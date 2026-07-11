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
    name: "1) supportedFormat inclui ts/mpegts + containers de séries",
    required: true,
    mustContainAfter: '"flv", "mkv", "avi", "m4v", "mov", "ts", "mpegts",',
    apply: (s) => s
      .replace(
        'new String[] { "mp4", "webm", "ogv", "3gp", "flv", "dash", "mpd", "m3u8", "ism", "ytube", "" }',
        'new String[] { "mp4", "webm", "ogv", "3gp", "flv", "mkv", "avi", "m4v", "mov", "ts", "mpegts", "dash", "mpd", "m3u8", "ism", "ytube", "" }',
      )
      .replace(
        'new String[] { "mp4", "webm", "ogv", "3gp", "flv", "ts", "mpegts", "dash", "mpd", "m3u8", "ism", "ytube", "" }',
        'new String[] { "mp4", "webm", "ogv", "3gp", "flv", "mkv", "avi", "m4v", "mov", "ts", "mpegts", "dash", "mpd", "m3u8", "ism", "ytube", "" }',
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
    name: "4) Progressive MediaSource para VOD de séries (.mkv/.avi/.m4v/.mov/.ts)",
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
    mustContainAfter: 'path.endsWith(".mkv")) return "mkv"',
    apply: (s) => s
      .replace(
        `  private String getVideoType(Uri uri) {\n    String ret = null;\n    Object obj = uri.getLastPathSegment();\n    String lastSegment = (obj == null) ? "" : uri.getLastPathSegment();\n    String path = uri.getPath() != null ? uri.getPath().toLowerCase(Locale.ROOT) : "";\n    if (path.endsWith(".ts")) return "ts";\n    if (path.endsWith(".m3u8")) return "m3u8";\n    if (path.endsWith(".mpd")) return "mpd";`,
        `  private String getVideoType(Uri uri) {\n    String ret = null;\n    Object obj = uri.getLastPathSegment();\n    String lastSegment = (obj == null) ? "" : uri.getLastPathSegment();\n    String path = uri.getPath() != null ? uri.getPath().toLowerCase(Locale.ROOT) : "";\n    if (path.endsWith(".ts")) return "ts";\n    if (path.endsWith(".mkv")) return "mkv";\n    if (path.endsWith(".avi")) return "avi";\n    if (path.endsWith(".m4v")) return "m4v";\n    if (path.endsWith(".mov")) return "mov";\n    if (path.endsWith(".m3u8")) return "m3u8";\n    if (path.endsWith(".mpd")) return "mpd";`,
      )
      .replace(
        `  private String getVideoType(Uri uri) {\n    String ret = null;\n    Object obj = uri.getLastPathSegment();\n    String lastSegment = (obj == null) ? "" : uri.getLastPathSegment();`,
        `  private String getVideoType(Uri uri) {\n    String ret = null;\n    Object obj = uri.getLastPathSegment();\n    String lastSegment = (obj == null) ? "" : uri.getLastPathSegment();\n    String path = uri.getPath() != null ? uri.getPath().toLowerCase(Locale.ROOT) : "";\n    if (path.endsWith(".ts")) return "ts";\n    if (path.endsWith(".mkv")) return "mkv";\n    if (path.endsWith(".avi")) return "avi";\n    if (path.endsWith(".m4v")) return "m4v";\n    if (path.endsWith(".mov")) return "mov";\n    if (path.endsWith(".m3u8")) return "m3u8";\n    if (path.endsWith(".mpd")) return "mpd";`,
      ),
  },
  {
    name: "6) Watchdog BUFFERING 45s força playerExit (mostra diagnóstico)",
    required: true,
    mustContainAfter: "JEEP_BUFFER_WATCHDOG",
    apply: (s) => s.replace(
      `        @Override\n        public void onPlayerStateChanged(boolean playWhenReady, int state) {`,
      `        // JEEP_BUFFER_WATCHDOG: se ExoPlayer ficar > 45s em BUFFERING sem
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
              Log.e(TAG, "JEEP_BUFFER_WATCHDOG: 45s em BUFFERING; forçando exit");
              try {
                Map<String, Object> info = new HashMap<String, Object>() {{
                  put("fromPlayerId", playerId);
                  put("currentTime", "0");
                  put("message", "ExoPlayer travou em BUFFERING (45s)");
                  put("errorCode", "BUFFER_TIMEOUT");
                  put("videoType", vType != null ? vType : "");
                  put("url", uri != null ? uri.toString() : "");
                }};
                NotificationCenter.defaultCenter().postNotification("playerItemError", info);
              } catch (Exception ignored) {}
              try { playerExit(); } catch (Exception ignored) {}
            }
          };
          _bufferHandler.postDelayed(_bufferTimeout, 45000);
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
  {
    name: "10) ExoPlayer agenda mesmo layout do botão expandir na abertura",
    required: true,
    mustContainAfter: "JEEP_AUTOFIT_CONTROLS_ON_OPEN",
    apply: (s) => s.replace(
      "    styledPlayerView.setShowPreviousButton(false);\n    styledPlayerView.setShowNextButton(false);\n    styledPlayerView.setShowFastForwardButton(false);\n    styledPlayerView.setShowRewindButton(false);",
      `    styledPlayerView.setShowPreviousButton(false);
    styledPlayerView.setShowNextButton(false);
    styledPlayerView.setShowFastForwardButton(false);
    styledPlayerView.setShowRewindButton(false);
    // JEEP_AUTOFIT_CONTROLS_ON_OPEN: não basta setar FILL cedo; em alguns APKs
    // os controles (pause/barra) só recalculam o tamanho depois do botão expandir.
    // Agenda o mesmo ajuste após o layout inicial do controller.
    try { styledPlayerView.postDelayed(() -> forceExpandedControlLayout(), 250); } catch (Exception ignored) {}`,
    ),
  },
  {
    name: "11) helper força controles no mesmo estado do expandir",
    required: true,
    mustContainAfter: "JEEP_FORCE_EXPANDED_CONTROLS",
    apply: (s) => s.replace(
      `  /**
   * Show controller
   */
  public void showController() {
    styledPlayerView.showController();
  }`,
      `  /**
   * Show controller
   */
  public void showController() {
    styledPlayerView.showController();
  }

  private void forceExpandedControlLayout() {
    // JEEP_FORCE_EXPANDED_CONTROLS: replica automaticamente o estado visual que
    // o usuário obtém ao apertar o botão expandir: vídeo e controller ocupando
    // match_parent, sem padding de system bars, com pause central e barra de
    // progresso alinhados ao player desde a primeira abertura.
    try {
      if (styledPlayerView == null) return;
      hideSystemUi();
      styledPlayerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FILL);
      resizeStatus = AspectRatioFrameLayout.RESIZE_MODE_FILL;
      if (resizeBtn != null) resizeBtn.setImageResource(R.drawable.ic_zoom);
      ViewGroup.LayoutParams vp = styledPlayerView.getLayoutParams();
      if (vp != null) {
        vp.width = ViewGroup.LayoutParams.MATCH_PARENT;
        vp.height = ViewGroup.LayoutParams.MATCH_PARENT;
        styledPlayerView.setLayoutParams(vp);
      }
      styledPlayerView.setPadding(0, 0, 0, 0);
      View controller = styledPlayerView.findViewById(com.google.android.exoplayer2.ui.R.id.exo_controller);
      if (controller != null) {
        ViewGroup.LayoutParams cp = controller.getLayoutParams();
        if (cp != null) {
          cp.width = ViewGroup.LayoutParams.MATCH_PARENT;
          cp.height = ViewGroup.LayoutParams.MATCH_PARENT;
          controller.setLayoutParams(cp);
        }
        controller.setPadding(0, 0, 0, 0);
        controller.requestLayout();
      }
      styledPlayerView.requestLayout();
      styledPlayerView.invalidate();
    } catch (Exception ignored) {}
  }`,
    ),
  },
  {
    name: "12) STATE_READY refaz layout expandido após controller existir",
    required: true,
    mustContainAfter: "JEEP_READY_REFIT_CONTROLS",
    apply: (s) => s.replace(
      `              linearLayout.setVisibility(View.INVISIBLE);
              Log.v(TAG, "**** in ExoPlayer.STATE_READY firstReadyToPlay " + firstReadyToPlay);`,
      `              linearLayout.setVisibility(View.INVISIBLE);
              // JEEP_READY_REFIT_CONTROLS: no READY o controller já foi inflado;
              // refaz o mesmo ajuste do expandir para alinhar pause/progresso.
              try { styledPlayerView.post(() -> forceExpandedControlLayout()); } catch (Exception ignored) {}
              Log.v(TAG, "**** in ExoPlayer.STATE_READY firstReadyToPlay " + firstReadyToPlay);`,
    ),
  },
  {
    name: "13) adjustAspectRatio sempre mantém layout expandido",
    required: true,
    mustContainAfter: "JEEP_KEEP_LANDSCAPE_FILL",
    apply: (s) => s.replace(
      `  private void adjustAspectRatio() {
    if (getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE) {
      styledPlayerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FILL);
    } else if (getResources().getConfiguration().orientation == Configuration.ORIENTATION_PORTRAIT) {
      styledPlayerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
    }
  }`,
      `  private void adjustAspectRatio() {
    // JEEP_KEEP_LANDSCAPE_FILL: APK/TV é landscape fixo. Nunca voltar para FIT
    // automaticamente, porque FIT é exatamente o estado desalinhado que só era
    // corrigido ao tocar no botão expandir.
    forceExpandedControlLayout();
  }`,
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
  // Remove "android:fitsSystemWindows="true"" tanto no meio da tag (espaço antes)
  // quanto no fim (fecha com ">"). Mantém o ">" da tag se for o caso.
  xml = xml.replace(/\s+android:fitsSystemWindows="true"(?=\s|>)/g, "");
  if (xml !== before) {
    writeFileSync(controlXmlPath, xml);
    console.log("[patch-video-player] XML controles: fitsSystemWindows removido");
  } else {
    console.log("[patch-video-player] XML controles: já removido ou padrão não bateu");
  }
}

// Patch XML da tela fullscreen: remove fitsSystemWindows também do fragmento
// externo/progress bar. Se sobrar em qualquer camada, Android pode reservar
// padding de status/navigation bar até o usuário tocar no resize.
const fragmentXmlPath = join(
  root,
  "node_modules/capacitor-video-player/android/src/main/res/layout/fragment_fs_exoplayer.xml",
);
if (existsSync(fragmentXmlPath)) {
  let xml = readFileSync(fragmentXmlPath, "utf8");
  const before = xml;
  xml = xml.replace(/\s+android:fitsSystemWindows="true"(?=\s|>)/g, "");
  if (xml !== before) {
    writeFileSync(fragmentXmlPath, xml);
    console.log("[patch-video-player] XML fullscreen: fitsSystemWindows removido");
  } else {
    console.log("[patch-video-player] XML fullscreen: já removido ou padrão não bateu");
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
  ["formatos VOD série registrados", '"flv", "mkv", "avi", "m4v", "mov", "ts", "mpegts"'],
  ["buffer ExoPlayer 20s/60s", "setBufferDurationsMs(20000, 60000"],
  ["onPlayerError nativo", "public void onPlayerError(com.google.android.exoplayer2.PlaybackException error)"],
  ["MIME MPEG-TS no MediaItem", "MimeTypes.VIDEO_MP2T"],
  ["detecção .ts por path", 'path.endsWith(".ts")'],
  ["detecção .mkv por path", 'path.endsWith(".mkv")'],
  ["watchdog nativo BUFFERING", "JEEP_BUFFER_WATCHDOG"],
  ["evento BUFFER_TIMEOUT", "BUFFER_TIMEOUT"],
  ["watchdog agenda/cancela", "_scheduleBufferWatchdog()"],
  ["fullscreen insets aplicados", "JEEP_FULLSCREEN_INSETS"],
  ["fitsSystemWindows desligado", "JEEP_FIT_INSETS_OFF"],
  ["autofit controles na abertura", "JEEP_AUTOFIT_CONTROLS_ON_OPEN"],
  ["helper controles expandidos", "JEEP_FORCE_EXPANDED_CONTROLS"],
  ["refit no READY", "JEEP_READY_REFIT_CONTROLS"],
  ["landscape mantém FILL", "JEEP_KEEP_LANDSCAPE_FILL"],
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
