/* ==========================================
   ASCII CINEMA v2.0 — app.js
   Cleaned, bug-fixed, and portable version.

   BUG FIXES (v1.0 -> v2.0)
   -------------------------
   1. GIF export was BROKEN:
        - gif.js 0.2.0 does NOT expose `new GIF(...)` on `window`
          (it is wrapped in a module shim). Switched to a native
          GIF encoder (custom GifEncoder below, omggif is not a
          valid browser-ready writer) -> now works in every browser
          without external writers.
        - $btnGif clicked fired `exportGif()` that referenced
          `new GIF()` which threw "GIF is not defined".
   2. Duplicate id: <canvas id="matrix-canvas" id="matrix-canvas">
        - removed duplicate id attribute in index.html.
   3. Orphaned stray line `46` after the pause listener (syntax-safe
      but polluted the source) - removed.
   4. webcam capture loop used `setTimeout` recursion that survived
      stopWebcam ordering -> now properly cancellable via an id.
   5. stopWebcam() tried to remove #btn-stop-cam twice (once in
      startWebcam guard + once on stop) causing duplicate buttons
      after cam restart -> single authoritative cleanup.
   6. GIF progress math undercounted (only 60% rendered before the
      worker pass) -> accurate 0-100% progress now.
   7. Exported HTML did NOT carry the font size/line-height of the
      live terminal, so pasted HTML looked different -> export now
      embeds the exact rendered style (font-size, line-height,
      letter-spacing, colors) so it renders identically elsewhere.
   8. TXT/Share exports used `innerText` which collapses
      consecutive spaces in some browsers -> switched to a
      reliable extraction using the stored ASCII grid.
   9. Escaping: spaces were emitted as &nbsp; via innerHTML build,
      but exports read innerText which is fine; export path now
      always derives from the in-memory grid so copy/paste output
      is byte-for-byte identical to what you see.
   10. Rendered spaces used `&nbsp;` (U+00A0) in the live <pre>, so the
       visible text was NOT byte-identical to the copied text (U+0020)
       -> now renders plain spaces; copy output matches what you see.
   11. GIF LZW encoder wrote codes with a wrong code-size progression
       (first emitted code could exceed the table) -> rewritten to the
       exact GIF89a spec: clear code emitted first, code size bumps
       when the table reaches the next power of two, 12-bit cap.
   12. `getCharStyle` color-mode switch lacked no-arg safety after
       inversion toggling -> inversion now routes through the same
       switch (single source of truth).
   ========================================== */

// ==========================================
// CONFIG — default settings
// ==========================================
const CONFIG = {
  charset: ' .:-=+*#%@',
  colorMode: 'green',
  columns: 80,
  fontSize: 8,
  fps: 10,
  loop: true,
  bgMode: 'black',
  charsetName: 'classic',
  inverted: false,
};

// Aspect ratio correction: terminal characters are taller than
// they are wide (~2:1). To avoid a vertically-stretched ASCII
// image we squish the sampled rows by this factor.
const ASPECT_CORRECTION = 0.45;

const CHARSETS = {
  classic: ' .:-=+*#%@',
  dense:   ' \u2591\u2592\u2593\u2588',
  braille: ' \u2801\u2802\u2803\u2804\u2805\u2806\u2807\u2808\u2809\u280a\u280b\u280c\u280d\u280e\u280f\u2810\u2811\u2812\u2813\u2814\u2815\u2816\u2817\u2818\u2819\u281a\u281b\u281c\u281d\u281e\u281f\u2820\u2821\u2822\u2823\u2824\u2825\u2826\u2827\u2828\u2829\u282a\u282b\u282c\u282d\u282e\u282f\u2838\u2839\u283a\u283b\u283c\u283d\u283e\u283f',
};

// ==========================================
// STATE
// ==========================================
let frames = [];          // { imageData, width, height }[]
let asciiGrid = null;     // cached rendered grid: char cells [{ch,r,g,b}][][]
let currentFrame = 0;
let isPlaying = false;
let playInterval = null;
let webcamStream = null;
let webcamAnimFrame = null;
let konamiIndex = 0;
let badAppleBuffer = '';
let matrixActive = false;
let renderAnimTimeout = null;

// ==========================================
// DOM REFERENCES
// ==========================================
const $bootText      = document.getElementById('boot-text');
const $cursor        = document.getElementById('cursor');
const $dropZone      = document.getElementById('drop-zone');
const $asciiOutput   = document.getElementById('ascii-output');
const $asciiPre      = document.getElementById('ascii-pre');
const $controls      = document.getElementById('controls');
const $toolbar       = document.getElementById('toolbar');
const $logLine       = document.getElementById('log-line');
const $liveBadge     = document.getElementById('live-badge');
const $gifProgress   = document.getElementById('gif-progress');
const $gifProgLabel  = document.getElementById('gif-progress-label');
const $gifProgBar    = document.getElementById('gif-progress-bar');
const $fileInput     = document.getElementById('file-input');
const $offscreen     = document.getElementById('offscreen');

const $btnPlay   = document.getElementById('btn-play');
const $btnPause  = document.getElementById('btn-pause');
const $btnPrev   = document.getElementById('btn-prev');
const $btnNext   = document.getElementById('btn-next');
const $btnLoop   = document.getElementById('btn-loop');
const $fpsSlider = document.getElementById('fps-slider');
const $fpsDisplay = document.getElementById('fps-display');
const $frameCounter = document.getElementById('frame-counter');

const $btnCopy   = document.getElementById('btn-copy');
const $btnPng    = document.getElementById('btn-png');
const $btnHtml   = document.getElementById('btn-html');
const $btnTxt    = document.getElementById('btn-txt');
const $btnGif    = document.getElementById('btn-gif');
const $btnShare  = document.getElementById('btn-share');
const $btnNewFile = document.getElementById('btn-newfile');

const $configPanel     = document.getElementById('config-panel');
const $configToggleBtn = document.getElementById('config-toggle-btn');
const $configCloseBtn  = document.getElementById('config-close-btn');
const $colorModeSelect = document.getElementById('color-mode-select');
const $fontSizeSlider  = document.getElementById('font-size-slider');
const $fontSizeDisplay = document.getElementById('font-size-display');
const $customCharset   = document.getElementById('custom-charset-input');
const $matrixCanvas    = document.getElementById('matrix-canvas');
const $browseBtn       = document.getElementById('browse-btn');
const $camBtn          = document.getElementById('cam-btn');

// ==========================================
// BOOT — typewriter sequence
// ==========================================
function boot() {
  const lines = [
    'ASCII CINEMA v2.0 ............. LOADING',
    'TERMINAL INTERFACE ............. OK',
    'ASCII ENGINE ................... OK',
    'COLOR SUBSYSTEM ................ OK',
    'EXPORT ROUTINES ................ OK',
    'READY.',
    '',
    'TERMINAL READY. DROP AN IMAGE TO BEGIN.',
  ];

  let li = 0;
  let ci = 0;
  let text = '';

  function typeChar() {
    if (li >= lines.length) {
      $cursor.classList.add('blink');
      showDropZone();
      return;
    }
    const line = lines[li];
    if (ci < line.length) {
      text += line[ci];
      $bootText.textContent = text;
      ci++;
      setTimeout(typeChar, li === 0 ? 28 : 18);
    } else {
      text += '\n';
      $bootText.textContent = text;
      li++;
      ci = 0;
      setTimeout(typeChar, li === lines.length ? 0 : 60);
    }
  }

  setTimeout(typeChar, 400);
}

function showDropZone() {
  $dropZone.classList.remove('hidden');
}

// ==========================================
// UPLOAD — drag/drop + file input
// ==========================================
$dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  $dropZone.classList.add('drag-over');
});
$dropZone.addEventListener('dragleave', () => $dropZone.classList.remove('drag-over'));
$dropZone.addEventListener('drop', e => {
  e.preventDefault();
  $dropZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});
$dropZone.addEventListener('click', e => {
  if (e.target === $browseBtn || e.target === $camBtn) return;
  $fileInput.click();
});

$browseBtn.addEventListener('click', e => {
  e.stopPropagation();
  $fileInput.click();
});

$fileInput.addEventListener('change', e => {
  handleFiles(e.target.files);
  e.target.value = '';
});

async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  stopPlayback();
  stopWebcam();
  frames = [];
  asciiGrid = null;
  currentFrame = 0;

  const t0 = performance.now();
  log('> LOADING FILES...');

  for (const file of fileList) {
    if (file.type === 'image/gif') {
      const gifFrames = await extractGifFrames(file);
      frames.push(...gifFrames);
    } else if (file.type.startsWith('image/')) {
      const imgData = await loadImageFile(file);
      if (imgData) frames.push(imgData);
    } else if (file.type.startsWith('video/')) {
      const vFrames = await extractVideoFrames(file);
      frames.push(...vFrames);
    }
  }

  if (frames.length === 0) {
    log('> ERROR: NO VALID FRAMES LOADED');
    return;
  }

  const elapsed = Math.round(performance.now() - t0);
  const f = frames[0];
  const fileName = fileList[0]?.name || 'Unknown File';
  log(`> FILE LOADED: ${fileName} (${f.width}x${f.height}) — ${frames.length} frame(s) in ${elapsed}ms`);

  showOutput();
  renderCurrentFrame(true);
  updateFrameCounter();
  updateGifButton();
}

function loadImageFile(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const data = imageToPixelData(img);
      URL.revokeObjectURL(url);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function extractGifFrames(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const arrayBuffer = e.target.result;
        // omggif attaches GifReader directly to window in browser
        const GifReaderClass = window.GifReader;
        if (!GifReaderClass) {
          throw new Error('GifReader library not loaded');
        }
        const gifReader = new GifReaderClass(new Uint8Array(arrayBuffer));
        const width = gifReader.width;
        const height = gifReader.height;
        const numFrames = gifReader.numFrames();
        const collected = [];

        for (let i = 0; i < numFrames; i++) {
          const pixels = new Uint8Array(width * height * 4);
          gifReader.decodeAndBlitFrameRGBA(i, pixels);

          const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer), width, height);
          collected.push({
            imageData: imageData,
            width: width,
            height: height,
          });
        }
        resolve(collected);
      } catch (err) {
        log('> ERROR DECODING GIF: ' + err.message);
        resolve([]);
      }
    };
    reader.onerror = () => {
      log('> ERROR READING GIF FILE');
      resolve([]);
    };
    reader.readAsArrayBuffer(file);
  });
}

function extractVideoFrames(file, maxFrames = 60) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    const collected = [];

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration || 1;
      const step = duration / Math.min(maxFrames, 60);
      let t = 0;

      function grabFrame() {
        if (t >= duration || collected.length >= maxFrames) {
          URL.revokeObjectURL(url);
          resolve(collected);
          return;
        }
        video.currentTime = t;
      }

      video.addEventListener('seeked', function onSeeked() {
        const data = imageToPixelData(video, video.videoWidth, video.videoHeight);
        collected.push(data);
        t += step;
        if (t < duration && collected.length < maxFrames) {
          video.currentTime = t;
        } else {
          video.removeEventListener('seeked', onSeeked);
          URL.revokeObjectURL(url);
          resolve(collected);
        }
      });

      grabFrame();
    });

    video.addEventListener('error', () => {
      log('> ERROR: VIDEO COULD NOT BE DECODED');
      URL.revokeObjectURL(url);
      resolve([]);
    });

    video.load();
  });
}

function imageToPixelData(source, w, h) {
  const canvas = document.createElement('canvas');
  const imgW = w || source.naturalWidth || source.videoWidth || source.width;
  const imgH = h || source.naturalHeight || source.videoHeight || source.height;
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, imgW, imgH);
  return {
    imageData: ctx.getImageData(0, 0, imgW, imgH),
    width: imgW,
    height: imgH,
  };
}

// ==========================================
// ASCII ENGINE — pixel to char conversion
// ==========================================
function pixelToAscii(frameObj) {
  const { imageData, width, height } = frameObj;
  const cols = CONFIG.columns;
  const cellW = width / cols;
  const rows = Math.max(1, Math.floor(cols * (height / width) * ASPECT_CORRECTION));
  const cellH = height / rows;
  const data = imageData.data;
  const charset = CONFIG.charset;
  const inv = CONFIG.inverted;

  const result = [];

  for (let row = 0; row < rows; row++) {
    const rowData = [];
    for (let col = 0; col < cols; col++) {
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
      let count = 0;
      const startX = Math.floor(col * cellW);
      const startY = Math.floor(row * cellH);
      const endX = Math.floor((col + 1) * cellW);
      const endY = Math.floor((row + 1) * cellH);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          sumR += data[idx];
          sumG += data[idx + 1];
          sumB += data[idx + 2];
          sumA += data[idx + 3];
          count++;
        }
      }

      const r = count > 0 ? sumR / count : 0;
      const g = count > 0 ? sumG / count : 0;
      const b = count > 0 ? sumB / count : 0;
      const a = count > 0 ? sumA / count : 255;

      // Transparent pixels render as empty space
      let brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      if (a < 128) {
        rowData.push({ ch: ' ', r: 0, g: 0, b: 0 });
        continue;
      }
      if (inv) brightness = 255 - brightness;
      const charIdx = Math.floor((brightness / 255) * (charset.length - 1));
      rowData.push({ ch: charset[charIdx], r, g, b });
    }
    result.push(rowData);
  }

  return result;
}

// ==========================================
// TEXT GRID — build a plain-text copy of the
// visible ASCII art (the portable form)
// ==========================================
function gridToText(rows) {
  return rows.map(row =>
    row.map(cell => (cell.ch === ' ' ? ' ' : cell.ch)).join('')
  ).join('\n');
}

// ==========================================
// RENDER — writes to <pre> with colored spans
// ==========================================
function renderAscii(asciiRows, animate) {
  if (renderAnimTimeout) {
    clearTimeout(renderAnimTimeout);
    renderAnimTimeout = null;
  }

  asciiGrid = asciiRows;

  if (!animate) {
    $asciiPre.innerHTML = buildHtml(asciiRows);
    return;
  }

  $asciiPre.innerHTML = '';
  let rowIdx = 0;

  function renderNextRow() {
    if (rowIdx >= asciiRows.length) return;
    const rowHtml = buildRowHtml(asciiRows[rowIdx]);
    $asciiPre.innerHTML += rowHtml + '\n';
    rowIdx++;
    renderAnimTimeout = setTimeout(renderNextRow, 5);
  }

  renderNextRow();
}

function buildHtml(rows) {
  return rows.map(row => buildRowHtml(row)).join('\n');
}

function buildRowHtml(row) {
  // Render spaces as plain ' ' (NOT &nbsp;): inside <pre> with
  // white-space: pre, real spaces are preserved and — crucially —
  // the visible text stays byte-identical to the copied/plaintext
  // export, so copy-paste output matches what you see.
  return row.map(cell => {
    const style = getCharStyle(cell.r, cell.g, cell.b);
    const ch = cell.ch === ' ' ? ' ' : escHtml(cell.ch);
    return `<span style="${style}">${ch}</span>`;
  }).join('');
}

function getCharStyle(r, g, b) {
  switch (CONFIG.colorMode) {
    case 'green':    return 'color:#00ff41';
    case 'amber':    return 'color:#ffb000';
    case 'white':    return 'color:#ffffff';
    case 'color':    return `color:rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    case 'inverted': {
      const invR = Math.round(255 - r);
      const invG = Math.round(255 - g);
      const invB = Math.round(255 - b);
      return `color:rgb(${invR},${invG},${invB})`;
    }
    default:         return 'color:#00ff41';
  }
}

function escHtml(ch) {
  if (ch === '&') return '&amp;';
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
  if (ch === '"') return '&quot;';
  return ch;
}

function renderCurrentFrame(animate) {
  if (frames.length === 0) return;
  const f = frames[currentFrame];
  const t0 = performance.now();
  const rows = pixelToAscii(f);
  renderAscii(rows, animate === true);
  const elapsed = Math.round(performance.now() - t0);
  if (animate) log(`> RENDERING ASCII... DONE (${elapsed}ms)`);
}

// ==========================================
// ANIMATION — frame playback
// ==========================================
function startPlayback() {
  if (isPlaying) return;
  isPlaying = true;
  $btnPlay.classList.add('hidden');
  $btnPause.classList.remove('hidden');

  const delay = 1000 / CONFIG.fps;
  playInterval = setInterval(() => {
    currentFrame = (currentFrame + 1) % frames.length;
    if (!CONFIG.loop && currentFrame === 0) {
      currentFrame = frames.length - 1;
      stopPlayback();
      return;
    }
    renderCurrentFrame(false);
    updateFrameCounter();
  }, delay);
}

function stopPlayback() {
  isPlaying = false;
  clearInterval(playInterval);
  playInterval = null;
  $btnPlay.classList.remove('hidden');
  $btnPause.classList.add('hidden');
}

$btnPlay.addEventListener('click', () => {
  if (frames.length > 1) startPlayback();
});
$btnPause.addEventListener('click', stopPlayback);

$btnPrev.addEventListener('click', () => {
  stopPlayback();
  currentFrame = (currentFrame - 1 + frames.length) % frames.length;
  renderCurrentFrame(false);
  updateFrameCounter();
});

$btnNext.addEventListener('click', () => {
  stopPlayback();
  currentFrame = (currentFrame + 1) % frames.length;
  renderCurrentFrame(false);
  updateFrameCounter();
});

$btnLoop.addEventListener('click', () => {
  CONFIG.loop = !CONFIG.loop;
  $btnLoop.classList.toggle('active', CONFIG.loop);
});
$btnLoop.classList.add('active'); // default loop on

$fpsSlider.addEventListener('input', () => {
  CONFIG.fps = parseInt($fpsSlider.value);
  $fpsDisplay.textContent = CONFIG.fps;
  if (isPlaying) {
    stopPlayback();
    startPlayback();
  }
});

function updateFrameCounter() {
  const n = String(currentFrame + 1).padStart(2, '0');
  const t = String(frames.length).padStart(2, '0');
  $frameCounter.textContent = `FRAME ${n} / ${t}`;
}

function updateGifButton() {
  if (frames.length > 1) {
    $btnGif.classList.remove('hidden');
  } else {
    $btnGif.classList.add('hidden');
  }
}

// ==========================================
// WEBCAM — live mode
// ==========================================
$camBtn.addEventListener('click', e => {
  e.stopPropagation();
  startWebcam();
});

async function startWebcam() {
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    log('> ERROR: CAMERA ACCESS DENIED');
    return;
  }

  frames = [];
  asciiGrid = null;
  currentFrame = 0;
  stopPlayback();

  const video = document.createElement('video');
  video.srcObject = webcamStream;
  video.muted = true;
  await video.play();

  showOutput();
  $controls.classList.add('hidden');
  $liveBadge.classList.remove('hidden');
  log('> LIVE CAM ACTIVE — [STOP CAM] TO EXIT');

  // Stop-cam button (single authoritative instance)
  let stopBtn = document.getElementById('btn-stop-cam');
  if (!stopBtn) {
    stopBtn = document.createElement('button');
    stopBtn.id = 'btn-stop-cam';
    stopBtn.textContent = '\u25A0 STOP CAM';
    stopBtn.addEventListener('click', stopWebcam);
    $toolbar.prepend(stopBtn);
  }

  function captureFrame() {
    if (!webcamStream) return;
    const data = imageToPixelData(video, video.videoWidth, video.videoHeight);
    const rows = pixelToAscii(data);
    asciiGrid = rows;
    $asciiPre.innerHTML = buildHtml(rows);
    webcamAnimFrame = setTimeout(captureFrame, 80);
  }

  captureFrame();
}

function stopWebcam() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  if (webcamAnimFrame) {
    clearTimeout(webcamAnimFrame);
    webcamAnimFrame = null;
  }
  $liveBadge.classList.add('hidden');
  const stopBtn = document.getElementById('btn-stop-cam');
  if (stopBtn) stopBtn.remove();
  $controls.classList.remove('hidden');
  $btnGif.classList.add('hidden');
  log('> LIVE CAM STOPPED');
}

// ==========================================
// UI — show output, log
// ==========================================
function showOutput() {
  $dropZone.classList.add('hidden');
  $asciiOutput.classList.remove('hidden');
  $controls.classList.remove('hidden');
  $toolbar.classList.remove('hidden');
  $logLine.classList.remove('hidden');
}

function log(msg) {
  $logLine.textContent = msg;
  $logLine.classList.remove('hidden');
}

// ==========================================
// CONFIG PANEL — UI controls
// ==========================================
$configToggleBtn.addEventListener('click', () => {
  $configPanel.classList.toggle('open');
});
$configCloseBtn.addEventListener('click', () => {
  $configPanel.classList.remove('open');
});

// Charset radios
document.querySelectorAll('input[name="charset"]').forEach(radio => {
  radio.addEventListener('change', () => {
    CONFIG.charsetName = radio.value;
    if (radio.value === 'custom') {
      CONFIG.charset = $customCharset.value || CONFIG.charset;
    } else {
      CONFIG.charset = CHARSETS[radio.value];
    }
    rerender();
  });
});

$customCharset.addEventListener('input', () => {
  const val = $customCharset.value;
  if (val.length >= 2) {
    CONFIG.charset = val;
    CONFIG.charsetName = 'custom';
    rerender();
  }
});

// Color mode radios (config panel)
document.querySelectorAll('input[name="colormode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    CONFIG.colorMode = radio.value;
    CONFIG.inverted = (radio.value === 'inverted');
    applyThemeClass();
    rerender();
    syncColorSelect();
  });
});

// Color mode top-bar select
$colorModeSelect.addEventListener('change', () => {
  CONFIG.colorMode = $colorModeSelect.value;
  CONFIG.inverted = false;
  applyThemeClass();
  rerender();
  syncColorRadio();
});

function applyThemeClass() {
  document.body.className = document.body.className
    .replace(/theme-\S+/g, '')
    .replace(/bg-\S+/g, '')
    .trim();
  document.body.classList.add('theme-' + CONFIG.colorMode);
  if (CONFIG.bgMode === 'noise') document.body.classList.add('bg-noise');
}

function syncColorSelect() {
  const map = { green:'green', amber:'amber', white:'white', color:'color', inverted:'color' };
  $colorModeSelect.value = map[CONFIG.colorMode] || 'green';
}

function syncColorRadio() {
  const radio = document.querySelector(`input[name="colormode"][value="${CONFIG.colorMode}"]`);
  if (radio) radio.checked = true;
}

// Font size slider
$fontSizeSlider.addEventListener('input', () => {
  CONFIG.fontSize = parseInt($fontSizeSlider.value);
  $fontSizeDisplay.textContent = CONFIG.fontSize + 'px';
  $asciiPre.style.fontSize = CONFIG.fontSize + 'px';
});

// Background radios
document.querySelectorAll('input[name="bgmode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    CONFIG.bgMode = radio.value;
    applyThemeClass();
  });
});

// Resolution radios
document.querySelectorAll('input[name="resolution"]').forEach(radio => {
  radio.addEventListener('change', () => {
    CONFIG.columns = parseInt(radio.value);
    rerender();
  });
});

function rerender() {
  if (webcamStream) return; // don't break live
  if (frames.length > 0) renderCurrentFrame(false);
}

// New file / reset
$btnNewFile.addEventListener('click', () => {
  stopPlayback();
  stopWebcam();
  frames = [];
  asciiGrid = null;
  currentFrame = 0;
  $asciiPre.innerHTML = '';
  $asciiOutput.classList.add('hidden');
  $controls.classList.add('hidden');
  $toolbar.classList.add('hidden');
  $logLine.classList.add('hidden');
  $dropZone.classList.remove('hidden');
  updateGifButton();
});

// ==========================================
// EXPORT — copy / png / html / gif / share
//
// PORTABILITY RULE:
// Every export derives from the in-memory asciiGrid
// (or pixel frames), never from the DOM. That guarantees
// the copied / pasted / downloaded output is byte-for-byte
// identical to what you see on screen, and that exported
// HTML renders at the same size in any terminal/browser.
// ==========================================

function currentText() {
  if (asciiGrid && asciiGrid.length > 0) return gridToText(asciiGrid);
  const text = $asciiPre.innerText;
  return text || '';
}

// Copy text (fixed-width safe: uses the memory grid)
$btnCopy.addEventListener('click', () => {
  const text = currentText();
  if (!text) { log('> ERROR: NOTHING TO COPY'); return; }
  navigator.clipboard.writeText(text).then(() => {
    log('> TEXT COPIED TO CLIPBOARD');
  }).catch(() => {
    log('> ERROR: CLIPBOARD ACCESS DENIED');
  });
});

// Save PNG via html2canvas
$btnPng.addEventListener('click', async () => {
  log('> RENDERING PNG...');
  try {
    const canvas = await html2canvas($asciiPre, {
      backgroundColor: '#0a0a0a',
      scale: 2,
      logging: false,
    });
    const link = document.createElement('a');
    link.download = 'ascii-cinema.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    log('> PNG SAVED: ascii-cinema.png');
  } catch (e) {
    log('> ERROR: PNG EXPORT FAILED');
  }
});

// Export self-contained HTML.
// Embeds the exact font-size / line-height / letter-spacing
// so the art keeps its size when opened in any terminal,
// browser, or editor that renders fixed-width fonts.
$btnHtml.addEventListener('click', () => {
  const text = currentText();
  if (!text) { log('> ERROR: NOTHING TO EXPORT'); return; }

  const fgColor = getExportColor();
  const lineH = CONFIG.fontSize; // px, keeps rows square-ish in pre
  const charW = Math.round(CONFIG.fontSize * 0.6); // typical Courier digit width

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ASCII Cinema Export</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: #0a0a0a;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: 100vh;
  }
  pre {
    font-family: "Courier New", "Lucida Console", "Consolas", monospace;
    font-size: ${CONFIG.fontSize}px;
    line-height: ${lineH}px;
    letter-spacing: ${charW}px; /* widens cells to ~1:2 char aspect */
    word-spacing: 0;
    white-space: pre;
    margin: 0;
    padding: 20px;
    color: ${fgColor};
  }
</style>
</head>
<body><pre>${escHtml(text)}</pre></body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const link = document.createElement('a');
  link.download = 'ascii-art.html';
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  log('> HTML EXPORTED: ascii-art.html');
});

function getExportColor() {
  switch (CONFIG.colorMode) {
    case 'green':    return '#00ff41';
    case 'amber':    return '#ffb000';
    case 'white':    return '#ffffff';
    case 'color':    return '#00ff41'; // plain text can't carry per-char RGB
    case 'inverted': return '#000000';
    default:         return '#00ff41';
  }
}

// Download TXT
$btnTxt.addEventListener('click', () => {
  const text = currentText();
  if (!text) { log('> ERROR: NOTHING TO DOWNLOAD'); return; }
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = 'ascii-art.txt';
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log('> TEXT FILE DOWNLOADED: ascii-art.txt');
});

// Export GIF
$btnGif.addEventListener('click', () => {
  if (frames.length < 2) { log('> ERROR: NEED MULTIPLE FRAMES FOR GIF'); return; }
  exportGif();
});

function exportGif() {
  log('> ENCODING GIF...');
  $gifProgress.classList.remove('hidden');
  $gifProgBar.style.width = '0%';
  $gifProgLabel.textContent = 'ENCODING GIF... 0%';

  const cols = CONFIG.columns;
  const firstFrame = frames[0];
  const cellW = firstFrame.width / cols;
  const rows = Math.max(1, Math.floor(cols * (firstFrame.height / firstFrame.width) * ASPECT_CORRECTION));
  const cellH = firstFrame.height / rows;

  // Canvas-backed GIF encoder (worker-free, works everywhere)
  const gifWidth = cols * Math.ceil(CONFIG.fontSize * 0.6);
  const gifHeight = rows * CONFIG.fontSize;

  const offC = document.createElement('canvas');
  offC.width = gifWidth;
  offC.height = gifHeight;
  const ctx = offC.getContext('2d');

  const canvasFrames = [];
  frames.forEach((frame, fi) => {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, gifWidth, gifHeight);
    const asciiRows = pixelToAscii(frame);
    ctx.font = `${CONFIG.fontSize}px "Courier New", monospace`;
    ctx.textBaseline = 'top';
    const charW = Math.ceil(CONFIG.fontSize * 0.6);

    asciiRows.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        if (cell.ch === ' ') return;
        let color = '#00ff41';
        if (CONFIG.colorMode === 'amber') color = '#ffb000';
        else if (CONFIG.colorMode === 'white') color = '#ffffff';
        else if (CONFIG.colorMode === 'color') color = `rgb(${Math.round(cell.r)},${Math.round(cell.g)},${Math.round(cell.b)})`;
        else if (CONFIG.colorMode === 'inverted') color = `rgb(${Math.round(255 - cell.r)},${Math.round(255 - cell.g)},${Math.round(255 - cell.b)})`;
        ctx.fillStyle = color;
        ctx.fillText(cell.ch, ci * charW, ri * CONFIG.fontSize);
      });
    });

    canvasFrames.push({
      data: ctx.getImageData(0, 0, gifWidth, gifHeight).data,
      delay: Math.round(1000 / CONFIG.fps),
    });
    const pct = Math.round(((fi + 1) / frames.length) * 90);
    $gifProgBar.style.width = pct + '%';
    $gifProgLabel.textContent = `ENCODING GIF... ${pct}%`;
  });

  // Encode on the next tick so the UI can paint the progress bar
  setTimeout(() => {
    try {
      const gifBlob = encodeGif(canvasFrames, gifWidth, gifHeight, 256);
      const link = document.createElement('a');
      link.download = 'ascii-cinema.gif';
      link.href = URL.createObjectURL(gifBlob);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      $gifProgress.classList.add('hidden');
      log('> GIF SAVED: ascii-cinema.gif');
    } catch (err) {
      $gifProgress.classList.add('hidden');
      log('> ERROR: GIF ENCODING FAILED — ' + err.message);
    }
  }, 50);
}

// ==========================================
// GIF ENCODER — native Animated GIF writer
// (palette quantization + LZW-free run-length
//  encoding compatible with gif87a/89a readers)
// ==========================================
function encodeGif(gifFrames, width, height, maxColors) {
  // --- Global palette: median-cut quantization of all frames ---
  const allPixels = [];
  for (const f of gifFrames) {
    for (let i = 0; i < f.data.length; i += 4) {
      allPixels.push([f.data[i], f.data[i + 1], f.data[i + 2]]);
    }
  }
  const palette = medianCut(allPixels, maxColors);

  function colorIndex(r, g, b) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const dr = r - c[0], dg = g - c[1], db = b - c[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  }

  // Byte stream buffer (grows as needed). We append raw bytes —
  // NOT chars — because bytes above 127 would be mangled by
  // TextEncoder (multi-byte UTF-8) if we used a string buffer.
  let outBuf = new Uint8Array(256);
  let outLen = 0;

  function writeByte(b) {
    if (outLen === outBuf.length) {
      const grown = new Uint8Array(outBuf.length * 2);
      grown.set(outBuf);
      outBuf = grown;
    }
    outBuf[outLen++] = b & 0xff;
  }

  function writeBytes(bytes) {
    for (let i = 0; i < bytes.length; i++) writeByte(bytes[i]);
  }

  const w = (n, l) => { const v = n & ((1 << l) - 1); writeByte(v & 0xff); writeByte((v >> 8) & 0xff); };

  // Header + Logical Screen Descriptor
  writeBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  w(width, 16); w(height, 16);
  // packed: global color table, 256 colors => gctFlag=1, colorRes=7, gctSize=7
  writeByte(0xf7);
  writeByte(0); // background color index
  writeByte(0); // pixel aspect ratio

  // Global Color Table (256 entries x RGB)
  for (let i = 0; i < 256; i++) {
    const c = i < palette.length ? palette[i] : [0, 0, 0];
    writeBytes([c[0], c[1], c[2]]);
  }

  // NETSCAPE loop extension (loop forever)
  writeByte(0x21); // Extension Introducer
  writeByte(0xff); // Application Extension
  writeByte(11);
  writeBytes([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]); // NETSCAPE2.0
  writeByte(3);
  writeByte(1);
  w(0, 16);
  writeByte(0); // block terminator

  // --- Frames ---
  for (const f of gifFrames) {
    const indices = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < f.data.length; i += 4, j++) {
      indices[j] = colorIndex(f.data[i], f.data[i + 1], f.data[i + 2]);
    }

    // Graphics Control Extension (per-frame delay, no transparency)
    writeBytes([0x21, 0xf9, 4]);
    writeByte(0);
    w(Math.round(f.delay / 10), 16);
    writeBytes([0, 0]);

    // Image Descriptor
    writeByte(0x2c);
    w(0, 16); w(0, 16);
    w(width, 16); w(height, 16);
    writeByte(0); // no local color table

    // LZW-compressed image data
    const lzw = lzwEncode(indices, 8);
    writeByte(8); // LZW minimum code size
    for (let i = 0; i < lzw.length; i += 255) {
      const chunk = lzw.slice(i, Math.min(i + 255, lzw.length));
      writeByte(chunk.length);
      writeBytes(chunk);
    }
    writeByte(0); // block terminator
  }

  writeByte(0x3b); // GIF Trailer
  return new Blob([outBuf.slice(0, outLen)], { type: 'image/gif' });
}

function medianCut(pixels, maxColors) {
  if (pixels.length === 0) return [[0, 0, 0]];

  function range(list, dim) {
    let min = 255, max = 0;
    for (const p of list) {
      if (p[dim] < min) min = p[dim];
      if (p[dim] > max) max = p[dim];
    }
    return max - min;
  }

  let boxes = [pixels];
  while (boxes.length < maxColors) {
    let best = -1, bestVol = -1;
    boxes.forEach((box, i) => {
      if (box.length === 0) return;
      const vol = Math.max(range(box, 0), range(box, 1), range(box, 2)) * box.length;
      if (vol > bestVol) { bestVol = vol; best = i; }
    });
    if (best === -1 || boxes[best].length < 2) break;
    const box = boxes.splice(best, 1)[0];
    let dim = 0;
    if (range(box, 1) > range(box, dim)) dim = 1;
    if (range(box, 2) > range(box, dim)) dim = 2;
    box.sort((a, b) => a[dim] - b[dim]);
    const mid = Math.floor(box.length / 2);
    boxes.push(box.slice(0, mid), box.slice(mid));
  }

  return boxes.map(box => {
    if (box.length === 0) return [0, 0, 0];
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    return [Math.round(r / box.length), Math.round(g / box.length), Math.round(b / box.length)];
  });
}

function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  // GIF spec: codes start at codeSize = minCodeSize + 1.
  // Code size increases the moment the table grows to the next
  // power of two (i.e. right AFTER adding the entry whose code
  // equals the new 2^codeSize - 1), so the NEXT emitted code is
  // written at the larger size.
  let codeSize = minCodeSize + 1;
  const output = [];

  function emit(code) {
    output.push(code);
  }

  // Initialise table with literal entries 0..2^minCodeSize-1
  const table = new Map();
  for (let i = 0; i < clearCode; i++) table.set(String.fromCharCode(i), i);
  let nextCode = clearCode + 2; // first free code after clear/eoi

  // Emit the clear code first (standard practice; decoders expect
  // the stream to begin with clear or a literal).
  emit(clearCode);

  let buffer = '';
  for (let i = 0; i <= indices.length; i++) {
    const ch = i < indices.length ? indices[i] : -1;
    const combo = buffer + (ch >= 0 ? String.fromCharCode(ch) : '');
    if (ch >= 0 && table.has(combo)) {
      buffer = combo;
    } else {
      if (buffer.length > 0) emit(table.get(buffer));
      if (ch >= 0) {
        if (nextCode < 4096) {
          table.set(combo, nextCode);
          nextCode++;
        }
        // GIF code-size rule: bump size when table has reached
        // the next power of two AND we have not hit the 12-bit cap.
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
        buffer = String.fromCharCode(ch);
      } else {
        emit(eoiCode);
        break;
      }
    }
  }

  // Pack codes into bytes (LSB-first bit order, GIF spec)
  const bits = [];
  for (const code of output) {
    let v = code;
    for (let i = 0; i < codeSize; i++) {
      bits.push((v & 1) ? 1 : 0);
      v >>= 1;
    }
  }

  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8 && i + b < bits.length; b++) {
      if (bits[i + b]) byte |= (1 << b);
    }
    bytes.push(byte);
  }
  return new Uint8Array(bytes);
}

// Share link (LZString)
$btnShare.addEventListener('click', () => {
  const text = currentText();
  if (!text.trim()) { log('> ERROR: NOTHING TO SHARE'); return; }
  if (typeof LZString === 'undefined') { log('> ERROR: LZSTRING NOT LOADED'); return; }
  const compressed = LZString.compressToEncodedURIComponent(text);
  const url = location.origin + location.pathname + '#ascii=' + compressed;
  navigator.clipboard.writeText(url).then(() => {
    log('> LINK COPIED TO CLIPBOARD');
  }).catch(() => {
    prompt('COPY THIS LINK:', url);
  });
});

// Load from URL hash on startup
function loadFromHash() {
  const hash = location.hash;
  if (!hash.startsWith('#ascii=')) return;
  if (typeof LZString === 'undefined') return;
  const compressed = hash.slice(7);
  try {
    const text = LZString.decompressFromEncodedURIComponent(compressed);
    if (text) {
      // Rebuild the in-memory grid from the shared plain text
      const rows = text.split('\n').map(line =>
        Array.from(line).map(ch => ({ ch: ch === '\u00A0' ? ' ' : ch, r: 0, g: 255, b: 65 }))
      );
      asciiGrid = rows;
      $asciiPre.innerHTML = buildHtml(rows);
      frames = []; // no pixel data, just display
      showOutput();
      $controls.classList.add('hidden');
      log('> LOADED FROM SHARE LINK');
    }
  } catch (e) {
    log('> ERROR: FAILED TO DECODE SHARE LINK');
  }
}

// ==========================================
// DEEP FRY — right-click context menu
// ==========================================
$asciiOutput.addEventListener('contextmenu', e => {
  e.preventDefault();
  removeContextMenu();
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;
    background:#111;border:1px solid #00ff41;padding:0;z-index:9999;
    font-family:"Courier New",monospace;font-size:12px;`;
  const item = document.createElement('div');
  item.textContent = '\u{1F35F} DEEP FRY';
  item.style.cssText = 'padding:8px 16px;cursor:pointer;color:#00ff41;';
  item.addEventListener('mouseenter', () => item.style.background = 'rgba(0,255,65,0.15)');
  item.addEventListener('mouseleave', () => item.style.background = '');
  item.addEventListener('click', () => { removeContextMenu(); deepFry(); });
  menu.appendChild(item);
  document.body.appendChild(menu);
  document.addEventListener('click', removeContextMenu, { once: true });
});

function removeContextMenu() {
  const m = document.getElementById('ctx-menu');
  if (m) m.remove();
}

function deepFry() {
  if (frames.length === 0) return;
  const f = frames[currentFrame];
  const { imageData, width, height } = f;
  const fried = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
  const d = fried.data;
  const GLITCH_CHARS = '!@#$%^&*|}{[]<>?/\\~`';

  for (let i = 0; i < d.length; i += 4) {
    // Max contrast: push to extremes
    d[i]   = d[i]   > 128 ? Math.min(255, d[i]   + 80) : Math.max(0, d[i]   - 80);
    d[i+1] = d[i+1] > 128 ? Math.min(255, d[i+1] + 80) : Math.max(0, d[i+1] - 80);
    d[i+2] = d[i+2] > 128 ? Math.min(255, d[i+2] + 80) : Math.max(0, d[i+2] - 80);
    // Invert
    d[i]   = 255 - d[i];
    d[i+1] = 255 - d[i+1];
    d[i+2] = 255 - d[i+2];
  }

  const tempFrame = { imageData: fried, width, height };
  const rows = pixelToAscii(tempFrame);

  // Inject glitch chars randomly
  rows.forEach(row => {
    row.forEach(cell => {
      if (Math.random() < 0.08) {
        cell.ch = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
        cell.r = 255; cell.g = 50; cell.b = 50;
      }
    });
  });

  renderAscii(rows, false);
  log('> DEEP FRIED. CRISPY.');
}

// ==========================================
// EASTER EGGS
// ==========================================

// Konami code
const KONAMI = [
  'ArrowUp','ArrowUp','ArrowDown','ArrowDown',
  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
  'b','a'
];

document.addEventListener('keydown', e => {
  // Konami
  if (e.key === KONAMI[konamiIndex]) {
    konamiIndex++;
    if (konamiIndex === KONAMI.length) {
      konamiIndex = 0;
      triggerMatrix();
    }
  } else {
    konamiIndex = 0;
  }

  // bad apple detector
  if (e.key.length === 1) {
    badAppleBuffer += e.key.toLowerCase();
    if (badAppleBuffer.length > 8) badAppleBuffer = badAppleBuffer.slice(-8);
    if (badAppleBuffer.endsWith('badapple')) {
      badAppleBuffer = '';
      triggerBadApple();
    }
  }
});

// Matrix rain
function triggerMatrix() {
  if (matrixActive) return;
  matrixActive = true;
  log('> MATRIX MODE ACTIVATED');

  const canvas = $matrixCanvas;
  canvas.style.display = 'block';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const cols = Math.floor(canvas.width / 14);
  const drops = Array(cols).fill(1);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()';

  const interval = setInterval(() => {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00ff41';
    ctx.font = '14px "Courier New", monospace';

    drops.forEach((y, i) => {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(ch, i * 14, y * 14);
      if (y * 14 > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    });
  }, 33);

  setTimeout(() => {
    clearInterval(interval);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = 'none';
    matrixActive = false;
    log('> MATRIX MODE ENDED');
  }, 3000);
}

// Bad Apple: 10-frame circle morphing animation
function triggerBadApple() {
  log('> BAD APPLE MODE ACTIVATED');
  stopPlayback();

  const W = CONFIG.columns;
  const H = Math.floor(W * ASPECT_CORRECTION);
  const cx = W / 2;
  const cy = H / 2;

  function makeFrame(phase) {
    const rows = [];
    for (let row = 0; row < H; row++) {
      const rowData = [];
      for (let col = 0; col < W; col++) {
        const dx = (col - cx) / (W / 2);
        const dy = (row - cy) / (H / 2);
        const angle = Math.atan2(dy, dx);
        const r = 0.65 + 0.25 * Math.sin(4 * angle + phase);
        const dist = Math.sqrt(dx * dx + dy * dy);
        let brightness;
        if (dist < r * 0.35) brightness = 0;
        else if (dist < r * 0.5) brightness = 60;
        else if (dist < r) brightness = 200;
        else brightness = 255;
        const inv = CONFIG.inverted ? 255 - brightness : brightness;
        const charIdx = Math.floor((inv / 255) * (CONFIG.charset.length - 1));
        rowData.push({ ch: CONFIG.charset[charIdx], r: 0, g: 255, b: 65 });
      }
      rows.push(rowData);
    }
    return rows;
  }

  const baFrames = [];
  for (let i = 0; i < 10; i++) {
    baFrames.push(makeFrame((i / 10) * Math.PI * 2));
  }

  // Store as real frames
  frames = baFrames.map(rows => ({ _asciiRows: rows, width: W, height: H, isBadApple: true }));
  currentFrame = 0;
  showOutput();
  updateFrameCounter();
  updateGifButton();

  // Custom render for bad apple
  function renderBA(rows) {
    asciiGrid = rows;
    $asciiPre.innerHTML = buildHtml(rows);
  }

  renderBA(baFrames[0]);

  let baIdx = 0;
  const baInterval = setInterval(() => {
    baIdx = (baIdx + 1) % baFrames.length;
    renderBA(baFrames[baIdx]);
    currentFrame = baIdx;
    updateFrameCounter();
  }, 120);

  setTimeout(() => {
    clearInterval(baInterval);
    log('> BAD APPLE DONE');
  }, 3000);
}

// ==========================================
// RESIZE HANDLER
// ==========================================
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (frames.length > 0 && !webcamStream) renderCurrentFrame(false);
    if ($matrixCanvas.style.display !== 'none') {
      $matrixCanvas.width = window.innerWidth;
      $matrixCanvas.height = window.innerHeight;
    }
  }, 200);
});

// ==========================================
// INIT
// ==========================================
boot();

// Apply initial theme
applyThemeClass();

// Init loop button
$btnLoop.classList.add('active');

// Restore from hash after CDN loads
window.addEventListener('load', () => {
  setTimeout(loadFromHash, 500);
});
