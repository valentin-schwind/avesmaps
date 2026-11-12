import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Wann ein Stil eigene Ebenen annimmt - die EINE Antwort für alle, die nach einem Stilwechsel eine Ebene anlegen,
 * verschieben oder entfernen.
 *
 * 💣 **`styledata` heißt nicht „der Stil ist geladen“.** MapLibre feuert es auch für einen Stil, der noch lädt: Ein
 * `addImage` direkt nach einem `setStyle`, der von vorn bauen musste, legt das Bild an und meldet es mit `styledata`.
 * Ein `addLayer` in diesem Zuhörer wirft „Style is not done loading“, und der Fehler landet beim Aufrufer von
 * `addImage` (2026-10-04: siebenmal „Laufzeitbild … nicht angemeldet“ beim Laden, obwohl jedes Bild stand; ausgelöst
 * im verborgenen Tab, wo der Stil auf sein erstes Bild wartet und ein Neubau vor ihm kommt).
 *
 * 🪤 **`map.isStyleLoaded()` ist die falsche Frage:** Es wartet zusätzlich auf alle Kacheln und Bilder. Ebenen nimmt
 * der Stil schon vorher an, und nach einem Neubau käme die Antwort „ja“ erst mit einem Ereignis, das keiner abwartet.
 * Gefragt wird deshalb, was MapLibre selbst vor jedem `addLayer` prüft (`Style._checkLoaded`).
 */
export function styleTakesChanges(map: MapLibreMap): boolean {
    // Nach `map.remove()` gibt es keinen Stil mehr.
    return (map.style as MapLibreMap["style"] | undefined)?._loaded === true;
}

/**
 * Ruft `reconcile` jetzt und nach jedem `styledata` - aber nur, wenn der Stil Ebenen annimmt. Übersprungen geht
 * nichts verloren: Ein Stil feuert am Ende seines Ladens selbst `styledata`, dann läuft `reconcile`. Gibt das Abmelden
 * zurück.
 */
export function onStyleData(map: MapLibreMap, reconcile: () => void): () => void {
    const ready = (): void => {
        if (styleTakesChanges(map)) reconcile();
    };
    map.on("styledata", ready);
    ready();
    return () => {
        map.off("styledata", ready);
    };
}

/** Ruft `run` genau einmal: sofort, wenn der Stil Ebenen annimmt, sonst beim ersten `styledata`, ab dem er es tut. */
export function whenStyleTakesChanges(map: MapLibreMap, run: () => void): void {
    if (styleTakesChanges(map)) {
        run();
        return;
    }
    const ready = (): void => {
        if (!styleTakesChanges(map)) return;
        map.off("styledata", ready);
        run();
    };
    map.on("styledata", ready);
}

/**
 * Ruft `run` nach jedem Stilwechsel im NÄCHSTEN Bild, nie mitten in MapLibres Stilaktualisierung, und nur, wenn der Stil Ebenen annimmt. Gibt
 * das Abmelden zurück. Für jede Ebene, die nach einem Stilwechsel neu angelegt wird.
 *
 * 💣 **Eine Ebene, die im `styledata`-Zuhörer selbst angelegt wird, zeichnet MapLibre im laufenden Bild unausgewertet** (Stage 2026-10-26,
 * Valis Blutzinnen beim Einschalten von „Kämme zeichnen“: fünfmal `TypeError: Cannot read properties of undefined (reading 'r')` in
 * `setUniform` einer Füllebene). Eine Füllebene bekommt ihre Umrissfarbe `fill-outline-color` erst in `recalculate` (ohne Angabe die
 * Füllfarbe); vorher ist sie `undefined`, und der Umriss liest daraus `.r`. Ein Bild später ist sie ausgewertet.
 */
export function nachStilwechsel(map: MapLibreMap, run: () => void): () => void {
    let bild: number | undefined;
    const melde = (): void => {
        if (bild !== undefined) return;
        bild = requestAnimationFrame(() => {
            bild = undefined;
            if (styleTakesChanges(map)) run();
        });
    };
    map.on("styledata", melde);
    return () => {
        map.off("styledata", melde);
        if (bild !== undefined) cancelAnimationFrame(bild);
        bild = undefined;
    };
}
