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

export const ALGORITHM_VERSION = '公平性優先 v6'

interface WorkingTeam {
  scheduled: number
  completed: number
  opponents: Map<string, number>
  lastPlayedRound: number
}

type WorkingState = Map<string, WorkingTeam>

interface ScheduleScore {
  categoryGap: number
  fairness: number
  repeats: number
  consecutive: number
  noise: number
}

interface FairnessMetrics {
  categoryGap: number
  withinCategory: number
}

interface RoundCandidate {
  matches: Match[]
  nextState: WorkingState
  score: ScheduleScore
}

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

function fairnessScore(
  state: WorkingState,
  teams: Team[],
  roundIndex: number,
  additionalTeamIds: string[] = [],
): FairnessMetrics {
  const additionalIds = new Set(additionalTeamIds)
  const categoryAverages: number[] = []
  let withinCategory = 0

  for (const category of ['advanced', 'beginner'] as const) {
    const eligible = teams.filter((team) => team.active && team.category === category && team.joinedRound <= roundIndex)
    if (eligible.length === 0) continue
    const scheduledFor = (team: Team): number => state.get(team.id)!.scheduled + Number(additionalIds.has(team.id))
    const mean = eligible.reduce((sum, team) => sum + scheduledFor(team), 0) / eligible.length
    categoryAverages.push(mean)
    withinCategory += eligible.reduce((sum, team) => sum + Math.pow(scheduledFor(team) - mean, 2), 0) / eligible.length
  }

  return {
    categoryGap: categoryAverages.length === 2 ? Math.abs(categoryAverages[0] - categoryAverages[1]) : 0,
    withinCategory,
  }
}

function compareScores(a: ScheduleScore, b: ScheduleScore): number {
  return a.repeats - b.repeats
    || a.categoryGap - b.categoryGap
    || a.fairness - b.fairness
    || a.consecutive - b.consecutive
    || a.noise - b.noise
}

function compareRoundCandidates(a: RoundCandidate, b: RoundCandidate): number {
  return b.matches.length - a.matches.length || compareScores(a.score, b.score)
}

function choosePairs(
  state: WorkingState,
  teams: Team[],
  category: Category,
  roundIndex: number,
  courts: Array<1 | 2 | 3>,
  seed: string,
): { matches: Match[]; nextState: WorkingState; score: ScheduleScore } {
  const eligible = teams.filter((team) => team.active && team.category === category && team.joinedRound <= roundIndex)
  const pairs: Array<[Team, Team]> = []
  for (let aIndex = 0; aIndex < eligible.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < eligible.length; bIndex += 1) {
      pairs.push([eligible[aIndex], eligible[bIndex]])
    }
  }

  const emptyScore: ScheduleScore = { categoryGap: 0, fairness: 0, repeats: 0, consecutive: 0, noise: 0 }
  const maxMatches = Math.min(courts.length, Math.floor(eligible.length / 2))
  for (let matchCount = maxMatches; matchCount > 0; matchCount -= 1) {
    let best: { matches: Match[]; nextState: WorkingState; score: ScheduleScore } | null = null
    const combinations: Array<Array<[Team, Team]>> = []

    if (matchCount === 1) {
      for (const pair of pairs) combinations.push([pair])
    } else {
      for (let firstIndex = 0; firstIndex < pairs.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < pairs.length; secondIndex += 1) {
          const first = pairs[firstIndex]
          const second = pairs[secondIndex]
          if (first.some((team) => second.some((other) => other.id === team.id))) continue
          combinations.push([first, second])
        }
      }
    }

    for (const combination of combinations) {
      const matches: Match[] = combination.map(([teamA, teamB], index) => ({
        id: `round-${roundIndex}-court-${courts[index]}`,
        roundIndex,
        court: courts[index],
        category,
        teamAId: teamA.id,
        teamBId: teamB.id,
        status: 'scheduled',
      }))
      const nextState = cloneState(state)
      for (const match of matches) applyMatch(nextState, match)

      const score: ScheduleScore = {
        categoryGap: 0,
        fairness: fairnessScore(nextState, teams, roundIndex).withinCategory,
        repeats: matches.reduce((sum, match) => sum + (state.get(match.teamAId)?.opponents.get(match.teamBId) ?? 0), 0),
        consecutive: matches.reduce((sum, match) => {
          const a = state.get(match.teamAId)?.lastPlayedRound ?? 0
          const b = state.get(match.teamBId)?.lastPlayedRound ?? 0
          return sum + Number(a === roundIndex - 1) + Number(b === roundIndex - 1)
        }, 0),
        noise: matches.reduce((sum, match) => sum + seededNoise(seed, roundIndex, match.teamAId, match.teamBId), 0),
      }
      if (!best || score.repeats < best.score.repeats
        || (score.repeats === best.score.repeats && compareScores(score, best.score) < 0)) {
        best = { matches, nextState, score }
      }
    }

    if (best) return best
  }

  return { matches: [], nextState: cloneState(state), score: emptyScore }
}

function generateRoundCandidate(
  state: WorkingState,
  teams: Team[],
  roundIndex: number,
  court2Category: Category | null,
  seed: string,
): RoundCandidate {
  const advanced = choosePairs(state, teams, 'advanced', roundIndex,
    court2Category === 'advanced' ? [1, 2] : [1], seed)
  const beginner = choosePairs(state, teams, 'beginner', roundIndex,
    court2Category === 'beginner' ? [2, 3] : [3], seed)
  const matches = [...advanced.matches, ...beginner.matches].sort((a, b) => a.court - b.court)
  const nextState = cloneState(state)
  for (const match of matches) applyMatch(nextState, match)

  const fairness = fairnessScore(nextState, teams, roundIndex)
  const score = matches.reduce((total, match) => {
    const previousCount = state.get(match.teamAId)?.opponents.get(match.teamBId) ?? 0
    const aLastRound = state.get(match.teamAId)?.lastPlayedRound ?? 0
    const bLastRound = state.get(match.teamBId)?.lastPlayedRound ?? 0
    return {
      categoryGap: fairness.categoryGap,
      fairness: fairness.withinCategory,
      repeats: total.repeats + previousCount,
      consecutive: total.consecutive + Number(aLastRound === roundIndex - 1) + Number(bLastRound === roundIndex - 1),
      noise: total.noise + seededNoise(seed, roundIndex, match.teamAId, match.teamBId),
    }
  }, { categoryGap: fairness.categoryGap, fairness: fairness.withinCategory, repeats: 0, consecutive: 0, noise: 0 })
  return {
    matches,
    nextState,
    score,
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
    const previousRound = rounds[roundIndex - 2]
    const previousAdvancedMatches = previousRound?.matches.filter((match) => match.category === 'advanced').length ?? 0
    const advanced = previousAdvancedMatches >= 2
      ? null
      : generateRoundCandidate(state, teams, roundIndex, 'advanced', seed)
    const beginner = generateRoundCandidate(state, teams, roundIndex, 'beginner', seed)
    const candidate = advanced && compareRoundCandidates(advanced, beginner) <= 0 ? advanced : beginner
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
  const openingRound = createDefaultOpeningRound(teams)
  const baseRounds = emptyRounds.map((round) => round.index === 1 ? openingRound : round)
  const rounds = generateFutureRounds(teams, baseRounds, seed, 2)
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

type OpeningCourt = 1 | 2 | 3
export type OpeningRoundDraft = Record<OpeningCourt, [string, string]>

export function openingRoundDraft(session: Session): OpeningRoundDraft {
  const round = session.rounds.find((candidate) => candidate.index === 1)
  const expectedCategories: Record<OpeningCourt, Category> = {
    1: 'advanced',
    2: 'beginner',
    3: 'beginner',
  }
  const validMatches = (round?.matches ?? []).filter((match) => match.category === expectedCategories[match.court])
  return {
    1: pairForCourt(validMatches, 1),
    2: pairForCourt(validMatches, 2),
    3: pairForCourt(validMatches, 3),
  }
}

function pairForCourt(matches: Match[], court: OpeningCourt): [string, string] {
  const match = matches.find((candidate) => candidate.court === court)
  return match ? [match.teamAId, match.teamBId] : ['', '']
}

function createDefaultOpeningRound(teams: Team[]): Round {
  const pairs: Array<{ court: OpeningCourt; teamAId: string; teamBId: string; category: Category }> = [
    { court: 1, teamAId: 'advanced-1', teamBId: 'advanced-2', category: 'advanced' },
    { court: 2, teamAId: 'beginner-a', teamBId: 'beginner-b', category: 'beginner' },
    { court: 3, teamAId: 'beginner-c', teamBId: 'beginner-d', category: 'beginner' },
  ]
  const availableIds = new Set(teams.filter((team) => team.active && team.joinedRound <= 1).map((team) => team.id))
  return {
    index: 1,
    status: 'planned',
    matches: pairs.filter((pair) => availableIds.has(pair.teamAId) && availableIds.has(pair.teamBId)).map((pair) => ({
      id: `round-1-court-${pair.court}`,
      roundIndex: 1,
      court: pair.court,
      category: pair.category,
      teamAId: pair.teamAId,
      teamBId: pair.teamBId,
      status: 'scheduled',
    })),
  }
}

export function recalculateFromOpeningRound(
  session: Session,
  draft: OpeningRoundDraft,
): { session: Session; diff: PlanDiff } {
  const openingRound = session.rounds.find((round) => round.index === 1)
  if (session.currentRound !== 1 || openingRound?.status !== 'planned') {
    throw new Error('第1ラウンドを組み直せるのは、終了前だけです。')
  }

  const expectedCategories: Record<OpeningCourt, Category> = {
    1: 'advanced',
    2: 'beginner',
    3: 'beginner',
  }
  const usedIds = new Set<string>()
  const matches: Match[] = []
  for (const court of [1, 2, 3] as const) {
    const [teamAId, teamBId] = draft[court]
    if (!teamAId && !teamBId) continue
    if (!teamAId || !teamBId) throw new Error(`コート${court}はチームを2つ選んでください。`)
    if (teamAId === teamBId) throw new Error(`コート${court}で同じチームは選べません。`)

    for (const teamId of [teamAId, teamBId]) {
      const team = session.teams.find((candidate) => candidate.id === teamId)
      if (!team || !team.active || team.joinedRound > 1 || team.category !== expectedCategories[court]) {
        throw new Error(`コート${court}のカテゴリーに合うチームを選んでください。`)
      }
      if (usedIds.has(teamId)) throw new Error('同じチームを第1ラウンドの複数の試合に入れることはできません。')
      usedIds.add(teamId)
    }

    matches.push({
      id: `round-1-court-${court}`,
      roundIndex: 1,
      court,
      category: expectedCategories[court],
      teamAId,
      teamBId,
      status: 'scheduled',
    })
  }

  const baseRounds = session.rounds.map((round) => round.index === 1
    ? { ...round, status: 'planned' as const, matches }
    : { ...round, matches: round.matches.map((match) => ({ ...match })) })
  const rounds = generateFutureRounds(session.teams, baseRounds, session.seed, 2)
  rounds[0] = { ...baseRounds[0]!, matches }
  const diff = diffPlans(session.rounds, rounds, 2)
  return {
    session: { ...session, rounds, algorithmVersion: ALGORITHM_VERSION, updatedAt: new Date().toISOString() },
    diff,
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
  const startRound = lockThrough === 0 ? 2 : lockThrough + 1
  const nextRounds = generateFutureRounds(teams, preservedRounds, session.seed, startRound)
  for (let index = 0; index < lockThrough; index += 1) nextRounds[index] = preservedRounds[index]
  const diff = diffPlans(session.rounds, nextRounds, startRound)
  const nextSession: Session = {
    ...session,
    teams,
    rounds: nextRounds,
    court2Overrides: {},
    algorithmVersion: ALGORITHM_VERSION,
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

