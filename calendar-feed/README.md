# Calendar feed

A Google Apps Script that gives each member their own calendar link. Google Calendar, Apple Calendar
and Outlook subscribe to it, then check it again on their own, so new and changed club events show up
without anyone doing anything.

- Members make their link in the portal: **Calendar → Subscribe**. A link shows club-wide events
  (ones not tied to a subteam) plus the subteams its owner picks, or everything. Changing the picks
  keeps the same link.
- A link stops working when its owner turns it off, or is no longer an active member. Their calendar
  app then shows an empty calendar named "Engineering Renaissance (link turned off)".
- It covers events from the last 60 days onward and caches each feed for 5 minutes.
- Calendar apps decide how often they check. Google Calendar can take up to a day; Apple Calendar
  and Outlook are usually quicker.

Setup is in `SETUP.md`, step 9. Files:

| File | What it is |
|---|---|
| `Code.gs` | The script. `doGet` serves the feed; run `checkSetup` once from the editor. |
| `appsscript.json` | Permissions, and the web app settings (runs as you, anyone with a link can fetch it). |
| `feed.test.mjs` | Tests with a stand-in database: `node --test calendar-feed/feed.test.mjs`. |
