---
name: LIVE pipeline invariants (trava anti-regressão)
description: Regras invioláveis do VideoPlayer LIVE. Violar qualquer uma quebra canais em produção.
type: constraint
---

Baseline confirmado funcionando (web desktop, APK, TV). Toda edição futura no
`src/components/VideoPlayer.tsx` DEVE respeitar todas as regras abaixo. Se uma
mudança exigir violar qualquer item, PARE e pergunte ao usuário antes.

## Invariantes

1. **`isLockedHlsFirstLiveHost()` existe e retorna `true` para `cdnchurras.space`.**
   Esse host é travado no pipeline HLS-first via `/api/stream` com
   `liveSyncDurationCount: 4` e `liveMaxLatencyDurationCount: 12`. Não remover,
   não renomear, não alterar a lista sem confirmação explícita do usuário.

2. **Watchdog de primeiro frame para hosts travados ≥ 35s** (não travado: 10–15s).
   Reduzir esse número quebra Space FHD e canais lentos. Se precisar acelerar,
   fazer só para hosts NÃO travados.

3. **Em 401/403 no `.m3u8` (LIVE)**: avançar `vodIdx` para o próximo candidato,
   NUNCA abortar direto com "Servidor recusou". Só mostrar erro quando todos os
   candidatos esgotarem. (mem://fixes/live-403-watchdog-fallback)

4. **ETAPA 8.6 NÃO pode persistir `bypassProxyForLive`** no host-profile.
   Só logar. Persistir contamina `multop100.top` e quebra APK.
   (mem://fixes/live-apk-working-baseline)

5. **`skipHls`, `liveBypassProxy`, `httpsPortCandidates` e handlers de erro HLS
   que reagem a 404/410 só se aplicam quando `!lockedHlsFirstLive`.** Hosts
   travados seguem o caminho HLS-first puro.

6. **`hls.js` internal timeout ≥ 30s para hosts travados** (`manifestLoadingTimeOut`,
   `manifestLoadingMaxRetryTimeout`). 15s é agressivo demais para `cdnchurras.space`.

7. **`/api/stream` NUNCA retorna 5xx.** Rebaixar upstream 5xx e fetch-fail para
   424. (mem://constraints/proxy-error-status)

8. **LIVE no APK usa pipeline WEB (proxy `/api/stream`) por padrão.** Só forçar
   ExoPlayer quando `defaultPlayer === "exo"` ou `host.forceNativeForLive`.
   (mem://constraints/live-apk-web-pipeline se existir; senão
   mem://fixes/live-apk-working-baseline)

## Antes de editar VideoPlayer.tsx

- Reler este arquivo + `mem://fixes/live-apk-working-baseline` +
  `mem://fixes/live-403-watchdog-fallback`.
- Fazer edição **cirúrgica** — nunca reescrever o pipeline inteiro.
- Se der para testar via Playwright em `/player/live/<id>`, testar antes de fechar.

## Como o usuário reverte se quebrar

O histórico do Lovable é a rede de segurança externa: qualquer mensagem no chat
tem botão *Revert* que restaura o projeto exatamente àquele estado. A versão
publicada (`tv-magica-brasa-soarestv.lovable.app`) continua servindo o último
build publicado mesmo que o preview quebre.
