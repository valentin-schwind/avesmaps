/**
 * Was mit den Übernahmen des WikiSync geschah, ohne dass die Ansicht des WikiSync es selbst anstieß (WI-0265 B8d): Das ↺ in „Änderungen“ reiht die Rücknahme eines Laufs ein (`wiki_zuruecknehmen`, derselbe
 * Auftrag wie in der Verwaltung) oder nimmt eine Übernahme von Regelvorschlägen zurück. Eine offene Ansicht des WikiSync (Stand mit den Aufträgen, Bereiche mit der jüngsten Übernahme) und das Fenster der Regeln
 * kennen den neuen Auftrag und den neuen Stand der Übernahme aber erst beim nächsten Lesen. Die Meldung ist das Gegenstück zu `inhalte/inhalte-melde.ts` und `fenster/wiki-box-melde.ts`, nur ohne Liste von
 * Gegenständen: Wer offen ist, liest neu (die Ansicht des WikiSync fragt danach alle paar Sekunden nach, solange ein Auftrag wartet oder läuft).
 */

type Hoerer = () => void;
const hoerer = new Set<Hoerer>();

/** Meldet, dass eine Rücknahme des WikiSync aus „Änderungen“ angestoßen oder geschrieben wurde. */
export function meldeWikiSync(): void {
    for (const eines of [...hoerer]) eines();
}

/** Meldet einen Hörer an; gibt die Abmeldung zurück (die Ansicht meldet sich ab, wenn sie nicht mehr offen ist). */
export function hoereWikiSyncMeldung(hoerer_: Hoerer): () => void {
    hoerer.add(hoerer_);
    return () => {
        hoerer.delete(hoerer_);
    };
}
