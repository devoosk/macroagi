import { getIndex, type PlaybackIndex } from '../playback/index'
import { usePlayback, type DesignKey } from '../playback/store'
import type { EventLog, Line } from '../contracts/types'

export interface LoadedDesign {
  line: Line
  log: EventLog
  index: PlaybackIndex
}

/** Line, log and memoised index for a loaded design (undefined until `load` was called). */
export function useDesign(design: DesignKey = 'current'): LoadedDesign | undefined {
  const line = usePlayback((s) => s.lines[design])
  const log = usePlayback((s) => s.logs[design])
  if (!line || !log) return undefined
  return { line, log, index: getIndex(line, log) }
}

export const useSimTime = () => usePlayback((s) => s.simTime)
