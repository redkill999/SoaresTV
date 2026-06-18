import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { store, type M3UPlaylist, type ParentalConfig } from "@/lib/storage";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Ajustes — SoaresTV" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  const [lists, setLists] = useState<M3UPlaylist[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [parental, setParental] = useState<ParentalConfig>({ pin: null, lockedCategories: [] });
  const [pin, setPin] = useState("");

  useEffect(() => {
    setLists(store.getM3U());
    setParental(store.getParental());
  }, []);

  const addList = () => {
    if (!name || !url) return;
    const next = [...lists, { name, url }];
    store.setM3U(next);
    setLists(next);
    setName("");
    setUrl("");
    toast.success("Lista M3U adicionada");
  };

  const removeList = (i: number) => {
    const next = lists.filter((_, idx) => idx !== i);
    store.setM3U(next);
    setLists(next);
  };

  const savePin = () => {
    const next = { ...parental, pin: pin || null };
    store.setParental(next);
    setParental(next);
    setPin("");
    toast.success(pin ? "PIN definido" : "PIN removido");
  };

  return (
    <AppShell>
      <Toaster theme="dark" />
      <h1 className="text-2xl font-bold mb-6">{t("pages.settings.title")}</h1>

      <section className="glass rounded-2xl p-6 mb-6">
        <h2 className="font-semibold mb-1">Listas M3U</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Adicione listas M3U/M3U8 para complementar seu Xtream.
        </p>

        <div className="grid sm:grid-cols-[1fr_2fr_auto] gap-2 mb-4">
          <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} className="bg-white/5 border-white/10" />
          <Input placeholder="URL .m3u" value={url} onChange={(e) => setUrl(e.target.value)} className="bg-white/5 border-white/10" />
          <Button onClick={addList} className="bg-brand-gradient">
            <Plus className="size-4" /> Adicionar
          </Button>
        </div>

        <div className="space-y-2">
          {lists.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma lista.</p>}
          {lists.map((l, i) => (
            <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{l.name}</div>
                <div className="text-xs text-muted-foreground truncate max-w-[60vw]">{l.url}</div>
              </div>
              <button onClick={() => removeList(i)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="glass rounded-2xl p-6 mb-6">
        <h2 className="font-semibold mb-1">Controle parental</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Defina um PIN para bloquear categorias. {parental.pin ? "PIN definido." : "Nenhum PIN."}
        </p>
        <div className="flex gap-2 max-w-sm">
          <Input
            type="password"
            inputMode="numeric"
            placeholder="Novo PIN (vazio = remover)"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={6}
            className="bg-white/5 border-white/10"
          />
          <Button onClick={savePin} className="bg-brand-gradient">
            Salvar
          </Button>
        </div>
      </section>

      <section className="glass rounded-2xl p-6">
        <h2 className="font-semibold mb-1">Sobre</h2>
        <p className="text-sm text-muted-foreground">
          SoaresTV — IPTV web player. Dados armazenados localmente no seu navegador.
        </p>
      </section>
    </AppShell>
  );
}
