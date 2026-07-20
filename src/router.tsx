import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RouteErrorState } from "./components/RouteErrorState";


const queryClientOptions = {
  defaultOptions: {
    queries: {
      // Cache agressivo: troca de abas usa dados em cache (instantâneo)
      // e revalida em background.
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
} as const;

// Singleton no cliente (preserva cache entre HMRs / chamadas duplicadas);
// no servidor, sempre cria uma nova instância por requisição.
let browserQueryClient: QueryClient | undefined;
function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return new QueryClient(queryClientOptions);
  if (!browserQueryClient) browserQueryClient = new QueryClient(queryClientOptions);
  return browserQueryClient;
}

export const getRouter = () => {
  const queryClient = getQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload the route module/chunk on hover/focus
    defaultPreload: "intent",
    // Reaproveita cache de rota já carregada: se a rota foi visitada nos
    // últimos 5 min, navegar volta instantâneo (sem refetch bloqueante).
    // Combina com staleTime dos useQuery (10 min) — revalidação silenciosa.
    defaultPreloadStaleTime: 5 * 60_000,
    // Mantém dados de rota em memória por 30 min mesmo sem visitantes,
    // então voltar para /live após passar por /movies e /series é imediato.
    defaultGcTime: 30 * 60_000,
    defaultErrorComponent: ({ error, reset }) => (
      <RouteErrorState error={error as Error} reset={reset} />
    ),
  });


  return router;
};
