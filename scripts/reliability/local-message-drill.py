"""Isolated local PostgreSQL drill. Never connects to hosted databases.
Copies the running local Supabase DB using pg_dump/pg_restore, verifies records,
then exercises concurrent operator sends/retries in the restored copy.
Timings include Docker/psql process overhead; they are not API or UI latency.
"""
import concurrent.futures, json, pathlib, subprocess, time, uuid

container = 'supabase_db_site-chat'
database = 'mill_drill_' + uuid.uuid4().hex[:12]
backup = pathlib.Path('/private/tmp') / (database + '.dump')
root = pathlib.Path(__file__).resolve().parents[2]

def command(args, **kwargs):
    return subprocess.run(['docker', 'exec', '-i', container, *args], check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)

def sql(query):
    return command(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin',
                    '-d', database, '-Atc', query]).stdout.decode().strip()

report = {'environment': 'local restored database only', 'database': database}
created = False
try:
    started = time.perf_counter()
    dump = command(['pg_dump', '-U', 'postgres', '-d', 'postgres', '-Fc']).stdout
    backup.write_bytes(dump)
    command(['createdb', '-U', 'postgres', database]); created = True
    command(['pg_restore', '-U', 'supabase_admin', '-d', database,
             '--clean', '--if-exists', '--no-owner'], input=dump)
    report['dump_restore_seconds'] = round(time.perf_counter()-started, 3)
    source_counts = command(['psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atc',
        'select count(*) from public.messages; select count(*) from public.conversations;']).stdout.decode().strip()
    restored_counts = sql('select count(*) from public.messages; select count(*) from public.conversations;')
    assert source_counts == restored_counts, 'Restored row counts differ'
    report['restored_message_conversation_counts'] = restored_counts.splitlines()
    fingerprint_query = "select md5(string_agg(row_to_json(m)::text, '' order by m.id)) from public.messages m; select md5(string_agg(row_to_json(c)::text, '' order by c.id)) from public.conversations c;"
    source_fingerprint = command(['psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atc', fingerprint_query]).stdout.decode().strip()
    assert source_fingerprint == sql(fingerprint_query), 'Restored contents differ'
    report['restored_contents_match'] = True
    fixture = sql("select c.workspace_id,c.id,m.user_id from public.conversations c join public.workspace_members m on m.workspace_id=c.workspace_id where m.role='owner' limit 1;")
    workspace, conversation, user = fixture.split('|')

    def send(client_id):
        begin = time.perf_counter()
        query = f"begin; set local request.jwt.claim.sub='{user}'; select public.send_operator_message('{workspace}','{conversation}','Reliability drill','{client_id}')->'message'->>'id'; commit;"
        try:
            output = sql(query)
            return {'ok': True, 'seconds': time.perf_counter()-begin, 'output': output}
        except subprocess.CalledProcessError as error:
            return {'ok': False, 'seconds': time.perf_counter()-begin, 'error': error.stderr.decode()[-500:]}

    def exercise(label):
        client_id = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
            results = list(pool.map(send, [client_id]*48))
        count = int(sql(f"select count(*) from public.messages where conversation_id='{conversation}' and client_message_id='{client_id}';"))
        report[label] = {'attempts': len(results), 'successes': sum(r['ok'] for r in results),
                         'persisted_messages': count,
                         'errors': [r['error'] for r in results if not r['ok']][:2]}
        return report[label]

    exercise('before_concurrent_retry')
    migration = root / 'supabase/migrations/20261007020000_operator_message_retry_lock.sql'
    command(['psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',database], input=migration.read_bytes())
    result = exercise('after_concurrent_retry')
    assert result['successes'] == result['attempts'] and result['persisted_messages'] == 1
    ids = [str(uuid.uuid4()) for _ in range(240)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        results = list(pool.map(send, ids))
    assert all(r['ok'] for r in results), 'Unique sends failed'
    unique_count = int(sql("select count(*) from public.messages where client_message_id in (" + ','.join("'"+i+"'" for i in ids) + ');'))
    assert unique_count == len(ids), 'Accepted message lost'
    times = sorted(r['seconds'] for r in results)
    report['unique_sends'] = {'accepted': len(ids), 'persisted': unique_count,
        'workers': 24, 'psql_with_process_overhead_p95_seconds': round(times[int(len(times)*.95)-1],3)}
except subprocess.CalledProcessError as error:
    report['failure'] = error.stderr.decode()[-6000:]
    raise
finally:
    if created: command(['dropdb', '-U', 'postgres', database])
    backup.unlink(missing_ok=True)
    report['isolated_copy_removed'] = True
    destination = root / 'outputs/mill-local-message-drill.json'
    destination.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))
