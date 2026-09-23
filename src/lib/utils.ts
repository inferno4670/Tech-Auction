import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCoins(amount: number): string {
  return amount.toLocaleString();
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ─── Leaderboard podium styling (ranks 1–3) ──────────────────────────────────
//
// Gold, silver and bronze are marked with a LIGHT tint: a soft row wash, a
// matching border and a small rank chip. Team names, scores and TC figures keep
// their own colours untouched, so the medal can never wash out the data — and
// every leaderboard (admin dashboard, leaderboard page, live control, team
// panel, projector) shares these three helpers, so the podium looks identical
// everywhere.

export function podiumRowClass(rank: number): string {
  switch (rank) {
    case 1: return 'bg-amber-500/15 border border-amber-500/50';
    case 2: return 'bg-slate-400/20 border border-slate-400/60';
    case 3: return 'bg-orange-500/15 border border-orange-500/45';
    default: return '';
  }
}

/** Chip / rank-number styling for the top three (light tint + readable ink). */
export function podiumRankClass(rank: number): string {
  switch (rank) {
    case 1: return 'bg-amber-500/20 text-amber-700 border border-amber-500/50';
    case 2: return 'bg-slate-400/25 text-slate-600 border border-slate-400/60';
    case 3: return 'bg-orange-500/20 text-orange-700 border border-orange-500/50';
    default: return '';
  }
}

/** Medal name for the top three (used for tooltips / screen readers). */
export function podiumLabel(rank: number): string {
  switch (rank) {
    case 1: return 'Gold — 1st place';
    case 2: return 'Silver — 2nd place';
    case 3: return 'Bronze — 3rd place';
    default: return `Rank ${rank}`;
  }
}

export function getDifficultyColor(difficulty: string): string {
  switch (difficulty) {
    case 'basic': return 'text-green-400 bg-green-500/10 border-green-500/30';
    case 'intermediate': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    case 'expert': return 'text-red-400 bg-red-500/10 border-red-500/30';
    default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'live':
    case 'open': return 'text-green-400';
    case 'paused': return 'text-amber-400';
    case 'finalized': return 'text-slate-400';
    case 'question': return 'text-violet-400';
    case 'completed': return 'text-cyan-400';
    default: return 'text-slate-500';
  }
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function generatePassword(length: number = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}
