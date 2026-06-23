import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { store } from "@/lib/storage";
import { api, loadM3U } from "@/lib/xtream";
import homeBg from "@/assets/loading-bg.png.asset.json";

export const Route = createFileRoute("/loading")({
  head: () => ({ meta: [{ title: "Carregando — SoaresTV" }] }),
  component: LoadingPage,
});

type Status = "pending" | "ok" | "fail";
type TestKey = "live" | "vod" | "series" | "epg";

const LABELS: Record<TestKey, string> = {
  live:   "TV AO VIVO",
  vod:    "VOD",
  series: "SÉRIES",
  epg:    "GUIA DA TV",
};

function LoadingPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Record<TestKey, Status>>({
    live: "pending", vod: "pending", series: "pending", epg: "pending",
  });
  const ran = useRef(false);

  // Mantém o letterbox preto; a imagem é renderizada apenas uma vez no container abaixo.
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
      for (const t of tests) {
        try {
          const data = await api<unknown[]>(creds, t.action);
          set(t.k, Array.isArray(data) ? "ok" : "fail");
        } catch {
          set(t.k, "fail");
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return true;
    };

    const runM3U = async () => {
      const first = lists[0];
      if (!first) return false;
      try {
        const entries = await loadM3U(first.url, first.username, first.password);
        // M3U não distingue por tipo de forma estrita — marcamos pelos grupos.
        const groups = entries.map((e) => (e.group || "").toLowerCase());
        const hasLive   = entries.some((e) => !/movie|filme|serie|série|vod/i.test(e.group || ""));
        const hasVod    = groups.some((g) => /movie|filme|vod/.test(g));
        const hasSeries = groups.some((g) => /serie|série/.test(g));
        set("live",   hasLive   || entries.length > 0 ? "ok" : "fail");
        await wait(200);
        set("vod",    hasVod    ? "ok" : "fail");
        await wait(200);
        set("series", hasSeries ? "ok" : "fail");
        await wait(200);
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
      // Só avança para /home se TODOS os testes passarem.
      // Se qualquer um falhar, mantém o usuário aqui com botões de ação.
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
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#082968] text-white">
      {/* Fundo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${homeBg.url})` }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/35" />

      {/* Header */}
      <div className="relative z-10 mx-auto mt-6 w-[94%] max-w-5xl rounded-md bg-gradient-to-b from-white/85 to-white/70 px-4 py-3 text-center">
        <div className="text-base sm:text-xl tracking-wide text-slate-700/90">
          Atualizar Conteúdos de Mídia
        </div>
      </div>

      {/* Grid de testes */}
      <div className="relative z-10 mx-auto mt-2 grid w-[94%] max-w-5xl grid-cols-2 gap-[2px] sm:grid-cols-4">
        {(Object.keys(LABELS) as TestKey[]).map((k) => (
          <TestCell key={k} title={LABELS[k]} status={status[k]} />
        ))}
      </div>


      {/* Spinner + mensagem */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center text-center px-4">
        {!finishedWithFailure ? (
          <>
            <Loader2 className="size-8 text-emerald-400 animate-spin" strokeWidth={2.2} />
            <div className="mt-4 text-lg sm:text-xl text-white/90">
              Por favor, aguarde........
            </div>
          </>
        ) : (
          <>
            <div className="text-lg sm:text-xl text-red-300 font-semibold">
              Falha ao carregar a lista. Verifique sua conexão ou os dados de acesso.
            </div>
            <div className="mt-2 text-sm text-white/70">
              Não vamos abrir o app enquanto algum conteúdo essencial estiver com falha.
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => { ran.current = false; setStatus({ live: "pending", vod: "pending", series: "pending", epg: "pending" }); window.location.reload(); }}
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
          </>
        )}
      </div>

      {/* Faixa rodapé */}
      <div className="relative z-10 mx-auto mb-4 w-[94%] max-w-5xl rounded-md border border-cyan-300/40 bg-teal-600/40 px-4 py-3 text-center tracking-[0.25em] text-white/80">
        POR FAVOR, AGUARDE........
      </div>
    </div>
  );
}

function TestCell({ title, status }: { title: string; status: Status }) {
  const label =
    status === "pending" ? "Esperando..." :
    status === "ok"      ? "SUCESSO!" :
                            "FALHOU!";
  const color =
    status === "pending" ? "text-white/80" :
    status === "ok"      ? "text-emerald-300" :
                            "text-red-400";
  return (
    <div className="bg-[#0a1430]/90 px-3 py-3 text-center">
      <div className="text-xs sm:text-sm font-semibold tracking-wider text-white">{title}</div>
      <div className={`mt-1.5 text-sm sm:text-base ${color}`}>{label}</div>
    </div>
  );
}

function wait(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
