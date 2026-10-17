import type { ToolKind, VerbClass } from '../contracts/types'

/** Scene-state types. Re-exported from `./store` (the original home) and `./index`. */

export type StationState = 'idle' | 'working' | 'blocked' | 'starved' | 'failed'

/** What a worker avatar is doing: the op's verb class, or one of the non-op poses. */
export type WorkerVerb = VerbClass | 'idle' | 'blocked' | 'walk'

export interface WorkerActivity {
  station: string
  operation?: string
  /** 0..1 progress through the current operation. */
  phase: number
  // --- additive extensions (playback workstream) ---
  /** Verb class of the current op; 'blocked' when the station is blocked; else 'idle'. */
  verb: WorkerVerb
  /** Tool held for the current op ('none' when idle). */
  tool: ToolKind
  /** Ordinal of this op instance on this lane (station or station#bay). Stable seed for per-cycle variation. */
  cycle: number
  /** Parallel bay index, set on per-bay entries of multi-bay stations. */
  bay?: number
  /** Unit being worked on, if any. */
  unit?: string
  /** Sim time the current op started / will end (end = Infinity if the log has no op_end). */
  opStart?: number
  opEnd?: number
}

export type UnitMotion = 'processing' | 'waiting' | 'transit'

export interface UnitPosition {
  unit: string
  variant: string
  /** Station the unit is at or moving toward. */
  station: string
  /** 0 = at station, (0,1) = travelling from `fromStation` toward `station`. */
  travel: number
  // --- additive extensions ---
  /** Set while travelling (travel > 0): the station the unit is leaving. */
  fromStation?: string
  /** Bay of `station` (multi-bay stations only). */
  bay?: number
  /** Bay of `fromStation`, while travelling. */
  fromBay?: number
  /** Furthest progress: 1 + line index of the furthest completed station, 0 = none. Never decreases (rework keeps it). */
  stage: number
  /** processing = inside a start..end visit; waiting = finished at `station`, not yet left (blocked); transit = moving. */
  motion: UnitMotion
  /** Number of rework loops this unit has gone through so far. */
  reworks: number
}

export interface SceneState {
  /** Station state. For multi-bay stations: working > failed > blocked > starved > idle across bays. */
  stations: Record<string, StationState>
  /**
   * Worker per station (keyed by station id). Multi-bay stations additionally get
   * one entry per bay keyed `${station}#${bay}`; the plain key mirrors the lowest bay.
   */
  workers: Record<string, WorkerActivity>
  units: UnitPosition[]
  // --- additive extensions ---
  /** Per-bay station state for multi-bay stations, keyed `${station}#${bay}`. */
  bays: Record<string, StationState>
  /** Units that completed the last station at or before t. */
  completed: number
  /** The time this state was computed for. */
  t: number
}
