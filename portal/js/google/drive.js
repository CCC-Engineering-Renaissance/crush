// Google Drive: file picker, previews and "Export to Google Sheets".
//
// Uses the drive.file scope only: the portal can see just the files someone picks here and
// the spreadsheets it creates. It never gets access to the rest of anyone's Drive.
import { getState } from '../lib/store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let gisReady, pickerReady;
let token = null, tokenExp = 0;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(Object.assign(new Error('Could not load ' + src), { userMessage: 'Google Drive didn’t load. Check your connection or content blockers, then try again.' }));
    document.head.appendChild(s);
  });
}

const g = () => getState().config?.google || {};
export function driveConfigured() {
  const c = g();
  return getState().api?.mode === 'firebase' && !!(c.oauthClientId && c.pickerApiKey && c.projectNumber);
}

// Load Google's scripts early so the consent pop-up opens straight from the click.
export function preloadDrive() {
  if (!driveConfigured()) return;
  gisReady ||= loadScript('https://accounts.google.com/gsi/client');
  pickerReady ||= loadScript('https://apis.google.com/js/api.js').then(() => new Promise((r) => window.gapi.load('picker', r)));
  gisReady.catch(() => { gisReady = null; });
  pickerReady.catch(() => { pickerReady = null; });
}

async function getToken() {
  if (token && Date.now() < tokenExp - 60e3) return token;
  preloadDrive();
  await gisReady;
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: g().oauthClientId,
      scope: SCOPE,
      login_hint: getState().profile?.email,
      callback: (resp) => {
        if (resp.error) return reject(Object.assign(new Error(resp.error), { userMessage: 'Google Drive access wasn’t granted.' }));
        token = resp.access_token;
        tokenExp = Date.now() + (Number(resp.expires_in) || 3000) * 1000;
        resolve(token);
      },
      error_callback: (err) => reject(Object.assign(new Error(err?.message || 'Drive access cancelled'), {
        userMessage: err?.type === 'popup_failed_to_open' ? 'Your browser blocked the Google pop-up. Allow pop-ups for this site, then try again.' : 'Google Drive access wasn’t granted.',
      })),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export async function pickFromDrive({ folders = false } = {}) {
  const tok = await getToken();
  await pickerReady;
  const P = window.google.picker;
  return new Promise((resolve) => {
    const mine = new P.DocsView(folders ? P.ViewId.FOLDERS : P.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(folders);
    const drives = new P.DocsView(folders ? P.ViewId.FOLDERS : P.ViewId.DOCS).setEnableDrives(true).setIncludeFolders(true).setSelectFolderEnabled(folders);
    new P.PickerBuilder()
      .setDeveloperKey(g().pickerApiKey)
      .setAppId(String(g().projectNumber))
      .setOAuthToken(tok)
      .addView(mine)
      .addView(drives)
      .enableFeature(P.Feature.SUPPORT_DRIVES)
      .setTitle(folders ? 'Choose a Google Drive folder' : 'Attach a file from Google Drive')
      .setCallback((data) => {
        const action = data[P.Response.ACTION];
        if (action === P.Action.PICKED) {
          resolve((data[P.Response.DOCUMENTS] || []).map((d) => ({
            id: d[P.Document.ID], name: d[P.Document.NAME], mimeType: d[P.Document.MIME_TYPE],
            url: d[P.Document.URL], iconUrl: d[P.Document.ICON_URL] || null,
          })));
        } else if (action === P.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}

// Creates a Google Sheet in the signed-in person's Drive from CSV text.
export async function exportToSheets(title, csvText) {
  const tok = await getToken();
  const boundary = 'er-' + Math.random().toString(36).slice(2);
  const meta = { name: title, mimeType: 'application/vnd.google-apps.spreadsheet' };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${boundary}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${csvText}\r\n--${boundary}--`;
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'multipart/related; boundary=' + boundary },
    body,
  });
  if (!res.ok) {
    if (res.status === 401) token = null;
    throw Object.assign(new Error('Drive upload failed: ' + res.status), { userMessage: 'Google Sheets export didn’t work. Check that the Drive API is enabled (SETUP.md, step 5).' });
  }
  return res.json();
}

// ── Links, previews, labels ──
const KINDS = {
  'application/vnd.google-apps.folder': ['Folder', '#5F6B76'],
  'application/vnd.google-apps.document': ['Google Doc', '#3D7BE0'],
  'application/vnd.google-apps.spreadsheet': ['Google Sheet', '#1E8E4E'],
  'application/vnd.google-apps.presentation': ['Google Slides', '#D9A100'],
  'application/vnd.google-apps.form': ['Google Form', '#7248B9'],
  'application/vnd.google-apps.drawing': ['Google Drawing', '#C2410C'],
  'application/pdf': ['PDF', '#C62828'],
};
export function kindOf(mimeType = '') {
  if (KINDS[mimeType]) return KINDS[mimeType];
  if (mimeType.startsWith('image/')) return ['Image', '#8A4B2F'];
  if (mimeType.startsWith('video/')) return ['Video', '#8A2F5B'];
  return ['File', '#5F6B76'];
}

const ID = /^[-\w]{10,}$/;
export function embedUrl(file) {
  if (!file?.id || !ID.test(file.id)) return null;
  const id = encodeURIComponent(file.id);
  switch (file.mimeType) {
    case 'application/vnd.google-apps.folder': return `https://drive.google.com/embeddedfolderview?id=${id}#list`;
    case 'application/vnd.google-apps.document': return `https://docs.google.com/document/d/${id}/preview`;
    case 'application/vnd.google-apps.spreadsheet': return `https://docs.google.com/spreadsheets/d/${id}/preview`;
    case 'application/vnd.google-apps.presentation': return `https://docs.google.com/presentation/d/${id}/preview`;
    case 'application/vnd.google-apps.form': return file.published ? `https://docs.google.com/forms/d/e/${id}/viewform?embedded=true` : null;
    default: return `https://drive.google.com/file/d/${id}/preview`;
  }
}
export function openUrl(file) {
  if (!file?.id || !ID.test(file.id)) return null;
  if (file.url && /^https:\/\/(docs|drive)\.google\.com\//.test(file.url)) return file.url;
  const id = encodeURIComponent(file.id);
  return file.mimeType === 'application/vnd.google-apps.folder' ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/open?id=${id}`;
}

// Turns a pasted Google Docs/Sheets/Slides/Forms/Drive link into a file reference.
export function parseDriveLink(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(docs|drive)\.google\.com$/.test(u.hostname)) return null;
  const path = u.pathname;
  const m = (re) => path.match(re)?.[1];
  let id, mimeType, published = false;
  if ((id = m(/\/document\/d\/([-\w]+)/))) mimeType = 'application/vnd.google-apps.document';
  else if ((id = m(/\/spreadsheets\/d\/([-\w]+)/))) mimeType = 'application/vnd.google-apps.spreadsheet';
  else if ((id = m(/\/presentation\/d\/([-\w]+)/))) mimeType = 'application/vnd.google-apps.presentation';
  else if ((id = m(/\/forms\/d\/e\/([-\w]+)/))) { mimeType = 'application/vnd.google-apps.form'; published = true; }
  else if ((id = m(/\/forms\/d\/([-\w]+)/))) mimeType = 'application/vnd.google-apps.form';
  else if ((id = m(/\/folders\/([-\w]+)/))) mimeType = 'application/vnd.google-apps.folder';
  else if ((id = m(/\/file\/d\/([-\w]+)/))) mimeType = 'application/octet-stream';
  else if (u.searchParams.get('id')) { id = u.searchParams.get('id'); mimeType = 'application/octet-stream'; }
  if (!id || !ID.test(id)) return null;
  return { id, mimeType, published, url: `https://${u.hostname}${path}`, name: kindOf(mimeType)[0], iconUrl: null };
}
