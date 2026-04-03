import * as pdfjsLib from 'pdfjs-dist'
import { isBrowser } from './utils'

let configured = false

/**
 * Configure the PDF.js worker. Call before loadDocument(), or let it auto-detect.
 *
 * Strategy:
 * 1. Explicit workerSrc if provided
 * 2. Fall back to CDN URL matching pdfjs-dist version
 * 3. In Node.js, workers are not needed (PDF.js handles this)
 */
export function configureWorker(options?: {
  workerSrc?: string
}): void {
  if (configured) return

  if (options?.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = options.workerSrc
    configured = true
    return
  }

  // Auto-detect: use CDN for browser, skip for Node.js
  if (isBrowser()) {
    // Use the bundled worker from pdfjs-dist if available via import.meta,
    // otherwise fall back to unpkg CDN
    const version = pdfjsLib.version ?? '4.0.0'
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`
  }

  configured = true
}

/** Reset worker configuration (for testing) */
export function resetWorkerConfig(): void {
  configured = false
}
