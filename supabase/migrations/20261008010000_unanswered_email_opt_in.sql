-- Existing widgets are opt-in too; owners can enable this again in settings.
UPDATE public.workspace_chat_settings SET config=jsonb_set(config,'{unansweredEmailEnabled}','false'::jsonb),version=version+1;
UPDATE public.site_chat_settings SET config=jsonb_set(config,'{unansweredEmailEnabled}','false'::jsonb),version=version+1;
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.widget_save_reply_email(uuid,text,text)'::regprocedure) INTO definition;
 definition:=replace(definition, 'unansweredEmailEnabled'')::boolean,true)', 'unansweredEmailEnabled'')::boolean,false)');
 EXECUTE definition;
END $migration$;
