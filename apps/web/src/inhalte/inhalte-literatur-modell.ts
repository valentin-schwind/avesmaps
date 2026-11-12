import {
    INHALTE_WERK_JAHR_MAX,
    INHALTE_WERK_JAHR_MIN,
    type InhalteHerkunft,
    type InhalteUrsprung,
    type InhalteWerk,
    type InhalteWerkAendernBody,
    type InhalteWerkFelder,
    type InhalteWerkOrt,
    type InhalteWerkOrtEintrag,
    type InhalteWerkRolle,
    type InhalteWerkZielStand,
    type InhalteWerkZielart,
    type InhalteWerkZustand,
    type InhalteZiel,
} from "@avesmaps3d/shared";
import type { Kreis } from "../editor-liste/liste-modell";

/**
 * Der Entwurf eines Werks im Reiter „Literatur“ des Fensters „Inhalte bearbeiten“ (WI-0254, Runde 2) als reine Rechnung ohne Vue: der Stand
 * der Mitte (Stammdaten) und der rechten Spalte (die geordnete Ortsliste), die Änderungen daran und der Körper von `work.update`, den
 * „Speichern“ daraus macht.
 *
 * - **Ein Stand, ein Schritt:** `WerkStand` ist alles, was der Entwurf hält; `Entwurf<WerkStand>` (`fenster/entwurf-kern.ts`) zählt die
 *   Schritte für ↶ ↷ und „n ungespeichert“. Der Stand ist unveränderlich: jede Änderung gibt einen neuen.
 * - **Die Ortsliste** steht mit allen Zeilen da, den aktiven und den stillen, in der Reihenfolge des Servers. Die Reihenfolge der AKTIVEN
 *   ist die Aussage (der kleinste ist der Startort); sie ordnet die Redaktion von Hand (▲ ▼) und nie still um. Eine Zeile hat EINE Rolle;
 *   ★ setzt `start`, nochmal ★ gibt die vorige Rolle zurück.
 * - **Der Körper** (`entwurfAlsKoerper`) enthält nur, was sich geändert hat: die Felder, die abweichen, und, wenn sich die aktive Liste ändert
 *   (eine Zeile dazu, weg, zurück, eine andere Rolle, eine andere Folge), die GANZE aktive Liste in der gewollten Reihenfolge.
 */

export interface WerkFelder {
    title: string;
    productType: string;
    /** Leer heißt unbekannt (`null` im Vertrag). */
    edition: string;
    series: string;
    /** Das Jahr als Text des Eingabefelds: nur Ziffern; leer heißt unbekannt. */
    bfYear: string;
    genre: string;
    isOfficial: boolean;
    editorNote: string;
    aktiv: boolean;
}

/** Eine Zeile der Ortsliste im Entwurf: die des Servers oder eine neu angehängte (`neu`). */
export interface EntwurfOrt {
    /** Eine Zeile des Servers trägt ihre `rowId`; eine neue `neu:<n>`. */
    readonly schluessel: string;
    readonly rowId: string | undefined;
    readonly role: InhalteWerkRolle;
    /** Die Rolle, in die ★ zurückschaltet (nie `start`). */
    readonly davor: Exclude<InhalteWerkRolle, "start">;
    readonly name: string;
    readonly targetState: InhalteWerkZielStand;
    readonly kind: InhalteWerkZielart | undefined;
    readonly carrierId: string | undefined;
    readonly subtype: string | undefined;
    readonly state: InhalteWerkZustand;
    readonly ursprung: InhalteUrsprung;
    readonly herkunft: InhalteHerkunft;
    readonly traegerAktiv: boolean | undefined;
    /** Im Entwurf angehängt, noch nicht gespeichert. */
    readonly neu: boolean;
}

export interface WerkStand {
    readonly felder: WerkFelder;
    readonly orte: readonly EntwurfOrt[];
}

const ohneStart = (rolle: InhalteWerkRolle): Exclude<InhalteWerkRolle, "start"> => (rolle === "start" ? "play" : rolle);
export const istAktiv = (ort: Pick<EntwurfOrt, "state">): boolean => ort.state === "active";

function ortAus(ort: InhalteWerkOrt): EntwurfOrt {
    return {
        schluessel: ort.rowId,
        rowId: ort.rowId,
        role: ort.role,
        davor: ohneStart(ort.role),
        name: ort.name,
        targetState: ort.targetState,
        kind: ort.kind,
        carrierId: ort.carrierId,
        subtype: ort.subtype,
        state: ort.state,
        ursprung: ort.ursprung,
        herkunft: ort.herkunft,
        traegerAktiv: ort.traegerAktiv,
        neu: false,
    };
}

/** Der Stand, mit dem ein Entwurf beginnt: genau das, was der Server liefert. */
export function standAusWerk(werk: InhalteWerk): WerkStand {
    return {
        felder: {
            title: werk.title,
            productType: werk.productType,
            edition: werk.edition ?? "",
            series: werk.series ?? "",
            bfYear: werk.bfYear === null ? "" : String(werk.bfYear),
            genre: werk.genre ?? "",
            isOfficial: werk.isOfficial,
            editorNote: werk.editorNote ?? "",
            aktiv: werk.aktiv,
        },
        orte: werk.orte.map(ortAus),
    };
}

/** Ein Jahr tippt man in Ziffern: Das Feld nimmt höchstens vier und lässt alles andere stehen, wie es war. */
const JAHR_MUSTER = /^\d{0,4}$/u;

export function setzeFeld<K extends keyof WerkFelder>(stand: WerkStand, feld: K, wert: WerkFelder[K]): WerkStand {
    if (stand.felder[feld] === wert) return stand;
    if (feld === "bfYear" && !JAHR_MUSTER.test(String(wert))) return stand;
    return { ...stand, felder: { ...stand.felder, [feld]: wert } };
}

const finde = (stand: WerkStand, schluessel: string): number =>
    stand.orte.findIndex((o) => o.schluessel === schluessel);

function ersetze(stand: WerkStand, index: number, aenderung: Partial<EntwurfOrt>): WerkStand {
    const eine = stand.orte[index];
    if (eine === undefined) return stand;
    const neu = { ...eine, ...aenderung };
    return { ...stand, orte: stand.orte.map((o, i) => (i === index ? neu : o)) };
}

let zaehler = 0;
const neuerSchluessel = (): string => {
    zaehler += 1;
    return `neu:${String(zaehler)}`;
};

/** Zeilen nach dem Ziel (Art und Kennung) und der Rolle; ein ungeklärter Name zählt nach seinem kleingeschriebenen Namen. */
export const aussage = (o: Pick<EntwurfOrt, "kind" | "carrierId" | "name" | "role">): string =>
    `${o.kind !== undefined && o.carrierId !== undefined ? `${o.kind}:${o.carrierId}` : `name:${o.name.trim().toLowerCase()}`}|${o.role}`;

function anhaengen(stand: WerkStand, neu: Omit<EntwurfOrt, "schluessel">): WerkStand {
    const gleiche = stand.orte.findIndex((o) => aussage(o) === aussage(neu));
    if (gleiche >= 0) {
        const da = stand.orte[gleiche]!;
        if (istAktiv(da)) return stand;
        // Eine stille Zeile desselben Ziels in derselben Rolle kommt zurück, und zwar ans Ende der Liste.
        const ohne = stand.orte.filter((_, i) => i !== gleiche);
        return { ...stand, orte: [...ohne, { ...da, state: "active" }] };
    }
    return { ...stand, orte: [...stand.orte, { ...neu, schluessel: neuerSchluessel() }] };
}

/** Einen Träger anhängen: ans Ende der Liste, oder eine stille Zeile desselben Ziels in derselben Rolle wird wieder aktiv. */
export function haengeOrtAn(stand: WerkStand, ziel: InhalteZiel, rolle: InhalteWerkRolle): WerkStand {
    return anhaengen(stand, {
        rowId: undefined,
        role: rolle,
        davor: ohneStart(rolle),
        name: ziel.name,
        targetState: "resolved",
        kind: ziel.kind,
        carrierId: ziel.carrierId,
        subtype: ziel.subtype,
        state: "active",
        ursprung: "manual",
        herkunft: "editor",
        traegerAktiv: true,
        neu: true,
    });
}

/** Einen Namen ohne Kartenbezug anhängen: ausdrücklich ungeklärt, nie ein Ziel. */
export function haengeNamenAn(stand: WerkStand, name: string, rolle: InhalteWerkRolle): WerkStand {
    const roh = name.trim();
    if (roh === "") return stand;
    return anhaengen(stand, {
        rowId: undefined,
        role: rolle,
        davor: ohneStart(rolle),
        name: roh,
        targetState: "unresolved",
        kind: undefined,
        carrierId: undefined,
        subtype: undefined,
        state: "active",
        ursprung: "manual",
        herkunft: "editor",
        traegerAktiv: undefined,
        neu: true,
    });
}

/** Eine Zeile um eine Stelle unter den AKTIVEN Zeilen verschieben (die stillen bleiben, wo sie stehen). */
export function verschiebeOrt(stand: WerkStand, schluessel: string, richtung: -1 | 1): WerkStand {
    const index = finde(stand, schluessel);
    if (index < 0 || !istAktiv(stand.orte[index]!)) return stand;
    let nachbar = index + richtung;
    while (nachbar >= 0 && nachbar < stand.orte.length && !istAktiv(stand.orte[nachbar]!)) nachbar += richtung;
    if (nachbar < 0 || nachbar >= stand.orte.length) return stand;
    const orte = [...stand.orte];
    [orte[index], orte[nachbar]] = [orte[nachbar]!, orte[index]!];
    return { ...stand, orte };
}

/** Die Rolle einer Zeile setzen; `start` merkt sich die Rolle davor, damit ★ zurückschalten kann. */
export function setzeRolle(stand: WerkStand, schluessel: string, rolle: InhalteWerkRolle): WerkStand {
    const index = finde(stand, schluessel);
    const da = stand.orte[index];
    if (da === undefined || !istAktiv(da) || da.role === rolle) return stand;
    return ersetze(stand, index, { role: rolle, davor: rolle === "start" ? ohneStart(da.role) : rolle });
}

/** ★: eine Zeile zum Startort machen, oder aus dem Startort die Rolle davor zurückholen. */
export function schalteStart(stand: WerkStand, schluessel: string): WerkStand {
    const da = stand.orte[finde(stand, schluessel)];
    if (da === undefined) return stand;
    return setzeRolle(stand, schluessel, da.role === "start" ? da.davor : "start");
}

/**
 * Lösen: eine im Entwurf angehängte Zeile verschwindet ganz; eine des Servers wird gelöst (aus Legacy unterdrückt, eigene gelöst: das
 * entscheidet der Server, hier steht nur der Entwurf).
 */
export function loeseOrt(stand: WerkStand, schluessel: string): WerkStand {
    const index = finde(stand, schluessel);
    const da = stand.orte[index];
    if (da === undefined || !istAktiv(da)) return stand;
    if (da.neu) return { ...stand, orte: stand.orte.filter((_, i) => i !== index) };
    return ersetze(stand, index, { state: da.herkunft === "legacy" ? "suppressed" : "retired" });
}

/** Eine stille Zeile zurückholen; sie steht danach am Ende der aktiven Liste. */
export function stelleOrtWiederHer(stand: WerkStand, schluessel: string): WerkStand {
    const index = finde(stand, schluessel);
    const da = stand.orte[index];
    if (da === undefined || istAktiv(da)) return stand;
    const ohne = stand.orte.filter((_, i) => i !== index);
    return { ...stand, orte: [...ohne, { ...da, state: "active" }] };
}

const leerAlsNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** Das Jahr als Zahl; `null` für „unbekannt“, `undefined`, wo das Feld keine gültige Zahl trägt. */
export function jahrAlsZahl(text: string): number | null | undefined {
    const roh = text.trim();
    if (roh === "") return null;
    const zahl = Number(roh);
    return Number.isInteger(zahl) && zahl >= INHALTE_WERK_JAHR_MIN && zahl <= INHALTE_WERK_JAHR_MAX ? zahl : undefined;
}

/** Ein Eintrag der aktiven Liste im Körper des Speicherns. */
function eintragVon(o: EntwurfOrt): InhalteWerkOrtEintrag {
    if (o.rowId !== undefined) return { rowId: o.rowId, role: o.role };
    if (o.kind !== undefined && o.carrierId !== undefined && o.kind !== "path") {
        return { kind: o.kind, carrierId: o.carrierId, role: o.role };
    }
    return { rawName: o.name, role: o.role };
}

export const aktiveOrte = (stand: WerkStand): readonly EntwurfOrt[] => stand.orte.filter(istAktiv);

/** Ändert sich die aktive Liste (eine Zeile dazu, weg, zurück, eine andere Rolle, eine andere Folge)? */
function listeGeaendert(start: WerkStand, jetzt: WerkStand): boolean {
    return JSON.stringify(aktiveOrte(start).map(eintragVon)) !== JSON.stringify(aktiveOrte(jetzt).map(eintragVon));
}

/**
 * Was „Speichern“ schickt: der Unterschied zwischen dem Stand des Servers (`start`) und dem Entwurf (`jetzt`). `undefined`, wo es keinen
 * gibt. Ein Jahr, das keine Zahl ist, geht nicht mit (das Feld lässt nur Ziffern zu).
 */
export function entwurfAlsKoerper(
    start: WerkStand,
    jetzt: WerkStand,
): Pick<InhalteWerkAendernBody, "fields" | "orte"> | undefined {
    const fields: InhalteWerkFelder = {};
    const a = start.felder;
    const b = jetzt.felder;
    if (a.title !== b.title) fields.title = b.title;
    if (a.productType !== b.productType) fields.productType = b.productType;
    if (leerAlsNull(a.edition) !== leerAlsNull(b.edition)) fields.edition = leerAlsNull(b.edition);
    if (leerAlsNull(a.series) !== leerAlsNull(b.series)) fields.series = leerAlsNull(b.series);
    if (a.bfYear !== b.bfYear) {
        const jahr = jahrAlsZahl(b.bfYear);
        if (jahr !== undefined && jahr !== jahrAlsZahl(a.bfYear)) fields.bfYear = jahr;
    }
    if (leerAlsNull(a.genre) !== leerAlsNull(b.genre)) fields.genre = leerAlsNull(b.genre);
    if (a.isOfficial !== b.isOfficial) fields.isOfficial = b.isOfficial;
    if (leerAlsNull(a.editorNote) !== leerAlsNull(b.editorNote)) fields.editorNote = leerAlsNull(b.editorNote);
    if (a.aktiv !== b.aktiv) fields.aktiv = b.aktiv;
    const orte = listeGeaendert(start, jetzt) ? aktiveOrte(jetzt).map(eintragVon) : undefined;
    if (Object.keys(fields).length === 0 && orte === undefined) return undefined;
    return {
        ...(Object.keys(fields).length === 0 ? {} : { fields }),
        ...(orte === undefined ? {} : { orte }),
    };
}

/** Wie viele Änderungen der Entwurf gegenüber dem Server-Stand trägt (für „n ungespeichert“): Felder, Zeilen dazu, weg, andere Rolle, eine andere Folge. */
export function zaehleAenderungen(start: WerkStand, jetzt: WerkStand): number {
    const koerper = entwurfAlsKoerper(start, jetzt);
    if (koerper === undefined) return 0;
    let anzahl = Object.keys(koerper.fields ?? {}).length;
    if (koerper.orte !== undefined) {
        const vorher = new Map(aktiveOrte(start).map((o) => [o.schluessel, o]));
        const nachher = new Map(aktiveOrte(jetzt).map((o) => [o.schluessel, o]));
        for (const [schluessel, o] of nachher) {
            const alt = vorher.get(schluessel);
            if (alt === undefined) anzahl += 1;
            else if (alt.role !== o.role) anzahl += 1;
        }
        for (const schluessel of vorher.keys()) if (!nachher.has(schluessel)) anzahl += 1;
        const gemeinsamVorher = [...vorher.keys()].filter((s) => nachher.has(s));
        const gemeinsamNachher = [...nachher.keys()].filter((s) => vorher.has(s));
        if (gemeinsamVorher.join("|") !== gemeinsamNachher.join("|")) anzahl += 1;
    }
    return Math.max(1, anzahl);
}

/** Die Reihenfolge der Rollen in der Auswahl neben „Ort“: Spielort, Startort, Schauplatz (Mockup). */
export const ROLLEN_FOLGE: readonly InhalteWerkRolle[] = ["play", "start", "covers"];

/** Eine Jahresangabe aus der Liste: eine Zahl bekommt „BF“ dahinter, ein Text in Worten („Praios 1040“) steht, wie er ist. */
export const jahrIstZahl = (jahr: string): boolean => /^-?\d+$/u.test(jahr);

/** Der Kreis einer Zeile der Liste: ● aus Legacy oder Wiki, ◐ von der Redaktion angelegt oder geändert, ○ unterdrückt. */
export function kreisDesWerks(zeile: { herkunft: InhalteHerkunft; stillgelegt: boolean }): Kreis {
    return zeile.stillgelegt ? "leer" : zeile.herkunft === "editor" ? "halb" : "voll";
}
