# Server-Only Bot Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify Stranger Bot to handle all UI panels, command responses, and chat relays directly within Discord servers instead of redirecting users to private DMs.

**Architecture:** Replace the DM-forwarding mechanism in `bot.js` with in-guild ephemeral Component V2 responses for menu navigation, and implement server-based private threads for anonymous chat sessions in the designated server channel. Update the `io` interface so state refreshes, notifications, and partner message relays target guild channels/threads rather than user DMs.

**Tech Stack:** Node.js, discord.js (v14.19+), Components V2 (`ContainerBuilder`, `TextDisplayBuilder`, `ActionRowBuilder`, etc.).

**Spec:** Current codebase (`bot.js`, `core.js`, `engine.js`) where `toDM()` is called inside `respond()` and `MessageCreate` ignores all guild messages (`m.guild`).

## Global Constraints

- Must preserve the shared `core.js` and `engine.js` architecture without breaking `stranger_bot_preview.html`.
- All panel responses in server channels must be private/ephemeral to the user to prevent channel clutter and preserve privacy.
- Anonymous chat messages between matched partners must remain isolated and private (utilizing private threads or designated relay channels).
- All existing tests in `test/core.test.js` and `test/engine.test.js` must continue to pass.

## Review Focus

1. **Ephemeral Message Token Expiry:** Discord ephemeral interaction tokens expire after 15 minutes and cannot be edited via `channel.messages.edit()`; asynchronous updates must handle expired tokens gracefully.
2. **Missing Guild Channel Permissions:** Bot attempting to create private threads or send messages in a channel without `CreatePrivateThreads` / `SendMessagesInThreads` permission must provide clear error feedback.
3. **Privileged Message Content Intent:** In guilds, reading text from regular messages requires `GatewayIntentBits.MessageContent` and `GatewayIntentBits.GuildMessages`.
4. **Multiple Guild Contexts:** Users belonging to multiple servers should have their active session pinned to the server where they initiated `/menu` or matching.
5. **Thread Cleanup on Disconnect / Skip:** Private chat threads must be properly archived or deleted when a chat session terminates, skips, or reports.

---

### Task 1: Server-Only Interaction Responses & Menu Routing in `bot.js`

**Files:**
- Modify: `bot.js:80-99`, `bot.js:140-168`
- Test: `test/bot_guild.test.js`

**Interfaces:**
- Consumes: `render(view)` from `bot.js`, `engine.view(uid, S)` from `engine.js`, `C.CMDS` from `core.js`
- Produces: In-guild ephemeral rendering in `respond(i, R)` without any DM redirects (`toDM()`, `dmCard()`, `dmLink()`)

- [ ] **Step 1: Write tests for in-guild `respond()` behavior**

Create `test/bot_guild.test.js` asserting:
1. `respond()` with a guild interaction replies directly with `{ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }`.
2. Button/select interactions in guild execute `i.update(payload)` in-place instead of creating DMs.
3. `buildCommands()` scopes context to `InteractionContextType.Guild`.

```javascript
// test/bot_guild.test.js
const assert = require('node:assert');
const { buildCommands } = require('../bot');

const cmds = buildCommands();
cmds.forEach(cmd => {
  assert.ok(cmd.contexts.includes(0), 'Command must support Guild context');
  assert.strictEqual(cmd.contexts.includes(1), false, 'Command must not allow BotDM context');
});
console.log('GUILD COMMAND CONTEXT TEST PASSED');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/bot_guild.test.js`
Expected: FAIL (DM context is currently included in `buildCommands`).

- [ ] **Step 3: Modify `bot.js` to restrict commands to Guilds and remove DM redirects**

In `bot.js`:
1. In `buildCommands()`: change `setContexts` to only include `[InteractionContextType.Guild]`.
2. In `respond()`: remove `toDM()`, `dmLink()`, `dmCard()`.
3. For all in-guild interactions (`i.inGuild()`):
   - If `i.isMessageComponent()` or `i.isModalSubmit()`, call `await i.update(payload)`.
   - If `i.isChatInputCommand()`, call `await i.reply(Object.assign({}, payload, { flags: V2 | EPH }))`.
   - For popups: follow up ephemerally directly in the guild interaction (`flags: V2 | EPH`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/bot_guild.test.js && npm test`
Expected: PASS

- [ ] **Step 5: Verify slash command deployment**

Run: `npm run deploy`
Expected: Successfully deploy commands scoped for Guild usage.

---

### Task 2: Server-Based Private Threads for Stranger Chat

**Files:**
- Modify: `bot.js:103-135`, `bot.js:208-230`
- Test: `test/engine.test.js`

**Interfaces:**
- Consumes: `engine.relay(uid, content)`, `engine.inChat(uid)`, `engine.getUser(uid)`
- Produces: Guild-based chat relays using ephemeral messages or private Discord threads per participant

- [ ] **Step 1: Write integration test for thread tracking in `io`**

Add test in `test/io_guild.test.js` verifying that when a match occurs (`engine.match`), `io.refresh` and message relays dispatch to guild channels/threads rather than calling `client.users.fetch().send()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/io_guild.test.js`
Expected: FAIL

- [ ] **Step 3: Implement Guild Message Relay & Thread Management in `bot.js`**

1. Enable `GatewayIntentBits.GuildMessages` and `GatewayIntentBits.MessageContent` in `Client` initialization.
2. In `io.refresh(uid)` and `io.dm(uid, text)`:
   - Check if user has an active guild thread/channel mapping in `refs.get(uid)`.
   - If in guild, post/edit within the user's private thread or channel.
3. In `client.on(Events.MessageCreate)`:
   - Allow messages from guild threads associated with active stranger chats.
   - Forward cleaned messages to the partner's corresponding guild thread via `io.dm(pair.pid, ...)`.
4. When a session ends (`C.partnerLeft`, `/chat stop`, `/panic`), archive or delete the temporary private thread.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/io_guild.test.js && npm test`
Expected: PASS

---

### Task 3: Guild Configuration & Channel Verification

**Files:**
- Modify: `bot.js:169-178`, `README.md`
- Test: `npm test`

**Interfaces:**
- Consumes: `engine.guild(guildId)`
- Produces: Enforcement of configured bot channels (`/server setup channel:#channel`)

- [ ] **Step 1: Write test for guild channel validation**

Ensure `guildGate()` blocks commands when executed outside the configured server channel if one is set.

- [ ] **Step 2: Implement strict server channel checks & instructions**

1. Ensure `/menu` prompts server admins to set up a designated channel via `/server setup channel:#chat` if not configured.
2. Update README.md with the required Discord Bot Permissions in server:
   - `Send Messages`
   - `Create Private Threads`
   - `Send Messages in Threads`
   - `Message Content Intent` (enabled in Developer Portal).

- [ ] **Step 3: Run full test suite and restart daemon**

Run: `npm test`
Expected: PASS
Restart bot daemon with updated logic.

