import { useEffect, useRef, useState } from 'react';
import { getLatestRoundResult } from '../lib/queries';
import { useRealtimeTable } from './useRealtime';
import type { RoundResult } from '../types';

/**
 * Live round results.
 *
 * settle_answer() writes exactly one row to round_results the moment a question
 * is graded — whether the winning team's pick was auto-verified or the
 * quizmaster graded it by hand. The admin panel, every team dashboard and the
 * projector all subscribe to that table, so the verdict shows up everywhere at
 * the same instant.
 *
 * `latest`      — newest result ever seen (safe as a static strip on mount)
 * `announcement`— non-null only for a realtime arrival; clears itself after
 *                 `displayMs`. That is the "prompt" the panels flash.
 */
export function useRoundResults(displayMs = 9000) {
  const [latest, setLatest] = useState<RoundResult | null>(null);
  const [announcement, setAnnouncement] = useState<RoundResult | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const clearRef = useRef<number | null>(null);

  // Seed with the current state of play — without announcing it (a page that
  // loads mid-event must not flash a stale result as if it just happened).
  useEffect(() => {
    let cancelled = false;
    getLatestRoundResult()
      .then(r => {
        if (cancelled || !r) return;
        seenRef.current.add(r.id);
        setLatest(r);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useRealtimeTable({
    table: 'round_results',
    onChange: (payload: any) => {
      if (payload?.eventType !== 'INSERT') return;
      const row = payload.new as RoundResult;
      if (!row?.id || seenRef.current.has(row.id)) return;
      seenRef.current.add(row.id);
      setLatest(row);
      setAnnouncement(row);
      if (clearRef.current) window.clearTimeout(clearRef.current);
      clearRef.current = window.setTimeout(() => setAnnouncement(null), displayMs);
    },
  });

  useEffect(() => () => {
    if (clearRef.current) window.clearTimeout(clearRef.current);
  }, []);

  return { latest, announcement };
}
