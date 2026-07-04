
## Escopo

Onze frentes de correção pedidas. Vou entregar em 5 blocos que respeitam as dependências e permitem validação incremental.

---

## Bloco A — Versionamento e diagnóstico de qual build o APK executa

Como o APK aponta `server.url` para `tv-magica-brasa-soarestv.lovable.app`, testes só valem depois de publicar. Sem um build id visível não há como o usuário confirmar.

1. Criar `src/lib/app-build.ts` exportando `APP_BUILD_ID = "2026.07.04-live-v3"` e `BUILT_AT`.
2. Gerar `public/app-version.json` no `prebuild` (script Node) com `{ buildId, builtAt }`.
3. Setar `document.documentElement.dataset.appBuild = APP_BUILD_ID` no boot (`src/start.ts` ou `__root.tsx`).
4. Mostrar `APP_BUILD_ID` em `src/routes/settings.tsx` (seção "Sobre") e no relatório de diagnóstico.
5. Diagnóstico de boot (sem credenciais): `{ buildId, native, deviceType, pathname }`.
6. No APK: fetch `/app-version.json` e comparar com `APP_BUILD_ID` embutido; toast quando divergir ("Site publicado está desatualizado — republique no Lovable").
7. Atualizar `GERAR-APK.bat` com aviso: "APK usa server.url — publicar no Lovable antes de testar".
8. `android-template/MainActivity.java`: ler `versionCode`, comparar com SharedPreferences; se mudou → `webView.clearCache(true)` uma vez.

---

## Bloco B — Corrigir Live: remover merge M3U síncrono e estado de loading

Causa raiz do skeleton infinito: `api("get_live_streams", { category_id })` passa por `maybePreserveLiveUrls` → `loadSavedM3UEntriesForCreds` que pode baixar/parsear M3U inteira.

1. `src/lib/xtream.ts`:
   - Adicionar `getAlreadyLoadedM3UEntriesSync(creds)` que lê SOMENTE cache em memória (Map módulo-scope populado quando o usuário abre a lista M3U em Configurações). Nunca fetch/IDB/parse.
   - Reescrever `maybePreserveLiveUrls` para usar apenas o cache sync. Se vazio → devolve resposta Xtream original imediatamente.
   - Expor flag de diagnóstico `m3uMergeTriggered` (WeakMap por resposta).
2. `src/routes/live.tsx`:
   - `activeQ` já existe; adicionar timeout de 15s por categoria — ao estourar, encerra skeleton e mostra erro com "Tentar novamente" / "Selecionar outra categoria".
   - `showSkeleton` já é derivado; garantir que erro nunca fica preso em skeleton.
3. Testes em `src/lib/__tests__/xtream-live.test.ts`:
   - `get_live_streams` com `category_id` não chama `loadM3U`.
   - `maybePreserveLiveUrls` sem cache retorna array intacto sem I/O.

---

## Bloco C — Aplicar por-categoria em Filmes e Séries (mesmo padrão de Live)

1. `src/routes/movies.tsx` e `src/routes/series.tsx`:
   - No `loader`, se `isNative()` → NÃO prefetch da lista global; só `get_vod_categories` / `get_series_categories`.
   - Auto-select primeira categoria válida (ref idempotente por conta).
   - Per-category query com chaves:
     - `vod-list:v2:xtream:{acct}:category:{catId}`
     - `series-list:v2:xtream:{acct}:category:{catId}`
   - Contadores persistidos por categoria em `vod-counts:v1:xtream:{acct}` / `series-counts:v1:...`
   - "Todas" no APK: opt-in explícito com mesmo modal de aviso de Live.
2. Reutilizar helpers `iptvLog`/`timed` e `withPersist`/`loadPersisted`.

---

## Bloco D — Anti-ANR: virtualização + persistência assíncrona + cancelamento

1. `src/hooks/use-progressive.tsx`:
   - Aceitar `initial`/`step` do caller e adicionar `getDeviceChunkSize()` em `src/lib/device-profile.ts` retornando `{ initial, step }` por perfil (celular 24/18, tablet 30/20, TV 36/24, desktop 80/40).
2. `LiveGrid` / grids de Movies/Series:
   - Substituir por virtualização com `@tanstack/react-virtual` `useVirtualizer` + `getScrollElement: () => scrollRef.current`. (Já é dep do TanStack; se não estiver, `bun add @tanstack/react-virtual`.)
   - Manter linhas visíveis + overscan 2.
3. `XciptvTile` (imagens):
   - `loading="lazy"` `decoding="async"` `fetchPriority="low"`.
   - Fallback com guarda `onError` que só troca uma vez (`data-fallback-applied`).
4. `src/lib/query-persist.ts`:
   - Fila de escrita com concorrência 1 (`Promise` chain por chave).
   - `requestIdleCallback` (fallback `setTimeout(…, 50)`) para agendar depois do primeiro paint.
   - Deduplicar escritas concorrentes por chave.
5. Cancelamento:
   - Passar `signal` do React Query nas chamadas `api()` (fetch nativo). Para CapacitorHttp: `requestId` + `AbortController` mock; resultado tardio é descartado por sequência.
   - Em `live.tsx`, ao trocar de `cat` rapidamente: guardar `activeRequestSeqRef`; ignorar respostas antigas em `onSuccess`/`useEffect`.

---

## Bloco E — Celular ≠ TV + contagens undefined

1. `src/routes/__root.tsx` `TV_MODE_SCRIPT`:
   - Trocar `var isTV = isNative || isSmartTV;` por:
     ```js
     var injected = window.__deviceType;
     var isTV = injected === "tv" || (injected == null && isSmartTV);
     ```
   - Quando não-TV: viewport `width=device-width`, sem canvas 1280×720, sem `data-tv-mode`.
   - Atualizar memória `constraints/tv-mode-trigger.md`.
2. `android-template/MainActivity.java`:
   - Ler `UiModeManager.getCurrentModeType()`. Se `UI_MODE_TYPE_TELEVISION` → injetar `window.__deviceType = "tv"`. Senão `phone` (ou `tablet` via `smallestScreenWidthDp >= 600`).
   - Injetar via `webView.evaluateJavascript(...)` no `onPageStarted`.
3. `src/components/xciptv/XciptvCategoryList.tsx`:
   - `count?: number` — renderizar `(N)` só quando `typeof count === "number"`.
   - `totalCount?: number` — mesmo tratamento; nunca default 0.
4. `live.tsx` / `movies.tsx` / `series.tsx`:
   - Passar `count: counts.has(id) ? counts.get(id) : undefined` (já feito em live; aplicar aos outros).
   - `totalCount={native && !allOptIn ? undefined : streamsQ.data?.length}` (sem `?? 0`).

---

## Testes automáticos

- `xtream-live.test.ts`: garantir sem merge M3U em `get_live_streams` sem cache em memória.
- Novo `use-progressive.test.ts`: chunks por device.
- Novo `query-persist.test.ts`: fila concorrência 1 + idle scheduling.

## Verificação final

- `bun run build`, `bunx vitest run`.
- Playwright headless em `localhost:8080/live`, `/movies`, `/series`: captura tela + confirma primeira categoria auto-selecionada, sem `(0)` em categorias não consultadas, `data-app-build` presente no `<html>`.
- Documentar no relatório que validação real em APK/TV depende de publicar antes.

## Detalhes técnicos

- Chaves de cache versionadas `v2` para não colidir com dados antigos.
- Todos os logs via `iptvLog` (sem credenciais, sem URLs completas).
- Nenhuma mudança em `capacitor.config.ts` (`server.url` continua igual).
- Sem regressão nos layouts de web desktop (memória `tv-mode-trigger` mantida).

Depois de aprovado, executo A→E em ordem, com build+testes ao fim de cada bloco.
