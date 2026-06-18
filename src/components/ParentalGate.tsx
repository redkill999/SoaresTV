import { useState } from "react";
import { store } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

export function ParentalGate({
  categoryId,
  onUnlock,
}: {
  categoryId: string;
  onUnlock: () => void;
}) {
  const p = store.getParental();
  const locked = p.pin && p.lockedCategories.includes(categoryId);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  if (!locked) {
    onUnlock();
    return null;
  }

  return (
    <div className="flex items-center justify-center py-20">
      <div className="glass rounded-2xl p-8 max-w-sm w-full text-center">
        <Lock className="size-10 mx-auto mb-3 text-primary" />
        <h2 className="text-xl font-bold mb-1">Conteúdo bloqueado</h2>
        <p className="text-sm text-muted-foreground mb-5">Digite o PIN para continuar.</p>
        <Input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="text-center text-lg tracking-widest mb-2 bg-white/5 border-white/10"
          maxLength={6}
        />
        {err && <p className="text-xs text-destructive mb-2">{err}</p>}
        <Button
          className="w-full bg-brand-gradient"
          onClick={() => {
            if (pin === p.pin) onUnlock();
            else setErr("PIN incorreto");
          }}
        >
          Desbloquear
        </Button>
      </div>
    </div>
  );
}
