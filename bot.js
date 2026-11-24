'use strict';
/* Stranger Bot, Discord glue (discord.js v14.19+, Components V2).
   Every screen comes from core.js, the same file the HTML preview uses, so the bot looks exactly like the preview.

   Setup
     1. npm install discord.js            (dotenv is optional)
     2. Create .env with:  DISCORD_TOKEN=...  CLIENT_ID=...
        Optional:          STAFF_CHANNEL_ID=...  OWNER_IDS=id1,id2  GUILD_ID=...  (GUILD_ID registers to one server only, no DM commands)
                           VERIFY_DEMO=1  (testing only: accepts any 6-digit phone code and auto-passes the selfie step)
     3. node bot.js deploy      registers the slash commands (global, shows in servers and DMs)
     4. node bot.js             starts the bot
   In the Developer Portal: Bot tab -> no privileged intents are needed (DMs always include message content).
   Invite with scopes: bot + applications.commands. Users must allow DMs from server members once. */
try { require('dotenv').config(); } catch (_) { /* dotenv is optional */ }
const D = require('discord.js');
const {
  Client, GatewayIntentBits, Partials, Events, REST, Routes, SlashCommandBuilder, PermissionFlagsBits,
  InteractionContextType, ApplicationIntegrationType, ChannelType, MessageFlags,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder,
} = D;
const C = require('./core');
const { createEngine } = require('./engine');

const V2 = MessageFlags.IsComponentsV2, EPH = MessageFlags.Ephemeral;
const NONE = { parse: [] };
const OWNERS = new Set((process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

/* ---------- renderer: core view -> Components V2 ---------- */
const STYLE = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
const EMOJI_MAP = { '←': '⬅️', '✖': '❌' };
function mkButton(b) {
  const x = new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(STYLE[b.style] || ButtonStyle.Secondary).setDisabled(!!b.disabled);
  if (b.emoji) {
    const em = EMOJI_MAP[b.emoji] || b.emoji;
    try { x.setEmoji(em); } catch (_) {}
  }
  return x;
}
function mkSelect(b) {
  return new StringSelectMenuBuilder().setCustomId(b.id).setPlaceholder(String(b.ph).slice(0, 150))
    .setMinValues(b.min).setMaxValues(Math.min(b.max, b.opts.length))
    .addOptions(b.opts.map(o => {
      const x = { label: String(o.label).slice(0, 100), value: String(o.value).slice(0, 100), default: !!o.def };
      if (o.desc) x.description = String(o.desc).slice(0, 100);
      if (o.emoji) x.emoji = { name: o.emoji };
      return x;
    }));
}
const txt = s => new TextDisplayBuilder().setContent(String(s).trim() ? String(s).slice(0, 3900) : '​');
function render(view) {
  const c = new ContainerBuilder().setAccentColor(C.COLOR[view.color] || C.COLOR.blue);
  for (const b of view.blocks) {
    if (b.k === 'text') c.addTextDisplayComponents(txt(b.md));
    else if (b.k === 'sep') c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    else if (b.k === 'row') c.addActionRowComponents(new ActionRowBuilder().addComponents(...b.items.map(mkButton)));
    else if (b.k === 'select') c.addActionRowComponents(new ActionRowBuilder().addComponents(mkSelect(b)));
    else if (b.k === 'section') c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(txt(b.md)).setButtonAccessory(mkButton(b.btn)));
  }
  return { components: [c], flags: V2, allowedMentions: NONE };
}
const card = (color, title, body) => ({ components: [new ContainerBuilder().setAccentColor(C.COLOR[color] || C.COLOR.blue).addTextDisplayComponents(txt('### ' + title + '\n' + body))], flags: V2, allowedMentions: NONE });
function modalOf(m) {
  const mod = new ModalBuilder().setCustomId(m.id).setTitle(m.title);
  for (const f of m.fields) {
    const t = new TextInputBuilder().setCustomId(f.id).setLabel(String(f.label).slice(0, 45)).setStyle(f.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(!!f.req);
    if (f.min) t.setMinLength(f.min);
    if (f.max) t.setMaxLength(f.max);
    if (f.val) t.setValue(String(f.val).slice(0, f.max || 4000));
    mod.addComponents(new ActionRowBuilder().addComponents(t));
  }
  return mod;
}

/* ---------- slash command registration (from C.CMDS) ---------- */
function addOpt(b, o) {
  const add = (fn, setup) => b[fn](x => { x.setName(o.n).setDescription(o.d).setRequired(!!o.req); if (setup) setup(x); return x; });
  if (o.t === 'i') return add('addIntegerOption', x => x.setMinValue(0).setMaxValue(999999));
  if (o.t === 'c') return add('addChannelOption', x => x.addChannelTypes(ChannelType.GuildText));
  return add('addStringOption', x => { if (o.ch) x.addChoices(...o.ch.map(v => ({ name: v, value: v }))); });
}
function buildCommands() {
  const groups = {};
  for (const c of C.CMDS) (groups[c.n] = groups[c.n] || []).push(c);
  const byReq = o => (o || []).slice().sort((a, b) => (b.req ? 1 : 0) - (a.req ? 1 : 0));
  return Object.entries(groups).map(([n, list]) => {
    const subs = list.filter(c => c.s), staff = list.some(c => c.p);
    const cmd = new SlashCommandBuilder().setName(n).setDescription(subs.length ? (C.GROUP_DESC[n] || list[0].d) : list[0].d)
      .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
      .setContexts(staff ? [InteractionContextType.Guild] : [InteractionContextType.Guild, InteractionContextType.BotDM]);
    if (list.some(c => c.p === 'Admin')) cmd.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
    else if (list.some(c => c.p === 'Mod')) cmd.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
    if (subs.length) for (const c of subs) cmd.addSubcommand(s => { s.setName(c.s).setDescription(c.d); byReq(c.o).forEach(o => addOpt(s, o)); return s; });
    else byReq(list[0].o).forEach(o => addOpt(cmd, o));
    return cmd.toJSON();
  });
}
async function deploy() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID) : Routes.applicationCommands(process.env.CLIENT_ID);
  const res = await rest.put(route, { body: buildCommands() });
  console.log(`Registered ${res.length} commands ${process.env.GUILD_ID ? 'to one server (no DM support)' : 'globally'}`);
}

/* ---------- bot ---------- */
function start() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], partials: [Partials.Channel, Partials.Message] });
  const refs = new Map();             // userId -> { c: channelId, m: messageId } of the live DM panel
  const hinted = new Map();
  const later = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); };
  const quiet = S => { if (!S.notif.quiet) return false; const h = new Date().getUTCHours(); return h >= 23 || h < 7; };

  const io = {
    async refresh(uid) {
      const S = engine.getUser(uid), payload = render(engine.view(uid, S)), r = refs.get(uid);
      if (r) { try { const ch = await client.channels.fetch(r.c); await ch.messages.edit(r.m, payload); return; } catch (e) { if (![10008, 10003].includes(e.code)) throw e; } }
      const m = await (await client.users.fetch(uid)).send(payload); refs.set(uid, { c: m.channelId, m: m.id });
    },
    async dm(uid, text) { return (await client.users.fetch(uid)).send({ content: String(text).slice(0, 2000), allowedMentions: NONE }); },
    async ping(uid, text) {
      const S = engine.getUser(uid); if (!S.notif.dm || quiet(S)) return;
      const m = await io.dm(uid, text); later(() => m.delete().catch(() => {}), 20000);
    },
    async staff(text) { const id = process.env.STAFF_CHANNEL_ID; if (!id) return; const ch = await client.channels.fetch(id); return ch.send({ content: String(text).slice(0, 2000), allowedMentions: NONE }); },
  };
  const engine = createEngine(io, { file: process.env.DATA_FILE || './data.json', onError: e => console.error('[engine]', e && e.message), demoVerify: process.env.VERIFY_DEMO === '1' });
  engine.load();

  const roleOf = i => {
    if (OWNERS.has(i.user.id)) return 'Admin';
    const p = i.memberPermissions;
    if (i.inGuild() && p) return p.has(PermissionFlagsBits.ManageGuild) ? 'Admin' : p.has(PermissionFlagsBits.ModerateMembers) ? 'Mod' : 'User';
    return 'User';
  };
  const ctxOf = i => ({ uname: i.user.username, role: roleOf(i), guildId: i.guildId || null });
  const isStaff = S => S.screen === 'mod' || S.screen === 'server' || (S.screen === 'confirm' && S.confirm && (S.confirm.back === 'mod' || S.confirm.back === 'server'));

  async function dropPanel(uid) { const r = refs.get(uid); if (!r) return; refs.delete(uid); try { const ch = await client.channels.fetch(r.c); await ch.messages.delete(r.m); } catch (_) { /* already gone */ } }
  async function popup(i, p) {
    const m = await i.followUp(Object.assign(card(p.c, p.t, p.b), i.inGuild() ? { flags: V2 | EPH } : {}));
    later(() => i.deleteReply(m).catch(() => {}), 9000);
  }
  const dmLink = (chId, msgId) => new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open my DMs').setURL(`https://discord.com/channels/@me/${chId}/${msgId}`));
  const dmCard = (chId, msgId) => ({ components: [new ContainerBuilder().setAccentColor(C.COLOR.blue).addTextDisplayComponents(txt('### 📬 Your menu is in your DMs\nEverything happens there so your chat stays private.')).addActionRowComponents(dmLink(chId, msgId))], flags: V2 });

  /* Send the right panel to the right place, then add the popup. */
  async function respond(i, R) {
    const uid = i.user.id, S = R.S;
    if (R.modal) return i.showModal(modalOf(R.modal));
    const payload = render(engine.view(uid, S)), staffView = isStaff(S);
    const toDM = async () => {
      await dropPanel(uid);
      const dm = await i.user.createDM(), m = await dm.send(payload);
      refs.set(uid, { c: dm.id, m: m.id }); return [dm, m];
    };
    try {
      if (i.isMessageComponent() || (i.isModalSubmit() && i.isFromMessage())) {
        if (i.inGuild() && !staffView) { await i.deferUpdate(); const [dm, m] = await toDM(); await i.editReply(dmCard(dm.id, m.id)); }
        else { await i.update(payload); if (!i.inGuild()) refs.set(uid, { c: i.channelId, m: i.message.id }); }
      } else if (i.inGuild()) {
        if (staffView) await i.reply(Object.assign({}, payload, { flags: V2 | EPH }));
        else { await i.deferReply({ flags: EPH }); const [dm, m] = await toDM(); await i.editReply({ content: '📬 Your menu is in your DMs.', components: [dmLink(dm.id, m.id)] }); }
      } else {
        await dropPanel(uid); await i.reply(payload); const m = await i.fetchReply(); refs.set(uid, { c: m.channelId, m: m.id });
      }
    } catch (e) {
      if (e.code === 50007) { const msg = { content: '❌ I can’t DM you. Turn on “Allow direct messages from server members” in this server’s privacy settings, then try again.', flags: EPH }; return i.deferred || i.replied ? i.editReply(msg).catch(() => {}) : i.reply(msg); }
      throw e;
    }
    if (R.pop) await popup(i, R.pop).catch(() => {});
  }

  function guildGate(i, S) {
    if (!i.inGuild()) return '';
    const g = engine.guild(i.guildId), role = roleOf(i);
    if (role !== 'User') return '';
    if (!g.on) return 'Stranger chat is turned off in this server.';
    if (g.vo && S.vlevel < 2) return 'This server only allows verified members. Run **/verify** first.';
    if (g.channel && i.channelId !== g.channel.replace(/\D/g, '')) return `Please use this in <#${g.channel.replace(/\D/g, '')}>.`;
    return '';
  }
  const deny = (i, msg) => (i.deferred || i.replied ? i.editReply({ content: msg }) : i.reply({ content: msg, flags: EPH }));

  client.on(Events.InteractionCreate, async i => {
    try {
      const uid = i.user.id, S = engine.getUser(uid, i.user.username);
      if (i.isChatInputCommand()) {
        const key = [i.commandName, i.options.getSubcommand(false)].filter(Boolean).join(' ');
        const c = C.CMDS.find(x => C.cname(x) === '/' + key), o = {};
        const gm = guildGate(i, S); if (gm) return deny(i, gm);
        for (const op of (c && c.o) || []) {
          const v = op.t === 'i' ? i.options.getInteger(op.n) : op.t === 'c' ? (i.options.getChannel(op.n) ? `<#${i.options.getChannel(op.n).id}>` : null) : i.options.getString(op.n);
          if (v != null) o[op.n] = v;
        }
        return respond(i, engine.cmd(uid, key, o, ctxOf(i)));
      }
      if (i.isStringSelectMenu() || i.isButton()) {
        const gm = guildGate(i, S); if (gm && !/^(ok:)?(nav:(home|safety)|no)$/.test(i.customId)) return deny(i, gm);
        return respond(i, engine.act(uid, i.customId, i.isStringSelectMenu() ? i.values : null, ctxOf(i)));
      }
      if (i.isModalSubmit()) {
        const vals = {}; i.fields.fields.forEach((f, k) => { vals[k] = f.value; });
        return respond(i, engine.act(uid, i.customId, vals, ctxOf(i)));
      }
    } catch (e) {
      console.error('[interaction]', e);
      const msg = { content: 'Something went wrong. Please try again.', flags: EPH };
      if (i.deferred || i.replied) i.followUp(msg).catch(() => {}); else if (i.isRepliable()) i.reply(msg).catch(() => {});
    }
  });

  /* DM relay: whatever a matched user types is cleaned and forwarded. */
  client.on(Events.MessageCreate, async m => {
    try {
      if (m.author.bot || m.guild) return;
      const uid = m.author.id, S = engine.getUser(uid, m.author.username);
      const hint = t => { const n = Date.now(); if (n - (hinted.get(uid) || 0) > 30000) { hinted.set(uid, n); m.reply({ content: t, allowedMentions: NONE }).catch(() => {}); } };
      if (!S.adult) return hint('👋 Use **/menu** to get started.');
      if (engine.banned(S)) return;
      if (!engine.inChat(uid)) return hint('You are not in a chat. Use **/menu** and press **Find someone**.');
      if (m.attachments.size && !m.content) return hint('📎 Files and images are not relayed, to keep everyone safe.');
      const r = engine.relay(uid, m.content);
      if (!r.ok) { if (r.why === 'slow') m.react('⏳').catch(() => {}); return; }
      if (r.removed) m.react('🔗').catch(() => {});
    } catch (e) { console.error('[relay]', e); }
  });

  setInterval(() => { try { engine.sweep(); } catch (e) { console.error('[sweep]', e); } }, 4000).unref();
  setInterval(() => engine.save(), 20000).unref();
  const bye = () => { engine.save(true); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
  client.on(Events.Error, e => console.error('[client error]', e));
  process.on('unhandledRejection', e => console.error('[unhandled rejection]', e));
  client.once(Events.ClientReady, c => console.log(`Logged in as ${c.user.tag}`));
  client.login(process.env.DISCORD_TOKEN);
}

if (require.main === module) {
  if (!process.env.DISCORD_TOKEN) { console.error('Missing DISCORD_TOKEN. See the setup notes at the top of bot.js.'); process.exit(1); }
  if (process.argv[2] === 'deploy') deploy().catch(e => { console.error(e); process.exit(1); }); else start();
}
module.exports = { start, render, card, modalOf, buildCommands, deploy };
