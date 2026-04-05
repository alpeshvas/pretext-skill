import { getDocument } from 'pdfjs-dist'
import { PretextDocument } from './document'
import { configureWorker } from './worker'
import type { LoadOptions } from './types'

// ── Core Classes ──────────────────────────────────────────────

export { PretextDocument } from './document'
export { PretextPage } from './page'
export type { RenderResult } from './page'
export { PretextTextLayer } from './text-layer'
export { PretextSearch } from './search'
export { FontMapper } from './font-map'
export { PrepareCache } from './cache'
export { configureWorker, resetWorkerConfig } from './worker'

// ── Utilities ─────────────────────────────────────────────────

export {
  setupHiDPICanvas,
  fontSizeFromTransform,
  pageToViewport,
  baselineOffset,
  PDF_TO_CSS,
} from './utils'

// ── Types ─────────────────────────────────────────────────────

export type {
  LoadOptions,
  RenderOptions,
  TextLayerOptions,
  ReflowOptions,
  ReflowedText,
  ReflowedLine,
  TextItemRef,
  SearchOptions,
  SearchHit,
  SearchHitRect,
  ThumbnailOptions,
  MeasuredAnnotation,
  CacheStats,
  PretextPDFEvent,
  PreparedTextContent,
  PageLayout,
  Paragraph,
  TextItem,
  TextStyle,
} from './types'

// ── Primary Entry Point ───────────────────────────────────────

/**
 * Load a PDF document with pretext-powered text capabilities.
 *
 * @example
 * ```js
 * import { loadDocument } from 'pretext-pdfjs'
 *
 * const doc = await loadDocument('paper.pdf')
 * const page = await doc.getPage(1)
 *
 * // Render to canvas
 * await page.renderToCanvas(canvas, { scale: 2 })
 *
 * // Reflow text at any width
 * const reflowed = await page.reflowText(400, { lineHeight: 24 })
 *
 * // Search with pixel-accurate highlights
 * const hits = await page.search('quantum')
 * ```
 */
export async function loadDocument(
  src: string | URL | ArrayBuffer | ArrayBufferView,
  options: LoadOptions = {},
): Promise<PretextDocument> {
  configureWorker({ workerSrc: options.workerSrc })

  const params: Record<string, any> = {}

  if (typeof src === 'string') {
    params.url = src
  } else if (src instanceof URL) {
    params.url = src.toString()
  } else {
    params.data = src
  }

  if (options.cMapUrl) {
    params.cMapUrl = options.cMapUrl
    params.cMapPacked = options.cMapPacked ?? true
  }

  const pdf = await getDocument(params).promise
  return new PretextDocument(pdf, options)
}
