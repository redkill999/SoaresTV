---
name: Ultra Premium LIVE APK HTTPS baseline
description: ultrapremium.live canais LIVE no APK precisam HTTPS direto antes de proxy/HTTP
type: constraint
---

DNS Ultra Premium (`ultrapremium.live`) em LIVE no APK/WebView não pode cair em
`http://` direto quando a página está em HTTPS: vira mixed-content e o canal nem
chega a abrir.

Regras validadas no player/perfil:
- Preset de `ultrapremium.live` deve manter `preferHttpsForLive: true`.
- Não reintroduzir `forceHttp` para esse host nem para variações com porta
  (`ultrapremium.live:80`, `www.ultrapremium.live:80`, subdomínios).
- Perfis antigos salvos em storage com porta precisam ser normalizados para o
  preset HTTPS, porque `getHostProfile()` consulta match exato antes do host sem
  porta.
- No APK, ordenar candidatos LIVE desse host como: HTTPS direto primeiro,
  depois proxy HTTPS, depois proxy/HTTP; HTTP direto só como último fallback.
- Para esse host no APK, HTTPS direto deve usar o elemento `<video>` nativo antes
  de hls.js/mpegts.js, evitando CORS/proxy quando o provedor bloqueia edge.

Não mexer no baseline global: demais listas continuam pelo pipeline Web padrão
no APK, e Web Desktop não deve receber mudanças globais por causa desse host.