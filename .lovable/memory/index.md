# Project Memory

## Core
Não bagunçar o que já está funcionando. Ao corrigir uma coisa, verificar que as outras (scroll, navegação, layout das três abas live/movies/series) continuam intactas — fazer ajuste cirúrgico, não reescrever layout inteiro.
Layout XCIPTV (live/movies/series): wrapper usa `flex-1 min-h-0` dentro de `AppShell` (que provê altura via flex-col). NÃO usar `h-[calc(100dvh-3rem)]` — em TV-mode o body fica em 720px e o calc estoura o pai, quebrando o scroll do painel direito.
TV mode (canvas 1280×720 escalado em `__root.tsx`) só pode ligar para APK nativo ou Smart TV via UA. NUNCA reativar gatilho "tela grande sem touch" — quebra navegador desktop (scrollbars somem, cursor: none, painel direito não rola).
Catálogos Live/Movies/Series renderizam em chunks de 240 via `useProgressive` (sentinel + IntersectionObserver). Nunca voltar a `filtered.map` inline — trava abertura em desktop, Android TV e celular.

## Memories
- [TV mode trigger](mem://constraints/tv-mode-trigger) — condição `isTV` em TV_MODE_SCRIPT; não reincluir heurística de tela grande
- [Desktop scroll + Voltar XCIPTV](mem://features/desktop-scroll-back-button) — 5 regras validadas para /live, /movies, /series funcionarem em navegador desktop sem quebrar mobile/TV
- [Renderização progressiva](mem://features/progressive-rendering) — chunks de 240 via useProgressive para abrir catálogos instantaneamente em todos os dispositivos
