import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const fragmentPath = join(
  root,
  "node_modules/capacitor-video-player/android/src/main/java/com/jeep/plugin/capacitor/capacitorvideoplayer/FullscreenExoPlayerFragment.java",
);
const pluginPath = join(
  root,
  "node_modules/capacitor-video-player/android/src/main/java/com/jeep/plugin/capacitor/capacitorvideoplayer/CapacitorVideoPlayerPlugin.java",
);
const pkgPath = join(root, "node_modules/capacitor-video-player/package.json");

let hardFail = false;
function loud(msg) {
  console.log("====================================================");
  console.log(msg);
  console.log("====================================================");
}

function assertContains(file, checks) {
  if (!existsSync(file)) {
    loud(`[patch-video-player] VERIFICAÇÃO FALHOU: arquivo não existe: ${file}`);
    hardFail = true;
    return;
  }
  const src = readFileSync(file, "utf8");
  for (const [label, token] of checks) {
    if (src.includes(token)) {
      console.log(`[patch-video-player] VERIFICADO: ${label}`);
    } else {
      loud(`[patch-video-player] VERIFICAÇÃO FALHOU: ${label}`);
      hardFail = true;
    }
  }
}

if (existsSync(pkgPath)) {
  try {
    const v = JSON.parse(readFileSync(pkgPath, "utf8")).version;
    console.log(`[patch-video-player] capacitor-video-player versão ${v}`);
    if (!v.startsWith("6.")) {
      loud(`AVISO: patch foi escrito para 6.x mas a versão instalada é ${v}. Pode não aplicar.`);
    }
  } catch { /* ignore */ }
} else {
  loud("ERRO: node_modules/capacitor-video-player não existe. Rode 'bun install' ou 'npm install' antes de gerar o APK.");
  process.exit(1);
}

function patchFile(file, steps) {
  if (!existsSync(file)) {
    loud(`ERRO: arquivo não existe: ${file}`);
    hardFail = true;
    return;
  }
  let src = readFileSync(file, "utf8");
  const original = src;
  for (const step of steps) {
    const { name, required, mustContainAfter, apply } = step;
    // Já está aplicado? pula.
    if (mustContainAfter && src.includes(mustContainAfter)) {
      console.log(`[patch-video-player] ${name}: já aplicado`);
      continue;
    }
    const next = apply(src);
    if (next === src) {
      console.log(`[patch-video-player] ${name}: PADRÃO NÃO ENCONTRADO`);
      if (required) hardFail = true;
      continue;
    }
    src = next;
    console.log(`[patch-video-player] ${name}: aplicado`);
  }
  if (src !== original) {
    writeFileSync(file, src);
    console.log(`[patch-video-player] gravado: ${file}`);
  } else {
    console.log(`[patch-video-player] sem alterações em: ${file}`);
  }
}

patchFile(fragmentPath, [
  {
    name: "1) supportedFormat inclui ts/mpegts",
    required: true,
    mustContainAfter: '"flv", "ts", "mpegts",',
    apply: (s) => s.replace(
      'new String[] { "mp4", "webm", "ogv", "3gp", "flv", "dash", "mpd", "m3u8", "ism", "ytube", "" }',
      'new String[] { "mp4", "webm", "ogv", "3gp", "flv", "ts", "mpegts", "dash", "mpd", "m3u8", "ism", "ytube", "" }',
    ),
  },
  {
    name: "2) LoadControl tolerante (20/60s)",
    required: true,
    mustContainAfter: "setBufferDurationsMs(20000, 60000",
    apply: (s) => s.replace(
      "LoadControl loadControl = new DefaultLoadControl();",
      "LoadControl loadControl = new DefaultLoadControl.Builder()\n        .setBufferDurationsMs(20000, 60000, 4000, 8000)\n        .build();",
    ),
  },
  {
    name: "3) onPlayerError emite playerItemError",
    required: true,
    mustContainAfter: "public void onPlayerError(com.google.android.exoplayer2.PlaybackException error)",
    apply: (s) => s.replace(
      `        @Override\n        public void onPlayerStateChanged(boolean playWhenReady, int state) {`,
      `        @Override\n        public void onPlayerError(com.google.android.exoplayer2.PlaybackException error) {\n          Map<String, Object> info = new HashMap<String, Object>() {\n            {\n              put("fromPlayerId", playerId);\n              put("currentTime", String.valueOf(player != null ? player.getCurrentPosition() / 1000 : 0));\n              put("message", error != null ? error.getMessage() : "ExoPlayer error");\n              put("errorCode", error != null ? String.valueOf(error.errorCode) : "");\n              put("videoType", vType != null ? vType : "");\n              put("url", uri != null ? uri.toString() : "");\n            }\n          };\n          Log.e(TAG, "ExoPlayer error", error);\n          try {\n            NotificationCenter.defaultCenter().postNotification("playerItemError", info);\n          } catch (Exception e) {\n            Log.e(TAG, "Error in posting playerItemError");\n          }\n          playerExit();\n        }\n\n        @Override\n        public void onPlayerStateChanged(boolean playWhenReady, int state) {`,
    ),
  },
  {
    name: "4) MediaItem MIME VIDEO_MP2T para .ts",
    required: true,
    mustContainAfter: "MimeTypes.VIDEO_MP2T",
    apply: (s) => s.replace(
      `      mediaSource = new ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(MediaItem.fromUri(uri));\n    } else if (vType.equals("dash") || vType.equals("mpd")) {`,
      `      MediaItem mediaItem;\n      if (vType.equals("ts") || vType.equals("mpegts")) {\n        mediaItem = new MediaItem.Builder().setUri(uri).setMimeType(MimeTypes.VIDEO_MP2T).build();\n      } else {\n        mediaItem = MediaItem.fromUri(uri);\n      }\n      mediaSource = new ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem);\n    } else if (vType.equals("dash") || vType.equals("mpd")) {`,
    ),
  },
  {
    name: "5) getVideoType por extensão real",
    required: true,
    mustContainAfter: 'path.endsWith(".ts")) return "ts"',
    apply: (s) => s.replace(
      `  private String getVideoType(Uri uri) {\n    String ret = null;\n    Object obj = uri.getLastPathSegment();\n    String lastSegment = (obj == null) ? "" : uri.getLastPathSegment();`,
      `  private String getVideoType(Uri uri) {\n    String ret = null;\n    Object obj = uri.getLastPathSegment();\n    String lastSegment = (obj == null) ? "" : uri.getLastPathSegment();\n    String path = uri.getPath() != null ? uri.getPath().toLowerCase(Locale.ROOT) : "";\n    if (path.endsWith(".ts")) return "ts";\n    if (path.endsWith(".m3u8")) return "m3u8";\n    if (path.endsWith(".mpd")) return "mpd";`,
    ),
  },
  {
    name: "6) Watchdog BUFFERING 18s força playerExit (mostra diagnóstico)",
    required: true,
    mustContainAfter: "JEEP_BUFFER_WATCHDOG",
    apply: (s) => s.replace(
      `        @Override\n        public void onPlayerStateChanged(boolean playWhenReady, int state) {`,
      `        // JEEP_BUFFER_WATCHDOG: se ExoPlayer ficar > 18s em BUFFERING sem
        // sair, força playerExit() e posta playerItemError. Sem isso o overlay
        // nativo cobre a WebView indefinidamente e o usuário não vê diagnóstico.
        private android.os.Handler _bufferHandler = new android.os.Handler(android.os.Looper.getMainLooper());
        private Runnable _bufferTimeout = null;
        @Override
        public void onPlayerStateChanged(boolean playWhenReady, int state) {`,
    ),
  },
  {
    name: "7) Agendar/cancelar watchdog dentro de onPlayerStateChanged",
    required: true,
    mustContainAfter: "_bufferTimeout = new Runnable()",
    apply: (s) => s.replace(
      "private Runnable _bufferTimeout = null;\n        @Override\n        public void onPlayerStateChanged(boolean playWhenReady, int state) {",
      `private Runnable _bufferTimeout = null;
        private void _scheduleBufferWatchdog() {
          if (_bufferTimeout != null) _bufferHandler.removeCallbacks(_bufferTimeout);
          _bufferTimeout = new Runnable() {
            @Override
            public void run() {
              Log.e(TAG, "JEEP_BUFFER_WATCHDOG: 18s em BUFFERING; forçando exit");
              try {
                Map<String, Object> info = new HashMap<String, Object>() {{
                  put("fromPlayerId", playerId);
                  put("currentTime", "0");
                  put("message", "ExoPlayer travou em BUFFERING (18s)");
                  put("errorCode", "BUFFER_TIMEOUT");
                  put("videoType", vType != null ? vType : "");
                  put("url", uri != null ? uri.toString() : "");
                }};
                NotificationCenter.defaultCenter().postNotification("playerItemError", info);
              } catch (Exception ignored) {}
              try { playerExit(); } catch (Exception ignored) {}
            }
          };
          _bufferHandler.postDelayed(_bufferTimeout, 18000);
        }
        private void _cancelBufferWatchdog() {
          if (_bufferTimeout != null) { _bufferHandler.removeCallbacks(_bufferTimeout); _bufferTimeout = null; }
        }
        @Override
        public void onPlayerStateChanged(boolean playWhenReady, int state) {
          if (state == Player.STATE_BUFFERING) { _scheduleBufferWatchdog(); }
          else { _cancelBufferWatchdog(); }`,
    ),
  },
  {
    name: "8) hideSystemUi aplica IMMERSIVE no decorView + cutout edge-to-edge",
    required: true,
    mustContainAfter: "JEEP_FULLSCREEN_INSETS",
    apply: (s) => s.replace(
      "  private void hideSystemUi() {\n    if (styledPlayerView != null) styledPlayerView.setSystemUiVisibility(",
      `  private void hideSystemUi() {
    // JEEP_FULLSCREEN_INSETS: aplica fullscreen no decorView da Activity (não
    // só na styledPlayerView). Sem isso a status bar / navigation bar continuam
    // reservando espaço e empurram os controles do ExoPlayer para fora da tela
    // em alguns devices (TV-mode / phones com cutout / Android 11+).
    try {
      android.app.Activity act = getActivity();
      if (act != null) {
        android.view.Window win = act.getWindow();
        if (win != null) {
          win.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
          win.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
          if (android.os.Build.VERSION.SDK_INT >= 28) {
            android.view.WindowManager.LayoutParams lp = win.getAttributes();
            lp.layoutInDisplayCutoutMode =
              android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            win.setAttributes(lp);
          }
          win.getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
          );
        }
      }
    } catch (Exception ignored) {}
    if (styledPlayerView != null) styledPlayerView.setSystemUiVisibility(`,
    ),
  },
  {
    name: "9) styledPlayerView.setFitsSystemWindows(false) + consome insets",
    required: true,
    mustContainAfter: "JEEP_FIT_INSETS_OFF",
    apply: (s) => s.replace(
      "    styledPlayerView = view.findViewById(R.id.videoViewId);",
      `    styledPlayerView = view.findViewById(R.id.videoViewId);
    // JEEP_FIT_INSETS_OFF: o exo_playback_control_view tem
    // android:fitsSystemWindows="true", o que adiciona padding das system bars
    // mesmo em modo imersivo e desalinha pause/barra de progresso. Forçamos
    // fitsSystemWindows=false e consumimos os insets para zerar o padding.
    try {
      styledPlayerView.setFitsSystemWindows(false);
      styledPlayerView.setPadding(0, 0, 0, 0);
      androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(styledPlayerView, (v, insets) -> {
        v.setPadding(0, 0, 0, 0);
        return androidx.core.view.WindowInsetsCompat.CONSUMED;
      });
      View controller = styledPlayerView.findViewById(com.google.android.exoplayer2.ui.R.id.exo_controller);
      if (controller != null) {
        controller.setFitsSystemWindows(false);
        controller.setPadding(0, 0, 0, 0);
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(controller, (v, insets) -> {
          v.setPadding(0, 0, 0, 0);
          return androidx.core.view.WindowInsetsCompat.CONSUMED;
        });
      }
    } catch (Exception ignored) {}`,
    ),
  },
]);

// Patch XML do controle: remove android:fitsSystemWindows="true" do controlador
// para os botões/barra ocuparem a tela inteira em landscape (sem padding de
// status/nav bar).
const controlXmlPath = join(
  root,
  "node_modules/capacitor-video-player/android/src/main/res/layout/exo_playback_control_view.xml",
);
if (existsSync(controlXmlPath)) {
  let xml = readFileSync(controlXmlPath, "utf8");
  const before = xml;
  xml = xml.replace(/\n\s*android:fitsSystemWindows="true"\s*\n/g, "\n");
  if (xml !== before) {
    writeFileSync(controlXmlPath, xml);
    console.log("[patch-video-player] XML controles: fitsSystemWindows removido");
  } else {
    console.log("[patch-video-player] XML controles: já removido ou padrão não bateu");
  }
}

patchFile(pluginPath, [
  {
    name: "P1) addMethodForNotification playerItemError",
    required: true,
    mustContainAfter: '"playerItemError"',
    apply: (s) => s.replace(
      `        NotificationCenter\n            .defaultCenter()\n            .addMethodForNotification(\n                "playerItemEnd",`,
      `        NotificationCenter\n            .defaultCenter()\n            .addMethodForNotification(\n                "playerItemError",\n                new MyRunnable() {\n                    @Override\n                    public void run() {\n                        JSObject data = new JSObject();\n                        data.put("fromPlayerId", this.getInfo().get("fromPlayerId"));\n                        data.put("currentTime", this.getInfo().get("currentTime"));\n                        data.put("message", this.getInfo().get("message"));\n                        data.put("errorCode", this.getInfo().get("errorCode"));\n                        data.put("videoType", this.getInfo().get("videoType"));\n                        data.put("url", this.getInfo().get("url"));\n                        notifyListeners("jeepCapVideoPlayerError", data);\n                        return;\n                    }\n                }\n            );\n        NotificationCenter\n            .defaultCenter()\n            .addMethodForNotification(\n                "playerItemEnd",`,
    ),
  },
]);

assertContains(fragmentPath, [
  ["formatos .ts/.mpegts registrados", '"flv", "ts", "mpegts"'],
  ["buffer ExoPlayer 20s/60s", "setBufferDurationsMs(20000, 60000"],
  ["onPlayerError nativo", "public void onPlayerError(com.google.android.exoplayer2.PlaybackException error)"],
  ["MIME MPEG-TS no MediaItem", "MimeTypes.VIDEO_MP2T"],
  ["detecção .ts por path", 'path.endsWith(".ts")'],
  ["watchdog nativo BUFFERING", "JEEP_BUFFER_WATCHDOG"],
  ["evento BUFFER_TIMEOUT", "BUFFER_TIMEOUT"],
  ["watchdog agenda/cancela", "_scheduleBufferWatchdog()"],
  ["fullscreen insets aplicados", "JEEP_FULLSCREEN_INSETS"],
]);

assertContains(pluginPath, [
  ["notification playerItemError", '"playerItemError"'],
  ["listener JS jeepCapVideoPlayerError", "jeepCapVideoPlayerError"],
]);

if (hardFail) {
  loud("ERRO: patches OBRIGATÓRIOS falharam. APK não vai ter as correções.\nVerifique a versão de capacitor-video-player e abra um issue.");
  process.exit(1);
}

console.log("[patch-video-player] CONCLUÍDO COM SUCESSO");
