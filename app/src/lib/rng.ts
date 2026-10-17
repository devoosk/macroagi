import seedrandom from 'seedrandom'

/** Deterministic RNG. Never use Math.random in render paths. */
export function rng(...seedParts: (string | number)[]): () => number {
  return seedrandom(seedParts.join(':'))
}

/** Stable hash of a key to [0, 1). Handy for per-entity variation. */
export function hash01(...seedParts: (string | number)[]): number {
  return rng(...seedParts)()
}
