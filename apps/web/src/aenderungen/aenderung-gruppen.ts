import type { MapHistoryEntry } from "@avesmaps3d/shared";
import { serienZustand, type EintragsZeile, type ListenZeile, type SerienZeile } from "./aenderung-modell";
import { felderZahl } from "./aenderung-titel";

/**
 * Die Liste von „Änderungen“ nach Tagen und mit gebündelten Läufen, ohne Vue und ohne Browser (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`, vom Betreiber am 2026-11-01 gewählt:
 * „Wiki- und Importläufe -> A“ und „Tagesköpfe -> An“).
 *
 * - **Tagesköpfe:** Die Zeilen (neueste zuerst, wie der Server sie liefert) stehen unter dem Kopf ihres Tages in Ortszeit des Browsers. Eine Arbeitsserie zählt zum Tag ihres neuesten Mitglieds, dort steht sie schon.
 * - **Läufe je Tag gebündelt:** Die Läufe des WikiSync und des Imports sind Maschinenarbeit mit hunderten Feldern und überdecken die Arbeit der Menschen. Je Tag und Quelle steht EINE gedämpfte Zeile an der Stelle des neuesten
 *   Laufs, aufklappbar zu den Läufen. Ein Lauf in einer Arbeitsserie bleibt in ihr.
 *
 * Die Liste selbst (Filter, Seiten, Serien) bleibt, wo sie ist (`aenderung-modell.ts`, `aenderungen-liste.ts`); hier steht nur, wie sie sich gruppiert.
 */

/** Die Quellen, deren Läufe ein Tag bündelt. */
export const BUENDEL_QUELLEN = ["wikisync", "import"] as const;
export type BuendelQuelle = (typeof BUENDEL_QUELLEN)[number];

/** Die Läufe EINER Quelle an EINEM Tag, neueste zuerst. */
export interface Buendel {
    readonly art: "buendel";
    /** `bundle:<Tag>:<Quelle>`: stabil, solange die Läufe zum Tag gehören. */
    readonly schluessel: string;
    readonly quelle: BuendelQuelle;
    readonly eintraege: readonly MapHistoryEntry[];
}

export type ListenPunkt = EintragsZeile | SerienZeile | Buendel;

export interface TagesGruppe {
    /** Der Tag in Ortszeit als `JJJJ-MM-TT`. */
    readonly schluessel: string;
    /** Ein Zeitpunkt dieses Tages (der neueste der Gruppe), für den Kopf. */
    readonly at: string;
    readonly punkte: readonly ListenPunkt[];
}

const zwei = (n: number): string => String(n).padStart(2, "0");

/** Der Tag eines Zeitpunkts in Ortszeit des Browsers als `JJJJ-MM-TT`. */
export function tagesSchluessel(at: string): string {
    const tag = new Date(at);
    return `${String(tag.getFullYear())}-${zwei(tag.getMonth() + 1)}-${zwei(tag.getDate())}`;
}

/** Ist das ein Lauf, den ein Tag bündelt (WikiSync oder Import, nicht Mitglied einer Arbeitsserie)? */
export const istBuendelbar = (eintrag: MapHistoryEntry): boolean =>
    eintrag.series === undefined && (BUENDEL_QUELLEN as readonly string[]).includes(eintrag.source);

/** Der Zeitpunkt, an dem eine Zeile steht: der des Eintrags, bei einer Serie der ihres neuesten Mitglieds. */
export const zeilenZeitpunkt = (zeile: ListenZeile): string =>
    zeile.art === "serie" ? zeile.mitglieder[0]!.at : zeile.eintrag.at;

/** Der Schlüssel, unter dem eine Zeile der Liste steht (Auswahl, Aufklappen, `key` der Vorlage). */
export function punktSchluessel(punkt: ListenPunkt): string {
    if (punkt.art === "buendel") return punkt.schluessel;
    return punkt.art === "serie" ? serienSchluessel(punkt.id) : punkt.eintrag.operationId;
}
export const serienSchluessel = (id: string): string => `serie:${id}`;
export const buendelSchluessel = (tag: string, quelle: BuendelQuelle): string => `bundle:${tag}:${quelle}`;

/**
 * Gruppiert die Zeilen nach Tagen; `buendeln` fasst die Läufe von WikiSync und Import je Tag und Quelle zusammen. Die Reihenfolge der Eingabe bleibt: Ein Tag steht dort, wo seine erste Zeile steht, ein Bündel dort,
 * wo sein neuester Lauf steht.
 */
export function tagesGruppen(zeilen: readonly ListenZeile[], buendeln: boolean): TagesGruppe[] {
    const gruppen = new Map<
        string,
        { at: string; punkte: ListenPunkt[]; buendel: Map<string, { eintraege: MapHistoryEntry[] }> }
    >();
    for (const zeile of zeilen) {
        const at = zeilenZeitpunkt(zeile);
        const tag = tagesSchluessel(at);
        let gruppe = gruppen.get(tag);
        if (gruppe === undefined) {
            gruppe = { at, punkte: [], buendel: new Map() };
            gruppen.set(tag, gruppe);
        }
        if (buendeln && zeile.art === "eintrag" && istBuendelbar(zeile.eintrag)) {
            const quelle = zeile.eintrag.source as BuendelQuelle;
            const schluessel = buendelSchluessel(tag, quelle);
            const bisher = gruppe.buendel.get(schluessel);
            if (bisher !== undefined) {
                bisher.eintraege.push(zeile.eintrag);
                continue;
            }
            const eintraege = [zeile.eintrag];
            gruppe.buendel.set(schluessel, { eintraege });
            gruppe.punkte.push({ art: "buendel", schluessel, quelle, eintraege });
            continue;
        }
        gruppe.punkte.push(zeile);
    }
    return [...gruppen].map(([schluessel, gruppe]) => ({ schluessel, at: gruppe.at, punkte: gruppe.punkte }));
}

/** Was ein Bündel zählt: Läufe, Felder (die Zahl, die der Lauf übernommen hat) und Objekte (die Gegenstände aller Läufe). */
export function buendelZaehlung(buendel: Buendel): {
    readonly laeufe: number;
    readonly felder: number;
    readonly objekte: number;
} {
    return {
        laeufe: buendel.eintraege.length,
        felder: buendel.eintraege.reduce((summe, eintrag) => summe + felderZahl(eintrag), 0),
        objekte: buendel.eintraege.reduce((summe, eintrag) => summe + eintrag.objects.length, 0),
    };
}

/** Die Zeile, in der ein Eintrag steht, samt seiner Serie und seines Bündels: was aufgeklappt sein muss, damit man ihn sieht. */
export function elternVon(eintrag: MapHistoryEntry, buendeln: boolean): string[] {
    if (eintrag.series !== undefined) return [serienSchluessel(eintrag.series.id)];
    if (buendeln && istBuendelbar(eintrag))
        return [buendelSchluessel(tagesSchluessel(eintrag.at), eintrag.source as BuendelQuelle)];
    return [];
}

// --- Der Zustand als Filter --------------------------------------------------------------------------------------------------

/** ◐ „teils zurückgenommen“ gibt es nur für eine Serie; der Server kennt es nicht und filtert es darum nicht. */
export const TEILS = "teils";

/** Nur Serien, von denen einige Mitglieder zurückgenommen sind, andere nicht. */
export const nurTeilsZurueck = (zeilen: readonly ListenZeile[]): ListenZeile[] =>
    zeilen.filter((zeile) => zeile.art === "serie" && serienZustand(zeile).kreis === "halb");
