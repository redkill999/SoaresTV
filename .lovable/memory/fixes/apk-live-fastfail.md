---
name: APK LIVE fast-fail sem afetar Web/VOD
description: No APK, hosts TS-only/preferTs não devem gastar 30-60s em HLS inventado antes do TS original
type: constraint
---

Correção de 2026-07-20 para canais LIVE demorando >1min no APK celular em listas específicas.

## Regra

- Alterações valem somente quando `nativeRuntimeRef.current && isLive`.
- Se o host tem `preferTs` ou `disableHlsConversion` e a URL original é `.ts`, o APK deve respeitar TS primeiro em vez de promover HLS inventado.
- URL `.m3u8` original da M3U continua preservada e não deve ser rebaixada automaticamente.
- Watchdog de primeiro frame HLS no APK não travado: 18s. Web Desktop continua 35s; `cdnchurras.space` continua 40s/locked.
- HTTPS direto no APK tem watchdog curto (10–14s) para avançar de candidato se o `<video>` nativo ficar sem primeiro frame.
- Correção v12: microcongeladas no APK LIVE devem ser tratadas suavizando apenas o runtime nativo: HLS ganha buffer maior/tolerância maior no WebView e `recoverMediaError()` só roda após underflow persistente; mpegts.js no APK usa stash pequeno e desliga latency chasing agressivo. Web Desktop e VOD permanecem no baseline.

## Não fazer

- Não reduzir o watchdog de Web Desktop.
- Não reativar ExoPlayer-primeiro global.
- Não persistir `forceNativeForLive` automaticamente.
- Não mexer em VOD/filmes/séries para resolver atraso de LIVE.
- Não voltar a chamar `recoverMediaError()` agressivamente a cada `waiting` no APK LIVE — isso causa microcongeladas perceptíveis.