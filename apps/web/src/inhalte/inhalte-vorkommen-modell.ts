import type {
    InhalteHerkunft,
    InhalteKontinent,
    InhalteVorkommen,
    InhalteVorkommenAendernBody,
    InhalteVorkommenArt,
    InhalteVorkommenBeziehung,
    InhalteVorkommenFelder,
    InhalteVorkommenTreffer,
    InhalteVorkommenUrsprung,
    InhalteVorkommenZiel,
    InhalteVorkommenZustand,
    SourceReferenceKind,
    SourceType,
    WikisyncOrtsrolle,
} from "@avesmaps3d/shared";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import type { Kreis } from "../editor-liste/liste-modell";
import { regelAenderungen, regelAusServer, type EntwurfRegel } from "./inhalte-vorkommen-regeln-modell";

/**
 * Der Entwurf eines Eintrags im Reiter „Vorkommen“ des Fensters „Inhalte bearbeiten“ (WI-0254, Runde 3) als reine Rechnung ohne Vue: der Stand der
 * Mitte (Stammdaten und Quellen des Eintrags) und der rechten Spalte (die Ortszeilen), die Änderungen daran und der Körper von `lore.update`, den
 * „Speichern“ daraus macht.
 *
 * - **Ein Stand, ein Schritt** (`Entwurf<VorkommenStand>`, `fenster/entwurf-kern.ts`): Der Stand ist unveränderlich, jede Änderung gibt einen neuen.
 * - **Die Ortszeilen sind Operationen, keine Folge:** Eine Zeile wird angehängt, gelöst oder zurückgeholt; eine Reihenfolge gibt es nicht (Legacy
 *   führt von Hand hinzugefügte Zeilen hinten). Der Körper nennt nur, was sich ändert.
 * - 🔴 **Das Ziel ist ein Wiki-Artikel ODER ein Name:** Eine neue Zeile nennt ein Kartenobjekt (`kind` + `carrierId`, mit Wiki-Schlüssel), einen
 *   Kontinentbegriff oder einen ungeklärten Namen („ungeklärt übernehmen“, Vali wählte B am Gate; Migration 0235). Die Treffer rechnet erst der Server
 *   beim Speichern; bis dahin steht die Zeile als neu da, ohne Treffer. Ein Name ist nie ein Schlüssel und hat nie Treffer.
 * - **Die Regeln** (Regeleditor, WI-0254 `--weiter`) rechnet `inhalte-vorkommen-regeln-modell.ts`; der Stand trägt sie mit, und ihre Änderungen gehen als `regeln` in den Körper. Ändern heißt dort
 *   neu anlegen und die alte still legen: Der Entwurf kennt neue Regeln, die eine alte ablösen.
 */

export interface VorkommenFelder {
    name: string;
    art: InhalteVorkommenArt;
    gruppe: string;
    lebensraum: string;
    synonyme: string;
    editorNote: string;
    aktiv: boolean;
}

/** Eine Ortszeile im Entwurf: die des Servers oder eine neu angehängte (`neu`). */
export interface EntwurfOrt {
    /** Eine Zeile des Servers trägt ihre `rowId`; eine neue `neu:<n>`. */
    readonly schluessel: string;
    readonly rowId: string | undefined;
    readonly relation: InhalteVorkommenBeziehung;
    readonly wikiKey: string | null;
    readonly name: string;
    readonly keyClass: "continent" | "other";
    readonly targetState: "resolved" | "ambiguous" | "unresolved" | "unmatched";
    /** Die Rolle der Zeile (Migration 0247): Nur `ort` trifft; jede andere bleibt Link ohne Treffer. Eine neue Zeile ist immer ein Ort. Der Editor ändert die Rolle nicht. */
    readonly rolle: WikisyncOrtsrolle;
    readonly treffer: readonly InhalteVorkommenTreffer[];
    readonly trefferGesamt: number;
    readonly state: InhalteVorkommenZustand;
    readonly ursprung: InhalteVorkommenUrsprung;
    readonly herkunft: InhalteHerkunft;
    /** Im Entwurf angehängt, noch nicht gespeichert. */
    readonly neu: boolean;
    /** Nur bei einer neuen Zeile: was der Server schreibt (ein Kartenobjekt, ein Kontinentbegriff oder ein ungeklärter Name). */
    readonly ziel:
        | { kind: InhalteVorkommenTreffer["kind"]; carrierId: string }
        | { kontinent: InhalteKontinent }
        | { name: string }
        | undefined;
}

/**
 * Eine Quellenverknüpfung im Entwurf. Typ, „offiziell“ und Adresse gehören der Quelle im Katalog und stehen nur zum Lesen da (Klappbox der Quellen): Bei einer im Entwurf
 * neu angehängten Quelle kennt die Suche im Katalog Typ und Adresse (`InhalteQuellenZeile`), „offiziell“ aber erst der Server beim Speichern (`null`); eine Quelle, die der
 * Konflikt-Weg ohne Katalogzeile wieder anhängt, kennt keines davon (`null`).
 */
export interface EntwurfQuelle {
    readonly sourceId: string;
    readonly title: string;
    readonly sourceType: SourceType | null;
    readonly offiziell: boolean | null;
    readonly url: string | null;
    readonly referenceKind: SourceReferenceKind | null;
    readonly pages: string;
    readonly note: string;
    readonly state: InhalteVorkommenZustand;
    readonly ursprung: InhalteVorkommenUrsprung;
    readonly herkunft: InhalteHerkunft;
    readonly neu: boolean;
    /** Der Name des Korpus der Quelle, wo er bekannt ist (eine eben per Link angehängte); sonst fehlt er. */
    readonly korpus?: string | null | undefined;
}

export interface VorkommenStand {
    readonly felder: VorkommenFelder;
    readonly orte: readonly EntwurfOrt[];
    readonly quellen: readonly EntwurfQuelle[];
    readonly regeln: readonly EntwurfRegel[];
}

export const istAktiv = (eins: { state: InhalteVorkommenZustand }): boolean => eins.state === "active";

/**
 * Trifft die Zeile Kartenobjekte? Nur die Rolle `ort` trifft (Migration 0247, WI-0253 §23); jede andere Rolle bleibt als Link gespeichert und hat nie Treffer. Die Oberfläche zeigt
 * so eine Zeile mit ihrer Rolle statt als „ungeklärt“.
 */
export const trifftAufDerKarte = (ort: Pick<EntwurfOrt, "rolle">): boolean => ort.rolle === "ort";

/** Der Stand, mit dem ein Entwurf beginnt: genau das, was der Server liefert. */
export function standAusVorkommen(eintrag: InhalteVorkommen): VorkommenStand {
    return {
        felder: {
            name: eintrag.name,
            art: eintrag.art,
            gruppe: eintrag.gruppe ?? "",
            lebensraum: eintrag.lebensraum ?? "",
            synonyme: eintrag.synonyme ?? "",
            editorNote: eintrag.editorNote ?? "",
            aktiv: eintrag.aktiv,
        },
        orte: eintrag.orte.map((o) => ({
            schluessel: o.rowId,
            rowId: o.rowId,
            relation: o.relation,
            wikiKey: o.wikiKey,
            name: o.name,
            keyClass: o.keyClass,
            targetState: o.targetState,
            rolle: o.rolle,
            treffer: o.treffer,
            trefferGesamt: o.trefferGesamt,
            state: o.state,
            ursprung: o.ursprung,
            herkunft: o.herkunft,
            neu: false,
            ziel: undefined,
        })),
        quellen: eintrag.quellen.map((q) => ({
            sourceId: q.sourceId,
            title: q.title,
            sourceType: q.sourceType,
            offiziell: q.offiziell,
            url: q.url ?? null,
            referenceKind: q.referenceKind,
            pages: q.pages ?? "",
            note: q.note ?? "",
            state: q.state,
            ursprung: q.ursprung,
            herkunft: q.herkunft,
            neu: false,
        })),
        regeln: eintrag.regeln.map(regelAusServer),
    };
}

export function setzeFeld<K extends keyof VorkommenFelder>(
    stand: VorkommenStand,
    feld: K,
    wert: VorkommenFelder[K],
): VorkommenStand {
    if (stand.felder[feld] === wert) return stand;
    return { ...stand, felder: { ...stand.felder, [feld]: wert } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Ortszeilen
// ---------------------------------------------------------------------------------------------------------------------

let zaehler = 0;
const neuerSchluessel = (): string => {
    zaehler += 1;
    return `neu:${String(zaehler)}`;
};

const finde = (stand: VorkommenStand, schluessel: string): number =>
    stand.orte.findIndex((o) => o.schluessel === schluessel);

function ersetzeOrt(stand: VorkommenStand, index: number, aenderung: Partial<EntwurfOrt>): VorkommenStand {
    const eine = stand.orte[index];
    if (eine === undefined) return stand;
    return { ...stand, orte: stand.orte.map((o, i) => (i === index ? { ...eine, ...aenderung } : o)) };
}

/** Eine Zeile steht durch ihr Ziel (der Schlüssel des Artikels) und ihre Beziehung. */
const aussage = (o: { wikiKey: string | null; name: string; relation: string }): string =>
    `${o.wikiKey !== null ? `wiki:${o.wikiKey}` : `name:${o.name.trim().toLowerCase()}`}|${o.relation}`;

/**
 * Ein Ziel anhängen: ans Ende der Liste, oder die stille Zeile desselben Ziels in derselben Beziehung kommt zurück. Dieselbe aktive Zeile noch einmal ist
 * keine Änderung.
 */
export function haengeOrtAn(
    stand: VorkommenStand,
    ziel: InhalteVorkommenZiel,
    relation: InhalteVorkommenBeziehung,
): VorkommenStand {
    return haengeZeileAn(stand, {
        rowId: undefined,
        relation,
        wikiKey: ziel.wikiKey,
        name: ziel.name,
        keyClass: "kontinent" in ziel ? "continent" : "other",
        // Die Treffer rechnet der Server beim Speichern; bis dahin ist offen, was die Zeile trifft.
        targetState: "kontinent" in ziel ? "unresolved" : "resolved",
        rolle: "ort",
        treffer: [],
        trefferGesamt: 0,
        state: "active",
        ursprung: "manual",
        herkunft: "editor",
        neu: true,
        ziel: "kontinent" in ziel ? { kontinent: ziel.kontinent } : { kind: ziel.kind, carrierId: ziel.carrierId },
    });
}

/**
 * Einen ungeklärten Namen anhängen („ungeklärt übernehmen“, Vali wählte B am Gate; Migration 0235): kein Schlüssel, nie Treffer, nie gegen Kartenobjekte
 * verglichen. Derselbe Name (Groß- und Kleinschreibung gleich) in derselben Beziehung ist keine Änderung; eine stille Zeile desselben Namens kommt zurück.
 */
export function haengeNamenAn(
    stand: VorkommenStand,
    name: string,
    relation: InhalteVorkommenBeziehung,
): VorkommenStand {
    const bereinigt = name.trim();
    if (bereinigt === "") return stand;
    return haengeZeileAn(stand, {
        rowId: undefined,
        relation,
        wikiKey: null,
        name: bereinigt,
        keyClass: "other",
        targetState: "unresolved",
        rolle: "ort",
        treffer: [],
        trefferGesamt: 0,
        state: "active",
        ursprung: "manual",
        herkunft: "editor",
        neu: true,
        ziel: { name: bereinigt },
    });
}

function haengeZeileAn(stand: VorkommenStand, neu: Omit<EntwurfOrt, "schluessel">): VorkommenStand {
    const gleiche = stand.orte.findIndex((o) => aussage(o) === aussage(neu));
    if (gleiche >= 0) {
        const da = stand.orte[gleiche]!;
        if (istAktiv(da)) return stand;
        return { ...stand, orte: [...stand.orte.filter((_, i) => i !== gleiche), { ...da, state: "active" }] };
    }
    return { ...stand, orte: [...stand.orte, { ...neu, schluessel: neuerSchluessel() }] };
}

/**
 * Lösen: eine im Entwurf angehängte Zeile verschwindet ganz; eine des Servers wird gelöst (aus Legacy oder dem Wiki unterdrückt, eigene gelöst: das
 * entscheidet der Server, hier steht nur der Entwurf).
 */
export function loeseOrt(stand: VorkommenStand, schluessel: string): VorkommenStand {
    const index = finde(stand, schluessel);
    const da = stand.orte[index];
    if (da === undefined || !istAktiv(da)) return stand;
    if (da.neu) return { ...stand, orte: stand.orte.filter((_, i) => i !== index) };
    return ersetzeOrt(stand, index, { state: da.herkunft === "legacy" ? "suppressed" : "retired" });
}

export function stelleOrtWiederHer(stand: VorkommenStand, schluessel: string): VorkommenStand {
    const index = finde(stand, schluessel);
    const da = stand.orte[index];
    if (da === undefined || istAktiv(da)) return stand;
    return ersetzeOrt(stand, index, { state: "active" });
}

// ---------------------------------------------------------------------------------------------------------------------
// Quellen des Eintrags
// ---------------------------------------------------------------------------------------------------------------------

const findeQuelle = (stand: VorkommenStand, sourceId: string): number =>
    stand.quellen.findIndex((q) => q.sourceId === sourceId);

function ersetzeQuelle(stand: VorkommenStand, index: number, aenderung: Partial<EntwurfQuelle>): VorkommenStand {
    const eine = stand.quellen[index];
    if (eine === undefined) return stand;
    return { ...stand, quellen: stand.quellen.map((q, i) => (i === index ? { ...eine, ...aenderung } : q)) };
}

/** Die Angaben einer Quelle des Katalogs, die das Anhängen mitnimmt: Typ und Adresse, wo die Suche sie kennt. */
export interface QuelleZumAnhaengen {
    sourceId: string;
    title: string;
    sourceType?: SourceType | null;
    url?: string | null;
    korpus?: string | null;
}

/** Eine Quelle des Katalogs anhängen: ans Ende, oder die gelöste Verknüpfung derselben Quelle wird wieder aktiv. */
export function haengeQuelleAn(stand: VorkommenStand, quelle: QuelleZumAnhaengen): VorkommenStand {
    const index = findeQuelle(stand, quelle.sourceId);
    if (index >= 0) {
        const da = stand.quellen[index]!;
        return istAktiv(da) ? stand : ersetzeQuelle(stand, index, { state: "active" });
    }
    const neu: EntwurfQuelle = {
        sourceId: quelle.sourceId,
        title: quelle.title,
        sourceType: quelle.sourceType ?? null,
        offiziell: null,
        url: quelle.url ?? null,
        referenceKind: null,
        pages: "",
        note: "",
        state: "active",
        ursprung: "manual",
        herkunft: "editor",
        neu: true,
        korpus: quelle.korpus ?? null,
    };
    return { ...stand, quellen: [...stand.quellen, neu] };
}

export function aendereQuelle(
    stand: VorkommenStand,
    sourceId: string,
    aenderung: Partial<Pick<EntwurfQuelle, "referenceKind" | "pages" | "note">>,
): VorkommenStand {
    const index = findeQuelle(stand, sourceId);
    const da = stand.quellen[index];
    if (da === undefined || !istAktiv(da)) return stand;
    return ersetzeQuelle(stand, index, aenderung);
}

export function loeseQuelle(stand: VorkommenStand, sourceId: string): VorkommenStand {
    const index = findeQuelle(stand, sourceId);
    const da = stand.quellen[index];
    if (da === undefined || !istAktiv(da)) return stand;
    if (da.neu) return { ...stand, quellen: stand.quellen.filter((_, i) => i !== index) };
    return ersetzeQuelle(stand, index, { state: da.herkunft === "legacy" ? "suppressed" : "retired" });
}

export function stelleQuelleWiederHer(stand: VorkommenStand, sourceId: string): VorkommenStand {
    const index = findeQuelle(stand, sourceId);
    const da = stand.quellen[index];
    if (da === undefined || istAktiv(da)) return stand;
    return ersetzeQuelle(stand, index, { state: "active" });
}

// ---------------------------------------------------------------------------------------------------------------------
// Der Körper
// ---------------------------------------------------------------------------------------------------------------------

const leerAlsNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

type OrtAenderung = NonNullable<InhalteVorkommenAendernBody["orte"]>[number];
type QuelleAenderung = NonNullable<InhalteVorkommenAendernBody["quellen"]>[number];

/** Die Änderungen der Ortszeilen gegen den Stand des Servers, in der Folge des Entwurfs. */
function ortAenderungen(start: VorkommenStand, jetzt: VorkommenStand): OrtAenderung[] {
    const aenderungen: OrtAenderung[] = [];
    for (const nach of jetzt.orte) {
        if (nach.neu || nach.rowId === undefined) {
            const ziel = nach.ziel;
            if (nach.state !== "active" || ziel === undefined) continue;
            aenderungen.push(
                "kontinent" in ziel
                    ? { op: "add", kontinent: ziel.kontinent, relation: nach.relation }
                    : "name" in ziel
                      ? { op: "add", name: ziel.name, relation: nach.relation }
                      : { op: "add", kind: ziel.kind, carrierId: ziel.carrierId, relation: nach.relation },
            );
            continue;
        }
        const vor = start.orte.find((o) => o.rowId === nach.rowId);
        if (vor === undefined) continue;
        if (istAktiv(vor) && !istAktiv(nach)) aenderungen.push({ op: "remove", rowId: nach.rowId });
        else if (!istAktiv(vor) && istAktiv(nach)) aenderungen.push({ op: "restore", rowId: nach.rowId });
    }
    return aenderungen;
}

/** Die Änderungen der Quellenverknüpfungen gegen den Stand des Servers. */
function quellenAenderungen(start: VorkommenStand, jetzt: VorkommenStand): QuelleAenderung[] {
    const aenderungen: QuelleAenderung[] = [];
    for (const nach of jetzt.quellen) {
        const angaben = {
            referenceKind: nach.referenceKind,
            pages: leerAlsNull(nach.pages),
            note: leerAlsNull(nach.note),
        };
        const vor = start.quellen.find((q) => q.sourceId === nach.sourceId);
        if (vor === undefined) {
            if (nach.state === "active") aenderungen.push({ op: "add", sourceId: nach.sourceId, ...angaben });
            continue;
        }
        const geaendert =
            vor.referenceKind !== nach.referenceKind || vor.pages !== nach.pages || vor.note !== nach.note;
        if (istAktiv(vor) && !istAktiv(nach)) {
            aenderungen.push({ op: "remove", sourceId: nach.sourceId });
        } else if (!istAktiv(vor) && istAktiv(nach)) {
            aenderungen.push(
                geaendert
                    ? { op: "add", sourceId: nach.sourceId, ...angaben }
                    : { op: "restore", sourceId: nach.sourceId },
            );
        } else if (istAktiv(vor) && istAktiv(nach) && geaendert) {
            aenderungen.push({ op: "update", sourceId: nach.sourceId, ...angaben });
        }
    }
    return aenderungen;
}

/**
 * Was „Speichern“ schickt: der Unterschied zwischen dem Stand des Servers (`start`) und dem Entwurf (`jetzt`). `undefined`, wo es keinen gibt.
 */
export function entwurfAlsKoerper(
    start: VorkommenStand,
    jetzt: VorkommenStand,
): Pick<InhalteVorkommenAendernBody, "fields" | "orte" | "quellen" | "regeln"> | undefined {
    const fields: InhalteVorkommenFelder = {};
    const a = start.felder;
    const b = jetzt.felder;
    if (a.name !== b.name) fields.name = b.name;
    if (a.art !== b.art) fields.art = b.art;
    if (leerAlsNull(a.gruppe) !== leerAlsNull(b.gruppe)) fields.gruppe = leerAlsNull(b.gruppe);
    if (leerAlsNull(a.lebensraum) !== leerAlsNull(b.lebensraum)) fields.lebensraum = leerAlsNull(b.lebensraum);
    if (leerAlsNull(a.synonyme) !== leerAlsNull(b.synonyme)) fields.synonyme = leerAlsNull(b.synonyme);
    if (leerAlsNull(a.editorNote) !== leerAlsNull(b.editorNote)) fields.editorNote = leerAlsNull(b.editorNote);
    if (a.aktiv !== b.aktiv) fields.aktiv = b.aktiv;
    const orte = ortAenderungen(start, jetzt);
    const quellen = quellenAenderungen(start, jetzt);
    const regeln = regelAenderungen(start.regeln, jetzt.regeln);
    if (Object.keys(fields).length === 0 && orte.length === 0 && quellen.length === 0 && regeln.length === 0)
        return undefined;
    return {
        ...(Object.keys(fields).length === 0 ? {} : { fields }),
        ...(orte.length === 0 ? {} : { orte }),
        ...(quellen.length === 0 ? {} : { quellen }),
        ...(regeln.length === 0 ? {} : { regeln }),
    };
}

/** Wie viele Änderungen der Entwurf gegenüber dem Server-Stand trägt (für „n ungespeichert“). */
export function zaehleAenderungen(start: VorkommenStand, jetzt: VorkommenStand): number {
    const koerper = entwurfAlsKoerper(start, jetzt);
    if (koerper === undefined) return 0;
    return (
        Object.keys(koerper.fields ?? {}).length +
        (koerper.orte?.length ?? 0) +
        (koerper.quellen?.length ?? 0) +
        (koerper.regeln?.length ?? 0)
    );
}

/** Der Kreis einer Zeile der Liste: ● aus Legacy oder Wiki, ◐ von der Redaktion angelegt oder geändert, ○ unterdrückt. */
export function kreisDesEintrags(zeile: { herkunft: InhalteHerkunft; stillgelegt: boolean }): Kreis {
    return zeile.stillgelegt ? "leer" : zeile.herkunft === "editor" ? "halb" : "voll";
}

/** Das Zeichen einer Zeile der Liste: das ihrer Kategorie (Blume, Pfote, Korb, Person); alles Unbekannte behält das Zeichen des Reiters. */
export function zeichenDerArt(art: string): EditorZeichenName {
    switch (art) {
        case "fauna":
        case "flora":
        case "ware":
        case "spezies":
            return art;
        default:
            return "vorkommen";
    }
}

/** Die Zahl der aktiven Zeilen und Quellen, für die Überschriften. */
export const aktiveOrte = (stand: VorkommenStand): readonly EntwurfOrt[] => stand.orte.filter(istAktiv);
export const aktiveQuellen = (stand: VorkommenStand): readonly EntwurfQuelle[] => stand.quellen.filter(istAktiv);

/** Die Unterreiter der Liste in der Folge des Mockups. */
export const UNTERREITER = ["alle", "fauna", "flora", "ware", "spezies"] as const;
export type Unterreiter = (typeof UNTERREITER)[number];
