import { useMemo } from 'react'
import type { Station, StationKind, Variant } from '../../contracts/types'
import { smooth } from '../stations/lib/prims'
import { ProductUnit } from './ProductUnit'

/** Canonical station order: `stage` = index of the last completed station in this list. */
export const STAGE_ORDER: StationKind[] = [
  'kitting',
  'base_frame',
  'compressor_mount',
  'brazing',
  'evacuation_leak_test',
  'refrigerant_charge',
  'electrical_wiring',
  'casing',
  'run_test',
  'eol_inspection',
  'packing',
]

/** Conveyor top surface height (station-local y). */
export const CONVEYOR_TOP = 0.85

/**
 * Build stage shown for a unit at (or arriving at) a station of this kind: every earlier station
 * is complete. At packing the carton goes on straight away so the strapper has something to strap.
 */
export function stageAt(kind: StationKind) {
  if (kind === 'packing') return 10
  return Math.max(0, STAGE_ORDER.indexOf(kind) - 1)
}

export interface UnitOnLine {
  unit: string
  variant: string
  station: string
  /** 0 = at station; (0,1) = progress travelling from the previous station toward this one. */
  travel: number
}

export function UnitsOnLine({ stations, units, variants, simTime }: { stations: Station[]; units: UnitOnLine[]; variants: Variant[]; simTime: number }) {
  const idx = useMemo(() => new Map(stations.map((s, i) => [s.id, i])), [stations])
  const kwOf = useMemo(() => new Map(variants.map((v) => [v.id, v.kw])), [variants])
  return (
    <group>
      {units.map((u) => {
        const i = idx.get(u.station)
        if (i === undefined) return null
        const cur = stations[i]
        const prev = stations[Math.max(0, i - 1)]
        const moving = u.travel > 0 && u.travel < 1 && i > 0
        const e = moving ? smooth(u.travel) : 1
        const x = prev.x + (cur.x - prev.x) * e
        const z = prev.y + (cur.y - prev.y) * e
        const rot = prev.rot + (cur.rot - prev.rot) * e
        const kw = kwOf.get(u.variant) ?? 9
        const stage = stageAt(cur.kind)
        const spinning = !moving && cur.kind === 'run_test'
        const fanSpin = spinning ? simTime * Math.PI * 2 * 11 : 0
        return (
          <group key={u.unit} position={[x, CONVEYOR_TOP, z]} rotation={[0, rot, 0]}>
            <ProductUnit kw={kw} stage={stage} fanSpin={fanSpin} seed={u.unit} />
          </group>
        )
      })}
    </group>
  )
}
