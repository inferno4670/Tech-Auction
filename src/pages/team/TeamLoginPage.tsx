import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { isConfigured } from '../../lib/supabase';

export default function TeamLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, profile } = useAuth();
  const navigate = useNavigate();

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
    } catch (err: any) {
      setError(err.message || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 grid-bg flex items-center justify-center p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        <a href="/" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-violet-400 transition-colors mb-8">
          <ArrowLeft size={16} />
          Back to Home
        </a>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 mb-4">
            <Users className="text-violet-400" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-wider">TECH AUCTION</h1>
          <p className="text-sm text-violet-400 font-mono mt-1 tracking-wider">TEAM LOGIN</p>
        </div>

        <div className="glass-strong rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-2 tracking-wider">EMAIL</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input-field"
                placeholder="team@techquiz.com"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-2 tracking-wider">PASSWORD</label>
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

            {!isConfigured && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
                Supabase not configured. Check your .env file.
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full py-3.5 rounded-xl bg-violet-500 text-slate-900 font-bold text-sm tracking-wider hover:bg-violet-400 disabled:bg-violet-500/40 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <Users size={18} />
                  SIGN IN
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6 font-mono">Competitor access only</p>
      </div>
    </div>
  );
}
