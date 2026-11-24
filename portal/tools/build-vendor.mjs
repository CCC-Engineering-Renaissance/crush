// Bundles the portal's third-party libraries into portal/vendor as plain ES modules,
// so the site itself needs no build step and loads nothing from outside CDNs.
//
//   cd portal/tools && npm install && npm run vendor
//
// Run this only when upgrading a library version in package.json.
import { build } from 'esbuild';
import { mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'vendor');
const tmp = join(here, '.entries');
await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });
await mkdir(out, { recursive: true });

const entries = {
  'preact.js': `
    export { h, render, Fragment, createContext, createRef, toChildArray } from 'preact';
    export { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useContext, useReducer } from 'preact/hooks';
    import { h } from 'preact';
    import htm from 'htm';
    export const html = htm.bind(h);
  `,
  'purify.js': `
    import DOMPurify from 'dompurify';
    export default DOMPurify;
  `,
  'firebase.js': `
    export { initializeApp } from 'firebase/app';
    export {
      getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
      browserLocalPersistence, setPersistence
    } from 'firebase/auth';
    export {
      initializeFirestore, memoryLocalCache, collection, doc, getDoc, getDocs, setDoc, addDoc,
      updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, writeBatch, serverTimestamp,
      Timestamp, deleteField, runTransaction, documentId
    } from 'firebase/firestore';
    export { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
  `,
  'editor.js': `
    export { default as EditorJS } from '@editorjs/editorjs';
    export { default as Header } from '@editorjs/header';
    export { default as List } from '@editorjs/list';
    export { default as Quote } from '@editorjs/quote';
    export { default as Delimiter } from '@editorjs/delimiter';
    export { default as Table } from '@editorjs/table';
    export { default as Code } from '@editorjs/code';
    export { default as InlineCode } from '@editorjs/inline-code';
    export { default as Marker } from '@editorjs/marker';
    export { default as Warning } from '@editorjs/warning';
  `,
};

for (const [name, source] of Object.entries(entries)) {
  const entry = join(tmp, name);
  await writeFile(entry, source);
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    minify: true,
    target: ['es2020'],
    legalComments: 'eof',
    outfile: join(out, name),
    nodePaths: [join(here, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  });
}
await rm(tmp, { recursive: true, force: true });

// Fonts are served from this site too (no Google Fonts request from the portal or the public site).
const fonts = join(here, '..', 'assets', 'fonts');
await mkdir(fonts, { recursive: true });
const nm = join(here, 'node_modules');
for (const [pkg, file] of [
  ['@fontsource-variable/dm-sans', 'dm-sans-latin-wght-normal.woff2'],
  ['@fontsource-variable/dm-sans', 'dm-sans-latin-wght-italic.woff2'],
  ['@fontsource/chakra-petch', 'chakra-petch-latin-500-normal.woff2'],
  ['@fontsource/chakra-petch', 'chakra-petch-latin-600-normal.woff2'],
  ['@fontsource/chakra-petch', 'chakra-petch-latin-700-normal.woff2'],
  ['@fontsource/dm-mono', 'dm-mono-latin-400-normal.woff2'],
  ['@fontsource/dm-mono', 'dm-mono-latin-500-normal.woff2'],
]) await copyFile(join(nm, pkg, 'files', file), join(fonts, file));
console.log('Vendor bundles written to', out, 'and fonts to', fonts);
