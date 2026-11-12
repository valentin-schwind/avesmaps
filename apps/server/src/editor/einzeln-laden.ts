/**
 * Teure Lesestellen einzeln (WI-0298 Stufe 5): Gleiche Anfragen teilen sich ein Ergebnis, verschiedene laufen nacheinander.
 *
 * Anlass: Speicherabbruch des Hauptthreads in Production am 2026-11-12 um 00:04 (Grenze 512 MB). Offen waren zweimal dieselben
 * Andockziele um die Landschaft „Meer“, deren Kasten fast die ganze Karte deckt: auf der Stage eine Antwort von 34 MB mit 247.000
 * Kanten. Zwei davon gleichzeitig bauten sich im Hauptthread nebeneinander auf.
 *
 * 🪤 Bricht der Browser ab, läuft die Abfrage hier trotzdem zu Ende. Eine gleiche Anfrage, die währenddessen kommt, bekommt ihr Ergebnis.
 */
export function einzelnLaden<T>(): (schluessel: string, laden: () => Promise<T>) => Promise<T> {
    const laufend = new Map<string, Promise<T>>();
    let vorher: Promise<unknown> = Promise.resolve();
    return (schluessel, laden) => {
        const schon = laufend.get(schluessel);
        if (schon !== undefined) return schon;
        const neu = vorher.then(laden);
        vorher = neu.catch(() => undefined);
        laufend.set(schluessel, neu);
        const fertig = (): void => {
            if (laufend.get(schluessel) === neu) laufend.delete(schluessel);
        };
        void neu.then(fertig, fertig);
        return neu;
    };
}
