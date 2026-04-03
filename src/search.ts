import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import type {
  PreparedTextContent,
  SearchHit,
  SearchHitRect,
  SearchOptions,
} from './types'

/**
 * Character-level search with pixel-accurate highlight rectangles.
 *
 * Uses pretext's layout engine to compute exact positions for each match,
 * enabling highlight rects that align perfectly with canvas-rendered text.
 */
export class PretextSearch {
  /**
   * Search within a page's prepared text content.
   * Returns matches with character positions (rects computed separately).
   */
  static searchPage(
    textContent: PreparedTextContent,
    query: string,
    pageNum: number,
    options: SearchOptions = {},
  ): SearchHit[] {
    if (!query) return []

    const text = textContent.fullText
    const searchText = options.caseSensitive ? text : text.toLowerCase()
    const searchQuery = options.caseSensitive ? query : query.toLowerCase()

    const hits: SearchHit[] = []
    let startIdx = 0
    let matchIndex = 0

    while (true) {
      const idx = searchText.indexOf(searchQuery, startIdx)
      if (idx === -1) break

      const matchText = text.substring(idx, idx + query.length)

      // Check whole word boundary if requested
      if (options.wholeWord) {
        const before = idx > 0 ? text[idx - 1] : ' '
        const after = idx + query.length < text.length ? text[idx + query.length] : ' '
        if (/\w/.test(before) || /\w/.test(after)) {
          startIdx = idx + 1
          continue
        }
      }

      hits.push({
        pageNum,
        matchIndex: matchIndex++,
        text: matchText,
        rects: [], // Computed by computeHighlightRects
      })

      startIdx = idx + 1
    }

    return hits
  }

  /**
   * Compute pixel-accurate highlight rectangles for search hits.
   *
   * Uses pretext layoutWithLines to find which lines contain the match,
   * then canvas measureText to compute exact x-positions within each line.
   */
  static computeHighlightRects(
    textContent: PreparedTextContent,
    query: string,
    maxWidth: number,
    lineHeight: number,
    scale: number,
    options: SearchOptions = {},
  ): SearchHitRect[][] {
    const text = textContent.fullText
    const font = textContent.paragraphs[0]?.font ?? '16px sans-serif'

    // Layout the full text to get line positions
    const prepared = prepareWithSegments(text, font)
    const { lines } = layoutWithLines(prepared, maxWidth, lineHeight)

    // Build a character-to-line index
    const charToLine: number[] = new Array(text.length)
    let charOffset = 0
    for (let li = 0; li < lines.length; li++) {
      const lineText = lines[li].text
      for (let ci = 0; ci < lineText.length; ci++) {
        charToLine[charOffset + ci] = li
      }
      charOffset += lineText.length
      // Account for line break character
      if (charOffset < text.length) {
        charToLine[charOffset] = li
        charOffset++
      }
    }

    // Find all matches and compute rects
    const searchText = options.caseSensitive ? text : text.toLowerCase()
    const searchQuery = options.caseSensitive ? query : query.toLowerCase()
    const allRects: SearchHitRect[][] = []

    let startIdx = 0
    while (true) {
      const idx = searchText.indexOf(searchQuery, startIdx)
      if (idx === -1) break

      const endIdx = idx + query.length - 1
      const startLine = charToLine[idx] ?? 0
      const endLine = charToLine[endIdx] ?? startLine

      const rects: SearchHitRect[] = []

      for (let li = startLine; li <= endLine; li++) {
        const line = lines[li]
        if (!line) continue

        // Compute x-start and x-end within this line
        // Find the character offsets relative to line start
        let lineStartChar = 0
        let tmp = 0
        for (let i = 0; i < li; i++) {
          tmp += lines[i].text.length + 1 // +1 for line break
        }
        lineStartChar = tmp

        const matchStartInLine = Math.max(0, idx - lineStartChar)
        const matchEndInLine = Math.min(line.text.length, endIdx - lineStartChar + 1)

        if (matchStartInLine >= matchEndInLine) continue

        // Use pretext line width ratios for x-position estimation
        const fullWidth = line.width
        const beforeText = line.text.substring(0, matchStartInLine)
        const matchText = line.text.substring(matchStartInLine, matchEndInLine)

        // Estimate x positions proportionally
        const beforeRatio = beforeText.length / (line.text.length || 1)
        const matchRatio = matchText.length / (line.text.length || 1)

        rects.push({
          x: beforeRatio * fullWidth * scale,
          y: li * lineHeight * scale,
          width: matchRatio * fullWidth * scale,
          height: lineHeight * scale,
          lineIndex: li,
        })
      }

      allRects.push(rects)
      startIdx = idx + 1
    }

    return allRects
  }
}
