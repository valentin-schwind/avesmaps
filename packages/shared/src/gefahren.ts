import type { EditorLandscapeLayer } from "./landscape-editor.ts";

/**
 * Gefährliche Gebiete (WI-0308; Vali 2026-11-11 und 2026-11-12, §1 des Work Items): Eine Landschaftsfläche trägt eine Gefahrenlage aus
 * null bis zwölf Gefahrenarten (`region.hazards`, Migration 0341).
 *
 * - **Der Katalog** in der Reihenfolge, in der Vali die Arten nannte; „ungefährlich“ ist keine Art, sondern die leere Auswahl und
 *   steht im Menü immer oben (Antwort 5). Die Schlüssel sind fest: Sie stehen in der Datenbank, im Protokoll und im Teilen-Link. Die
 *   Namen kommen aus den Sprachtafeln (`gefahr.art.<schlüssel>`).
 * - **Wo sie wirkt:** nur in Derographie, Vegetation und Topographie (Antwort 6). Wechselt eine Fläche in eine andere Ebene, ruht
 *   ihre Gefahrenlage: Sie bleibt gespeichert, schraffiert nicht, warnt nicht und wird nicht gemieden, und sie gilt wieder, sobald
 *   die Fläche zurückwechselt (Antwort 10). Darum liest jede Wirkung (Kachel, Wegfindung, Warnung, Infopanel) über `gefahrWirkt`.
 * - Beim Meiden zählen alle Arten gleich (Antwort 4): Eine Fläche mit mindestens einer Art ist ein gefährliches Gebiet.
 */
export const GEFAHREN_ARTEN = [
    "kriegsgebiet",
    "feindselige_bewohner",
    "kriminalitaet",
    "kreaturen",
    "daemonisch",
    "verbotenes_heiligtum",
    "seuche",
    "naturgefahren",
    "extremwetter",
    "wildnis",
    "sperrgebiet",
    "unerforscht",
] as const;
export type GefahrenArt = (typeof GEFAHREN_ARTEN)[number];

/** Die Ebenen, in denen eine Gefahrenlage wirkt; `klima` (und jede künftige Ebene) nicht. */
export const GEFAHR_EBENEN: readonly EditorLandscapeLayer[] = ["derographisch", "vegetation", "topographie"];

export const istGefahrenArt = (wert: string): wert is GefahrenArt =>
    (GEFAHREN_ARTEN as readonly string[]).includes(wert);

/** Wirkt eine Gefahrenlage in dieser Ebene? Sonst ruht sie (Antwort 10). */
export const gefahrWirkt = (ebene: string): boolean => (GEFAHR_EBENEN as readonly string[]).includes(ebene);

/** Die Arten in der Folge des Katalogs, jede einmal; Unbekanntes fällt weg. */
export function ordneGefahren(arten: Iterable<string>): GefahrenArt[] {
    const gewaehlt = new Set(arten);
    return GEFAHREN_ARTEN.filter((art) => gewaehlt.has(art));
}

/** Die wirksamen Arten einer Fläche: in einer Ebene, in der die Gefahrenlage ruht, keine. */
export const wirksameGefahren = (ebene: string, arten: Iterable<string>): GefahrenArt[] =>
    gefahrWirkt(ebene) ? ordneGefahren(arten) : [];

/** Zwei Auswahlen gleich (ohne Rücksicht auf Folge und Dopplung)? */
export function gleicheGefahren(a: Iterable<string>, b: Iterable<string>): boolean {
    const x = ordneGefahren(a);
    const y = ordneGefahren(b);
    return x.length === y.length && x.every((art, i) => art === y[i]);
}
