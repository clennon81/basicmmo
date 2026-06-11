"use strict";
/* ════════════════════════════════════════════════════════════════════
   input.js — pointer lock, mouse look, and free WASD movement.

   The client never tells the server WHERE it is — only which keys are
   held and which way it's looking. The server integrates movement and
   fires shots along its own stored yaw, so speed/teleport/aim hacks
   have nothing to grab onto.
   ════════════════════════════════════════════════════════════════════ */

function anyModalOpen(){ return shopOpen||invOpen||charOpen||tradeOpen||boardOpen; }

/* ── Input streaming ── */
let _inputDirty=false, _lastInputSend=0;

function sendInput(force){
  if(!socket||!selfPlayer) return;
  inputState.yaw=yaw;
  socket.emit("input",{f:inputState.f,b:inputState.b,l:inputState.l,r:inputState.r,yaw,jump:inputState.jump?true:undefined});
  _inputDirty=false; _lastInputSend=performance.now();
}

function stopMovement(){
  if(inputState.f||inputState.b||inputState.l||inputState.r){
    inputState.f=inputState.b=inputState.l=inputState.r=false;
    sendInput(true);
  }
}

function startInputLoop(){
  // Heartbeat: keeps the server's yaw fresh for shots and movement,
  // and re-sends state on change immediately for responsiveness.
  setInterval(()=>{
    if(!socket) return;
    if(anyModalOpen()||isDead){ stopMovement(); return; }
    const idle=!inputState.f&&!inputState.b&&!inputState.l&&!inputState.r;
    if(_inputDirty||!idle) sendInput();
  },1000/PC.INPUT_HZ);
}

/* ── Pointer lock + mouse look ── */
function wantLock(){ if(!anyModalOpen()&&!isDead&&selfPlayer&&mapData) canvas.requestPointerLock(); }
canvas.addEventListener("click",()=>{ if(!pointerLocked){wantLock();return;} tryShoot(); });
$("lockHint").addEventListener("click",wantLock);
document.addEventListener("pointerlockchange",()=>{
  pointerLocked=document.pointerLockElement===canvas;
  if(!pointerLocked) stopMovement(); // alt-tab / Esc shouldn't leave us running
  updateLockHint();
});
function updateLockHint(){
  const show=!pointerLocked&&!anyModalOpen()&&selfPlayer&&mapData&&!isDead;
  $("lockHint").classList.toggle("hidden",!show);
}
document.addEventListener("mousemove",e=>{
  if(!pointerLocked) return;
  yaw-=e.movementX*MOUSE_SENSITIVITY;
  pitch-=e.movementY*MOUSE_SENSITIVITY;
  pitch=Math.max(-PITCH_LIMIT,Math.min(PITCH_LIMIT,pitch));
});
/* Exit pointer lock automatically when a modal opens. */
setInterval(()=>{ if(anyModalOpen()&&pointerLocked)document.exitPointerLock(); updateLockHint(); },150);

/* ── Keyboard: free movement state, jump, modal hotkeys ── */
const KEY_FLAG={w:"f",W:"f",ArrowUp:"f",s:"b",S:"b",ArrowDown:"b",a:"l",A:"l",ArrowLeft:"l",d:"r",D:"r",ArrowRight:"r"};

document.addEventListener("keydown",e=>{
  if(document.activeElement===$("chatInput")) return;
  const k=e.key;
  if(k==="b"||k==="B"){e.preventDefault();if(!isDead)shopOpen?closeShop():openShop();return;}
  if(k==="i"||k==="I"){e.preventDefault();invOpen?closeInv():openInv();return;}
  if(k==="c"||k==="C"){e.preventDefault();charOpen?closeChar():openChar();return;}
  if(k==="m"||k==="M"){e.preventDefault();const m=Sound.toggleMute();$("soundToggle").textContent=m?"🔇":"🔊";return;}
  if(k==="Escape"){if(shopOpen)closeShop();else if(invOpen)closeInv();else if(charOpen)closeChar();else if(tradeOpen)closeTradePost();else if(boardOpen){boardOpen=false;$("boardOverlay").classList.remove("show");}return;}
  if(k===" "){ // jump
    e.preventDefault();
    if(!anyModalOpen()&&!isDead&&predH<=0){ inputState.jump=true; sendInput(true); /* render.js consumes the flag for local prediction */ }
    return;
  }
  const flag=KEY_FLAG[k];
  if(flag&&!anyModalOpen()){
    e.preventDefault();
    if(!inputState[flag]){ inputState[flag]=true; sendInput(true); }
  }
});
document.addEventListener("keyup",e=>{
  const flag=KEY_FLAG[e.key];
  if(flag&&inputState[flag]){ inputState[flag]=false; sendInput(true); }
});
window.addEventListener("blur",stopMovement);
$("soundToggle").addEventListener("click",()=>{const m=Sound.toggleMute();$("soundToggle").textContent=m?"🔇":"🔊";});

/* ── Shooting: the client only ASKS; aim + rate live on the server ── */
function tryShoot(){
  if(isDead||anyModalOpen()||!socket) return;
  const now=Date.now(), delay=Math.max(120,selfStats.fireDelay||150);
  if(now-lastFireTime<delay) return; // purely cosmetic; server enforces too
  lastFireTime=now;
  sendInput(true);          // make sure the server has our current yaw…
  socket.emit("shoot");     // …then request the shot (no direction payload)
}
