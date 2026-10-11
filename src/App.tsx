import { useEffect, useMemo, useState } from 'react'
import {
  categoryLabelJa,
  completeCurrentRound,
  createInitialSession,
  diffPlans,
  getTeamById,
  getTeamStats,
  recalculateSessionPlan,
  undoLastCompletedRound,
} from './domain/scheduler'
import { clearSession, loadSessionResult, saveSession } from './domain/storage'
import { Category, Match, PlanDiff, Round, Session } from './domain/types'
import logoImage from './assets/jmv-logo.png'

const DEFAULT_SEED = '20261011'
const initialStorage = loadSessionResult()

function App() {
  const [session, setSession] = useState<Session | null>(() => initialStorage.session)
  const [advancedCount, setAdvancedCount] = useState('4')
  const [beginnerCount, setBeginnerCount] = useState('5')
  const [addCategory, setAddCategory] = useState<Category>('advanced')
  const [addCount, setAddCount] = useState('1')
  const [preview, setPreview] = useState<{ nextSession: Session; diff: PlanDiff } | null>(null)
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
    if (advanced === null || beginner === null) {
      flash('チーム数は0以上の整数で入力してください。', 'warning')
      return
    }
    setSession(createInitialSession(advanced, beginner, DEFAULT_SEED))
    setPreview(null)
    flash('9ラウンドの対戦表を生成しました。')
  }

  const handleComplete = () => {
    if (!session || !currentRound || currentRound.status === 'completed') return
    setSession(completeCurrentRound(session))
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
    if (count === null || count < 0) {
      flash('追加チーム数は0以上の整数で入力してください。', 'warning')
      return
    }
    const result = recalculateSessionPlan(session, count === 0 ? null : addCategory, count)
    setPreview({ nextSession: result.session, diff: result.diff })
    if (result.diff.changes.length === 0 && count === 0) flash('変更はありません。', 'warning')
  }

  const handleApplyPreview = () => {
    if (!preview) return
    setSession({
      ...preview.nextSession,
      revisions: [...preview.nextSession.revisions, {
        id: `revision-${Date.now()}`,
        createdAt: new Date().toISOString(),
        reason: '途中参加',
        previousPlan: session?.rounds ?? [],
        nextPlan: preview.nextSession.rounds,
        confirmed: true,
      }],
    })
    setPreview(null)
    flash('変更を確定しました。未開始ラウンドだけ更新されています。')
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
            advancedCount={advancedCount}
            beginnerCount={beginnerCount}
            setAdvancedCount={setAdvancedCount}
            setBeginnerCount={setBeginnerCount}
            onGenerate={handleGenerate}
          />
        </main>
      ) : (
        <main className="workspace">
          <div className="main-grid">
            <div className="schedule-column">
              <ScheduleBoard session={session} />
              <TeamSummary stats={stats} />
            </div>
            <aside className="side-column">
              <ProgressPanel session={session} currentRound={currentRound} onComplete={handleComplete} onUndo={handleUndo} />
              <ChangePanel
                addCategory={addCategory}
                addCount={addCount}
                setAddCategory={setAddCategory}
                setAddCount={setAddCount}
                onPreview={handlePreview}
                onClear={() => setPreview(null)}
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
  advancedCount,
  beginnerCount,
  setAdvancedCount,
  setBeginnerCount,
  onGenerate,
}: {
  advancedCount: string
  beginnerCount: string
  setAdvancedCount: (value: string) => void
  setBeginnerCount: (value: string) => void
  onGenerate: () => void
}) {
  return <section className="setup-panel panel">
    <div className="section-heading"><div><h3>チーム数</h3></div></div>
    <div className="count-grid">
      <NumberField label="アドバンス" value={advancedCount} onChange={setAdvancedCount} />
      <NumberField label="ビギナー" value={beginnerCount} onChange={setBeginnerCount} />
    </div>
    <button className="primary-button" type="button" onClick={onGenerate}>対戦表を生成 <span>→</span></button>
  </section>
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="number-field"><span>{label}</span><input type="number" min="0" value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function ScheduleBoard({ session }: { session: Session }) {
  return <section className="panel schedule-panel">
    <div className="board-header section-heading"><div><h3>対戦表</h3></div></div>
    <div className="schedule-scroll">
      <div className="schedule-head"><div>ラウンド</div><div>コート 1 <span>ADVANCE</span></div><div>コート 2 <span>可変</span></div><div>コート 3 <span>BEGINNER</span></div></div>
      {session.rounds.map((round) => <RoundRow key={round.index} round={round} session={session} />)}
    </div>
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

function PreviewPanel({ session, preview, onApply, onCancel }: { session: Session; preview: { nextSession: Session; diff: PlanDiff }; onApply: () => void; onCancel: () => void }) {
  return <section className="panel preview-panel">
    <div className="section-heading"><div><h3>差分プレビュー</h3><p>{preview.diff.changedRounds.length}ラウンド・{preview.diff.changes.length}コートが変更</p></div></div>
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
