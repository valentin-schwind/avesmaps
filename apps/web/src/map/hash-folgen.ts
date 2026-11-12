import type { ShareDisplay } from "@avesmaps3d/shared";
import { readAddressDisplay } from "./display-state";
import { parseViewState, readViewChoices, type ViewChoices, type ViewState } from "./view-state";

/**
 * Ein tiefer Link im offenen Tab (Fund der Hauptorchestrierung auf der Stage 2026-10-20, über die Editor-Orchestrierung): Wer im
 * selben Tab nur den Hash ändert (`#…&view=landscapes&layer=alle`), lädt die Seite nicht neu. Bis hierher las die Karte den Hash nur beim
 * Laden; danach schrieb sie ihn nur noch (`formatViewState` per `replaceState`, das kein `hashchange` auslöst). Ansicht, Ebene und Lage
 * blieben stehen, und das Kartenmenü baute „Hier hinzufügen ›“ aus der alten Ansicht.
 *
 * Jetzt gilt ein geänderter Hash wie beim Laden: Wahl (`readViewChoices`: Ansicht, Ebene, Topographie, Serie), Ausschnitt
 * (`parseViewState`) und die Schalter des Auges (`readAddressDisplay`). Was der Hash nicht nennt, bleibt, wie es ist.
 */
export interface HashZiel {
    readonly wahl: ViewChoices;
    /** Ausschnitt mit Mitte und Zoom; `undefined`, wenn der Hash keinen vollständigen nennt. */
    readonly lage: ViewState | undefined;
    readonly anzeige: ShareDisplay;
}

export function hashZiel(hash: string, serien: readonly string[], serie: string): HashZiel {
    return {
        wahl: readViewChoices(hash, serien),
        lage: parseViewState(hash, serien, serie),
        anzeige: readAddressDisplay("", hash),
    };
}

/**
 * Der Hash, den der Wechsel gesetzt hat: der Teil ab `#` in `neueAdresse` (`HashChangeEvent.newURL`); fehlt die Adresse, der von jetzt.
 *
 * 🪤 Nicht `location.hash` im Handler lesen: `hashchange` kommt als eigene Aufgabe NACH dem Setzen, und die Karte schreibt ihre Lage
 * gebündelt (150 ms nach der letzten Bewegung oder Panel-Änderung, `app.vue` `writeViewState`) per `replaceState`. Fällt dieser
 * Schreibzug zwischen Setzen und Ereignis, liest der Handler die ALTE Lage der Karte zurück und fliegt dorthin: Der Link wäre
 * verschluckt (gemessen 2026-10-24 im Release-Test: Hash `z=7.50` gesetzt, fünf Millisekunden später schrieb die Karte `z=2.50` zurück,
 * der Handler las das, `gebietseditor.spec.ts` „Umschalt-Klick auf einen Ort über dem Gebiet“ wartete 20 s auf einen Zoom, der nie kam).
 */
export function hashDesWechsels(neueAdresse: string | undefined, jetzt: string): string {
    if (neueAdresse === undefined || neueAdresse === "") return jetzt;
    const ab = neueAdresse.indexOf("#");
    return ab < 0 ? "" : neueAdresse.slice(ab);
}

/** Hört auf `hashchange` und reicht das Ziel weiter; gibt die Abmeldung zurück. Ohne Fenster (Vitest) hört es nichts. */
export function installHashFolgen(
    serien: readonly string[],
    serie: () => string,
    folge: (ziel: HashZiel) => void,
): () => void {
    if (typeof globalThis.addEventListener !== "function") return () => undefined;
    const hoere = (ereignis: Event): void =>
        folge(
            hashZiel(
                hashDesWechsels((ereignis as Partial<HashChangeEvent>).newURL, globalThis.location.hash),
                serien,
                serie(),
            ),
        );
    globalThis.addEventListener("hashchange", hoere);
    return () => globalThis.removeEventListener("hashchange", hoere);
}
