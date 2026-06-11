"use strict";
/* ══════════════════ SOUND ══════════════════ */
const Sound = (() => {
  let actx=null, muted=false, masterGain=null;
  function ensureCtx(){if(!actx){actx=new(window.AudioContext||window.webkitAudioContext)();masterGain=actx.createGain();masterGain.gain.value=0.35;masterGain.connect(actx.destination);}if(actx.state==="suspended")actx.resume();}
  function tone(freq,dur,type="square",opts={}){if(muted)return;ensureCtx();const t0=actx.currentTime,osc=actx.createOscillator(),g=actx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,t0);if(opts.slideTo)osc.frequency.exponentialRampToValueAtTime(Math.max(20,opts.slideTo),t0+dur/1000);const vol=opts.vol??0.5,atk=(opts.attack??4)/1000;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+atk);g.gain.exponentialRampToValueAtTime(0.001,t0+dur/1000);osc.connect(g);g.connect(masterGain);osc.start(t0);osc.stop(t0+dur/1000+0.05);}
  function noise(dur,opts={}){if(muted)return;ensureCtx();const t0=actx.currentTime,len=actx.sampleRate*(dur/1000),buf=actx.createBuffer(1,len,actx.sampleRate),data=buf.getChannelData(0);for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*(1-i/len);const src=actx.createBufferSource();src.buffer=buf;const g=actx.createGain();g.gain.value=opts.vol??0.25;const filt=actx.createBiquadFilter();filt.type=opts.filter??"lowpass";filt.frequency.value=opts.freq??800;src.connect(filt);filt.connect(g);g.connect(masterGain);src.start(t0);}
  return {
    shoot(){tone(880,90,"square",{slideTo:220,vol:0.25});},
    hitMonster(){tone(220,80,"sawtooth",{slideTo:110,vol:0.3});noise(60,{freq:1200,vol:0.15});},
    monsterDie(){tone(440,200,"sawtooth",{slideTo:55,vol:0.35});noise(180,{freq:600,vol:0.2});},
    coin(){tone(988,70,"sine",{vol:0.3});setTimeout(()=>tone(1319,120,"sine",{vol:0.3}),70);},
    hurt(){tone(160,180,"sawtooth",{slideTo:70,vol:0.4});noise(120,{freq:400,vol:0.25});},
    blocked(){tone(523,60,"triangle",{vol:0.3});setTimeout(()=>tone(392,80,"triangle",{vol:0.25}),50);},
    die(){tone(330,250,"sawtooth",{slideTo:82,vol:0.4});setTimeout(()=>tone(220,350,"sawtooth",{slideTo:55,vol:0.35}),200);setTimeout(()=>tone(147,500,"sawtooth",{slideTo:37,vol:0.3}),450);},
    respawn(){tone(262,100,"sine",{vol:0.3});setTimeout(()=>tone(330,100,"sine",{vol:0.3}),100);setTimeout(()=>tone(392,100,"sine",{vol:0.3}),200);setTimeout(()=>tone(523,200,"sine",{vol:0.35}),300);},
    door(){noise(350,{freq:300,vol:0.3});tone(196,350,"sine",{slideTo:392,vol:0.2});},
    buy(){tone(659,80,"sine",{vol:0.3});setTimeout(()=>tone(880,80,"sine",{vol:0.3}),80);setTimeout(()=>tone(1175,160,"sine",{vol:0.35}),160);},
    itemPickup(){tone(660,60,"sine",{vol:0.2});setTimeout(()=>tone(990,100,"sine",{vol:0.25}),60);},
    error(){tone(196,150,"square",{slideTo:147,vol:0.2});},
    join(){tone(523,80,"sine",{vol:0.2});setTimeout(()=>tone(659,120,"sine",{vol:0.2}),80);},
    toggleMute(){muted=!muted;return muted;},isMuted(){return muted;},unlock(){ensureCtx();}
  };
})();
