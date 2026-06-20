---
name: Renderização progressiva de catálogos (Live/Movies/Series)
description: Chunks de 240 itens via IntersectionObserver para abrir abas instantaneamente em desktop, Android TV TCL e celular Android
type: feature
---
Validado em 20/jun/2026 pelo usuário em todos os dispositivos (navegador desktop, Android TV TCL, celular Android).

**Problema original:** abrir /movies e /series demorava muito porque renderizava o catálogo inteiro (5k+ tiles) de uma vez — DOM e imagens travavam o thread.

**Solução (não regredir):**

1. Hook `src/hooks/use-progressive.tsx` — `useProgressive(items, initial=240, step=240)`:
   - Começa renderizando `initial` itens.
   - `IntersectionObserver` com `rootMargin: "600px 0px"` observa um sentinel no fim da lista e cresce em `step` itens.
   - Reseta para `initial` quando o array `items` muda (categoria/busca/sort).
   - Fallback: se `IntersectionObserver` não existir, renderiza tudo.

2. Em `src/routes/live.tsx`, `movies.tsx`, `series.tsx`:
   - O grid foi extraído em subcomponente (`LiveGrid` / `MovieGrid` / `SeriesGrid`) que chama `useProgressive(filtered)`.
   - Renderiza `visible.map(...)` em vez de `filtered.map(...)`.
   - Sentinel `<div ref={sentinelRef} className="h-8" />` renderizado quando `hasMore`.

**Não fazer:**
- Não trocar por virtualização pesada (react-window/virtual) — quebra o layout flex/scroll já validado.
- Não aumentar `initial` acima de ~300 — perde o ganho em TV/celular fracos.
- Não remover o subcomponente e voltar a `filtered.map` inline no route — regride a performance.
- Manter scroll do painel direito (`flex-1 basis-0 min-h-0 overflow-y-auto`) intacto: o IntersectionObserver depende dele para detectar o sentinel.
