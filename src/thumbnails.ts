import { layoutWithLines } from '@chenglou/pretext'
import type { PreparedTextContent, ThumbnailOptions } from './types'
import { setupHiDPICanvas, baselineOffset } from './utils'

/**
 * Generate page thumbnails with optional text reflow for readability.
 *
 * Normal mode: renders the PDF page at a small scale (standard shrink).
 * Reflow mode: extracts text and reflows it at thumbnail width using pretext,
 * producing readable text at any thumbnail size instead of a blurry shrink.
 */
export async function renderThumbnail(
  canvas: HTMLCanvasElement,
  textContent: PreparedTextContent,
  options: ThumbnailOptions = {},
): Promise<void> {
  const width = options.width ?? 150
  const font = options.reflowFont ?? '10px sans-serif'
  const lineHeight = options.reflowLineHeight ?? 14

  if (!options.reflowText) {
    // Normal mode is handled by PretextPage.renderToCanvas at small scale.
    // This function only handles reflow mode.
    return
  }

  // Reflow mode: render reflowed text to canvas for readable thumbnails
  const text = textContent.fullText
  if (!text.trim()) return

  const prepared = textContent.fullPrepared
  const padding = 8
  const contentWidth = width - padding * 2

  const { lines, height } = layoutWithLines(prepared, contentWidth, lineHeight)

  const totalHeight = height + padding * 2
  const { ctx } = setupHiDPICanvas(canvas, width, totalHeight)

  // Background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, totalHeight)

  // Render text
  ctx.font = font
  ctx.fillStyle = '#1a1a1a'
  const baseline = baselineOffset(lineHeight)

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    ctx.fillText(line.text, padding, padding + li * lineHeight + baseline)
  }

  // Subtle border
  ctx.strokeStyle = '#e0e0e0'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, width - 1, totalHeight - 1)
}
