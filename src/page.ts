import { layoutWithLines } from '@chenglou/pretext'
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api'
import type {
  MeasuredAnnotation,
  PreparedTextContent,
  ReflowedLine,
  ReflowedText,
  ReflowOptions,
  RenderOptions,
  SearchHit,
  SearchOptions,
  TextLayerOptions,
  ThumbnailOptions,
} from './types'
import { PrepareCache } from './cache'
import { FontMapper } from './font-map'
import { extractAndPrepare } from './text-content'
import { PretextTextLayer } from './text-layer'
import { PretextSearch } from './search'
import { measureAnnotations } from './annotations'
import { renderThumbnail } from './thumbnails'
import { setupHiDPICanvas, baselineOffset } from './utils'

/**
 * Wraps a PDF.js page with pretext-powered text capabilities.
 *
 * All original PDF.js functionality is available via the `pdfPage` escape hatch.
 * Pretext adds: responsive text reflow, accurate text layers, character-level
 * search, smart annotation sizing, and readable thumbnails.
 */
export class PretextPage {
  readonly pageNum: number
  /** Escape hatch: raw PDF.js page proxy */
  readonly pdfPage: PDFPageProxy

  private cache: PrepareCache
  private fontMapper: FontMapper
  private docId: string

  constructor(
    pdfPage: PDFPageProxy,
    cache: PrepareCache,
    fontMapper: FontMapper,
    docId: string,
  ) {
    this.pdfPage = pdfPage
    this.pageNum = pdfPage.pageNumber
    this.cache = cache
    this.fontMapper = fontMapper
    this.docId = docId
  }

  /**
   * Render the PDF page to a canvas with automatic HiDPI setup.
   * This is a thin wrapper over PDF.js's page.render().
   */
  async renderToCanvas(
    canvas: HTMLCanvasElement,
    options: RenderOptions = {},
  ): Promise<void> {
    const scale = options.scale ?? 1
    const viewport = this.pdfPage.getViewport({ scale })

    const { ctx } = setupHiDPICanvas(canvas, viewport.width, viewport.height)

    if (options.background) {
      ctx.fillStyle = options.background
      ctx.fillRect(0, 0, viewport.width, viewport.height)
    }

    await this.pdfPage.render({
      canvasContext: options.canvasContext ?? ctx,
      viewport,
    }).promise
  }

  /**
   * Create an enhanced text layer with pretext-measured positioning.
   * Produces a transparent text overlay for selection, search, and accessibility
   * that aligns precisely with the canvas-rendered PDF.
   */
  async createTextLayer(
    container: HTMLElement,
    options: TextLayerOptions = {},
  ): Promise<PretextTextLayer> {
    const scale = options.scale ?? 1
    const viewport = this.pdfPage.getViewport({ scale })
    const textContent = await this.getTextContent(scale)

    const layer = new PretextTextLayer(
      container,
      textContent,
      viewport.width,
      viewport.height,
      options,
    )
    layer.render()
    return layer
  }

  /**
   * Reflow extracted PDF text at an arbitrary width using pretext.
   * The killer feature: PDF text becomes responsive to any container size.
   *
   * Call `prepare` once (cached), then `layout` on every resize (~0.01ms).
   */
  async reflowText(
    maxWidth: number,
    options: ReflowOptions = {},
  ): Promise<ReflowedText> {
    const textContent = await this.getTextContent(1)
    const lineHeight = options.lineHeight ?? 24

    const lines: ReflowedLine[] = []
    let totalHeight = 0

    for (const paragraph of textContent.paragraphs) {
      const font = options.font ?? paragraph.font
      const { lines: pLines } = layoutWithLines(
        paragraph.prepared,
        maxWidth,
        lineHeight,
      )

      for (const pLine of pLines) {
        lines.push({
          text: pLine.text,
          width: pLine.width,
          y: totalHeight,
          sourceItems: paragraph.sourceItemIndices.map((idx) => ({
            itemIndex: idx,
            charStart: 0,
            charEnd: textContent.items[idx]?.str.length ?? 0,
          })),
        })
        totalHeight += lineHeight
      }

      // Small gap between paragraphs
      totalHeight += lineHeight * 0.3
    }

    return {
      lines,
      height: totalHeight,
      lineCount: lines.length,
      sourcePageNum: this.pageNum,
    }
  }

  /**
   * Reflow PDF text and render it directly to a canvas.
   * Combines reflowText + canvas rendering in one call.
   */
  async renderReflowedText(
    canvas: HTMLCanvasElement,
    maxWidth: number,
    options: ReflowOptions & RenderOptions = {},
  ): Promise<ReflowedText> {
    const reflowed = await this.reflowText(maxWidth, options)
    const padding = 16

    const { ctx } = setupHiDPICanvas(
      canvas,
      maxWidth + padding * 2,
      reflowed.height + padding * 2,
    )

    if (options.background) {
      ctx.fillStyle = options.background
      ctx.fillRect(0, 0, maxWidth + padding * 2, reflowed.height + padding * 2)
    }

    const lineHeight = options.lineHeight ?? 24
    const baseline = baselineOffset(lineHeight)
    const textContent = await this.getTextContent(1)
    const font = options.font ?? textContent.paragraphs[0]?.font ?? '16px sans-serif'

    ctx.font = font
    ctx.fillStyle = '#000000'

    for (const line of reflowed.lines) {
      ctx.fillText(line.text, padding, padding + line.y + baseline)
    }

    return reflowed
  }

  /**
   * Search within this page using character-level precision.
   * Returns matches with pixel-accurate highlight rectangles.
   */
  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchHit[]> {
    const textContent = await this.getTextContent(1)
    const hits = PretextSearch.searchPage(textContent, query, this.pageNum, options)

    // Compute highlight rects for each hit
    if (hits.length > 0) {
      const lineHeight = 24
      const maxWidth = this.pdfPage.getViewport({ scale: 1 }).width
      const allRects = PretextSearch.computeHighlightRects(
        textContent,
        query,
        maxWidth,
        lineHeight,
        1,
        options,
      )
      for (let i = 0; i < hits.length && i < allRects.length; i++) {
        hits[i].rects = allRects[i]
      }
    }

    return hits
  }

  /**
   * Get annotations with pretext-measured text bounds.
   * Enables accurate popup/bubble sizing without DOM measurement.
   */
  async getAnnotations(options: { scale?: number; maxWidth?: number } = {}): Promise<MeasuredAnnotation[]> {
    const scale = options.scale ?? 1
    const maxWidth = options.maxWidth ?? 250
    const annotations = await this.pdfPage.getAnnotations()
    return measureAnnotations(annotations, this.fontMapper, maxWidth, scale)
  }

  /**
   * Generate a page thumbnail.
   * Normal mode: renders at small scale.
   * Reflow mode: extracts and reflows text for readability at any size.
   */
  async thumbnail(
    canvas: HTMLCanvasElement,
    options: ThumbnailOptions = {},
  ): Promise<void> {
    if (options.reflowText) {
      const textContent = await this.getTextContent(1)
      await renderThumbnail(canvas, textContent, options)
    } else {
      // Normal thumbnail: render at small scale
      const targetWidth = options.width ?? 150
      const viewport = this.pdfPage.getViewport({ scale: 1 })
      const scale = options.scale ?? targetWidth / viewport.width
      await this.renderToCanvas(canvas, { scale })
    }
  }

  /** Access the prepared text content (for advanced use) */
  async getTextContent(scale = 1): Promise<PreparedTextContent> {
    return this.cache.getOrPrepare(this.docId, this.pageNum, () =>
      extractAndPrepare(this.pdfPage, this.fontMapper, scale),
    )
  }

  /** Dispose page-level cache entry */
  dispose(): void {
    this.cache.evict(this.docId, this.pageNum)
  }
}
