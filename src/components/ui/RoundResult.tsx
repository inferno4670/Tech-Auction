import { CheckCircle, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { RoundResult } from '../../types';

// ─── Round-result announcements ──────────────────────────────────────────────
//
// Both views render the same fact sheet: which team answered, right or wrong,
// the TC swing, and — on a miss — the correct option. `graded_by` tells the
// audience whether the database verified the pick or the quizmaster marked it.

function tcDelta(result: RoundResult) {
  return result.result === 'correct' ? `+${result.reward} TC` : `−${result.penalty} TC`;
}

function sourceLabel(result: RoundResult) {
  return result.graded_by === 'auto' ? 'auto-verified' : 'graded by quizmaster';
}

/** Compact card used inside toasts on the admin panel and team dashboards. */
export function RoundResultToast({ result }: { result: RoundResult }) {
  const correct = result.result === 'correct';

  return (
    <div
      className={cn(
        'min-w-[300px] max-w-[400px] rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md',
        correct
          ? 'bg-green-500/10 border-green-500/40'
          : 'bg-red-500/10 border-red-500/40'
      )}
    >
      <div className="flex items-center gap-2">
        {correct
          ? <CheckCircle className="text-green-400 shrink-0" size={18} />
          : <XCircle className="text-red-400 shrink-0" size={18} />}
        <p className={cn('font-bold text-sm', correct ? 'text-green-400' : 'text-red-400')}>
          {result.team_name || 'Team'} answered {correct ? 'CORRECTLY' : 'WRONG'}
        </p>
      </div>
      <p className="text-sm font-mono text-slate-900 mt-1">
        {tcDelta(result)}
        <span className="text-slate-500">
          {correct ? ' — bid refunded + 150 TC bonus' : ' — bid lost'}
        </span>
      </p>
      <p className="mt-1 break-words text-[11px] font-mono text-slate-500">
        {result.item_name || 'Item'} · {sourceLabel(result)}
      </p>
      {!correct && result.correct_answer && (
        <p className="mt-1 break-words text-[11px] font-mono text-amber-400">
          Correct answer: {result.correct_answer}
        </p>
      )}
    </div>
  );
}

/** Full-screen announcement for the projector. */
export function RoundResultOverlay({ result }: { result: RoundResult }) {
  const correct = result.result === 'correct';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/85 backdrop-blur-sm animate-fade-in">
      <div
        className={cn(
          'max-w-4xl w-full mx-8 rounded-3xl border p-12 text-center animate-scale-in',
          correct
            ? 'bg-green-500/10 border-green-500/40 glow-green'
            : 'bg-red-500/10 border-red-500/40 glow-red'
        )}
      >
        {correct
          ? <CheckCircle className="mx-auto text-green-400 mb-6" size={72} />
          : <XCircle className="mx-auto text-red-400 mb-6" size={72} />}

        <p className={cn('text-6xl font-black tracking-tight mb-3', correct ? 'text-green-400' : 'text-red-400')}>
          {correct ? 'CORRECT!' : 'WRONG!'}
        </p>
        <p className="break-words text-4xl font-bold text-slate-900 mb-6">{result.team_name || 'Team'}</p>

        <p className={cn('break-words text-5xl font-mono font-black mb-8', correct ? 'text-cyan-400 text-glow-cyan' : 'text-red-400')}>
          {tcDelta(result)}
          <span className="text-xl text-slate-400 font-bold ml-3">
            {correct ? 'bid refunded + 150 TC bonus' : 'bid lost'}
          </span>
        </p>

        {!correct && result.correct_answer && (
          <p className="break-words text-2xl font-mono text-amber-400 mb-6">
            Correct answer: {result.correct_answer}
          </p>
        )}

        <p className="break-words text-sm font-mono text-slate-500 tracking-widest">
          {result.item_name || 'ITEM'} · {sourceLabel(result).toUpperCase()}
        </p>
      </div>
    </div>
  );
}

/** One-line strip for panels that should keep the last verdict on screen. */
export function RoundResultStrip({ result, className }: { result: RoundResult; className?: string }) {
  const correct = result.result === 'correct';

  return (
    // Two rows so nothing can ever collide or overflow a narrow card: the
    // verdict line lets the team name truncate while the CORRECT/WRONG badge
    // and the TC swing stay pinned (shrink-0); on a miss the correct answer
    // gets its own full-width, word-breaking line below instead of being
    // crammed inline where it used to overlap the verdict.
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-2 min-w-0">
        {correct
          ? <CheckCircle className="text-green-400 shrink-0" size={16} />
          : <XCircle className="text-red-400 shrink-0" size={16} />}
        <span className="min-w-0 truncate font-bold text-sm text-slate-900">
          {result.team_name || 'Team'}
        </span>
        <span className={cn('shrink-0 text-xs font-mono font-bold', correct ? 'text-green-400' : 'text-red-400')}>
          {correct ? 'CORRECT' : 'WRONG'}
        </span>
        <span className={cn('ml-auto shrink-0 font-mono font-bold', correct ? 'text-cyan-400' : 'text-red-400')}>
          {tcDelta(result)}
        </span>
      </div>
      {!correct && result.correct_answer && (
        <p className="break-words text-xs font-mono text-amber-500">
          ans: {result.correct_answer}
        </p>
      )}
    </div>
  );
}
