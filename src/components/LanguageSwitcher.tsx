import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Languages, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SUPPORTED_LANGS, getStoredLang, setLang, type LangCode } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { t } = useTranslation();
  // Inicia em "pt" para casar com SSR; ajusta após hidratação.
  const [current, setCurrent] = useState<LangCode>("pt");

  useEffect(() => {
    const lang = getStoredLang();
    setCurrent(lang);
  }, []);

  const pick = (code: LangCode) => {
    setCurrent(code);
    setLang(code);
  };

  const active = SUPPORTED_LANGS.find((l) => l.code === current) ?? SUPPORTED_LANGS[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={t("lang.label")}
          className="bg-white/5 border-white/10 hover:bg-white/10"
        >
          <Languages className="size-4 mr-1.5" />
          <span className="hidden sm:inline">{active.flag} {active.code.toUpperCase()}</span>
          <span className="sm:hidden">{active.flag}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <div className="px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          {t("lang.label")}
        </div>
        <div className="space-y-1">
          {SUPPORTED_LANGS.map((l) => {
            const isActive = l.code === current;
            return (
              <button
                key={l.code}
                onClick={() => pick(l.code)}
                className={`w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/5 ${
                  isActive ? "bg-white/5" : ""
                }`}
              >
                <span className="text-lg leading-none">{l.flag}</span>
                <span className="flex-1 text-sm font-medium">{l.label}</span>
                {isActive && <Check className="size-4 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
