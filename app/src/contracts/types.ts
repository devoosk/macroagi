// TypeScript mirror of the shared JSON contracts (see CLAUDE.md and docs/).
// Python modules write these files; the app only reads them.

/** Every number carries where it came from: a citation, or the literal "estimate". */
export interface Sourced<T = number> {
  value: T
  source: string
}

export type VerbClass =
  | 'pick'
  | 'place'
  | 'insert'
  | 'screw'
  | 'connect'
  | 'braze'
  | 'inspect'
  | 'walk'
  | 'search'

export type StationKind =
  | 'kitting'
  | 'base_frame'
  | 'compressor_mount'
  | 'brazing'
  | 'evacuation_leak_test'
  | 'refrigerant_charge'
  | 'electrical_wiring'
  | 'casing'
  | 'run_test'
  | 'eol_inspection'
  | 'packing'

export type Presentation = 'loose_bin' | 'tray' | 'fixtured' | 'kitted'

export type ToolKind = 'none' | 'screwdriver' | 'torque_driver' | 'torch' | 'crimper' | 'scanner' | 'hose' | 'strapper'

export interface OperationTime {
  /** Seconds. */
  mean: Sourced
  /** Standard deviation, seconds. */
  sd: Sourced
}

export interface Operation {
  id: string
  name: string
  verb: VerbClass
  parts: string[]
  tool: ToolKind
  /** Per variant id. */
  time: Record<string, OperationTime>
  station: string
  /** Probability the operation fails and triggers rework (test ops only). */
  failRate?: Sourced
}

export interface PrecedenceEdge {
  from: string
  to: string
  type: 'hard' | 'soft'
  confidence: number
  evidence: 'bom' | 'video_order_variance' | 'engineer' | 'estimate'
}

export interface Part {
  id: string
  name: string
  /** Bounding box in metres [x, y, z]. */
  size: [number, number, number]
  mass: Sourced
  rigidity: 'rigid' | 'semi' | 'flexible'
  tolerance: 'loose' | 'medium' | 'tight'
  presentation: Presentation
}

export interface Station {
  id: string
  name: string
  kind: StationKind
  operations: string[]
  staff: 'human' | 'robot' | 'empty'
  /** Floor position in metres; the line runs along +x. */
  x: number
  y: number
  /** Rotation about vertical axis, radians. */
  rot: number
  bufferBefore: number
  bufferAfter: number
  /** Parallel bays (e.g. split test station). Defaults to 1. */
  bays?: number
  /** Redesigns: id of the human station that takes units after a robot failure. */
  fallback?: string
  /** True for an off-line fallback station (not part of the serial flow). */
  offline?: boolean
}

export interface Variant {
  id: string
  name: string
  /** e.g. 6, 9, 12 kW. Drives unit size in the render. */
  kw: number
  mix: Sourced
  operations: string[]
}

export type LeverType = 'eliminate' | 'fixture' | 'kit' | 'goods_to_robot' | 'regroup' | 'decouple'

export interface Lever {
  id: string
  type: LeverType
  cost: Sourced
  operations: string[]
  featureChanges: Record<string, string>
}

export interface Line {
  id: string
  name: string
  takt: Sourced
  operations: Operation[]
  edges: PrecedenceEdge[]
  parts: Part[]
  stations: Station[]
  variants: Variant[]
  levers: Lever[]
  /** Levers applied in this design (redesigns only). */
  appliedLevers?: string[]
}

export type SimEventType =
  | 'start'
  | 'end'
  | 'blocked'
  | 'starved'
  | 'failed'
  | 'rework'
  // Contract extension (to agree with simulate/): per-operation timing for avatars and capture ground truth.
  | 'op_start'
  | 'op_end'

export interface SimEvent {
  unit: string
  variant: string
  station: string
  event: SimEventType
  /** Seconds of simulated time. */
  time: number
  /** Set on op_start / op_end. */
  operation?: string
  /** Parallel bay index for multi-bay stations. */
  bay?: number
}

export interface EventLog {
  line: string
  seed: number
  duration: number
  events: SimEvent[]
}

export interface SweepPoint {
  reliability: number
  throughput: Sourced
  /** 95% confidence interval of the mean throughput, units/h. */
  ci95?: [number, number]
}

export interface MigrationStage {
  id: string
  name: string
  stations: string[]
  gate: string
}

export interface DesignResult {
  design: string
  throughput: Sourced
  capex: Sourced
  requiredReliability: Sourced
  sweep: SweepPoint[]
  stages: MigrationStage[]
}

export interface Results {
  designs: DesignResult[]
}
