// Local-only websocket drill. No production credentials, URLs or customer data.
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const root = new URL('../../', import.meta.url);
const local = JSON.parse(execFileSync('/opt/homebrew/bin/supabase', ['status','--output','json'], {cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if (!['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname)) throw new Error('Local backend required');
const sql = (query) => execFileSync('docker',['exec','-i','supabase_db_site-chat','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'],{input:query,encoding:'utf8'}).trim();
const fixture = sql("select c.workspace_id,c.id,m.user_id from public.conversations c join public.workspace_members m on m.workspace_id=c.workspace_id join public.workspaces w on w.id=c.workspace_id where m.role='owner' and m.status='active' and w.status='active' and w.deleted_at is null limit 1;");
const [workspace,conversation,user] = fixture.split('|');
if (!user) throw new Error('Local fixture missing');
const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned = `${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+300})}`;
const token = `${unsigned}.${createHmac('sha256',local.JWT_SECRET).update(unsigned).digest('base64url')}`;
const client = createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
let installed=false;
const report={local_only:true,delivery_verified:false};
try {
 if (sql("select count(*) from pg_policies where policyname='operator_public_messages_receive';") !== '0') throw new Error('Existing local migration: refusing to change it');
 sql(readFileSync(new URL('supabase/migrations/20261007130000_operator_message_broadcast.sql',root),'utf8'));
 installed=true;
 await client.realtime.setAuth(token);
 const id=randomUUID();
 let received;
 const arrival=new Promise(resolve=>{received=resolve;});
 const channel=client.channel(`operator-messages:${workspace}`,{config:{private:true}}).on('broadcast',{event:'message.created'},({payload})=>{if(payload.client_message_id===id)received(payload);});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Join timeout')),15000);
  channel.subscribe(state=>{if(state==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(state==='CHANNEL_ERROR'||state==='TIMED_OUT'){clearTimeout(timer);reject(new Error(state));}});
 });
 const start=performance.now();
 const {error}=await client.rpc('send_operator_message',{p_workspace_id:workspace,p_conversation_id:conversation,p_body:'Local Broadcast delivery verification',p_client_message_id:id});
 if(error)throw new Error(error.message);
 let timer;
 const row=await Promise.race([arrival,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Delivery timeout')),15000);})]).finally(()=>clearTimeout(timer));
 if(row.workspace_id!==workspace||row.conversation_id!==conversation||row.is_internal!==false)throw new Error('Invalid event');
 report.delivery_verified=true;
 report.send_to_receive_ms=Math.round(performance.now()-start);
 // Leave the live stream, commit while disconnected, and retry the same UUID.
 // Rejoin is not a replay protocol: recover persisted rows using the cursor.
 await client.removeChannel(channel);
 const missedId=randomUUID();
 const args={p_workspace_id:workspace,p_conversation_id:conversation,p_body:'Local offline recovery verification',p_client_message_id:missedId};
 for(let attempt=0;attempt<2;attempt++) {
  const result=await client.rpc('send_operator_message',args);
  if(result.error)throw new Error(result.error.message);
 }
 const resumedId=randomUUID();
 let receiveResumed;
 const resumedArrival=new Promise(resolve=>{receiveResumed=resolve;});
 const resumed=client.channel(`operator-messages:${workspace}`,{config:{private:true}}).on('broadcast',{event:'message.created'},({payload})=>{if(payload.client_message_id===resumedId)receiveResumed(payload);});
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Rejoin timeout')),15000);
  resumed.subscribe(state=>{if(state==='SUBSCRIBED'){clearTimeout(timeout);resolve();}else if(state==='CHANNEL_ERROR'||state==='TIMED_OUT'){clearTimeout(timeout);reject(new Error(state));}});
 });
 const history=await client.rpc('list_messages',{p_workspace_id:workspace,p_conversation_id:conversation,p_query:{after_sequence:row.sequence_number,limit:50}});
 if(history.error)throw new Error(history.error.message);
 const recovered=history.data.items.filter(item=>item.client_message_id===missedId);
 if(recovered.length!==1)throw new Error('Offline retry was missing or duplicated');
 report.offline_message_recovered=true;
 report.retry_persisted_rows=recovered.length;
 const resumedSend=await client.rpc('send_operator_message',{...args,p_body:'Local post-rejoin live delivery',p_client_message_id:resumedId});
 if(resumedSend.error)throw new Error(resumedSend.error.message);
 let resumedTimer;
 const delivered=await Promise.race([resumedArrival,new Promise((_,reject)=>{resumedTimer=setTimeout(()=>reject(new Error('Post-rejoin delivery timeout')),15000);})]).finally(()=>clearTimeout(resumedTimer));
 if(delivered.conversation_id!==conversation)throw new Error('Wrong post-rejoin conversation');
 report.live_delivery_after_rejoin=true;

} finally {
 await client.removeAllChannels();
 if(installed)sql('DROP TRIGGER broadcast_operator_public_message ON public.messages; DROP FUNCTION app_private.broadcast_operator_public_message(); DROP POLICY operator_public_messages_receive ON realtime.messages;');
 report.migration_removed=installed;
 writeFileSync(new URL('outputs/mill-local-broadcast-drill.json',root),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
