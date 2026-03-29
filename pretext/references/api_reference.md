# @chenglou/pretext API Reference

## Installation
```bash
npm install @chenglou/pretext
```
CDN: `https://esm.sh/@chenglou/pretext`

## Two-Phase Architecture

**Phase 1 — prepare()**: Expensive one-time analysis (~0.4ms per text). Runs `Intl.Segmenter`, canvas `measureText()`, emoji correction, bidi analysis. Returns opaque handle.

**Phase 2 — layout()**: Pure arithmetic over cached widths (~0.01ms). No DOM reads, no canvas calls, no string allocation. Safe to call 60+ times per second.

## API

### Use Case 1: Height Measurement

```js
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('Text here', '16px Inter')
const { height, lineCount } = layout(prepared, maxWidth, lineHeight)
```

Options: `{ whiteSpace: 'pre-wrap' }` for textarea-compatible mode.

### Use Case 2: Line-Level Layout

```js
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const prepared = prepareWithSegments('Text here', '18px "Helvetica Neue"')
const { lines, height, lineCount } = layoutWithLines(prepared, maxWidth, lineHeight)

for (let i = 0; i < lines.length; i++) {
  ctx.fillText(lines[i].text, 0, i * lineHeight)
}
```

### Use Case 3: Shrink-Wrap (walkLineRanges)

```js
import { walkLineRanges } from '@chenglou/pretext'

let maxW = 0
const count = walkLineRanges(prepared, maxWidth, (line) => {
  if (line.width > maxW) maxW = line.width
})
// maxW = tightest bounding width, count = number of lines
```

Allocation-free — no string materialization. Callback receives `LayoutLineRange` (width, start, end) without `.text`.

### Use Case 4: Variable-Width Lines (layoutNextLine)

```js
import { layoutNextLine } from '@chenglou/pretext'

let cursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0

while (true) {
  // Different width per line — text flows around obstacles
  const width = y < image.bottom ? columnWidth - image.width : columnWidth
  const line = layoutNextLine(prepared, cursor, width)
  if (line === null) break
  ctx.fillText(line.text, 0, y)
  cursor = line.end
  y += lineHeight
}
```

## Types

```ts
type LayoutLine = {
  text: string          // Line content
  width: number         // Measured width
  start: LayoutCursor   // Inclusive start
  end: LayoutCursor     // Exclusive end
}

type LayoutLineRange = {
  width: number
  start: LayoutCursor
  end: LayoutCursor
}

type LayoutCursor = {
  segmentIndex: number
  graphemeIndex: number
}
```

## Utilities

- `clearCache()` — Clear internal caches when cycling fonts
- `setLocale(locale?)` — Set locale, calls clearCache() internally

## Constraints

- Font string must be named fonts (avoid `system-ui` on macOS — resolves to different optical variants)
- Default: `white-space: normal`, `word-break: normal`, `overflow-wrap: break-word`
- Very narrow widths break at grapheme boundaries only
- `{ whiteSpace: 'pre-wrap' }` preserves spaces, tabs, hard breaks (tab-size: 8)

## Internals (for advanced use)

- Segments via `Intl.Segmenter` with `granularity: 'word'`
- CJK: per-character segments with kinsoku shori rules
- Bidi: UAX #9 embedding levels for Arabic/Hebrew
- Caching: module-scoped `Map<font, Map<segment, metrics>>`
- Emoji correction: one-time per-font DOM read for Chrome/Firefox macOS inflation
- Line fit: `lineFitEpsilon` for sub-pixel floating-point tolerance
