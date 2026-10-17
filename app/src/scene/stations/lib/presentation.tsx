import { memo, type ReactNode } from 'react'
import type { Line, Operation, Part, Presentation, Station, StationKind, ToolKind } from '../../../contracts/types'
import { CasingPanel, Compressor, CopperPipe, EEV, FanGrille, FanPropeller, FourWayValve, HarnessCoil, PcbBoard, PlateHX, CoilSlab, grommetGeo, screwGeo } from '../../units/parts'
import { M } from './mats'
import { B, C, CX, Hose, Tor, cylGeo, boxGeo } from './prims'
import { Bin, EuroPallet, Heap, Jig, KitCart, VacTray, ScannerHolster } from './common'

/**
 * Parts presentation: turns the parts used by a station's operations into visible,
 * recognisable objects presented the way the line data says (loose bin, tray, fixture, kit).
 */

export type PartShape =
  | 'screw' | 'grommet' | 'basepan' | 'feet' | 'compressor' | 'pipe' | 'valve4' | 'eev' | 'coil' | 'phe' | 'pcb' | 'harness'
  | 'panel' | 'grille' | 'fan' | 'motor' | 'carton' | 'strap' | 'label' | 'cap' | 'tie' | 'foam' | 'generic'

export function partShape(p: Pick<Part, 'id' | 'name'>): PartShape {
  const s = `${p.id} ${p.name}`.toLowerCase()
  const has = (...k: string[]) => k.some((x) => s.includes(x))
  if (has('screw', 'bolt', 'nut', 'washer', 'rivet')) return 'screw'
  if (has('grommet', 'damper', 'rubber', 'anti-vib', 'mount')) return 'grommet'
  if (has('foot', 'feet', 'rail')) return 'feet'
  if (has('base', 'pan', 'chassis', 'frame')) return 'basepan'
  if (has('compressor')) return 'compressor'
  if (has('4-way', 'four-way', 'reversing', '4way')) return 'valve4'
  if (has('eev', 'expansion')) return 'eev'
  if (has('phe', 'plate heat', 'plate hx', 'water heat', 'bphe')) return 'phe'
  if (has('coil', 'evaporator', 'condenser', 'fin')) return 'coil'
  if (has('pipe', 'tube', 'copper', 'line', 'capillary')) return 'pipe'
  if (has('pcb', 'inverter', 'board', 'controller', 'control')) return 'pcb'
  if (has('harness', 'cable', 'wire', 'loom')) return 'harness'
  if (has('grille', 'guard')) return 'grille'
  if (has('fan', 'blade', 'propeller')) return 'fan'
  if (has('motor')) return 'motor'
  if (has('panel', 'cover', 'casing', 'top', 'lid')) return 'panel'
  if (has('carton', 'box', 'packag')) return 'carton'
  if (has('strap', 'film', 'wrap')) return 'strap'
  if (has('label', 'sticker', 'plate')) return 'label'
  if (has('cap', 'plug')) return 'cap'
  if (has('tie')) return 'tie'
  if (has('foam', 'corner', 'edge')) return 'foam'
  return 'generic'
}

/** Small items go into bins as heaps; big ones need floor-level presentation. */
export const isTiny = (s: PartShape) => s === 'screw' || s === 'grommet' || s === 'cap' || s === 'tie' || s === 'label'
const isLarge = (s: PartShape, part?: Part) =>
  s === 'basepan' || s === 'panel' || s === 'carton' || s === 'coil' || s === 'feet' || (part ? Math.max(...part.size) > 0.5 : false)

/** One part at roughly real size, resting on y = 0. */
export function PartModel({ shape, part, seed = 'p' }: { shape: PartShape; part?: Part; seed?: string }) {
  const sz = part?.size ?? [0.1, 0.1, 0.1]
  switch (shape) {
    case 'screw':
      return <mesh geometry={screwGeo()} material={M.steel} position={[0, 0.0125, 0]} rotation={[Math.PI / 2, 0, 0]} />
    case 'grommet':
      return <mesh geometry={grommetGeo()} material={M.rubber} position={[0, 0.007, 0]} rotation={[Math.PI / 2, 0, 0]} />
    case 'cap':
      return <C rt={0.012} h={0.016} p={[0, 0.008, 0]} m={M.plasticRed} seg={14} />
    case 'tie':
      return <B s={[0.2, 0.002, 0.005]} p={[0, 0.001, 0]} m={M.plasticDark} />
    case 'label':
      return <C rt={0.05} h={0.08} p={[0, 0.04, 0]} m={M.plasticWhite} seg={24} />
    case 'basepan':
      return (
        <group>
          <B s={[Math.max(0.9, sz[0]), 0.004, Math.max(0.38, sz[2])]} p={[0, 0.002, 0]} m={M.galv} />
          {[-1, 1].map((s) => <B key={s} s={[Math.max(0.9, sz[0]), 0.035, 0.003]} p={[0, 0.0175, s * Math.max(0.19, sz[2] / 2)]} m={M.galv} />)}
          {[-1, 1].map((s) => <B key={'e' + s} s={[0.003, 0.035, Math.max(0.38, sz[2])]} p={[s * Math.max(0.45, sz[0] / 2), 0.0175, 0]} m={M.galv} />)}
        </group>
      )
    case 'feet':
      return (
        <group>
          <B s={[0.45, 0.004, 0.06]} p={[0, 0.002, 0]} m={M.galv} />
          {[-1, 1].map((s) => <B key={s} s={[0.45, 0.045, 0.004]} p={[0, 0.0225, s * 0.028]} m={M.galv} />)}
        </group>
      )
    case 'compressor':
      return <Compressor r={0.085} h={0.32} withMounts={false} />
    case 'pipe':
      return <group position={[0, 0.01, 0]}><CopperPipe len={Math.max(0.25, Math.min(0.5, sz[0]))} rad={0.008} /></group>
    case 'valve4':
      return <group position={[0, 0.07, 0]}><FourWayValve /></group>
    case 'eev':
      return <group position={[0, 0.02, 0]}><EEV /></group>
    case 'phe':
      return <group position={[0, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}><PlateHX w={0.11} h={0.28} n={30} /></group>
    case 'coil':
      return <group position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}><CoilSlab len={0.9} h={0.6} t={0.045} /></group>
    case 'pcb':
      return <PcbBoard w={0.2} d={0.14} seed={seed} />
    case 'harness':
      return <HarnessCoil R={0.08} seed={seed} />
    case 'panel':
      return <CasingPanel w={0.9} h={0.65} />
    case 'grille':
      return <group position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><FanGrille R={0.25} /></group>
    case 'fan':
      return <group position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}><FanPropeller R={0.24} /></group>
    case 'motor':
      return (
        <group>
          <C rt={0.07} h={0.08} p={[0, 0.04, 0]} m={M.ral9005} seg={24} />
          <C rt={0.008} h={0.04} p={[0, 0.1, 0]} m={M.chrome} seg={8} />
        </group>
      )
    case 'carton':
      return <B s={[1.3, 0.008, 0.9]} p={[0, 0.004, 0]} m={M.cardboard} />
    case 'strap':
      return (
        <group>
          <Tor R={0.15} rad={0.04} p={[0, 0.04, 0]} r={[Math.PI / 2, 0, 0]} m={M.strap} ts={32} />
          <C rt={0.11} h={0.1} p={[0, 0.05, 0]} m={M.cardboardDark} seg={24} open />
        </group>
      )
    case 'foam':
      return <B s={[0.1, 0.1, 0.1]} p={[0, 0.05, 0]} m={M.foam} />
    default:
      return <B s={[Math.min(0.3, sz[0]), Math.min(0.2, sz[1]), Math.min(0.3, sz[2])]} rad={0.004} p={[0, Math.min(0.2, sz[1]) / 2, 0]} m={M.plasticGrey} />
  }
}

/** Loose bin with a heap of small parts or a few larger ones. */
export function LooseBin({ shape, part, seed }: { shape: PartShape; part?: Part; seed: string }) {
  const w = 0.15, d = 0.24
  if (isTiny(shape)) {
    const g = shape === 'screw' ? screwGeo() : shape === 'grommet' ? grommetGeo() : shape === 'cap' ? cylGeo(0.012, 0.012, 0.016, 10) : boxGeo(0.08, 0.002, 0.005)
    const m = shape === 'screw' ? M.steel : shape === 'grommet' ? M.rubber : shape === 'cap' ? M.plasticRed : M.plasticDark
    return (
      <Bin w={w} d={d} h={0.12} m={seed.length % 2 ? M.plasticBlue : M.plasticGrey}>
        <Heap g={g} m={m} w={w} d={d} n={shape === 'screw' ? 160 : 70} seed={seed} height={0.06} />
      </Bin>
    )
  }
  return (
    <Bin w={0.3} d={0.4} h={0.18} m={M.plasticBlue}>
      {[0, 1, 2].map((i) => (
        <group key={i} position={[(i - 1) * 0.06, 0.01 + i * 0.03, (i - 1) * 0.05]} rotation={[0, i * 0.7, 0]} scale={0.6}>
          <PartModel shape={shape} part={part} seed={seed + i} />
        </group>
      ))}
    </Bin>
  )
}

/** Vacuum-formed tray filled with parts. */
export function PartTray({ shape, part, seed }: { shape: PartShape; part?: Part; seed: string }) {
  const big = shape === 'compressor' || shape === 'phe' || shape === 'grille' || shape === 'fan'
  const cols = big ? 2 : 3
  const rows = big ? 2 : 2
  const cell = big ? 0.3 : 0.16
  const w = cols * cell, d = rows * cell
  return (
    <group>
      <VacTray w={w} d={d} cols={cols} rows={rows} m={shape === 'pcb' ? M.plasticDark : M.plasticGrey} />
      {Array.from({ length: cols * rows }, (_, i) => {
        const cx = -w / 2 + cell / 2 + (i % cols) * cell
        const cz = -d / 2 + cell / 2 + Math.floor(i / cols) * cell
        const sc = big ? 0.7 : shape === 'pcb' ? 0.7 : shape === 'pipe' ? 0.5 : 0.9
        return (
          <group key={i} position={[cx, 0.006, cz]} scale={sc}>
            <PartModel shape={shape} part={part} seed={seed + i} />
          </group>
        )
      })}
    </group>
  )
}

/** Floor-level stack (dunnage trolley) for large flat parts. */
export function PartStack({ shape, part, seed, n = 6 }: { shape: PartShape; part?: Part; seed: string; n?: number }) {
  const lift = shape === 'carton' ? 0.008 : shape === 'panel' ? 0.016 : shape === 'feet' ? 0.05 : 0.04
  if (shape === 'carton') {
    return (
      <EuroPallet>
        {Array.from({ length: 30 }, (_, i) => (
          <group key={i} position={[0, i * lift, 0]} rotation={[0, (i % 3) * 0.004, 0]}>
            <PartModel shape={shape} part={part} seed={seed} />
          </group>
        ))}
      </EuroPallet>
    )
  }
  return (
    <group>
      <KitCart w={1.0} d={0.55}>
        {null}
      </KitCart>
      <group position={[0, 0.8625, 0]}>
        {Array.from({ length: n }, (_, i) => (
          <group key={i} position={[0, 0.0125 + i * lift, 0]} rotation={[0, i % 2 ? 0.01 : -0.01, 0]} scale={shape === 'coil' ? [0.95, 1, 0.75] : shape === 'basepan' ? [0.95, 1, 1.2] : 1}>
            <PartModel shape={shape} part={part} seed={seed} />
          </group>
        ))}
      </group>
    </group>
  )
}

/** Panel A-frame rack (side panels stood on edge). */
export function PanelRack({ n = 8 }: { n?: number }) {
  return (
    <group>
      <B s={[1.1, 0.05, 0.7]} p={[0, 0.06, 0]} m={M.ral5015} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <B s={[0.04, 1.2, 0.04]} p={[s * 0.53, 0.65, 0]} m={M.ral5015} />
          <CX rt={0.05} h={0.03} p={[s * 0.5, 0.05, 0.3]} m={M.rubber} />
          <CX rt={0.05} h={0.03} p={[s * 0.5, 0.05, -0.3]} m={M.rubber} />
        </group>
      ))}
      <B s={[1.1, 0.04, 0.04]} p={[0, 1.25, 0]} m={M.ral5015} />
      {Array.from({ length: n }, (_, i) => {
        const side = i % 2 ? 1 : -1
        const k = Math.floor(i / 2)
        return (
          <group key={i} position={[0, 0.5 + 0.08, side * (0.06 + k * 0.035)]} rotation={[side * (0.18 - k * 0.02), 0, 0]}>
            <group rotation={[Math.PI / 2, 0, 0]}>
              <CasingPanel w={0.95} h={0.72} />
            </group>
          </group>
        )
      })}
    </group>
  )
}

export interface StationPart {
  part?: Part
  shape: PartShape
  presentation: Presentation
}

/** Default parts per station kind, used when the line has no parts for the station. */
const DEFAULTS: Record<StationKind, [PartShape, Presentation][]> = {
  kitting: [['pipe', 'kitted'], ['valve4', 'tray'], ['eev', 'tray'], ['screw', 'loose_bin'], ['grommet', 'loose_bin'], ['cap', 'loose_bin']],
  base_frame: [['basepan', 'tray'], ['screw', 'loose_bin'], ['grommet', 'loose_bin'], ['feet', 'loose_bin']],
  compressor_mount: [['grommet', 'loose_bin'], ['screw', 'loose_bin'], ['phe', 'tray'], ['coil', 'tray']],
  brazing: [['pipe', 'kitted'], ['valve4', 'tray'], ['eev', 'fixtured'], ['cap', 'loose_bin']],
  evacuation_leak_test: [['cap', 'loose_bin']],
  refrigerant_charge: [['cap', 'loose_bin'], ['label', 'loose_bin']],
  electrical_wiring: [['pcb', 'tray'], ['harness', 'kitted'], ['screw', 'loose_bin'], ['tie', 'loose_bin'], ['fan', 'kitted'], ['motor', 'kitted']],
  casing: [['panel', 'tray'], ['grille', 'tray'], ['screw', 'loose_bin'], ['screw', 'loose_bin']],
  run_test: [['cap', 'loose_bin']],
  eol_inspection: [['label', 'loose_bin'], ['cap', 'loose_bin']],
  packing: [['carton', 'tray'], ['foam', 'loose_bin'], ['strap', 'loose_bin'], ['label', 'loose_bin']],
}

export function stationParts(station: Station, line?: Line): { parts: StationPart[]; tools: ToolKind[] } {
  const ops: Operation[] = line ? line.operations.filter((o) => o.station === station.id || station.operations.includes(o.id)) : []
  const byId = new Map((line?.parts ?? []).map((p) => [p.id, p]))
  const seen = new Set<string>()
  const parts: StationPart[] = []
  for (const o of ops)
    for (const pid of o.parts) {
      if (seen.has(pid)) continue
      seen.add(pid)
      const part = byId.get(pid)
      if (!part) continue
      parts.push({ part, shape: partShape(part), presentation: part.presentation })
    }
  const tools = [...new Set(ops.map((o) => o.tool).filter((t) => t !== 'none'))] as ToolKind[]
  if (parts.length === 0) for (const [shape, presentation] of DEFAULTS[station.kind]) parts.push({ shape, presentation })
  return { parts, tools }
}

/** Bench positions (station-local). Bench front faces -z towards the conveyor. */
export const BENCH_Z = 1.76
export const BENCH_H = 0.9
const SHELF_Y = BENCH_H + 0.805
const SHELF_Z = BENCH_Z + 0.13
const LARGE_SLOTS: [number, number][] = [[-1.45, 1.15], [1.45, 1.15], [-1.4, 2.05], [1.4, 2.05]]

/** Lays out every station part by presentation style around the operator. */
export const PartsPresentation = memo(function PartsPresentation({ parts, seed, benchTop }: { parts: StationPart[]; seed: string; benchTop?: ReactNode }) {
  const nodes: ReactNode[] = []
  let bin = 0
  let large = 0
  let benchSlot = 0
  const kitted = parts.filter((p) => p.presentation === 'kitted')
  const benchX = [-0.55, 0.0, 0.5]
  const slots = kitted.length ? [LARGE_SLOTS[0], LARGE_SLOTS[2], LARGE_SLOTS[3]] : LARGE_SLOTS
  const placeLarge = (node: ReactNode, key: string, rot = 0) => {
    const s = slots[large++ % slots.length]
    nodes.push(<group key={key} position={[s[0], 0, s[1]]} rotation={[0, rot, 0]}>{node}</group>)
  }
  parts.forEach((sp, i) => {
    const key = `${sp.shape}${i}`
    const sd = `${seed}:${i}`
    if (sp.presentation === 'kitted') return
    const big = isLarge(sp.shape, sp.part) || sp.shape === 'compressor'
    if (sp.presentation === 'loose_bin') {
      if (big) {
        placeLarge(<PartStack shape={sp.shape} part={sp.part} seed={sd} n={4} />, key)
        return
      }
      const x = -0.75 + (bin % 7) * 0.24
      nodes.push(<group key={key} position={[x, SHELF_Y, SHELF_Z]}><LooseBin shape={sp.shape} part={sp.part} seed={sd} /></group>)
      bin++
      return
    }
    if (sp.presentation === 'tray') {
      if (big) {
        if (sp.shape === 'panel') placeLarge(<PanelRack />, key, Math.PI / 2)
        else if (sp.shape === 'compressor') placeLarge(<EuroPallet><PartTray shape="compressor" part={sp.part} seed={sd} /></EuroPallet>, key)
        else placeLarge(<PartStack shape={sp.shape} part={sp.part} seed={sd} />, key)
        return
      }
      const x = benchX[benchSlot++ % benchX.length]
      nodes.push(<group key={key} position={[x, BENCH_H, BENCH_Z - 0.05]}><PartTray shape={sp.shape} part={sp.part} seed={sd} /></group>)
      return
    }
    if (sp.presentation === 'fixtured') {
      if (big) {
        placeLarge(
          <group>
            <B s={[0.9, 0.85, 0.6]} rad={0.01} p={[0, 0.425, 0]} m={M.ral7035} />
            <group position={[0, 0.85, 0]}><Jig w={0.85} d={0.55}><PartModel shape={sp.shape} part={sp.part} seed={sd} /></Jig></group>
          </group>,
          key,
        )
        return
      }
      const x = benchX[benchSlot++ % benchX.length]
      nodes.push(<group key={key} position={[x, BENCH_H, BENCH_Z - 0.08]}><Jig w={0.42} d={0.3}><PartModel shape={sp.shape} part={sp.part} seed={sd} /></Jig></group>)
    }
  })
  if (kitted.length) {
    const s = LARGE_SLOTS[1]
    nodes.push(
      <group key="kit" position={[s[0], 0, s[1]]} rotation={[0, Math.PI / 2, 0]}>
        <KitCart
          w={0.8}
          d={0.5}
          top={kitted.slice(0, 3).map((k, i) => (
            <group key={i} position={[-0.25 + i * 0.25, 0, 0]} scale={isLarge(k.shape, k.part) ? 0.5 : 0.85}>
              <PartModel shape={k.shape} part={k.part} seed={`${seed}:k${i}`} />
            </group>
          ))}
        >
          {kitted.slice(3, 6).map((k, i) => (
            <group key={i} position={[-0.25 + i * 0.25, 0, 0]} scale={isLarge(k.shape, k.part) ? 0.5 : 0.85}>
              <PartModel shape={k.shape} part={k.part} seed={`${seed}:k${i + 3}`} />
            </group>
          ))}
          {kitted.length <= 3 && kitted.map((k, i) => (
            <group key={'l' + i} position={[-0.25 + i * 0.25, 0, 0.05]} scale={0.8}>
              <PartModel shape={k.shape} part={k.part} seed={`${seed}:l${i}`} />
            </group>
          ))}
        </KitCart>
      </group>,
    )
  }
  return (
    <group>
      {nodes}
      {benchTop}
    </group>
  )
})

/** Hand tools lying on the bench top (crimper, scanner, tape gun). */
export function BenchTools({ tools }: { tools: ToolKind[] }) {
  return (
    <group position={[0, BENCH_H, BENCH_Z]}>
      {tools.includes('scanner') && <group position={[0.8, 0, 0.1]}><ScannerHolster /></group>}
      {tools.includes('crimper') && (
        <group position={[0.3, 0.012, -0.15]} rotation={[0, 0.4, 0]}>
          <B s={[0.2, 0.02, 0.025]} rad={0.008} p={[0.06, 0, 0.02]} r={[0, 0.12, 0]} m={M.plasticRed} />
          <B s={[0.2, 0.02, 0.025]} rad={0.008} p={[0.06, 0, -0.02]} r={[0, -0.12, 0]} m={M.plasticRed} />
          <B s={[0.07, 0.024, 0.05]} rad={0.004} p={[-0.07, 0, 0]} m={M.steelDark} />
        </group>
      )}
      {tools.includes('strapper') && (
        <group position={[0.35, 0, -0.1]}>
          <B s={[0.32, 0.1, 0.1]} rad={0.02} p={[0, 0.05, 0]} m={M.ral1003} />
          <B s={[0.1, 0.06, 0.08]} rad={0.01} p={[-0.1, 0.13, 0]} m={M.plasticDark} />
          <B s={[0.08, 0.12, 0.07]} rad={0.01} p={[0.1, 0.11, 0]} m={M.plasticDark} />
        </group>
      )}
      {tools.includes('screwdriver') && (
        <group position={[-0.2, 0.02, -0.18]} rotation={[0, 0, Math.PI / 2]}>
          <C rt={0.018} h={0.12} m={M.plasticYellow} />
          <C rt={0.004} h={0.12} p={[0, -0.12, 0]} m={M.chrome} seg={8} />
        </group>
      )}
      {tools.includes('hose') && <Hose pts={[[-0.6, 0.02, -0.1], [-0.4, 0.02, 0.05], [-0.5, 0.02, 0.15], [-0.7, 0.02, 0.0]]} rad={0.008} m={M.hoseYellow} tub={24} />}
    </group>
  )
}
