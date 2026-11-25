# Member portal setup

The member portal lives at **engineeringrenaissance.org/portal**. It's part of this repository and
GitHub Pages hosts it like the rest of the site. Google sign-in and the database run on
**Firebase**, Google's free backend for websites.

Setup takes about 30 minutes and happens once. Do it while signed in to the **club Google account**
(cccengineeringrenaissance@gmail.com), not a personal one. That way the portal stays with the club
when officers graduate.

Until step 2 is done, /portal shows a "opens soon" page and a demo with sample data.

---

## What you'll end up with

| Piece | Where it lives | Cost |
|---|---|---|
| Website and portal code | This GitHub repository (GitHub Pages) | Free |
| Google sign-in | Firebase Authentication | Free |
| Hours, pages, tasks, events, members | Cloud Firestore (Spark plan) | Free: 50,000 reads and 20,000 writes a day, 1 GiB stored. A club of ~100 uses a small slice of that. No credit card needed. |
| Files | Your existing Google Drive | Free |
| Discord announcements bot (optional) | Google Apps Script, under the club Google account | Free |

---

## 1. Create the Firebase project

1. Go to **console.firebase.google.com** and click **Create a project**.
2. Name it something like `er-portal`. Turn **Google Analytics off** (the portal doesn't use it).
3. Stay on the free **Spark** plan.

## 2. Add a web app and paste its settings into `portal/config.js`

1. In the project, open **Project settings** (gear icon) → **General** → **Your apps** → the **`</>`** (Web) button.
2. Nickname: `ER portal`. Leave **Firebase Hosting unchecked** (GitHub Pages hosts the site). Click **Register app**.
3. Firebase shows a `firebaseConfig` block. Copy these five values into the `firebase` section of
   **`portal/config.js`**:

   ```js
   firebase: {
     apiKey: 'AIza…',
     authDomain: 'er-portal.firebaseapp.com',
     projectId: 'er-portal',
     appId: '1:…:web:…',
     messagingSenderId: '…',
   },
   ```

   These values are **not secrets**. Every Firebase website ships them to the browser. The data is
   protected by the security rules in step 4.

## 3. Turn on Google sign-in

1. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
   Set the support email to the club account and **Save**.
2. **Authentication → Settings → Authorized domains → Add domain:** `engineeringrenaissance.org`.
   (`localhost` is already there for testing on your own computer.)
3. Name the sign-in screen. Open **console.cloud.google.com** with the same project selected, then
   **Google Auth Platform** (older consoles call it **OAuth consent screen**):
   - **Branding:** App name `Engineering Renaissance Portal`, support email, and add
     `engineeringrenaissance.org` under **Authorized domains**. Skip the logo: uploading one
     triggers a Google review.
   - **Audience:** User type **External**. Under **Publishing status**, click **Publish app** so
     it says **In production**. If it stays in "Testing", only listed test users can sign in.

## 4. Create the database and lock it down

1. **Build → Firestore Database → Create database.**
   - Edition: **Standard**.
   - Location: **`us-west2` (Los Angeles)**, the closest to Fresno. *This can't be changed later.*
   - Start in **production mode**.
2. Open the **Rules** tab, delete what's there, paste the whole contents of
   **`firebase/firestore.rules`** from this repository, and click **Publish**.
3. Open the **Indexes** tab → **Composite** → **Create index**:
   - Collection ID: `timeEntries`
   - Fields: `uid` **Ascending**, then `start` **Ascending**
   - Query scope: **Collection**

   It takes a few minutes to build. (If you skip this, the first person to open **My time** sees an
   error in the browser console with a link that creates the same index in one click.)

## 5. Make yourself the first admin

Nobody can get admin rights from the website itself, so the first admin is set in the console:

1. **Firestore Database → Data → + Start collection.**
2. Collection ID: `invites`.
3. Document ID: **the Google account email you'll sign in with, all lowercase**, for example
   `santino.gonzales@gmail.com`.
4. Add four fields:

   | Field | Type | Value |
   |---|---|---|
   | `email` | string | the same email, lowercase |
   | `role` | string | `admin` |
   | `title` | string | `Treasurer` (or your title) |
   | `subteams` | array | leave empty |

5. Save. Add a second admin the same way now, so the club never gets locked out.

## 6. Publish the files and sign in

1. Upload the new and changed files to this repository (drag the folders onto **Add file → Upload
   files** on GitHub) and commit to `main`. GitHub Pages republishes in a minute or two.
2. Open **engineeringrenaissance.org/portal** and click **Sign in with Google** with the email from
   step 5. You land in the portal as an admin.
3. Go to **Admin**. Click **Add starter content**. It creates Crush Depth and Prosthetic as
   subsidiaries, with a subteam and a space for each of Crush Depth's Discord channels
   (mate-club-mgmt and tech-leads start out private), a club-wide club-hq space, and the clock-in
   activities. Prosthetic's three subteams (electrical, mechanical, signal-processing) are a guess,
   so rename them to match its channels. Change any of it later under **Admin → Subsidiaries and
   subteams** and **Admin → Spaces**.
   If you tried the portal before this version and added starter content then, delete the
   `subteams`, `activities`, `spaces`, `pages` and `tasks` collections in **Firestore → Data** first,
   so the new set starts clean.
4. **Admin → Settings:** set the term name, start and end dates, the hour goals, and the longest
   session allowed before a lead has to approve it (10 hours by default).
5. **Admin → Invites:** paste the officers' emails with the **Lead** role. Invited people skip
   approval the first time they sign in. Everyone else signs in, fills out the join form, and an admin
   approves them under **Admin → Members**.
6. **Private spaces.** A private space (lock icon in the sidebar) opens only for admins and the people
   you add. Add people from the space (**Who can open it**, which can add a whole subteam at once) or
   from the person (**Admin → Members → Manage → Private spaces they can open**). When you approve
   someone, the private spaces tied to the subteams they picked are already ticked.
7. **Space icons.** Each starter space comes with an emoji. Leads change one by clicking the big icon
   at the top of the space (or in its settings): pick an emoji, type any emoji, upload a picture, or
   go back to a plain #. Pictures are cropped to a small square and saved in the space itself, so
   you don't need Firebase Storage. Logos and simple pictures read best at sidebar size.

The public site's **Get Involved** buttons and the **Member portal** link in the menu now lead here.

## 7. Connect Google Drive (recommended)

This lets people attach Drive files to pages with Google's own file picker, link a Drive folder to
each space, and export reports straight to Google Sheets. Without it, people can still paste Drive
links into pages.

The portal asks only for Drive's narrowest permission (`drive.file`): it can open the files someone
picks and the spreadsheets it creates, nothing else in anyone's Drive. Google classifies it as
non-sensitive, so no app review is needed.

In **console.cloud.google.com** (same project):

1. **APIs & Services → Library:** enable **Google Picker API** and **Google Drive API**.
2. **Google Auth Platform → Data Access → Add or remove scopes:** add
   `https://www.googleapis.com/auth/drive.file` and **Save**.
3. **APIs & Services → Credentials → OAuth 2.0 Client IDs → "Web client (auto created by Google
   Service)":** under **Authorized JavaScript origins** add `https://engineeringrenaissance.org`
   and **Save**. Copy the **Client ID**.
4. **Credentials → + Create credentials → API key.** Edit the new key:
   - **Application restrictions → Websites:** `https://engineeringrenaissance.org/*` **and**
     `https://docs.google.com/*` (the picker fails without the second one).
   - **API restrictions → Restrict key:** Google Picker API and Google Drive API.
5. Find the **project number** under **IAM & Admin → Settings** (also shown in Firebase project
   settings).
6. Fill in the `google` section of `portal/config.js` and upload it again:

   ```js
   google: {
     oauthClientId: '1234567890-abc….apps.googleusercontent.com',
     pickerApiKey: 'AIza…',
     projectNumber: '1234567890',
   },
   ```

Files still follow Drive's own sharing. Keep team files in a shared Drive folder that club members can
open, or the preview inside a page will ask them to request access.

## 8. Post announcements from Discord (optional)

Leads already announce things in Discord. With the portal bot in the server, a Discord post that
mentions the bot is copied into the portal's **Announcements** too, so nobody posts twice:

- `@ER Portal @Chassis Pool test moved to 10 AM` is posted for the Chassis subteam.
- `@ER Portal @MATE Registration is due Friday` is posted for every Crush Depth subteam, once the MATE
  role is linked to the Crush Depth subsidiary (step 8c).
- `@ER Portal @everyone …`, or a post with no role, is for everyone.

New posts appear within a minute. Editing the Discord post updates the announcement, and deleting it
(or editing out the bot's mention) takes it down, within 10 minutes. The bot reacts ✅ when a post is
on the portal, 🚫 when the person isn't allowed to post, and replies when a role isn't linked to a
subteam yet. Only officers can post this way: people whose Discord roles can @everyone, manage messages
or manage the server.

In the portal, leads can pin a Discord post or hide it from members; edits happen in Discord.

The bot is a Google Apps Script that runs under the club Google account every minute. There's no
server to keep running and it's free.

### 8a. Create the bot in Discord

1. Go to **discord.com/developers/applications → New Application** and name it `ER Portal`. That's
   the name people will @.
2. **Bot:** click **Reset Token** and copy the token. Treat it like a password: anyone with it can act as
   the bot. Turn off **Public Bot**. Under **Privileged Gateway Intents**, turn on **Message Content
   Intent**, so the bot can read posts that mention its role as well as the bot itself.
3. **OAuth2 → URL Generator:** tick `bot`, then under **Bot Permissions** tick **View Channels**,
   **Read Message History**, **Add Reactions** and **Send Messages**. Open the URL it makes and add
   the bot to the club's server.
4. Your MATE channels are private, so let the bot into them: right-click the category →
   **Edit Category → Permissions → Add members or roles → ER Portal**, allow **View Channel** and
   **Read Message History**, and sync the channels. The bot only sees channels it's allowed into.

### 8b. Set up the script (club Google account)

1. Open **script.google.com → New project** and name it `ER portal Discord bot`.
2. Replace everything in **Code.gs** with `discord-bot/Code.gs` from this repository.
3. **Project Settings** (gear icon) → tick **Show "appsscript.json" manifest file in editor**. Open
   `appsscript.json` in the editor and replace it with `discord-bot/appsscript.json`.
4. **Project Settings → Script properties → Add script property:**
   - `DISCORD_BOT_TOKEN`: the token from 8a.
   - `FIREBASE_PROJECT_ID`: the Project ID from **Firebase → Project settings**, like `er-portal-19d4a`.
5. In the editor, pick **setup** in the function menu and click **Run**. Google asks you to allow it:
   choose the club account → **Advanced → Go to ER portal Discord bot (unsafe) → Allow**. It says
   "unsafe" only because it's your own script that Google hasn't reviewed. The log lists the channels
   the bot watches and which Discord roles go with which subteams.

If the log says the Firestore API isn't turned on for this script's project, open **Project Settings
→ Google Cloud Platform (GCP) Project → Change project**, enter the **Project number** from
**Firebase → Project settings**, click **Set project**, and run **setup** again. If it says the account
can't reach the database, run the script as the Google account that owns the Firebase project.

### 8c. Link Discord roles to subteams

In the portal, open **Admin → Subsidiaries and subteams** and fill in each subteam's **Discord role**
with the role's name (like `Chassis`) or its ID. You can skip a subteam whose name matches a role
exactly, unless two subteams share the name: Crush Depth and Prosthetic both have an Electrical, so
link each to its own role. Fill in a subsidiary's **Discord role** (like `MATE`) to post for all its
subteams at once. Run **checkSetup** in the script editor any time to see the current links.

Optional script properties:

| Property | What it does |
|---|---|
| `DISCORD_CHANNELS` | Only watch these channels (names or IDs, separated by commas). |
| `POSTER_ROLES` | Only these roles (and server admins) can post through the bot. |
| `DISCORD_GUILD_ID` | Which server to use, if the bot is in more than one. |

To turn the bot off, run **stop** in the script editor. Good to know:

- Every member can read every announcement. The @role decides who it's for and powers the **Only for
  my subteams** filter; it doesn't hide the post from anyone.
- Images and files stay in Discord. The announcement says how many there are and links to the post.
- Posts in threads and forum channels aren't picked up. Post in a regular channel.
- Posts from before you ran setup aren't copied.

---

## How the portal keeps things secure

- **Only approved members see anything.** A new Google account can only ask to join. Until an admin
  approves it, it sees its own request and nothing else.
- **Private spaces stay private.** The rules check every page, task and page list against the people
  an admin added, and nobody can add themselves. Signed-in members can see a private space's name
  and description, but not its pages, tasks or Drive folder.
- **The Discord bot holds no keys to the database.** It runs as the club Google account, which already
  owns the Firebase project, and its Discord token lives in the script's properties, which only that
  account can see. It only acts on posts from officers.
- **The rules run on Google's servers.** The website's code is public, so every permission lives in
  `firebase/firestore.rules`, which Firestore checks on every read and write. Changing the website's
  JavaScript can't get around it.
- **Hours can't be backdated.** Clock-in and clock-out use Google's server clock, not the phone's.
  A forgotten clock-out becomes a fix request that a lead approves. Leads can't approve their own.
- **Every lead and admin change is logged.** Approvals, edits to hours, role changes, settings and
  deletions go to **Admin → Audit log**, which nobody can edit or delete from the portal.
- **No passwords.** People sign in with Google, so Google's protections (including 2-step
  verification) apply.
- **Injected scripts are blocked.** The portal page has a Content Security Policy that only allows
  code from this site and Google's sign-in, database and Drive services. Text members write is
  sanitized before it's shown.
- **Optional location check.** Admin → Settings can check that people are at the lab when they
  clock in. Only "at the lab / away" is saved, never the location. It's a nudge, not proof: a
  determined person can fake their location.

## Hardening (optional, do after everything works)

- **Restrict the Firebase API key.** Credentials → **Browser key (auto created by Firebase)** →
  Websites: `https://engineeringrenaissance.org/*` and `https://YOUR-PROJECT.firebaseapp.com/*`
  (sign-in breaks without the second one). Then sign in again to confirm it still works.
- **App Check** blocks scripts that aren't running on your site from using the database. Firebase
  console → **App Check** → register the web app with **reCAPTCHA Enterprise**, put the site key in
  `appCheckSiteKey` in `portal/config.js`, upload, wait a few days to confirm the metrics show
  verified requests, then click **Enforce** for Cloud Firestore.
- **Keep at least two admins**, and mark people who leave as **Inactive** instead of deleting them so
  their hours stay attached to a name.
- **Back up each term.** Reports → Export → **Every session as CSV** (or to Google Sheets) at the end
  of every term, and keep the file in the club Drive.

## Each term

1. **Admin → Settings:** new term name, dates and goals.
2. **Admin → Members:** mark graduated members **Inactive**.
3. Export last term's hours (above).

## Troubleshooting

| What you see | Fix |
|---|---|
| "This web address isn't on the Firebase authorized domains list" | Step 3.2. |
| Sign-in window flashes and closes, or "Your browser blocked the Google sign-in window" | Allow pop-ups for engineeringrenaissance.org. On iPhone, open the portal in Safari rather than inside another app. |
| Only some people can sign in | The Google Auth Platform publishing status is still "Testing" (step 3.3). |
| "A database index is still being set up" | Step 4.3, then wait a few minutes. |
| "You don't have permission to do that" | The rules in step 4.2 weren't published, or the person's role doesn't allow it. |
| Drive picker says "API developer key is invalid" | Add `https://docs.google.com/*` to the picker key's website list (step 7.4). |
| A Google feature stops loading | Open the browser console. A "Content Security Policy" message names the blocked address; add it to the matching line at the top of `portal/index.html`. |
| A Discord post that mentions the bot gets no ✅ | Check that the bot can see that channel (step 8a.4) and that the post mentions the bot itself, not just its name in text. The script's **Executions** page at script.google.com shows each run and any error. |
| The bot replied that a role isn't linked | Link the role to a subteam (step 8c), then edit the Discord post. It goes up within 10 minutes. |
| Everything says "Quota exceeded" | Over the free daily limit; it resets at midnight Pacific time. If it happens often, upgrade the Firebase project to the Blaze plan, where the same usage costs cents. |

## For developers

- **No build step.** The portal is plain ES modules (`portal/js`), styled by `portal/app.css`.
  Edit, commit, and GitHub Pages serves it.
- **Try it locally:** from the repository root run `python3 -m http.server 8000` and open
  `http://localhost:8000/portal/?demo` for the demo, or fill in `config.js` to use Firebase
  (`localhost` is an authorized domain by default).
- **Libraries** (Firebase, Preact + htm, DOMPurify, Editor.js) and fonts are bundled into
  `portal/vendor` and `portal/assets/fonts` so the site loads nothing from outside CDNs. To upgrade
  one: `cd portal/tools && npm install && npm run vendor`.
- **Rules tests:** `cd firebase && npm install && npm test` (needs Java 21+ for the Firestore
  emulator). Run them after any change to `firestore.rules`. GitHub runs them too, along with the
  Discord bot's tests, whenever `firebase/` or `discord-bot/` changes: see the **Actions** tab
  (`.github/workflows/portal-checks.yml`).
- **Home Screen app:** on phones, `portal/js/views/install.js` offers to add the portal to the Home
  Screen: a one-tap Install button where the browser allows it (Chrome, Edge and Samsung Internet on
  Android), and step-by-step instructions on iPhone and iPad, which don't let websites prompt. "Not
  now" hides it for two weeks; it's always in the menu as **Add to Home Screen**. The app's name,
  icons and colors are in `portal/manifest.webmanifest`.
- **Discord bot:** `discord-bot/Code.gs` is the whole bot. `node --test discord-bot/bot.test.mjs`
  runs it against a pretend Discord server and database. After changing it, paste it into the Apps
  Script project again.
- **Spaces:** `spaces/{id}` holds a space's name, subsidiary and whether it's private; its page list
  and Drive folder are in `spaceContent/{id}` and its tasks in `spaces/{id}/tasks`, so the rules can
  check access by the space id in the path. `users/{uid}.spaces` lists the private spaces someone can
  open. A space's icon is `icon` (an emoji) or `iconImage`, a picture of at most 128 px that
  `portal/js/lib/picture.js` makes in the browser and stores as a data: URL. The rules accept only
  PNG, JPEG or WebP data URLs up to 50,000 characters, so an icon can't be a link to another site.
- **Deploying rules from the command line** instead of pasting them: copy
  `firebase/.firebaserc.example` to `firebase/.firebaserc`, set your project ID, then
  `npx firebase login` and `npm run deploy:rules`.
- Map of the code: `portal/js/data/` (Firebase and demo backends behind one API),
  `portal/js/views/` (one file per screen), `portal/js/lib/` (store, router, dates, UI kit),
  `portal/js/google/drive.js` (picker, previews, Sheets export).
- **ASCII logos:** the bull on the sign-in screens and both logos on the public site are drawn by
  `portal/js/art/engine.js` from class maps of `logo.png` and `crushdepth.png`
  (`portal/js/art/bull-map.js`, `crush-map.js`). If a logo changes, rebuild its map from
  `portal/tools`: `python3 ascii-logo.py ../../logo.png ../js/art/bull-map.js` or
  `python3 ascii-logo.py ../../crushdepth.png ../js/art/crush-map.js --width 200` (needs Pillow).
  Every animation has a pause button, stops when the tab is hidden, and stays still for anyone
  who has reduced motion turned on.
- **Pool water:** the Crush Depth sections use `caustics.png`, a seamless light texture, drifting
  over a blue gradient (`.pool` in `index.html`).
- **Sponsors:** edit `sponsorTiersData` near the bottom of `index.html`; each logo is an image file
  next to it (`sponsor-*.png`). Wordmarks that are white in the original are saved in dark ink so
  they show on the white site.
- **Public site fonts and art:** `index.html` loads its fonts from `portal/assets/fonts` and the
  ASCII art from `portal/js/art`, so keep those folders when moving files around.
