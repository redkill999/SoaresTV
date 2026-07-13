---
name: LIVE APK strategy (native-first with web fallback)
description: Como LIVE roda no APK Android — ExoPlayer primeiro com fallback silencioso para pipeline Web
type: constraint
---

## Estado atual (a partir de 2026-07-13)

**Correção do bug "canais LIVE não abrem no APK celular":** no APK Android,
LIVE agora tenta ExoPlayer nativo PRIMEIRO. Se ExoPlayer não emitir READY/PLAY
em 25s (ou emitir erro explícito), o handler cai **silenciosamente** para o
pipeline Web (hls.js/mpegts + `/api/stream`) — sem mostrar diagnóstico.

Motivo: hls.js dentro da WebView Android era instável para muitos painéis
(canais simplesmente não abriam). ExoPlayer/Media3 toca MPEG-TS/HLS
nativamente e é o padrão dos apps IPTV Android (XCIPTV, TiviMate).

## Regras invioláveis

1. **Web Desktop NÃO é afetado.** `apkLiveAutoNative` só liga quando
   `isNativeAppSync()===true`. Fora do APK, `shouldUseNativePlayer` continua
   ligando só via `defaultPlayer='exo'` ou `forceNativeForLive` do host.

2. **Exceções obrigatórias para o auto-native (mantidas no pipeline Web):**
   - `cdnchurras.space` (Space FHD) → `isLockedHlsFirstLiveHost()`
     (mem://constraints/live-pipeline-lock)
   - `multop100.top` (canais adultos) → `isNoNativeFallbackLiveHost()`
     (mem://fixes/live-apk-working-baseline)

   Essas exclusões vivem em `shouldPreferNativeOnApkLive()` em
   `src/components/VideoPlayer.tsx`. Adicionar hosts que quebram no
   ExoPlayer aqui, nunca remover os existentes.

3. **Fallback silencioso obrigatório.** Nos handlers do ExoPlayer LIVE
   (erro explícito, `openNative` falho, watchdog):
   - Se `apkLiveAutoNativeRef.current === true` → `setPlayerMode("web")`
     + `setError(null)`. Deixa o `useEffect` do pipeline Web rodar.
   - Caso contrário (forceNativeForLive, defaultPlayer='exo', mandatory)
     → `showStreamDiagnostic(...)` como antes.

   NUNCA remover a checagem `autoFallback` — sem ela, hosts com problemas
   no ExoPlayer (potencialmente novos) mostram diagnóstico em vez de
   tocarem via proxy.

4. **`settings.defaultPlayer === "exo"` continua forçando ExoPlayer para
   tudo (LIVE e VOD) sem fallback silencioso** — é escolha explícita do
   usuário, respeita.

## Antes de editar

- Reler `mem://constraints/live-pipeline-lock` e
  `mem://fixes/live-apk-working-baseline`.
- Se ao adicionar um host à lista `isNoNativeFallbackLiveHost`, testar que
  ele volta a tocar via pipeline Web depois do watchdog.
- Marcador de build: `LIVE_PLAYER_BUILD = "live-hls-first-restore-v6-apk-native-first"`.
