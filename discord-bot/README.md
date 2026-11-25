# Discord announcements bot

Copies Discord posts that mention the portal bot into the member portal's announcements, for the
subteams whose roles the post mentions, or for everyone. It runs as a Google Apps Script under the club
Google account, checking Discord once a minute.

- `Code.gs`: the whole bot. Paste it into the Apps Script project.
- `appsscript.json`: the project's manifest (time zone, runtime and permissions).
- `bot.test.mjs`: tests against a pretend Discord server and database. Run them with
  `node --test discord-bot/bot.test.mjs`.

Setup is in `SETUP.md`, step 8.
