import type { StationState } from '../../../playback/store'

export type Quality = 'demo' | 'capture'

/** Props every station-kind machine receives. All animation is a pure function of these. */
export interface KindProps {
  t: number
  state: StationState
  working: boolean
  robot: boolean
  quality: Quality
  seed: string
}
