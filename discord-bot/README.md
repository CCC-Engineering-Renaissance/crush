# Discord bot

Copies Discord posts that mention the portal bot into the member portal's announcements, for the
subteams whose roles the post mentions, or for everyone. It also DMs members when someone assigns them a
task in the portal, and when they've been clocked in longer than the portal's session limit. It runs as a
Google Apps Script under the club Google account, checking Discord once a minute and the portal every
five minutes.

- `Code.gs`: the whole bot. Paste it into the Apps Script project.
- `appsscript.json`: the project's manifest (time zone, runtime and permissions).
- `bot.test.mjs`: tests against a pretend Discord server and database. Run them with
  `node --test discord-bot/bot.test.mjs`.

Setup is in `SETUP.md`, step 8.
