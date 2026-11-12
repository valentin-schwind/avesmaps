import {
    SEARCH_PRAEPOSITIONEN,
    SEARCH_VORKOMMEN_SICHTBAR,
    type InhalteVorkommenArt,
    type SearchAnfrage,
    type SearchGebietHit,
    type SearchHit,
    type SearchLandmarkeHit,
    type SearchLeuchtenBegriff,
    type SearchResponse,
    type SearchSpracheHit,
    type SearchVorkommenHit,
    type SearchZahl,
    type SearchZielGruppe,
    type SearchZielHit,
} from "@avesmaps3d/shared";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import type { MessageKey } from "../i18n/i18n";

/**
 * Die Trefferliste der Spotlight-Suche samt den Vorkommen (WI-0257, S3b), als reine Daten: Was die Antwort des Servers an Sektionen, Zielen, Chips und Hinweisen trägt, in der Reihenfolge, in der
 * es steht – ohne Vue und ohne Browser. Die Komponente zeichnet, diese Datei entscheidet.
 *
 * 🔴 Nichts wird geraten: Eine Zeile steht da, wenn der Server sie geliefert hat; die Zahl der leuchtenden Gegenden kommt erst, wenn `GET /api/search/zahlen` sie nennt. Was fehlt, fehlt.
 */

/** Das Zeichen der Kategorie, aus dem vorhandenen Satz (`controls/editor-zeichen.vue`): Blatt, gefüllte Pfote, Korb, Person. */
export const KATEGORIE_ZEICHEN: Readonly<Record<InhalteVorkommenArt, EditorZeichenName>> = {
    flora: "flora",
    fauna: "fauna",
    ware: "ware",
    spezies: "spezies",
};

/** Der Name der Kategorie in der Sprachtafel (derselbe wie in den Zeilen des Infopanels). */
export const KATEGORIE_NAME: Readonly<Record<InhalteVorkommenArt, MessageKey>> = {
    flora: "infoPanel.lore.flora",
    fauna: "infoPanel.lore.fauna",
    ware: "infoPanel.lore.ware",
    spezies: "infoPanel.lore.spezies",
};

/** Eine Zeile der Liste; `key` ist stabil und eindeutig (Vue-Schlüssel und Kennung für die Pfeiltasten). */
export type SuchZeile =
    | { readonly art: "hit"; readonly key: string; readonly hit: SearchHit }
    | { readonly art: "vorkommen"; readonly key: string; readonly hit: SearchVorkommenHit }
    | { readonly art: "gebiet"; readonly key: string; readonly hit: SearchGebietHit }
    | { readonly art: "landmarke"; readonly key: string; readonly hit: SearchLandmarkeHit }
    | { readonly art: "sprache"; readonly key: string; readonly hit: SearchSpracheHit }
    | {
          readonly art: "ziel";
          readonly key: string;
          readonly hit: SearchZielHit;
          readonly begriff: SearchLeuchtenBegriff;
          /** Wofür das Ziel steht: eine Landschaft, ein Herrschaftsgebiet oder ein Ort. */
          readonly gruppe: SearchZielGruppe["art"];
      };

/** Eine Sektion mit Überschrift; `weitere` ist die Zahl der Treffer darüber hinaus („… und N weitere“), `ungeprueft` die der nicht gerechneten Ziele. */
export interface SuchSektion {
    readonly id: string;
    readonly titel: SektionsTitel | undefined;
    readonly zeilen: readonly SuchZeile[];
    readonly weitere: number;
    readonly ungeprueft: number;
}

/** Die Überschrift: ein Wort der Sprachtafel oder „Begriff Präposition … · Gruppe“ über den Zielen. */
export type SektionsTitel =
    | {
          readonly art: "sektion";
          readonly key:
              | "search.sektion.vorkommen"
              | "search.sektion.gebiete"
              | "search.sektion.sprachen"
              | "search.sektion.landmarken";
      }
    | {
          readonly art: "ziele";
          readonly begriff: string;
          readonly praeposition: string;
          readonly gruppe: SearchZielGruppe["art"];
      };

export interface SuchAnsicht {
    /** Die Sektionen in der Reihenfolge der Anzeige. */
    readonly sektionen: readonly SuchSektion[];
    /** Alle Zeilen in der Reihenfolge der Anzeige: Die Pfeiltasten gehen darüber. */
    readonly flach: readonly SuchZeile[];
    /** Die Präpositionen als Chips unter dem Begriff; `undefined`, wo keine stehen. */
    readonly chips: { readonly begriff: string; readonly praepositionen: readonly string[] } | undefined;
    /** Die leise Zeile „in …, auf …, südlich von … grenzt ein“ unter einem Vorkommen ohne Präposition. */
    readonly hinweis: boolean;
    /** Die Präposition steht, aber die Rechnung der Ziele war überlastet: erneut fragen, nie „keine Treffer“ zeigen. */
    readonly zieleFehlen: boolean;
    /** Die Präposition steht, und es gibt keine Ziele mit Treffern. */
    readonly zieleLeer: boolean;
    /** Mindestens ein Ziel ist im Wiki genannt: Dann erklärt eine Zeile, was die Marke heißt. */
    readonly zieleErklaerung: boolean;
}

/** Wie viele Präpositionen es gibt: Stehen weniger da, hat der Server auf das Getippte eingegrenzt. */
const PRAEPOSITIONEN_ZAHL = SEARCH_PRAEPOSITIONEN.length;

/**
 * Stehen die Präpositionen als Chips da oder nur als leise Zeile? Als Chips, sobald der Begriff abgeschlossen ist (Leerzeichen dahinter) oder die Liste eingegrenzt ist („wirselkraut n“); steht der
 * Begriff ohne Leerzeichen da, bleibt es die leise Zeile.
 */
export function zeigtChips(anfrage: SearchAnfrage | undefined, eingabe: string): boolean {
    const liste = anfrage?.praepositionen;
    if (liste === undefined || liste.length === 0) return false;
    return /\s$/u.test(eingabe) || liste.length < PRAEPOSITIONEN_ZAHL;
}

/** Steht nach der Präposition noch nichts? Dann zeigt die Liste Vorschläge (die im Wiki genannten, dann die größten), keine Suche: Dort wäre „N nicht geprüft“ Rauschen. */
export function restLeer(anfrage: SearchAnfrage | undefined, eingabe: string): boolean {
    const praeposition = anfrage?.praeposition;
    if (praeposition === undefined) return false;
    return eingabe.trim().toLowerCase().endsWith(praeposition.toLowerCase());
}

function zielSektionen(anfrage: SearchAnfrage | undefined, eingabe: string): SuchSektion[] {
    const praeposition = anfrage?.praeposition;
    if (anfrage === undefined || praeposition === undefined || anfrage.ziele === undefined) return [];
    const vorschlaege = restLeer(anfrage, eingabe);
    return anfrage.ziele
        .filter((gruppe) => gruppe.hits.length > 0)
        .map((gruppe) => ({
            id: `ziele:${gruppe.art}`,
            titel: { art: "ziele", begriff: anfrage.begriff.name, praeposition, gruppe: gruppe.art },
            zeilen: gruppe.hits.map((hit, index) => ({
                art: "ziel",
                key: `ziel:${gruppe.art}:${String(index)}:${hit.text}`,
                hit,
                begriff: anfrage.begriff,
                gruppe: gruppe.art,
            })),
            weitere: Math.max(0, gruppe.total - gruppe.hits.length),
            ungeprueft: vorschlaege ? 0 : gruppe.ungeprueft,
        }));
}

/** Die Ansicht der Antwort. `eingabe` ist der Text im Feld, wie getippt (mit Leerzeichen am Ende). */
export function baueAnsicht(response: SearchResponse | undefined, eingabe: string): SuchAnsicht {
    if (response === undefined) {
        return {
            sektionen: [],
            flach: [],
            chips: undefined,
            hinweis: false,
            zieleFehlen: false,
            zieleLeer: false,
            zieleErklaerung: false,
        };
    }
    const anfrage = response.anfrage;
    const gewoehnlich: SuchSektion | undefined =
        response.hits.length === 0
            ? undefined
            : {
                  id: "hits",
                  titel: undefined,
                  zeilen: response.hits.map((hit) => ({ art: "hit", key: `${hit.kind}:${hit.id}`, hit })),
                  weitere: 0,
                  ungeprueft: 0,
              };
    const vorkommen: SuchSektion | undefined =
        response.vorkommen === undefined
            ? undefined
            : {
                  id: "vorkommen",
                  titel: { art: "sektion", key: "search.sektion.vorkommen" },
                  zeilen: response.vorkommen.hits.map((hit) => ({ art: "vorkommen", key: `vorkommen:${hit.id}`, hit })),
                  weitere: Math.max(0, response.vorkommen.total - response.vorkommen.hits.length),
                  ungeprueft: 0,
              };
    const gebiete: SuchSektion | undefined =
        response.gebiete === undefined
            ? undefined
            : {
                  id: "gebiete",
                  titel: { art: "sektion", key: "search.sektion.gebiete" },
                  zeilen: response.gebiete.hits.map((hit) => ({ art: "gebiet", key: `gebiet:${hit.id}`, hit })),
                  weitere: Math.max(0, response.gebiete.total - response.gebiete.hits.length),
                  ungeprueft: 0,
              };
    // Die Sprachen der Karte (WI-0261 S5c) stehen hinter den gewöhnlichen Treffern, vor den Vorkommen (Bauvorlage: ORTE, SPRACHEN, VORKOMMEN).
    const sprachen: SuchSektion | undefined =
        response.sprachen === undefined
            ? undefined
            : {
                  id: "sprachen",
                  titel: { art: "sektion", key: "search.sektion.sprachen" },
                  zeilen: response.sprachen.hits.map((hit) => ({ art: "sprache", key: `sprache:${hit.id}`, hit })),
                  weitere: Math.max(0, response.sprachen.total - response.sprachen.hits.length),
                  ungeprueft: 0,
              };
    // Die Landmarken (WI-0271 L6) sind Punkte der Karte wie die Orte: Sie stehen gleich hinter den gewöhnlichen Treffern.
    const landmarken: SuchSektion | undefined =
        response.landmarken === undefined
            ? undefined
            : {
                  id: "landmarken",
                  titel: { art: "sektion", key: "search.sektion.landmarken" },
                  zeilen: response.landmarken.hits.map((hit) => ({
                      art: "landmarke",
                      key: `landmarke:${hit.id}`,
                      hit,
                  })),
                  weitere: Math.max(0, response.landmarken.total - response.landmarken.hits.length),
                  ungeprueft: 0,
              };
    const ziele = zielSektionen(anfrage, eingabe);
    // Ein abgeschlossener Begriff steht vorn: Wer „Baumdrache“ tippt, will den Eintrag, nicht den Ort „Baumdrachental“ vor ihm.
    const vorn = anfrage !== undefined;
    const sektionen = [
        ...ziele,
        ...(vorn ? [vorkommen, gewoehnlich, landmarken, sprachen] : [gewoehnlich, landmarken, sprachen, vorkommen]),
        gebiete,
    ].filter((sektion): sektion is SuchSektion => sektion !== undefined);
    const chips = zeigtChips(anfrage, eingabe)
        ? { begriff: anfrage?.begriff.name ?? "", praepositionen: anfrage?.praepositionen ?? [] }
        : undefined;
    return {
        sektionen,
        flach: sektionen.flatMap((sektion) => sektion.zeilen),
        chips,
        hinweis:
            chips === undefined &&
            vorkommen !== undefined &&
            anfrage?.praepositionen !== undefined &&
            anfrage.praepositionen.length > 0,
        zieleFehlen: anfrage?.praeposition !== undefined && anfrage.ziele === undefined,
        zieleLeer: anfrage?.praeposition !== undefined && anfrage.ziele !== undefined && ziele.length === 0,
        zieleErklaerung: ziele.some((sektion) =>
            sektion.zeilen.some((zeile) => zeile.art === "ziel" && zeile.hit.genannt),
        ),
    };
}

/** Die Kennungen der Vorkommen, deren Zahl nachzuladen ist: nur sichtbare mit Kartenbezug (ohne ihn leuchtet nichts), höchstens `SEARCH_VORKOMMEN_SICHTBAR`. */
export function zahlenFragen(ansicht: SuchAnsicht): string[] {
    return ansicht.flach
        .flatMap((zeile) => (zeile.art === "vorkommen" && zeile.hit.kartenbezug ? [zeile.hit.id] : []))
        .slice(0, SEARCH_VORKOMMEN_SICHTBAR);
}

/** Was hinter der Art eines Vorkommens steht: noch nichts, „überall in Aventurien“, die Zahl der Gegenden, die der Orte oder „noch kein Ort“. */
export type ZahlAnzeige =
    | { readonly art: "keine" }
    | { readonly art: "keinOrt" }
    | { readonly art: "ueberall" }
    | { readonly art: "gegenden"; readonly n: number }
    | { readonly art: "orte"; readonly n: number };

export function zahlAnzeige(hit: SearchVorkommenHit, zahl: SearchZahl | undefined): ZahlAnzeige {
    if (!hit.kartenbezug) return { art: "keinOrt" };
    if (zahl === undefined) return { art: "keine" };
    if (zahl.gegenden > 0) return { art: "gegenden", n: zahl.gegenden };
    if (zahl.orte > 0) return { art: "orte", n: zahl.orte };
    if (zahl.nurKontinent) return { art: "ueberall" };
    return { art: "keinOrt" };
}

/** Die Zahl eines Ziels: Gegenden, sonst Orte (ein Ziel „südlich von Gareth“ kann nur Orte treffen); `undefined`, wo der Server keine nennt. */
export function zielZahl(hit: SearchZielHit): { readonly art: "gegenden" | "orte"; readonly n: number } | undefined {
    if (hit.gegenden !== undefined && hit.gegenden > 0) return { art: "gegenden", n: hit.gegenden };
    if (hit.orte !== undefined && hit.orte > 0) return { art: "orte", n: hit.orte };
    return undefined;
}

/**
 * Was in der Zeile einer Sprache hinter dem Namen steht (WI-0261 S5c), als Daten: ihre Art (`sprache.art.sprache`, `sprache.art.sprachgruppe`; bei einem Dialekt „Dialekt von …“), der Text,
 * über den sie gefunden wurde, wo er etwas erklärt (ein Wiki-Artikel oder die Legende; über den Namen oder einen Dialekt gefunden, steht er schon im Namen oder in der Art), und die Zahl der
 * Gegenden, in denen sie leuchtet (0: „noch keine Fläche“). Die Komponente setzt die Texte aus der Sprachtafel ein.
 */
export interface SpracheZeilenText {
    readonly art: {
        readonly key: "sprache.art.sprache" | "sprache.art.sprachgruppe" | "search.sprache.dialektVon";
        readonly params?: { readonly sprache: string };
    };
    readonly detail: string | undefined;
    readonly gegenden: number;
}

export function spracheZeilenText(hit: SearchSpracheHit): SpracheZeilenText {
    const art: SpracheZeilenText["art"] =
        hit.gefundenIn === "dialekt"
            ? { key: "search.sprache.dialektVon", params: { sprache: hit.dialektVon ?? "" } }
            : { key: hit.gruppe ? "sprache.art.sprachgruppe" : "sprache.art.sprache" };
    return {
        art,
        detail: hit.gefundenIn === "wiki" || hit.gefundenIn === "legende" ? hit.ueber : undefined,
        gegenden: hit.gegenden,
    };
}

/** Der Text eines Eintrags im Feld, wenn er mit Tab oder dem Chip übernommen wird: Name und ein Leerzeichen (danach kommen die Präpositionen). */
export const eintragsText = (name: string): string => `${name} `;

/** Der Text, wenn eine Präposition gewählt wird: „Begriff Präposition “ (das Leerzeichen am Ende zeigt, dass das Ziel folgt). */
export const praepositionsText = (begriff: string, praeposition: string): string => `${begriff} ${praeposition} `;
