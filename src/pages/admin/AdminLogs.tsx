import { useEffect, useState } from 'react';
import { getEventLogs } from '../../lib/queries';
import { LoadingSpinner, Badge } from '../../components/ui';
import type { EventLog } from '../../types';
import { FileText, Filter } from 'lucide-react';

export default function AdminLogs() {
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    getEventLogs()
      .then(setLogs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filteredLogs = filter
    ? logs.filter(l => l.action.includes(filter) || l.entity_type.includes(filter))
    : logs;

  const formatAction = (action: string) => {
    return action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getActionColor = (action: string) => {
    if (action.includes('correct') || action.includes('bonus')) return 'green';
    if (action.includes('wrong') || action.includes('delete') || action.includes('penalty')) return 'red';
    if (action.includes('started') || action.includes('created') || action.includes('live')) return 'cyan';
    if (action.includes('closed') || action.includes('completed') || action.includes('finalized')) return 'violet';
    return 'default';
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><LoadingSpinner text="Loading logs..." /></div>;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Audit Log</h1>
          <p className="text-sm text-slate-500 font-mono mt-1">{logs.length} events recorded</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Filter size={14} className="text-slate-500" />
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="input-field max-w-xs text-sm"
          placeholder="Filter actions..."
        />
      </div>

      {/* Log entries */}
      <div className="space-y-2">
        {filteredLogs.map(log => (
          <div key={log.id} className="card flex items-start gap-4 py-3 px-4 animate-slide-up">
            <FileText size={14} className="text-slate-600 mt-1 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <Badge variant={getActionColor(log.action) as any}>
                  {formatAction(log.action)}
                </Badge>
                <span className="text-xs font-mono text-slate-600">
                  {log.entity_type}
                </span>
              </div>
              {log.metadata && (
                <p className="text-xs text-slate-500 font-mono truncate">
                  {JSON.stringify(log.metadata)}
                </p>
              )}
            </div>
            <span className="text-xs text-slate-600 font-mono shrink-0">
              {new Date(log.created_at).toLocaleTimeString()}
            </span>
          </div>
        ))}

        {filteredLogs.length === 0 && (
          <div className="card text-center py-12">
            <FileText className="mx-auto text-slate-600 mb-3" size={32} />
            <p className="text-slate-500">No audit log entries found.</p>
          </div>
        )}
      </div>
    </div>
  );
}
