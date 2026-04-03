import { prepareWithSegments } from '@chenglou/pretext'
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api'
import type {
  Paragraph,
  PreparedTextContent,
  TextItem,
  TextStyle,
} from './types'
import { FontMapper } from './font-map'
import { fontSizeFromTransform } from './utils'

/**
 * Extract text from a PDF page, group into paragraphs, and prepare with pretext.
 * This is the bridge between PDF.js text extraction and pretext layout.
 */
export async function extractAndPrepare(
  page: PDFPageProxy,
  fontMapper: FontMapper,
  scale: number,
): Promise<PreparedTextContent> {
  const textContent = await page.getTextContent()

  // Filter to actual text items (not marked content markers)
  const items = textContent.items.filter(
    (item): item is TextItem => 'str' in item && typeof item.str === 'string',
  )

  const styles = (textContent.styles ?? {}) as Record<string, TextStyle>

  // Map all fonts for this page
  const fontMap = fontMapper.mapAllFonts(styles)

  // Group into paragraphs using spatial proximity
  const viewport = page.getViewport({ scale })
  const paragraphs = groupIntoParagraphs(items, styles, fontMapper, viewport.height, scale)

  // Build full concatenated text
  const fullText = paragraphs.map((p) => p.text).join('\n')

  // Prepare full text with pretext (using the first paragraph's font, or default)
  const defaultFont = paragraphs.length > 0 ? paragraphs[0].font : '16px sans-serif'
  const fullPrepared = prepareWithSegments(fullText, defaultFont)

  return {
    items,
    styles,
    paragraphs,
    fontMap,
    fullText,
    fullPrepared,
  }
}

/**
 * Group text items into paragraphs based on spatial proximity.
 *
 * Heuristic:
 * - Items on the same baseline (within tolerance) = same line
 * - Consecutive lines with consistent spacing = same paragraph
 * - Large vertical gaps or font changes = new paragraph
 */
export function groupIntoParagraphs(
  items: TextItem[],
  styles: Record<string, TextStyle>,
  fontMapper: FontMapper,
  viewportHeight: number,
  scale: number,
): Paragraph[] {
  if (items.length === 0) return []

  // Sort items by Y (top-to-bottom), then X (left-to-right)
  // PDF Y is bottom-up, so higher Y = higher on page
  const sorted = items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const ay = a.item.transform[5]
      const by = b.item.transform[5]
      if (Math.abs(ay - by) > 2) return by - ay // Higher Y first (top of page)
      return a.item.transform[4] - b.item.transform[4] // Left to right
    })

  const paragraphs: Paragraph[] = []
  let currentTexts: string[] = []
  let currentIndices: number[] = []
  let currentFont = ''
  let currentFontSize = 0
  let currentX = 0
  let currentY = 0
  let lastY = -Infinity
  let lastFontName = ''
  let lastFontSize = 0

  function flushParagraph() {
    if (currentTexts.length === 0) return

    const text = currentTexts.join('')
    if (!text.trim()) {
      currentTexts = []
      currentIndices = []
      return
    }

    const prepared = prepareWithSegments(text, currentFont)
    paragraphs.push({
      text,
      font: currentFont,
      fontSize: currentFontSize,
      prepared,
      sourceItemIndices: [...currentIndices],
      x: currentX * scale,
      y: (viewportHeight - currentY * scale),
    })

    currentTexts = []
    currentIndices = []
  }

  for (const { item, idx } of sorted) {
    const fontSize = fontSizeFromTransform(item.transform)
    const y = item.transform[5]
    const x = item.transform[4]
    const fontName = item.fontName

    // Detect paragraph break: large Y gap or font change
    const yGap = Math.abs(lastY - y)
    const lineGap = lastFontSize > 0 ? lastFontSize * 1.8 : fontSize * 1.8
    const isFontChange = fontName !== lastFontName && lastFontName !== ''
    const isLargeGap = yGap > lineGap && lastY !== -Infinity

    if (isLargeGap || isFontChange) {
      flushParagraph()
    }

    if (currentTexts.length === 0) {
      currentX = x
      currentY = y
      currentFontSize = fontSize
      const scaledSize = Math.round(fontSize * scale)
      const family = fontMapper.mapFont(fontName, styles[fontName], scaledSize)
      currentFont = family
    }

    // Add space between items on the same line if there's a gap
    if (currentTexts.length > 0 && Math.abs(y - lastY) < 2) {
      const lastText = currentTexts[currentTexts.length - 1]
      if (lastText && !lastText.endsWith(' ') && !item.str.startsWith(' ')) {
        // Heuristic: add space if there's horizontal gap > half a space width
        currentTexts.push(' ')
      }
    }

    currentTexts.push(item.str)
    currentIndices.push(idx)

    // Add newline at end of line
    if (item.hasEOL && currentTexts.length > 0) {
      currentTexts.push(' ')
    }

    lastY = y
    lastFontName = fontName
    lastFontSize = fontSize
  }

  flushParagraph()
  return paragraphs
}
