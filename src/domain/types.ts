export const TOTAL_ROUNDS = 9

export type Category = 'advanced' | 'beginner'
export type Court2Mode = 'auto' | Category
export type RoundStatus = 'planned' | 'in_progress' | 'completed'
export type MatchStatus = 'scheduled' | 'completed'

export interface Team {
  id: string
  category: Category
  displayName: string
  joinedRound: number
  active: boolean
}

export interface Match {
  id: string
  roundIndex: number
  court: 1 | 2 | 3
  category: Category
  teamAId: string
  teamBId: string
  status: MatchStatus
}

export interface Round {
  index: number
  status: RoundStatus
  matches: Match[]
}

export interface Revision {
  id: string
  createdAt: string
  reason: string
  previousPlan: Round[]
  nextPlan: Round[]
  confirmed: boolean
}

export interface Session {
  version: 1
  id: string
  totalRounds: number
  currentRound: number
  status: 'active' | 'completed'
  createdAt: string
  updatedAt: string
  algorithmVersion: string
  seed: string
  teams: Team[]
  rounds: Round[]
  court2Overrides: Record<string, Court2Mode>
  revisions: Revision[]
}

export interface TeamStats {
  team: Team
  completedMatches: number
  plannedMatches: number
  opponentCounts: Record<string, number>
  restAfterRound: number
}

export interface PlanChange {
  roundIndex: number
  court: 1 | 2 | 3
  before: Match | null
  after: Match | null
}

export interface PlanDiff {
  changes: PlanChange[]
  changedRounds: number[]
}
