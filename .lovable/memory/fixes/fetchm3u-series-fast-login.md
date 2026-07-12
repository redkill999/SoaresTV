---
name: fetchM3U — login rápido (série + race de candidatos)
description: Duas otimizações no login M3U — pular chamadas por série e correr as URLs candidatas em paralelo em vez de sequencial com timeout de 60s.
type: fix
---
Validado em 12/jul/2026. Aplicável a desktop e APK.

**Bug 1 — mapXtreamSeries lento (20–60s):**
Fazia até 800 chamadas `player_api.php?action=get_series_info` em série
(8 concorrentes × 8s timeout) só para descobrir o primeiro episódio de
cada série. Fix: monta entradas leves sem chamada extra; rotas
`/live`, `/movies`, `/series` usam xtreamApi separado.

**Bug 2 — candidatos de M3U em série com timeout de 60s (minutos de espera):**
`buildM3UCandidateUrls` gera ~24 URLs (12 portas × 2 outputs). Muitas
portas do painel (mnnet.live tinha 6 de 12 mortas) travavam por 60s cada
até a boa ser tentada. Fix: `raceCandidates` corre todas em paralelo e
retorna a primeira com `#EXTINF`; timeout individual reduzido para 20s.

**Não fazer:**
- Não reintroduzir `get_series_info` em loop dentro de `fetchM3U`.
- Não voltar ao `for...of await fetchText()` sequencial nos candidatos.
- Não subir `fetchText` timeout acima de 20s — o race protege painéis lentos.

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
