import { useMemo, useRef, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tv, Film, Clapperboard, Search } from "lucide-react";
import { store, miniPlayerStore, type XtreamCreds } from "@/lib/storage";
import {
  api,
  xtreamCredsFromUrl,
  type LiveStream,
  type VodStream,
  type Series,
} from "@/lib/xtream";
import { withPersist, loadPersisted } from "@/lib/query-persist";
import { filterBySearch } from "@/lib/search-index";
import { getLockedIdSet } from "@/lib/parental";

const MAX_PER_SECTION = 5;
const MIN_QUERY = 2;

function getCreds(): XtreamCreds | null {
  const saved = store.getCreds();
  if (saved) return saved;
  const firstList = store.getM3U()[0];
  return firstList ? xtreamCredsFromUrl(firstList.url, firstList.username, firstList.password) : null;
}

type Result =
  | { kind: "live"; id: string; name: string; logo?: string; url?: string }
  | { kind: "movie"; id: string; name: string; logo?: string }
  | { kind: "series"; id: string; name: string; logo?: string };

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef("");
  const [q, setQ] = useState("");
  queryRef.current = q;

  const creds = useMemo(() => (open ? getCreds() : null), [open]);
  const acct = creds ? `${creds.server}|${creds.username}` : "";

  const liveKey = `live-streams:${acct}:all`;
  const vodKey = `vod-list:${acct}:all`;
  const seriesKey = `series-list:${acct}:all`;
  const livePersisted = useMemo(() => (acct ? loadPersisted<LiveStream[]>(liveKey) : null), [liveKey, acct]);
  const liveInitialData = livePersisted?.data?.some((s) => !!s.url) ? livePersisted.data : undefined;
  const vodPersisted = useMemo(() => (acct ? loadPersisted<VodStream[]>(vodKey) : null), [vodKey, acct]);
  const seriesPersisted = useMemo(() => (acct ? loadPersisted<Series[]>(seriesKey) : null), [seriesKey, acct]);

  const liveQ = useQuery({
    queryKey: ["live-streams", acct, "all"],
    enabled: open && !!creds,
    queryFn: withPersist(liveKey, () => api<LiveStream[]>(creds!, "get_live_streams")),
    initialData: liveInitialData,
    initialDataUpdatedAt: liveInitialData ? livePersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
  });
  const vodQ = useQuery({
    queryKey: ["vod-list", acct, "all"],
    enabled: open && !!creds,
    queryFn: withPersist(vodKey, () => api<VodStream[]>(creds!, "get_vod_streams")),
    initialData: vodPersisted?.data,
    initialDataUpdatedAt: vodPersisted?.updatedAt,
    staleTime: 10 * 60_000,
  });
  const seriesQ = useQuery({
    queryKey: ["series-list", acct, "all"],
    enabled: open && !!creds,
    queryFn: withPersist(seriesKey, () => api<Series[]>(creds!, "get_series")),
    initialData: seriesPersisted?.data,
    initialDataUpdatedAt: seriesPersisted?.updatedAt,
    staleTime: 10 * 60_000,
  });

  const trimmed = q.trim();
  const enabled = trimmed.length >= MIN_QUERY;

  const lockedLive = useMemo(() => (open ? getLockedIdSet("live") : new Set<string>()), [open]);
  const lockedMovie = useMemo(() => (open ? getLockedIdSet("movie") : new Set<string>()), [open]);
  const lockedSeries = useMemo(() => (open ? getLockedIdSet("series") : new Set<string>()), [open]);

  const liveResults: Result[] = useMemo(() => {
    if (!enabled || !liveQ.data) return [];
    return filterBySearch(liveQ.data, (s) => s.name, trimmed)
      .filter((s) => !lockedLive.has(String(s.stream_id)))
      .slice(0, MAX_PER_SECTION)
      .map((s) => ({ kind: "live", id: String(s.stream_id), name: s.name, logo: s.stream_icon, url: s.url }));
  }, [enabled, liveQ.data, trimmed, lockedLive]);

  const movieResults: Result[] = useMemo(() => {
    if (!enabled || !vodQ.data) return [];
    return filterBySearch(vodQ.data, (s) => s.name, trimmed)
      .filter((s) => !lockedMovie.has(String(s.stream_id)))
      .slice(0, MAX_PER_SECTION)
      .map((s) => ({ kind: "movie", id: String(s.stream_id), name: s.name, logo: s.stream_icon }));
  }, [enabled, vodQ.data, trimmed, lockedMovie]);

  const seriesResults: Result[] = useMemo(() => {
    if (!enabled || !seriesQ.data) return [];
    return filterBySearch(seriesQ.data, (s) => s.name, trimmed)
      .filter((s) => !lockedSeries.has(String(s.series_id)))
      .slice(0, MAX_PER_SECTION)
      .map((s) => ({ kind: "series", id: String(s.series_id), name: s.name, logo: s.cover }));
  }, [enabled, seriesQ.data, trimmed, lockedSeries]);

  const flat = useMemo(
    () => [...liveResults, ...movieResults, ...seriesResults],
    [liveResults, movieResults, seriesResults],
  );

  // Reset query ao fechar; foco ao abrir.
  useEffect(() => {
    if (!open) {
      setQ("");
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const handleSelect = (r: Result) => {
    onOpenChange(false);
    if (r.kind === "live") {
      miniPlayerStore.set({ streamId: r.id, name: r.name, logo: r.logo, src: r.url });
      void navigate({
        to: "/player/$type/$id",
        params: { type: "live", id: r.id },
        search: r.url ? { name: r.name, src: r.url } : { name: r.name },
      });
    } else if (r.kind === "movie") {
      void navigate({ to: "/player/$type/$id", params: { type: "movie", id: r.id }, search: { name: r.name } });
    } else {
      void navigate({ to: "/player/$type/$id", params: { type: "series", id: r.id }, search: { name: r.name } });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && flat.length > 0) {
      e.preventDefault();
      handleSelect(flat[0]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Busca global</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar canais, filmes e séries…"
            className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-9 px-0 text-sm"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!creds && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Faça login ou adicione uma lista para pesquisar no catálogo.
            </div>
          )}
          {creds && !enabled && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Digite pelo menos {MIN_QUERY} caracteres para buscar.
            </div>
          )}
          {creds && enabled && flat.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Nenhum resultado para "{trimmed}".
            </div>
          )}
          {creds && (
            <>
              <Section title="Ao Vivo" icon={Tv} results={liveResults} onSelect={handleSelect} />
              <Section title="Filmes" icon={Film} results={movieResults} onSelect={handleSelect} />
              <Section title="Séries" icon={Clapperboard} results={seriesResults} onSelect={handleSelect} />
            </>
          )}
        </div>
        <div className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground flex justify-between">
          <span>Enter para abrir o primeiro</span>
          <span>Esc para fechar</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  icon: Icon,
  results,
  onSelect,
}: {
  title: string;
  icon: typeof Tv;
  results: Result[];
  onSelect: (r: Result) => void;
}) {
  if (results.length === 0) return null;
  return (
    <div className="mb-1">
      <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Icon className="size-3" />
        {title}
      </div>
      <ul>
        {results.map((r) => (
          <li key={`${r.kind}:${r.id}`}>
            <button
              type="button"
              onClick={() => onSelect(r)}
              className="w-full flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-white/5 text-left transition-colors"
            >
              <Thumb logo={r.logo} icon={Icon} />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm">{r.name}</div>
                <div className="text-[10px] text-muted-foreground">{title}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thumb({ logo, icon: Icon }: { logo?: string; icon: typeof Tv }) {
  const [err, setErr] = useState(false);
  if (!logo || err) {
    return (
      <div className="size-9 rounded bg-white/5 grid place-items-center shrink-0">
        <Icon className="size-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={logo}
      alt=""
      onError={() => setErr(true)}
      className="size-9 rounded object-cover bg-white/5 shrink-0"
      loading="lazy"
    />
  );
}

