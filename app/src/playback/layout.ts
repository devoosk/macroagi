import type { Line } from '../contracts/types'
import type { UnitPosition } from './types'
import { BAY_DZ, stationWorld } from '../lib/layout'

/** World-space [x, y, z] (y up). The line's floor plan is (x, y) → world (x, 0, y), as in Factory.tsx. */
export type Vec3 = [number, number, number]

/** Spacing between parallel bays (m); see lib/layout.ts. */
export const BAY_SPACING = BAY_DZ

/** Floor anchor of a station (or one of its bays). */
export function stationAnchor(line: Line, station: string, bay?: number): Vec3 {
  const s = line.stations.find((x) => x.id === station)
  if (!s) return [0, 0, 0]
  if (bay === undefined || (s.bays ?? 1) <= 1) return [s.x, 0, s.y]
  return stationWorld(s, bay)
}

/** Interpolated floor position of a unit (travel lerps from `fromStation` to `station`). */
export function unitAnchor(line: Line, u: UnitPosition): Vec3 {
  const to = stationAnchor(line, u.station, u.bay)
  if (!u.fromStation || u.travel <= 0) return to
  const from = stationAnchor(line, u.fromStation, u.fromBay)
  const k = u.travel
  return [from[0] + (to[0] - from[0]) * k, 0, from[2] + (to[2] - from[2]) * k]
}

/** Bounds of the station layout on the floor: [minX, maxX, minZ, maxZ]. */
export function lineBounds(line: Line): [number, number, number, number] {
  if (!line.stations.length) return [0, 0, 0, 0]
  let a = Infinity
  let b = -Infinity
  let c = Infinity
  let d = -Infinity
  for (const s of line.stations) {
    a = Math.min(a, s.x)
    b = Math.max(b, s.x)
    c = Math.min(c, s.y)
    d = Math.max(d, s.y)
  }
  return [a, b, c, d]
}
