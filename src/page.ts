import { layoutWithLines } from '@chenglou/pretext'
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api'
import type {
  MeasuredAnnotation,
  PageLayout,
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

/** Result of a unified render() call */
export interface RenderResult {
  /** The text layer (if textLayerContainer was provided) */
  textLayer?: PretextTextLayer
  /** Detected page layout */
  layout: PageLayout
}

/**
 * Wraps a PDF.js page with pretext-powered text capabilities.
 *
 * Default mode: PDF.js renders the page exactly as authored on canvas.
 * Pretext operates invisibly underneath — powering text layer alignment,
 * character-level search, annotation sizing, and on-demand reflow.
 *
 * The raw PDF.js page is always available via the `pdfPage` escape hatch.
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

  // ── Primary: Render PDF exactly as authored ─────────────────

  /**
   * Render the PDF page exactly as it was written.
   *
   * - Canvas: PDF.js renders all glyphs, images, vectors natively
   * - Text layer (optional): PDF.js positions invisible spans at
   *   original coordinates, pretext refines widths for selection
   * - Annotations: PDF.js annotation layer
   *
   * This is the main entry point. The PDF looks identical to the original.
   * Pretext capabilities (search, reflow) work behind the scenes.
   *
   * @example
   * ```js
   * const { textLayer } = await page.render(canvas, {
   *   scale: 2,
   *   textLayerContainer: textLayerDiv,
   * })
   * // PDF renders exactly as authored
   * // textLayer enables selection + search highlighting
   * ```
   */
  async render(
    canvas: HTMLCanvasElement,
    options: RenderOptions & {
      textLayerContainer?: HTMLElement
      textLayerOptions?: TextLayerOptions
    } = {},
  ): Promise<RenderResult> {
    const scale = options.scale ?? 1

    // 1. Render PDF canvas — pure PDF.js, pixel-perfect original
    await this.renderToCanvas(canvas, options)

    // 2. Prepare text content (cached for search/reflow later)
    const textContent = await this.getTextContent(scale)

    // 3. Text layer — PDF.js renders it, pretext enhances positioning
    let textLayer: PretextTextLayer | undefined
    if (options.textLayerContainer) {
      textLayer = await this.createTextLayer(
        options.textLayerContainer,
        { scale, ...options.textLayerOptions },
      )
    }

    return { textLayer, layout: textContent.layout }
  }

  /**
   * Render the PDF page to a canvas with automatic HiDPI setup.
   * Pure PDF.js rendering — the output is identical to the original PDF.
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
   * Create an enhanced text layer using PDF.js's native renderTextLayer.
   * The text positions match exactly where PDF.js rendered glyphs on canvas.
   * Pretext refines span widths for better selection accuracy.
   */
  async createTextLayer(
    container: HTMLElement,
    options: TextLayerOptions = {},
  ): Promise<PretextTextLayer> {
    const scale = options.scale ?? 1
    const textContent = await this.getTextContent(scale)

    const layer = new PretextTextLayer(
      container,
      textContent,
      this.pdfPage,
      options,
    )
    await layer.render()
    return layer
  }

  // ── Search: highlights on original PDF coordinates ──────────

  /**
   * Search within this page. Highlight rects are positioned at the
   * original PDF text locations — they overlay exactly on the canvas
   * where the text was rendered.
   */
  async search(
    query: string,
    options: SearchOptions & { scale?: number } = {},
  ): Promise<SearchHit[]> {
    const scale = options.scale ?? 1
    const viewport = this.pdfPage.getViewport({ scale })
    const textContent = await this.getTextContent(scale)

    return PretextSearch.searchPage(
      textContent,
      query,
      this.pageNum,
      viewport.height,
      scale,
      options,
    )
  }

  // ── Reflow: on-demand reader mode ───────────────────────────

  /**
   * Reflow extracted PDF text at an arbitrary width using pretext.
   * This is an optional "reader mode" — it does NOT change the PDF
   * canvas rendering. Use when you want responsive text for a
   * different viewport.
   *
   * Handles multi-column layouts: columns are read in order,
   * full-width blocks (title, authors) are preserved.
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
      const isTitle = paragraph.role === 'title'
      const isAuthors = paragraph.role === 'authors'

      if (isTitle && totalHeight > 0) {
        totalHeight += lineHeight * 0.5
      }

      const effectiveLineHeight = isTitle
        ? lineHeight * 1.3
        : isAuthors
          ? lineHeight * 0.9
          : lineHeight

      const { lines: pLines } = layoutWithLines(
        paragraph.prepared,
        maxWidth,
        effectiveLineHeight,
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
        totalHeight += effectiveLineHeight
      }

      if (isTitle) {
        totalHeight += lineHeight * 0.6
      } else if (isAuthors) {
        totalHeight += lineHeight * 0.4
      } else {
        totalHeight += lineHeight * 0.3
      }
    }

    return {
      lines,
      height: totalHeight,
      lineCount: lines.length,
      sourcePageNum: this.pageNum,
    }
  }

  /**
   * Render reflowed text to a canvas (reader mode).
   * Separate from the PDF canvas — this creates its own rendering.
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

  // ── Annotations & Thumbnails ────────────────────────────────

  /**
   * Get annotations with pretext-measured text bounds.
   * Annotations are positioned at their original PDF locations.
   */
  async getAnnotations(options: { scale?: number; maxWidth?: number } = {}): Promise<MeasuredAnnotation[]> {
    const scale = options.scale ?? 1
    const maxWidth = options.maxWidth ?? 250
    const annotations = await this.pdfPage.getAnnotations()
    return measureAnnotations(annotations, this.fontMapper, maxWidth, scale)
  }

  /**
   * Generate a page thumbnail.
   * Normal mode: renders the original PDF at small scale.
   * Reflow mode: extracts and reflows text for readability.
   */
  async thumbnail(
    canvas: HTMLCanvasElement,
    options: ThumbnailOptions = {},
  ): Promise<void> {
    if (options.reflowText) {
      const textContent = await this.getTextContent(1)
      await renderThumbnail(canvas, textContent, options)
    } else {
      const targetWidth = options.width ?? 150
      const viewport = this.pdfPage.getViewport({ scale: 1 })
      const scale = options.scale ?? targetWidth / viewport.width
      await this.renderToCanvas(canvas, { scale })
    }
  }

  // ── Layout & Text Access ────────────────────────────────────

  /** Get the detected page layout (column count, structure) */
  async getLayout(): Promise<PageLayout> {
    const textContent = await this.getTextContent(1)
    return textContent.layout
  }

  /** Access prepared text content (for advanced use) */
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
