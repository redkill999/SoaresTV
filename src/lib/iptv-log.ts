/**
 * Logger sanitizado para chamadas IPTV.
 * Nunca registra username, password, URL completa da playlist, token,
 * ou qualquer credencial. Apenas: action, category_id, duração, status,
 * quantidade de itens.
 */
type Level = "info" | "warn" | "error";

const ENABLED =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

export interface IptvLogEntry {
  action: string;
  category_id?: string | null;
  status: "ok" | "error" | "empty";
  ms: number;
  count?: number;
  message?: string;
}

export function iptvLog(level: Level, entry: IptvLogEntry) {
  if (!ENABLED) return;
  const safe = {
    action: entry.action,
    category_id: entry.category_id ?? null,
    status: entry.status,
    ms: Math.round(entry.ms),
    count: entry.count ?? null,
    ...(entry.message ? { message: String(entry.message).slice(0, 120) } : {}),
  };
  // eslint-disable-next-line no-console
  console[level === "info" ? "log" : level]("[iptv]", safe);
}

export async function timed<T>(
  action: string,
  fn: () => Promise<T>,
  opts: { category_id?: string | null; countOf?: (v: T) => number } = {},
): Promise<T> {
  const t0 = performance.now();
  try {
    const v = await fn();
    const count = opts.countOf ? opts.countOf(v) : undefined;
    iptvLog("info", {
      action,
      category_id: opts.category_id ?? null,
      status: count === 0 ? "empty" : "ok",
      ms: performance.now() - t0,
      count,
    });
    return v;
  } catch (e) {
    iptvLog("warn", {
      action,
      category_id: opts.category_id ?? null,
      status: "error",
      ms: performance.now() - t0,
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
