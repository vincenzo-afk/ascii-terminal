// Minimal headless test: validates the pure functions from app.js
// (GIF encoder, medianCut, lzwEncode, escHtml, gridToText)
//
// Strategy: extract each function source and define it via `eval`
// inside an IIFE-like scope so declarations do not collide.

const fs = require('fs');
const src = fs.readFileSync('app.js', 'utf8');

function extractFn(name) {
  const marker = 'function ' + name + '(';
  const start = src.indexOf(marker);
  if (start === -1) throw new Error('missing ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// Run each extraction in its own function scope so declarations
// do not collide across tests.
function makeFn(code, name) {
  return new Function(code + '\nreturn ' + name + ';').call(null);
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS  ' + name); passed++; }
  catch (e) { console.log('FAIL  ' + name + ': ' + e.message); failed++; }
}

// 1. escHtml
test('escHtml escapes &, <, >, "', () => {
  // escHtml is a per-character escaper (used per cell in buildRowHtml)
  const esc = makeFn(extractFn('escHtml'), 'escHtml');
  const amp = String.fromCharCode(38), lt = String.fromCharCode(60), gt = String.fromCharCode(62), qt = String.fromCharCode(34);
  const input = amp + lt + gt + qt; // & < > "
  const expected = amp + 'amp;' + lt + 'lt;' + gt + 'gt;' + qt + 'quot;';
  const r = input.split('').map(ch => esc(ch)).join('');
  if (r !== '&amp;&lt;&gt;&quot;') throw new Error('bad escape: ' + JSON.stringify(r));
});

// 2. gridToText preserves spaces and newlines exactly
test('gridToText preserves spacing', () => {
  const gt = makeFn(extractFn('gridToText'), 'gridToText');
  const rows = [
    [{ch:' ',r:0,g:0,b:0},{ch:'#',r:100,g:100,b:100},{ch:' ',r:0,g:0,b:0}],
    [{ch:'@',r:200,g:200,b:200},{ch:'@',r:200,g:200,b:200},{ch:'.',r:50,g:50,b:50}],
  ];
  const t = gt(rows);
  if (t !== ' # \n@@.') throw new Error('spacing lost: ' + JSON.stringify(t));
});

// 3. medianCut produces palette
test('medianCut returns 256 colors', () => {
  const mc = makeFn(extractFn('medianCut'), 'medianCut');
  const pixels = [];
  for (let i = 0; i < 1000; i++) pixels.push([Math.random()*255, Math.random()*255, Math.random()*255]);
  const p = mc(pixels, 256);
  if (p.length !== 256) throw new Error('palette size: ' + p.length);
});

// 4. lzwEncode produces output
test('lzwEncode produces output', () => {
  const le = makeFn(extractFn('lzwEncode'), 'lzwEncode');
  const idx = new Uint8Array(100);
  for (let i = 0; i < 100; i++) idx[i] = i % 50;
  const bytes = le(idx, 8);
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error('empty output');
});

// 5+6. Full GIF binary: header GIF89a, trailer 0x3b, NETSCAPE loop extension
const gifSrc = extractFn('encodeGif') + extractFn('medianCut') + extractFn('lzwEncode');
test('encodeGif produces valid GIF89a with loop extension', async () => {
  const { encodeGif } = makeFn(gifSrc, '{ encodeGif }');
  const frames = [];
  for (let fr = 0; fr < 3; fr++) {
    const data = new Uint8Array(20 * 10 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i/4) % 256; data[i+1] = 50; data[i+2] = 100; data[i+3] = 255;
    }
    frames.push({ data, delay: 100 });
  }
  const blob = encodeGif(frames, 20, 10, 256);
  if (!blob || !blob.size) throw new Error('no blob');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = String.fromCharCode(...bytes.slice(0, 6));
  const trailer = bytes[bytes.length - 1];
  let netscape = false;
  for (let i = 0; i < bytes.length - 13; i++) {
    if (bytes[i] === 0x21 && bytes[i+1] === 0xff && bytes[i+2] === 11) {
      const s = String.fromCharCode(...bytes.slice(i+3, i+14));
      if (s === 'NETSCAPE2.0') netscape = true;
    }
  }
  if (header !== 'GIF89a') throw new Error('bad header: ' + header);
  if (trailer !== 0x3b) throw new Error('bad trailer: ' + trailer);
  if (!netscape) throw new Error('NETSCAPE loop extension missing');
  console.log('      (GIF binary is ' + bytes.length + ' bytes)');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
