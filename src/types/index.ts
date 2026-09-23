// ─── Database Entity Types ───────────────────────────────────────────────────

export type UserRole = 'admin' | 'team';
export type AuctionStatus = 'scheduled' | 'open' | 'closed' | 'question' | 'completed' | 'cancelled';

/** Fixed bidding window once an auction opens (seconds). */
export const BIDDING_DURATION_SECONDS = 45;

/** MCQ choice key for a question. */
export type McqKey = 'A' | 'B' | 'C' | 'D';

export const MCQ_KEYS: McqKey[] = ['A', 'B', 'C', 'D'];
export type Difficulty = 'basic' | 'intermediate' | 'expert';
export type ScoreTransactionType = 'reward' | 'penalty' | 'bonus' | 'manual_adjustment';
export type BudgetTransactionType = 'starting_budget' | 'bid' | 'refund' | 'manual_adjustment';
export type RoundStatus = 'setup' | 'lobby' | 'live' | 'paused' | 'finalized';
export type AnswerResult = 'correct' | 'wrong' | null;

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  display_name: string;
  created_at: string;
}

// ─── Team ────────────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  short_name: string;
  logo_url: string | null;
  starting_budget: number;
  current_budget: number;
  score: number;
  correct_answers: number;
  wrong_answers: number;
  auctions_won: number;
  rounds_inactive: number;
  is_active: boolean;
  created_at: string;
}

// ─── Team Member ─────────────────────────────────────────────────────────────

export interface TeamMember {
  id: string;
  user_id: string;
  team_id: string;
}

// ─── Auction Item ────────────────────────────────────────────────────────────

export interface AuctionItem {
  id: string;
  name: string;
  category: string;
  description: string;
  difficulty: Difficulty;
  starting_bid: number;
  minimum_increment: number;
  reward_points: number;
  penalty_points: number;
  question: string;
  correct_answer: string;
  option_a: string | null;
  option_b: string | null;
  option_c: string | null;
  option_d: string | null;
  hint: string | null;
  special_rule: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

// ─── Auction (live session for an item) ──────────────────────────────────────

export interface Auction {
  id: string;
  item_id: string;
  status: AuctionStatus;
  current_bid: number;
  current_team_id: string | null;
  winning_bid: number | null;
  winning_team_id: string | null;
  timer_started_at: string | null;
  timer_duration: number;
  timer_paused: boolean;
  /** Absolute deadline for the bidding phase (server clock). */
  bidding_ends_at: string | null;
  started_at: string | null;
  closed_at: string | null;
  created_at: string;
}

// ─── Bid ─────────────────────────────────────────────────────────────────────

export interface Bid {
  id: string;
  auction_id: string;
  team_id: string;
  amount: number;
  is_valid: boolean;
  created_at: string;
}

// ─── Question Attempt ────────────────────────────────────────────────────────

export interface QuestionAttempt {
  id: string;
  auction_id: string;
  team_id: string;
  result: AnswerResult;
  points_awarded: number;
  /** MCQ choice the team picked ('A'–'D'), if the question had options. */
  selected_answer: string | null;
  answered_at: string;
  admin_id: string | null;
}

// ─── Round Result (graded-answer announcement) ───────────────────────────────
//
// Written by settle_answer() the moment a question is graded — whether the
// team's pick was auto-verified or the quizmaster graded it by hand. Every
// panel (admin, all team dashboards, the projector) subscribes to this table
// over realtime, so the verdict appears everywhere at the same instant.
export interface RoundResult {
  id: string;
  auction_id: string;
  item_id: string | null;
  item_name: string | null;
  team_id: string | null;
  team_name: string | null;
  result: 'correct' | 'wrong';
  selected_answer: string | null;
  correct_answer: string | null;
  reward: number;
  penalty: number;
  graded_by: 'auto' | 'admin';
  /** true when the round was settled by the question timer running out, not by
   *  a pick — the announcements render TIME'S UP instead of WRONG. */
  expired: boolean;
  created_at: string;
}

// ─── Score Transaction ───────────────────────────────────────────────────────

export interface ScoreTransaction {
  id: string;
  team_id: string;
  type: ScoreTransactionType;
  amount: number;
  reason: string;
  reference_id: string | null;
  admin_id: string | null;
  created_at: string;
}

// ─── Budget Transaction ──────────────────────────────────────────────────────

export interface BudgetTransaction {
  id: string;
  team_id: string;
  type: BudgetTransactionType;
  amount: number;
  reason: string;
  reference_id: string | null;
  created_at: string;
}

// ─── Event Settings ──────────────────────────────────────────────────────────

export interface EventSettings {
  id: string;
  event_name: string;
  starting_budget: number;
  default_question_time: number;
  status: RoundStatus;
  demo_mode: boolean;
  live_mode: boolean;
  created_at: string;
}

// ─── Event Log ───────────────────────────────────────────────────────────────

export interface EventLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ─── Extended / Computed Types ───────────────────────────────────────────────

export interface TeamWithRank extends Team {
  rank: number;
  qualified: boolean;
}

export interface AuctionWithItem extends Auction {
  item: AuctionItem;
}

export interface AuctionWithDetails extends Auction {
  item: AuctionItem;
  bids: Bid[];
  team?: Team;
}

// ─── Team-visible auction (no answer) ────────────────────────────────────────

export interface PublicAuction {
  id: string;
  item_name: string;
  category: string;
  description: string;
  difficulty: Difficulty;
  starting_bid: number;
  minimum_increment: number;
  reward_points: number;
  penalty_points: number;
  current_bid: number;
  current_team_id: string | null;
  status: AuctionStatus;
  timer_started_at: string | null;
  timer_duration: number;
  timer_paused: boolean;
  bidding_ends_at: string | null;
}

// ─── Admin-visible auction (with answer) ─────────────────────────────────────

export interface AdminAuction extends PublicAuction {
  correct_answer: string;
  winning_team_id: string | null;
  question: string;
  special_rule: string | null;
}

// ─── Display State ───────────────────────────────────────────────────────────

export interface DisplayState {
  status: RoundStatus;
  current_auction: PublicAuction | null;
  leaderboard: TeamWithRank[];
  event_name: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DIFFICULTY_PRESETS: Record<Difficulty, Omit<AuctionItem, 'id' | 'name' | 'category' | 'description' | 'question' | 'correct_answer' | 'option_a' | 'option_b' | 'option_c' | 'option_d' | 'sort_order' | 'is_active' | 'created_at' | 'hint' | 'special_rule' | 'image_url'>> = {
  basic: {
    starting_bid: 50,
    minimum_increment: 10,
    reward_points: 75,
    penalty_points: 25,
    difficulty: 'basic',
  },
  intermediate: {
    starting_bid: 100,
    minimum_increment: 25,
    reward_points: 150,
    penalty_points: 75,
    difficulty: 'intermediate',
  },
  expert: {
    starting_bid: 200,
    minimum_increment: 50,
    reward_points: 250,
    penalty_points: 150,
    difficulty: 'expert',
  },
};

export const DEFAULT_STARTING_BUDGET = 1000;
export const DEFAULT_QUESTION_TIME = 25;
/** Teams that survive the cut advance — see getRankings(). */
export const TOP_QUALIFY_COUNT = 6;
