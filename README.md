# ASCII CINEMA

> **Turn any image, GIF, or video into animated ASCII art — rendered live in a retro CRT terminal, then copy-pasted, shared, or exported anywhere.**

![version](https://img.shields.io/badge/version-2.0-green)
![license](https://img.shields.io/badge/license-MIT-blue)
![size](https://img.shields.io/badge/size-~30%20KB-lightgrey)
![works](https://img.shields.io/badge/works-offline%20|%20no%20backend-orange)

---

## Description

**ASCII CINEMA** is a zero-dependency, single-page web app that converts images, animated GIFs, and videos into live ASCII art displayed inside a CRT-styled terminal. Every frame is sampled into a character grid, brightness-mapped to a configurable charset, and rendered as colored `<span>` elements — exactly like the green-phosphor terminals of the '80s.

What makes it different is **portability**. The plain-text output is a fixed-width character grid with a consistent column count, so when you copy it and paste it into any other terminal, editor, or monospaced environment of the same column size, it aligns perfectly — no broken wrapping, no collapsed spaces, no scrambled rows. Exports (PNG, HTML, TXT, GIF, shareable link) all derive from the same in-memory grid, so the copied output is byte-for-byte identical to what you see on screen.

---

## Topics

`ascii-art` `terminal` `crt` `retro` `image-to-ascii` `video-to-ascii` `gif-generator` `animation` `javascript` `html5-canvas` `no-backend`

---

## Features

| Feature | What it does |
|---|---|
| Image → ASCII | Drop any image (PNG, JPG, WebP, etc.) and watch it render live |
| GIF → animated ASCII | Decodes every frame of an animated GIF |
| Video → animated ASCII | Samples up to 60 frames from any video file |
| Live webcam mode | Real-time ASCII rendering of your camera feed |
| Color modes | Green, Amber, White, Full Color, and Inverted terminal themes |
| Charsets | Classic, Dense (shading blocks), Braille, or fully custom |
| Resolution control | 40 / 80 / 120 / 160 columns — paste into a matching terminal |
| Playback controls | Play, pause, prev/next frame, loop toggle, FPS slider |
| Copy & paste | One click copies the exact grid you see on screen |
| Export HTML | Self-contained HTML with embedded font metrics so the art keeps its exact size in any browser or terminal |
| Export TXT / PNG / GIF | Download the art as plain text, an image, or an animated GIF |
| Share link | Compresses the ASCII art into a URL you can send to anyone |
| CRT effects | Scanlines, vignette, phosphor glow, static-noise background |
| Easter eggs | Konami code triggers Matrix rain; typing `badapple` plays an ASCII circle animation; right-click the art to Deep Fry it |

---

## How to use

1. **Open `index.html`** in any modern browser — no server, no install, no build step. You can also just double-click the file.
2. **Drop an image or video** onto the terminal, or click **OPEN FILE** to browse, or **LIVE CAM** to stream your webcam.
3. **Adjust the look** with the ⚙ CONFIG panel (top-right): charset, color mode, font size, background, and column resolution.
4. **Play the animation** with the playback bar at the bottom; tune the FPS with the slider.
5. **Copy & paste anywhere**: hit **COPY TEXT** and paste into any terminal of the same column count — the art stays aligned.
6. **Export** as PNG, HTML, TXT, or GIF, or generate a **share link**.

---

## Copy-paste portability

The core design goal: **what you copy is what you get, in any terminal of the same size.**

- The rendered grid always has exactly `columns` characters per row (40–160, your choice).
- Trailing spaces are preserved — they are real spaces, not collapsed whitespace.
- All exports (copy, TXT, share link, HTML) read from the same in-memory character grid, never from the DOM, so spacing can never drift.
- The exported HTML embeds the exact `font-size`, `line-height`, and `letter-spacing` used on screen, so opening it anywhere reproduces the same visual proportions.

> **Tip:** if your target terminal is 80 columns wide, select **80** in the RESOLUTION setting before copying. The pasted art will then wrap-correctly at column boundaries.

---

## How it works

1. The source media is drawn onto an off-screen `<canvas>` and read back as raw pixel data.
2. Each pixel block (cell) is averaged for RGB brightness using the luminance formula `0.299R + 0.587G + 0.114B`.
3. Brightness is mapped to a character from the chosen charset — darkest cells get dense characters (`@`, `#`), brightest get light ones (` `. , `:`).
4. A vertical **aspect correction factor (0.45)** compensates for the fact that monospace characters are roughly twice as tall as wide, keeping the art from looking stretched.
5. Characters are written into a `<pre>` as individually colored `<span>` elements, producing the glowing terminal look.
6. GIF export uses a **native LZW + median-cut quantization encoder** built into `app.js` — no external worker scripts required.

---

## Project structure

```
ascii-terminal/
├── index.html     # Single-page app markup + CDN libraries (lz-string, html2canvas, omggif)
├── style.css      # CRT styling, themes (green/amber/white/color), config panel, responsive layout
├── app.js         # All logic: pixel engine, renderer, playback, webcam, exports, GIF encoder, easter eggs
├── LICENSE        # MIT
└── README.md      # You are here
```

---

## Browser support

Works in all modern browsers (Chrome, Firefox, Safari, Edge). The webcam feature requires a camera and an HTTPS or `localhost` context. Everything else works fully offline once the page is loaded.

---

## Changelog (v2.0)

**Bug fixes**

- GIF export is now fully functional — v1.0 shipped with a broken writer (`new GIF()` from `gif.js` never existed on `window` and threw on click). Replaced with a native LZW + median-cut encoder built into the app.
- Removed duplicate `id="matrix-canvas"` attribute that appeared twice on the same element.
- Fixed webcam capture loop so it reliably stops when **STOP CAM** is pressed (previously the animation frame could leak).
- Fixed duplicate stop-cam button appearing after restarting the camera.
- GIF encoding progress bar now reports accurate 0–100%.
- Copy/TXT/share exports now derive from the in-memory character grid instead of `innerText`, guaranteeing spacing is preserved across all browsers.
- Inverted color mode now routes through the same style switch as the other modes (single source of truth).
- Removed stray orphaned line left over from v1.0 source.
- Transparent pixels in images now render as empty space instead of dark characters.

**Improvements**

- Exported HTML now embeds the exact font size, line height, and letter spacing, so the art keeps its size in any terminal or browser.
- Cleaner code organization with documented sections and a changelog-style bug-fix list at the top of `app.js`.
- Better README: description, topics, feature table, usage guide, and architecture notes.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

Copyright (c) 2026 BHARANI KUMAR S
