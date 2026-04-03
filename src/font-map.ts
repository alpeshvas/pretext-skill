import type { TextStyle } from './types'

/**
 * Maps PDF internal font names to CSS font strings usable by canvas and pretext.
 *
 * Strategy:
 * 1. Check user overrides
 * 2. Use textContent.styles[fontName].fontFamily as primary hint
 * 3. Apply heuristic name cleaning (strip subset prefixes, PS suffixes)
 * 4. Fall back to configurable default font
 */
export class FontMapper {
  private defaultFont: string
  private userOverrides: Map<string, string>
  private resolved = new Map<string, string>()

  constructor(defaultFont = 'sans-serif', userOverrides?: Record<string, string>) {
    this.defaultFont = defaultFont
    this.userOverrides = new Map(Object.entries(userOverrides ?? {}))
  }

  /**
   * Map a PDF font name + style info to a CSS font string.
   * Returns a string like '16px "Times New Roman"' suitable for
   * both canvas ctx.font and pretext prepare().
   */
  mapFont(
    pdfFontName: string,
    style: TextStyle | undefined,
    fontSize: number,
  ): string {
    const cached = this.resolved.get(pdfFontName)
    if (cached) {
      return `${fontSize}px ${cached}`
    }

    const family = this.resolveFamily(pdfFontName, style)
    this.resolved.set(pdfFontName, family)
    return `${fontSize}px ${family}`
  }

  /** Bulk map all fonts from a textContent result */
  mapAllFonts(
    styles: Record<string, TextStyle>,
  ): Map<string, string> {
    const result = new Map<string, string>()
    for (const [name, style] of Object.entries(styles)) {
      const family = this.resolveFamily(name, style)
      result.set(name, family)
      this.resolved.set(name, family)
    }
    return result
  }

  /** Get current resolved mappings (for debugging) */
  getMappings(): ReadonlyMap<string, string> {
    return this.resolved
  }

  private resolveFamily(pdfFontName: string, style?: TextStyle): string {
    // 1. User override takes priority
    const override = this.userOverrides.get(pdfFontName)
    if (override) return override

    // 2. Use PDF.js style fontFamily if available
    if (style?.fontFamily) {
      const cleaned = cleanFontFamily(style.fontFamily)
      if (cleaned) return quoteFamily(cleaned)
    }

    // 3. Heuristic: clean the PDF font name itself
    const cleaned = cleanPdfFontName(pdfFontName)
    if (cleaned) return quoteFamily(cleaned)

    // 4. Fallback
    return this.defaultFont
  }
}

// ── PDF Standard 14 Fonts ─────────────────────────────────────

const STANDARD_14: Record<string, string> = {
  'Courier': '"Courier New", monospace',
  'Courier-Bold': 'bold "Courier New", monospace',
  'Courier-Oblique': 'italic "Courier New", monospace',
  'Courier-BoldOblique': 'bold italic "Courier New", monospace',
  'Helvetica': '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Helvetica-Bold': 'bold "Helvetica Neue", Helvetica, Arial, sans-serif',
  'Helvetica-Oblique': 'italic "Helvetica Neue", Helvetica, Arial, sans-serif',
  'Helvetica-BoldOblique': 'bold italic "Helvetica Neue", Helvetica, Arial, sans-serif',
  'Times-Roman': '"Times New Roman", Times, serif',
  'Times-Bold': 'bold "Times New Roman", Times, serif',
  'Times-Italic': 'italic "Times New Roman", Times, serif',
  'Times-BoldItalic': 'bold italic "Times New Roman", Times, serif',
  'Symbol': 'Symbol, serif',
  'ZapfDingbats': 'ZapfDingbats, sans-serif',
}

// ── Heuristic Font Name Cleaning ──────────────────────────────

/** Strip subset prefix (e.g., "BCDFEE+Calibri" → "Calibri") */
function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '')
}

/** Strip common PostScript suffixes */
function stripPsSuffixes(name: string): string {
  return name
    .replace(/PSMTr?$/, '')
    .replace(/MT$/, '')
    .replace(/-?(Regular|Roman|Book|Medium|Light)$/i, '')
}

/** Insert spaces before capitals in camelCase names: "TimesNewRoman" → "Times New Roman" */
function insertSpaces(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2')
}

/** Detect weight/style from name fragments */
function detectWeightStyle(name: string): { weight: string; style: string } {
  let weight = ''
  let style = ''
  if (/Bold/i.test(name)) weight = 'bold'
  if (/Italic|Oblique/i.test(name)) style = 'italic'
  return { weight, style }
}

function cleanPdfFontName(name: string): string | null {
  // Check standard 14 first
  if (STANDARD_14[name]) return STANDARD_14[name]

  let cleaned = stripSubsetPrefix(name)

  // Check standard 14 after prefix strip
  if (STANDARD_14[cleaned]) return STANDARD_14[cleaned]

  const { weight, style } = detectWeightStyle(cleaned)

  cleaned = stripPsSuffixes(cleaned)
  cleaned = cleaned.replace(/-?(Bold|Italic|Oblique|BoldItalic|BoldOblique)/gi, '')
  cleaned = insertSpaces(cleaned).trim()

  if (!cleaned) return null

  const prefix = [weight, style].filter(Boolean).join(' ')
  return prefix ? `${prefix} "${cleaned}"` : `"${cleaned}"`
}

function cleanFontFamily(family: string): string | null {
  // PDF.js sometimes gives us "sans-serif" or "monospace" directly
  if (['serif', 'sans-serif', 'monospace'].includes(family)) return family
  const trimmed = family.trim()
  return trimmed || null
}

function quoteFamily(family: string): string {
  // Already quoted or a generic family
  if (family.startsWith('"') || family.startsWith("'")) return family
  if (['serif', 'sans-serif', 'monospace'].includes(family)) return family
  // If it contains spaces or special chars, quote it
  if (/\s/.test(family) || /[^a-zA-Z0-9-]/.test(family)) return `"${family}"`
  return `"${family}"`
}
