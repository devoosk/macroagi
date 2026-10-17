import { rng } from '../../lib/rng'

/** Per-worker appearance. Pure function of the look seed (see `workerLook`). */
export interface WorkerLook {
  seed: string
  /** Standing height in metres (1.62..1.92). */
  height: number
  /** Uniform rig scale relative to the 1.75 m reference rig. */
  scale: number
  /** Girth multiplier for torso and limbs (0.9..1.18). */
  build: number
  /** Extra belly depth in metres (0..0.04). */
  belly: number
  skin: string
  /** Slightly darker skin tone for lips, ears and creases. */
  skinShade: string
  hair: string
  hairStyle: 'buzz' | 'short' | 'crop' | 'ponytail' | 'bun' | 'bald'
  facialHair: 'none' | 'stubble' | 'beard' | 'moustache'
  headwear: 'bumpcap' | 'beanie' | 'none'
  capColor: string
  top: 'vest' | 'jacket'
  shirt: string
  /** Hi-vis vest or jacket body colour. */
  outer: string
  /** Retro-reflective stripe colour. */
  stripe: string
  sleeves: 'long' | 'rolled'
  trousers: string
  trouserAccent: string
  shoes: string
  shoeAccent: string
  gloves: string
  glovePalm: string
  glassesTint: string
}

const SKIN = ['#f1d3bc', '#e8bf9f', '#d9a57f', '#c48a62', '#a96f4a', '#8a5636', '#6b3f26', '#4f2d1c']
const HAIR = ['#1b1512', '#2b1d14', '#3d2817', '#5a3a22', '#7b5233', '#a8794a', '#c9a46a', '#8c8a87', '#b9b5ae', '#6e2f1a']
const HI_VIS = ['#d7e81c', '#e2ef2a', '#ff6a14', '#ff7f1f', '#cfe317']
const WORKWEAR = ['#1f2a44', '#232b3a', '#3a4049', '#4a5059', '#2a2d31', '#34404f', '#3b4436']
const SHIRTS = ['#1f2a44', '#3c4654', '#2b2e33', '#d9d9d4', '#6e7f95', '#7a2a2a', '#2f4f3f', '#8a8f96']
const SHOES = ['#1d1b19', '#2d2620', '#4a3424', '#262a2e']
const SHOE_ACCENT = ['#3a3a3a', '#7a5a2e', '#25364f', '#5b1f1f']
const GLOVES: [string, string][] = [
  ['#c8c9c4', '#2f3e5c'], // knit with blue nitrile palm
  ['#bfc2c6', '#3a3d42'], // grey knit, black palm
  ['#2b2c2e', '#1a1a1b'], // black nitrile
  ['#d9d2c0', '#c46a1c'], // beige with orange palm
  ['#33495f', '#1f2833'], // navy coated
]
const CAPS = ['#1f2a44', '#d7e81c', '#ff6a14', '#2b2e33', '#c2c6cb', '#3f5b7a']
const TINT = ['#c9d6dc', '#c9d6dc', '#d9d0a8', '#9fb0b8']

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))]
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

const cache = new Map<string, WorkerLook>()

/** Deterministic appearance for a look seed (height, build, skin, hair, PPE palette). */
export function workerLook(seed: string): WorkerLook {
  const hit = cache.get(seed)
  if (hit) return hit
  const r = rng('worker-look', seed)
  // Roughly normal height distribution, clamped to the 1.62..1.92 m range.
  const hn = (r() + r() + r()) / 3
  const height = 1.62 + 0.3 * hn
  const build = 0.9 + 0.28 * r()
  const belly = r() < 0.35 ? 0.04 * r() : 0
  const skin = pick(r, SKIN)
  const longHair = r() < 0.3
  const hairStyle: WorkerLook['hairStyle'] = longHair ? (r() < 0.5 ? 'ponytail' : 'bun') : pick(r, ['buzz', 'short', 'crop', 'short', 'bald'] as const)
  const facialHair: WorkerLook['facialHair'] = longHair ? 'none' : pick(r, ['none', 'none', 'stubble', 'beard', 'moustache'] as const)
  const hr = r()
  const headwear: WorkerLook['headwear'] = hr < 0.55 ? 'bumpcap' : hr < 0.7 ? 'beanie' : 'none'
  const top: WorkerLook['top'] = r() < 0.7 ? 'vest' : 'jacket'
  const outer = top === 'vest' ? pick(r, HI_VIS) : pick(r, WORKWEAR)
  const [gloves, glovePalm] = pick(r, GLOVES)
  const trousers = pick(r, WORKWEAR)
  const look: WorkerLook = {
    seed,
    height,
    scale: height / 1.75,
    build,
    belly,
    skin,
    skinShade: shade(skin, 0.86),
    hair: pick(r, HAIR),
    hairStyle,
    facialHair,
    headwear,
    capColor: pick(r, CAPS),
    top,
    shirt: pick(r, SHIRTS),
    outer,
    stripe: '#c7ccd1',
    sleeves: r() < 0.3 ? 'rolled' : 'long',
    trousers,
    trouserAccent: shade(trousers, 0.7),
    shoes: pick(r, SHOES),
    shoeAccent: pick(r, SHOE_ACCENT),
    gloves,
    glovePalm,
    glassesTint: pick(r, TINT),
  }
  cache.set(seed, look)
  return look
}
