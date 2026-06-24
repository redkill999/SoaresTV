import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PremiumChrome } from "@/components/PremiumChrome";
import { store, type XtreamCreds } from "@/lib/storage";
import {
  api,
  getFullEpg,
  type EpgListing,
  type LiveCategory,
  type LiveStream,
} from "@/lib/xtream";
import { loadPersisted, withPersist } from "@/lib/query-persist";
import { CalendarDays, ChevronLeft, ChevronRight, Tv } from "lucide-react";

export const Route = createFileRoute("/guide")({
  head: () => ({ meta: [{ title: "Guia EPG — SoaresTV" }] }),
  component: GuidePage,
});

// Visual scale: 1 hour = 240px wide
const PX_PER_HOUR = 240;
const PX_PER_SEC = PX_PER_HOUR / 3600;
const ROW_HEIGHT = 64;
const CHANNEL_COL = 240;
// Window: from 1h ago, to +11h
const WINDOW_HOURS = 12;
// Limit channels to keep the page snappy (you can scroll the list with arrows)
const CHANNELS_PER_PAGE = 30;

function GuidePage() {
  const navigate = useNavigate();
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [catId, setCatId] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCreds(store.getCreds()), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const categoriesQ = useQuery({
    queryKey: ["live-cats", acct],
    enabled: !!creds,
    queryFn: () => api<LiveCategory[]>(creds!, "get_live_categories"),
  });
  const streamsQ = useQuery({
    queryKey: ["live-streams", acct, "all"],
    enabled: !!creds,
    queryFn: () => api<LiveStream[]>(creds!, "get_live_streams"),
  });

  const filteredChannels = useMemo(() => {
    let list = streamsQ.data ?? [];
    if (catId !== "all") list = list.filter((s) => String(s.category_id) === catId);
    return list;
  }, [streamsQ.data, catId]);

  const totalPages = Math.max(1, Math.ceil(filteredChannels.length / CHANNELS_PER_PAGE));
  useEffect(() => {
    if (page >= totalPages) setPage(0);
  }, [totalPages, page]);

  const visibleChannels = useMemo(() => {
    const start = page * CHANNELS_PER_PAGE;
    return filteredChannels.slice(start, start + CHANNELS_PER_PAGE);
  }, [filteredChannels, page]);

  // ---- EPG viewport-gating -----------------------------------------------
  // Em vez de disparar 30 requests em paralelo (que derruba painel lento),
  // só buscamos EPG quando a linha do canal entra na viewport do scroll.
  // Uma vez buscado, mantemos o id no Set — evita flicker ao rolar.
  const dayKey = useMemo(() => Math.floor(Date.now() / 86_400_000), []);
  const [activeIds, setActiveIds] = useState<Set<number>>(() => new Set());
  // Reset quando o conjunto base muda (página/categoria) — semeamos os 6
  // primeiros já como ativos pra não esperar IntersectionObserver no 1º render.
  useEffect(() => {
    const seed = new Set<number>();
    visibleChannels.slice(0, 6).forEach((s) => seed.add(s.stream_id));
    setActiveIds(seed);
  }, [visibleChannels]);

  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());
  const registerRow = useCallback((id: number, el: HTMLElement | null) => {
    const map = rowRefs.current;
    if (el) map.set(id, el);
    else map.delete(id);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const toAdd: number[] = [];
        for (const e of entries) {
          if (e.isIntersecting) {
            const id = Number((e.target as HTMLElement).dataset.streamId);
            if (Number.isFinite(id)) toAdd.push(id);
          }
        }
        if (toAdd.length) {
          setActiveIds((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const id of toAdd) {
              if (!next.has(id)) { next.add(id); changed = true; }
            }
            return changed ? next : prev;
          });
        }
      },
      { rootMargin: "400px 0px" },
    );
    for (const el of rowRefs.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [visibleChannels]);

  // Fetch EPG só para canais ativos; cada um é persistido por dia/servidor.
  const epgQueries = useQueries({
    queries: visibleChannels.map((s) => {
      const cacheKey = `epg-full:${acct}:${s.stream_id}:${dayKey}`;
      const persisted = acct ? loadPersisted<EpgListing[]>(cacheKey) : null;
      return {
        queryKey: ["epg-full", acct, s.stream_id, dayKey],
        enabled: !!creds && activeIds.has(s.stream_id),
        staleTime: 30 * 60_000,
        queryFn: withPersist(cacheKey, () => getFullEpg(creds!, s.stream_id)),
        initialData: persisted?.data,
        initialDataUpdatedAt: persisted?.updatedAt,
      };
    }),
  });

  // Timeline window
  const windowStart = useMemo(() => {
    const d = new Date(now * 1000);
    d.setMinutes(0, 0, 0);
    return Math.floor(d.getTime() / 1000) - 3600; // start 1h before this hour
  }, [now]);
  const windowEnd = windowStart + WINDOW_HOURS * 3600;
  const timelineWidth = WINDOW_HOURS * PX_PER_HOUR;

  // Scroll so "now" is visible on first paint
  useEffect(() => {
    if (!timelineRef.current) return;
    const x = (now - windowStart) * PX_PER_SEC - 160;
    timelineRef.current.scrollLeft = Math.max(0, x);
  }, [windowStart, now]);

  if (!creds) {
    return (
      <PremiumChrome title="EPG">
        <div className="py-20 text-center text-sm text-white/60 px-4">
          Faça login para ver o guia EPG.
        </div>
      </PremiumChrome>
    );
  }

  const nowOffsetPx = (now - windowStart) * PX_PER_SEC;
  const hours = Array.from({ length: WINDOW_HOURS + 1 }, (_, i) => windowStart + i * 3600);

  return (
    <PremiumChrome title="EPG">
      <div className="px-3 sm:px-5 pb-3 flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <CalendarDays className="size-5 text-red-400" />
          <h2 className="text-sm font-bold tracking-[0.25em] uppercase text-white/90 truncate">Guia EPG</h2>
          <span className="text-[10px] text-white/50 hidden sm:inline">agora ± {WINDOW_HOURS - 1}h</span>
        </div>
        <select
          value={catId}
          onChange={(e) => { setCatId(e.target.value); setPage(0); }}
          className="h-8 rounded-full bg-white/5 border border-white/10 px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-500/40 text-white"
        >
          <option value="all">Todas categorias</option>
          {(categoriesQ.data ?? []).map((c) => (
            <option key={c.category_id} value={c.category_id}>
              {c.category_name}
            </option>
          ))}
        </select>
      </div>

      {streamsQ.isLoading ? (
        <div className="py-20 text-center text-sm text-muted-foreground">Carregando canais…</div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-card/40 backdrop-blur overflow-hidden flex-1 min-h-0 flex flex-col">
          {/* Hour ruler */}
          <div className="flex border-b border-white/10 bg-black/30">
            <div
              className="shrink-0 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-r border-white/10 flex items-center"
              style={{ width: CHANNEL_COL }}
            >
              Canal
            </div>
            <div className="overflow-x-auto flex-1" ref={timelineRef}>
              <div className="relative" style={{ width: timelineWidth, height: 32 }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0 border-l border-white/10 text-[11px] text-muted-foreground pl-1 pt-1"
                    style={{ left: (h - windowStart) * PX_PER_SEC, width: PX_PER_HOUR }}
                  >
                    {fmtHour(h)}
                  </div>
                ))}
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
                  style={{ left: nowOffsetPx }}
                />
              </div>
            </div>
          </div>

          {/* Rows */}
          <div className="flex max-h-[calc(100dvh-22rem)] overflow-y-auto">
            {/* Channel column */}
            <div className="shrink-0 border-r border-white/10 bg-black/20" style={{ width: CHANNEL_COL }}>
              {visibleChannels.map((s) => (
                <button
                  key={s.stream_id}
                  type="button"
                  ref={(el) => registerRow(s.stream_id, el)}
                  data-stream-id={s.stream_id}
                  onClick={() =>
                    navigate({
                      to: "/player/$type/$id",
                      params: { type: "live", id: String(s.stream_id) },
                      search: { name: s.name },
                    })
                  }
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5 transition-colors border-b border-white/5 outline-none focus-visible:bg-primary/10"
                  style={{ height: ROW_HEIGHT }}
                >
                  {s.stream_icon ? (
                    <img
                      src={s.stream_icon}
                      alt=""
                      loading="lazy"
                      className="size-10 rounded-md object-contain bg-white/5 shrink-0"
                      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                    />
                  ) : (
                    <div className="size-10 rounded-md bg-white/5 grid place-items-center shrink-0">
                      <Tv className="size-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{s.name}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">#{s.num}</div>
                  </div>
                </button>
              ))}
            </div>

            {/* Programs grid */}
            <div className="flex-1 overflow-x-auto" onScroll={(e) => syncScroll(e, timelineRef)}>
              <div style={{ width: timelineWidth }}>
                {visibleChannels.map((s, idx) => {
                  const epg = epgQueries[idx]?.data ?? [];
                  const loading = epgQueries[idx]?.isLoading;
                  return (
                    <div
                      key={s.stream_id}
                      className="relative border-b border-white/5"
                      style={{ height: ROW_HEIGHT, width: timelineWidth }}
                    >
                      {loading && (
                        <div className="absolute inset-2 rounded bg-white/[0.04] animate-pulse" />
                      )}
                      {epg.map((p) => (
                        <ProgramBlock
                          key={p.id}
                          p={p}
                          windowStart={windowStart}
                          windowEnd={windowEnd}
                          now={now}
                          onOpen={() =>
                            navigate({
                              to: "/player/$type/$id",
                              params: { type: "live", id: String(s.stream_id) },
                              search: { name: s.name },
                            })
                          }
                        />
                      ))}
                      <div
                        className="absolute top-0 bottom-0 w-px bg-red-500/70 pointer-events-none"
                        style={{ left: nowOffsetPx }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-white/10 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/5 disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" /> Canais anteriores
              </button>
              <span>
                Página {page + 1} de {totalPages} · {filteredChannels.length} canais
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/5 disabled:opacity-40"
              >
                Próximos canais <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
      </div>
    </PremiumChrome>
  );
}

function ProgramBlock({
  p,
  windowStart,
  windowEnd,
  now,
  onOpen,
}: {
  p: EpgListing;
  windowStart: number;
  windowEnd: number;
  now: number;
  onOpen: () => void;
}) {
  const start = Number(p.start_timestamp);
  const stop = Number(p.stop_timestamp);
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return null;
  if (stop <= windowStart || start >= windowEnd) return null;

  const clampedStart = Math.max(start, windowStart);
  const clampedStop = Math.min(stop, windowEnd);
  const left = (clampedStart - windowStart) * PX_PER_SEC;
  const width = (clampedStop - clampedStart) * PX_PER_SEC;
  const isNow = now >= start && now < stop;
  const isPast = stop <= now;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${p.title}\n${fmtHour(start)} – ${fmtHour(stop)}${p.description ? "\n\n" + p.description : ""}`}
      className={`absolute top-1 bottom-1 rounded-md px-2 text-left text-xs leading-tight overflow-hidden transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        isNow
          ? "bg-primary/30 border border-primary text-foreground hover:bg-primary/40"
          : isPast
            ? "bg-white/[0.03] border border-white/5 text-muted-foreground/70"
            : "bg-white/[0.07] border border-white/10 text-foreground/90 hover:bg-white/[0.12]"
      }`}
      style={{ left, width: Math.max(width, 2) }}
    >
      <div className="font-semibold truncate">{p.title}</div>
      <div className="text-[10px] opacity-80">
        {fmtHour(start)}–{fmtHour(stop)}
      </div>
    </button>
  );
}

function fmtHour(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Keep the hour ruler scroll in sync with the program grid scroll
function syncScroll(
  e: React.UIEvent<HTMLDivElement>,
  ref: React.RefObject<HTMLDivElement | null>,
) {
  if (ref.current) ref.current.scrollLeft = e.currentTarget.scrollLeft;
}
