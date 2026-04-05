import { prepareWithSegments } from '@chenglou/pretext'
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api'
import type {
  PageLayout,
  Paragraph,
  PreparedTextContent,
  TextItem,
  TextStyle,
} from './types'
import { FontMapper } from './font-map'
import { fontSizeFromTransform } from './utils'

/**
 * Extract text from a PDF page, detect layout (columns, author blocks),
 * group into paragraphs in reading order, and prepare with pretext.
 */
export async function extractAndPrepare(
  page: PDFPageProxy,
  fontMapper: FontMapper,
  scale: number,
): Promise<PreparedTextContent> {
  const textContent = await page.getTextContent()

  const items = textContent.items.filter(
    (item): item is TextItem => 'str' in item && typeof item.str === 'string',
  )

  const styles = (textContent.styles ?? {}) as Record<string, TextStyle>
  const fontMap = fontMapper.mapAllFonts(styles)
  const viewport = page.getViewport({ scale })

  // Step 1: Detect page layout (columns, structure)
  const layout = detectLayout(items, viewport.width, viewport.height)

  // Step 2: Group into paragraphs respecting column order
  const paragraphs = groupIntoParagraphs(
    items, styles, fontMapper, viewport.height, scale, layout,
  )

  // Step 3: Build full text from paragraphs (reading order)
  const fullText = paragraphs.map((p) => p.text).join('\n')
  const defaultFont = paragraphs.length > 0 ? paragraphs[0].font : '16px sans-serif'
  const fullPrepared = prepareWithSegments(fullText, defaultFont)

  return { items, styles, paragraphs, fontMap, fullText, fullPrepared, layout }
}

// ── Column Detection ──────────────────────────────────────────

/**
 * Detect multi-column layouts by analyzing the X-position distribution
 * of text items. Research papers typically have:
 * - Full-width header (title, authors) at the top
 * - Two columns for body text below
 */
export function detectLayout(
  items: TextItem[],
  pageWidth: number,
  pageHeight: number,
): PageLayout {
  if (items.length === 0) {
    return { columnCount: 1, columns: [{ left: 0, right: pageWidth }], pageWidth, hasAuthorBlock: false }
  }

  // Collect X-positions of all items in the lower 70% of the page
  // (skip top 30% which often has full-width title/authors)
  const bodyItems = items.filter((item) => {
    const y = item.transform[5]
    return y < pageHeight * 0.7 // Lower on page = smaller Y in PDF coords
  })

  if (bodyItems.length < 10) {
    // Not enough body text to detect columns
    return { columnCount: 1, columns: [{ left: 0, right: pageWidth }], pageWidth, hasAuthorBlock: false }
  }

  // Build histogram of X start positions (binned to ~5% page width)
  const binWidth = pageWidth * 0.05
  const xStarts = bodyItems.map((item) => item.transform[4])

  // Find clusters of X start positions
  const sorted = [...xStarts].sort((a, b) => a - b)
  const clusters = clusterValues(sorted, pageWidth * 0.1)

  // Detect author block: items in top 25% that are centered
  const hasAuthorBlock = detectAuthorBlock(items, pageWidth, pageHeight)

  if (clusters.length >= 2) {
    // Multi-column layout detected
    // Sort clusters by X position (left to right)
    clusters.sort((a, b) => a.center - b.center)

    // Check if the gap between clusters is significant (> 5% page width)
    const gap = clusters.length >= 2
      ? clusters[1].center - clusters[0].center
      : 0

    if (gap > pageWidth * 0.2) {
      // Two-column layout
      const midpoint = (clusters[0].center + clusters[1].center) / 2
      return {
        columnCount: 2,
        columns: [
          { left: 0, right: midpoint },
          { left: midpoint, right: pageWidth },
        ],
        pageWidth,
        hasAuthorBlock,
      }
    }
  }

  return { columnCount: 1, columns: [{ left: 0, right: pageWidth }], pageWidth, hasAuthorBlock }
}

/** Cluster nearby values together */
function clusterValues(
  sorted: number[],
  threshold: number,
): Array<{ center: number; count: number }> {
  const clusters: Array<{ sum: number; count: number; center: number }> = []

  for (const val of sorted) {
    const existing = clusters.find((c) => Math.abs(c.center - val) < threshold)
    if (existing) {
      existing.sum += val
      existing.count++
      existing.center = existing.sum / existing.count
    } else {
      clusters.push({ sum: val, count: 1, center: val })
    }
  }

  // Only return significant clusters (> 10% of items)
  const minCount = sorted.length * 0.1
  return clusters.filter((c) => c.count >= minCount)
}

/** Detect if top section has centered author/affiliation text */
function detectAuthorBlock(
  items: TextItem[],
  pageWidth: number,
  pageHeight: number,
): boolean {
  // Look at items in the top 25% of the page
  const topItems = items.filter((item) => item.transform[5] > pageHeight * 0.75)
  if (topItems.length < 3) return false

  // Check if multiple font sizes exist (title vs author vs affiliation)
  const fontSizes = new Set(topItems.map((item) =>
    Math.round(fontSizeFromTransform(item.transform)),
  ))

  // Check if items are roughly centered
  const centerX = pageWidth / 2
  const centeredCount = topItems.filter((item) => {
    const itemCenter = item.transform[4] + (item.width / 2)
    return Math.abs(itemCenter - centerX) < pageWidth * 0.2
  }).length

  // Author block: multiple font sizes + mostly centered
  return fontSizes.size >= 2 && centeredCount > topItems.length * 0.5
}

// ── Paragraph Grouping ────────────────────────────────────────

/**
 * Assign each item to a column, then group into paragraphs
 * reading column-by-column (left column fully, then right column).
 */
export function groupIntoParagraphs(
  items: TextItem[],
  styles: Record<string, TextStyle>,
  fontMapper: FontMapper,
  viewportHeight: number,
  scale: number,
  layout: PageLayout,
): Paragraph[] {
  if (items.length === 0) return []

  // Assign each item to a column
  const itemsWithColumn = items.map((item, idx) => ({
    item,
    idx,
    column: assignColumn(item, layout),
  }))

  // Separate full-width items (title, authors) from columned content
  const fullWidthItems: typeof itemsWithColumn = []
  const columnedItems: typeof itemsWithColumn = []

  if (layout.columnCount > 1) {
    for (const entry of itemsWithColumn) {
      if (isFullWidthItem(entry.item, layout)) {
        fullWidthItems.push(entry)
      } else {
        columnedItems.push(entry)
      }
    }
  } else {
    columnedItems.push(...itemsWithColumn)
  }

  const paragraphs: Paragraph[] = []

  // Process full-width items first (title, authors, abstract)
  if (fullWidthItems.length > 0) {
    const sorted = sortByReadingOrder(fullWidthItems)
    paragraphs.push(
      ...buildParagraphs(sorted, styles, fontMapper, viewportHeight, scale, 0),
    )

    // Tag roles for full-width paragraphs
    tagRoles(paragraphs, layout)
  }

  // Process each column in order
  for (let col = 0; col < layout.columnCount; col++) {
    const colItems = columnedItems.filter((e) => e.column === col)
    if (colItems.length === 0) continue

    const sorted = sortByReadingOrder(colItems)
    paragraphs.push(
      ...buildParagraphs(sorted, styles, fontMapper, viewportHeight, scale, col),
    )
  }

  return paragraphs
}

/** Determine which column an item belongs to */
function assignColumn(item: TextItem, layout: PageLayout): number {
  const x = item.transform[4]
  for (let i = 0; i < layout.columns.length; i++) {
    const col = layout.columns[i]
    if (x >= col.left && x < col.right) return i
  }
  // Default to nearest column
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < layout.columns.length; i++) {
    const mid = (layout.columns[i].left + layout.columns[i].right) / 2
    const dist = Math.abs(x - mid)
    if (dist < bestDist) { bestDist = dist; best = i }
  }
  return best
}

/** Check if an item spans the full page width (title, authors) */
function isFullWidthItem(item: TextItem, layout: PageLayout): boolean {
  if (layout.columnCount <= 1) return false

  const x = item.transform[4]
  const pageCenter = layout.pageWidth / 2
  const itemCenter = x + (item.width / 2)

  // Full-width if: centered on page AND wider than a single column,
  // OR positioned in the "gutter" area between columns
  const colWidth = layout.columns[0].right - layout.columns[0].left
  const isCentered = Math.abs(itemCenter - pageCenter) < layout.pageWidth * 0.15

  // Also check Y: full-width items are typically in the top portion
  const isTopArea = item.transform[5] > layout.pageWidth * 0.6 // rough heuristic

  return isCentered && isTopArea
}

/** Sort items in natural reading order (top-to-bottom, left-to-right) */
function sortByReadingOrder(
  items: Array<{ item: TextItem; idx: number; column: number }>,
): Array<{ item: TextItem; idx: number; column: number }> {
  return [...items].sort((a, b) => {
    const ay = a.item.transform[5]
    const by = b.item.transform[5]
    if (Math.abs(ay - by) > 2) return by - ay // Higher Y first
    return a.item.transform[4] - b.item.transform[4] // Left to right
  })
}

/** Build paragraphs from sorted items within a single column */
function buildParagraphs(
  sorted: Array<{ item: TextItem; idx: number; column: number }>,
  styles: Record<string, TextStyle>,
  fontMapper: FontMapper,
  viewportHeight: number,
  scale: number,
  column: number,
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let currentTexts: string[] = []
  let currentIndices: number[] = []
  let currentFont = ''
  let currentFontSize = 0
  let currentX = 0
  let currentY = 0
  let lastY = -Infinity
  let lastFontSize = 0
  let lastItemEndX = 0

  function flush() {
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
      y: viewportHeight - currentY * scale,
      column,
    })

    currentTexts = []
    currentIndices = []
  }

  for (const { item, idx } of sorted) {
    const fontSize = fontSizeFromTransform(item.transform)
    const y = item.transform[5]
    const x = item.transform[4]

    // Detect paragraph break
    const yGap = Math.abs(lastY - y)
    const lineGap = lastFontSize > 0 ? lastFontSize * 1.8 : fontSize * 1.8
    const isNewLine = yGap > 2 && lastY !== -Infinity
    const isLargeGap = yGap > lineGap && lastY !== -Infinity

    // Font SIZE change is a paragraph break (title→body, heading→text)
    // But font FAMILY change within similar size is NOT (bold+italic in same line)
    const sizeChanged = lastFontSize > 0 && Math.abs(fontSize - lastFontSize) > lastFontSize * 0.15

    if (isLargeGap || sizeChanged) {
      flush()
    }

    if (currentTexts.length === 0) {
      currentX = x
      currentY = y
      currentFontSize = fontSize
      const scaledSize = Math.round(fontSize * scale)
      currentFont = fontMapper.mapFont(item.fontName, styles[item.fontName], scaledSize)
    }

    // Add space between items on the same line
    if (currentTexts.length > 0 && !isNewLine) {
      const lastText = currentTexts[currentTexts.length - 1]
      if (lastText && !lastText.endsWith(' ') && !item.str.startsWith(' ')) {
        // Check actual horizontal gap
        const gap = x - lastItemEndX
        if (gap > fontSize * 0.15) {
          currentTexts.push(' ')
        }
      }
    }

    // Add space for line breaks within a paragraph
    if (isNewLine && !isLargeGap && !sizeChanged && currentTexts.length > 0) {
      const lastText = currentTexts[currentTexts.length - 1]
      if (lastText && !lastText.endsWith(' ')) {
        currentTexts.push(' ')
      }
    }

    currentTexts.push(item.str)
    currentIndices.push(idx)

    lastY = y
    lastFontSize = fontSize
    lastItemEndX = x + (item.width || 0)
  }

  flush()
  return paragraphs
}

/** Tag semantic roles for full-width paragraphs (title, authors, etc.) */
function tagRoles(paragraphs: Paragraph[], layout: PageLayout): void {
  if (paragraphs.length === 0) return

  // First paragraph is typically the title (largest font)
  let maxFontSize = 0
  let titleIdx = 0
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].fontSize > maxFontSize) {
      maxFontSize = paragraphs[i].fontSize
      titleIdx = i
    }
  }
  paragraphs[titleIdx].role = 'title'

  // Paragraphs after title with smaller font + centered = authors
  if (layout.hasAuthorBlock) {
    for (let i = titleIdx + 1; i < paragraphs.length; i++) {
      const p = paragraphs[i]
      if (p.fontSize < maxFontSize * 0.85) {
        p.role = 'authors'
      } else {
        break
      }
    }
  }

  // Look for "Abstract" keyword
  for (const p of paragraphs) {
    if (!p.role && /^\s*abstract\s*/i.test(p.text)) {
      p.role = 'abstract'
    }
  }
}
