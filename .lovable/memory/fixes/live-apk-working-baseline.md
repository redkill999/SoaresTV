---
name: LIVE APK working baseline (multop100 / no-native-force)
description: Estado estável dos canais LIVE no APK após remover forceNativeForLive e sanitizar host-profile
type: constraint
---

Baseline confirmado pelo usuário como "funcionando 100% no APK, sem travar e sem congelar". NÃO desfazer nenhum desses pontos sem ordem explícita.

**src/lib/host-profile.ts**
- `multop100.top` NÃO deve ter `forceNativeForLive: true`, `disableHlsConversion: true`, `preferTs: true`, nem `bypassProxyForLive: true`. ExoPlayer não abre neste host — forçar nativo mata a reprodução.
- Existe um patch em memória que limpa esses flags caso estejam salvos em storage. Manter.

**src/components/VideoPlayer.tsx**
- `LIVE_PLAYER_BUILD = "live-hls-first-restore-v4"` (marcador do baseline).
- `isMandatoryNativeLiveHost()` retorna `false` (curto-circuito) — nunca reativar.
- `isNoNativeFallbackLiveHost()` retorna `true` para `multop100.top` e é consultado em `markCurrentLiveHostNativePreferred`, `fallbackToNativeFromApkFreeze` e `liveEndedOnApkWeb` para pular fallback nativo.
- `liveEndedOnApkWeb` chama `tryNextVod()` em vez de `reconnectCurrentLiveWeb()` neste host.
- Botão DIAG do canto do player foi removido a pedido do usuário — o diagnóstico continua no console via `pushDbg`. Não reintroduzir o botão visível.

**Regra geral:** LIVE no APK toca pelo pipeline WEB (proxy `/api/stream`) + HLS. Nunca forçar ExoPlayer/nativo globalmente. Alterações no player LIVE precisam preservar este comportamento.
