import { supabase } from './supabase';
import { serverNow, serverNowIso } from './serverTime';
import { BIDDING_DURATION_SECONDS, TOP_QUALIFY_COUNT } from '../types';
import type {
  Team,
  AuctionItem,
  Auction,
  Bid,
  EventSettings,
  EventLog,
  TeamWithRank,
  AuctionWithItem,
  QuestionAttempt,
  RoundResult,
  BudgetTransaction,
  McqKey,
  TiebreakQuestion,
  TiebreakState,
} from '../types';

// ─── Event Settings ──────────────────────────────────────────────────────────

export async function getEventSettings(): Promise<EventSettings | null> {
  const { data, error } = await supabase
    .from('event_settings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    // maybeSingle: an empty table is normal pre-setup, not an error
    // (.single() turned every empty fetch into a noisy 406/PGRST116).
    .maybeSingle();

  if (error) return null;
  return data as EventSettings | null;
}

export async function updateEventSettings(
  id: string,
  updates: Partial<EventSettings>
) {
  const { data, error } = await supabase
    .from('event_settings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as EventSettings;
}

// ─── Teams ───────────────────────────────────────────────────────────────────

export async function getTeams(): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .order('name');

  if (error) throw error;
  return data as Team[];
}

export async function getTeam(id: string): Promise<Team | null> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data as Team;
}

export async function getTeamByUserId(userId: string): Promise<Team | null> {
  const { data: member, error: memberError } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .single();

  if (memberError || !member) return null;

  return getTeam(member.team_id);
}

export async function updateTeam(id: string, updates: Partial<Team>) {
  const { data, error } = await supabase
    .from('teams')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Team;
}

export async function createTeam(team: Omit<Team, 'id' | 'created_at' | 'score' | 'correct_answers' | 'wrong_answers' | 'auctions_won' | 'rounds_inactive' | 'tiebreak_order' | 'current_budget'>) {
  const { data, error } = await supabase
    .from('teams')
    .insert({
      ...team,
      current_budget: team.starting_budget,
      score: 0,
      correct_answers: 0,
      wrong_answers: 0,
      auctions_won: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Team;
}

export async function deleteTeam(id: string) {
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) throw error;
}

// ─── Rankings ────────────────────────────────────────────────────────────────

/**
 * The whole leaderboard, ranked.
 *
 * Order: POINTS → TECH COINS → CORRECT ANSWERS → manual tie-breaker → name.
 * `score` is the real metric (a correct answer is +1, plus any admin bonus);
 * Tech Coins only ever break a dead heat. The manual tie-breaker sits strictly
 * BELOW the three official keys, so a quizmaster can rule on a tie after a
 * tie-breaker round without being able to lift a team past one it genuinely
 * outscored. With no override set, the alphabet is the last resort.
 */
export async function getRankings(): Promise<TeamWithRank[]> {
  const teams = await getTeams();
  const sorted = [...teams]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.current_budget !== a.current_budget) return b.current_budget - a.current_budget;
      if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers;
      // Unset overrides sort last (Number.MAX_SAFE_INTEGER), so an explicit
      // tie-breaker position outranks an untouched team in the same tie.
      const aOrder = a.tiebreak_order ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.tiebreak_order ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
    });

  return sorted.map((team, index) => ({
    ...team,
    rank: index + 1,
    qualified: index < TOP_QUALIFY_COUNT,
  }));
}

/**
 * Admin tie-breaker ruling — the quizmaster's decision when teams are level on
 * every official metric and a tie-breaker round has to settle it.
 *
 * Pass the tied group's ids IN THE ORDER THEY SHOULD RANK (first id → first
 * place); the RPC stores 0,1,2… in one statement so a partial write can never
 * leave two teams sharing a position. Pass clear = true to drop the overrides
 * instead — with ids to reset one group, or without ids to reset every team.
 *
 * Admin-only, enforced inside the RPC against the JWT. It only ever reorders
 * teams that are already tied, so it cannot distort the standings.
 */
export async function setTiebreakOrder(teamIds: string[] | null, clear = false) {
  const { data, error } = await supabase.rpc('set_tiebreak_order', {
    p_team_ids: teamIds,
    p_clear: clear,
  });
  if (error) throw new Error(error.message);

  const res = data as { ok: boolean; error?: string; ordered?: number; cleared?: number };
  if (!res?.ok) {
    if (res?.error === 'not_allowed') throw new Error('Only admins can set the tie-breaker order');
    if (res?.error === 'no_teams') throw new Error('No teams were sent to reorder');
    throw new Error('Failed to save the tie-breaker order');
  }
  return res;
}

// ─── Tie-Breaker Questions ───────────────────────────────────────────────────
//
// A tie-break round, end to end: the quizmaster saves a short bank of questions,
// starts one in front of the tied teams, and the FIRST team to answer correctly
// wins the higher place. Everything that decides the outcome — who may answer,
// one shot each, whose correct answer arrived first — is enforced inside the
// database RPCs, so a slow network or a re-opened laptop can never change the
// verdict. The pages below only render what the server already decided.

/** The saved bank. `correct_key` is readable only by an admin, by RLS. */
export async function getTiebreakQuestions(): Promise<TiebreakQuestion[]> {
  const { data, error } = await supabase
    .from('tiebreak_questions')
    .select('*')
    .order('sort_order');

  if (error) throw error;
  return (data || []) as TiebreakQuestion[];
}

export async function createTiebreakQuestion(
  question: Omit<TiebreakQuestion, 'id' | 'created_at'>
): Promise<TiebreakQuestion> {
  const { data, error } = await supabase
    .from('tiebreak_questions')
    .insert(question)
    .select()
    .single();

  if (error) throw error;
  return data as TiebreakQuestion;
}

export async function updateTiebreakQuestion(
  id: string,
  updates: Partial<TiebreakQuestion>
): Promise<TiebreakQuestion> {
  const { data, error } = await supabase
    .from('tiebreak_questions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as TiebreakQuestion;
}

export async function deleteTiebreakQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('tiebreak_questions').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Put a saved question in front of the chosen teams. Admin-only (enforced in the
 * RPC). Any earlier live round is closed in the same statement, so exactly one
 * tie-break is ever running and no panel has to guess which one is current.
 */
export async function startTiebreak(questionId: string, teamIds: string[]) {
  const { data, error } = await supabase.rpc('start_tiebreak', {
    p_question_id: questionId,
    p_team_ids: teamIds,
  });
  if (error) throw new Error(error.message);

  const res = data as { ok: boolean; error?: string; session_id?: string; teams?: number };
  if (!res?.ok) {
    if (res?.error === 'not_allowed') throw new Error('Only admins can start a tie-breaker');
    if (res?.error === 'question_not_found') throw new Error('That tie-breaker question no longer exists');
    if (res?.error === 'no_teams') throw new Error('Pick at least one team to compete in the tie-breaker');
    throw new Error('Failed to start the tie-breaker');
  }
  return res;
}

export interface TiebreakSubmitResult {
  correct: boolean;
  won: boolean;
  /** the RPC replayed this team's own winning answer (a retry, not a new pick) */
  alreadySettled: boolean;
}

/**
 * A selected team's one shot at the live tie-breaker. The RPC decides everything
 * — eligibility, one attempt per team, and whether this pick was the first
 * correct one — under a row lock, so two simultaneous buzzer presses can never
 * both win.
 */
export async function submitTiebreakAnswer(
  sessionId: string,
  selectedKey: McqKey
): Promise<TiebreakSubmitResult> {
  const { data, error } = await supabase.rpc('submit_tiebreak_answer', {
    p_session_id: sessionId,
    p_selected_key: selectedKey,
  });
  if (error) throw new Error(error.message);

  const res = data as {
    ok: boolean; error?: string; correct?: boolean; won?: boolean; already_settled?: boolean;
  };
  if (!res?.ok) {
    const messages: Record<string, string> = {
      not_a_team_member: 'Your account is not linked to a team',
      session_not_found: 'This tie-breaker is no longer available',
      not_eligible: 'Your team is not in this tie-breaker',
      already_answered: 'Your team has already answered',
      tiebreak_closed: 'Another team answered first — the tie-breaker is over',
      invalid_key: 'Pick one of the options',
    };
    throw new Error((res.error && messages[res.error]) || 'Failed to submit your answer');
  }

  return {
    correct: res.correct ?? false,
    won: res.won ?? false,
    alreadySettled: res.already_settled ?? false,
  };
}

/** End the live round (no id = whichever round is running). Admin-only. */
export async function closeTiebreak(sessionId?: string | null) {
  const { data, error } = await supabase.rpc('close_tiebreak', {
    p_session_id: sessionId ?? null,
  });
  if (error) throw new Error(error.message);

  const res = data as { ok: boolean; error?: string; closed?: number };
  if (!res?.ok) {
    if (res?.error === 'not_allowed') throw new Error('Only admins can stop a tie-breaker');
    throw new Error('Failed to stop the tie-breaker');
  }
  return res;
}

/**
 * The current (or most recently run) tie-break, as much of it as the caller may
 * see. An admin gets the picks, their correctness and the answer key throughout;
 * a team or the logged-out projector gets only who has answered until the round
 * closes, when the reveal happens. Callable by anon.
 */
export async function getTiebreakState(): Promise<TiebreakState> {
  const empty: TiebreakState = { session: null, question: null, answers: [] };

  const { data, error } = await supabase.rpc('get_tiebreak_state');
  if (error) return empty;

  const res = data as ({ ok: boolean } & Partial<TiebreakState>) | null;
  if (!res?.ok) return empty;

  return {
    session: res.session ?? null,
    question: res.question ?? null,
    answers: res.answers ?? [],
  };
}

// ─── Auction Items ───────────────────────────────────────────────────────────

export async function getAuctionItems(): Promise<AuctionItem[]> {
  const { data, error } = await supabase
    .from('auction_items')
    .select('*')
    .order('sort_order');

  if (error) throw error;
  return data as AuctionItem[];
}

export async function getActiveAuctionItems(): Promise<AuctionItem[]> {
  const { data, error } = await supabase
    .from('auction_items')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');

  if (error) throw error;
  return data as AuctionItem[];
}

export async function createAuctionItem(item: Omit<AuctionItem, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('auction_items')
    .insert(item)
    .select()
    .single();

  if (error) throw error;
  return data as AuctionItem;
}

export async function updateAuctionItem(id: string, updates: Partial<AuctionItem>) {
  const { data, error } = await supabase
    .from('auction_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as AuctionItem;
}

export async function deleteAuctionItem(id: string) {
  const { error } = await supabase.from('auction_items').delete().eq('id', id);
  if (error) throw error;
}

// ─── Auctions ────────────────────────────────────────────────────────────────

export async function getAuctions(): Promise<Auction[]> {
  const { data, error } = await supabase
    .from('auctions')
    .select('*')
    .order('created_at');

  if (error) throw error;
  return data as Auction[];
}

export async function getCurrentAuction(): Promise<AuctionWithItem | null> {
  const { data, error } = await supabase
    .from('auctions')
    .select('*, item:auction_items(*)')
    .in('status', ['open', 'closed', 'question'])
    .order('created_at', { ascending: false })
    // Deterministic tie-break: two auctions inserted in the same instant used
    // to resolve to DIFFERENT rows on different clients (admin watched one,
    // teams another — the "wrong team got the question" glitch).
    .order('id', { ascending: false })
    .limit(1)
    // maybeSingle: "no live auction" is a normal state, not an error.
    .maybeSingle();

  if (error) return null;
  return data as unknown as AuctionWithItem;
}

export async function getAuctionWithItem(auctionId: string): Promise<AuctionWithItem | null> {
  const { data, error } = await supabase
    .from('auctions')
    .select('*, item:auction_items(*)')
    .eq('id', auctionId)
    .single();

  if (error) return null;
  return data as unknown as AuctionWithItem;
}

export async function startAuction(itemId: string, timerDuration: number): Promise<Auction> {
  // Only one live auction at a time — a second concurrent row used to make
  // different clients resolve "the current auction" differently.
  const { data: activeAuction } = await supabase
    .from('auctions')
    .select('id')
    .in('status', ['open', 'closed', 'question'])
    .limit(1);
  if (activeAuction && activeAuction.length > 0) {
    throw new Error('Another auction is still active. Close or skip it first.');
  }

  // Get the item's starting bid
  const item = await supabase
    .from('auction_items')
    .select('starting_bid')
    .eq('id', itemId)
    .single();

  if (item.error) throw item.error;

  const { data, error } = await supabase
    .from('auctions')
    .insert({
      item_id: itemId,
      status: 'open',
      current_bid: item.data.starting_bid,
      timer_duration: timerDuration,
      // Absolute bidding deadline (45s) on the SERVER clock. Every panel counts
      // down from this one timestamp, so admin/teams/display always agree.
      bidding_ends_at: new Date(serverNow() + BIDDING_DURATION_SECONDS * 1000).toISOString(),
      started_at: serverNowIso(),
    })
    .select()
    .single();

  if (error) throw error;
  return data as Auction;
}

export async function updateAuction(id: string, updates: Partial<Auction>) {
  const { data, error } = await supabase
    .from('auctions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Auction;
}

export async function closeAuction(id: string) {
  return updateAuction(id, {
    status: 'closed',
    closed_at: new Date().toISOString(),
  });
}

export async function completeAuction(id: string) {
  return updateAuction(id, { status: 'completed' });
}

// ─── Bids ────────────────────────────────────────────────────────────────────

/**
 * Place (or raise) a bid — ATOMICALLY, inside the database.
 *
 * Why an RPC instead of the old read → upsert → guarded-update dance: at the
 * buzzer the settlement could run BETWEEN those statements. close_bidding()
 * would lock the auction, crown the second-last bidder and settle the round,
 * while the late bid row was already stored — so the admin's feed showed a
 * higher bid that never won (the "question went to the wrong team" bug).
 *
 * place_bid() takes the SAME row lock as close_bidding(), so the two can never
 * interleave: the bid is either counted by the settlement or refused outright —
 * never left behind as a ghost row. The team is identified from the JWT, and
 * the 2s buzzer grace lets a bid fired before the deadline land just after it.
 *
 * Returns the accepted bid amount.
 */
export async function placeBid(auctionId: string, amount: number): Promise<number> {
  const { data, error } = await supabase.rpc('place_bid', {
    p_auction_id: auctionId,
    p_amount: amount,
  });
  if (error) throw new Error(error.message);

  const res = data as {
    ok: boolean; error?: string; amount?: number;
    current_bid?: number; minimum_increment?: number;
  };
  if (!res?.ok) {
    switch (res?.error) {
      case 'bidding_closed':
        throw new Error('Bidding is over for this item — the round is being settled.');
      case 'insufficient_budget':
        throw new Error('Insufficient Tech Coins');
      case 'bid_too_low':
        throw new Error(`Bid must be higher than current bid of ${res.current_bid} TC`);
      case 'below_minimum_increment':
        throw new Error(`Minimum increment is ${res.minimum_increment} TC`);
      case 'not_a_team_member':
        throw new Error('Your account is not linked to a team');
      case 'invalid_amount':
        throw new Error('Enter a valid bid amount');
      default:
        throw new Error('Failed to place bid');
    }
  }

  return res.amount ?? amount;
}

export async function getBidsForAuction(auctionId: string): Promise<Bid[]> {
  const { data, error } = await supabase
    .from('bids')
    .select('*')
    .eq('auction_id', auctionId)
    // Only bids that actually count. Withdrawn rows (a bid that lost the race
    // for the auction row, or came in after the round settled) must never show
    // up in the admin feed / projector — that was the "last bid shown, someone
    // else got the question" confusion.
    .eq('is_valid', true)
    .order('amount', { ascending: false });

  if (error) throw error;
  return data as Bid[];
}

// ─── Auction Finalization ────────────────────────────────────────────────────

/**
 * Close the bidding phase and settle the round ATOMICALLY on the server.
 *
 * The winner is determined inside one database transaction from the bids
 * table itself (highest bid wins; on a tie, the earlier bid wins) — never
 * from client state, which is what used to let the admin panel and team
 * dashboards disagree about who won. The winning bid is deducted from the
 * winner's budget and the budget transaction recorded in the SAME
 * transaction. Idempotent: closing an already-closed auction is a no-op.
 *
 * force=false → auto-close: only settles once the bidding deadline passed.
 * force=true  → admin "CLOSE BIDDING" (admin role enforced inside the RPC).
 */
export async function closeBidding(auctionId: string, force = false) {
  const { data, error } = await supabase.rpc('close_bidding', {
    p_auction_id: auctionId,
    p_force: force,
  });
  if (error) throw new Error(error.message);
  return data as {
    ok: boolean;
    error?: string;
    already_closed?: boolean;
    winning_team_id: string | null;
    winning_bid?: number | null;
  };
}

/**
 * Settle a round whose question timer ran out — the clock decided, so the round
 * is marked WRONG (bid lost) and the announcement is flagged `expired`, which
 * is what makes every screen show TIME'S UP + the correct answer.
 *
 * Callable by any client (the projector is logged out) and safe to spam: the
 * RPC locks the auction row, re-checks the deadline on the SERVER clock, only
 * touches the question phase, ignores a paused/never-started timer, and keeps
 * the verdict of a round that was already answered. Clients simply retry while
 * it answers `not_expired`.
 */
export async function expireQuestion(auctionId: string) {
  const { data, error } = await supabase.rpc('expire_question', {
    p_auction_id: auctionId,
  });
  if (error) throw new Error(error.message);
  return data as {
    ok: boolean;
    error?: string;
    skipped?: boolean;
    already_settled?: boolean;
    already_graded?: boolean;
    result?: 'correct' | 'wrong';
    expired?: boolean;
  };
}

// ─── Question Attempts ───────────────────────────────────────────────────────

/**
 * Admin grades the round (MARK CORRECT / MARK WRONG). The whole settlement —
 * attempt row, score, budget refund/bonus, counters, inactivity ticks, auction
 * completed — happens atomically inside the grade_answer() RPC; the admin role
 * is enforced server-side. This is the override path: the team's own pick is
 * usually already auto-verified by submitTeamAnswer, in which case the RPC
 * reports already_graded and this resolves to null.
 */
export async function recordAnswer(
  auctionId: string,
  result: 'correct' | 'wrong'
): Promise<QuestionAttempt | null> {
  const { data, error } = await supabase.rpc('grade_answer', {
    p_auction_id: auctionId,
    p_result: result,
  });
  if (error) throw new Error(error.message);

  const res = data as { ok: boolean; error?: string; already_graded?: boolean };
  if (!res?.ok) {
    if (res?.error === 'not_allowed') throw new Error('Only admins can grade answers');
    if (res?.error === 'already_graded') return null;
    throw new Error(res?.error || 'Failed to record the answer');
  }

  // Return the settled attempt (if the row exists) so callers can refresh UI.
  const attempts = await getAttemptsForAuction(auctionId);
  return attempts[0] ?? null;
}

// ─── MCQ Answer Submission (team side) ───────────────────────────────────────

export interface SubmitAnswerResult {
  /** true when the item had an answer key and the RPC settled the round */
  graded: boolean;
  result: 'correct' | 'wrong' | null;
  /** TC returned to the winner on a correct pick (bid refund + 150 bonus) */
  reward: number;
  /** TC lost on a wrong pick (the winning bid) */
  bidLost: number;
}

/**
 * Team picks an MCQ option during the question phase. The submit_team_answer()
 * RPC stores the pick and — when the item carries a correct_answer — verifies
 * it SERVER-SIDE and settles the round atomically (refund/bonus or lost bid,
 * counters, score, inactivity ticks, auction completed). Items without a key
 * stay on the quizmaster's manual grading path.
 */
export async function submitTeamAnswer(
  auctionId: string,
  selectedAnswer: string
): Promise<SubmitAnswerResult> {
  const { data, error } = await supabase.rpc('submit_team_answer', {
    p_auction_id: auctionId,
    p_selected: selectedAnswer,
  });
  if (error) throw new Error(error.message);

  const res = data as {
    ok: boolean; error?: string; graded?: boolean;
    result?: 'correct' | 'wrong'; reward?: number; bid_lost?: number;
  };
  if (!res?.ok) {
    const messages: Record<string, string> = {
      auction_not_found: 'Auction not found',
      not_in_question_phase: 'The question phase is not active',
      not_a_team_member: 'Your account is not linked to a team',
      only_winner_can_answer: 'Only the winning team can answer this question',
      already_graded: 'Your answer has already been graded',
      time_up: "Time's up for this question",
    };
    throw new Error((res.error && messages[res.error]) || 'Failed to submit answer');
  }

  return {
    graded: res.graded ?? false,
    result: res.result ?? null,
    reward: res.reward ?? 0,
    bidLost: res.bid_lost ?? 0,
  };
}

/**
 * The newest graded-answer announcement. Written by settle_answer() the moment
 * a question is settled (team auto-verify OR quizmaster override) and mirrored
 * to every panel over realtime.
 */
export async function getLatestRoundResult(): Promise<RoundResult | null> {
  const { data, error } = await supabase
    .from('round_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data as RoundResult | null;
}

export async function getAttemptsForAuction(auctionId: string): Promise<QuestionAttempt[]> {
  const { data, error } = await supabase
    .from('question_attempts')
    .select('*')
    .eq('auction_id', auctionId);

  if (error) throw error;
  return (data || []) as QuestionAttempt[];
}

// ─── Bonus / Penalty ─────────────────────────────────────────────────────────

export async function applyBonus(
  teamId: string,
  amount: number,
  reason: string,
  adminId: string
) {
  const { data: team } = await supabase
    .from('teams')
    .select('score')
    .eq('id', teamId)
    .single();

  if (!team) throw new Error('Team not found');

  await supabase
    .from('teams')
    .update({ score: team.score + amount })
    .eq('id', teamId);

  await supabase
    .from('score_transactions')
    .insert({
      team_id: teamId,
      type: 'bonus',
      amount,
      reason,
      admin_id: adminId,
    });
}

export async function adjustBudget(
  teamId: string,
  amount: number,
  reason: string
) {
  const { data: team } = await supabase
    .from('teams')
    .select('current_budget')
    .eq('id', teamId)
    .single();

  if (!team) throw new Error('Team not found');

  await supabase
    .from('teams')
    .update({ current_budget: team.current_budget + amount })
    .eq('id', teamId);

  await supabase
    .from('budget_transactions')
    .insert({
      team_id: teamId,
      type: 'manual_adjustment',
      amount,
      reason,
    });
}

// Recent manual TC adjustments for a team (the admin's add/deduct together
// with the reason entered at the time), newest first — surfaced on the team
// dashboard so a budget change is never unexplained.
export async function getBudgetTransactions(
  teamId: string,
  limit = 5
): Promise<BudgetTransaction[]> {
  const { data, error } = await supabase
    .from('budget_transactions')
    .select('*')
    .eq('team_id', teamId)
    .eq('type', 'manual_adjustment')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ─── Event Logs ──────────────────────────────────────────────────────────────

export async function logEvent(
  action: string,
  entityType: string,
  entityId?: string,
  metadata?: Record<string, unknown>
) {
  const { data: { user } } = await supabase.auth.getUser();

  await supabase
    .from('event_logs')
    .insert({
      actor_id: user?.id || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      metadata: metadata || null,
    });
}

export async function getEventLogs(): Promise<EventLog[]> {
  const { data, error } = await supabase
    .from('event_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;
  return data as EventLog[];
}

// Delete one audit entry (targeted cleanup from the Audit Log page).
export async function deleteEventLog(id: string): Promise<void> {
  const { error } = await supabase.from('event_logs').delete().eq('id', id);
  if (error) throw error;
}

// Wipe the whole audit trail (Settings → Audit History). Deliberately does
// NOT log itself: the wipe must be able to empty the log completely, so no
// entry survives to document who pressed the button.
export async function clearEventLogs(): Promise<void> {
  const { error } = await supabase
    .from('event_logs')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw error;
}

// ─── Demo Mode ───────────────────────────────────────────────────────────────

export async function resetDemoMode() {
  // Reset all teams
  const { data: settings } = await supabase
    .from('event_settings')
    .select('starting_budget')
    .limit(1)
    .single();

  const budget = settings?.starting_budget || 1000;

  await supabase
    .from('teams')
    .update({
      current_budget: budget,
      score: 0,
      correct_answers: 0,
      wrong_answers: 0,
      auctions_won: 0,
      rounds_inactive: 0,
      // A demo reset clears the quizmaster's tie-breaker rulings too, so the
      // standings fall back to the automatic order.
      tiebreak_order: null,
    })
    .neq('id', '00000000-0000-0000-0000-000000000000');

  // A demo reset clears the tie-breaker rounds as well — the bank itself is
  // prepared material and is deliberately kept.
  await supabase.from('tiebreak_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Delete all auctions, bids, attempts, transactions
  await supabase.from('question_attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('bids').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('auctions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('score_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('budget_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Reset event status back to lobby
  const { data: allSettings } = await supabase.from('event_settings').select('id').limit(1);
  if (allSettings && allSettings.length > 0) {
    await supabase.from('event_settings').update({ status: 'lobby' }).eq('id', allSettings[0].id);
  }
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

export async function exportFinalResults(): Promise<string> {
  const rankings = await getRankings();

  const header = 'Rank,Team Name,Final Score,Remaining Tech Coins,Auctions Won,Correct Answers,Wrong Answers,Qualification Status';
  const rows = rankings.map(r =>
    `${r.rank},"${r.name}",${r.score},${r.current_budget},${r.auctions_won},${r.correct_answers},${r.wrong_answers},${r.qualified ? 'QUALIFIED' : 'NOT QUALIFIED'}`
  );

  return [header, ...rows].join('\n');
}

export async function exportAuctionHistory(): Promise<string> {
  const { data: auctions } = await supabase
    .from('auctions')
    .select('*, item:auction_items(name), team:teams(name)')
    .eq('status', 'completed')
    .order('closed_at');

  if (!auctions) return '';

  const header = 'Auction Item,Winning Team,Winning Bid,Reward,Penalty,Answer Result,Timestamp';
  const rows = auctions.map((a: any) => {
    const item = a.item;
    const team = a.team;
    return `"${item?.name || 'N/A'}","${team?.name || 'N/A'}",${a.winning_bid || 0},${item?.reward_points || 0},${item?.penalty_points || 0},,${a.closed_at || ''}`;
  });

  return [header, ...rows].join('\n');
}
