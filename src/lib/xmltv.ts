/**
 * XMLTV parser incremental para EPG proveniente de listas M3U.
 *
 * Motivação: Xtream tem `get_simple_data_table` (usado em `xtream.ts`), mas
 * listas .m3u puras só oferecem EPG via `url-tvg="..."` no header, que aponta
 * para um XMLTV (às vezes .xml.gz). Este módulo cobre esse caminho — sem
 * alterar o fluxo Xtream existente.
 *
 * Características:
 *  - varredura sem `text.split` (evita OOM em XMLs grandes, 30-80 MB)
 *  - regex-based, tolerante a atributos em qualquer ordem
 *  - índice `channelId → EpgProgramme[]` já ordenado por início
 *  - `channelDisplay` para casar tvg-name quando tvg-id não bate
 *  - cancelamento cooperativo via `{ aborted: boolean }`
 *  - normalização de datas XMLTV: `YYYYMMDDHHMMSS +ZZZZ`
 */

export type EpgProgramme = {
  channelId: string;
  /** epoch ms */
  start: number;
  /** epoch ms */
  stop: number;
  title: string;
  description?: string;
};

export type XmltvIndex = {
  /** tvg-id → programas ordenados por start asc */
  byChannel: Map<string, EpgProgramme[]>;
  /** display-name (lowercased) → channelId — fallback quando tvg-id não casa */
  channelByDisplay: Map<string, string>;
  totalProgrammes: number;
  truncated: boolean;
};

interface CancelSignal { aborted: boolean }

const MAX_PROGRAMMES = 500_000;

const RE_CHANNEL = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
const RE_PROG_OPEN = /<programme\b([^>]*)>/g;
const RE_ATTR = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
const RE_DISPLAY = /<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>/g;
const RE_TITLE = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/;
const RE_DESC = /<desc(?:\s[^>]*)?>([\s\S]*?)<\/desc>/;

function decodeEntities(s: string): string {
  if (!s) return s;
  if (s.indexOf("&") === -1) return s.trim();
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .trim();
}

function attr(raw: string, name: string): string | undefined {
  RE_ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_ATTR.exec(raw))) {
    if (m[1].toLowerCase() === name) return m[2];
  }
  return undefined;
}

/**
 * Converte data XMLTV `YYYYMMDDHHMMSS +ZZZZ` → epoch ms.
 * Aceita sem timezone (assume UTC), com espaço ou sem.
 */
export function parseXmltvDate(s: string | undefined): number {
  if (!s) return NaN;
  const t = s.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?$/.exec(t);
  if (!m) {
    const n = Date.parse(t);
    return Number.isFinite(n) ? n : NaN;
  }
  const [, Y, Mo, D, H, Mi, S, tz] = m;
  const iso = `${Y}-${Mo}-${D}T${H}:${Mi}:${S}${tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "Z"}`;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parser incremental. Não usa DOMParser (não disponível SSR e explode memória).
 * Regex-based, seguro porque XMLTV tem estrutura simples e bem definida.
 */
export function parseXmltv(text: string, opts?: { signal?: CancelSignal }): XmltvIndex {
  const byChannel = new Map<string, EpgProgramme[]>();
  const channelByDisplay = new Map<string, string>();
  let truncated = false;
  let total = 0;

  // Strip BOM
  const src = text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  // 1) canais → display-names
  RE_CHANNEL.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = RE_CHANNEL.exec(src))) {
    if (opts?.signal?.aborted) return { byChannel, channelByDisplay, totalProgrammes: total, truncated };
    const id = attr(cm[1], "id");
    if (!id) continue;
    RE_DISPLAY.lastIndex = 0;
    let dm: RegExpExecArray | null;
    while ((dm = RE_DISPLAY.exec(cm[2]))) {
      const name = decodeEntities(dm[1]).toLowerCase();
      if (name && !channelByDisplay.has(name)) channelByDisplay.set(name, id);
    }
  }

  // 2) programmes — varredura por índice, sem materializar array de matches
  RE_PROG_OPEN.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = RE_PROG_OPEN.exec(src))) {
    if (opts?.signal?.aborted) break;
    const openEnd = RE_PROG_OPEN.lastIndex;
    const close = src.indexOf("</programme>", openEnd);
    if (close === -1) break;
    const inner = src.slice(openEnd, close);
    RE_PROG_OPEN.lastIndex = close + "</programme>".length;

    const channelId = attr(pm[1], "channel");
    if (!channelId) continue;
    const start = parseXmltvDate(attr(pm[1], "start"));
    const stop = parseXmltvDate(attr(pm[1], "stop"));
    if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;

    const t = RE_TITLE.exec(inner)?.[1];
    const d = RE_DESC.exec(inner)?.[1];
    const prog: EpgProgramme = {
      channelId,
      start,
      stop,
      title: t ? decodeEntities(t) : "",
      description: d ? decodeEntities(d) : undefined,
    };
    let list = byChannel.get(channelId);
    if (!list) {
      list = [];
      byChannel.set(channelId, list);
    }
    list.push(prog);
    total++;
    if (total >= MAX_PROGRAMMES) { truncated = true; break; }
  }

  // 3) ordena por start (defensivo — XMLTV normalmente já vem ordenado)
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.start - b.start);
  }

  return { byChannel, channelByDisplay, totalProgrammes: total, truncated };
}

/**
 * Descobre o EpgProgramme corrente para um canal, dado o índice XMLTV.
 * Tenta primeiro por tvg-id; se não achar, tenta casar por tvg-name
 * (case-insensitive) via `channelByDisplay`.
 */
export function lookupNowProgramme(
  idx: XmltvIndex,
  opts: { tvgId?: string; tvgName?: string; nowMs?: number },
): EpgProgramme | null {
  const now = opts.nowMs ?? Date.now();
  let list = opts.tvgId ? idx.byChannel.get(opts.tvgId) : undefined;
  if ((!list || !list.length) && opts.tvgName) {
    const mapped = idx.channelByDisplay.get(opts.tvgName.toLowerCase());
    if (mapped) list = idx.byChannel.get(mapped);
  }
  if (!list || !list.length) return null;
  // busca linear a partir do meio; listas de canal costumam ter <200 itens/dia
  for (const p of list) {
    if (p.start <= now && p.stop > now) return p;
    if (p.start > now) break;
  }
  return null;
}
