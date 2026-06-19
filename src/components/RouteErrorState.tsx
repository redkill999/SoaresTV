import { Link, useRouter } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, LogIn } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export function RouteErrorState({ error, reset }: { error: Error; reset?: () => void }) {
  const router = useRouter();
  const msg = error?.message || "Algo deu errado.";
  const isAuth = /credenciais|bloqueada|401|403|inválid/i.test(msg);

  return (
    <AppShell>
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-7" />
        </div>
        <h1 className="font-display text-2xl font-bold">
          {isAuth ? "Sessão expirada" : "Não foi possível carregar"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{msg}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              reset?.();
              void router.invalidate();
            }}
          >
            <RefreshCw className="size-4" /> Tentar novamente
          </Button>
          {isAuth ? (
            <Button asChild>
              <Link to="/">
                <LogIn className="size-4" /> Entrar novamente
              </Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link to="/home">Voltar ao início</Link>
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
