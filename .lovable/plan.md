
# Playback Engine 5.0 — Plano

Antes de tocar em ~1250 linhas do `VideoPlayer.tsx` (hoje funcional para esma26.top e demais listas), preciso confirmar a estratégia. Muitas das regras pedidas **já estão implementadas** (ver coluna "estado atual"). Quero evitar regressão.

## Estado atual vs. pedido

| Item | Já existe | Falta |
|---|---|---|
| 2. HostProfile persistente | ✅ `src/lib/host-profile.ts` (localStorage + Capacitor Preferences, migração legado) | Campos extras: `lastWorkingStrategy` (=`preferPlayer`), `useProxy` (=`!disableProxy`), `preferredUserAgent`, `lastError`, `stabilityScore` |
| 3. Motor de decisão por perfil | ✅ parcial: consulta perfil para `disableProxy`/`forceHttp` | Ordem fixa Exo→mpegts→html5→hls hoje é "candidate URLs", não "engines" |
| 5. 502/503/504 desativa proxy | ✅ `isProxyDeadStatus` + `rememberProxyDead` | ok |
| 6. Nunca forçar HTTPS | ✅ `httpsVariant` respeita `forceHttp` | ok |
| 7. Buffer ExoPlayer (15s/50s/3s/5s) | ✅ `src/lib/native-player.ts` | ok |
| 8. Instância única | ✅ cleanup destrói hls/mpegts/nativo | ok |
| 10. Restore no relogin | ✅ persistência sobrevive | ok |
| 1. Arquivo central `PlaybackEngine.playStream()` | ❌ lógica vive no `useEffect` do `VideoPlayer` | criar |
| 4. Anti-fragmentação (1 engine por vez, sem paralelo) | ⚠️ hoje é sequencial mas o código mistura HLS/mpegts/HTML5 no mesmo loop de candidatos | refatorar em "tentativas de engine" |
| 9. Fallback Exo→mpegts→html5→hls | ⚠️ no APK Exo é tudo-ou-nada; no web a ordem é HLS-first para `.ts` ao vivo (decisão histórica, funciona melhor com Xtream) | **conflito real — ver pergunta abaixo** |
| 11. UI fullscreen (centralização, safe-area, z-index) | ? não inspecionei ainda | revisar |
| 12. Logs `[PLAYBACK ENGINE]` unificados | ⚠️ hoje há `[STREAM DEBUG]`, `[503 BYPASS]`, `[HOST PROFILE]` separados | unificar prefixo |

## Pontos que precisam decisão sua

1. **Ordem no web (navegador desktop):** o pedido diz "ExoPlayer → mpegts → HTML5 → HLS". ExoPlayer só existe no APK. No browser, hoje tentamos **HLS primeiro** para canais `.ts` ao vivo porque mpegts.js direto falha na maioria dos painéis Xtream (CORS/codec). Inverter para "mpegts antes de HLS" tem risco real de quebrar listas que hoje funcionam no preview web.
   - Opção A: manter HLS-first **no web** e Exo-first **no APK**.
   - Opção B: aplicar literalmente Exo→mpegts→HTML5→HLS em ambos (risco de regressão no preview).

2. **Refactor em novo arquivo `PlaybackEngine.ts` vs. refactor in-place:** extrair toda a máquina de estado para um serviço fora do componente é uma reescrita grande. Posso fazer isso, mas o risco de quebrar a integração com `useEffect`/cleanup/`stopNative`/listeners do `<video>` é alto. Alternativa: **manter no `VideoPlayer.tsx` mas reorganizar como máquina de estados explícita** (`tryEngine('exo')` → `tryEngine('mpegts')` → …) e deixar o "engine" exportado como módulo separado para os helpers puros (decisão de ordem, montagem de URL, perfil).

3. **UI fullscreen:** você relatou problema específico, ou é preventivo? Hoje funciona ok em landscape no APK. Mexer em z-index/safe-area sem repro pode quebrar o overlay nativo.

4. **Campos extras do HostProfile** (`stabilityScore`, `preferredUserAgent`, `lastError`): são realmente necessários agora ou bastam os 3 atuais (`disableProxy`, `forceHttp`, `preferPlayer`)? Adicionar campos sem consumidor é overhead.

## Proposta recomendada (cirúrgica, baixo risco)

Se confirmar, faço **nessa ordem, sem reescrever o componente inteiro**:

1. Extrair `src/lib/playback-engine.ts` com funções puras: `decideEngineOrder(host, format, isNative)`, `buildCandidateUrls(...)`, `classifyError(...)`. Sem React, sem efeitos colaterais além do `host-profile`.
2. No `VideoPlayer.tsx`, substituir o loop de candidatos atual por chamadas a `decideEngineOrder()` + uma função `runEngine(engine, url)` por tentativa, garantindo `destroyTsPlayer()`/`hls.destroy()` entre cada uma.
3. Unificar logs sob prefixo `[PLAYBACK ENGINE]` mantendo os antigos como apelidos por uma versão (para não perder rastreio).
4. **Não mexer** em: design, login, listas, AppShell, `native-player.ts` (buffer já ok), `host-profile.ts` (já cobre o essencial — adiciono só `preferredUserAgent` se útil).
5. **Não inverter** ordem HLS↔mpegts no web sem teste; manter Opção A.
6. UI fullscreen: só toco se você confirmar um sintoma específico.

## Pergunta

Confirma **Opção A** (preservar HLS-first no web, Exo-first no APK) e o refactor cirúrgico acima? Ou prefere **Opção B** (aplicar literalmente a ordem pedida em todos os ambientes, aceitando risco de regressão no preview web)?
