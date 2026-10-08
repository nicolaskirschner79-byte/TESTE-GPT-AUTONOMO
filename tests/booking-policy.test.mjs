import test from 'node:test';
import assert from 'node:assert/strict';
import { canCustomerChange, cancellationDeadline, additionalBookingMinutes, reminderAvailable, parseAccessKey } from '../src/booking-policy.js';
import { requiresSecondFactor } from '../supabase/functions/_shared/auth-policy.ts';
import { requestJson } from '../src/transport.js';
import { integrationStatusMarkup } from '../src/integration-view.js';

test('prazo de alteração respeita dois minutos, duas horas, limite exato e status', () => {
  const b = { starts_at: '2026-10-08T15:00:00-03:00', status: 'confirmado' };
  assert.equal(cancellationDeadline(b,120).toISOString(),'2026-10-08T16:00:00.000Z');
  assert.equal(canCustomerChange(b,120,new Date('2026-10-08T16:00:00Z')),true);
  assert.equal(canCustomerChange(b,120,new Date('2026-10-08T16:00:00.001Z')),false);
  assert.equal(canCustomerChange(b,2,new Date('2026-10-08T17:57:59Z')),true);
  assert.equal(canCustomerChange(b,0,new Date(b.starts_at)),false);
  assert.equal(canCustomerChange({...b,status:'cancelado'},120,new Date('2026-10-08T15:00:00Z')),false);
});
test('serviços combinados pedem blocos completos sem alterar a reserva de uma hora', () => {
  assert.equal(additionalBookingMinutes([{duration:40},{duration:10}]),0);
  assert.equal(additionalBookingMinutes([{duration:40},{duration:25}]),60);
  assert.equal(additionalBookingMinutes([{duration:120}]),60);
  assert.equal(additionalBookingMinutes([{duration:120},{duration:25}]),120);
});
test('consentimento só é oferecido quando a integração confirma disponibilidade', () => {
  assert.equal(reminderAvailable({}),false);
  assert.equal(reminderAvailable({whatsapp:{reminder_available:false}}),false);
  assert.equal(reminderAvailable({whatsapp:{reminder_available:true}}),true);
  assert.throws(()=>parseAccessKey('5511999999999'));
  assert.throws(()=>parseAccessKey('<script>'));
  assert.equal(parseAccessKey('  '+'a'.repeat(43)+'  '),'a'.repeat(43));
});
test('proprietário com fator verificado exige aal2; identidade do JWT precisa corresponder', async () => {
  const user = {id:'owner',factors:[{status:'verified'}]};
  assert.equal(requiresSecondFactor(user,{sub:'owner',aal:'aal1'}),true);
  assert.equal(requiresSecondFactor(user,{sub:'owner',aal:'aal2'}),false);
  assert.equal(requiresSecondFactor(user,{sub:'other',aal:'aal2'}),true);
  assert.equal(requiresSecondFactor({id:'owner',factors:[]},{sub:'owner',aal:'aal1'}),false);
  await assert.rejects(requestJson('https://example.test',{}, {fetcher:async()=>Response.json({error:'Confirme o autenticador',code:'MFA_REQUIRED'},{status:403})}), e=>e.status===403&&e.code==='MFA_REQUIRED');
});
test('saúde usa contagem total e identifica worker parado, falhas e configuração parcial', () => {
  const now = new Date('2026-10-08T18:00:00Z');
  const status = {whatsapp:{configured:true},health:{queue:{pending:201,failed:7,unknown:2},worker:{last_checked_at:'2026-10-08T17:55:00Z'}}};
  const html=integrationStatusMarkup(status,[{status:'pending'}],now);
  assert.ok(html.includes('201 mensagens')); assert.ok(html.includes('7 com falha')); assert.ok(html.includes('2 aguardando conferência')); assert.ok(html.includes('sem verificação recente'));
  const partial=integrationStatusMarkup({whatsapp:{configured:false,owner_configured:true}},[],now);
  assert.ok(partial.includes('avisos ao barbeiro configurados')); assert.ok(partial.includes('Lembretes ao cliente ainda não'));
});
