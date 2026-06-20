import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.soarestv.app',
  appName: 'SoaresTV',
  webDir: 'dist',
  // Estratégia "casca" (Opção A): o APK abre o site publicado no Lovable.
  // Assim o backend (server functions do TanStack Start) continua funcionando.
  // Se um dia quiser empacotar offline, remova o bloco `server` e rode `bun run build` antes de `cap sync`.
  server: {
    url: 'https://tv-magica-brasa-soarestv.lovable.app',
    cleartext: true,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    // XCIPTV-like: landscape travado e fullscreen imersivo
    backgroundColor: '#000000',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    ScreenOrientation: {
      orientation: 'landscape',
    },
    // Desativa o splash nativo do Android (a logo estática que aparecia
    // antes da animação React). Agora o APK abre direto numa tela preta
    // e a animação splash/login da WebView entra em seguida.
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      showSpinner: false,
      androidSplashResourceName: 'splash',
      splashFullScreen: true,
      splashImmersive: true,
      backgroundColor: '#000000',
    },
  },
};

export default config;
