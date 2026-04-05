import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextItem as PDFTextItem,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api'

// Re-export PDF.js types that consumers may need
export type { PDFDocumentProxy, PDFPageProxy }

// ── Load Options ──────────────────────────────────────────────

export interface LoadOptions {
  /** PDF.js worker source URL. Auto-detected if omitted. */
  workerSrc?: string
  /** Character map URL for CJK fonts */
  cMapUrl?: string
  /** Whether cMaps are packed (default true) */
  cMapPacked?: boolean
  /** Fallback CSS font when PDF font can't be mapped (default: 'sans-serif') */
  defaultFont?: string
  /** Manual overrides: PDF font name → CSS font string */
  fontMap?: Record<string, string>
  /** Max pages to keep in prepare cache (default 50) */
  cacheSize?: number
}

// ── Render Options ────────────────────────────────────────────

export interface RenderOptions {
  /** Scale factor (default 1) */
  scale?: number
  /** Optional pre-existing canvas context */
  canvasContext?: CanvasRenderingContext2D
  /** Canvas background color (default transparent) */
  background?: string
}

// ── Text Layer Options ────────────────────────────────────────

export interface TextLayerOptions {
  /** Scale factor (default 1) */
  scale?: number
  /** Use pretext for positioning instead of PDF.js defaults (default true) */
  enhancePositioning?: boolean
  /** CSS class for the text layer container */
  className?: string
}

// ── Reflow Options ────────────────────────────────────────────

export interface ReflowOptions {
  /** Line height in CSS pixels */
  lineHeight?: number
  /** CSS font override for reflowed text */
  font?: string
  /** White-space mode (default 'normal') */
  whiteSpace?: 'normal' | 'pre-wrap'
}

// ── Reflowed Text ─────────────────────────────────────────────

export interface ReflowedText {
  lines: ReflowedLine[]
  height: number
  lineCount: number
  sourcePageNum: number
}

export interface ReflowedLine {
  text: string
  width: number
  /** Computed y position in CSS pixels */
  y: number
  /** Back-references to original PDF text items */
  sourceItems: TextItemRef[]
}

export interface TextItemRef {
  itemIndex: number
  charStart: number
  charEnd: number
}

// ── Search ────────────────────────────────────────────────────

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface SearchHit {
  pageNum: number
  matchIndex: number
  text: string
  /** One rect per line the match spans */
  rects: SearchHitRect[]
}

export interface SearchHitRect {
  x: number
  y: number
  width: number
  height: number
  lineIndex: number
}

// ── Thumbnails ────────────────────────────────────────────────

export interface ThumbnailOptions {
  /** Target width in CSS pixels */
  width?: number
  /** Exact scale factor (overrides width) */
  scale?: number
  /** Reflow text for readability at small sizes (default false) */
  reflowText?: boolean
  /** Font for reflowed text */
  reflowFont?: string
  /** Line height for reflowed text */
  reflowLineHeight?: number
}

// ── Annotations ───────────────────────────────────────────────

export interface MeasuredAnnotation {
  /** Raw PDF.js annotation */
  annotation: any
  /** Pretext-computed text bounds (only if annotation has text) */
  textBounds?: {
    width: number
    height: number
    lineCount: number
    lines: Array<{ text: string; width: number }>
  }
}

// ── Cache ─────────────────────────────────────────────────────

export interface CacheStats {
  preparedHandles: number
  fontMappings: number
  pages: number
}

// ── Internal: Prepared text content for a page ────────────────

export interface TextStyle {
  fontFamily: string
  ascent: number
  descent: number
  vertical: boolean
}

/** A text item from PDF.js (only actual text, not marked content) */
export type TextItem = PDFTextItem & {
  str: string
  dir: string
  width: number
  height: number
  transform: number[]
  fontName: string
  hasEOL: boolean
}

export interface Paragraph {
  text: string
  font: string
  fontSize: number
  /** Pretext prepared handle */
  prepared: any
  /** Which TextItems compose this paragraph */
  sourceItemIndices: number[]
  /** Position in page coordinates */
  x: number
  y: number
  /** Which column this paragraph belongs to (0-based) */
  column: number
  /** Semantic role hint */
  role?: 'title' | 'authors' | 'abstract' | 'heading' | 'body' | 'footnote'
}

/** Detected page layout structure */
export interface PageLayout {
  /** Number of text columns detected */
  columnCount: number
  /** X boundaries of each column [{ left, right }, ...] */
  columns: Array<{ left: number; right: number }>
  /** Page width */
  pageWidth: number
  /** Whether an author/affiliation block was detected */
  hasAuthorBlock: boolean
}

export interface PreparedTextContent {
  items: TextItem[]
  styles: Record<string, TextStyle>
  paragraphs: Paragraph[]
  fontMap: Map<string, string>
  fullText: string
  fullPrepared: any
  /** Detected page layout (columns, author blocks, etc.) */
  layout: PageLayout
}

// ── Events ────────────────────────────────────────────────────

export type PretextPDFEvent = 'page-prepared' | 'font-mapped' | 'cache-cleared'
