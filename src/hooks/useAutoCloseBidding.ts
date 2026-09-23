import { useEffect, useRef } from 'react';
import { closeBidding, expireQuestion } from '../lib/queries';
import { serverNow } from '../lib/serverTime';
import type { AuctionWithItem } from '../types';

/**
 * Settle a phase when its clock runs out — no quizmaster click required.
 *
 *  · BIDDING over  → close_bidding() crowns the highest bidder and hands them
 *    the question.
 *  · QUESTION over → expire_question() marks the round WRONG (bid lost) and
 *    announces it as TIME'S UP with the correct answer.
 *
 * Every client (admin panel, each team dashboard, the projector) calls this;
 * both RPCs are idempotent and re-check their deadline on the SERVER clock, so
 * duplicate callers are harmless — the round settles even if every team closes
 * its laptop.
 *
 * Each deadline is scheduled locally to fire the moment it passes rather than
 * waiting for the next realtime event (a quiet round produces none), and the
 * server waits out a 2s grace before either deadline is final, so a bid or a
 * pick fired at the buzzer still lands. Until then the RPC answers
 * `not_expired`, which is why the settle retries briefly.
 */
export function useAutoCloseBidding(auction: AuctionWithItem | null) {
  // Separate guards: bidding and the question are the SAME auction row, so one
  // shared ref would let the settlement of phase one suppress phase two.
  const bidFiredRef = useRef<string | null>(null);
  const questionFiredRef = useRef<string | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => () => {
    timersRef.current.forEach(t => window.clearTimeout(t));
  }, []);

  // ── Bidding deadline → crown the winner of the round ────────────────────────
  useEffect(() => {
    if (!auction || auction.status !== 'open' || !auction.bidding_ends_at) {
      bidFiredRef.current = null;
      return;
    }
    const auctionId = auction.id;
    const msLeft = new Date(auction.bidding_ends_at).getTime() - serverNow();
    return fireWhenDue(timersRef, auctionId, bidFiredRef, id => closeBidding(id, false), msLeft);
  }, [auction]);

  // ── Question timer expires → settle the round as WRONG (TIME'S UP) ──────────
  useEffect(() => {
    if (!auction || auction.status !== 'question') {
      questionFiredRef.current = null;
      return;
    }
    if (auction.timer_paused || !auction.timer_started_at) return;

    const auctionId = auction.id;
    const endsAt = new Date(auction.timer_started_at).getTime() + auction.timer_duration * 1000;
    return fireWhenDue(timersRef, auctionId, questionFiredRef, id => expireQuestion(id), endsAt - serverNow());
  }, [auction]);
}

/**
 * Run the settle RPC now — or the moment the deadline passes — retrying while
 * the server still reports the grace window. Module scope keeps it out of the
 * effects' dependency lists.
 */
function fireWhenDue(
  timersRef: { current: number[] },
  auctionId: string,
  firedRef: { current: string | null },
  rpc: (id: string) => Promise<{ ok: boolean; error?: string } | null>,
  delayMs: number
): (() => void) | undefined {
  const run = () => {
    if (firedRef.current === auctionId) return;
    firedRef.current = auctionId;

    const settle = async (attempt: number) => {
      const res = await rpc(auctionId).catch(() => null);
      if (res && !res.ok && res.error === 'not_expired' && attempt < 6) {
        timersRef.current.push(window.setTimeout(() => settle(attempt + 1), 1000));
      }
    };

    settle(0);
  };

  if (delayMs <= 0) {
    run();
    return;
  }
  const t = window.setTimeout(run, delayMs + 300);
  timersRef.current.push(t);
  return () => window.clearTimeout(t);
}
