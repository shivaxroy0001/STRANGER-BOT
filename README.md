# Stranger Bot v4

Anonymous 1-to-1 chat in Discord DMs. The menu is a Components V2 panel with buttons, selects and modals.

## How it fits together

| File | What it does |
|---|---|
| `core.js` | Every screen, rule and command. No Discord code. The HTML preview and the bot both use this file, so they match. |
| `engine.js` | Queue, matching, relay, reports, moderation, saving. Talks to Discord only through a small `io` object, so it is testable. |
| `bot.js` | discord.js glue: turns screens into Components V2, routes slash commands, buttons, selects, modals and DMs. |
| `stranger_bot_preview.html` | Clickable preview. Open it in a browser. |

To change a screen, edit it once in `core.js`, then rebuild the preview (it embeds `core.js`).

## Run it

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`.
3. `npm run deploy` registers the slash commands (global, so they work in DMs too).
4. `npm start`
5. Invite the bot with the scopes `bot` and `applications.commands`. No privileged intents are needed.
6. Members must allow DMs from server members once. `/menu` sends their panel to their DMs.

`npm test` runs the core and engine tests.

## Staff

- `/mod queue` needs the Moderate Members permission. `/server settings` and `/server setup` need Manage Server.
- `OWNER_IDS` gives full staff access anywhere. `STAFF_CHANNEL_ID` gets a plain-text alert for each report and appeal.

## Read before going live

- **Verification is not real.** Phone and selfie checks are placeholders. The bot refuses them unless `VERIFY_DEMO=1`. Connect a provider (for example Twilio Verify) before you show a Verified badge.
- **The age gate is a self-declaration.** It is not proof of age.
- **Reports live in memory.** They are lost on restart. Store them in a database, with a retention policy, before relying on them. Chat text is held only for the last 20 messages of a pair.
- **Users are anonymous to each other, not to you.** The bot relays every message. Tell your users that, and handle the logs accordingly.
- **One process only.** The queue and pairs are in memory. For more than one process you need Redis or a database.
- **Nearby is regional.** It uses a region the user picks. It never uses location.
- **Popups in DMs** are normal messages that the bot deletes after about 9 seconds. In servers they are private (ephemeral).
- **Not yet tested against live Discord.** The tests use a stand-in for discord.js that enforces Discord's published limits. Do a real run in a test server first.
