import { useEffect, useState } from 'react';
import {
  getTeams, createTeam, updateTeam, deleteTeam,
  getEventSettings, updateEventSettings, logEvent
} from '../../lib/queries';
import { supabase, isConfigured } from '../../lib/supabase';
import { useTeamRealtime, useOnlineTeams } from '../../hooks/useRealtime';
import { Modal, ConfirmModal, LoadingSpinner } from '../../components/ui';
import { formatCoins } from '../../lib/utils';
import type { Team, EventSettings } from '../../types';
import {
  Plus, Trash2, Edit3, Save, AlertTriangle, Loader2,
  Key, Copy, Check, Eye, EyeOff
} from 'lucide-react';
import toast from 'react-hot-toast';

// Teams are added manually by the admin

interface Credential {
  team_id: string;
  short_name: string;
  email: string;
  password: string;
  user_id: string;
}

export default function AdminTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [settings, setSettings] = useState<EventSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Team | null>(null);
  const [budget, setBudget] = useState(1000);
  const [newTeam, setNewTeam] = useState({ name: '', short_name: '' });
  const [saving, setSaving] = useState(false);

  // Credential generation state
  const [showCredentials, setShowCredentials] = useState(false);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [generatingCredentials, setGeneratingCredentials] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const loadData = async () => {
    try {
      const [t, s] = await Promise.all([getTeams(), getEventSettings()]);
      setTeams(t);
      setSettings(s);
      if (s) setBudget(s.starting_budget);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  useTeamRealtime(() => { loadData(); });
  const onlineTeams = useOnlineTeams();

  const handleSaveBudget = async () => {
    if (!settings) return;
    try {
      await updateEventSettings(settings.id, { starting_budget: budget });
      for (const team of teams) {
        await updateTeam(team.id, {
          starting_budget: budget,
          current_budget: budget,
        });
      }
      await logEvent('budget_updated', 'event_settings', settings.id, { budget });
      await loadData();
      toast.success('Budget updated for all teams');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update budget');
    }
  };

  const handleAddTeam = async () => {
    if (!newTeam.name || !newTeam.short_name) return;
    setSaving(true);
    try {
      await createTeam({
        name: newTeam.name,
        short_name: newTeam.short_name.toUpperCase(),
        starting_budget: budget,
        logo_url: null,
        is_active: true,
      });
      await logEvent('team_created', 'team', undefined, { name: newTeam.name });
      setNewTeam({ name: '', short_name: '' });
      setShowAddModal(false);
      await loadData();
      toast.success('Team added');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add team');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTeam = async () => {
    if (!editTeam) return;
    setSaving(true);
    try {
      await updateTeam(editTeam.id, {
        name: editTeam.name,
        short_name: editTeam.short_name.toUpperCase(),
      });
      await logEvent('team_updated', 'team', editTeam.id, { name: editTeam.name });
      setEditTeam(null);
      await loadData();
      toast.success('Team updated');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update team');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    try {
      await deleteTeam(team.id);
      await logEvent('team_deleted', 'team', team.id, { name: team.name });
      setDeleteConfirm(null);
      await loadData();
      toast.success('Team deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete team');
    }
  };



  // ─── Credential Generation ──────────────────────────────────────────────────

  const generateCredentials = async () => {
    if (teams.length === 0) {
      toast.error('Create teams first before generating credentials');
      return;
    }
    if (!isConfigured) {
      toast.error('Supabase not configured');
      return;
    }

    setGeneratingCredentials(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      if (!token) {
        toast.error('Not authenticated. Please log in again.');
        return;
      }

      const response = await fetch(
        `${supabaseUrl}/functions/v1/create-team-credentials`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            teams: teams.map(t => ({
              team_id: t.id,
              short_name: t.short_name,
            })),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate credentials');
      }

      if (data.credentials) {
        setCredentials(data.credentials);
        setShowCredentials(true);
        await logEvent('credentials_generated', 'team', undefined, {
          count: data.credentials.length,
        });
        toast.success(`Generated ${data.credentials.length} team login credentials`);
      }

      if (data.errors && data.errors.length > 0) {
        for (const err of data.errors) {
          toast.error(`${err.short_name}: ${err.error}`);
        }
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to generate credentials');
    } finally {
      setGeneratingCredentials(false);
    }
  };

  const copyAllCredentials = () => {
    const text = credentials
      .map(c => `${c.short_name}\t${c.email}\t${c.password}`)
      .join('\n');
    const header = 'Team\tEmail\tPassword\n';
    navigator.clipboard.writeText(header + text);
    setCopiedIndex(-1);
    setTimeout(() => setCopiedIndex(null), 2000);
    toast.success('All credentials copied to clipboard');
  };

  const copySingleCredential = (index: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const togglePassword = (email: string) => {
    setShowPasswords(prev => ({ ...prev, [email]: !prev[email] }));
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner text="Loading teams..." />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Teams</h1>
          <p className="text-sm text-slate-500 font-mono mt-1">
            {teams.length} teams configured
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={14} />
            Add Team
          </button>
        </div>
      </div>

      {/* Starting Budget */}
      <div className="card">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Starting Budget</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={budget}
              onChange={e => setBudget(Number(e.target.value))}
              className="input-field w-32 font-mono"
              min={1}
            />
            <span className="text-slate-500 font-mono text-sm">Tech Coins</span>
          </div>
          <button onClick={handleSaveBudget} className="btn-primary text-sm flex items-center gap-2" disabled={saving}>
            <Save size={14} />
            Apply to All Teams
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-2 font-mono">
          This sets the starting budget for all teams. Existing team budgets will be reset.
        </p>
      </div>

      {/* Generate Credentials */}
      <div className="card border-violet-500/20">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Key size={18} className="text-violet-400" />
              Team Login Credentials
            </h2>
            <p className="text-sm text-slate-500 font-mono">
              Generate Supabase Auth accounts for each team so they can log in
            </p>
          </div>
          <button
            onClick={generateCredentials}
            disabled={generatingCredentials || teams.length === 0}
            className="btn-primary flex items-center gap-2 text-sm bg-violet-600 hover:bg-violet-500 disabled:bg-violet-600/40"
          >
            {generatingCredentials ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Key size={14} />
                Generate Team Credentials
              </>
            )}
          </button>
        </div>

        {!isConfigured && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
            Supabase not configured. Deploy the Edge Function first, then set your .env.
          </div>
        )}
      </div>

      {/* Credentials Table */}
      {showCredentials && credentials.length > 0 && (
        <div className="card animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-900">Generated Credentials</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCredentials(false)}
                className="btn-secondary text-xs flex items-center gap-1"
              >
                Hide
              </button>
              <button
                onClick={copyAllCredentials}
                className="btn-secondary text-xs flex items-center gap-1"
              >
                {copiedIndex === -1 ? <Check size={12} /> : <Copy size={12} />}
                Copy All
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-400">
                  <th className="text-left py-2 px-3 text-xs font-mono text-slate-500 tracking-wider">TEAM</th>
                  <th className="text-left py-2 px-3 text-xs font-mono text-slate-500 tracking-wider">EMAIL</th>
                  <th className="text-left py-2 px-3 text-xs font-mono text-slate-500 tracking-wider">PASSWORD</th>
                  <th className="text-right py-2 px-3 text-xs font-mono text-slate-500 tracking-wider">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((cred, idx) => (
                  <tr key={cred.team_id} className="border-b border-dark-500/50 hover:bg-slate-100/50 transition-colors">
                    <td className="py-3 px-3">
                      <span className="font-bold text-slate-900">{cred.short_name}</span>
                    </td>
                    <td className="py-3 px-3">
                      <code className="text-cyan-400 font-mono text-xs bg-dark-700 px-2 py-1 rounded">
                        {cred.email}
                      </code>
                    </td>
                    <td className="py-3 px-3">
                      <code className="text-violet-400 font-mono text-xs bg-dark-700 px-2 py-1 rounded">
                        {showPasswords[cred.email] ? cred.password : '••••••••'}
                      </code>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => togglePassword(cred.email)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 transition-colors"
                          title={showPasswords[cred.email] ? 'Hide' : 'Show'}
                        >
                          {showPasswords[cred.email] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          onClick={() => copySingleCredential(idx, `${cred.email}\t${cred.password}`)}
                          className="p-1.5 text-slate-500 hover:text-cyan-400 transition-colors"
                          title="Copy credentials"
                        >
                          {copiedIndex === idx ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-dark-700/50 border border-dark-400">
            <p className="text-xs text-slate-500 font-mono">
              💡 Share these credentials with each team. Teams log in at <span className="text-violet-400">/team/login</span> using their email and password.
            </p>
          </div>
        </div>
      )}

      {/* Teams List */}
      <div className="space-y-3">
        {teams.map((team, idx) => (
          <div
            key={team.id}
            className="card flex items-center justify-between gap-4 animate-slide-up"
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <span className="text-cyan-400 font-bold font-mono text-sm">{team.short_name}</span>
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                  onlineTeams.has(team.id) ? 'bg-green-400' : 'bg-slate-300'
                }`} title={onlineTeams.has(team.id) ? 'Online' : 'Offline'} />
              </div>
              <div>
                <p className="text-slate-900 font-bold">{team.name}</p>
                <div className="flex items-center gap-4 mt-1">
                  <span className="text-xs font-mono text-cyan-400">
                    {formatCoins(team.current_budget)} TC
                  </span>
                  <span className="text-xs font-mono text-slate-500">
                    Score: {team.score}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditTeam(team)}
                className="p-2 text-slate-500 hover:text-cyan-400 transition-colors"
                title="Edit"
              >
                <Edit3 size={16} />
              </button>
              <button
                onClick={() => setDeleteConfirm(team)}
                className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        {teams.length === 0 && (
          <div className="card text-center py-12">
            <AlertTriangle className="mx-auto text-slate-600 mb-3" size={32} />
            <p className="text-slate-500 mb-4">No teams yet. Add teams manually, then generate credentials.</p>
            <button onClick={() => setShowAddModal(true)} className="btn-primary text-sm">
              Add First Team
            </button>
          </div>
        )}
      </div>

      {/* Add Team Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add Team" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">TEAM NAME</label>
            <input
              type="text"
              value={newTeam.name}
              onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))}
              className="input-field"
              placeholder="Team Alpha"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">SHORT NAME</label>
            <input
              type="text"
              value={newTeam.short_name}
              onChange={e => setNewTeam(p => ({ ...p, short_name: e.target.value.toUpperCase() }))}
              className="input-field"
              placeholder="ALPHA"
              maxLength={10}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
            <button
              onClick={handleAddTeam}
              className="btn-primary flex items-center gap-2"
              disabled={!newTeam.name || !newTeam.short_name || saving}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Add Team
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Team Modal */}
      <Modal isOpen={!!editTeam} onClose={() => setEditTeam(null)} title="Edit Team" size="sm">
        {editTeam && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-2">TEAM NAME</label>
              <input
                type="text"
                value={editTeam.name}
                onChange={e => setEditTeam(p => p ? { ...p, name: e.target.value } : null)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-2">SHORT NAME</label>
              <input
                type="text"
                value={editTeam.short_name}
                onChange={e => setEditTeam(p => p ? { ...p, short_name: e.target.value.toUpperCase() } : null)}
                className="input-field"
                maxLength={10}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setEditTeam(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={handleUpdateTeam}
                className="btn-primary flex items-center gap-2"
                disabled={saving}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDeleteTeam(deleteConfirm)}
        title="Delete Team"
        message={`Are you sure you want to delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
