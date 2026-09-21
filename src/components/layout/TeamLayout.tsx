import { type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTeamPresence } from '../../hooks/useRealtime';
import { ConnectionStatus, Badge, Logo } from '../ui';
import { LogOut } from 'lucide-react';

export default function TeamLayout({ children }: { children: ReactNode }) {
  const { team, signOut } = useAuth();
  useTeamPresence(team?.short_name || null, team?.id || null);

  return (
    <div className="min-h-screen bg-dark-900 grid-bg">
      {/* Header */}
      <header className="glass-strong border-b border-dark-400 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
              <Logo size={16} />
            </div>
            <div>
              <h1 className="text-xs font-bold text-slate-900 tracking-widest">TECH AUCTION</h1>
              {team && (
                <p className="text-xs text-cyan-400 font-mono">{team.name}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <ConnectionStatus status="live" />
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
