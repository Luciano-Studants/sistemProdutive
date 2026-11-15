import './style.css';
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { BUILD, otaEnabled, markReady, checkUpdate, applyNow } from './ota.js';
import * as HB from './habits.js';
import { LEAD, ROUTINE, KIND_LABEL, buildPlan, dueNow, alertItems, fmtDue } from './plan.js';

(function(){
'use strict';
var AREAS={casa:'Casa',faculdade:'Faculdade',estudo:'Estudo',projeto:'Projeto',plan:'Planejamento',livre:'Livre',outros:'Outros'};
var AREA_KEYS=Object.keys(AREAS);
var SLOTS=[{k:'a',t:'18:00–18:30'},{k:'b',t:'18:30–20:30'},{k:'c',t:'21:00–22:30'},{k:'f',t:'22:30–23:00'}];
var DOW=['dom','seg','ter','qua','qui','sex','sáb'];
var DOW_FULL=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
var WEEK_ORDER=[1,2,3,4,5,6,0];
var ST_LABEL=['A estudar','Estudando','Dominado'];
var CHECK='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
var XICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
var TABS=[
 {k:'hoje',n:'Hoje',i:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'},
 {k:'semana',n:'Semana',i:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'},
 {k:'faculdade',n:'Faculdade',i:'<path d="M3 9l9-5 9 5-9 5-9-5z"/><path d="M7 11.5V16c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5v-4.5"/>'},
 {k:'estudos',n:'Estudos',i:'<path d="M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3V4z"/><path d="M5 17a3 3 0 013-3h10"/>'},
 {k:'projetos',n:'Projetos',i:'<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><path d="M13 16.5h7"/>'},
 {k:'habitos',n:'Hábitos',i:'<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>'}
];

/* ---------- utilidades ---------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pad(n){return String(n).padStart(2,'0');}
function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function parse(k){var p=k.split('-').map(Number);return new Date(p[0],p[1]-1,p[2]);}
function todayKey(){return ymd(new Date());}
function addDays(k,n){var d=parse(k);d.setDate(d.getDate()+n);return ymd(d);}
function diffDays(a,b){return Math.round((parse(a)-parse(b))/86400000);}
function shortD(k){var p=k.split('-');return p[2]+'/'+p[1];}
function uid(){return Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-4);}
function clone(o){return JSON.parse(JSON.stringify(o));}
function fmtMin(m){m=Math.round(m||0);if(m<60)return m+' min';var h=Math.floor(m/60),r=m%60;return h+'h'+(r?pad(r):'');}
function avg(a){return a.length?a.reduce(function(x,y){return x+y;},0)/a.length:0;}
function fmt1(n){return n.toFixed(1).replace('.',',');}
function slotT(k){return SLOTS.filter(function(s){return s.k===k;})[0].t;}

/* ---------- estado ---------- */
function defTemplate(){
  function t(l,a){return {l:l,a:a};}
  return {
    1:{a:t('Planejar o dia','plan'),b:t('Faculdade','faculdade'),c:t('Matemática','estudo')},
    2:{a:t('Lixo e planejar o dia','casa'),b:t('Projeto dev','projeto'),c:t('Programação','estudo')},
    3:{a:t('Planejar o dia','plan'),b:t('Faculdade','faculdade'),c:t('Física','estudo')},
    4:{a:t('Lixo e planejar o dia','casa'),b:t('Projeto dev','projeto'),c:t('Matemática','estudo')},
    5:{a:t('Limpar a área da casa','casa'),b:t('Projeto dev','projeto'),c:t('Design (Photoshop) leve','projeto')},
    6:{a:t('Tirar o lixo','casa'),b:t('Design ou projeto pessoal','projeto'),c:t('Revisão da semana e plano da próxima','plan')},
    0:{a:t('Livre','livre'),b:t('Livre','livre'),c:t('Ideias e descanso','livre')}
  };
}
function defState(){
  return {v:1,updatedAt:0,template:defTemplate(),tasks:[],deadlines:[],events:[],
    subjects:[{id:'s1',name:'Matemática',min:0,topics:[]},{id:'s2',name:'Física',min:0,topics:[]},{id:'s3',name:'Programação',min:0,topics:[]}],
    projects:[],ideas:[],days:{},screenGoal:120,notif:{on:false},
    courses:[],habits:[],branches:[{id:'dev',name:'Desenvolvimento'},{id:'design',name:'Design'}],pomo:{total:120,focus:25}};
}
function normalize(r){
  var d=defState(),s=Object.assign(d,r||{});
  ['tasks','deadlines','events','subjects','projects','ideas'].forEach(function(k){if(!Array.isArray(s[k]))s[k]=[];});
  ['courses','habits','branches'].forEach(function(k){if(!Array.isArray(s[k]))s[k]=defState()[k];});
  s.courses.forEach(function(c){if(!Array.isArray(c.mats))c.mats=[];c.mats.forEach(function(m){if(!Array.isArray(m.discs))m.discs=[];});});
  s.habits.forEach(function(h){if(!h.logs||typeof h.logs!=='object')h.logs={};});
  if(!s.pomo||typeof s.pomo!=='object')s.pomo={total:120,focus:25};
  if(s.pomo.focus!==50)s.pomo.focus=25;
  if(!(s.pomo.total>=10&&s.pomo.total<=720))s.pomo.total=120;
  if(!s.days||typeof s.days!=='object')s.days={};
  var dt=defTemplate();
  if(!s.template||typeof s.template!=='object')s.template=dt;
  for(var i=0;i<7;i++){
    if(!s.template[i])s.template[i]=dt[i];
    ['a','b','c'].forEach(function(k){if(!s.template[i][k])s.template[i][k]=dt[i][k];});
  }
  if(typeof s.screenGoal!=='number')s.screenGoal=120;
  if(!s.notif||typeof s.notif!=='object')s.notif={on:false};
  if(typeof s.updatedAt!=='number')s.updatedAt=0;
  return s;
}
var S=defState(),tab='hoje',confirmKey='',curDay=todayKey();
var timer={plan:[],idx:0,sig:'',left:0,running:false,endAt:0,subj:'',done:'',iv:0};
var sync='load',saving=false,dirty=false,failed=false,saveTimer=0,loadTimer=0;
var EMPTY={blocks:{},main:'',next:'',screen:null,focusMin:0};

function getDay(k){return S.days[k]||EMPTY;}
function ensureDay(k){
  if(!S.days[k])S.days[k]={blocks:{},main:'',next:'',screen:null,focusMin:0};
  var d=S.days[k];if(!d.blocks)d.blocks={};return d;
}
function cell(dow,slot){
  if(slot==='f')return {l:'Fechamento do dia',a:'plan'};
  return (S.template[dow]&&S.template[dow][slot])||{l:'Livre',a:'livre'};
}
function touch(){S.updatedAt=Math.max(Date.now(),S.updatedAt+1);}
function mutate(fn,opts){
  fn(S);touch();
  if(!opts||opts.render!==false)render();
  scheduleSave();
}
function rollover(){
  var t=todayKey(),ch=false;
  S.tasks.forEach(function(x){
    if(!x.done&&x.date<t){x.from=x.from||x.date;x.date=t;x.slot='';x.time='';ch=true;}
  });
  return ch;
}

/* ---------- armazenamento, conta e sincronia (Supabase) ---------- */
var SB_URL=import.meta.env.VITE_SUPABASE_URL||'',SB_KEY=import.meta.env.VITE_SUPABASE_ANON_KEY||'';
var sb=(SB_URL&&SB_KEY)?createClient(SB_URL,SB_KEY):null;
var session=null,userId=null,chan=null,authMsg='',authEmail='',importMsg='';
var NATIVE=Capacitor.isNativePlatform();
var DESKTOP=!NATIVE&&!!window.rotinaDesktop;

function lsKeyFor(id){return 'rotina-noturna-v2:'+(id||'local');}
function lsLoadKey(id){try{var r=localStorage.getItem(lsKeyFor(id));if(r)return normalize(JSON.parse(r));}catch(e){}return null;}
function lsSave(){
  if(sb&&!userId)return;
  try{localStorage.setItem(lsKeyFor(userId),JSON.stringify(S));}catch(e){}
}
var SYNC_TXT={load:'Conectando…',ok:'Sincronizado',saving:'Salvando…',local:'Só neste aparelho',err:'Falha ao salvar, tentando de novo',slow:'Sem resposta do servidor',out:'Sem conta'};
function setSync(s){
  sync=s;var el=document.getElementById('sync');if(!el)return;
  el.setAttribute('data-s',s);el.querySelector('b').textContent=SYNC_TXT[s]||'';
}
function scheduleSave(){
  lsSave();scheduleNotifs();
  if(!sb||!userId)return;
  dirty=true;setSync('saving');
  clearTimeout(saveTimer);saveTimer=setTimeout(flush,700);
}
async function flush(){
  if(!sb||!userId||saving||!dirty)return;
  saving=true;dirty=false;failed=false;
  var body=clone(S);
  try{
    var r=await sb.from('app_state').upsert({user_id:userId,state:body,updated_at:new Date().toISOString()});
    if(r.error)throw r.error;
    setSync(dirty?'saving':'ok');
  }catch(e){failed=true;dirty=true;setSync('err');}
  saving=false;
  if(dirty){clearTimeout(saveTimer);saveTimer=setTimeout(flush,failed?8000:700);}
}
/* Regra de conflito: vence a versão com updatedAt maior (última edição). */
function applyRemote(r){
  var ru=r&&typeof r.updatedAt==='number'?r.updatedAt:0;
  if(ru>S.updatedAt){
    S=normalize(clone(r));
    var ch=rollover();if(ch)touch();
    lsSave();render();scheduleNotifs();
    if(ch)scheduleSave();
  }else if(ru<S.updatedAt&&!dirty&&!saving){dirty=true;flush();}
}
async function pullNow(){
  if(!sb||!userId||dirty||saving)return;
  try{
    var r=await sb.from('app_state').select('state').eq('user_id',userId).maybeSingle();
    if(r.error)throw r.error;
    if(r.data&&r.data.state)applyRemote(r.data.state);
    if(!dirty&&!saving)setSync('ok');
  }catch(e){setSync('err');}
}
async function startSession(sess){
  session=sess;userId=sess.user.id;
  S=lsLoadKey(userId)||lsLoadKey(null)||defState();
  if(rollover())touch();
  setSync('load');render();
  clearTimeout(loadTimer);loadTimer=setTimeout(function(){if(sync==='load')setSync('slow');},10000);
  try{
    var r=await sb.from('app_state').select('state').eq('user_id',userId).maybeSingle();
    if(r.error)throw r.error;
    clearTimeout(loadTimer);
    if(r.data&&r.data.state&&Object.keys(r.data.state).length)applyRemote(r.data.state);
    else{dirty=true;flush();}
    if(!dirty&&!saving)setSync('ok');
    if(chan)sb.removeChannel(chan);
    chan=sb.channel('app_state_'+userId).on('postgres_changes',
      {event:'*',schema:'public',table:'app_state',filter:'user_id=eq.'+userId},
      function(p){if(p.new&&p.new.state)applyRemote(p.new.state);}).subscribe();
  }catch(e){clearTimeout(loadTimer);setSync('err');}
  scheduleNotifs();maybeAlert();
}
function endSession(){
  if(chan&&sb){sb.removeChannel(chan);chan=null;}
  session=null;userId=null;S=defState();dirty=false;
  setSync('out');render();scheduleNotifs();
}
function trErr(m){
  m=String(m||'');
  if(/invalid login/i.test(m))return 'E-mail ou senha incorretos.';
  if(/already registered/i.test(m))return 'Este e-mail já tem conta. Toque em Entrar.';
  if(/at least 6/i.test(m))return 'A senha precisa ter pelo menos 6 caracteres.';
  if(/email not confirmed/i.test(m))return 'Confirme seu e-mail pelo link que enviamos e entre de novo.';
  if(/rate limit/i.test(m))return 'Muitas tentativas. Espere alguns minutos.';
  return m||'Não foi possível entrar. Tente de novo.';
}
async function doAuth(mode,email,pass){
  authEmail=email;authMsg='';
  var btns=document.querySelectorAll('.authform button');btns.forEach(function(b){b.disabled=true;});
  try{
    var r=mode==='up'?await sb.auth.signUp({email:email,password:pass}):await sb.auth.signInWithPassword({email:email,password:pass});
    if(r.error)authMsg=trErr(r.error.message);
    else if(mode==='up'&&!(r.data&&r.data.session))authMsg='Conta criada. Confirme pelo link enviado ao seu e-mail e depois toque em Entrar.';
  }catch(e){authMsg='Sem conexão. Tente de novo.';}
  if(!session)render();
}
function viewAuth(){
  return '<section class="card auth"><h2>Entrar</h2><p class="hint">Use o mesmo e-mail no celular e no PC para ver os mesmos dados.</p>'+
    '<form class="authform" data-form="auth">'+
    '<label class="lab" for="au-mail">E-mail</label><input id="au-mail" name="email" type="email" autocomplete="email" value="'+esc(authEmail)+'" required>'+
    '<label class="lab" for="au-pass">Senha</label><input id="au-pass" name="password" type="password" minlength="6" autocomplete="current-password" required>'+
    '<div class="tools"><button class="btn" type="submit" value="in">Entrar</button><button class="btn ghost" type="submit" value="up">Criar conta</button></div></form>'+
    (authMsg?'<p class="note">'+esc(authMsg)+'</p>':'')+'</section>';
}
function viewSettings(){
  var h='<section class="card"><h3>Ajustes</h3>';
  if(session)h+='<p class="hint">Conta: '+esc(session.user.email||'')+'</p>';
  var on=pushOn(),canWeb=!NATIVE&&typeof Notification!=='undefined';
  var rules='Rotina: 18:00, 18:30, 21:00, 22:30 e 23:00. Entregas, etapas e compromissos: '+LEAD+' dias antes (08:00 e 18:00), no dia (08:00, 12:00, 18:00 e 21:00, ou 1 hora antes e na hora quando tem horário) e, se atrasarem, por 3 dias seguidos.';
  if(NATIVE||canWeb){
    var active=on&&(NATIVE||Notification.permission==='granted');
    h+='<div class="drow"><div class="dmain"><span>Avisos com som'+(NATIVE?' e vibração':' neste navegador')+'</span><span class="due">'+rules+'</span></div>'+
      '<button class="st'+(active?' s2':'')+'" data-act="notif" aria-pressed="'+active+'">'+(active?'Ligados':'Desligados')+'</button></div>';
    if(DESKTOP)h+='<p class="hint">No Windows o app continua na bandeja do sistema (perto do relógio) quando você fecha a janela, e os avisos seguem saindo. Clique com o botão direito no ícone da bandeja para abrir com o Windows ou sair de vez.</p>';
    else if(!NATIVE)h+='<p class="hint">Na web os avisos saem enquanto o app ou a aba estiver aberto, mesmo minimizado. Para ser avisado com o app fechado, use o app do celular.</p>';
    if(!NATIVE&&Notification.permission==='denied')h+='<p class="note">O navegador bloqueou as notificações deste site. Libere no cadeado ao lado do endereço e ligue de novo.</p>';
    if(active)h+='<div class="tools"><button class="btn ghost" data-act="ntest">Testar aviso</button></div>';
  }else h+='<p class="hint">Este navegador não oferece notificações.</p>';
  if(notifMsg)h+='<p class="note">'+esc(notifMsg)+'</p>';
  if(!NATIVE){
    h+='<div class="tools"><button class="btn ghost" data-act="export">Exportar backup</button>'+
      '<label class="btn ghost filebtn" for="imp-file">Importar backup</label><input id="imp-file" type="file" accept="application/json" data-field="import" hidden></div>';
  }
  if(importMsg)h+='<p class="note">'+esc(importMsg)+'</p>';
  if(NATIVE&&otaEnabled()){
    h+='<div class="drow"><div class="dmain"><span>Atualizações do app</span><span class="due">Versão '+BUILD+'. O app procura sozinho e baixa só o que mudou; a troca acontece quando você sair do app e voltar.</span></div>'+
      '<button class="st" data-act="otacheck">Procurar</button></div>';
    if(otaMsg)h+='<p class="note">'+esc(otaMsg)+'</p>';
  }
  if(session)h+='<div class="tools"><button class="btn ghost" data-act="logout">Sair da conta</button></div>';
  return h+'</section>';
}

/* ---------- atualização do código (APK) ---------- */
var otaMsg='',otaLast=0;
function otaBanner(v){
  var el=document.getElementById('ota');if(!el)return;
  if(!v){el.hidden=true;return;}
  el.innerHTML='<span>Atualização '+v+' baixada.</span><button class="btn" data-act="otaapply">Aplicar agora</button>';
  el.hidden=false;
}
async function otaRun(manual){
  if(!NATIVE||!otaEnabled())return;
  otaLast=Date.now();
  var r=await checkUpdate();
  if(r.state==='ready'){otaMsg='Atualização '+r.version+' baixada. Ela entra quando você sair do app e voltar, ou toque em Aplicar agora.';otaBanner(r.version);}
  else if(r.state==='reinstall')otaMsg='Há uma versão nova que precisa instalar o APK de novo (baixe em Releases).';
  else if(r.state==='current')otaMsg='Você já está na versão mais recente ('+r.version+').';
  else otaMsg=manual?(r.step==='download'?'Achei uma atualização, mas o download falhou: ':'Não consegui consultar o servidor de atualizações: ')+r.why:'';
  if(manual&&tab==='habitos')render();
}

/* ---------- avisos: itens, celular, web e popup ---------- */
var NOTIF_MAX=150;
var notifTimer=0,notifMsg='',alertOpen=false,hiddenAt=0;
function pushOn(){try{return localStorage.getItem('rotina-push')==='1';}catch(e){return false;}}
function setPush(v){try{localStorage.setItem('rotina-push',v?'1':'0');}catch(e){}}

/* Tudo que pode gerar aviso, num formato único. */
function collectItems(){
  var out=[];
  S.deadlines.forEach(function(d){
    if(!d.done)out.push({kind:'dl',id:d.id,title:d.title,sub:d.subject||'Faculdade',date:d.due,time:'',overdue:true});
  });
  S.projects.forEach(function(p){
    if(p.done)return;
    p.steps.forEach(function(st){
      if(!st.done&&st.due)out.push({kind:'step',id:st.id,pid:p.id,title:st.title,sub:p.name,date:st.due,time:'',overdue:true});
    });
  });
  S.events.forEach(function(e){
    if(!e.done)out.push({kind:'ev',id:e.id,title:e.title,sub:AREAS[e.area]||'Outros',date:e.date,time:e.time||'',overdue:false});
  });
  S.habits.forEach(function(h){
    HB.reminderDays(h,todayKey(),S,7).forEach(function(k){out.push({kind:'hab',id:h.id+'|'+k,title:h.name,sub:'',date:k,time:h.remind.time,overdue:false});});
  });
  S.tasks.forEach(function(t){
    if(!t.done&&t.time)out.push({kind:'task',id:t.id,title:t.title,sub:'',date:t.date,time:t.time,overdue:false});
  });
  return out;
}

/* Celular: notificações locais agendadas, com som e vibração. */
function scheduleNotifs(){
  if(!NATIVE)return;
  clearTimeout(notifTimer);notifTimer=setTimeout(function(){applyNotifs(false);},1500);
}
async function setupChannels(){
  try{
    await LocalNotifications.createChannel({id:'prazos',name:'Prazos e compromissos',description:'Entregas, etapas e compromissos, com som e vibração',importance:5,visibility:1,vibration:true,lights:true,lightColor:'#7d9bff'});
    await LocalNotifications.createChannel({id:'rotina',name:'Rotina diária',description:'Lembretes dos blocos da noite',importance:4,visibility:1,vibration:true});
  }catch(e){}
}
async function applyNotifs(ask){
  if(!NATIVE)return false;
  try{
    var pend=await LocalNotifications.getPending();
    if(pend.notifications.length)await LocalNotifications.cancel({notifications:pend.notifications.map(function(n){return {id:n.id};})});
    if(!pushOn()||(sb&&!userId))return false;
    var perm=await LocalNotifications.checkPermissions();
    if(perm.display!=='granted'&&ask)perm=await LocalNotifications.requestPermissions();
    if(perm.display!=='granted')return false;
    await setupChannels();
    var list=ROUTINE.map(function(n){
      return {id:n.id,title:n.t,body:n.b,channelId:'rotina',schedule:{on:{hour:n.h,minute:n.m},allowWhileIdle:true}};
    });
    buildPlan(collectItems(),new Date(),NOTIF_MAX).forEach(function(p,i){
      list.push({id:3000+i,title:p.title,body:p.body,channelId:'prazos',schedule:{at:p.at,allowWhileIdle:true}});
    });
    await LocalNotifications.schedule({notifications:list});
    return true;
  }catch(e){return false;}
}

/* Web: notificação do navegador com som, enquanto o app estiver aberto. */
var AC=null;
function unlockAudio(){
  try{
    AC=AC||new (window.AudioContext||window.webkitAudioContext)();
    if(AC.state==='suspended')AC.resume();
  }catch(e){}
}
function beep(){
  try{
    if(!AC)return;
    var t=AC.currentTime;
    [880,1175,880].forEach(function(f,i){
      var o=AC.createOscillator(),g=AC.createGain(),s=t+i*0.2;
      o.type='sine';o.frequency.value=f;
      g.gain.setValueAtTime(0.0001,s);g.gain.exponentialRampToValueAtTime(0.3,s+0.02);g.gain.exponentialRampToValueAtTime(0.0001,s+0.17);
      o.connect(g);g.connect(AC.destination);o.start(s);o.stop(s+0.19);
    });
  }catch(e){}
}
function showWeb(p,key){
  var opts={body:p.body,tag:key,icon:'icon-192.png'};
  try{var n=new Notification(p.title,opts);n.onclick=function(){try{if(window.rotinaDesktop)window.rotinaDesktop.show();}catch(e){}window.focus();};}
  catch(e){try{navigator.serviceWorker.ready.then(function(r){r.showNotification(p.title,opts);});}catch(e2){}}
  beep();
}
function firedLoad(){try{return JSON.parse(localStorage.getItem('rotina-fired')||'{}');}catch(e){return {};}}
function webTick(){
  if(NATIVE||typeof Notification==='undefined'||!pushOn()||Notification.permission!=='granted')return;
  if(sb&&!userId)return;
  var now=new Date(),fired=firedLoad(),ch=false,limit=now.getTime()-3*86400000;
  dueNow(collectItems(),now,3*60000).forEach(function(p){
    var key=p.at.getTime()+'|'+p.title+'|'+p.body;
    if(fired[key])return;
    fired[key]=now.getTime();ch=true;showWeb(p,key);
  });
  Object.keys(fired).forEach(function(k){if(fired[k]<limit){delete fired[k];ch=true;}});
  if(ch){try{localStorage.setItem('rotina-fired',JSON.stringify(fired));}catch(e){}}
}

/* Popup ao abrir: atrasados e prazos dos próximos dias. */
function alertHtml(items){
  function row(i){
    var c=i.n<0?'late':(i.n<=1?'soon':'');
    return '<div class="drow"><button class="chk sm" data-act="mdone" data-kind="'+i.kind+'" data-id="'+i.id+'"'+(i.pid?' data-p="'+i.pid+'"':'')+' aria-label="Marcar como feito">'+CHECK+'</button>'+
      '<div class="dmain"><span>'+esc(i.title)+'</span><span><span class="chip">'+esc(i.sub||'')+'</span> <span class="chip">'+esc(KIND_LABEL[i.kind])+'</span> <span class="due '+c+'">'+fmtDue(i.n,i.time,i.date)+'</span></span></div></div>';
  }
  function grp(t,a){return a.length?'<h3>'+t+'</h3><div class="list">'+a.map(row).join('')+'</div>':'';}
  var late=items.filter(function(i){return i.n<0;}),today=items.filter(function(i){return i.n===0;}),soon=items.filter(function(i){return i.n>0;});
  return '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="md-t"><h2 id="md-t">Atenção aos prazos</h2>'+
    '<p class="hint">'+items.length+(items.length===1?' item pede':' itens pedem')+' sua atenção. Marque o que já fez.</p>'+
    grp('Atrasados',late)+grp('Hoje',today)+grp('Próximos '+LEAD+' dias',soon)+
    '<div class="tools"><button class="btn" id="md-close" data-act="mclose">Fechar</button></div></div>';
}
function renderModal(){
  var el=document.getElementById('modal');if(!el)return;
  var items=alertOpen?alertItems(collectItems(),todayKey()):[];
  if(!items.length){alertOpen=false;el.hidden=true;el.innerHTML='';return;}
  el.innerHTML=alertHtml(items);el.hidden=false;
  var c=document.getElementById('md-close');if(c)c.focus();
}
function maybeAlert(){
  if(alertOpen||(sb&&!userId))return;
  if(!alertItems(collectItems(),todayKey()).length)return;
  alertOpen=true;renderModal();
}


/* ---------- peças de interface ---------- */
function delBtn(kind,id,parent){
  var key=kind+'|'+id,ask=confirmKey===key;
  return '<button class="x'+(ask?' ask':'')+'" data-act="del" data-kind="'+kind+'" data-id="'+id+'"'+(parent?' data-p="'+parent+'"':'')+' aria-label="Excluir">'+(ask?'Excluir?':XICON)+'</button>';
}
function areaOpts(sel){return AREA_KEYS.map(function(a){return '<option value="'+a+'"'+(a===sel?' selected':'')+'>'+AREAS[a]+'</option>';}).join('');}
function taskLi(t){
  return '<li class="task'+(t.done?' is-done':'')+'"><button class="chk sm'+(t.done?' on':'')+'" data-act="task" data-id="'+t.id+'" aria-pressed="'+!!t.done+'" aria-label="Marcar tarefa">'+CHECK+'</button>'+
    '<span class="tt">'+esc(t.title)+'<small class="tarea a-'+t.area+'">'+(t.time?t.time+' · ':'')+(AREAS[t.area]||'Outros')+(t.from?' · reagendada de '+shortD(t.from):'')+'</small></span>'+delBtn('task',t.id)+'</li>';
}
function rating(slot,b){
  function row(kind,label){
    var h='';for(var n=1;n<=5;n++)h+='<button data-act="rate" data-slot="'+slot+'" data-kind="'+kind+'" data-val="'+n+'" class="'+(b[kind]===n?'on':'')+'" aria-label="'+label+' '+n+'">'+n+'</button>';
    return '<span>'+label+'</span><div class="dots">'+h+'</div>';
  }
  return '<div class="rate">'+row('energy','Energia')+row('focus','Foco')+'</div>';
}
function blockRow(s,dow,day,tasks){
  var c=cell(dow,s.k),b=day.blocks[s.k]||{},mine=tasks.filter(function(t){return t.slot===s.k;});
  var h='<section class="block'+(b.done?' is-done':'')+'"><div class="brow">'+
    '<button class="chk'+(b.done?' on':'')+'" data-act="blk" data-slot="'+s.k+'" aria-pressed="'+!!b.done+'" aria-label="Concluir bloco">'+CHECK+'</button>'+
    '<div class="bmain"><div class="btime">'+s.t+'</div><div class="btitle">'+esc(c.l)+'</div></div>'+
    '<span class="tag a-'+c.a+'"><i></i>'+AREAS[c.a]+'</span></div>';
  if(b.done)h+=rating(s.k,b);
  if(mine.length)h+='<ul class="tl">'+mine.map(taskLi).join('')+'</ul>';
  if(s.k==='f')h+='<div><label class="lab" for="next">Primeira ação de amanhã</label><textarea id="next" data-field="next" rows="2" placeholder="Escreva a próxima ação exata, para começar sem pensar.">'+esc(day.next||'')+'</textarea></div>';
  return h+'</section>';
}
function pomoSig(){return S.pomo.total+'/'+S.pomo.focus;}
function pomoSync(){
  if(timer.running)return;
  var sig=pomoSig();
  if(timer.sig!==sig||!timer.plan.length){
    timer.plan=HB.pomoPlan(S.pomo.total,S.pomo.focus);timer.sig=sig;timer.idx=0;timer.left=timer.plan[0].m*60;timer.done='';
  }
}
function pomoLabel(ph,i){
  if(ph.t==='f'){var n=timer.plan.slice(0,i+1).filter(function(x){return x.t==='f';}).length,tot=timer.plan.filter(function(x){return x.t==='f';}).length;return 'Foco '+n+' de '+tot;}
  return ph.t==='l'?'Pausa longa':'Pausa curta';
}
function timerCard(){
  pomoSync();
  var ph=timer.plan[timer.idx],m=Math.floor(timer.left/60),s=timer.left%60;
  var focos=timer.plan.filter(function(x){return x.t==='f';}),pausas=timer.plan.filter(function(x){return x.t!=='f';});
  var chips=timer.plan.map(function(x,i){
    return '<span class="pchip '+x.t+(i===timer.idx?' now':'')+(i<timer.idx?' past':'')+'" title="'+pomoLabel(x,i)+'">'+(x.t==='f'?'':'☕ ')+x.m+'</span>';
  }).join('');
  var msg='';
  if(timer.done==='f')msg='Foco concluído e minutos registrados. Próximo: '+pomoLabel(ph,timer.idx).toLowerCase()+' de '+ph.m+' min.';
  else if(timer.done==='b')msg='Pausa terminada. Próximo: '+pomoLabel(ph,timer.idx).toLowerCase()+'.';
  else if(timer.done==='all')msg='Pomodoro completo. Os minutos de foco já foram somados ao dia.';
  return '<section class="card timer"><div class="th"><h3>Pomodoro</h3><div class="seg" role="group" aria-label="Duração do foco">'+
    [25,50].map(function(v){return '<button class="segbtn'+(S.pomo.focus===v?' on':'')+'" data-act="pfocus" data-val="'+v+'"'+(timer.running?' disabled':'')+'>'+v+' min</button>';}).join('')+'</div></div>'+
    '<div class="pomoset"><label class="fld"><span class="lab">Tempo de estudo (min)</span><input id="pm-total" type="number" min="10" max="720" step="5" inputmode="numeric" data-field="pmtotal" value="'+S.pomo.total+'"'+(timer.running?' disabled':'')+'></label>'+
    '<div class="seg" role="group" aria-label="Atalhos de tempo">'+[60,90,120,180].map(function(v){return '<button class="segbtn'+(S.pomo.total===v?' on':'')+'" data-act="ptotal" data-val="'+v+'"'+(timer.running?' disabled':'')+'>'+fmtMin(v)+'</button>';}).join('')+'</div></div>'+
    '<p class="hint">'+focos.length+(focos.length===1?' foco':' focos')+' de até '+S.pomo.focus+' min'+(pausas.length?' e '+pausas.length+(pausas.length===1?' pausa':' pausas'):'')+', somando '+fmtMin(S.pomo.total)+'. As pausas são calculadas sozinhas: '+HB.POMO[S.pomo.focus].short+' min entre focos e '+HB.POMO[S.pomo.focus].long+' min a cada '+HB.POMO[S.pomo.focus].every+' focos.</p>'+
    '<div class="pplan" aria-label="Sequência do Pomodoro">'+chips+'</div>'+
    '<div class="phase '+ph.t+'">'+pomoLabel(ph,timer.idx)+' · '+ph.m+' min</div>'+
    '<div class="clock" id="tm-clock" role="timer">'+pad(m)+':'+pad(s)+'</div>'+
    '<div class="trow2"><select id="tm-subj" data-field="tmsubj" aria-label="Matéria do foco"><option value="">Sem matéria</option>'+
    S.subjects.map(function(x){return '<option value="'+x.id+'"'+(timer.subj===x.id?' selected':'')+'>'+esc(x.name)+'</option>';}).join('')+'</select>'+
    '<button class="btn" data-act="tgo">'+(timer.running?'Pausar':(timer.left<ph.m*60?'Continuar':'Iniciar'))+'</button>'+
    '<button class="btn ghost" data-act="tskip"'+(timer.plan.length<2?' disabled':'')+'>Pular</button>'+
    '<button class="btn ghost" data-act="treset">Zerar</button></div>'+
    (msg?'<p class="note ok">'+msg+'</p>':'')+'</section>';
}
function dueInfo(due){
  var n=diffDays(due,todayKey());
  if(n<0)return {t:'atrasado '+(-n)+(n===-1?' dia':' dias'),c:'late'};
  if(n===0)return {t:'hoje',c:'soon'};
  if(n===1)return {t:'amanhã',c:'soon'};
  return {t:'em '+n+' dias · '+shortD(due),c:n<=3?'soon':''};
}
function dlRow(d){
  var i=dueInfo(d.due);
  return '<div class="drow"><button class="chk sm'+(d.done?' on':'')+'" data-act="dl" data-id="'+d.id+'" aria-pressed="'+!!d.done+'" aria-label="Concluir entrega">'+CHECK+'</button>'+
    '<div class="dmain"><span>'+esc(d.title)+'</span><span><span class="chip">'+esc(d.subject||'Geral')+'</span> <span class="due '+(d.done?'':i.c)+'">'+(d.done?'entrega em '+shortD(d.due):i.t)+'</span></span></div>'+delBtn('dl',d.id)+'</div>';
}

/* ---------- telas ---------- */
function viewHoje(){
  var k=todayKey(),dow=parse(k).getDay(),day=getDay(k),yest=getDay(addDays(k,-1));
  var planned=SLOTS.filter(function(s){return s.k==='f'||cell(dow,s.k).a!=='livre';});
  var doneN=planned.filter(function(s){return (day.blocks[s.k]||{}).done;}).length;
  var tasks=S.tasks.filter(function(t){return t.date===k;}).sort(function(a,b){return (a.time||'99:99').localeCompare(b.time||'99:99');});
  var loose=tasks.filter(function(t){return !t.slot;});
  var soon=S.deadlines.filter(function(d){return !d.done&&diffDays(d.due,k)<=7;}).sort(function(a,b){return a.due.localeCompare(b.due);});
  var goal=S.screenGoal,scr=day.screen;
  var h='<div class="stats">'+
    '<div class="stat"><span>Blocos</span><b>'+doneN+'<small>/'+planned.length+'</small></b></div>'+
    '<div class="stat"><span>Foco</span><b>'+fmtMin(day.focusMin||0)+'</b></div>'+
    '<div class="stat"><span>Telas</span><b class="'+(scr==null?'':(scr<=goal?'ok':'over'))+'">'+(scr==null?'—':fmtMin(scr))+'</b></div></div>';
  if(yest.next)h+='<p class="note">Ontem você deixou como primeira ação: <b>'+esc(yest.next)+'</b></p>';
  h+='<section class="card"><label class="lab" for="main">Tarefa principal de hoje</label><input id="main" data-field="main" value="'+esc(day.main||'')+'" placeholder="O que precisa estar pronto até 23h?" autocomplete="off"></section>';
  var evToday=S.events.filter(function(e){return e.date===k&&!e.done;}).sort(evSort);
  if(evToday.length)h+='<section class="card"><h3>Compromissos de hoje</h3><div class="list">'+evToday.map(evRow).join('')+'</div></section>';
  h+='<div class="blocks">'+SLOTS.map(function(s){return blockRow(s,dow,day,tasks);}).join('')+'</div>';
  if(loose.length)h+='<section class="card"><h3>Sem bloco</h3><p class="hint">Tarefas avulsas e reagendadas. Escolha o próximo bloco livre para cada uma.</p><ul class="tl">'+loose.map(taskLi).join('')+'</ul></section>';
  h+=timerCard();
  h+='<section class="card"><h3>Nova tarefa</h3><form class="addrow wide" data-form="task">'+
    '<input id="nt-title" name="title" placeholder="Ex.: revisar lista de Física" required autocomplete="off" class="full">'+
    '<label class="fld"><span class="lab">Tipo</span><select id="nt-area" name="area">'+areaOpts('estudo')+'</select></label>'+
    '<label class="fld"><span class="lab">Horário (opcional)</span><input id="nt-time" name="time" type="time"></label>'+
    '<label class="fld"><span class="lab">Bloco</span><select id="nt-slot" name="slot"><option value="">Sem bloco</option><option value="a">18:00</option><option value="b">18:30</option><option value="c">21:00</option></select></label>'+
    '<button class="btn" type="submit">Adicionar</button></form>'+
    '<p class="hint">Com horário, o celular avisa 10 minutos antes e na hora.</p></section>';
  if(soon.length)h+='<section class="card"><h3>Entregas próximas</h3><div class="list">'+soon.map(dlRow).join('')+'</div></section>';
  return h;
}

function weekStats(){
  var k=todayKey(),keys=[0,1,2,3,4,5,6].map(function(i){return addDays(k,i-6);});
  var slot={};SLOTS.forEach(function(s){slot[s.k]={e:[],f:[]};});
  var per=keys.map(function(key){
    var dow=parse(key).getDay(),day=S.days[key];
    var pl=SLOTS.filter(function(s){return s.k==='f'||cell(dow,s.k).a!=='livre';});
    var dn=0;
    if(day&&day.blocks){
      pl.forEach(function(s){var b=day.blocks[s.k];if(b&&b.done)dn++;});
      SLOTS.forEach(function(s){var b=day.blocks[s.k];if(b&&b.done){if(b.energy)slot[s.k].e.push(b.energy);if(b.focus)slot[s.k].f.push(b.focus);}});
    }
    return {key:key,dow:dow,pl:pl.length,dn:dn,screen:day?day.screen:null,focus:day?(day.focusMin||0):0};
  });
  return {per:per,slot:slot};
}
function evSort(a,b){return a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||'');}
function evRow(e){
  var n=diffDays(e.date,todayKey()),past=n<0,di=dueInfo(e.date);
  var when=past?'em '+shortD(e.date):di.t,c=(e.done||past)?'':di.c;
  return '<div class="drow"><button class="chk sm'+(e.done?' on':'')+'" data-act="ev" data-id="'+e.id+'" aria-pressed="'+!!e.done+'" aria-label="Concluir compromisso">'+CHECK+'</button>'+
    '<div class="dmain"><span>'+esc(e.title)+'</span><span><span class="chip">'+esc(AREAS[e.area]||'Outros')+'</span> <span class="due '+c+'">'+when+(e.time?' às '+e.time:'')+'</span></span>'+
    (e.note?'<span class="due">'+esc(e.note)+'</span>':'')+'</div>'+delBtn('ev',e.id)+'</div>';
}
function eventsSection(){
  var k=todayKey();
  var open=S.events.filter(function(e){return !e.done;}).sort(evSort);
  var past=open.filter(function(e){return e.date<k;});
  var today=open.filter(function(e){return e.date===k;});
  var week=open.filter(function(e){var n=diffDays(e.date,k);return n>0&&n<=7;});
  var later=open.filter(function(e){return diffDays(e.date,k)>7;});
  var done=S.events.filter(function(e){return e.done;}).sort(function(a,b){return evSort(b,a);}).slice(0,5);
  function grp(t,a){return a.length?'<section class="card"><h3>'+t+'</h3><div class="list">'+a.map(evRow).join('')+'</div></section>':'';}
  var h='<h2>Compromissos e atividades</h2><p class="hint">Registre o que foge da rotina. Os avisos seguem o padrão das entregas: '+LEAD+' dias antes, no dia e na hora marcada.</p>'+
    '<section class="card"><h3>Novo compromisso</h3><form class="addrow" data-form="ev">'+
    '<input id="ev-title" name="title" class="full" placeholder="Ex.: consulta, reunião, visita" required autocomplete="off">'+
    '<label class="fld"><span class="lab">Data</span><input id="ev-date" name="date" type="date" value="'+k+'" required></label>'+
    '<label class="fld"><span class="lab">Horário (opcional)</span><input id="ev-time" name="time" type="time"></label>'+
    '<label class="fld"><span class="lab">Tipo</span><select id="ev-area" name="area">'+areaOpts('outros')+'</select></label>'+
    '<label class="fld"><span class="lab">Observação</span><input id="ev-note" name="note" placeholder="Local, quem, detalhe" autocomplete="off"></label>'+
    '<button class="btn" type="submit">Adicionar compromisso</button></form></section>';
  if(!open.length)h+='<p class="empty">Nenhum compromisso pendente.</p>';
  h+=grp('Passados sem marcar',past)+grp('Hoje',today)+grp('Próximos 7 dias',week)+grp('Mais adiante',later);
  if(done.length)h+='<section class="card"><h3>Concluídos recentemente</h3><div class="list">'+done.map(evRow).join('')+'</div></section>';
  return h;
}
function viewSemana(){
  var k=todayKey(),td=parse(k).getDay(),st=weekStats();
  var totPl=0,totDn=0,foc=0,scrs=[];
  st.per.forEach(function(p){totPl+=p.pl;totDn+=p.dn;foc+=p.focus;if(p.screen!=null)scrs.push(p.screen);});
  var pct=totPl?Math.round(totDn/totPl*100):0;
  var best=null;
  SLOTS.forEach(function(s){var f=st.slot[s.k].f;if(f.length&&(!best||avg(f)>best.v))best={k:s.k,v:avg(f)};});
  var insight=best?'Seu foco costuma ser maior no bloco das '+slotT(best.k).replace('–',' às ')+' (média '+fmt1(best.v)+'). Coloque aí a tarefa mais difícil.':'Registre energia e foco ao concluir blocos para descobrir seus melhores horários.';
  var bars=st.per.map(function(p){
    var h=p.pl?Math.round(p.dn/p.pl*100):0;
    return '<div class="bar" title="'+DOW_FULL[p.dow]+': '+p.dn+' de '+p.pl+'"><div class="t"><i style="height:'+h+'%"></i></div><small>'+DOW[p.dow]+'</small></div>';
  }).join('');
  var h='<section class="card"><div class="review-top"><h3>Revisão dos últimos 7 dias</h3><span class="big">'+pct+'%</span></div>'+
    '<div class="bars" role="img" aria-label="Blocos concluídos por dia">'+bars+'</div>'+
    '<p class="hint">'+totDn+' de '+totPl+' blocos concluídos · foco total '+fmtMin(foc)+(scrs.length?' · telas, média de '+fmtMin(avg(scrs))+' por dia':'')+'</p>'+
    '<p class="note">'+insight+'</p></section>';
  h+=eventsSection();
  h+='<h2>Grade semanal</h2><p class="hint">Toque no nome para editar. Toque na bolinha para mudar o tipo do bloco.</p><div class="grid2">';
  WEEK_ORDER.forEach(function(d){
    h+='<section class="card daycard'+(d===td?' today':'')+'"><h3>'+DOW_FULL[d]+(d===td?' <span class="pill">hoje</span>':'')+'</h3>';
    ['a','b','c'].forEach(function(s){
      var c=S.template[d][s];
      h+='<div class="trow"><span class="ttime">'+slotT(s)+'</span><button class="dotbtn a-'+c.a+'" data-act="cyc" data-d="'+d+'" data-s="'+s+'" aria-label="Tipo: '+AREAS[c.a]+'. Toque para mudar"><i></i></button>'+
        '<input id="tpl-'+d+'-'+s+'" data-field="tpl" data-d="'+d+'" data-s="'+s+'" value="'+esc(c.l)+'" aria-label="'+DOW_FULL[d]+' '+slotT(s)+'" autocomplete="off"></div>';
    });
    h+='<div class="trow fixed"><span class="ttime">22:30–23:00</span><span>Fechamento do dia</span></div></section>';
  });
  return h+'</div>';
}

/* Estante: cada pasta é um curso, com matérias e, dentro delas, disciplinas marcáveis. */
var FOLDER='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>';
var folded={};
function courseProg(c){
  var t=0,d=0;
  c.mats.forEach(function(m){m.discs.forEach(function(x){t++;if(x.done)d++;});});
  return {t:t,d:d,pct:t?Math.round(d/t*100):0};
}
function discLi(x){
  return '<li class="task'+(x.done?' is-done':'')+'"><button class="chk sm'+(x.done?' on':'')+'" data-act="disc" data-id="'+x.id+'" aria-pressed="'+!!x.done+'" aria-label="Marcar disciplina">'+CHECK+'</button>'+
    '<span class="tt">'+esc(x.name)+'</span>'+delBtn('disc',x.id)+'</li>';
}
function matBlock(m){
  var d=m.discs.filter(function(x){return x.done;}).length;
  return '<div class="mat"><div class="mat-h"><h4>'+esc(m.name)+'</h4><span class="chip">'+d+'/'+m.discs.length+'</span>'+delBtn('mat',m.id)+'</div>'+
    (m.discs.length?'<ul class="tl">'+m.discs.map(discLi).join('')+'</ul>':'<p class="empty">Nenhuma disciplina ainda.</p>')+
    '<form class="goalrow" data-form="disc" data-id="'+m.id+'"><input name="name" placeholder="Nova disciplina (ex.: HTML e CSS)" autocomplete="off" required aria-label="Nova disciplina de '+esc(m.name)+'"><button class="btn" type="submit">Incluir</button></form></div>';
}
function folderHtml(c){
  var p=courseProg(c),open=!folded[c.id];
  var h='<section class="folder'+(open?' open':'')+'"><div class="ftab"><button class="foldbtn" data-act="fold" data-id="'+c.id+'" aria-expanded="'+open+'">'+FOLDER+'<b>'+esc(c.name)+'</b></button>'+
    '<span class="chip">'+p.d+'/'+p.t+' · '+p.pct+'%</span>'+delBtn('course',c.id)+'</div>';
  if(open){
    h+='<div class="fbody"><div class="progress" role="img" aria-label="'+p.pct+'% das disciplinas concluídas"><i style="width:'+p.pct+'%"></i></div>';
    h+=c.mats.map(matBlock).join('');
    if(!c.mats.length)h+='<p class="empty">Crie a primeira matéria deste curso.</p>';
    h+='<form class="goalrow" data-form="mat" data-id="'+c.id+'"><input name="name" placeholder="Nova matéria (ex.: Desenvolvimento Frontend)" autocomplete="off" required aria-label="Nova matéria de '+esc(c.name)+'"><button class="btn ghost" type="submit">Criar matéria</button></form></div>';
  }
  return h+'</section>';
}
function shelfHtml(){
  var h='<h3>Minha grade</h3>';
  if(!S.courses.length)h+='<p class="empty">Crie uma pasta para o seu curso e organize as matérias e disciplinas dentro dela.</p>';
  else h+='<div class="shelf">'+S.courses.map(folderHtml).join('')+'</div>';
  h+='<section class="card"><h3>Novo curso</h3><form class="goalrow" data-form="course"><input name="name" placeholder="Nome do curso (ex.: Análise e Desenvolvimento de Sistemas)" autocomplete="off" required aria-label="Nome do curso"><button class="btn" type="submit">Criar pasta</button></form></section>';
  return h;
}
function viewFac(){
  var k=todayKey();
  var open=S.deadlines.filter(function(d){return !d.done;}).sort(function(a,b){return a.due.localeCompare(b.due);});
  var done=S.deadlines.filter(function(d){return d.done;}).sort(function(a,b){return b.due.localeCompare(a.due);}).slice(0,6);
  var late=open.filter(function(d){return d.due<k;});
  var week=open.filter(function(d){var n=diffDays(d.due,k);return n>=0&&n<=7;});
  var later=open.filter(function(d){return diffDays(d.due,k)>7;});
  var subs=[],seen={};
  function addSub(n){if(n&&!seen[n]){seen[n]=1;subs.push(n);}}
  S.courses.forEach(function(c){c.mats.forEach(function(m){addSub(m.name);m.discs.forEach(function(x){addSub(x.name);});});});
  S.deadlines.forEach(function(d){addSub(d.subject);});
  function grp(title,arr){return arr.length?'<section class="card"><h3>'+title+'</h3><div class="list">'+arr.map(dlRow).join('')+'</div></section>':'';}
  var h='<h2>Faculdade</h2>'+shelfHtml()+'<h3>Entregas</h3><section class="card"><h3>Nova entrega</h3><form class="addrow" data-form="dl">'+
    '<input id="dl-sub" name="subject" list="dl-subs" placeholder="Matéria ou disciplina" autocomplete="off" required>'+
    '<datalist id="dl-subs">'+subs.map(function(s){return '<option value="'+esc(s)+'">';}).join('')+'</datalist>'+
    '<input id="dl-due" name="due" type="date" value="'+addDays(k,3)+'" required aria-label="Data de entrega">'+
    '<input id="dl-title" name="title" class="full" placeholder="Atividade ou projeto" autocomplete="off" required>'+
    '<button class="btn" type="submit">Adicionar entrega</button></form></section>';
  if(!open.length)h+='<p class="empty">Nenhuma entrega pendente. Cadastre as atividades e projetos para o app avisar a tempo.</p>';
  h+=grp('Atrasadas',late)+grp('Próximos 7 dias',week)+grp('Mais adiante',later);
  if(done.length)h+='<section class="card"><h3>Concluídas recentemente</h3><div class="list">'+done.map(dlRow).join('')+'</div></section>';
  return h;
}

function rodizio(name){
  var low=name.toLowerCase(),days=[];
  WEEK_ORDER.forEach(function(d){
    ['a','b','c'].forEach(function(s){
      if(S.template[d][s].l.toLowerCase().indexOf(low)>=0&&days.indexOf(DOW[d])<0)days.push(DOW[d]);
    });
  });
  return days;
}
function viewEstudos(){
  var h='<h2>Estudos</h2><p class="hint">Rodízio fixo: um assunto por dia, conforme a grade da semana.</p><div class="grid2">';
  S.subjects.forEach(function(sj){
    var tp=sj.topics||[],dom=tp.filter(function(t){return t.st===2;}).length,pct=tp.length?Math.round(dom/tp.length*100):0,rd=rodizio(sj.name);
    h+='<section class="card"><div class="subj-h"><div><h3>'+esc(sj.name)+'</h3><p class="hint">'+(rd.length?'Rodízio: '+rd.join(' · '):'Fora do rodízio')+' · '+fmtMin(sj.min||0)+' estudados</p></div>'+delBtn('subj',sj.id)+'</div>'+
      '<div class="progress" role="img" aria-label="'+pct+'% dos assuntos dominados"><i style="width:'+pct+'%"></i></div>'+
      '<div class="minrow"><button class="btn ghost" data-act="logmin" data-id="'+sj.id+'" data-val="25">+25 min</button><button class="btn ghost" data-act="logmin" data-id="'+sj.id+'" data-val="50">+50 min</button></div>';
    if(tp.length){
      h+='<ul class="tl">'+tp.map(function(t){
        return '<li class="task"><span class="tt">'+esc(t.title)+'</span><button class="st s'+t.st+'" data-act="tcyc" data-id="'+t.id+'" data-p="'+sj.id+'">'+ST_LABEL[t.st]+'</button>'+delBtn('topic',t.id,sj.id)+'</li>';
      }).join('')+'</ul>';
    }else h+='<p class="empty">Nenhum assunto ainda.</p>';
    h+='<form class="goalrow" data-form="topic" data-id="'+sj.id+'"><input id="tp-'+sj.id+'" name="title" placeholder="Novo assunto" autocomplete="off" required aria-label="Novo assunto de '+esc(sj.name)+'"><button class="btn" type="submit">Incluir</button></form></section>';
  });
  h+='</div><section class="card"><h3>Nova matéria</h3><form class="goalrow" data-form="subj"><input id="sj-name" name="name" placeholder="Ex.: Cálculo, Estrutura de dados" autocomplete="off" required><button class="btn" type="submit">Criar</button></form></section>';
  return h;
}

function projCard(p){
  var tot=p.steps.length,dn=p.steps.filter(function(s){return s.done;}).length,pct=tot?Math.round(dn/tot*100):0;
  var h='<section class="card"><div class="subj-h"><div><h3>'+esc(p.name)+'</h3><p class="hint">'+branchName(p.kind)+' · '+dn+' de '+tot+' etapas</p></div>'+delBtn('proj',p.id)+'</div>'+
    '<div class="progress" role="img" aria-label="'+pct+'% concluído"><i style="width:'+pct+'%"></i></div>'+
    '<div><label class="lab" for="pg-'+p.id+'">Pronto quando</label><input id="pg-'+p.id+'" data-field="pgoal" data-id="'+p.id+'" value="'+esc(p.goal||'')+'" placeholder="Defina a versão mínima que conta como pronta" autocomplete="off"></div>';
  if(tot)h+='<ul class="tl">'+p.steps.map(function(s){
    return '<li class="task'+(s.done?' is-done':'')+'"><button class="chk sm'+(s.done?' on':'')+'" data-act="step" data-id="'+s.id+'" data-p="'+p.id+'" aria-pressed="'+!!s.done+'" aria-label="Concluir etapa">'+CHECK+'</button><span class="tt">'+esc(s.title)+(s.due?'<small class="due '+(s.done?'':dueInfo(s.due).c)+'">'+(s.done?'prazo '+shortD(s.due):dueInfo(s.due).t)+'</small>':'')+'</span>'+delBtn('step',s.id,p.id)+'</li>';
  }).join('')+'</ul>';
  else h+='<p class="empty">Quebre em etapas de até 90 minutos.</p>';
  h+='<form class="goalrow" data-form="step" data-id="'+p.id+'"><input id="st-'+p.id+'" name="title" placeholder="Nova etapa (até 90 min)" autocomplete="off" required aria-label="Nova etapa"><input id="sd-'+p.id+'" name="due" type="date" class="dateinp" aria-label="Prazo da etapa (opcional)" title="Prazo opcional: o app avisa '+LEAD+' dias antes"><button class="btn" type="submit">Incluir</button></form>';
  h+='<div class="tools">'+(p.active?'<button class="btn ghost" data-act="ppark" data-id="'+p.id+'">Guardar</button>':'<button class="btn" data-act="pact" data-id="'+p.id+'">Ativar</button>')+
    '<button class="btn ghost" data-act="pdone" data-id="'+p.id+'">'+(p.done?'Reabrir':'Concluir')+'</button></div></section>';
  return h;
}
var branchMsg='';
function branchName(id){var b=S.branches.filter(function(x){return x.id===id;})[0];return b?b.name:'Sem ramo';}
function branchOpts(sel){return S.branches.length?S.branches.map(function(b){return '<option value="'+b.id+'"'+(b.id===sel?' selected':'')+'>'+esc(b.name)+'</option>';}).join(''):'<option value="">Sem ramo</option>';}
function branchUse(id){return S.projects.filter(function(p){return p.kind===id;}).length+S.ideas.filter(function(i){return i.kind===id;}).length;}
function branchesCard(){
  return '<section class="card"><h3>Ramos de projeto</h3><p class="hint">Crie os ramos que fizerem sentido para você (jogos, automação, música…). Ficam salvos e valem para projetos e ideias.</p>'+
    '<div class="kindrow">'+(S.branches.length?S.branches.map(function(b){return '<span class="chip br">'+esc(b.name)+' · '+branchUse(b.id)+delBtn('branch',b.id)+'</span>';}).join(''):'<span class="empty">Nenhum ramo ainda.</span>')+'</div>'+
    (branchMsg?'<p class="note">'+esc(branchMsg)+'</p>':'')+
    '<form class="goalrow" data-form="branch"><input name="name" placeholder="Novo ramo (ex.: Jogos, Automação)" autocomplete="off" required aria-label="Nome do novo ramo"><button class="btn" type="submit">Criar ramo</button></form></section>';
}
function viewProj(){
  var act=S.projects.filter(function(p){return p.active&&!p.done;})[0];
  var parked=S.projects.filter(function(p){return !p.active&&!p.done;});
  var fin=S.projects.filter(function(p){return p.done;});
  var h='<h2>Projetos</h2><p class="hint">Um projeto ativo por vez. Os outros ficam guardados até chegar a vez deles.</p>';
  h+=act?'<h3>Projeto ativo</h3>'+projCard(act):'<p class="empty">Nenhum projeto ativo. Crie um abaixo ou ative um guardado.</p>';
  if(parked.length)h+='<h3>Guardados</h3><div class="grid2">'+parked.map(projCard).join('')+'</div>';
  if(fin.length)h+='<h3>Concluídos</h3><div class="grid2">'+fin.map(projCard).join('')+'</div>';
  h+=branchesCard();
  h+='<section class="card"><h3>Novo projeto</h3><form class="addrow" data-form="proj"><input id="pj-name" name="name" class="full" placeholder="Nome do projeto" autocomplete="off" required>'+
    '<select id="pj-kind" name="kind" aria-label="Ramo do projeto">'+branchOpts('')+'</select>'+
    '<input id="pj-goal" name="goal" placeholder="Pronto quando…" autocomplete="off"><button class="btn" type="submit">Criar projeto</button></form></section>';
  h+='<section class="card"><h3>Banco de ideias</h3><p class="hint">Anote tudo aqui, sem compromisso. Reserve 15 minutos, duas vezes por semana, para revisar.</p>'+
    '<form class="addrow" data-form="idea"><input id="id-text" name="text" class="full" placeholder="Uma ideia de app, plugin ou arte" autocomplete="off" required>'+
    '<select id="id-kind" name="kind" aria-label="Ramo da ideia">'+branchOpts('')+'</select><button class="btn" type="submit">Guardar ideia</button></form>';
  if(S.ideas.length)h+='<ul class="tl">'+S.ideas.map(function(i){
    return '<li class="task"><span class="tt">'+esc(i.text)+'<small class="due">'+esc(branchName(i.kind))+'</small></span><button class="st" data-act="idea2p" data-id="'+i.id+'">Virar projeto</button>'+delBtn('idea',i.id)+'</li>';
  }).join('')+'</ul>';
  else h+='<p class="empty">Nenhuma ideia guardada ainda.</p>';
  return h+'</section>';
}

/* ---------- hábitos ---------- */
var habMode='list',habDraft=null,habEditId='',habDetailId='',habMsg='',habFold={tpl:true,fin:true};
var ICONS=[['⭐','Geral'],['💧','Água'],['😴','Sono'],['⏰','Despertador'],['📱','Telas'],['📚','Leitura'],['🏃','Exercício'],['🧘','Meditação'],['🍎','Alimentação'],['✍️','Escrita'],['🧹','Organização'],['💻','Estudo']];
var DAY_ORDER=[1,2,3,4,5,6,0];
function habFind(id){return S.habits.filter(function(h){return h.id===id;})[0];}
function fmtNum(n){return String(Math.round(n*100)/100).replace('.',',');}
function nowHM(){var d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes());}
function blankHabit(){
  return {id:'',name:'',desc:'',icon:'⭐',cat:'Outros',start:todayKey(),paused:false,link:'',tpl:'',
    freq:{mode:'days',days:[0,1,2,3,4,5,6],perWeek:3},period:'any',goal:{type:'duration',value:null,unit:'',time:''},
    remind:{on:false,time:''},end:{mode:'none',date:'',days:null},logs:{}};
}
function habFreqText(h){
  var f=HB.cfgAt(h,todayKey()).freq;
  if(f.mode==='week')return f.perWeek+(f.perWeek===1?' dia':' dias')+' por semana';
  if(f.days.length===7)return 'Todos os dias';
  return DAY_ORDER.filter(function(d){return f.days.indexOf(d)>=0;}).map(function(d){return DOW[d];}).join(', ');
}
function habGoalText(h,key){
  var g=HB.cfgAt(h,key||todayKey()).goal;
  if(g.type==='time')return g.time?'às '+g.time:'horário não definido';
  if(g.value==null)return 'meta não definida';
  if(g.type==='duration')return (h.link==='screen'?'no máximo ':'')+fmtMin(g.value);
  return fmtNum(g.value)+' '+(g.unit||'vezes');
}
function timeDiffText(planned,actual){
  var d=HB.timeDiff(planned,actual);
  return d===0?'no horário':(d>0?'+':'−')+Math.abs(d)+' min';
}
/* Resumo do dia de hoje: texto, % da barra e cor. */
function habToday(h){
  var k=todayKey(),v=HB.dayValue(h,k,S),g=HB.cfgAt(h,k).goal;
  if(v==null)return {txt:'sem registro hoje',pct:0,cls:''};
  if(g.type==='time')return {txt:'registrado '+v+(g.time?' · '+timeDiffText(g.time,v)+' do planejado':''),pct:100,cls:'ok'};
  var txt=g.type==='duration'?fmtMin(v):fmtNum(v)+' '+(g.unit||'vezes');
  if(g.value==null)return {txt:txt+' hoje',pct:100,cls:''};
  var pct=Math.min(100,Math.round(v/g.value*100));
  var cls=h.link==='screen'?(v<=g.value?'ok':'over'):(v>=g.value?'ok':'');
  return {txt:txt+' de '+(g.type==='duration'?fmtMin(g.value):fmtNum(g.value)),pct:pct,cls:cls};
}
function nextReminder(h){
  var days=HB.reminderDays(h,todayKey(),S,8),now=new Date();
  for(var i=0;i<days.length;i++){
    var p=days[i].split('-'),t=h.remind.time.split(':');
    var at=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]),Number(t[0]),Number(t[1]));
    if(at>now)return (days[i]===todayKey()?'hoje':days[i]===addDays(todayKey(),1)?'amanhã':shortD(days[i]))+' às '+h.remind.time;
  }
  return '';
}
function stCls(st){return st==='done'?'s2':(st==='pending'?'s1':'');}
function habLogForm(h,withDate){
  var g=HB.cfgAt(h,todayKey()).goal,inp,btn='Registrar';
  if(g.type==='time')inp='<input name="v" type="time" value="'+nowHM()+'" required aria-label="Horário real">';
  else if(g.type==='duration'||h.link==='screen')inp='<input name="v" type="number" min="1" max="1440" step="1" inputmode="numeric" placeholder="minutos" required aria-label="Minutos">';
  else inp='<input name="v" type="number" min="0.01" step="any" inputmode="decimal" value="1" required aria-label="Quantidade">';
  if(h.link==='screen')btn='Somar';
  return '<form class="goalrow wrapf" data-form="hlog" data-id="'+h.id+'">'+inp+
    (withDate?'<input name="date" type="date" value="'+todayKey()+'" min="'+h.start+'" max="'+todayKey()+'" class="dateinp" aria-label="Data do registro">':'')+
    '<button class="btn" type="submit">'+btn+'</button></form>';
}
function habCard(h){
  var t=todayKey(),st=HB.habitState(h,t,S),p=habToday(h),f=HB.cfgAt(h,t).freq,badges='';
  if(!HB.hasAnyLog(h,S))badges+='<span class="chip">sem registros</span> ';
  else if(HB.dayPartial(h,t,S))badges+='<span class="chip warn">'+(h.link==='screen'?'acima da meta':'registro incompleto hoje')+'</span> ';
  var wk=f.mode==='week'?' · '+HB.weekDone(h,t,S)+'/'+f.perWeek+' esta semana':'';
  var rem=h.remind&&h.remind.on&&h.remind.time&&!h.paused?nextReminder(h):'';
  return '<div class="habcard"><div class="hrow"><button class="hmain" data-act="hopen" data-id="'+h.id+'"><span class="hicon" aria-hidden="true">'+esc(h.icon)+'</span>'+
    '<span class="dmain"><b>'+esc(h.name)+'</b><span class="due">'+esc(h.cat)+' · '+habFreqText(h)+wk+' · '+HB.PERIODS[h.period]+'</span></span></button>'+
    '<span class="st '+stCls(st)+'">'+HB.STATE_LABEL[st]+'</span></div>'+
    '<div class="due">Meta: '+habGoalText(h)+' · '+p.txt+'</div>'+
    '<div class="progress '+p.cls+'"><i style="width:'+p.pct+'%"></i></div>'+
    (badges||rem?'<div class="kindrow">'+badges+(rem?'<span class="due">Próximo lembrete: '+rem+'</span>':'')+'</div>':'')+
    (st==='finished'||st==='paused'?'':habLogForm(h,false))+'</div>';
}
function habSection(){
  var t=todayKey(),live=S.habits.filter(function(h){return !HB.isFinished(h,t);}),fin=S.habits.filter(function(h){return HB.isFinished(h,t);});
  var h='<section class="card"><div class="subj-h"><h3>Meus hábitos</h3><button class="btn" data-act="hnew">Adicionar hábito</button></div>';
  if(habMsg)h+='<p class="note">'+esc(habMsg)+'</p>';
  if(!live.length)h+='<p class="empty">Nenhum hábito ativo. Crie um do zero ou comece por um modelo.</p>';
  else h+='<div class="list">'+live.map(habCard).join('')+'</div>';
  h+='<button class="btn ghost" data-act="hfold" data-id="tpl" aria-expanded="'+!habFold.tpl+'">'+(habFold.tpl?'Ver modelos de hábitos':'Ocultar modelos')+'</button>';
  if(!habFold.tpl)h+='<div class="list">'+HB.TEMPLATES.map(function(m){
    return '<div class="drow"><span class="hicon" aria-hidden="true">'+m.icon+'</span><div class="dmain"><span>'+esc(m.name)+'</span><span class="due">'+esc(m.desc)+'</span></div><button class="st" data-act="htpl" data-id="'+m.id+'">Usar modelo</button></div>';
  }).join('')+'<p class="hint">Os modelos vêm sem metas, horários ou prazos: você preenche tudo antes de salvar.</p></div>';
  if(fin.length){
    h+='<button class="btn ghost" data-act="hfold" data-id="fin" aria-expanded="'+!habFold.fin+'">'+(habFold.fin?'Ver hábitos finalizados ('+fin.length+')':'Ocultar finalizados')+'</button>';
    if(!habFold.fin)h+='<div class="list">'+fin.map(function(x){
      var r=HB.rate(x,S,t);
      return '<div class="drow"><span class="hicon" aria-hidden="true">'+esc(x.icon)+'</span><div class="dmain"><span>'+esc(x.name)+'</span><span class="due">Terminou em '+shortD(HB.lastDay(x))+' · '+HB.totalDone(x,S,t)+' realizações'+(r==null?'':' · '+r+'% de cumprimento')+'</span></div><button class="st" data-act="hopen" data-id="'+x.id+'">Histórico</button></div>';
    }).join('')+'</div>';
  }
  return h+'</section>';
}

/* ---------- formulário de cadastro e edição ---------- */
function habForm(){
  var d=habDraft,edit=!!habEditId,f=d.freq,g=d.goal,E=d.end,gv='',gdu='min';
  if(g.value!=null&&!isNaN(g.value)){if(g.type==='duration'&&g.value>=60&&g.value%60===0){gv=g.value/60;gdu='h';}else gv=g.value;}
  function opt(v,l,sel){return '<option value="'+esc(v)+'"'+(sel?' selected':'')+'>'+esc(l)+'</option>';}
  function radio(name,val,label,on){return '<label class="rad"><input type="radio" name="'+name+'" value="'+val+'" data-field="hform"'+(on?' checked':'')+'><span>'+label+'</span></label>';}
  var screen=d.link==='screen';
  var h='<button class="btn ghost" data-act="hback">‹ Voltar</button><form class="card habform" data-form="habit" novalidate>'+
    '<h2>'+(edit?'Editar hábito':'Adicionar hábito')+'</h2>'+
    '<fieldset class="hfs"><legend>Informações básicas</legend>'+
    '<label class="fld"><span class="lab">Nome do hábito</span><input name="name" value="'+esc(d.name)+'" placeholder="Ex.: Ler antes de dormir" autocomplete="off" required></label>'+
    '<label class="fld"><span class="lab">Descrição (opcional)</span><input name="desc" value="'+esc(d.desc)+'" autocomplete="off"></label>'+
    '<div class="addrow"><label class="fld"><span class="lab">Ícone</span><select name="icon">'+ICONS.map(function(i){return opt(i[0],i[0]+' '+i[1],d.icon===i[0]);}).join('')+'</select></label>'+
    '<label class="fld"><span class="lab">Categoria</span><select name="cat">'+HB.CATS.map(function(c){return opt(c,c,d.cat===c);}).join('')+'</select></label></div></fieldset>'+
    '<fieldset class="hfs"><legend>Frequência</legend><div class="radrow">'+radio('freqmode','days','Dias específicos da semana',f.mode==='days')+radio('freqmode','week','Quantidade de dias por semana',f.mode==='week')+'</div>'+
    '<div data-showif="freqmode=days"><div class="dayrow">'+DAY_ORDER.map(function(x){return '<label class="dchk"><input type="checkbox" name="day" value="'+x+'"'+(f.days.indexOf(x)>=0?' checked':'')+'><span>'+DOW[x]+'</span></label>';}).join('')+'</div>'+
    '<div class="tools"><button type="button" class="st" data-act="hpreset" data-v="all">Todos os dias</button><button type="button" class="st" data-act="hpreset" data-v="wk">Fins de semana</button><button type="button" class="st" data-act="hpreset" data-v="uteis">Dias úteis</button></div></div>'+
    '<div data-showif="freqmode=week"><label class="fld"><span class="lab">Dias por semana</span><input name="perweek" type="number" min="1" max="7" value="'+(f.perWeek||3)+'" inputmode="numeric"></label><p class="hint">Sem escolher os dias: o app só conta quantas vezes você cumpriu em cada semana (segunda a domingo).</p></div></fieldset>'+
    '<fieldset class="hfs"><legend>Período</legend><div class="radrow">'+Object.keys(HB.PERIODS).map(function(k){return radio('period',k,HB.PERIODS[k],d.period===k);}).join('')+'</div><p class="hint">Serve para organizar. Você pode registrar fora do período.</p></fieldset>'+
    '<fieldset class="hfs"><legend>Meta</legend>'+
    (screen?'<input type="hidden" name="gtype" value="duration" data-field="hform"><p class="hint">Tempo de tela é um limite diário. O total do dia é o mesmo registro do cartão "Menos telas e redes".</p>':
      '<label class="fld"><span class="lab">Tipo de meta</span><select name="gtype" data-field="hform">'+opt('duration','Duração (minutos ou horas)',g.type==='duration')+opt('count','Repetição ou quantidade',g.type==='count')+opt('time','Horário específico',g.type==='time')+'</select></label>')+
    '<div class="addrow" data-showif="gtype=duration|count"><label class="fld"><span class="lab">'+(screen?'Limite por dia':'Valor da meta')+'</span><input name="gval" type="number" min="0" step="any" inputmode="decimal" value="'+esc(gv)+'" placeholder="preencha"></label>'+
    '<label class="fld" data-showif="gtype=duration"><span class="lab">Unidade</span><select name="gdu">'+opt('min','minutos',gdu==='min')+opt('h','horas',gdu==='h')+'</select></label>'+
    '<label class="fld" data-showif="gtype=count"><span class="lab">Unidade (ex.: ml, copos, páginas)</span><input name="gcu" value="'+esc(g.unit||'')+'" autocomplete="off"></label></div>'+
    '<label class="fld" data-showif="gtype=time"><span class="lab">Horário desejado</span><input name="gtime" type="time" value="'+esc(g.time||'')+'"></label>'+
    '<p class="hint">Deixar a meta em branco não vale zero: o hábito só registra, sem comparar.</p></fieldset>'+
    '<details class="adv"'+((d.remind.on||E.mode!=='none'||habMsg)?' open':'')+'><summary>Ajustes avançados</summary>'+
    '<fieldset class="hfs"><legend>Lembrete</legend><label class="rad"><input type="checkbox" name="remind" data-field="hform"'+(d.remind.on?' checked':'')+'><span>Lembrar nos dias programados</span></label>'+
    '<label class="fld" data-showif="remind=on"><span class="lab">Horário da notificação</span><input name="rtime" type="time" value="'+esc(d.remind.time||'')+'"></label>'+
    '<p class="hint">O aviso só sai nos dias do hábito e não sai se você já cumpriu o dia. Para remover, desmarque.</p></fieldset>'+
    '<fieldset class="hfs"><legend>Finalizar em</legend><div class="radrow">'+radio('endmode','none','Sem data de término',E.mode==='none')+radio('endmode','date','Data específica',E.mode==='date')+radio('endmode','days','Depois de uma quantidade de dias',E.mode==='days')+'</div>'+
    '<label class="fld" data-showif="endmode=date"><span class="lab">Data de término</span><input name="edate" type="date" min="'+d.start+'" value="'+esc(E.date||'')+'"></label>'+
    '<label class="fld" data-showif="endmode=days"><span class="lab">Quantidade de dias (contando a partir de '+shortD(d.start)+')</span><input name="edays" type="number" min="1" inputmode="numeric" value="'+(E.days||'')+'" placeholder="preencha"></label>'+
    '<p class="hint">Ao chegar ao fim o hábito vira "Finalizado" e o histórico continua disponível.</p></fieldset></details>'+
    (habMsg?'<p class="note" role="alert">'+esc(habMsg)+'</p>':'')+
    '<div class="tools"><button class="btn" type="submit">Salvar hábito</button><button class="btn ghost" type="button" data-act="hback">Cancelar</button></div></form>';
  return h;
}
function fv(f,n){var e=f.elements[n];if(!e)return '';if(e.type==='checkbox')return e.checked?'on':'off';return e.value;}
function syncHabForm(f){
  if(!f)return;
  f.querySelectorAll('[data-showif]').forEach(function(el){
    var p=el.dataset.showif.split('='),vals=p[1].split('|');
    el.hidden=vals.indexOf(fv(f,p[0]))<0;
  });
}
function habFromForm(fd,base){
  var gt=String(fd.get('gtype')||'duration'),raw=String(fd.get('gval')||'').replace(',','.').trim(),gv=raw===''?null:Number(raw);
  var goal={type:gt,value:null,unit:'',time:''};
  if(gt==='duration')goal.value=gv==null?null:Math.round(gv*(fd.get('gdu')==='h'?60:1)*100)/100;
  else if(gt==='count'){goal.value=gv;goal.unit=String(fd.get('gcu')||'').trim();}
  else goal.time=String(fd.get('gtime')||'');
  var mode=fd.get('freqmode')==='week'?'week':'days';
  var em=String(fd.get('endmode')||'none');
  return Object.assign({},base,{
    name:String(fd.get('name')||'').trim(),desc:String(fd.get('desc')||'').trim(),icon:String(fd.get('icon')||'⭐'),cat:String(fd.get('cat')||'Outros'),
    period:String(fd.get('period')||'any'),
    freq:{mode:mode,days:fd.getAll('day').map(Number),perWeek:parseInt(fd.get('perweek'),10)||0},
    goal:goal,
    remind:{on:fd.get('remind')==='on',time:String(fd.get('rtime')||'')},
    end:{mode:em,date:em==='date'?String(fd.get('edate')||''):'',days:em==='days'?(parseInt(fd.get('edays'),10)||null):null}
  });
}

/* ---------- detalhes e histórico ---------- */
function evoBars(arr,fmtLabel){
  return '<div class="bars" role="img" aria-label="Evolução do cumprimento">'+arr.map(function(x){
    var hgt=x.pct==null?0:Math.max(3,x.pct);
    return '<div class="bar'+(x.pct!=null&&x.pct>=80?' ok':'')+'" title="'+fmtLabel(x)+': '+(x.pct==null?'sem dias esperados':x.done+' de '+x.expected+' ('+x.pct+'%)')+'"><div class="t"><i style="height:'+hgt+'%"></i></div><small>'+fmtLabel(x)+'</small></div>';
  }).join('')+'</div>';
}
function habHistRow(h,k,t){
  var v=HB.dayValue(h,k,S),done=HB.dayDone(h,k,S),part=HB.dayPartial(h,k,S),g=HB.cfgAt(h,k).goal,sched=HB.isScheduled(h,k,S);
  var stx=done?'cumprido':(part?(h.link==='screen'?'acima da meta':'incompleto'):(k<t&&sched?'sem registro':(sched?'pendente':'fora do programa')));
  var val='';
  if(v!=null){
    if(g.type==='time')val=v+(g.time?' · '+timeDiffText(g.time,v):'');
    else if(g.type==='duration')val=fmtMin(v);
    else val=fmtNum(v)+' '+(g.unit||'vezes');
  }
  var d=parse(k);
  return '<div class="drow"><div class="dmain"><span>'+shortD(k)+' · '+DOW[d.getDay()]+'</span><span class="due '+(done?'':(part?'soon':''))+'">'+stx+(val?' · '+esc(val):'')+'</span></div>'+(v!=null?delBtn('hday',h.id,k):'')+'</div>';
}
function habDetail(){
  var h=habFind(habDetailId),t=todayKey(),st=HB.habitState(h,t,S),g=HB.cfgAt(h,t).goal,f=HB.cfgAt(h,t).freq;
  var last=HB.lastDay(h),r=HB.rate(h,S,t),from=addDays(t,-29);if(from<h.start)from=h.start;
  var rows=[];for(var k=t;k>=from;k=addDays(k,-1)){if(last&&k>last)continue;rows.push(habHistRow(h,k,t));}
  var wk=HB.weeklyEvolution(h,S,t,8),mo=HB.monthlyEvolution(h,S,t,6);
  var out='<button class="btn ghost" data-act="hback">‹ Voltar</button>'+
    '<section class="card"><div class="hrow"><span class="hicon big" aria-hidden="true">'+esc(h.icon)+'</span><div class="dmain"><h2>'+esc(h.name)+'</h2><span class="due">'+esc(h.cat)+(h.desc?' · '+esc(h.desc):'')+'</span></div><span class="st '+stCls(st)+'">'+HB.STATE_LABEL[st]+'</span></div>'+
    '<div class="stats"><div class="stat"><span>Realizações</span><b>'+HB.totalDone(h,S,t)+'</b></div><div class="stat"><span>Cumprimento</span><b>'+(r==null?'—':r+'%')+'</b></div>'+
    '<div class="stat"><span>Esta semana</span><b>'+HB.weekDone(h,t,S)+(f.mode==='week'?'<small>/'+f.perWeek+'</small>':'')+'</b></div></div>'+
    '<ul class="kv"><li><span>Frequência</span><b>'+habFreqText(h)+'</b></li><li><span>Período</span><b>'+HB.PERIODS[h.period]+'</b></li>'+
    '<li><span>Meta</span><b>'+habGoalText(h)+'</b></li>'+
    '<li><span>Lembrete</span><b>'+(h.remind.on&&h.remind.time?h.remind.time:'desligado')+'</b></li>'+
    '<li><span>Início</span><b>'+shortD(h.start)+'</b></li>'+
    '<li><span>Término</span><b>'+(last?shortD(last)+(h.end.mode==='days'?' ('+h.end.days+' dias)':''):'sem data')+'</b></li></ul>'+
    (!HB.hasAnyLog(h,S)?'<p class="note">Ainda não há registros deste hábito.</p>':'')+
    '<div class="tools">'+(st==='finished'?'':'<button class="btn" data-act="hedit" data-id="'+h.id+'">Editar</button><button class="btn ghost" data-act="hpause" data-id="'+h.id+'">'+(h.paused?'Retomar':'Pausar')+'</button>')+delBtn('habit',h.id)+'</div></section>';
  if(st!=='finished')out+='<section class="card"><h3>Registrar</h3>'+habLogForm(h,true)+'<p class="hint">'+(h.link==='screen'?'Soma ao total de tempo de tela do dia.':(g.type==='time'?'Substitui o horário registrado naquele dia.':'Pode escolher outra data para corrigir um dia.'))+(h.tpl==='sleep'?' Horários entre 00:00 e 05:59 registrados hoje contam para a noite anterior.':'')+'</p></section>';
  out+='<section class="card"><h3>Evolução semanal</h3>'+evoBars(wk,function(x){return shortD(x.key);})+'<p class="hint">Últimas 8 semanas (segunda a domingo). Barra verde: 80% ou mais.</p></section>'+
    '<section class="card"><h3>Evolução mensal</h3>'+evoBars(mo,function(x){return x.key.slice(5,7)+'/'+x.key.slice(2,4);})+'</section>'+
    '<section class="card"><h3>Histórico</h3><p class="hint">Mudanças na meta ou na frequência valem daqui para frente: os dias passados mantêm a configuração que tinham.</p><div class="list">'+rows.join('')+'</div></section>';
  return out;
}

function streak(){
  var k=todayKey(),n=0;
  for(var i=0;i<400;i++){
    var key=addDays(k,-i),d=S.days[key],v=d?d.screen:null;
    if(v==null){if(i===0)continue;break;}
    if(v<=S.screenGoal)n++;else break;
  }
  return n;
}
function viewHab(){
  if(habMode==='form'&&habDraft)return habForm();
  if(habMode==='detail'&&habFind(habDetailId))return habDetail();
  var k=todayKey(),day=getDay(k),goal=S.screenGoal,keys=[],i;
  for(i=13;i>=0;i--)keys.push(addDays(k,-i));
  var vals=keys.map(function(key){var d=S.days[key];return d?d.screen:null;});
  var maxY=Math.max.apply(null,[goal*1.6].concat(vals.filter(function(v){return v!=null;})));
  var bars=keys.map(function(key,idx){
    var v=vals[idx],cls=v==null?'':(v<=goal?'ok':'over'),h=v==null?0:Math.max(3,Math.min(100,Math.round(v/maxY*100)));
    return '<div class="bar '+cls+'" title="'+shortD(key)+': '+(v==null?'sem registro':fmtMin(v))+'"><div class="t"><i style="height:'+h+'%"></i></div><small>'+key.slice(8)+'</small></div>';
  }).join('');
  var fech=keys.filter(function(key){var d=S.days[key];return d&&d.blocks&&d.blocks.f&&d.blocks.f.done;}).length;
  var sn=streak(),scr=day.screen;
  var h='<h2>Hábitos</h2>'+habSection()+'<section class="card"><h3>Menos telas e redes</h3>'+
    '<div class="stats"><div class="stat"><span>Hoje</span><b class="'+(scr==null?'':(scr<=goal?'ok':'over'))+'">'+(scr==null?'—':fmtMin(scr))+'</b></div>'+
    '<div class="stat"><span>Meta diária</span><b>'+fmtMin(goal)+'</b></div>'+
    '<div class="stat"><span>Sequência</span><b>'+sn+'<small> '+(sn===1?'dia':'dias')+'</small></b></div></div>'+
    '<form class="addrow" data-form="screen"><div><label class="lab" for="sc-min">Tempo de tela hoje (min)</label><input id="sc-min" name="min" type="number" min="0" max="1440" inputmode="numeric" value="'+(scr==null?'':scr)+'" placeholder="0"></div>'+
    '<div><label class="lab" for="sc-goal">Meta (min)</label><input id="sc-goal" name="goal" type="number" min="10" max="1440" inputmode="numeric" value="'+goal+'"></div>'+
    '<button class="btn" type="submit">Salvar</button></form>'+
    '<div class="sbars"><div class="bars" role="img" aria-label="Tempo de tela nos últimos 14 dias">'+bars+'</div><div class="gl" style="--g:'+(goal/maxY).toFixed(3)+'"><em>meta</em></div></div>'+
    '<p class="hint">Últimos 14 dias, verde dentro da meta e laranja acima. A sequência conta dias seguidos dentro da meta.</p></section>';
  h+='<section class="card"><h3>Fechamento do dia</h3><p class="big">'+fech+'<small class="hint"> de 14 dias</small></p><p class="hint">Fechar o dia às 22:30 e deixar a primeira ação de amanhã escrita ajuda a começar sem esforço.</p></section>';
  return h+viewSettings();
}

var VIEWS={hoje:viewHoje,semana:viewSemana,faculdade:viewFac,estudos:viewEstudos,projetos:viewProj,habitos:viewHab};
function renderHead(){
  var el=document.getElementById('hd-date');
  if(el){var t=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});el.textContent=t.charAt(0).toUpperCase()+t.slice(1);}
}
function renderNav(){
  document.getElementById('nav').innerHTML=TABS.map(function(t){
    return '<button data-tab="'+t.k+'" class="'+(tab===t.k?'on':'')+'"'+(tab===t.k?' aria-current="page"':'')+'><svg viewBox="0 0 24 24" aria-hidden="true">'+t.i+'</svg><span>'+t.n+'</span></button>';
  }).join('');
}
function render(){
  var locked=!!(sb&&!session);
  document.getElementById('nav').hidden=locked;
  if(locked){document.getElementById('app').innerHTML=viewAuth();return;}
  renderNav();
  document.getElementById('app').innerHTML=(VIEWS[tab]||viewHoje)();
  if(tab==='habitos'&&habMode==='form')syncHabForm(document.querySelector('.habform'));
}
function go(t){
  if(t===tab)return;
  tab=t;confirmKey='';render();window.scrollTo(0,0);
  try{if(location.hash!=='#'+t)location.hash=t;}catch(e){}
}

/* ---------- Pomodoro: contagem e troca de fases ---------- */
function tickTimer(){
  timer.left=Math.max(0,Math.round((timer.endAt-Date.now())/1000));
  var el=document.getElementById('tm-clock');
  if(el)el.textContent=pad(Math.floor(timer.left/60))+':'+pad(timer.left%60);
  if(timer.left<=0)finishPhase(true);
}
/* Termina a fase atual. Foco concluído soma os minutos ao dia e à matéria; pular não soma. */
function finishPhase(completed){
  clearInterval(timer.iv);timer.running=false;
  var ph=timer.plan[timer.idx],subj=timer.subj;
  var log=completed&&ph.t==='f';
  timer.idx++;
  if(timer.idx>=timer.plan.length){timer.idx=0;timer.done='all';}
  else timer.done=ph.t==='f'?'f':'b';
  timer.left=timer.plan[timer.idx].m*60;
  if(completed){try{unlockAudio();beep();}catch(e){}}
  if(log)mutate(function(s){
    var d=ensureDay(todayKey());d.focusMin=(d.focusMin||0)+ph.m;
    if(subj){var sj=s.subjects.filter(function(x){return x.id===subj;})[0];if(sj)sj.min=(sj.min||0)+ph.m;}
  });
  else render();
}

/* ---------- ações ---------- */
function findP(id){return S.projects.filter(function(p){return p.id===id;})[0];}
function findS(id){return S.subjects.filter(function(p){return p.id===id;})[0];}
var ACTIONS={
  blk:function(b){var slot=b.dataset.slot;mutate(function(s){var d=ensureDay(todayKey()),x=d.blocks[slot]||(d.blocks[slot]={});x.done=!x.done;if(!x.done){delete x.energy;delete x.focus;}});},
  rate:function(b){var slot=b.dataset.slot,kind=b.dataset.kind,val=Number(b.dataset.val);mutate(function(s){var x=ensureDay(todayKey()).blocks[slot];if(!x)return;if(x[kind]===val)delete x[kind];else x[kind]=val;});},
  task:function(b){var id=b.dataset.id;mutate(function(s){s.tasks.forEach(function(t){if(t.id===id){t.done=!t.done;t.doneAt=t.done?Date.now():0;}});});},
  dl:function(b){var id=b.dataset.id;mutate(function(s){s.deadlines.forEach(function(t){if(t.id===id)t.done=!t.done;});});},
  cyc:function(b){var d=b.dataset.d,sl=b.dataset.s;mutate(function(s){var c=s.template[d][sl];c.a=AREA_KEYS[(AREA_KEYS.indexOf(c.a)+1)%AREA_KEYS.length];});},
  tcyc:function(b){var id=b.dataset.id,p=b.dataset.p;mutate(function(s){var sj=findS(p);if(!sj)return;sj.topics.forEach(function(t){if(t.id===id)t.st=(t.st+1)%3;});});},
  logmin:function(b){var id=b.dataset.id,v=Number(b.dataset.val);mutate(function(s){var sj=findS(id);if(sj)sj.min=(sj.min||0)+v;var d=ensureDay(todayKey());d.focusMin=(d.focusMin||0)+v;});},
  step:function(b){var id=b.dataset.id,p=b.dataset.p;mutate(function(s){var pj=findP(p);if(!pj)return;pj.steps.forEach(function(t){if(t.id===id)t.done=!t.done;});});},
  pact:function(b){var id=b.dataset.id;mutate(function(s){s.projects.forEach(function(p){p.active=(p.id===id);if(p.id===id)p.done=false;});});},
  ppark:function(b){var id=b.dataset.id;mutate(function(s){var p=findP(id);if(p)p.active=false;});},
  pdone:function(b){var id=b.dataset.id;mutate(function(s){var p=findP(id);if(p){p.done=!p.done;if(p.done)p.active=false;}});},
  idea2p:function(b){var id=b.dataset.id;mutate(function(s){var i=s.ideas.filter(function(x){return x.id===id;})[0];if(!i)return;
    s.projects.push({id:uid(),name:i.text.slice(0,70),kind:i.kind,goal:'',steps:[],active:false,done:false});
    s.ideas=s.ideas.filter(function(x){return x.id!==id;});});},
  del:function(b){
    var kind=b.dataset.kind,id=b.dataset.id,p=b.dataset.p,key=kind+'|'+id;
    if(confirmKey!==key){confirmKey=key;render();setTimeout(function(){if(confirmKey===key){confirmKey='';render();}},3000);return;}
    confirmKey='';
    if(kind==='branch'&&branchUse(id)){branchMsg='Este ramo ainda tem projetos ou ideias. Mude ou apague esses itens antes de remover o ramo.';render();return;}
    if(kind==='branch')branchMsg='';
    if(kind==='habit'){habMode='list';habDraft=null;}
    mutate(function(s){
      if(kind==='task')s.tasks=s.tasks.filter(function(x){return x.id!==id;});
      else if(kind==='dl')s.deadlines=s.deadlines.filter(function(x){return x.id!==id;});
      else if(kind==='ev')s.events=s.events.filter(function(x){return x.id!==id;});
      else if(kind==='subj')s.subjects=s.subjects.filter(function(x){return x.id!==id;});
      else if(kind==='proj')s.projects=s.projects.filter(function(x){return x.id!==id;});
      else if(kind==='idea')s.ideas=s.ideas.filter(function(x){return x.id!==id;});
      else if(kind==='course')s.courses=s.courses.filter(function(x){return x.id!==id;});
      else if(kind==='mat')s.courses.forEach(function(c){c.mats=c.mats.filter(function(x){return x.id!==id;});});
      else if(kind==='disc')s.courses.forEach(function(c){c.mats.forEach(function(m){m.discs=m.discs.filter(function(x){return x.id!==id;});});});
      else if(kind==='branch')s.branches=s.branches.filter(function(x){return x.id!==id;});
      else if(kind==='habit')s.habits=s.habits.filter(function(x){return x.id!==id;});
      else if(kind==='hday'){var hh=s.habits.filter(function(x){return x.id===id;})[0];if(hh){if(hh.link==='screen'){if(s.days[p])s.days[p].screen=null;}else delete hh.logs[p];}}
      else if(kind==='topic'){var sj=findS(p);if(sj)sj.topics=sj.topics.filter(function(x){return x.id!==id;});}
      else if(kind==='step'){var pj=findP(p);if(pj)pj.steps=pj.steps.filter(function(x){return x.id!==id;});}
    });
  },
  pfocus:function(b){if(timer.running)return;var v=Number(b.dataset.val);mutate(function(s){s.pomo.focus=v===50?50:25;});},
  ptotal:function(b){if(timer.running)return;var v=Number(b.dataset.val);mutate(function(s){s.pomo.total=v;});},
  tskip:function(){if(timer.plan.length<2)return;finishPhase(false);},
  tgo:function(){
    if(timer.running){tickTimer();if(!timer.running)return;clearInterval(timer.iv);timer.running=false;render();return;}
    timer.done='';unlockAudio();timer.endAt=Date.now()+timer.left*1000;timer.running=true;
    clearInterval(timer.iv);timer.iv=setInterval(tickTimer,500);render();
  },
  fold:function(b){var id=b.dataset.id;folded[id]=!folded[id];render();},
  disc:function(b){var id=b.dataset.id;mutate(function(s){s.courses.forEach(function(c){c.mats.forEach(function(m){m.discs.forEach(function(x){if(x.id===id)x.done=!x.done;});});});});},
  hnew:function(){habDraft=blankHabit();habEditId='';habMode='form';habMsg='';render();window.scrollTo(0,0);},
  htpl:function(b){
    var m=HB.TEMPLATES.filter(function(x){return x.id===b.dataset.id;})[0];if(!m)return;
    if(m.link==='screen'&&S.habits.some(function(h){return h.link==='screen'&&!HB.isFinished(h,todayKey());})){habMsg='Você já tem um hábito de tempo de tela. Edite o que existe.';render();return;}
    habDraft=Object.assign(blankHabit(),clone(m),{id:'',start:todayKey(),paused:false,remind:{on:false,time:''},end:{mode:'none',date:'',days:null},logs:{}});
    habEditId='';habMode='form';habMsg='';render();window.scrollTo(0,0);
  },
  hedit:function(b){var h=habFind(b.dataset.id);if(!h)return;habDraft=clone(h);habEditId=h.id;habMode='form';habMsg='';render();window.scrollTo(0,0);},
  hopen:function(b){habDetailId=b.dataset.id;habMode='detail';habMsg='';render();window.scrollTo(0,0);},
  hback:function(){habMode='list';habDraft=null;habEditId='';habMsg='';render();window.scrollTo(0,0);},
  hpause:function(b){var id=b.dataset.id;mutate(function(s){var h=s.habits.filter(function(x){return x.id===id;})[0];if(h)h.paused=!h.paused;});},
  hfold:function(b){var id=b.dataset.id;habFold[id]=!habFold[id];render();},
  hpreset:function(b){
    var f=b.closest('form'),set={all:[0,1,2,3,4,5,6],wk:[0,6],uteis:[1,2,3,4,5]}[b.dataset.v]||[];
    f.querySelectorAll('input[name=day]').forEach(function(i){i.checked=set.indexOf(Number(i.value))>=0;});
  },
  notif:async function(){
    notifMsg='';
    if(pushOn()){setPush(false);render();applyNotifs(false);return;}
    if(NATIVE){
      setPush(true);
      var ok=await applyNotifs(true);
      if(!ok){setPush(false);notifMsg='Não foi possível ligar. Libere as notificações do app nas configurações do Android e tente de novo.';}
      render();return;
    }
    if(typeof Notification==='undefined')return;
    unlockAudio();
    var perm=Notification.permission;
    if(perm!=='granted'){try{perm=await Notification.requestPermission();}catch(e){}}
    if(perm==='granted'){setPush(true);webTick();}
    render();
  },
  otacheck:function(){otaMsg='Procurando…';if(tab==='habitos')render();otaRun(true);},
  otaapply:function(){applyNow();},
  ntest:async function(){
    var p={title:'Teste de aviso',body:'Se você ouviu o som e sentiu a vibração, os avisos estão funcionando.'};
    if(NATIVE){
      try{
        var perm=await LocalNotifications.checkPermissions();
        if(perm.display!=='granted')perm=await LocalNotifications.requestPermissions();
        if(perm.display!=='granted'){notifMsg='Permissão negada. Libere as notificações do app nas configurações do Android.';render();return;}
        await setupChannels();
        await LocalNotifications.schedule({notifications:[{id:9,title:p.title,body:p.body,channelId:'prazos',schedule:{at:new Date(Date.now()+5000),allowWhileIdle:true}}]});
        notifMsg='O aviso de teste chega em 5 segundos. Pode bloquear a tela.';
      }catch(e){notifMsg='Não foi possível agendar o teste.';}
    }else if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
      unlockAudio();showWeb(p,'teste'+Date.now());notifMsg='Aviso de teste enviado.';
    }else notifMsg='Ligue os avisos antes de testar.';
    render();
  },
  ev:function(b){var id=b.dataset.id;mutate(function(s){s.events.forEach(function(x){if(x.id===id)x.done=!x.done;});});},
  mdone:function(b){
    var kind=b.dataset.kind,id=b.dataset.id,pid=b.dataset.p;
    mutate(function(s){
      if(kind==='dl')s.deadlines.forEach(function(x){if(x.id===id)x.done=true;});
      else if(kind==='ev')s.events.forEach(function(x){if(x.id===id)x.done=true;});
      else if(kind==='step'){var pj=s.projects.filter(function(x){return x.id===pid;})[0];if(pj)pj.steps.forEach(function(x){if(x.id===id)x.done=true;});}
    });
    renderModal();
  },
  mclose:function(){alertOpen=false;renderModal();},
  logout:async function(){if(sb)await sb.auth.signOut();},
  export:function(){
    var blob=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rotina-noturna-'+todayKey()+'.json';
    document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
  },
  treset:function(){clearInterval(timer.iv);timer.running=false;timer.idx=0;timer.left=timer.plan.length?timer.plan[0].m*60:0;timer.done='';render();}
};
var FORMS={
  auth:function(fd,f,sub){doAuth(sub&&sub.value==='up'?'up':'in',String(fd.get('email')||'').trim(),String(fd.get('password')||''));},
  task:function(fd){var title=String(fd.get('title')||'').trim();if(!title)return;var area=fd.get('area')||'estudo',slot=fd.get('slot')||'',time=String(fd.get('time')||'');
    mutate(function(s){s.tasks.push({id:uid(),title:title,area:area,date:todayKey(),slot:slot,time:time,done:false});});},
  dl:function(fd){var title=String(fd.get('title')||'').trim(),sub=String(fd.get('subject')||'').trim(),due=String(fd.get('due')||'');if(!title||!due)return;
    mutate(function(s){s.deadlines.push({id:uid(),subject:sub,title:title,due:due,done:false});});},
  topic:function(fd,f){var title=String(fd.get('title')||'').trim(),id=f.dataset.id;if(!title)return;
    mutate(function(s){var sj=findS(id);if(sj)sj.topics.push({id:uid(),title:title,st:0});});},
  subj:function(fd){var name=String(fd.get('name')||'').trim();if(!name)return;
    mutate(function(s){s.subjects.push({id:uid(),name:name,min:0,topics:[]});});},
  proj:function(fd){var name=String(fd.get('name')||'').trim();if(!name)return;var kind=fd.get('kind')||'',goal=String(fd.get('goal')||'').trim();
    mutate(function(s){var has=s.projects.some(function(p){return p.active&&!p.done;});
      s.projects.push({id:uid(),name:name,kind:kind,goal:goal,steps:[],active:!has,done:false});});},
  step:function(fd,f){var title=String(fd.get('title')||'').trim(),id=f.dataset.id,due=String(fd.get('due')||'');if(!title)return;
    mutate(function(s){var p=findP(id);if(p)p.steps.push({id:uid(),title:title,due:due,done:false});});},
  ev:function(fd){var title=String(fd.get('title')||'').trim(),date=String(fd.get('date')||'');if(!title||!date)return;
    var time=String(fd.get('time')||''),area=fd.get('area')||'outros',note=String(fd.get('note')||'').trim();
    mutate(function(s){s.events.push({id:uid(),title:title,date:date,time:time,area:area,note:note,done:false});});},
  idea:function(fd){var text=String(fd.get('text')||'').trim();if(!text)return;var kind=fd.get('kind')||'';
    mutate(function(s){s.ideas.unshift({id:uid(),text:text,kind:kind});});},
  course:function(fd){var name=String(fd.get('name')||'').trim();if(!name)return;
    mutate(function(s){s.courses.push({id:uid(),name:name,mats:[]});});},
  mat:function(fd,f){var name=String(fd.get('name')||'').trim(),id=f.dataset.id;if(!name)return;
    mutate(function(s){s.courses.forEach(function(c){if(c.id===id)c.mats.push({id:uid(),name:name,discs:[]});});});},
  disc:function(fd,f){var name=String(fd.get('name')||'').trim(),id=f.dataset.id;if(!name)return;
    mutate(function(s){s.courses.forEach(function(c){c.mats.forEach(function(m){if(m.id===id)m.discs.push({id:uid(),name:name,done:false});});});});},
  branch:function(fd){var name=String(fd.get('name')||'').trim();if(!name)return;
    if(S.branches.some(function(b){return b.name.toLowerCase()===name.toLowerCase();})){branchMsg='Já existe um ramo com esse nome.';render();return;}
    branchMsg='';mutate(function(s){s.branches.push({id:uid(),name:name});});},
  habit:function(fd){
    var d=habFromForm(fd,habDraft||blankHabit()),err=HB.validateHabit(d);
    if(err){habDraft=d;habMsg=err;render();return;}
    var t=todayKey(),edit=habEditId;
    habMsg='';habDraft=null;habEditId='';habMode='list';
    mutate(function(s){
      if(d.link==='screen'&&d.goal.value>0)s.screenGoal=Math.round(d.goal.value);
      if(!edit){
        var nh=Object.assign({},d,{id:uid(),start:t,paused:false,logs:{}});
        nh.hist=[{from:t,goal:clone(nh.goal),freq:clone(nh.freq)}];
        s.habits.push(nh);return;
      }
      var e=s.habits.filter(function(x){return x.id===edit;})[0];if(!e)return;
      var before=JSON.stringify([HB.cfgAt(e,t).goal,HB.cfgAt(e,t).freq]);
      ['name','desc','icon','cat','period','freq','goal','remind','end'].forEach(function(k){e[k]=d[k];});
      if(JSON.stringify([d.goal,d.freq])!==before){
        e.hist=e.hist||[{from:e.start,goal:clone(d.goal),freq:clone(d.freq)}];
        var last=e.hist[e.hist.length-1],ent={from:t,goal:clone(d.goal),freq:clone(d.freq)};
        if(last&&last.from===t)e.hist[e.hist.length-1]=ent;else e.hist.push(ent);
      }
    });
  },
  hlog:function(fd,f){
    var h=habFind(f.dataset.id),t=todayKey();if(!h||HB.isFinished(h,t))return;
    var given=String(fd.get('date')||''),key=given||t;
    if(key>t)key=t;if(key<h.start)key=h.start;
    var g=HB.cfgAt(h,key).goal,raw=String(fd.get('v')||''),v;
    if(g.type==='time'&&h.link!=='screen'){
      if(!/^\d{2}:\d{2}$/.test(raw))return;
      v=raw;
      if(h.tpl==='sleep'&&!given&&raw<'06:00'&&addDays(t,-1)>=h.start)key=addDays(t,-1); /* madrugada conta para a noite anterior */
    }else{v=Number(raw.replace(',','.'));if(!(v>0))return;}
    mutate(function(s){
      var hh=s.habits.filter(function(x){return x.id===h.id;})[0];if(!hh)return;
      if(hh.link==='screen'){var d=ensureDay(key);d.screen=(d.screen||0)+v;return;}
      var ent={id:uid(),v:v,at:Date.now()};
      if(g.type==='time')hh.logs[key]=[ent];else(hh.logs[key]=hh.logs[key]||[]).push(ent);
    });
  },
  screen:function(fd){var m=parseInt(fd.get('min'),10),g=parseInt(fd.get('goal'),10);
    mutate(function(s){ensureDay(todayKey()).screen=isNaN(m)?null:Math.max(0,m);if(g>0)s.screenGoal=g;});}
};
var FIELDS={
  import:function(t){
    var f=t.files&&t.files[0];if(!f)return;
    var r=new FileReader();
    r.onload=function(){
      try{
        var o=JSON.parse(String(r.result));
        if(!o||typeof o!=='object'||!o.template)throw new Error('formato');
        S=normalize(o);touch();importMsg='Backup importado.';render();scheduleSave();
      }catch(e){importMsg='Arquivo inválido. Use um backup exportado por este app.';render();}
    };
    r.readAsText(f);t.value='';
  },
  main:function(t){mutate(function(s){ensureDay(todayKey()).main=t.value.trim();},{render:false});},
  next:function(t){mutate(function(s){ensureDay(todayKey()).next=t.value.trim();},{render:false});},
  tpl:function(t){var d=t.dataset.d,sl=t.dataset.s,v=t.value.trim()||'Livre';mutate(function(s){s.template[d][sl].l=v;},{render:false});},
  pgoal:function(t){var id=t.dataset.id,v=t.value.trim();mutate(function(s){var p=findP(id);if(p)p.goal=v;},{render:false});},
  tmsubj:function(t){timer.subj=t.value;},
  pmtotal:function(t){var v=Math.round(Number(t.value));if(!(v>=10))v=10;if(v>720)v=720;mutate(function(s){s.pomo.total=v;});},
  hform:function(t){syncHabForm(t.form);}
};

/* ---------- eventos ---------- */
var app=document.getElementById('app');
app.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b)return;
  var fn=ACTIONS[b.dataset.act];if(fn)fn(b);
});
app.addEventListener('submit',function(e){
  e.preventDefault();var f=e.target,fn=FORMS[f.dataset.form];if(fn)fn(new FormData(f),f,e.submitter);
});
app.addEventListener('change',function(e){
  var t=e.target,fn=FIELDS[t.dataset&&t.dataset.field];if(fn)fn(t);
});
document.getElementById('nav').addEventListener('click',function(e){
  var b=e.target.closest('[data-tab]');if(b)go(b.dataset.tab);
});
window.addEventListener('hashchange',function(){
  var h=(location.hash||'').slice(1);
  if(h!==tab&&VIEWS[h]){tab=h;confirmKey='';render();}
});
function dayCheck(){
  if(todayKey()!==curDay){
    curDay=todayKey();
    if(rollover()){touch();scheduleSave();}
    renderHead();render();
  }
}
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'){
    dayCheck();pullNow();scheduleNotifs();webTick();
    if(NATIVE&&Date.now()-otaLast>30*60000)otaRun(false);
    if(hiddenAt&&Date.now()-hiddenAt>10*60000)maybeAlert();
    hiddenAt=0;
  }else{hiddenAt=Date.now();if(dirty)flush();}
});
setInterval(dayCheck,60000);
setInterval(webTick,20000);
document.addEventListener('pointerdown',unlockAudio,{once:true});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&alertOpen){alertOpen=false;renderModal();}});
document.getElementById('ota').addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b)return;
  var fn=ACTIONS[b.dataset.act];if(fn)fn(b);
});
document.getElementById('modal').addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b)return;
  var fn=ACTIONS[b.dataset.act];if(fn)fn(b);
});

/* ---------- início ---------- */
(async function boot(){
  try{var h=(location.hash||'').slice(1);if(VIEWS[h])tab=h;}catch(e){}
  renderHead();
  if(NATIVE){markReady();setTimeout(function(){otaRun(false);},4000);}
  if(!NATIVE&&!DESKTOP&&'serviceWorker' in navigator&&location.protocol!=='file:'){navigator.serviceWorker.register('./sw.js').catch(function(){});}
  if(!sb){
    /* Sem Supabase configurado: funciona só neste aparelho. */
    S=lsLoadKey(null)||defState();
    if(rollover())touch();
    setSync('local');render();scheduleNotifs();setTimeout(maybeAlert,400);
    return;
  }
  setSync('out');render();
  sb.auth.onAuthStateChange(function(ev,sess){
    setTimeout(function(){
      if(sess&&sess.user){if(userId!==sess.user.id)startSession(sess);}
      else if(ev==='SIGNED_OUT'&&userId)endSession();
    },0);
  });
  try{
    var r=await sb.auth.getSession();
    if(r.data&&r.data.session&&!userId)startSession(r.data.session);
  }catch(e){setSync('err');}
})();
})();
