import { supabase } from './supabase';
import { serverNow, serverNowIso } from './serverTime';
import { BIDDING_DURATION_SECONDS } from '../types';
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

export async function createTeam(team: Omit<Team, 'id' | 'created_at' | 'score' | 'correct_answers' | 'wrong_answers' | 'auctions_won' | 'rounds_inactive' | 'current_budget'>) {
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

export async function getRankings(): Promise<TeamWithRank[]> {
  const teams = await getTeams();
  const sorted = [...teams]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.current_budget !== a.current_budget) return b.current_budget - a.current_budget;
      if (b.correct_answers !== a.correct_answers) return b.correct_answers - a.correct_answers;
      return a.name.localeCompare(b.name);
    });

  return sorted.map((team, index) => ({
    ...team,
    rank: index + 1,
    qualified: index < 4,
  }));
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
      // Absolute 60s bidding deadline on the SERVER clock. Every panel counts
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

export async function placeBid(auctionId: string, teamId: string, amount: number): Promise<Bid> {
  // Server-side validation
  const { data: auction, error: auctionError } = await supabase
    .from('auctions')
    .select('*, item:auction_items(starting_bid, minimum_increment)')
    .eq('id', auctionId)
    .single();

  if (auctionError || !auction) throw new Error('Auction not found');
  if (auction.status !== 'open') throw new Error('Auction is not open for bidding');

  // Bidding window expired — no more bids (the 60s auto-close settles it).
  if (auction.bidding_ends_at && serverNow() >= new Date(auction.bidding_ends_at).getTime()) {
    throw new Error('Bidding time is over for this item');
  }

  const item = auction.item as any;
  if (amount <= auction.current_bid) {
    throw new Error(`Bid must be higher than current bid of ${auction.current_bid}`);
  }
  if (amount < auction.current_bid + item.minimum_increment) {
    throw new Error(`Minimum increment is ${item.minimum_increment} TC`);
  }

  // Check team budget
  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('current_budget')
    .eq('id', teamId)
    .single();

  if (teamError || !team) throw new Error('Team not found');
  if (team.current_budget < amount) {
    throw new Error('Insufficient Tech Coins');
  }

  // Atomic upsert on (auction_id, team_id) — requires the unique index from
  // migration 007. Replaces the old select-then-insert/update, which both raced
  // between teams and crashed with PGRST116 ("Cannot coerce the result to a
  // single JSON object") when a team raised a bid (no UPDATE policy on bids).
  const { data: bid, error: bidError } = await supabase
    .from('bids')
    .upsert(
      { auction_id: auctionId, team_id: teamId, amount, is_valid: true },
      { onConflict: 'auction_id,team_id' }
    )
    .select()
    .single();

  if (bidError) {
    const code = (bidError as any).code;
    if (code === '23505') throw new Error('Bid conflict — another bid just landed. Try again.');
    if (code === '42501') throw new Error('You are not allowed to modify this bid.');
    throw new Error(bidError.message || 'Failed to record bid');
  }

  // Update auction current bid — guarded so only a bid ABOVE the stored
  // current_bid can land. This closes the race where two teams bid
  // near-simultaneously: both passed validation against the same stale
  // current_bid and whichever update landed last used to overwrite the higher
  // bid (root cause of "admin shows team A as winner, question went to B").
  // RLS can also silently reject (0 rows, no error) when the auction closes
  // mid-bid — the team must not be told the bid succeeded then either.
  const { data: updated, error: updateError } = await supabase
    .from('auctions')
    .update({
      current_bid: amount,
      current_team_id: teamId,
    })
    .eq('id', auctionId)
    .eq('status', 'open')
    .lt('current_bid', amount)
    .select('id');

  if (updateError) throw new Error(`Failed to update auction: ${updateError.message}`);
  if (!updated || updated.length === 0) {
    // Our update lost the race or the auction closed — find out which.
    const { data: current } = await supabase
      .from('auctions')
      .select('status, current_bid')
      .eq('id', auctionId)
      .single();
    // Withdraw the losing bid so it can never win the tie-break later.
    await supabase
      .from('bids')
      .update({ is_valid: false })
      .eq('auction_id', auctionId)
      .eq('team_id', teamId)
      .eq('amount', amount);
    if (current?.status !== 'open') {
      throw new Error('Bid no longer accepted — the auction just closed.');
    }
    throw new Error(`Outbid! Current bid is now ${current?.current_bid ?? amount} TC — bid higher.`);
  }

  return bid as Bid;
}

export async function getBidsForAuction(auctionId: string): Promise<Bid[]> {
  const { data, error } = await supabase
    .from('bids')
    .select('*')
    .eq('auction_id', auctionId)
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
 * force=false → auto-close: only settles once the 60s bidding deadline passed.
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

// ─── Question Attempts ───────────────────────────────────────────────────────

export async function recordAnswer(
  auctionId: string,
  teamId: string,
  result: 'correct' | 'wrong',
  adminId: string
): Promise<QuestionAttempt> {
  // Get the auction to know the winning bid for refund logic
  const { data: auction } = await supabase
    .from('auctions')
    .select('winning_bid')
    .eq('id', auctionId)
    .single();

  const winningBid = auction?.winning_bid || 0;
  // Scoring rules: correct → refund the bid + 150 TC bonus to budget.
  // Wrong → the team simply loses the amount they bid (already deducted when
  // they won the auction) — NO extra penalty on top.
  const budgetReward = result === 'correct' ? winningBid + 150 : 0;

  // Attach the result to the team's submitted MCQ attempt if one exists;
  // otherwise create the attempt row. One attempt per (auction, team).
  const { data: updatedAttempts, error: updateAttemptError } = await supabase
    .from('question_attempts')
    .update({
      result,
      points_awarded: result === 'correct' ? 1 : 0,
      admin_id: adminId,
      answered_at: serverNowIso(),
    })
    .eq('auction_id', auctionId)
    .eq('team_id', teamId)
    .select();

  let attempt: QuestionAttempt | null = null;

  if (updateAttemptError) throw updateAttemptError;

  if (updatedAttempts && updatedAttempts.length > 0) {
    attempt = updatedAttempts[0] as QuestionAttempt;
  } else {
    const inserted = await supabase
      .from('question_attempts')
      .insert({
        auction_id: auctionId,
        team_id: teamId,
        result,
        points_awarded: result === 'correct' ? 1 : 0,
        admin_id: adminId,
      })
      .select()
      .single();
    if (inserted.error) throw inserted.error;
    attempt = inserted.data as QuestionAttempt;
  }

  if (!attempt) throw new Error('Failed to record the answer');

  // Update team: score + budget
  const { data: team } = await supabase
    .from('teams')
    .select('score, correct_answers, wrong_answers, current_budget')
    .eq('id', teamId)
    .single();

  if (team) {
    const updates: any = {};
    if (result === 'correct') {
      updates.correct_answers = team.correct_answers + 1;
      updates.current_budget = team.current_budget + budgetReward;
      updates.score = team.score + 1;
    } else {
      updates.wrong_answers = team.wrong_answers + 1;
    }
    await supabase.from('teams').update(updates).eq('id', teamId);
  }

  // Record score transaction for correct answer
  if (result === 'correct') {
    await supabase
      .from('score_transactions')
      .insert({
        team_id: teamId,
        type: 'reward',
        amount: 1,
        reason: 'Correct answer',
        reference_id: auctionId,
        admin_id: adminId,
      });
  }

  // Record budget transaction on correct answer
  if (budgetReward > 0) {
    await supabase
      .from('budget_transactions')
      .insert({
        team_id: teamId,
        type: 'refund',
        amount: budgetReward,
        reason: `Correct answer — bid refund + 150 TC bonus for auction ${auctionId}`,
        reference_id: auctionId,
      });
  }

  // Mark auction as completed
  await supabase
    .from('auctions')
    .update({ status: 'completed' })
    .eq('id', auctionId);

  // Check and apply inactive team penalties after each auction
  await checkAndApplyInactivePenalties(auctionId);

  return attempt as QuestionAttempt;
}

// ─── MCQ Answer Submission (team side) ───────────────────────────────────────

/**
 * Team picks an MCQ option during the question phase. Stored as a pending
 * attempt; the quizmaster still grades it (MARK CORRECT / MARK WRONG).
 */
export async function submitTeamAnswer(
  auctionId: string,
  teamId: string,
  selectedAnswer: string
): Promise<QuestionAttempt> {
  // Only while the question phase is live — no changing picks after grading.
  const { data: auction } = await supabase
    .from('auctions')
    .select('status, winning_team_id')
    .eq('id', auctionId)
    .single();

  if (!auction || auction.status !== 'question') {
    throw new Error('The question phase is not active');
  }
  if (auction.winning_team_id !== teamId) {
    throw new Error('Only the winning team can answer this question');
  }

  const { data: existing } = await supabase
    .from('question_attempts')
    .select('result')
    .eq('auction_id', auctionId)
    .eq('team_id', teamId)
    .single();

  if (existing?.result) throw new Error('Your answer has already been graded');

  const { data, error } = await supabase
    .from('question_attempts')
    .upsert(
      {
        auction_id: auctionId,
        team_id: teamId,
        selected_answer: selectedAnswer,
        result: null,
        points_awarded: 0,
      },
      { onConflict: 'auction_id,team_id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data as QuestionAttempt;
}

export async function getAttemptsForAuction(auctionId: string): Promise<QuestionAttempt[]> {
  const { data, error } = await supabase
    .from('question_attempts')
    .select('*')
    .eq('auction_id', auctionId);

  if (error) throw error;
  return (data || []) as QuestionAttempt[];
}

// ─── Inactive Team Penalties ─────────────────────────────────────────────────

const INACTIVE_ROUNDS_THRESHOLD = 3;
const INACTIVE_PENALTY_TC = 150;

export async function checkAndApplyInactivePenalties(
  completedAuctionId: string
): Promise<void> {
  // 1. Get the winning team of this auction
  const { data: completedAuction } = await supabase
    .from('auctions')
    .select('winning_team_id')
    .eq('id', completedAuctionId)
    .single();

  const winnerId = completedAuction?.winning_team_id;

  // 2. Get all active teams
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, rounds_inactive, current_budget')
    .eq('is_active', true);

  if (!allTeams || allTeams.length === 0) return;

  // 3. Winner resets counter; everyone else increments
  for (const team of allTeams) {
    if (team.id === winnerId) {
      await supabase
        .from('teams')
        .update({ rounds_inactive: 0 })
        .eq('id', team.id);
    } else {
      const newCount = team.rounds_inactive + 1;
      const updates: any = { rounds_inactive: newCount };

      if (newCount >= INACTIVE_ROUNDS_THRESHOLD) {
        updates.current_budget = Math.max(0, team.current_budget - INACTIVE_PENALTY_TC);
        updates.rounds_inactive = 0;

        await supabase
          .from('budget_transactions')
          .insert({
            team_id: team.id,
            type: 'manual_adjustment',
            amount: -INACTIVE_PENALTY_TC,
            reason: "Inactivity penalty - " + INACTIVE_ROUNDS_THRESHOLD + " rounds without winning",
            reference_id: completedAuctionId,
          });
      }

      await supabase
        .from('teams')
        .update(updates)
        .eq('id', team.id);
    }
  }
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
    })
    .neq('id', '00000000-0000-0000-0000-000000000000');

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
