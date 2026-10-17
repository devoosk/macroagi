import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import type { BloomEffect } from 'postprocessing'
import { CameraRig } from './camera'
import { getT, useClock } from './clock'
import { useStoryData } from './data'
import { Feeds } from './Feeds'
import { Floor } from './Floor'
import { Focus } from './Focus'
import { Graph } from './Graph'
import { layoutGraph } from './layout'
import { Overlay } from './Overlay'
import { Steam } from './Steam'
import { Swarm } from './Swarm'
import { night, stageColor, DURATION } from './theme'
import { World } from './World'

const params = new URLSearchParams(window.location.search)
/** `?record=30` steps the clock by exactly 1/30 s per frame (for frame-perfect capture). */
const recordFps = Number(params.get('record') ?? 0)

function Ticker() {
  const advance = useClock((s) => s.advance)
  const { scene } = useThree()
  useFrame((_, dt) => {
    advance(recordFps ? 1 / recordFps : Math.min(dt, 0.1))
    const c = stageColor(getT())
    scene.background = c
  })
  return null
}

/** Glow only on the black stage, like the white squares on microagi.ai's dark sections. */
function Glow() {
  const ref = useRef<BloomEffect>(null)
  useFrame(() => {
    if (ref.current) ref.current.intensity = 1.6 * night(getT())
  })
  return (
    <EffectComposer multisampling={4}>
      <Bloom ref={ref as never} luminanceThreshold={0.9} luminanceSmoothing={0.2} mipmapBlur intensity={0} />
    </EffectComposer>
  )
}

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useClock.getState()
      if (e.key === ' ') {
        if (s.t >= DURATION) s.setT(0)
        s.setPlaying(!s.playing)
      } else if (e.key === 'ArrowRight') s.setT(s.t + 2)
      else if (e.key === 'ArrowLeft') s.setT(s.t - 2)
      else if (e.key === 'r') {
        s.setT(0)
        s.setPlaying(true)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** The 60-second Gaia story: hook, how, results, ending. Open /story.html. */
export function Story() {
  const data = useStoryData()
  useKeys()
  const nodes = useMemo(() => (data ? layoutGraph(data.story, data.line) : undefined), [data])
  const bottlenecks = useMemo(() => data?.story.stations.filter((s) => s.bottleneck).map((s) => s.id) ?? [], [data])
  if (!data || !nodes) return null
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas orthographic dpr={[1, 2]} gl={{ antialias: true }} camera={{ near: 1, far: 1000, position: [100, 100, 100] }} flat>
        <Ticker />
        <CameraRig />
        <Steam />
        <Floor line={data.line} waveOne={data.waveOne} redesign={data.redesign} bottlenecks={bottlenecks} />
        <Feeds line={data.line} />
        <Graph story={data.story} line={data.line} nodes={nodes} />
        <Focus story={data.story} line={data.line} />
        <Swarm story={data.story} />
        <World />
        <Glow />
      </Canvas>
      <Overlay data={data} />
    </div>
  )
}
