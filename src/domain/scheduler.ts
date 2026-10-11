import {
  Category,
  Match,
  PlanDiff,
  Round,
  Session,
  Team,
  TeamStats,
  TOTAL_ROUNDS,
} from './types'

export const ALGORITHM_VERSION = '公平性優先 v1'

interface WorkingTeam {
  scheduled: number
  completed: number
  opponents: Map<string, number>
  lastPlayedRound: number
}

type WorkingState = Map<string, WorkingTeam>

const categoryLabel = (category: Category) => (category === 'advanced' ? 'アドバンス' : 'ビギナー')

export function categoryLabelJa(category: Category): string {
  return categoryLabel(category)
}

export function numberToLetters(index: number): string {
  let value = index + 1
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

export function createTeams(advancedCount: number, beginnerCount: number, joinedRound = 1): Team[] {
  const advanced = Array.from({ length: advancedCount }, (_, index) => ({
    id: `advanced-${index + 1}`,
    category: 'advanced' as const,
    displayName: String(index + 1),
    joinedRound,
    active: true,
  }))
  const beginner = Array.from({ length: beginnerCount }, (_, index) => ({
    id: `beginner-${indexToStableId(index)}`,
    category: 'beginner' as const,
    displayName: numberToLetters(index),
    joinedRound,
    active: true,
  }))
  return [...advanced, ...beginner]
}

function indexToStableId(index: number): string {
  return numberToLetters(index).toLowerCase()
}

function cloneState(state: WorkingState): WorkingState {
  return new Map([...state.entries()].map(([id, value]) => [id, {
    scheduled: value.scheduled,
    completed: value.completed,
    opponents: new Map(value.opponents),
    lastPlayedRound: value.lastPlayedRound,
  }]))
}

function createWorkingState(teams: Team[]): WorkingState {
  return new Map(teams.map((team) => [team.id, {
    scheduled: 0,
    completed: 0,
    opponents: new Map<string, number>(),
    lastPlayedRound: 0,
  }]))
}

function applyMatch(state: WorkingState, match: Match): void {
  const a = state.get(match.teamAId)
  const b = state.get(match.teamBId)
  if (!a || !b) return
  a.scheduled += 1
  b.scheduled += 1
  if (match.status === 'completed') {
    a.completed += 1
    b.completed += 1
  }
  a.opponents.set(match.teamBId, (a.opponents.get(match.teamBId) ?? 0) + 1)
  b.opponents.set(match.teamAId, (b.opponents.get(match.teamAId) ?? 0) + 1)
  a.lastPlayedRound = match.roundIndex
  b.lastPlayedRound = match.roundIndex
}

function seededNoise(seed: string, roundIndex: number, a: string, b: string): number {
  const value = `${seed}:${roundIndex}:${a}:${b}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

function openingPairPreference(roundIndex: number, teamA: Team, teamB: Team): number {
  if (roundIndex !== 1) return 0
  const preferredPair = teamA.category === 'advanced'
    ? new Set(['1', '2'])
    : new Set(['A', 'B'])
  const isPreferredPair = preferredPair.has(teamA.displayName) && preferredPair.has(teamB.displayName)
  return isPreferredPair ? -1000 : 0
}

function pairScore(
  state: WorkingState,
  roundIndex: number,
  teamA: Team,
  teamB: Team,
  seed: string,
): number {
  const a = state.get(teamA.id)!
  const b = state.get(teamB.id)!
  const repeatCount = (a.opponents.get(teamB.id) ?? 0) + (b.opponents.get(teamA.id) ?? 0)
  const consecutivePenalty = (a.lastPlayedRound === roundIndex - 1 ? 12 : 0) + (b.lastPlayedRound === roundIndex - 1 ? 12 : 0)
  const loadPenalty = (a.scheduled + b.scheduled) * 7
  const imbalancePenalty = Math.abs(a.scheduled - b.scheduled) * 2
  const openingPreference = openingPairPreference(roundIndex, teamA, teamB)
  return openingPreference + repeatCount * 80 + consecutivePenalty + loadPenalty + imbalancePenalty + seededNoise(seed, roundIndex, teamA.id, teamB.id)
}

function choosePair(
  state: WorkingState,
  teams: Team[],
  category: Category,
  roundIndex: number,
  usedIds: Set<string>,
  seed: string,
): { match: Match | null; score: number } {
  const eligible = teams.filter((team) => team.active && team.category === category && team.joinedRound <= roundIndex && !usedIds.has(team.id))
  let best: { teamA: Team; teamB: Team; score: number } | null = null
  for (let aIndex = 0; aIndex < eligible.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < eligible.length; bIndex += 1) {
      const teamA = eligible[aIndex]
      const teamB = eligible[bIndex]
      const score = pairScore(state, roundIndex, teamA, teamB, seed)
      if (!best || score < best.score) best = { teamA, teamB, score }
    }
  }
  if (!best) return { match: null, score: 0 }
  return {
    score: best.score,
    match: {
      id: `round-${roundIndex}-court-pending-${best.teamA.id}-${best.teamB.id}`,
      roundIndex,
      court: 1,
      category,
      teamAId: best.teamA.id,
      teamBId: best.teamB.id,
      status: 'scheduled',
    },
  }
}

function fairnessScore(state: WorkingState, teams: Team[], roundIndex: number): number {
  const eligible = teams.filter((team) => team.active && team.joinedRound <= roundIndex)
  if (eligible.length === 0) return 0
  const mean = eligible.reduce((sum, team) => sum + state.get(team.id)!.scheduled, 0) / eligible.length
  return eligible.reduce((sum, team) => {
    const value = state.get(team.id)!
    const restPenalty = value.lastPlayedRound === roundIndex ? 0 : 0.15
    return sum + Math.pow(value.scheduled - mean, 2) + restPenalty
  }, 0)
}

function generateRoundCandidate(
  state: WorkingState,
  teams: Team[],
  roundIndex: number,
  court2Category: Category | null,
  seed: string,
): { matches: Match[]; nextState: WorkingState; score: number } {
  const nextState = cloneState(state)
  const usedIds = new Set<string>()
  const matches: Match[] = []
  let score = 0

  const addMatch = (court: 1 | 2 | 3, category: Category): void => {
    const result = choosePair(nextState, teams, category, roundIndex, usedIds, seed)
    if (!result.match) return
    const match = { ...result.match, id: `round-${roundIndex}-court-${court}`, court }
    matches.push(match)
    usedIds.add(match.teamAId)
    usedIds.add(match.teamBId)
    applyMatch(nextState, match)
    score += result.score
  }

  addMatch(1, 'advanced')
  addMatch(3, 'beginner')
  if (court2Category) addMatch(2, court2Category)

  return {
    matches: matches.sort((a, b) => a.court - b.court),
    nextState,
    score: score + fairnessScore(nextState, teams, roundIndex),
  }
}

function generateFutureRounds(
  teams: Team[],
  baseRounds: Round[],
  seed: string,
  startRound: number,
): Round[] {
  const state = createWorkingState(teams)
  for (const round of baseRounds.filter((round) => round.index < startRound)) {
    for (const match of round.matches) applyMatch(state, match)
  }

  const rounds = [...baseRounds]
  for (let roundIndex = startRound; roundIndex <= TOTAL_ROUNDS; roundIndex += 1) {
    const advanced = generateRoundCandidate(state, teams, roundIndex, 'advanced', seed)
    const beginner = generateRoundCandidate(state, teams, roundIndex, 'beginner', seed)
    const candidate = advanced.score <= beginner.score ? advanced : beginner
    rounds[roundIndex - 1] = {
      index: roundIndex,
      status: 'planned',
      matches: candidate.matches,
    }
    state.clear()
    for (const [id, value] of candidate.nextState.entries()) state.set(id, value)
  }
  return rounds
}

export function createInitialSession(advancedCount: number, beginnerCount: number, seed = '20261011'): Session {
  const teams = createTeams(advancedCount, beginnerCount)
  const emptyRounds = Array.from({ length: TOTAL_ROUNDS }, (_, index) => ({
    index: index + 1,
    status: 'planned' as const,
    matches: [],
  }))
  const rounds = generateFutureRounds(teams, emptyRounds, seed, 1)
  const now = new Date().toISOString()
  return {
    version: 1,
    id: `session-${Date.now()}`,
    totalRounds: TOTAL_ROUNDS,
    currentRound: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    algorithmVersion: ALGORITHM_VERSION,
    seed,
    teams,
    rounds,
    court2Overrides: {},
    revisions: [],
  }
}

export function lockedThroughRound(session: Session): number {
  return session.rounds.filter((round) => round.status === 'completed' || round.status === 'in_progress').reduce((max, round) => Math.max(max, round.index), 0)
}

export function recalculateSessionPlan(
  session: Session,
  addedCategory: Category | null,
  addedCount: number,
): { session: Session; diff: PlanDiff } {
  const lockThrough = lockedThroughRound(session)
  const addedTeams = addedCategory && addedCount > 0 ? createTeamsForAddition(session.teams, addedCategory, addedCount, lockThrough + 1) : []
  const teams = [...session.teams, ...addedTeams]
  const preservedRounds = session.rounds.map((round) => ({ ...round, matches: round.matches.map((match) => ({ ...match })) }))
  const nextRounds = generateFutureRounds(teams, preservedRounds, session.seed, lockThrough + 1)
  for (let index = 0; index < lockThrough; index += 1) nextRounds[index] = preservedRounds[index]
  const diff = diffPlans(session.rounds, nextRounds, lockThrough + 1)
  const nextSession: Session = {
    ...session,
    teams,
    rounds: nextRounds,
    court2Overrides: {},
    updatedAt: new Date().toISOString(),
  }
  return { session: nextSession, diff }
}

export function createTeamsForAddition(teams: Team[], category: Category, count: number, joinedRound: number): Team[] {
  const categoryTeams = teams.filter((team) => team.category === category)
  const start = categoryTeams.length
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset
    const displayName = category === 'advanced' ? String(index + 1) : numberToLetters(index)
    return {
      id: `${category}-${category === 'advanced' ? index + 1 : indexToStableId(index)}`,
      category,
      displayName,
      joinedRound,
      active: true,
    }
  })
}

export function diffPlans(before: Round[], after: Round[], fromRound = 1): PlanDiff {
  const changes: PlanDiff['changes'] = []
  for (let roundIndex = fromRound; roundIndex <= TOTAL_ROUNDS; roundIndex += 1) {
    const beforeRound = before.find((round) => round.index === roundIndex)
    const afterRound = after.find((round) => round.index === roundIndex)
    for (const court of [1, 2, 3] as const) {
      const beforeMatch = beforeRound?.matches.find((match) => match.court === court) ?? null
      const afterMatch = afterRound?.matches.find((match) => match.court === court) ?? null
      const beforeSignature = matchSignature(beforeMatch)
      const afterSignature = matchSignature(afterMatch)
      if (beforeSignature !== afterSignature) changes.push({ roundIndex, court, before: beforeMatch, after: afterMatch })
    }
  }
  return { changes, changedRounds: [...new Set(changes.map((change) => change.roundIndex))] }
}

function matchSignature(match: Match | null): string {
  if (!match) return 'none'
  return `${match.category}:${match.teamAId}:${match.teamBId}`
}

export function completeCurrentRound(session: Session): Session {
  const round = session.rounds.find((candidate) => candidate.index === session.currentRound)
  if (!round || round.status === 'completed') return session
  const rounds = session.rounds.map((candidate) => candidate.index === round.index ? {
    ...candidate,
    status: 'completed' as const,
    matches: candidate.matches.map((match) => ({ ...match, status: 'completed' as const })),
  } : candidate)
  const nextRound = session.currentRound + 1
  return {
    ...session,
    rounds,
    currentRound: Math.min(nextRound, TOTAL_ROUNDS),
    status: nextRound > TOTAL_ROUNDS ? 'completed' : 'active',
    updatedAt: new Date().toISOString(),
  }
}

export function undoLastCompletedRound(session: Session): Session {
  const lastCompleted = [...session.rounds].reverse().find((round) => round.status === 'completed')
  if (!lastCompleted) return session
  const rounds = session.rounds.map((round) => round.index === lastCompleted.index ? {
    ...round,
    status: 'planned' as const,
    matches: round.matches.map((match) => ({ ...match, status: 'scheduled' as const })),
  } : round)
  return {
    ...session,
    rounds,
    currentRound: lastCompleted.index,
    status: 'active',
    updatedAt: new Date().toISOString(),
  }
}

export function getTeamStats(session: Session): TeamStats[] {
  const stats = new Map<string, TeamStats>(session.teams.map((team) => [team.id, {
    team,
    completedMatches: 0,
    plannedMatches: 0,
    opponentCounts: {},
    restAfterRound: 0,
  }]))
  for (const round of session.rounds) {
    for (const match of round.matches) {
      const a = stats.get(match.teamAId)
      const b = stats.get(match.teamBId)
      if (!a || !b) continue
      if (match.status === 'completed') {
        a.completedMatches += 1
        b.completedMatches += 1
      } else {
        a.plannedMatches += 1
        b.plannedMatches += 1
      }
      a.opponentCounts[match.teamBId] = (a.opponentCounts[match.teamBId] ?? 0) + 1
      b.opponentCounts[match.teamAId] = (b.opponentCounts[match.teamAId] ?? 0) + 1
    }
  }
  for (const value of stats.values()) {
    const lastPlayedRound = [...session.rounds].reverse().find((round) => round.matches.some((match) => match.teamAId === value.team.id || match.teamBId === value.team.id))?.index ?? 0
    value.restAfterRound = Math.max(0, TOTAL_ROUNDS - lastPlayedRound)
  }
  return [...stats.values()].sort((a, b) => a.team.category.localeCompare(b.team.category) || a.team.displayName.localeCompare(b.team.displayName, 'ja', { numeric: true }))
}

export function getPlanHealth(session: Session): { matchCount: number; repeatCount: number; maxLoadGap: number; completedRounds: number } {
  const stats = getTeamStats(session)
  const matchCount = session.rounds.reduce((sum, round) => sum + round.matches.length, 0)
  const repeatCount = stats.reduce((sum, stat) => sum + Object.values(stat.opponentCounts).filter((count) => count > 1).reduce((inner, count) => inner + count - 1, 0), 0) / 2
  const loads = stats.map((stat) => stat.completedMatches + stat.plannedMatches)
  const maxLoadGap = loads.length ? Math.max(...loads) - Math.min(...loads) : 0
  return {
    matchCount,
    repeatCount,
    maxLoadGap,
    completedRounds: session.rounds.filter((round) => round.status === 'completed').length,
  }
}

export function getTeamById(session: Session, teamId: string): Team | undefined {
  return session.teams.find((team) => team.id === teamId)
}

