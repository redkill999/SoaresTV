# Build APK / AAB — SoaresTV

Guia definitivo para gerar o APK (debug e release) e o AAB para Google Play,
incluindo checklist de testes em celular e Android TV.

O projeto usa a **estratégia "casca"** definida em `capacitor.config.ts`:
o APK abre `https://tv-magica-brasa-soarestv.lovable.app` dentro do WebView.
Isso significa que o backend (TanStack Start server functions) segue
funcionando sem precisar empacotar as rotas Node no APK.

Se um dia quiser empacotar offline (offline-first), remova o bloco `server`
do `capacitor.config.ts` e execute `bun run build` antes de `bunx cap sync`.

## 1. Pré-requisitos (uma vez por máquina)

| Ferramenta | Versão testada | Como instalar |
|---|---|---|
| JDK | 17 (Temurin) | `sdkman install java 17.0.12-tem` ou baixe do Adoptium |
| Android SDK | Platform 34 + Build-Tools 34.0.0 | Android Studio → SDK Manager |
| Android NDK | não necessário | — |
| Bun | ≥ 1.1 | `curl -fsSL https://bun.sh/install | bash` |
| Cabo USB / adb | — | `adb devices` deve listar o aparelho |

Variáveis de ambiente (adicione ao `~/.zshrc` ou `~/.bashrc`):

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)   # macOS
export ANDROID_HOME=$HOME/Library/Android/sdk       # macOS
# Linux: export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
```

## 2. Bootstrap do projeto Android (uma vez por clone)

Se `android/` não existe (não vem versionado no repo):

```bash
bun install
bun run build
bunx cap add android
bunx cap sync android
node scripts/patch-video-player.mjs
bash scripts/fix-android-splash.sh
node scripts/android-landscape.mjs
```

O script `android:sync` do `package.json` faz os quatro últimos passos:

```bash
bun run android:sync
```

## 3. APK debug (celular ou TV, para testes rápidos)

```bash
bun run build           # gera dist/ que o WebView casca vai referenciar
bun run android:sync    # copia webDir + aplica patches
cd android
./gradlew assembleDebug
# Saída: android/app/build/outputs/apk/debug/app-debug.apk
```

Instalar via USB:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Instalar em Android TV pela rede:

```bash
adb connect 192.168.0.42:5555              # IP da TV
adb -s 192.168.0.42:5555 install -r app-debug.apk
```

## 4. APK release (assinado, distribuição direta)

### 4.1 Gerar keystore (uma vez, guarde com sua vida)

```bash
keytool -genkey -v -keystore ~/soarestv-release.keystore \
  -alias soarestv -keyalg RSA -keysize 2048 -validity 10000
```

Anote em local seguro: caminho do `.keystore`, senha, alias, senha do alias.

### 4.2 Configurar variáveis de build

Crie `android/keystore.properties` (**NÃO comitar**):

```
storeFile=/Users/voce/soarestv-release.keystore
storePassword=****
keyAlias=soarestv
keyPassword=****
```

Adicione ao `.gitignore` do projeto (já deveria estar):

```
android/keystore.properties
android/app/release/
```

### 4.3 Build

```bash
bun run build
bun run android:sync
cd android
./gradlew assembleRelease
# Saída: android/app/build/outputs/apk/release/app-release.apk
```

Se preferir usar o helper já pronto do repo:

```bash
node scripts/sign-release-apk.mjs
```

## 5. AAB para Google Play (`bundleRelease`)

```bash
bun run build
bun run android:sync
cd android
./gradlew bundleRelease
# Saída: android/app/build/outputs/bundle/release/app-release.aab
```

Suba o `.aab` no Play Console → Produção → Criar nova versão.

## 6. Versionamento

Edite antes de cada release:

- `android/app/build.gradle` → `versionCode` (inteiro, sempre incremental) e
  `versionName` (semver visível ao usuário, ex.: `"1.4.2"`).
- Se mudou a URL publicada no Lovable: atualizar `server.url` em
  `capacitor.config.ts` e rodar `bunx cap sync android` de novo.

## 7. Checklist de testes — Celular Android

Instale o APK e verifique **cada item**:

- [ ] App abre em landscape travado (não gira ao virar o aparelho).
- [ ] Splash preto → animação de login aparece sem logo estática flashar.
- [ ] Login Xtream: aceita `server + user + pass` e persiste após reabrir.
- [ ] Login M3U: aceita URL `.m3u`/`get.php` e persiste.
- [ ] `/loading` desbloqueia com pelo menos 1 capacidade (live OU vod OU series).
- [ ] Home: hotspots indisponíveis ficam com opacidade reduzida e mostram toast.
- [ ] Aba Live: painel direito rola com scroll interno; canais mudam sem freeze.
- [ ] Aba Movies: catálogo carrega, capa aparece, player nativo abre.
- [ ] Aba Series: temporadas/episódios listam, "continuar assistindo" volta ao ponto certo.
- [ ] Guia EPG (Xtream): programas do canal aparecem; alerta agenda notificação.
- [ ] Voltar ao Home preserva o scroll de cada aba.
- [ ] Reproduzir por 10min: sem drops, sem OOM, sem WebView crash.
- [ ] Favoritos: adicionar/remover em Live/Movies/Series persiste após restart.
- [ ] Histórico: item recém-assistido aparece no topo da home.
- [ ] Trocar de lista (logout → nova conta): não vaza dados da lista anterior.

## 8. Checklist de testes — Android TV

Adicional aos itens do celular:

- [ ] App instala via `adb install` na TV (Fire TV / Google TV / Bravia).
- [ ] Foco navega com **d-pad**: setas movem entre hotspots do home.
- [ ] Botão OK do controle abre o item focado (não precisa touch).
- [ ] `data-tv-focusable` visível: hotspot focado tem borda destacada.
- [ ] Botão VOLTAR do controle sai do player (não fecha o app inteiro).
- [ ] TV mode ativa canvas 1280×720 (não usa layout mobile) — comparar com a
      preview desktop dentro do navegador.
- [ ] Reprodução HLS (`.m3u8`) via ExoPlayer nativo sem buffering excessivo.
- [ ] Reprodução MPEG-TS (`.ts`) via mpegts.js — testar canal aberto Xtream.
- [ ] Guia EPG rolável com d-pad; foco pula linha a linha.
- [ ] Splash não fica travada > 3s em TVs lentas (Fire TV Stick Lite).

## 9. Problemas comuns

| Sintoma | Causa provável | Fix |
|---|---|---|
| APK abre em tela branca | `dist/` desatualizado ou `server.url` errado | `bun run build && bun run android:sync` |
| Vídeo não roda mas lista carrega | `CapacitorHttp` foi habilitado | Deixar `enabled: false` no `capacitor.config.ts` |
| Peer error `capacitor-video-player` | Faltou o patch | `bun install` (aplica automático via `patchedDependencies`) |
| Splash com logo antiga aparece | Cache do resource | `bash scripts/fix-android-splash.sh` de novo, depois `cap sync` |
| Landscape não trava na TV | Manifest sem `screenOrientation` | `node scripts/android-landscape.mjs` |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Assinaturas debug vs release conflitando | `adb uninstall com.soarestv.app` antes do install |

## 10. Recursos suportados / não suportados

**Suportados hoje:**
- Xtream Codes (live + VOD + series + EPG via `get_simple_data_table`)
- M3U puro (parser incremental com tvg-*/catchup*/EXTVLCOPT/KODIPROP/EXTGRP + url-tvg)
- XMLTV (parser incremental com timezone, gzip via DecompressionStream, TTL 6h)
- HLS `.m3u8` (ExoPlayer nativo no APK, hls.js no navegador)
- MPEG-TS `.ts` (mpegts.js em ambos)
- Favoritos + histórico + "continuar assistindo" (com providerId+stableId)
- TV mode (canvas 1280×720 escalado) para APK e Smart TV UA
- Splash/login imersivo em landscape

**Não suportados (ainda):**
- Catchup / Timeshift UI (backend Xtream expõe, front não consome)
- Rádio como aba dedicada (streams entram como live)
- DRM Widevine em KODIPROP (parser captura, player nativo não aplica)
- Chromecast / Google Cast do device Android para outra tela
- Múltiplos perfis de usuário no mesmo aparelho
