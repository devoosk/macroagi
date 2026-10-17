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
  /** Set in redesigns. `time` stays the human time; robot time comes from capability.json. */
  mode?: 'human' | 'robot' | 'eliminated'
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
  /** Summary written by `python -m optimize` (redesigns only). */
  design?: DesignSummary
}

export interface DesignSummary {
  /** Lever bundle the solver was allowed to use (B0 none ... B4 all). */
  bundle: string
  humanStations: number
  robotStations: number
  /** Robot cells plus lever costs, EUR. */
  capex: Sourced
  /** Solver objective: station costs over 3 years plus lever costs, EUR. */
  objective: Sourced & { note: string }
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

// capability.json: written by `python -m capability` (plan step 2).

export interface CapabilityFeatures {
  verb: VerbClass
  presentation: Presentation
  rigidity: Part['rigidity']
  tolerance: Part['tolerance']
  mass_kg: number
  tool: ToolKind
  variants: number
  has_parts: boolean
  eliminated: boolean
}

export interface CapabilityPrior {
  verb: VerbClass
  presentation: Presentation
  /** Prior mean robot success. */
  mean: number
  /** alpha + beta of the prior Beta; lower is wider. */
  concentration: number
  /** Robot time / human time. */
  timeFactor: number
  source: string
}

/** Robot success range (Beta) and time for one operation with a set of lever types. */
export interface CapabilityEstimate {
  operation: string
  levers: LeverType[]
  mean: number
  p05: number
  p95: number
  /** Null when the operation is eliminated. */
  alpha: number | null
  beta: number | null
  timeFactor: { low: number; mean: number; high: number }
  /** Robot seconds per variant id. */
  robotTime: Record<string, number>
  /** Walk or search: eliminate rather than automate. */
  waste: boolean
  eliminated: boolean
  features: CapabilityFeatures
  reasons: string[]
  source: string
}

export interface CapabilityTable {
  line: string
  version: string
  priors: CapabilityPrior[]
  leverCosts: Record<LeverType, Sourced>
  /** Per operation: the baseline (levers: []) plus one row per applicable single lever. */
  operations: CapabilityEstimate[]
}
