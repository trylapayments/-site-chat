INSERT INTO mobile_push_devices(user_id,installation_id,workspace_id,member_id,token) VALUES
('00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','ExpoPushToken[fixture1]'),
('00000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','ExpoPushToken[fixture2]'),
('00000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','ExpoPushToken[fixture3]');
INSERT INTO notifications(workspace_id,recipient_id,conversation_id,type) VALUES
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','conversation_new'),
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','unrelated'),
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',NULL,'visitor_message'),
('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','visitor_message'),
('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','visitor_message');
DO $$ BEGIN
  IF (SELECT count(*) FROM mobile_push_outbox)<>1 THEN RAISE EXCEPTION 'recipient/workspace/active routing failed'; END IF;
  IF has_table_privilege('authenticated','mobile_push_devices','SELECT') OR has_table_privilege('anon','mobile_push_outbox','INSERT') THEN RAISE EXCEPTION 'private table exposed'; END IF;
  IF has_function_privilege('authenticated','claim_mobile_push(integer)','EXECUTE') OR has_function_privilege('anon','claim_mobile_push(integer)','EXECUTE') THEN RAISE EXCEPTION 'claim RPC exposed'; END IF;
  IF NOT has_function_privilege('service_role','claim_mobile_push(integer)','EXECUTE') THEN RAISE EXCEPTION 'server cannot claim'; END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('mobile_push_devices'::regclass,'mobile_push_outbox'::regclass) AND relrowsecurity)<>2 THEN RAISE EXCEPTION 'RLS disabled'; END IF;
END $$;
INSERT INTO mobile_push_outbox(notification_id,device_id) SELECT notification_id,device_id FROM mobile_push_outbox ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF (SELECT count(*) FROM mobile_push_outbox)<>1 THEN RAISE EXCEPTION 'duplicate push job'; END IF;
  IF jsonb_array_length(claim_mobile_push(100))<>1 THEN RAISE EXCEPTION 'initial claim failed'; END IF;
  IF jsonb_array_length(claim_mobile_push(10))<>0 THEN RAISE EXCEPTION 'claimed job leased twice'; END IF;
END $$;
UPDATE mobile_push_outbox SET claimed_at=now()-interval '3 minutes';
DO $$ BEGIN
  IF jsonb_array_length(claim_mobile_push(10))<>1 THEN RAISE EXCEPTION 'expired lease not reclaimed'; END IF;
  IF (SELECT attempts FROM mobile_push_outbox)<>2 THEN RAISE EXCEPTION 'attempt count failed'; END IF;
END $$;
UPDATE mobile_push_outbox SET status='sent';
DO $$ BEGIN
  IF jsonb_array_length(claim_mobile_push(10))<>0 THEN RAISE EXCEPTION 'sent job reclaimed'; END IF;
  BEGIN
    INSERT INTO mobile_push_devices(user_id,installation_id,workspace_id,member_id,token) VALUES ('00000000-0000-4000-8000-000000000001',gen_random_uuid(),'10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','ExpoPushToken[fixture4]');
    RAISE EXCEPTION 'cross-workspace member accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO mobile_push_devices(user_id,installation_id,workspace_id,member_id,token) VALUES ('00000000-0000-4000-8000-000000000001',gen_random_uuid(),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','invalid-token');
    RAISE EXCEPTION 'invalid token accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'isolated mobile push schema checks passed';
