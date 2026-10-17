import { useEffect, useState } from 'react'
import type { Line, Results } from '../contracts/types'
import { loadJson } from '../lib/data'

/** Shape of app/public/data/story.json (written by `uv run python -m story`). */
export interface StoryData {
  takt: number
  stations: {
    id: string
    kind: string
    x: number
    order: number
    load: number
    loadRatio: number
    blockedShare: number
    starvedShare: number
    bottleneck: boolean
  }[]
  sparks: { st: string; t: number; node: string; verb: string }[]
  graph: {
    nodes: { id: string; station: string; verb: string; meanTime: number; cv: number; n: number; gx: number; gy: number }[]
    edges: { from: string; to: string; type: 'hard' | 'soft'; nab: number; nba: number; redundant: boolean }[]
  }
  swarm: {
    evaluated: number
    points: { cost: number; rate: number; people: number; ok: boolean; why: string | null; near: number }[]
    current: { cost: number; rate: number; people: number }
    winners: { design: string; file: string; cost: number; rate: number; people: number }[]
  }
}

export interface RobotType {
  id: string
  name: string
  class: string
  payloadKg: number
  rentPerMonth: number
}

export interface Loaded {
  line: Line
  /** Wave one: the best "robot where a person stood" design. */
  waveOne: Line
  /** Gaia: the line rebuilt for robots (falls back to the swarm winner). */
  redesign: Line
  story: StoryData
  results: Results
  robots: RobotType[]
}

export function useStoryData(): Loaded | undefined {
  const [data, setData] = useState<Loaded>()
  useEffect(() => {
    ;(async () => {
      const [line, story, results, cap] = await Promise.all([
        loadJson<Line>('/data/line.json'),
        loadJson<StoryData>('/data/story.json'),
        loadJson<Results>('/data/results.json'),
        loadJson<{ robots: RobotType[] }>('/data/capability.json'),
      ])
      const waveOne = await loadJson<Line>('/data/line_solver_1.json')
      const redesign = await loadJson<Line>('/data/line_rebuild_1.json').catch(() => loadJson<Line>(`/data/${story.swarm.winners[0]?.file ?? 'line_solver_1.json'}`))
      setData({ line, waveOne, redesign, story, results, robots: cap.robots ?? [] })
    })()
  }, [])
  return data
}
