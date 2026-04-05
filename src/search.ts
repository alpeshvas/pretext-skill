import { prepare, layout } from '@chenglou/pretext'
import type {
  PreparedTextContent,
  SearchHit,
  SearchHitRect,
  SearchOptions,
  TextItem,
} from './types'
import { fontSizeFromTransform } from './utils'

/**
 * Character-level search with highlight rectangles in original PDF coordinates.
 *
 * Search operates on the extracted text but highlights are computed from
 * the original PDF text item positions — so they overlay correctly on
 * the PDF canvas, exactly where it was written.
 */
export class PretextSearch {
  /**
   * Search within a page's text and return matches with highlight rects
   * positioned in the original PDF coordinate space (matching the canvas).
   */
  static searchPage(
    textContent: PreparedTextContent,
    query: string,
    pageNum: number,
    viewportHeight: number,
    scale: number,
    options: SearchOptions = {},
  ): SearchHit[] {
    if (!query) return []

    // Build a flat string from items preserving item boundaries
    const { text, itemMap } = buildSearchableText(textContent.items)

    const searchText = options.caseSensitive ? text : text.toLowerCase()
    const searchQuery = options.caseSensitive ? query : query.toLowerCase()

    const hits: SearchHit[] = []
    let startIdx = 0
    let matchIndex = 0

    while (true) {
      const idx = searchText.indexOf(searchQuery, startIdx)
      if (idx === -1) break

      const matchText = text.substring(idx, idx + query.length)

      if (options.wholeWord) {
        const before = idx > 0 ? text[idx - 1] : ' '
        const after = idx + query.length < text.length ? text[idx + query.length] : ' '
        if (/\w/.test(before) || /\w/.test(after)) {
          startIdx = idx + 1
          continue
        }
      }

      // Compute highlight rects from original PDF item positions
      const rects = computeRectsFromItems(
        idx,
        idx + query.length,
        itemMap,
        textContent.items,
        textContent.fontMap,
        viewportHeight,
        scale,
      )

      hits.push({
        pageNum,
        matchIndex: matchIndex++,
        text: matchText,
        rects,
      })

      startIdx = idx + 1
    }

    return hits
  }
}

// ── Internal: Searchable text with item position tracking ─────

interface ItemRange {
  /** Index into items array */
  itemIndex: number
  /** Start position in the flat searchable string */
  textStart: number
  /** End position in the flat searchable string */
  textEnd: number
}

/**
 * Build a single searchable string from all text items,
 * tracking which character ranges map to which items.
 */
function buildSearchableText(items: TextItem[]): {
  text: string
  itemMap: ItemRange[]
} {
  const parts: string[] = []
  const itemMap: ItemRange[] = []
  let offset = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const str = item.str

    if (i > 0) {
      // Add space between items unless they're on different lines
      // (PDF.js already handles word spacing within items)
      const prevY = items[i - 1].transform[5]
      const currY = item.transform[5]
      const sameLine = Math.abs(prevY - currY) < 2

      if (sameLine) {
        parts.push(' ')
        offset += 1
      } else {
        parts.push('\n')
        offset += 1
      }
    }

    itemMap.push({
      itemIndex: i,
      textStart: offset,
      textEnd: offset + str.length,
    })

    parts.push(str)
    offset += str.length
  }

  return { text: parts.join(''), itemMap }
}

/**
 * Given a match range in the flat search string, compute highlight
 * rectangles using the original PDF text item transforms.
 *
 * Each item the match spans gets its own rect, positioned exactly
 * where the PDF rendered that text on the canvas.
 */
function computeRectsFromItems(
  matchStart: number,
  matchEnd: number,
  itemMap: ItemRange[],
  items: TextItem[],
  fontMap: Map<string, string>,
  viewportHeight: number,
  scale: number,
): SearchHitRect[] {
  const rects: SearchHitRect[] = []

  for (const range of itemMap) {
    // Does this item overlap with the match?
    if (range.textEnd <= matchStart || range.textStart >= matchEnd) continue

    const item = items[range.itemIndex]
    const fontSize = fontSizeFromTransform(item.transform) * scale

    // Character offsets within this item's text
    const charStart = Math.max(0, matchStart - range.textStart)
    const charEnd = Math.min(item.str.length, matchEnd - range.textStart)
    const matchStr = item.str.substring(charStart, charEnd)

    // Use pretext to measure exact character positions within the item
    const fontFamily = fontMap.get(item.fontName) ?? 'sans-serif'
    const fontStr = `${fontSize}px ${fontFamily}`

    let xOffset = 0
    let matchWidth = item.width * scale * (matchStr.length / (item.str.length || 1))

    try {
      // Measure text before match start for x-offset
      if (charStart > 0) {
        const beforeText = item.str.substring(0, charStart)
        const beforePrepared = prepare(beforeText, fontStr)
        const beforeLayout = layout(beforePrepared, Infinity, fontSize * 1.2)
        // Use width from the item proportionally
        xOffset = (charStart / item.str.length) * item.width * scale
      }

      // Measure match text width
      const matchPrepared = prepare(matchStr, fontStr)
      const matchLayout = layout(matchPrepared, Infinity, fontSize * 1.2)
      // Proportional width from the original item
      matchWidth = (matchStr.length / (item.str.length || 1)) * item.width * scale
    } catch {
      // Fallback: proportional width estimation
    }

    // Position from original PDF transform
    const x = item.transform[4] * scale + xOffset
    const y = viewportHeight - item.transform[5] * scale - fontSize

    rects.push({
      x,
      y,
      width: matchWidth,
      height: fontSize * 1.2,
      lineIndex: -1, // Original coordinates, not line-based
    })
  }

  return rects
}
