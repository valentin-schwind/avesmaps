import { createHash } from "node:crypto";
import { NAVIGATION_TRENNER, SPRACHE_FELDER, sprachSchluessel } from "../infobox/sprache.ts";

/**
 * Der Bereich `sprachen` im Abgleich (WI-0261 S3): die Wörter, die Plan, Lader und Schreiber teilen. REIN, ohne Datenbank.
 *
 * 🔴 Abweichung von den übrigen Bereichen: Der Bereich ist ARTIKELZENTRIERT (wie die Katalogquellen, aber ohne Träger). Das Objekt ist der Wiki-Stand eines aventurischen Sprachartikels
 * (`wiki_sprache_artikel`, Migration 0255), und der WikiSync führt seinen Lebenslauf selbst: Ein neuer Artikel wird angelegt, ein verschwundener oder nicht mehr aventurischer still gelegt,
 * ein zurückgekehrter belebt. Den Lebenslauf trägt das Feld `artikel` (Wert: der Titel; leer heißt still gelegt), die Felder des Wiki-Stands sind Spalten des Objekts selbst
 * (`LOKALE_FELDER.sprachen`). Ein neuer Artikel hat noch keine Kennung: Seine Zeilen hängen an einer Platzhalter-Kennung aus seinem Schlüssel (`neuerArtikelId`, wie die fehlende
 * Katalogquelle der Quellen), und die Übernahme legt ihn in einem Listen-Schreiber an (`uebernahme/sprachen.ts`).
 */

/** Die Art des Objekts in den Zeilen des Plans, im Protokoll der Übernahme und im Fachprotokoll. */
export const SPRACHE_ARTIKEL_ART = "sprache_artikel";

/** Das Feld des Lebenslaufs: sein Wert ist der Titel des Artikels, solange er aktiv ist; leer heißt still gelegt. */
export const ARTIKEL_FELD = "artikel";

/** Alle Felder eines Sprachartikels im Plan, in der Reihenfolge des Berichts: zuerst der Lebenslauf, dann die Felder des Wiki-Stands. */
export const SPRACHEN_PLANFELDER: readonly string[] = [ARTIKEL_FELD, ...SPRACHE_FELDER];

/** Feld des Plans → Spalte in `wiki_sprache_artikel`. `artikel` ist keine Spalte: Der Schreiber setzt daraus Titel und Zustand (`uebernahme/sprachen.ts`). */
export const SPRACHE_SPALTEN: Readonly<Record<string, string>> = {
    [ARTIKEL_FELD]: ARTIKEL_FELD,
    name: "name",
    sprachfamilie: "sprachfamilie",
    vorstufen: "vorstufen",
    schrift: "schrift",
    sprecheranzahl: "sprecheranzahl",
    offizielle_sprache: "offizielle_sprache",
    weitere_verbreitung: "weitere_verbreitung",
    kurzbeschreibung: "kurzbeschreibung",
    navigation: "navigation",
    roh_vorstufen: "vorstufen_roh",
    roh_schrift: "schrift_roh",
    roh_offizielle_sprache: "offizielle_sprache_roh",
    roh_weitere_verbreitung: "weitere_verbreitung_roh",
};

/** Die Navigationsleisten als EIN Wert des Plans (`Nav A | Nav B`); keine Leiste heißt kein Wert. */
export const navigationWert = (leisten: readonly string[]): string | null =>
    leisten.length === 0 ? null : leisten.join(NAVIGATION_TRENNER);

/** Zurück in die Liste der Spalte `navigation`. */
export const navigationListe = (wert: string | null): string[] =>
    wert === null
        ? []
        : wert
              .split(NAVIGATION_TRENNER)
              .map((leiste) => leiste.trim())
              .filter((leiste) => leiste !== "");

/** Die Adresse eines Sprachartikels im Wiki: daran findet der Dump-Durchgang seine Seite auch als Weiterleitung (für den Grund des Stilllegens). */
export const spracheAdresse = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

/** Die Platzhalter-Kennung eines Sprachartikels, den der Bestand noch nicht hat: eine UUID aus seinem Schlüssel (dieselbe in Vorschau und Übernahme). */
export function neuerArtikelId(schluessel: string): string {
    const hash = createHash("sha256").update(`wikisync|sprache-neu|${schluessel}`, "utf8").digest("hex");
    const hex = hash.slice(0, 32).split("");
    hex[12] = "5";
    hex[16] = "8";
    const roh = hex.join("");
    return `${roh.slice(0, 8)}-${roh.slice(8, 12)}-${roh.slice(12, 16)}-${roh.slice(16, 20)}-${roh.slice(20, 32)}`;
}

/** Gehört die Zeile zu einem Artikel, den der Bestand noch nicht hat? Ihre Kennung ist dann der Platzhalter ihres Artikels. */
export function istNeuerArtikel(zeile: { objektId: string | null; artikel: string | null }): boolean {
    return (
        zeile.objektId !== null &&
        zeile.artikel !== null &&
        zeile.objektId === neuerArtikelId(sprachSchluessel(zeile.artikel))
    );
}

/** Gründe im Bericht (`grund`, höchstens 200 Zeichen). */
export const GRUND_NEU = "Neuer aventurischer Sprachartikel: wird angelegt";
export const GRUND_WIEDER = "Wieder ein aventurischer Sprachartikel im Dump: lebt wieder auf";
export const GRUND_NICHT_IM_DUMP = "Nicht mehr im Dump: wird still gelegt";
export const GRUND_NICHT_AVENTURISCH =
    "Weder {{Aventurien}} noch {{Nav Sprachen}}: nicht mehr aventurisch, wird still gelegt";
export const GRUND_KEINE_INFOBOX = "Keine Infobox Sprache mehr: wird still gelegt";
export const grundWeiterleitung = (ziel: string | null): string =>
    `Weiterleitung auf ${ziel ?? "?"}: wird still gelegt`.slice(0, 200);
