/**
 * Copy one exported capture frame per camera into public/story/feeds/ for the story player's feed wall.
 *
 *   npx tsx scripts/export-frames.ts --cam all --from 2000 --to 2001 --width 360 --height 360 --out /tmp/feeds
 *   node scripts/story-feeds.mjs /tmp/feeds
 */
import fs from 'node:fs'
import path from 'node:path'

const src = process.argv[2] ?? '../capture/frames'
const out = path.resolve(import.meta.dirname, '../public/story/feeds')
fs.mkdirSync(out, { recursive: true })
const cams = []
for (const dir of fs.readdirSync(src).sort()) {
  const frames = fs.readdirSync(path.join(src, dir)).filter((f) => f.endsWith('.jpg')).sort().slice(0, 2)
  if (!frames.length) continue
  const [type, station] = dir.split('_')
  const names = frames.map((f, i) => {
    const name = `${dir}_${i}.jpg`
    fs.copyFileSync(path.join(src, dir, f), path.join(out, name))
    return name
  })
  cams.push({ id: `${type}:${station}`, station, fp: type === 'fp', frames: names })
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ cams }, null, 2) + '\n')
console.log(`wrote ${cams.length} cameras to ${out}`)
