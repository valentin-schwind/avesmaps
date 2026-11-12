import { shallowRef } from "vue";
import type { EditorPathStreet } from "@avesmaps3d/shared";
import type { HandgriffWahl } from "../editor-menu/action";

/**
 * Die Abschnitte einer Straße für das Menü am Weg (WI-0177; EDIT-0003 T49; Probierseite „Abschnitte im Menü“, Betreiber 2026-10-17:
 * „abschnittseditierung perfekt“, „Diese Form von Abschnitten gibts nur in Wege“): „Wegkurve bearbeiten ›“, „Wegkurve vereinfachen ›“ und
 * „Weg entfernen ›“ stehen schon beim ersten Klick, mit einem Untermenü „n · Von – Bis“ in der Folge der Straße. Ein Abschnitt außerhalb
 * des Bilds trägt rechts „außerhalb“. Gibt es nur einen, steht er trotzdem darin: Man sieht, dass es Abschnitte gibt.
 *
 * - **Geladen** wird die Straße über den Lesepfad des Wege-Fensters (`GET /api/editor/paths/:id/street`, Folge und Orte vom Server), einmal
 *   je Straße, gemerkt unter jedem ihrer Abschnitte. `fuer` ist reaktiv: Solange sie lädt, gibt es keine Wahlen (der Handgriff fehlt dann
 *   im Menü am Objekt und erscheint, sobald sie da ist). Das Kartenmenü baut seine Einträge nicht reaktiv: Es wartet auf `bereit`.
 * - **Neu gelesen** wird nach jeder Änderung an Wegen (`vergiss`), damit Teilen, Löschen und Anlegen gleich stimmen.
 */

export interface WegAbschnitt {
    readonly publicId: string;
    readonly revision: number;
    /** Die Nummer in der Folge der Straße, ab 1. */
    readonly nr: number;
    readonly von: string | undefined;
    readonly bis: string | undefined;
    readonly bounds: readonly [number, number, number, number] | undefined;
}

export interface WegAbschnitteDaten {
    strasse(publicId: string, signal: AbortSignal): Promise<EditorPathStreet | null>;
}

/** Der sichtbare Ausschnitt in Karteneinheiten. */
export interface Ausschnitt {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
}

export interface WegAbschnitteTexte {
    /** „Abzweig“: ein Ende ohne Ort (Abzweig, Kartenrand). */
    readonly abzweig: string;
    /** „außerhalb“: der Abschnitt liegt nicht im Bild. */
    readonly ausserhalb: string;
}

export interface WegAbschnitte {
    /** Die Abschnitte der Straße dieses Abschnitts in ihrer Folge; `undefined`, solange sie lädt (dann lädt der Aufruf sie). */
    fuer(publicId: string): readonly WegAbschnitt[] | undefined;
    /** Die Straße selbst (Name, Art), wenn sie geladen ist. */
    strasse(publicId: string): EditorPathStreet | undefined;
    /** Die Wahlen des Untermenüs: „n · Von – Bis“, rechts „außerhalb“, mit Vorschau. Leer, solange die Straße lädt. */
    wahlen(publicId: string): HandgriffWahl[];
    /** Erfüllt, sobald die Straße dieses Abschnitts geladen ist (oder das Laden scheiterte); lädt sie, wenn nötig. */
    bereit(publicId: string): Promise<void>;
    /** Nach einer Änderung an Wegen: alles neu lesen, sobald es wieder gebraucht wird. */
    vergiss(): void;
}

/** Liegt der Rahmen ganz außerhalb des Ausschnitts? Ohne Rahmen oder Ausschnitt gilt er als im Bild. */
export function ausserhalb(bounds: WegAbschnitt["bounds"], bild: Ausschnitt | undefined): boolean {
    if (bounds === undefined || bild === undefined) return false;
    const [x0, y0, x1, y1] = bounds;
    const bx0 = Math.min(bild.x0, bild.x1);
    const bx1 = Math.max(bild.x0, bild.x1);
    const by0 = Math.min(bild.y0, bild.y1);
    const by1 = Math.max(bild.y0, bild.y1);
    return x1 < bx0 || x0 > bx1 || y1 < by0 || y0 > by1;
}

/** Der Text einer Wahl: „n · Von – Bis“; ein Ende ohne Ort heißt „Abzweig“. */
export const wahlText = (abschnitt: WegAbschnitt, abzweig: string): string =>
    `${String(abschnitt.nr)} · ${abschnitt.von ?? abzweig} – ${abschnitt.bis ?? abzweig}`;

export function createWegAbschnitte(
    daten: WegAbschnitteDaten,
    optionen: { readonly bild: () => Ausschnitt | undefined; readonly texte: () => WegAbschnitteTexte },
): WegAbschnitte {
    /** Die geladenen Straßen unter jedem ihrer Abschnitte. */
    const stand = shallowRef(new Map<string, EditorPathStreet>());
    /**
     * Was gerade lädt, bewusst nicht reaktiv: `fuer` wird in berechneten Werten gelesen (das Menü), und dort darf das Laden keinen
     * reaktiven Wert ändern. Reaktiv ist erst die Antwort.
     */
    const laedt = new Map<string, Promise<void>>();
    let generation = 0;

    function lade(publicId: string): Promise<void> {
        const laufend = laedt.get(publicId);
        if (laufend !== undefined) return laufend;
        const meine = generation;
        const versprochen: Promise<void> = daten
            .strasse(publicId, new AbortController().signal)
            .catch(() => null)
            .then((strasse) => {
                if (laedt.get(publicId) === versprochen) laedt.delete(publicId);
                if (meine !== generation || strasse === null) return;
                const fertig = new Map(stand.value);
                for (const teil of strasse.segments) fertig.set(teil.id, strasse);
                fertig.set(publicId, strasse);
                stand.value = fertig;
            });
        laedt.set(publicId, versprochen);
        return versprochen;
    }

    function strasseVon(publicId: string): EditorPathStreet | undefined {
        const geladen = stand.value.get(publicId);
        if (geladen === undefined) void lade(publicId);
        return geladen;
    }

    function fuer(publicId: string): readonly WegAbschnitt[] | undefined {
        const strasse = strasseVon(publicId);
        return strasse?.segments.map((teil, i) => ({
            publicId: teil.id,
            revision: teil.revision,
            nr: i + 1,
            von: teil.von,
            bis: teil.bis,
            bounds: teil.bounds,
        }));
    }

    return {
        fuer,
        strasse: strasseVon,
        wahlen(publicId) {
            const abschnitte = fuer(publicId);
            if (abschnitte === undefined) return [];
            const texte = optionen.texte();
            const bild = optionen.bild();
            return abschnitte.map((abschnitt) => ({
                id: abschnitt.publicId,
                text: wahlText(abschnitt, texte.abzweig),
                ...(ausserhalb(abschnitt.bounds, bild) ? { hinweis: texte.ausserhalb } : {}),
                vorschau: true as const,
            }));
        },
        bereit: (publicId) => (stand.value.has(publicId) ? Promise.resolve() : lade(publicId)),
        vergiss() {
            generation += 1;
            laedt.clear();
            stand.value = new Map();
        },
    };
}
