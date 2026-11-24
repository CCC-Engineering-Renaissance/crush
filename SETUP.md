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
3. Go to **Admin**. Click **Add starter content** to create the four subteams, the clock-in
   activities and the spaces (Club HQ, Crush Depth, Mechanical, Electrical & Software, Business, Media).
   Rename or remove any of them later.
4. **Admin → Settings:** set the term name, start and end dates, the hour goals, and the longest
   session allowed before a lead has to approve it (10 hours by default).
5. **Admin → Invites:** paste the officers' emails with the **Lead** role. Invited people skip
   approval the first time they sign in. Everyone else signs in, fills out the join form, and an admin
   approves them under **Admin → Members**.

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

---

## How the portal keeps things secure

- **Only approved members see anything.** A new Google account can only ask to join. Until an admin
  approves it, it sees its own request and nothing else.
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
- **Rules tests:** `cd firebase && npm install && npm test` (needs Java 11+ for the Firestore
  emulator). Run them after any change to `firestore.rules`.
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
