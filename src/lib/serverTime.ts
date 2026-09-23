import { supabase } from './supabase';

// ─── Server-Clock Sync ────────────────────────────────────────────────────────
//
// Every countdown (bidding window, question timer) is derived from an
// absolute timestamp stored in the DATABASE, evaluated against the SERVER
// clock. Each client measures its own offset vs the server once via the
// get_server_time() RPC (migration 008) — so admin, team dashboards and the
// projector all tick in lock-step even when their device clocks disagree.
// This is what fixes "admin timer runs faster/slower than team panels" and
// countdowns that jumped up and down between refetches.

let offsetMs = 0;
let lastSyncAt = 0;
let inFlight: Promise<void> | null = null;

const RESYNC_INTERVAL_MS = 5 * 60 * 1000;

export async function syncServerTime(): Promise<void> {
  if (Date.now() - lastSyncAt < RESYNC_INTERVAL_MS) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const t0 = Date.now();
      const { data, error } = await supabase.rpc('get_server_time');
      const t1 = Date.now();
      if (!error && data) {
        const serverMs = new Date(data as string).getTime();
        // Half-RTT correction: best estimate of the server clock "right now".
        offsetMs = serverMs + (t1 - t0) / 2 - t1;
        lastSyncAt = t1;
      }
    } catch {
      // Offline / RPC missing — keep the previous offset (initially 0).
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Current time adjusted to the server clock (ms since epoch). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** ISO timestamp generated against the server clock — use for DB writes. */
export function serverNowIso(): string {
  return new Date(serverNow()).toISOString();
}

/** Whole seconds left until an absolute ISO deadline (server clock). Monotonic. */
export function remainingSeconds(isoDeadline: string | null | undefined): number {
  if (!isoDeadline) return 0;
  return Math.max(0, Math.ceil((new Date(isoDeadline).getTime() - serverNow()) / 1000));
}
