import test from 'node:test';
import assert from 'node:assert/strict';
import { configFromInput, validateConnection, publicConfig } from '../supabase/functions/_shared/whatsapp-config.ts';
import { runQueue } from '../supabase/functions/_shared/notification-processor.ts';
import { notificationStatus } from '../supabase/functions/_shared/notification-status.ts';
import { whatsappSettingsMarkup, whatsappConnectionFields } from '../src/whatsapp-editor.js';

const config={access_token:'private-token',phone_number_id:'123456',sender_phone:'5511999999999',waba_id:'654321',graph_version:'v25.0',reminder_template:'barber_booking_reminder',automatic_enabled:true};
const template={name:config.reminder_template,status:'APPROVED',language:'pt_BR',components:[{type:'BODY',text:'Olá {{1}} na {{2}} em {{3}}, {{4}} com {{5}}. {{6}}.'}]};
function validationFetch(override={}){return async (url,opts)=>{
 assert.equal(opts.headers.Authorization,'Bearer private-token');assert.ok(!url.includes('private-token'));
 if(url.includes('/phone_numbers'))return Response.json({data:[{id:config.phone_number_id,display_phone_number:'+55 11 99999-9999',verified_name:'Barbearia'}]});
 return Response.json({data:[{...template,...override}]});
};}
const job={id:'job',recipient:'5511888888888',kind:'reminder',attempts:1,payload:{shop_name:'Barbearia',booking:{customer_name:'Cliente',starts_at:'2026-10-08T13:00:00Z',barber_name:'Nicolas',items:[{name:'Corte'}]}}};
function clientFixture({prepare=job}={}){
 const calls=[];
 return {calls,rpc:async(_,{p_action,p_payload})=>{calls.push({action:p_action,payload:p_payload});return {data:p_action==='claim'?[job]:p_action==='prepare'?prepare:{ok:true}};}};
}
test('conexão preserva segredos em branco e valida IDs e versão antes da Meta',()=>{
 const input={...config,access_token:''};assert.equal(configFromInput(input,config).access_token,'private-token');
 assert.throws(()=>configFromInput({...input,phone_number_id:'../messages'},config));
 assert.throws(()=>configFromInput({...input,graph_version:'https://attacker.test'},config));
 assert.throws(()=>configFromInput({...input,reminder_template:'Modelo Inválido'},config));
 const publicData=publicConfig({...config,app_secret:'secret-app',verify_token:'secret-verify'});
 assert.ok(!JSON.stringify(publicData).includes('private-token'));assert.ok(!JSON.stringify(publicData).includes('secret-app'));assert.ok(!JSON.stringify(publicData).includes('secret-verify'));
});
test('conta e modelo aprovado são validados sem enviar mensagens',async()=>{
 const ready=await validateConnection(config,validationFetch());assert.equal(ready.sender_phone,config.sender_phone);assert.ok(ready.verified_at);
 await assert.rejects(validateConnection({...config,phone_number_id:'999999'},validationFetch()),/não pertence/);
 await assert.rejects(validateConnection(config,validationFetch({status:'PENDING'})),/aprovado/);
 await assert.rejects(validateConnection(config,validationFetch({parameter_format:'NAMED'})),/numerados/);
 await assert.rejects(validateConnection(config,validationFetch({components:[{type:'BODY',text:'{{1}} {{2}}'}]})),/6 parâmetros/);
 await assert.rejects(validateConnection(config,validationFetch({components:[...template.components,{type:'BUTTONS',buttons:[]}]})),/botões/);
});
test('lembrete funciona sem modelo de aviso ao barbeiro e não expõe segredo no HTML',()=>{
 const status=notificationStatus(k=>({WHATSAPP_ACCESS_TOKEN:'t',WHATSAPP_PHONE_NUMBER_ID:'id',WHATSAPP_SENDER_PHONE:'phone',WHATSAPP_GRAPH_VERSION:'v25.0',WHATSAPP_REMINDER_TEMPLATE:'model'})[k]);
 assert.equal(status.whatsapp.configured,true);assert.equal(status.whatsapp.owner_configured,false);
 const html=whatsappConnectionFields({whatsapp:{...publicConfig(config),verified_name:'<script>bad</script>'}})+whatsappSettingsMarkup({whatsapp:{configured:true,...publicConfig(config),verified_name:'<script>bad</script>'}});
 assert.ok(!html.includes('private-token'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('30 minutos'));assert.ok(html.includes('Conectar'));
});
test('worker sem configuração não retira mensagens da fila',async()=>{
 const client=clientFixture();let sent=0;
 assert.deepEqual(await runQueue(client,{},async()=>{sent++;}),{configured:false,processed:0});assert.equal(sent,0);assert.deepEqual(client.calls.map(x=>x.action),['maintenance']);
});
test('worker enfileira automaticamente e envia seis parâmetros com id para webhook',async()=>{
 const client=clientFixture();let sent=0;
 const result=await runQueue(client,config,async(url,opts)=>{sent++;assert.ok(url.endsWith('/123456/messages'));const body=JSON.parse(opts.body);assert.equal(body.to,job.recipient);assert.equal(body.template.components[0].parameters.length,6);assert.ok(body.template.components[0].parameters[2].text.includes('10:00'));assert.equal(body.biz_opaque_callback_data,'job');return Response.json({messages:[{id:'wamid.ok'}]});});
 assert.equal(result.processed,1);assert.equal(sent,1);assert.deepEqual(client.calls.slice(0,2).map(x=>x.action),['maintenance','enqueue_reminders']);
 assert.deepEqual(client.calls.find(x=>x.action==='claim').payload.kinds,['reminder']);assert.equal(client.calls.at(-1).payload.status,'sent');
});
test('reserva invalidada entre claim e envio não recebe mensagem',async()=>{
 const client=clientFixture({prepare:null});let sent=0;
 await runQueue(client,config,async()=>{sent++;});assert.equal(sent,0);assert.ok(!client.calls.some(x=>x.action==='result'));
});
test('pausa da automação não enfileira e impede claim de lembretes automáticos',async()=>{
 const client=clientFixture();await runQueue(client,{...config,automatic_enabled:false},async()=>Response.json({messages:[{id:'wamid.ok'}]}));
 assert.ok(!client.calls.some(x=>x.action==='enqueue_reminders'));assert.equal(client.calls.find(x=>x.action==='claim').payload.automatic_enabled,false);
});
test('timeout fica para conferência e erro 429 recebe nova tentativa',async()=>{
 for(const [fetcher,status] of [[async()=>{throw new Error('timeout');},'unknown'],[async()=>Response.json({error:{code:80007}},{status:429}),'pending'],[async()=>Response.json({error:{}},{status:500}),'unknown']]){
  const client=clientFixture();await runQueue(client,config,fetcher);assert.equal(client.calls.at(-1).payload.status,status);
 }
});
