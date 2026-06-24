// In-app overlay shown when a LIVE channel fails (APK Android sem F12).
// Render-only. Sem dependência de console, sem alterar layout do player.

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ClipboardCopy, Check, X } from "lucide-react";
import {
  liveDiagFormat, copyToClipboard, type LiveDiagSession,
} from "@/lib/live-diag-store";

export function LiveDiagPanel({
  session, open, onClose,
}: { session: LiveDiagSession | null; open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (!open) setCopied(false); }, [open]);

  const doCopy = async () => {
    if (!session) return;
    const ok = await copyToClipboard(liveDiagFormat(session));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl bg-black text-white border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Diagnóstico LIVE
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Falha ao reproduzir este canal. Os dados abaixo ajudam a identificar o motivo
            (status HTTP, content-type, player que falhou, erro do video element/HLS/mpegts).
          </DialogDescription>
        </DialogHeader>

        {session ? (
          <pre className="max-h-[55dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] leading-relaxed text-white/85">
            {liveDiagFormat(session)}
          </pre>
        ) : (
          <div className="text-sm text-white/60">Sem dados de sessão.</div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} className="gap-2">
            <X className="size-4" /> Fechar
          </Button>
          <Button onClick={doCopy} disabled={!session} className="gap-2">
            {copied ? <><Check className="size-4" /> Copiado</> : <><ClipboardCopy className="size-4" /> Copiar diagnóstico</>}
          </Button>
        </div>
        <p className="text-[10px] text-white/40">
          Também disponível em Configurações → Diagnóstico IPTV (últimas 50 sessões).
        </p>
      </DialogContent>
    </Dialog>
  );
}
