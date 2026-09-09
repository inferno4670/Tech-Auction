const fs = require('fs');
let code = fs.readFileSync('src/lib/queries.ts', 'utf8');
let changed = 0;

// ═══ FIX 1: Replace broken RPC with direct update ═══
const old1 = `  // Update team auctions_won
  await supabase.rpc('increment_auctions_won', { team_id_input: winnerTeamId });`;
const new1 = `  // Update team auctions_won + reset inactivity counter
  const { data: winTeam } = await supabase.from("teams").select("auctions_won").eq("id", winnerTeamId).single();
  await supabase.from("teams").update({ auctions_won: (winTeam?.auctions_won ?? 0) + 1, rounds_inactive: 0 }).eq("id", winnerTeamId);`;
if (code.includes(old1)) { code = code.replace(old1, new1); changed++; console.log('Fix 1: replaced broken RPC'); }

// ═══ FIX 2: Upsert bid instead of always insert ═══
const old2 = `  // Insert the bid
  const { data: bid, error: bidError } = await supabase
    .from('bids')
    .insert({
      auction_id: auctionId,
      team_id: teamId,
      amount,
      is_valid: true,
    })
    .select()
    .single();

  if (bidError) throw bidError;`;
const new2 = `  // Upsert the bid — update if team already bid, insert otherwise
  const { data: existingBid } = await supabase
    .from('bids')
    .select('id')
    .eq('auction_id', auctionId)
    .eq('team_id', teamId)
    .single();

  let bid;
  if (existingBid) {
    const { data: updated, error: updateBidErr } = await supabase
      .from('bids')
      .update({ amount, is_valid: true })
      .eq('id', existingBid.id)
      .select()
      .single();
    if (updateBidErr) throw updateBidErr;
    bid = updated;
  } else {
    const { data: inserted, error: insertBidErr } = await supabase
      .from('bids')
      .insert({ auction_id: auctionId, team_id: teamId, amount, is_valid: true })
      .select()
      .single();
    if (insertBidErr) throw insertBidErr;
    bid = inserted;
  }`;
if (code.includes(old2)) { code = code.replace(old2, new2); changed++; console.log('Fix 2: upsert bid'); }

// ═══ FIX 3a: Scoring — correct = bid refund + 100 TC; wrong = bid lost ═══
const old3a = `  const winningBid = auction?.winning_bid || 0;
  const scoreReward = result === 'correct' ? 100 : 0;
  const budgetRefund = result === 'correct' ? winningBid : 0;`;
const new3a = `  const winningBid = auction?.winning_bid || 0;
  // Correct: refund bid + 100 TC to budget. Wrong: bid stays deducted.
  const budgetReward = result === 'correct' ? winningBid + 100 : 0;`;
if (code.includes(old3a)) { code = code.replace(old3a, new3a); changed++; console.log('Fix 3a: scoring vars'); }

// ═══ FIX 3b: Team update logic ═══
const old3b = `  if (team) {
    const updates: any = {
      score: team.score + scoreReward,
    };

    if (result === 'correct') {
      updates.correct_answers = team.correct_answers + 1;
      // Refund the winning bid back to budget
      updates.current_budget = team.current_budget + budgetRefund;
    } else {
      updates.wrong_answers = team.wrong_answers + 1;
      // Bid stays deducted — no refund
    }

    await supabase.from('teams').update(updates).eq('id', teamId);
  }`;
const new3b = `  if (team) {
    const updates: any = {};
    if (result === 'correct') {
      updates.correct_answers = team.correct_answers + 1;
      updates.current_budget = team.current_budget + budgetReward;
      updates.score = team.score + 1;
    } else {
      updates.wrong_answers = team.wrong_answers + 1;
    }
    await supabase.from('teams').update(updates).eq('id', teamId);
  }`;
if (code.includes(old3b)) { code = code.replace(old3b, new3b); changed++; console.log('Fix 3b: team update'); }

// ═══ FIX 3c: Score transaction ═══
const old3c = `  // Record score transaction
  if (scoreReward > 0) {
    await supabase
      .from('score_transactions')
      .insert({
        team_id: teamId,
        type: 'reward',
        amount: scoreReward,
        reason: \`Correct answer — bid refunded + \${scoreReward} pts\`,
        reference_id: auctionId,
        admin_id: adminId,
      });
  }`;
const new3c = `  // Record score transaction for correct answer
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
  }`;
if (code.includes(old3c)) { code = code.replace(old3c, new3c); changed++; console.log('Fix 3c: score transaction'); }

// ═══ FIX 3d: Budget transaction ═══
const old3d = `  // Record budget refund transaction if applicable
  if (budgetRefund > 0) {
    await supabase
      .from('budget_transactions')
      .insert({
        team_id: teamId,
        type: 'refund',
        amount: budgetRefund,
        reason: \`Bid refunded — correct answer for auction \${auctionId}\`,
        reference_id: auctionId,`;
const new3d = `  // Record budget transaction on correct answer
  if (budgetReward > 0) {
    await supabase
      .from('budget_transactions')
      .insert({
        team_id: teamId,
        type: 'refund',
        amount: budgetReward,
        reason: \`Correct answer — bid refund + 100 TC bonus for auction \${auctionId}\`,
        reference_id: auctionId,`;
if (code.includes(old3d)) { code = code.replace(old3d, new3d); changed++; console.log('Fix 3d: budget transaction'); }

// ═══ FIX 4: Inactivity — track wins, -100 TC penalty ═══
const old4 = `// ─── Inactive Team Penalties ─────────────────────────────────────────────────

const INACTIVE_ROUNDS_THRESHOLD = 3;
const INACTIVE_PENALTY = -50;

export async function checkAndApplyInactivePenalties(
  completedAuctionId: string
): Promise<void> {
  // 1. Get all teams
  const { data: allTeams } = await supabase
    .from('teams')
    .select('id, rounds_inactive')
    .eq('is_active', true);

  if (!allTeams || allTeams.length === 0) return;

  // 2. Get all teams that placed a bid in this completed auction
  const { data: bids } = await supabase
    .from('bids')
    .select('team_id')
    .eq('auction_id', completedAuctionId);

  const activeTeamIds = new Set((bids || []).map((b: any) => b.team_id));

  // 3. Update rounds_inactive for each team
  for (const team of allTeams) {
    if (activeTeamIds.has(team.id)) {
      // Team participated — reset counter
      await supabase
        .from('teams')
        .update({ rounds_inactive: 0 })
        .eq('id', team.id);
    } else {
      // Team did not participate — increment counter
      const newCount = team.rounds_inactive + 1;
      const updates: any = { rounds_inactive: newCount };

      // Apply penalty if threshold reached
      if (newCount >= INACTIVE_ROUNDS_THRESHOLD) {
        updates.score = Math.max(0, (await getTeam(team.id))?.score ?? 0) + INACTIVE_PENALTY;
        updates.rounds_inactive = 0; // reset after penalty

        // Record the penalty transaction
        await supabase
          .from('score_transactions')
          .insert({
            team_id: team.id,
            type: 'penalty',
            amount: INACTIVE_PENALTY,
            reason: \`Inactivity penalty — \${INACTIVE_ROUNDS_THRESHOLD} consecutive rounds without bidding\`,
            reference_id: completedAuctionId,
          });
      }

      await supabase
        .from('teams')
        .update(updates)
        .eq('id', team.id);
    }
  }
}`;
const new4 = `// ─── Inactive Team Penalties ─────────────────────────────────────────────────

const INACTIVE_ROUNDS_THRESHOLD = 3;
const INACTIVE_PENALTY_TC = 100;

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

  // 3. Update rounds_inac
