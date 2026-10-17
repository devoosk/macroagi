import type { Station } from '../contracts/types'

/**
 * Single source of truth for where things sit on the floor. A station at {x, y, rot}
 * sits at world (x, 0, y), rotated by rot about Y. Parallel bays stack along the
 * station's local -z (behind the conveyor), BAY_DZ apart; bay 0 is on the main line.
 */
export const BAY_DZ = 3.1

export function bayLocalZ(bay = 0): number {
  return -bay * BAY_DZ
}

/** World floor position of a station (or one of its bays). */
export function stationWorld(s: Pick<Station, 'x' | 'y' | 'rot'>, bay = 0): [number, number, number] {
  const dz = bayLocalZ(bay)
  // Local (0, 0, dz) rotated by rot about +Y.
  return [s.x + Math.sin(s.rot) * dz, 0, s.y + Math.cos(s.rot) * dz]
}

/** Floor bounds including all bays: { minX, maxX, minZ, maxZ } with a station footprint margin. */
export function floorBounds(stations: Station[], margin = 2.2) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const s of stations) {
    for (let b = 0; b < Math.max(1, s.bays ?? 1); b++) {
      const [x, , z] = stationWorld(s, b)
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
    }
  }
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin }
}
