import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ConnectionStatus, Logo } from '../ui';
import {
  LayoutDashboard, Users, Gavel, BarChart3,
  FileText, Settings, LogOut, Zap
} from 'lucide-react';
import { cn } from '../../lib/utils';

const navItems = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/admin/teams', label: 'Teams', icon: Users },
  { path: '/admin/auctions', label: 'Auctions', icon: Gavel },
  { path: '/admin/live', label: 'Live Control', icon: Zap },
  { path: '/admin/leaderboard', label: 'Leaderboard', icon: BarChart3 },
  { path: '/admin/logs', label: 'Audit Log', icon: FileText },
  { path: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-dark-900 grid-bg flex">
      {/* Sidebar */}
      <aside className="w-64 glass-strong border-r border-dark-400 flex flex-col fixed h-full z-40">
        {/* Logo */}
        <div className="p-6 border-b border-dark-400">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 shrink-0 overflow-hidden rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
              <Logo size={40} className="w-full h-full" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 tracking-wider">TECH AUCTION</h1>
              <p className="text-xs text-cyan-400 font-mono">CONTROL ROOM</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = item.path === '/admin'
              ? location.pathname === '/admin'
              : location.pathname.startsWith(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                    : 'text-slate-400 hover:text-slate-900 hover:bg-slate-100'
                )}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-dark-400">
          <div className="flex items-center justify-between mb-3">
            <ConnectionStatus status="live" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-mono truncate">
              {profile?.display_name || 'Admin'}
            </span>
            <button
              onClick={signOut}
              className="text-slate-500 hover:text-red-400 transition-colors"
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-64 p-8">
        {children}
      </main>
    </div>
  );
}
