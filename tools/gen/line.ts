// Reference line: R290 monobloc outdoor heat pump, current state ("r290_current").
// Every number is a Sourced value; all are engineer estimates until real capture data exists.

import type {
  Lever,
  Line,
  Operation,
  OperationTime,
  Part,
  PrecedenceEdge,
  Sourced,
  Station,
  StationKind,
  ToolKind,
  Variant,
  VerbClass,
} from '../../app/src/contracts/types'

export const EST = 'estimate'

export const round1 = (v: number) => Math.round(v * 10) / 10

/** Round for readability: 1 decimal for seconds/kg/EUR, 4 decimals for fractions below 1. */
export const roundSmart = (v: number) => (Math.abs(v) < 1 ? Math.round(v * 1e4) / 1e4 : round1(v))

export const S = (value: number, source = EST): Sourced => ({ value: roundSmart(value), source })

export const VARIANT_IDS = ['V6', 'V9', 'V12'] as const

/** Default variant scaling of the V9 time: bigger units have bigger coils, panels and charge. */
const SCALE_STD: Record<string, number> = { V6: 0.92, V9: 1, V12: 1.12 }
/** Evacuation time scales with internal volume. */
const SCALE_EVAC: Record<string, number> = { V6: 0.88, V9: 1, V12: 1.15 }
/** Run test is mostly fixed stabilisation time. */
const SCALE_RUN: Record<string, number> = { V6: 0.95, V9: 1, V12: 1.06 }
/** Walk/search/inspect barely depend on unit size. */
const SCALE_FLAT: Record<string, number> = { V6: 1, V9: 1, V12: 1.03 }

export function times(v9Mean: number, sdFrac: number, scale: Record<string, number> = SCALE_STD): Record<string, OperationTime> {
  const out: Record<string, OperationTime> = {}
  for (const v of VARIANT_IDS) {
    const mean = v9Mean * scale[v]
    out[v] = { mean: S(mean), sd: S(mean * sdFrac) }
  }
  return out
}

function op(
  id: string,
  station: string,
  name: string,
  verb: VerbClass,
  parts: string[],
  tool: ToolKind,
  v9Mean: number,
  sdFrac: number,
  scale: Record<string, number> = SCALE_STD,
  failRate?: Sourced,
): Operation {
  const o: Operation = { id, name, verb, parts, tool, time: times(v9Mean, sdFrac, scale), station }
  if (failRate) o.failRate = failRate
  return o
}

export function buildOperations(): Operation[] {
  return [
    // S01 kitting: two waste ops (walk, search) and one pick, all freely orderable.
    op('O01', 'S01', 'Fetch fan motor from rack', 'walk', ['P_fan_motor'], 'none', 30, 0.35, SCALE_FLAT),
    op('O02', 'S01', 'Find correct harness variant', 'search', ['P_harness'], 'none', 25, 0.4, SCALE_FLAT),
    op('O03', 'S01', 'Pick valve kit and brazing rings', 'pick', ['P_4way_valve', 'P_eev', 'P_braze_ring'], 'scanner', 35, 0.15),
    // S02 base frame
    op('O04', 'S02', 'Place base pan on pallet', 'place', ['P_base_pan'], 'none', 20, 0.12),
    op('O05', 'S02', 'Screw anti-vibration feet', 'screw', ['P_base_pan', 'P_screw_m8'], 'torque_driver', 35, 0.12),
    op('O06', 'S02', 'Place finned coil and plate heat exchanger', 'place', ['P_coil', 'P_phe'], 'none', 40, 0.15),
    // S03 compressor mount
    op('O07', 'S03', 'Place compressor on grommets', 'place', ['P_compressor'], 'none', 45, 0.15),
    op('O08', 'S03', 'Torque compressor mounting nuts', 'screw', ['P_compressor', 'P_screw_m8'], 'torque_driver', 35, 0.12),
    op('O09', 'S03', 'Insert 4-way valve and EEV into pipe set', 'insert', ['P_4way_valve', 'P_eev'], 'none', 25, 0.18),
    // S04 brazing
    op('O10', 'S04', 'Braze suction and discharge lines', 'braze', ['P_compressor', 'P_braze_ring'], 'torch', 55, 0.15),
    op('O11', 'S04', 'Braze valve, coil and PHE joints', 'braze', ['P_4way_valve', 'P_eev', 'P_coil', 'P_phe', 'P_braze_ring'], 'torch', 55, 0.15),
    // S05 evacuation and helium leak test (bottleneck #2)
    op('O12', 'S05', 'Connect vacuum and helium hoses', 'connect', [], 'hose', 25, 0.15, SCALE_FLAT),
    op('O13', 'S05', 'Evacuate and helium leak test', 'inspect', [], 'hose', 155, 0.08, SCALE_EVAC, S(0.04, 'estimate (typical 2-5% first-pass leak rejects on brazed R290 circuits)')),
    // S06 R290 charge
    op('O14', 'S06', 'Charge R290 by weight and crimp-seal port', 'connect', ['P_r290'], 'hose', 85, 0.1),
    // S07 electrical
    op('O15', 'S07', 'Place inverter PCB in e-box', 'place', ['P_pcb'], 'none', 20, 0.15),
    op('O16', 'S07', 'Connect wiring harness to compressor and PCB', 'connect', ['P_harness', 'P_pcb'], 'crimper', 55, 0.18),
    op('O17', 'S07', 'Screw PCB and earth terminals', 'screw', ['P_pcb', 'P_screw_m6'], 'screwdriver', 25, 0.15),
    // S08 casing
    op('O18', 'S08', 'Place fan motor and fan blade', 'place', ['P_fan_motor', 'P_fan_blade'], 'none', 30, 0.15),
    op('O19', 'S08', 'Insert side panels and grille', 'insert', ['P_side_panel', 'P_grille'], 'none', 35, 0.15),
    op('O20', 'S08', 'Screw side panels and top cover', 'screw', ['P_side_panel', 'P_top_cover', 'P_screw_m6'], 'screwdriver', 40, 0.12),
    // S09 run test (bottleneck #1)
    op('O21', 'S09', 'Connect mains and water test rig', 'connect', [], 'hose', 20, 0.15, SCALE_FLAT),
    op('O22', 'S09', 'Functional run test (COP, pressures, noise)', 'inspect', [], 'scanner', 220, 0.06, SCALE_RUN, S(0.02, 'estimate (EOL run-test reject rate)')),
    // S10 EOL inspection
    op('O23', 'S10', 'Visual inspection and label check', 'inspect', ['P_side_panel', 'P_top_cover'], 'scanner', 45, 0.15, SCALE_FLAT),
    op('O24', 'S10', 'Walk to printer for rating label', 'walk', [], 'none', 20, 0.35, SCALE_FLAT),
    // S11 packing
    op('O25', 'S11', 'Place carton and strap to pallet', 'place', ['P_carton'], 'strapper', 60, 0.12),
  ]
}

const hard = (from: string, to: string, evidence: PrecedenceEdge['evidence'] = 'bom'): PrecedenceEdge => ({
  from,
  to,
  type: 'hard',
  confidence: 1,
  evidence,
})
const soft = (from: string, to: string, confidence = 0.6): PrecedenceEdge => ({
  from,
  to,
  type: 'soft',
  confidence,
  evidence: 'estimate',
})

export function buildEdges(): PrecedenceEdge[] {
  return [
    // S01: today's habit order, all reorderable.
    soft('O01', 'O02', 0.5),
    soft('O02', 'O03', 0.55),
    // Kit must exist before the valves are fitted.
    hard('O03', 'O09'),
    // S02
    hard('O04', 'O05'),
    hard('O04', 'O06'),
    soft('O05', 'O06', 0.6),
    // S03
    hard('O06', 'O07'),
    hard('O07', 'O08'),
    soft('O08', 'O09', 0.55),
    hard('O07', 'O09', 'engineer'),
    // S04: either joint group first.
    hard('O08', 'O10'),
    hard('O09', 'O11'),
    soft('O10', 'O11', 0.5),
    // Circuit must be closed before it is tested.
    hard('O10', 'O12'),
    hard('O11', 'O12'),
    hard('O12', 'O13'),
    hard('O13', 'O14'),
    // S07
    hard('O15', 'O16'),
    hard('O15', 'O17'),
    soft('O16', 'O17', 0.6),
    soft('O14', 'O15', 0.7),
    // S08
    hard('O16', 'O19', 'engineer'),
    soft('O18', 'O19', 0.6),
    hard('O19', 'O20'),
    hard('O01', 'O18'),
    // Run test needs charge, wiring and a closed casing.
    hard('O14', 'O21'),
    hard('O16', 'O21'),
    hard('O20', 'O21'),
    hard('O21', 'O22'),
    // S10: label fetch and inspection reorderable.
    hard('O22', 'O23', 'engineer'),
    soft('O23', 'O24', 0.5),
    hard('O22', 'O24', 'engineer'),
    hard('O23', 'O25'),
    hard('O24', 'O25'),
  ]
}

const part = (
  id: string,
  name: string,
  size: [number, number, number],
  mass: number,
  rigidity: Part['rigidity'],
  tolerance: Part['tolerance'],
  presentation: Part['presentation'],
  massSource = EST,
): Part => ({ id, name, size, mass: S(mass, massSource), rigidity, tolerance, presentation })

export function buildParts(): Part[] {
  return [
    part('P_base_pan', 'Galvanised base pan', [1.15, 0.09, 0.45], 7.5, 'rigid', 'loose', 'tray'),
    part('P_compressor', 'Inverter rotary compressor (R290)', [0.2, 0.36, 0.2], 18, 'rigid', 'medium', 'loose_bin', 'estimate (twin-rotary 9 kW class)'),
    part('P_4way_valve', '4-way reversing valve', [0.12, 0.08, 0.06], 0.6, 'rigid', 'tight', 'loose_bin'),
    part('P_eev', 'Electronic expansion valve', [0.06, 0.1, 0.05], 0.25, 'rigid', 'tight', 'loose_bin'),
    part('P_phe', 'Brazed plate heat exchanger', [0.12, 0.32, 0.1], 5.5, 'rigid', 'medium', 'tray'),
    part('P_coil', 'Finned evaporator coil', [1.0, 0.75, 0.06], 9, 'semi', 'medium', 'fixtured'),
    part('P_fan_motor', 'EC fan motor', [0.18, 0.18, 0.12], 3.2, 'rigid', 'medium', 'loose_bin'),
    part('P_fan_blade', 'Axial fan blade 550 mm', [0.55, 0.55, 0.12], 0.9, 'semi', 'loose', 'tray'),
    part('P_pcb', 'Inverter PCB in e-box', [0.3, 0.06, 0.22], 1.4, 'rigid', 'tight', 'tray'),
    part('P_harness', 'Wiring harness (variant-specific)', [0.8, 0.05, 0.05], 0.7, 'flexible', 'medium', 'loose_bin'),
    part('P_side_panel', 'Powder-coated side panel', [0.95, 0.8, 0.02], 3.8, 'semi', 'medium', 'tray'),
    part('P_top_cover', 'Top cover', [1.15, 0.02, 0.45], 3.1, 'semi', 'medium', 'tray'),
    part('P_grille', 'Fan guard grille', [0.6, 0.6, 0.04], 0.8, 'semi', 'loose', 'tray'),
    part('P_screw_m6', 'Screw M6x12 self-tapping', [0.006, 0.012, 0.006], 0.004, 'rigid', 'medium', 'loose_bin'),
    part('P_screw_m8', 'Screw M8x20 with nut', [0.008, 0.02, 0.008], 0.011, 'rigid', 'medium', 'loose_bin'),
    part('P_braze_ring', 'Silver brazing ring (15% Ag)', [0.016, 0.002, 0.016], 0.002, 'semi', 'tight', 'loose_bin'),
    part('P_r290', 'R290 refrigerant charge', [0.05, 0.05, 0.05], 0.9, 'flexible', 'tight', 'fixtured', 'estimate (~0.9 kg charge, under IEC 60335-2-40 limits)'),
    part('P_carton', 'Carton and corner pads', [1.25, 1.0, 0.55], 2.5, 'semi', 'loose', 'tray'),
  ]
}

interface StationSpec {
  id: string
  name: string
  kind: StationKind
  bufferBefore: number
  bufferAfter: number
}

export const STATION_SPECS: StationSpec[] = [
  { id: 'S01', name: 'Kitting', kind: 'kitting', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S02', name: 'Base frame', kind: 'base_frame', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S03', name: 'Compressor mount', kind: 'compressor_mount', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S04', name: 'Brazing', kind: 'brazing', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S05', name: 'Evacuation & leak test', kind: 'evacuation_leak_test', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S06', name: 'R290 charge', kind: 'refrigerant_charge', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S07', name: 'Electrical wiring', kind: 'electrical_wiring', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S08', name: 'Casing', kind: 'casing', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S09', name: 'Run test', kind: 'run_test', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S10', name: 'EOL inspection', kind: 'eol_inspection', bufferBefore: 0, bufferAfter: 1 },
  { id: 'S11', name: 'Packing', kind: 'packing', bufferBefore: 0, bufferAfter: 0 },
]

const WIDE_KINDS: StationKind[] = ['evacuation_leak_test', 'run_test']

/** x positions: 4.5 m pitch, 6 m next to the (wider) test stations; `extra` adds width per station id. */
export function layoutX(stations: { id: string; kind: StationKind }[], extra: Record<string, number> = {}): number[] {
  const xs: number[] = []
  let x = 0
  stations.forEach((st, i) => {
    if (i > 0) {
      const prev = stations[i - 1]
      const wide = WIDE_KINDS.includes(prev.kind) || WIDE_KINDS.includes(st.kind)
      x += (wide ? 6 : 4.5) + ((extra[prev.id] ?? 0) + (extra[st.id] ?? 0)) / 2
    }
    xs.push(round1(x))
  })
  return xs
}

export function buildStations(ops: Operation[]): Station[] {
  const xs = layoutX(STATION_SPECS)
  return STATION_SPECS.map((sp, i) => ({
    id: sp.id,
    name: sp.name,
    kind: sp.kind,
    operations: ops.filter((o) => o.station === sp.id).map((o) => o.id),
    staff: 'human',
    x: xs[i],
    y: 0,
    rot: 0,
    bufferBefore: sp.bufferBefore,
    bufferAfter: sp.bufferAfter,
    bays: 1,
  }))
}

export function buildVariants(ops: Operation[]): Variant[] {
  const all = ops.map((o) => o.id)
  return [
    { id: 'V6', name: '6 kW', kw: 6, mix: S(0.45, 'estimate (order book split)'), operations: all },
    { id: 'V9', name: '9 kW', kw: 9, mix: S(0.35, 'estimate (order book split)'), operations: all },
    { id: 'V12', name: '12 kW', kw: 12, mix: S(0.2, 'estimate (order book split)'), operations: all },
  ]
}

export function buildLevers(): Lever[] {
  return [
    {
      id: 'L_kit',
      type: 'kit',
      cost: S(14000),
      operations: ['O02', 'O03'],
      featureChanges: { presentation: 'kitted', search: 'removed', variant_ambiguity: 'none' },
    },
    {
      id: 'L_flowrack',
      type: 'eliminate',
      cost: S(6500),
      operations: ['O01', 'O24'],
      featureChanges: { walk: 'removed', supply: 'line-side flow rack + label printer at S10' },
    },
    {
      id: 'L_comp_fixture',
      type: 'fixture',
      cost: S(22000),
      operations: ['O07', 'O08', 'O09'],
      featureChanges: { orientation: 'known', presentation: 'fixtured', locating: 'pallet pins' },
    },
    {
      id: 'L_panel_g2r',
      type: 'goods_to_robot',
      cost: S(28000),
      operations: ['O18', 'O19', 'O20'],
      featureChanges: { presentation: 'tray', pose: 'known', reach: 'within robot envelope' },
    },
    {
      id: 'L_test_bays',
      type: 'decouple',
      cost: S(165000, 'estimate (extra helium leak bay + 2 run-test bays)'),
      operations: ['O12', 'O13', 'O21', 'O22'],
      featureChanges: { bays: 'leak test x2, run test x3', buffers: 'decoupling buffers before tests' },
    },
    {
      id: 'L_regroup_valves',
      type: 'regroup',
      cost: S(3000),
      operations: ['O09', 'O11'],
      featureChanges: { station: 'move valve insert into brazing cell', handling: 'one fewer re-grip' },
    },
  ]
}

export function buildLine(): Line {
  const operations = buildOperations()
  return {
    id: 'r290_current',
    name: 'R290 monobloc outdoor unit — current line',
    takt: S(120, 'estimate (30 units/h target)'),
    operations,
    edges: buildEdges(),
    parts: buildParts(),
    stations: buildStations(operations),
    variants: buildVariants(operations),
    levers: buildLevers(),
  }
}
