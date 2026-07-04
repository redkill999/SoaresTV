---
name: Desktop browser scroll + Voltar button (XCIPTV)
description: Configuração validada para /live, /movies, /series funcionarem corretamente em navegador desktop sem quebrar mobile/TV
type: feature
---
Estado validado e aprovado pelo usuário em 20/jun/2026.

Regras que precisam ser mantidas para /live, /movies e /series no navegador desktop:

1. **Botão VOLTAR sempre visível** em `src/components/xciptv/XciptvHeader.tsx` — texto não pode ter `hidden` em nenhum breakpoint; manter borda `border-[#1FB6FF]/55` e shadow para destaque.

2. **Painel direito (lista de canais/filmes/séries) com scroll independente** — em `src/routes/live.tsx`, `movies.tsx`, `series.tsx` o wrapper do painel direito usa `flex-1 basis-0 min-h-0 overflow-y-auto` (NÃO `h-full`, NÃO `h-[calc(...)]`). A altura vem do flex pai (AppShell `flex-col` + wrapper `flex-1 min-h-0`).

3. **D-pad só ativo em TV mode** — em `src/lib/tv-dpad.ts` o `handleKey` faz early return se `!tvMode`, deixando seta/scroll/wheel nativos funcionarem no navegador desktop.

4. **AppShell viewport** — root div usa `h-screen h-dvh max-h-dvh overflow-hidden flex` para fallback em navegadores sem `h-dvh`.

5. **TV mode trigger** — só APK nativo ou Smart TV via UA (ver mem://constraints/tv-mode-trigger). Nunca reativar heurística de "tela grande sem touch".

Se algo quebrar no desktop (scroll direito sumir, botão voltar sumir), conferir esses 5 pontos antes de mexer em layout.
