import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const url=process.env.VITE_SUPABASE_URL, key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Use node --env-file=.env.local tests/production-readonly.mjs. Somente a chave pública é necessária.');
const endpoint=`${url}/functions/v1/barber-api`;
let checks=0;
async function call(action,payload={},token) {
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',apikey:key,...(token?{'x-device-token':token}:{})},body:JSON.stringify({action,payload}),signal:AbortSignal.timeout(20000)});
  return {status:response.status,body:await response.json()};
}
const catalog=await call('catalog');assert.equal(catalog.status,200);checks++;
assert.equal(typeof catalog.body.data.whatsapp.reminder_available,'boolean');checks++;
assert.ok(!Object.hasOwn(catalog.body.data.whatsapp,'access_token'));checks++;
const barber=catalog.body.data.barbers[0],service=catalog.body.data.barber_services.find(b=>b.barber_id===barber.id);
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(Date.now()+2*86400000));
const slots=await call('slots',{barber_id:barber.id,services:[service.service_id],day});assert.equal(slots.status,200);checks++;
assert.ok(slots.body.data.every(s=>new Date(s.end)-new Date(s.start)===3600000));checks++;
const token=randomBytes(32).toString('base64url');
assert.deepEqual((await call('mine',{},token)).body.data,[]);checks++;
assert.equal((await call('restore',{},token)).status,403);checks++;
for (const action of ['whoami','admin_export','notifications','reserve_extra','integration_status']) {assert.equal((await call(action)).status,401);checks++;}
assert.equal((await call('mine',{},'invalid')).status,401);checks++;
const privateRpc=await fetch(`${url}/rest/v1/rpc/barber_rpc`,{method:'POST',headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify({p_action:'admin_export'}),signal:AbortSignal.timeout(20000)});
assert.ok([401,403,404].includes(privateRpc.status));checks++;
const worker=await fetch(`${url}/functions/v1/whatsapp-worker`,{method:'POST',signal:AbortSignal.timeout(20000)});assert.equal(worker.status,401);checks++;
console.log(JSON.stringify({checks,passed:true,reminderAvailable:catalog.body.data.whatsapp.reminder_available,slots:slots.body.data.length,deviceCreated:false,bookingsCreated:false,messagesSent:false},null,2));
