/**
 * Lyrics Cache
 *
 * In-memory cache for lyrics API calls to avoid duplicate requests.
 * Implements TTL (time-to-live) for cache entries.
 */

import NodeCache from "node-cache";

interface CacheEntry {
  lyrics: string;
  confidence: number;
  timestamp: number;
}

// Cache with 24-hour TTL
const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

/**
 * Get cached lyrics for a song
 */
export function getCachedLyrics(
  title: string,
  artist: string
): CacheEntry | null {
  const key = `${artist}:${title}`.toLowerCase();
  const cached = cache.get<CacheEntry>(key);
  return cached || null;
}

/**
 * Cache lyrics for a song
 */
export function cacheLyrics(
  title: string,
  artist: string,
  lyrics: string,
  confidence: number
): void {
  const key = `${artist}:${title}`.toLowerCase();
  cache.set(key, {
    lyrics,
    confidence,
    timestamp: Date.now(),
  });
}

/**
 * Clear cache (for testing)
 */
export function clearCache(): void {
  cache.flushAll();
}

/**
 * Get cache stats
 */
export function getCacheStats(): {
  keys: number;
  size: number;
} {
  return {
    keys: cache.keys().length,
    size: JSON.stringify(cache.getStats()).length,
  };
}
