#!/usr/bin/env node
/**
 * Patch android/app/src/main/AndroidManifest.xml para travar a MainActivity
 * em landscape (igual XCIPTV). Rode após `npx cap add android` ou `npx cap sync android`.
 *
 * Uso:
 *   node scripts/android-landscape.mjs
 *
 * Idempotente: se já estiver landscape, não altera nada.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve("android/app/src/main/AndroidManifest.xml");

if (!existsSync(manifestPath)) {
  console.error("❌ AndroidManifest.xml não encontrado em", manifestPath);
  console.error("   Rode `npx cap add android` antes.");
  process.exit(1);
}

let xml = readFileSync(manifestPath, "utf8");
const before = xml;

// Permissões básicas para WebView + streaming IPTV.
for (const permission of ["INTERNET", "ACCESS_NETWORK_STATE", "WAKE_LOCK"]) {
  const full = `android.permission.${permission}`;
  if (!xml.includes(full)) {
    xml = xml.replace(
      /(<manifest\b[^>]*>)/,
      `$1\n    <uses-permission android:name="${full}" />`,
    );
  }
}

// Garante android:screenOrientation="landscape" e configChanges incluindo orientation/screenSize
xml = xml.replace(
  /<activity\b([^>]*?)\bandroid:name="\.MainActivity"([^>]*)>/,
  (match, pre, post) => {
    let attrs = pre + ' android:name=".MainActivity"' + post;
    // screenOrientation
    if (/android:screenOrientation=/.test(attrs)) {
      attrs = attrs.replace(/android:screenOrientation="[^"]*"/, 'android:screenOrientation="landscape"');
    } else {
      attrs += ' android:screenOrientation="landscape"';
    }
    // configChanges (mantém o que já tem + garante orientation|screenSize|keyboardHidden)
    if (/android:configChanges=/.test(attrs)) {
      attrs = attrs.replace(/android:configChanges="([^"]*)"/, (_m, v) => {
        const set = new Set(v.split("|").map((s) => s.trim()).filter(Boolean));
        ["orientation", "screenSize", "keyboardHidden", "screenLayout", "uiMode"].forEach((k) => set.add(k));
        return `android:configChanges="${Array.from(set).join("|")}"`;
      });
    } else {
      attrs += ' android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|uiMode"';
    }
    return `<activity${attrs}>`;
  },
);

// Garante android:banner="@drawable/tv_banner" no <application> (icone TV Leanback).
xml = xml.replace(/<application\b([^>]*)>/, (m, attrs) => {
  let next = attrs;
  if (!/android:banner=/.test(next)) next += ' android:banner="@drawable/tv_banner"';
  if (!/android:usesCleartextTraffic=/.test(next)) next += ' android:usesCleartextTraffic="true"';
  if (!/android:hardwareAccelerated=/.test(next)) next += ' android:hardwareAccelerated="true"';
  if (!/android:largeHeap=/.test(next)) next += ' android:largeHeap="true"';
  return `<application${next}>`;
});

// Garante intent-filter LEANBACK_LAUNCHER na MainActivity (icone na grade da TV).
if (!/android\.intent\.category\.LEANBACK_LAUNCHER/.test(xml)) {
  xml = xml.replace(
    /(<category android:name="android\.intent\.category\.LAUNCHER"\s*\/>)/,
    `$1\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />`,
  );
}

// Declara suporte a TV (touchscreen e leanback opcionais para nao bloquear celular nem TV).
if (!/uses-feature[^>]*android\.software\.leanback/.test(xml)) {
  xml = xml.replace(
    /(<manifest\b[^>]*>)/,
    `$1\n    <uses-feature android:name="android.software.leanback" android:required="false" />\n    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />`,
  );
}

if (xml === before) {
  console.log("ℹ️  Nada a alterar — AndroidManifest já está em landscape.");
} else {
  writeFileSync(manifestPath, xml);
  console.log("✅ AndroidManifest.xml patchado: landscape + icone TV (banner/leanback).");
}
