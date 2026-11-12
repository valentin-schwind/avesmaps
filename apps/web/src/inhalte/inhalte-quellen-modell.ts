import {
    quellenWikiNormal,
    type InhalteQuelle,
    type InhalteQuelleAendernBody,
    type InhalteQuelleFelder,
    type InhalteVerwendung,
    type InhalteVerwendungVorher,
    type InhalteZiel,
    type InhalteTraegerArt,
    type SourceReferenceKind,
} from "@avesmaps3d/shared";
import type { Kreis } from "../editor-liste/liste-modell";

/**
 * Der Entwurf einer Quelle im Fenster „Inhalte bearbeiten“ (WI-0254) als reine Rechnung ohne Vue: der Stand der Mitte (Stammdaten) und der
 * rechten Spalte (Verwendungen), die Änderungen daran und der Körper von `source.update`, den „Speichern“ daraus macht.
 *
 * - **Ein Stand, ein Schritt:** `QuellenStand` ist alles, was der Entwurf hält; `Entwurf<QuellenStand>` (`fenster/entwurf-kern.ts`) zählt
 *   die Schritte für ↶ ↷ und „n ungespeichert“. Der Stand ist unveränderlich: jede Änderung gibt einen neuen.
 * - **Der Körper** (`entwurfAlsKoerper`) enthält nur, was sich gegenüber dem Server-Stand geändert hat: Felder, die abweichen, und je Verwendung
 *   eine Änderung (`add`, `update`, `remove`, `restore`). Eine im Entwurf angelegte und wieder gelöste Verwendung kommt nicht vor.
 * - **Ein Weg ist immer die ganze Straße** (Betreiber 2026-10-28): Seine Verwendung ist eine Zeile wie jede andere und geht mit den anderen in den Körper. Weil die Straße keine eigene
 *   Revision hat, trägt ihre Änderung `vorher`: die Sicht, die der Stand des Servers zeigte (`null`: die Zeile war neu). Ein Abschnitt kommt in der Oberfläche nie vor.
 */

export interface QuellenFelder {
    title: string;
    sourceType: InhalteQuelle["sourceType"];
    isOfficial: boolean;
    lizenzAussage: InhalteQuelle["lizenzAussage"];
    lizenzKey: string | null;
    attribution: string;
    /** Der Kommentar der Redaktion (Migration 0233); leer heißt keiner. */
    editorNote: string;
    aktiv: boolean;
}

/** Eine Verwendung im Entwurf: die des Servers oder eine neu angehängte (`neu`). */
export interface EntwurfVerwendung {
    readonly kind: InhalteTraegerArt;
    readonly carrierId: string;
    readonly name: string;
    readonly subtype: string | undefined;
    readonly referenceKind: SourceReferenceKind | null;
    readonly pages: string;
    readonly note: string;
    readonly state: InhalteVerwendung["state"];
    readonly herkunft: InhalteVerwendung["herkunft"];
    readonly traegerAktiv: boolean;
    readonly canon: InhalteVerwendung["canon"];
    readonly aenderbar: boolean;
    /** Im Entwurf angehängt, noch nicht gespeichert. */
    readonly neu: boolean;
}

export interface QuellenStand {
    readonly felder: QuellenFelder;
    readonly verwendungen: readonly EntwurfVerwendung[];
}

export const schluesselVon = (v: { kind: string; carrierId: string }): string => `${v.kind}:${v.carrierId}`;

/** Der Stand, mit dem ein Entwurf beginnt: genau das, was der Server liefert. */
export function standAusQuelle(quelle: InhalteQuelle): QuellenStand {
    return {
        felder: {
            title: quelle.title,
            sourceType: quelle.sourceType,
            isOfficial: quelle.isOfficial,
            lizenzAussage: quelle.lizenzAussage,
            lizenzKey: quelle.lizenzKey,
            attribution: quelle.attribution ?? "",
            editorNote: quelle.editorNote ?? "",
            aktiv: quelle.aktiv,
        },
        verwendungen: quelle.verwendungen.map((v) => ({
            kind: v.kind,
            carrierId: v.carrierId,
            name: v.name,
            subtype: v.subtype,
            referenceKind: v.referenceKind,
            pages: v.pages ?? "",
            note: v.note ?? "",
            state: v.state,
            herkunft: v.herkunft,
            traegerAktiv: v.traegerAktiv,
            canon: v.canon,
            aenderbar: v.aenderbar,
            neu: false,
        })),
    };
}

export function setzeFeld<K extends keyof QuellenFelder>(
    stand: QuellenStand,
    feld: K,
    wert: QuellenFelder[K],
): QuellenStand {
    if (stand.felder[feld] === wert) return stand;
    const felder: QuellenFelder = { ...stand.felder, [feld]: wert };
    // Die Lizenz gehört zusammen: ohne Aussage „Lizenz“ gibt es keinen Schlüssel.
    if (feld === "lizenzAussage" && wert !== "license") felder.lizenzKey = null;
    return { ...stand, felder };
}

/** Die Aussage und der Schlüssel der Lizenz als ein Wert der Auswahl: `license:<key>` oder die Aussage. */
export function lizenzWert(felder: Pick<QuellenFelder, "lizenzAussage" | "lizenzKey">): string {
    return felder.lizenzAussage === "license" && felder.lizenzKey !== null
        ? `license:${felder.lizenzKey}`
        : felder.lizenzAussage;
}

export function setzeLizenz(stand: QuellenStand, wert: string): QuellenStand {
    if (wert.startsWith("license:")) {
        const key = wert.slice("license:".length);
        if (stand.felder.lizenzAussage === "license" && stand.felder.lizenzKey === key) return stand;
        return { ...stand, felder: { ...stand.felder, lizenzAussage: "license", lizenzKey: key } };
    }
    if (wert !== "unrecorded" && wert !== "public_domain" && wert !== "unfree") return stand;
    if (stand.felder.lizenzAussage === wert && stand.felder.lizenzKey === null) return stand;
    return { ...stand, felder: { ...stand.felder, lizenzAussage: wert, lizenzKey: null } };
}

const finde = (stand: QuellenStand, kind: string, carrierId: string): number =>
    stand.verwendungen.findIndex((v) => v.kind === kind && v.carrierId === carrierId);

function ersetze(stand: QuellenStand, index: number, aenderung: Partial<EntwurfVerwendung>): QuellenStand {
    const eine = stand.verwendungen[index];
    if (eine === undefined || !eine.aenderbar) return stand;
    const neu = { ...eine, ...aenderung };
    return { ...stand, verwendungen: stand.verwendungen.map((v, i) => (i === index ? neu : v)) };
}

export function aendereVerwendung(
    stand: QuellenStand,
    kind: string,
    carrierId: string,
    aenderung: Partial<Pick<EntwurfVerwendung, "referenceKind" | "pages" | "note">>,
): QuellenStand {
    const index = finde(stand, kind, carrierId);
    return index < 0 ? stand : ersetze(stand, index, aenderung);
}

/** Einen Träger anhängen: neu am Ende, oder eine gelöste Verwendung desselben Trägers wird wieder aktiv. */
export function haengeAn(
    stand: QuellenStand,
    ziel: InhalteZiel,
    referenceKind: SourceReferenceKind | null,
): QuellenStand {
    const index = finde(stand, ziel.kind, ziel.carrierId);
    if (index >= 0) {
        const da = stand.verwendungen[index]!;
        if (da.state === "active") return stand;
        return ersetze(stand, index, { state: "active", referenceKind });
    }
    const neu: EntwurfVerwendung = {
        kind: ziel.kind,
        carrierId: ziel.carrierId,
        name: ziel.name,
        subtype: ziel.subtype,
        referenceKind,
        pages: "",
        note: "",
        state: "active",
        herkunft: "editor",
        traegerAktiv: true,
        canon: ziel.canon,
        aenderbar: true,
        neu: true,
    };
    return { ...stand, verwendungen: [neu, ...stand.verwendungen] };
}

/**
 * Lösen: eine im Entwurf angehängte Verwendung verschwindet ganz; eine des Servers wird gelöst (aus Legacy unterdrückt, eigene gelöst:
 * das entscheidet der Server, hier steht nur der Entwurf). Der Zustand im Entwurf heißt `retired`.
 */
export function loeseVerwendung(stand: QuellenStand, kind: string, carrierId: string): QuellenStand {
    const index = finde(stand, kind, carrierId);
    const da = stand.verwendungen[index];
    if (da === undefined || !da.aenderbar) return stand;
    if (da.neu) return { ...stand, verwendungen: stand.verwendungen.filter((_, i) => i !== index) };
    return ersetze(stand, index, { state: da.herkunft === "legacy" ? "suppressed" : "retired" });
}

export function stelleWiederHer(stand: QuellenStand, kind: string, carrierId: string): QuellenStand {
    const index = finde(stand, kind, carrierId);
    const da = stand.verwendungen[index];
    if (da === undefined || da.state === "active") return stand;
    return ersetze(stand, index, { state: "active" });
}

const leerAlsNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** Was die Oberfläche von einer Verwendung sah (`undefined`: Sie war neu). Für einen Weg ist es der gesehene Stand der Straße; Seiten und Notiz gekürzt wie beim Wiki. */
const gesehen = (vor: EntwurfVerwendung | undefined): InhalteVerwendungVorher | null =>
    vor === undefined
        ? null
        : {
              state: vor.state,
              referenceKind: vor.referenceKind,
              pages: quellenWikiNormal(vor.pages),
              note: quellenWikiNormal(vor.note),
          };

/**
 * Was „Speichern“ schickt: der Unterschied zwischen dem Stand des Servers (`start`) und dem Entwurf (`jetzt`). `undefined`, wenn es keinen
 * gibt. Die Reihenfolge der Verwendungen im Körper folgt dem Entwurf.
 */
export function entwurfAlsKoerper(
    start: QuellenStand,
    jetzt: QuellenStand,
): Pick<InhalteQuelleAendernBody, "fields" | "links"> | undefined {
    const fields: InhalteQuelleFelder = {};
    const a = start.felder;
    const b = jetzt.felder;
    if (a.title !== b.title) fields.title = b.title;
    if (a.sourceType !== b.sourceType) fields.sourceType = b.sourceType;
    if (a.isOfficial !== b.isOfficial) fields.isOfficial = b.isOfficial;
    if (a.lizenzAussage !== b.lizenzAussage || a.lizenzKey !== b.lizenzKey) {
        fields.lizenzAussage = b.lizenzAussage;
        fields.lizenzKey = b.lizenzKey;
    }
    if (leerAlsNull(a.attribution) !== leerAlsNull(b.attribution)) fields.attribution = leerAlsNull(b.attribution);
    if (leerAlsNull(a.editorNote) !== leerAlsNull(b.editorNote)) fields.editorNote = leerAlsNull(b.editorNote);
    if (a.aktiv !== b.aktiv) fields.aktiv = b.aktiv;

    const links: NonNullable<InhalteQuelleAendernBody["links"]> = [];
    for (const nach of jetzt.verwendungen) {
        if (!nach.aenderbar) continue;
        const kind = nach.kind;
        const vor = start.verwendungen.find((v) => v.kind === nach.kind && v.carrierId === nach.carrierId);
        const angaben = {
            referenceKind: nach.referenceKind,
            pages: leerAlsNull(nach.pages),
            note: leerAlsNull(nach.note),
        };
        // Nur der Weg trägt den gesehenen Stand (die Straße hat keine Revision); jeder andere Träger prüft ihn nicht.
        const stand = kind === "path" ? { vorher: gesehen(vor) } : {};
        if (vor === undefined) {
            if (nach.state === "active")
                links.push({ op: "add", kind, carrierId: nach.carrierId, ...stand, ...angaben });
            continue;
        }
        const geaendert =
            vor.referenceKind !== nach.referenceKind || vor.pages !== nach.pages || vor.note !== nach.note;
        if (vor.state === "active" && nach.state !== "active") {
            links.push({ op: "remove", kind, carrierId: nach.carrierId, ...stand });
        } else if (vor.state !== "active" && nach.state === "active") {
            links.push(
                geaendert
                    ? { op: "add", kind, carrierId: nach.carrierId, ...stand, ...angaben }
                    : { op: "restore", kind, carrierId: nach.carrierId, ...stand },
            );
        } else if (vor.state === "active" && nach.state === "active" && geaendert) {
            links.push({ op: "update", kind, carrierId: nach.carrierId, ...stand, ...angaben });
        }
    }
    if (Object.keys(fields).length === 0 && links.length === 0) return undefined;
    return {
        ...(Object.keys(fields).length === 0 ? {} : { fields }),
        ...(links.length === 0 ? {} : { links }),
    };
}

/** Wie viele Änderungen der Entwurf gegenüber dem Server-Stand trägt (für „n ungespeichert“). */
export function zaehleAenderungen(start: QuellenStand, jetzt: QuellenStand): number {
    const koerper = entwurfAlsKoerper(start, jetzt);
    return (
        Object.keys(koerper?.fields ?? {}).length -
        (koerper?.fields?.lizenzKey !== undefined ? 1 : 0) +
        (koerper?.links?.length ?? 0)
    );
}

/** Der Kreis einer Zeile der Liste: ● aus Legacy oder Wiki, ◐ von der Redaktion angelegt oder geändert, ○ stillgelegt. */
export function kreisDerQuelle(zeile: { herkunft: "legacy" | "editor"; stillgelegt: boolean }): Kreis {
    return zeile.stillgelegt ? "leer" : zeile.herkunft === "editor" ? "halb" : "voll";
}

/** Zählt die aktiven Verwendungen eines Entwurfs. */
export const aktiveVerwendungen = (stand: QuellenStand): number =>
    stand.verwendungen.filter((v) => v.state === "active").length;
