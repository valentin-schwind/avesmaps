import { ref, watch } from "vue";

/**
 * Der Schalter „Höhenlinien“ der Editoren (WI-0236; Betreiber 2026-10-19: „Wir wollen sowohl für die Topographie (Höhenlinien und
 * Höhenstufen) die möglichkeit haben die feinen linien mit den höhenmetern auszublenden“): Aus nimmt die Höhenlinien aller drei
 * Stufen samt Höhenzahlen von der Karte, in Höhenlinien wie Höhenstufen. Höhenstufen, Gipfel und Flächen bleiben.
 *
 * - **„Die feinen Linien“ sind alle Höhenlinien**, nicht nur die Hunderter: Die Hunderter erscheinen erst ab Zoom 5, im Gebirge ab
 *   6,5, und tragen Zahlen erst ab 6,5. Was man in der Übersicht als feine Linien mit Höhenmetern sieht, sind die Tausender (ab Zoom
 *   3, Zahlen ab 0) und die Fünfhunderter (ab 4, Zahlen ab 5). Ein Schalter nur für die Hunderter änderte dort nichts.
 * - **Im Anzeigemenü (Auge), für alle**, solange die Ebene Topographie gewählt ist (Betreiber 2026-10-20: „kannst du die anzeige der
 *   höhenlinien in das anzeigemenü tun (nicht in die leiste oben, sondern da wo wir unsere layer ein- und ausschalten) - und nur wenn
 *   topographie an ist.“). Bis dahin stand er als ◎ in der Ebenenleiste, nur für Editoren am Rechner.
 * - 🔴 **Gemerkt je Browser** wie ◐: eine Gewohnheit der Person, nicht der Ansicht und nicht des Links.
 * - Ein Wechsel baut den Stil neu (`setStyle` mit `diff`): Ohne Linien fallen auch ihre Kachelquellen weg, sonst lüden sie weiter.
 */
const STORAGE_KEY = "avesmaps3d.hoehenlinien";

function liesGemerkt(): boolean {
    try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) !== "aus";
    } catch {
        // Ohne Speicher (privates Fenster) gilt die Vorgabe: Linien an.
        return true;
    }
}

/** Stehen die Höhenlinien auf der Karte? */
export const hoehenlinienZeigen = ref(liesGemerkt());

watch(hoehenlinienZeigen, (an) => {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, an ? "an" : "aus");
    } catch {
        // siehe liesGemerkt
    }
});

/** Was der Stil bekommt: der Schalter im Anzeigemenü, für Besucher wie Editoren, am Rechner wie am Telefon. */
export function hoehenlinienImStil(): boolean {
    return hoehenlinienZeigen.value;
}

/** Ein Wechsel baut den Stil neu, solange die Landschaftsansicht steht; sonst zeigt die Karte ohnehin keine Höhenlinien. */
export function beobachteHoehenlinien(ansicht: () => string, neuBauen: () => void): void {
    watch(hoehenlinienZeigen, () => {
        if (ansicht() === "landscapes") neuBauen();
    });
}
