import { useEffect, useState } from 'react';
import {
  getAuctionItems, createAuctionItem, updateAuctionItem,
  deleteAuctionItem, logEvent
} from '../../lib/queries';
import { Modal, ConfirmModal, Badge, LoadingSpinner } from '../../components/ui';
import { getDifficultyColor } from '../../lib/utils';
import type { AuctionItem, Difficulty } from '../../types';
import { DIFFICULTY_PRESETS } from '../../types';
import {
  Plus, Trash2, Edit3, Copy, Gavel,
  Loader2, Eye, EyeOff
} from 'lucide-react';

// ─── Auction Item Form (module scope — must NOT be defined inside the page
// component, or every keystroke re-creates it, remounts the form and drops
// input focus after each letter) ────────────────────────────────────────────

interface ItemFormProps {
  form: {
    name: string; category: string; description: string; difficulty: Difficulty;
    starting_bid: number; minimum_increment: number; reward_points: number; penalty_points: number;
    question: string; correct_answer: string; hint: string; special_rule: string;
  };
  onFieldChange: <K extends keyof ItemFormProps['form']>(field: K, value: ItemFormProps['form'][K]) => void;
  onPreset: (diff: Difficulty) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  isEdit: boolean;
}

function ItemForm({ form, onFieldChange, onPreset, onSubmit, onCancel, saving, isEdit }: ItemFormProps) {
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(); }} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-mono text-slate-400 mb-1">ITEM NAME *</label>
          <input type="text" value={form.name} onChange={e => onFieldChange('name', e.target.value)}
            className="input-field" required placeholder="SMART GRID" />
        </div>
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">CATEGORY</label>
          <input type="text" value={form.category} onChange={e => onFieldChange('category', e.target.value)}
            className="input-field" placeholder="Electrical Engineering" />
        </div>
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">DIFFICULTY</label>
          <div className="flex gap-2">
            {(['basic', 'intermediate', 'expert'] as Difficulty[]).map(d => (
              <button key={d} type="button" onClick={() => onPreset(d)}
                className={`flex-1 py-2 rounded-lg text-xs font-mono border transition-all ${
                  form.difficulty === d
                    ? getDifficultyColor(d) + ' border-current'
                    : 'bg-dark-700 text-slate-500 border-dark-400 hover:border-slate-500'
                }`}>
                {d.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-mono text-slate-400 mb-1">DESCRIPTION</label>
          <textarea value={form.description} onChange={e => onFieldChange('description', e.target.value)}
            className="input-field h-20 resize-none" placeholder="Brief description..." />
        </div>
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">STARTING BID</label>
          <input type="number" value={form.starting_bid} onChange={e => onFieldChange('starting_bid', Number(e.target.value))}
            className="input-field font-mono" min={1} />
        </div>
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">MIN INCREMENT</label>
          <input type="number" value={form.minimum_increment} onChange={e => onFieldChange('minimum_increment', Number(e.target.value))}
            className="input-field font-mono" min={1} />
        </div>
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">REWARD POINTS</label>
          <input type="number" value={form.reward_points} onChange={e => onFieldChange('reward_points', Number(e.target.value))}
            className="input-field font-mono text-green-400" min={0} />
        </div>
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">PENALTY POINTS</label>
          <input type="number" value={form.penalty_points} onChange={e => onFieldChange('penalty_points', Number(e.target.value))}
            className="input-field font-mono text-red-400" min={0} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-mono text-slate-400 mb-1">QUESTION *</label>
          <textarea value={form.question} onChange={e => onFieldChange('question', e.target.value)}
            className="input-field h-24 resize-none" required placeholder="Technical question..." />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-mono text-slate-400 mb-1">CORRECT ANSWER *</label>
          <textarea value={form.correct_answer} onChange={e => onFieldChange('correct_answer', e.target.value)}
            className="input-field h-16 resize-none" required placeholder="Correct answer..." />
        </div>
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">HINT (optional)</label>
          <input type="text" value={form.hint} onChange={e => onFieldChange('hint', e.target.value)}
            className="input-field" placeholder="Optional hint..." />
        </div>
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">SPECIAL RULE</label>
          <input type="text" value={form.special_rule} onChange={e => onFieldChange('special_rule', e.target.value)}
            className="input-field" placeholder="e.g., JACKPOT" />
        </div>
      </div>
      <div className="flex gap-3 justify-end pt-2 border-t border-dark-400">
        <button type="button" onClick={onCancel}
          className="btn-secondary">Cancel</button>
        <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Save Changes' : 'Add Item'}
        </button>
      </div>
    </form>
  );
}

export default function AdminAuctions() {
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editItem, setEditItem] = useState<AuctionItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AuctionItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', category: '', description: '', difficulty: 'intermediate' as Difficulty,
    starting_bid: 100, minimum_increment: 25, reward_points: 150, penalty_points: 75,
    question: '', correct_answer: '', hint: '', special_rule: '',
  });

  const loadItems = async () => {
    try {
      const data = await getAuctionItems();
      setItems(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadItems(); }, []);

  const resetForm = () => {
    setForm({
      name: '', category: '', description: '', difficulty: 'intermediate',
      starting_bid: 100, minimum_increment: 25, reward_points: 150, penalty_points: 75,
      question: '', correct_answer: '', hint: '', special_rule: '',
    });
  };

  const applyPreset = (diff: Difficulty) => {
    const preset = DIFFICULTY_PRESETS[diff];
    setForm(p => ({
      ...p,
      difficulty: diff,
      starting_bid: preset.starting_bid,
      minimum_increment: preset.minimum_increment,
      reward_points: preset.reward_points,
      penalty_points: preset.penalty_points,
    }));
  };

  const handleAdd = async () => {
    setSaving(true);
    try {
      await createAuctionItem({
        ...form,
        image_url: null,
        sort_order: items.length + 1,
        is_active: true,
      });
      await logEvent('item_created', 'auction_item', undefined, { name: form.name });
      setShowAddModal(false);
      resetForm();
      await loadItems();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await updateAuctionItem(editItem.id, form);
      await logEvent('item_updated', 'auction_item', editItem.id, { name: form.name });
      setEditItem(null);
      resetForm();
      await loadItems();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (item: AuctionItem) => {
    try {
      const { id, created_at, ...rest } = item;
      await createAuctionItem({
        ...rest,
        name: `${item.name} (Copy)`,
        image_url: null,
        sort_order: items.length + 1,
      });
      await loadItems();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleActive = async (item: AuctionItem) => {
    try {
      await updateAuctionItem(item.id, { is_active: !item.is_active });
      await loadItems();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (item: AuctionItem) => {
    try {
      await deleteAuctionItem(item.id);
      await logEvent('item_deleted', 'auction_item', item.id, { name: item.name });
      setDeleteConfirm(null);
      await loadItems();
    } catch (err) {
      console.error(err);
    }
  };

  const openEditModal = (item: AuctionItem) => {
    setForm({
      name: item.name, category: item.category, description: item.description,
      difficulty: item.difficulty, starting_bid: item.starting_bid,
      minimum_increment: item.minimum_increment, reward_points: item.reward_points,
      penalty_points: item.penalty_points, question: item.question,
      correct_answer: item.correct_answer, hint: item.hint || '',
      special_rule: item.special_rule || '',
    });
    setEditItem(item);
  };

  const handleFieldChange = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm(p => ({ ...p, [field]: value }));
  };

  const handleCancel = () => {
    setShowAddModal(false);
    setEditItem(null);
    resetForm();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner text="Loading auction items..." />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Auction Items</h1>
          <p className="text-sm text-slate-500 font-mono mt-1">{items.length} items configured</p>
        </div>
        <button onClick={() => { resetForm(); setShowAddModal(true); }}
          className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={14} /> Add Item
        </button>
      </div>

      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={item.id} className={`card animate-slide-up ${!item.is_active ? 'opacity-50' : ''}`}
            style={{ animationDelay: `${idx * 30}ms` }}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-slate-900 font-bold">{item.name}</h3>
                  <Badge className={getDifficultyColor(item.difficulty)}>
                    {item.difficulty.toUpperCase()}
                  </Badge>
                  {!item.is_active && <Badge>INACTIVE</Badge>}
                  {item.special_rule && <Badge variant="amber">{item.special_rule}</Badge>}
                </div>
                <p className="text-sm text-slate-400 mb-2">{item.category}</p>
                <div className="flex flex-wrap gap-4 text-xs font-mono">
                  <span className="text-cyan-400">Starting: {item.starting_bid} TC</span>
                  <span className="text-slate-500">Increment: {item.minimum_increment} TC</span>
                  <span className="text-green-400">Reward: +{item.reward_points}</span>
                  <span className="text-red-400">Penalty: -{item.penalty_points}</span>
                </div>
                {item.question && (
                  <p className="text-xs text-slate-600 mt-2 line-clamp-1">
                    Q: {item.question}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleToggleActive(item)}
                  className="p-2 text-slate-500 hover:text-amber-400 transition-colors"
                  title={item.is_active ? 'Deactivate' : 'Activate'}>
                  {item.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button onClick={() => handleDuplicate(item)}
                  className="p-2 text-slate-500 hover:text-cyan-400 transition-colors"
                  title="Duplicate">
                  <Copy size={16} />
                </button>
                <button onClick={() => openEditModal(item)}
                  className="p-2 text-slate-500 hover:text-cyan-400 transition-colors"
                  title="Edit">
                  <Edit3 size={16} />
                </button>
                <button onClick={() => setDeleteConfirm(item)}
                  className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                  title="Delete">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div className="card text-center py-12">
            <Gavel className="mx-auto text-slate-600 mb-3" size={32} />
            <p className="text-slate-500 mb-4">No auction items configured.</p>
            <button onClick={() => { resetForm(); setShowAddModal(true); }} className="btn-primary text-sm">
              Add First Item
            </button>
          </div>
        )}
      </div>

      {/* Add Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add Auction Item" size="lg">
        <ItemForm
          form={form}
          onFieldChange={handleFieldChange}
          onPreset={applyPreset}
          onSubmit={handleAdd}
          onCancel={handleCancel}
          saving={saving}
          isEdit={false}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={!!editItem} onClose={() => { setEditItem(null); resetForm(); }} title="Edit Auction Item" size="lg">
        <ItemForm
          form={form}
          onFieldChange={handleFieldChange}
          onPreset={applyPreset}
          onSubmit={handleEdit}
          onCancel={handleCancel}
          saving={saving}
          isEdit={true}
        />
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        title="Delete Auction Item"
        message={`Are you sure you want to delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
