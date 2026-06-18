import type { M3UEntry } from "./xtream";

// In-memory cache of last loaded M3U list. Survives client navigation but not
// full page reloads. We avoid localStorage because large lists (>5MB) blow the
// quota and serializing JSON for thousands of entries on every nav is slow.
let cached: { url: string; name: string; entries: M3UEntry[] } | null = null;

export const m3uCache = {
  set(url: string, name: string, entries: M3UEntry[]) {
    cached = { url, name, entries };
  },
  get() {
    return cached;
  },
  clear() {
    cached = null;
  },
};
