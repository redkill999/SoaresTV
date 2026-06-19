import { createServerFn } from "@tanstack/react-start";

// Proxy fetch for Xtream/M3U/XMLTV to bypass CORS.
// No DB, no auth — pure passthrough. Credentials live in the user's browser.

function normalizeServer(s: string) {
  let v = s.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    return u.origin;
  } catch {
    return v;
  }
}

export const xtreamApi = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      server: string;
      username: string;
      password: string;
      action?: string;
      params?: Record<string, string | number>;
    }) => d,
  )
  .handler(async ({ data }) => {
    const base = normalizeServer(data.server);
    const url = new URL(`${base}/player_api.php`);
    url.searchParams.set("username", data.username);
    url.searchParams.set("password", data.password);
    if (data.action) url.searchParams.set("action", data.action);
    if (data.params) {
      for (const [k, v] of Object.entries(data.params)) {
        url.searchParams.set(k, String(v));
      }
    }

    // Some Xtream panels respond 502/503/504 transiently when overloaded,
    // OR permanently reject requests whose User-Agent isn't on their allow-list.
    // We try the most common IPTV-app UAs in order — if the panel works in
    // Xciptv/Smarters/TiviMate, one of these will match.
    const UAS = [
      "Xciptv/6.0",
      "IPTVSmartersPro/3.1.5",
      "TiviMate/4.7.0",
      "okhttp/4.9.3",
      "Lavf/58.76.100",
      "VLC/3.0.20 LibVLC/3.0.20",
      "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36",
    ];
    let lastStatus = 0;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < UAS.length; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(url.toString(), {
          headers: {
            "User-Agent": UAS[attempt],
            Accept: "*/*",
            "Accept-Encoding": "identity",
            Connection: "keep-alive",
          },
          redirect: "follow",
          signal: controller.signal,
        });
        if (res.ok) {
          const text = await res.text();
          try {
            return { ok: true as const, data: JSON.parse(text) };
          } catch {
            return { ok: false as const, raw: text };
          }
        }
        lastStatus = res.status;
        // Don't retry on auth/permanent errors
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
      // Short backoff between UA attempts (200ms) — total ~1.4s for 7 tries
      await new Promise((r) => setTimeout(r, 200));
    }

    // Em vez de lançar (o que vira "unhandled rejection" no boundary do
    // server-fn e polui o overlay de runtime errors), retornamos um
    // resultado tipado. O cliente (lib/xtream.ts) traduz para mensagem
    // de UI/toast localmente.
    let errMessage: string;
    if (lastStatus === 503 || lastStatus === 502 || lastStatus === 504) {
      errMessage = `Painel Xtream rejeitou o acesso (HTTP ${lastStatus}) mesmo após tentar vários User-Agents. Pode ser bloqueio de IP do servidor (datacenter). Tente novamente em alguns segundos.`;
    } else if (lastStatus === 401 || lastStatus === 403) {
      errMessage = "Credenciais inválidas ou conta bloqueada pelo painel.";
    } else if (lastStatus === 404) {
      errMessage = "Esse endereço não parece ser o DNS Xtream: player_api.php/get.php não existe nele. Link /dashboard é só o painel web; use o DNS/porta da lista IPTV usada no XCIPTV.";
    } else if (lastStatus === 429) {
      errMessage = "Muitas requisições ao painel Xtream. Aguarde alguns segundos e tente novamente.";
    } else if (lastStatus) {
      errMessage = `Xtream respondeu HTTP ${lastStatus}`;
    } else {
      errMessage = lastErr instanceof Error
        ? `Falha de rede ao contatar o servidor: ${lastErr.message}`
        : "Falha de rede ao contatar o servidor Xtream.";
    }
    return { ok: false as const, error: errMessage, status: lastStatus };
  });

export const discoverPanelXtreamServer = createServerFn({ method: "POST" })
  .inputValidator((d: { server: string; username: string; password: string }) => d)
  .handler(async ({ data }) => {
    let target = data.server.trim();
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;

    const inputUrl = new URL(target);
    const origin = inputUrl.origin;
    const loginUrl = new URL("/login", origin).toString();
    const dashboardUrl = new URL("/dashboard", origin).toString();
    const body = new URLSearchParams({ username: data.username, password: data.password, save: "1" });

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const loginRes = await fetch(loginUrl, {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: dashboardUrl,
        },
        body,
        redirect: "manual",
        signal: ctrl.signal,
      });

      const setCookieHeader =
        (loginRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()?.join(", ") ??
        loginRes.headers.get("set-cookie") ??
        "";
      const cookies = setCookieHeader
        ? setCookieHeader.split(/,(?=\s*[^;=]+=[^;]+)/).map((c) => c.split(";")[0]).join("; ")
        : "";
      const location = loginRes.headers.get("location");
      const nextUrl = location ? new URL(location, origin).toString() : dashboardUrl;
      const pageRes = await fetch(nextUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36",
          Accept: "text/html,*/*",
          ...(cookies ? { Cookie: cookies } : {}),
        },
        redirect: "follow",
        signal: ctrl.signal,
      });
      const html = await pageRes.text();
      const haystack = `${location || ""}\n${html}`;

      const matches = Array.from(haystack.matchAll(/https?:\/\/[^\s"'<>]+/gi)).map((m) => m[0].replace(/&amp;/g, "&"));
      const xtreamUrl = matches.find((u) => /\/(player_api|get)\.php\b|:\d{2,5}\b/i.test(u));
      if (xtreamUrl) return { server: normalizeServer(xtreamUrl) };

      if (/Para acessar é preciso logar-se|Bem-vindo ao painel/i.test(html) && !cookies) {
        throw new Error("Não foi possível entrar no painel web para descobrir o DNS Xtream.");
      }

      throw new Error("Login do painel web aceito, mas não encontrei DNS Xtream na página. Copie no XCIPTV o campo Portal/DNS/Host, normalmente com porta, não o link /dashboard.");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        throw new Error("Tempo esgotado ao contatar o painel. Verifique o endereço e tente novamente.");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  });

type M3UEntryDTO = {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
};

type M3UResultDTO = { entries: M3UEntryDTO[]; error?: string };

const MAX_SERVER_ENTRIES = 10_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseM3UText(text: string, limit = MAX_SERVER_ENTRIES): M3UEntryDTO[] {
  const out: M3UEntryDTO[] = [];
  let cur: { name: string; logo?: string; group?: string } | null = null;
  let i = 0;
  // Iterate without splitting the whole string (saves memory on big lists)
  let start = 0;
  for (let j = 0; j <= text.length; j++) {
    if (j === text.length || text.charCodeAt(j) === 10 /* \n */) {
      let line = text.slice(start, j);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      start = j + 1;
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("#EXTINF")) {
        const name = decodeEntities(t.split(",").slice(1).join(",").trim());
        const logo = /tvg-logo="([^"]+)"/.exec(t)?.[1];
        const group = decodeEntities(/group-title="([^"]+)"/.exec(t)?.[1] ?? "");
        cur = { name, logo, group: group || undefined };
      } else if (t.startsWith("#")) {
        // skip other directives
      } else if (cur) {
        out.push({
          id: `m3u-${i++}`,
          url: t,
          name: cur.name || "Sem nome",
          logo: cur.logo,
          group: cur.group,
        });
        if (out.length >= limit) return out;
        cur = null;
      }
    }
  }
  return out;
}

function buildM3UUrl(raw: string, username?: string, password?: string): string {
  let target = (raw || "").trim();
  if (!target) throw new Error("URL vazia");
  if (!/^https?:\/\//i.test(target)) target = `http://${target}`;

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    throw new Error("URL inválida");
  }

  const path = u.pathname.toLowerCase();
  const looksXtream =
    path.endsWith("/player_api.php") ||
    path === "/" ||
    path === "" ||
    (!path.endsWith(".m3u") && !path.endsWith(".m3u8") && !path.endsWith("/get.php"));

  if (looksXtream) {
    const user = u.searchParams.get("username") || username || "";
    const pass = u.searchParams.get("password") || password || "";
    if (!user || !pass) {
      // bare DNS with no credentials — likely not an m3u file
      if (path === "/" || path === "") {
        throw new Error("Para URLs Xtream informe usuário e senha");
      }
    }
    const out = new URL(`${u.origin}/get.php`);
    if (user) out.searchParams.set("username", user);
    if (pass) out.searchParams.set("password", pass);
    out.searchParams.set("type", "m3u_plus");
    // Browser playback needs HLS. Xtream accepts output=m3u8 and returns
    // stream URLs with the provider's real playback host/port.
    out.searchParams.set("output", "m3u8");
    return out.toString();
  }

  // explicit get.php — make sure m3u_plus/HLS params are set
  if (path.endsWith("/get.php")) {
    if (username && !u.searchParams.get("username")) u.searchParams.set("username", username);
    if (password && !u.searchParams.get("password")) u.searchParams.set("password", password);
    if (!u.searchParams.get("type")) u.searchParams.set("type", "m3u_plus");
    u.searchParams.set("output", "m3u8");
    return u.toString();
  }

  return target;
}

function getXtreamAccess(raw: string, username?: string, password?: string) {
  let target = (raw || "").trim();
  if (!target) return null;
  if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
  try {
    const u = new URL(target);
    const user = u.searchParams.get("username") || username || "";
    const pass = u.searchParams.get("password") || password || "";
    if (!user || !pass) return null;
    return { origin: u.origin, username: user, password: pass };
  } catch {
    return null;
  }
}

function isExplicitM3UInput(raw: string): boolean {
  let target = (raw || "").trim();
  if (!target) return false;
  if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
  try {
    const path = new URL(target).pathname.toLowerCase();
    return path.endsWith("/get.php") || path.endsWith(".m3u") || path.endsWith(".m3u8");
  } catch {
    return false;
  }
}

function buildM3UCandidateUrls(raw: string, username?: string, password?: string): string[] {
  const urls: string[] = [];
  const add = (url: string) => {
    if (!urls.includes(url)) urls.push(url);
  };

  const first = buildM3UUrl(raw, username, password);
  add(first);

  let target = (raw || "").trim();
  if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
  try {
    const u = new URL(target);
    const path = u.pathname.toLowerCase();
    if (path.endsWith(".m3u") || path.endsWith(".m3u8")) return urls;

    const user = u.searchParams.get("username") || username || "";
    const pass = u.searchParams.get("password") || password || "";
    if (!user || !pass) return urls;

    const origins = new Set<string>([u.origin]);
    const ports = ["", "80", "8080", "8081", "8880", "25461", "2052", "2082", "2095", "8000", "8001", "8088"];
    for (const port of ports) {
      const origin = `http://${u.hostname}${port ? `:${port}` : ""}`;
      origins.add(origin);
    }

    for (const origin of origins) {
      for (const output of ["m3u8", "ts"]) {
        const out = new URL(`${origin}/get.php`);
        out.searchParams.set("username", user);
        out.searchParams.set("password", pass);
        out.searchParams.set("type", "m3u_plus");
        out.searchParams.set("output", output);
        add(out.toString());
      }
    }
  } catch {
    // keep the first URL only
  }

  return urls;
}

type CategoryMap = Map<string, string>;

async function fetchJson(url: string, timeoutMs = 12_000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "VLC/3.0.20 LibVLC/3.0.20", Accept: "*/*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function loadCategories(
  access: NonNullable<ReturnType<typeof getXtreamAccess>>,
  action: "get_live_categories" | "get_vod_categories" | "get_series_categories",
): Promise<CategoryMap> {
  const u = new URL(`${access.origin}/player_api.php`);
  u.searchParams.set("username", access.username);
  u.searchParams.set("password", access.password);
  u.searchParams.set("action", action);
  const data = await fetchJson(u.toString());
  const m: CategoryMap = new Map();
  if (Array.isArray(data)) {
    for (const c of data) {
      const id = (c as Record<string, unknown>).category_id;
      const name = (c as Record<string, unknown>).category_name;
      if (id != null && typeof name === "string") m.set(String(id), name);
    }
  }
  return m;
}

function mapXtreamLiveStreams(
  data: unknown,
  access: NonNullable<ReturnType<typeof getXtreamAccess>>,
  cats: CategoryMap,
): M3UEntryDTO[] {
  if (!Array.isArray(data)) return [];
  const entries: M3UEntryDTO[] = [];
  data.forEach((item, i) => {
    if (entries.length >= MAX_SERVER_ENTRIES) return;
    const s = item as Record<string, unknown>;
    const id = s.stream_id;
    const name = typeof s.name === "string" ? s.name : `Canal ${i + 1}`;
    if (id == null) return;
    const catId = s.category_id != null ? String(s.category_id) : "";
    const group = cats.get(catId) ?? (typeof s.category_name === "string" ? s.category_name : undefined);
    entries.push({
      id: `xtream-live-${String(id)}`,
      name: decodeEntities(name),
      url: `${access.origin}/live/${access.username}/${access.password}/${String(id)}.ts`,
      logo: typeof s.stream_icon === "string" ? s.stream_icon : undefined,
      group: group ? `Canais | ${group}` : "Canais",
    });
  });
  return entries;
}

function mapXtreamVodStreams(
  data: unknown,
  access: NonNullable<ReturnType<typeof getXtreamAccess>>,
  cats: CategoryMap,
): M3UEntryDTO[] {
  if (!Array.isArray(data)) return [];
  const entries: M3UEntryDTO[] = [];
  data.forEach((item, i) => {
    if (entries.length >= MAX_SERVER_ENTRIES) return;
    const s = item as Record<string, unknown>;
    const id = s.stream_id;
    const name = typeof s.name === "string" ? s.name : `Filme ${i + 1}`;
    if (id == null) return;
    const ext = typeof s.container_extension === "string" && s.container_extension ? s.container_extension : "mp4";
    const catId = s.category_id != null ? String(s.category_id) : "";
    const group = cats.get(catId);
    entries.push({
      id: `xtream-vod-${String(id)}`,
      name: decodeEntities(name),
      url: `${access.origin}/movie/${access.username}/${access.password}/${String(id)}.${ext}`,
      logo: typeof s.stream_icon === "string" ? s.stream_icon : undefined,
      group: group ? `Filmes | ${group}` : "Filmes",
    });
  });
  return entries;
}

async function mapXtreamSeries(
  data: unknown,
  access: NonNullable<ReturnType<typeof getXtreamAccess>>,
  cats: CategoryMap,
): Promise<M3UEntryDTO[]> {
  if (!Array.isArray(data)) return [];
  const entries: M3UEntryDTO[] = [];
  // To keep this fast and within Worker limits, we only fetch the first
  // episode per series in parallel batches. The /playlist UI plays one
  // entry at a time so this gives users access to series content without
  // exploding into thousands of HTTP calls.
  const items = data.slice(0, 800) as Record<string, unknown>[];
  const CONCURRENCY = 8;
  let idx = 0;
  async function worker() {
    while (idx < items.length && entries.length < MAX_SERVER_ENTRIES) {
      const i = idx++;
      const s = items[i];
      const sid = s.series_id;
      if (sid == null) continue;
      const name = typeof s.name === "string" ? s.name : `Série ${i + 1}`;
      const catId = s.category_id != null ? String(s.category_id) : "";
      const group = cats.get(catId);
      const u = new URL(`${access.origin}/player_api.php`);
      u.searchParams.set("username", access.username);
      u.searchParams.set("password", access.password);
      u.searchParams.set("action", "get_series_info");
      u.searchParams.set("series_id", String(sid));
      const info = (await fetchJson(u.toString(), 8_000)) as
        | { episodes?: Record<string, Array<{ id?: string | number; container_extension?: string }>> }
        | null;
      const seasons = info?.episodes ? Object.keys(info.episodes).sort() : [];
      const firstSeason = seasons[0];
      const firstEp = firstSeason ? info?.episodes?.[firstSeason]?.[0] : undefined;
      if (firstEp?.id != null) {
        const ext = firstEp.container_extension || "mp4";
        entries.push({
          id: `xtream-series-${String(sid)}`,
          name: decodeEntities(name),
          url: `${access.origin}/series/${access.username}/${access.password}/${String(firstEp.id)}.${ext}`,
          logo: typeof s.cover === "string" ? s.cover : undefined,
          group: group ? `Séries | ${group}` : "Séries",
        });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return entries;
}

function mergeEntries(primary: M3UEntryDTO[], extra: M3UEntryDTO[]): M3UEntryDTO[] {
  const seen = new Set(primary.map((e) => `${e.url}|${e.name}`));
  const merged = [...primary];
  for (const entry of extra) {
    const key = `${entry.url}|${entry.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged.slice(0, MAX_SERVER_ENTRIES);
}

export const fetchM3U = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { url: string; username?: string; password?: string }) => d,
  )
  .handler(async ({ data }): Promise<M3UResultDTO> => {
    const access = getXtreamAccess(data.url, data.username, data.password);

    async function fetchText(target: string) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const res = await fetch(target, {
          headers: {
            "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
            Accept: "*/*",
          },
          redirect: "follow",
          signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) return { text, error: `Servidor respondeu ${res.status}` };
        return { text };
      } catch (e) {
        return { text: "", error: e instanceof Error ? e.message : "falha de rede" };
      } finally {
        clearTimeout(timer);
      }
    }

    try {
      const candidates = buildM3UCandidateUrls(data.url, data.username, data.password);
      const target = candidates[0];
      const explicitM3U = isExplicitM3UInput(data.url);

      // If the user pasted a concrete M3U/get.php URL, parse that playlist first:
      // it contains the provider's real playback host/port. Falling back to
      // player_api JSON can build wrong stream URLs for panels that separate API
      // and stream hosts.
      if (explicitM3U) {
        const first = await fetchText(target);
        if (first.text.includes("#EXTINF")) {
          const entries = parseM3UText(first.text);
          if (entries.length) {
            if (access) {
              const [seriesCats, seriesData] = await Promise.all([
                loadCategories(access, "get_series_categories"),
                fetchJson(`${access.origin}/player_api.php?username=${encodeURIComponent(access.username)}&password=${encodeURIComponent(access.password)}&action=get_series`),
              ]);
              const seriesEntries = await mapXtreamSeries(seriesData, access, seriesCats);
              return { entries: mergeEntries(entries, seriesEntries) };
            }
            return { entries };
          }
        }
      }

      // For bare Xtream credentials, prefer player_api.php (compact JSON) over
      // get.php (huge M3U dump that can exceed Worker memory/time limits).
      // Pull live + VOD + series in parallel so the playlist UI sees all three.
      if (access && !explicitM3U) {
        const apiUrl = (action: string) => {
          const u = new URL(`${access.origin}/player_api.php`);
          u.searchParams.set("username", access.username);
          u.searchParams.set("password", access.password);
          u.searchParams.set("action", action);
          return u.toString();
        };

        const [liveCats, vodCats, seriesCats, liveData, vodData, seriesData] = await Promise.all([
          loadCategories(access, "get_live_categories"),
          loadCategories(access, "get_vod_categories"),
          loadCategories(access, "get_series_categories"),
          fetchJson(apiUrl("get_live_streams")),
          fetchJson(apiUrl("get_vod_streams")),
          fetchJson(apiUrl("get_series")),
        ]);

        const liveEntries = mapXtreamLiveStreams(liveData, access, liveCats);
        const vodEntries = mapXtreamVodStreams(vodData, access, vodCats);
        const seriesEntries = await mapXtreamSeries(seriesData, access, seriesCats);

        const entries = [...liveEntries, ...vodEntries, ...seriesEntries];
        if (entries.length) return { entries };
      }

      let lastError = "";
      let lastSnippet = "";
      for (const candidate of candidates) {
        const first = await fetchText(candidate);
        if (first.text.includes("#EXTINF")) {
          const entries = parseM3UText(first.text);
          if (entries.length) return { entries };
        }
        lastError = first.error || "Conteúdo não parece M3U válido";
        lastSnippet = first.text.slice(0, 160).replace(/\s+/g, " ").trim();
      }

      return {
        entries: [],
        error: `${lastError || "Conteúdo não parece M3U válido"}. Testei variações automáticas de porta/saída. Verifique se o campo usado é o Portal/DNS/Host do XCIPTV, não o link do painel.${lastSnippet ? ` Resposta: ${lastSnippet}` : ""}`,
      };
    } catch (e) {
      return {
        entries: [],
        error: e instanceof Error ? e.message : "Falha ao carregar a lista M3U",
      };
    }
  });

