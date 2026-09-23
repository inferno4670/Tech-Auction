import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRankings, getEventSettings, updateEventSettings } from '../../lib/queries';
import { useEventSettingsRealtime, useOnlineTeams } from '../../hooks/useRealtime';
import { StatCard, Badge, ConfirmModal, LoadingSpinner } from '../../components/ui';
import { formatCoins } from '../../lib/utils';
import type { TeamWithRank, EventSettings } from '../../types';
import {
  Trophy, Coins, Users, Gavel, Zap, Play, Pause,
  RotateCcw, CheckCircle, AlertTriangle, ArrowRight
} from 'lucide-react';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [rankings, setRankings] = useState<TeamWithRank[]>([]);
  const [settings, setSettings] = useState<EventSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);

  const loadData = async () => {
    try {
      const [r, s] = await Promise.all([getRankings(), getEventSettings()]);
      setRankings(r);
      setSettings(s);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Realtime updates
  useEventSettingsRealtime(() => { loadData(); });
  const onlineTeams = useOnlineTeams();

  const handleStatusChange = async (newStatus: string) => {
    if (!settings) return;
    try {
      await updateEventSettings(settings.id, { status: newStatus as any });
      await loadData();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleFinalize = async () => {
    await handleStatusChange('finalized');
    setShowFinalizeConfirm(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner text="Loading dashboard..." />
      </div>
    );
  }

  const totalScore = rankings.reduce((sum, t) => sum + t.score, 0);
  const statusLabel = settings?.status?.toUpperCase() || 'SETUP';

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500 font-mono mt-1">
            {settings?.event_name || 'TECH AUCTION'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={settings?.status === 'live' ? 'green' : settings?.status === 'finalized' ? 'violet' : 'amber'}>
            {statusLabel}
          </Badge>
          {settings?.demo_mode && (
            <Badge variant="amber">DEMO MODE</Badge>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Teams" value={rankings.length} color="cyan" icon={<Users size={16} />} />
        <StatCard
          label="Top Score"
          value={rankings.length > 0 ? rankings[0].score : 0}
          color="green"
          icon={<Trophy size={16} />}
        />
        <StatCard
          label="Total Points"
          value={totalScore}
          color="violet"
          icon={<Gavel size={16} />}
        />
        <StatCard
          label="Budget"
          value={settings?.starting_budget || 1000}
          color="amber"
          icon={<Coins size={16} />}
          suffix=" TC"
        />
      </div>

      {/* Status Controls */}
      <div className="card">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Event Status</h2>
        <div className="flex flex-wrap gap-3">
          {settings?.status === 'setup' && (
            <button
              onClick={() => handleStatusChange('lobby')}
              className="btn-primary flex items-center gap-2"
            >
              <Play size={16} />
              ENTER LOBBY
            </button>
          )}
          {settings?.status === 'lobby' && (
            <>
              <button
                onClick={() => handleStatusChange('live')}
                className="btn-success flex items-center gap-2"
              >
                <Zap size={16} />
                START LIVE EVENT
              </button>
              <button
                onClick={() => handleStatusChange('setup')}
                className="btn-secondary flex items-center gap-2"
              >
                <ArrowRight size={16} className="rotate-180" />
                Back to Setup
              </button>
            </>
          )}
          {settings?.status === 'live' && (
            <>
              <button
                onClick={() => handleStatusChange('paused')}
                className="btn-amber flex items-center gap-2"
              >
                <Pause size={16} />
                PAUSE
              </button>
              <button
                onClick={() => setShowFinalizeConfirm(true)}
                className="btn-danger flex items-center gap-2"
              >
                <CheckCircle size={16} />
                END ROUND
              </button>
            </>
          )}
          {settings?.status === 'paused' && (
            <button
              onClick={() => handleStatusChange('live')}
              className="btn-success flex items-center gap-2"
            >
              <Play size={16} />
              RESUME
            </button>
          )}
          {settings?.status === 'finalized' && (
            <div className="flex items-center gap-3">
              <Badge variant="green">
                <CheckCircle size={12} className="mr-1" />
                ROUND FINALIZED
              </Badge>
              <button
                onClick={() => handleStatusChange('setup')}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <RotateCcw size={14} />
                Reset for New Round
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Team Rankings Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-slate-900">Team Rankings</h2>
          <button
            onClick={() => navigate('/admin/leaderboard')}
            className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors font-mono"
          >
            Full Leaderboard →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-400">
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">RANK</th>
                <th className="text-left py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">TEAM</th>
                <th className="text-right py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">SCORE</th>
                <th className="text-right py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">TECH COINS</th>
                <th className="text-center py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">CORRECT</th>
                <th className="text-center py-3 px-4 text-xs font-mono text-slate-500 tracking-wider">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(team => (
                <tr
                  key={team.id}
                  className="border-b border-dark-400/50 hover:bg-slate-100/50 transition-colors"
                >
                  <td className="py-3 px-4">
                    <span className={`font-mono font-bold ${
                      team.rank <= 6 ? 'text-cyan-400' : 'text-slate-500'
                    }`}>
                      #{team.rank}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                          team.rank <= 6
                            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                            : 'bg-dark-500 text-slate-500 border border-dark-400'
                        }`}>
                          {team.short_name}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                          onlineTeams.has(team.id) ? 'bg-green-400' : 'bg-slate-300'
                        }`} />
                      </div>
                      <span className="text-slate-900 font-medium">{team.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="font-mono font-bold text-slate-900">{formatCoins(team.score)}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="font-mono text-cyan-400">{formatCoins(team.current_budget)}</span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="font-mono text-green-400">{team.correct_answers}</span>
                    <span className="text-slate-600 mx-1">/</span>
                    <span className="font-mono text-red-400">{team.wrong_answers}</span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Badge variant={team.rank <= 6 ? 'green' : 'default'}>
                      {settings?.status === 'finalized'
                        ? (team.qualified ? 'QUALIFIED' : 'ELIMINATED')
                        : (team.rank <= 6 ? 'IN POSITION' : 'AT RISK')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rankings.length === 0 && (
          <div className="text-center py-12">
            <AlertTriangle className="mx-auto text-slate-600 mb-3" size={32} />
            <p className="text-slate-500">No teams configured yet.</p>
            <button
              onClick={() => navigate('/admin/teams')}
              className="btn-secondary mt-4 text-sm"
            >
              Set Up Teams
            </button>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => navigate('/admin/live')}
          className="card hover:border-cyan-500/30 transition-all duration-200 text-left group"
        >
          <Zap className="text-cyan-400 mb-3 group-hover:animate-pulse" size={24} />
          <h3 className="text-slate-900 font-bold mb-1">Live Control</h3>
          <p className="text-sm text-slate-500">Control auctions, bidding, and questions</p>
        </button>
        <button
          onClick={() => navigate('/admin/auctions')}
          className="card hover:border-violet-500/30 transition-all duration-200 text-left group"
        >
          <Gavel className="text-violet-400 mb-3" size={24} />
          <h3 className="text-slate-900 font-bold mb-1">Auction Items</h3>
          <p className="text-sm text-slate-500">Manage auction items and questions</p>
        </button>
        <button
          onClick={() => window.open('/display', '_blank')}
          className="card hover:border-amber-500/30 transition-all duration-200 text-left group"
        >
          <Trophy className="text-amber-400 mb-3" size={24} />
          <h3 className="text-slate-900 font-bold mb-1">Display Screen</h3>
          <p className="text-sm text-slate-500">Open projector display for the audience</p>
        </button>
      </div>

      <ConfirmModal
        isOpen={showFinalizeConfirm}
        onClose={() => setShowFinalizeConfirm(false)}
        onConfirm={handleFinalize}
        title="End Round"
        message="Are you sure you want to end the round? This will finalize all rankings and freeze all scores. This action cannot be undone."
        confirmText="END ROUND"
        variant="danger"
      />
    </div>
  );
}
