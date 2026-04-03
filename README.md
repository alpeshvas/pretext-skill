# pretext-pdfjs

Fuses [PDF.js](https://mozilla.github.io/pdf.js/) rendering with [@chenglou/pretext](https://github.com/chenglou/pretext) text layout — responsive reflow, pixel-accurate text layers, smart annotations, and character-level search highlighting for PDFs on canvas.

## Why

PDF.js renders PDFs and extracts text. Pretext measures and lays out text in ~0.01ms without DOM reflows. Together they solve problems neither handles alone:

| Problem | PDF.js Alone | With Pretext |
|---|---|---|
| Responsive text reflow | Re-render entire page | Fast relayout (~0.01ms) |
| Text overlay alignment | CSS-based, often drifts | Canvas measureText-based, precise |
| Annotation text sizing | Manual DOM measurement | Auto-layout with prepareWithSegments |
| Search hit highlighting | Approximate DOM rects | Pixel-perfect character positions |
| Readable thumbnails | Blurry shrink | Reflowed text at any size |

## Install

```bash
npm install pretext-pdfjs pdfjs-dist @chenglou/pretext
```

Both `pdfjs-dist` and `@chenglou/pretext` are peer dependencies.

## Quick Start

```js
import { loadDocument } from 'pretext-pdfjs'

const doc = await loadDocument('paper.pdf')
const page = await doc.getPage(1)

// Render PDF page to canvas with HiDPI
await page.renderToCanvas(canvas, { scale: 2 })

// Enhanced text layer (pretext-measured positioning)
const textLayer = await page.createTextLayer(container, { scale: 2 })

// Reflow text at any width — call again on resize, it's ~0.01ms
const reflowed = await page.reflowText(400, { lineHeight: 24 })

// Render reflowed text to a separate canvas
await page.renderReflowedText(readerCanvas, 400, {
  lineHeight: 24,
  background: '#fff',
})

// Search with character-level highlight rects
const hits = await page.search('quantum')
textLayer.highlightSearchResults(hits)

// Readable thumbnails via text reflow
await page.thumbnail(thumbCanvas, { width: 150, reflowText: true })

// Annotation text sizing
const annotations = await page.getAnnotations({ maxWidth: 250 })
// annotations[0].textBounds.height → exact popup height

// Search across all pages (async generator)
for await (const hit of doc.searchAll('entropy')) {
  console.log(`Page ${hit.pageNum}: "${hit.text}"`)
}
```

## API

### `loadDocument(src, options?)`

Load a PDF with pretext capabilities. Returns `PretextDocument`.

```ts
const doc = await loadDocument(url | ArrayBuffer | Uint8Array, {
  workerSrc: '...',         // PDF.js worker URL (auto-detected)
  defaultFont: 'sans-serif', // Fallback CSS font for unmapped PDF fonts
  fontMap: { 'g_d0_f1': '"Inter"' }, // Manual PDF → CSS font overrides
  cacheSize: 50,            // Max pages in prepare cache
})
```

### `PretextDocument`

| Method | Description |
|---|---|
| `getPage(num)` | Get a `PretextPage` |
| `searchAll(query, opts?)` | Async generator of `SearchHit` across all pages |
| `preparePages(start, end)` | Pre-warm cache for a page range |
| `getMetadata()` | Document metadata |
| `numPages` | Total page count |
| `cacheStats` | Cache statistics |
| `clearCache()` | Evict all cached prepare handles |
| `destroy()` | Clean up resources |
| `pdf` | Escape hatch to raw `PDFDocumentProxy` |

### `PretextPage`

| Method | Description |
|---|---|
| `renderToCanvas(canvas, opts?)` | Render page with HiDPI setup |
| `createTextLayer(container, opts?)` | Enhanced text layer with pretext positioning |
| `reflowText(maxWidth, opts?)` | Reflow text at any width |
| `renderReflowedText(canvas, maxWidth, opts?)` | Reflow + render to canvas |
| `search(query, opts?)` | Character-level search |
| `getAnnotations(opts?)` | Annotations with pretext-measured text bounds |
| `thumbnail(canvas, opts?)` | Thumbnail with optional text reflow |
| `getTextContent()` | Access prepared text content |
| `pdfPage` | Escape hatch to raw `PDFPageProxy` |

### `PretextTextLayer`

| Method | Description |
|---|---|
| `render()` | Build the text layer DOM |
| `update(newScale)` | Update positions on scale change |
| `highlightSearchResults(hits)` | Highlight search matches |
| `clearHighlights()` | Remove highlights |
| `destroy()` | Remove the text layer |

### Utilities

```js
import {
  configureWorker,    // Manual worker setup
  setupHiDPICanvas,   // HiDPI canvas helper
  fontSizeFromTransform, // Extract font size from PDF transform matrix
  pageToViewport,     // PDF coords → viewport coords
  baselineOffset,     // Alphabetic baseline within line height
  PDF_TO_CSS,         // 96/72 conversion factor
  FontMapper,         // PDF font → CSS font mapping
  PrepareCache,       // LRU cache for prepare handles
} from 'pretext-pdfjs'
```

## Architecture

```
loadDocument(src)
  → PretextDocument (wraps PDFDocumentProxy)
    → PretextPage (wraps PDFPageProxy)
      → renderToCanvas()      — PDF.js render + HiDPI
      → createTextLayer()     — pretext-measured positioning
      → reflowText()          — pretext layout at any width
      → search()              — character-level precision
      → getAnnotations()      — pretext-sized text bounds
      → thumbnail()           — optional text reflow mode
```

**Caching**: `prepare()` runs once per page (~0.4ms), cached in an LRU (default 50 pages). `layout()` runs on every resize (~0.01ms) — safe at 60fps.

**Font mapping**: PDF internal font names are mapped to CSS font strings via heuristics + user overrides. The font string must match between pretext's `prepare()` and canvas `ctx.font`.

## Claude Code Skill

This repo also includes a Claude Code skill for `@chenglou/pretext`. To install:

```bash
cd ~/.claude/skills
git clone git@github.com:alpeshvas/pretext-skill.git pretext
```

## License

MIT
