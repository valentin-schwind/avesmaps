import {
    EDITOR_PLACE_TEXT_FIELDS,
    type EditorPlaceDetail,
    type EditorPlaceTextField,
    type PlaceSubtype,
    type PlaceUpdateBody,
} from "@avesmaps3d/shared";
import { wikiLage, type WikiFeldLage } from "../fenster/wiki-feld";

/**
 * Der Entwurf eines Orts im Ortseditor (WI-0128 E11; EDIT-0001 §4.3; Gesamtmockup Version 7, „Eigenschaften & Overrides“). Reine
 * Rechnung ohne Vue, damit Vitest sie prüft.
 *
 * - Ein Feld gilt als **eigener Wert**, wenn es vom Wiki-Stand abweicht: Dann steht der Wiki-Wert durchgestrichen daneben, mit ↺.
 * - ↺ setzt das Feld im Entwurf auf den Wiki-Wert und merkt sich die Herkunft `wiki`; gespeichert wird das als `{ revert: "wiki" }`, damit
 *   der Server Wert UND Herkunft aus dem Wiki-Stand setzt.
 * - **Gespeichert wird nur, was sich gegenüber dem gelesenen Stand ändert** (`aenderungen`); eine Operation, eine Revision.
 * - **Konflikt:** Hat jemand anderes inzwischen gespeichert, sagt `fremdeFelder`, welche Felder er geändert hat. Überschneiden sie sich
 *   nicht mit den eigenen, darf die eigene Änderung auf den neuen Stand (Mockup: „Eigene Änderung auf Revision N anwenden“).
 */

/** Die Felder in der Reihenfolge des Formulars (Gesamtmockup): So nennen Speicherleiste und Konflikt sie. */
export const ENTWURF_FELDER = [
    "name",
    "subtype",
    "kind",
    "einwohner",
    "oberhaupt",
    "lage",
    "description",
    "ruined",
    "hidden",
    "seaport",
    "nodix",
    "underground",
    "withdrawn",
    "approximate",
] as const satisfies readonly (keyof Aenderungen)[];

/**
 * Die Merkmale am Ort, je ein Haken, in der Folge des Kastens „Merkmale“. Seehafen und Nodix sind gespeicherte Merkmale wie in Legacy,
 * keine Folge von Seewegen oder Kraftlinien (Betreiber 2026-10-11); Unterirdisch und Entrückt sind eigene von Avesmaps3D (D21), ebenso
 * die ungefähre Lage (WI-0267, Kanal OPS-000067).
 */
export const MERKMALE = ["ruined", "hidden", "seaport", "nodix", "underground", "withdrawn", "approximate"] as const;
export type Merkmal = (typeof MERKMALE)[number];
export type EntwurfFeld = (typeof ENTWURF_FELDER)[number];

export interface EntwurfText {
    wert: string;
    /** Der Wert soll der Wiki-Stand sein (↺, Herkunft `wiki`). */
    wiki: boolean;
}

export interface Entwurf extends Record<Merkmal, boolean> {
    name: string;
    /** Der Name soll der Wiki-Name sein (↺, Herkunft `wiki`; WI-0225). Fehlt in einem älteren gesicherten Entwurf: nicht. */
    nameWiki?: boolean;
    subtype: string;
    /** Die Ortsgröße soll die des Wiki sein (↺, Herkunft `wiki`; WI-0225). */
    subtypeWiki?: boolean;
    kind: string;
    texte: Record<EditorPlaceTextField, EntwurfText>;
}

export type Aenderungen = PlaceUpdateBody["changes"];

const textVon = (detail: EditorPlaceDetail, feld: EditorPlaceTextField): EntwurfText => {
    const text = detail.fields[feld];
    // Ohne eigenen Wert zeigt das Feld den Wiki-Wert; er gilt als Wiki-Wert, bis jemand ihn ändert.
    if (text.value === null) return { wert: text.wiki ?? "", wiki: text.wiki !== null };
    return { wert: text.value, wiki: text.origin === "wiki" };
};

const merkmaleVon = (detail: EditorPlaceDetail): Record<Merkmal, boolean> =>
    Object.fromEntries(MERKMALE.map((merkmal) => [merkmal, detail[merkmal]])) as Record<Merkmal, boolean>;

/** Der Entwurf, wie er nach dem Laden dasteht: genau der gelesene Stand. */
export function entwurfAus(detail: EditorPlaceDetail): Entwurf {
    return {
        name: detail.name,
        nameWiki: detail.herkunft?.["name"] === "wiki",
        subtype: detail.subtype,
        subtypeWiki: detail.herkunft?.["subtype"] === "wiki",
        kind: detail.kind ?? "",
        ...merkmaleVon(detail),
        texte: Object.fromEntries(EDITOR_PLACE_TEXT_FIELDS.map((feld) => [feld, textVon(detail, feld)])) as Record<
            EditorPlaceTextField,
            EntwurfText
        >,
    };
}

const gleich = (a: EntwurfText, b: EntwurfText): boolean => a.wert === b.wert && a.wiki === b.wiki;

/** Was sich gegenüber dem gelesenen Stand ändert, in der Form von `place.update`; leer, wenn nichts. */
export function aenderungen(detail: EditorPlaceDetail, entwurf: Entwurf): Aenderungen {
    const basis = entwurfAus(detail);
    const raus: Partial<Record<keyof Aenderungen, unknown>> = {};
    const name = entwurf.name.trim();
    // Geändert ist der WERT; ↺ schreibt ihn als `{ revert: "wiki" }`, damit der Server Name UND Herkunft setzt (WI-0225).
    if (name !== basis.name) raus.name = entwurf.nameWiki === true ? { revert: "wiki" } : name;
    if (entwurf.subtype !== basis.subtype)
        raus.subtype = entwurf.subtypeWiki === true ? { revert: "wiki" } : (entwurf.subtype as PlaceSubtype);
    const kind = entwurf.kind.trim();
    if (kind !== basis.kind) raus.kind = kind === "" ? null : kind;
    for (const merkmal of MERKMALE) if (entwurf[merkmal] !== basis[merkmal]) raus[merkmal] = entwurf[merkmal];
    for (const feld of EDITOR_PLACE_TEXT_FIELDS) {
        const jetzt = entwurf.texte[feld];
        if (gleich(jetzt, basis.texte[feld])) continue;
        const wert = jetzt.wert.trim();
        // Ein Feld ohne eigenen Wert zeigt den Wiki-Wert; geleert bleibt es ohne eigenen Wert, am Ort ändert sich nichts.
        if (!jetzt.wiki && wert === "" && detail.fields[feld].value === null) continue;
        raus[feld] = jetzt.wiki ? { revert: "wiki" } : { value: wert === "" ? null : wert };
    }
    return raus as Aenderungen;
}

export const geaendert = (aenderung: Aenderungen): EntwurfFeld[] =>
    ENTWURF_FELDER.filter((feld) => aenderung[feld] !== undefined);

/**
 * Die Zeile des Wiki-Felds (`fenster/wiki-feld.ts`, WI-0225): EINE Regel für alle Editoren. Ohne Artikel hat das Feld kein Gegenstück.
 * 🪤 Am Ort heißt ein fehlender Wiki-Wert (`null`) vorerst „unbekannt“, nicht „das Wiki kennt keinen“: sonst stünde an jedem Feld mit
 * eigenem Wert und leerem Schnappschuss „(leer)“ durchgestrichen, und ↺ löschte den Wert. Das bleibt, bis der Wiki-Abgleich den Unterschied
 * liefert.
 */
export function wikiZeile(detail: EditorPlaceDetail, entwurf: Entwurf, feld: EditorPlaceTextField): WikiFeldLage {
    const text = entwurf.texte[feld];
    return wikiLage({
        eigen: text.wert,
        wiki: detail.fields[feld].wiki ?? undefined,
        mitWiki: detail.wiki !== null,
        herkunft: text.wiki ? "wiki" : "manual",
    });
}

/** Das Feld trägt einen eigenen Wert, der vom Wiki-Stand abweicht (Beschriftung braun, Wiki-Wert durchgestrichen mit ↺). */
export const eigenerWert = (detail: EditorPlaceDetail, entwurf: Entwurf, feld: EditorPlaceTextField): boolean =>
    wikiZeile(detail, entwurf, feld).zurueck;

/** Die Zeile des Namens (WI-0225): Wiki-Name aus dem Schnappschuss; fehlt er, ist er unbekannt, ohne Artikel hat er kein Gegenstück. */
export function nameZeile(detail: EditorPlaceDetail, entwurf: Entwurf): WikiFeldLage {
    return wikiLage({
        eigen: entwurf.name,
        wiki: detail.nameWiki,
        mitWiki: detail.wiki !== null,
        herkunft: entwurf.nameWiki === true ? "wiki" : "manual",
    });
}

/** ↺ am Namen: der Wiki-Name, Herkunft `wiki`. */
export function aufWikiName(detail: EditorPlaceDetail, entwurf: Entwurf): Entwurf {
    return detail.nameWiki === undefined ? entwurf : { ...entwurf, name: detail.nameWiki, nameWiki: true };
}

/** Der Name getippt: ein eigener Wert, auch wenn er wie der Wiki-Name lautet. */
export const setzeName = (entwurf: Entwurf, wert: string): Entwurf => ({ ...entwurf, name: wert, nameWiki: false });

/**
 * Die Zeile der Ortsgröße (WI-0225): die Ortsgröße laut Wiki, in der Beschriftung des Auswahlfelds (`beschrifte`, Legacy: „aus der
 * EIGENEN Liste dieses Fensters“). Fehlt sie oder ist sie geraten, ist sie unbekannt; ohne Artikel hat sie kein Gegenstück.
 */
export function groesseZeile(
    detail: EditorPlaceDetail,
    entwurf: Entwurf,
    beschrifte: (schluessel: string) => string,
): WikiFeldLage {
    return wikiLage({
        eigen: entwurf.subtype,
        wiki: detail.subtypeWiki,
        mitWiki: detail.wiki !== null,
        herkunft: entwurf.subtypeWiki === true ? "wiki" : "manual",
        formatiere: (wert) => beschrifte(String(wert)),
    });
}

/** ↺ an der Ortsgröße: die des Wiki, Herkunft `wiki`. */
export function aufWikiGroesse(detail: EditorPlaceDetail, entwurf: Entwurf): Entwurf {
    return detail.subtypeWiki === undefined ? entwurf : { ...entwurf, subtype: detail.subtypeWiki, subtypeWiki: true };
}

/** Die Ortsgröße gewählt: ein eigener Wert. */
export const setzeGroesse = (entwurf: Entwurf, wert: string): Entwurf => ({
    ...entwurf,
    subtype: wert,
    subtypeWiki: false,
});

/** ↺ im Entwurf: das Feld auf den Wiki-Wert, Herkunft `wiki`. */
export function aufWiki(detail: EditorPlaceDetail, entwurf: Entwurf, feld: EditorPlaceTextField): Entwurf {
    const wiki = detail.fields[feld].wiki;
    if (wiki === null) return entwurf;
    return { ...entwurf, texte: { ...entwurf.texte, [feld]: { wert: wiki, wiki: true } } };
}

/** „↺ Alles auf Wiki-Werte“: jedes Feld mit eigenem Wert zurück; die Zahl sagt, wie viele es sind. */
export function allesAufWiki(detail: EditorPlaceDetail, entwurf: Entwurf): Entwurf {
    const texte = EDITOR_PLACE_TEXT_FIELDS.reduce(
        (stand, feld) => (eigenerWert(detail, stand, feld) ? aufWiki(detail, stand, feld) : stand),
        entwurf,
    );
    const mitName = nameZeile(detail, texte).zurueck ? aufWikiName(detail, texte) : texte;
    return groesseZeile(detail, mitName, String).zurueck ? aufWikiGroesse(detail, mitName) : mitName;
}

export const eigeneWerte = (detail: EditorPlaceDetail, entwurf: Entwurf): number =>
    EDITOR_PLACE_TEXT_FIELDS.filter((feld) => eigenerWert(detail, entwurf, feld)).length +
    (nameZeile(detail, entwurf).zurueck ? 1 : 0) +
    (groesseZeile(detail, entwurf, String).zurueck ? 1 : 0);

/** Ein Text getippt: Er ist ein eigener Wert, auch wenn er zufällig wie der Wiki-Wert lautet. */
export function setzeText(entwurf: Entwurf, feld: EditorPlaceTextField, wert: string): Entwurf {
    return { ...entwurf, texte: { ...entwurf.texte, [feld]: { wert, wiki: false } } };
}

/** Welche Felder sich zwischen zwei gelesenen Ständen unterscheiden (was der andere geändert hat). */
export function fremdeFelder(vorher: EditorPlaceDetail, jetzt: EditorPlaceDetail): EntwurfFeld[] {
    const a = entwurfAus(vorher);
    const b = entwurfAus(jetzt);
    return ENTWURF_FELDER.filter((feld) =>
        (EDITOR_PLACE_TEXT_FIELDS as readonly string[]).includes(feld)
            ? !gleich(a.texte[feld as EditorPlaceTextField], b.texte[feld as EditorPlaceTextField])
            : a[feld as keyof Omit<Entwurf, "texte">] !== b[feld as keyof Omit<Entwurf, "texte">],
    );
}

/**
 * Der Entwurf auf einem neuen gelesenen Stand (E12, T12.8): Die eigenen Änderungen gegenüber `vorher` bleiben, alles andere ist der
 * neue Stand. So rückt die Basis vor, wenn der Ort verschoben wurde (die Lage gehört nicht zum Entwurf), ohne Selbstkonflikt.
 */
export function aufNeuenStand(vorher: EditorPlaceDetail, jetzt: EditorPlaceDetail, entwurf: Entwurf): Entwurf {
    const eigene = geaendert(aenderungen(vorher, entwurf));
    const neu = entwurfAus(jetzt);
    const texte = { ...neu.texte };
    for (const feld of EDITOR_PLACE_TEXT_FIELDS) if (eigene.includes(feld)) texte[feld] = entwurf.texte[feld];
    return {
        name: eigene.includes("name") ? entwurf.name : neu.name,
        nameWiki: eigene.includes("name") ? entwurf.nameWiki === true : neu.nameWiki === true,
        subtype: eigene.includes("subtype") ? entwurf.subtype : neu.subtype,
        subtypeWiki: eigene.includes("subtype") ? entwurf.subtypeWiki === true : neu.subtypeWiki === true,
        kind: eigene.includes("kind") ? entwurf.kind : neu.kind,
        ...(Object.fromEntries(
            MERKMALE.map((merkmal) => [merkmal, eigene.includes(merkmal) ? entwurf[merkmal] : neu[merkmal]]),
        ) as Record<Merkmal, boolean>),
        texte,
    };
}

export const ueberschneiden = (eigene: readonly EntwurfFeld[], fremde: readonly EntwurfFeld[]): EntwurfFeld[] =>
    eigene.filter((feld) => fremde.includes(feld));
