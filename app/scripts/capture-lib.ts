/** Shared helpers for capture scripts (export-frames, check-determinism). Node only. */
import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer, { type Browser, type Page } from 'puppeteer'

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export type Args = Record<string, string | boolean>

/** Minimal `--key value` / `--flag` parser. */
export function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const [k, inline] = a.slice(2).split('=', 2)
    if (inline !== undefined) out[k] = inline
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]
    else out[k] = true
  }
  return out
}

export const str = (a: Args, k: string, d: string) => (typeof a[k] === 'string' ? (a[k] as string) : d)
export const num = (a: Args, k: string, d: number) => (typeof a[k] === 'string' ? Number(a[k]) : d)

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, () => {
      const p = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(p))
    })
    srv.on('error', reject)
  })
}

async function waitHttp(url: string, timeoutMs = 60000) {
  const t0 = Date.now()
  for (;;) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`server at ${url} did not come up`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

/** Spawn `vite` on a free port from app/; returns base URL and a stop function. */
export async function startVite(): Promise<{ url: string; stop: () => void; proc: ChildProcess }> {
  const port = await freePort()
  const bin = path.join(APP_DIR, 'node_modules', '.bin', 'vite')
  const proc = spawn(bin, ['--port', String(port), '--strictPort'], { cwd: APP_DIR, stdio: 'ignore' })
  const url = `http://localhost:${port}`
  await waitHttp(url)
  return { url, proc, stop: () => proc.kill('SIGTERM') }
}

export async function launchBrowser(width: number, height: number): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    defaultViewport: { width, height, deviceScaleFactor: 1 },
    args: [
      '--use-angle=metal',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      `--window-size=${width},${height}`,
    ],
  })
}

export function captureUrl(base: string, page: string, cam: string, width: number, height: number): string {
  const u = new URL(page, base.endsWith('/') ? base : base + '/')
  u.searchParams.set('mode', 'capture')
  u.searchParams.set('cam', cam)
  u.searchParams.set('w', String(width))
  u.searchParams.set('h', String(height))
  return u.toString()
}

/** Open a capture page and wait for window.__capture.ready. */
export async function openCapture(page: Page, url: string, timeoutMs = 60000) {
  // tsx/esbuild keepNames wraps named inner functions in __name(); define it in the page for page.evaluate bodies.
  await page.evaluateOnNewDocument('self.__name = (f) => f')
  page.on('pageerror', (e) => console.error(`[page error] ${e instanceof Error ? e.message : String(e)}`))
  await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })
  await page.waitForFunction(() => window.__capture?.ready === true, { timeout: timeoutMs, polling: 50 })
  return page.evaluate(() => ({ cameras: window.__capture!.cameras, camera: window.__capture!.camera, duration: window.__capture!.duration }))
}

/** Render sim time t and return the canvas as a data URL. */
export async function grabFrame(page: Page, t: number, mime = 'image/jpeg', quality = 0.9): Promise<string> {
  return page.evaluate(
    async (t, mime, quality) => {
      await window.__capture!.renderAt(t)
      const c = document.querySelector('canvas') as HTMLCanvasElement
      return c.toDataURL(mime, quality)
    },
    t,
    mime,
    quality,
  )
}

export const dataUrlToBuffer = (d: string) => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64')

/** `<t padded 6>` (+ `-mmm` only for fractional times). */
export function frameName(t: number): string {
  const whole = Math.floor(t + 1e-9)
  const ms = Math.round((t - whole) * 1000)
  return `${String(whole).padStart(6, '0')}${ms ? '-' + String(ms).padStart(3, '0') : ''}.jpg`
}

export const camDir = (id: string) => id.replace(/:/g, '_')
