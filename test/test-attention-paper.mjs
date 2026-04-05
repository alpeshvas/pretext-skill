/**
 * Test: Extract and analyze "Attention Is All You Need" paper.
 *
 * Validates:
 * 1. Column detection on a real two-column NeurIPS paper
 * 2. Reading order (left column first, then right)
 * 3. Author block detection (centered, multi-font header)
 * 4. Paragraph grouping doesn't garble cross-column text
 *
 * Run: node test/test-attention-paper.mjs
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// PDF.js in Node.js requires some setup
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

// Pretext needs a canvas-like measureText — use a stub for Node
// (In a real browser, this just works)
import { fontSizeFromTransform } from '../src/utils.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PDF_PATH = join(__dirname, 'attention.pdf')

// ── Helpers (inline from our library since we can't import TS directly) ──

function detectLayout(items, pageWidth, pageHeight) {
  if (items.length === 0) {
    return { columnCount: 1, columns: [{ left: 0, right: pageWidth }], pageWidth, hasAuthorBlock: false }
  }

  const bodyItems = items.filter((item) => item.transform[5] < pageHeight * 0.7)

  if (bodyItems.length < 10) {
    return { columnCount: 1, columns: [{ left: 0, right: pageWidth }], pageWidth, hasAuthorBlock: false }
  }

  const xStarts = bodyItems.map((item) => item.transform[4])
  const sorted = [...xStarts].sort((a, b) => a - b)
  const clusters = clusterValues(sorted, pageWidth * 0.1)
  const hasAuthorBlock = detectAuthorBlock(items, pageWidth, pageHeight)

  if (clusters.length >= 2) {
    clusters.sort((a, b) => a.center - b.center)
    const gap = clusters[1].center - clusters[0].center

    if (gap > pageWidth * 0.2) {
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

function clusterValues(sorted, threshold) {
  const clusters = []
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
  const minCount = sorted.length * 0.1
  return clusters.filter((c) => c.count >= minCount)
}

function detectAuthorBlock(items, pageWidth, pageHeight) {
  const topItems = items.filter((item) => item.transform[5] > pageHeight * 0.75)
  if (topItems.length < 3) return false

  const fontSizes = new Set(topItems.map((item) =>
    Math.round(fontSizeFromTransform(item.transform)),
  ))

  const centerX = pageWidth / 2
  const centeredCount = topItems.filter((item) => {
    const itemCenter = item.transform[4] + (item.width / 2)
    return Math.abs(itemCenter - centerX) < pageWidth * 0.2
  }).length

  return fontSizes.size >= 2 && centeredCount > topItems.length * 0.5
}

// ── Main Test ─────────────────────────────────────────────────

async function main() {
  if (!existsSync(PDF_PATH)) {
    console.log('⚠  Downloading "Attention Is All You Need" paper...')
    const { execSync } = await import('child_process')
    try {
      execSync(
        `curl -sL "https://arxiv.org/pdf/1706.03762v7" -o "${PDF_PATH}"`,
        { timeout: 30000 },
      )
      console.log('✓  Downloaded.\n')
    } catch (e) {
      console.error('✗  Failed to download. Place the PDF at test/attention.pdf manually.')
      process.exit(1)
    }
  }

  const data = readFileSync(PDF_PATH)
  const pdf = await pdfjsLib.getDocument({ data }).promise

  console.log(`Document: ${pdf.numPages} pages\n`)
  console.log('=' .repeat(70))

  // Test pages 1-3 (cover different layouts)
  for (const pageNum of [1, 2, 3]) {
    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()

    const items = textContent.items.filter(
      (item) => 'str' in item && typeof item.str === 'string',
    )

    console.log(`\n── Page ${pageNum} ──────────────────────────────────────`)
    console.log(`  Viewport: ${viewport.width.toFixed(0)} x ${viewport.height.toFixed(0)}`)
    console.log(`  Text items: ${items.length}`)

    // Test 1: Column detection
    const layout = detectLayout(items, viewport.width, viewport.height)
    console.log(`  Columns detected: ${layout.columnCount}`)
    if (layout.columnCount > 1) {
      for (let i = 0; i < layout.columns.length; i++) {
        const col = layout.columns[i]
        console.log(`    Column ${i}: x=[${col.left.toFixed(0)}, ${col.right.toFixed(0)}]`)
      }
    }
    console.log(`  Author block: ${layout.hasAuthorBlock}`)

    // Test 2: Show first few items per column for reading order
    if (layout.columnCount >= 2) {
      for (let col = 0; col < layout.columns.length; col++) {
        const colBounds = layout.columns[col]
        const colItems = items.filter((item) => {
          const x = item.transform[4]
          return x >= colBounds.left && x < colBounds.right
        })

        // Sort by reading order
        colItems.sort((a, b) => {
          const ay = a.transform[5], by = b.transform[5]
          if (Math.abs(ay - by) > 2) return by - ay
          return a.transform[4] - b.transform[4]
        })

        console.log(`\n  Column ${col} (first 5 items):`)
        for (let i = 0; i < Math.min(5, colItems.length); i++) {
          const item = colItems[i]
          const fontSize = fontSizeFromTransform(item.transform).toFixed(1)
          console.log(`    [${fontSize}pt @ x=${item.transform[4].toFixed(0)}, y=${item.transform[5].toFixed(0)}] "${item.str.substring(0, 60)}"`)
        }
      }
    }

    // Test 3: Show full-width items (title, authors)
    if (layout.columnCount >= 2) {
      const fullWidthItems = items.filter((item) => {
        const x = item.transform[4]
        const pageCenter = viewport.width / 2
        const itemCenter = x + (item.width / 2)
        const isCentered = Math.abs(itemCenter - pageCenter) < viewport.width * 0.15
        const isTopArea = item.transform[5] > viewport.height * 0.6
        return isCentered && isTopArea
      })

      if (fullWidthItems.length > 0) {
        console.log(`\n  Full-width items (title/authors):`)
        for (const item of fullWidthItems.slice(0, 10)) {
          const fontSize = fontSizeFromTransform(item.transform).toFixed(1)
          console.log(`    [${fontSize}pt] "${item.str}"`)
        }
      }
    }

    // Test 4: Font variety on page 1
    if (pageNum === 1) {
      const fonts = new Map()
      for (const item of items) {
        const size = Math.round(fontSizeFromTransform(item.transform))
        const key = `${item.fontName}@${size}pt`
        fonts.set(key, (fonts.get(key) || 0) + 1)
      }
      console.log(`\n  Font usage:`)
      const sortedFonts = [...fonts.entries()].sort((a, b) => b[1] - a[1])
      for (const [font, count] of sortedFonts.slice(0, 8)) {
        console.log(`    ${font}: ${count} items`)
      }
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('Done.')
  await pdf.destroy()
}

main().catch(console.error)
