import { useEffect, useMemo, useState } from 'react'
import {
  categoryLabelJa,
  completeCurrentRound,
  createInitialSession,
  getTeamById,
  getTeamStats,
  openingRoundDraft,
  recalculateFromOpeningRound,
  recalculateSessionPlan,
  undoLastCompletedRound,
} from './domain/scheduler'
import { clearSession, loadSessionResult, saveSession } from './domain/storage'
import { Category, Match, PlanDiff, Round, Session } from './domain/types'
import type { OpeningRoundDraft } from './domain/scheduler'
import logoImage from './assets/jmv-logo.png'

const DEFAULT_SEED = '20261011'
const initialStorage = loadSessionResult()

function App() {
  const [session, setSession] = useState<Session | null>(() => initialStorage.session)
  const [advancedCount, setAdvancedCount] = useState('4')
  const [beginnerCount, setBeginnerCount] = useState('5')
  const [attendanceCounts, setAttendanceCounts] = useState<Record<Category, string>>({ advanced: '0', beginner: '0' })
  const [addCategory, setAddCategory] = useState<Category>('advanced')
  const [addCount, setAddCount] = useState('1')
  const [preview, setPreview] = useState<{ nextSession: Session; diff: PlanDiff; reason: '途中参加' | '第1ラウンド調整' } | null>(null)
  const [notice, setNotice] = useState<{ type: 'success' | 'warning'; text: string } | null>(() => initialStorage.warning ? { type: 'warning', text: initialStorage.warning } : null)

  useEffect(() => {
    if (session) saveSession(session)
  }, [session])

  const stats = useMemo(() => session ? getTeamStats(session) : [], [session])
  const currentRound = session?.rounds.find((round) => round.index === session.currentRound)

  const flash = (text: string, type: 'success' | 'warning' = 'success') => {
    setNotice({ text, type })
    window.setTimeout(() => setNotice(null), 3600)
  }

  const handleGenerate = () => {
    const advanced = parseCount(advancedCount)
    const beginner = parseCount(beginnerCount)
    const advancedAttendees = parseCount(attendanceCounts.advanced)
    const beginnerAttendees = parseCount(attendanceCounts.beginner)
    if (advanced === null || beginner === null || advancedAttendees === null || beginnerAttendees === null) {
      flash('受付人数とチーム数は0以上の整数で入力してください。', 'warning')
      return
    }
    const created = createInitialSession(advanced, beginner, DEFAULT_SEED)
    setSession({
      ...created,
      attendanceCounts: { advanced: advancedAttendees, beginner: beginnerAttendees },
    })
    setPreview(null)
    flash('9ラウンドの対戦表を生成しました。')
  }

  const handleComplete = () => {
    if (!session || !currentRound || currentRound.status === 'completed') return
    setSession(completeCurrentRound(session))
    setPreview(null)
    flash(`第${currentRound.index}ラウンドを終了しました。`)
  }

  const handleUndo = () => {
    if (!session || !window.confirm('直前に終了したラウンドを取り消しますか？')) return
    setSession(undoLastCompletedRound(session))
    flash('直前のラウンドを予定に戻しました。', 'warning')
  }

  const handlePreview = () => {
    if (!session) return
    const count = parseCount(addCount)
    if (count === null) {
      flash('追加するチーム数は0以上の整数で入力してください。', 'warning')
      return
    }
    const result = recalculateSessionPlan(session, count === 0 ? null : addCategory, count)
    setPreview({ nextSession: result.session, diff: result.diff, reason: '途中参加' })
    if (result.diff.changes.length === 0 && count === 0) flash('変更はありません。', 'warning')
  }

  const updateAttendanceCount = (category: Category, value: string) => {
    if (!session) return
    const count = parseCount(value)
    if (count === null) return
    const currentCounts = session.attendanceCounts ?? {}
    setSession({
      ...session,
      attendanceCounts: { ...currentCounts, [category]: count },
      updatedAt: new Date().toISOString(),
    })
    setPreview(null)
  }

  const handleOpeningPreview = (draft: OpeningRoundDraft) => {
    if (!session) return
    try {
      const result = recalculateFromOpeningRound(session, draft)
      setPreview({ nextSession: result.session, diff: result.diff, reason: '第1ラウンド調整' })
    } catch (error) {
      flash(error instanceof Error ? error.message : '第1ラウンドを組み直せませんでした。', 'warning')
    }
  }

  const handleApplyPreview = () => {
    if (!preview) return
    setSession({
      ...preview.nextSession,
      revisions: [...preview.nextSession.revisions, {
        id: `revision-${Date.now()}`,
        createdAt: new Date().toISOString(),
        reason: preview.reason,
        previousPlan: session?.rounds ?? [],
        nextPlan: preview.nextSession.rounds,
        confirmed: true,
      }],
    })
    setPreview(null)
    flash(preview.reason === '第1ラウンド調整'
      ? '第1ラウンドを固定し、第2ラウンド以降を更新しました。'
      : '変更を確定しました。未開始ラウンドだけ更新されています。')
  }

  const handleReset = () => {
    if (!window.confirm('保存済みの対戦表と履歴を削除しますか？')) return
    clearSession()
    setSession(null)
    setPreview(null)
    flash('保存データを削除しました。', 'warning')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <img className="brand-mark" src={logoImage} alt="JMV" />
          <h1>対戦表</h1>
        </div>
        <div className="topbar-meta">
          {session && <span className={`status-dot ${session.status === 'completed' ? 'is-done' : ''}`}><i />{session.status === 'completed' ? '全ラウンド終了' : `次は第${session.currentRound}ラウンド`}</span>}
        </div>
      </header>

      {notice && <div className={`notice ${notice.type}`} role="status">{notice.text}</div>}

      {!session ? (
        <main className="empty-state">
          <SetupPanel
            teamCounts={{ advanced: advancedCount, beginner: beginnerCount }}
            setTeamCounts={(counts) => {
              setAdvancedCount(counts.advanced)
              setBeginnerCount(counts.beginner)
            }}
            attendanceCounts={attendanceCounts}
            setAttendanceCounts={setAttendanceCounts}
            onGenerate={handleGenerate}
          />
        </main>
      ) : (
        <main className="workspace">
          <div className="main-grid">
            <div className="schedule-column">
              <TeamRoster
                session={session}
                attendanceCounts={session.attendanceCounts}
                onAttendanceChange={updateAttendanceCount}
              />
              <ScheduleBoard session={session} />
              <TeamSummary stats={stats} />
            </div>
            <aside className="side-column">
              {currentRound?.index === 1 && currentRound.status === 'planned' && <OpeningRoundEditor
                key={`${session.id}-${session.rounds[0]?.status}-${session.rounds[0]?.matches.map((match) => `${match.court}:${match.teamAId}:${match.teamBId}`).join('|')}`}
                session={session}
                onPreview={handleOpeningPreview}
              />}
              <ProgressPanel session={session} currentRound={currentRound} onComplete={handleComplete} onUndo={handleUndo} />
              <ChangePanel
                addCategory={addCategory}
                addCount={addCount}
                setAddCategory={setAddCategory}
                setAddCount={setAddCount}
                onPreview={handlePreview}
                onClear={() => {
                  setPreview(null)
                  setAddCount('1')
                }}
              />
              {preview && <PreviewPanel session={session} preview={preview} onApply={handleApplyPreview} onCancel={() => setPreview(null)} />}
              <div className="small-actions">
                <button className="text-button" type="button" onClick={handleReset}>保存データを初期化</button>
              </div>
            </aside>
          </div>
        </main>
      )}
    </div>
  )
}

function SetupPanel({
  teamCounts,
  setTeamCounts,
  attendanceCounts,
  setAttendanceCounts,
  onGenerate,
}: {
  teamCounts: Record<Category, string>
  setTeamCounts: (value: Record<Category, string>) => void
  attendanceCounts: Record<Category, string>
  setAttendanceCounts: (value: Record<Category, string>) => void
  onGenerate: () => void
}) {
  return <section className="setup-panel panel">
    <div className="section-heading"><div><h3>人数とチーム数</h3><p>受付人数からチーム数の目安を確認し、当日の編成に合わせて調整します。</p></div></div>
    <div className="setup-team-groups">
      {(['advanced', 'beginner'] as const).map((category) => <section className="draft-team-group" key={category}>
        <div className="draft-team-heading"><strong>{categoryLabelJa(category)}</strong></div>
        <label className="number-field"><span>受付人数</span><input type="number" min="0" step="1" value={attendanceCounts[category]} onChange={(event) => setAttendanceCounts({ ...attendanceCounts, [category]: event.target.value })} /></label>
        <p className="team-count-estimate">6〜7人編成の目安：約{estimateTeamCount(attendanceCounts[category])}チーム</p>
        <label className="number-field"><span>作るチーム数</span><input type="number" min="0" step="1" value={teamCounts[category]} onChange={(event) => setTeamCounts({ ...teamCounts, [category]: event.target.value })} /></label>
      </section>)}
    </div>
    <p className="microcopy setup-note">人数やチーム数は、5:20以降の到着や現場の調整に合わせて変更できます。</p>
    <button className="primary-button" type="button" onClick={onGenerate}>対戦表を生成 <span>→</span></button>
  </section>
}

function estimateTeamCount(value: string): string {
  const count = parseCount(value)
  if (count === null || count === 0) return '0'
  const minTeams = Math.max(1, Math.ceil(count / 7))
  const maxTeams = Math.floor(count / 6)
  if (minTeams <= maxTeams) return minTeams === maxTeams ? `${minTeams}` : `${minTeams}〜${maxTeams}`
  return `${Math.max(1, Math.round(count / 6.5))}前後`
}

function TeamRoster({
  session,
  attendanceCounts,
  onAttendanceChange,
}: {
  session: Session
  attendanceCounts: Session['attendanceCounts']
  onAttendanceChange: (category: Category, value: string) => void
}) {
  return <section className="panel roster-panel">
    <div className="section-heading"><div><h3>参加人数とチーム数</h3><p>受付人数は必要に応じて更新できます。</p></div></div>
    <div className="roster-groups">
      {(['advanced', 'beginner'] as const).map((category) => {
        const categoryTeams = session.teams.filter((team) => team.category === category && team.active)
        const checkedInCount = attendanceCounts?.[category]
        return <section className="roster-group" key={category}>
          <div className="roster-group-heading">
            <strong><i className={category === 'advanced' ? 'advance-dot' : 'beginner-dot'} />{categoryLabelJa(category)}</strong>
            <span>{categoryTeams.length}チーム</span>
          </div>
          <div className="roster-count-summary">
            <label><span>受付人数</span><input type="number" min="0" step="1" value={checkedInCount ?? ''} onChange={(event) => onAttendanceChange(category, event.target.value)} /></label>
            {checkedInCount !== undefined && <span>チーム数の目安：約{estimateTeamCount(String(checkedInCount))}</span>}
          </div>
        </section>
      })}
    </div>
  </section>
}

function ScheduleBoard({ session }: { session: Session }) {
  return <section className="panel schedule-panel">
    <div className="board-header section-heading"><div><h3>対戦表</h3></div></div>
    <div className="schedule-scroll">
      <div className="schedule-head"><div>ラウンド</div><div>コート 1 <span>ADVANCE</span></div><div>コート 2 <span>第1Rはビギナー／以降は自動</span></div><div>コート 3 <span>BEGINNER</span></div></div>
      {session.rounds.map((round) => <RoundRow key={round.index} round={round} session={session} />)}
    </div>
  </section>
}

function OpeningRoundEditor({ session, onPreview }: { session: Session; onPreview: (draft: OpeningRoundDraft) => void }) {
  const [draft, setDraft] = useState(() => openingRoundDraft(session))
  const openingRound = session.rounds.find((round) => round.index === 1)
  const canEdit = session.currentRound === 1 && openingRound?.status === 'planned'
  const selectedIds = Object.values(draft).flat()

  const updateTeam = (court: 1 | 2 | 3, side: 0 | 1, teamId: string) => {
    setDraft((current) => {
      const pair: [string, string] = [...current[court]]
      pair[side] = teamId
      return { ...current, [court]: pair }
    })
  }

  return <section className="panel opening-panel">
    <div className="section-heading"><div><h3>第1ラウンドを調整する</h3><p>実際の対戦カードに合わせて、第2ラウンド以降を組み直せます。</p></div></div>
    <p className="microcopy opening-help">コート1はアドバンス、コート2・3はビギナーです。両方を「選択しない」にすると試合なしになります。</p>
    {([1, 2, 3] as const).map((court) => {
      const category: Category = court === 1 ? 'advanced' : 'beginner'
      const candidates = session.teams.filter((team) => team.active && team.joinedRound <= 1 && team.category === category)
      return <div className="opening-court" key={court}>
        <strong>コート{court}<span>{categoryLabelJa(category)}</span></strong>
        <div className="opening-pair">
          {([0, 1] as const).map((side) => {
            const ownTeamId = draft[court][side]
            const reservedElsewhere = new Set(selectedIds.filter((id) => id && id !== ownTeamId))
            return <select
              key={side}
              aria-label={`第1ラウンド コート${court}の${side === 0 ? 'チームA' : 'チームB'}`}
              value={ownTeamId}
              disabled={!canEdit}
              onChange={(event) => updateTeam(court, side, event.target.value)}
            >
              <option value="">選択しない</option>
              {candidates.map((team) => <option key={team.id} value={team.id} disabled={reservedElsewhere.has(team.id)}>{team.displayName}</option>)}
            </select>
          })}
        </div>
      </div>
    })}
    <button className="primary-button" type="button" disabled={!canEdit} onClick={() => onPreview(draft)}>この組み合わせで後半を組み直す <span>→</span></button>
    {!canEdit && <p className="microcopy">第1ラウンド終了前に変更できます。</p>}
  </section>
}

function RoundRow({ round, session }: { round: Round; session: Session }) {
  const state = round.status === 'completed' ? 'done' : round.index === session.currentRound ? 'current' : ''
  return <div className={`round-row ${state}`}>
    <div className="round-label"><strong>{String(round.index).padStart(2, '0')}</strong><span>{round.status === 'completed' ? '終了' : round.index === session.currentRound ? '次' : '予定'}</span></div>
    {[1, 2, 3].map((court) => {
      const match = round.matches.find((candidate) => candidate.court === court)
      return <div className="match-cell" key={court}><MatchCard match={match ?? null} session={session} /></div>
    })}
  </div>
}

function MatchCard({ match, session }: { match: Match | null; session: Session }) {
  if (!match) return <div className="no-match"><span>—</span> 試合なし</div>
  const teamA = getTeamById(session, match.teamAId)
  const teamB = getTeamById(session, match.teamBId)
  return <div className={`match-card ${match.category}`}>
    <div className="team-pair"><strong>{teamA?.displayName ?? '?'}</strong><span>—</span><strong>{teamB?.displayName ?? '?'}</strong></div>
    <span className="category-caption">{categoryLabelJa(match.category)}</span>
  </div>
}

function ProgressPanel({ session, currentRound, onComplete, onUndo }: { session: Session; currentRound?: Round; onComplete: () => void; onUndo: () => void }) {
  const isComplete = session.status === 'completed'
  return <section className="panel progress-panel">
    <div className="section-heading"><div><h3>進行</h3></div></div>
    <div className="current-round"><span>{isComplete ? '終了' : '次のラウンド'}</span><strong>{isComplete ? '完' : `第${currentRound?.index ?? session.currentRound}R`}</strong></div>
    <button className="primary-button" type="button" onClick={onComplete} disabled={isComplete}>このラウンドを終了 <span>→</span></button>
    <button className="secondary-button" type="button" onClick={onUndo} disabled={!session.rounds.some((round) => round.status === 'completed')}>直前の終了を取り消す</button>
  </section>
}

function ChangePanel({
  addCategory,
  addCount,
  setAddCategory,
  setAddCount,
  onPreview,
  onClear,
}: {
  addCategory: Category
  addCount: string
  setAddCategory: (value: Category) => void
  setAddCount: (value: string) => void
  onPreview: () => void
  onClear: () => void
}) {
  return <section className="panel change-panel">
    <div className="section-heading"><div><h3>変更</h3></div></div>
    <div className="change-block"><p className="field-label">チームを追加</p><div className="inline-fields"><select value={addCategory} onChange={(event) => setAddCategory(event.target.value as Category)}><option value="advanced">アドバンス</option><option value="beginner">ビギナー</option></select><input type="number" min="0" value={addCount} onChange={(event) => setAddCount(event.target.value)} /><span>チーム</span></div></div>
    <div className="change-actions"><button className="primary-button" type="button" onClick={onPreview}>差分をプレビュー <span>→</span></button><button className="text-button" type="button" onClick={onClear}>入力をクリア</button></div>
  </section>
}

function PreviewPanel({ session, preview, onApply, onCancel }: { session: Session; preview: { nextSession: Session; diff: PlanDiff; reason: '途中参加' | '第1ラウンド調整' }; onApply: () => void; onCancel: () => void }) {
  const isOpeningAdjustment = preview.reason === '第1ラウンド調整'
  return <section className="panel preview-panel">
    <div className="section-heading"><div><h3>{isOpeningAdjustment ? '第1ラウンド調整の確認' : '差分プレビュー'}</h3><p>{isOpeningAdjustment ? `第1ラウンドを固定します。第2〜9ラウンドは${preview.diff.changedRounds.length}ラウンド・${preview.diff.changes.length}コートを変更` : `${preview.diff.changedRounds.length}ラウンド・${preview.diff.changes.length}コートが変更`}</p></div></div>
    {isOpeningAdjustment && <div className="opening-summary"><strong>固定する第1ラウンド</strong>{([1, 2, 3] as const).map((court) => {
      const match = preview.nextSession.rounds[0]?.matches.find((candidate) => candidate.court === court) ?? null
      return <div key={court}><span>コート{court}</span><b>{shortMatch(match, preview.nextSession)}</b></div>
    })}</div>}
    <div className="preview-list">{preview.diff.changes.length === 0 ? <p className="empty-line">対戦カードの変更はありません。</p> : preview.diff.changes.slice(0, 8).map((change) => <div className="preview-row" key={`${change.roundIndex}-${change.court}`}><span>第{change.roundIndex}R / C{change.court}</span><strong>{shortMatch(change.before, session)} <b>→</b> {shortMatch(change.after, preview.nextSession)}</strong></div>)}{preview.diff.changes.length > 8 && <p className="microcopy">ほか {preview.diff.changes.length - 8} 件。全9ラウンド表に反映されます。</p>}</div>
    <div className="preview-actions"><button className="primary-button" type="button" onClick={onApply}>この変更を確定 <span>→</span></button><button className="secondary-button" type="button" onClick={onCancel}>キャンセル</button></div>
  </section>
}

function shortMatch(match: Match | null, session: Session): string {
  if (!match) return '試合なし'
  const a = getTeamById(session, match.teamAId)?.displayName ?? '?'
  const b = getTeamById(session, match.teamBId)?.displayName ?? '?'
  return `${a}—${b}`
}

function TeamSummary({ stats }: { stats: ReturnType<typeof getTeamStats> }) {
  const groups: Category[] = ['advanced', 'beginner']
  return <section className="panel team-panel">
    <div className="section-heading"><div><h3>チーム集計</h3></div></div>
    <div className="stats-grid">
      {groups.map((category) => {
        const categoryStats = stats.filter((stat) => stat.team.category === category)
        return <div className="stats-group" key={category}>
          <div className="stats-group-title"><i className={category === 'advanced' ? 'advance-dot' : 'beginner-dot'} />{categoryLabelJa(category)}</div>
          <div className="stats-head"><span>チーム</span><span>終了</span><span>予定</span></div>
          {categoryStats.map((stat) => <div className="stats-row" key={stat.team.id}><span>{stat.team.displayName}</span><strong>{stat.completedMatches}</strong><strong>{stat.plannedMatches}</strong></div>)}
        </div>
      })}
    </div>
  </section>
}

function parseCount(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

export default App
