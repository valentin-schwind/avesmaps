import type { MessageKey } from "../i18n/de";
import { LOCALES, type Locale } from "../i18n/i18n";

/**
 * Die Sprachdimension der Besucherstatistik (WI-0168): jede Sprache der Oberfläche unter ihrem Namen, nicht nur Deutsch und
 * Englisch.
 *
 * Gezählt wird die Sprache des **Browsers**, nicht die auf der Seite gewählte: die erste Marke aus `Accept-Language`, auf zwei
 * Buchstaben gekürzt (`spracheAus`, `apps/server/src/besucher/zaehler.ts`), ohne Kopfzeile „ohne“. Der Server liefert also
 * jeden Code, den ein Browser schickt. Unsere Sprachen bekommen ihren Namen aus der Tafel; jede andere steht weiter als
 * Kürzel da, wie bisher.
 *
 * 🔴 Der Schlüssel wird aus `Locale` gebaut, nicht aufgezählt: Eine Sprache in `LOCALES` ohne `statistik.wert.<code>` in
 * `de.ts` ist ein Typfehler. Bis WI-0168 stand hier eine feste Liste aus `de` und `en`, und Französisch, Niederländisch
 * und Italienisch erschienen als Rohwert.
 */
export const sprachWertSchluessel = (lang: Locale): MessageKey => `statistik.wert.${lang}`;

/** Ausprägung → Schlüssel, zum Einmischen in die Namen der Statistik (`editor-status.vue`). */
export const SPRACH_WERT_NAMEN: Readonly<Record<string, MessageKey>> = Object.fromEntries(
    LOCALES.map((lang) => [lang, sprachWertSchluessel(lang)]),
);
