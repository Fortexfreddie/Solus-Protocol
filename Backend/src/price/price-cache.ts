// src/price/price-cache.ts
// Shared 30-second TTL price cache for all three agents.
// All agents read from the same cache — only one live API call per 30s window.

import type { PriceData } from '../types/agent-types.js';

const CACHE_TTL_MS = 30_000; // 30 seconds per spec

// PriceCache class 
export class PriceCache {
    private data: PriceData | null = null;
    private fetchedAt: number = 0;

    /**
     * Returns the cached price data if it is still fresh (within TTL).
     * Returns null if the cache is empty or stale.
     */
    get(): PriceData | null {
        if (!this.data) return null;
        if (Date.now() - this.fetchedAt > CACHE_TTL_MS) return null;
        return this.data;
    }

    /**
     * Returns the last known price data regardless of TTL.
     * Used as a fallback when the live API call fails — data is explicitly marked stale.
     */
    getStale(): PriceData | null {
        if (!this.data) return null;
        
        return {
            ...this.data,
            stale: true,
            timestamp: Date.now() // Update timestamp so the current cycle doesn't reject it
        };
    }

    /**
     * Stores fresh price data and updates the cache timestamp.
     */
    set(data: PriceData): void {
        this.data = { ...data, stale: false };
        this.fetchedAt = Date.now();
    }

    /** Returns true if the cache has any data (fresh or stale). */
    hasData(): boolean {
        return this.data !== null;
    }

    /** Returns true if cached data is still within TTL. */
    isFresh(): boolean {
        return this.data !== null && Date.now() - this.fetchedAt <= CACHE_TTL_MS;
    }

    /** Returns how many milliseconds until the cache expires. */
    ttlRemainingMs(): number {
        if (!this.data) return 0;
        return Math.max(0, CACHE_TTL_MS - (Date.now() - this.fetchedAt));
  }
}

// Singleton 

// Shared singleton — all agents, oracle service, and REST /api/prices route
// import and use this same instance.
export const priceCache = new PriceCache();