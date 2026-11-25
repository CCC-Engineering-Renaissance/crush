// "Add to Home Screen": a small sheet that shows phone users how to keep the portal as an app.
// Android (Chrome, Edge, Samsung Internet) can install it with one tap. iPhones and iPads can't be
// prompted by a website, so the sheet shows the steps for the browser they're using.
import { html, useState, useEffect, Icon } from '../lib/ui.js';

const LATER_KEY = 'er-install-later';   // when someone tapped "Not now"
const WAIT_DAYS = 14;

let deferred = null;                    // the install prompt Chrome hands us, kept for the button
const listeners = new Set();
const changed = () => listeners.forEach((f) => f());

// Call once at startup: Chrome can offer the prompt before the sheet is on screen.
export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; changed(); });
  window.addEventListener('appinstalled', () => { deferred = null; snooze(3650); changed(); });
}

export function device() {
  const ua = navigator.userAgent || '';
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPads ask for desktop sites
  const ios = /iPhone|iPad|iPod/.test(ua) || iPadOS;
  const android = /Android/i.test(ua);
  const standalone = !!(window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || navigator.standalone === true);
  const inApp = ios && (!/Safari\//.test(ua) || /Instagram|FBAN|FBAV|Discord|Snapchat|LinkedInApp/.test(ua));
  const otherBrowser = ios && /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
  const safari = ios && !inApp && !otherBrowser;
  const safariMajor = Number((ua.match(/Version\/(\d+)/) || [])[1] || 0);
  return { ios, iPad: iPadOS || /iPad/.test(ua), android, standalone, inApp, otherBrowser, safari, safariMajor };
}

function snoozed() {
  try { return Date.now() < Number(localStorage.getItem(LATER_KEY) || 0); } catch { return false; }
}
function snooze(days = WAIT_DAYS) {
  try { localStorage.setItem(LATER_KEY, String(Date.now() + days * 86400e3)); } catch { /* private mode */ }
}

// Whether this device can still add the portal (shows the menu link even after "Not now").
export function canInstall() {
  const d = device();
  return (d.ios || d.android) && !d.standalone;
}
export function openInstallSheet() { window.dispatchEvent(new Event('er-install-open')); }

export function InstallSheet() {
  const [open, setOpen] = useState(false);
  const [, rerender] = useState(0);
  useEffect(() => {
    const f = () => rerender((n) => n + 1);
    listeners.add(f);
    const show = () => setOpen(true);
    window.addEventListener('er-install-open', show);
    // Offer it once people have had a moment to look around, and never over the guided tour.
    const offer = () => {
      if (document.documentElement.classList.contains('touring')) window.addEventListener('er-tour-end', () => setTimeout(offer, 1500), { once: true });
      else show();
    };
    const t = canInstall() && !snoozed() ? setTimeout(offer, 2500) : null;
    return () => { listeners.delete(f); window.removeEventListener('er-install-open', show); clearTimeout(t); };
  }, []);
  if (!open || !canInstall()) return null;

  const d = device();
  const later = () => { snooze(); setOpen(false); };
  const install = async () => {
    const prompt = deferred;
    if (!prompt) return;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    deferred = null;
    if (choice?.outcome === 'accepted') { snooze(3650); setOpen(false); } else rerender((n) => n + 1);
  };

  const step = (icon, body) => ({ icon, body });
  let steps = [];
  let note = '';
  if (d.ios && d.inApp) {
    steps = [
      step('external', html`Open this page in <b>Safari</b>. Look for <b>Open in Safari</b> in this app’s <b>···</b> menu.`),
      step('share', html`In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.`),
    ];
  } else if (d.ios && d.safari && d.safariMajor >= 26) {
    steps = [
      step('more', html`Tap <b>···</b> next to the address bar.`),
      step('share', html`Tap <b>Share</b>.`),
      step('addSquare', html`Scroll down, tap <b>Add to Home Screen</b>, then <b>Add</b>.`),
    ];
  } else if (d.ios && d.safari) {
    steps = [
      step('share', html`Tap <b>Share</b> ${d.iPad ? 'at the top of Safari' : 'at the bottom of Safari'}.`),
      step('addSquare', html`Scroll down and tap <b>Add to Home Screen</b>.`),
      step('check', html`Tap <b>Add</b>.`),
    ];
  } else if (d.ios) {
    steps = [
      step('share', html`Tap <b>Share</b> in your browser’s address bar or menu.`),
      step('addSquare', html`Tap <b>Add to Home Screen</b>, then <b>Add</b>.`),
    ];
  } else if (!deferred) {
    steps = [
      step('dotsV', html`Tap <b>⋮</b> at the top right of your browser.`),
      step('addSquare', html`Tap <b>Add to Home screen</b> or <b>Install app</b>, then <b>Install</b>.`),
    ];
  }
  if (d.ios && !d.inApp) note = 'The Home Screen app keeps its own sign-in, so you’ll sign in once more there.';

  return html`<section class="install-sheet" role="dialog" aria-labelledby="install-h" aria-describedby="install-p">
    <div class="install-head">
      <img src="assets/icon-192.png" alt="" width="48" height="48" />
      <div><h2 id="install-h">${d.android && deferred ? 'Install the portal app' : 'Add the portal to your Home Screen'}</h2>
        <p id="install-p">It opens full screen like an app, so clocking in is one tap.</p></div>
    </div>
    ${steps.length > 0 && html`<ol class="install-steps">${steps.map((s, i) => html`<li key=${i}><span class="install-icon"><${Icon} name=${s.icon} size=${18} /></span><span>${s.body}</span></li>`)}</ol>`}
    ${note && html`<p class="install-note">${note}</p>`}
    <div class="install-actions">
      ${d.android && deferred && html`<button class="btn btn-primary" onClick=${install}><${Icon} name="download" />Install</button>`}
      <button class=${'btn' + (d.android && deferred ? ' btn-quiet' : '')} onClick=${later}>${d.android && deferred ? 'Not now' : 'Got it'}</button>
    </div>
  </section>`;
}
