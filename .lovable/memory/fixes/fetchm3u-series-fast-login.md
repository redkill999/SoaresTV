---
name: fetchM3U — mapXtreamSeries sem chamadas por série (login rápido)
description: Login M3U demorava 20–60s porque mapXtreamSeries fazia até 800 get_series_info sequenciais para resolver o "primeiro episódio". Agora só monta entradas leves.
type: fix
---
Validado em 12/jul/2026. Aplicável a desktop e APK.

**Bug:** `src/lib/xtream.functions.ts` → `mapXtreamSeries` fazia até 800
chamadas `player_api.php?action=get_series_info` (8 concorrentes × 8s timeout)
só para descobrir o primeiro episódio de cada série e montar uma URL
"tocável" no cache M3U. Somava 20–60s ao login em todos os dispositivos.

**Fix:** montar apenas entradas leves com URL relativa `/player/series/<sid>`.
Sem chamadas HTTP extras.

**Por que é seguro:**
- Rotas `/live`, `/movies`, `/series` consomem `xtreamApi` diretamente
  (pipeline separado do cache M3U) — não dependem dessa resolução.
- `/playlist` continua listando as séries visualmente; o playback real
  acontece via `/series` que resolve episódios sob demanda.

**Não fazer:**
- Não reintroduzir `get_series_info` em loop dentro de `fetchM3U`. Se um dia
  quisermos episódio real no cache M3U, deve ser feito **lazy** (sob demanda
  quando o item for clicado), nunca no path de login.
- Manter `MAX_SERVER_ENTRIES=10_000` e o `Promise.all` das outras 6 chamadas
  (`get_live_categories`, `get_vod_categories`, `get_series_categories`,
  `get_live_streams`, `get_vod_streams`, `get_series`) — essas são JSON
  compactos e não gargalam.
