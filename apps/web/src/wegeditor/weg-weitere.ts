import { PATH_WEITERE_MAX, type EditorPathWeiterer } from "@avesmaps3d/shared";

/**
 * Die weiteren Straßennamen der Abschnitte (WI-0302, OPS-000108; Bauvorlage Entwurf „Weitere Straßennamen“ Fassung 2; Vali 2026-11-10,
 * Option „Nur Wiki-Artikel“): je Abschnitt die Wiki-Artikel der Wege, die neben seinem Hauptartikel hier mitlaufen (ein Pilgerweg über einer
 * Reichsstraße). Reine Rechnung ohne Vue und ohne Texte; das Feld (`weg-weitere.vue`) setzt die Sätze, `weg-art.ts` schreibt.
 *
 * - **Wie der Wegtyp:** Eine Änderung gilt den gewählten Abschnitten (`mitWeiterem`, `ohneWeiteren`); gespeichert wird mit „Fertig“.
 * - **Teil-Chips:** Tragen die gewählten Abschnitte verschiedene Namen, steht jeder Name EINMAL, mit „n von m“ (`chipsDerWahl`); „allen
 *   geben“ ist dasselbe `mitWeiterem`, ✕ löst ihn von allen gewählten.
 * - **Gleich ist gleich als Menge:** Die Folge der Schlüssel zählt nicht (der Server liest sie nach Namen geordnet, das Feld hängt hinten an).
 */

/** Die weiteren Straßennamen je Abschnitt, unter seiner Kennung. */
export type WeitereJeAbschnitt = Readonly<Record<string, readonly EditorPathWeiterer[]>>;

/** Ein Name an den gewählten Abschnitten: an wie vielen er steht und wie viele gewählt sind. */
export interface WeitererChip extends EditorPathWeiterer {
    readonly anzahl: number;
    readonly von: number;
}

/** Die Schlüssel einer Liste als Menge. */
const schluessel = (liste: readonly EditorPathWeiterer[] | undefined): Set<string> =>
    new Set((liste ?? []).map((w) => w.key));

/** Tragen zwei Listen dieselben Artikel (die Folge zählt nicht)? */
export function weitereGleich(
    a: readonly EditorPathWeiterer[] | undefined,
    b: readonly EditorPathWeiterer[] | undefined,
): boolean {
    const x = schluessel(a);
    const y = schluessel(b);
    return x.size === y.size && [...x].every((key) => y.has(key));
}

/** Die Abschnitte, deren weitere Straßennamen in zwei Ständen verschieden stehen. */
export const weitereWechsel = (a: WeitereJeAbschnitt, b: WeitereJeAbschnitt): string[] =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((id) => !weitereGleich(a[id], b[id]));

/**
 * Die Namen an den gewählten Abschnitten, je Name einmal, in der Folge, in der sie an den Abschnitten stehen (ein neuer steht hinten; die
 * Rücktaste im leeren Feld meint ihn).
 */
export function chipsDerWahl(weitere: WeitereJeAbschnitt, ids: readonly string[]): WeitererChip[] {
    const zaehler = new Map<string, { weiterer: EditorPathWeiterer; anzahl: number }>();
    for (const id of ids)
        for (const w of weitere[id] ?? []) {
            const eintrag = zaehler.get(w.key);
            if (eintrag === undefined) zaehler.set(w.key, { weiterer: w, anzahl: 1 });
            else eintrag.anzahl += 1;
        }
    return [...zaehler.values()].map(({ weiterer, anzahl }) => ({ ...weiterer, anzahl, von: ids.length }));
}

/**
 * Einen Namen den gewählten Abschnitten geben, wo er fehlt („allen geben“ ist derselbe Griff). Ein Abschnitt, der schon die Höchstzahl
 * trägt, bleibt, wie er ist (der Server lehnte ihn sonst ab).
 */
export function mitWeiterem(
    weitere: WeitereJeAbschnitt,
    ids: readonly string[],
    weiterer: EditorPathWeiterer,
): WeitereJeAbschnitt {
    const neu: Record<string, readonly EditorPathWeiterer[]> = { ...weitere };
    for (const id of ids) {
        const liste = neu[id] ?? [];
        if (liste.some((w) => w.key === weiterer.key) || liste.length >= PATH_WEITERE_MAX) continue;
        neu[id] = [
            ...liste,
            { key: weiterer.key, name: weiterer.name, ...(weiterer.url ? { url: weiterer.url } : {}) },
        ];
    }
    return neu;
}

/** Einen Namen von allen gewählten Abschnitten lösen (✕ am Chip). */
export function ohneWeiteren(weitere: WeitereJeAbschnitt, ids: readonly string[], key: string): WeitereJeAbschnitt {
    const neu: Record<string, readonly EditorPathWeiterer[]> = { ...weitere };
    for (const id of ids) {
        const liste = neu[id];
        if (liste !== undefined && liste.some((w) => w.key === key)) neu[id] = liste.filter((w) => w.key !== key);
    }
    return neu;
}

/**
 * Was ein Treffer der Suche für die gewählten Abschnitte ist: gesperrt, weil er der Hauptartikel des Wegs ist (`haupt`) oder schon an allen
 * gewählten steht (`schon`); an einem Teil steht er (`teil`, wählen gibt ihn allen); sonst frei (`undefined`).
 */
export type TrefferLage =
    | { readonly art: "haupt" }
    | { readonly art: "schon"; readonly von: number }
    | { readonly art: "teil"; readonly anzahl: number; readonly von: number };

export function trefferLage(
    chips: readonly WeitererChip[],
    hauptKey: string | undefined,
    key: string,
): TrefferLage | undefined {
    if (hauptKey !== undefined && key === hauptKey) return { art: "haupt" };
    const chip = chips.find((c) => c.key === key);
    if (chip === undefined) return undefined;
    return chip.anzahl >= chip.von
        ? { art: "schon", von: chip.von }
        : { art: "teil", anzahl: chip.anzahl, von: chip.von };
}

/** Ist ein gesperrter Treffer gesperrt? */
export const trefferGesperrt = (lage: TrefferLage | undefined): boolean =>
    lage !== undefined && (lage.art === "haupt" || lage.art === "schon");

/**
 * Der nächste wählbare Eintrag einer Liste in eine Richtung (Pfeiltasten): gesperrte springt er über; ohne Markierung beginnt er oben (↓)
 * oder unten (↑). `-1`: keiner wählbar.
 */
export function naechsterWaehlbar(gesperrt: readonly boolean[], von: number, schritt: 1 | -1): number {
    const n = gesperrt.length;
    let i = von;
    for (let k = 0; k < n; k += 1) {
        i = i < 0 ? (schritt > 0 ? 0 : n - 1) : (i + schritt + n) % n;
        if (gesperrt[i] !== true) return i;
    }
    return -1;
}

/** Ein gesicherter Stand der weiteren Straßennamen (Sicherung im Browser), grob geprüft. */
export const weitereGueltig = (wert: unknown): wert is WeitereJeAbschnitt =>
    typeof wert === "object" &&
    wert !== null &&
    Object.values(wert).every(
        (liste) =>
            Array.isArray(liste) &&
            liste.every(
                (w: Partial<EditorPathWeiterer> | null) => typeof w?.key === "string" && typeof w.name === "string",
            ),
    );
