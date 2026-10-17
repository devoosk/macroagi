import type { EventLog, Line } from '../contracts/types'
import { selectStateAt, usePlayback } from '../playback/store'

/** Placeholder scene: integration point for environment, stations, units and workers. */
export function Factory({ line, log }: { line: Line; log: EventLog }) {
  const simTime = usePlayback((s) => s.simTime)
  const state = selectStateAt(line, log, simTime)
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[60, 30]} />
        <meshStandardMaterial color="#8a8d91" roughness={0.6} />
      </mesh>
      {line.stations.map((s) => (
        <mesh key={s.id} position={[s.x, 0.45, s.y]} rotation-y={s.rot} castShadow>
          <boxGeometry args={[2, 0.9, 1.2]} />
          <meshStandardMaterial color={state.stations[s.id] === 'working' ? '#3c8d5a' : '#5b6470'} />
        </mesh>
      ))}
    </group>
  )
}
