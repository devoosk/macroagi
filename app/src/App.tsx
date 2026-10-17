import { useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { EventLog, Line } from './contracts/types'
import { loadEvents, loadLine } from './lib/data'
import { usePlayback } from './playback/store'
import { Factory } from './scene/Factory'

/** Advances simTime in demo mode. The store is the only clock. */
function Clock() {
  useFrame((_, dt) => {
    const s = usePlayback.getState()
    if (s.playing) s.setTime(s.simTime + dt * s.speed)
  })
  return null
}

export default function App() {
  const [data, setData] = useState<{ line: Line; log: EventLog }>()
  useEffect(() => {
    Promise.all([loadLine(), loadEvents()]).then(([line, log]) => {
      usePlayback.getState().load('current', line, log)
      usePlayback.getState().setPlaying(true)
      setData({ line, log })
    })
  }, [])
  if (!data) return null
  return (
    <Canvas shadows camera={{ position: [4, 8, 14], fov: 45 }}>
      <color attach="background" args={['#1a1d22']} />
      <hemisphereLight args={['#ffffff', '#444444', 0.8]} />
      <directionalLight position={[10, 15, 8]} intensity={1.5} castShadow />
      <Clock />
      <Factory line={data.line} log={data.log} />
      <OrbitControls target={[4, 0, 0]} />
    </Canvas>
  )
}
