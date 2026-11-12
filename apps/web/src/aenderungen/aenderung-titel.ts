import type { MapHistoryEntry } from "@avesmaps3d/shared";
import { istGrundFeld, istNebenfeld } from "./aenderung-detail-modell";
import { vorgangVon } from "./aenderung-vorgang";

/**
 * Der Titel einer Operation in der Liste von „Änderungen“ (WI-0265 B6i): die Zusammenfassung des Servers (`summary`), sonst der Name der Operation.
 *
 * 🔴 **Eine offensichtlich falsche Zählung** der Übernahme des WikiSync korrigiert die Liste aus den gelieferten Gegenständen. Bis WI-0265 B6i schrieb der Server „WikiSync: 0 Felder aus dem
 * Wiki übernommen (0 Objekte)“ für einen Lauf, der nur NEUE Objekte anlegte (Sprachartikel: die Schritte der Felder sind leer, die angelegten Artikel stehen in keiner der beiden Zahlen). Der
 * Altbestand bleibt in der Datenbank, wie er ist; die Liste zählt, was sie hat: eine Null, wo die Operation Gegenstände mit Feldern trägt, wird durch die Zahl der Gegenstände und ihrer Felder
 * ersetzt (dieselben Zeilen, die das Detail zeigt). Eine Zahl über Null, auch eine zu kleine, bleibt: Der Server zählt für die Wiki-Box und für die Folgen anders als die Liste.
 */

/** Wie der Server die Übernahme des WikiSync nennt (`wiki/abgleich/uebernahme/uebernehmen.ts`). */
const WIKISYNC_TITEL = /^(WikiSync: )(\d+)( Felder aus dem Wiki übernommen \()(\d+)( Objekte\))$/u;

/** Die Felder, die das Detail als Zeile zeigt, über alle Gegenstände der Operation. */
function feldZeilen(eintrag: Pick<MapHistoryEntry, "objects">): number {
    return eintrag.objects.reduce((summe, gegenstand) => {
        const felder = Object.keys(gegenstand.changes);
        return summe + felder.filter((feld) => !istNebenfeld(feld, felder) && !istGrundFeld(feld)).length;
    }, 0);
}

/** Der Titel einer Operation in der Liste. */
export function eintragsTitel(eintrag: Pick<MapHistoryEntry, "operation" | "objects" | "summary" | "source">): string {
    const summary = eintrag.summary;
    if (summary === undefined) return vorgangVon(eintrag);
    const treffer = eintrag.source === "wikisync" ? WIKISYNC_TITEL.exec(summary) : null;
    if (treffer === null || eintrag.objects.length === 0) return summary;
    const felder = Number(treffer[2]);
    const objekte = Number(treffer[4]);
    if (felder > 0 && objekte > 0) return summary;
    const gezaehlt = feldZeilen(eintrag);
    if (felder === 0 && gezaehlt === 0) return summary;
    return `${treffer[1]}${String(felder > 0 ? felder : gezaehlt)}${treffer[3]}${String(
        objekte > 0 ? objekte : eintrag.objects.length,
    )}${treffer[5]}`;
}

/**
 * Wie viele Felder ein Lauf übernommen oder geändert hat (die Zahl im Bündel eines Tages, WI-0265 B10): beim WikiSync die Zahl, die der Server im Titel nennt, sofern sie über Null liegt (er zählt für die Wiki-Box
 * und die Folgen anders als die Liste), sonst die Zeilen, die das Detail zeigt.
 */
export function felderZahl(eintrag: Pick<MapHistoryEntry, "objects" | "summary" | "source">): number {
    const treffer =
        eintrag.source === "wikisync" && eintrag.summary !== undefined ? WIKISYNC_TITEL.exec(eintrag.summary) : null;
    const genannt = treffer === null ? 0 : Number(treffer[2]);
    return genannt > 0 ? genannt : feldZeilen(eintrag);
}
