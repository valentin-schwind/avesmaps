import type { VorschauAuftrag, VorschauErgebnis } from "./auftrag";

/**
 * Die Gebirge-Vorschau für die Oberfläche (WI-0226; gezeichnet wird in WI-0178): EIN Worker, eine Rechnung zur Zeit. Kommt ein neuer
 * Auftrag, während einer läuft, ersetzt er den wartenden; der ersetzte endet mit `null` (überholt). So bleibt das Ziehen flüssig, und
 * das letzte Bild gehört immer zum letzten Stand. Der Worker entsteht erst beim ersten Auftrag und lädt die V12 nur dann.
 *
 * Mit `vorrang` wartet ein neuer Auftrag nicht auf den laufenden (WI-0249 Leistung): Der Worker wird beendet, der laufende endet mit `null`,
 * ein neuer Worker rechnet gleich. Eine feine Rechnung eines großen Gebirges dauert 14 s (Ehernes Schwert); eine Änderung kurz nach ihrem Start
 * kam sonst erst danach an die Reihe.
 */
export interface GebirgsVorschau {
    rechne(auftrag: VorschauAuftrag, art?: { vorrang?: boolean }): Promise<VorschauErgebnis | null>;
    beenden(): void;
}

interface Wartend {
    auftrag: VorschauAuftrag;
    fertig: (ergebnis: VorschauErgebnis | null) => void;
    fehler: (grund: Error) => void;
}

/** Die Warteschlange um einen Worker; `neuerWorker` liefert ihn beim ersten Auftrag (Tests geben einen Ersatz). */
export function vorschauWarteschlange(neuerWorker: () => Worker): GebirgsVorschau {
    let worker: Worker | null = null;
    let nummer = 0;
    let laufend: (Wartend & { nr: number }) | null = null;
    let wartend: Wartend | null = null;

    const senden = (eintrag: Wartend): void => {
        worker ??= starten();
        laufend = { ...eintrag, nr: ++nummer };
        worker.postMessage({ nr: laufend.nr, auftrag: eintrag.auftrag });
    };
    const starten = (): Worker => {
        const w = neuerWorker();
        w.onmessage = (ereignis: MessageEvent<{ nr: number; ergebnis?: VorschauErgebnis; fehler?: string }>) => {
            const eintrag = laufend;
            if (!eintrag || ereignis.data.nr !== eintrag.nr) return;
            laufend = null;
            if (ereignis.data.ergebnis) eintrag.fertig(ereignis.data.ergebnis);
            else eintrag.fehler(new Error(ereignis.data.fehler ?? "Vorschau fehlgeschlagen"));
            const naechster = wartend;
            wartend = null;
            if (naechster) senden(naechster);
        };
        return w;
    };

    return {
        rechne(auftrag, art) {
            return new Promise((fertig, fehler) => {
                const eintrag: Wartend = { auftrag, fertig, fehler };
                if (laufend && art?.vorrang === true) {
                    worker?.terminate();
                    worker = null;
                    laufend.fertig(null);
                    laufend = null;
                    wartend?.fertig(null);
                    wartend = null;
                }
                if (!laufend) {
                    senden(eintrag);
                    return;
                }
                wartend?.fertig(null);
                wartend = eintrag;
            });
        },
        beenden() {
            worker?.terminate();
            worker = null;
            laufend?.fertig(null);
            wartend?.fertig(null);
            laufend = null;
            wartend = null;
        },
    };
}
