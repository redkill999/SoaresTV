import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.soarestv.app',
  appName: 'SoaresTV',
  webDir: 'dist',
  // Estratégia "casca" (Opção A): o APK abre o site publicado no Lovable.
  // Assim o backend (server functions do TanStack Start) continua funcionando.
  // URL estável do projeto: não muda se o subdomínio publicado for renomeado,
  // garantindo que APKs instalados não quebrem após mudança de slug.
  // Se um dia quiser empacotar offline, remova o bloco `server` e rode `bun run build` antes de `cap sync`.
  server: {
    // URL publicada do app. Se você renomear o projeto no Lovable,
    // atualize esta URL e gere um novo APK.
    url: 'https://tv-magica-brasa-soarestv.lovable.app',
    cleartext: true,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    // XCIPTV-like: landscape travado e fullscreen imersivo
    backgroundColor: '#000000',
    // Permite debug remoto via chrome://inspect só em builds dev.
    webContentsDebuggingEnabled: false,
    // Trata navegação para domínios diferentes do host como link externo
    // em vez de carregar dentro do WebView (evita ficar "preso" se um
    // anúncio/redirect aparecer).
    captureInput: true,
  },
  plugins: {
    // IMPORTANTE: manter desabilitado. Quando `enabled: true`, o plugin
    // intercepta fetch/XHR da WebView e quebra streaming HLS (.m3u8/.ts),
    // fazendo a lista carregar mas os canais não rodarem.
    CapacitorHttp: {
      enabled: false,
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
