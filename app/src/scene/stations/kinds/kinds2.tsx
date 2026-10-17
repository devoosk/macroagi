import { memo } from 'react'
import { Articulated, MergeSkip } from '../../batch'
import { M, lampMat } from '../lib/mats'
import { B, C, CX, CZ, Hose, Tor, circleGeo, frac, planeGeo, smooth } from '../lib/prims'
import { Balancer, Cabinet, GasBottle, HazardZone, KitCart, Monitor, Regulator } from '../lib/common'
import { CasingPanel, FanGrille, HarnessCoil, PcbBoard } from '../../units/parts'
import type { KindProps } from './types'

/** Round dial gauge facing +z; value 0..1 sweeps the needle across the scale. */
export function Gauge({ value, r = 0.06 }: { value: number; r?: number }) {
  const th = 1.25 * Math.PI - Math.max(0, Math.min(1, value)) * 1.5 * Math.PI
  return (
    <Articulated>
      <CZ rt={r + 0.008} h={0.03} p={[0, 0, -0.015]} m={M.chrome} seg={32} />
      <mesh geometry={circleGeo(r, 40)} material={M.dial} position={[0, 0, 0.001]} />
      <group position={[0, 0, 0.006]} rotation={[0, 0, th]}>
        <B s={[r * 0.85, 0.004, 0.002]} p={[r * 0.35, 0, 0]} m={M.plasticRed} cast={false} />
      </group>
      <CZ rt={0.007} h={0.006} p={[0, 0, 0.008]} m={M.ral9005} seg={12} />
      <mesh geometry={circleGeo(r + 0.004, 40)} material={M.glass} position={[0, 0, 0.012]} />
    </Articulated>
  )
}

/* ----------------------------------------------------- evacuation_leak_test */

const CH = { x0: -1.0, x1: 1.0, z0: -0.62, z1: 0.53, h: 2.15, oy0: 0.78, oy1: 1.95, oz: 0.45 }

const ChamberShell = memo(function ChamberShell() {
  const { x0, x1, z0, z1, h, oy0, oy1, oz } = CH
  const w = x1 - x0
  const d = z1 - z0
  return (
    <group>
      {/* corner posts */}
      {[x0, x1].map((x) => [z0, z1].map((z) => <B key={`${x}${z}`} s={[0.08, h, 0.08]} p={[x, h / 2, z]} m={M.ral7035} />))}
      {/* back wall with stiffeners */}
      <B s={[w, h, 0.02]} p={[0, h / 2, z0]} m={M.ral7035} />
      {[-0.5, 0, 0.5].map((x) => <B key={x} s={[0.05, h - 0.1, 0.05]} p={[x, h / 2, z0 - 0.035]} m={M.ral7035} />)}
      {/* roof */}
      <B s={[w + 0.08, 0.06, d + 0.08]} p={[0, h + 0.03, (z0 + z1) / 2]} m={M.ral7035} />
      <C rt={0.06} h={0.3} p={[0.4, h + 0.2, -0.2]} m={M.steel} />
      <C rt={0.08} h={0.03} p={[0.4, h + 0.08, -0.2]} m={M.steel} />
      {/* side walls with conveyor openings */}
      {[x0, x1].map((x) => (
        <group key={x}>
          <B s={[0.03, oy0, d]} p={[x, oy0 / 2, (z0 + z1) / 2]} m={M.ral7035} />
          <B s={[0.03, h - oy1, d]} p={[x, (h + oy1) / 2, (z0 + z1) / 2]} m={M.ral7035} />
          <B s={[0.03, oy1 - oy0, z1 - oz]} p={[x, (oy0 + oy1) / 2, (z1 + oz) / 2]} m={M.ral7035} />
          <B s={[0.03, oy1 - oy0, -oz - z0]} p={[x, (oy0 + oy1) / 2, (z0 - oz) / 2]} m={M.ral7035} />
          {/* PVC strip curtain */}
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} geometry={planeGeo(0.14, oy1 - oy0 - 0.02)} material={M.glass} position={[x, (oy0 + oy1) / 2, -oz + 0.075 + i * 0.15]} rotation={[0, Math.PI / 2, 0]} />
          ))}
        </group>
      ))}
      {/* lower front panel and door rail */}
      <B s={[w, oy0, 0.02]} p={[0, oy0 / 2, z1]} m={M.ral7035} />
      <B s={[3.9, 0.08, 0.06]} p={[0, h + 0.0, z1 + 0.06]} m={M.alu} />
      {/* interior light and test head */}
      <mesh geometry={planeGeo(1.4, 0.1)} material={M.ledPanel} position={[0, h - 0.01, -0.1]} rotation={[Math.PI / 2, 0, 0]} />
      <group position={[0.55, 1.75, 0.05]}>
        <B s={[0.1, 0.1, 0.1]} rad={0.01} m={M.alu} />
        <C rt={0.02} h={0.3} p={[0, 0.2, 0]} m={M.steel} />
        <Hose pts={[[0, -0.05, 0], [0.05, -0.25, 0.05], [0.07, -0.45, 0.1], [0.06, -0.55, 0.12]]} rad={0.009} m={M.hoseBlack} tub={20} />
        <B s={[0.05, 0.08, 0.04]} rad={0.008} p={[0.06, -0.6, 0.12]} m={M.ral2004} />
      </group>
      {/* frame for helium spray / evacuation manifold on the roof */}
      <B s={[0.6, 0.25, 0.4]} rad={0.01} p={[-0.4, h + 0.185, -0.2]} m={M.ral7016} />
    </group>
  )
})

function ChamberDoors({ open }: { open: number }) {
  const { z1, oy0, h } = CH
  const leafW = 1.0
  const leafH = h - oy0 - 0.02
  return (
    <group>
      {[-1, 1].map((s) => {
        const x = s * (0.5 + open * 1.02)
        return (
          <group key={s} position={[x, oy0 + leafH / 2, z1 + 0.03]}>
            {/* frame around a large window */}
            <B s={[leafW, 0.12, 0.035]} rad={0.004} p={[0, -leafH / 2 + 0.06, 0]} m={M.ral7035} />
            <B s={[leafW, 0.1, 0.035]} rad={0.004} p={[0, leafH / 2 - 0.05, 0]} m={M.ral7035} />
            <B s={[0.08, leafH, 0.035]} rad={0.004} p={[-leafW / 2 + 0.04, 0, 0]} m={M.ral7035} />
            <B s={[0.08, leafH, 0.035]} rad={0.004} p={[leafW / 2 - 0.04, 0, 0]} m={M.ral7035} />
            <B s={[leafW - 0.1, 0.012, 0.012]} p={[0, -0.1, 0]} m={M.ral9005} />
            <mesh geometry={planeGeo(leafW - 0.14, leafH - 0.2)} material={M.glass} position={[0, 0.01, 0.0]} />
            <B s={[0.03, 0.3, 0.04]} rad={0.01} p={[-s * (leafW / 2 - 0.08), 0, 0.04]} m={M.alu} />
            <B s={[0.12, 0.05, 0.05]} p={[0, leafH / 2 + 0.03, 0]} m={M.steelDark} />
          </group>
        )
      })}
    </group>
  )
}

const VacuumPumpCart = memo(function VacuumPumpCart() {
  return (
    <group>
      <KitCart w={0.7} d={0.5} />
      <group position={[0, 0.875, 0]}>
        {/* rotary vane pump: motor + pump body + oil sight glass */}
        <CX rt={0.09} h={0.26} p={[-0.13, 0.11, 0]} m={M.ral5015} seg={24} />
        {Array.from({ length: 8 }, (_, i) => <B key={i} s={[0.24, 0.005, 0.18]} p={[-0.13, 0.04 + i * 0.02, 0]} m={M.ral5015} />)}
        <B s={[0.22, 0.2, 0.18]} rad={0.02} p={[0.13, 0.1, 0]} m={M.ral7035} />
        <CZ rt={0.025} h={0.01} p={[0.13, 0.06, 0.092]} m={M.glass} />
        <CZ rt={0.025} h={0.006} p={[0.13, 0.06, 0.089]} m={M.hoseYellow} />
        <C rt={0.03} h={0.08} p={[0.18, 0.24, 0]} m={M.steel} />
        <Tor R={0.035} rad={0.008} p={[0.18, 0.285, 0]} r={[Math.PI / 2, 0, 0]} m={M.steel} />
        <C rt={0.012} h={0.05} p={[0.05, 0.23, 0.05]} m={M.ral9005} />
      </group>
      {/* gauge panel */}
      <B s={[0.03, 0.4, 0.03]} p={[0.0, 1.2, -0.2]} m={M.steelDark} />
      <B s={[0.3, 0.2, 0.04]} rad={0.006} p={[0, 1.42, -0.19]} m={M.ral7016} />
    </group>
  )
})

export function LeakTest({ t, working }: KindProps) {
  const open = working ? 0 : 1
  // pump-down curve: needle falls fast then levels off each cycle
  const u = frac(t / 45)
  const vac = working ? 0.08 + 0.85 * Math.exp(-u * 6) : 0.95
  return (
    <group>
      <ChamberShell />
      <Articulated>
        <ChamberDoors open={open} />
      </Articulated>
      <group position={[1.2, 0, -1.3]}>
        <VacuumPumpCart />
        <group position={[-0.07, 1.42, -0.165]}>
          <Gauge value={vac} r={0.07} />
        </group>
        <group position={[0.1, 1.42, -0.165]}>
          <Gauge value={working ? smooth(u * 3) * 0.7 : 0} r={0.05} />
        </group>
      </group>
      <Hose pts={[[1.38, 1.18, -1.3], [1.3, 1.6, -1.1], [1.0, 2.3, -0.7], [0.6, 2.45, -0.4], [0.4, 2.35, -0.2]]} rad={0.022} m={M.hoseBlack} tub={40} radial={10} />
      {/* helium leak detector */}
      <group position={[-0.1, 0, -1.3]}>
        <B s={[0.6, 0.9, 0.5]} rad={0.02} p={[0, 0.5, 0]} m={M.ral9010} />
        {[-1, 1].map((a) => [-1, 1].map((b) => <C key={`${a}${b}`} rt={0.035} h={0.05} p={[a * 0.25, 0.03, b * 0.2]} m={M.rubber} />))}
        <group position={[0, 1.02, 0.12]} rotation={[-0.5, 0, 0]}>
          <B s={[0.5, 0.06, 0.3]} rad={0.01} m={M.ral7016} />
          <mesh geometry={planeGeo(0.3, 0.18)} material={M.screen} position={[-0.05, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]} />
          <MergeSkip>
            <mesh geometry={circleGeo(0.015)} material={lampMat('green', working)} position={[0.19, 0.031, -0.08]} rotation={[-Math.PI / 2, 0, 0]} />
          </MergeSkip>
        </group>
        <Hose pts={[[0.2, 0.8, -0.2], [0.3, 1.6, -0.1], [0.0, 2.4, 0.5], [-0.3, 2.3, 1.1]]} rad={0.012} m={M.hoseGrey} tub={30} />
      </group>
      {/* helium bottles chained to a rack */}
      <group position={[-1.3, 0, -1.35]}>
        <B s={[0.75, 1.2, 0.04]} p={[0, 0.6, -0.2]} m={M.ral7016} />
        {[-0.2, 0.15].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <GasBottle body={M.cylGrey} shoulder={M.cylBrown} />
            <Regulator p={[0, 1.45, 0.07]} />
          </group>
        ))}
        <B s={[0.75, 0.03, 0.03]} p={[0, 1.0, 0.12]} m={M.steelDark} />
      </group>
      <group position={[-1.45, 0, -0.78]} rotation={[0, Math.PI / 2, 0]}>
        <Cabinet w={0.5} h={1.7} d={0.35} lamps={[['green', working], ['red', false]]} />
      </group>
    </group>
  )
}

/* ------------------------------------------------------- refrigerant_charge */

const ChargingMachine = memo(function ChargingMachine() {
  return (
    <group>
      <B s={[1.0, 1.05, 0.7]} rad={0.015} p={[0, 0.575, 0]} m={M.ral7035} />
      <B s={[1.0, 0.05, 0.7]} p={[0, 0.025, 0]} m={M.ral7016} />
      {/* sloped console */}
      <group position={[0, 1.2, 0.05]} rotation={[-0.55, 0, 0]}>
        <B s={[1.0, 0.32, 0.12]} rad={0.015} m={M.ral7035} />
        <mesh geometry={planeGeo(0.38, 0.22)} material={M.screen} position={[-0.25, 0, 0.061]} />
        {[0, 1, 2, 3].map((i) => <CZ key={i} rt={0.014} h={0.015} p={[0.06 + (i % 2) * 0.05, 0.06 - Math.floor(i / 2) * 0.06, 0.065]} m={i === 3 ? M.plasticRed : M.plasticGreen} seg={16} />)}
      </group>
      {/* tower with hose reel */}
      <B s={[0.25, 0.8, 0.25]} rad={0.01} p={[-0.38, 1.5, -0.2]} m={M.ral7035} />
      <group position={[-0.38, 1.45, -0.04]}>
        <CZ rt={0.17} h={0.015} p={[0, 0, 0.05]} m={M.ral3000} seg={32} />
        <CZ rt={0.17} h={0.015} p={[0, 0, -0.05]} m={M.ral3000} seg={32} />
        <CZ rt={0.08} h={0.1} m={M.steelDark} />
        {Array.from({ length: 4 }, (_, i) => <Tor key={i} R={0.1 + i * 0.012} rad={0.009} p={[0, 0, -0.035 + i * 0.022]} m={M.hoseBlack} ts={32} />)}
      </group>
      {/* side door with louvres (ventilated) */}
      <B s={[0.01, 0.8, 0.5]} p={[0.505, 0.6, 0]} m={M.ral7035} />
      {Array.from({ length: 6 }, (_, i) => <B key={i} s={[0.012, 0.02, 0.35]} p={[0.51, 0.35 + i * 0.08, 0]} m={M.ral7016} />)}
    </group>
  )
})

function ChargeCage() {
  return (
    <group>
      <B s={[0.5, 0.06, 0.5]} p={[0, 0.03, 0]} m={M.steelDark} />
      <B s={[0.36, 0.04, 0.36]} p={[0, 0.08, 0]} m={M.steel} />
      <group position={[0, 0.1, 0]}>
        <GasBottle body={M.cylRed} shoulder={M.cylRed} h={1.1} r={0.15} />
      </group>
      {[-1, 1].map((sx) => [-1, 1].map((sz) => <B key={`${sx}${sz}`} s={[0.03, 1.5, 0.03]} p={[sx * 0.25, 0.75, sz * 0.25]} m={M.ral1003} />))}
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a, i) => (
        <group key={i} rotation={[0, a, 0]}>
          {i !== 0 && <mesh geometry={planeGeo(0.48, 1.35)} material={M.guardMesh} position={[0, 0.8, 0.25]} />}
        </group>
      ))}
      <B s={[0.53, 0.03, 0.53]} p={[0, 1.5, 0]} m={M.ral1003} />
    </group>
  )
}

export function RefrigerantCharge({ t, working, robot }: KindProps) {
  const u = frac(t / 30)
  const vac = working ? (u < 0.4 ? 0.9 - u * 2 : 0.1 + smooth((u - 0.4) / 0.5) * 0.7) : 0.9
  return (
    <group>
      <group position={[-0.1, 0, -1.2]}>
        <ChargingMachine />
        <group position={[0.3, 1.25, 0.16]} rotation={[-0.55, 0, 0]}>
          <Gauge value={vac} r={0.05} />
        </group>
        <group position={[0.42, 1.25, 0.16]} rotation={[-0.55, 0, 0]}>
          <Gauge value={working ? 0.3 + 0.4 * smooth((u - 0.4) / 0.5) : 0.1} r={0.05} />
        </group>
      </group>
      <group position={[1.15, 0, -1.25]}>
        <ChargeCage />
      </group>
      <Hose pts={[[1.15, 1.35, -1.2], [0.95, 1.5, -1.25], [0.5, 1.4, -1.0]]} rad={0.007} m={M.hoseBlack} tub={20} />
      {/* charging hose: reel → rail → balancer → charge gun at the service valves */}
      {!robot && (
        <>
          <Hose pts={[[-0.48, 1.45, -1.18], [-0.4, 2.0, -0.9], [0.0, 2.45, -0.2], [0.4, 2.42, 0.2], [0.55, 2.2, 0.3], [0.58, 1.6, 0.32], [0.56, 1.33, 0.3]]} rad={0.011} m={M.hoseBlack} tub={64} radial={10} />
          <Balancer x={0.56} drop={0.8}>
            <group rotation={[0, 0, 0]}>
              <B s={[0.05, 0.14, 0.05]} rad={0.012} p={[0, -0.08, 0]} m={M.ral2004} />
              <B s={[0.04, 0.05, 0.12]} rad={0.01} p={[0, -0.16, 0.04]} m={M.plasticDark} />
              <C rt={0.014} h={0.08} p={[0, -0.2, 0.1]} r={[Math.PI / 2, 0, 0]} m={M.brass} seg={12} />
              <B s={[0.012, 0.05, 0.03]} p={[0, -0.12, -0.035]} m={M.plasticRed} />
            </group>
          </Balancer>
        </>
      )}
      {/* extraction hood and duct above the unit */}
      <group position={[0.2, 2.15, -0.25]}>
        <B s={[1.4, 0.04, 0.7]} p={[0, 0, 0]} m={M.galv} />
        <B s={[1.4, 0.18, 0.02]} p={[0, -0.1, 0.35]} m={M.galv} />
        <B s={[1.4, 0.18, 0.02]} p={[0, -0.1, -0.35]} m={M.galv} />
        <C rt={0.12} h={1.0} p={[0, 0.52, -0.1]} m={M.galv} seg={24} />
      </group>
      {[-0.45, 0.85].map((x) => <C key={x} rt={0.01} h={0.22} p={[x, 2.3, -0.25]} m={M.steel} seg={6} />)}
      {/* gas detector with ATEX beacon */}
      <group position={[-1.5, 0, -0.65]}>
        <C rt={0.025} h={1.5} p={[0, 0.75, 0]} m={M.alu} />
        <B s={[0.3, 0.02, 0.3]} p={[0, 0.01, 0]} m={M.ral7016} />
        <B s={[0.14, 0.18, 0.08]} rad={0.01} p={[0, 0.45, 0.05]} m={M.ral1003} />
        <C rt={0.02} h={0.05} p={[0, 0.34, 0.05]} m={M.steelDark} />
        <C rt={0.05} h={0.04} p={[0, 1.52, 0]} m={M.ral9005} />
        <C rt={0.04} h={0.1} p={[0, 1.59, 0]} m={lampMat('amber', false)} />
      </group>
      <HazardZone x0={-1.75} x1={1.75} z0={-1.95} z1={-0.5} />
    </group>
  )
}

/* -------------------------------------------------------- electrical_wiring */

const HarnessRack = memo(function HarnessRack() {
  return (
    <group>
      {[-0.6, 0.6].map((x) => (
        <group key={x}>
          <B s={[0.04, 1.85, 0.04]} p={[x, 0.925, 0]} m={M.ral7035} />
          <B s={[0.06, 0.02, 0.5]} p={[x, 0.01, 0]} m={M.ral7035} />
        </group>
      ))}
      <CX rt={0.012} h={1.3} p={[0, 1.8, 0]} m={M.steel} />
      {Array.from({ length: 8 }, (_, i) => {
        const x = -0.5 + i * 0.14
        const mats = [M.hoseBlack, M.hoseBlue, M.cableOrange, M.hoseGrey]
        return (
          <group key={i} position={[x, 1.8, 0]}>
            {mats.map((m, k) => (
              <Hose key={k} pts={[[0, 0, 0], [0.01 * k, -0.2, 0.03], [0.03, -0.55 - k * 0.03, 0.02 * k], [-0.02, -0.7 - k * 0.04, 0], [0, -0.75 - k * 0.05, -0.02]]} rad={0.004} m={m} tub={20} radial={5} />
            ))}
            <B s={[0.03, 0.02, 0.02]} p={[0, -0.78, -0.02]} m={M.plasticWhite} />
            <Tor R={0.015} rad={0.003} p={[0, 0.0, 0]} m={M.plasticDark} />
          </group>
        )
      })}
    </group>
  )
})

const PcbRack = memo(function PcbRack() {
  return (
    <group>
      <KitCart w={0.8} d={0.5}>
        {[0, 1].map((i) => (
          <group key={i} position={[(i - 0.5) * 0.38, 0, 0]}>
            <B s={[0.34, 0.012, 0.42]} p={[0, 0.006, 0]} m={M.plasticDark} />
            {[0, 1].map((k) => <group key={k} position={[0, 0.014, (k - 0.5) * 0.2]} scale={0.8}><PcbBoard w={0.2} d={0.14} seed={`r${i}${k}`} /></group>)}
          </group>
        ))}
      </KitCart>
      <group position={[0, 0.8625, 0]}>
        {[0, 1, 2].map((s) => (
          <group key={s} position={[0, s * 0.06, 0]}>
            <B s={[0.7, 0.012, 0.42]} p={[0, 0.006, 0]} m={M.plasticDark} />
            {[0, 1, 2].map((k) => <group key={k} position={[(k - 1) * 0.23, 0.013, 0]} scale={0.85}><PcbBoard w={0.2} d={0.14} seed={`t${s}${k}`} /></group>)}
          </group>
        ))}
      </group>
    </group>
  )
})

const CableReels = memo(function CableReels() {
  const mats = [M.hoseBlack, M.hoseBlue, M.cableOrange, M.hoseGreen]
  return (
    <group>
      <B s={[0.9, 0.04, 0.45]} p={[0, 0.02, 0]} m={M.ral7016} />
      {[-1, 1].map((s) => <B key={s} s={[0.04, 0.9, 0.04]} p={[s * 0.43, 0.45, 0]} m={M.ral7016} />)}
      {[0.35, 0.75].map((y) => <CX key={y} rt={0.012} h={0.9} p={[0, y, 0]} m={M.steel} />)}
      {mats.map((m, i) => {
        const x = -0.2 + (i % 2) * 0.4
        const y = i < 2 ? 0.35 : 0.75
        return (
          <group key={i} position={[x, y, 0]}>
            <CX rt={0.16} h={0.02} p={[-0.08, 0, 0]} m={M.plasticDark} seg={28} />
            <CX rt={0.16} h={0.02} p={[0.08, 0, 0]} m={M.plasticDark} seg={28} />
            <CX rt={0.13} h={0.14} m={m} seg={28} />
          </group>
        )
      })}
    </group>
  )
})

export function ElectricalWiring({ robot }: KindProps) {
  return (
    <group>
      <group position={[-0.5, 0, -1.4]}>
        <HarnessRack />
      </group>
      <group position={[1.15, 0, -1.25]}>
        <PcbRack />
      </group>
      <group position={[-1.45, 0, -0.75]} rotation={[0, Math.PI / 2, 0]}>
        <CableReels />
      </group>
      {!robot && (
        <group position={[0.35, 1.55, -0.75]}>
          <Monitor />
          <C rt={0.02} h={1.55} p={[0, -0.78, -0.2]} m={M.alu} />
          <B s={[0.3, 0.02, 0.3]} p={[0, -1.54, -0.2]} m={M.ral7016} />
        </group>
      )}
    </group>
  )
}

export const WiringBench = memo(function WiringBench() {
  return (
    <group>
      <group position={[-0.25, 0.0, 0.0]}><HarnessCoil R={0.1} seed="wb" /></group>
      <group position={[0.65, 0.0, -0.1]} rotation={[0, 0.5, 0]}>
        <B s={[0.05, 0.1, 0.14]} rad={0.015} p={[0, 0.05, 0]} m={M.plasticDark} />
        <B s={[0.04, 0.03, 0.12]} rad={0.008} p={[0, 0.11, 0.06]} r={[0.4, 0, 0]} m={M.plasticBlue} />
      </group>
      <B s={[0.25, 0.004, 0.18]} p={[0.25, 0.002, 0.1]} m={M.plasticWhite} />
    </group>
  )
})

/* ------------------------------------------------------------------- casing */

const FrontPanelRack = memo(function FrontPanelRack() {
  return (
    <group>
      <B s={[1.2, 0.05, 0.6]} p={[0, 0.06, 0]} m={M.ral5015} />
      {[-1, 1].map((s) => (
        <group key={s}>
          <B s={[0.04, 0.95, 0.04]} p={[s * 0.58, 0.5, -0.28]} m={M.ral5015} />
          <B s={[0.04, 0.95, 0.04]} p={[s * 0.58, 0.5, 0.28]} m={M.ral5015} />
          <CX rt={0.05} h={0.03} p={[s * 0.55, 0.05, 0.25]} m={M.rubber} />
          <CX rt={0.05} h={0.03} p={[s * 0.55, 0.05, -0.25]} m={M.rubber} />
        </group>
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <group key={i} position={[0, 0.48, -0.22 + i * 0.11]} rotation={[-0.08, 0, 0]}>
          <B s={[1.05, 0.72, 0.012]} rad={0.004} m={M.casing} />
          <group position={[-0.17, 0.0, 0.008]}>
            <FanGrille R={0.27} />
          </group>
        </group>
      ))}
      {Array.from({ length: 6 }, (_, i) => <B key={i} s={[1.16, 0.02, 0.012]} p={[0, 0.1, -0.27 + i * 0.11]} m={M.rubber} />)}
    </group>
  )
})

function VacuumLifter({ working, t }: { working: boolean; t: number }) {
  const y = working ? 1.55 + 0.15 * Math.sin(t * 0.7) : 1.75
  return (
    <group>
      {/* cable length changes every frame (new geometry), so it is drawn on its own */}
      <MergeSkip>
        <C rt={0.004} h={2.47 - y - 0.25} p={[0, (2.47 + y + 0.25) / 2 - 0.12, 0]} m={M.steel} seg={6} />
      </MergeSkip>
      <group position={[0, y, 0]}>
        <B s={[0.08, 0.2, 0.08]} rad={0.01} p={[0, 0.1, 0]} m={M.ral1003} />
        <B s={[0.7, 0.04, 0.04]} p={[0, 0, 0]} m={M.alu} />
        <B s={[0.04, 0.04, 0.5]} p={[0, 0, 0]} m={M.alu} />
        {[-1, 1].map((a) =>
          [-1, 1].map((b) => (
            <group key={`${a}${b}`} position={[a * 0.32, -0.04, b * 0.22]}>
              <C rt={0.008} h={0.05} m={M.steel} seg={8} />
              <C rt={0.012} rb={0.045} h={0.025} p={[0, -0.035, 0]} m={M.rubber} seg={18} />
            </group>
          )),
        )}
        <B s={[0.15, 0.04, 0.03]} rad={0.01} p={[0.36, 0.05, 0]} m={M.plasticDark} />
      </group>
    </group>
  )
}

export function Casing({ t, working, robot }: KindProps) {
  return (
    <group>
      <group position={[0.35, 0, -1.3]}>
        <FrontPanelRack />
      </group>
      <group position={[-1.25, 0, -1.25]} rotation={[0, Math.PI / 2, 0]}>
        <KitCart w={1.1} d={0.55} top={Array.from({ length: 5 }, (_, i) => (
          <group key={i} position={[0, 0.012 + i * 0.03, 0]}>
            <B s={[1.05, 0.022, 0.46]} rad={0.006} p={[0, 0.011, 0]} m={M.casing} />
          </group>
        ))}>
          {Array.from({ length: 4 }, (_, i) => (
            <group key={i} position={[0, 0.01 + i * 0.02, 0]}>
              <CasingPanel w={0.95} h={0.45} />
            </group>
          ))}
        </KitCart>
      </group>
      {!robot && (
        <group position={[-0.65, 0, 0.3]}>
          <Articulated>
            <VacuumLifter working={working} t={t} />
          </Articulated>
        </group>
      )}
    </group>
  )
}

