/**
 * Test: Column detection and reading order on synthetic two-column data.
 *
 * Simulates the text item layout of a typical NeurIPS/ACM paper like
 * "Attention Is All You Need":
 * - Centered title (large font, full-width)
 * - Centered author block (medium font, multiple lines)
 * - Two-column body text (small font)
 *
 * Validates that our layout detection + reading order correctly:
 * 1. Detects 2 columns
 * 2. Identifies the author block
 * 3. Reads left column first, then right column
 * 4. Doesn't interleave text across columns
 */

// ── Inline the detection logic (can't import TS directly) ─────

function fontSizeFromTransform(transform) {
  return Math.sqrt(transform[2] * transform[2] + transform[3] * transform[3])
}

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
      return { columnCount: 2, columns: [{ left: 0, right: midpoint }, { left: midpoint, right: pageWidth }], pageWidth, hasAuthorBlock }
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

function assignColumn(item, layout) {
  const x = item.transform[4]
  for (let i = 0; i < layout.columns.length; i++) {
    if (x >= layout.columns[i].left && x < layout.columns[i].right) return i
  }
  return 0
}

function isFullWidthItem(item, layout, columnStartY) {
  if (layout.columnCount <= 1) return false
  if (columnStartY === undefined) return false
  return item.transform[5] > columnStartY
}

function findColumnStartY(items, layout) {
  if (layout.columnCount <= 1) return undefined
  const lines = new Map()
  for (const item of items) {
    const y = Math.round(item.transform[5] / 3) * 3
    const col = assignColumn(item, layout)
    let cols = lines.get(y)
    if (!cols) { cols = new Set(); lines.set(y, cols) }
    cols.add(col)
  }
  let maxY = -Infinity
  for (const [y, cols] of lines) {
    if (cols.size >= 2 && y > maxY) maxY = y
  }
  return maxY !== -Infinity ? maxY + 5 : undefined
}

// ── Synthetic paper layout ────────────────────────────────────

const PAGE_WIDTH = 612   // US Letter in PDF points
const PAGE_HEIGHT = 792

function makeItem(str, x, y, fontSize, fontName = 'body') {
  return {
    str,
    dir: 'ltr',
    width: str.length * fontSize * 0.5, // rough estimate
    height: fontSize,
    transform: [fontSize, 0, 0, fontSize, x, y],
    fontName,
    hasEOL: false,
  }
}

// Simulate "Attention Is All You Need" page 1 layout:
const items = [
  // ── Title (centered, large font, y=740) ──
  makeItem('Attention Is All You Need', 170, 740, 20, 'title-font'),

  // ── Authors (centered, medium font, y=710-690) ──
  makeItem('Ashish Vaswani*', 200, 710, 10, 'author-font'),
  makeItem('Noam Shazeer*', 310, 710, 10, 'author-font'),
  makeItem('Niki Parmar*', 200, 698, 10, 'author-font'),
  makeItem('Jakob Uszkoreit*', 310, 698, 10, 'author-font'),
  makeItem('Google Brain', 250, 680, 9, 'affil-font'),
  makeItem('Google Research', 250, 668, 9, 'affil-font'),

  // ── Abstract label (centered, bold, y=620) ──
  makeItem('Abstract', 275, 620, 11, 'heading-font'),

  // ── Abstract text (full-width, y=600-560) ──
  makeItem('The dominant sequence transduction models are based on complex', 108, 600, 10, 'body-font'),
  makeItem('recurrent or convolutional neural networks that include an encoder', 108, 588, 10, 'body-font'),
  makeItem('and a decoder.', 108, 576, 10, 'body-font'),

  // ── LEFT COLUMN (x≈72, y=500 downward) ──
  makeItem('1 Introduction', 72, 500, 12, 'heading-font'),
  makeItem('Recurrent neural networks, long short-', 72, 482, 10, 'body-font'),
  makeItem('term memory and gated recurrent neural', 72, 470, 10, 'body-font'),
  makeItem('networks in particular, have been firmly', 72, 458, 10, 'body-font'),
  makeItem('established as state of the art approaches', 72, 446, 10, 'body-font'),
  makeItem('in sequence modeling and transduction', 72, 434, 10, 'body-font'),
  makeItem('problems such as language modeling and', 72, 422, 10, 'body-font'),
  makeItem('machine translation. Numerous efforts', 72, 410, 10, 'body-font'),
  makeItem('have since continued to push the bound-', 72, 398, 10, 'body-font'),
  makeItem('aries of recurrent language models and', 72, 386, 10, 'body-font'),
  makeItem('encoder-decoder architectures.', 72, 374, 10, 'body-font'),
  makeItem('Recurrent models typically factor compu-', 72, 350, 10, 'body-font'),
  makeItem('tation along the symbol positions of the', 72, 338, 10, 'body-font'),
  makeItem('input and output sequences.', 72, 326, 10, 'body-font'),

  // ── RIGHT COLUMN (x≈318, y=500 downward) ──
  makeItem('Attention mechanisms have become an', 318, 500, 10, 'body-font'),
  makeItem('integral part of compelling sequence', 318, 488, 10, 'body-font'),
  makeItem('modeling and transduction models in', 318, 476, 10, 'body-font'),
  makeItem('various tasks, allowing modeling of', 318, 464, 10, 'body-font'),
  makeItem('dependencies without regard to their', 318, 452, 10, 'body-font'),
  makeItem('distance in the input or output sequences.', 318, 440, 10, 'body-font'),
  makeItem('In all but a few cases, however, such', 318, 428, 10, 'body-font'),
  makeItem('attention mechanisms are used in conjunc-', 318, 416, 10, 'body-font'),
  makeItem('tion with a recurrent network.', 318, 404, 10, 'body-font'),
  makeItem('In this work we propose the Transformer,', 318, 380, 10, 'body-font'),
  makeItem('a model architecture eschewing recurrence', 318, 368, 10, 'body-font'),
  makeItem('and instead relying entirely on an attention', 318, 356, 10, 'body-font'),
  makeItem('mechanism to draw global dependencies', 318, 344, 10, 'body-font'),
  makeItem('between input and output.', 318, 332, 10, 'body-font'),
]

// ── Run Tests ─────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`)
    passed++
  } else {
    console.log(`  ✗ ${name}`)
    failed++
  }
}

console.log('Column Detection Tests')
console.log('='.repeat(60))

// Test 1: Detect two columns
console.log('\n1. Layout Detection:')
const layout = detectLayout(items, PAGE_WIDTH, PAGE_HEIGHT)
assert(layout.columnCount === 2, `Detected ${layout.columnCount} columns (expected 2)`)
assert(layout.hasAuthorBlock, 'Author block detected')
console.log(`   Columns: [0, ${layout.columns[0].right.toFixed(0)}] and [${layout.columns[1].left.toFixed(0)}, ${PAGE_WIDTH}]`)

// Test 2: Column assignment
console.log('\n2. Column Assignment:')
const columnStartY = findColumnStartY(items, layout)
console.log(`   Column content starts at Y=${columnStartY?.toFixed(0) ?? 'N/A'}`)
const leftItems = items.filter(i => {
  const col = assignColumn(i, layout)
  return col === 0 && !isFullWidthItem(i, layout, columnStartY)
})
const rightItems = items.filter(i => {
  const col = assignColumn(i, layout)
  return col === 1 && !isFullWidthItem(i, layout, columnStartY)
})
const fullWidthItems = items.filter(i => isFullWidthItem(i, layout, columnStartY))

assert(fullWidthItems.length > 0, `Full-width items found: ${fullWidthItems.length}`)
assert(leftItems.length > 5, `Left column items: ${leftItems.length}`)
assert(rightItems.length > 5, `Right column items: ${rightItems.length}`)

// Test 3: Full-width items are title/authors
console.log('\n3. Full-Width Content:')
const fullWidthTexts = fullWidthItems.map(i => i.str)
assert(
  fullWidthTexts.some(t => t.includes('Attention')),
  'Title is in full-width items'
)
assert(
  fullWidthTexts.some(t => t.includes('Vaswani') || t.includes('Shazeer')),
  'Authors are in full-width items'
)

// Test 4: Reading order — left column text comes before right column text
console.log('\n4. Reading Order:')

// Sort each column by reading order (top to bottom)
leftItems.sort((a, b) => b.transform[5] - a.transform[5])
rightItems.sort((a, b) => b.transform[5] - a.transform[5])

const firstLeftText = leftItems[0]?.str ?? ''
const firstRightText = rightItems[0]?.str ?? ''

console.log(`   Left col starts:  "${firstLeftText.substring(0, 40)}"`)
console.log(`   Right col starts: "${firstRightText.substring(0, 40)}"`)

assert(
  firstLeftText.includes('Introduction') || firstLeftText.includes('Recurrent'),
  'Left column starts with section heading or intro text'
)
assert(
  firstRightText.includes('Attention mechanisms'),
  'Right column starts with continuation text'
)

// Test 5: Cross-column text not interleaved
console.log('\n5. No Cross-Column Interleaving:')

// In a naive sort-by-Y approach, items at the same Y from different columns
// would get interleaved. Verify our column separation prevents this.
const leftTexts = leftItems.map(i => i.str)
const rightTexts = rightItems.map(i => i.str)

assert(
  !leftTexts.some(t => t.includes('Attention mechanisms')),
  'Right-column text NOT in left column'
)
assert(
  !rightTexts.some(t => t.includes('Introduction')),
  'Left-column heading NOT in right column'
)

// Test 6: Simulated reading order output
console.log('\n6. Full Reading Order (first 3 items per section):')
console.log('   --- Full-width ---')
for (const item of fullWidthItems.slice(0, 3)) {
  console.log(`   "${item.str}"`)
}
console.log('   --- Left column ---')
for (const item of leftItems.slice(0, 3)) {
  console.log(`   "${item.str}"`)
}
console.log('   --- Right column ---')
for (const item of rightItems.slice(0, 3)) {
  console.log(`   "${item.str}"`)
}

// Test 7: Single-column page (simulate a references page)
console.log('\n7. Single-Column Detection:')
const singleColItems = [
  makeItem('References', 72, 740, 14, 'heading'),
  makeItem('[1] Vaswani et al. Attention is all you need. NeurIPS 2017.', 72, 720, 10, 'body'),
  makeItem('[2] Bahdanau et al. Neural machine translation by jointly', 72, 708, 10, 'body'),
  makeItem('learning to align and translate. ICLR 2015.', 72, 696, 10, 'body'),
  makeItem('[3] Gehring et al. Convolutional sequence to sequence', 72, 684, 10, 'body'),
  makeItem('learning. ICML 2017.', 72, 672, 10, 'body'),
  makeItem('[4] Wu et al. Google neural machine translation system.', 72, 660, 10, 'body'),
  makeItem('[5] Kim et al. Structured attention networks. ICLR 2017.', 72, 648, 10, 'body'),
  makeItem('[6] Parikh et al. A decomposable attention model. EMNLP 2016.', 72, 636, 10, 'body'),
  makeItem('[7] Lin et al. A self-attentive sentence embedding. ICLR 2017.', 72, 624, 10, 'body'),
  makeItem('[8] Sukhbaatar et al. End-to-end memory networks. NeurIPS 2015.', 72, 612, 10, 'body'),
  makeItem('[9] Luong et al. Effective approaches to attention. EMNLP 2015.', 72, 600, 10, 'body'),
]
const singleLayout = detectLayout(singleColItems, PAGE_WIDTH, PAGE_HEIGHT)
assert(singleLayout.columnCount === 1, `Single-column page: detected ${singleLayout.columnCount} column(s)`)

// ── Summary ───────────────────────────────────────────────────
console.log('\n' + '='.repeat(60))
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
