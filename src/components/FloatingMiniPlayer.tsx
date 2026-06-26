import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { MiniLivePlayer } from "@/components/MiniLivePlayer";
import { useMiniPlayer } from "@/hooks/use-mini-player";
import { store, type XtreamCreds } from "@/lib/storage";
import { xtreamCredsFromUrl } from "@/lib/xtream";

const HIDDEN_PREFIXES = ["/loading", "/home", "/player"];
const HIDDEN_EXACT = new Set<string>(["/"]);

export function FloatingMiniPlayer() {
  const { state, clear } = useMiniPlayer();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = store.getCreds();
    if (saved) { setCreds(saved); return; }
    const first = store.getM3U()[0];
    const rec = first ? xtreamCredsFromUrl(first.url, first.username, first.password) : null;
    if (rec) setCreds(rec);
  }, [state?.streamId]);

  // Marca o <video> interno para que o hotspot "Multitela" do home consiga
  // chamar requestPictureInPicture nele via document.querySelector.
  useEffect(() => {
    if (!state) return;
    const id = window.setInterval(() => {
      const v = wrapRef.current?.querySelector("video");
      if (v && !v.hasAttribute("data-mini-video")) {
        v.setAttribute("data-mini-video", "true");
      }
    }, 300);
    return () => window.clearInterval(id);
  }, [state?.streamId]);

  if (!state) return null;
  const hidden =
    HIDDEN_EXACT.has(pathname) ||
    HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (hidden) return null;

  return (
    <div
      className="fixed z-50 bottom-16 right-3 sm:bottom-4 sm:right-4 w-56 sm:w-72 transition-all duration-300 translate-y-0 opacity-100"
    >
      <div className="relative rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-black">
        <button
          type="button"
          onClick={clear}
          aria-label="Fechar mini player"
          className="absolute top-1.5 right-1.5 z-10 size-7 rounded-full bg-black/70 hover:bg-black/90 text-white grid place-items-center"
        >
          <X className="size-4" />
        </button>
        <MiniLivePlayer
          creds={creds}
          streamId={state.streamId}
          name={state.name}
          logo={state.logo}
        />
      </div>
    </div>
  );
}
