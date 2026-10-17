import { useMemo } from 'react'
import type { EventLog, Line } from '../contracts/types'
import { floorBounds, stationWorld } from '../lib/layout'
import { isCapture } from '../lib/mode'
import { selectStateAt, usePlayback } from '../playback/store'
import { StateOverlay3D } from '../ui'
import { StaticBatch } from './batch'
import { FactoryEnvironment } from './environment'
import type { Rect } from './environment'
import { ConveyorLine, StationModel } from './stations'
import { UnitsOnLine } from './units'
import { Worker } from './workers'
import { bayLocalZ, WORKER_LOCAL_Z } from '../lib/layout'

const quality = isCapture ? 'capture' : 'demo'

/** Hatched no-go floor zones behind the test stations (and all their bays). */
function hazardZones(line: Line): Rect[] {
  return line.stations
    .filter((s) => s.kind === 'evacuation_leak_test' || s.kind === 'run_test')
    .map((s) => {
      const [, , zLast] = stationWorld(s, Math.max(1, s.bays ?? 1) - 1)
      return { minX: s.x - 2, maxX: s.x + 2, minZ: Math.min(-2.2, zLast - 2.2), maxZ: -1.4 }
    })
}

/**
 * The whole line: hall, stations, conveyor, units and (demo only) state overlays.
 * Everything is a pure function of the playback store's simTime and the event log.
 */
export function Factory({ line, log, lightSeed = 0, cutaway = !isCapture }: { line: Line; log: EventLog; lightSeed?: number | string; cutaway?: boolean }) {
  const simTime = usePlayback((s) => s.simTime)
  const state = selectStateAt(line, log, simTime)
  const bounds = useMemo(() => floorBounds(line.stations), [line])
  const zones = useMemo(() => hazardZones(line), [line])

  return (
    <group>
      <group name="mx:environment">
        <FactoryEnvironment quality={quality} bounds={bounds} hazardZones={zones} lightSeed={lightSeed} cutaway={cutaway} />
      </group>
      {/* Conveyor and station machinery: static geometry merged per material line-wide (see scene/batch). */}
      <StaticBatch>
        <group name="mx:conveyor">
          <ConveyorLine stations={line.stations} />
        </group>
        {line.stations.map((s) => (
          <group key={s.id} position={[s.x, 0, s.y]} rotation-y={s.rot}>
            <group name="mx:stations">
              <StationModel station={s} state={state.stations[s.id] ?? 'idle'} simTime={simTime} quality={quality} line={line} />
            </group>
            {s.staff === 'human' &&
              Array.from({ length: Math.max(1, s.bays ?? 1) }, (_, b) => {
                // Bay 0's worker keeps the plain station id so `head:<id>` / `fp:<id>` line up.
                const key = (s.bays ?? 1) > 1 ? `${s.id}#${b}` : s.id
                const id = b === 0 ? s.id : key
                const w = state.workers[key] ?? state.workers[s.id]
                const dur = w?.opEnd !== undefined && w.opStart !== undefined && Number.isFinite(w.opEnd) ? w.opEnd - w.opStart : undefined
                return (
                  <group key={id} name="mx:workers" position={[0, 0, bayLocalZ(b) + WORKER_LOCAL_Z]}>
                    <Worker
                      stationId={id}
                      lookSeed={`${line.id}:${id}`}
                      verb={w?.verb ?? 'idle'}
                      phase={w?.phase ?? 0}
                      simTime={simTime}
                      tool={w?.tool ?? 'none'}
                      cycle={w?.cycle ?? 0}
                      quality={quality}
                      duration={dur}
                    />
                  </group>
                )
              })}
          </group>
        ))}
      </StaticBatch>
      <group name="mx:units">
        <UnitsOnLine stations={line.stations} units={state.units} variants={line.variants} simTime={simTime} />
      </group>
      {!isCapture && (
        <group name="mx:overlay">
          <StateOverlay3D line={line} state={state} />
        </group>
      )}
    </group>
  )
}
