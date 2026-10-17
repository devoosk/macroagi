import { Color } from 'three'

/** MicroAGI visual language: monochrome, paper and ink, glow on black. */
export const PAPER = '#f2f2f2'
export const WHITE = '#ffffff'
export const INK = '#1a1a1a'
export const NIGHT = '#0c0c0c'
export const FONT = '"Inter Tight", "Neue Haas Grotesk", Inter, system-ui, sans-serif'

/** Total story length, seconds. */
export const DURATION = 60

/** Beat windows, seconds. Every animation is a pure function of story time t. */
export const T = {
  steam: [0, 7],
  today: [7, 11.5],
  turn: [11.5, 13.5],
  feeds: [13.5, 18.5],
  graph: [18.5, 26.5],
  focus: [26.5, 30.5],
  swarm: [30.5, 38.5],
  morph: [38.5, 44.5],
  results: [44.5, 50.5],
  world: [50.5, 60],
} as const

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** Progress of t through [a, b], clamped to 0..1. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
export const within = (t: number, w: readonly [number, number], pad = 0) => t >= w[0] - pad && t <= w[1] + pad
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
/** 0 → 1 → 0 over [a, b] with soft edges of width f. */
export const pulse = (t: number, a: number, b: number, f = 0.4) => Math.min(seg(t, a, a + f), 1 - seg(t, b - f, b))

/** Deterministic hash → [0, 1). */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** How dark the stage is at time t (0 paper, 1 night). Analysis and the ending live on black. */
export function night(t: number): number {
  const up = seg(t, T.feeds[0] - 0.8, T.feeds[0] + 0.4)
  const down = seg(t, T.morph[0] - 0.6, T.morph[0] + 0.6)
  const end = seg(t, T.world[0], T.world[0] + 1.2)
  return Math.max(up * (1 - down), end)
}

const paper = new Color(PAPER)
const nightC = new Color(NIGHT)
const ink = new Color(INK)
const white = new Color(WHITE)
export const stageColor = (t: number, out = new Color()) => out.copy(paper).lerp(nightC, night(t))
/** Line colour: ink on paper, white on night. */
export const lineColor = (t: number, out = new Color()) => out.copy(ink).lerp(white, night(t))
