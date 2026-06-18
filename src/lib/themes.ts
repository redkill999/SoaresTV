export type ThemePreset = {
  id: string;
  name: string;
  swatches: string[]; // for preview
  vars: Record<string, string>;
};

export const THEMES: ThemePreset[] = [
  {
    id: "sunset",
    name: "Sunset (padrão)",
    swatches: ["#6d28d9", "#db2777", "#f43f5e", "#fb923c"],
    vars: {
      "--background": "oklch(0.15 0.04 320)",
      "--foreground": "oklch(0.98 0.01 0)",
      "--card": "oklch(0.20 0.05 318)",
      "--muted-foreground": "oklch(0.78 0.03 0)",
      "--primary": "oklch(0.62 0.24 340)",
      "--ring": "oklch(0.62 0.24 340)",
      "--gradient-brand":
        "linear-gradient(135deg, oklch(0.45 0.22 310) 0%, oklch(0.55 0.25 340) 55%, oklch(0.62 0.22 25) 100%)",
      "--gradient-bg":
        "radial-gradient(ellipse at top left, oklch(0.18 0.06 320) 0%, oklch(0.10 0.03 290) 60%)",
      "--shadow-glow": "0 20px 60px -20px oklch(0.55 0.25 340 / 0.55)",
    },
  },
  {
    id: "midnight",
    name: "Midnight Indigo",
    swatches: ["#0a0a1a", "#1e1e5a", "#4f46e5", "#818cf8"],
    vars: {
      "--background": "oklch(0.12 0.04 270)",
      "--foreground": "oklch(0.98 0.01 270)",
      "--card": "oklch(0.18 0.05 265)",
      "--muted-foreground": "oklch(0.78 0.03 270)",
      "--primary": "oklch(0.62 0.22 270)",
      "--ring": "oklch(0.62 0.22 270)",
      "--gradient-brand":
        "linear-gradient(135deg, oklch(0.30 0.15 280) 0%, oklch(0.45 0.22 265) 55%, oklch(0.60 0.22 250) 100%)",
      "--gradient-bg":
        "radial-gradient(ellipse at top, oklch(0.20 0.08 275) 0%, oklch(0.08 0.03 270) 60%)",
      "--shadow-glow": "0 20px 60px -20px oklch(0.55 0.22 265 / 0.55)",
    },
  },
  {
    id: "ocean",
    name: "Ocean Deep",
    swatches: ["#0c2340", "#1a4a6e", "#2d8a9e", "#5cbdb9"],
    vars: {
      "--background": "oklch(0.14 0.04 230)",
      "--foreground": "oklch(0.98 0.01 220)",
      "--card": "oklch(0.20 0.05 225)",
      "--muted-foreground": "oklch(0.80 0.03 220)",
      "--primary": "oklch(0.68 0.14 210)",
      "--ring": "oklch(0.68 0.14 210)",
      "--gradient-brand":
        "linear-gradient(135deg, oklch(0.30 0.10 240) 0%, oklch(0.45 0.14 220) 55%, oklch(0.65 0.14 195) 100%)",
      "--gradient-bg":
        "radial-gradient(ellipse at top, oklch(0.20 0.06 230) 0%, oklch(0.09 0.03 230) 60%)",
      "--shadow-glow": "0 20px 60px -20px oklch(0.55 0.16 220 / 0.55)",
    },
  },
  {
    id: "emerald",
    name: "Emerald Prestige",
    swatches: ["#064e3b", "#0d7a5f", "#c9a84c", "#f5f0e0"],
    vars: {
      "--background": "oklch(0.13 0.04 170)",
      "--foreground": "oklch(0.98 0.01 100)",
      "--card": "oklch(0.19 0.05 170)",
      "--muted-foreground": "oklch(0.80 0.03 100)",
      "--primary": "oklch(0.62 0.15 165)",
      "--ring": "oklch(0.75 0.14 85)",
      "--gradient-brand":
        "linear-gradient(135deg, oklch(0.35 0.12 165) 0%, oklch(0.50 0.14 160) 55%, oklch(0.72 0.14 85) 100%)",
      "--gradient-bg":
        "radial-gradient(ellipse at top, oklch(0.20 0.07 170) 0%, oklch(0.08 0.03 170) 60%)",
      "--shadow-glow": "0 20px 60px -20px oklch(0.55 0.14 165 / 0.55)",
    },
  },
  {
    id: "ember",
    name: "Charcoal Ember",
    swatches: ["#1a1a1a", "#2d2d2d", "#e85d3a", "#fbbf24"],
    vars: {
      "--background": "oklch(0.13 0.01 30)",
      "--foreground": "oklch(0.98 0.01 60)",
      "--card": "oklch(0.18 0.01 30)",
      "--muted-foreground": "oklch(0.80 0.02 60)",
      "--primary": "oklch(0.68 0.20 35)",
      "--ring": "oklch(0.68 0.20 35)",
      "--gradient-brand":
        "linear-gradient(135deg, oklch(0.30 0.05 30) 0%, oklch(0.58 0.20 35) 55%, oklch(0.78 0.16 75) 100%)",
      "--gradient-bg":
        "radial-gradient(ellipse at top, oklch(0.20 0.04 30) 0%, oklch(0.08 0.01 30) 60%)",
      "--shadow-glow": "0 20px 60px -20px oklch(0.60 0.20 35 / 0.55)",
    },
  },
];

const KEY = "soarestv.theme";

export function getStoredTheme(): string {
  if (typeof localStorage === "undefined") return THEMES[0].id;
  return localStorage.getItem(KEY) ?? THEMES[0].id;
}

export function applyTheme(id: string) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v);
  }
  try {
    localStorage.setItem(KEY, theme.id);
  } catch {}
}
