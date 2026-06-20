#!/usr/bin/env bash
# ============================================================================
# fix-android-splash.sh
# ----------------------------------------------------------------------------
# Remove COMPLETAMENTE a imagem de splash estática que o Android exibe antes
# da WebView do Capacitor carregar. Use depois de `bunx cap add android` /
# `bunx cap sync android`, sempre que regenerar a pasta android/.
#
# O que faz:
#   1. Troca o tema da MainActivity de "AppTheme.NoActionBarLaunch"
#      para "AppTheme.NoActionBar" no AndroidManifest.xml (sem splash).
#   2. Reescreve android/app/src/main/res/values/styles.xml para que
#      AppTheme.NoActionBarLaunch use windowBackground=preto (defensivo).
#   3. Substitui todos os drawable*/splash.png por um PNG preto 1x1
#      (nem launcher antigo nem cache mostra mais a logo).
#   4. Reescreve drawable/splash.xml apontando para cor preta.
#
# Uso:
#   chmod +x scripts/fix-android-splash.sh
#   ./scripts/fix-android-splash.sh
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT/android"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "[fix-android-splash] Pasta android/ nao encontrada."
  echo "                     Rode antes: bunx cap add android  (ou cap sync android)"
  exit 1
fi

MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
STYLES="$ANDROID_DIR/app/src/main/res/values/styles.xml"
COLORS="$ANDROID_DIR/app/src/main/res/values/colors.xml"

# ---- 1) AndroidManifest: tema sem splash ----------------------------------
if [ -f "$MANIFEST" ]; then
  echo "[fix-android-splash] Patch AndroidManifest.xml"
  # GNU sed e BSD sed (macOS) compativel
  if sed --version >/dev/null 2>&1; then
    sed -i 's/AppTheme\.NoActionBarLaunch/AppTheme.NoActionBar/g' "$MANIFEST"
  else
    sed -i '' 's/AppTheme\.NoActionBarLaunch/AppTheme.NoActionBar/g' "$MANIFEST"
  fi
else
  echo "[fix-android-splash] AVISO: $MANIFEST nao encontrado"
fi

# ---- 2) styles.xml: forca windowBackground preto no tema de launch --------
if [ -f "$STYLES" ]; then
  echo "[fix-android-splash] Reescrevendo styles.xml"
  cat > "$STYLES" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="android:background">@android:color/black</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@android:color/black</item>
    </style>

    <!-- Tema de launch: SEM logo estatica, so tela preta -->
    <style name="AppTheme.NoActionBarLaunch" parent="AppTheme.NoActionBar">
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@android:color/black</item>
    </style>
</resources>
XML
fi

# ---- 3) Substitui PNGs de splash por 1x1 preto ----------------------------
echo "[fix-android-splash] Zerando splash.png em todos os drawable-*"
# 1x1 PNG preto (base64). Pequeno e valido.
BLACK_PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
TMP_BLACK="$(mktemp)"
echo "$BLACK_PNG_B64" | base64 -d > "$TMP_BLACK"

find "$ANDROID_DIR/app/src/main/res" -type f -name "splash.png" -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do
      echo "  - $f"
      cp "$TMP_BLACK" "$f"
    done
rm -f "$TMP_BLACK"

# ---- 4) drawable/splash.xml -> cor preta ----------------------------------
SPLASH_XML="$ANDROID_DIR/app/src/main/res/drawable/splash.xml"
if [ -d "$(dirname "$SPLASH_XML")" ]; then
  echo "[fix-android-splash] Reescrevendo drawable/splash.xml"
  cat > "$SPLASH_XML" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@android:color/black" />
</layer-list>
XML
fi

echo ""
echo "[fix-android-splash] OK. Agora rode:"
echo "    cd android && ./gradlew assembleRelease"
echo "(ou abra o projeto no Android Studio e gere o APK)"
