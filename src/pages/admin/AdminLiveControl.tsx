import { useEffect, useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { useAutoCloseBidding } from '../../hooks/useAutoCloseBidding';
import { useRoundResults } from '../../hooks/useRoundResults';
import {
  getActiveAuctionItems, getCurrentAuction, getTeams, getEventSettings,
  getRankings, startAuction, updateAuction,
  closeBidding, recordAnswer, applyBonus, adjustBudget, logEvent,
  getBidsForAuction, getAttemptsForAuction
} from '../../lib/queries';
import { syncServerTime, serverNow, serverNowIso, remainingSeconds } from '../../lib/serverTime';
import { useAuctionRealtime, useTeamRealtime, useEventSettingsRealtime, useBidRealtime } from '../../hooks/useRealtime';
import { Badge, ConfirmModal, Modal, LoadingSpinner, RoundResultStrip, RoundResultToast } from '../../components/ui';
import { formatTime, getDifficultyColor } from '../../lib/utils';
import type { TeamWithRank, AuctionItem, AuctionWithItem, EventSettings, Bid, QuestionAttempt } from '../../types';
import { MCQ_KEYS } from '../../types';
import {
  Pause, Square, Gavel, Clock, CheckCircle,
  XCircle, ChevronRight, SkipForward, Award, Loader2, Zap, Coins
} from 'lucide-react';

export default function AdminLiveControl() {
  const { user } = useAuth();
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [auction, setAuction] = useState<AuctionWithItem | null>(null);
  const [rankings, setRankings] = useState<TeamWithRank[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [settings, setSettings] = useState<EventSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0); // forces re-render every second for timer
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [bonusTeamId, setBonusTeamId] = useState('');
  const [bonusAmount, setBonusAmount] = useState(50);
  const [bonusReason, setBonusReason] = useState('');
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [bids, setBids] = useState<Bid[]>([]);
  const [showTcModal, setShowTcModal] = useState(false);
  const [tcTeamId, setTcTeamId] = useState("");
  const [tcAmount, setTcAmount] = useState<number>(50);
  const [tcReason, setTcReason] = useState("");
  const [tcMode, setTcMode] = useState<"add" | "deduct">("add");
  const [processing, setProcessing] = useState(false);
  const [attempts, setAttempts] = useState<QuestionAttempt[]>([]);

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
      const [i, a, r, t, s] = await Promise.all([
        getActiveAuctionItems(), getCurrentAuction(), getRankings(),
        getTeams(), getEventSettings()
      ]);
      if (!mountedRef.current || myLoadId !== loadIdRef.current) return;
      setItems(i);
      setAuction(a);
      setRankings(r);
      setTeams(t);
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
        if (a.status === 'question') {
          try {
            const at = await getAttemptsForAuction(a.id);
            if (mountedRef.current && myLoadId === loadIdRef.current) {
              setAttempts(at);
            }
          } catch {
            // attempts fetch failed, keep existing
          }
        } else if (mountedRef.current && myLoadId === loadIdRef.current) {
          setAttempts([]);
        }
      } else {
        setBids([]);
      }
    } catch (err) {
      console.error('AdminLiveControl loadData error:', err);
    } finally {
      if (mountedRef.current && myLoadId === loadIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime
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

  // Timers — both derived from DB timestamps evaluated against the SERVER
  // clock (serverTime.ts). Admin, team dashboards and the projector all tick
  // in lock-step regardless of local device clock drift.
  const timerRunning = auction?.status === 'question' && auction.timer_started_at != null && !auction.timer_paused;
  const timeRemaining = (() => {
    if (!auction?.timer_started_at || auction.status !== 'question') return 0;
    if (auction.timer_paused) return auction.timer_duration;
    const elapsed = Math.floor((serverNow() - new Date(auction.timer_started_at).getTime()) / 1000);
    return Math.max(0, auction.timer_duration - elapsed);
  })();

  // 60s bidding countdown — one absolute deadline (auction.bidding_ends_at).
  const biddingHasDeadline = auction?.status === 'open' && !!auction.bidding_ends_at;
  const biddingRemaining = auction?.status === 'open' ? remainingSeconds(auction.bidding_ends_at) : 0;

  useEffect(() => {
    if (!timerRunning && !biddingHasDeadline) return;
    const interval = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(interval);
  }, [timerRunning, biddingHasDeadline]);

  // Auto-close when the 60s window expires (shared with the team dashboards
  // and the projector — idempotent RPC, safe to fire from every client).
  useAutoCloseBidding(auction);

  // Every graded answer — auto-verified by the database or marked by the
  // quizmaster — arrives over realtime: a toast for the room, plus the strip
  // below that keeps the verdict on screen after the round resets.
  const { latest: lastResult, announcement: resultAnnouncement } = useRoundResults();
  useEffect(() => {
    if (!resultAnnouncement) return;
    toast.custom(() => <RoundResultToast result={resultAnnouncement} />, { duration: 8000 });
  }, [resultAnnouncement]);

  const currentLeader = auction?.current_team_id
    ? teams.find((t: any) => t.id === auction.current_team_id)
    : null;

  // MCQ options for the current item (non-empty), and the winning team's pick
  const liveItem = auction?.item;
  const itemOptions = liveItem
    ? (['option_a', 'option_b', 'option_c', 'option_d'] as const)
        .map(k => liveItem[k])
        .filter((v): v is string => !!v && v.trim() !== '')
    : [];
  const winningTeamId = auction?.winning_team_id ?? null;
  const winningAttempt = winningTeamId
    ? attempts.find(a => a.team_id === winningTeamId)
    : undefined;

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleStartAuction = async (itemId: string) => {
    setProcessing(true);
    try {
      const a = await startAuction(itemId, settings?.default_question_time || 20);
      await logEvent('auction_started', 'auction', a.id, { item_id: itemId });
      await loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleCloseBidding = async () => {
    if (!auction) return;
    setProcessing(true);
    try {
      // Server-authoritative: the RPC picks the true highest bidder (ties go
      // to the earlier bid) and settles the budget in ONE transaction — no
      // stale client state can crown a different winner than the teams see.
      const res = await closeBidding(auction.id, true);
      if (res?.winning_team_id) {
        await logEvent('bidding_closed_winner', 'auction', auction.id, {
          team_id: res.winning_team_id, bid: res.winning_bid
        });
      } else {
        await logEvent('bidding_closed_no_bids', 'auction', auction.id);
      }
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const handleMarkAnswer = async (result: 'correct' | 'wrong') => {
    if (!auction || !auction.winning_team_id) return;
    setProcessing(true);
    try {
      // Atomic settlement inside the grade_answer() RPC (admin role enforced
      // server-side). Null = the team's pick was already auto-verified — the
      // round is settled and there is nothing left to override.
      const settled = await recordAnswer(auction.id, result);
      await logEvent(`answer_${result}`, 'auction', auction.id, {
        team_id: auction.winning_team_id, result,
        auto_verified: settled === null,
      });
      await updateAuction(auction.id, { timer_started_at: null, timer_paused: false });
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const handleSkip = async () => {
    if (!auction) return;
    setProcessing(true);
    try {
      await updateAuction(auction.id, { status: 'completed' });
      await logEvent('auction_skipped', 'auction', auction.id);
      setShowSkipConfirm(false);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const handleBonus = async () => {
    if (!user || !bonusTeamId) return;
    setProcessing(true);
    try {
      await applyBonus(bonusTeamId, bonusAmount, bonusReason, user.id);
      await logEvent('bonus_applied', 'team', bonusTeamId, { amount: bonusAmount, reason: bonusReason });
      setShowBonusModal(false);
      setBonusTeamId('');
      setBonusAmount(50);
      setBonusReason('');
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

    const handleTcAdjust = async () => {
    if (!tcTeamId || tcAmount <= 0) return;
    setProcessing(true);
    try {
      const amount = tcMode === "add" ? tcAmount : -tcAmount;
      await adjustBudget(tcTeamId, amount, tcReason || (tcMode === "add" ? "Admin TC grant" : "Admin TC deduction"));
      // Log the SAME reason adjustBudget stored, so the audit trail shows a
      // real reason even when the reason box was left empty.
      await logEvent("tc_adjusted", "team", tcTeamId, {
        amount,
        mode: tcMode,
        reason: tcReason || (tcMode === "add" ? "Admin TC grant" : "Admin TC deduction"),
      });
      setShowTcModal(false);
      setTcTeamId("");
      setTcAmount(50);
      setTcReason("");
      setTcMode("add");
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner text="Loading live control..." />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Live Control</h1>
          <p className="text-sm text-slate-500 font-mono mt-1">
            {settings?.status?.toUpperCase() || 'SETUP'} MODE
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowBonusModal(true)} className="btn-secondary text-sm flex items-center gap-2">
            <Award size={14} /> Bonus
          </button>
          <button onClick={() => setShowTcModal(true)} className="btn-secondary text-sm flex items-center gap-2">
            <Coins size={14} /> Adjust TC
          </button>
        </div>
      </div>

      {/* Last graded answer — stays visible after the round resets */}
      {lastResult && (
        <div className="card">
          <h3 className="text-sm font-mono text-slate-500 mb-3 tracking-wider">LAST ROUND RESULT</h3>
          <RoundResultStrip result={lastResult} />
        </div>
      )}

      {/* Live Auction Panel */}
      {auction ? (
        <div className="space-y-6">
          {/* Current Auction Card */}
          <div className="card neon-border">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold text-slate-900">{auction.item.name}</h2>
                  <Badge className={getDifficultyColor(auction.item.difficulty)}>
                    {auction.item.difficulty.toUpperCase()}
                  </Badge>
                  <Badge variant={
                    auction.status === 'open' ? 'green' :
                    auction.status === 'closed' ? 'amber' :
                    auction.status === 'question' ? 'violet' : 'default'
                  }>
                    {auction.status.toUpperCase()}
                  </Badge>
                </div>
                <p className="text-sm text-slate-400">{auction.item.category}</p>
              </div>
              {auction.status === 'open' && biddingHasDeadline && (
                <div className="text-right">
                  <p className="text-xs text-slate-500 font-mono mb-1">BIDDING ENDS IN</p>
                  <p className={`text-4xl font-mono font-bold ${
                    biddingRemaining <= 10 ? 'text-red-400 animate-pulse-glow' : 'text-cyan-400'
                  }`}>
                    {formatTime(biddingRemaining)}
                  </p>
                  {biddingRemaining <= 0 && (
                    <p className="text-xs text-red-400 font-mono animate-pulse-glow">CLOSING…</p>
                  )}
                </div>
              )}
              {(timerRunning || auction.timer_paused) && auction.status === 'question' && (
                <div className="text-right">
                  <p className="text-xs text-slate-500 font-mono mb-1">
                    {auction.timer_paused ? 'PAUSED' : 'TIME'}
                  </p>
                  <p className={`text-4xl font-mono font-bold ${timeRemaining <= 5 && timerRunning ? 'text-red-400 animate-pulse-glow' : 'text-cyan-400'}`}>
                    {formatTime(timeRemaining)}
                  </p>
                </div>
              )}
            </div>

            {/* Bid Display */}
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="text-center p-4 bg-dark-700 rounded-xl">
                <p className="text-xs font-mono text-slate-500 mb-1">STARTING BID</p>
                <p className="text-xl font-mono font-bold text-slate-400">{auction.item.starting_bid} TC</p>
              </div>
              <div className="text-center p-4 bg-dark-700 rounded-xl border border-cyan-500/20">
                <p className="text-xs font-mono text-slate-500 mb-1">CURRENT BID</p>
                <p className="text-3xl font-mono font-bold text-cyan-400 text-glow-cyan">
                  {auction.current_bid} TC
                </p>
              </div>
              <div className="text-center p-4 bg-dark-700 rounded-xl">
                <p className="text-xs font-mono text-slate-500 mb-1">CURRENT LEADER</p>
                <p className="text-xl font-mono font-bold text-slate-900">
                  {currentLeader?.short_name || '—'}
                </p>
              </div>
            </div>

            {/* Actual scoring rules */}
            <div className="flex flex-wrap items-center gap-6 mb-6 text-sm font-mono">
              <span className="text-green-400">
                {auction.status === 'question' && auction.winning_bid
                  ? `Correct: +${auction.winning_bid + 150} TC`
                  : 'Correct: bid + 150 TC'}
              </span>
              <span className="text-red-400">
                {auction.status === 'question' && auction.winning_bid
                  ? `Wrong: -${auction.winning_bid} TC (bid lost)`
                  : 'Wrong: -bid TC'}
              </span>
              {auction.item.special_rule && (
                <span className="text-amber-400">Special: {auction.item.special_rule}</span>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              {auction.status === 'open' && (
                <>
                  <button onClick={handleCloseBidding} className="btn-danger flex items-center gap-2"
                    disabled={processing}>
                    <Square size={16} />
                    CLOSE BIDDING
                  </button>
                  <button onClick={() => setShowSkipConfirm(true)} className="btn-secondary flex items-center gap-2 text-sm">
                    <SkipForward size={14} /> Skip
                  </button>
                </>
              )}
              {auction.status === 'closed' && !auction.current_team_id && (
                <div className="flex items-center gap-3">
                  <p className="text-amber-400 text-sm">No bids received.</p>
                  <button onClick={handleSkip} className="btn-secondary text-sm" disabled={processing}>
                    Skip Item
                  </button>
                </div>
              )}
              {auction.status === 'question' && (
                <>
                  <button onClick={async () => {
                    if (!auction) return;
                    const duration = settings?.default_question_time || 20;
                    await updateAuction(auction.id, {
                      timer_started_at: serverNowIso(),
                      timer_duration: duration,
                      timer_paused: false,
                    });
                  }}
                    className="btn-primary flex items-center gap-2">
                    <Clock size={16} />
                    {timerRunning ? 'RESTART TIMER' : 'START TIMER'} ({settings?.default_question_time || 20}s)
                  </button>
                  {timerRunning && (
                    <button onClick={async () => {
                      if (!auction) return;
                      await updateAuction(auction.id, {
                        timer_started_at: null,
                        timer_paused: true,
                        timer_duration: timeRemaining,
                      });
                    }} className="btn-secondary flex items-center gap-2">
                      <Pause size={14} /> Pause ({timeRemaining}s)
                    </button>
                  )}
                  {!timerRunning && auction.timer_paused && (
                    <button onClick={async () => {
                      if (!auction) return;
                    await updateAuction(auction.id, {
                      timer_started_at: serverNowIso(),
                      timer_paused: false,
                    });
                    }} className="btn-success flex items-center gap-2">
                      <Clock size={14} /> Resume ({timeRemaining}s)
                    </button>
                  )}
                  <div className="w-px bg-dark-400" />
                  <button onClick={() => handleMarkAnswer('correct')} className="btn-success flex items-center gap-2"
                    disabled={processing}>
                    <CheckCircle size={16} /> MARK CORRECT (team gets bid + 150 TC)
                  </button>
                  <button onClick={() => handleMarkAnswer('wrong')} className="btn-danger flex items-center gap-2"
                    disabled={processing}>
                    <XCircle size={16} /> MARK WRONG (team loses bid — no extra penalty)
                  </button>
                  <button onClick={() => setShowSkipConfirm(true)} className="btn-secondary flex items-center gap-2 text-sm">
                    <SkipForward size={14} /> Skip
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Live Bid Feed */}
          {auction.status === 'open' && (
            <div className="card">
              <h3 className="text-sm font-mono text-slate-500 mb-3 tracking-wider">LIVE BID FEED</h3>
              {bids.length === 0 ? (
                <p className="text-xs text-slate-600 font-mono">
                  No bids yet. Current starting bid: {auction.item.starting_bid} TC
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {bids.map((bid, idx) => {
                    const bidTeam = teams.find((t: any) => t.id === bid.team_id);
                    return (
                      <div
                        key={bid.id}
                        className={`flex items-center justify-between p-3 rounded-lg transition-all ${
                          idx === 0
                            ? 'bg-cyan-500/10 border border-cyan-500/20'
                            : 'bg-dark-700 border border-dark-400'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-mono font-bold ${
                            idx === 0 ? 'text-cyan-400' : 'text-slate-500'
                          }`}>
                            #{idx + 1}
                          </span>
                          <span className={`text-sm font-bold ${
                            idx === 0 ? 'text-cyan-400' : 'text-slate-900'
                          }`}>
                            {bidTeam?.short_name || '???' }
                          </span>
                        </div>
                        <div className="text-right">
                          <span className={`text-lg font-mono font-bold ${
                            idx === 0 ? 'text-cyan-400 text-glow-cyan' : 'text-slate-900'
                          }`}>
                            {bid.amount} TC
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Question Panel */}
          {auction.status === 'question' && (
            <div className="card neon-border-violet">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="text-violet-400" size={18} />
                  <h3 className="text-lg font-bold text-violet-400">QUESTION</h3>
                </div>
                {auction.winning_team_id && (
                  <p className="text-sm font-mono text-violet-400">
                    {teams.find((t: any) => t.id === auction.winning_team_id)?.name || 'Winning team'} is answering
                  </p>
                )}
              </div>
              <div className="bg-dark-700 rounded-xl p-6 mb-4">
                <p className="text-slate-900 text-lg leading-relaxed">{auction.item.question}</p>
              </div>

              {/* MCQ Options + the team's submitted pick */}
              {itemOptions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  {itemOptions.map((opt, i) => {
                    const key = MCQ_KEYS[i];
                    const isTeamPick = !!winningAttempt?.selected_answer && winningAttempt.selected_answer === opt;
                    return (
                      <div key={key}
                        className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${
                          isTeamPick
                            ? 'bg-violet-500/10 border-violet-500/40'
                            : 'bg-dark-700 border-dark-400'
                        }`}>
                        <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center font-mono font-bold text-sm ${
                          isTeamPick ? 'bg-violet-500 text-white' : 'bg-dark-600 text-slate-500'
                        }`}>
                          {key}
                        </span>
                        <span className={`flex-1 font-medium ${isTeamPick ? 'text-slate-900' : 'text-slate-600'}`}>
                          {opt}
                        </span>
                        {isTeamPick && <Badge variant="violet">TEAM PICK</Badge>}
                      </div>
                    );
                  })}
                </div>
              )}
              {winningAttempt?.result ? (
                /* Auto-verified (or previously graded) — settled, read-only */
                <div className={`mb-4 p-4 rounded-xl border flex items-center gap-3 ${
                  winningAttempt.result === 'correct'
                    ? 'bg-green-500/10 border-green-500/30'
                    : 'bg-red-500/10 border-red-500/30'
                }`}>
                  {winningAttempt.result === 'correct'
                    ? <CheckCircle className="text-green-400" size={20} />
                    : <XCircle className="text-red-400" size={20} />}
                  <p className={`font-bold ${
                    winningAttempt.result === 'correct' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    AUTO-VERIFIED {winningAttempt.result.toUpperCase()} — round settled against the item's answer key
                  </p>
                </div>
              ) : winningAttempt?.selected_answer ? (
                <p className="text-sm font-mono text-violet-400 mb-4">
                  Answer submitted — waiting for your grading.
                </p>
              ) : null}

              <div className="bg-dark-700 rounded-xl p-4 border border-amber-500/20">
                <p className="text-xs font-mono text-amber-600 mb-1">CORRECT ANSWER (Admin Only)</p>
                <p className="text-amber-600 font-bold font-mono">{auction.item.correct_answer}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* No Active Auction — Show Item Selection */
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Start New Auction</h2>
            <p className="text-sm text-slate-400 mb-6">Select an item to begin auctioning.</p>
            <div className="grid gap-3">
              {items.filter(i => i.is_active).map(item => (
                <button
                  key={item.id}
                  onClick={() => handleStartAuction(item.id)}
                  disabled={processing}
                  className="flex items-center justify-between p-4 rounded-xl bg-dark-700 border border-dark-400 hover:border-cyan-500/30 hover:bg-slate-100 transition-all duration-200 text-left group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                      <Gavel className="text-cyan-400" size={18} />
                    </div>
                    <div>
                      <p className="text-slate-900 font-bold">{item.name}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs font-mono">
                        <Badge className={getDifficultyColor(item.difficulty)}>
                          {item.difficulty.toUpperCase()}
                        </Badge>
                        <span className="text-cyan-400">{item.starting_bid} TC</span>
                        <span className="text-green-400">+{item.reward_points}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="text-slate-600 group-hover:text-cyan-400 transition-colors" size={20} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mini Leaderboard */}
      <div className="card">
        <h3 className="text-sm font-mono text-slate-500 mb-3 tracking-wider">LIVE RANKINGS</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {rankings.slice(0, 8).map(team => (
            <div key={team.id} className={`p-3 rounded-lg ${
              team.rank <= 4 ? 'bg-cyan-500/5 border border-cyan-500/10' : 'bg-dark-700 border border-dark-400'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-mono font-bold ${team.rank <= 4 ? 'text-cyan-400' : 'text-slate-500'}`}>
                  #{team.rank}
                </span>
                <span className="text-xs font-mono text-slate-900">{team.short_name}</span>
              </div>
              <p className="text-lg font-mono font-bold text-slate-900">{team.score}</p>
              <p className="text-xs font-mono text-cyan-400">{team.current_budget} TC</p>
            </div>
          ))}
        </div>
      </div>

      {/* Bonus Modal */}
      <Modal isOpen={showBonusModal} onClose={() => setShowBonusModal(false)} title="Award Bonus" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">TEAM</label>
            <select
              value={bonusTeamId}
              onChange={e => setBonusTeamId(e.target.value)}
              className="input-field"
            >
              <option value="">Select team...</option>
              {teams.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">POINTS</label>
            <input type="number" value={bonusAmount}
              onChange={e => setBonusAmount(Number(e.target.value))}
              className="input-field font-mono" min={1} />
          </div>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">REASON</label>
            <input type="text" value={bonusReason}
              onChange={e => setBonusReason(e.target.value)}
              className="input-field" placeholder="e.g., Fastest response" />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowBonusModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleBonus} className="btn-success flex items-center gap-2"
              disabled={!bonusTeamId || !bonusReason || processing}>
              {processing && <Loader2 size={14} className="animate-spin" />}
              Award Bonus
            </button>
          </div>
        </div>
      </Modal>

      {/* Adjust TC Modal */}
      <Modal isOpen={showTcModal} onClose={() => setShowTcModal(false)} title="Adjust Team TC" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">TEAM</label>
            <select value={tcTeamId} onChange={e => setTcTeamId(e.target.value)} className="input-field">
              <option value="">Select team...</option>
              {teams.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name} ({t.current_budget} TC)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">MODE</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setTcMode("add")} className={"flex-1 py-2 rounded-lg text-xs font-mono border transition-all " + (tcMode === "add" ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-dark-700 text-slate-500 border-dark-400")}>+ ADD TC</button>
              <button type="button" onClick={() => setTcMode("deduct")} className={"flex-1 py-2 rounded-lg text-xs font-mono border transition-all " + (tcMode === "deduct" ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-dark-700 text-slate-500 border-dark-400")}>- DEDUCT TC</button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">AMOUNT (TC)</label>
            <input type="number" value={tcAmount} onChange={e => setTcAmount(Number(e.target.value))} className="input-field font-mono" min={1} />
          </div>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">REASON</label>
            <input type="text" value={tcReason} onChange={e => setTcReason(e.target.value)} className="input-field" placeholder="e.g., Manual adjustment" />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowTcModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleTcAdjust} disabled={!tcTeamId || tcAmount <= 0 || processing}
              className={(tcMode === "add" ? "btn-success" : "btn-danger") + " flex items-center gap-2"}>
              {processing && <Loader2 size={14} className="animate-spin" />}
              {tcMode === "add" ? "Add" : "Deduct"} {tcAmount} TC
            </button>
          </div>
        </div>
      </Modal>

{/* Skip Confirmation */}
      <ConfirmModal
        isOpen={showSkipConfirm}
        onClose={() => setShowSkipConfirm(false)}
        onConfirm={handleSkip}
        title="Skip Auction Item"
        message="Are you sure you want to skip this auction item? No winner will be determined."
        confirmText="Skip Item"
        variant="danger"
      />
    </div>
  );
}
