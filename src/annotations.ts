import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import type { MeasuredAnnotation } from './types'
import { FontMapper } from './font-map'

/**
 * Measure annotation text using pretext for accurate bubble/popup sizing.
 *
 * PDF.js annotations with text content (popup, free text, sticky notes) need
 * to be sized to fit their text. Instead of DOM measurement, pretext gives
 * us exact bounds in ~0.01ms per layout call.
 */
export function measureAnnotations(
  annotations: any[],
  fontMapper: FontMapper,
  maxWidth: number,
  scale: number,
): MeasuredAnnotation[] {
  return annotations.map((annotation) => {
    const result: MeasuredAnnotation = { annotation }

    // Extract text from various annotation types
    const text = extractAnnotationText(annotation)
    if (!text) return result

    // Determine font for this annotation
    const fontSize = Math.round((annotation.fontSize ?? 12) * scale)
    const fontFamily = annotation.fontName
      ? fontMapper.mapFont(annotation.fontName, undefined, fontSize)
      : `${fontSize}px sans-serif`

    const font = annotation.fontName ? fontFamily : `${fontSize}px sans-serif`

    const prepared = prepareWithSegments(text, font)
    const lineHeight = fontSize * 1.4
    const { lines, height, lineCount } = layoutWithLines(prepared, maxWidth, lineHeight)

    result.textBounds = {
      width: Math.max(...lines.map((l) => l.width), 0),
      height,
      lineCount,
      lines: lines.map((l) => ({ text: l.text, width: l.width })),
    }

    return result
  })
}

/** Extract text content from various annotation types */
function extractAnnotationText(annotation: any): string | null {
  // Free text annotations have direct content
  if (annotation.subtype === 'FreeText' && annotation.contents) {
    return annotation.contents
  }

  // Popup/sticky note annotations
  if (annotation.contents) {
    return annotation.contents
  }

  // Rich text content (strip HTML tags)
  if (annotation.richText) {
    return annotation.richText.replace(/<[^>]+>/g, '')
  }

  return null
}
