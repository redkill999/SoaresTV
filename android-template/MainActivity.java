package com.soarestv.app;

/*
 * =====================================================================
 * TEMPLATE de MainActivity.java — Fullscreen IMERSIVO REAL
 * =====================================================================
 *
 * COMO USAR
 * ---------
 * Depois de `bunx cap add android`, substitua o conteúdo de:
 *   android/app/src/main/java/com/soarestv/app/MainActivity.java
 * por este arquivo.
 *
 * O QUE FAZ
 * ---------
 *  - Edge-to-edge real (cobre câmera/notch via shortEdges).
 *  - Esconde status bar, navigation bar (botões voltar/home/multitarefa).
 *  - Reaplica imersivo quando o usuário desliza a tela (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE).
 *  - Compatível com Android 8 (API 26) até Android 15 (API 35).
 *  - Usa WindowInsetsController quando disponível (API 30+) e fallback
 *    SYSTEM_UI_FLAG_IMMERSIVE_STICKY para versões antigas.
 *  - NÃO mexe em nada do Capacitor / WebView / IPTV.
 */

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveMode();
    }

    private void applyImmersiveMode() {
        try {
            // Edge-to-edge: a WebView pinta atrás das barras de sistema.
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

            // Cobre área de notch / câmera frontal.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                        ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                        : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                getWindow().setAttributes(lp);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // API 30+ — WindowInsetsController moderno.
                WindowInsetsController c = getWindow().getInsetsController();
                if (c != null) {
                    c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    c.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    );
                }
            } else {
                // API 26-29 — flags legadas (sticky immersive).
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
