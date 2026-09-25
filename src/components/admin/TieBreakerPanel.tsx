import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  getTiebreakQuestions, createTiebreakQuestion, updateTiebreakQuestion,
  deleteTiebreakQuestion, startTiebreak, closeTiebreak, getTiebreakState,
  setTiebreakOrder, logEvent,
} from '../../lib/queries';
import { useTiebreakRealtime } from '../../hooks/useRealtime';
import { Modal, ConfirmModal, Badge, LoadingSpinner } from '../ui';
import { cn, formatCoins } from '../../lib/utils';
import type { McqKey, TiebreakQuestion, TiebreakState, TeamWithRank } from '../../types';
import { MCQ_KEYS, TIEBREAK_BANK_LIMIT } from '../../types';
import {
  Plus, Pencil, Trash2, Play, Square, Trophy, CheckCircle,
  Loader2, Clock, Users, ChevronRight,
} from 'lucide-react';

// ─── Question form (module scope — a component defined inside the page would be
// re-created on every keystroke, remount the inputs and drop the focus) ───────

type QuestionFormState = {
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_key: McqKey;
};

const EMPTY_QUESTION: QuestionFormState = {
  question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_key: 'A',
};

function QuestionForm({
  form, onFieldChange, onSubmit, onCancel, saving, isEdit,
}: {
  form: QuestionFormState;
  onFieldChange: <K extends keyof QuestionFormState>(field: K, value: QuestionFormState[K]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  isEdit: boolean;
}) {
  const optionValue: Record<McqKey, string> = {
    A: form.option_a, B: form.option_b, C: form.option_c, D: form.option_d,
  };
  const filled = (k: McqKey) => optionValue[k].trim() !== '';
  const keyHasOption = filled(form.correct_key);

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(); }} className="space-y-4">
      <div>
        <label className="block text-xs font-mono text-slate-400 mb-1">QUESTION *</label>
        <textarea value={form.question} onChange={e => onFieldChange('question', e.target.value)}
          className="input-field h-20 resize-none" required
          placeholder="Tie-breaker question..." />
      </div>

      <div>
        <label className="block text-xs font-mono text-slate-400 mb-1">
          OPTIONS * <span className="text-slate-600">— at least A and B; tap the letter to mark the answer</span>
        </label>
        <div className="space-y-2">
          {MCQ_KEYS.map(k => (
            <div key={k} className="flex items-center gap-2">
              <button
                type="button"
                title={`Mark ${k} as the correct answer`}
                onClick={() => filled(k) && onFieldChange('correct_key', k)}
                disabled={!filled(k)}
                className={cn(
                  'w-9 h-9 shrink-0 rounded-lg border font-mono text-sm font-bold transition-all',
                  form.correct_key === k && keyHasOption
                    ? 'bg-green-500/15 border-green-500/50 text-green-500'
                    : 'bg-dark-700 border-dark-400 text-slate-500 hover:border-green-500/40',
                  !filled(k) && 'opacity-40 cursor-not-allowed'
                )}
              >
                {k}
              </button>
              <input
                type="text"
                value={optionValue[k]}
                onChange={e => onFieldChange(`option_${k.toLowerCase()}` as 'option_a', e.target.value)}
                className="input-field"
                placeholder={k === 'A' || k === 'B' ? `Option ${k} (required)` : `Option ${k} (optional)`}
                required={k === 'A' || k === 'B'}
              />
            </div>
          ))}
        </div>
        {!keyHasOption && (
          <p className="text-xs font-mono text-amber-500 mt-2">
            The correct option has no text yet — fill the option in or mark another letter.
          </p>
        )}
      </div>

      <div className="flex gap-3 justify-end pt-2 border-t border-dark-400">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" className="btn-primary flex items-center gap-2"
          disabled={saving || !keyHasOption}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Save Question' : 'Add Question'}
        </button>
      </div>
    </form>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

/**
 * The tie-breaker round, from the quizmaster's seat.
 *
 * Run it in three moves: save up to three questions in the bank, start one in
 * front of as many teams as you like, then let the room answer — the first
 * correct answer wins and the button under the winner pays that ruling into the
 * standings. The manual ▲▼ controls on the Tie-Breaker Order card stay available
 * for the last adjustment.
 */
export default function TieBreakerPanel({
  teams, onOrderChanged,
}: {
  /** Ranked teams, so labels and tie groups always match the leaderboard. */
  teams: TeamWithRank[];
  onOrderChanged: () => void;
}) {
  const [questions, setQuestions] = useState<TiebreakQuestion[]>([]);
  const [state, setState] = useState<TiebreakState | null>(null);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showBank, setShowBank] = useState(false);
  const [editing, setEditing] = useState<TiebreakQuestion | null>(null);
  const [form, setForm] = useState<QuestionFormState>(EMPTY_QUESTION);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TiebreakQuestion | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [qs, st] = await Promise.all([getTiebreakQuestions(), getTiebreakState()]);
      setQuestions(qs);
      setState(st);
      setSelectedQuestionId(prev => (qs.some(q => q.id === prev) ? prev : qs[0]?.id || ''));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live updates: a round opening, a team answering, a winner being crowned.
  useTiebreakRealtime(() => { load(); });

  // ── Derived ────────────────────────────────────────────────────────────────

  const liveSession = state?.session?.status === 'open' ? state.session : null;
  const question = state?.question ?? null;
  const answers = state?.answers ?? [];
  const winnerId = state?.session?.winner_team_id ?? null;
  const winnerTeam = winnerId ? teams.find(t => t.id === winnerId) ?? null : null;

  /** Every team level with the given one on all three official metrics. */
  const tieGroupOf = useCallback((team: TeamWithRank | null) => {
    if (!team) return [] as TeamWithRank[];
    return teams.filter(t =>
      t.score === team.score &&
      t.current_budget === team.current_budget &&
      t.correct_answers === team.correct_answers
    );
  }, [teams]);

  // Quick picks: the groups the leaderboard already considers tied.
  const tiedGroups = useMemo(() => {
    const groups = new Map<string, TeamWithRank[]>();
    for (const t of teams) {
      const key = `${t.score}|${t.current_budget}|${t.correct_answers}`;
      const g = groups.get(key);
      if (g) g.push(t); else groups.set(key, [t]);
    }
    return [...groups.values()]
      .filter(g => g.length > 1)
      .sort((a, b) => a[0].rank - b[0].rank);
  }, [teams]);

  const selectedTeams = useMemo(
    () => teams.filter(t => selectedTeamIds.includes(t.id)),
    [teams, selectedTeamIds]
  );

  // A saved order only bites when the teams are level on points, TC and correct
  // answers — otherwise the three official keys already decide the ranks.
  const selectionIsLevel = selectedTeams.length > 1 && selectedTeams.every(t =>
    t.score === selectedTeams[0].score &&
    t.current_budget === selectedTeams[0].current_budget &&
    t.correct_answers === selectedTeams[0].correct_answers
  );

  const selectionSpansCut = selectedTeams.length > 1 &&
    selectedTeams.some(t => t.qualified) && selectedTeams.some(t => !t.qualified);

  const toggleTeam = (id: string) => {
    setSelectedTeamIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  const openAdd = () => { setEditing(null); setForm(EMPTY_QUESTION); setShowBank(true); };
  const openEdit = (q: TiebreakQuestion) => {
    setEditing(q);
    setForm({
      question: q.question,
      option_a: q.option_a, option_b: q.option_b,
      option_c: q.option_c ?? '', option_d: q.option_d ?? '',
      correct_key: q.correct_key,
    });
    setShowBank(true);
  };

  const handleSaveQuestion = async () => {
    setSaving(true);
    try {
      const payload = {
        question: form.question.trim(),
        option_a: form.option_a.trim(),
        option_b: form.option_b.trim(),
        option_c: form.option_c.trim() || null,
        option_d: form.option_d.trim() || null,
        correct_key: form.correct_key,
        sort_order: editing?.sort_order ?? questions.length + 1,
      };
      if (editing) {
        await updateTiebreakQuestion(editing.id, payload);
        await logEvent('tiebreak_question_updated', 'tiebreak_question', editing.id, { question: payload.question });
        toast.success('Tie-breaker question updated');
      } else {
        const created = await createTiebreakQuestion(payload);
        await logEvent('tiebreak_question_saved', 'tiebreak_question', created.id, { question: payload.question });
        toast.success('Tie-breaker question saved');
      }
      setEditing(null);
      setForm(EMPTY_QUESTION);
      setShowBank(false);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to save the question');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteQuestion = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTiebreakQuestion(deleteTarget.id);
      await logEvent('tiebreak_question_deleted', 'tiebreak_question', deleteTarget.id, { question: deleteTarget.question });
      setDeleteTarget(null);
      toast.success('Tie-breaker question deleted');
      await load();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete the question');
    } finally {
      setDeleting(false);
    }
  };

  const handleStart = async () => {
    if (!selectedQuestionId) { toast.error('Save a tie-breaker question first'); return; }
    if (selectedTeamIds.length === 0) { toast.error('Pick at least one team'); return; }
    setBusy(true);
    try {
      const res = await startTiebreak(selectedQuestionId, selectedTeamIds);
      await logEvent('tiebreak_started', 'tiebreak_session', res.session_id, {
        teams: selectedTeams.map(t => t.name),
      });
      await load();
      toast.success('Tie-breaker question is on the teams’ screens');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to start the tie-breaker');
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await closeTiebreak(state?.session?.id ?? null);
      await logEvent('tiebreak_stopped', 'tiebreak_session', state?.session?.id, {});
      await load();
      toast.success('Tie-breaker stopped');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to stop the tie-breaker');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Pay the winner's ruling into the standings. The whole tie group is written
   * in one call — winner first, everyone else in their current order — so the
   * group keeps a clean 0,1,2… sequence. Writing only the selected teams would
   * leave an uninvolved team of the same tie stranded on the default order and
   * silently drop it to the bottom of the group.
   */
  const handleApplyWinner = async () => {
    if (!winnerTeam) return;
    const group = tieGroupOf(winnerTeam);
    // Nothing to write when the winner is not actually level with anyone: an
    // override stored on a lone team would not change a single rank, it would
    // only badge the team as a tie-break winner and light up "Reset all".
    if (group.length < 2) {
      toast(`${winnerTeam.short_name} is not level with any other team — the standings already separate them`, { icon: 'ℹ️' });
      return;
    }

    const ordered = [winnerTeam, ...group.filter(t => t.id !== winnerTeam.id)];
    setBusy(true);
    try {
      await setTiebreakOrder(ordered.map(t => t.id));
      await logEvent('tiebreak_applied', 'team', winnerTeam.id, {
        winner: winnerTeam.name,
        order: ordered.map(t => t.name),
      });
      await load();
      onOrderChanged();
      toast.success(`${winnerTeam.short_name} placed first of the tie`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to apply the tie-break');
    } finally {
      setBusy(false);
    }
  };

  const setField = <K extends keyof QuestionFormState>(field: K, value: QuestionFormState[K]) =>
    setForm(p => ({ ...p, [field]: value }));

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="card"><LoadingSpinner text="Loading tie-breaker..." /></div>;
  }

  const optionText = (key: McqKey): string => {
    if (!question) return '';
    const value = key === 'A' ? question.option_a
      : key === 'B' ? question.option_b
      : key === 'C' ? question.option_c
      : question.option_d;
    return value ?? '';
  };

  const options = question
    ? MCQ_KEYS.map(k => ({ key: k, text: optionText(k) })).filter(o => o.text.trim() !== '')
    : [];

  const eligibleIds = state?.session?.eligible_team_ids ?? [];
  const eligible = teams.filter(t => eligibleIds.includes(t.id));

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Tie-Breaker Question</h2>
          <p className="text-xs font-mono text-slate-500 mt-1 tracking-wider">
            RUN A SAVED QUESTION IN FRONT OF THE TIED TEAMS — FIRST CORRECT ANSWER TAKES THE HIGHER PLACE
          </p>
        </div>
        <button onClick={openAdd} disabled={questions.length >= TIEBREAK_BANK_LIMIT}
          title={questions.length >= TIEBREAK_BANK_LIMIT ? `The bank holds ${TIEBREAK_BANK_LIMIT} questions` : 'Add a question'}
          className="btn-secondary text-xs flex items-center gap-2 shrink-0 disabled:opacity-40">
          <Plus size={12} /> Question ({questions.length}/{TIEBREAK_BANK_LIMIT})
        </button>
      </div>

      {questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center">
          <p className="text-sm text-slate-500 font-mono mb-3">
            No tie-breaker questions yet — save one before the event.
          </p>
          <button onClick={openAdd} className="btn-primary text-sm inline-flex items-center gap-2">
            <Plus size={14} /> Add tie-breaker question
          </button>
        </div>
      ) : (
        <>
          {/* ── Setup ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-mono text-slate-500 mb-2 tracking-wider">
                QUESTION TO ASK
              </label>
              <select
                value={selectedQuestionId}
                onChange={e => setSelectedQuestionId(e.target.value)}
                className="input-field"
              >
                {questions.map((q, i) => (
                  <option key={q.id} value={q.id}>
                    {i + 1}. {q.question.length > 70 ? `${q.question.slice(0, 70)}…` : q.question}
                  </option>
                ))}
              </select>

              {questions.length > 1 && (
                <div className="mt-3 space-y-1.5">
                  {questions.map(q => (
                    <div key={q.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                      <span className={cn(
                        'flex-1 min-w-0 truncate text-xs',
                        q.id === selectedQuestionId ? 'text-slate-900 font-bold' : 'text-slate-500'
                      )}>
                        {q.question}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-green-500">KEY {q.correct_key}</span>
                      <button onClick={() => openEdit(q)} title="Edit"
                        className="shrink-0 text-slate-400 hover:text-cyan-500 transition-colors">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => setDeleteTarget(q)} title="Delete"
                        className="shrink-0 text-slate-400 hover:text-red-500 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {questions.length === 1 && (
                <div className="mt-3 flex items-center gap-3">
                  <button onClick={() => openEdit(questions[0])}
                    className="text-xs font-mono text-slate-500 hover:text-cyan-600 transition-colors inline-flex items-center gap-1">
                    <Pencil size={11} /> edit
                  </button>
                  <button onClick={() => setDeleteTarget(questions[0])}
                    className="text-xs font-mono text-slate-500 hover:text-red-500 transition-colors inline-flex items-center gap-1">
                    <Trash2 size={11} /> delete
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="flex items-center gap-2 text-xs font-mono text-slate-500 mb-2 tracking-wider">
                <Users size={12} /> TEAMS IN THE TIE-BREAK ({selectedTeamIds.length})
              </label>

              {tiedGroups.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {tiedGroups.map(g => (
                    <button
                      key={`${g[0].score}-${g[0].current_budget}-${g[0].correct_answers}`}
                      onClick={() => setSelectedTeamIds(g.map(t => t.id))}
                      className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-1 text-xs font-mono text-amber-600 hover:border-amber-500 transition-colors"
                    >
                      tied at #{g[0].rank} · {g.length} teams
                    </button>
                  ))}
                </div>
              )}

              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {teams.map(t => {
                  const on = selectedTeamIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTeam(t.id)}
                      className={cn(
                        'w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all',
                        on ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-200 bg-slate-50 hover:border-cyan-500/30'
                      )}
                    >
                      <span className={cn(
                        'w-5 h-5 shrink-0 rounded border flex items-center justify-center',
                        on ? 'bg-cyan-500 border-cyan-500 text-white' : 'border-slate-300'
                      )}>
                        {on && <CheckCircle size={12} />}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-sm font-bold text-slate-900">
                        {t.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-500">
                        {t.score} pts · {formatCoins(t.current_budget)} TC
                      </span>
                      <span className={cn(
                        'shrink-0 font-mono text-[11px]',
                        t.qualified ? 'text-green-500' : 'text-slate-400'
                      )}>
                        #{t.rank}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedTeams.length > 1 && !selectionIsLevel && (
                <p className="text-xs font-mono text-amber-500 mt-2">
                  These teams are not level on points, TC and correct answers — the result will be
                  recorded but the standing order will not change.
                </p>
              )}
              {selectionSpansCut && (
                <p className="text-xs font-mono text-amber-500 mt-2">
                  This tie decides the cut — the winner may knock a team out of the top 6.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-dark-400">
            <button onClick={handleStart} disabled={busy || selectedTeamIds.length === 0}
              className="btn-primary flex items-center gap-2 disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {liveSession ? 'Replace the live round' : 'Start Tie-Breaker'}
            </button>
            {liveSession && (
              <button onClick={handleStop} disabled={busy}
                className="btn-secondary flex items-center gap-2 text-sm">
                <Square size={13} /> Stop round
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Live round ─────────────────────────────────────────────────────── */}
      {state?.session && question && (
        <div className={cn(
          'mt-5 rounded-xl border p-4',
          liveSession ? 'border-violet-500/40 bg-violet-500/5' : 'border-slate-200 bg-slate-50'
        )}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {liveSession
              ? <Badge variant="violet">LIVE ON TEAM SCREENS</Badge>
              : winnerTeam
                ? <Badge variant="green">SETTLED</Badge>
                : <Badge variant="amber">CLOSED — NO CORRECT ANSWER</Badge>}
            <span className="text-xs font-mono text-slate-500">
              {eligible.length} TEAM{eligible.length === 1 ? '' : 'S'} · STARTED{' '}
              {new Date(state.session.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          <p className="text-slate-900 font-bold mb-3">{question.question}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {options.map(o => {
              const isKey = question.correct_key === o.key;
              return (
                <div key={o.key} className={cn(
                  'flex items-center gap-3 rounded-lg border px-3 py-2',
                  isKey ? 'border-green-500/50 bg-green-500/10' : 'border-slate-200 bg-white'
                )}>
                  <span className={cn(
                    'w-7 h-7 shrink-0 rounded-md flex items-center justify-center font-mono text-xs font-bold',
                    isKey ? 'bg-green-500 text-white' : 'bg-dark-700 text-slate-500'
                  )}>
                    {o.key}
                  </span>
                  <span className="text-sm text-slate-900">{o.text}</span>
                </div>
              );
            })}
          </div>

          {question.correct_key === null && (
            <p className="text-xs font-mono text-slate-500 mb-3">
              The answer key stays hidden until the round is closed.
            </p>
          )}

          <div className="space-y-1.5">
            {eligible.map(t => {
              const answer = answers.find(a => a.team_id === t.id);
              return (
                <div key={t.id} className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2',
                  answer ? 'bg-dark-700' : 'bg-dark-800'
                )}>
                  <span className="w-5 text-xs font-mono text-slate-500">
                    {answer ? <CheckCircle size={13} className="text-cyan-400" /> : <Clock size={13} />}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm font-bold text-slate-900">{t.name}</span>
                  {answer ? (
                    <>
                      {answer.selected_key && (
                        <span className={cn(
                          'shrink-0 font-mono text-xs',
                          answer.is_correct === true ? 'text-green-500'
                            : answer.is_correct === false ? 'text-red-500' : 'text-slate-500'
                        )}>
                          {answer.selected_key}
                          {answer.is_correct === true && ' ✓'}
                          {answer.is_correct === false && ' ✗'}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[11px] text-slate-500">
                        {new Date(answer.answered_at).toLocaleTimeString([], {
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                      </span>
                      {t.id === winnerId && <Trophy size={14} className="shrink-0 text-amber-400" />}
                    </>
                  ) : (
                    <span className="shrink-0 font-mono text-[11px] text-slate-500">WAITING</span>
                  )}
                </div>
              );
            })}
          </div>

          {winnerTeam && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
              <Trophy size={18} className="text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900">
                  {winnerTeam.name} answered first
                </p>
                <p className="text-xs font-mono text-slate-500">
                  {tieGroupOf(winnerTeam).length > 1
                    ? 'Apply to move them to the top of their tie'
                    : 'No tied team to reorder — the standings already agree'}
                </p>
              </div>
              <button
                onClick={handleApplyWinner}
                disabled={busy || !winnerTeam || tieGroupOf(winnerTeam).length < 2}
                title={winnerTeam && tieGroupOf(winnerTeam).length < 2
                  ? 'No tied team to reorder'
                  : 'Move the winner to the top of its tie'}
                className="btn-amber text-sm flex items-center gap-2 disabled:opacity-40"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={14} />}
                Place first
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Bank modal ─────────────────────────────────────────────────────── */}
      <Modal
        isOpen={showBank}
        onClose={() => { setShowBank(false); setEditing(null); setForm(EMPTY_QUESTION); }}
        title={editing ? 'Edit tie-breaker question' : 'New tie-breaker question'}
      >
        <QuestionForm
          form={form}
          onFieldChange={setField}
          onSubmit={handleSaveQuestion}
          onCancel={() => { setShowBank(false); setEditing(null); setForm(EMPTY_QUESTION); }}
          saving={saving}
          isEdit={!!editing}
        />
      </Modal>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteQuestion}
        title="Delete question"
        message={deleteTarget ? `Delete “${deleteTarget.question}”? Any round still using it is removed too.` : ''}
        confirmText="Delete"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
