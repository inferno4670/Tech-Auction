import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  getRankings, getEventSettings, exportFinalResults, exportAuctionHistory,
  setTiebreakOrder, logEvent,
} from '../../lib/queries';
import { useTeamRealtime, useEventSettingsRealtime } from '../../hooks/useRealtime';
import { LoadingSpinner, Badge } from '../../components/ui';
import { formatCoins, downloadCSV, cn, podiumRowClass, podiumRankClass, podiumLabel } from '../../lib/utils';
import type { TeamWithRank, EventSettings } from '../../types';
import { TOP_QUALIFY_COUNT } from '../../types';
import { Trophy, Medal, Download, BarChart3, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';

export default function AdminLeaderboard() {
  const [rankings, setRankings] = useState<TeamWithRank[]>([]);
  const [settings, setSettings] = useState<EventSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [r, s] = await Promise.all([getRankings(), getEventSettings()]);
      setRankings(r);
      setSettings(s);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);
  useTeamRealtime(() => { loadData(); });
  useEventSettingsRealtime(() => { loadData(); });

  // ── Tie-breaker ordering ────────────────────────────────────────────────────
  //
  // Teams level on points, Tech Coins AND correct answers used to be split
  // alphabetically — an accident of naming, not a result. A tie-breaker round
  // settles it properly, and the quizmaster records that decision here. It is
  // stored on the team, so the projector, every team panel and the live control
  // all follow it automatically.
  //
  // Only groups that are genuinely tied can be reordered, which is what makes
  // this safe to use mid-event: it can never lift a team past one it actually
  // outscored.
  const [savingOrder, setSavingOrder] = useState(false);

  // rankings is already in effective order, so each group keeps that order.
  const tiedGroups = useMemo(() => {
    const groups = new Map<string, TeamWithRank[]>();
    for (const team of rankings) {
      const key = `${team.score}|${team.current_budget}|${team.correct_answers}`;
      const group = groups.get(key);
      if (group) group.push(team);
      else groups.set(key, [team]);
    }
    return [...groups.values()]
      .filter(group => group.length > 1)
      .sort((a, b) => a[0].rank - b[0].rank);
  }, [rankings]);

  const hasOverrides = rankings.some(t => t.tiebreak_order !== null);

  /** Move a team one place inside its tied group and persist the new order. */
  const moveInTie = async (group: TeamWithRank[], index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= group.length) return;

    const reordered = [...group];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    setSavingOrder(true);
    try {
      await setTiebreakOrder(reordered.map(t => t.id));
      await logEvent('tiebreak_reordered', 'team', reordered[0].id, {
        order: reordered.map(t => t.name),
        score: reordered[0].score,
      });
      await loadData();

      // Only worth flagging when the ruling actually moved the cut-off.
      const straddlesCut = reordered.some(t => t.rank <= TOP_QUALIFY_COUNT)
        && reordered.some(t => t.rank > TOP_QUALIFY_COUNT);
      toast.success(straddlesCut ? 'Tie-break saved — the cut-off changed' : 'Tie-break order saved');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to save the tie-break');
    } finally {
      setSavingOrder(false);
    }
  };

  /** Hand one group — or every team — back to the automatic order. */
  const resetTie = async (group: TeamWithRank[] | null) => {
    setSavingOrder(true);
    try {
      await setTiebreakOrder(group ? group.map(t => t.id) : null, true);
      await logEvent('tiebreak_reset', 'team', group?.[0]?.id || undefined, {
        teams: group ? group.map(t => t.name) : 'all',
      });
      await loadData();
      toast.success(group ? 'Tie-break reset for this group' : 'All tie-break overrides cleared');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to reset the tie-break');
    } finally {
      setSavingOrder(false);
    }
  };

  const handleExportResults = async () => {
    const csv = await exportFinalResults();
    downloadCSV(csv, 'tech-auction-final-results.csv');
  };

  const handleExportHistory = async () => {
    const csv = await exportAuctionHistory();
    downloadCSV(csv, 'tech-auction-history.csv');
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><LoadingSpinner text="Loading leaderboard..." /></div>;
  }

  const isFinalized = settings?.status === 'finalized';

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Leaderboard</h1>
          <p className="text-sm text-slate-500 font-mono mt-1">
            {isFinalized ? 'FINAL RESULTS' : 'LIVE RANKINGS'}
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleExportResults} className="btn-secondary text-sm flex items-center gap-2">
            <Download size={14} /> Export Results CSV
          </button>
          <button onClick={handleExportHistory} className="btn-secondary text-sm flex items-center gap-2">
            <BarChart3 size={14} /> Export History CSV
          </button>
        </div>
      </div>

      {/* Qualifier Podium — gold / silver / bronze on the top three */}
      <div className="grid grid-cols-6 gap-4">
        {rankings.slice(0, TOP_QUALIFY_COUNT).map((team, idx) => (
          <div key={team.id} title={podiumLabel(team.rank)} className={cn(
            'card text-center animate-scale-in',
            idx === 0 ? 'neon-border glow-cyan' : 'neon-border',
            podiumRowClass(team.rank)
          )} style={{ animationDelay: `${idx * 100}ms` }}>
            <div className={cn(
              'w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center',
              podiumRankClass(team.rank) || 'bg-cyan-500/10 text-cyan-400'
            )}>
              {idx === 0 ? <Trophy size={24} /> : <Medal size={24} />}
            </div>
            <p className={`text-xs font-mono mb-1 ${idx === 0 ? 'text-amber-700' : 'text-slate-500'}`}>
              #{team.rank}
            </p>
            <p className="text-lg font-bold text-slate-900 mb-2">{team.short_name}</p>
            <p className={`text-2xl font-mono font-bold ${idx === 0 ? 'text-cyan-400 text-glow-cyan' : 'text-slate-900'}`}>
              {team.score}
            </p>
            <p className="text-xs font-mono text-cyan-400 mt-1">{team.current_budget} TC</p>
            {isFinalized && (
              <Badge variant="green" className="mt-3">QUALIFIED</Badge>
            )}
          </div>
        ))}
      </div>

      {/* Tie-breaker order — the quizmaster's ruling when teams are level */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Tie-Breaker Order</h2>
            <p className="text-xs font-mono text-slate-500 mt-1 tracking-wider">
              TEAMS LEVEL ON POINTS, TC AND CORRECT ANSWERS — RANK THEM BY THE TIE-BREAKER ROUND
            </p>
          </div>
          {hasOverrides && (
            <button
              onClick={() => resetTie(null)}
              disabled={savingOrder}
              className="btn-secondary text-xs flex items-center gap-2 shrink-0"
            >
              <RotateCcw size={12} /> Reset all
            </button>
          )}
        </div>

        {tiedGroups.length === 0 ? (
          <p className="text-sm text-slate-500 font-mono">
            No ties right now — every rank is already decided by points → Tech Coins → correct answers.
          </p>
        ) : (
          <div className="space-y-4">
            {tiedGroups.map(group => {
              // A group that spans the qualification line decides who advances.
              const straddlesCut =
                group.some(t => t.rank <= TOP_QUALIFY_COUNT) &&
                group.some(t => t.rank > TOP_QUALIFY_COUNT);
              const manual = group.some(t => t.tiebreak_order !== null);

              return (
                <div
                  // Stable across reorders: keyed on the tie itself, not on
                  // whichever team happens to sit at the top of the group.
                  key={`${group[0].score}-${group[0].current_budget}-${group[0].correct_answers}`}
                  className={cn(
                    'rounded-xl border p-3',
                    straddlesCut ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-200'
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs font-mono text-slate-500 tracking-wider">
                      TIED AT #{group[0].rank} · {group.length} TEAMS · {group[0].score} PTS ·{' '}
                      {formatCoins(group[0].current_budget)} TC
                    </span>
                    {straddlesCut && <Badge variant="amber">DECIDES THE CUT</Badge>}
                    {manual && <Badge variant="cyan">MANUAL</Badge>}
                    {manual && (
                      <button
                        onClick={() => resetTie(group)}
                        disabled={savingOrder}
                        className="text-xs font-mono text-slate-500 hover:text-cyan-600 transition-colors"
                      >
                        reset
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {group.map((team, idx) => (
                      <div
                        key={team.id}
                        className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <span
                          className={cn(
                            'inline-flex w-9 h-9 shrink-0 items-center justify-center rounded-lg font-mono font-bold',
                            podiumRankClass(team.rank) || 'text-slate-500'
                          )}
                        >
                          #{team.rank}
                        </span>
                        <span className="flex-1 min-w-0 truncate font-bold text-slate-900">{team.name}</span>
                        <span className="shrink-0 font-mono text-xs text-green-500">
                          {team.correct_answers} ✓
                        </span>
                        <span className="shrink-0 font-mono text-xs text-cyan-500">
                          {formatCoins(team.current_budget)} TC
                        </span>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => moveInTie(group, idx, -1)}
                            disabled={idx === 0 || savingOrder}
                            title="Move up"
                            className="p-1.5 rounded-lg border border-slate-300 text-slate-500 hover:text-cyan-600 hover:border-cyan-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={() => moveInTie(group, idx, 1)}
                            disabled={idx === group.length - 1 || savingOrder}
                            title="Move down"
                            className="p-1.5 rounded-lg border border-slate-300 text-slate-500 hover:text-cyan-600 hover:border-cyan-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Full Table */}
      <div className="card">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Complete Rankings</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-400">
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">RANK</th>
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">TEAM</th>
                <th className="text-right py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">SCORE</th>
                <th className="text-right py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">TECH COINS</th>
                <th className="text-center py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">CORRECT</th>
                <th className="text-center py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">WRONG</th>
                <th className="text-center py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">WON</th>
                <th className="text-center py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(team => (
                <tr key={team.id} title={podiumLabel(team.rank)} className={cn(
                  'border-b border-dark-400/50',
                  podiumRowClass(team.rank) || (team.rank <= TOP_QUALIFY_COUNT ? 'bg-cyan-500/5' : '')
                )}>
                  <td className="py-4 px-4">
                    <span className={cn(
                      'inline-flex w-9 h-9 items-center justify-center rounded-lg font-mono font-bold text-lg',
                      podiumRankClass(team.rank) ||
                        (team.rank <= TOP_QUALIFY_COUNT ? 'text-cyan-400' : 'text-slate-500')
                    )}>
                      #{team.rank}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-900 font-bold">{team.name}</span>
                      {team.tiebreak_order !== null && (
                        <span title={`Manual tie-break position #${team.tiebreak_order + 1} within its tie`}>
                          <Badge variant="cyan">TIE-BREAK</Badge>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="font-mono font-bold text-xl text-slate-900">{formatCoins(team.score)}</span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <span className="font-mono text-cyan-400">{formatCoins(team.current_budget)}</span>
                  </td>
                  <td className="py-4 px-4 text-center">
                    <span className="font-mono text-green-400">{team.correct_answers}</span>
                  </td>
                  <td className="py-4 px-4 text-center">
                    <span className="font-mono text-red-400">{team.wrong_answers}</span>
                  </td>
                  <td className="py-4 px-4 text-center">
                    <span className="font-mono text-violet-400">{team.auctions_won}</span>
                  </td>
                  <td className="py-4 px-4 text-center">
                    <Badge variant={isFinalized ? (team.qualified ? 'green' : 'red') : (team.rank <= TOP_QUALIFY_COUNT ? 'cyan' : 'default')}>
                      {isFinalized
                        ? (team.qualified ? 'QUALIFIED' : 'ELIMINATED')
                        : (team.rank <= TOP_QUALIFY_COUNT ? 'IN THE CUT' : 'AT RISK')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
