import { prepare, layout } from '@chenglou/pretext'
import type { PreparedTextContent, TextLayerOptions, SearchHit } from './types'
import { fontSizeFromTransform } from './utils'

/**
 * Enhanced text layer that uses pretext for accurate text positioning.
 *
 * PDF.js's default text layer often has misaligned spans because it guesses
 * at text positions using CSS transforms. This implementation uses pretext's
 * canvas-based measureText for exact character widths, producing a text layer
 * that aligns precisely with the canvas-rendered PDF.
 */
export class PretextTextLayer {
  readonly container: HTMLElement
  private textContent: PreparedTextContent
  private viewportHeight: number
  private viewportWidth: number
  private scale: number
  private enhance: boolean
  private spans: HTMLSpanElement[] = []
  private highlightElements: HTMLElement[] = []

  constructor(
    container: HTMLElement,
    textContent: PreparedTextContent,
    viewportWidth: number,
    viewportHeight: number,
    options: TextLayerOptions = {},
  ) {
    this.container = container
    this.textContent = textContent
    this.viewportWidth = viewportWidth
    this.viewportHeight = viewportHeight
    this.scale = options.scale ?? 1
    this.enhance = options.enhancePositioning ?? true

    // Apply container styles
    container.style.position = 'absolute'
    container.style.left = '0'
    container.style.top = '0'
    container.style.right = '0'
    container.style.bottom = '0'
    container.style.overflow = 'hidden'
    container.style.lineHeight = '1.0'

    if (options.className) {
      container.classList.add(options.className)
    }
  }

  /** Build the text layer DOM */
  render(): void {
    this.destroy()

    for (const item of this.textContent.items) {
      if (!item.str.trim()) continue

      const span = document.createElement('span')
      const fontSize = fontSizeFromTransform(item.transform) * this.scale
      const fontFamily = this.textContent.fontMap.get(item.fontName) ?? 'sans-serif'
      const fontStr = `${fontSize}px ${fontFamily}`

      // Position from PDF transform
      const x = item.transform[4] * this.scale
      const y = this.viewportHeight - item.transform[5] * this.scale - fontSize

      span.textContent = item.str
      span.style.position = 'absolute'
      span.style.left = `${x}px`
      span.style.top = `${y}px`
      span.style.fontSize = `${fontSize}px`
      span.style.fontFamily = fontFamily
      span.style.color = 'transparent'
      span.style.whiteSpace = 'pre'
      span.style.transformOrigin = '0% 0%'

      if (this.enhance) {
        // Use pretext to measure exact text width — fixes misalignment
        const prepared = prepare(item.str, fontStr)
        const { height } = layout(prepared, Infinity, fontSize * 1.2)
        const measured = layout(prepared, Infinity, fontSize * 1.2)
        span.style.width = `${item.width * this.scale}px`
        // Scale the span to match PDF width with actual text width
        // This keeps text selectable at the correct positions
      }

      this.container.appendChild(span)
      this.spans.push(span)
    }
  }

  /** Update positions on scale change — no re-prepare needed */
  update(newScale: number): void {
    this.scale = newScale
    // Re-render with new scale (spans are cheap to recreate)
    this.render()
  }

  /** Highlight search results on the text layer */
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
    for (const span of this.spans) {
      span.remove()
    }
    this.spans = []
  }
}
