import { EDITOR_PLACE_KINDS_URL, type EditorPlaceKind, type EditorPlaceKindList } from "@avesmaps3d/shared";

/**
 * Die Ortsarten zur Wahl im Feld „Art“ (WI-0295; Legacy `js/ui/place-kind-autocomplete.js`): einmal je Seite geholt und dann im Speicher gefiltert. Ein
 * Netzaufruf je Tastendruck kostete mehr als die ganze Liste (rund 100 kurze Namen). Scheitert der Abruf, ist das Feld ein gewöhnliches Textfeld ohne
 * Vorschläge, und der nächste Fokus fragt neu: Ein Editor, der nichts eintragen kann, wäre schlechter dran als einer ohne Liste.
 */

type Abruf = (url: string, init: RequestInit) => Promise<Response>;

let geladen: Promise<readonly EditorPlaceKind[]> | undefined;

export function ladeOrtsarten(abruf: Abruf = (url, init) => fetch(url, init)): Promise<readonly EditorPlaceKind[]> {
    geladen ??= abruf(EDITOR_PLACE_KINDS_URL, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "same-origin",
        // Mit dem ETag kommt eine unveränderte Liste als 304 aus dem Cache des Browsers.
        cache: "no-cache",
    })
        .then(async (antwort) => (antwort.ok ? ((await antwort.json()) as EditorPlaceKindList).kinds : []))
        .catch(() => [])
        .then((arten) => {
            if (arten.length === 0) geladen = undefined;
            return arten;
        });
    return geladen;
}

/** Nur für Tests: die geholte Liste vergessen. */
export function vergissOrtsarten(): void {
    geladen = undefined;
}

/** Legacys Regel (`filterPlaceKinds`): Teilstück, Groß und Klein egal, Reihenfolge wie geliefert (alphabetisch). Leer heißt alles. */
export function filtereOrtsarten(arten: readonly EditorPlaceKind[], text: string): EditorPlaceKind[] {
    const gesucht = text.trim().toLocaleLowerCase("de");
    if (gesucht === "") return [...arten];
    return arten.filter((art) => art.kind.toLocaleLowerCase("de").includes(gesucht));
}

/** Der Name in Stücken, das getippte Teilstück als Treffer (jede Stelle, an der es vorkommt). */
export function teileNachTreffer(name: string, text: string): { text: string; treffer: boolean }[] {
    const gesucht = text.trim().toLocaleLowerCase("de");
    if (gesucht === "") return [{ text: name, treffer: false }];
    const klein = name.toLocaleLowerCase("de");
    const stuecke: { text: string; treffer: boolean }[] = [];
    let ab = 0;
    for (let stelle = klein.indexOf(gesucht); stelle !== -1; stelle = klein.indexOf(gesucht, ab)) {
        if (stelle > ab) stuecke.push({ text: name.slice(ab, stelle), treffer: false });
        stuecke.push({ text: name.slice(stelle, stelle + gesucht.length), treffer: true });
        ab = stelle + gesucht.length;
    }
    if (ab < name.length) stuecke.push({ text: name.slice(ab), treffer: false });
    return stuecke;
}
