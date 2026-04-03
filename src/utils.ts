// ── HiDPI Canvas Setup ────────────────────────────────────────

export function setupHiDPICanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): { ctx: CanvasRenderingContext2D; dpr: number } {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, dpr }
}

// ── PDF Coordinate Helpers ────────────────────────────────────

/** PDF uses 72 DPI points, CSS uses 96 DPI pixels */
export const PDF_TO_CSS = 96 / 72

/** Extract font size from a PDF text item's transform matrix */
export function fontSizeFromTransform(transform: number[]): number {
  // transform = [scaleX, skewX, skewY, scaleY, translateX, translateY]
  // Font size = vertical scale magnitude
  return Math.sqrt(transform[2] * transform[2] + transform[3] * transform[3])
}

/** Convert PDF page coordinates to viewport coordinates */
export function pageToViewport(
  x: number,
  y: number,
  viewportHeight: number,
): { x: number; y: number } {
  // PDF origin is bottom-left, canvas/DOM is top-left
  return { x, y: viewportHeight - y }
}

// ── Simple Event Emitter ──────────────────────────────────────

export class EventEmitter<T extends string> {
  private listeners = new Map<T, Set<Function>>()

  on(event: T, handler: Function): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler)
  }

  off(event: T, handler: Function): void {
    this.listeners.get(event)?.delete(handler)
  }

  emit(event: T, ...args: any[]): void {
    this.listeners.get(event)?.forEach((fn) => fn(...args))
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }
}

// ── Environment Detection ─────────────────────────────────────

export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export function isNode(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).process !== 'undefined' &&
    (globalThis as any).process.versions != null &&
    (globalThis as any).process.versions.node != null
  )
}

// ── Baseline Offset ───────────────────────────────────────────

/** Approximate alphabetic baseline offset within a line height */
export function baselineOffset(lineHeight: number): number {
  return lineHeight * 0.68
}
