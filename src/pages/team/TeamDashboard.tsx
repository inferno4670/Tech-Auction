import { useEffect, useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { useAutoCloseBidding } from '../../hooks/useAutoCloseBidding';
import { useRoundResults } from '../../hooks/useRoundResults';
import { getTeamForUser } from '../../lib/auth';
import {
  getRankings, getCurrentAuction, getEventSettings, placeBid, getBidsForAuction,
  submitTeamAnswer, getAttemptsForAuction, getBudgetTransactions, type SubmitAnswerResult
} from '../../lib/queries';
import { useAuctionRealtime, useTeamRealtime, useEventSettingsRealtime, useBidRealtime } from '../../hooks/useRealtime';
import { StatCard, Badge, LoadingSpinner, RoundResultStrip, RoundResultToast } from '../../components/ui';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { formatTime, getDifficultyColor, cn, podiumRowClass, podiumRankClass, podiumLabel } from '../../lib/utils';
import { syncServerTime, serverNow, remainingSeconds } from '../../lib/serverTime';
import type { Team, TeamWithRank, AuctionWithItem, EventSettings, Bid, BudgetTransaction, QuestionAttempt } from '../../types';
import { MCQ_KEYS, TOP_QUALIFY_COUNT } from '../../types';
import {
  Coins, Trophy, Medal, Gavel, Zap, AlertCircle,
  CheckCircle, XCircle, Timer, Clock
} from 'lucide-react';

/** How long a transient message stays on a team's screen before clearing. */
const MESSAGE_DISMISS_MS = 2500;

type TeamViewState =
  | 'waiting'
  | 'auction_live'
  | 'winning'
  | 'outbid'
  | 'won'
  | 'question'
  | 'finalized';

export default function TeamDashboard() {
  const { user, team: authTeam } = useAuth();
  const [team, setTeam] = useState<Team | null>(null);
  const [rankings, setRankings] = useState<TeamWithRank[]>([]);
  const [auction, setAuction] = useState<AuctionWithItem | null>(null);
  const [settings, setSettings] = useState<EventSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [bidAmount, setBidAmount] = useState<number>(0);
  const [bidError, setBidError] = useState('');
  const [bidLoading, setBidLoading] = useState(false);
  // const [connectionStatus, setConnectionStatus] = useState<'live' | 'reconnecting' | 'offline'>('live');
  const [bids, setBids] = useState<Bid[]>([]);
  // Admin TC add/deducts with the quizmaster's reason — flashed to the team so
  // a budget change is never unexplained, then cleared like every other
  // message on this screen.
  const [tcAdjustments, setTcAdjustments] = useState<BudgetTransaction[]>([]);
  const [showTcMessage, setShowTcMessage] = useState(false);
  const [myAttempt, setMyAttempt] = useState<QuestionAttempt | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState('');
  // Instant server verdict for the team's MCQ pick (survives the panel swap
  // while the auction flips to 'completed').
  const [answerOutcome, setAnswerOutcome] = useState<
    (SubmitAnswerResult & { correctAnswer: string | null }) | null
  >(null);

  const mountedRef = useRef(true);
  const loadIdRef = useRef(0); // prevents stale responses from overwriting fresh data

  useEffect(() => {
    mountedRef.current = true;
    syncServerTime();
    return () => { mountedRef.current = false; };
  }, []);

  const loadData = useCallback(async () => {
    if (!user) return;
    const myLoadId = ++loadIdRef.current;
    try {
      const [t, r, auctionData, s] = await Promise.all([
        getTeamForUser(user.id),
        getRankings(),
        getCurrentAuction(),
        getEventSettings(),
      ]);
      // If a newer load has started, discard this one's results
      if (!mountedRef.current || myLoadId !== loadIdRef.current) return;
      setTeam(t);
      // Manual TC adjustments (admin add/deduct + reason) — non-blocking so
      // a slow ledger never delays the dashboard's first paint.
      if (t) {
        getBudgetTransactions(t.id)
          .then(tx => {
            if (mountedRef.current && myLoadId === loadIdRef.current) setTcAdjustments(tx);
          })
          .catch(() => { /* keep the last adjustments we loaded */ });
      }
      setRankings(r);
      setAuction(auctionData);
      setSettings(s);
      if (auctionData) {
        try {
          const b = await getBidsForAuction(auctionData.id);
          if (mountedRef.current && myLoadId === loadIdRef.current) {
            setBids(b);
          }
        } catch {
          // bid fetch failed, keep existing bids
        }
        if (auctionData.status === 'question') {
          try {
            const at = await getAttemptsForAuction(auctionData.id);
            if (mountedRef.current && myLoadId === loadIdRef.current) {
              setMyAttempt(at.find(x => x.team_id === t?.id) || null);
            }
          } catch {
            // attempts fetch failed, keep existing
          }
        } else if (mountedRef.current && myLoadId === loadIdRef.current) {
          setMyAttempt(null);
        }
      } else {
        setBids([]);
        setMyAttempt(null);
      }
    } catch (err) {
      console.error('TeamDashboard loadData error:', err);
    } finally {
      if (mountedRef.current && myLoadId === loadIdRef.current) {
        setLoading(false);
      }
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // A new auction clears the previous question's instant verdict.
  useEffect(() => { setAnswerOutcome(null); }, [auction?.id]);

  // Every message on the team screen is transient: the instant verdict clears
  // itself a moment after it appears instead of stacking up on the dashboard.
  useEffect(() => {
    if (!answerOutcome) return;
    const t = window.setTimeout(() => setAnswerOutcome(null), MESSAGE_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [answerOutcome]);

  // Same for the TC message: show it when the ledger CHANGES (the admin just
  // added or deducted coins — including the reason they typed), then hide it.
  // Comparing ids rather than array identity keeps background refreshes from
  // re-flashing it on every realtime event.
  const tcSignature = tcAdjustments.map(tx => tx.id).join(',');
  const lastTcSignatureRef = useRef('');
  useEffect(() => {
    if (!tcSignature || tcSignature === lastTcSignatureRef.current) return;
    lastTcSignatureRef.current = tcSignature;
    setShowTcMessage(true);
    const t = window.setTimeout(() => setShowTcMessage(false), MESSAGE_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [tcSignature]);

  // Realtime
  useAuctionRealtime(() => { if (mountedRef.current) loadData(); });
  useTeamRealtime(() => { if (mountedRef.current) loadData(); }, authTeam ? `id=eq.${authTeam.id}` : undefined);
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

  // Timers — derived from DB timestamps against the SERVER clock so every
  // panel ticks identically (fixes fast/slow drift and countdown jumps).
  const [, setTick] = useState(0);
  const timerRunning = auction?.status === 'question' && auction.timer_started_at != null && !auction.timer_paused;
  const timeRemaining = (() => {
    if (!auction?.timer_started_at || auction.status !== 'question') return 0;
    if (auction.timer_paused) return auction.timer_duration;
    const elapsed = Math.floor((serverNow() - new Date(auction.timer_started_at).getTime()) / 1000);
    return Math.max(0, auction.timer_duration - elapsed);
  })();

  // Bidding countdown — one absolute deadline (auction.bidding_ends_at)
  const biddingHasDeadline = auction?.status === 'open' && !!auction.bidding_ends_at;
  const biddingRemaining = auction?.status === 'open' ? remainingSeconds(auction.bidding_ends_at) : 0;

  useEffect(() => {
    if (!timerRunning && !biddingHasDeadline) return;
    const interval = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(interval);
  }, [timerRunning, biddingHasDeadline]);

  // First client to notice expiry settles the round via the atomic RPC
  // (idempotent + deadline re-checked server-side, so racing callers are safe).
  useAutoCloseBidding(auction);

  // Round verdicts for EVERYONE, not just the team at the podium: the instant
  // a question is graded (auto-verified or quizmaster-marked), each dashboard
  // flashes the outcome. The winning team already sees its own big verdict
  // banner, so it is skipped here to avoid a double notification.
  const { latest: lastResult, announcement: resultAnnouncement } = useRoundResults();
  useEffect(() => {
    if (!resultAnnouncement) return;
    // The winning team already flashed its own big verdict banner for a pick it
    // submitted — no need to say it twice. When the round ended on the clock
    // there is no banner, so the toast is exactly how they learn it.
    if (team && resultAnnouncement.team_id === team.id && answerOutcome?.graded) return;
    toast.custom(() => <RoundResultToast result={resultAnnouncement} />, { duration: MESSAGE_DISMISS_MS });
  }, [resultAnnouncement, team, answerOutcome]);


  if (loading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <LoadingSpinner text="Loading your dashboard..." />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="text-center">
          <AlertCircle className="mx-auto text-red-400 mb-3" size={32} />
          <p className="text-slate-900 font-bold mb-2">Team Not Found</p>
          <p className="text-sm text-slate-500">Your account is not linked to a team.</p>
        </div>
      </div>
    );
  }

  // Determine view state
  const myRank = rankings.find(r => r.id === team.id);
  const isFinalized = settings?.status === 'finalized';
  const isPaused = settings?.status === 'paused';

  let viewState: TeamViewState = 'waiting';
  let stateMessage = 'Waiting for Quizmaster...';
  let stateColor = 'text-slate-400';

    if (isFinalized) {
    viewState = 'finalized';
    stateMessage = myRank?.qualified ? 'YOU QUALIFIED FOR THE NEXT ROUND' : 'ROUND COMPLETE';
    stateColor = myRank?.qualified ? 'text-green-400' : 'text-slate-500';
  } else if (isPaused) {
    stateMessage = 'ROUND PAUSED';
    stateColor = 'text-amber-400';
  } else  if (auction) {
    if (auction.status === 'open') {
      if (biddingHasDeadline && biddingRemaining <= 0) {
        viewState = 'auction_live';
        stateMessage = 'BIDDING CLOSED — SETTLING…';
        stateColor = 'text-amber-400';
      } else if (auction.current_team_id === team.id) {
        viewState = 'winning';
        stateMessage = 'You are currently the highest bidder';
        stateColor = 'text-green-400';
      } else if (auction.current_team_id) {
        viewState = 'outbid';
        stateMessage = 'You have been outbid';
        stateColor = 'text-red-400';
      } else {
        viewState = 'auction_live';
        stateMessage = 'AUCTION LIVE';
        stateColor = 'text-cyan-400';
      }
    } else if (auction.status === 'question') {
      if (auction.winning_team_id === team.id) {
        viewState = 'question';
        stateMessage = 'ANSWER NOW';
        stateColor = 'text-violet-400';
      } else {
        viewState = 'auction_live';
        stateMessage = 'Waiting for answer...';
        stateColor = 'text-slate-400';
      }
    } else if (auction.status === 'completed') {
      // Check if this team recently got a result
      viewState = 'auction_live';
      stateMessage = 'Preparing next auction...';
      stateColor = 'text-slate-400';
    } else if (auction.status === 'closed') {
      viewState = 'auction_live';
      stateMessage = 'Bidding closed...';
      stateColor = 'text-amber-400';
    }
  }

  // Calculate bid suggestions
  const minBid = auction
    ? auction.current_bid + (auction.status === 'open' ? getMinIncrement(auction) : 0)
    : 0;

  function getMinIncrement(a: AuctionWithItem): number {
    return a.item?.minimum_increment || 25;
  }

  const bidSuggestions = auction ? [
    minBid,
    minBid + 25,
    minBid + 50,
    minBid + 100,
  ].filter(b => b <= team.current_budget) : [];

  const canBid = auction?.status === 'open' && team.current_budget >= minBid
    && (!biddingHasDeadline || biddingRemaining > 0);

  // MCQ options for the current item (non-empty)
  const liveItem = auction?.item;
  const questionOptions = liveItem
    ? (['option_a', 'option_b', 'option_c', 'option_d'] as const)
        .map(k => liveItem[k])
        .filter((v): v is string => !!v && v.trim() !== '')
    : [];

  const handlePlaceBid = async (amount: number) => {
    if (!auction || !team) return;
    setBidError('');
    setBidLoading(true);
    try {
      // Atomic server-side bid: the RPC takes the same row lock as the round
      // settlement, so a last-second bid either wins outright or is refused —
      // it can no longer be shown as a bid that never counted.
      await placeBid(auction.id, amount);
      setBidAmount(0);
    } catch (err: any) {
      setBidError(err.message || 'Failed to place bid');
    } finally {
      setBidLoading(false);
    }
  };

  // Winning team picks an MCQ option — the submit_team_answer() RPC verifies
  // the pick against the item's answer key SERVER-SIDE and settles the round
  // atomically (refund + bonus, or lost bid). Items without a key fall back to
  // quizmaster grading.
  const handleSelectAnswer = async (answer: string) => {
    if (!auction || !team) return;
    setAnswerError('');
    setAnswerLoading(true);
    try {
      const outcome = await submitTeamAnswer(auction.id, answer);
      setAnswerOutcome({
        ...outcome,
        // Captured now: once the round completes, the payload no longer
        // includes the item (getCurrentAuction excludes completed rounds).
        correctAnswer: outcome.graded && outcome.result === 'wrong'
          ? (auction.item?.correct_answer ?? null)
          : null,
      });
      setMyAttempt(prev => prev
        ? { ...prev, selected_answer: answer, result: outcome.result }
        : prev);
    } catch (err: any) {
      setAnswerError(err.message || 'Failed to submit answer');
    } finally {
      setAnswerLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Status Banner */}
      <div className={`text-center py-4 rounded-xl ${
        viewState === 'winning' ? 'bg-green-500/10 border border-green-500/20' :
        viewState === 'outbid' ? 'bg-red-500/10 border border-red-500/20' :
        viewState === 'question' ? 'bg-violet-500/10 border border-violet-500/20 animate-pulse-glow' :
        viewState === 'finalized' && myRank?.qualified ? 'bg-green-500/10 border border-green-500/20' :
        'bg-slate-100 border border-dark-400'
      }`}>
        <p className={`text-lg font-bold tracking-wider ${stateColor}`}>
          {stateMessage}
        </p>
      </div>

      {/* Instant verdict from the auto-verified MCQ (top-level so it stays
          visible after the round settles and the question card unmounts) */}
      {answerOutcome?.graded && (
        answerOutcome.result === 'wrong' ? (
          <div className="p-5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3 animate-slide-up">
            <XCircle className="text-red-400 shrink-0" size={26} />
            <div className="text-left">
              <p className="text-red-400 font-bold text-lg">WRONG ANSWER</p>
              <p className="text-sm font-mono text-red-400/80 mt-0.5">
                −{answerOutcome.bidLost} TC — your bid is lost
              </p>
              {answerOutcome.correctAnswer && (
                <p className="text-xs text-slate-500 font-mono mt-2">
                  Correct answer: {answerOutcome.correctAnswer}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5 rounded-xl bg-green-500/10 border border-green-500/30 flex items-start gap-3 animate-slide-up">
            <CheckCircle className="text-green-400 shrink-0" size={26} />
            <div className="text-left">
              <p className="text-green-400 font-bold text-lg">CORRECT! 🎉</p>
              <p className="text-sm font-mono text-green-400/80 mt-0.5">
                +{answerOutcome.reward} TC — bid refunded + 150 TC bonus
              </p>
            </div>
          </div>
        )
      )}

      {/* Last graded answer — every team sees the result of the round */}
      {lastResult && (
        <div className="card">
          <h3 className="text-sm font-mono text-slate-500 mb-3 tracking-wider">LAST ROUND RESULT</h3>
          <RoundResultStrip result={lastResult} />
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="TECH COINS"
          value={team.current_budget}
          color="cyan"
          icon={<Coins size={16} />}
          suffix=" TC"
        />
        <StatCard
          label="SCORE"
          value={team.score}
          color="violet"
          icon={<Trophy size={16} />}
        />
        <StatCard
          label="RANK"
          value={`#${myRank?.rank || '-'}`}
          color={myRank && myRank.rank <= TOP_QUALIFY_COUNT ? 'green' : 'red'}
          icon={<Medal size={16} />}
        />
        <StatCard
          label="AUCTIONS WON"
          value={team.auctions_won}
          color="amber"
          icon={<Gavel size={16} />}
        />
      </div>

      {/* Manual TC adjustments — the quizmaster's reason, flashed then cleared */}
      {tcAdjustments.length > 0 && showTcMessage && (
        <div className="card">
          <h3 className="text-sm font-mono text-slate-500 mb-3 tracking-wider">TC ADJUSTMENTS</h3>
          <div className="space-y-2">
            {tcAdjustments.map(tx => (
              <div key={tx.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-mono font-bold ${tx.amount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {tx.amount >= 0 ? '+' : ''}{tx.amount} TC
                  </p>
                  <p className="text-xs text-slate-500 break-words">{tx.reason}</p>
                </div>
                <span className="text-xs text-slate-400 font-mono shrink-0">
                  {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current Auction Panel */}
      {auction && (auction.status === 'open' || auction.status === 'question' || auction.status === 'closed') && (
        <div className={`card ${
          viewState === 'winning' ? 'neon-border glow-green' :
          viewState === 'outbid' ? 'border border-red-500/30 glow-red' :
          'neon-border'
        }`}>
          {/* Item Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-xl font-bold text-slate-900">{auction.item?.name}</h2>
                <Badge className={getDifficultyColor(auction.item?.difficulty || 'basic')}>
                  {(auction.item?.difficulty || 'basic').toUpperCase()}
                </Badge>
              </div>
              <p className="text-sm text-slate-400">{auction.item?.category}</p>
            </div>
            {auction.status === 'question' && auction.winning_team_id === team.id && (
              <div className="text-right">
                <p className="text-xs font-mono text-slate-500 mb-1">TIME TO ANSWER</p>
                <p className={`text-3xl font-mono font-bold ${
                  timeRemaining <= 5 && timerRunning ? 'text-red-500 animate-pulse-glow' : 'text-violet-500'
                }`}>
                  {timerRunning ? formatTime(timeRemaining) : auction.timer_paused ? 'PAUSED' : formatTime(timeRemaining)}
                </p>
              </div>
            )}
          </div>

          {/* Bid Display */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-4 bg-dark-700 rounded-xl">
              <p className="text-xs font-mono text-slate-500 mb-1">STARTING BID</p>
              <p className="text-lg font-mono font-bold text-slate-400">
                {auction.item?.starting_bid || 0} TC
              </p>
            </div>
            <div className="text-center p-4 bg-dark-700 rounded-xl border border-cyan-500/20">
              <p className="text-xs font-mono text-slate-500 mb-1">CURRENT BID</p>
              <p className="text-2xl font-mono font-bold text-cyan-400 text-glow-cyan">
                {auction.current_bid} TC
              </p>
            </div>
            <div className="text-center p-4 bg-dark-700 rounded-xl">
              <p className="text-xs font-mono text-slate-500 mb-1">YOUR BUDGET</p>
              <div className="text-2xl font-mono font-bold text-slate-900">
                <AnimatedNumber value={team.current_budget} duration={700} suffix=" TC" />
              </div>
            </div>
          </div>

          {/* Scoring rules + live bidding countdown */}
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
            {auction.status === 'open' && biddingHasDeadline && (
              <span className={`flex items-center gap-2 ${
                biddingRemaining <= 10 ? 'text-red-400 font-bold animate-pulse-glow' : 'text-slate-500'
              }`}>
                <Clock size={14} />
                Bidding ends in {formatTime(biddingRemaining)}
              </span>
            )}
          </div>

          {/* Bidding Controls (only when auction is open) */}
          {auction.status === 'open' && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <p className="text-xs font-mono text-slate-500">QUICK BID:</p>
                {bidSuggestions.map(amount => (
                  <button
                    key={amount}
                    onClick={() => handlePlaceBid(amount)}
                    disabled={!canBid || bidLoading}
                    className="px-4 py-2 rounded-lg bg-slate-100 border border-dark-400 text-cyan-400 font-mono text-sm
                               hover:bg-cyan-500/10 hover:border-cyan-500/30 transition-all disabled:opacity-30"
                  >
                    +{amount - auction.current_bid}
                  </button>
                ))}
              </div>

              {/* Custom bid */}
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <input
                    type="number"
                    value={bidAmount || ''}
                    onChange={e => setBidAmount(Number(e.target.value))}
                    placeholder={`Min: ${minBid} TC`}
                    className="input-field pr-16 font-mono"
                    min={minBid}
                    max={team.current_budget}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono">TC</span>
                </div>
                <button
                  onClick={() => bidAmount >= minBid && handlePlaceBid(bidAmount)}
                  disabled={!canBid || bidLoading || bidAmount < minBid}
                  className="btn-primary px-8 flex items-center gap-2"
                >
                  {bidLoading ? (
                    <span className="animate-spin">⟳</span>
                  ) : (
                    <>
                      <Zap size={16} />
                      PLACE BID
                    </>
                  )}
                </button>
              </div>

              {bidError && (
                <p className="text-red-400 text-sm font-mono mt-2 animate-slide-down">{bidError}</p>
              )}
            </div>
          )}

          {/* Question display (only for winning team) */}
          {auction.status === 'question' && auction.winning_team_id === team.id && (
            <div className="mt-6 p-6 bg-violet-500/5 border border-violet-500/20 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Timer className="text-violet-500" size={18} />
                  <h3 className="text-lg font-bold text-violet-500">YOUR QUESTION</h3>
                </div>
                {timerRunning && timeRemaining <= 5 && (
                  <span className="text-red-500 font-mono font-bold animate-pulse-glow text-sm">HURRY UP!</span>
                )}
              </div>
              <p className="text-slate-900 text-lg leading-relaxed">{auction.item?.question}</p>

              {/* MCQ Options */}
              {questionOptions.length > 0 && (
                <div className="mt-4 space-y-2">
                  {questionOptions.map((opt, i) => {
                    const key = MCQ_KEYS[i];
                    const picked = myAttempt?.selected_answer === opt;
                    const graded = answerOutcome?.graded ? answerOutcome.result : myAttempt?.result ?? null;
                    const pickedCorrect = picked && graded === 'correct';
                    const pickedWrong = picked && graded === 'wrong';
                    return (
                      <button key={key}
                        onClick={() => handleSelectAnswer(opt)}
                        disabled={!!myAttempt?.selected_answer || answerLoading}
                        className={`w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
                          pickedCorrect ? 'bg-green-500/15 border-green-500/50' :
                          pickedWrong ? 'bg-red-500/15 border-red-500/50' :
                          picked ? 'bg-violet-500/15 border-violet-500/50' :
                          'bg-dark-700 border-dark-400 hover:border-violet-500/40 disabled:opacity-60'
                        }`}>
                        <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center font-mono font-bold text-sm ${
                          pickedCorrect ? 'bg-green-500 text-white' :
                          pickedWrong ? 'bg-red-500 text-white' :
                          picked ? 'bg-violet-500 text-white' : 'bg-dark-600 text-slate-500'
                        }`}>
                          {key}
                        </span>
                        <span className="flex-1 font-medium text-slate-900">{opt}</span>
                        {pickedCorrect && <CheckCircle className="text-green-400" size={18} />}
                        {pickedWrong && <XCircle className="text-red-400" size={18} />}
                        {picked && !graded && <CheckCircle className="text-violet-500" size={18} />}
                      </button>
                    );
                  })}
                </div>
              )}

              {answerError && (
                <p className="text-red-400 text-sm font-mono mt-2">{answerError}</p>
              )}

              {/* Manual-grading fallback (item has no answer key) */}
              {myAttempt?.selected_answer && !answerOutcome?.graded && !myAttempt.result && (
                <p className="text-sm font-mono text-violet-400 mt-3 flex items-center gap-2">
                  <CheckCircle size={14} />
                  Answer submitted — waiting for the quizmaster.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Waiting State */}
      {!auction && settings?.status !== 'finalized' && (
        <div className="card text-center py-16">
          <div className="animate-float mb-6">
            <Gavel className="mx-auto text-slate-600" size={48} />
          </div>
          <p className="text-xl text-slate-400 font-bold mb-2">
            {isPaused ? 'ROUND PAUSED' : 'Waiting for Auction...'}
          </p>
          <p className="text-sm text-slate-600 font-mono">
            The quizmaster will start the next auction soon.
          </p>
        </div>
      )}

      {/* Finalization Result */}
      {isFinalized && (
        <div className={`card text-center py-12 ${
          myRank?.qualified ? 'neon-border glow-green' : 'border border-slate-500/20'
        }`}>
          {myRank?.qualified ? (
            <>
              <CheckCircle className="mx-auto text-green-400 mb-4" size={48} />
              <h2 className="text-2xl font-bold text-green-400 mb-2">YOU QUALIFIED</h2>
              <p className="text-lg text-slate-900">Final Rank: #{myRank.rank}</p>
            </>
          ) : (
            <>
              <XCircle className="mx-auto text-slate-500 mb-4" size={48} />
              <h2 className="text-2xl font-bold text-slate-400 mb-2">ROUND COMPLETE</h2>
              <p className="text-lg text-slate-900">Final Rank: #{myRank?.rank}</p>
              <p className="text-sm text-slate-500 mt-2">Top 6 teams qualified for the next round.</p>
            </>
          )}
        </div>
      )}


      {/* Live Bid Feed */}
      {auction && bids.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-mono text-slate-500 mb-3 tracking-wider">COMPETITOR BIDS</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {bids.slice(0, 8).map((bid, idx) => {
              const bidTeam = rankings.find(r => r.id === bid.team_id);
              const isMe = bid.team_id === team.id;
              return (
                <div
                  key={bid.id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isMe ? 'bg-cyan-500/10 border border-cyan-500/20' :
                    idx === 0 ? 'bg-green-500/5 border border-green-500/10' :
                    'bg-dark-700 border border-dark-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-mono font-bold ${
                      idx === 0 ? 'text-green-400' : 'text-slate-500'
                    }`}>
                      #{idx + 1}
                    </span>
                    <span className={`text-sm font-bold ${
                      isMe ? 'text-cyan-400' : idx === 0 ? 'text-green-400' : 'text-slate-900'
                    }`}>
                      {bidTeam?.short_name || '???'}{isMe && ' (YOU)'}
                    </span>
                  </div>
                  <span className={`text-lg font-mono font-bold ${
                    idx === 0 ? 'text-green-400' : 'text-slate-900'
                  }`}>
                    {bid.amount} TC
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mini Leaderboard */}
      <div className="card">
        <h3 className="text-sm font-mono text-slate-500 mb-3 tracking-wider">RANKINGS</h3>
        <div className="space-y-2">
          {rankings.slice(0, 8).map(t => (
            <div
              key={t.id}
              title={podiumLabel(t.rank)}
              className={cn(
                'flex items-center justify-between py-2 px-3 rounded-lg',
                podiumRowClass(t.rank) ||
                  (t.rank <= TOP_QUALIFY_COUNT ? 'bg-dark-700' : 'bg-dark-800'),
                t.id === team.id && 'ring-1 ring-cyan-500/50'
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn(
                  'w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-xs font-mono font-bold',
                  podiumRankClass(t.rank) ||
                    (t.rank <= TOP_QUALIFY_COUNT ? 'text-cyan-400' : 'text-slate-600')
                )}>
                  {t.rank}
                </span>
                <span className={`text-sm ${t.id === team.id ? 'text-slate-900 font-bold' : 'text-slate-600'}`}>
                  {t.name}
                  {t.id === team.id && <span className="text-cyan-400 ml-1 text-xs">(YOU)</span>}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="text-violet-400">{t.score} pts</span>
                <span className="text-cyan-400">{t.current_budget} TC</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
