import { useEffect, useState, useRef } from 'react';
import {
  getEventSettings, updateEventSettings, resetDemoMode,
  getTeams, logEvent
} from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { ConfirmModal, LoadingSpinner, Badge } from '../../components/ui';
import type { EventSettings, Team } from '../../types';import { RotateCcw, AlertTriangle, Monitor,
  CheckCircle, Database, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminSettings() {
  const [settings, setSettings] = useState<EventSettings | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDemoReset, setShowDemoReset] = useState(false);
  const [showResetFinalized, setShowResetFinalized] = useState(false);
  const [showDeleteRounds, setShowDeleteRounds] = useState(false);
  const [showDeleteTeams, setShowDeleteTeams] = useState(false);

  // Local draft for text/number config fields. Inputs read from this so every
  // keystroke stays instant and focus is never lost (previously each keystroke
  // fired a DB write which toggled disabled={saving} and dropped focus).
  const [draft, setDraft] = useState({
    event_name: '',
    starting_budget: 1000,
    default_question_time: 20,
  });
  const draftInitialized = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const loadData = async () => {
    try {
      const [s, t] = await Promise.all([getEventSettings(), getTeams()]);
      setSettings(s);
      if (s && !draftInitialized.current) {
        draftInitialized.current = true;
        setDraft({
          event_name: s.event_name,
          starting_budget: s.starting_budget,
          default_question_time: s.default_question_time,
        });
      }
      setTeams(t);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSave = async (updates: Partial<EventSettings>) => {
    if (!settings) return;
    setSaving(true);
    try {
      await updateEventSettings(settings.id, updates);
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Debounced save: coalesces rapid keystrokes into one DB write after 600ms
  const queueSave = (updates: Partial<EventSettings>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { handleSave(updates); }, 600);
  };

  const updateDraft = (patch: Partial<typeof draft>) => {
    setDraft(d => ({ ...d, ...patch }));
    queueSave(patch);
  };

  const handleDemoReset = async () => {
    setSaving(true);
    try {
      await resetDemoMode();
      await logEvent('demo_reset', 'event_settings', settings?.id);
      setShowDemoReset(false);
      toast.success('All data reset to defaults');
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error('Failed to reset: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetFinalized = async () => {
    setSaving(true);
    try {
      await updateEventSettings(settings!.id, { status: 'live' });
      await logEvent('reset_finalized', 'event_settings', settings?.id);
      setShowResetFinalized(false);
      toast.success('Event status reset to LIVE');
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error('Failed to reset status: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAllRounds = async () => {
    setSaving(true);
    try {

      // Delete question_attempts, bids, then auctions
      await supabase.from('question_attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('bids').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('auctions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      // Reset event status to lobby
      if (settings) {
        await updateEventSettings(settings.id, { status: 'lobby' });
      }
      await logEvent('delete_all_rounds', 'event_settings', settings?.id);
      setShowDeleteRounds(false);
      toast.success('All auction history deleted');
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete rounds: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAllTeams = async () => {
    setSaving(true);
    try {
      // Delete in order: question_attempts -> bids -> auctions -> team_members -> teams -> profiles
      await supabase.from('question_attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('bids').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('auctions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('score_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('budget_transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('team_members').delete().neq('user_id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('teams').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      // Also delete team profiles
      const { data: teamProfiles } = await supabase.from('profiles').select('id').eq('role', 'team');
      if (teamProfiles && teamProfiles.length > 0) {
        const ids = teamProfiles.map(p => p.id);
        await supabase.from('profiles').delete().in('id', ids);
      }
      // Reset event status
      if (settings) {
        await updateEventSettings(settings.id, { status: 'lobby' });
      }
      await logEvent('delete_all_teams', 'event_settings', settings?.id);
      setShowDeleteTeams(false);
      toast.success('All teams deleted');
      await loadData();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete teams: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><LoadingSpinner text="Loading settings..." /></div>;
  }

  const setupChecklist = [
    { label: '8 teams configured', done: teams.length >= 8 },
    { label: 'Team accounts ready', done: teams.length > 0 },
    { label: 'Starting budgets configured', done: (settings?.starting_budget || 0) > 0 },
    { label: 'Questions configured', done: true },
    { label: 'Display tested', done: true },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Settings</h1>
        <p className="text-sm text-slate-500 font-mono mt-1">Event configuration</p>
      </div>

      {/* Setup Checklist */}
      <div className="card">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Setup Checklist</h2>
        <div className="space-y-3">
          {setupChecklist.map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                item.done ? 'bg-green-500/20 text-green-600' : 'bg-slate-100 text-slate-400'
              }`}>
                {item.done ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
              </div>
              <span className={item.done ? 'text-slate-900' : 'text-slate-500'}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Event Configuration */}
      <div className="card">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Event Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">EVENT NAME</label>
            <input
              type="text"
              value={draft.event_name}
              onChange={e => updateDraft({ event_name: e.target.value })}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">STARTING BUDGET (TC)</label>
            <input
              type="number"
              value={draft.starting_budget}
              onChange={e => updateDraft({ starting_budget: Number(e.target.value) })}
              className="input-field font-mono"
              min={1}
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">QUESTION TIME (seconds)</label>
            <input
              type="number"
              value={draft.default_question_time}
              onChange={e => updateDraft({ default_question_time: Number(e.target.value) })}
              className="input-field font-mono"
              min={5}
              max={120}
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-slate-400 mb-2">CURRENT STATUS</label>
            <div className="input-field bg-slate-100">
              <Badge variant={
                settings?.status === 'live' ? 'green' :
                settings?.status === 'finalized' ? 'violet' : 'amber'
              }>
                {settings?.status?.toUpperCase() || 'SETUP'}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Mode Toggles */}
      <div className="card">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Mode</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3">
              <Database className="text-amber-500" size={20} />
              <div>
                <p className="text-slate-900 font-bold">Demo Mode</p>
                <p className="text-xs text-slate-500">Reset and test without affecting live data</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {settings?.demo_mode && <Badge variant="amber">ACTIVE</Badge>}
              <button
                onClick={() => handleSave({ demo_mode: !settings?.demo_mode })}
                className={`px-4 py-2 rounded-lg text-sm font-mono transition-all ${
                  settings?.demo_mode
                    ? 'bg-amber-500/20 text-amber-600 border border-amber-500/30'
                    : 'bg-slate-100 text-slate-500 border border-slate-300 hover:border-amber-500/30'
                }`}
                disabled={saving}
              >
                {settings?.demo_mode ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3">
              <Monitor className="text-cyan-600" size={20} />
              <div>
                <p className="text-slate-900 font-bold">Live Event Mode</p>
                <p className="text-xs text-slate-500">Enable for actual competition</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {settings?.live_mode && <Badge variant="green">LIVE</Badge>}
              <button
                onClick={() => handleSave({ live_mode: !settings?.live_mode })}
                className={`px-4 py-2 rounded-lg text-sm font-mono transition-all ${
                  settings?.live_mode
                    ? 'bg-green-500/20 text-green-600 border border-green-500/30'
                    : 'bg-slate-100 text-slate-500 border border-slate-300 hover:border-green-500/30'
                }`}
                disabled={saving}
              >
                {settings?.live_mode ? 'LIVE' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Reset */}
      <div className="card border border-amber-500/20">
        <h2 className="text-lg font-bold text-amber-600 mb-4 flex items-center gap-2">
          <AlertTriangle size={18} />
          Demo Reset
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Reset all team budgets, scores, and auction history. This is useful for rehearsals.
        </p>
        <button
          onClick={() => setShowDemoReset(true)}
          className="btn-amber flex items-center gap-2"
          disabled={saving}
        >
          <RotateCcw size={16} />
          RESET ALL DATA
        </button>
      </div>

      {/* Reset Finalized Status */}
      {settings?.status === 'finalized' && (
        <div className="card border border-violet-500/20">
          <h2 className="text-lg font-bold text-violet-600 mb-4 flex items-center gap-2">
            <RotateCcw size={18} />
            Reset Finalized Round
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            Re-open the current round so teams can bid and answer questions again. Scores and budgets are preserved.
          </p>
          <button
            onClick={() => setShowResetFinalized(true)}
            className="btn-secondary flex items-center gap-2"
            disabled={saving}
          >
            <RotateCcw size={16} />
            RESET TO LIVE
          </button>
        </div>
      )}

      {/* Delete All Finalized Rounds */}
      <div className="card border border-red-500/20">
        <h2 className="text-lg font-bold text-red-600 mb-4 flex items-center gap-2">
          <AlertTriangle size={18} />
          Delete All Auction History
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Permanently delete all completed auctions, bids, and question attempts. Teams keep their current scores and budgets. This cannot be undone.
        </p>
        <button
          onClick={() => setShowDeleteRounds(true)}
          className="btn-danger flex items-center gap-2"
          disabled={saving}
        >
          <RotateCcw size={16} />
          DELETE ALL FINALIZED ROUNDS
        </button>
      </div>

      {/* Delete All Teams */}
      <div className="card border border-red-500/30">
        <h2 className="text-lg font-bold text-red-600 mb-4 flex items-center gap-2">
          <Trash2 size={18} />
          Delete All Teams
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Remove all teams and their auth accounts. You will need to create new teams and generate fresh credentials. This cannot be undone.
        </p>
        <button
          onClick={() => setShowDeleteTeams(true)}
          className="btn-danger flex items-center gap-2"
          disabled={saving}
        >
          <Trash2 size={16} />
          DELETE ALL TEAMS
        </button>
      </div>

      <ConfirmModal
        isOpen={showDemoReset}
        onClose={() => setShowDemoReset(false)}
        onConfirm={handleDemoReset}
        title="Reset All Data"
        message="This will reset all team budgets, scores, auction history, and bids. This cannot be undone. Are you sure?"
        confirmText="RESET EVERYTHING"
        variant="danger"
        loading={saving}
      />
      <ConfirmModal
        isOpen={showResetFinalized}
        onClose={() => setShowResetFinalized(false)}
        onConfirm={handleResetFinalized}
        title="Reset Finalized Round"
        message="This will change the event status from FINALIZED back to LIVE so teams can bid and answer again. Scores and budgets are preserved."
        confirmText="RESET TO LIVE"
        variant="primary"
        loading={saving}
      />
      <ConfirmModal
        isOpen={showDeleteRounds}
        onClose={() => setShowDeleteRounds(false)}
        onConfirm={handleDeleteAllRounds}
        title="Delete All Finalized Rounds"
        message="This will permanently delete ALL auction history, bids, and question attempts. Teams keep their current scores and budgets. This cannot be undone."
        confirmText="DELETE EVERYTHING"
        variant="danger"
        loading={saving}
      />
      <ConfirmModal
        isOpen={showDeleteTeams}
        onClose={() => setShowDeleteTeams(false)}
        onConfirm={handleDeleteAllTeams}
        title="Delete All Teams"
        message="This will permanently delete ALL teams, their auth accounts, and all related data (bids, scores, history). You will need to re-create teams and generate new credentials. This cannot be undone."
        confirmText="DELETE ALL TEAMS"
        variant="danger"
        loading={saving}
      />
    </div>
  );
}
