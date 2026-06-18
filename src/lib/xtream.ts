import { xtreamApi, fetchM3U } from "./xtream.functions";
import type { XtreamCreds } from "./storage";

export type LiveCategory = { category_id: string; category_name: string };
export type LiveStream = {
  num: number;
  name: string;
  stream_id: number;
  stream_icon: string;
  category_id: string;
  epg_channel_id?: string;
};
export type VodStream = {
  num: number;
  name: string;
  stream_id: number;
  stream_icon: string;
  category_id: string;
  container_extension: string;
  rating?: string;
};
export type Series = {
  num: number;
  name: string;
  series_id: number;
  cover: string;
  category_id: string;
  plot?: string;
  releaseDate?: string;
};
export type Episode = {
  id: string;
  episode_num: number;
  title: string;
  container_extension: string;
  info?: { plot?: string; movie_image?: string; duration?: string };
};

export async function api<T = unknown>(
  c: XtreamCreds,
  action?: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const r = await xtreamApi({ data: { ...c, action, params } });
  if (!r.ok) throw new Error("Resposta inválida do servidor");
  return r.data as T;
}

export async function login(c: XtreamCreds) {
  const r = await api<{ user_info?: { auth?: number; status?: string }; server_info?: unknown }>(
    c,
  );
  if (!r?.user_info || r.user_info.auth !== 1) throw new Error("Credenciais inválidas");
  return r;
}

export const normalizeServer = (s: string) => {
  let v = s.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v;
};

export const streamUrl = {
  live: (c: XtreamCreds, id: number | string) =>
    `${normalizeServer(c.server)}/live/${c.username}/${c.password}/${id}.m3u8`,
  movie: (c: XtreamCreds, id: number | string, ext = "mp4") =>
    `${normalizeServer(c.server)}/movie/${c.username}/${c.password}/${id}.${ext}`,
  episode: (c: XtreamCreds, id: number | string, ext = "mp4") =>
    `${normalizeServer(c.server)}/series/${c.username}/${c.password}/${id}.${ext}`,
};

// --- M3U parser ---
export type M3UEntry = {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
};

export function parseM3U(text: string): M3UEntry[] {
  const lines = text.split(/\r?\n/);
  const out: M3UEntry[] = [];
  let cur: Partial<M3UEntry> | null = null;
  let i = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF")) {
      const name = line.split(",").slice(1).join(",").trim();
      const logo = /tvg-logo="([^"]+)"/.exec(line)?.[1];
      const group = /group-title="([^"]+)"/.exec(line)?.[1];
      cur = { name, logo, group };
    } else if (line && !line.startsWith("#") && cur) {
      out.push({ id: `m3u-${i++}`, url: line, name: cur.name || "Sem nome", logo: cur.logo, group: cur.group });
      cur = null;
    }
  }
  return out;
}

export async function loadM3U(url: string) {
  const r = await fetchM3U({ data: { url } });
  return parseM3U(r.text);
}
