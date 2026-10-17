import { useT } from './clock'
import { boxGeo, cylGeo, Edged, Person } from './prims'
import { T, ease, seg } from './theme'

const HALF_PI = Math.PI / 2
const MACHINES = 7

/** A spinning pulley on the overhead shaft, with spokes so the rotation reads. */
function Pulley({ x, y, r, a, opacity }: { x: number; y: number; r: number; a: number; opacity: number }) {
  return (
    <group position={[x, y, 0]} rotation={[a, 0, 0]}>
      <Edged geometry={cylGeo(r, 0.25, 16)} position={[-0.125, 0, 0]} rotation={[0, 0, -HALF_PI]} opacity={opacity} />
      <Edged geometry={boxGeo(0.06, r * 2, 0.06)} position={[0.14, -r, 0]} opacity={opacity} filled={false} />
    </group>
  )
}

/**
 * Beat 1: the steam-age line shaft. One engine drives every machine through an
 * overhead shaft and belts. The engine becomes an electric motor, the shafts stay,
 * and nothing gets faster. Illustrative, not data.
 */
export function Steam() {
  const t = useT()
  if (t > T.today[0] + 1) return null
  const out = ease(seg(t, T.steam[1] - 0.6, T.steam[1] + 0.6))
  const op = 1 - out
  const swap = ease(seg(t, 3.4, 4.6))
  const a = t * 3.2 // the same speed before and after the swap
  const shaftY = 4.4
  const x0 = 6
  const x1 = x0 + MACHINES * 3.6
  return (
    <group scale={[1, Math.max(0.001, 1 - out), 1]}>
      <Edged geometry={boxGeo(x1 - x0 + 14, 0.25, 9)} position={[(x0 + x1) / 2 - 3, -0.25, 0]} opacity={op} />
      {/* steam engine → electric motor, same shaft */}
      <group position={[x0 - 4.5, 0, 0]} scale={Math.max(0.001, 1 - swap)}>
        <Edged geometry={boxGeo(3, 2.2, 2.4)} opacity={op} />
        <Edged geometry={cylGeo(0.35, 5)} position={[-0.8, 2.2, -0.6]} opacity={op} />
        <Pulley x={1.7} y={1.6} r={1.4} a={a} opacity={op} />
      </group>
      <group position={[x0 - 3.6, 0, 0]} scale={Math.max(0.001, swap)}>
        <Edged geometry={boxGeo(1.3, 1.1, 1.1)} opacity={op} />
        <Edged geometry={cylGeo(0.42, 1.6, 16)} position={[0, 1.4, 0]} rotation={[0, 0, -HALF_PI]} opacity={op} />
      </group>
      {Array.from({ length: 12 }, (_, i) => {
        // Steam puffs: squares rising from the chimney while the engine runs.
        const p = (t * 0.7 + i / 12) % 1
        const s = 0.3 + p * 0.8
        return (
          <Edged
            key={i}
            geometry={boxGeo(s, s, s)}
            position={[x0 - 5.3 + Math.sin(i * 2.3) * p, 7.2 + p * 4, -0.6 + Math.cos(i) * p]}
            opacity={op * (1 - swap) * (1 - p)}
            filled={false}
          />
        )
      })}
      {/* the overhead line shaft with its hangers */}
      <Edged geometry={cylGeo(0.12, x1 - x0 + 4, 10)} position={[x1 + 1, shaftY, 0]} rotation={[0, 0, HALF_PI]} opacity={op} />
      <Edged geometry={boxGeo(0.08, 1.5, 0.08)} position={[x0 - 2.8, shaftY - 1.5 + 0.1, 0]} opacity={op} filled={false} />
      {Array.from({ length: MACHINES }, (_, i) => {
        const x = x0 + i * 3.6 + 1.2
        return (
          <group key={i}>
            <Edged geometry={boxGeo(0.08, 1.6, 0.08)} position={[x - 1.2, shaftY, 0]} opacity={op} filled={false} />
            <Pulley x={x} y={shaftY} r={0.55} a={a} opacity={op} />
            <Edged geometry={boxGeo(0.04, shaftY - 1.4, 0.04)} position={[x + 0.12, 1.4, 0.5]} opacity={op} filled={false} />
            <Edged geometry={boxGeo(0.04, shaftY - 1.4, 0.04)} position={[x + 0.12, 1.4, -0.5]} opacity={op} filled={false} />
            <Edged geometry={boxGeo(1.9, 1.2, 1.4)} position={[x, 0, 0]} opacity={op} />
            <Pulley x={x} y={1.4} r={0.3} a={a * 1.8} opacity={op} />
            <Person position={[x, 0, 1.6]} opacity={op} />
          </group>
        )
      })}
    </group>
  )
}
