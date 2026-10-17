/**
 * Tiny deterministic hash + value-noise helpers for capture variation.
 * Pure functions of their inputs: no Math.random, no clocks (CLAUDE.md rule 1).
 * Cheaper than seedrandom for per-frame noise.
 */

/** 32-bit FNV-1a of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Integer hash (lowbias32) of (seed, i) -> [0, 1). */
export function hashInt01(seed: number, i: number): number {
  let x = (seed ^ Math.imul(i | 0, 0x9e3779b1)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** Uniform in [-1, 1) for (seed, i). */
export function hashSigned(seed: number, i: number): number {
  return hashInt01(seed, i) * 2 - 1
}

const smooth = (u: number) => u * u * (3 - 2 * u)

/** Smooth 1D value noise in [-1, 1]. Same (seed, x) always gives the same value. */
export function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const a = hashSigned(seed, i)
  const b = hashSigned(seed, i + 1)
  return a + (b - a) * smooth(f)
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return smooth(u)
}
