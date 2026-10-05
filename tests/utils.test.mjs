import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone,dayKey,localInstant,metrics,escape } from '../src/utils.js';
test('telefone brasileiro normalizado com DDD e país',()=>{assert.equal(normalizePhone('(15) 99685-5412'),'5515996855412');assert.equal(normalizePhone('+55 15 99685-5412'),'5515996855412');assert.throws(()=>normalizePhone('1234'));});
test('dia e instante respeitam São Paulo, incluindo virada UTC',()=>{assert.equal(dayKey(new Date('2026-10-06T01:00:00Z')),'2026-10-05');assert.equal(localInstant('2026-10-06','09:00'),'2026-10-06T12:00:00.000Z');});
test('cancelamento remove previsão e preserva recebido até estorno',()=>{const data={bookings:[{starts_at:'2026-10-06T12:00Z',status:'cancelado',total:35,paid:35},{starts_at:'2026-10-06T13:00Z',status:'agendado',total:55,paid:10}],payments:[{created_at:'2026-10-06T12:00Z',kind:'payment',amount:45},{created_at:'2026-10-06T13:00Z',kind:'refund',amount:5}],expenses:[{day:'2026-10-06',amount:8}]};const m=metrics(data,'2026-10-06','2026-10-06');assert.equal(m.forecast,45);assert.equal(m.received,40);assert.equal(m.profit,32);assert.equal(m.cancelled,1);});
test('conteúdo de cliente é escapado para impedir HTML executável',()=>assert.equal(escape('<img src=x onerror="alert(1)">'),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
