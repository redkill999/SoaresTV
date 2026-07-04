package com.soarestv.app;

/*
 * =====================================================================
 * MainActivity.java — Fullscreen imersivo + injeção de deviceType +
 *                     limpeza de cache WebView quando versionCode muda
 * =====================================================================
 *
 * COMO USAR
 * ---------
 * Depois de `bunx cap add android`, substitua o conteúdo de:
 *   android/app/src/main/java/com/soarestv/app/MainActivity.java
 * por este arquivo.
 *
 * NOVO NESTA VERSÃO
 * -----------------
 *  - Injeta window.__deviceType ("tv" | "phone" | "tablet") ANTES da
 *    WebView renderizar, usando UiModeManager + smallestScreenWidthDp.
 *    Isso resolve o layout de TV comprimido em celular.
 *  - Ao detectar mudança de versionCode do APK, chama WebView.clearCache
 *    UMA VEZ, evitando servir HTML/JS antigo do cache HTTP quando o site
 *    remoto (server.url do capacitor.config.ts) é republicado.
 *  - Fullscreen imersivo (edge-to-edge) preservado como antes.
 */

import android.app.UiModeManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String PREFS = "soarestv-native";
    private static final String KEY_LAST_VERSION_CODE = "last_version_code";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyImmersiveMode();
        clearWebViewCacheOnVersionChange();
        // A WebView do Capacitor só existe depois de super.onCreate; injetamos
        // o deviceType via evaluateJavascript no ciclo do bridge.
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                String deviceType = detectDeviceType();
                String js = "window.__deviceType='" + deviceType + "';"
                        + "try{document.documentElement.setAttribute('data-device-type','" + deviceType + "');}catch(e){}";
                webView.evaluateJavascript(js, null);
            }
        } catch (Throwable t) {
            // Não bloqueia o app se a injeção falhar — o fallback JS assume "não-TV".
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveMode();
    }

    private String detectDeviceType() {
        try {
            UiModeManager ui = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            if (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
                return "tv";
            }
            int sw = getResources().getConfiguration().smallestScreenWidthDp;
            return sw >= 600 ? "tablet" : "phone";
        } catch (Throwable t) {
            return "phone";
        }
    }

    private void clearWebViewCacheOnVersionChange() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            int last = prefs.getInt(KEY_LAST_VERSION_CODE, -1);
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            int current = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? (int) (pi.getLongVersionCode() & 0xFFFFFFFFL)
                    : pi.versionCode;
            if (last != current) {
                try {
                    WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                    if (webView != null) webView.clearCache(true);
                } catch (Throwable ignored) {}
                prefs.edit().putInt(KEY_LAST_VERSION_CODE, current).apply();
            }
        } catch (Throwable ignored) {
            // App nunca cai por causa disso.
        }
    }

    private void applyImmersiveMode() {
        try {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                        ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                        : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                getWindow().setAttributes(lp);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController c = getWindow().getInsetsController();
                if (c != null) {
                    c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    c.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    );
                }
            } else {
                int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
                getWindow().getDecorView().setSystemUiVisibility(flags);
            }
        } catch (Throwable t) {
            // Nunca derrubar o app por causa de tema/insets — IPTV continua rodando.
        }
    }
}
