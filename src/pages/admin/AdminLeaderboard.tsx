import { useEffect, useState } from 'react';
import { getRankings, getEventSettings, exportFinalResults, exportAuctionHistory } from '../../lib/queries';
import { useTeamRealtime, useEventSettingsRealtime } from '../../hooks/useRealtime';
import { LoadingSpinner, Badge } from '../../components/ui';
import { formatCoins, downloadCSV } from '../../lib/utils';
import type { TeamWithRank, EventSettings } from '../../types';
import { Trophy, Medal, Download, BarChart3 } from 'lucide-react';

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

      {/* Top 4 Podium */}
      <div className="grid grid-cols-4 gap-4">
        {rankings.slice(0, 4).map((team, idx) => (
          <div key={team.id} className={`card text-center animate-scale-in ${
            idx === 0 ? 'neon-border glow-cyan' : 'neon-border'
          }`} style={{ animationDelay: `${idx * 100}ms` }}>
            <div className={`w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center ${
              idx === 0 ? 'bg-amber-500/20 text-amber-400' :
              idx === 1 ? 'bg-slate-400/20 text-slate-600' :
              idx === 2 ? 'bg-amber-700/20 text-amber-600' :
              'bg-cyan-500/10 text-cyan-400'
            }`}>
              {idx === 0 ? <Trophy size={24} /> : <Medal size={24} />}
            </div>
            <p className={`text-xs font-mono mb-1 ${idx === 0 ? 'text-amber-400' : 'text-slate-500'}`}>
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
                <tr key={team.id} className={`border-b border-dark-400/50 ${
                  team.rank <= 4 ? 'bg-cyan-500/5' : ''
                }`}>
                  <td className="py-4 px-4">
                    <span className={`font-mono font-bold text-lg ${
                      team.rank === 1 ? 'text-amber-400' :
                      team.rank <= 4 ? 'text-cyan-400' : 'text-slate-500'
                    }`}>
                      #{team.rank}
                    </span>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-slate-900 font-bold">{team.name}</span>
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
                    <Badge variant={isFinalized ? (team.qualified ? 'green' : 'red') : (team.rank <= 4 ? 'cyan' : 'default')}>
                      {isFinalized ? (team.qualified ? 'QUALIFIED' : 'ELIMINATED') : (team.rank <= 4 ? 'IN TOP 4' : 'AT RISK')}
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
