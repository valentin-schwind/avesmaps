import type { MediaRole } from "@avesmaps3d/shared";

/**
 * Welche Variante (`media_file.variant`) einer Rolle öffentlich dient (WI-0063 26.11, media.yaml `profile`).
 *
 * Eine Rolle wählt genau EINE veröffentlichte Variante; der Schlüssel `(Asset, Variante)` ist unter den veröffentlichten
 * Dateien eindeutig (Migration 0064). Der Name einer Variante ist der Name ihres Rezepts: `coat` erhält die Transparenz
 * und schneidet nichts zu, `header_16_9` ist der 16:9-Kopf (aus der privaten Quelle abgeleitet), `citymap_full`,
 * `citymap_preview` und `literature_cover` sind die Profile der Kartensammlung und der Literatur. Die Rasterpipeline
 * (`raster/profiles.ts`, MEDIA-M7) erzeugt diese Dateien und liest die Namen von hier; sie ändert Namen nur HIER.
 */
export const PUBLISHED_VARIANT: Readonly<Record<MediaRole, string>> = {
    coat: "coat",
    header: "header_16_9",
    map_full: "citymap_full",
    map_preview: "citymap_preview",
    literature_cover: "literature_cover",
    photobox: "photobox_2048",
    social_post: "social_post_2048",
};

/**
 * Die zweite öffentliche Fassung eines Reisebildes (WI-0272 S4, Aufgabe 22): die Kachel für Leiste und Kartensymbole (lange Kante 480, `raster/profiles.ts`).
 * Mit nur `photobox_2048` lüde die Leiste Megabytes, und jedes Vorschaubild auf der Karte dekodierte 2048 px. Sie ist eine Beifassung der Rolle
 * `photobox`, keine eigene Rolle: Sie hängt als Zeile an `media_file`, und Offline, Aufbewahrung, Notaus und Rollenschalter greifen so von selbst.
 */
export const PHOTOBOX_KACHEL_VARIANT = "photobox_kachel";

/**
 * Alle öffentlichen Varianten einer Rolle, die Hauptvariante (`PUBLISHED_VARIANT`) zuerst. Die Hauptvariante bleibt die eine, die Lesepfade, Plätze und die
 * Vorschau fragen; die weiteren (heute nur die Kachel des Reisebildes) halten Abgleich und Quarantäne mit.
 */
export function oeffentlicheVarianten(role: MediaRole): readonly string[] {
    return role === "photobox" ? [PUBLISHED_VARIANT.photobox, PHOTOBOX_KACHEL_VARIANT] : [PUBLISHED_VARIANT[role]];
}

/** Die Variante der privaten Vorschau einer Rolle: `intern_coat`, `intern_header_16_9` … (Klasse `derivative`). */
export function internVariante(variant: string): string {
    return `intern_${variant}`;
}
