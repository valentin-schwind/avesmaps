import type { EditorSiteCandidate, SiteAddBody } from "@avesmaps3d/shared";

/**
 * Die Auswahl von „Innerorts hinzufügen“ (WI-0196, EDIT-0003 T33 (3)): Was ist gewählt, was steht in der Liste, was geht an den Server.
 *
 * 🔴 Die Vorauswahl im Umkreis ist ein VORSCHLAG (Betreiber: „Zur Vereinfachung der Suche kann man einen "Automatische Auswahl …
 * im Umkreis von N Meilen" mit N = 1 default hinzufügen“): Gewählt ist, was im Umkreis liegt, dazu was man von Hand anhakt, ohne was man
 * von Hand abhakt. Wer den Umkreis ändert, verliert seine Handgriffe nicht. Einträge ohne Lage liegen in keinem Umkreis; sie wählt man
 * über die Suche.
 */

/** Ein Kandidat eindeutig über Art und Kennung: Eine Stätte und ein Kartenpunkt könnten dieselbe Zeichenfolge tragen. */
export const kandidatSchluessel = (kandidat: Pick<EditorSiteCandidate, "kind" | "id">): string =>
    `${kandidat.kind}:${kandidat.id}`;

/** Die Vorgabe des Umkreises in Meilen (Betreiber: „N = 1 default“). */
export const UMKREIS_VORGABE = 1;

/** Höchstens so viele Zeilen der Suche stehen da; der Rest kommt mit einer genaueren Suche. */
export const ZEILEN_MAX = 120;

export interface Handgriffe {
    /** Von Hand angehakt (auch außerhalb des Umkreises). */
    readonly dazu: ReadonlySet<string>;
    /** Von Hand abgehakt (auch innerhalb des Umkreises). */
    readonly weg: ReadonlySet<string>;
}

export const KEINE_HANDGRIFFE: Handgriffe = { dazu: new Set(), weg: new Set() };

/** Liegt der Kandidat im Umkreis? Nur mit Lage; ein Umkreis unter 0 oder keiner wählt nichts. */
export const imUmkreis = (kandidat: EditorSiteCandidate, meilen: number): boolean =>
    Number.isFinite(meilen) && meilen >= 0 && kandidat.meilen !== undefined && kandidat.meilen <= meilen;

/** Die gewählten Schlüssel: im Umkreis, dazu von Hand, ohne von Hand abgehakt. */
export function gewaehlt(
    kandidaten: readonly EditorSiteCandidate[],
    meilen: number,
    handgriffe: Handgriffe,
): Set<string> {
    const wahl = new Set<string>();
    for (const kandidat of kandidaten) {
        const schluessel = kandidatSchluessel(kandidat);
        if ((imUmkreis(kandidat, meilen) || handgriffe.dazu.has(schluessel)) && !handgriffe.weg.has(schluessel))
            wahl.add(schluessel);
    }
    return wahl;
}

/** Ein Haken umgelegt: Der Handgriff gilt gegen die Vorauswahl, ein zweiter Klick nimmt ihn zurück. */
export function umschalten(
    kandidat: EditorSiteCandidate,
    meilen: number,
    handgriffe: Handgriffe,
    jetztGewaehlt: boolean,
): Handgriffe {
    const schluessel = kandidatSchluessel(kandidat);
    const dazu = new Set(handgriffe.dazu);
    const weg = new Set(handgriffe.weg);
    dazu.delete(schluessel);
    weg.delete(schluessel);
    const vorgeschlagen = imUmkreis(kandidat, meilen);
    if (jetztGewaehlt && vorgeschlagen) weg.add(schluessel);
    if (!jetztGewaehlt && !vorgeschlagen) dazu.add(schluessel);
    return { dazu, weg };
}

/**
 * Was in der Liste steht: zuerst alles Gewählte (man sieht, was „Fertig“ schreibt), dann die Treffer der Suche nach Abstand, höchstens
 * `ZEILEN_MAX`. Gesucht wird in Name und Art, ohne Groß- und Kleinschreibung.
 */
export function zeilen(
    kandidaten: readonly EditorSiteCandidate[],
    wahl: ReadonlySet<string>,
    suche: string,
): { zeilen: EditorSiteCandidate[]; weitere: number } {
    const wort = suche.trim().toLocaleLowerCase("de");
    const passt = (kandidat: EditorSiteCandidate): boolean =>
        wort === "" || `${kandidat.name} ${kandidat.type ?? ""}`.toLocaleLowerCase("de").includes(wort);
    const oben = kandidaten.filter((kandidat) => wahl.has(kandidatSchluessel(kandidat)));
    const treffer = kandidaten.filter((kandidat) => !wahl.has(kandidatSchluessel(kandidat)) && passt(kandidat));
    return { zeilen: [...oben, ...treffer.slice(0, ZEILEN_MAX)], weitere: Math.max(0, treffer.length - ZEILEN_MAX) };
}

/** Der Körper für `site.add`: Stätten über ihre `site.id`, Kartenpunkte über die `public_id` des Orts. */
export function hinzufuegenKoerper(
    kandidaten: readonly EditorSiteCandidate[],
    wahl: ReadonlySet<string>,
    operationId: string,
): SiteAddBody {
    const gewaehlte = kandidaten.filter((kandidat) => wahl.has(kandidatSchluessel(kandidat)));
    return {
        operationId,
        sites: gewaehlte.filter((kandidat) => kandidat.kind === "staette").map((kandidat) => kandidat.id),
        places: gewaehlte.filter((kandidat) => kandidat.kind === "kartenpunkt").map((kandidat) => kandidat.id),
    };
}
