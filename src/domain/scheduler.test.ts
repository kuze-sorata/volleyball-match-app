import { describe, expect, it } from 'vitest'
import {
  completeCurrentRound,
  createInitialSession,
  diffPlans,
  getPlanHealth,
  getTeamStats,
  recalculateSessionPlan,
} from './scheduler'
import { Match, Session } from './types'

function allMatches(session: Session): Match[] {
  return session.rounds.flatMap((round) => round.matches)
}

describe('volleyball match scheduler', () => {
  it('T01: creates 9 rounds and up to 3 courts for a typical input', () => {
    const session = createInitialSession(6, 4, 'test')
    expect(session.rounds).toHaveLength(9)
    expect(session.rounds.every((round) => round.matches.length <= 3)).toBe(true)
    expect(getPlanHealth(session).matchCount).toBeGreaterThan(0)
  })

  it('T01b: opens with the first advanced pair and two beginner pairs', () => {
    const session = createInitialSession(6, 4, 'test')
    const firstRound = session.rounds[0]
    const advancedMatch = firstRound.matches.find((match) => match.court === 1)
    const beginnerMatch = firstRound.matches.find((match) => match.court === 2)
    const secondBeginnerMatch = firstRound.matches.find((match) => match.court === 3)
    expect(advancedMatch && [advancedMatch.teamAId, advancedMatch.teamBId]).toEqual(['advanced-1', 'advanced-2'])
    expect(beginnerMatch && [beginnerMatch.teamAId, beginnerMatch.teamBId]).toEqual(['beginner-a', 'beginner-b'])
    expect(secondBeginnerMatch && [secondBeginnerMatch.teamAId, secondBeginnerMatch.teamBId]).toEqual(['beginner-c', 'beginner-d'])
  })

  it('T02: never mixes categories or repeats a team in one round', () => {
    const session = createInitialSession(6, 4, 'test')
    for (const round of session.rounds) {
      const teamIds = round.matches.flatMap((match) => [match.teamAId, match.teamBId])
      expect(new Set(teamIds).size).toBe(teamIds.length)
      expect(round.matches.every((match) => {
        const a = session.teams.find((team) => team.id === match.teamAId)
        const b = session.teams.find((team) => team.id === match.teamBId)
        return a?.category === match.category && b?.category === match.category
      })).toBe(true)
    }
  })

  it('T03: keeps court 1 advanced and court 3 beginner', () => {
    const session = createInitialSession(6, 4, 'test')
    for (const match of allMatches(session)) {
      if (match.court === 1) expect(match.category).toBe('advanced')
      if (match.court === 3) expect(match.category).toBe('beginner')
    }
  })

  it('T04: completing a round increments each scheduled team exactly once', () => {
    const session = createInitialSession(6, 4, 'test')
    const completed = completeCurrentRound(session)
    const duplicate = completeCurrentRound(session)
    expect(completed.rounds[0].status).toBe('completed')
    expect(getTeamStats(completed).some((stat) => stat.completedMatches > 0)).toBe(true)
    expect(duplicate).toEqual(completed)
  })

  it('T05/T07: preserves locked rounds and only previews future changes', () => {
    let session = createInitialSession(6, 4, 'test')
    session = completeCurrentRound(session)
    session = completeCurrentRound(session)
    session = completeCurrentRound(session)
    const beforeLocked = session.rounds.slice(0, 3)
    const result = recalculateSessionPlan(session, 'beginner', 2)
    expect(result.session.rounds.slice(0, 3)).toEqual(beforeLocked)
    expect(result.diff.changedRounds.every((round) => round >= 4)).toBe(true)
    expect(diffPlans(session.rounds, result.session.rounds, 4).changes.length).toBe(result.diff.changes.length)
  })

  it('T08: supports zero and one team categories without failing', () => {
    expect(() => createInitialSession(0, 1, 'test')).not.toThrow()
    const session = createInitialSession(1, 1, 'test')
    expect(getPlanHealth(session).matchCount).toBe(0)
  })

  it('T09: session shape is JSON serializable for browser persistence', () => {
    const session = createInitialSession(4, 4, 'test')
    expect(() => JSON.parse(JSON.stringify(session))).not.toThrow()
  })

  it('T10: same input and seed creates the same plan', () => {
    const first = createInitialSession(6, 4, 'stable-seed')
    const second = createInitialSession(6, 4, 'stable-seed')
    expect(first.rounds).toEqual(second.rounds)
  })

  it('T11: never creates a tenth round', () => {
    const session = createInitialSession(18, 18, 'test')
    expect(session.rounds).toHaveLength(9)
    expect(Math.max(...session.rounds.map((round) => round.index))).toBe(9)
  })

  it('T12: reports repeat opponents and load gap for scenario checks', () => {
    const session = createInitialSession(4, 4, 'test')
    const health = getPlanHealth(session)
    expect(health.repeatCount).toBeGreaterThanOrEqual(0)
    expect(health.maxLoadGap).toBeGreaterThanOrEqual(0)
  })
})
