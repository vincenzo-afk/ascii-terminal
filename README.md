# ASCII Cinema

[![version](https://img.shields.io/badge/version-2.0-green)](https://github.com/vincenzo-afk/ascii-terminal/releases)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/vincenzo-afk/ascii-terminal)](https://github.com/vincenzo-afk/ascii-terminal/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/vincenzo-afk/ascii-terminal)](https://github.com/vincenzo-afk/ascii-terminal/issues)

> **Turn any image, GIF, or video into animated ASCII art — rendered live in a retro CRT terminal, then copy-pasted, shared, or exported anywhere.**

ASCII Cinema is a high-performance, zero-dependency, single-page web application that converts visual media into live ASCII art. Designed with a focus on **portability** and **retro aesthetics**, it simulates a classic green-phosphor CRT terminal while providing modern export capabilities that ensure your art looks perfect in any monospaced environment.

---

## 🚀 Key Features

| Feature | Description |
| :--- | :--- |
| **Multi-Format Support** | Convert PNG, JPG, WebP, animated GIFs, and MP4 videos live. |
| **Live Webcam Mode** | Real-time ASCII rendering of your camera feed with low latency. |
| **Portability Engine** | Guaranteed fixed-width output (40-160 cols) for perfect copy-pasting. |
| **Retro CRT Effects** | Customizable scanlines, vignette, phosphor glow, and static noise. |
| **Native GIF Encoder** | Built-in LZW + median-cut quantization encoder for high-quality GIF exports. |
| **Easter Eggs** | Konami code for Matrix rain, `badapple` animation, and "Deep Fry" mode. |

---

## 🛠 How to Use

1.  **Launch**: Open `index.html` in any modern web browser. No installation or server required.
2.  **Import**: Drag and drop a file onto the terminal, or use the **OPEN FILE** / **LIVE CAM** buttons.
3.  **Configure**: Use the ⚙ **CONFIG** panel to adjust charset, color themes (Green, Amber, White, Full Color), and resolution.
4.  **Export**: 
    *   **COPY TEXT**: One-click copy of the exact grid.
    *   **HTML**: Self-contained file with embedded font metrics.
    *   **GIF/PNG/TXT**: Downloadable formats for sharing.
    *   **SHARE LINK**: A compressed URL containing your art.

---

## 📐 Portability Contract

The core design goal of ASCII Cinema is: **What you see is what you get.**

Unlike other converters that suffer from collapsed whitespace or variable wrapping, ASCII Cinema uses an in-memory character grid. Every export format (Copy, TXT, HTML) derives from this same grid, ensuring that:
*   Trailing spaces are preserved as real characters.
*   Line lengths are strictly enforced to the selected resolution.
*   HTML exports embed `line-height` and `letter-spacing` to maintain visual proportions.

---

## 🏗 Technical Architecture

1.  **Sampling**: Media is drawn to an off-screen `<canvas>` and read as raw RGBA data.
2.  **Mapping**: Luminance is calculated via `0.299R + 0.587G + 0.114B` and mapped to a 10-step or custom charset.
3.  **Correction**: A **0.45 aspect correction factor** compensates for monospace character height-to-width ratios.
4.  **Rendering**: The grid is rendered as colored `<span>` elements inside a `<pre>` tag for maximum performance.

---

## 📦 Project Structure

```text
ascii-terminal/
├── index.html     # SPA Markup + CDN dependencies (lz-string, html2canvas, omggif)
├── style.css      # CRT styling, phosphor themes, and config UI
├── app.js         # Core engine: pixel mapping, GIF encoder, and playback logic
├── scripts/       # Unit and functional test suites
├── LICENSE        # MIT License
└── README.md      # Documentation
```

---

## 🧪 Development & Testing

ASCII Cinema includes a comprehensive test suite to ensure engine stability.

```bash
# Install dependencies (for testing only)
npm install

# Run all tests
npm test
```

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

Copyright (c) 2026 **BHARANI KUMAR S** (vincenzo-afk)
