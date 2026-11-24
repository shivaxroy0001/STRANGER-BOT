const C=require(require('path').join(__dirname,'..','core.js'));
const env=C.defEnv();const S=C.newUser();
const errs=[];
const count=v=>{let n=1;const rows=v.blocks.filter(b=>b.k==='row').length;for(const b of v.blocks){n++; if(b.k==='row')n+=1+b.items.length; else if(b.k==='section')n+=3; else if(b.k==='select')n+=1+0;}return {n,rows};};
const check=(label)=>{try{const v=C.view(S,env);const c=count(v);
 for(const b of v.blocks){if(b.k==='row'&&b.items.length>5)errs.push(label+' row>5');if(b.k==='select'&&b.opts.length>25)errs.push(label+' select>25');}
 const ids=[];v.blocks.forEach(b=>{if(b.k==='row')b.items.forEach(i=>ids.push(i.id));if(b.k==='section')ids.push(b.btn.id);if(b.k==='select')ids.push(b.id)});
 const d=ids.filter((x,i)=>ids.indexOf(x)!==i);if(d.length)errs.push(label+' dup ids '+d);
 const prim=v.blocks.reduce((a,b)=>a+(b.k==='row'?b.items.filter(i=>i.style==='primary').length:b.k==='section'&&b.btn.style==='primary'?1:0),0);
 if(prim>1)errs.push(label+' primaries='+prim);
 if(c.n>40||c.rows>5)errs.push(label+' count '+JSON.stringify(c));
 return v;}catch(e){errs.push(label+' ERR '+e.message);}};
const D=(id,v)=>{const r=C.dispatch(S,id,v,env);return r;};
// gate
check('gate');D('gate:yes');check('home');
for(const s of C.SCREENS){ if(['chat','game','confirm','report','ended','minor','searching','mod','server'].includes(s))continue; S.screen=s;check(s);}
S.role='Admin';S.screen='mod';check('mod');S.screen='server';check('server');
// flow
D('chat:find');check('searching');
C.matched(S,{id:'u2',tag:'4821',verified:true,region:'Europe',shared:['music']},env);check('chat');
D('chat:ice');D('chat:reveal');check('confirm');D('ok:chat:reveal');check('chat');
C.partnerReveal(S,'req');check('chat');C.partnerReveal(S,'yes','sky');check('chat');
D('game:invite:wyr');check('chat');C.partnerGame(S,'yes',{q:1},env);check('game');
D('game:pick:0');C.partnerGame(S,'ans',0,env);check('game');D('game:next');check('game');D('game:close');check('chat');
C.partnerGame(S,'invite','tri',env);check('chat');D('game:yes');check('game');D('game:pick:1');C.partnerGame(S,'ans',2,env);check('game');D('game:close');
D('chat:report');check('report');D('sel:reason',['Spam or links']);check('report');D('rep:send');check('confirm');D('ok:rep:send');check('ended');
D('end:good');check('ended');
D('chat:find');C.matched(S,{id:'u3',tag:'1190',verified:false,shared:[]},env);D('chat:panic');check('confirm');D('ok:chat:panic');check('panic');
D('nav:blocks');check('blocks');D('sel:unblock',[String(S.blocks[0].id)]);
D('nav:quests');check('quests');D('nav:badges');check('badges');D('nav:leaderboard');check('leaderboard');
D('mod:warn');D('nav:mod');check('mod');D('mod:ban');check('confirm');D('ok:mod:ban');
D('tg:sv.on');check('confirm');D('ok:tg:sv.on');
console.log(D('modal:profile',{alias:'Skye99',bio:'hi'}).pop.t, D('modal:vcode',{code:'123456'}).pop.t, D('modal:appeal',{reason:'short'}).pop.t);
console.log(C.runCmd(S,'chat start',{mode:'Nearby'},env).fx.map(f=>f.t), C.runCmd(S,'verify code',{code:'12'},env).pop.t, C.runCmd(S,'interests',{list:'gaming, music'},env).pop.t);
console.log(errs.length?errs.join('\n'):'CORE OK');
