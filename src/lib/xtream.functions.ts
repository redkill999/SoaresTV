import { createServerFn } from "@tanstack/react-start";

// Proxy fetch for Xtream/M3U/XMLTV to bypass CORS.
// No DB, no auth — pure passthrough. Credentials live in the user's browser.

function normalizeServer(s: string) {
  let v = s.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v;
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
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 SoaresTV" },
    });
    if (!res.ok) throw new Error(`Xtream ${res.status}`);
    const text = await res.text();
    try {
      return { ok: true as const, data: JSON.parse(text) };
    } catch {
      return { ok: false as const, raw: text };
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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseM3UText(text: string): M3UEntryDTO[] {
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
    out.searchParams.set("output", "ts");
    return out.toString();
  }

  // explicit get.php — make sure m3u_plus params are set
  if (path.endsWith("/get.php")) {
    if (username && !u.searchParams.get("username")) u.searchParams.set("username", username);
    if (password && !u.searchParams.get("password")) u.searchParams.set("password", password);
    if (!u.searchParams.get("type")) u.searchParams.set("type", "m3u_plus");
    if (!u.searchParams.get("output")) u.searchParams.set("output", "ts");
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

function mapXtreamLiveStreams(data: unknown, access: NonNullable<ReturnType<typeof getXtreamAccess>>): M3UEntryDTO[] {
  if (!Array.isArray(data)) return [];
  const entries: M3UEntryDTO[] = [];
  data.forEach((item, i) => {
    const stream = item as Record<string, unknown>;
    const id = stream.stream_id;
    const name = typeof stream.name === "string" ? stream.name : `Canal ${i + 1}`;
    if (id !== undefined && id !== null) {
      entries.push({
        id: `xtream-live-${String(id)}`,
        name: decodeEntities(name),
        url: `${access.origin}/live/${access.username}/${access.password}/${String(id)}.ts`,
        logo: typeof stream.stream_icon === "string" ? stream.stream_icon : undefined,
        group: typeof stream.category_name === "string" ? stream.category_name : undefined,
      });
    }
  });
  return entries;
}

export const fetchM3U = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { url: string; username?: string; password?: string }) => d,
  )
  .handler(async ({ data }): Promise<M3UResultDTO> => {
    const access = getXtreamAccess(data.url, data.username, data.password);
    const tried: string[] = [];

    async function fetchText(target: string) {
      tried.push(target);
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
      const target = buildM3UUrl(data.url, data.username, data.password);
      const first = await fetchText(target);
      if (first.text.includes("#EXTINF")) {
        const entries = parseM3UText(first.text);
        if (entries.length) return { entries };
      }

      if (access) {
        const liveUrl = new URL(`${access.origin}/player_api.php`);
        liveUrl.searchParams.set("username", access.username);
        liveUrl.searchParams.set("password", access.password);
        liveUrl.searchParams.set("action", "get_live_streams");

        const live = await fetchText(liveUrl.toString());
        try {
          const entries = mapXtreamLiveStreams(JSON.parse(live.text), access);
          if (entries.length) return { entries };
        } catch {
          // keep controlled error below
        }
      }

      const snippet = first.text.slice(0, 160).replace(/\s+/g, " ").trim();
      return {
        entries: [],
        error: `${first.error || "Conteúdo não parece M3U válido"}. Verifique URL/usuário/senha.${snippet ? ` Resposta: ${snippet}` : ""}`,
      };
    } catch (e) {
      return {
        entries: [],
        error: e instanceof Error ? e.message : "Falha ao carregar a lista M3U",
      };
    }
  });

