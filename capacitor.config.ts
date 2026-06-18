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
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
