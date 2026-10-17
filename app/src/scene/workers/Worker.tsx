import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ToolKind } from '../../contracts/types'
import { registerAnchor } from '../../lib/anchors'
import { Articulated, MergeSkip } from '../batch'
import { hash01 } from '../../lib/rng'
import { Abdomen, Chest, Foot, Hand, Head, LowerArm, LowerLeg, NeckMesh, Pelvis, UpperArm, UpperLeg, bodyMats, M, type BodyMats } from './body'
import { box, mat } from './geo'
import { workerLook, type WorkerLook } from './look'
import { poseWorker, TOOL_GEOM, type HeldItem, type PartKind, type Pose, type WorkerVerb } from './pose'
import { RIG, palmSide, type Side, type V3 } from './rig'
import { Hose, InspectHoseTool, PartModel, ToolModel } from './tools'

export interface WorkerProps {
  stationId: string
  lookSeed: string
  verb: WorkerVerb
  /** 0..1 progress through the current operation. */
  phase: number
  /** Simulation time (s) from the playback store. Drives jitter and flicker only. */
  simTime: number
  tool: ToolKind
  /** Unit/cycle counter for per-cycle variation. */
  cycle: number
  quality: 'demo' | 'capture'
  /** Operation duration in seconds (pacing for walk/search). Optional. */
  duration?: number
}

const GRIP_ROT: V3 = [-Math.PI / 2, 0, 0]
const gripPos = (side: Side): V3 => [RIG.grip[0] * palmSide(side), RIG.grip[1], RIG.grip[2]]

function decompose(m: number[]): { p: V3; q: [number, number, number, number] } {
  const M4 = new THREE.Matrix4().fromArray(m)
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  M4.decompose(p, q, s)
  return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] }
}
function xform(m: number[], v: V3): V3 {
  const r = new THREE.Vector3(...v).applyMatrix4(new THREE.Matrix4().fromArray(m))
  return [r.x, r.y, r.z]
}
function xdir(m: number[], v: V3): V3 {
  const r = new THREE.Vector3(...v).transformDirection(new THREE.Matrix4().fromArray(m))
  return [r.x, r.y, r.z]
}

function Held({ item, side, pose, seg, flicker }: { item: HeldItem; side: Side; pose: Pose; seg: number; flicker: number }) {
  if (!item) return null
  return (
    <group position={gripPos(side)} rotation={GRIP_ROT}>
      {item === 'tool' ? (
        pose.verb === 'inspect' && pose.tool === 'hose' ? (
          <InspectHoseTool seg={seg} />
        ) : (
          <ToolModel kind={pose.tool} fx={pose.fx} flicker={flicker} seg={seg} />
        )
      ) : (
        <PartModel kind={item as PartKind} side={side} seg={seg} />
      )}
    </group>
  )
}

function Arm({ side, pose, look, m, seg, flicker, lite }: { side: Side; pose: Pose; look: WorkerLook; m: BodyMats; seg: number; flicker: number; lite: boolean }) {
  const j = pose.joints
  const R = side === 1
  return (
    <group position={[side * RIG.shoulder[0], RIG.shoulder[1], RIG.shoulder[2]]} quaternion={R ? j.shoulderR : j.shoulderL}>
      <group position={[side * RIG.upperArm[0], 0, 0]} quaternion={R ? j.upperArmR : j.upperArmL}>
        <UpperArm l={look} m={m} seg={seg} />
        <group position={[0, -RIG.upperArmLen, 0]} quaternion={R ? j.lowerArmR : j.lowerArmL}>
          <LowerArm l={look} m={m} seg={seg} />
          <group position={[0, -RIG.lowerArmLen, 0]} quaternion={R ? j.handR : j.handL}>
            <Hand side={side} curls={R ? pose.fingers.R : pose.fingers.L} m={m} seg={seg} lite={lite} />
            {/* tools swap in and out of the hand: keep them out of the body batch */}
            <MergeSkip>
              <Held item={R ? pose.held.R : pose.held.L} side={side} pose={pose} seg={seg} flicker={flicker} />
            </MergeSkip>
          </group>
        </group>
      </group>
    </group>
  )
}

function Leg({ side, pose, look, m, seg }: { side: Side; pose: Pose; look: WorkerLook; m: BodyMats; seg: number }) {
  const j = pose.joints
  const R = side === 1
  return (
    <group position={[side * RIG.upperLeg[0], RIG.upperLeg[1], RIG.upperLeg[2]]} quaternion={R ? j.upperLegR : j.upperLegL}>
      <UpperLeg l={look} m={m} side={side} seg={seg} />
      <group position={[0, -RIG.upperLegLen, 0]} quaternion={R ? j.lowerLegR : j.lowerLegL}>
        <LowerLeg l={look} m={m} seg={seg} />
        <group position={[0, -RIG.lowerLegLen, 0]} quaternion={R ? j.footR : j.footL}>
          <Foot m={m} seg={seg} />
        </group>
      </group>
    </group>
  )
}

/** Hose runs and floor-standing supply units for tools on a hose. */
function ToolHoses({ pose, quality }: { pose: Pose; quality: 'demo' | 'capture' }) {
  const g = pose.held.R === 'tool' ? pose.grip.R : pose.held.L === 'tool' ? pose.grip.L : null
  if (!g) return null
  if (pose.tool === 'torch') {
    const from = xform(g, TOOL_GEOM.hoseOut)
    return (
      <group>
        <Hose from={from} to={[0.95, 0.02, 0.45]} dir={xdir(g, [0, -1, 0])} color="#1f2a20" radius={0.007} quality={quality} />
        <Hose from={xform(g, [0.006, -0.1, 0.012])} to={[0.97, 0.02, 0.42]} dir={xdir(g, [0, -1, 0])} color="#7a1c17" radius={0.006} quality={quality} />
        <GasCart />
      </group>
    )
  }
  if (pose.tool === 'hose' && pose.verb === 'inspect') {
    return (
      <group>
        <Hose from={xform(g, [0, -0.085, 0])} to={[-0.55, 0.12, 0.25]} dir={xdir(g, [0, -1, 0])} color="#2a2f35" radius={0.005} quality={quality} />
        <group position={[-0.55, 0.0, 0.3]}>
          <M g={box(0.22, 0.16, 0.12)} m={mat('#e2b91f', { roughness: 0.45 })} p={[0, 0.08, 0]} />
          <M g={box(0.16, 0.06, 0.005)} m={mat('#141414', { roughness: 0.2 })} p={[0, 0.1, -0.061]} />
          <M g={box(0.2, 0.02, 0.03)} m={mat('#1d1d1d')} p={[0, 0.17, 0]} />
        </group>
      </group>
    )
  }
  if (pose.tool === 'hose') {
    return <Hose from={xform(g, [0, 0, 0.055])} to={[0.95, 0.02, 0.2]} dir={xdir(g, [0, 0, 1])} color="#2d3f8a" radius={0.008} quality={quality} />
  }
  return null
}

function GasCart() {
  return (
    <group position={[1.05, 0, 0.55]}>
      <M g={box(0.36, 0.04, 0.24)} m={mat('#3a3f45', { roughness: 0.6 })} p={[0, 0.06, 0]} />
      <mesh position={[-0.08, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.9, 20]} />
        <meshStandardMaterial color="#2f6b3a" roughness={0.5} />
      </mesh>
      <mesh position={[0.09, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.7, 20]} />
        <meshStandardMaterial color="#8e1f1a" roughness={0.5} />
      </mesh>
      <M g={box(0.03, 0.9, 0.03)} m={mat('#3a3f45')} p={[0, 0.45, 0.11]} />
    </group>
  )
}

function Placed({ pose, seg }: { pose: Pose; seg: number }) {
  return (
    <>
      {pose.placed.map((pp, i) => {
        const { p, q } = decompose(pp.matrix)
        return (
          <group key={i} position={p} quaternion={q}>
            <PartModel kind={pp.kind} side={pp.side} seg={seg} />
          </group>
        )
      })}
    </>
  )
}

/**
 * Procedural rigged worker in station-local space (stands at the origin facing -z).
 * Registers the eye point as anchor `head:<stationId>` for the first-person camera.
 */
export function Worker({ stationId, lookSeed, verb, phase, simTime, tool, cycle, quality, duration }: WorkerProps) {
  const look = useMemo(() => workerLook(lookSeed), [lookSeed])
  const m = useMemo(() => bodyMats(look), [look])
  const pose = useMemo(() => poseWorker(verb, phase, { seed: lookSeed, cycle, simTime, tool, duration }), [verb, phase, lookSeed, cycle, simTime, tool, duration])
  const seg = quality === 'capture' ? 24 : 14
  const eyeRef = useRef<THREE.Object3D>(null)
  useEffect(() => {
    const key = 'head:' + stationId
    registerAnchor(key, eyeRef.current)
    return () => registerAnchor(key, null)
  }, [stationId])
  const k = useMemo(() => hash01('flicker', lookSeed) * 100, [lookSeed])
  const flicker = 0.82 + 0.1 * Math.sin(simTime * 31 + k) + 0.08 * Math.sin(simTime * 57 + k * 3)
  const j = pose.joints
  return (
    <group>
      {/* Body: one skinned draw per material, bones are the rig groups (see scene/batch). */}
      <Articulated>
        <group position={[pose.root.x, 0, pose.root.z]} rotation={[0, pose.root.yaw, 0]}>
          <group scale={pose.scale}>
            <group position={pose.hips} quaternion={j.hips}>
              <Pelvis l={look} m={m} seg={seg} />
              <Leg side={1} pose={pose} look={look} m={m} seg={seg} />
              <Leg side={-1} pose={pose} look={look} m={m} seg={seg} />
              <group position={RIG.spine} quaternion={j.spine}>
                <Abdomen l={look} m={m} seg={seg} />
                <group position={RIG.chest} quaternion={j.chest}>
                  <Chest l={look} m={m} seg={seg} />
                  <group position={RIG.neck} quaternion={j.neck}>
                    <NeckMesh m={m} seg={seg} />
                    <group position={RIG.head} quaternion={j.head}>
                      <Head l={look} m={m} seg={seg} lite={quality === 'demo'} />
                      <object3D ref={eyeRef} position={RIG.eye} />
                    </group>
                  </group>
                  <Arm side={1} pose={pose} look={look} m={m} seg={seg} flicker={flicker} lite={quality === 'demo'} />
                  <Arm side={-1} pose={pose} look={look} m={m} seg={seg} flicker={flicker} lite={quality === 'demo'} />
                </group>
              </group>
            </group>
          </group>
        </group>
      </Articulated>
      <ToolHoses pose={pose} quality={quality} />
      <Placed pose={pose} seg={seg} />
    </group>
  )
}
