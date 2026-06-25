// ══ STORAGE ══
var UK = 'nemu_users', SK = 'nemu_session', RK = 'nemu_recents';
var getU = function(){ try{return JSON.parse(localStorage.getItem(UK)||'{}')}catch(e){return{}} };
var setU = function(u){ localStorage.setItem(UK,JSON.stringify(u)) };
var getSess = function(){ try{return JSON.parse(localStorage.getItem(SK))}catch(e){return null} };
var setSess = function(s){ localStorage.setItem(SK,JSON.stringify(s)) };
var clrSess = function(){ localStorage.removeItem(SK) };
var getR = function(){ try{return JSON.parse(localStorage.getItem(RK)||'[]')}catch(e){return[]} };
var setR = function(r){ localStorage.setItem(RK,JSON.stringify(r.slice(0,50))) };

// ══ STATE ══
var peer=null, localStream=null, currentCall=null, pendingCall=null;
var muted=false, camOff=false, callNum='', deferredPrompt=null;
var currentUser=null;

// ══ UI ══
function show(id){
  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active')});
  document.getElementById(id).classList.add('active');
}
function showLogin(){ show('authScreen'); hide('loginErr'); }
function showReg(){ show('regScreen'); hide('regErr'); }
function hide(id){ document.getElementById(id).style.display='none'; }
function err(id,msg){ var e=document.getElementById(id); e.textContent=msg; e.style.display='block'; }

// ══ TABS ══
var currentTab = 'dial';
function switchTab(t){
  currentTab = t;
  ['dial','recents','me'].forEach(function(x){
    document.getElementById('tab'+x.charAt(0).toUpperCase()+x.slice(1)).classList.toggle('active', x===t);
    document.getElementById('tabContent'+x.charAt(0).toUpperCase()+x.slice(1)).style.display = x===t ? 'flex' : 'none';
  });
  if(t==='recents') renderRecents();
}

// ══ KEYPAD ══
var dialStr='';
function kp(d){ if(dialStr.length>=15)return; dialStr+=d; document.getElementById('dialNum').textContent=dialStr||'\u200B'; }
function kpDel(){ dialStr=dialStr.slice(0,-1); document.getElementById('dialNum').textContent=dialStr||'\u200B'; }
function callDial(video){ startCall(dialStr, video); }

// ══ AUTH ══
function doRegister(){
  var name=document.getElementById('regName').value.trim();
  var num=document.getElementById('regNum').value.trim();
  var pass=document.getElementById('regPass').value;
  hide('regErr');
  if(!name||!num||!pass){err('regErr','Completa todos los campos');return;}
  if(!/^\d+$/.test(num)){err('regErr','El número solo debe tener dígitos');return;}
  var u=getU();
  if(u[num]){err('regErr','Ese número ya existe, elige otro');return;}
  u[num]={name:name,pass:pass};
  setU(u);
  setSess({num:num,name:name});
  enterApp(num,name);
}

function login(){
  var num=document.getElementById('loginNum').value.trim();
  var pass=document.getElementById('loginPass').value;
  hide('loginErr');
  var u=getU();
  if(!u[num]||u[num].pass!==pass){err('loginErr','Número o contraseña incorrectos');return;}
  setSess({num:num,name:u[num].name});
  enterApp(num,u[num].name);
}

function logout(){
  if(peer){try{peer.destroy()}catch(e){} peer=null;}
  clrSess(); showLogin();
}

// ══ ENTER APP ══
function enterApp(num,name){
  currentUser={num:num,name:name};
  document.getElementById('uName').textContent=name;
  document.getElementById('uNum').textContent=num;
  document.getElementById('myName').textContent=name;
  document.getElementById('myNum').textContent=num;
  show('appScreen');
  switchTab('dial');
  initPeer(num);
  checkBanners();
}

function copyNum(){
  var n=currentUser?currentUser.num:'';
  if(navigator.clipboard){navigator.clipboard.writeText(n);}
  var b=document.getElementById('myNum');
  b.textContent='✅ Copiado!';
  setTimeout(function(){b.textContent=currentUser.num;},1500);
}

// ══ PEERJS ══
function initPeer(num){
  if(peer){try{peer.destroy()}catch(e){}}
  var dot=document.getElementById('onlineDot');
  peer=new Peer('nemu-'+num,{
    host:'0.peerjs.com',port:443,path:'/',secure:true,
    config:{iceServers:[
      {urls:'stun:stun.l.google.com:19302'},
      {urls:'stun:stun1.l.google.com:19302'},
      {urls:'stun:stun2.l.google.com:19302'},
      {urls:'turn:openrelay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},
      {urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
      {urls:'turn:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'}
    ]}
  });
  peer.on('open',function(){ dot.classList.add('on'); });
  peer.on('disconnected',function(){ dot.classList.remove('on'); setTimeout(function(){if(peer)peer.reconnect();},3000); });
  peer.on('call',function(call){
    pendingCall=call;
    callNum=call.peer.replace('nemu-','');
    document.getElementById('incomingNum').textContent=callNum;
    show('incomingScreen');
    vibrateIncoming();
    sendNotif('📲 Llamada de '+callNum,'Toca para contestar en Ñemu');
  });
  peer.on('error',function(e){
    if(e.type==='peer-unavailable'){setDialErr('El número '+dialStr+' no está conectado.');return;}
    setDialErr('Error: '+e.type);
    show('appScreen');
  });
}

function setDialErr(msg){
  var el=document.getElementById('dialErr');
  el.textContent=msg;
  setTimeout(function(){el.textContent='';},4000);
}

// ══ MEDIA ══
function getMedia(video,cb){
  navigator.mediaDevices.getUserMedia({audio:true,video:video})
    .then(function(s){cb(null,s)})
    .catch(function(e){
      var m='No se pudo acceder a la cámara/micrófono.';
      if(e.name==='NotAllowedError'||e.name==='PermissionDeniedError')
        m='Permiso denegado. Toca el candado en el navegador y permite cámara y micrófono.';
      else if(e.name==='NotFoundError') m='No se encontró cámara o micrófono.';
      else if(e.name==='NotReadableError') m='La cámara está en uso por otra app.';
      cb(m,null);
    });
}

// ══ CALLS ══
function startCall(dest, video){
  if(!dest){setDialErr('Marca un número primero');return;}
  if(!peer||!peer.open){setDialErr('Conectando… espera un momento');return;}
  getMedia(video,function(e,stream){
    if(e){setDialErr(e);return;}
    localStream=stream;
    document.getElementById('localVideo').srcObject=stream;
    showCallScreen(dest, video);
    document.getElementById('callStatus').textContent='Llamando…';
    var call=peer.call('nemu-'+dest,stream);
    currentCall=call;
    var answered=false;
    var t=setTimeout(function(){
      if(!answered){hangup();setDialErr('No contestó o el número no está conectado.');}
    },30000);
    call.on('stream',function(rs){
      answered=true; clearTimeout(t);
      setRemoteStream(rs);
      document.getElementById('callStatus').textContent='En llamada ✅';
      addRecent(dest,'out');
    });
    call.on('close',function(){clearTimeout(t);endCallUI();});
    call.on('error',function(){clearTimeout(t);endCallUI();setDialErr('Error de conexión.');});
  });
}

function answerCall(){
  if(!pendingCall)return;
  var call=pendingCall; pendingCall=null;
  getMedia(true,function(e,stream){
    if(e){show('appScreen');setDialErr(e);return;}
    localStream=stream;
    document.getElementById('localVideo').srcObject=stream;
    call.answer(stream);
    currentCall=call;
    showCallScreen(callNum, true);
    document.getElementById('callStatus').textContent='En llamada ✅';
    call.on('stream',function(rs){
      setRemoteStream(rs);
      addRecent(callNum,'in');
    });
    call.on('close',function(){endCallUI();});
  });
}

function rejectCall(){
  if(pendingCall){try{pendingCall.close()}catch(e){} pendingCall=null;}
  show('appScreen');
}

function showCallScreen(num, video){
  document.getElementById('callPeer').textContent=num;
  document.getElementById('noVideoName').textContent=num;
  document.getElementById('noVideoOverlay').style.display = video ? 'none' : 'flex';
  show('callScreen');
}

function setRemoteStream(rs){
  var rv=document.getElementById('remoteVideo');
  rv.srcObject=rs;
  rv.muted=false;
  rv.volume=1.0;
  rv.play().catch(function(){});
  // show no-video overlay if no video tracks
  var hasVideo=rs.getVideoTracks().length>0;
  document.getElementById('noVideoOverlay').style.display=hasVideo?'none':'flex';
}

function hangup(){
  if(currentCall){try{currentCall.close()}catch(e){} currentCall=null;}
  stopStream();
  endCallUI();
}

function stopStream(){
  if(localStream){localStream.getTracks().forEach(function(t){t.stop()});localStream=null;}
}

function endCallUI(){
  document.getElementById('remoteVideo').srcObject=null;
  document.getElementById('localVideo').srcObject=null;
  document.getElementById('localVideo').style.filter='none';
  document.querySelectorAll('.fpill').forEach(function(p){p.classList.remove('on')});
  document.querySelector('.fpill').classList.add('on');
  muted=false; camOff=false;
  document.getElementById('btnMute').textContent='🎙️';
  document.getElementById('btnCam').textContent='📷';
  show('appScreen');
}

// ── CONTROLS ──
function toggleMute(){
  if(!localStream)return;
  muted=!muted;
  localStream.getAudioTracks().forEach(function(t){t.enabled=!muted});
  var b=document.getElementById('btnMute');
  b.textContent=muted?'🔇':'🎙️';
  b.className='ctrl '+(muted?'on':'off');
}
function toggleCam(){
  if(!localStream)return;
  camOff=!camOff;
  localStream.getVideoTracks().forEach(function(t){t.enabled=!camOff});
  var b=document.getElementById('btnCam');
  b.textContent=camOff?'🚫':'📷';
  b.className='ctrl '+(camOff?'on':'off');
}

// ── FILTERS ──
function setF(f,el){
  document.getElementById('localVideo').style.filter=f;
  document.querySelectorAll('.fpill').forEach(function(p){p.classList.remove('on')});
  if(el)el.classList.add('on');
}

// ── RECENTS ──
function addRecent(num, dir){
  var r=getR();
  r.unshift({num:num,dir:dir,time:Date.now()});
  setR(r);
}
function renderRecents(){
  var r=getR();
  var wrap=document.getElementById('recentsList');
  if(!r.length){wrap.innerHTML='<div class="recents-empty">Sin llamadas recientes</div>';return;}
  wrap.innerHTML='';
  r.forEach(function(item){
    var d=new Date(item.time);
    var t=d.toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});
    var icon=item.dir==='in'?'📲':'📞';
    var div=document.createElement('div');
    div.className='recent-item';
    div.innerHTML='<div class="recent-avatar">'+icon+'</div>'+
      '<div class="recent-info"><div class="recent-name">'+item.num+'</div>'+
      '<div class="recent-time">'+(item.dir==='in'?'Entrante':'Saliente')+' · '+t+'</div></div>'+
      '<div class="recent-call-btn" onclick="startCallRecent(\''+item.num+'\')">📞</div>';
    wrap.appendChild(div);
  });
}
function startCallRecent(num){
  dialStr=num;
  document.getElementById('dialNum').textContent=num;
  switchTab('dial');
  startCall(num,false);
}

// ── NOTIFICATIONS ──
function sendNotif(title,body){
  if('Notification' in window && Notification.permission==='granted'){
    try{new Notification(title,{body:body,icon:'icon-192.png'});}catch(e){}
  }
}
function askNotif(){
  if(!('Notification' in window)){hide('notifBanner');return;}
  Notification.requestPermission().then(function(p){
    if(p==='granted') hide('notifBanner');
  });
}

// ── VIBRATE ──
function vibrateIncoming(){
  if(navigator.vibrate){
    var i=setInterval(function(){
      if(document.getElementById('incomingScreen').classList.contains('active')){
        navigator.vibrate([500,300,500]);
      } else { clearInterval(i); }
    },1400);
  }
}

// ── INSTALL PWA ──
window.addEventListener('beforeinstallprompt',function(e){
  e.preventDefault(); deferredPrompt=e;
  document.getElementById('installBanner').style.display='flex';
});
window.addEventListener('appinstalled',function(){
  document.getElementById('installBanner').style.display='none';
});
function doInstall(){
  if(deferredPrompt){deferredPrompt.prompt();deferredPrompt.userChoice.then(function(){deferredPrompt=null;});}
}

// ── BANNERS ──
function checkBanners(){
  if('Notification' in window && Notification.permission==='default'){
    document.getElementById('notifBanner').style.display='flex';
  }
}

// ── SERVICE WORKER ──
if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('/telefono-nemu/sw.js').catch(function(){});
  });
}

// ── INIT ──
(function(){
  var s=getSess();
  if(s&&s.num){ enterApp(s.num,s.name); }
})();
