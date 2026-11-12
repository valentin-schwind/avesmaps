import { t } from "../i18n/i18n";

/**
 * MapLibres eigene Texte auf Deutsch (WI-0016, AC14).
 *
 * 🪤 Ohne diese Tafel heißt die Karte für den Screenreader „Map", und die Quellenangabe schaltet mit
 * „Toggle attribution". Übersetzt ist nur, was die Karte heute zeigt; die Schlüssel stehen in
 * MapLibres `src/ui/default_locale.ts`.
 */
/**
 * In der Sprache der Seite (WI-0032). 🪤 MapLibre liest die Tafel nur beim Anlegen der Karte: Nach
 * einem Sprachwechsel bleiben diese drei Texte bis zum Neuladen in der Startsprache.
 */
export function mapLocale(): Record<string, string> {
    return {
        "Map.Title": t("maplibre.map"),
        "AttributionControl.ToggleAttribution": t("maplibre.attribution.toggle"),
        "AttributionControl.MapFeedback": t("maplibre.attribution.feedback"),
    };
}
