import { type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTeamPresence } from '../../hooks/useRealtime';
import { Badge, Logo } from '../ui';
import { LogOut } from 'lucide-react';

export default function TeamLayout({ children }: { children: ReactNode }) {
  const { team, signOut } = useAuth();
  useTeamPresence(team?.short_name || null, team?.id || null);

  return (
    <div className="min-h-screen bg-dark-900 grid-bg">
      {/* Header */}
      <header className="glass-strong border-b border-dark-400 sticky top-0 z-40">
        {/* Full-width bar (no max-w cap): brand tucks into the top-left
            corner and controls into the top-right, however wide the screen. */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 shrink-0 overflow-hidden rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
              <Logo size={36} className="w-full h-full" />
            </div>
            <div>
              <h1 className="text-xs font-bold text-slate-900 tracking-widest">TECH AUCTION</h1>
              {team && (
                <p className="text-xs text-cyan-400 font-mono">{team.name}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {team && (
              <Badge variant="cyan">{team.short_name}</Badge>
            )}
            <button
              onClick={signOut}
              className="text-slate-500 hover:text-red-400 transition-colors"
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
