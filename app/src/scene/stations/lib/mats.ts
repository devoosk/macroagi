import * as THREE from 'three'
import { rng } from '../../../lib/rng'

/**
 * Shared PBR materials and deterministic procedural textures (module scope, created once).
 * Textures are drawn on canvases from the seeded RNG, so every frame is reproducible.
 */

const hasDom = typeof document !== 'undefined'
const texCache = new Map<string, THREE.Texture>()

function canvasTexture(key: string, size: number, draw: (g: CanvasRenderingContext2D, r: () => number, n: number) => void, srgb = true) {
  const hit = texCache.get(key)
  if (hit) return hit
  if (!hasDom) return null
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  draw(g, rng('tex', key), size)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  texCache.set(key, t)
  return t
}

function withRepeat(base: THREE.Texture | null, rx: number, ry: number) {
  if (!base) return null
  const key = `${base.uuid}:${rx}:${ry}`
  const hit = texCache.get(key)
  if (hit) return hit
  const t = base.clone()
  t.repeat.set(rx, ry)
  t.needsUpdate = true
  texCache.set(key, t)
  return t
}

/** Fine horizontal streaks: brushed metal roughness / bump. */
export const brushedTex = () =>
  canvasTexture('brushed', 256, (g, r, n) => {
    g.fillStyle = '#808080'
    g.fillRect(0, 0, n, n)
    for (let i = 0; i < 1400; i++) {
      const y = r() * n
      const v = 100 + Math.floor(r() * 70)
      g.strokeStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.4})`
      g.lineWidth = 0.5 + r()
      g.beginPath()
      const x = r() * n
      g.moveTo(x - 80, y)
      g.lineTo(x + 80 + r() * 120, y + (r() - 0.5) * 1.2)
      g.stroke()
    }
  }, false)

/** Galvanised spangle pattern. */
export const spangleTex = () =>
  canvasTexture('spangle', 256, (g, r, n) => {
    g.fillStyle = '#b4b8bb'
    g.fillRect(0, 0, n, n)
    for (let i = 0; i < 220; i++) {
      const x = r() * n, y = r() * n, s = 8 + r() * 26
      const v = 160 + Math.floor(r() * 60)
      g.fillStyle = `rgba(${v},${v + 3},${v + 6},0.55)`
      g.beginPath()
      const k = 5 + Math.floor(r() * 3)
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2 + r() * 0.6
        const rr = s * (0.6 + r() * 0.5)
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
      }
      g.fill()
    }
  })

/** Aluminium fin stack: dense vertical lines. */
export const finTex = () =>
  canvasTexture('fins', 128, (g, _r, n) => {
    g.fillStyle = '#c9ced2'
    g.fillRect(0, 0, n, n)
    for (let x = 0; x < n; x += 4) {
      g.fillStyle = '#f2f5f7'
      g.fillRect(x, 0, 1, n)
      g.fillStyle = '#8a9095'
      g.fillRect(x + 2, 0, 1, n)
    }
  })

/** Perforated sheet (pegboard / acoustic panel). */
export const perfTex = () =>
  canvasTexture('perf', 128, (g, _r, n) => {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, n, n)
    g.fillStyle = '#222222'
    for (let y = 8; y < n; y += 16) for (let x = 8; x < n; x += 16) {
      g.beginPath()
      g.arc(x, y, 3.2, 0, Math.PI * 2)
      g.fill()
    }
  })

/** Corrugated cardboard: colour variation and faint flute lines. */
export const cardboardTex = () =>
  canvasTexture('cardboard', 256, (g, r, n) => {
    g.fillStyle = '#b8966c'
    g.fillRect(0, 0, n, n)
    for (let i = 0; i < 4000; i++) {
      const v = r()
      g.fillStyle = v > 0.5 ? 'rgba(90,65,40,0.035)' : 'rgba(235,215,185,0.04)'
      g.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2)
    }
    for (let x = 0; x < n; x += 8) {
      g.fillStyle = 'rgba(90,65,40,0.025)'
      g.fillRect(x, 0, 3, n)
    }
  })

/** Wire mesh (safety fence / guards): alpha map grid. */
export const meshAlphaTex = () =>
  canvasTexture('meshAlpha', 128, (g, _r, n) => {
    g.fillStyle = '#000000'
    g.fillRect(0, 0, n, n)
    g.fillStyle = '#ffffff'
    for (let i = 0; i < n; i += 16) {
      g.fillRect(i, 0, 3, n)
      g.fillRect(0, i, n, 3)
    }
  }, false)

/** Concentric-ring gauge dial with tick marks (no numerals). */
export const dialTex = () =>
  canvasTexture('dial', 256, (g, _r, n) => {
    const c = n / 2
    g.fillStyle = '#f4f4f0'
    g.fillRect(0, 0, n, n)
    g.strokeStyle = '#111'
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * 0.75 + (i / 40) * Math.PI * 1.5
      const long = i % 5 === 0
      g.lineWidth = long ? 4 : 2
      g.beginPath()
      g.moveTo(c + Math.cos(a) * (c - 14), c + Math.sin(a) * (c - 14))
      g.lineTo(c + Math.cos(a) * (c - (long ? 44 : 30)), c + Math.sin(a) * (c - (long ? 44 : 30)))
      g.stroke()
    }
    g.strokeStyle = '#c0261c'
    g.lineWidth = 8
    g.beginPath()
    g.arc(c, c, c - 22, Math.PI * 0.75 + Math.PI * 1.2, Math.PI * 2.25)
    g.stroke()
    g.strokeStyle = '#2a8a3a'
    g.beginPath()
    g.arc(c, c, c - 22, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 0.3)
    g.stroke()
  })

/** Dark screen with a faint generic UI layout (blocks only, never text). */
export const screenTex = () =>
  canvasTexture('screen', 256, (g, r, n) => {
    g.fillStyle = '#0b1622'
    g.fillRect(0, 0, n, n)
    g.fillStyle = '#16314a'
    g.fillRect(0, 0, n, 26)
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? '#123049' : '#0f2639'
      g.fillRect(12, 40 + i * 30, n * 0.55, 22)
    }
    g.strokeStyle = '#2f9e6a'
    g.lineWidth = 3
    g.beginPath()
    for (let x = 0; x < 90; x++) g.lineTo(n * 0.62 + x, 120 - Math.sin(x / 9) * 26 - r() * 8)
    g.stroke()
    g.fillStyle = '#2f9e6a'
    g.fillRect(n * 0.62, 180, 80, 40)
  })

/** Wood laminate bench top. */
export const woodTex = () =>
  canvasTexture('wood', 256, (g, r, n) => {
    g.fillStyle = '#c9a77a'
    g.fillRect(0, 0, n, n)
    for (let i = 0; i < 160; i++) {
      const y = r() * n
      g.strokeStyle = `rgba(110,72,38,${0.05 + r() * 0.12})`
      g.lineWidth = 1 + r() * 2
      g.beginPath()
      g.moveTo(0, y)
      for (let x = 0; x <= n; x += 16) g.lineTo(x, y + Math.sin(x / 40 + i) * 2)
      g.stroke()
    }
  })

/** Hazard stripe (yellow/black) for floor tape and guards. */
export const hazardTex = () =>
  canvasTexture('hazard', 64, (g, _r, n) => {
    g.fillStyle = '#f2b705'
    g.fillRect(0, 0, n, n)
    g.fillStyle = '#151515'
    for (let i = -n; i < n * 2; i += 32) {
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i + 16, 0)
      g.lineTo(i + 16 + n, n)
      g.lineTo(i + n, n)
      g.fill()
    }
  })

type MP = THREE.MeshStandardMaterialParameters
const std = (p: MP) => new THREE.MeshStandardMaterial(p)

const brushed = brushedTex()
const brushedR = withRepeat(brushed, 2, 2)

export const M = {
  steel: std({ color: '#c3c7cb', metalness: 0.9, roughness: 0.32, roughnessMap: brushedR, bumpMap: brushedR, bumpScale: 0.3 }),
  steelDark: std({ color: '#6f757b', metalness: 0.85, roughness: 0.4, roughnessMap: brushedR }),
  chrome: std({ color: '#e4e7ea', metalness: 1, roughness: 0.12 }),
  galv: std({ color: '#c4c8cb', metalness: 0.75, roughness: 0.42, map: withRepeat(spangleTex(), 2, 2) }),
  alu: std({ color: '#cfd3d6', metalness: 0.8, roughness: 0.38, roughnessMap: brushedR }),
  aluDark: std({ color: '#8d9398', metalness: 0.75, roughness: 0.45 }),
  // Powder coat (RAL-ish)
  ral7035: std({ color: '#c8cac6', metalness: 0.05, roughness: 0.62 }), // light grey
  ral7016: std({ color: '#383e42', metalness: 0.1, roughness: 0.55 }), // anthracite
  ral5015: std({ color: '#2470b3', metalness: 0.1, roughness: 0.5 }), // sky blue
  ral5010: std({ color: '#1b4a85', metalness: 0.1, roughness: 0.5 }), // gentian blue
  ral1003: std({ color: '#f2b705', metalness: 0.08, roughness: 0.5 }), // signal yellow
  ral2004: std({ color: '#e5641b', metalness: 0.1, roughness: 0.45 }), // pure orange
  ral3000: std({ color: '#a32820', metalness: 0.1, roughness: 0.5 }), // flame red
  ral6011: std({ color: '#5d7a54', metalness: 0.08, roughness: 0.55 }), // reseda green
  ral9005: std({ color: '#151617', metalness: 0.1, roughness: 0.5 }),
  ral9010: std({ color: '#ecebe4', metalness: 0.05, roughness: 0.5 }),
  rubber: std({ color: '#161718', metalness: 0, roughness: 0.92 }),
  plasticDark: std({ color: '#2a2c2f', metalness: 0, roughness: 0.55 }),
  plasticGrey: std({ color: '#7f858b', metalness: 0, roughness: 0.6 }),
  plasticBlue: std({ color: '#2a5ea6', metalness: 0, roughness: 0.48 }),
  plasticRed: std({ color: '#c3271d', metalness: 0, roughness: 0.45 }),
  plasticYellow: std({ color: '#f0c419', metalness: 0, roughness: 0.45 }),
  plasticGreen: std({ color: '#2d8a46', metalness: 0, roughness: 0.5 }),
  plasticWhite: std({ color: '#e9e9e6', metalness: 0, roughness: 0.4 }),
  copper: std({ color: '#d0835a', metalness: 1, roughness: 0.28 }),
  copperDark: std({ color: '#6b3a22', metalness: 0.75, roughness: 0.55 }),
  brazeFill: std({ color: '#d9d2c0', metalness: 0.9, roughness: 0.4 }),
  brass: std({ color: '#c9a64e', metalness: 1, roughness: 0.3 }),
  wood: std({ color: '#ffffff', metalness: 0, roughness: 0.65, map: withRepeat(woodTex(), 1, 1) }),
  esdMat: std({ color: '#4e6a80', metalness: 0, roughness: 0.85 }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#cfe3ea', metalness: 0, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false }),
  polycarb: new THREE.MeshPhysicalMaterial({ color: '#e0b070', metalness: 0, roughness: 0.15, transparent: true, opacity: 0.35, depthWrite: false }),
  curtain: new THREE.MeshStandardMaterial({ color: '#b5361e', metalness: 0, roughness: 0.6, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
  fenceMesh: new THREE.MeshStandardMaterial({ color: '#d9a400', metalness: 0.3, roughness: 0.5, alphaMap: withRepeat(meshAlphaTex(), 14, 14), alphaTest: 0.5, side: THREE.DoubleSide }),
  guardMesh: new THREE.MeshStandardMaterial({ color: '#2b2d30', metalness: 0.5, roughness: 0.5, alphaMap: withRepeat(meshAlphaTex(), 30, 30), alphaTest: 0.5, side: THREE.DoubleSide }),
  perfGrey: std({ color: '#b9bcbd', metalness: 0.3, roughness: 0.6, map: withRepeat(perfTex(), 10, 8) }),
  pegboard: std({ color: '#d1d4d4', metalness: 0.2, roughness: 0.6, map: withRepeat(perfTex(), 14, 6) }),
  cardboard: std({ color: '#ffffff', metalness: 0, roughness: 0.92, map: withRepeat(cardboardTex(), 1, 1) }),
  cardboardDark: std({ color: '#9c8466', metalness: 0, roughness: 0.9 }),
  tape: std({ color: '#9b7a4e', metalness: 0, roughness: 0.35 }),
  foam: std({ color: '#efefea', metalness: 0, roughness: 0.95 }),
  stretch: new THREE.MeshPhysicalMaterial({ color: '#dfe8ec', metalness: 0, roughness: 0.15, transparent: true, opacity: 0.38, depthWrite: false }),
  strap: std({ color: '#f0f0ea', metalness: 0, roughness: 0.4 }),
  strapBlack: std({ color: '#1d1d1d', metalness: 0, roughness: 0.4 }),
  hazard: std({ color: '#ffffff', metalness: 0.05, roughness: 0.55, map: withRepeat(hazardTex(), 6, 1) }),
  floorTape: std({ color: '#e8b923', metalness: 0, roughness: 0.6 }),
  screen: std({ color: '#ffffff', metalness: 0.2, roughness: 0.2, map: screenTex(), emissive: '#ffffff', emissiveMap: screenTex(), emissiveIntensity: 0.55 }),
  dial: std({ color: '#ffffff', metalness: 0, roughness: 0.4, map: dialTex() }),
  pcb: std({ color: '#1e6a3c', metalness: 0.1, roughness: 0.45 }),
  solder: std({ color: '#c0c4c6', metalness: 0.9, roughness: 0.3 }),
  ledPanel: std({ color: '#f4f7fa', emissive: '#eef4ff', emissiveIntensity: 1.6, roughness: 0.4 }),
  ledBar: std({ color: '#ffffff', emissive: '#f2f6ff', emissiveIntensity: 2.2, roughness: 0.3 }),
  lightCurtain: std({ color: '#2b2b2b', emissive: '#ff2a1a', emissiveIntensity: 0.6, roughness: 0.4 }),
  flameCore: new THREE.MeshBasicMaterial({ color: '#c8e4ff', transparent: true, opacity: 0.9, depthWrite: false }),
  flameOuter: new THREE.MeshBasicMaterial({ color: '#4f8cff', transparent: true, opacity: 0.45, depthWrite: false }),
  hoseRed: std({ color: '#b3261e', metalness: 0, roughness: 0.7 }),
  hoseBlue: std({ color: '#1f4fa0', metalness: 0, roughness: 0.7 }),
  hoseBlack: std({ color: '#1b1b1c', metalness: 0, roughness: 0.75 }),
  hoseYellow: std({ color: '#d8a91a', metalness: 0, roughness: 0.65 }),
  hoseGreen: std({ color: '#2f7a3a', metalness: 0, roughness: 0.7 }),
  hoseGrey: std({ color: '#5d6266', metalness: 0, roughness: 0.7 }),
  cableOrange: std({ color: '#d4661c', metalness: 0, roughness: 0.6 }),
  // Gas cylinder colours (EN 1089-3 style shoulders)
  cylBlack: std({ color: '#1f2022', metalness: 0.3, roughness: 0.45 }),
  cylWhite: std({ color: '#efefea', metalness: 0.3, roughness: 0.4 }),
  cylMaroon: std({ color: '#6e1d22', metalness: 0.3, roughness: 0.45 }),
  cylGreen: std({ color: '#26473a', metalness: 0.3, roughness: 0.45 }),
  cylBrown: std({ color: '#6b4a2c', metalness: 0.3, roughness: 0.45 }),
  cylGrey: std({ color: '#8a8f93', metalness: 0.3, roughness: 0.45 }),
  cylRed: std({ color: '#b2231b', metalness: 0.3, roughness: 0.4 }),
  // Product
  casing: std({ color: '#e7e6e1', metalness: 0.15, roughness: 0.42 }),
  casingShade: std({ color: '#d5d5d0', metalness: 0.15, roughness: 0.48 }),
  grille: std({ color: '#1f2123', metalness: 0.3, roughness: 0.5 }),
  fanBlade: new THREE.MeshStandardMaterial({ color: '#2b2e31', metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide }),
  compressor: std({ color: '#1c1d1f', metalness: 0.35, roughness: 0.45 }),
  insulation: std({ color: '#262626', metalness: 0, roughness: 0.95 }),
  palletTop: std({ color: '#3d4247', metalness: 0.6, roughness: 0.45 }),
  palletWear: std({ color: '#d7d9d1', metalness: 0, roughness: 0.6 }),
  stainless: std({ color: '#b9bdc0', metalness: 0.9, roughness: 0.3, roughnessMap: brushedR }),
}

export type MatKey = keyof typeof M

/** Emissive indicator lamps: lit and unlit variants. */
const lampColors = {
  red: '#ff2418',
  amber: '#ffa20a',
  green: '#1fe04a',
  blue: '#2a7bff',
  white: '#fff6e8',
} as const
export type LampColor = keyof typeof lampColors

const lampOnCache = new Map<string, THREE.MeshStandardMaterial>()
export function lampMat(c: LampColor, on: boolean) {
  const key = c + on
  let m = lampOnCache.get(key)
  if (!m) {
    const col = new THREE.Color(lampColors[c])
    m = on
      ? new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 3.2, roughness: 0.3, toneMapped: false })
      : new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.28), roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 })
    lampOnCache.set(key, m)
  }
  return m
}

/** Fin material at a given repeat (coil width in metres). */
export function finMat(widthM: number, heightM: number) {
  const key = `finmat:${widthM.toFixed(2)}:${heightM.toFixed(2)}`
  let m = matCache.get(key)
  if (!m) {
    const t = withRepeat(finTex(), Math.round(widthM * 200 / 32), 1)
    m = new THREE.MeshStandardMaterial({ color: '#e6eaed', metalness: 0.45, roughness: 0.4, map: t, bumpMap: t, bumpScale: 1.5 })
    matCache.set(key, m)
  }
  return m
}

const matCache = new Map<string, THREE.Material>()
/** Cardboard with repeat tuned to a box size. */
export function cardboardMat(seed: number) {
  const key = 'card' + (seed % 3)
  let m = matCache.get(key)
  if (!m) {
    const tint = ['#ffffff', '#f1e7da', '#fbf3e6'][seed % 3]
    m = new THREE.MeshStandardMaterial({ color: tint, metalness: 0, roughness: 0.92, map: withRepeat(cardboardTex(), 1, 1) })
    matCache.set(key, m)
  }
  return m
}
