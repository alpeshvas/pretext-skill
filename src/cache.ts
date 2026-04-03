import type { CacheStats, PreparedTextContent } from './types'

interface CacheEntry {
  docId: string
  pageNum: number
  data: PreparedTextContent
}

/**
 * LRU cache for pretext prepared handles, keyed by (docId, pageNum).
 * Prevents re-extracting and re-preparing text when scrolling back to a page.
 */
export class PrepareCache {
  private cache = new Map<string, CacheEntry>()
  private maxSize: number

  constructor(maxSize = 50) {
    this.maxSize = maxSize
  }

  private key(docId: string, pageNum: number): string {
    return `${docId}:${pageNum}`
  }

  /** Get cached data or create it via the factory, caching the result. */
  async getOrPrepare(
    docId: string,
    pageNum: number,
    factory: () => Promise<PreparedTextContent>,
  ): Promise<PreparedTextContent> {
    const k = this.key(docId, pageNum)
    const existing = this.cache.get(k)
    if (existing) {
      // LRU: move to end
      this.cache.delete(k)
      this.cache.set(k, existing)
      return existing.data
    }

    const data = await factory()
    const entry: CacheEntry = { docId, pageNum, data }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value!
      this.cache.delete(oldest)
    }

    this.cache.set(k, entry)
    return data
  }

  /** Check if a page is cached */
  has(docId: string, pageNum: number): boolean {
    return this.cache.has(this.key(docId, pageNum))
  }

  /** Evict a specific page */
  evict(docId: string, pageNum: number): void {
    this.cache.delete(this.key(docId, pageNum))
  }

  /** Evict all pages for a document */
  evictDocument(docId: string): void {
    for (const [k, entry] of this.cache) {
      if (entry.docId === docId) {
        this.cache.delete(k)
      }
    }
  }

  /** Clear everything */
  clear(): void {
    this.cache.clear()
  }

  /** Cache statistics */
  stats(): CacheStats {
    let fontMappings = 0
    let preparedHandles = 0
    for (const entry of this.cache.values()) {
      fontMappings += entry.data.fontMap.size
      preparedHandles += entry.data.paragraphs.length + 1 // +1 for fullPrepared
    }
    return {
      pages: this.cache.size,
      fontMappings,
      preparedHandles,
    }
  }
}
