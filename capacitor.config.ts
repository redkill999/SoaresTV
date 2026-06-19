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
  },
};

export default config;
