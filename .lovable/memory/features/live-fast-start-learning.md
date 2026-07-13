---
name: LIVE fast-start (aprendizado por host)
description: hls.js liveSync 4/12 → 3/10 após host provar abertura rápida; auto-reverte em erro fatal
type: feature
---

# Objetivo

Reduzir o delay de abertura de canais LIVE em web desktop de ~20s para ~13-15s,
SEM regressão em hosts frágeis. Baseline 4/12 é sagrada na primeira execução
e para hosts travados (`isLockedHlsFirstLiveHost` → `cdnchurras.space`).

## Como funciona

1. `HostProfile.liveFastStart?: boolean` em `src/lib/host-profile.ts`.
2. `attachHls` em `VideoPlayer.tsx`:
   - Se `!lockedHlsFirstLive && liveHostProfile.liveFastStart` → usa 3/10.
   - Senão → usa 4/12 (baseline conservador).
3. Ao evento `playing` do vídeo, se elapsed < 12s desde `attachHls` e host
   ainda não estava promovido → `updateHostProfile(host, { liveFastStart: true })`.
4. Em `Hls.Events.ERROR` fatal antes do primeiro frame, se o host estava
   promovido → `updateHostProfile(host, { liveFastStart: false })` (auto-reverte).

## Regras invioláveis

- NUNCA aplicar fast-start a `isLockedHlsFirstLiveHost()` (Space FHD).
- NUNCA reduzir 4/12 globalmente — só via aprendizado por host.
- Primeira execução em host novo SEMPRE usa 4/12.
- Se um usuário reportar regressão em canal específico, o próximo erro fatal
  já limpa o flag automaticamente; não precisa mexer no código.

## Arquivos

- `src/lib/host-profile.ts` (campo `liveFastStart`)
- `src/components/VideoPlayer.tsx` (blocos ETAPA 8.5 no `attachHls`)
