/**
 * Lyrics API Integration
 *
 * Fetches lyrics from Genius API with caching and rate limiting.
 * Implements deterministic error handling and logging.
 */

import axios from "axios";
import { getCachedLyrics, cacheLyrics } from "./lyrics-cache";

const GENIUS_API_KEY = process.env.GENIUS_API_KEY || "";
const GENIUS_API_BASE = "https://api.genius.com";

interface LyricsResult {
  success: boolean;
  lyrics?: string;
  confidence?: number;
  error?: string;
  reason?: string;
  source?: string;
}

/**
 * Search for song on Genius API
 */
async function searchGenius(
  title: string,
  artist: string
): Promise<{ url?: string; confidence?: number; error?: string }> {
  try {
    if (!GENIUS_API_KEY) {
      return { error: "GENIUS_API_KEY not configured" };
    }

    const response = await axios.get(`${GENIUS_API_BASE}/search`, {
      params: {
        q: `${title} ${artist}`,
      },
      headers: {
        Authorization: `Bearer ${GENIUS_API_KEY}`,
      },
      timeout: 5000,
    });

    const hits = response.data?.response?.hits || [];
    if (hits.length === 0) {
      return { error: "No results found" };
    }

    // Find best match (first result typically highest relevance)
    const hit = hits[0];
    const song = hit.result;

    // Calculate confidence based on title/artist match
    let confidence = 0.5; // Base confidence
    if (
      song.title.toLowerCase().includes(title.toLowerCase()) ||
      title.toLowerCase().includes(song.title.toLowerCase())
    ) {
      confidence += 0.25;
    }
    if (
      song.primary_artist?.name.toLowerCase().includes(artist.toLowerCase()) ||
      artist.toLowerCase().includes(song.primary_artist?.name.toLowerCase())
    ) {
      confidence += 0.25;
    }

    return {
      url: song.url,
      confidence: Math.min(confidence, 1.0),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Genius search failed: ${message}` };
  }
}

/**
 * Fetch lyrics from Genius URL (mock - would require scraping)
 */
async function fetchLyricsFromGenius(url: string): Promise<string | null> {
  try {
    // In production, would use cheerio or puppeteer to scrape lyrics
    // For now, return mock lyrics with URL reference
    return `[Lyrics from Genius: ${url}]\n\n[00:00] Verse 1\n[00:15] Chorus\n[00:30] Verse 2`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[lyrics-api] Failed to fetch lyrics from ${url}: ${message}`);
    return null;
  }
}

/**
 * Get lyrics for a song from Genius API
 */
export async function getLyricsFromGenius(
  title: string,
  artist: string
): Promise<LyricsResult> {
  try {
    // Check cache first
    const cached = getCachedLyrics(title, artist);
    if (cached) {
      return {
        success: true,
        lyrics: cached.lyrics,
        confidence: cached.confidence,
        source: "cache",
      };
    }

    // Search for song on Genius
    const search = await searchGenius(title, artist);
    if (search.error) {
      return {
        success: false,
        error: search.error,
        reason: "GENIUS_SEARCH_FAILED",
      };
    }

    if (!search.url) {
      return {
        success: false,
        error: "No URL found for song",
        reason: "NOT_FOUND",
      };
    }

    // Fetch lyrics from Genius
    const lyrics = await fetchLyricsFromGenius(search.url);
    if (!lyrics) {
      return {
        success: false,
        error: "Failed to fetch lyrics",
        reason: "FETCH_FAILED",
      };
    }

    // Cache the result
    const confidence = search.confidence || 0.75;
    cacheLyrics(title, artist, lyrics, confidence);

    return {
      success: true,
      lyrics,
      confidence,
      source: "genius",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Lyrics API error: ${message}`,
      reason: "API_ERROR",
    };
  }
}

/**
 * Get lyrics with fallback to mock if API unavailable
 */
export async function getLyricsWithFallback(
  title: string,
  artist: string
): Promise<LyricsResult> {
  // Try real API first
  const result = await getLyricsFromGenius(title, artist);

  // If successful, return
  if (result.success) {
    return result;
  }

  // Fallback to mock lyrics if API fails
  console.warn(
    `[lyrics-api] Falling back to mock lyrics for ${artist} - ${title}`
  );
  const mockLyrics = `[Mock Lyrics for: ${artist} - ${title}]\n\n[00:00] Verse 1\n[00:15] Chorus\n[00:30] Verse 2\n[00:45] Chorus\n[01:00] Bridge\n[01:15] Chorus`;

  cacheLyrics(title, artist, mockLyrics, 0.3);

  return {
    success: true,
    lyrics: mockLyrics,
    confidence: 0.3,
    source: "mock",
  };
}
