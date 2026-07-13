---
name: LIVE APK strategy (WEB pipeline first — baseline estável)
description: LIVE no APK toca pelo pipeline Web (/api/stream + HLS). ExoPlayer só via opt-in.
type: constraint
---

## Estado atual (a partir de 2026-07-13, build v7)

**REVERTIDO** o experimento "ExoPlayer primeiro no APK LIVE" (build v6).
Ele quebrou os canais na maioria dos painéis: usuário confirmou que apenas
filmes e séries rodavam no APK, canais não abriam. Voltamos ao baseline
documentado em `mem://fixes/live-apk-working-baseline`.

## Regra atual

- `apkLiveAutoNative = false` (constante). LIVE no APK usa o pipeline WEB
  (proxy `/api/stream` + hls.js/mpegts.js dentro da WebView).
- ExoPlayer nativo entra em LIVE **somente** quando:
  1. `settings.defaultPlayer === "exo"` (escolha explícita do usuário), OU
  2. `srcHostProfile.forceNativeForLive === true` (opt-in manual/confirmado por host), OU
  3. `isMandatoryNativeLiveHost(host)` (hoje: nenhum host — a função retorna
     `false`, curto-circuito de segurança).
- O player **não pode aprender/persistir automaticamente** `forceNativeForLive`,
  `bypassProxyForLive`, `disableHlsConversion` e `preferTs` só porque um canal
  LIVE travou no APK. Isso contamina o host e faz os próximos canais abrirem
  direto no ExoPlayer, quebrando listas em que filmes/séries continuam OK.
- Web Desktop segue totalmente isolado (`isNativeAppSync()` continua sendo o
  gate para qualquer alteração APK-específica em outras partes do player).
- VOD (filme/série) no APK também usa pipeline web por default e continua
  intocado.

## O que NÃO fazer

- Não reativar `apkLiveAutoNative` com condição derivada de `isNativeAppSync()`
  sem ter uma prova concreta (com o usuário) de que o host funciona no
  ExoPlayer. O plugin `capacitor-video-player` falha silenciosamente em muitos
  painéis IPTV; o watchdog leva 25s pra cair e nesse intervalo o pipeline web
  fica atrasado.
- Não reintroduzir fallback automático de freeze/ended do pipeline Web para
  ExoPlayer em LIVE. Em caso de travada, tentar recuperar/reconectar o pipeline
  Web atual sem gravar preferência nativa no host.
- Não remover as helpers `shouldPreferNativeOnApkLive` /
  `isNoNativeFallbackLiveHost` — elas ainda servem para bloquear ExoPlayer em
  hosts problemáticos quando o usuário liga `forceNativeForLive` manualmente
  ou seleciona `defaultPlayer="exo"`.
- Marcador de build: `LIVE_PLAYER_BUILD = "live-hls-first-restore-v7-apk-web-first"`.
- APK é casca do site publicado: fix só chega ao celular depois de publicar.

