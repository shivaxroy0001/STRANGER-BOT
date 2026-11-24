'use strict';
/* Stranger Bot engine: users, queue, matching, relay, reports, moderation.
   No discord.js in here. The glue in bot.js passes in `io` so this file can be tested alone.
   io = { refresh(uid), dm(uid, text), ping(uid, text), staff(text) } (all may return promises) */
const fs = require('fs');
const C = require('./core');

const SAVE = ['alias', 'bio', 'avatar', 'mood', 'mode', 'age', 'myAge', 'region', 'lang', 'interests', 'vlevel', 'xp', 'streak', 'lastDaily', 'qday', 'quests', 'claimed', 'poll', 'notif', 'discoverable', 'showBadge', 'showRegion', 'verifiedOnly', 'blocks', 'strikes', 'stats', 'adult', 'minor', 'banUntil', 'uname', 'repN'];
const rnd = a => a[Math.floor(Math.random() * a.length)];
const FOREVER = 8.64e15;

function createEngine(io, opts) {
  opts = opts || {};
  const users = new Map(), guilds = new Map(), queue = new Map(), pairs = new Map(), seen = new Map(), lastMsg = new Map();
  const reports = [], appeals = [], archive = new Map();
  let repSeq = 1042, tickN = 0;
  const safe = async (fn, ...a) => { try { return await fn(...a); } catch (e) { if (opts.onError) opts.onError(e); } };

  /* ---------- persistence ---------- */
  function load() {
    if (!opts.file || !fs.existsSync(opts.file)) return;
    try {
      const d = JSON.parse(fs.readFileSync(opts.file, 'utf8'));
      for (const [id, s] of Object.entries(d.users || {})) users.set(id, C.newUser(Object.assign({ id }, s)));
      for (const [id, g] of Object.entries(d.guilds || {})) guilds.set(id, g);
      repSeq = d.repSeq || repSeq;
    } catch (e) { if (opts.onError) opts.onError(e); }
  }
  let dirty = false;
  function save(force) {
    if (!opts.file || (!dirty && !force)) return;
    const u = {};
    for (const [id, S] of users) { u[id] = {}; for (const k of SAVE) u[id][k] = S[k]; }
    try { fs.writeFileSync(opts.file + '.tmp', JSON.stringify({ users: u, guilds: Object.fromEntries(guilds), repSeq })); fs.renameSync(opts.file + '.tmp', opts.file); dirty = false; }
    catch (e) { if (opts.onError) opts.onError(e); }
  }

  /* ---------- users ---------- */
  function getUser(uid, uname) {
    let S = users.get(uid);
    if (!S) {
      S = C.newUser({ id: uid, alias: 'Guest' + (1000 + Math.floor(Math.random() * 9000)), avatar: rnd(C.AVATARS), interests: [], xp: 0, streak: 0, lastDaily: 0, stats: { chats: 0, good: 0, nearby: 0, games: 0 } });
      users.set(uid, S);
    }
    if (uname) S.uname = uname;
    seen.set(uid, Date.now());
    return S;
  }
  const guild = gid => { if (!guilds.has(gid)) guilds.set(gid, { on: true, vo: false, safe: true, channel: null }); return guilds.get(gid); };
  const agoStr = ms => { const m = Math.round(ms / 60000); return m < 60 ? Math.max(1, m) + 'm' : Math.round(m / 60) + 'h'; };
  function env(uid) {
    return {
      now: () => Date.now(), day: () => C.today(), verifyOff: !opts.demoVerify,
      online: r => { let n = 0; const cut = Date.now() - 10 * 60000; for (const [id, t] of seen) if (t > cut) { const S = users.get(id); if (S && S.adult && (!r || S.region === r)) n++; } return n; },
      get reports() { reports.forEach(r => { r.ago = agoStr(Date.now() - r.at); }); return reports; },
      lb: () => [...users.entries()].filter(([id, S]) => id !== uid && S.adult && S.xp > 0).sort((a, b) => b[1].xp - a[1].xp).slice(0, 5).map(([, S]) => [S.alias, S.xp]),
    };
  }
  const view = (uid, S) => C.view(S, env(uid));
  const banText = S => S.banUntil > Date.now() ? (S.banUntil >= FOREVER ? 'You are banned from Stranger chat.' : 'You are banned until <t:' + Math.floor(S.banUntil / 1000) + ':f>.') + ' You can still use **/appeal**.' : '';

  /* ---------- pairs ---------- */
  function endPair(uid, why, notify) {
    const p = pairs.get(uid); if (!p) return null;
    pairs.delete(uid); pairs.delete(p.pid);
    const SP = users.get(p.pid);
    if (SP && notify !== false) { C.partnerLeft(SP, env(p.pid)); safe(io.refresh, p.pid); }
    return p;
  }
  function makePair(a, b) {
    const A = users.get(a), B = users.get(b);
    queue.delete(a); queue.delete(b);
    const ta = String(1000 + Math.floor(Math.random() * 9000)), tb = String(1000 + Math.floor(Math.random() * 9000));
    const shared = A.interests.filter(i => B.interests.includes(i));
    const info = (X, id, tag) => ({ id, tag, verified: X.vlevel >= 2, showBadge: X.showBadge, region: X.showRegion ? X.region : null, shared, mood: X.mood, uname: X.uname });
    const log = [];
    C.matched(A, info(B, b, tb), env(a)); C.matched(B, info(A, a, ta), env(b));
    pairs.set(a, { pid: b, log }); pairs.set(b, { pid: a, log });
    for (const [id, S] of [[a, A], [b, B]]) { safe(io.refresh, id); if (S.notif.match) safe(io.ping, id, '🟢 **Matched!** Say hi. Your messages in this chat go to your partner.'); }
  }
  function sweep() {
    const now = Date.now(); tickN++;
    for (const a of [...queue.keys()]) {
      if (!queue.has(a)) continue;
      const A = users.get(a), wa = now - queue.get(a).since;
      let best = null, bs = -1;
      for (const b of queue.keys()) {
        if (b === a) continue;
        const B = users.get(b); if (!B.discoverable) continue;
        const s = C.score(A, B, Math.max(wa, now - queue.get(b).since));
        if (s > bs) { bs = s; best = b; }
      }
      if (best) makePair(a, best);
    }
    for (const [uid, q] of [...queue]) {
      const S = users.get(uid);
      if (now - q.since > 120000) { queue.delete(uid); S.searching = null; S.screen = 'home'; safe(io.refresh, uid); safe(io.dm, uid, '😕 No match yet. Try **Anyone** mode or fewer filters, then press Find someone again.'); }
      else if (tickN % 3 === 0 && S.screen === 'searching') safe(io.refresh, uid);
    }
  }

  /* ---------- side effects from core.dispatch ---------- */
  function notify(text) { return safe(io.staff, text); }
  function applyFx(uid, S, fx, first) {
    const e = env(uid), pair = pairs.get(uid), pid = pair && pair.pid, SP = pid && users.get(pid);
    for (const f of fx || []) {
      switch (f.t) {
        case 'queue': case 'requeue': queue.set(uid, { since: S.searching ? S.searching.since : Date.now() }); setImmediate(sweep); break;
        case 'unqueue': queue.delete(uid); break;
        case 'end': endPair(uid, f.why); break;
        case 'ice': for (const t of [uid, pid]) if (t) safe(io.dm, t, '💡 **Icebreaker:** ' + f.text); break;
        case 'reveal_req': if (SP) { C.partnerReveal(SP, 'req'); SP.screen = 'chat'; safe(io.refresh, pid); if (SP.notif.reveal) safe(io.ping, pid, '🔓 Your partner wants to swap usernames. Check your panel.'); } break;
        case 'reveal_ans': if (SP) { if (f.yes) { C.partnerReveal(SP, 'yes', S.uname); if (S.chat) S.chat.uname = SP.uname; } else C.partnerReveal(SP, 'no'); safe(io.refresh, pid); } break;
        case 'game_invite': if (SP) { C.partnerGame(SP, 'invite', f.g, e); if (SP.game && SP.game.state === 'incoming') { SP.screen = 'chat'; if (SP.notif.game) safe(io.ping, pid, '🎮 Your partner invited you to a game. Check your panel.'); } safe(io.refresh, pid); } break;
        case 'game_yes': if (SP) { C.partnerGame(SP, 'yes', { q: f.q }, e); safe(io.refresh, pid); } break;
        case 'game_no': if (SP) { C.partnerGame(SP, 'no'); safe(io.refresh, pid); } break;
        case 'game_ans': if (SP) { C.partnerGame(SP, 'ans', f.v, e); safe(io.refresh, pid); } break;
        case 'game_next': if (SP) { C.partnerGame(SP, 'next', { q: f.q }, e); safe(io.refresh, pid); } break;
        case 'game_close': if (SP) { C.partnerGame(SP, 'close'); safe(io.refresh, pid); } break;
        case 'panic': case 'report': {
          const log = pair ? pair.log.slice(-20) : [];
          const r = { id: f.no || ++repSeq, reason: f.reason || 'Panic exit', details: f.details || '', n: log.length, by: 'Stranger #' + String(uid).slice(-4), reporter: uid, target: pid || f.pid, log, at: Date.now() };
          if (f.t === 'panic') r.id = ++repSeq; else repSeq = Math.max(repSeq, r.id);
          reports.push(r); archive.set(r.id, r);
          notify(`🚩 New report #${r.id}: ${r.reason}${f.t === 'panic' ? ' (panic exit)' : ''}. ${r.n} messages saved.`);
          if (f.t === 'panic') endPair(uid, 'panic');
          break;
        }
        case 'appeal': appeals.push({ uid, reason: f.reason, at: Date.now() }); notify(`📝 New appeal from user ${uid}: ${f.reason.slice(0, 200)}`); break;
        case 'mod': {
          const r = first && first.id === f.rep ? first : archive.get(f.rep), T = r && users.get(r.target);
          if (T) {
            if (f.act === 'warn') { T.strikes++; safe(io.dm, r.target, '⚠️ **Warning:** a report about your behavior was upheld. Strikes: ' + T.strikes + '/4. You can appeal with /appeal.'); }
            if (f.act === 'ban24' || f.act === 'ban') { T.banUntil = f.act === 'ban' ? FOREVER : Date.now() + 864e5; queue.delete(r.target); T.searching = null; endPair(r.target, 'ban'); safe(io.dm, r.target, '⛔ **You were banned.** ' + banText(T)); }
          }
          notify(`🛡️ Report #${f.rep}: ${f.act} by a moderator.`); break;
        }
        case 'setup': { /* channel is stored by bot.js (needs guild id) */ break; }
      }
    }
    dirty = true;
  }

  /* ---------- public API ---------- */
  function ctxSetup(uid, ctx) {
    const S = getUser(uid, ctx.uname); S.role = ctx.role || 'User';
    if (ctx.guildId) S.sv = guild(ctx.guildId);
    return S;
  }
  function act(uid, id, val, ctx) {
    ctx = ctx || {}; const S = ctxSetup(uid, ctx);
    if (S.banUntil > Date.now() && !/^(ap:|modal:appeal|nav:(safety|home|help))/.test(id)) return { fx: [], pop: { c: 'red', t: 'You are banned', b: banText(S) }, S, blocked: true };
    if (!opts.demoVerify && (id === 'modal:vcode' || id === 'ver:selfie')) return { fx: [], S, pop: { c: 'amber', t: 'Not available yet', b: 'Phone and selfie verification needs a verification provider, and this bot has none connected. Age confirmation still works.' } };
    const first = reports[0];
    const R = C.dispatch(S, id, val, env(uid));
    applyFx(uid, S, R.fx, first); R.S = S; return R;
  }
  function cmd(uid, key, opts_, ctx) {
    ctx = ctx || {}; const S = ctxSetup(uid, ctx);
    if (S.banUntil > Date.now() && key !== 'appeal' && key !== 'help' && key !== 'safety') return { fx: [], pop: { c: 'red', t: 'You are banned', b: banText(S) }, S, blocked: true };
    if (!opts.demoVerify && key === 'verify code') return { fx: [], S, pop: { c: 'amber', t: 'Not available yet', b: 'Phone verification needs a verification provider, and this bot has none connected.' } };
    const first = reports[0];
    const R = C.runCmd(S, key, opts_, env(uid));
    applyFx(uid, S, R.fx, first);
    if (key === 'server setup' && ctx.guildId && opts_.channel) { guild(ctx.guildId).channel = opts_.channel; dirty = true; }
    R.S = S; return R;
  }
  function relay(uid, text) {
    const pair = pairs.get(uid); if (!pair) return { ok: false, why: 'none' };
    const now = Date.now(); if (now - (lastMsg.get(uid) || 0) < 600) return { ok: false, why: 'slow' };
    lastMsg.set(uid, now);
    const S = users.get(uid), SP = users.get(pair.pid);
    const cl = C.clean(text); if (!cl.text.trim()) return { ok: false, why: 'empty' };
    pair.log.push({ from: uid, t: cl.text, at: now }); if (pair.log.length > 20) pair.log.shift();
    C.received(S); C.received(SP); seen.set(uid, now);
    safe(io.dm, pair.pid, `**Stranger ${SP.chat ? SP.chat.tag : ''}:** ${cl.text}`);
    return { ok: true, removed: cl.removed };
  }
  const inChat = uid => pairs.has(uid);
  return { load, save, getUser, view, env, act, cmd, relay, sweep, inChat, banText, guild, users, queue, pairs, reports, appeals, banned: S => S.banUntil > Date.now() };
}
module.exports = { createEngine };
