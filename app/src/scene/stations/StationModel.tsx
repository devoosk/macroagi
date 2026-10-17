import { BAY_DZ } from '../../lib/layout'
import { memo, useCallback, useMemo, type ReactNode } from 'react'
import type * as THREE from 'three'
import type { Line, Station, StationKind, ToolKind } from '../../contracts/types'
import type { StationState } from '../../playback/store'
import { registerAnchor } from '../../lib/anchors'
import { Articulated, Static } from '../batch'
import { M } from './lib/mats'
import { B, C } from './lib/prims'
import { Andon, Balancer, Bench, Fence, FloorTape, Gantry, LightCurtain, TorqueDriver } from './lib/common'
import { BENCH_Z, BenchTools, PartsPresentation, stationParts } from './lib/presentation'
import { RobotArm, robotPose, type RobotTool } from './lib/robot'
import { RollerSection } from './ConveyorLine'
import { BaseFrame, Brazing, BrazingBench, CompressorMount, Kitting } from './kinds/kinds1'
import { Casing, ElectricalWiring, LeakTest, RefrigerantCharge, WiringBench } from './kinds/kinds2'
import { EolBench, EolInspection, Packing, PackingBench, RunTest } from './kinds/kinds3'
import type { KindProps, Quality } from './kinds/types'
import { Compressor, FourWayValve, PcbBoard } from '../units/parts'
import { hash01 } from '../../lib/rng'

export interface StationModelProps {
  station: Station
  state: StationState
  simTime: number
  quality: Quality
  /** Whole line, used for the parts and tools this station's operations need. Optional. */
  line?: Line
}

const MACHINES: Record<StationKind, (p: KindProps) => JSX.Element> = {
  kitting: Kitting,
  base_frame: BaseFrame,
  compressor_mount: CompressorMount,
  brazing: Brazing,
  evacuation_leak_test: LeakTest,
  refrigerant_charge: RefrigerantCharge,
  electrical_wiring: ElectricalWiring,
  casing: Casing,
  run_test: RunTest,
  eol_inspection: EolInspection,
  packing: Packing,
}

/** Tools assumed per kind when the line gives none. */
const DEFAULT_TOOLS: Record<StationKind, ToolKind[]> = {
  kitting: ['scanner'],
  base_frame: ['torque_driver'],
  compressor_mount: ['torque_driver'],
  brazing: ['torch'],
  evacuation_leak_test: ['hose'],
  refrigerant_charge: ['hose', 'scanner'],
  electrical_wiring: ['screwdriver', 'crimper'],
  casing: ['torque_driver', 'screwdriver'],
  run_test: ['hose'],
  eol_inspection: ['scanner'],
  packing: ['strapper'],
}

const BENCH_TOP: Partial<Record<StationKind, 'wood' | 'esd' | 'steel'>> = { electrical_wiring: 'esd', brazing: 'steel' }
const BENCH_EXTRAS: Partial<Record<StationKind, ReactNode>> = {
  brazing: <BrazingBench />,
  electrical_wiring: <WiringBench />,
  eol_inspection: <EolBench />,
  packing: <PackingBench />,
}

/** Kinds where a robot arm does the handling when staff = robot. Test stations are automated without an arm. */
const ARM_KINDS: StationKind[] = ['kitting', 'base_frame', 'compressor_mount', 'brazing', 'refrigerant_charge', 'electrical_wiring', 'casing', 'packing']

const ROBOT_Z = -0.95

/** Station-local (x, y, z) → robot-local (robot base at (0, 0, ROBOT_Z), facing +z). */
const toRobot = (x: number, y: number, z: number): [number, number, number] => [z - ROBOT_Z, y, -x]

function robotSetup(kind: StationKind): { tool: RobotTool; pick: [number, number, number]; place: [number, number, number]; carry?: ReactNode; table: boolean } {
  switch (kind) {
    case 'compressor_mount':
      return {
        tool: 'gripper',
        pick: toRobot(0.7, 0.56, -0.75),
        place: toRobot(0.3, 1.42, 0.035),
        carry: <group position={[0, -0.36, 0]}><Compressor r={0.085} h={0.33} withMounts={false} /></group>,
        table: false,
      }
    case 'brazing':
      return { tool: 'torch', pick: toRobot(0.25, 1.3, 0.0), place: toRobot(0.4, 1.45, -0.08), table: false }
    case 'electrical_wiring':
      return { tool: 'gripper', pick: toRobot(1.15, 0.98, -1.25), place: toRobot(0.38, 1.55, 0.12), carry: <group rotation={[0, 0, 0]}><PcbBoard w={0.18} d={0.12} seed="robot" /></group>, table: false }
    case 'casing':
    case 'packing':
      return { tool: 'vacuum', pick: toRobot(1.05, 1.05, -0.95), place: toRobot(0.0, 1.95, 0.0), table: true }
    case 'base_frame':
    case 'refrigerant_charge':
      return { tool: 'screwdriver', pick: toRobot(1.05, 1.05, -0.95), place: toRobot(-0.3, 1.0, 0.15), table: true }
    default:
      return { tool: 'gripper', pick: toRobot(1.05, 1.05, -0.95), place: toRobot(-0.2, 1.1, 0.0), carry: <FourWayValve />, table: true }
  }
}

/** Pick table with a vibratory bowl feeder (robot stations). */
const PickTable = memo(function PickTable() {
  return (
    <group>
      <B s={[0.7, 0.04, 0.6]} p={[0, 0.88, 0]} m={M.alu} />
      {[-1, 1].map((a) => [-1, 1].map((b) => <B key={`${a}${b}`} s={[0.05, 0.86, 0.05]} p={[a * 0.3, 0.43, b * 0.25]} m={M.ral7016} />))}
      <C rt={0.17} rb={0.12} h={0.12} p={[-0.1, 0.96, 0]} m={M.steel} seg={28} open />
      <C rt={0.12} h={0.04} p={[-0.1, 0.92, 0]} m={M.ral5015} seg={28} />
      <B s={[0.25, 0.03, 0.04]} p={[0.15, 0.98, 0]} m={M.steel} />
      <B s={[0.12, 0.05, 0.1]} p={[0.25, 0.93, 0]} m={M.ral7016} />
    </group>
  )
})

function RobotCell({ kind, t, working, seed }: { kind: StationKind; t: number; working: boolean; seed: string }) {
  const setup = useMemo(() => robotSetup(kind), [kind])
  const phase = useMemo(() => hash01('robot', seed), [seed])
  const pose = robotPose(t, working, setup.pick, setup.place, 11, setup.tool === 'vacuum' ? 0.18 : 0.16, phase)
  return (
    <group>
      <group position={[0, 0, ROBOT_Z]} rotation={[0, -Math.PI / 2, 0]}>
        <Articulated>
          <RobotArm pose={pose} tool={setup.tool} carry={setup.carry} />
        </Articulated>
      </group>
      {setup.table && (
        <group position={[1.05, 0, -0.95]}>
          <PickTable />
        </group>
      )}
      <RobotGuarding />
    </group>
  )
}

const RobotGuarding = memo(function RobotGuarding() {
  return (
    <group>
      <Fence pts={[[-1.8, -0.5], [-1.8, -1.95], [1.8, -1.95], [1.8, -0.5]]} h={2.0} />
      <LightCurtain a={[-1.15, 0, 0.5]} b={[1.15, 0, 0.5]} h={1.3} />
      {/* robot controller cabinet outside the fence */}
      <group position={[-1.3, 0, -2.3]}>
        <B s={[0.6, 1.1, 0.5]} rad={0.01} p={[0, 0.55, 0]} m={M.ral7035} />
        <B s={[0.2, 0.08, 0.02]} p={[0, 0.9, 0.26]} m={M.ral7016} />
      </group>
    </group>
  )
})

/** Overhead tools on spring balancers, chosen by the station's operation tools. */
function OverheadTools({ tools, t, working }: { tools: ToolKind[]; t: number; working: boolean }) {
  const sway = working ? Math.sin(t * 1.3) * 0.04 : 0
  const nodes: ReactNode[] = []
  if (tools.includes('torque_driver')) {
    nodes.push(
      <Balancer key="td" x={0.35} drop={0.45} sway={sway}>
        <TorqueDriver />
      </Balancer>,
    )
  }
  if (tools.includes('screwdriver')) {
    nodes.push(
      <Balancer key="sd" x={-0.35} drop={0.55} sway={-sway * 0.7}>
        <group scale={0.8}>
          <TorqueDriver color={M.ral7016 as THREE.Material} />
        </group>
      </Balancer>,
    )
  }
  return <Articulated>{nodes}</Articulated>
}

/** Static furniture shared by every station: gantry, floor tape, light curtain at the outfeed. */
const Furniture = memo(function Furniture({ robot }: { robot: boolean }) {
  return (
    <group>
      <Gantry zFront={2.4} />
      <FloorTape x0={-1.85} x1={1.85} z0={-1.95} z1={2.5} />
      {!robot && <LightCurtain a={[1.62, 0, -0.56]} b={[1.62, 0, 0.56]} h={1.2} />}
    </group>
  )
})

/** One bay of the station's machine (bays > 1 render side by side along -z with their own spur conveyor). */
function Bay({ kind, props, bay }: { kind: StationKind; props: KindProps; bay: number }) {
  const Machine = MACHINES[kind]
  return (
    <group position={[0, 0, -bay * BAY_DZ]}>
      <Machine {...props} />
      {bay > 0 && (
        <>
          <RollerSection len={2.6} />
          {/* transverse transfer linking this bay's spur to the main line */}
          <group position={[-1.95, 0, BAY_DZ / 2]} rotation={[0, Math.PI / 2, 0]}>
            <RollerSection len={BAY_DZ - 0.9} guides={false} />
          </group>
        </>
      )}
    </group>
  )
}

/**
 * Renders the right machine for station.kind, in station-local coordinates.
 * Everything is <Static> (merged line-wide by the enclosing <StaticBatch>) except the parts that
 * animate, which sit in <Articulated> batches inside the machines.
 */
export const StationModel = memo(function StationModel({ station, state, simTime, quality, line }: StationModelProps) {
  const ref = useCallback((g: THREE.Group | null) => registerAnchor('station:' + station.id, g), [station.id])
  const robot = station.staff === 'robot'
  const working = state === 'working'
  const bays = Math.max(1, Math.floor(station.bays ?? 1))
  const { parts, tools } = useMemo(() => {
    const r = stationParts(station, line)
    return { parts: station.kind === 'kitting' ? r.parts.filter((p) => p.presentation === 'kitted') : r.parts, tools: r.tools.length ? r.tools : DEFAULT_TOOLS[station.kind] }
  }, [station, line])
  const props: KindProps = { t: simTime, state, working, robot, quality, seed: station.id }
  const hasBench = station.kind !== 'kitting'
  return (
    <group ref={ref}>
      <Static>
        {Array.from({ length: bays }, (_, b) => (
          <Bay key={b} kind={station.kind} props={props} bay={b} />
        ))}
        <Furniture robot={robot} />
        <Andon state={state} t={simTime} p={[1.75, 2.65, -0.85]} h={0.2} />
        {hasBench && (
          <group position={[0, 0, BENCH_Z]}>
            <Bench top={BENCH_TOP[station.kind] ?? 'wood'}>
              <group position={[0, 0.9, 0]}>{BENCH_EXTRAS[station.kind]}</group>
            </Bench>
          </group>
        )}
        <PartsPresentation parts={parts} seed={station.id} />
        <BenchTools tools={tools} />
        {!robot && <OverheadTools tools={tools} t={simTime} working={working} />}
        {robot && ARM_KINDS.includes(station.kind) && <RobotCell kind={station.kind} t={simTime} working={working} seed={station.id} />}
      </Static>
    </group>
  )
})
