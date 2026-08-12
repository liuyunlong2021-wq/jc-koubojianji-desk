export interface PrototypeCue {
  cueId: string
  startMs: number
  endMs: number
  text: string
  removed: boolean
}

export function movePrototypeCue(cues: PrototypeCue[], cueId: string, direction: -1 | 1) {
  const next = cues.map((cue) => ({ ...cue }))
  const index = next.findIndex((cue) => cue.cueId === cueId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function togglePrototypeCue(cues: PrototypeCue[], cueId: string) {
  return cues.map((cue) => (cue.cueId === cueId ? { ...cue, removed: !cue.removed } : { ...cue }))
}
