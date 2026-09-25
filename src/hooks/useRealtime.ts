import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type TableName =
  | 'auctions' | 'teams' | 'bids' | 'event_settings' | 'event_logs' | 'round_results'
  | 'tiebreak_sessions' | 'tiebreak_answers' | 'tiebreak_questions';

interface RealtimeOptions {
  table: TableName;
  filter?: string;
  onChange?: (payload: any) => void;
  enabled?: boolean;
}

export function useRealtimeTable({ table, filter, onChange, enabled = true }: RealtimeOptions) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;

    let channel = supabase.channel(`realtime:${table}`);

    const config = {
      event: '*',
      schema: 'public',
      table,
      ...(filter ? { filter } : {}),
    };

    channel = channel.on('postgres_changes' as any, config, (payload: any) => {
      onChangeRef.current?.(payload);
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, enabled]);
}

// Convenience hooks for specific tables

export function useAuctionRealtime(onChange: (payload: any) => void, enabled = true) {
  useRealtimeTable({ table: 'auctions', onChange, enabled });
}

export function useTeamRealtime(onChange: (payload: any) => void, filter?: string, enabled = true) {
  useRealtimeTable({ table: 'teams', filter, onChange, enabled });
}

export function useBidRealtime(auctionId: string | null, onChange: (payload: any) => void, enabled = true) {
  useRealtimeTable({
    table: 'bids',
    filter: auctionId ? `auction_id=eq.${auctionId}` : undefined,
    onChange,
    enabled: enabled && !!auctionId,
  });
}

export function useEventSettingsRealtime(onChange: (payload: any) => void, enabled = true) {
  useRealtimeTable({ table: 'event_settings', onChange, enabled });
}

// A tie-break lives in two places: the round itself (opened / won / closed) and
// the answers landing in it. One hook covers both so a caller only refetches the
// tie-break state once per event.
export function useTiebreakRealtime(onChange: (payload: any) => void, enabled = true) {
  useRealtimeTable({ table: 'tiebreak_sessions', onChange, enabled });
  useRealtimeTable({ table: 'tiebreak_answers', onChange, enabled });
}

// Broadcast-based channel for ephemeral state (e.g., timer)
export function useBroadcast(channelName: string) {
  const channelRef = useRef<any>(null);

  useEffect(() => {
    const channel = supabase.channel(channelName);
    channelRef.current = channel;
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName]);

  const broadcast = useCallback((event: string, payload: Record<string, unknown>) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event,
        payload,
      });
    }
  }, []);

  const onBroadcast = useCallback((event: string, callback: (payload: Record<string, unknown>) => void) => {
    if (channelRef.current) {
      channelRef.current.on('broadcast', { event }, ({ payload }: any) => {
        callback(payload);
      });
    }
  }, []);

  return { broadcast, onBroadcast };
}

// ─── Presence ────────────────────────────────────────────────────────────────

/** Track which team users are online via Supabase Presence */
export function useTeamPresence(teamShortName: string | null, teamId: string | null) {
  const [onlineTeams, setOnlineTeams] = useState<Record<string, { id: string; name: string; online_at: string }>>({});

  useEffect(() => {
    if (!teamShortName || !teamId) return;

    const channel = supabase.channel('team-presence');

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, any[]>;
        const teams: Record<string, { id: string; name: string; online_at: string }> = {};
        for (const [key, presences] of Object.entries(state)) {
          if (presences.length > 0) {
            teams[key] = presences[0];
          }
        }
        setOnlineTeams(teams);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            [teamId]: {
              id: teamId,
              name: teamShortName,
              online_at: new Date().toISOString(),
            },
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamShortName, teamId]);

  return onlineTeams;
}

/** Admin hook to listen for team presence */
export function useOnlineTeams() {
  const [onlineTeamIds, setOnlineTeamIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const channel = supabase.channel('team-presence');

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, any[]>;
        const ids = new Set<string>();
        for (const [key, presences] of Object.entries(state)) {
          if (presences.length > 0) {
            ids.add(key);
          }
        }
        setOnlineTeamIds(ids);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return onlineTeamIds;
}
