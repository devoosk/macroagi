import * as THREE from 'three'
import { rng } from '../../lib/rng'
import type { HallLayout } from './layout'

/** Fast deterministic PRNG for per-pixel loops, seeded from the shared seeded RNG. */
function fast(seed: () => number) {
  let a = Math.floor(seed() * 4294967296) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Ctx = CanvasRenderingContext2D

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true }) as Ctx
  return { c, ctx }
}

interface TexOpts {
  srgb?: boolean
  repeat?: [number, number]
  anisotropy?: number
  wrap?: boolean
}

function finish(c: HTMLCanvasElement, o: TexOpts = {}) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace
  if (o.wrap !== false) {
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
  }
  if (o.repeat) t.repeat.set(...o.repeat)
  t.anisotropy = o.anisotropy ?? 4
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.needsUpdate = true
  return t
}

/** Add per-pixel luminance noise of +-amp to the whole canvas. */
function grain(ctx: Ctx, w: number, h: number, amp: number, r: () => number) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 2 * amp
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
  }
  ctx.putImageData(img, 0, 0)
}

function blob(ctx: Ctx, x: number, y: number, rad: number, rgba: string, sx = 1, sy = 1) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(sx, sy)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad)
  g.addColorStop(0, rgba)
  g.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'))
  ctx.fillStyle = g
  ctx.fillRect(-rad, -rad, rad * 2, rad * 2)
  ctx.restore()
}

/**
 * Epoxy floor over the whole hall: colour and roughness maps in hall UV space (0..1).
 * Mottling, roller streaks, saw-cut slab joints, traffic wear and tyre marks.
 */
export function floorTextures(L: HallLayout, size: number, anisotropy: number) {
  const W = size
  const H = Math.round((size * L.width) / L.length / 4) * 4
  const R = rng('env', 'floor')
  const f = fast(R)
  const px = (x: number) => ((x - L.x0) / L.length) * W
  const pz = (z: number) => ((z - L.z0) / L.width) * H
  const ppm = W / L.length

  const { c, ctx } = makeCanvas(W, H)
  ctx.fillStyle = '#7b8288'
  ctx.fillRect(0, 0, W, H)
  // Low-frequency mottling (light and dark).
  for (let i = 0; i < 520; i++) {
    const light = R() < 0.5
    blob(ctx, R() * W, R() * H, (1.5 + R() * 7) * ppm, light ? `rgba(200,205,210,${0.035 + R() * 0.05})` : `rgba(40,45,50,${0.035 + R() * 0.05})`, 1, 0.6 + R() * 0.8)
  }
  // Roller streaks along X.
  ctx.globalAlpha = 1
  for (let i = 0; i < 260; i++) {
    const y = R() * H
    const x = R() * W
    const len = (2 + R() * 10) * ppm
    ctx.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)'
    ctx.fillRect(x, y, len, (0.15 + R() * 0.4) * ppm)
  }
  // Traffic wear: darker, scuffed bands in aisles and the operator zone.
  const b = L.bounds
  const wearBands: [number, number, number, number, number][] = [
    [b.minX - 2, b.maxX + 2, b.minZ + 0.4, b.maxZ, 0.05],
    [L.x0 + 1, L.x1 - 1, L.zones.rack[1] + 0.8, L.zones.agvLane[0] - 0.2, 0.06],
    [L.x0 + 1, L.x1 - 1, L.zones.agvLane[0], L.zones.agvLane[1], 0.05],
    [L.x0 + 1, L.x1 - 1, L.zones.walkway[0], L.zones.walkway[1], 0.03],
  ]
  for (const [ax, bx, az, bz, a] of wearBands) {
    for (let i = 0; i < 160; i++) {
      const x = px(ax + R() * (bx - ax))
      const z = pz(az + R() * (bz - az))
      blob(ctx, x, z, (0.4 + R() * 1.6) * ppm, `rgba(55,55,52,${a * (0.5 + R())})`, 1.8, 0.7)
    }
  }
  // Tyre marks in the forklift aisle.
  ctx.lineCap = 'round'
  for (let i = 0; i < 70; i++) {
    const zc = L.zones.rack[1] + 0.8 + R() * (L.zones.agvLane[0] - L.zones.rack[1] - 1.2)
    const x = L.x0 + 2 + R() * (L.length - 4)
    const len = 2 + R() * 8
    const bend = (R() - 0.5) * 3
    ctx.strokeStyle = `rgba(25,25,25,${0.05 + R() * 0.07})`
    ctx.lineWidth = Math.max(1, 0.12 * ppm)
    for (const off of [0, 0.9]) {
      ctx.beginPath()
      ctx.moveTo(px(x), pz(zc + off))
      ctx.quadraticCurveTo(px(x + len / 2), pz(zc + off + bend), px(x + len), pz(zc + off + bend * 0.3))
      ctx.stroke()
    }
  }
  // Oil drips and stains.
  for (let i = 0; i < 40; i++) {
    blob(ctx, px(L.x0 + R() * L.length), pz(L.z0 + R() * L.width), (0.08 + R() * 0.35) * ppm, `rgba(30,28,24,${0.12 + R() * 0.2})`, 1, 0.6 + R() * 0.6)
  }
  // Saw-cut slab joints on a 6 m grid (epoxy shows them as thin darker lines).
  ctx.strokeStyle = 'rgba(40,42,45,0.3)'
  ctx.lineWidth = Math.max(1, 0.012 * ppm)
  for (let x = Math.ceil(L.x0 / 6) * 6; x < L.x1; x += 6) {
    ctx.beginPath()
    ctx.moveTo(px(x), 0)
    ctx.lineTo(px(x), H)
    ctx.stroke()
  }
  for (let z = Math.ceil(L.z0 / 6) * 6; z < L.z1; z += 6) {
    ctx.beginPath()
    ctx.moveTo(0, pz(z))
    ctx.lineTo(W, pz(z))
    ctx.stroke()
  }
  grain(ctx, W, H, 6, f)
  const map = finish(c, { wrap: false, anisotropy })

  // Roughness: glossy epoxy, rougher where worn.
  const RW = Math.min(1024, W)
  const RH = Math.round((RW * H) / W)
  const rr = makeCanvas(RW, RH)
  const rs = RW / W
  rr.ctx.fillStyle = 'rgb(80,80,80)'
  rr.ctx.fillRect(0, 0, RW, RH)
  for (let i = 0; i < 300; i++) {
    const v = R() < 0.6 ? 150 : 60
    blob(rr.ctx, R() * RW, R() * RH, (1 + R() * 5) * ppm * rs, `rgba(${v},${v},${v},${0.15 + R() * 0.2})`)
  }
  for (const [ax, bx, az, bz] of wearBands) {
    for (let i = 0; i < 90; i++) {
      blob(rr.ctx, px(ax + R() * (bx - ax)) * rs, pz(az + R() * (bz - az)) * rs, (0.6 + R() * 1.5) * ppm * rs, `rgba(170,170,170,${0.15 + R() * 0.2})`, 1.6, 0.8)
    }
  }
  grain(rr.ctx, RW, RH, 10, f)
  const roughnessMap = finish(rr.c, { srgb: false, wrap: false, anisotropy })
  return { map, roughnessMap }
}

/** Precast concrete: tileable, pores and form marks. UV in metres, 2 m tile. */
export function concreteTexture() {
  const S = 512
  const R = rng('env', 'concrete')
  const { c, ctx } = makeCanvas(S, S)
  ctx.fillStyle = '#a3a19c'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 160; i++) {
    const v = R() < 0.5 ? '235,232,225' : '70,68,64'
    const x = R() * S
    const y = R() * S
    const r = 10 + R() * 60
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) blob(ctx, x + ox, y + oy, r, `rgba(${v},${0.04 + R() * 0.05})`)
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(40,40,38,${0.2 + R() * 0.4})`
    const r = 0.5 + R() * 1.5
    ctx.beginPath()
    ctx.arc(R() * S, R() * S, r, 0, Math.PI * 2)
    ctx.fill()
  }
  grain(ctx, S, S, 10, fast(R))
  return finish(c, { repeat: [0.5, 0.5] })
}

/** Kraft cardboard with a tape band across the middle. Standard 0..1 box UVs. */
export function cardboardTexture() {
  const S = 256
  const R = rng('env', 'cardboard')
  const { c, ctx } = makeCanvas(S, S)
  ctx.fillStyle = '#b38b5d'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = R() < 0.5 ? 'rgba(90,60,30,0.06)' : 'rgba(230,200,160,0.06)'
    ctx.fillRect(R() * S, R() * S, 1 + R() * 30, 1)
  }
  // Tape band.
  ctx.fillStyle = 'rgba(200,170,120,0.85)'
  ctx.fillRect(0, S * 0.44, S, S * 0.12)
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(0, S * 0.45, S, S * 0.02)
  // Edge darkening (dirty edges).
  const g = ctx.createLinearGradient(0, 0, S, 0)
  g.addColorStop(0, 'rgba(60,40,20,0.25)')
  g.addColorStop(0.06, 'rgba(60,40,20,0)')
  g.addColorStop(0.94, 'rgba(60,40,20,0)')
  g.addColorStop(1, 'rgba(60,40,20,0.25)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  grain(ctx, S, S, 8, fast(R))
  return finish(c, { wrap: false })
}

/** Yellow/black 45 degree hazard hatch, seamless, scuffed. UV in metres, 0.8 m tile. */
export function hatchTexture() {
  const S = 256
  const R = rng('env', 'hatch')
  const { c, ctx } = makeCanvas(S, S)
  ctx.fillStyle = '#1d1d1b'
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = '#e2b512'
  const P = 64
  for (let k = -S; k < 2 * S; k += P) {
    ctx.beginPath()
    ctx.moveTo(k, 0)
    ctx.lineTo(k + P / 2, 0)
    ctx.lineTo(k + P / 2 - S, S)
    ctx.lineTo(k - S, S)
    ctx.closePath()
    ctx.fill()
  }
  for (let i = 0; i < 120; i++) {
    blob(ctx, R() * S, R() * S, 4 + R() * 16, `rgba(120,120,115,${0.08 + R() * 0.12})`, 2, 0.5)
  }
  grain(ctx, S, S, 10, fast(R))
  return finish(c, { repeat: [1.25, 1.25] })
}

/** Paint wear for floor lines: white with scuffs (multiplies the paint colour). UV in metres. */
export function paintWearTexture() {
  const W = 1024
  const H = 64
  const R = rng('env', 'paint')
  const { c, ctx } = makeCanvas(W, H)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 220; i++) {
    const x = R() * W
    blob(ctx, x, R() * H, 3 + R() * 18, `rgba(110,110,110,${0.1 + R() * 0.3})`, 2.5, 0.6)
    if (x < 40) blob(ctx, x + W, R() * H, 6, 'rgba(110,110,110,0.2)', 2.5, 0.6)
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(90,90,90,${0.15 + R() * 0.3})`
    ctx.fillRect(R() * W, R() * H, 4 + R() * 40, 1)
  }
  grain(ctx, W, H, 12, fast(R))
  return finish(c, { repeat: [0.25, 1 / 0.12] })
}

/** Welded wire mesh alpha (50 x 200 mm cells) for safety fence panels. UV in metres. */
export function fenceMeshTexture() {
  const S = 512
  const { c, ctx } = makeCanvas(S, S)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = '#fff'
  const cellsX = 20
  const cellsY = 5
  for (let i = 0; i < cellsX; i++) ctx.fillRect((i * S) / cellsX, 0, 3, S)
  for (let j = 0; j < cellsY; j++) ctx.fillRect(0, (j * S) / cellsY, S, 4)
  return finish(c, { srgb: false })
}

/** Galvanised steel spangle (ducts, trays). UV in metres, 2 m tile. */
export function galvanisedTexture() {
  const S = 512
  const R = rng('env', 'galv')
  const { c, ctx } = makeCanvas(S, S)
  ctx.fillStyle = '#b9bdc0'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 1400; i++) {
    const v = 150 + Math.floor(R() * 90)
    ctx.fillStyle = `rgba(${v},${v + 3},${v + 6},0.35)`
    const x = R() * S
    const y = R() * S
    const r = 3 + R() * 12
    ctx.beginPath()
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + R()
      const rr = r * (0.6 + R() * 0.5)
      if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    ctx.closePath()
    ctx.fill()
  }
  grain(ctx, S, S, 6, fast(R))
  return finish(c, { repeat: [0.5, 0.5] })
}

/** Pallet softwood with grain. Box UVs in metres; 1 m tile. */
export function woodTexture() {
  const S = 256
  const R = rng('env', 'wood')
  const { c, ctx } = makeCanvas(S, S)
  ctx.fillStyle = '#c4a777'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 160; i++) {
    const y = R() * S
    ctx.strokeStyle = `rgba(120,85,45,${0.08 + R() * 0.15})`
    ctx.lineWidth = 0.5 + R() * 1.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= S; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 2 + (R() - 0.5) * 2)
    ctx.stroke()
  }
  for (let i = 0; i < 6; i++) blob(ctx, R() * S, R() * S, 4 + R() * 5, 'rgba(90,60,30,0.5)', 1.5, 1)
  grain(ctx, S, S, 10, fast(R))
  return finish(c)
}

/** Pallet-rack upright: blue with punched slots. UV v along length in metres. */
export function uprightTexture() {
  const W = 64
  const H = 512
  const { c, ctx } = makeCanvas(W, H)
  ctx.fillStyle = '#1f4f9a'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#0b1424'
  // 50 mm pitch slots: 512 px per 1 m => ~25.6 px per slot.
  for (let y = 4; y < H; y += 25.6) {
    ctx.fillRect(10, y, 8, 14)
    ctx.fillRect(W - 18, y, 8, 14)
  }
  return finish(c, { repeat: [1, 1] })
}

/** Light liner-panel grime for the inside of the cladding. UV in metres, 6 m tile. */
export function wallGrimeTexture() {
  const S = 512
  const R = rng('env', 'grime')
  const { c, ctx } = makeCanvas(S, S)
  ctx.fillStyle = '#f2f2f0'
  ctx.fillRect(0, 0, S, S)
  for (let i = 0; i < 140; i++) {
    const x = R() * S
    const y = R() * S
    const h = 20 + R() * 160
    const g = ctx.createLinearGradient(0, y, 0, y + h)
    g.addColorStop(0, `rgba(120,118,110,${0.05 + R() * 0.06})`)
    g.addColorStop(1, 'rgba(120,118,110,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, y, 2 + R() * 10, h)
  }
  for (let i = 0; i < 60; i++) blob(ctx, R() * S, R() * S, 20 + R() * 80, `rgba(150,150,140,${0.03 + R() * 0.04})`)
  grain(ctx, S, S, 4, fast(R))
  return finish(c, { repeat: [1 / 6, 1 / 6] })
}

/** Twin-wall polycarbonate rooflight pattern for the emissive map. UV in metres. */
export function polycarbonateTexture() {
  const S = 256
  const R = rng('env', 'poly')
  const { c, ctx } = makeCanvas(S, S)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = 'rgba(150,160,170,0.35)'
  for (let x = 0; x < S; x += 16) ctx.fillRect(x, 0, 2, S)
  for (let i = 0; i < 40; i++) blob(ctx, R() * S, R() * S, 20 + R() * 50, `rgba(170,175,180,${0.08 + R() * 0.1})`)
  return finish(c, { repeat: [1, 1] })
}
