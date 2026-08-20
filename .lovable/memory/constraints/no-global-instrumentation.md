---
name: Sem instrumentação global no APK
description: Não instalar patch de window.fetch/history nem setState por linha de log — causava crash/travamento no APK
type: constraint
---

## Regra (2026-08-20)

- `installPlaybackMetrics()` (src/lib/playback-metrics.ts) NÃO deve ser
  instalado por padrão em `src/routes/__root.tsx`. Ele substitui
  `window.fetch`, `history.pushState/replaceState` e registra listeners em
  capture no `document` — no WebView do APK isso interfere no streaming e
  acumula sessões em memória (crash). Só reativar temporariamente para uma
  investigação específica, e remover depois.
- `pushDbg` no VideoPlayer só pode chamar `setDbgLines` quando um painel de
  diagnóstico está visível (`dbgVisibleRef`). Chamar setState a cada linha de
  log re-renderizava o componente inteiro dezenas de vezes por segundo.
- Arrays de diagnóstico (`window.__vodErrors`, sessões de telemetria) precisam
  de cap explícito (50 / 200 itens).
- Nada disso altera o pipeline de reprodução (LIVE/VOD, proxy, watchdogs).
