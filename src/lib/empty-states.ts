import i18n from "@/lib/i18n";

export function emptyTitle(tab: string, itemKey: "channel" | "movie" | "series") {
  const item = i18n.t(`empty.${itemKey}`);
  if (tab === "favorites") return i18n.t("empty.noFav", { item });
  if (tab === "recent") return i18n.t("empty.noRecent", { item });
  return i18n.t("empty.noResults");
}

export function emptyHint(tab: string, search: string) {
  if (search) return i18n.t("empty.searchHint", { q: search });
  if (tab === "favorites") return i18n.t("empty.favHint");
  if (tab === "recent") return i18n.t("empty.recentHint");
  return i18n.t("empty.defaultHint");
}
