# Relatório de Correções — SoaresTV

Consolidação das 8 ondas de correção estrutural aplicadas ao projeto, sem
descaracterizar a identidade visual, sem apagar dados do usuário, sem
recriar o app do zero.

---

## 1. Resumo das correções

| Onda | Objetivo | Status |
|---|---|---|
| 1 | Resolver conflito de peer do `capacitor-video-player` com Capacitor 8 | ✅ |
| 2 | Unificar detecção de plataforma (Identity) e liberar Home com capacidades parciais (Loading) | ✅ |
| 3 | Introduzir `ProviderAccount` + `ContentReference` (stableId) sem quebrar API legada | ✅ |
| 4 | Parser M3U completo (tvg-*/EXTVLCOPT/KODIPROP/EXTGRP/url-tvg/URLs relativas/BOM/CRLF/cancel) | ✅ |
| 5 | Parser XMLTV incremental com índice `tvgId → programas` + `display-name → id` | ✅ |
| 6 | Serviço EPG para M3U puro (download `.xml.gz`, merge, cache 6h, dedup inflight) | ✅ |
| 7 | Suíte de testes unitários (vitest) travando parsers M3U e XMLTV | ✅ |
| 8 | Documentação de build APK/AAB + checklists celular/TV | ✅ |

Fora do escopo (intencional, sem quebrar nada existente): catchup UI, rádio
como aba dedicada, DRM Widevine no player, Cast, multi-perfil.

---

## 2. Arquivos modificados / criados

### Criados

- `patches/capacitor-video-player@6.0.2.patch` — expande peer para Capacitor 6/7/8.
- `src/lib/device-profile.ts` — `DeviceProfile` central (platform/formFactor/inputMode).
- `src/lib/capabilities.ts` — `Capabilities` (`live|movies|series|epg|radio|catchup`) com persistência.
- `src/lib/content-ref.ts` — `ProviderAccount`, `ContentReference`, `stableIdOf`, hashes FNV-1a.
- `src/lib/xmltv.ts` — parser XMLTV incremental + `lookupNowProgramme`.
- `src/lib/m3u-epg.ts` — serviço EPG (download, gzip, merge, TTL 6h).
- `src/lib/__tests__/xtream-m3u.test.ts` — 7 testes do parser M3U.
- `src/lib/__tests__/xmltv.test.ts` — 6 testes do parser XMLTV.
- `docs/BUILD-ANDROID.md` — guia APK/AAB + checklists.
- `.lovable/memory/design/home-hotspots-alignment.md` (onda anterior, preservado).

### Modificados

- `package.json` — `patchedDependencies` + `vitest` devDep.
- `bun.lock` — atualizado por `bun install`.
- `src/lib/xtream.ts` — `parseM3UDetailed` novo + `M3UEntry` estendido; `parseM3U` virou wrapper retrocompat.
- `src/lib/storage.ts` — `FavItem`/`HistItem` ganharam `providerId+stableId` opcionais; `migrateLegacyItems` idempotente; `toggleFavRef`/`isFavRef` por `stableId`; `getCurrentProviderId` público.
- `src/routes/loading.tsx` — libera Home com **qualquer** capacidade real (live OU vod OU series), persiste capacidades.
- `src/routes/home.tsx` — hotspots respeitam `capabilities`, ficam `aria-disabled` com opacidade quando indisponíveis; toast explicativo.

### Não tocados (preservação explícita)

- Layout XCIPTV (`live/movies/series`) — scroll interno preservado.
- `capacitor.config.ts` — `CapacitorHttp.enabled=false` mantido (essencial para HLS/TS).
- TV mode script em `__root.tsx` — gatilho só APK nativo ou UA Smart TV; **não** reintroduzido "tela grande sem touch".
- `guide.tsx` — fluxo Xtream `get_simple_data_table` intacto.
- `native-player.ts`, `VideoPlayer.tsx`, `platform.ts` — sem mudanças.

---

## 3. Arquitetura criada

```
┌─────────────────────────────────────────────────────────────┐
│                     Detecção de contexto                    │
│  device-profile.ts  ───►  Platform | FormFactor | InputMode │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                    Capacidades do provedor                 │
│  loading.tsx  ──►  capabilities.ts  ──►  home.tsx (gate)   │
│  (probe live+vod+series; libera com ≥1)                    │
└────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                     Referência de conteúdo                 │
│  content-ref.ts:                                           │
│    providerIdFromXtream(server,user)  →  FNV-1a            │
│    providerIdFromM3U(url,user)        →  FNV-1a            │
│    stableIdOf({provider,type,id,season,episode}) → hash    │
│  storage.ts:                                               │
│    Fav/Hist agora carregam providerId+stableId opcionais   │
│    migrateLegacyItems() enriquece itens antigos            │
└────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                   Ingestão de listas M3U                   │
│  xtream.ts::parseM3UDetailed(text, {baseUrl, signal})      │
│    → { entries: M3UEntry[], epgUrls: string[], truncated } │
│  M3UEntry: id,name,url,logo,group,tvgId,tvgName,tvgChno,   │
│            userAgent,referer,catchup*,kodiProps,extGroup   │
└────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                     EPG (XMLTV pipeline)                   │
│  m3u-epg.ts::getActiveXmltvIndex(epgUrls)                  │
│    ├─ fetch em paralelo (AbortSignal)                      │
│    ├─ decodeMaybeGzip via DecompressionStream              │
│    ├─ xmltv.ts::parseXmltv (regex incremental)             │
│    │    → byChannel: Map<tvgId, EpgProgramme[]>            │
│    │    → channelByDisplay: Map<name.lower, tvgId>         │
│    ├─ merge de múltiplos XMLs, ordena por start            │
│    └─ singleton in-memory, TTL 6h, dedup inflight          │
│  lookupNowProgramme(idx, {tvgId|tvgName, nowMs})           │
└────────────────────────────────────────────────────────────┘
```

---

## 4. Migrações realizadas

Sem SQL. Todas migrações são **idempotentes** em `localStorage`:

- `soarestv:migration:v1-content-ref` (flag em `storage.ts`) — enriquece
  `Fav`/`Hist` legados com `providerId+stableId` baseados no provedor
  ativo. Roda uma vez. Chamada dispara no primeiro `getFavs()`/`getHist()`.
- `resetContentRefMigration()` limpa a flag quando o usuário troca de conta
  (`setCreds` / `setM3U`), garantindo re-enriquecimento com o novo provider.
- **Zero perda de dados**: itens sem `providerId` continuam funcionando
  pela API legada (`toggleFav({type,id,name,logo})`).

---

## 5. Testes adicionados

`bunx vitest run` → **13/13 passam**.

- `src/lib/__tests__/xtream-m3u.test.ts` (7 testes):
  tvg-id/name/chno/logo/group-title, `url-tvg` header, EXTVLCOPT (UA/referer),
  KODIPROP, URLs relativas via `baseUrl`, BOM+CRLF, `#EXTGRP` fallback,
  wrapper legado `parseM3U`.
- `src/lib/__tests__/xmltv.test.ts` (6 testes):
  indexação por tvg-id, `display-name → id`, `parseXmltvDate` (com/sem
  timezone), `lookupNowProgramme` por tvg-id, fallback por display-name,
  retorno null quando nada casa.

---

## 6. Resultados dos comandos

```
$ bun install               → patch aplicado, 0 ERESOLVE
$ bun run build             → ✓ built in ~700ms
$ bunx vitest run           → Test Files 2 passed (2)
                              Tests      13 passed (13)
$ bun run android:sync      → cap sync + patch-video-player + splash + landscape
```

Warnings restantes (não bloqueantes):
- `createServerFn().inputValidator() is deprecated` em `xtream.functions.ts`
  (3 chamadas). Substituição por `.validator()` fica para uma próxima
  refatoração — mudança de API do TanStack Start, não bug funcional.

---

## 7. Recursos realmente suportados

- **Xtream Codes**: live + VOD + series + EPG (`get_simple_data_table`).
- **M3U puro**: parser completo com todos os atributos padrão da indústria.
- **XMLTV**: parser incremental com timezone, `.xml.gz`, merge multi-fonte.
- **HLS `.m3u8`**: ExoPlayer nativo (APK) / hls.js (web).
- **MPEG-TS `.ts`**: mpegts.js em ambos.
- **Favoritos + histórico + continuar assistindo**: com `providerId+stableId`.
- **TV mode**: canvas 1280×720 para APK nativo e Smart TV via UA.
- **Splash landscape imersivo** no Android.
- **Detecção unificada de plataforma** via `DeviceProfile`.
- **Home resiliente**: libera com ≥1 capacidade; desativa hotspots faltantes.

## 8. Recursos ainda não suportados

- Catchup / Timeshift UI (parser captura `catchup*`, front não consome).
- Rádio como aba dedicada (streams caem como live).
- DRM Widevine em KODIPROP (parser captura, player não aplica).
- Chromecast / Google Cast.
- Múltiplos perfis por aparelho.
- Wiring do `m3u-epg.ts` no `guide.tsx` para provider M3U puro (infra
  pronta, ligar quando houver decisão de UX).

---

## 9. Instruções para gerar APK e AAB

Guia completo em [`docs/BUILD-ANDROID.md`](./BUILD-ANDROID.md). TL;DR:

**APK debug:**
```bash
bun install
bun run build
bun run android:sync
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**APK release assinado:**
```bash
# 1x: keytool -genkey -v -keystore ~/soarestv-release.keystore -alias soarestv -keyalg RSA -keysize 2048 -validity 10000
# criar android/keystore.properties (NÃO commitar)
bun run build && bun run android:sync
cd android && ./gradlew assembleRelease
```

**AAB para Google Play:**
```bash
bun run build && bun run android:sync
cd android && ./gradlew bundleRelease
# upload de android/app/build/outputs/bundle/release/app-release.aab
```

---

## 10. Checklist de testes

Consolidado em `docs/BUILD-ANDROID.md` §7 (celular, 14 itens) e §8
(Android TV, 10 itens adicionais). Cobre landscape travado, splash, login
Xtream/M3U, loading resiliente, hotspots com capacidades, scroll das abas,
EPG, favoritos, histórico, troca de lista, foco d-pad, botão OK/VOLTAR,
canvas 1280×720, HLS/TS nativo, guide rolável.

---

## 11. O que NÃO foi feito (e por quê)

- **Não** recriei o projeto do zero.
- **Não** removi funcionalidades funcionando.
- **Não** troquei a identidade visual, layouts, imagens, rotas.
- **Não** apaguei dados do usuário — todas migrações são aditivas + flag idempotente.
- **Não** reativei o gatilho "tela grande sem touch" para TV mode (quebrava desktop).
- **Não** habilitei `CapacitorHttp` (quebra HLS/TS).
- **Não** persisti `setCreds()` de fallback silencioso.
- **Não** troquei o parser M3U legado — só estendi com `parseM3UDetailed`.
- **Não** mexi no `guide.tsx` (Xtream EPG funciona; wiring M3U-XMLTV
  fica opcional pra próxima onda).
