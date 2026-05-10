/* ==========================================
   ASCII CINEMA v1.0 — app.js
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

const CHARSETS = {
  classic: ' .:-=+*#%@',
  dense:   ' \u2591\u2592\u2593\u2588',
  braille: ' \u2801\u2802\u2803\u2804\u2805\u2806\u2807\u2808\u2809\u280a\u280b\u280c\u280d\u280e\u280f\u2810\u2811\u2812\u2813\u2814\u2815\u2816\u2817\u2818\u2819\u281a\u281b\u281c\u281d\u281e\u281f\u2820\u2821\u2822\u2823\u2824\u2825\u2826\u2827\u2828\u2829\u282a\u282b\u282c\u282d\u282e\u282f\u2838\u2839\u283a\u283b\u283c\u283d\u283e\u283f',
};

// ==========================================
// STATE
// ==========================================
let frames = [];          // { imageData, width, height }[]
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
const $asciiPREouter = document.getElementById('ascii-output');

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
    'ASCII CINEMA v1.0 ............. LOADING',
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
  currentFrame = 0;

  const t0 = performance.now();
  log('> LOADING FILES...');

  for (const file of fileList) {
    if (file.type.startsWith('image/')) {
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
  log(`> FILE LOADED: ${fileList[0].name} (${f.width}x${f.height}) — ${frames.length} frame(s) in ${elapsed}ms`);

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

function extractVideoFrames(file, maxFrames = 60) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    const collected = [];

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
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
// ASCII ENGINE — pixel → char conversion
// ==========================================
function pixelToAscii(frameObj) {
  const { imageData, width, height } = frameObj;
  const cols = CONFIG.columns;
  const cellW = width / cols;
  const rows = Math.floor(cols * (height / width) * 0.45);
  const cellH = height / rows;
  const data = imageData.data;
  const charset = CONFIG.charset;
  const inv = CONFIG.inverted;

  const result = [];

  for (let row = 0; row < rows; row++) {
    const rowData = [];
    for (let col = 0; col < cols; col++) {
      const px = Math.floor(col * cellW);
      const py = Math.floor(row * cellH);
      const idx = (py * width + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      let brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      if (inv) brightness = 255 - brightness;
      const charIdx = Math.floor((brightness / 255) * (charset.length - 1));
      rowData.push({ ch: charset[charIdx], r, g, b });
    }
    result.push(rowData);
  }

  return result;
}

// ==========================================
// RENDER — writes to <pre> with colored spans
// ==========================================
function renderAscii(asciiRows, animate) {
  if (renderAnimTimeout) {
    clearTimeout(renderAnimTimeout);
    renderAnimTimeout = null;
  }

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
  return row.map(cell => {
    const style = getCharStyle(cell.r, cell.g, cell.b);
    const ch = cell.ch === ' ' ? '&nbsp;' : escHtml(cell.ch);
    return `<span style="${style}">${ch}</span>`;
  }).join('');
}

function getCharStyle(r, g, b) {
  switch (CONFIG.colorMode) {
    case 'green':    return 'color:#00ff41';
    case 'amber':    return 'color:#ffb000';
    case 'white':    return 'color:#ffffff';
    case 'color':    return `color:rgb(${r},${g},${b})`;
    case 'inverted': return `color:rgb(${255-r},${255-g},${255-b})`;
    default:         return 'color:#00ff41';
  }
}

function escHtml(ch) {
  if (ch === '&') return '&amp;';
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
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

  // Add stop-cam button to toolbar
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
// ==========================================

// Copy text
$btnCopy.addEventListener('click', () => {
  const text = $asciiPre.innerText;
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

// Export HTML
$btnHtml.addEventListener('click', () => {
  const pre = $asciiPre.outerHTML;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>ASCII Cinema Export</title>
<style>
  body { margin: 0; background: #0a0a0a; display: flex; justify-content: center; align-items: flex-start; padding: 20px; }
  pre { font-family: "Courier New", monospace; font-size: ${CONFIG.fontSize}px; line-height: 1.0; letter-spacing: 0px; white-space: pre; margin: 0; }
</style>
</head>
<body>${pre}</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const link = document.createElement('a');
  link.download = 'ascii-art.html';
  link.href = URL.createObjectURL(blob);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  log('> HTML EXPORTED: ascii-art.html');
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
  const rows = Math.floor(cols * (firstFrame.height / firstFrame.width) * 0.45);
  const cellH = firstFrame.height / rows;

  // Render each frame to a canvas
  const gifWidth = cols * Math.ceil(CONFIG.fontSize * 0.6);
  const gifHeight = rows * CONFIG.fontSize;

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: gifWidth,
    height: gifHeight,
    workerScript: 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js',
  });

  const offC = document.createElement('canvas');
  offC.width = gifWidth;
  offC.height = gifHeight;
  const ctx = offC.getContext('2d');

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
        else if (CONFIG.colorMode === 'color') color = `rgb(${cell.r},${cell.g},${cell.b})`;
        else if (CONFIG.colorMode === 'inverted') color = `rgb(${255-cell.r},${255-cell.g},${255-cell.b})`;
        ctx.fillStyle = color;
        ctx.fillText(cell.ch, ci * charW, ri * CONFIG.fontSize);
      });
    });

    gif.addFrame(offC, { copy: true, delay: Math.round(1000 / CONFIG.fps) });
    const pct = Math.round(((fi + 1) / frames.length) * 60);
    $gifProgBar.style.width = pct + '%';
    $gifProgLabel.textContent = `ENCODING GIF... ${pct}%`;
  });

  gif.on('progress', p => {
    const pct = 60 + Math.round(p * 40);
    $gifProgBar.style.width = pct + '%';
    $gifProgLabel.textContent = `ENCODING GIF... ${pct}%`;
  });

  gif.on('finished', blob => {
    const link = document.createElement('a');
    link.download = 'ascii-cinema.gif';
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    $gifProgress.classList.add('hidden');
    log('> GIF SAVED: ascii-cinema.gif');
  });

  gif.render();
}

// Share link (LZString)
$btnShare.addEventListener('click', () => {
  const text = $asciiPre.innerText;
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
      $asciiPre.textContent = text;
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
  item.textContent = '&#127830; DEEP FRY';
  item.innerHTML = '&#127830; DEEP FRY';
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
  const H = Math.floor(W * 0.45);
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