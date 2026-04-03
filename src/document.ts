import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import type {
  CacheStats,
  LoadOptions,
  PretextPDFEvent,
  SearchHit,
  SearchOptions,
} from './types'
import { PrepareCache } from './cache'
import { FontMapper } from './font-map'
import { PretextPage } from './page'
import { EventEmitter } from './utils'

/**
 * Wraps a PDF.js document with pretext-powered text capabilities.
 *
 * Manages a page cache so that pretext's expensive prepare() phase runs
 * at most once per page, while the cheap layout() phase runs on every
 * resize/reflow (~0.01ms).
 *
 * All original PDF.js functionality is available via the `pdf` escape hatch.
 */
export class PretextDocument {
  /** Escape hatch: raw PDF.js document proxy */
  readonly pdf: PDFDocumentProxy
  /** Unique document identifier for cache keying */
  readonly id: string

  private cache: PrepareCache
  private fontMapper: FontMapper
  private events = new EventEmitter<PretextPDFEvent>()

  constructor(pdf: PDFDocumentProxy, options: LoadOptions = {}) {
    this.pdf = pdf
    this.id = pdf.fingerprints?.[0] ?? `doc-${Date.now()}`
    this.cache = new PrepareCache(options.cacheSize ?? 50)
    this.fontMapper = new FontMapper(
      options.defaultFont ?? 'sans-serif',
      options.fontMap,
    )
  }

  /** Total page count */
  get numPages(): number {
    return this.pdf.numPages
  }

  /** Get a wrapped page with pretext capabilities */
  async getPage(num: number): Promise<PretextPage> {
    const pdfPage = await this.pdf.getPage(num)
    return new PretextPage(pdfPage, this.cache, this.fontMapper, this.id)
  }

  /**
   * Search across all pages. Yields results as each page is searched,
   * so the caller can show results incrementally.
   */
  async *searchAll(
    query: string,
    options: SearchOptions = {},
  ): AsyncGenerator<SearchHit> {
    for (let i = 1; i <= this.numPages; i++) {
      const page = await this.getPage(i)
      const hits = await page.search(query, options)
      for (const hit of hits) {
        yield hit
      }
    }
  }

  /** Get document metadata */
  async getMetadata(): Promise<{ info: any; metadata: any }> {
    const data = await this.pdf.getMetadata()
    return { info: data.info, metadata: data.metadata }
  }

  /**
   * Pre-prepare text for a range of pages in the background.
   * Useful for warming the cache ahead of user scrolling.
   */
  async preparePages(startPage: number, endPage: number): Promise<void> {
    const end = Math.min(endPage, this.numPages)
    const promises: Promise<void>[] = []

    for (let i = startPage; i <= end; i++) {
      if (!this.cache.has(this.id, i)) {
        promises.push(
          this.getPage(i).then(async (page) => {
            await page.getTextContent()
            this.events.emit('page-prepared', i)
          }),
        )
      }
    }

    await Promise.all(promises)
  }

  /** Cache statistics */
  get cacheStats(): CacheStats {
    return this.cache.stats()
  }

  /** Clear all cached prepare handles */
  clearCache(): void {
    this.cache.evictDocument(this.id)
    this.events.emit('cache-cleared')
  }

  /** Subscribe to events */
  on(event: PretextPDFEvent, handler: (...args: any[]) => void): void {
    this.events.on(event, handler)
  }

  /** Unsubscribe from events */
  off(event: PretextPDFEvent, handler: (...args: any[]) => void): void {
    this.events.off(event, handler)
  }

  /** Clean up resources */
  async destroy(): Promise<void> {
    this.cache.evictDocument(this.id)
    this.events.removeAllListeners()
    await this.pdf.destroy()
  }
}
