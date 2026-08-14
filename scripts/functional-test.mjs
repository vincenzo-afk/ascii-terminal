// Functional pipeline test using jsdom: exercises the REAL render/export
// pipeline (pixelToAscii -> renderAscii -> currentText -> clipboard copy,
// HTML export, TXT export) with a synthetic RGBA frame, verifying the
// fixed-width copy-paste portability contract end to end.
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const stubs = `
  class FakeBlob { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; this.text = () => Promise.resolve(String(this.parts[0] || '')); } get size() { return String(this.parts[0]||'').length; } async arrayBuffer() { return new ArrayBuffer(0); } }
  window.Blob = FakeBlob;
  window.__lastBlobType = null;
  window.URL.createObjectURL = (b) => { window.__lastBlobType = b.type; return 'blob:fake'; };
  window.URL.revokeObjectURL = () => {};
  window.performance = { now: () => Date.now() };
  class FakeClipboard { async writeText(t) { window.__lastCopied = t; } }
  Object.defineProperty(navigator, 'clipboard', { value: new FakeClipboard(), configurable: true });
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
`;

const dom = new JSDOM(html, { url: 'http://localhost:8899/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
dom.window.eval(stubs);

// app.js uses `const` at the top level: evaluate it in a fresh nested global
// scope via a function wrapper so `const CONFIG` etc. do not throw
// "Identifier has already been declared" on re-eval.
// jsdom caveat: in window.eval, top-level `const`/`let` do NOT become
// window properties (lexical bindings), while function declarations do.
// A real browser <script> tag puts `const` into the global lexical scope,
// so the app is correct there. For this headless test we load app.js
// inside an IIFE and explicitly mirror its public constants onto window.
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
dom.window.eval('(function(){ ' + appSrc + ' window.__testExports = { CONFIG, ASPECT_CORRECTION, CHARSETS, currentText, gridToText, pixelToAscii, renderAscii, escHtml }; }).call(window);');
Object.assign(w, w.__testExports);
const __te = { CONFIG: w.CONFIG };

for (const url of [
  'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.js',
]) dom.window.eval(await (await fetch(url)).text());

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS  ' + name); passed++; }
  catch (e) { console.log('FAIL  ' + name + ': ' + e.message); failed++; }
}

// --- Seed a synthetic RGBA frame (80 wide so geometry matches CONFIG) ---
// (jsdom's eval keeps top-level `const` lexical, so read CONFIG from inside eval)
const cols2 = w.CONFIG.columns;
const imgW = cols2 * 4;                 // 320 px wide test image
const imgH = 90;                        // arbitrary height
// jsdom has no ImageData constructor; build the plain object shape the
// engine reads (getImageData-style { data, width, height })
const source = { data: new Uint8ClampedArray(imgW * imgH * 4), width: imgW, height: imgH };
for (let i = 0; i < source.data.length; i += 4) {
  const px = (i / 4) % imgW, py = Math.floor(i / 4 / imgW);
  const v = Math.round(((px + py) / (imgW + imgH)) * 255);
  source.data[i] = v; source.data[i+1] = v; source.data[i+2] = v; source.data[i+3] = 255;
}
const frameObj = { imageData: source, width: imgW, height: imgH };

t('pipeline helpers exist', () => {
  for (const fn of ['pixelToAscii', 'gridToText', 'currentText', 'renderAscii']) {
    if (typeof w[fn] !== 'function') throw new Error('missing ' + fn);
  }
});

// Real engine call: pixelToAscii
const grid = w.pixelToAscii(frameObj);
t('pixelToAscii builds a grid of exact width', () => {
  if (grid.length === 0) throw new Error('empty grid');
  for (const row of grid) if (row.length !== cols2) throw new Error('row width ' + row.length);
  if (grid[0][0].ch === undefined) throw new Error('cell missing ch');
});

// Real engine render (sync path, no animation)
w.renderAscii(grid, false);
t('renderAscii writes grid to <pre> with one span per cell', () => {
  const spans = w.document.querySelectorAll('#ascii-pre span');
  if (spans.length !== grid.length * cols2) throw new Error('span count ' + spans.length);
  const preText = w.document.getElementById('ascii-pre').textContent;
  if (preText.trim() === '') throw new Error('pre empty');
});

// Portability contract: rendered text == in-memory grid text
t('rendered <pre> text equals gridToText output', () => {
  const a = w.document.getElementById('ascii-pre').textContent.replace(/\n+$/, '');
  const b = w.gridToText(grid).replace(/\n+$/, '');
  console.log('      pre len:', a.length, 'grid len:', b.length);
  // Find first differing position for diagnosis
  let diff = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { diff = i; break; }
  }
  if (diff >= 0) console.log('      a[diff] code:', a.charCodeAt(diff), 'b[diff] code:', b.charCodeAt(diff));
  console.log('      a start:', JSON.stringify(a.slice(0, 30)), 'b start:', JSON.stringify(b.slice(0, 30)));
  if (a !== b) throw new Error('render/grid mismatch');
  for (const line of b.split('\n')) if (line.length !== cols2) throw new Error('line width');
});

// currentText() routes through the grid (not innerText)
t('currentText() derives from the in-memory grid', () => {
  if (w.currentText() !== w.gridToText(grid)) throw new Error('currentText mismatch');
});

// Copy button -> clipboard
await w.document.getElementById('btn-copy').click();
await new Promise(r => setTimeout(r, 50));
t('copy writes exact grid text to clipboard', () => {
  if (w.__lastCopied !== w.currentText()) throw new Error('clipboard mismatch');
});

// HTML export -> intercept blob + captured download link
w.__capturedHtml = null;
const origCreate = w.URL.createObjectURL;
w.URL.createObjectURL = (blob) => { blob.text().then(t2 => { w.__capturedHtml = t2; }); return 'blob:fake'; };
await w.document.getElementById('btn-html').click();
await new Promise(r => setTimeout(r, 100));
t('HTML export is self-contained with embedded sizing', () => {
  if (!w.__capturedHtml) throw new Error('no html blob captured');
  const doc = new w.DOMParser().parseFromString(w.__capturedHtml, 'text/html');
  const pre = doc.querySelector('pre');
  if (!pre) throw new Error('export missing <pre>');
  const style = doc.querySelector('style');
  if (!style || !style.textContent.includes('font-size')) throw new Error('export missing sizing style');
  const lines = pre.textContent.split('\n').filter(l => l.length > 0);
  for (const line of lines) if (line.length !== cols2) throw new Error('export line width ' + line.length);
});

// TXT export
w.__capturedTxt = null;
w.URL.createObjectURL = (blob) => { blob.text().then(t2 => { w.__capturedTxt = t2; }); return 'blob:fake'; };
await w.document.getElementById('btn-txt').click();
await new Promise(r => setTimeout(r, 100));
t('TXT export is identical plain-text grid', () => {
  if (!w.__capturedTxt) throw new Error('no txt blob captured');
  const lines = w.__capturedTxt.split('\n').filter(l => l.length > 0);
  for (const line of lines) if (line.length !== cols2) throw new Error('txt line width ' + line.length);
  if (w.__capturedTxt !== w.currentText()) throw new Error('txt != currentText');
});

// Copy == TXT == rendered text: the copy-paste promise
t('copy / TXT / rendered text are byte-identical', () => {
  const rendered = w.document.getElementById('ascii-pre').textContent.replace(/\n+$/, '');
  if (w.__lastCopied !== w.__capturedTxt) throw new Error('copy != txt');
  if (w.__capturedTxt !== rendered) throw new Error('txt != rendered');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
