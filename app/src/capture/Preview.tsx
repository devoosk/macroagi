/**
 * Stand-alone capture test bench (preview-capture.html) until the full scene is
 * integrated. Minimal procedural scene, deterministic in simTime, no text/HUD/state colours.
 * Open: /preview-capture.html?mode=capture&cam=cctv:S02
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Color, type Group } from 'three'
import type { EventLog, Line, Station } from '../contracts/types'
import { registerAnchor } from '../lib/anchors'
import { captureCam } from '../lib/mode'
import { loadEvents, loadLine } from '../lib/data'
import { hash01 } from '../lib/rng'
import { selectStateAt, usePlayback } from '../playback/store'
import { CAMERA_IDS, captureLighting } from './cameras'
import { CaptureRoot } from './CaptureRig'

function Lights({ camId }: { camId: string }) {
  const t = usePlayback((s) => s.simTime)
  const L = captureLighting(t, camId)
  const c = (base: [number, number, number]) => new Color(base[0] * L.color[0], base[1] * L.color[1], base[2] * L.color[2])
  return (
    <>
      <hemisphereLight args={[c([1, 1, 1]), '#3a3d42', 0.9 * L.intensity]} />
      <directionalLight position={[6, 12, 6]} intensity={1.6 * L.intensity} color={c([1, 0.97, 0.92])} castShadow shadow-mapSize={[1024, 1024]}>
        <orthographicCamera attach="shadow-camera" args={[-14, 14, 8, -8, 0.5, 40]} />
      </directionalLight>
    </>
  )
}

function Worker({ st, phase, busy }: { st: Station; phase: number; busy: boolean }) {
  const t = usePlayback((s) => s.simTime)
  const head = useRef<Group>(null)
  useLayoutEffect(() => {
    registerAnchor(`head:${st.id}`, head.current)
    return () => registerAnchor(`head:${st.id}`, null)
  }, [st.id])
  const sway = Math.sin(t * 0.9 + hash01('sway', st.id) * 6.28) * 0.04
  const reach = busy ? 0.25 + 0.15 * Math.sin(phase * Math.PI * 6) : 0.05
  return (
    <group position={[0, 0, 0.95]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.32, 1.0, 0.22]} />
        <meshStandardMaterial color="#2f4a6b" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.42, 0.55, 0.26]} />
        <meshStandardMaterial color="#c86b22" roughness={0.7} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.18, 1.12, -reach]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.5 + reach, 8]} />
          <meshStandardMaterial color="#d8b49a" roughness={0.6} />
        </mesh>
      ))}
      {/* Head anchor: eye point, -z is view direction. */}
      <group ref={head} position={[sway, 1.65, 0]} rotation={[0, sway * 1.5, 0]}>
        <mesh castShadow position={[0, -0.02, 0.06]}>
          <sphereGeometry args={[0.11, 16, 12]} />
          <meshStandardMaterial color="#d8b49a" roughness={0.6} />
        </mesh>
      </group>
    </group>
  )
}

function StationBox({ st, busy, phase }: { st: Station; busy: boolean; phase: number }) {
  const ref = useRef<Group>(null)
  useLayoutEffect(() => {
    registerAnchor(`station:${st.id}`, ref.current)
    return () => registerAnchor(`station:${st.id}`, null)
  }, [st.id])
  return (
    <group ref={ref} position={[st.x, 0, st.y]} rotation-y={st.rot}>
      <mesh position={[0, 0.82, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.06, 0.9]} />
        <meshStandardMaterial color="#9aa1a8" metalness={0.6} roughness={0.35} />
      </mesh>
      {[-0.8, 0.8].flatMap((x) => [-0.38, 0.38].map((z) => (
        <mesh key={`${x}${z}`} position={[x, 0.4, z]} castShadow>
          <boxGeometry args={[0.05, 0.8, 0.05]} />
          <meshStandardMaterial color="#4b5057" metalness={0.5} roughness={0.5} />
        </mesh>
      )))}
      <mesh position={[0.65, 0.92, -0.25]} castShadow>
        <boxGeometry args={[0.35, 0.14, 0.25]} />
        <meshStandardMaterial color="#2c6fb5" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.6, -0.55]} castShadow>
        <boxGeometry args={[1.8, 1.4, 0.04]} />
        <meshStandardMaterial color="#6d747c" metalness={0.3} roughness={0.6} />
      </mesh>
      <Worker st={st} busy={busy} phase={phase} />
    </group>
  )
}

function Scene({ line, log }: { line: Line; log: EventLog }) {
  const t = usePlayback((s) => s.simTime)
  const state = selectStateAt(line, log, t)
  const byId = new Map(line.stations.map((s) => [s.id, s]))
  const kw = new Map(line.variants.map((v) => [v.id, v.kw]))
  return (
    <group>
      <color attach="background" args={['#2a2d31']} />
      <mesh rotation-x={-Math.PI / 2} position={[4, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 24]} />
        <meshStandardMaterial color="#7d8186" roughness={0.75} />
      </mesh>
      <mesh position={[4, 2.5, -4]} receiveShadow>
        <boxGeometry args={[40, 5, 0.2]} />
        <meshStandardMaterial color="#b9bcc0" roughness={0.9} />
      </mesh>
      {line.stations.map((s) => (
        <StationBox key={s.id} st={s} busy={!!state.workers[s.id]?.operation} phase={state.workers[s.id]?.phase ?? 0} />
      ))}
      {state.units.map((u) => {
        const st = byId.get(u.station)
        if (!st) return null
        const sc = 0.7 + 0.03 * (kw.get(u.variant) ?? 9)
        const yaw = hash01('unit-yaw', u.unit) * 0.2 - 0.1
        return (
          <group key={u.unit} position={[st.x, 0.85, st.y]} rotation-y={st.rot + yaw}>
            <mesh position={[0, 0.3 * sc, 0]} castShadow>
              <boxGeometry args={[0.9 * sc, 0.6 * sc, 0.4 * sc]} />
              <meshStandardMaterial color="#e6e7e4" roughness={0.45} metalness={0.2} />
            </mesh>
            <mesh position={[0.15 * sc, 0.32 * sc, 0.205 * sc]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.2 * sc, 0.2 * sc, 0.01, 24]} />
              <meshStandardMaterial color="#222" roughness={0.8} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export default function Preview() {
  const [data, setData] = useState<{ line: Line; log: EventLog }>()
  useEffect(() => {
    Promise.all([loadLine(), loadEvents()]).then(([line, log]) => {
      usePlayback.getState().load('current', line, log)
      usePlayback.getState().setPlaying(false)
      usePlayback.getState().setTime(0)
      setData({ line, log })
    })
  }, [])
  if (!data) return null
  const camId = captureCam ?? CAMERA_IDS(data.line)[0]
  return (
    <CaptureRoot line={data.line} cam={camId}>
      <Lights camId={camId} />
      <Scene line={data.line} log={data.log} />
    </CaptureRoot>
  )
}
