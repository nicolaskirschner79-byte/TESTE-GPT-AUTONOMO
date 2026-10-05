const day = '2026-10-05';
const instant = hour => `${day}T${hour}:00-03:00`;
function booking(id, name, hour, status, total = 35, services = ['Corte']) {
  return { id, customer_name: name, customer_phone: '5511999990000', barber_id: 'barber-a', barber_name: 'Nicolas', starts_at: instant(hour), ends_at: new Date(+new Date(instant(hour)) + 40 * 60000).toISOString(), status, total, paid: status === 'concluido' ? total : 0, reminder_consent: true, version: 1, items: services.map(name => ({ name, price: total / services.length, duration: 40 / services.length })) };
}
export function agendaFixture() {
  return {
    settings: { shop_name: 'FLÁVIO BARBER', branding: { accent_color: '#d73737', header_color: '#000000', background_color: '#f6f7f9', font: 'inter' } },
    bookings: [booking('pedro','Pedro Alves','09:00','concluido'),booking('lucas','Lucas Santos','10:00','concluido',55,['Corte','Barba']),booking('rafael','Rafael Lima','11:00','em_atendimento'),booking('joao','João Costa','14:00','confirmado',20,['Barba']),booking('matheus','Matheus Souza','15:00','agendado')],
    barbers: [{ id: 'barber-a', name: 'Nicolas', active: true }],
    services: [{ id: 'cut', name: 'Corte', active: true, duration: 40, price: 35 },{ id:'brow', name:'Sobrancelha', active:true,duration:10,price:5 }],
    barber_services: [{ barber_id:'barber-a',service_id:'cut' },{barber_id:'barber-a',service_id:'brow'}],
    hours: [{ barber_id:'barber-a',weekday:1,opens:'09:00:00',closes:'19:00:00',lunch_start:'12:00:00',lunch_end:'13:00:00',slot_minutes:60 }],special_hours:[],blocks:[],payments:[],expenses:[],notifications:[],
    agenda_slots: [{ barber_id:'barber-a',day,minimum_duration:10,slots:['13:00','16:00','17:00'].map(hour=>({start:instant(hour),end:new Date(+new Date(instant(hour))+10*60000).toISOString()})) }],
  };
}
export const fixtureFilters = { day, view:'day',barber:'',search:'',status:'',selected:'' };
export const fixtureNow = new Date('2026-10-05T11:20:00-03:00');
