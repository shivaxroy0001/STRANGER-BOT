const {createEngine}=require(require('path').join(__dirname,'..','engine.js'));
const C=require(require('path').join(__dirname,'..','core.js'));
const log=[];const errs=[];
const io={refresh:async u=>log.push('refresh '+u),dm:async(u,t)=>log.push('dm '+u+': '+t),ping:async(u,t)=>log.push('ping '+u),staff:async t=>log.push('staff: '+t)};
const E=createEngine(io,{demoVerify:true,onError:e=>errs.push(e.stack)});
const ok=(c,m)=>{if(!c)errs.push('FAIL '+m)};
const A='111',B='222',M='999';
E.act(A,'gate:yes',null,{uname:'alice'});E.act(B,'gate:yes',null,{uname:'bob'});
// both need shared interests or wait 30s: give A and B a shared interest
E.act(A,'sel:int',['gaming'],{});E.act(B,'sel:int',['gaming','music'],{});
// fresh users must not carry preview presets
ok(E.getUser(A).xp===0&&E.getUser(A).streak===0,'fresh user zero');
E.act(A,'chat:find',null,{});E.act(B,'chat:find',null,{});
E.sweep();
ok(E.pairs.get(A)&&E.pairs.get(A).pid===B,'matched');
const SA=E.getUser(A),SB=E.getUser(B);
ok(SA.screen==='chat'&&SB.screen==='chat','both on chat screen');
ok(SA.chat.shared[0]==='gaming','shared');
// relay + sanitize
const r1=E.relay(A,'hi visit www.bad.com');ok(r1.ok&&r1.removed,'relay sanitized');
ok(log.some(l=>l.includes('dm 222')&&l.includes('[link removed]')),'partner got cleaned text');
ok(E.relay(A,'again').why==='slow','rate limit');
// reveal
E.act(A,'ok:chat:reveal',null,{});ok(SB.chat.rev==='got','partner sees request');
E.act(B,'reveal:yes',null,{});ok(SA.chat.rev==='done'&&SA.chat.uname==='bob'&&SB.chat.uname==='alice','reveal both');
// game
E.act(A,'game:invite:wyr',null,{});ok(SB.game&&SB.game.state==='incoming','invite');
E.act(B,'game:yes',null,{});ok(SA.game&&SA.game.state==='play'&&SA.game.q===SB.game.q,'same question');
E.act(A,'game:pick:0',null,{});E.act(B,'game:pick:0',null,{});
ok(SA.game.mine===0&&SA.game.theirs===0&&SB.game.theirs===0,'answers synced');
ok(C.view(SA,E.env(A)).blocks.length>0,'game view');
E.act(A,'game:close',null,{});ok(!SB.game,'game closed both');
// icebreaker
E.act(A,'chat:ice',null,{});ok(log.filter(l=>l.includes('Icebreaker')).length>=2,'ice to both');
// report -> queue -> mod
E.act(A,'chat:report',null,{});E.act(A,'sel:reason',['Harassment'],{});E.act(A,'rep:send',null,{});E.act(A,'ok:rep:send',null,{});
ok(E.reports.length===1&&E.reports[0].reason==='Harassment'&&E.reports[0].log.length>=1,'report saved with log');
ok(!E.pairs.has(A)&&!E.pairs.has(B),'pair closed');ok(SB.screen==='ended'&&SB.last.why==='partner','partner sees ended');
ok(SA.blocks.length===1,'reporter blocked partner');
// users cant use mod
ok(E.act(A,'nav:mod',null,{role:'User'}).pop.t==='Missing permissions','mod denied');
const mr=E.act(M,'nav:mod',null,{role:'Mod',uname:'mod'});E.getUser(M);// mod needs adult
E.act(M,'gate:yes',null,{role:'Mod'});E.act(M,'nav:mod',null,{role:'Mod'});
ok(E.getUser(M).screen==='mod','mod screen');
E.act(M,'mod:ban24',null,{role:'Mod'});E.act(M,'ok:mod:ban24',null,{role:'Mod'});
ok(SB.banUntil>Date.now(),'target banned (reported user is B)');
ok(E.act(B,'chat:find',null,{}).blocked,'banned user blocked');
ok(E.act(B,'ap:open',null,{}).modal,'banned user can appeal');
ok(E.act(B,'modal:appeal',{reason:'This was a misunderstanding, please review it.'},{}).fx.some(f=>f.t==='appeal'),'appeal fx');
// panic
SB.banUntil=0;E.act(A,'sel:int',['gaming'],{});E.act(B,'sel:int',['gaming'],{});
SA.blocks=[];SB.blocks=[];SA.cd={};SB.cd={};
E.act(A,'chat:find',null,{});E.act(B,'chat:find',null,{});E.sweep();ok(E.pairs.has(A),'rematch');
E.act(A,'ok:chat:panic',null,{});ok(!E.pairs.has(B)&&E.reports.length>=1,'panic ends and reports');
// nearby filter
const X='333',Y='444';for(const u of[X,Y]){E.act(u,'gate:yes',null,{});E.act(u,'sel:mode',['Nearby'],{});}
E.act(X,'sel:region',['Europe'],{});E.act(Y,'sel:region',['Oceania'],{});E.act(X,'chat:find',null,{});E.act(Y,'chat:find',null,{});E.sweep();
ok(!E.pairs.has(X),'nearby blocks other region');
E.act(Y,'sel:region',['Europe'],{});E.sweep();ok(E.pairs.has(X),'nearby pairs same region');
// timeout
const Z='555';E.act(Z,'gate:yes',null,{});E.act(Z,'chat:find',null,{});E.queue.get(Z).since-=130000;E.sweep();ok(!E.queue.has(Z),'search timeout');
// server settings
const g=E.act(M,'nav:server',null,{role:'Admin',guildId:'G1'});ok(E.getUser(M).screen==='server','server screen');
E.act(M,'tg:sv.vo',null,{role:'Admin',guildId:'G1'});ok(E.guild('G1').vo===true,'guild setting persisted in guild obj');
const fs=require('fs');const E2=createEngine(io,{file:'./.test-data.json'});E2.getUser('77','u');E2.act('77','gate:yes',null,{});E2.save(true);
const E3=createEngine(io,{file:'./.test-data.json'});E3.load();ok(E3.users.get('77')&&E3.users.get('77').adult,'persistence');
console.log(errs.length?errs.join('\n'):'ENGINE OK ('+log.length+' io calls)');
