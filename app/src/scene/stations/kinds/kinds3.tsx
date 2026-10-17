import { memo } from 'react'
import { Articulated, MergeSkip } from '../../batch'
import { M, lampMat } from '../lib/mats'
import { B, C, CX, CZ, Hose, frac, keyed, planeGeo } from '../lib/prims'
import { Cabinet, EuroPallet, Monitor } from '../lib/common'
import { ProductUnit } from '../../units/ProductUnit'
import type { KindProps } from './types'

/* ----------------------------------------------------------------- run_test */

const BOOTH = { x: 1.7, zb: -1.75, zf: 0.5, h: 2.3, oy0: 0.78, oy1: 2.0, oz: 0.45 }

const Booth = memo(function Booth() {
  const { x, zb, zf, h, oy0, oy1, oz } = BOOTH
  return (
    <group>
      {/* acoustic back wall */}
      <B s={[2 * x, h, 0.08]} p={[0, h / 2, zb]} m={M.perfGrey} />
      {[-1, 0, 1].map((i) => <B key={i} s={[0.06, h, 0.1]} p={[i * x, h / 2, zb]} m={M.ral7016} />)}
      <B s={[2 * x, 0.08, 0.1]} p={[0, h, zb]} m={M.ral7016} />
      {[-x, x].map((sx) => (
        <group key={sx}>
          <B s={[0.08, oy0, zf - zb]} p={[sx, oy0 / 2, (zb + zf) / 2]} m={M.perfGrey} />
          <B s={[0.08, h - oy1, zf - zb]} p={[sx, (h + oy1) / 2, (zb + zf) / 2]} m={M.perfGrey} />
          <B s={[0.08, oy1 - oy0, -oz - zb]} p={[sx, (oy0 + oy1) / 2, (zb - oz) / 2]} m={M.perfGrey} />
          <B s={[0.08, oy1 - oy0, zf - oz]} p={[sx, (oy0 + oy1) / 2, (zf + oz) / 2]} m={M.perfGrey} />
          <B s={[0.1, h, 0.1]} p={[sx, h / 2, zf]} m={M.ral7016} />
          <B s={[0.1, h, 0.1]} p={[sx, h / 2, zb]} m={M.ral7016} />
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} geometry={planeGeo(0.14, oy1 - oy0 - 0.02)} material={M.glass} position={[sx, (oy0 + oy1) / 2, -oz + 0.075 + i * 0.15]} rotation={[0, Math.PI / 2, 0]} />
          ))}
        </group>
      ))}
    </group>
  )
})

const WaterRig = memo(function WaterRig() {
  return (
    <group>
      <B s={[1.0, 0.06, 0.55]} p={[0, 0.08, 0]} m={M.ral7016} />
      {[-1, 1].map((a) => [-1, 1].map((b) => <B key={`${a}${b}`} s={[0.05, 0.05, 0.05]} p={[a * 0.45, 0.025, b * 0.23]} m={M.rubber} />))}
      {/* buffer tank */}
      <C rt={0.16} h={0.75} p={[-0.28, 0.5, 0]} m={M.insulation} seg={28} />
      <C rt={0.165} h={0.02} p={[-0.28, 0.88, 0]} m={M.alu} seg={28} />
      {/* circulation pump */}
      <group position={[0.15, 0.22, 0.05]}>
        <CX rt={0.06} h={0.16} p={[0.08, 0, 0]} m={M.ral5010} />
        <C rt={0.07} h={0.08} m={M.ral3000} />
        <B s={[0.06, 0.05, 0.08]} p={[0.08, 0.07, 0]} m={M.ral7016} />
      </group>
      {/* flow meter + valves */}
      <group position={[0.32, 0.6, 0.1]}>
        <B s={[0.12, 0.12, 0.08]} rad={0.01} m={M.ral5015} />
        <mesh geometry={planeGeo(0.08, 0.05)} material={M.screen} position={[0, 0.02, 0.041]} />
      </group>
      {/* insulated flow/return risers with colour bands */}
      {[[0.3, M.hoseRed], [0.42, M.hoseBlue]].map(([x, band], i) => (
        <group key={i}>
          <C rt={0.03} h={1.1} p={[x as number, 0.65, -0.15]} m={M.insulation} seg={16} />
          <C rt={0.032} h={0.05} p={[x as number, 0.95, -0.15]} m={band as typeof M.hoseRed} seg={16} />
          <B s={[0.04, 0.03, 0.12]} p={[x as number, 0.8, -0.08]} m={M.ral3000} />
        </group>
      ))}
      <Hose pts={[[0.15, 0.3, 0.05], [0.0, 0.35, 0.05], [-0.12, 0.3, 0.0]]} rad={0.022} m={M.insulation} tub={12} />
    </group>
  )
})

function TestLamp({ state }: { state: KindProps['state'] }) {
  const green = state === 'working'
  const red = state === 'failed'
  return (
    <group>
      <B s={[0.25, 0.02, 0.25]} p={[0, 0.01, 0]} m={M.ral7016} />
      <C rt={0.025} h={1.9} p={[0, 0.95, 0]} m={M.alu} />
      <C rt={0.07} h={0.04} p={[0, 1.92, 0]} m={M.ral9005} />
      {/* lamps swap material with the state: drawn on their own */}
      <MergeSkip>
        <C rt={0.065} h={0.12} p={[0, 2.0, 0]} m={lampMat('green', green)} seg={24} />
        <C rt={0.065} h={0.12} p={[0, 2.13, 0]} m={lampMat('red', red)} seg={24} />
      </MergeSkip>
      <C rt={0.068} h={0.01} p={[0, 2.065, 0]} m={M.ral9005} seg={24} />
      <C rt={0.068} h={0.02} p={[0, 2.2, 0]} m={M.ral9005} seg={24} />
    </group>
  )
}

export function RunTest({ state, working }: KindProps) {
  return (
    <group>
      <Booth />
      <group position={[-1.0, 0, -1.35]}>
        <Cabinet w={0.7} h={1.9} d={0.45} lamps={[['green', working], ['red', state === 'failed'], ['amber', state === 'blocked']]} />
        <group position={[0, 1.5, 0.35]}>
          <Monitor w={0.36} h={0.24} />
        </group>
      </group>
      <group position={[0.55, 0, -1.25]}>
        <WaterRig />
      </group>
      {/* flexible hoses with quick couplers to the unit's water connections */}
      <Hose pts={[[0.85, 1.2, -1.4], [1.0, 1.6, -0.9], [1.0, 1.4, -0.3], [0.85, 1.2, -0.08], [0.74, 1.2, -0.04]]} rad={0.016} m={M.hoseRed} tub={40} radial={10} />
      <Hose pts={[[0.97, 1.2, -1.4], [1.12, 1.55, -0.9], [1.1, 1.2, -0.3], [0.88, 1.0, -0.08], [0.74, 1.02, -0.04]]} rad={0.016} m={M.hoseBlue} tub={40} radial={10} />
      {/* power / comms cable from cabinet */}
      <Hose pts={[[-0.85, 1.9, -1.3], [-0.6, 2.2, -0.9], [0.3, 1.9, -0.6], [0.6, 1.3, -0.3], [0.66, 0.98, -0.15]]} rad={0.011} m={M.cableOrange} tub={40} radial={8} />
      {/* microphone on stand for noise check */}
      <group position={[-0.75, 0, 0.5]}>
        <C rt={0.12} h={0.02} p={[0, 0.01, 0]} m={M.ral9005} />
        <C rt={0.01} h={1.35} p={[0, 0.68, 0]} m={M.steelDark} seg={8} />
        <C rt={0.009} h={0.25} p={[0.08, 1.37, -0.05]} r={[0.6, 0, -1.2]} m={M.steelDark} seg={8} />
        <C rt={0.008} h={0.1} p={[0.2, 1.42, -0.1]} r={[Math.PI / 2 + 0.3, 0, 0]} m={M.chrome} seg={10} />
      </group>
      <group position={[1.45, 0, 0.42]}>
        <TestLamp state={state} />
      </group>
    </group>
  )
}

/* ----------------------------------------------------------- eol_inspection */

const InspectionArch = memo(function InspectionArch() {
  const zs = [-0.62, 0.6]
  return (
    <group>
      {zs.map((z) => (
        <group key={z}>
          <B s={[0.3, 0.02, 0.3]} p={[0, 0.01, z]} m={M.ral7016} />
          <B s={[0.08, 2.25, 0.08]} p={[0, 1.125, z]} m={M.alu} />
          <B s={[0.03, 1.3, 0.04]} p={[0, 1.4, z - Math.sign(z) * 0.05]} m={M.ledBar} cast={false} />
          <B s={[0.05, 1.34, 0.03]} p={[0, 1.4, z - Math.sign(z) * 0.025]} m={M.ral9005} />
        </group>
      ))}
      <B s={[0.1, 0.1, 1.32]} p={[0, 2.25, -0.01]} m={M.alu} />
      <B s={[0.04, 0.03, 1.1]} p={[0, 2.19, -0.01]} m={M.ledBar} cast={false} />
      {/* cameras */}
      {[-0.4, 0.0, 0.4].map((z, i) => (
        <group key={z} position={[0.12, 2.1, z]} rotation={[0, 0, -0.6 - i * 0.1]}>
          <B s={[0.08, 0.07, 0.07]} rad={0.008} m={M.ral9005} />
          <CX rt={0.025} h={0.06} p={[0.07, 0, 0]} m={M.plasticDark} />
          <CX rt={0.02} h={0.005} p={[0.1, 0, 0]} m={M.glass} />
          <Hose pts={[[-0.04, 0.02, 0], [-0.08, 0.08, 0.02], [-0.12, 0.12, 0.06]]} rad={0.004} m={M.hoseBlack} tub={10} radial={5} />
        </group>
      ))}
    </group>
  )
})

export function EolInspection({ working }: KindProps) {
  return (
    <group>
      <group position={[-1.2, 0, 0]}>
        <InspectionArch />
      </group>
      <group position={[0.75, 1.5, -0.7]}>
        <Monitor />
        <C rt={0.02} h={1.5} p={[0, -0.75, -0.2]} m={M.alu} />
        <B s={[0.3, 0.02, 0.3]} p={[0, -1.49, -0.2]} m={M.ral7016} />
      </group>
      {/* reference (golden sample) unit on a table */}
      <group position={[-0.35, 0, -1.4]}>
        <B s={[1.5, 0.05, 0.8]} p={[0, 0.6, 0]} m={M.ral7035} />
        {[-1, 1].map((a) => [-1, 1].map((b) => <B key={`${a}${b}`} s={[0.05, 0.6, 0.05]} p={[a * 0.7, 0.3, b * 0.35]} m={M.ral7016} />))}
        <group position={[0, 0.625, 0]}>
          <ProductUnit kw={9} stage={9} fanSpin={0} seed="golden" />
        </group>
      </group>
      {/* reject / quarantine bin */}
      <group position={[1.3, 0, -1.05]}>
        <B s={[0.7, 0.7, 0.5]} rad={0.02} p={[0, 0.35, 0]} m={M.ral3000} />
        <B s={[0.66, 0.02, 0.46]} p={[0, 0.695, 0]} m={M.ral9005} />
      </group>
      <group position={[1.5, 0, -1.75]}>
        <Cabinet w={0.5} h={1.6} d={0.3} lamps={[['green', working], ['red', false]]} />
      </group>
    </group>
  )
}

/** Hipot / electrical safety tester and label printer on the bench. */
export const EolBench = memo(function EolBench() {
  return (
    <group>
      <group position={[-0.45, 0, -0.05]}>
        <B s={[0.36, 0.16, 0.3]} rad={0.012} p={[0, 0.08, 0]} m={M.ral7035} />
        <mesh geometry={planeGeo(0.16, 0.08)} material={M.screen} position={[-0.06, 0.1, -0.151]} rotation={[0, Math.PI, 0]} />
        {[0, 1].map((i) => <CZ key={i} rt={0.01} h={0.02} p={[0.08 + i * 0.05, 0.05, -0.155]} m={i ? M.plasticRed : M.plasticDark} />)}
        <Hose pts={[[0.08, 0.05, -0.16], [0.1, 0.02, -0.3], [0.2, 0.01, -0.35], [0.3, 0.01, -0.28]]} rad={0.004} m={M.hoseRed} tub={16} />
        <Hose pts={[[0.13, 0.05, -0.16], [0.16, 0.02, -0.26], [0.28, 0.01, -0.22], [0.35, 0.01, -0.12]]} rad={0.004} m={M.hoseBlack} tub={16} />
      </group>
      <group position={[0.15, 0, 0.05]}>
        <B s={[0.22, 0.18, 0.3]} rad={0.02} p={[0, 0.09, 0]} m={M.ral9010} />
        <B s={[0.12, 0.004, 0.06]} p={[0, 0.06, -0.15]} m={M.plasticWhite} />
      </group>
    </group>
  )
})

/* ------------------------------------------------------------------ packing */

function Strapper({ t, working }: { t: number; working: boolean }) {
  const u = frac(t / 8)
  const down = working ? keyed([[0, 0], [0.15, 1], [0.55, 1], [0.7, 0], [1, 0]], u) : 0
  const headY = 2.12 - down * 0.1
  // arch posts: far side post is deep, operator side post is slim so the operator strip stays free
  const posts: [number, number][] = [[-0.62, 0.14], [0.5, 0.09]]
  return (
    <group>
      {/* arch */}
      {posts.map(([z, d]) => (
        <group key={z}>
          <B s={[0.25, 2.3, d]} rad={0.01} p={[0, 1.15, z]} m={M.ral5015} />
          <B s={[0.12, 1.45, 0.02]} p={[0, 1.55, z - Math.sign(z) * (d / 2 + 0.005)]} m={M.ral9005} />
        </group>
      ))}
      <B s={[0.25, 0.16, 1.28]} rad={0.01} p={[0, 2.38, -0.06]} m={M.ral5015} />
      <B s={[0.12, 0.02, 1.0]} p={[0, 2.29, -0.06]} m={M.ral9005} />
      {/* top press head */}
      <group position={[0, headY, 0]}>
        <C rt={0.03} h={0.2} p={[0, 0.12, 0]} m={M.chrome} />
        <B s={[0.2, 0.025, 0.5]} rad={0.006} p={[0, 0, 0]} m={M.steelDark} />
        <B s={[0.22, 0.02, 0.52]} p={[0, -0.02, 0]} m={M.rubber} />
      </group>
      {/* machine body with strap dispenser */}
      <group position={[0.0, 0, -0.95]}>
        <B s={[0.6, 0.85, 0.5]} rad={0.015} p={[0, 0.425, 0]} m={M.ral5015} />
        <CZ rt={0.25} h={0.02} p={[0, 0.55, 0.27]} m={M.plasticDark} seg={32} />
        <CZ rt={0.22} h={0.14} p={[0, 0.55, 0.2]} m={M.strap} seg={32} />
        <CZ rt={0.08} h={0.16} p={[0, 0.55, 0.2]} m={M.cardboardDark} seg={24} />
        <B s={[0.2, 0.1, 0.08]} rad={0.01} p={[0.15, 0.95, 0.15]} m={M.ral7035} />
        <MergeSkip>
          <C rt={0.02} h={0.02} p={[0.15, 1.01, 0.15]} m={lampMat('green', working)} />
        </MergeSkip>
      </group>
    </group>
  )
}

export function Packing({ t, working }: KindProps) {
  return (
    <group>
      <group position={[0, 0, 0]}>
        <Articulated>
          <Strapper t={t} working={working} />
        </Articulated>
      </group>
      {/* outgoing pallet with packed units */}
      <group position={[-1.05, 0, -1.4]}>
        <EuroPallet>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.3, 0, 0]}>
              <B s={[0.58, 0.95, 0.75]} rad={0.006} p={[0, 0.475, 0]} m={M.cardboard} />
              <B s={[0.59, 0.002, 0.05]} p={[0, 0.951, 0]} m={M.tape} />
              {[-0.15, 0.15].map((x) => <B key={x} s={[0.016, 0.96, 0.76]} p={[x, 0.48, 0]} m={M.strap} />)}
            </group>
          ))}
          <mesh geometry={planeGeo(1.22, 1.0)} material={M.stretch} position={[0, 0.5, 0.405]} />
          <mesh geometry={planeGeo(1.22, 1.0)} material={M.stretch} position={[0, 0.5, -0.405]} rotation={[0, Math.PI, 0]} />
        </EuroPallet>
      </group>
      {/* stretch film roll stand */}
      <group position={[0.55, 0, -1.5]}>
        <B s={[0.4, 0.03, 0.4]} p={[0, 0.015, 0]} m={M.ral7016} />
        <C rt={0.02} h={0.9} p={[0, 0.45, 0]} m={M.steel} />
        <C rt={0.06} h={0.5} p={[0, 0.65, 0]} m={M.stretch} seg={24} />
        <C rt={0.04} h={0.52} p={[0, 0.65, 0]} m={M.cardboardDark} seg={16} />
      </group>
    </group>
  )
}

/** Tape gun and spare strap on the packing bench. */
export const PackingBench = memo(function PackingBench() {
  return (
    <group>
      <group position={[-0.4, 0, 0]} rotation={[0, 0.4, 0]}>
        <CZ rt={0.07} h={0.05} p={[0, 0.1, 0]} m={M.tape} />
        <B s={[0.03, 0.12, 0.04]} rad={0.01} p={[0.0, 0.04, 0.0]} r={[0, 0, 0.3]} m={M.ral3000} />
        <B s={[0.15, 0.02, 0.05]} p={[0.06, 0.03, 0]} m={M.ral3000} />
      </group>
      <group position={[0.1, 0, 0.05]}>
        {Array.from({ length: 4 }, (_, i) => <B key={i} s={[0.12, 0.12, 0.12]} p={[(i % 2) * 0.13, 0.06 + Math.floor(i / 2) * 0.12, 0]} m={M.foam} />)}
      </group>
    </group>
  )
})
