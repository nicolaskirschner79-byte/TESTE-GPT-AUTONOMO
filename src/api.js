import { createClient } from '@supabase/supabase-js';
import { requestJson } from './transport.js';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw new Error('Configure as variáveis públicas do Supabase antes de iniciar.');
export const auth=createClient(url,key,{auth:{storageKey:'barber-owner-auth',persistSession:true,detectSessionInUrl:true}});
export const realtime=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const DEVICE_KEY='barber-device-token';
export function deviceToken() {
  let token=localStorage.getItem(DEVICE_KEY);
  if(!token){token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');localStorage.setItem(DEVICE_KEY,token);}
  return token;
}
let ready;
export async function api(action,payload={},admin=false) {
  const headers={'Content-Type':'application/json',apikey:key};
  if(admin){const {data}=await auth.auth.getSession();if(!data.session){const error=new Error('Entre novamente no painel.');error.status=401;throw error;}headers.Authorization=`Bearer ${data.session.access_token}`;}
  else headers['x-device-token']=deviceToken();
  return requestJson(`${url}/functions/v1/barber-api`,{method:'POST',headers,body:JSON.stringify({action,payload})});
}
export async function ensureDevice(){return ready??=api('session').catch(e=>{ready=null;throw e;});}
export function forgetDevice(){localStorage.removeItem(DEVICE_KEY);localStorage.removeItem('barber-contact');localStorage.removeItem('barber-pending-booking');ready=null;}
export function watchChanges(callback,onConnection=()=>{}) {
  let timeout;
  const refresh=()=>{clearTimeout(timeout);timeout=setTimeout(callback,250);};
  const channel=realtime.channel(`availability-${crypto.randomUUID()}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'availability_signal'},refresh).subscribe(status=>{onConnection(status==='SUBSCRIBED');if(status==='SUBSCRIBED')refresh();});
  const visible=()=>{if(!document.hidden)refresh();};
  document.addEventListener('visibilitychange',visible);window.addEventListener('online',refresh);
  const poll=setInterval(()=>{if(!document.hidden)refresh();},45000);
  return ()=>{clearInterval(poll);clearTimeout(timeout);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',refresh);realtime.removeChannel(channel);};
}
