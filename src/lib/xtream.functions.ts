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

export const fetchM3U = createServerFn({ method: "POST" })
  .inputValidator((d: { url: string }) => d)
  .handler(async ({ data }): Promise<{ entries: M3UEntryDTO[] }> => {
    let target = (data.url || "").trim();
    if (!target) throw new Error("URL vazia");
    if (!/^https?:\/\//i.test(target)) target = `http://${target}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(target, {
        headers: {
          "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
          Accept: "*/*",
        },
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(`Falha de rede: ${e instanceof Error ? e.message : "desconhecida"}`);
    }
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Servidor M3U respondeu ${res.status}`);
    const text = await res.text();
    if (!text.includes("#EXTM3U") && !text.includes("#EXTINF")) {
      throw new Error("Conteúdo não parece ser uma lista M3U válida");
    }
    const entries = parseM3UText(text);
    if (!entries.length) throw new Error("Nenhum canal encontrado na lista");
    return { entries };
  });
