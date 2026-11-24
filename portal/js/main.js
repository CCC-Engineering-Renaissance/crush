// Entry point. config.js decides between the real Firebase backend and the demo.
import { html, render } from '../vendor/preact.js';
import config from '../config.js';
import { App } from './views/app.js';

render(html`<${App} config=${config} />`, document.getElementById('app'));
