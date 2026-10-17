/** Hall layout derived from the line bounds. Units are metres, Y up, line along +X at z = 0. */

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type Rect = Bounds

/** The reference line: 11 stations, x in about [-3, 50], operator side at +z. */
export const DEFAULT_BOUNDS: Bounds = { minX: -3, maxX: 50, minZ: -4, maxZ: 4 }

export interface Door {
  x: number
  z: number
  w: number
  h: number
}

export interface HallLayout {
  bounds: Bounds
  /** Inner faces of the walls. */
  x0: number
  x1: number
  z0: number
  z1: number
  length: number
  width: number
  /** Portal frame grid along X. */
  bay: number
  frameXs: number[]
  /** Underside of the truss bottom chord (clear height). */
  clearH: number
  /** Top chord height at the eaves and at the ridge. */
  eaveH: number
  ridgeH: number
  ridgeZ: number
  /** Concrete plinth height at the bottom of the walls. */
  plinthH: number
  /** Top-chord (roof) height at a given z. */
  roofY: (z: number) => number
  zones: {
    /** Pedestrian walkway on the operator side. */
    walkway: [number, number]
    /** Supermarket flow racks on the far side. */
    flowRack: [number, number]
    agvLane: [number, number]
    /** Pallet racking along the back wall. */
    rack: [number, number]
  }
  doorIn: Door
  doorOut: Door
}

export function hallLayout(b: Bounds = DEFAULT_BOUNDS): HallLayout {
  const bay = 7
  const nBays = Math.max(6, Math.ceil((b.maxX - b.minX + 17) / bay))
  const length = nBays * bay
  const x0 = Math.floor(b.minX - 10)
  const x1 = x0 + length
  const cz = (b.minZ + b.maxZ) / 2
  const width = Math.max(30, Math.ceil((b.maxZ - b.minZ + 22) / 2) * 2)
  const z0 = cz - width / 2
  const z1 = cz + width / 2
  const frameXs: number[] = []
  for (let i = 0; i <= nBays; i++) frameXs.push(x0 + i * bay)
  const clearH = 9
  const eaveH = 9.9
  const tanP = Math.tan((5 * Math.PI) / 180)
  const ridgeH = eaveH + (width / 2) * tanP
  const ridgeZ = cz
  const roofY = (z: number) => eaveH + (width / 2 - Math.abs(z - ridgeZ)) * tanP
  const walkway: [number, number] = [b.maxZ + 0.7, b.maxZ + 2.5]
  const flowRack: [number, number] = [b.minZ - 2.0, b.minZ - 0.6]
  const agvLane: [number, number] = [b.minZ - 4.6, b.minZ - 2.6]
  const rack: [number, number] = [z0 + 0.35, z0 + 1.45]
  const aisleMid = (agvLane[0] + rack[1]) / 2
  return {
    bounds: b,
    x0,
    x1,
    z0,
    z1,
    length,
    width,
    bay,
    frameXs,
    clearH,
    eaveH,
    ridgeH,
    ridgeZ,
    plinthH: 1.2,
    roofY,
    zones: { walkway, flowRack, agvLane, rack },
    doorIn: { x: x0, z: aisleMid, w: 4.5, h: 5 },
    doorOut: { x: x1, z: aisleMid, w: 4.5, h: 5 },
  }
}
