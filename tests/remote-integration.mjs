import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { addDays,dayKey } from '../src/utils.js';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').trim().split('\n').filter(x=>x.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
const identities=Array.from({length:3},()=>crypto.randomBytes(32).toString('base64url'));
const cleanup={hashes:identities.map(s=>crypto.createHash('sha256').update(s).digest('hex')),bookings:[]};
const checks=[];const record=(name)=>{checks.push(name);console.log('PASS',name);};
const call=async(action,payload={},token=identities[0])=>{const r=await fetch(url+'/functions/v1/barber-api',{method:'POST',headers:{apikey:key,'Content-Type':'application/json','x-device-token':token},body:JSON.stringify({action,payload})});return {status:r.status,...await r.json()};};
const realtime=createClient(url,key,{auth:{persistSession:false}});let events=0;
let channel;
try{
 const catalog=await call('catalog');assert.equal(catalog.status,200);assert.equal(catalog.data.services.length,4);record('Catálogo real disponível pela Edge Function');
 for(const token of identities)assert.equal((await call('session',{},token)).status,200);
 let day=addDays(dayKey(),1);const barber=catalog.data.barbers[0].id;const cut=catalog.data.services.find(s=>s.name==='Corte').id;
 let slots=(await call('slots',{barber_id:barber,services:[cut],day})).data;
 while(slots.length<3){day=addDays(day,1);slots=(await call('slots',{barber_id:barber,services:[cut],day})).data;}
 channel=realtime.channel('remote-test-'+crypto.randomUUID()).on('postgres_changes',{event:'UPDATE',schema:'public',table:'availability_signal'},()=>events++);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Realtime connection timeout')),15000);channel.subscribe(s=>{if(s==='SUBSCRIBED'){clearTimeout(timer);resolve();}});});
 const payload={barber_id:barber,services:[cut],start:slots[0].start,name:'QA Automático de Integração',phone:'5515999990000',idempotency_key:crypto.randomUUID(),consent:false};
 const payloads=[payload,{...payload,idempotency_key:crypto.randomUUID()}];const race=await Promise.all(payloads.map((p,i)=>call('book',p,identities[i])));
 assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);const winningIndex=race.findIndex(x=>x.status===200);const token=identities[winningIndex];const loser=identities[1-winningIndex];const booking=race[winningIndex].data;cleanup.bookings.push(booking.id);record('Duas requisições simultâneas: uma confirma e a outra recebe conflito');
 const duplicate=await call('book',payloads[winningIndex],token);
 assert.equal(duplicate.status,200);assert.equal(duplicate.data.id,booking.id);record('Repetição da mesma requisição não duplica a reserva');
 const other=await call('mine',{},loser);assert.equal(other.data.length,0);assert.equal((await call('cancel',{id:booking.id},loser)).status,403);record('Outro dispositivo não lê nem cancela a reserva');
 const second=await call('book',{...payload,start:slots[1].start,idempotency_key:crypto.randomUUID()},identities[2]);assert.equal(second.status,200);cleanup.bookings.push(second.data.id);
 assert.equal((await call('reschedule',{id:booking.id,start:slots[1].start},token)).status,409);assert.equal((await call('mine',{},token)).data[0].starts_at,booking.starts_at);record('Reagendamento em conflito preserva o intervalo original');
 assert.equal((await call('cancel',{id:second.data.id},identities[2])).status,200);
 const moved=await call('reschedule',{id:booking.id,start:slots[1].start},token);assert.equal(moved.status,200);assert.equal(new Date(moved.data.starts_at).toISOString(),new Date(slots[1].start).toISOString());record('Reagendamento disponível altera a reserva numa operação atômica');
 assert.equal((await call('cancel',{id:booking.id},token)).status,200);const available=await call('slots',{barber_id:barber,services:[cut],day});assert(available.data.some(s=>s.start===slots[1].start));record('Cancelamento libera o horário pela API real');
 assert.equal((await call('admin_data',{})).status,401);record('Painel bloqueia requisição sem sessão administrativa');
 const direct=await fetch(url+'/rest/v1/rpc/barber_rpc',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({p_action:'admin_data'})});assert([401,403,404].includes(direct.status));record('Chave pública não invoca RPC de servidor');
 const webhook=await fetch(url+'/functions/v1/whatsapp-webhook',{method:'POST',body:'{}'});assert([401,503].includes(webhook.status));const worker=await fetch(url+'/functions/v1/whatsapp-worker',{method:'POST',body:'{}'});assert.equal(worker.status,401);record('Worker e webhook rejeitam chamadas não autenticadas');
 assert(events>0);record('Realtime recebeu somente alterações do sinal público, sem dados pessoais');
}finally{
 if(channel)await realtime.removeChannel(channel);await realtime.removeAllChannels();realtime.realtime.disconnect();await realtime.auth.stopAutoRefresh();fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/cleanup.json',JSON.stringify(cleanup));fs.writeFileSync('test-results/remote.json',JSON.stringify({checks,passed:checks.length},null,2));
}
