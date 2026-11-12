import {
    EDITOR_TERRITORY_DETAIL_FIELDS,
    type EditorTerritoryDetail,
    type EditorTerritoryDetailField,
    type FeldHerkuenfte,
    type WikiArtikel,
} from "@avesmaps3d/shared";
import {
    herkunftIm,
    mitHerkunft,
    wikiLage,
    wikiWertIm,
    type WikiFeldLage,
    type WikiFelder,
} from "../fenster/wiki-feld";
import type { WikiBoxFeld } from "../fenster/wiki-box";
import type { MessageKey } from "../i18n/i18n";

/**
 * Die 17 Detailfelder eines Herrschaftsgebiets als Wiki-Felder (WI-0209 G6; Bauteil `fenster/wiki-feld.vue`, Design Guide §13.8; Modell c
 * der Orchestrierung): Beschriftung, Kasten der Eigenschaften, ob mehrzeilig, und wie Entwurf und Zeile sie rechnen. Die Herkunft steht
 * am Server in `territory_detail_field_origin` (`override` heißt manual), der Wiki-Wert im Schnappschuss `wiki_territory_snapshot`
 * (Detail-Antwort: `details[feld].wiki`; fehlt der Schlüssel, ist er unbekannt).
 *
 * - Im Entwurf steht jedes Detailfeld unter seinem Schlüssel (`ruler`, `founded_text` …): Text, `""` der bewusste Leerwert, `null` kein
 *   Wert. Dazu `wiki` (die Wiki-Werte als `WikiArtikel.werte`) und `herkunft` (`FeldHerkuenfte`), damit `mitHerkunft`, `aufWikiWert` und
 *   `wikiAenderung` aus `fenster/wiki-feld.ts` wie in jedem Editor rechnen.
 * - „Hauptstadt“ und „Sitz“ als Text (`capital_name`, `seat_name`) sind die Namen, die das Wiki nennt; verknüpft wird die Hauptstadt als
 *   Ort (B2), der Sitz bleibt als Ort nur lesend (E1).
 */

/** Die Felder je Kasten der Eigenschaften, in der Folge des Blatts. */
export const DETAIL_KAESTEN = {
    identitaet: ["form_of_government", "continent"],
    herrschaft: ["capital_name", "seat_name", "ruler", "founder"],
    landUndLeute: [
        "language",
        "currency",
        "population",
        "trade_goods",
        "trade_zone",
        "political",
        "geographic",
        "blazon",
    ],
    zeit: ["founded_text", "dissolved_text"],
    /** Die Zugehörigkeit, wie das Wiki sie nennt: im Kasten „Im Baum“, wo sie hingehört (WI-0253); die Wiki-Box trägt nur den Artikel. */
    imBaum: ["affiliation_raw"],
} as const satisfies Record<string, readonly EditorTerritoryDetailField[]>;

/**
 * Die Detailfelder, die ein Sync am Gebiet ändern kann (WI-0253, Wiki-Box; `wiki/abgleich/uebernahme/gebiet.ts`: die 14 Felder des Abgleichs und der Kontinent). `Handelszone` und `Politisch` lesen den Wiki-Wert,
 * ein Sync schreibt sie nicht; sie zählen darum nicht zu „Das Wiki ist neuer“.
 */
export const GEBIET_SYNC_FELDER: readonly EditorTerritoryDetailField[] = EDITOR_TERRITORY_DETAIL_FIELDS.filter(
    (feld) => feld !== "trade_zone" && feld !== "political",
);

/** Die Beschriftung je Feld: die des Infopanels, wo es eine gibt (dasselbe Feld heißt überall gleich). */
export const DETAIL_NAMEN: Readonly<Record<EditorTerritoryDetailField, MessageKey>> = {
    continent: "infoPanel.field.continent",
    form_of_government: "infoPanel.field.herrschaftsform",
    capital_name: "gebietseditor.feld.hauptstadtText",
    seat_name: "gebietseditor.feld.sitzText",
    ruler: "infoPanel.field.oberhaupt",
    founder: "infoPanel.field.gruender",
    language: "infoPanel.field.sprache",
    currency: "infoPanel.field.waehrung",
    population: "infoPanel.field.einwohnerzahl",
    trade_goods: "infoPanel.field.handelswaren",
    trade_zone: "infoPanel.field.handelszone",
    political: "infoPanel.field.politisch",
    geographic: "infoPanel.field.geographisch",
    blazon: "infoPanel.field.wappenbeschreibung",
    founded_text: "infoPanel.field.gruendung",
    dissolved_text: "infoPanel.field.aufloesung",
    affiliation_raw: "infoPanel.field.zugehoerigkeitRoh",
};

/** Lange Texte bekommen einen Textbereich; Beschriftung und ↺ stehen dann oben. */
export const DETAIL_MEHRZEILIG: ReadonlySet<EditorTerritoryDetailField> = new Set([
    "political",
    "geographic",
    "trade_goods",
    "blazon",
    "affiliation_raw",
]);

/** Ist `feld` eines der 17 Detailfelder? */
export const istDetailfeld = (feld: string): feld is EditorTerritoryDetailField =>
    (EDITOR_TERRITORY_DETAIL_FIELDS as readonly string[]).includes(feld);

export type GebietDetailfelder = { readonly [F in EditorTerritoryDetailField]: string | null };

/** Die Detailfelder des Entwurfs aus dem Detail: Werte, Wiki-Werte und Herkunft. */
export function detailfelderAus(d: EditorTerritoryDetail): GebietDetailfelder & WikiFelder {
    const werte: WikiArtikel["werte"] = {};
    const herkunft: { [feld: string]: "wiki" | "manual" } = {};
    const felder = {} as { -readonly [F in EditorTerritoryDetailField]: string | null };
    for (const feld of EDITOR_TERRITORY_DETAIL_FIELDS) {
        const eintrag = d.details[feld];
        felder[feld] = eintrag?.value ?? null;
        if (eintrag !== undefined && "wiki" in eintrag) werte[feld] = eintrag.wiki ?? null;
        if (eintrag?.origin !== undefined) herkunft[feld] = eintrag.origin === "wiki" ? "wiki" : "manual";
    }
    return {
        ...felder,
        wiki: { key: d.wiki?.key ?? d.id, url: d.wiki?.url ?? "", name: d.name, werte },
        herkunft: herkunft as FeldHerkuenfte,
    };
}

/** Welche Detailfelder sich zwischen zwei Ständen unterscheiden (getrimmt wie der Server; `null` und `""` sind verschieden). */
export function detailUnterschiede(a: GebietDetailfelder, b: GebietDetailfelder): EditorTerritoryDetailField[] {
    const norm = (wert: string | null): string | null => (wert === null ? null : wert.trim());
    return EDITOR_TERRITORY_DETAIL_FIELDS.filter((feld) => norm(a[feld]) !== norm(b[feld]));
}

/**
 * Getippt in einem Detailfeld: der Wert mit Herkunft manual. Leert das Tippen ein Feld, das vorher keinen Wert hatte, ist es wieder
 * dieses (kein Wert, die Herkunft von vorher), damit Tippen und Löschen keinen bewussten Leerwert schreibt.
 */
export function tippeDetail<F extends GebietDetailfelder & WikiFelder>(
    felder: F,
    vorher: GebietDetailfelder & WikiFelder,
    feld: EditorTerritoryDetailField,
    wert: string,
): F {
    if (wert.trim() !== "" || vorher[feld] !== null) return mitHerkunft(felder, feld, wert, "manual");
    const herkunft = Object.fromEntries(Object.entries(felder.herkunft).filter(([schluessel]) => schluessel !== feld));
    const alte = vorher.herkunft[feld];
    return { ...felder, [feld]: null, herkunft: alte === undefined ? herkunft : { ...herkunft, [feld]: alte } };
}

/** Die Zeile eines Detailfelds: Zustand aus Wert, Wiki-Wert und Herkunft (`wikiLage`); ohne Schreibrecht lesend. */
export function detailLage(
    felder: GebietDetailfelder & WikiFelder,
    feld: EditorTerritoryDetailField,
    lesend: boolean,
): WikiFeldLage {
    return wikiLage({
        eigen: felder[feld],
        wiki: wikiWertIm(felder, feld),
        herkunft: herkunftIm(felder, feld),
        lesend,
    });
}

/**
 * Die Felder des Gebiets für die Wiki-Box (WI-0253): die Detailfelder, die ein Sync ändern kann, je mit der Zeile des Wiki-Felds (`detailLage`, dieselbe Rechnung wie in den Eigenschaften) und dem Vermerk, ob der Wert
 * dem Wiki folgt. Die Box rechnet daraus „Das Wiki ist neuer“, „n von m Feldern folgen dem Wiki“ und die Zeilen „vorher → nachher“. Reine Rechnung ohne Vue; `namen` liefert die Beschriftung.
 */
export function gebietWikiBoxFelder(
    felder: GebietDetailfelder & WikiFelder,
    lesend: boolean,
    namen: (feld: EditorTerritoryDetailField) => string,
): WikiBoxFeld[] {
    return GEBIET_SYNC_FELDER.map((feld) => ({
        id: feld,
        plan: [feld],
        name: namen(feld),
        lage: detailLage(felder, feld, lesend),
        folgt: herkunftIm(felder, feld) === "wiki",
        eigen: felder[feld] ?? undefined,
        mehrzeilig: DETAIL_MEHRZEILIG.has(feld),
    }));
}
