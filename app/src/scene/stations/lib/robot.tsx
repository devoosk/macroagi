import { memo, type ReactNode } from 'react'
import { Articulated } from '../../batch'
import { M } from './mats'
import { B, C, CX, CZ, Hose, Sph, frac, smooth, type V3 } from './prims'

/**
 * Procedural 6-axis industrial robot on a pedestal. Robot-local frame: +x forward, +y up.
 * Joint angles come from a deterministic pick/place loop solved with planar IK, so the
 * tool really reaches the pick and place points.
 */

const BASE_H = 0.6 // pedestal height
const J2_UP = 0.33 // shoulder above turret base
const J2_FWD = 0.15
const A = 0.68 // upper arm
const BL = 0.72 // forearm (J3 → J5)
const FLANGE = 0.1
const ROBOT = M.ral2004

export type RobotTool = 'gripper' | 'screwdriver' | 'torch' | 'vacuum'

export interface RobotPose {
  j: [number, number, number, number, number, number]
  grip: number // 0 open .. 1 closed
  carrying: boolean
}

/** Planar 2-link IK + yaw for a tool pointing straight down at target (robot-local, floor origin). */
export function solveIK(target: V3, toolLen: number): RobotPose['j'] {
  const [tx, ty, tz] = target
  const yaw = Math.atan2(-tz, tx)
  const r = Math.hypot(tx, tz)
  const wx = r - J2_FWD
  const wy = ty + toolLen + FLANGE - (BASE_H + 0.12 + J2_UP)
  let D = Math.hypot(wx, wy)
  D = Math.min(A + BL - 1e-3, Math.max(Math.abs(A - BL) + 1e-3, D))
  const cosD = (D * D - A * A - BL * BL) / (2 * A * BL)
  const delta = Math.acos(Math.max(-1, Math.min(1, cosD)))
  const a1 = Math.atan2(wy, wx) - Math.atan2(-BL * Math.sin(delta), A + BL * Math.cos(delta))
  const j2 = Math.PI / 2 - a1
  const phi = delta - a1
  const j3 = phi - j2
  const j5 = Math.PI / 2 - phi
  return [yaw, j2, j3, 0, j5, 0]
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Deterministic pick → place loop. `pick`/`place` in robot-local coordinates. */
export function robotPose(t: number, working: boolean, pick: V3, place: V3, period = 11, toolLen = 0.16, phase = 0): RobotPose {
  const up = (p: V3, h = 0.28): V3 => [p[0], p[1] + h, p[2]]
  if (!working) {
    const j = solveIK([0.75, 1.55, 0], toolLen)
    return { j, grip: 0, carrying: false }
  }
  const u = frac(t / period + phase)
  const keys: [number, V3][] = [
    [0.0, up(pick)],
    [0.12, pick],
    [0.18, pick],
    [0.3, up(pick)],
    [0.52, up(place)],
    [0.64, place],
    [0.7, place],
    [0.82, up(place)],
    [1.0, up(pick)],
  ]
  let p = keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [t0, a] = keys[i - 1]
      const [t1, b] = keys[i]
      p = lerp3(a, b, smooth((u - t0) / (t1 - t0)))
      break
    }
  }
  const j = solveIK(p, toolLen)
  // wrist roll and flange twist while travelling, for life-like motion
  j[3] = Math.sin(u * Math.PI * 2) * 0.15
  j[5] = smooth((u - 0.3) / 0.22) * 0.8 - smooth((u - 0.82) / 0.18) * 0.8
  const grip = u > 0.13 && u < 0.66 ? 1 : 0
  return { j, grip, carrying: u > 0.16 && u < 0.66 }
}

const Pedestal = memo(function Pedestal() {
  return (
    <group>
      <B s={[0.7, 0.025, 0.7]} p={[0, 0.0125, 0]} m={M.ral7016} />
      {[-1, 1].map((sx) => [-1, 1].map((sz) => <C key={`${sx}${sz}`} rt={0.014} h={0.03} p={[sx * 0.3, 0.035, sz * 0.3]} m={M.steel} seg={6} />))}
      <B s={[0.42, BASE_H - 0.07, 0.42]} rad={0.01} p={[0, 0.025 + (BASE_H - 0.07) / 2, 0]} m={M.ral7016} />
      {[-1, 1].map((s) => <B key={s} s={[0.02, BASE_H - 0.1, 0.2]} p={[s * 0.22, 0.3, 0]} m={M.ral7016} />)}
      <B s={[0.5, 0.045, 0.5]} p={[0, BASE_H - 0.0225, 0]} m={M.steelDark} />
      <B s={[0.12, 0.16, 0.012]} p={[0, 0.3, -0.216]} m={M.ral7035} />
      <Hose pts={[[0.0, 0.2, -0.23], [0.0, 0.05, -0.35], [0.0, 0.02, -0.6], [0.0, 0.02, -0.9]]} rad={0.022} m={M.hoseBlack} tub={20} radial={8} />
    </group>
  )
})

function Gripper({ grip }: { grip: number }) {
  const open = 0.075 - grip * 0.04
  return (
    <group>
      <CX rt={0.05} h={0.04} p={[0.02, 0, 0]} m={M.alu} />
      <B s={[0.06, 0.07, 0.16]} rad={0.006} p={[0.07, 0, 0]} m={M.alu} />
      {[-1, 1].map((s) => (
        <group key={s} position={[0.1, 0, s * open]}>
          <B s={[0.1, 0.05, 0.016]} p={[0.05, 0, 0]} m={M.steel} />
          <B s={[0.03, 0.05, 0.022]} p={[0.09, 0, -s * 0.006]} m={M.rubber} />
        </group>
      ))}
      <Hose pts={[[0.07, 0.035, 0.05], [0.0, 0.07, 0.06], [-0.15, 0.08, 0.05]]} rad={0.004} m={M.hoseBlue} tub={12} radial={6} />
    </group>
  )
}

function Screwdriver() {
  return (
    <group>
      <CX rt={0.05} h={0.03} p={[0.015, 0, 0]} m={M.alu} />
      <CX rt={0.032} h={0.16} p={[0.11, 0, 0]} m={M.ral5015} seg={20} />
      <CX rt={0.02} h={0.04} p={[0.21, 0, 0]} m={M.steelDark} />
      <CX rt={0.005} h={0.05} p={[0.255, 0, 0]} m={M.chrome} seg={8} />
      <B s={[0.06, 0.04, 0.03]} p={[0.06, 0.05, 0]} m={M.ral7016} />
      <Hose pts={[[0.03, 0.04, 0.0], [0.0, 0.1, 0.0], [-0.2, 0.1, 0.02]]} rad={0.012} m={M.hoseBlue} tub={14} radial={6} />
    </group>
  )
}

function Vacuum() {
  return (
    <group>
      <CX rt={0.05} h={0.03} p={[0.015, 0, 0]} m={M.alu} />
      <B s={[0.04, 0.3, 0.3]} rad={0.006} p={[0.06, 0, 0]} m={M.alu} />
      {[-1, 1].map((a) =>
        [-1, 1].map((b) => (
          <group key={`${a}${b}`} position={[0.1, a * 0.11, b * 0.11]}>
            <CX rt={0.008} h={0.05} m={M.steel} seg={8} />
            <CX rt={0.01} rb={0.03} h={0.025} p={[0.035, 0, 0]} m={M.rubber} seg={18} />
          </group>
        )),
      )}
    </group>
  )
}

/** Generic robot arm. `carry` is rendered in the gripper while carrying. Origin = floor under pedestal. */
export function RobotArm({ pose, tool = 'gripper', carry }: { pose: RobotPose; tool?: RobotTool; carry?: ReactNode }) {
  const [j1, j2, j3, j4, j5, j6] = pose.j
  return (
    <group>
      <Pedestal />
      <group position={[0, BASE_H, 0]}>
        {/* fixed base */}
        <C rt={0.2} rb={0.22} h={0.12} p={[0, 0.06, 0]} m={ROBOT} seg={32} />
        <C rt={0.12} h={0.04} p={[-0.14, 0.08, 0]} m={M.ral7016} seg={20} />
        {/* J1 turret */}
        <group position={[0, 0.12, 0]} rotation={[0, j1, 0]}>
          <C rt={0.18} h={0.06} p={[0, 0.03, 0]} m={M.ral7016} seg={32} />
          <B s={[0.36, 0.26, 0.32]} rad={0.07} p={[0.04, 0.2, 0]} m={ROBOT} />
          <CZ rt={0.07} h={0.12} p={[J2_FWD, J2_UP, -0.21]} m={M.ral7016} seg={24} />
          <CZ rt={0.055} h={0.04} p={[J2_FWD, J2_UP, -0.29]} m={M.steelDark} seg={20} />
          <CX rt={0.06} h={0.14} p={[-0.17, 0.2, 0]} m={M.ral7016} seg={20} />
          {/* J2 shoulder */}
          <group position={[J2_FWD, J2_UP, 0]} rotation={[0, 0, -j2]}>
            <CZ rt={0.13} h={0.3} m={ROBOT} seg={32} />
            <B s={[0.15, A, 0.17]} rad={0.05} p={[0, A / 2, 0]} m={ROBOT} />
            <B s={[0.11, A * 0.7, 0.19]} rad={0.04} p={[-0.02, A * 0.5, 0]} m={ROBOT} />
            <Hose pts={[[-0.1, 0.0, 0.16], [-0.12, A * 0.4, 0.15], [-0.1, A * 0.9, 0.14]]} rad={0.02} m={M.hoseBlack} tub={16} radial={8} />
            {/* J3 elbow */}
            <group position={[0, A, 0]} rotation={[0, 0, -j3]}>
              <CZ rt={0.11} h={0.26} m={ROBOT} seg={28} />
              <CZ rt={0.07} h={0.04} p={[0, 0, 0.15]} m={M.ral7016} seg={20} />
              <B s={[0.26, 0.16, 0.18]} rad={0.05} p={[-0.13, 0.02, 0]} m={ROBOT} />
              <CX rt={0.05} h={0.12} p={[-0.3, 0.02, 0]} m={M.ral7016} seg={20} />
              <CX rt={0.075} rb={0.06} h={BL * 0.55} p={[BL * 0.275, 0, 0]} m={ROBOT} seg={24} />
              {/* J4 forearm roll */}
              <group position={[BL * 0.55, 0, 0]} rotation={[j4, 0, 0]}>
                <CX rt={0.055} h={BL * 0.32} p={[BL * 0.16, 0, 0]} m={ROBOT} seg={24} />
                {/* J5 wrist */}
                <group position={[BL * 0.45, 0, 0]} rotation={[0, 0, -j5]}>
                  {[-1, 1].map((s) => <B key={s} s={[0.11, 0.1, 0.02]} rad={0.008} p={[0.0, 0, s * 0.055]} m={ROBOT} />)}
                  <CZ rt={0.045} h={0.13} m={M.ral7016} seg={20} />
                  {/* J6 flange */}
                  <group position={[0.06, 0, 0]} rotation={[j6, 0, 0]}>
                    <CX rt={0.04} h={0.04} p={[0.02, 0, 0]} m={ROBOT} seg={20} />
                    <CX rt={0.036} h={0.008} p={[0.044, 0, 0]} m={M.steel} seg={20} />
                    <group position={[0.048, 0, 0]}>
                      {tool === 'gripper' && <Gripper grip={pose.grip} />}
                      {tool === 'screwdriver' && <Screwdriver />}
                      {tool === 'vacuum' && <Vacuum />}
                      {tool === 'torch' && (
                        <group>
                          <CX rt={0.04} h={0.04} p={[0.02, 0, 0]} m={M.alu} />
                          <CX rt={0.012} h={0.16} p={[0.12, 0, 0]} m={M.brass} />
                          <Sph rad={0.014} p={[0.2, 0, 0]} m={M.copper} />
                        </group>
                      )}
                      {/* always mounted (shown while carrying) so the arm's batch does not rebuild every pick */}
                      {carry && (
                        <group position={[0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]} visible={pose.carrying}>
                          <Articulated>{carry}</Articulated>
                        </group>
                      )}
                    </group>
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}
