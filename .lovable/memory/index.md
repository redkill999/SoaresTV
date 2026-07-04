# Project Memory

## Core
Não bagunçar o que já está funcionando. Ao corrigir uma coisa, verificar que as outras (scroll, navegação, layout das três abas live/movies/series) continuam intactas — fazer ajuste cirúrgico, não reescrever layout inteiro.
Layout XCIPTV (live/movies/series): wrapper usa `flex-1 min-h-0` dentro de `AppShell` (que provê altura via flex-col). NÃO usar `h-[calc(100dvh-3rem)]` — em TV-mode o body fica em 720px e o calc estoura o pai, quebrando o scroll do painel direito.
TV mode (canvas 1280×720 escalado em `__root.tsx`) só pode ligar para APK nativo ou Smart TV via UA. NUNCA reativar gatilho "tela grande sem touch" — quebra navegador desktop (scrollbars somem, cursor: none, painel direito não rola).
Catálogos Live/Movies/Series renderizam em chunks de 240 via `useProgressive` (sentinel + IntersectionObserver). Nunca voltar a `filtered.map` inline — trava abertura em desktop, Android TV e celular.
Proxy `/api/stream` NUNCA retorna 5xx: fetch-fail e upstream 5xx são rebaixados para 424. Devolver 502/503/504 dispara runtime-error/tela em branco falsa no preview enquanto o player já está em fallback.

## Memories
- [TV mode trigger](mem://constraints/tv-mode-trigger) — condição `isTV` em TV_MODE_SCRIPT; não reincluir heurística de tela grande
- [TV device detection](mem://constraints/tv-device-detection) — isTvDevice() em tv-dpad.ts não pode usar noTouch fallback; só UA de Smart TV + window.__deviceType
- [D-pad escapa inputs em TV](mem://constraints/dpad-input-escape) — `if (typing) return` em handleKey só bloqueia fora de tvMode; Up/Down precisam navegar de inputs em TV
- [Proxy status 4xx-only](mem://constraints/proxy-error-status) — src/routes/api/stream.ts nunca pode responder com 5xx
- [Desktop scroll + Voltar XCIPTV](mem://features/desktop-scroll-back-button) — 5 regras validadas para /live, /movies, /series funcionarem em navegador desktop sem quebrar mobile/TV
- [Renderização progressiva](mem://features/progressive-rendering) — chunks de 240 via useProgressive para abrir catálogos instantaneamente em todos os dispositivos
