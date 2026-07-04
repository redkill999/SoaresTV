#!/usr/bin/env bash
# build-apk.sh — Gera o APK Android (debug) do SoaresTV
# Uso: ./build-apk.sh [release]
#   sem args  -> gera APK debug via Gradle (assembleDebug)
#   release   -> gera APK release não-assinado (assembleRelease)
#
# Pré-requisitos (na máquina local):
#   - Bun instalado (https://bun.sh)
#   - JDK 17 (java -version)
#   - Android SDK + variável ANDROID_HOME ou ANDROID_SDK_ROOT apontando para o SDK
#     (ex.: ~/Android/Sdk no Linux, ~/Library/Android/sdk no macOS)

set -euo pipefail

MODE="${1:-debug}"

log() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
err() { printf "\n\033[1;31m✖ %s\033[0m\n" "$*" >&2; }

# ---------- checagens ----------
command -v bun >/dev/null 2>&1 || { err "bun não encontrado. Instale em https://bun.sh"; exit 1; }
command -v java >/dev/null 2>&1 || { err "JDK não encontrado. Instale o JDK 17."; exit 1; }

JAVA_MAJOR="$(java -version 2>&1 | awk -F[\".] '/version/ {print $2}')"
if [ "${JAVA_MAJOR:-0}" -lt 17 ]; then
  err "JDK 17+ necessário (detectado: $JAVA_MAJOR)."
  exit 1
fi

if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
  err "Defina ANDROID_HOME (ou ANDROID_SDK_ROOT) apontando para o Android SDK."
  exit 1
fi

# ---------- pipeline ----------
log "1/5 — Instalando dependências (bun install)"
bun install

log "2/5 — Buildando frontend (bun run build)"
bun run build

if [ ! -d "android" ]; then
  log "Plataforma Android ausente — executando: bunx cap add android"
  bunx cap add android
fi

log "3/5 — Sincronizando Capacitor (bunx cap sync android)"
bunx cap sync android

log "3b/5 — Patch landscape + permissões (android-landscape.mjs)"
node scripts/android-landscape.mjs
# Validação: aborta se o patch não pegou
if ! grep -q 'android:screenOrientation="landscape"' android/app/src/main/AndroidManifest.xml; then
  err "AndroidManifest não ficou em landscape após o patch."
  exit 1
fi
if ! grep -q 'android.permission.INTERNET' android/app/src/main/AndroidManifest.xml; then
  err "Permissão INTERNET ausente no AndroidManifest."
  exit 1
fi

log "4/5 — Compilando APK ($MODE) com Gradle"
pushd android >/dev/null
chmod +x ./gradlew
if [ "$MODE" = "release" ]; then
  ./gradlew assembleRelease
  APK_PATH="app/build/outputs/apk/release/app-release-unsigned.apk"
else
  ./gradlew assembleDebug
  APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi
popd >/dev/null

FULL_APK="android/$APK_PATH"
if [ ! -f "$FULL_APK" ]; then
  err "APK não encontrado em $FULL_APK"
  exit 1
fi

if [ "$MODE" = "release" ]; then
  log "4b/5 — Assinando APK release com keystore LOCAL (teste pessoal, NÃO Play Store)"
  if node scripts/sign-release-apk.mjs; then
    FULL_APK="android/app/build/outputs/apk/release/app-release-signed.apk"
  else
    err "Assinatura automática falhou — APK unsigned continua em $FULL_APK"
  fi
fi

log "5/5 — Pronto!"
printf "\n\033[1;32mAPK gerado (modo: %s):\033[0m %s\n" "$MODE" "$FULL_APK"
printf "Tamanho: %s\n\n" "$(du -h "$FULL_APK" | cut -f1)"
