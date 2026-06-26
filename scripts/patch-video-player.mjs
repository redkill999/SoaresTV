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

function patchFile(file, patcher) {
  if (!existsSync(file)) {
    console.log(`[patch-video-player] ignorado: ${file} não existe`);
    return;
  }
  const before = readFileSync(file, "utf8");
  const after = patcher(before);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`[patch-video-player] aplicado: ${file}`);
  } else {
    console.log(`[patch-video-player] ok: ${file}`);
  }
}

patchFile(fragmentPath, (src) => {
  let out = src;

  // 1) O plugin original não reconhece .ts. Em IPTV live Xtream isso deixa
  // vType="" e o ExoPlayer entra em Progressive genérico sem MIME, podendo
  // ficar eternamente em BUFFERING no APK. Registramos .ts explicitamente.
  out = out.replace(
    'new String[] { "mp4", "webm", "ogv", "3gp", "flv", "dash", "mpd", "m3u8", "ism", "ytube", "" }',
    'new String[] { "mp4", "webm", "ogv", "3gp", "flv", "ts", "mpegts", "dash", "mpd", "m3u8", "ism", "ytube", "" }',
  );

  // 2) Buffer mais tolerante para LIVE/TS/H265: evita travadas curtas virarem
  // erro visual. Não muda VOD/web; só o ExoPlayer nativo do APK.
  out = out.replace(
    'LoadControl loadControl = new DefaultLoadControl();',
    `LoadControl loadControl = new DefaultLoadControl.Builder()\n        .setBufferDurationsMs(20000, 60000, 4000, 8000)\n        .build();`,
  );

  // 3) Evento real de erro do ExoPlayer. O plugin original quase não emite erro
  // para JS, então a WebView não consegue exibir diagnóstico quando o overlay
  // nativo fica preso no loading. Postamos playerItemError e fechamos o overlay.
  if (!out.includes("public void onPlayerError")) {
    out = out.replace(
      `        @Override\n        public void onPlayerStateChanged(boolean playWhenReady, int state) {`,
      `        @Override\n        public void onPlayerError(com.google.android.exoplayer2.PlaybackException error) {\n          Map<String, Object> info = new HashMap<String, Object>() {\n            {\n              put("fromPlayerId", playerId);\n              put("currentTime", String.valueOf(player != null ? player.getCurrentPosition() / 1000 : 0));\n              put("message", error != null ? error.getMessage() : "ExoPlayer error");\n              put("errorCode", error != null ? String.valueOf(error.errorCode) : "");\n              put("videoType", vType != null ? vType : "");\n              put("url", uri != null ? uri.toString() : "");\n            }\n          };\n          Log.e(TAG, "ExoPlayer error", error);\n          try {\n            NotificationCenter.defaultCenter().postNotification("playerItemError", info);\n          } catch (Exception e) {\n            Log.e(TAG, "Error in posting playerItemError");\n          }\n          playerExit();\n        }\n\n        @Override\n        public void onPlayerStateChanged(boolean playWhenReady, int state) {`,
    );
  }

  // 4) Para .ts/.mpegts, cria MediaItem com MIME VIDEO_MP2T. Isso força o
  // extractor correto do ExoPlayer em vez de depender de sniffing frágil.
  out = out.replace(
    `      mediaSource = new ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(MediaItem.fromUri(uri));\n    } else if (vType.equals("dash") || vType.equals("mpd")) {`,
    `      MediaItem mediaItem;\n      if (vType.equals("ts") || vType.equals("mpegts")) {\n        mediaItem = new MediaItem.Builder().setUri(uri).setMimeType(MimeTypes.VIDEO_MP2T).build();\n      } else {\n        mediaItem = MediaItem.fromUri(uri);\n      }\n      mediaSource = new ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem);\n    } else if (vType.equals("dash") || vType.equals("mpd")) {`,
  );

  // 5) getVideoType por extensão real. A versão original usa contains(), então
  // pode confundir parâmetros/segmentos e também aceita "" cedo demais.
  if (!out.includes('String path = uri.getPath() != null ? uri.getPath().toLowerCase(Locale.ROOT) : "";')) {
    out = out.replace(
      `  private String getVideoType(Uri uri) {\n    String ret = null;\n    Object obj = uri.getLastPathSegment();\n    String lastSegment = (obj == null) ? "" : uri.getLastPathSegment();`,
      `  private String getVideoType(Uri uri) {\n    String ret = null;\n    Object obj = uri.getLastPathSegment();\n    String lastSegment = (obj == null) ? "" : uri.getLastPathSegment();\n    String path = uri.getPath() != null ? uri.getPath().toLowerCase(Locale.ROOT) : "";\n    if (path.endsWith(".ts")) return "ts";\n    if (path.endsWith(".m3u8")) return "m3u8";\n    if (path.endsWith(".mpd")) return "mpd";`,
    );
  }

  return out;
});

patchFile(pluginPath, (src) => {
  let out = src;
  if (!out.includes('"playerItemError"')) {
    out = out.replace(
      `        NotificationCenter\n            .defaultCenter()\n            .addMethodForNotification(\n                "playerItemEnd",`,
      `        NotificationCenter\n            .defaultCenter()\n            .addMethodForNotification(\n                "playerItemError",\n                new MyRunnable() {\n                    @Override\n                    public void run() {\n                        JSObject data = new JSObject();\n                        data.put("fromPlayerId", this.getInfo().get("fromPlayerId"));\n                        data.put("currentTime", this.getInfo().get("currentTime"));\n                        data.put("message", this.getInfo().get("message"));\n                        data.put("errorCode", this.getInfo().get("errorCode"));\n                        data.put("videoType", this.getInfo().get("videoType"));\n                        data.put("url", this.getInfo().get("url"));\n                        notifyListeners("jeepCapVideoPlayerError", data);\n                        return;\n                    }\n                }\n            );\n        NotificationCenter\n            .defaultCenter()\n            .addMethodForNotification(\n                "playerItemEnd",`,
    );
  }
  return out;
});