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
