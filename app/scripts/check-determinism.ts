/**
 * Determinism check: the same (cam, t) must give the same pixels.
 *  1. Fresh page A renders each t; fresh page B (new browser context) renders the same t's.
 *  2. Page A also scrubs out of order (later t, back to earlier t) and re-renders.
 * Compares lossless PNG pixels (byte-identical and per-pixel diff).
 *
 *   npx tsx scripts/check-determinism.ts --cam cctv:S02,fp:S02 --t 3,11.5,17 --url http://localhost:5185 --page /preview-capture.html
 *   (or --serve to spawn vite)
 * Exit code 1 on any mismatch.
 */
import type { Browser, Page } from 'puppeteer'
import { captureUrl, grabFrame, launchBrowser, num, openCapture, parseArgs, startVite, str } from './capture-lib'

const args = parseArgs(process.argv.slice(2))
const cams = str(args, 'cam', 'cctv:S02,fp:S02').split(',')
const times = str(args, 't', '3,11.5,17').split(',').map(Number)
const width = num(args, 'width', 960)
const height = num(args, 'height', 540)
const pagePath = str(args, 'page', '/')

async function freshPage(browser: Browser): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  return page
}

/** Decode two PNG data URLs in the page and count differing pixels / max channel delta. */
async function pixelDiff(page: Page, a: string, b: string) {
  return page.evaluate(async (a, b) => {
    const load = (src: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const img = new Image()
        img.onload = () => res(img)
        img.onerror = rej
        img.src = src
      })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const px = (img: HTMLImageElement) => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0)
      return g.getImageData(0, 0, c.width, c.height).data
    }
    const da = px(ia)
    const db = px(ib)
    let diff = 0
    let maxDelta = 0
    for (let i = 0; i < da.length; i += 4) {
      let d = 0
      for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(da[i + k] - db[i + k]))
      if (d) diff++
      maxDelta = Math.max(maxDelta, d)
    }
    return { diff, total: da.length / 4, maxDelta }
  }, a, b)
}

async function main() {
  let server: Awaited<ReturnType<typeof startVite>> | undefined
  let base = str(args, 'url', 'http://localhost:5173')
  if (args.serve) {
    server = await startVite()
    base = server.url
  }
  const browser = await launchBrowser(width, height)
  let failures = 0
  try {
    for (const cam of cams) {
      const url = captureUrl(base, pagePath, cam, width, height)
      const pa = await freshPage(browser)
      const pb = await freshPage(browser)
      await openCapture(pa, url)
      await openCapture(pb, url)
      const first: string[] = []
      for (const t of times) first.push(await grabFrame(pa, t, 'image/png'))
      // Fresh page, reverse order (also exercises scrubbing backwards).
      const second: string[] = []
      for (const t of [...times].reverse()) second.unshift(await grabFrame(pb, t, 'image/png'))
      // Same page, scrub away and back.
      const third: string[] = []
      for (const t of times) {
        await grabFrame(pa, t + 37)
        third.push(await grabFrame(pa, t, 'image/png'))
      }
      for (let i = 0; i < times.length; i++) {
        for (const [label, other] of [
          ['fresh page', second[i]],
          ['scrub back', third[i]],
        ] as const) {
          const same = first[i] === other
          const d = same ? { diff: 0, total: width * height, maxDelta: 0 } : await pixelDiff(pa, first[i], other)
          const ok = d.diff === 0
          if (!ok) failures++
          console.log(`${ok ? 'PASS' : 'FAIL'}  ${cam}  t=${times[i]}  ${label}: ${same ? 'byte-identical' : `${d.diff}/${d.total} px differ, max delta ${d.maxDelta}`}`)
        }
      }
      // Sanity: different times must differ (catches a frozen canvas).
      if (times.length > 1) {
        const d = await pixelDiff(pa, first[0], first[1])
        console.log(`${d.diff > 0 ? 'PASS' : 'FAIL'}  ${cam}  t=${times[0]} vs t=${times[1]} differ: ${d.diff} px`)
        if (d.diff === 0) failures++
      }
      await pa.browserContext().close()
      await pb.browserContext().close()
    }
  } finally {
    await browser.close()
    server?.stop()
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall determinism checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
