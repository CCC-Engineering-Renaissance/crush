// Root component: picks the backend, then walks a visitor through sign-in, joining and approval.
import { html, useState, useEffect, useRef, Icon, Toasts, ModalHost, toastError, friendlyError, Field, Spinner } from '../lib/ui.js';
import { useStore, setState, getState } from '../lib/store.js';
import { DemoBar, initTheme, SubteamPicker } from './common.js';
import { BullArt } from './bull-art.js';
import { Portal } from './shell.js';

function demoRequested() {
  try { return sessionStorage.getItem('er-demo') === '1' || new URLSearchParams(location.search).has('demo'); } catch { return false; }
}

export function App({ config }) {
  const configured = !!config?.firebase?.apiKey;
  const [mode, setMode] = useState(configured ? 'firebase' : demoRequested() ? 'demo' : null);
  const [bootError, setBootError] = useState(null);
  const { api, authUser, profile } = useStore((s) => ({ api: s.api, authUser: s.authUser, profile: s.profile }));

  useEffect(() => { initTheme(); }, []);

  // Start the chosen backend and listen for sign-in changes.
  useEffect(() => {
    if (!mode) return;
    let unsub;
    (async () => {
      const backend = mode === 'firebase'
        ? (await import('../data/firebase-backend.js')).createFirebaseBackend(config)
        : (await import('../data/demo-backend.js')).createDemoBackend();
      setState({ api: backend, config });
      unsub = backend.onAuth((u) => {
        const prev = getState().authUser;
        // Same person again (token refresh, persona re-select): keep the loaded profile.
        if (u && prev && prev.uid === u.uid) { setState({ authUser: u }); return; }
        setState({ authUser: u, profile: u ? undefined : null, membersCache: null });
      });
    })().catch((e) => { console.error(e); setBootError(e); });
    return () => unsub && unsub();
  }, [mode]);

  // Watch the signed-in person's profile. People an admin invited are let straight in.
  useEffect(() => {
    if (!api || !authUser) return;
    let checkedInvite = false;
    return api.watchUser(authUser.uid, async (p) => {
      if (!p && !checkedInvite) {
        checkedInvite = true;
        const invite = await api.getMyInvite(authUser.email);
        if (invite) {
          try { await api.createMyProfile(authUser, {}, invite); return; } catch (e) { toastError(e); }
        }
      }
      setState({ profile: p || null });
    }, (e) => { setState({ profile: null }); toastError(e, 'Couldn’t load your profile.'); });
  }, [api, authUser?.uid]);

  let screen;
  if (bootError) {
    screen = html`<${Gate} title="The portal didn’t start." lede=${friendlyError(bootError, 'Reload the page. If it keeps happening, tell an officer.')}>
      <div class="gate-actions"><button class="btn btn-primary btn-lg" onClick=${() => location.reload()}>Reload the page</button></div>
    </${Gate}>`;
  }
  else if (!mode) screen = html`<${SetupNotice} onDemo=${() => { try { sessionStorage.setItem('er-demo', '1'); } catch { /* ignore */ } setMode('demo'); }} />`;
  else if (!api || authUser === undefined) screen = html`<${Boot} />`;
  else if (!authUser) screen = html`<${SignIn} />`;
  else if (profile === undefined) screen = html`<${Boot} />`;
  else if (profile === null) screen = html`<${Join} />`;
  else if (profile.status === 'pending') screen = html`<${Pending} />`;
  else if (profile.status !== 'active') screen = html`<${NoAccess} />`;
  else screen = html`<${Portal} />`;

  return html`${mode === 'demo' && !(profile && profile.status === 'active') ? html`<${DemoBar} />` : null}${screen}<${ModalHost} /><${Toasts} />`;
}

function Boot() {
  return html`<div class="boot" aria-label="Loading"><img src="assets/mark.png" alt="" width="56" height="56" /></div>`;
}

const PORTAL_URL = 'https://engineeringrenaissance.org/portal/';
const contactEmail = () => getState().config?.contactEmail || 'cccengineeringrenaissance@gmail.com';

// Every step before the portal: copy on the left, the ASCII bull on the right.
function Gate({ title, lede, small, foot, children }) {
  return html`<main class="gate">
    <header class="gate-top">
      <a class="gate-brand" href="../"><img src="assets/mark.png" alt="" width="32" height="32" /><span><b>Engineering Renaissance</b><small>Member portal</small></span></a>
    </header>
    <div class="gate-hero">
      <section class="gate-copy">
        <h1 class=${small ? 'gate-title small' : 'gate-title'}>${title}</h1>
        ${lede && html`<p class="gate-lede">${lede}</p>`}
        ${children}
      </section>
      <${BullArt} />
    </div>
    ${foot && html`<footer class="gate-foot">${foot}</footer>`}
  </main>`;
}

function EmailOfficers({ primary }) {
  return html`<a class=${primary ? 'btn btn-primary btn-lg' : 'btn btn-lg'} href=${'mailto:' + contactEmail()}>Email the officers</a>`;
}

// The portal's address in a box with a copy button, for passing on to new members.
function ShareLink() {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef(null);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(PORTAL_URL);
      setCopied(true);
    } catch {
      // Some embedded browsers block the clipboard: select the address so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(codeRef.current);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };
  return html`<div class="gate-share">
    <code ref=${codeRef}>engineeringrenaissance.org/portal</code>
    <button type="button" onClick=${copy}>${copied ? html`<${Icon} name="check" size=${15} />Copied` : 'Copy link'}</button>
    <span class="sr-only" role="status">${copied ? 'Link copied' : ''}</span>
  </div>`;
}

function SetupNotice({ onDemo }) {
  return html`<${Gate} title="The portal opens soon."
    lede="Officers are connecting it to the club’s Google account. Until then, you can try every screen with sample data. Nothing you do in the demo leaves this browser.">
    <div class="gate-actions">
      <button class="btn btn-primary btn-lg" onClick=${onDemo}>Try the demo</button>
      <${EmailOfficers} />
    </div>
    <p class="gate-note">Officers: SETUP.md in the website’s repository walks through connecting it. It takes about 30 minutes, once.</p>
  </${Gate}>`;
}

function SignIn() {
  const api = useStore((s) => s.api);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await api.signIn(); } catch (e) { setError(friendlyError(e, 'Sign-in didn’t finish. Try again.')); } finally { setBusy(false); }
  };
  return html`<${Gate} title="Your lab hours, docs and tasks."
    lede="The member portal for Engineering Renaissance and the Crush Depth ROV team at Clovis Community College. Clock in from your phone, find the team’s Drive docs and pick up tasks."
    foot=${html`Signing in shares your name, email address and Google profile photo with the portal. It never sees your password. Questions? Email <a href=${'mailto:' + contactEmail()}>${contactEmail()}</a>.`}>
    <div class="gate-actions">
      <button class="btn btn-primary btn-lg" onClick=${go} disabled=${busy} aria-busy=${busy ? 'true' : 'false'}>${busy ? html`<${Spinner} />Signing in…` : 'Sign in with Google'}</button>
      <${EmailOfficers} />
    </div>
    ${error && html`<p class="form-error" role="alert">${error}</p>`}
    <${ShareLink} />
    <p class="gate-note">New members: sign in, add your details, and an officer approves your account.</p>
  </${Gate}>`;
}

function Join() {
  const { api, authUser } = useStore((s) => ({ api: s.api, authUser: s.authUser }));
  const [form, setForm] = useState({ name: authUser?.name || '', pronouns: '', major: '', subteams: [], joinNote: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  // Subteams grouped by subsidiary, so "Electrical" on Crush Depth and on Prosthetic read apart.
  const [teams, setTeams] = useState({ subteams: [], subsidiaries: [] });
  useEffect(() => {
    const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99);
    Promise.all([api.listSubteams?.() || [], api.listSubsidiaries?.().catch(() => []) || []]).then(([list, subs]) => setTeams({
      subteams: (list || []).filter((s) => !s.archived).sort(byOrder),
      subsidiaries: (subs || []).sort(byOrder),
    })).catch(() => { /* the question just stays hidden */ });
  }, [api]);
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr('Add your name so officers know who you are.'); return; }
    setBusy(true); setErr('');
    try { await api.createMyProfile(authUser, { ...form, name: form.name.trim() }); }
    catch (ex) { setErr(friendlyError(ex, 'Your request didn’t go through. Try again.')); setBusy(false); }
  };
  return html`<${Gate} small title="Request access" lede=${`Signed in as ${authUser?.email}. Tell the officers who you are; they approve each new member.`}>
    <form class="form-grid gate-form" onSubmit=${submit}>
      <${Field} label="Your name" full><input class="input" value=${form.name} onInput=${set('name')} required maxlength="80" autocomplete="name" /></${Field}>
      <${Field} label="Pronouns (optional)"><input class="input" value=${form.pronouns} onInput=${set('pronouns')} maxlength="30" /></${Field}>
      <${Field} label="Major"><input class="input" value=${form.major} onInput=${set('major')} maxlength="80" /></${Field}>
      ${teams.subteams.length > 0 && html`<div class="field full" role="group" aria-labelledby="join-interests"><span id="join-interests">What do you want to work on?</span>
        <${SubteamPicker} value=${form.subteams} onChange=${(v) => setForm({ ...form, subteams: v })} subteams=${teams.subteams} subsidiaries=${teams.subsidiaries} />
      </div>`}
      <${Field} label="Anything officers should know? (optional)" full><textarea class="textarea" value=${form.joinNote} onInput=${set('joinNote')} maxlength="1000"></textarea></${Field}>
      ${err && html`<p class="form-error full" role="alert">${err}</p>`}
      <div class="full gate-actions">
        <button class="btn btn-primary btn-lg" type="submit" disabled=${busy}>${busy ? 'Sending…' : 'Send request'}</button>
        <button class="btn btn-lg" type="button" onClick=${() => api.signOut()}>Use a different account</button>
      </div>
    </form>
  </${Gate}>`;
}

function Pending() {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  return html`<${Gate} title="Your request is in."
    lede=${`Thanks, ${profile.name.split(' ')[0]}. An officer approves new accounts, usually at the next club meeting. This page opens the portal as soon as they do.`}>
    <div class="gate-actions">
      <button class="btn btn-lg" onClick=${() => api.signOut()}>Sign out</button>
      <${EmailOfficers} />
    </div>
    <p class="gate-note">Signed in as ${profile.email}. If that’s the wrong account, sign out and use the right one.</p>
  </${Gate}>`;
}

function NoAccess() {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const denied = profile.status === 'denied';
  return html`<${Gate} title=${denied ? 'Your request wasn’t approved.' : 'Your membership is inactive.'}
    lede=${`${denied ? 'An officer didn’t approve this account.' : 'An officer marked this account as inactive.'} If you think that’s a mistake, email the officers.`}>
    <div class="gate-actions">
      <${EmailOfficers} primary />
      <button class="btn btn-lg" onClick=${() => api.signOut()}>Sign out</button>
    </div>
    <p class="gate-note">Signed in as ${profile.email}.</p>
  </${Gate}>`;
}
