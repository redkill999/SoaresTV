// In-app overlay shown when VOD (filmes/séries) fails.
// Render-only. Não altera a lógica do player.

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ClipboardCopy, Check, X } from "lucide-react";
import { copyToClipboard } from "@/lib/live-diag-store";
import { vodDiagFormat, type VodDiagSession } from "@/lib/vod-diag-store";

export function VodDiagPanel({
  session, open, onClose,
}: { session: VodDiagSession | null; open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (!open) setCopied(false); }, [open]);

  const doCopy = async () => {
    if (!session) return;
    const ok = await copyToClipboard(vodDiagFormat(session));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl bg-black text-white border-white/10">
        <DialogHeader>
          <DialogTitle>Diagnóstico VOD</DialogTitle>
          <DialogDescription className="text-white/60">
            Falha ao reproduzir filme/série. O relatório mostra URL original/final,
            status HTTP, content-type, User-Agent, player usado e erro retornado.
          </DialogDescription>
        </DialogHeader>

        {session ? (
          <pre className="max-h-[55dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] leading-relaxed text-white/85">
            {vodDiagFormat(session)}
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
          Também disponível em Configurações → Diagnóstico IPTV → VOD.
        </p>
      </DialogContent>
    </Dialog>
  );
}