import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getRankings, getCurrentAuction, getEventSettings, getBidsForAuction
} from '../../lib/queries';
import { useAuctionRealtime, useTeamRealtime, useEventSettingsRealtime, useBidRealtime } from '../../hooks/useRealtime';
import { useAutoCloseBidding } from '../../hooks/useAutoCloseBidding';
import { useRoundResults } from '../../hooks/useRoundResults';
import { Badge, Logo, RoundResultStrip, RoundResultOverlay } from '../../components/ui';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { formatTime, cn, podiumRowClass, podiumRankClass, podiumLabel } from '../../lib/utils';
import { syncServerTime, serverNow, remainingSeconds } from '../../lib/serverTime';
import type { TeamWithRank, AuctionWithItem, EventSettings, Bid } from '../../types';
import { MCQ_KEYS, TOP_QUALIFY_COUNT } from '../../types';
import { Trophy, Clock, Gavel, CheckCircle } from 'lucide-react';

export default function DisplayPage() {
  const [rankings, setRankings] = useState<TeamWithRank[]>([]);
  const [auction, setAuction] = useState<AuctionWithItem | null>(null);
  const [settings, setSettings] = useState<EventSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [bids, setBids] = useState<Bid[]>([]);

  const mountedRef = useRef(true);
  const loadIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    syncServerTime();
    return () => { mountedRef.current = false; };
  }, []);

  const loadData = useCallback(async () => {
    const myLoadId = ++loadIdRef.current;
    try {
      const [r, a, s] = await Promise.all([getRankings(), getCurrentAuction(), getEventSettings()]);
      if (!mountedRef.current || myLoadId !== loadIdRef.current) return;
      setRankings(r);
      setAuction(a);
      setSettings(s);
      if (a) {
        try {
          const b = await getBidsForAuction(a.id);
          if (mountedRef.current && myLoadId === loadIdRef.current) {
            setBids(b);
          }
        } catch {
          // bid fetch failed, keep existing bids
        }
      } else {
        setBids([]);
      }
    } catch (err) {
      console.error('DisplayPage loadData error:', err);
    } finally {
      if (mountedRef.current && myLoadId === loadIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useAuctionRealtime(() => { if (mountedRef.current) loadData(); });
  useTeamRealtime(() => { if (mountedRef.current) loadData(); });
  useEventSettingsRealtime(() => { if (mountedRef.current) loadData(); });
  useBidRealtime(auction?.id || null, () => {
    if (!mountedRef.current) return;
    const aid = auction?.id;
    if (aid) {
      getBidsForAuction(aid).then(b => {
        if (mountedRef.current) setBids(b);
      }).catch(() => {});
    }
    loadData();
  });

  // Timers — server-clock based so the projector ticks in lock-step with the
  // admin panel and every team dashboard.
  const [, setTick] = useState(0);
  const timerRunning = auction?.status === 'question' && auction.timer_started_at != null && !auction.timer_paused;
  const timeRemaining = (() => {
    if (!auction?.timer_started_at || auction.status !== 'question') return 0;
    if (auction.timer_paused) return auction.timer_duration;
    const elapsed = Math.floor((serverNow() - new Date(auction.timer_started_at).getTime()) / 1000);
    return Math.max(0, auction.timer_duration - elapsed);
  })();

  // Bidding countdown
  const biddingHasDeadline = auction?.status === 'open' && !!auction.bidding_ends_at;
  const biddingRemaining = auction?.status === 'open' ? remainingSeconds(auction.bidding_ends_at) : 0;

  useEffect(() => {
    if (!timerRunning && !biddingHasDeadline) return;
    const interval = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(interval);
  }, [timerRunning, biddingHasDeadline]);

  // The display also settles phases on its own once their clock expires:
  // bidding deadline → crown the winner, question timer → TIME'S UP.
  useAutoCloseBidding(auction);

  // Verdict announcements: settle_answer() writes one round_results row per
  // graded answer, so the projector shows the outcome to the whole room the
  // moment it happens — auto-verified or quizmaster-graded alike.
  const { latest: lastResult, announcement: resultAnnouncement } = useRoundResults(10000);

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-900 grid-bg flex items-center justify-center">
        <div className="text-center">
          <Logo className="mx-auto animate-pulse-glow" size={48} />
          <p className="text-slate-500 font-mono mt-4">LOADING DISPLAY...</p>
        </div>
      </div>
    );
  }

  const isFinalized = settings?.status === 'finalized';

  // No overflow-hidden on the root: on short projector resolutions a full
  // leaderboard used to be silently clipped. Content that doesn't fit now
  // scrolls instead of falling out of bounds.
  return (
    <div className="min-h-screen bg-dark-900 grid-bg p-8">
      {/* Round verdict — full-screen for the room */}
      {resultAnnouncement && <RoundResultOverlay result={resultAnnouncement} />}

      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[400px] bg-cyan-500/3 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 right-0 w-[800px] h-[400px] bg-violet-500/3 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Logo size={32} />
            <h1 className="text-5xl font-black text-slate-900 tracking-tighter">
              TECH <span className="text-cyan-400 text-glow-cyan">AUCTION</span>
            </h1>
            <Logo size={32} />
          </div>
          <div className="w-48 h-0.5 bg-gradient-to-r from-transparent via-cyan-500 to-transparent mx-auto" />
          <p className="break-words text-sm text-slate-500 font-mono mt-3 tracking-widest">
            {settings?.event_name || 'NATIONAL LEVEL QUIZ COMPETITION'}
          </p>
        </div>

        {/* min-w-0 on both columns lets the fr tracks resolve against the
            viewport instead of their content's min-width, so long item or
            team names wrap inside the grid instead of pushing it wider. */}
        <div className="grid grid-cols-3 gap-6">
          {/* Left: Current Auction */}
          <div className="col-span-2 min-w-0">
            {auction && auction.status !== 'completed' ? (
              <div className="card neon-border p-8">
                {/* Auction Status */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <Badge variant={
                      auction.status === 'open' ? 'green' :
                      auction.status === 'question' ? 'violet' :
                      auction.status === 'closed' ? 'amber' : 'default'
                    }>
                      {auction.status === 'open' ? 'BIDDING OPEN' :
                       auction.status === 'question' ? 'QUESTION TIME' :
                       auction.status.toUpperCase()}
                    </Badge>
                  </div>
                  {auction.status === 'open' && biddingHasDeadline && (
                    <div className="flex items-center gap-2">
                      <Gavel size={20} className={biddingRemaining <= 10 ? 'text-red-500' : 'text-cyan-400'} />
                      <span className={`text-3xl font-mono font-bold ${
                        biddingRemaining <= 10 ? 'text-red-500 animate-pulse-glow' : 'text-cyan-400'
                      }`}>
                        {formatTime(biddingRemaining)}
                      </span>
                    </div>
                  )}
                  {auction.status === 'question' && (
                    <div className="flex items-center gap-2">
                      <Clock size={20} className={timerRunning && timeRemaining <= 5 ? 'text-red-500' : 'text-violet-500'} />
                      <span className={`text-3xl font-mono font-bold ${
                        timerRunning && timeRemaining <= 5 ? 'text-red-500 animate-pulse-glow' : 'text-violet-500'
                      }`}>
                        {formatTime(timeRemaining)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Item Name */}
                <h2 className="break-words text-4xl font-black text-slate-900 tracking-tight mb-2">
                  {auction.item?.name}
                </h2>
                <p className="text-lg text-slate-400 mb-8">{auction.item?.category}</p>

                {/* Big Bid Display */}
                <div className="text-center py-8 bg-dark-700 rounded-2xl mb-8">
                  <p className="text-sm font-mono text-slate-500 mb-2 tracking-widest">CURRENT BID</p>
                  <div className="text-7xl font-black font-mono text-cyan-400 text-glow-cyan">
                    <AnimatedNumber value={auction.current_bid} duration={400} />
                  </div>
                  <p className="text-lg font-mono text-slate-400 mt-2">TECH COINS</p>
                  {/* NOTE: the big number above is a <div> — AnimatedNumber renders a <div>,
                      which cannot nest inside a <p> (React DOM nesting warning). */}
                </div>

                {/* Leader */}

                {/* Live Bid Feed */}
                {bids.length > 0 && (
                  <div className="mt-6">
                    <p className="text-sm font-mono text-slate-500 mb-3 text-center tracking-wider">RECENT BIDS</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {bids.slice(0, 8).map((bid) => {
                        const bidTeam = rankings.find(r => r.id === bid.team_id);
                        return (
                          <div key={bid.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-dark-700">
                            <span className="min-w-0 truncate text-sm font-bold text-slate-900">
                              {bidTeam?.name || 'Team'}
                            </span>
                            <span className="shrink-0 text-lg font-mono font-bold text-cyan-400">
                              {bid.amount} TC
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {auction.current_team_id && (
                  <div className="text-center">
                    <p className="text-sm font-mono text-slate-500 mb-2">
                      {auction.status === 'question' ? 'ROUND WINNER' : 'CURRENT LEADER'}
                    </p>
                    <p className="break-words text-3xl font-bold text-slate-900">
                      {rankings.find(r => r.id === auction.current_team_id)?.name || 'Team'}
                    </p>
                  </div>
                )}

                {/* Question display — MCQ options shown to the audience */}
                {auction.status === 'question' && (
                  <div className="mt-8 p-6 bg-violet-500/5 border border-violet-500/20 rounded-xl">
                    <p className="text-sm font-mono text-violet-400 mb-3">QUESTION</p>
                    <p className="break-words text-xl text-slate-900 leading-relaxed">{auction.item?.question}</p>
                    {(() => {
                      const opts = (['option_a', 'option_b', 'option_c', 'option_d'] as const)
                        .map(k => auction.item?.[k])
                        .filter((v): v is string => !!v && v.trim() !== '');
                      if (opts.length === 0) return null;
                      return (
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                          {opts.map((opt, i) => (
                            <div key={MCQ_KEYS[i]}
                              className="flex items-center gap-3 p-4 rounded-xl bg-dark-700 border border-dark-400">
                              <span className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center font-mono font-bold text-sm bg-dark-600 text-slate-500">
                                {MCQ_KEYS[i]}
                              </span>
                              <span className="min-w-0 flex-1 break-words font-medium text-slate-900">{opt}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              /* No Active Auction */
              <div className="card p-12 text-center">
                <div className="animate-float mb-6">
                  <Trophy className="mx-auto text-slate-600" size={64} />
                </div>
                <p className="text-3xl font-bold text-slate-400 mb-2">
                  {isFinalized ? 'ROUND COMPLETE' : 'READY'}
                </p>
                <p className="text-lg text-slate-600 font-mono">
                  {isFinalized ? 'Final results displayed on the right' : 'Waiting for the next auction...'}
                </p>
              </div>
            )}
          </div>

          {/* Right: Leaderboard */}
          <div className="col-span-1 min-w-0">
            <div className={`card ${isFinalized ? 'neon-border' : ''}`}>
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="text-amber-400" size={18} />
                <h3 className="text-lg font-bold text-slate-900">
                  {isFinalized ? 'FINAL RESULTS' : 'LIVE LEADERBOARD'}
                </h3>
              </div>

              <div className="space-y-2">
                {rankings.map(team => (
                  <div
                    key={team.id}
                    title={podiumLabel(team.rank)}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-xl transition-all',
                      podiumRowClass(team.rank) ||
                        (team.rank <= TOP_QUALIFY_COUNT
                          ? 'bg-cyan-500/5 border border-cyan-500/10'
                          : 'bg-dark-700 border border-transparent')
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={cn(
                        'w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-lg font-mono font-bold',
                        podiumRankClass(team.rank) ||
                          (team.rank <= TOP_QUALIFY_COUNT ? 'text-cyan-400' : 'text-slate-600')
                      )}>
                        {team.rank}
                      </span>
                      <div className="min-w-0">
                        <p className={`truncate font-bold ${
                          team.rank <= TOP_QUALIFY_COUNT ? 'text-slate-900' : 'text-slate-400'
                        }`}>
                          {team.name}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-xl font-mono font-bold ${
                        team.rank <= TOP_QUALIFY_COUNT ? 'text-slate-900' : 'text-slate-500'
                      }`}>
                        {team.score}
                      </p>
                      <p className="text-xs font-mono text-cyan-400">{team.current_budget} TC</p>
                    </div>
                    {isFinalized && team.rank <= TOP_QUALIFY_COUNT && (
                      <Badge variant="green" className="ml-2">✓</Badge>
                    )}
                  </div>
                ))}
              </div>

              {isFinalized && (
                <div className="mt-6 pt-4 border-t border-dark-400">
                  <p className="text-xs font-mono text-green-400 mb-2 tracking-wider">QUALIFIED FOR NEXT ROUND</p>
                  {rankings.filter(r => r.qualified).map(team => (
                    <p key={team.id} className="text-slate-900 font-bold">{team.name}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Last graded answer — the room keeps the verdict in view */}
            {lastResult && (
              <div className="card mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className={lastResult.result === 'correct' ? 'text-green-400' : 'text-red-400'} size={18} />
                  <h3 className="text-lg font-bold text-slate-900">LAST ANSWER</h3>
                </div>
                <RoundResultStrip result={lastResult} />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-xs text-slate-700 font-mono">
            TECH AUCTION — {settings?.event_name || 'Live Auction Quiz'}
          </p>
        </div>
      </div>
    </div>
  );
}
