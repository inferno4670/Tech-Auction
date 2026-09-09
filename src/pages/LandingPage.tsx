import { useNavigate } from 'react-router-dom';
import { Zap, Shield, Users, Monitor, AlertTriangle } from 'lucide-react';
import { isConfigured } from '../lib/supabase';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-dark-900 grid-bg flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-cyan-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 w-[600px] h-[300px] bg-violet-500/5 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 right-0 w-[400px] h-[400px] bg-cyan-500/3 rounded-full blur-[80px]" />
      </div>

      <div className="relative z-10 text-center px-6 animate-fade-in">
        {/* Logo */}
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 mb-8 animate-float">
          <Zap className="text-cyan-400" size={40} />
        </div>

        {/* Title */}
        <h1 className="text-6xl md:text-8xl font-black text-slate-900 tracking-tighter mb-4 leading-none">
          TECH
          <span className="text-cyan-400 text-glow-cyan"> AUCTION</span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-slate-400 font-mono tracking-[0.3em] mb-2">
          NATIONAL LEVEL QUIZ COMPETITION
        </p>
        <div className="w-32 h-0.5 bg-gradient-to-r from-transparent via-cyan-500 to-transparent mx-auto mb-12" />

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-lg mx-auto">
          <button
            onClick={() => navigate('/admin/login')}
            className="w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-cyan-500 text-dark-900 font-bold text-sm tracking-wider hover:bg-cyan-400 transition-all duration-200 active:scale-95"
          >
            <Shield size={20} />
            ADMIN CONTROL ROOM
          </button>

          <button
            onClick={() => navigate('/team/login')}
            className="w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-slate-100 text-violet-400 border border-violet-500/30 font-bold text-sm tracking-wider hover:bg-dark-500 hover:border-violet-400/50 transition-all duration-200 active:scale-95"
          >
            <Users size={20} />
            TEAM LOGIN
          </button>
        </div>

        {/* Display mode link */}
        <button
          onClick={() => navigate('/display')}
          className="mt-8 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-cyan-400 transition-colors font-mono"
        >
          <Monitor size={14} />
          Presentation Display
        </button>

        {/* Setup Warning */}
        {!isConfigured && (
          <div className="mt-12 max-w-md mx-auto p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 animate-slide-up">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-amber-400 shrink-0" size={20} />
              <div className="text-left">
                <p className="text-amber-400 font-bold text-sm">Supabase Not Configured</p>
                <p className="text-xs text-slate-500 font-mono mt-1">
                  Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file, then restart the dev server.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="mt-16 text-xs text-slate-700 font-mono">
          Round 3 — Auction Quiz Format
        </p>
      </div>
    </div>
  );
}
