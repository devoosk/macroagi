/**
 * Export capture frames with headless Puppeteer.
 *
 *   npm run export -- --cam cctv:S05 --from 0 --to 120
 *   npx tsx scripts/export-frames.ts --cam all --from 0 --to 600 --fps 1 --serve --mp4 --gt
 *
 * Flags:
 *   --cam <id|all>        camera id (cctv:S02, fp:S02, cctv:S05#1) or all (default all)
 *   --from <s> --to <s>   sim-time range, [from, to) (default 0 .. log duration)
 *   --fps <n>             frames per sim second (default 1)
 *   --url <base>          dev server (default http://localhost:5173); ignored with --serve
 *   --page <path>         html page (default /), e.g. /preview-capture.html
 *   --query <qs>          extra page query, e.g. design=redesign (films line_redesign_1 / events_redesign_1;
 *                         camera ids and --gt then default to those files too)
 *   --serve               spawn vite on a free port for the run
 *   --out <dir>           frames root (default ../capture/frames, relative to app/)
 *   --width/--height      frame size (default 960x540)
 *   --concurrency <n>     parallel pages (default 2)
 *   --quality <0..1>      JPEG quality (default 0.9)
 *   --mp4                 assemble <cam>.mp4 per camera with ffmpeg if available
 *   --mp4-fps <n>         video frame rate (default = fps)
 *   --gt                  ALSO write capture/ground_truth/<cam>.json from the event log (scoring only)
 *   --gt-out <dir>        ground-truth root (default ../capture/ground_truth)
 *   --line / --events     data files for --gt (default public/data/line.json, events_current.json)
 *
 * The per-camera manifest.json carries no labels, ops or events: it must not leak ground truth.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from 'puppeteer'
import type { EventLog, Line } from '../src/contracts/types'
import { APP_DIR, camDir, captureUrl, dataUrlToBuffer, frameName, grabFrame, launchBrowser, num, openCapture, parseArgs, startVite, str } from './capture-lib'
import { CAMERA_IDS, findCamera } from '../src/capture/cameras'

const args = parseArgs(process.argv.slice(2))
const camArg = str(args, 'cam', 'all')
const fps = num(args, 'fps', 1)
const width = num(args, 'width', 960)
const height = num(args, 'height', 540)
const concurrency = Math.max(1, num(args, 'concurrency', 2))
const quality = num(args, 'quality', 0.9)
const pagePath = str(args, 'page', '/')
const query = str(args, 'query', '')
const redesign = new URLSearchParams(query.replace(/^[?&]/, '')).get('design') === 'redesign'
const outRoot = path.resolve(APP_DIR, str(args, 'out', '../capture/frames'))
const gtRoot = path.resolve(APP_DIR, str(args, 'gt-out', '../capture/ground_truth'))
const linePath = path.resolve(APP_DIR, str(args, 'line', redesign ? 'public/data/line_redesign_1.json' : 'public/data/line.json'))
const eventsPath = path.resolve(APP_DIR, str(args, 'events', redesign ? 'public/data/events_redesign_1.json' : 'public/data/events_current.json'))

function haveFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function frameTimes(from: number, to: number): number[] {
  const out: number[] = []
  const n = Math.max(0, Math.ceil((to - from) * fps - 1e-9))
  for (let i = 0; i < n; i++) out.push(Math.round((from + i / fps) * 1000) / 1000)
  return out
}

/** Ground truth for scoring only: ops/state at the camera's station over the frame times. Never given to the VLM. */
function groundTruth(line: Line, log: EventLog, camId: string, times: { t: number; file: string }[], from: number, to: number) {
  const def = findCamera(line, camId)!
  const sid = def.stationId
  const opById = new Map(line.operations.map((o) => [o.id, o]))
  const evs = log.events.filter((e) => e.station === sid && (def.bay === undefined || e.bay === undefined || e.bay === def.bay))
  const segments: { operation: string; verb: string; parts: string[]; unit: string; variant: string; bay?: number; start: number; end: number }[] = []
  const open = new Map<string, (typeof evs)[number]>()
  for (const e of evs) {
    const key = `${e.unit}|${e.operation}|${e.bay ?? ''}`
    if (e.event === 'op_start' && e.operation) open.set(key, e)
    else if (e.event === 'op_end' && e.operation) {
      const s = open.get(key)
      open.delete(key)
      if (s && e.time > from && s.time < to) {
        const op = opById.get(e.operation)
        segments.push({ operation: e.operation, verb: op?.verb ?? 'unknown', parts: op?.parts ?? [], unit: e.unit, variant: e.variant, bay: e.bay, start: s.time, end: e.time })
      }
    }
  }
  const stateEvents = evs.filter((e) => e.event !== 'op_start' && e.event !== 'op_end' && e.time >= from && e.time < to)
  const frames = times.map(({ t, file }) => {
    const seg = segments.find((s) => s.start <= t && t < s.end)
    let state = 'idle'
    for (const e of evs) {
      if (e.time > t) break
      if (e.event === 'op_start' || e.event === 'op_end') continue
      state = e.event === 'start' ? 'working' : e.event === 'end' ? 'idle' : e.event
    }
    return { file, t, state, operation: seg?.operation ?? null, verb: seg?.verb ?? null, unit: seg?.unit ?? null, variant: seg?.variant ?? null }
  })
  return { camera: camId, station: sid, from, to, fps, segments, stateEvents, frames }
}

async function main() {
  const line: Line = JSON.parse(fs.readFileSync(linePath, 'utf8'))
  const log: EventLog | undefined = fs.existsSync(eventsPath) ? JSON.parse(fs.readFileSync(eventsPath, 'utf8')) : undefined
  const allIds = CAMERA_IDS(line)
  const cams = camArg === 'all' ? allIds : camArg.split(',')
  for (const c of cams) if (!allIds.includes(c)) throw new Error(`unknown camera ${c}; known: ${allIds.join(', ')}`)
  const from = num(args, 'from', 0)
  const to = num(args, 'to', log?.duration ?? 60)
  const times = frameTimes(from, to)

  let server: Awaited<ReturnType<typeof startVite>> | undefined
  let base = str(args, 'url', 'http://localhost:5173')
  if (args.serve) {
    server = await startVite()
    base = server.url
    console.log(`vite at ${base}`)
  }
  const browser = await launchBrowser(width, height)
  const t0 = Date.now()
  let done = 0
  const total = cams.length * times.length
  const queue = [...cams]

  async function runCamera(page: Page, cam: string) {
    const dir = path.join(outRoot, camDir(cam))
    fs.mkdirSync(dir, { recursive: true })
    const url = captureUrl(base, pagePath, cam, width, height, query)
    // One retry: a page that loads while vite is (re)optimising deps can miss its ready flag.
    const info = await openCapture(page, url).catch((e) => {
      console.warn(`\n${cam}: page not ready (${e instanceof Error ? e.message : e}); retrying once`)
      return openCapture(page, url)
    })
    if (info.camera !== cam) throw new Error(`page opened camera ${info.camera}, expected ${cam}`)
    const frames: { t: number; file: string }[] = []
    for (const t of times) {
      const data = await grabFrame(page, t, 'image/jpeg', quality)
      const file = frameName(t)
      fs.writeFileSync(path.join(dir, file), dataUrlToBuffer(data))
      frames.push({ t, file })
      done++
      if (done % 10 === 0 || done === total) {
        const s = (Date.now() - t0) / 1000
        process.stdout.write(`\r${done}/${total} frames  ${(done / s).toFixed(2)} fps  [${cam} t=${t}]      `)
      }
    }
    const def = findCamera(line, cam)!
    // Manifest: NO labels, operations or events.
    const manifest = { camera: cam, type: def.type, station: def.stationId, fps, from, to, width, height, frames }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    if (args.gt) {
      if (!log) throw new Error(`--gt needs the event log at ${eventsPath}`)
      fs.mkdirSync(gtRoot, { recursive: true })
      fs.writeFileSync(path.join(gtRoot, `${camDir(cam)}.json`), JSON.stringify(groundTruth(line, log, cam, frames, from, to), null, 2))
    }
    if (args.mp4) {
      if (!haveFfmpeg()) console.warn('\nffmpeg not found; skipping mp4')
      else {
        const vfps = num(args, 'mp4-fps', fps)
        const r = spawnSync(
          'ffmpeg',
          ['-y', '-loglevel', 'error', '-framerate', String(vfps), '-pattern_type', 'glob', '-i', path.join(dir, '*.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(outRoot, `${camDir(cam)}.mp4`)],
          { stdio: 'inherit' },
        )
        if (r.status !== 0) console.warn(`\nffmpeg failed for ${cam}`)
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, cams.length) }, async () => {
        // A fresh tab per camera: re-navigating one tab ~15 times exhausted WebGL resources and
        // the next page never became ready (60 s timeout on a full --cam all run).
        for (let cam = queue.shift(); cam; cam = queue.shift()) {
          const page = await browser.newPage()
          await page.setViewport({ width, height, deviceScaleFactor: 1 })
          try {
            await runCamera(page, cam)
          } finally {
            await page.close()
          }
        }
      }),
    )
  } finally {
    await browser.close()
    server?.stop()
  }
  const s = (Date.now() - t0) / 1000
  console.log(`\nwrote ${done} frames for ${cams.length} camera(s) to ${outRoot} in ${s.toFixed(1)} s (${(done / s).toFixed(2)} frames/s)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
