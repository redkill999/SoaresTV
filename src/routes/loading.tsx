import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { store } from "@/lib/storage";
import { api, loadM3U } from "@/lib/xtream";
import bgAsset from "@/assets/loading-bg.png.asset.json";

export const Route = createFileRoute("/loading")({
  head: () => ({ meta: [{ title: "Carregando — SoaresTV" }] }),
  component: LoadingPage,
});

type Status = "pending" | "ok" | "fail";
type TestKey = "live" | "vod" | "series" | "epg";

// Posições (em % do canvas 16:9) dos rótulos de status logo abaixo do título
// dentro de cada card desenhado na imagem de fundo.
const CARD_POS: Record<TestKey, { left: string; top: string; width: string }> = {
  live:   { left: "7.2%",  top: "36.0%", width: "16%" },
  vod:    { left: "30.2%", top: "36.0%", width: "16%" },
  series: { left: "53.1%", top: "36.0%", width: "16%" },
  epg:    { left: "76.5%", top: "36.0%", width: "16%" },
};

function LoadingPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Record<TestKey, Status>>({
    live: "pending", vod: "pending", series: "pending", epg: "pending",
  });
  const ran = useRef(false);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevH = html.style.background;
    const prevB = body.style.background;
    html.style.background = "#000";
    body.style.background = "#000";
    return () => { html.style.background = prevH; body.style.background = prevB; };
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const creds = store.getCreds();
    const lists = store.getM3U();

    if (!creds && lists.length === 0) {
      navigate({ to: "/", replace: true });
      return;
    }

    const set = (k: TestKey, s: Status) => setStatus((p) => ({ ...p, [k]: s }));

    const runXtream = async () => {
      if (!creds) return false;
      const tests: { k: TestKey; action: string }[] = [
        { k: "live",   action: "get_live_categories" },
        { k: "vod",    action: "get_vod_categories" },
        { k: "series", action: "get_series_categories" },
        { k: "epg",    action: "get_live_streams" },
      ];
      await Promise.all(tests.map(async (t) => {
        try {
          const data = await api<unknown[]>(creds, t.action);
          set(t.k, Array.isArray(data) ? "ok" : "fail");
        } catch {
          set(t.k, "fail");
        }
      }));
      return true;
    };

    const runM3U = async () => {
      const first = lists[0];
      if (!first) return false;
      try {
        const entries = await loadM3U(first.url, first.username, first.password);
        const groups = entries.map((e) => (e.group || "").toLowerCase());
        const hasLive   = entries.some((e) => !/movie|filme|serie|série|vod/i.test(e.group || ""));
        const hasVod    = groups.some((g) => /movie|filme|vod/.test(g));
        const hasSeries = groups.some((g) => /serie|série/.test(g));
        set("live",   hasLive   || entries.length > 0 ? "ok" : "fail"); await wait(200);
        set("vod",    hasVod    ? "ok" : "fail"); await wait(200);
        set("series", hasSeries ? "ok" : "fail"); await wait(200);
        set("epg",    entries.length > 0 ? "ok" : "fail");
      } catch {
        set("live", "fail"); set("vod", "fail"); set("series", "fail"); set("epg", "fail");
      }
      return true;
    };

    (async () => {
      if (creds) await runXtream();
      else await runM3U();
      await wait(700);
      setStatus((p) => {
        const allOk = (Object.keys(p) as TestKey[]).every((k) => p[k] === "ok");
        if (allOk) navigate({ to: "/home", replace: true });
        return p;
      });
    })();
  }, [navigate]);

  const anyFail = (Object.keys(status) as TestKey[]).some((k) => status[k] === "fail");
  const anyPending = (Object.keys(status) as TestKey[]).some((k) => status[k] === "pending");
  const finishedWithFailure = !anyPending && anyFail;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black overflow-hidden">
      {/* Caixa 16:9 que preserva a proporção da imagem para que os overlays caiam exatos sobre os cards */}
      <div
        className="relative"
        style={{
          aspectRatio: "16 / 9",
          width: "min(100vw, calc(100vh * 16 / 9))",
          height: "min(100vh, calc(100vw * 9 / 16))",
          backgroundImage: `url(${bgAsset.url})`,
          backgroundSize: "100% 100%",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          containerType: "size",
        } as React.CSSProperties}
      >
        {/* Rótulos de status sobre os 4 cards do fundo */}
        {(Object.keys(CARD_POS) as TestKey[]).map((k) => (
          <StatusLabel key={k} pos={CARD_POS[k]} status={status[k]} />
        ))}

        {/* Mensagem de erro (sobre a faixa do rodapé) quando tudo falhar */}
        {finishedWithFailure && (
          <div
            className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-3"
            style={{ top: "82%", width: "90%" }}
          >
            <div className="text-base sm:text-lg text-red-300 font-semibold text-center drop-shadow">
              Falha ao carregar a lista. Verifique sua conexão ou os dados de acesso.
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => {
                  ran.current = false;
                  setStatus({ live: "pending", vod: "pending", series: "pending", epg: "pending" });
                  window.location.reload();
                }}
                className="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold"
              >
                Tentar novamente
              </button>
              <button
                onClick={() => {
                  try { window.localStorage.clear(); } catch { /* noop */ }
                  try { window.sessionStorage.clear(); } catch { /* noop */ }
                  window.location.replace("/?reset=1");
                }}
                className="px-4 py-2 rounded-md bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
              >
                Voltar ao login
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusLabel({
  pos,
  status,
}: {
  pos: { left: string; top: string; width: string };
  status: Status;
}) {
  const label =
    status === "pending" ? "Esperando..." :
    status === "ok"      ? "SUCESSO!" :
                            "FALHOU!";
  const color =
    status === "pending" ? "text-cyan-200" :
    status === "ok"      ? "text-emerald-300" :
                            "text-red-400";
  return (
    <div
      className={`absolute text-center font-semibold tracking-wide ${color}`}
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        fontSize: "clamp(11px, 1.6cqi, 22px)",
        textShadow: "0 1px 2px rgba(0,0,0,0.6)",
      }}
    >
      {label}
    </div>
  );
}

function wait(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
