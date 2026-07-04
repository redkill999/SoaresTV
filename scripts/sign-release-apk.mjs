#!/usr/bin/env node
// ============================================================================
//  sign-release-apk.mjs — assina o APK release do SoaresTV com uma keystore
//  LOCAL DE DESENVOLVIMENTO gerada automaticamente.
//
//  ATENÇÃO: essa keystore vive em `.tools/soarestv-release.keystore` e é
//  descartável. Serve APENAS para instalar o APK no seu próprio celular/TV
//  para teste. NÃO SERVE para publicar na Play Store — publicação exige
//  keystore próprio guardado com segurança (perder o keystore = perder o
//  app na Play Store).
//
//  Usa `apksigner` do Android SDK build-tools (preferido) e cai para
//  `jarsigner` do JDK como fallback. `zipalign` (build-tools) é aplicado
//  antes quando disponível.
// ============================================================================
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const APK_DIR = join(ROOT, "android/app/build/outputs/apk/release");
const UNSIGNED = join(APK_DIR, "app-release-unsigned.apk");
const ALIGNED = join(APK_DIR, "app-release-aligned.apk");
const SIGNED = join(APK_DIR, "app-release-signed.apk");
const KEYSTORE_DIR = join(ROOT, ".tools");
const KEYSTORE = join(KEYSTORE_DIR, "soarestv-release.keystore");
const KEY_ALIAS = "soarestv";
const KEY_PASS = "soarestv-local";

function log(msg) { console.log(`[sign-release-apk] ${msg}`); }
function warn(msg) { console.warn(`[sign-release-apk] AVISO: ${msg}`); }
function die(msg) { console.error(`[sign-release-apk] ERRO: ${msg}`); process.exit(1); }

function run(cmd, args) {
  return execFileSync(cmd, args, { stdio: "inherit" });
}

function which(bin) {
  try {
    const cmd = process.platform === "win32" ? `where ${bin}` : `command -v ${bin}`;
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split(/\r?\n/)[0] || null;
  } catch { return null; }
}

function findBuildToolsBinary(binName) {
  const exe = process.platform === "win32" ? `${binName}.bat` : binName;
  const exeAlt = process.platform === "win32" ? `${binName}.exe` : binName;
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const btDir = join(sdk, "build-tools");
    if (existsSync(btDir)) {
      const versions = readdirSync(btDir)
        .filter((d) => { try { return statSync(join(btDir, d)).isDirectory(); } catch { return false; } })
        .sort()
        .reverse();
      for (const v of versions) {
        for (const name of [exe, exeAlt, binName]) {
          const p = join(btDir, v, name);
          if (existsSync(p)) return p;
        }
      }
    }
  }
  return which(binName);
}

if (!existsSync(UNSIGNED)) {
  die(`APK release não encontrado em ${UNSIGNED}. Rode assembleRelease antes.`);
}

// 1) Garante keystore local
if (!existsSync(KEYSTORE)) {
  log("Nenhum keystore local encontrado — gerando um novo em .tools/soarestv-release.keystore");
  log("(uso local apenas; NÃO publicar na Play Store com este keystore)");
  mkdirSync(KEYSTORE_DIR, { recursive: true });
  const keytool = which("keytool");
  if (!keytool) die("`keytool` não encontrado no PATH. Instale o JDK 17+.");
  run(keytool, [
    "-genkeypair", "-v",
    "-keystore", KEYSTORE,
    "-alias", KEY_ALIAS,
    "-keyalg", "RSA", "-keysize", "2048",
    "-validity", "10000",
    "-storepass", KEY_PASS, "-keypass", KEY_PASS,
    "-dname", "CN=SoaresTV Local,O=SoaresTV,C=BR",
  ]);
} else {
  log("Keystore local já existe — reutilizando .tools/soarestv-release.keystore");
}

// 2) zipalign (opcional mas recomendado)
const zipalign = findBuildToolsBinary("zipalign");
let toSign = UNSIGNED;
if (zipalign) {
  log(`zipalign encontrado: ${zipalign}`);
  run(zipalign, ["-f", "-p", "4", UNSIGNED, ALIGNED]);
  toSign = ALIGNED;
} else {
  warn("zipalign não encontrado no Android SDK build-tools — pulando alinhamento.");
}

// 3) Assina — prefere apksigner, fallback pra jarsigner
const apksigner = findBuildToolsBinary("apksigner");
if (apksigner) {
  log(`apksigner encontrado: ${apksigner}`);
  run(apksigner, [
    "sign",
    "--ks", KEYSTORE,
    "--ks-key-alias", KEY_ALIAS,
    "--ks-pass", `pass:${KEY_PASS}`,
    "--key-pass", `pass:${KEY_PASS}`,
    "--out", SIGNED,
    toSign,
  ]);
} else {
  const jarsigner = which("jarsigner");
  if (!jarsigner) die("Nem apksigner (Android SDK) nem jarsigner (JDK) encontrados.");
  warn("apksigner não encontrado — usando jarsigner (fallback).");
  // jarsigner assina in-place
  if (toSign !== SIGNED) renameSync(toSign, SIGNED);
  run(jarsigner, [
    "-verbose",
    "-sigalg", "SHA256withRSA",
    "-digestalg", "SHA-256",
    "-keystore", KEYSTORE,
    "-storepass", KEY_PASS,
    "-keypass", KEY_PASS,
    SIGNED, KEY_ALIAS,
  ]);
}

log("========================================================");
log(`APK release ASSINADO (para instalação local): ${SIGNED}`);
log("Este APK é instalável em qualquer celular/TV para TESTE PESSOAL.");
log("NÃO use este keystore para publicar na Play Store.");
log("========================================================");
