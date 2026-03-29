---
name: pretext
description: Build with @chenglou/pretext — a pure JS library for multiline text measurement and layout without DOM reflows. Use when importing or working with @chenglou/pretext, building canvas-rendered text, measuring text height without DOM, implementing variable-width text reflow, rendering text to canvas/SVG/WebGL, or building interactive text-heavy UIs that need jank-free layout. Also use when the user mentions "pretext", "text layout without DOM", or "canvas text rendering".
---

# @chenglou/pretext Integration

Pure JS text measurement and layout. Two-phase: expensive `prepare()` once, then cheap `layout()` on every resize/reflow. No DOM reads in the hot path.

For full API details: see [references/api_reference.md](references/api_reference.md).

## Import

```js
import {
  prepare, layout,                    // height measurement
  prepareWithSegments, layoutWithLines, // line-level layout
  layoutNextLine,                      // variable-width per line
  walkLineRanges,                      // allocation-free iteration
} from '@chenglou/pretext'
// CDN: https://esm.sh/@chenglou/pretext
```

## Choosing the Right API

| Need | API | Returns |
|---|---|---|
| Text height/line count only | `prepare` + `layout` | `{ height, lineCount }` |
| Render lines on canvas/SVG | `prepareWithSegments` + `layoutWithLines` | `{ lines[], height, lineCount }` |
| Text flowing around obstacles | `prepareWithSegments` + `layoutNextLine` | `LayoutLine \| null` per iteration |
| Tight bounding box / count | `prepareWithSegments` + `walkLineRanges` | line count (callback per line) |

## Canvas Text Rendering Pattern

The core pattern for rendering Pretext-laid-out text on canvas:

```js
const FONT = '20px "JetBrains Mono"'
const LINE_HEIGHT = 44

// Phase 1: prepare (do once)
const prepared = prepareWithSegments(text, FONT)

// Phase 2: layout (redo on resize, reflow — it's cheap)
const { lines } = layoutWithLines(prepared, containerWidth, LINE_HEIGHT)

// Phase 3: render each character with measured positions
ctx.font = FONT
for (let li = 0; li < lines.length; li++) {
  const line = lines[li]
  const y = li * LINE_HEIGHT
  // Per-character positioning via ctx.measureText within line
  for (let ci = 0; ci < line.text.length; ci++) {
    const x = ctx.measureText(line.text.substring(0, ci)).width
    ctx.fillText(line.text[ci], PAD + x, PAD + y + baselineOffset)
  }
}
```

## Character-to-Line Mapping

Map original text indices to canvas positions by walking Pretext's lines:

```js
function buildCharPositions(text, lines, ctx, lineHeight, padX, padY) {
  const positions = []
  let consumed = 0
  for (let li = 0; li < lines.length; li++) {
    const lt = lines[li].text
    for (let ci = 0; ci < lt.length; ci++) {
      const xBefore = ctx.measureText(lt.substring(0, ci)).width
      const xAfter = ctx.measureText(lt.substring(0, ci + 1)).width
      positions[consumed++] = {
        x: padX + xBefore, y: padY + li * lineHeight,
        w: xAfter - xBefore, lineIdx: li,
      }
    }
    // Handle inter-line space (consumed by line break)
    if (consumed < text.length && text[consumed] === ' ') {
      positions[consumed++] = {
        x: padX + lines[li].width, y: padY + li * lineHeight,
        w: ctx.measureText(' ').width, lineIdx: li,
      }
    }
  }
  return positions
}
```

## Variable-Width Reflow (layoutNextLine)

Text that flows around obstacles — different width per line:

```js
function reflowWithObstacle(prepared, baseWidth, obstacleWidth, obstacleLines) {
  let cursor = { segmentIndex: 0, graphemeIndex: 0 }
  const lines = []
  let lineIdx = 0
  while (true) {
    const w = lineIdx < obstacleLines ? baseWidth - obstacleWidth : baseWidth
    const line = layoutNextLine(prepared, cursor, w)
    if (!line) break
    lines.push({ ...line, maxWidth: w })
    cursor = line.end
    lineIdx++
  }
  return lines
}
```

This is extremely cheap to call repeatedly (sidebar growing, window resizing, elements animating).

## HiDPI Canvas Setup

Critical for sharp text rendering:

```js
const dpr = window.devicePixelRatio || 1
canvas.width = containerWidth * dpr
canvas.height = containerHeight * dpr
canvas.style.width = containerWidth + 'px'
canvas.style.height = containerHeight + 'px'
ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
```

The font string passed to Pretext must exactly match `ctx.font` on the rendering canvas.

## Key Gotchas

- **Font string must match exactly** between `prepare*()` and `ctx.font` — otherwise positions drift
- **Use named fonts**, not `system-ui` (macOS resolves to different optical variants at different sizes)
- **`prepare()` is cached** — calling it again with the same text+font is fast (~0.1ms vs ~0.4ms first call)
- **`layout()` is pure arithmetic** — safe to call in rAF, resize handlers, animation loops (60+ reflows/sec is fine)
- **Inter-line spaces** are consumed by line breaks — when mapping characters to positions, account for spaces between lines not appearing in either line's `.text`
- **`walkLineRanges` vs `layoutWithLines`** — use `walkLineRanges` when you don't need `.text` strings (saves allocations)
- **Baseline offset** — `ctx.fillText` with `textBaseline = 'alphabetic'` needs baseline calculation: roughly `lineHeight * 0.68`
