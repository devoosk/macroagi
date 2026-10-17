/** URL-driven app mode. Capture mode renders one camera with no overlays (CLAUDE.md rule 2). */
const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')

export const appMode: 'demo' | 'capture' = params.get('mode') === 'capture' ? 'capture' : 'demo'
export const captureCam = params.get('cam')
export const isCapture = appMode === 'capture'
