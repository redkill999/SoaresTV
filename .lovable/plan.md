## Recuperação cirúrgica do app (LIVE/MOVIES/SERIES)

Estado atual: LIVE funciona. VOD (filmes/séries) falha. O proxy `src/routes/api/stream.ts` (1228 linhas) e o `VideoPlayer.tsx` (2264 linhas) acumularam camadas experimentais (probe, debug overlay, platform badge, audit, fast-path, redirect manual com matriz de UA × cookies × Referer/Origin × Range × retry). Esse acoplamento é a causa raiz das regressões.

Antes de executar, preciso confirmar o escopo da reversão porque uma reescrita errada do `VideoPlayer` derruba os canais que estão funcionando hoje.

### Fase 1 — Remoção do código de diagnóstico (sem risco para LIVE)

Apagar imports/usos e arquivos:
- `src/components/PlatformBadge.tsx` (+ remover de `__root.tsx`)
- `src/components/VodDebugOverlay.tsx` (+ remover de `VideoPlayer.tsx`)
- `src/components/VodDiagPanel.tsx`, `src/components/LiveDiagPanel.tsx` (+ remover da página `settings.tsx`)
- `src/lib/vod-diag-store.ts`, `src/lib/live-diag-store.ts`, `src/lib/live-debug.ts`
- `src/lib/vod-platform-log.ts`, `src/lib/audit-trace.ts`, `src/lib/platform-flags.ts`
- Logs `[VOD AUDIT]`, `[VOD WEB]`, `[VOD ANDROID]`, `plog`, `probeLiveStream`, `assertPlatform`

### Fase 2 — Simplificação do proxy `src/routes/api/stream.ts`

Reduzir para responsabilidade única:
- LIVE: mantém o caminho atual que funciona (rewrite de HLS + ciclo curto de UA).
- VOD: **apenas fast-path** — um `fetch` por UA (lista curta de 4), `redirect: "follow"`, repasse de `Range` do cliente, repasse direto de status/headers do upstream.
- Remover: `debugJsonResponse`, `normalizeVodFailureResponse`, `redirect=peek`, `probe=1`, `finalRedirectHeaderPlans`, ciclo Referer/Origin/Cookie, `sliceReadableStream`, classificações `redirected-cdn-404-html`, headers `X-Upstream-*` e `X-Debug-*`.
- Erros sempre como JSON `{error, status}` (nunca HTML).

### Fase 3 — Limpeza do `VideoPlayer.tsx`

Manter intacto o fluxo LIVE (memória do projeto: "fazer ajuste cirúrgico"). Cortar apenas:
- Remoção do `<VodDebugOverlay/>` e seus estados.
- Remoção de `assertPlatform`, `plog`, `[VOD AUDIT]`, `probeLiveStream`, `vod-diag-store`, `live-diag-store`.
- Para VOD: lista de candidatos volta a ser `[workingSrc, ...fallbackSrcs]` (já está assim após último ajuste) — sem multiplicar extensões, sem `vodRedirectDirectCache`, sem `deadBases`, sem peek.
- `host-profile.ts`: manter (LIVE depende dele).
- `playback-engine.ts`: manter (LIVE usa `decideEngineOrder`).

### Fase 4 — Validação

Após cada fase rodar typecheck. Pedir ao usuário para validar 1 canal + 1 filme + 1 episódio no preview e APK.

### Risco

A reescrita de `VideoPlayer.tsx` (2264 linhas) tem risco real de quebrar LIVE. Por isso a Fase 3 é **subtractiva** — só removo imports/blocos de diagnóstico, sem reescrever a lógica de seleção de player.

### Pergunta antes de executar

Confirma que posso:
1. Apagar os arquivos listados na Fase 1 (não há outra dependência além de `settings.tsx` e `__root.tsx`).
2. Reescrever `api/stream.ts` mantendo só LIVE-rewrite + VOD fast-path (sem `probe`, sem `peek`, sem `X-Upstream-*`).
3. Remover do `VideoPlayer.tsx` apenas os blocos de diagnóstico, **sem mexer** na ordem de players, host-profile, ou recuperação de stall (que LIVE usa).
