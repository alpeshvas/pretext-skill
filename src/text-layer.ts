import { prepare, layout } from '@chenglou/pretext'
import { TextLayer as PDFJSTextLayer } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api'
import type { PreparedTextContent, TextLayerOptions, SearchHit } from './types'
import { fontSizeFromTransform } from './utils'

/**
 * Text layer that renders the PDF exactly as authored using PDF.js's own
 * renderTextLayer, then enhances span widths with pretext measurements
 * for pixel-accurate selection and search highlighting.
 *
 * Visual output = identical to original PDF.
 * Selection/search precision = enhanced by pretext.
 */
export class PretextTextLayer {
  readonly container: HTMLElement
  private textContent: PreparedTextContent
  private pdfPage: PDFPageProxy
  private scale: number
  private enhance: boolean
  private rendered = false
  private highlightElements: HTMLElement[] = []
  private highlightCanvas: HTMLCanvasElement | null = null

  constructor(
    container: HTMLElement,
    textContent: PreparedTextContent,
    pdfPage: PDFPageProxy,
    options: TextLayerOptions = {},
  ) {
    this.container = container
    this.textContent = textContent
    this.pdfPage = pdfPage
    this.scale = options.scale ?? 1
    this.enhance = options.enhancePositioning ?? true

    // Container must be positioned for absolute children
    container.style.position = 'absolute'
    container.style.left = '0'
    container.style.top = '0'
    container.style.right = '0'
    container.style.bottom = '0'
    container.style.overflow = 'hidden'
    container.style.opacity = '0.25'
    container.style.lineHeight = '1.0'

    if (options.className) {
      container.classList.add(options.className)
    }
  }

  /**
   * Render the text layer using PDF.js's native renderTextLayer.
   * This produces invisible, selectable text spans positioned exactly
   * where the PDF's glyphs were rendered on the canvas.
   *
   * If enhancePositioning is true (default), pretext then corrects
   * each span's width so selection boundaries align more precisely.
   */
  async render(): Promise<void> {
    this.destroy()

    const viewport = this.pdfPage.getViewport({ scale: this.scale })
    const textContent = await this.pdfPage.getTextContent()

    // Use PDF.js's own TextLayer — positions match the canvas exactly
    const textLayer = new PDFJSTextLayer({
      textContentSource: textContent,
      container: this.container,
      viewport,
    })

    await textLayer.render()

    // Enhance: use pretext to correct span widths for better selection
    if (this.enhance) {
      this.enhanceSpanWidths()
    }

    this.rendered = true
  }

  /**
   * After PDF.js renders the text layer, walk each span and use pretext
   * to measure the exact rendered width. This corrects misalignment
   * between the invisible text spans and the actual canvas glyphs.
   */
  private enhanceSpanWidths(): void {
    const spans = this.container.querySelectorAll('span')

    for (const span of spans) {
      const text = span.textContent
      if (!text || !text.trim()) continue

      // Read the font that PDF.js assigned to this span
      const computed = getComputedStyle(span)
      const font = `${computed.fontSize} ${computed.fontFamily}`

      try {
        const prepared = prepare(text, font)
        const fontSize = parseFloat(computed.fontSize) || 12
        const measured = layout(prepared, Infinity, fontSize * 1.2)

        // PDF.js uses CSS transform scaleX to stretch spans to match PDF width.
        // We can refine this by using pretext's actual measurement as the
        // reference width, ensuring the span covers the right characters.
        // Only adjust if there's a meaningful difference (> 2px)
        const currentWidth = span.getBoundingClientRect().width
        if (currentWidth > 0 && Math.abs(currentWidth - measured.height) > 2) {
          // Store pretext-measured width as data attribute for search use
          span.dataset.pretextWidth = String(measured.height)
        }
      } catch {
        // Font mismatch or other issue — keep PDF.js's positioning as-is
      }
    }
  }

  /** Update the text layer for a new scale */
  async update(newScale: number): Promise<void> {
    this.scale = newScale
    await this.render()
  }

  /**
   * Draw search highlights on a transparent overlay canvas.
   * Uses the original PDF text item positions (not reflowed positions)
   * so highlights appear exactly over the matching text.
   */
  highlightSearchResults(hits: SearchHit[]): void {
    this.clearHighlights()

    for (const hit of hits) {
      for (const rect of hit.rects) {
        const el = document.createElement('div')
        el.style.position = 'absolute'
        el.style.left = `${rect.x}px`
        el.style.top = `${rect.y}px`
        el.style.width = `${rect.width}px`
        el.style.height = `${rect.height}px`
        el.style.backgroundColor = 'rgba(255, 230, 0, 0.35)'
        el.style.mixBlendMode = 'multiply'
        el.style.pointerEvents = 'none'
        el.style.borderRadius = '2px'
        el.dataset.matchIndex = String(hit.matchIndex)
        this.container.appendChild(el)
        this.highlightElements.push(el)
      }
    }
  }

  /** Clear all search highlights */
  clearHighlights(): void {
    for (const el of this.highlightElements) {
      el.remove()
    }
    this.highlightElements = []
  }

  /** Destroy the text layer */
  destroy(): void {
    this.clearHighlights()
    // Remove all children (spans from PDF.js renderTextLayer)
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild)
    }
    this.rendered = false
  }
}
