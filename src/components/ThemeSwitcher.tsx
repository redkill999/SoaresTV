import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { THEMES, applyTheme, getStoredTheme } from "@/lib/themes";
import { Palette, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);
  return <>{children}</>;
}

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string>(THEMES[0].id);

  useEffect(() => {
    setCurrent(getStoredTheme());
  }, []);

  const pick = (id: string) => {
    setCurrent(id);
    applyTheme(id);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-white/5 border-white/10 hover:bg-white/10"
        >
          <Palette className="size-4 mr-1.5" />
          {t("theme.label")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          {t("theme.label")}
        </div>
        <div className="space-y-1">
          {THEMES.map((t) => {
            const active = t.id === current;
            return (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/5 ${
                  active ? "bg-white/5" : ""
                }`}
              >
                <div
                  className="size-10 rounded-md shrink-0 border border-white/10"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${t.swatches.join(", ")})`,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.name}</div>
                  <div className="flex gap-1 mt-1">
                    {t.swatches.map((c, i) => (
                      <span
                        key={i}
                        className="size-3 rounded-full border border-white/10"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
                {active && <Check className="size-4 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
