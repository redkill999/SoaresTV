---
name: LIVE 403 + watchdog fallback (canais adultos multop100.top)
description: Correções que fazem canais como sexyhot abrirem em ~8s no APK/Web quando o .m3u8 dá 403 ou trava
type: fix
---

Baseline confirmado pelo usuário: "abriu rapidao agora, maravilha". NÃO reverter.

Contexto: canais adultos do `multop100.top` (ex.: sexyhot, stream_id 2325908) devolvem
HTTP 403 no `.m3u8` proxiado E travam sem responder no `.m3u8` direto. Só o `.ts`
(via proxy → mpegts.js) funciona. Antes das correções, o player abortava no 403 ou
ficava pendurado 1min+.

**src/components/VideoPlayer.tsx — handler HLS fatal networkError (~linha 1645)**
- Em 401/403 (isAuthFail), NÃO abortar — avançar `vodIdx` para o próximo candidato.
  Só mostrar "Servidor recusou a reprodução" se TODOS os candidatos esgotarem.
- Log emite `ETAPA 8.5 hls→next idx=N (advance from failed .m3u8 http=403)`.

**src/components/VideoPlayer.tsx — attachHls, watchdog de manifest (~linha 1510)**
- LIVE tem watchdog de **4 segundos**: se `MANIFEST_PARSED` não disparar nesse prazo,
  destroi hls, avança `vodIdx` e chama `playDirect()`.
- Cobre casos silenciosos: mixed-content bloqueado, IP bloqueado sem devolver 4xx,
  host travado sem timeout de socket.
- Log emite `ETAPA 8.7 watchdog: manifest HLS não parseou em 4s idx=N — avançando`.
- 4s foi calibrado pelo usuário — 7s era funcional mas lento. NÃO aumentar sem novo teste.

**src/components/VideoPlayer.tsx — ETAPA 8.6 (~linha 1136)**
- REMOVIDA a persistência automática de `bypassProxyForLive` no host-profile quando
  cai no candidato direto. Era observação de runtime que contaminava perfis (violava
  `mem://fixes/live-apk-working-baseline` para `multop100.top`).
- Mantido apenas o log `ETAPA 8.6 fallback direto sem proxy host=X` e o warning de
  mixed-content. NÃO reintroduzir `updateHostProfile(h, { bypassProxyForLive: true })`
  neste ponto.

**Sequência esperada no diag do sexyhot (APK):**
```
ETAPA 8 playDirect idx=0 url=/api/stream?u=...2325908.m3u8...
hls FATAL type=networkError details=manifestLoadError http=403
ETAPA 8.5 hls→next idx=1 (advance from failed .m3u8 http=403)
ETAPA 8.6 fallback direto sem proxy host=multop100.top
ETAPA 8 playDirect idx=1 url=http://multop100.top/.../2325908.m3u8
ETAPA 8.7 watchdog: manifest HLS não parseou em 4s idx=1 — avançando
ETAPA 8 playDirect idx=2 url=/api/stream?u=...2325908.ts...
→ abre via mpegts.js
```
Tempo total ~8s.
