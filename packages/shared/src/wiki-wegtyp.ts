import type { SUBJECT_PATH_SUBTYPES } from "./subject.ts";

/** Einer unserer Wegtypen (Schlüssel wie in `path.subtype`). */
export type Wegtyp = (typeof SUBJECT_PATH_SUBTYPES)[number];

/**
 * Welcher unserer Wegtypen einer Weg-Art aus dem Wiki entspricht (`wiki_path_snapshot.art`, freier Text). EINE Stelle für alle Leser:
 * das Wiki-Feld des Wegtyps (WI-0225, Design Guide §13.8 „ohne Zuordnung“) und später der Wiki-Abgleich.
 *
 * - **Betreiber 2026-10-18**, wörtlich: „Kronstraße -> Reichsstraße, Karawanenroute -> Karawanenroute (das ist eigener Typ wenn es das
 *   noch nicht gibt …)“. Die Karawanenroute wird ein Kennzeichen ÜBER dem Wegtyp, kein Wegtyp (WI-0177 §30, Modell der Orchestrierung):
 *   Hier hat sie keine Zuordnung, ihr ↺ setzt nur das Kennzeichen (Wege-Sitzung). Die Mischformen („Straße, Pass“, „Karawanenroute,
 *   Pass“) bleiben ohne Zuordnung, ↺ still.
 * - Die übrigen Zeilen stammen aus der Probierseite „Wiki-Feld“ (Fassung 2 bis 4, abgenommen 2026-10-18: „wiki-felder -> so bauen“).
 * - Gemessen im lokalen Stand (2026-10-18, Straßen): Straße 55, Pass 35, Karawanenroute 16, Kronstraße 11, Reichsstraße 6, ehemalige
 *   Reichsstraße 4, Reichslandstraße 4, Mischformen je 3, Knüppeldamm 2, Landstraße 2, Stieg 2, Pilgerweg, Damm, Waldweg, Pfad je 1.
 *   Flüsse: Fluss, Strom, Bach, Kanal.
 */
export const WIKI_WEGTYP: Readonly<Record<string, Wegtyp>> = {
    Reichsstraße: "Reichsstrasse",
    Reichslandstraße: "Reichsstrasse",
    Kronstraße: "Reichsstrasse",
    Straße: "Strasse",
    Landstraße: "Strasse",
    "ehemalige Reichsstraße": "Strasse",
    Pass: "Gebirgspass",
    Stieg: "Pfad",
    Pfad: "Pfad",
    Waldweg: "Weg",
    Pilgerweg: "Weg",
    Knüppeldamm: "Weg",
    Damm: "Weg",
    Fluss: "Flussweg",
    Strom: "Flussweg",
    Bach: "Flussweg",
    Kanal: "Flussweg",
};

/** Unser Wegtyp zur Weg-Art des Wiki; `undefined`: keine Zuordnung (Mischform, Karawanenroute, leer, unbekannt). */
export function wegtypAusWiki(art: string): Wegtyp | undefined {
    return WIKI_WEGTYP[art.trim()];
}

/**
 * Das Kennzeichen über dem Wegtyp zur Weg-Art des Wiki (WI-0177 §30, Migration 0174; Betreiber 2026-10-18: „Karawanenroute ->
 * Karawanenroute“): „Karawanenroute“ ist das Kennzeichen `karawanenroute`, jede andere Art keins (`""`); eine Mischform mit der
 * Karawanenroute („Karawanenroute, Pass“) bleibt ohne Zuordnung (`undefined`, ↺ still).
 */
export function kennzeichenAusWiki(art: string): "karawanenroute" | "" | undefined {
    const text = art.trim();
    if (text === "Karawanenroute") return "karawanenroute";
    return /karawanenroute/iu.test(text) ? undefined : "";
}
