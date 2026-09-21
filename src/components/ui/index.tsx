import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { AnimatedNumber } from './AnimatedNumber';
import { X, Loader2, Wifi, WifiOff, AlertTriangle } from 'lucide-react';

export { Logo } from './Logo';

// ─── Connection Status ───────────────────────────────────────────────────────

type ConnectionStatusType = 'live' | 'reconnecting' | 'offline';

export function ConnectionStatus({ status }: { status: ConnectionStatusType }) {
  const config = {
    live: { color: 'bg-green-400', text: 'LIVE', textColor: 'text-green-400', icon: Wifi },
    reconnecting: { color: 'bg-amber-400', text: 'RECONNECTING', textColor: 'text-amber-400', icon: AlertTriangle },
    offline: { color: 'bg-red-400', text: 'OFFLINE', textColor: 'text-red-400', icon: WifiOff },
  };

  const c = config[status];
  const Icon = c.icon;

  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs font-mono tracking-wider', c.textColor)}>
      <span className={cn('w-2 h-2 rounded-full animate-pulse-glow', c.color)} />
      <Icon size={12} />
      <span>{c.text}</span>
    </div>
  );
}

// ─── Loading Spinner ─────────────────────────────────────────────────────────

export function LoadingSpinner({ size = 'md', text }: { size?: 'sm' | 'md' | 'lg'; text?: string }) {
  const sizeClass = {
    sm: 'w-5 h-5',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <Loader2 className={cn('animate-spin text-cyan-400', sizeClass[size])} />
      {text && <p className="text-sm text-slate-400 font-mono">{text}</p>}
    </div>
  );
}

export function FullPageLoader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="fixed inset-0 bg-dark-900 grid-bg flex items-center justify-center z-50">
      <div className="text-center animate-fade-in">
        <LoadingSpinner size="lg" text={text} />
      </div>
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  if (!isOpen) return null;

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className={cn('glass-strong rounded-2xl w-full animate-scale-in', sizeClass[size])}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-dark-400">
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 transition-colors p-1">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Confirm Modal ───────────────────────────────────────────────────────────

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  variant?: 'danger' | 'primary' | 'success';
  loading?: boolean;
}

export function ConfirmModal({
  isOpen, onClose, onConfirm, title, message,
  confirmText = 'Confirm', variant = 'primary', loading = false,
}: ConfirmModalProps) {
  const btnClass = {
    danger: 'btn-danger',
    primary: 'btn-primary',
    success: 'btn-success',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-slate-600 mb-6">{message}</p>
      <div className="flex gap-3 justify-end">
        <button onClick={onClose} className="btn-secondary" disabled={loading}>Cancel</button>
        <button onClick={onConfirm} className={btnClass[variant]} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────

export function Badge({
  children,
  variant = 'default',
  className,
}: {
  children: ReactNode;
  variant?: 'default' | 'cyan' | 'violet' | 'green' | 'red' | 'amber';
  className?: string;
}) {
  const variants = {
    default: 'bg-slate-100 text-slate-600 border-slate-300',
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
    green: 'bg-green-500/10 text-green-400 border-green-500/30',
    red: 'bg-red-500/10 text-red-400 border-red-500/30',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  };

  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border',
      variants[variant],
      className
    )}>
      {children}
    </span>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  color = 'cyan',
  icon,
  prefix,
  suffix,
}: {
  label: string;
  value: string | number;
  color?: 'cyan' | 'violet' | 'green' | 'red' | 'amber';
  icon?: ReactNode;
  prefix?: string;
  suffix?: string;
}) {
  const colorMap = {
    cyan: 'text-cyan-400 text-glow-cyan',
    violet: 'text-violet-400 text-glow-violet',
    green: 'text-green-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
  };

  return (
    <div className="card text-center">
      <div className="flex items-center justify-center gap-2 mb-1">
        {icon && <span className="text-slate-500">{icon}</span>}
        <p className="stat-label">{label}</p>
      </div>
      <p className={cn('stat-value', colorMap[color])}>
        {typeof value === 'number' ? (
          <AnimatedNumber value={value} prefix={prefix} suffix={suffix} />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

// ─── Toast helper (simple) ──────────────────────────────────────────────────

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  // Using native notification as fallback; react-hot-toast in App.tsx
  const event = new CustomEvent('app-toast', { detail: { message, type } });
  window.dispatchEvent(event);
}

// ─── Empty State ─────────────────────────────────────────────────────────────

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-12 px-6">
      <p className="text-xl font-bold text-slate-400 mb-2">{title}</p>
      {description && <p className="text-sm text-slate-500">{description}</p>}
    </div>
  );
}
