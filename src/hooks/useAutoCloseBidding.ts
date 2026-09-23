import { useEffect, useRef } from 'react';
import { closeBidding } from '../lib/queries';
import { remainingSeconds } from '../lib/serverTime';
import type { AuctionWithItem } from '../types';

/**
 * Settle the bidding phase when the 60s window expires.
 *
 * Every client (admin panel, each team dashboard, the projector) calls this;
 * close_bidding() is idempotent and re-checks the deadline on the SERVER clock,
 * so duplicate callers are harmless.
 *
 * The server waits out a 2s buzzer grace before settling so bids fired just
 * before the deadline still land — until then the RPC answers `not_expired`,
 * which is why this retries briefly. One shared hook keeps all three panels
 * behaving identically (they used to carry three copies of this logic).
 */
export function useAutoCloseBidding(auction: AuctionWithItem | null) {
  const firedRef = useRef<string | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => () => {
    timersRef.current.forEach(t => window.clearTimeout(t));
  }, []);

  useEffect(() => {
    if (!auction || auction.status !== 'open' || !auction.bidding_ends_at) {
      firedRef.current = null;
      return;
    }
    if (remainingSeconds(auction.bidding_ends_at) > 0) return;
    if (firedRef.current === auction.id) return;

    const auctionId = auction.id;
    firedRef.current = auctionId;

    const settle = async (attempt: number) => {
      const res = await closeBidding(auctionId, false).catch(() => null);
      if (res && !res.ok && res.error === 'not_expired' && attempt < 6) {
        timersRef.current.push(window.setTimeout(() => settle(attempt + 1), 1000));
      }
    };

    settle(0);
  }, [auction]);
}
