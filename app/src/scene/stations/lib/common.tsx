import { memo, useMemo, type ReactNode } from 'react'
import { MergeSkip } from '../../batch'
import type * as THREE from 'three'
import type { StationState } from '../../../playback/store'
import { rng } from '../../../lib/rng'
import { M, lampMat, stateLamp, type LampColor } from './mats'
import { B, C, CX, CZ, Hose, Inst, Sph, Tor, boxGeo, circleGeo, cylGeo, planeGeo, type InstItem, type V3 } from './prims'

/** Station furniture shared by every station kind. All in station-local coordinates. */

export const BELT_Y = 0.85

/** Overhead aluminium-profile gantry with a balancer rail and LED luminaires. */
export const Gantry = memo(function Gantry({ railZ = 0.3, zBack = -0.85, zFront = 2.25, half = 1.75 }: { railZ?: number; zBack?: number; zFront?: number; half?: number }) {
  const H = 2.65
  const P = 0.08
  return (
    <group>
      {[-half, half].map((x) =>
        [zBack, zFront].map((z) => (
          <group key={`${x}${z}`}>
            <B s={[P, H, P]} rad={0.004} p={[x, H / 2, z]} m={M.alu} />
            <B s={[0.16, 0.012, 0.16]} p={[x, 0.006, z]} m={M.steelDark} />
            {[-1, 1].map((s) => <C key={s} rt={0.008} h={0.02} p={[x + s * 0.055, 0.016, z + s * 0.055]} m={M.steel} seg={6} />)}
            <B s={[P + 0.004, 0.012, P + 0.004]} p={[x, H + 0.006, z]} m={M.plasticDark} />
          </group>
        )),
      )}
      {/* longitudinal beams */}
      {[zBack, zFront].map((z) => <B key={z} s={[half * 2 + P, P, P]} rad={0.004} p={[0, H - P / 2, z]} m={M.alu} />)}
      {/* cross beams */}
      {[-half, half].map((x) => <B key={x} s={[P, P, zFront - zBack]} rad={0.004} p={[x, H - P / 2, (zBack + zFront) / 2]} m={M.alu} />)}
      {/* corner gussets */}
      {[-half, half].map((x) =>
        [zBack, zFront].map((z) => <B key={`g${x}${z}`} s={[0.012, 0.25, 0.25]} p={[x, H - 0.2, z + (z === zBack ? 0.12 : -0.12)]} r={[Math.PI / 4, 0, 0]} m={M.aluDark} />),
      )}
      {/* balancer rail (C-track) */}
      <B s={[half * 2, 0.06, 0.05]} p={[0, H - 0.12, railZ]} m={M.ral7035} />
      <B s={[half * 2, 0.012, 0.03]} p={[0, H - 0.156, railZ]} m={M.steelDark} />
      {[-half + 0.6, half - 0.6].map((x) => <B key={x} s={[0.04, 0.08, 0.04]} p={[x, H - 0.06, railZ]} m={M.steelDark} />)}
      {/* luminaires */}
      {[railZ + 0.55, railZ - 0.6].map((z) => (
        <group key={z} position={[0, H - 0.2, z]}>
          <B s={[1.5, 0.05, 0.18]} rad={0.01} m={M.ral9010} />
          <mesh geometry={planeGeo(1.42, 0.12)} material={M.ledPanel} position={[0, -0.026, 0]} rotation={[Math.PI / 2, 0, 0]} />
          {[-0.6, 0.6].map((x) => <Hose key={x} pts={[[x, 0.025, 0], [x, 0.08, 0], [x, 0.16, 0]]} rad={0.002} m={M.steelDark} tub={4} radial={4} />)}
        </group>
      ))}
      {/* cable tray along the back beam */}
      <B s={[half * 2, 0.06, 0.2]} p={[0, H + 0.04, zBack + 0.15]} m={M.galv} />
    </group>
  )
})

/** Andon signal tower: coloured stack only. */
export function Andon({ state, t, p, h = 0.45 }: { state: StationState; t: number; p: V3; h?: number }) {
  const blink = Math.floor(t * 2) % 2 === 0
  const on: Record<LampColor, boolean> = {
    red: state === 'failed' && blink,
    amber: state === 'blocked' || state === 'starved',
    green: state === 'working',
    blue: false,
    white: state === 'idle',
  }
  const order: LampColor[] = ['green', 'amber', 'red']
  return (
    <group position={p}>
      <C rt={0.03} h={0.03} p={[0, 0.015, 0]} m={M.plasticDark} />
      <C rt={0.01} h={h} p={[0, 0.03 + h / 2, 0]} m={M.alu} seg={12} />
      {order.map((c, i) => (
        <group key={c} position={[0, 0.03 + h + 0.045 + i * 0.075, 0]}>
          {/* lamps swap material with the state: drawn on their own, the rest merges */}
          <MergeSkip>
            <C rt={0.034} h={0.07} m={stateLamp(c, on[c])} seg={24} />
          </MergeSkip>
          <C rt={0.036} h={0.006} p={[0, 0.036, 0]} m={M.plasticDark} seg={24} />
        </group>
      ))}
      <C rt={0.036} h={0.03} p={[0, 0.03 + h + 0.045 + 3 * 0.075 - 0.02, 0]} m={M.plasticDark} seg={24} />
    </group>
  )
}

/** Safety light curtain post pair spanning an opening along x at height range. */
export const LightCurtain = memo(function LightCurtain({ a, b, h = 1.5 }: { a: V3; b: V3; h?: number }) {
  return (
    <group>
      {[a, b].map((p, i) => (
        <group key={i} position={p}>
          <B s={[0.16, 0.012, 0.16]} p={[0, 0.006, 0]} m={M.ral9005} />
          <B s={[0.045, h, 0.035]} rad={0.004} p={[0, 0.25 + h / 2, 0]} m={M.ral1003} />
          <B s={[0.025, 0.25, 0.025]} p={[0, 0.125, 0]} m={M.steelDark} />
          <B s={[0.006, h - 0.06, 0.02]} p={[i === 0 ? 0.024 : -0.024, 0.25 + h / 2, 0]} m={M.lightCurtain} />
          <C rt={0.006} h={0.06} p={[0, 0.25 + h + 0.03, 0]} m={M.hoseBlack} seg={8} />
        </group>
      ))}
    </group>
  )
})

/** Yellow floor tape rectangle. */
export const FloorTape = memo(function FloorTape({ x0, x1, z0, z1 }: { x0: number; x1: number; z0: number; z1: number }) {
  const t = 0.05
  return (
    <group>
      <B s={[x1 - x0, 0.002, t]} p={[(x0 + x1) / 2, 0.001, z0]} m={M.floorTape} cast={false} />
      <B s={[x1 - x0, 0.002, t]} p={[(x0 + x1) / 2, 0.001, z1]} m={M.floorTape} cast={false} />
      <B s={[t, 0.002, z1 - z0]} p={[x0, 0.001, (z0 + z1) / 2]} m={M.floorTape} cast={false} />
      <B s={[t, 0.002, z1 - z0]} p={[x1, 0.001, (z0 + z1) / 2]} m={M.floorTape} cast={false} />
    </group>
  )
})

/** Hazard-striped floor zone. */
export function HazardZone({ x0, x1, z0, z1 }: { x0: number; x1: number; z0: number; z1: number }) {
  return (
    <group>
      <mesh geometry={planeGeo(x1 - x0, 0.08)} material={M.hazard} position={[(x0 + x1) / 2, 0.0015, z0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow />
      <mesh geometry={planeGeo(x1 - x0, 0.08)} material={M.hazard} position={[(x0 + x1) / 2, 0.0015, z1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow />
    </group>
  )
}

/** Workbench; front edge faces -z (towards the conveyor). Origin = floor centre. */
export const Bench = memo(function Bench({ w = 1.8, d = 0.62, h = 0.9, top = 'wood', children }: { w?: number; d?: number; h?: number; top?: 'wood' | 'esd' | 'steel'; children?: ReactNode }) {
  const topMat = top === 'wood' ? M.wood : top === 'esd' ? M.esdMat : M.steel
  return (
    <group>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx}${sz}`}>
            <B s={[0.04, h - 0.04, 0.04]} rad={0.003} p={[sx * (w / 2 - 0.04), (h - 0.04) / 2, sz * (d / 2 - 0.04)]} m={M.ral7035} />
            <C rt={0.022} h={0.012} p={[sx * (w / 2 - 0.04), 0.006, sz * (d / 2 - 0.04)]} m={M.rubber} seg={12} />
          </group>
        )),
      )}
      <B s={[w - 0.04, 0.04, d - 0.06]} p={[0, h - 0.06, 0]} m={M.ral7035} />
      <B s={[w, 0.03, d]} rad={0.004} p={[0, h - 0.015, 0]} m={topMat} />
      {top === 'esd' && <B s={[w - 0.04, 0.003, d - 0.04]} p={[0, h + 0.0015, 0]} m={M.esdMat} />}
      {/* lower shelf */}
      <B s={[w - 0.08, 0.02, d - 0.1]} p={[0, 0.2, 0]} m={M.ral7035} />
      {/* drawer unit */}
      <group position={[w / 2 - 0.3, h - 0.25, 0]}>
        <B s={[0.45, 0.36, d - 0.08]} rad={0.004} m={M.ral5015} />
        {[0, 1, 2].map((i) => (
          <group key={i}>
            <B s={[0.43, 0.004, 0.004]} p={[0, 0.12 - i * 0.11 - 0.05, -(d - 0.08) / 2 - 0.002]} m={M.ral7016} />
            <B s={[0.16, 0.014, 0.02]} rad={0.005} p={[0, 0.12 - i * 0.11, -(d - 0.08) / 2 - 0.01]} m={M.alu} />
          </group>
        ))}
      </group>
      {/* rear upright with pegboard, top shelf, task light */}
      {[-1, 1].map((sx) => <B key={sx} s={[0.04, 1.1, 0.04]} p={[sx * (w / 2 - 0.04), h + 0.55, d / 2 - 0.04]} m={M.ral7035} />)}
      <B s={[w - 0.1, 0.62, 0.012]} p={[0, h + 0.36, d / 2 - 0.03]} m={M.pegboard} />
      <B s={[w - 0.02, 0.025, 0.32]} p={[0, h + 0.78, d / 2 - 0.18]} m={M.ral7035} />
      <B s={[w - 0.02, 0.06, 0.012]} p={[0, h + 0.81, d / 2 - 0.335]} m={M.ral7035} />
      <B s={[w - 0.2, 0.025, 0.07]} p={[0, h + 1.18, d / 2 - 0.1]} m={M.ral7035} />
      <mesh geometry={planeGeo(w - 0.24, 0.05)} material={M.ledPanel} position={[0, h + 1.166, d / 2 - 0.1]} rotation={[Math.PI / 2, 0, 0]} />
      {/* power strip */}
      <B s={[0.4, 0.045, 0.04]} rad={0.006} p={[-w / 4, h + 0.08, d / 2 - 0.06]} m={M.ral9010} />
      {[0, 1, 2, 3].map((i) => <C key={i} rt={0.013} h={0.004} p={[-w / 4 - 0.14 + i * 0.09, h + 0.08, d / 2 - 0.082]} r={[Math.PI / 2, 0, 0]} m={M.plasticDark} seg={14} />)}
      {/* hand tools on pegboard */}
      {[-0.5, -0.38, -0.26].map((x, i) => (
        <group key={x} position={[x * w / 1.8, h + 0.4, d / 2 - 0.045]}>
          <B s={[0.02, 0.16 + i * 0.03, 0.015]} rad={0.006} m={i === 1 ? M.plasticRed : M.plasticYellow} />
          <C rt={0.004} h={0.14} p={[0, -0.14 - i * 0.015, 0]} m={M.chrome} seg={8} />
        </group>
      ))}
      {children}
    </group>
  )
})

/** Spring balancer hanging from the rail with a tool on its cable. `drop` = cable length. */
export function Balancer({ x, z = 0.3, drop, sway = 0, children, top = 2.47 }: { x: number; z?: number; drop: number; sway?: number; children?: ReactNode; top?: number }) {
  return (
    <group position={[x, top, z]}>
      <B s={[0.05, 0.03, 0.04]} p={[0, 0.0, 0]} m={M.steelDark} />
      <C rt={0.004} h={0.05} p={[0, -0.04, 0]} m={M.steel} seg={6} />
      <group position={[0, -0.12, 0]}>
        <CZ rt={0.055} h={0.05} m={M.ral5010} seg={28} />
        <CZ rt={0.02} h={0.056} m={M.steel} seg={16} />
        <B s={[0.03, 0.03, 0.03]} p={[0, -0.06, 0]} m={M.ral7016} />
      </group>
      <group rotation={[sway, 0, sway * 0.4]}>
        <C rt={0.0015} h={drop} p={[0, -0.18 - drop / 2, 0]} m={M.steel} seg={5} />
        <Tor R={0.012} rad={0.0025} p={[0, -0.18 - drop - 0.01, 0]} m={M.steel} ts={12} />
        <group position={[0, -0.2 - drop, 0]}>{children}</group>
      </group>
    </group>
  )
}

/** Inline electric torque driver, hanging vertically (bit down). Origin at top hook. */
export const TorqueDriver = memo(function TorqueDriver({ color = M.ral5015 }: { color?: THREE.Material }) {
  return (
    <group>
      <Tor R={0.012} rad={0.003} p={[0, -0.01, 0]} r={[0, Math.PI / 2, 0]} m={M.steelDark} ts={12} />
      <C rt={0.022} h={0.04} p={[0, -0.04, 0]} m={M.plasticDark} />
      <C rt={0.024} h={0.13} p={[0, -0.125, 0]} m={color} seg={20} />
      <C rt={0.021} h={0.12} p={[0, -0.25, 0]} m={M.rubber} seg={20} />
      {Array.from({ length: 6 }, (_, i) => <Tor key={i} R={0.021} rad={0.0025} p={[0, -0.2 - i * 0.018, 0]} r={[Math.PI / 2, 0, 0]} m={M.rubber} ts={18} />)}
      <C rt={0.018} rb={0.012} h={0.04} p={[0, -0.33, 0]} m={M.steelDark} />
      <C rt={0.004} h={0.05} p={[0, -0.375, 0]} m={M.chrome} seg={6} />
      <B s={[0.02, 0.012, 0.012]} p={[0.024, -0.29, 0]} m={M.plasticGreen} />
      <Hose pts={[[0, -0.02, 0.02], [0.02, 0.03, 0.06], [0.04, 0.25, 0.08], [0.04, 0.5, 0.05]]} rad={0.005} m={M.hoseBlack} tub={20} radial={6} />
    </group>
  )
})

/** Brazing torch with twin hose (oxygen blue / fuel red). Origin at grip top, torch tip points -y/+z. */
export function BrazingTorch({ flame = 0 }: { flame?: number }) {
  return (
    <group>
      <C rt={0.014} h={0.18} p={[0, -0.09, 0]} m={M.brass} seg={16} />
      <C rt={0.016} h={0.02} p={[0, -0.18, 0]} m={M.brass} seg={16} />
      {[0, 1].map((i) => <CX key={i} rt={0.012} h={0.012} p={[0.02, -0.03 - i * 0.035, 0]} m={i ? M.plasticBlue : M.plasticRed} seg={12} />)}
      <Hose pts={[[0, -0.19, 0], [0, -0.26, 0.02], [0, -0.3, 0.07], [0, -0.31, 0.12]]} rad={0.004} m={M.copper} tub={16} radial={8} />
      <C rt={0.0055} rb={0.004} h={0.03} p={[0, -0.311, 0.135]} r={[Math.PI / 2, 0, 0]} m={M.brass} seg={10} />
      {flame > 0 && (
        <group position={[0, -0.311, 0.15]} rotation={[Math.PI / 2, 0, 0]} scale={[1, flame, 1]}>
          <mesh geometry={cylGeo(0.0008, 0.005, 0.03, 10)} material={M.flameCore} position={[0, 0.015, 0]} />
          <mesh geometry={cylGeo(0.001, 0.012, 0.09, 12)} material={M.flameOuter} position={[0, 0.045, 0]} />
        </group>
      )}
    </group>
  )
}

/** Gas cylinder: body colour + shoulder colour, valve and guard cap. Origin at floor. */
export function GasBottle({ body, shoulder, h = 1.45, r = 0.115 }: { body: THREE.Material; shoulder: THREE.Material; h?: number; r?: number }) {
  return (
    <group>
      <C rt={r} h={h - r} p={[0, (h - r) / 2, 0]} m={body} seg={28} />
      <Sph rad={r} p={[0, h - r, 0]} scale={[1, 0.6, 1]} m={shoulder} ws={28} hs={14} />
      <C rt={0.025} h={0.05} p={[0, h - r + r * 0.6 + 0.02, 0]} m={M.brass} seg={12} />
      <C rt={0.045} h={0.11} p={[0, h + 0.07, 0]} m={M.steelDark} seg={16} open />
      <Tor R={r + 0.002} rad={0.006} p={[0, h * 0.62, 0]} r={[Math.PI / 2, 0, 0]} m={M.steelDark} ts={28} />
    </group>
  )
}

/** Pressure regulator with dial gauge facing +z. */
export function Regulator({ p }: { p: V3 }) {
  return (
    <group position={p}>
      <B s={[0.06, 0.06, 0.06]} rad={0.01} m={M.brass} />
      <CX rt={0.022} h={0.04} p={[0.05, 0.02, 0]} m={M.steelDark} />
      <CZ rt={0.032} h={0.025} p={[0.05, 0.02, 0.02]} m={M.chrome} seg={28} />
      <mesh geometry={circleGeo(0.028)} material={M.dial} position={[0.05, 0.02, 0.0335]} />
      <CZ rt={0.012} h={0.05} p={[0, 0, -0.045]} m={M.plasticDark} seg={14} />
    </group>
  )
}

/** Two-wheel cylinder cart. */
export function BottleCart({ bottles, children }: { bottles: [THREE.Material, THREE.Material][]; children?: ReactNode }) {
  const n = bottles.length
  const w = n * 0.26 + 0.08
  return (
    <group>
      <B s={[w, 0.03, 0.34]} p={[0, 0.06, 0]} m={M.ral3000} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <B s={[0.03, 1.15, 0.03]} p={[s * (w / 2 - 0.02), 0.62, -0.15]} m={M.ral3000} />
          <CX rt={0.1} h={0.05} p={[s * (w / 2 + 0.03), 0.1, -0.12]} m={M.rubber} seg={24} />
          <CX rt={0.045} h={0.055} p={[s * (w / 2 + 0.03), 0.1, -0.12]} m={M.steel} seg={16} />
        </group>
      ))}
      <B s={[w, 0.03, 0.03]} p={[0, 1.19, -0.15]} m={M.ral3000} />
      <B s={[w, 0.025, 0.025]} p={[0, 0.85, -0.15]} m={M.ral3000} />
      <CX rt={0.015} h={w + 0.1} p={[0, 1.25, -0.22]} m={M.rubber} seg={12} />
      {bottles.map(([b, s], i) => (
        <group key={i} position={[-w / 2 + 0.17 + i * 0.26, 0.075, 0]}>
          <GasBottle body={b} shoulder={s} />
          <Regulator p={[0, 1.42, 0.07]} />
          <Tor R={0.12} rad={0.005} p={[0, 0.95, 0]} r={[Math.PI / 2, 0, 0]} m={M.steel} ts={24} />
        </group>
      ))}
      {children}
    </group>
  )
}

/** Open-fronted stacking bin (louvre bin). Origin = bottom centre, open side faces -z. */
export function Bin({ w = 0.15, d = 0.24, h = 0.12, m = M.plasticBlue, children }: { w?: number; d?: number; h?: number; m?: THREE.Material; children?: ReactNode }) {
  const t = 0.004
  return (
    <group>
      <B s={[w, t, d]} p={[0, t / 2, 0]} m={m} />
      <B s={[w, h, t]} p={[0, h / 2, d / 2]} m={m} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <B s={[t, h * 0.55, d]} p={[s * (w / 2), h * 0.275, 0]} m={m} />
          <B s={[t, h * 0.5, d * 0.55]} p={[s * (w / 2), h * 0.7, d * 0.22]} m={m} />
        </group>
      ))}
      <B s={[w, h * 0.45, t]} p={[0, h * 0.225, -d / 2]} m={m} />
      <B s={[w * 0.5, h * 0.12, 0.012]} p={[0, h * 0.36, -d / 2 - 0.004]} m={M.plasticWhite} />
      <B s={[w + 0.006, 0.01, 0.02]} p={[0, h - 0.005, d / 2 - 0.01]} m={m} />
      {children}
    </group>
  )
}

/** Heap of small parts (screws, grommets) as one instanced mesh. Origin = bin floor centre. */
export function Heap({ g, m, w, d, n = 90, seed, height = 0.05, s = 1 }: { g: THREE.BufferGeometry; m: THREE.Material; w: number; d: number; n?: number; seed: string; height?: number; s?: number }) {
  const items = useMemo<InstItem[]>(() => {
    const r = rng('heap', seed)
    const out: InstItem[] = []
    for (let i = 0; i < n; i++) {
      const u = (r() - 0.5) * w * 0.85
      const v = (r() - 0.5) * d * 0.85
      // heap: higher towards the back, lower at the open front
      const yMax = height * (0.6 + 0.4 * (v / d + 0.5)) * (1 - Math.abs(u) / w)
      out.push({ p: [u, 0.006 + r() * yMax, v], r: [r() * Math.PI, r() * Math.PI, r() * Math.PI], s })
    }
    return out
  }, [w, d, n, seed, height, s])
  return <Inst g={g} m={m} items={items} cast={false} />
}

/** Vacuum-formed tray with a grid of compartments. Origin = bottom centre. Children are laid into cells by the caller. */
export function VacTray({ w, d, cols, rows, m = M.plasticDark, h = 0.05 }: { w: number; d: number; cols: number; rows: number; m?: THREE.Material; h?: number }) {
  return (
    <group>
      <B s={[w, 0.004, d]} rad={0.0015} p={[0, 0.002, 0]} m={m} />
      <B s={[w + 0.02, 0.004, d + 0.02]} rad={0.0015} p={[0, h, 0]} m={m} />
      {Array.from({ length: cols + 1 }, (_, i) => <B key={'c' + i} s={[0.012, h, d]} rad={0.004} p={[-w / 2 + (i * w) / cols, h / 2, 0]} m={m} />)}
      {Array.from({ length: rows + 1 }, (_, i) => <B key={'r' + i} s={[w, h, 0.012]} rad={0.004} p={[0, h / 2, -d / 2 + (i * d) / rows]} m={m} />)}
    </group>
  )
}

/** Shop trolley with two shelves. Origin = floor centre. */
export function KitCart({ w = 0.9, d = 0.55, children, top }: { w?: number; d?: number; children?: ReactNode; top?: ReactNode }) {
  return (
    <group>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx}${sz}`} position={[sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03)]}>
            <C rt={0.012} h={0.85} p={[0, 0.53, 0]} m={M.steel} seg={10} />
            <CX rt={0.045} h={0.03} p={[0, 0.05, 0]} m={M.rubber} seg={18} />
            <B s={[0.04, 0.03, 0.04]} p={[0, 0.1, 0]} m={M.steelDark} />
          </group>
        )),
      )}
      <B s={[w, 0.025, d]} rad={0.004} p={[0, 0.25, 0]} m={M.ral5015} />
      <B s={[w, 0.025, d]} rad={0.004} p={[0, 0.85, 0]} m={M.ral5015} />
      <B s={[w, 0.04, 0.01]} p={[0, 0.88, d / 2]} m={M.ral5015} />
      <B s={[w, 0.04, 0.01]} p={[0, 0.88, -d / 2]} m={M.ral5015} />
      <CZ rt={0.013} h={d - 0.02} p={[w / 2 + 0.05, 1.0, 0]} m={M.plasticDark} seg={12} />
      {[-1, 1].map((s) => <CX key={s} rt={0.01} h={0.06} p={[w / 2 + 0.02, 1.0, s * (d / 2 - 0.05)]} m={M.steel} />)}
      <group position={[0, 0.2625, 0]}>{children}</group>
      <group position={[0, 0.8625, 0]}>{top}</group>
    </group>
  )
}

/** Tooling-plate jig with locating pins and toggle clamps. Origin = bottom centre. */
export function Jig({ w = 0.5, d = 0.35, children }: { w?: number; d?: number; children?: ReactNode }) {
  return (
    <group>
      <B s={[w, 0.02, d]} rad={0.003} p={[0, 0.01, 0]} m={M.alu} />
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => <C key={`${sx}${sz}`} rt={0.006} h={0.03} p={[sx * (w / 2 - 0.04), 0.035, sz * (d / 2 - 0.04)]} m={M.chrome} seg={10} />),
      )}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * (w / 2 - 0.02), 0.02, 0]}>
          <B s={[0.03, 0.04, 0.05]} p={[0, 0.02, 0]} m={M.steelDark} />
          <B s={[0.07, 0.01, 0.015]} p={[-sx * 0.02, 0.05, 0]} r={[0, 0, sx * 0.4]} m={M.steel} />
          <B s={[0.012, 0.06, 0.014]} rad={0.005} p={[sx * 0.01, 0.075, 0]} r={[0, 0, -sx * 0.5]} m={M.plasticRed} />
        </group>
      ))}
      <B s={[0.05, 0.03, 0.03]} p={[0, 0.035, d / 2 - 0.02]} m={M.ral5015} />
      <group position={[0, 0.02, 0]}>{children}</group>
    </group>
  )
}

/** Electrical control cabinet, doors face +z. Origin = floor centre. */
export function Cabinet({ w = 0.6, h = 1.8, d = 0.4, lamps = [], plinth = true }: { w?: number; h?: number; d?: number; lamps?: [LampColor, boolean][]; plinth?: boolean }) {
  const y0 = plinth ? 0.1 : 0
  return (
    <group>
      {plinth && <B s={[w, 0.1, d]} p={[0, 0.05, 0]} m={M.ral7016} />}
      <B s={[w, h - y0, d]} rad={0.006} p={[0, y0 + (h - y0) / 2, 0]} m={M.ral7035} />
      <B s={[0.004, h - y0 - 0.06, 0.004]} p={[0, y0 + (h - y0) / 2, d / 2 + 0.001]} m={M.ral7016} />
      {[-1, 1].map((s) => <B key={s} s={[0.025, 0.12, 0.02]} rad={0.008} p={[s * 0.04, y0 + (h - y0) * 0.55, d / 2 + 0.01]} m={M.plasticDark} />)}
      {lamps.map(([c, on], i) => (
        <group key={i} position={[-w / 4 + i * 0.06, y0 + (h - y0) * 0.82, d / 2 + 0.008]}>
          <CZ rt={0.016} h={0.016} m={M.chrome} seg={20} />
          {/* swaps material with the station state: drawn on its own */}
          <MergeSkip>
            <CZ rt={0.012} h={0.02} p={[0, 0, 0.004]} m={stateLamp(c, on)} seg={20} />
          </MergeSkip>
        </group>
      ))}
      {/* e-stop */}
      <group position={[w / 4, y0 + (h - y0) * 0.82, d / 2 + 0.01]}>
        <B s={[0.07, 0.07, 0.02]} rad={0.006} m={M.ral1003} />
        <CZ rt={0.022} h={0.03} p={[0, 0, 0.02]} m={M.plasticRed} seg={20} />
      </group>
      {/* filter fan */}
      <group position={[0, y0 + 0.25, d / 2 + 0.006]}>
        <B s={[0.15, 0.15, 0.012]} rad={0.004} m={M.ral7035} />
        {Array.from({ length: 6 }, (_, i) => <B key={i} s={[0.12, 0.006, 0.006]} p={[0, -0.05 + i * 0.02, 0.006]} m={M.plasticGrey} />)}
      </group>
      {/* roof cable entry */}
      <B s={[w * 0.5, 0.06, d * 0.5]} p={[0, h + 0.03, 0]} m={M.ral7016} />
    </group>
  )
}

/** Monitor on a VESA arm, screen facing +z. */
export function Monitor({ w = 0.42, h = 0.27 }: { w?: number; h?: number }) {
  return (
    <group>
      <B s={[w, h, 0.03]} rad={0.006} m={M.plasticDark} />
      <mesh geometry={planeGeo(w - 0.02, h - 0.02)} material={M.screen} position={[0, 0, 0.0155]} />
      <B s={[0.05, 0.05, 0.04]} p={[0, 0, -0.035]} m={M.steelDark} />
      <CZ rt={0.012} h={0.15} p={[0, 0, -0.12]} m={M.steelDark} />
    </group>
  )
}

/** Mesh safety fence along a polyline of floor points (x,z). */
export function Fence({ pts, h = 2.0 }: { pts: [number, number][]; h?: number }) {
  const segs = useMemo(() => {
    const out: { cx: number; cz: number; len: number; a: number }[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i]
      const [x1, z1] = pts[i + 1]
      const len = Math.hypot(x1 - x0, z1 - z0)
      out.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, len, a: -Math.atan2(z1 - z0, x1 - x0) })
    }
    return out
  }, [pts])
  return (
    <group>
      {pts.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <B s={[0.06, h + 0.1, 0.06]} p={[0, (h + 0.1) / 2, 0]} m={M.ral1003} />
          <B s={[0.14, 0.01, 0.14]} p={[0, 0.005, 0]} m={M.ral1003} />
        </group>
      ))}
      {segs.map((s, i) => (
        <group key={i} position={[s.cx, 0, s.cz]} rotation={[0, s.a, 0]}>
          <mesh geometry={planeGeo(s.len - 0.06, h - 0.25)} material={M.fenceMesh} position={[0, 0.2 + (h - 0.25) / 2, 0]} />
          <B s={[s.len - 0.06, 0.025, 0.025]} p={[0, 0.2, 0]} m={M.ral9005} />
          <B s={[s.len - 0.06, 0.025, 0.025]} p={[0, h - 0.05, 0]} m={M.ral9005} />
        </group>
      ))}
    </group>
  )
}

/** Pallet (EUR 1.2 x 0.8) with optional load. Origin = floor centre. */
export function EuroPallet({ children }: { children?: ReactNode }) {
  return (
    <group>
      {[-1, 0, 1].map((i) => <B key={'b' + i} s={[1.2, 0.022, 0.1]} p={[0, 0.011, i * 0.35]} m={M.wood} />)}
      {[-1, 0, 1].map((i) =>
        [-1, 0, 1].map((j) => <B key={`k${i}${j}`} s={[0.145, 0.078, 0.1]} p={[i * 0.53, 0.061, j * 0.35]} m={M.wood} />),
      )}
      {[-1, 0, 1].map((i) => <B key={'s' + i} s={[1.2, 0.022, 0.1]} p={[0, 0.111, i * 0.35]} m={M.wood} />)}
      {[-2, -1, 0, 1, 2].map((i) => <B key={'t' + i} s={[0.1 + (i === 0 ? 0.05 : 0), 0.022, 0.8]} p={[i * 0.27, 0.133, 0]} m={M.wood} />)}
      <group position={[0, 0.144, 0]}>{children}</group>
    </group>
  )
}

/** Barcode scanner holster with handheld scanner. */
export function ScannerHolster() {
  return (
    <group>
      <B s={[0.07, 0.1, 0.05]} rad={0.006} p={[0, 0.05, 0]} m={M.plasticDark} />
      <group position={[0, 0.12, 0]} rotation={[0.3, 0, 0]}>
        <B s={[0.05, 0.05, 0.12]} rad={0.012} p={[0, 0.02, 0.03]} m={M.ral1003} />
        <B s={[0.035, 0.12, 0.04]} rad={0.01} p={[0, -0.04, -0.01]} m={M.plasticDark} />
        <mesh geometry={planeGeo(0.035, 0.03)} material={lampMat('red', false)} position={[0, 0.02, 0.091]} />
      </group>
      <Hose pts={[[0, 0.06, -0.03], [0, -0.05, -0.08], [0.05, -0.2, -0.05], [0.1, -0.3, 0.0]]} rad={0.003} m={M.hoseBlack} tub={16} radial={5} />
    </group>
  )
}

export { boxGeo }
