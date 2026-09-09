import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Zap, ArrowLeft, Loader2, Shield, Users } from 'lucide-react';
import { cn } from '../lib/utils';

type LoginMode = 'select' | 'admin' | 'team';

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>('select');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, profile } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in
  if (profile) {
    if (profile.role === 'admin') navigate('/admin', { replace: true });
    else navigate('/team', { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn(email, password);
      // Navigation will happen via the profile check above on re-render
    } catch (err: any) {
      setError(err.message || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 grid-bg flex items-center justify-center p-4">
      {/* Background gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Back to landing */}
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-cyan-400 transition-colors mb-8"
        >
          <ArrowLeft size={16} />
          Back to Home
        </a>

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 mb-4">
            <Zap className="text-cyan-400" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-wider">TECH AUCTION</h1>
          <p className="text-sm text-slate-500 font-mono mt-1">COMPETITION LOGIN</p>
        </div>

        {/* Login Form */}
        <div className="glass-strong rounded-2xl p-8">
          {mode === 'select' ? (
            <div className="space-y-4">
              <p className="text-center text-slate-400 text-sm mb-6">Select your role to continue</p>

              <button
                onClick={() => setMode('admin')}
                className="w-full flex items-center gap-4 p-5 rounded-xl bg-dark-600 border border-dark-400 hover:border-cyan-500/30 hover:bg-dark-500 transition-all duration-200 group"
              >
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                  <Shield className="text-cyan-400" size={24} />
                </div>
                <div className="text-left">
                  <p className="text-white font-bold">ADMIN CONTROL ROOM</p>
                  <p className="text-xs text-slate-500 font-mono">Quizmaster access</p>
                </div>
              </button>

              <button
                onClick={() => setMode('team')}
                className="w-full flex items-center gap-4 p-5 rounded-xl bg-dark-600 border border-dark-400 hover:border-violet-500/30 hover:bg-dark-500 transition-all duration-200 group"
              >
                <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center group-hover:bg-violet-500/20 transition-colors">
                  <Users className="text-violet-400" size={24} />
                </div>
                <div className="text-left">
                  <p className="text-white font-bold">TEAM LOGIN</p>
                  <p className="text-xs text-slate-500 font-mono">Competitor access</p>
                </div>
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <button
                type="button"
                onClick={() => { setMode('select'); setError(''); setEmail(''); setPassword(''); }}
                className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-cyan-400 transition-colors"
              >
                <ArrowLeft size={14} />
                {mode === 'admin' ? 'Admin Login' : 'Team Login'}
              </button>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-2 tracking-wider">
                  EMAIL
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input-field"
                  placeholder="your@email.com"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-2 tracking-wider">
                  PASSWORD
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input-field"
                  placeholder="••••••••"
                  required
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-mono animate-slide-down">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email || !password}
                className={cn(
                  'w-full py-3.5 rounded-xl font-bold text-sm tracking-wider transition-all duration-200',
                  mode === 'admin'
                    ? 'bg-cyan-500 text-dark-900 hover:bg-cyan-400 disabled:bg-cyan-500/40'
                    : 'bg-violet-500 text-white hover:bg-violet-400 disabled:bg-violet-500/40',
                  'disabled:cursor-not-allowed flex items-center justify-center gap-2'
                )}
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    {mode === 'admin' ? <Shield size={18} /> : <Users size={18} />}
                    SIGN IN
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Footer hint */}
        <p className="text-center text-xs text-slate-600 mt-6 font-mono">
          National Level Quiz Competition
        </p>
      </div>
    </div>
  );
}
