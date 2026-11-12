import {
    editorPathStreetUrl,
    editorPathUpdateUrl,
    PATH_EDIT_SUBTYPES,
    PATH_LAND_SUBTYPES,
    pathReaderName,
    type EditorPathReisen,
    type EditorPathStreet,
    type EditorPathWeiterer,
    type FeldHerkuenfte,
    type FeldHerkunft,
    type PathFlowDirection,
    type PathMark,
    type PathReisenBody,
    type PathShape,
    type PathUpdateBody,
    type PathUpdateReceipt,
} from "@avesmaps3d/shared";
import type { BearbeitungsArt, Stand } from "../fenster/bearbeitung";
import { sende } from "../fenster/entwurf-senden";
import { herkunftDerAbschnitte, type WikiFelder } from "../fenster/wiki-feld";
import type { Punkt, Teil } from "../map/geometrie/geometrie";
import { deckungsgleich } from "../map/geometrie/rechnung";
import { weitereAbsageSatz } from "./wegeditor-texte";
import { weitereGleich, weitereGueltig, weitereWechsel } from "./weg-weitere";

/**
 * Die Straße als Art des gemeinsamen Entwurfs (WI-0177 W5b; O3, `fenster/bearbeitung.ts`; EDIT-0003 T44; Muster
 * `landschaftseditor/landschaft-art.ts`): was ihre Felder sind und wie sie als EINE Operation `path.update` gehen
 * (`POST /api/editor/paths/:id/update`).
 *
 * - **Gelesen** wird die Straße des Wege-Fensters (`GET /api/editor/paths/:id/street`) unter ihrem Anker; ihre Abschnitte mit Revision
 *   gehen als `sections` mit, damit der Server prüft, dass die Straße noch dieselbe ist.
 * - **Felder:** Name, Wegart, „Name auf der Karte“, dazu „Tunnel“ je Abschnitt (Migration 0172). Ein Griff („Pfad-3443“) ist kein Name (WI-0105): Das Feld steht dann leer, und
 *   geschrieben wird erst, was jemand einträgt. „Name auf der Karte“ ist `null`, solange die Abschnitte uneins sind (gemischt); erst
 *   ein Haken gilt allen. Die Wegart wechselt nur zwischen Landwegen (`wegartWaehlbar`). „Tunnel“ geht nur an den Abschnitt, dessen
 *   Kästchen sich bewegt hat (`sections[].tunnel`). Ebenso die Reisemittel je Abschnitt (`sections[].reisen`, Migration 0208, Vorschlag 3
 *   Schritt 3): nur an Abschnitten, deren Stand sich geändert hat, dann ganz (F16 „A“, `reisemittel.ts`, `ausgeschrieben`). Das
 *   Kennzeichen „Karawanenroute“ (`mark`, Migration 0174, WI-0177 §30) gilt allen
 *   Abschnitten und ändert keine Reisezeit; eine Straße mit Kennzeichen kann auf verschiedenen Wegtypen liegen, dann steht die Wegart
 *   auf „gemischt“ (`WEGART_GEMISCHT`), bis jemand einen Wegtyp für alle wählt.
 * - **Form** (W5b Schritt 3, `wegkurve.ts`): die Kurve EINES Abschnitts samt der Wege, die an seinen Stützpunkten mitziehen. Sie trägt
 *   ihren Ursprung (wie der Abschnitt beim Anhängen lag), denn die Straße kennt keine Punkte; `kurveAus` macht daraus die `shape` von
 *   `path.update`, in derselben Operation wie die Felder. Der Abschnitt schreibt gegen seine Revision aus `sections`, jeder Mitgezogene
 *   gegen die seines Ursprungs.
 * - **Herkunft** (WI-0225 §7, Modell c): Name, Wegart und Kennzeichen tragen sie je Abschnitt (`field_origin`); die Straße rechnet sie
 *   mit `herkunftDerAbschnitte`. ↺ setzt Herkunft wiki und geht als `{ revert: "wiki" }`, Tippen setzt manual und geht als Wert. Die
 *   Herkunft allein schreibt nichts: Geändert ist ein Feld, dessen Wert sich geändert hat.
 * - **Weitere Straßennamen** (WI-0302, `weg-weitere.ts`): je Abschnitt die Wiki-Artikel, die neben seinem Hauptartikel mitlaufen. Sie gehen wie
 *   die Reisemittel nur an Abschnitte, deren Liste sich geändert hat, dann vollständig als Schlüssel (`sections[].weitere`). Eine Absage des
 *   Servers dazu (`ist_hauptartikel`, `validation_failed` am Feld `weitere`) steht als eigener Satz im Fuß (`weitereAbsageSatz`).
 * - Für Konflikt und Fuß heißen die Teile `name`, `wegart`, `nameAufKarte`, `tunnel`, `reisen`, `weitere`, `kennzeichen` und `form`. Ein anderer hat die Form geändert, sobald sich
 *   eine Revision der Abschnitte bewegt hat: Die Straße kennt keine Punkte, und auch Felder heben die Revisionen; so wendet „Anwenden“
 *   eine eigene Kurve nie still über eine fremde.
 */

export interface WegFelder extends WikiFelder {
    readonly name: string;
    /** Der Wegtyp aller Abschnitte; `WEGART_GEMISCHT`, solange eine Straße mit Kennzeichen auf mehreren liegt. */
    readonly subtype: string;
    /** Das Kennzeichen über dem Wegtyp (Karawanenroute); `null` ohne. */
    readonly mark: PathMark | null;
    /** `null`: gemischt (die Abschnitte sind uneins), solange niemand den Haken setzt. */
    readonly labelVisible: boolean | null;
    /** Tunnel je Abschnitt, unter seiner Kennung (Migration 0172). */
    readonly tunnel: Readonly<Record<string, boolean>>;
    /** Die Reisemittel je Abschnitt, unter seiner Kennung (Migration 0208): wie gelesen, nach dem ersten Ändern ausgeschrieben. */
    readonly reisen: Readonly<Record<string, EditorPathReisen>>;
    /**
     * Der Wegtyp je Abschnitt, unter seiner Kennung (Vorschlag 3 Schritt 3). `subtype` ist der Wegtyp aller, solange sie gleich sind,
     * sonst `WEGART_GEMISCHT`; die Wegart oben und ↺ setzen beide, die Tafel nur die gewählten Abschnitte (`mitWegartTeil`).
     */
    readonly arten: Readonly<Record<string, string>>;
    /**
     * Die Fließrichtung je Abschnitt, unter seiner Kennung (Plan Fluss/Bach, Schritt 4): `forward` in Zeichenrichtung, `reverse`
     * dagegen, `null` offen. Geschrieben wird sie nur an einem Fluss.
     */
    readonly richtung: Readonly<Record<string, PathFlowDirection | null>>;
    /** Die weiteren Straßennamen je Abschnitt, unter seiner Kennung (WI-0302): die Wiki-Artikel, die neben dem Hauptartikel mitlaufen. */
    readonly weitere: Readonly<Record<string, readonly EditorPathWeiterer[]>>;
    /** Herkunft von Name, Wegtyp und Kennzeichen der Straße (aus den Abschnitten, im Entwurf fortgeschrieben). */
    readonly herkunft: FeldHerkuenfte;
}

/** Die Felder der Straße mit Herkunft (`FELD_HERKUNFT_FELDER.path`). */
export const WEG_HERKUNFT_FELDER = ["name", "subtype", "mark"] as const;

/** Die Herkunft der Straße je Feld aus ihren Abschnitten (wiki nur, wenn alle; ein manual macht manual). */
function herkunftAus(d: EditorPathStreet): FeldHerkuenfte {
    const raus: Partial<Record<string, FeldHerkunft>> = {};
    for (const feld of WEG_HERKUNFT_FELDER) {
        const herkunft = herkunftDerAbschnitte(d.segments.map((teil) => teil.herkunft?.[feld]));
        if (herkunft !== undefined) raus[feld] = herkunft;
    }
    return raus;
}

/** Der Abschnitt und die Wege, die an seinen Stützpunkten mitziehen. */
export interface WegKurve {
    readonly teil: Teil;
    readonly nachbarn: readonly Teil[];
}

/** Die Form: die Kurve eines Abschnitts, wie sie jetzt liegt, und wie sie beim Anhängen lag. */
export interface WegForm extends WegKurve {
    readonly ursprung: WegKurve;
    /** Ein Schritt von „Wegkurve vereinfachen“: die Punkte, die vereinfacht wurden, und die Stärke. Eine Handbewegung hat keinen. */
    readonly vereinfacht?: { readonly von: readonly Punkt[]; readonly staerke: number };
}

export type WegStand = Stand<WegFelder, WegForm>;

export interface WegArt extends BearbeitungsArt<EditorPathStreet, WegFelder, WegForm, PathUpdateBody> {
    /** Die Quittung des letzten Schreibens (für den Hinweis, woran die Enden nach der Kurve hängen). */
    quittung(): PathUpdateReceipt | undefined;
}

/** Der Bach als Wahl neben den Wegtypen (Plan Fluss/Bach 2026-10-19): ein Flussweg mit `is_bach`, wie Legacys Haken „Bach“. */
export const WEGART_BACH = "Bach";

/**
 * Ist das eine Wahl der Wegart? Die Landwege, der Fluss und der Bach (Plan Fluss/Bach, wie Legacys Dialog mit allen Wegtypen); Seewege
 * gibt es im Editor nicht.
 */
export const wegartWaehlbar = (art: string): boolean =>
    art === WEGART_BACH || (PATH_EDIT_SUBTYPES as readonly string[]).includes(art);

/** Der Wegtyp hinter einer Wahl: Der Bach ist ein Flussweg. */
export const subtypeDerWahl = (art: string): string => (art === WEGART_BACH ? "Flussweg" : art);

/** Ist die Wahl ein Gewässer (Fluss oder Bach)? Nur dann hat ein Abschnitt eine Fließrichtung. */
export const istFluss = (art: string): boolean => subtypeDerWahl(art) === "Flussweg";

/** Die Verkehrsdomäne einer Wahl: Wechselt sie, fallen die Reisemittel auf die Vorgabe der neuen Art (Legacy `resetToDefault`). */
const domaeneDerWahl = (art: string): string => (art === WEGART_BACH ? "bach" : istFluss(art) ? "fluss" : "land");

/** Die Wahl eines Abschnitts: sein Wegtyp, ein Bach als „Bach“. */
const wahlDes = (
    teil: EditorPathStreet["segments"][number],
    d: Pick<EditorPathStreet, "subtype" | "isBach">,
): string => {
    const art = teil.art ?? teil.subtype ?? d.subtype;
    return art === "Flussweg" && (teil.bach ?? d.isBach) ? WEGART_BACH : art;
};

/** Die Wegart einer Straße mit Kennzeichen auf mehreren Wegtypen: kein Wegtyp, nichts zu schreiben, bis einer gewählt ist. */
export const WEGART_GEMISCHT = "";

/** Trägt jeder Abschnitt der Straße einen Landweg? Nur dann ist das Kennzeichen wählbar. */
export const nurLandwege = (d: Pick<EditorPathStreet, "subtype" | "subtypes">): boolean =>
    (d.subtypes ?? [d.subtype]).every((art) => (PATH_LAND_SUBTYPES as readonly string[]).includes(art));

/** Lässt sich die Wegart der Straße wählen? Jeder Abschnitt ist ein Landweg oder ein Fluss (kein Seeweg). */
export const wegartWaehlbarFuer = (d: Pick<EditorPathStreet, "subtype" | "subtypes">): boolean =>
    (d.subtypes ?? [d.subtype]).every(wegartWaehlbar);

/** Die Wahl aller, wenn sie einig sind, sonst „gemischt“. */
const einig = (arten: Readonly<Record<string, string>>, sonst: string): string => {
    const werte = new Set(Object.values(arten));
    return werte.size === 0 ? sonst : werte.size === 1 ? ([...werte][0] ?? WEGART_GEMISCHT) : WEGART_GEMISCHT;
};

/** Ein Abschnitt ohne gespeicherte Reisemittel: die Vorgabe seines Wegtyps. */
const OHNE_REISEN: EditorPathReisen = { liste: null, domaene: null, fenster: {} };

export const felderAus = (d: EditorPathStreet): WegFelder => ({
    name: pathReaderName(d.name, d.subtype) ?? "",
    // Mehrere Wegtypen: „gemischt“; sonst die Wahl aller, wenn sie einig sind (auch Fluss und Bach nebeneinander sind gemischt).
    subtype:
        d.subtypes !== undefined
            ? WEGART_GEMISCHT
            : einig(
                  Object.fromEntries(d.segments.map((teil) => [teil.id, wahlDes(teil, d)])),
                  d.subtype === "Flussweg" && d.isBach ? WEGART_BACH : d.subtype,
              ),
    mark: d.mark ?? null,
    labelVisible: d.labelVisible,
    tunnel: Object.fromEntries(d.segments.map((teil) => [teil.id, teil.tunnel === true])),
    reisen: Object.fromEntries(d.segments.map((teil) => [teil.id, teil.reisen ?? OHNE_REISEN])),
    arten: Object.fromEntries(d.segments.map((teil) => [teil.id, wahlDes(teil, d)])),
    richtung: Object.fromEntries(d.segments.map((teil) => [teil.id, teil.flowDirection ?? null])),
    weitere: Object.fromEntries(d.segments.map((teil) => [teil.id, teil.weitere ?? []])),
    herkunft: herkunftAus(d),
});

/** Die Reisemittel nach einem Wechsel der Wahl: über die Domäne hinweg die Vorgabe der neuen Art, sonst wie sie waren. */
function reisenNachWahl(
    reisen: WegFelder["reisen"],
    vorher: WegFelder["arten"],
    nachher: WegFelder["arten"],
): WegFelder["reisen"] {
    return Object.fromEntries(
        Object.entries(reisen).map(([id, r]) => [
            id,
            domaeneDerWahl(vorher[id] ?? "") === domaeneDerWahl(nachher[id] ?? "") ? r : OHNE_REISEN,
        ]),
    );
}

/**
 * Die Wegart für alle Abschnitte (die Wegart oben, ↺): jeder wählbare Abschnitt nimmt sie; über die Domäne hinweg (Land, Fluss, Bach)
 * fallen seine Reisemittel auf die Vorgabe der neuen Art.
 */
export function mitWegartFuerAlle<F extends Pick<WegFelder, "arten" | "reisen">>(felder: F, wert: string): F {
    if (!wegartWaehlbar(wert)) return felder;
    const arten = Object.fromEntries(
        Object.entries(felder.arten).map(([id, art]) => [id, wegartWaehlbar(art) ? wert : art]),
    );
    return { ...felder, arten, reisen: reisenNachWahl(felder.reisen, felder.arten, arten) };
}

/**
 * Der Wegtyp nur der gewählten Abschnitte (die Tafel, Vorschlag 3 Schritt 3): Ein Flussweg bleibt Flussweg. `subtype` folgt: gleich
 * für alle, sonst „gemischt“; wechselt er, ist seine Herkunft manual.
 */
export function mitWegartTeil(felder: WegFelder, ids: readonly string[], wert: string): WegFelder {
    if (!wegartWaehlbar(wert)) return felder;
    const arten = { ...felder.arten };
    for (const id of ids) if (arten[id] !== undefined && wegartWaehlbar(arten[id])) arten[id] = wert;
    const alle = einig(arten, felder.subtype);
    const neu = { ...felder, arten, reisen: reisenNachWahl(felder.reisen, felder.arten, arten) };
    return alle === felder.subtype
        ? neu
        : { ...neu, subtype: alle, herkunft: { ...felder.herkunft, subtype: "manual" } };
}

/** Die Fließrichtung der gewählten Abschnitte, die ein Fluss sind (Schritt 4); an einem Landweg nichts. */
export function mitRichtung(felder: WegFelder, ids: readonly string[], wert: PathFlowDirection | null): WegFelder {
    const richtung = { ...felder.richtung };
    for (const id of ids) if (istFluss(felder.arten[id] ?? "")) richtung[id] = wert;
    return { ...felder, richtung };
}

/** Je Abschnitt eine eigene Fließrichtung („Auf alle Abschnitte übernehmen“, OPS-000112, `weg-fliessrichtung.ts`); nur an Flüssen. */
export function mitRichtungen(felder: WegFelder, werte: Readonly<Record<string, PathFlowDirection>>): WegFelder {
    const richtung = { ...felder.richtung };
    for (const [id, wert] of Object.entries(werte)) if (istFluss(felder.arten[id] ?? "")) richtung[id] = wert;
    return { ...felder, richtung };
}

/** „Umkehren“ (Legacy „Richtung umdrehen“): je gewähltem Fluss das Feld drehen, nie die Linie; eine offene bleibt offen. */
export function mitRichtungUmgekehrt(felder: WegFelder, ids: readonly string[]): WegFelder {
    const richtung = { ...felder.richtung };
    for (const id of ids) {
        const jetzt = richtung[id];
        if (!istFluss(felder.arten[id] ?? "") || jetzt === null || jetzt === undefined) continue;
        richtung[id] = jetzt === "forward" ? "reverse" : "forward";
    }
    return { ...felder, richtung };
}

/** Die Abschnitte, deren Fließrichtung in zwei Ständen verschieden steht. */
const richtungWechsel = (a: WegFelder["richtung"], b: WegFelder["richtung"]): string[] =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((id) => (a[id] ?? null) !== (b[id] ?? null));

/** Die Wahl im Körper von `path.update`: der Wegtyp, am Fluss dazu, ob Bach (Plan Fluss/Bach). */
const wahlImKoerper = (
    art: string,
): { subtype: Exclude<NonNullable<PathUpdateBody["subtype"]>, object>; bach?: boolean } => ({
    subtype: subtypeDerWahl(art) as Exclude<NonNullable<PathUpdateBody["subtype"]>, object>,
    ...(istFluss(art) ? { bach: art === WEGART_BACH } : {}),
});

/** Die Abschnitte, deren Wegtyp in zwei Ständen verschieden steht. */
const artenWechsel = (a: WegFelder["arten"], b: WegFelder["arten"]): string[] =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((id) => a[id] !== b[id]);

/** Die Abschnitte, deren Reisemittel in zwei Ständen verschieden stehen. */
const reisenWechsel = (a: WegFelder["reisen"], b: WegFelder["reisen"]): string[] =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
        (id) => JSON.stringify(a[id] ?? OHNE_REISEN) !== JSON.stringify(b[id] ?? OHNE_REISEN),
    );

/** Die Abschnitte, deren Tunnel in zwei Ständen verschieden steht. */
const tunnelWechsel = (a: WegFelder["tunnel"], b: WegFelder["tunnel"]): string[] =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((id) => (a[id] === true) !== (b[id] === true));

const gleichePunkte = (a: readonly Punkt[], b: readonly Punkt[]): boolean =>
    a.length === b.length && a.every((p, i) => deckungsgleich(p, b[i]!));

/**
 * Die Kurve zur Form: die Punkte des Abschnitts, wie sie jetzt liegen, und je Punkt eines Mitgezogenen, der seit dem Ursprung woanders
 * liegt, von wo nach wo gegen dessen Revision im Ursprung. Ein Mitgezogener bekommt nie Punkte dazu, also stehen seine Punkte an
 * denselben Stellen wie im Ursprung. `undefined`: Die Form liegt, wie sie lag.
 */
export function kurveAus(form: WegForm): PathShape | undefined {
    const carried: PathShape["carried"] = [];
    for (const nachbar of form.nachbarn) {
        const vorher = form.ursprung.nachbarn.find((n) => n.objekt === nachbar.objekt);
        if (vorher === undefined) continue;
        nachbar.punkte.forEach((nach, index) => {
            const von = vorher.punkte[index];
            if (von === undefined || deckungsgleich(von, nach)) return;
            carried.push({
                pathId: nachbar.objekt,
                index,
                baseRevision: vorher.revision,
                from: { x: von.x, y: von.y },
                to: { x: nach.x, y: nach.y },
            });
        });
    }
    if (carried.length === 0 && gleichePunkte(form.teil.punkte, form.ursprung.teil.punkte)) return undefined;
    return { publicId: form.teil.objekt, points: form.teil.punkte.map((p) => ({ x: p.x, y: p.y })), carried };
}

/** Hat sich an den Abschnitten der Straße etwas bewegt (eine Revision)? */
const abschnitteBewegt = (vorher: EditorPathStreet, jetzt: EditorPathStreet): boolean =>
    vorher.segments.length !== jetzt.segments.length ||
    vorher.segments.some((teil) => jetzt.segments.find((x) => x.id === teil.id)?.revision !== teil.revision);

/** Punkte aus der Sicherung im Browser; `undefined`: nicht lesbar. */
const punkteEin = (wert: unknown): Punkt[] | undefined =>
    Array.isArray(wert) && wert.every((p: Partial<Punkt> | null) => typeof p?.x === "number" && typeof p.y === "number")
        ? (wert as Punkt[]).map((p) => ({ x: p.x, y: p.y }))
        : undefined;

/** Ein Teil aus der Sicherung im Browser; `undefined`: nicht lesbar. */
function teilEin(wert: unknown): Teil | undefined {
    const t = wert as Partial<Teil> | null | undefined;
    const punkte = punkteEin(t?.punkte);
    if (typeof t?.objekt !== "string" || typeof t.name !== "string" || typeof t.revision !== "number") return undefined;
    return punkte === undefined
        ? undefined
        : { objekt: t.objekt, name: t.name, nr: 0, art: "linie", punkte, revision: t.revision };
}

function kurveEin(wert: unknown): WegKurve | undefined {
    const k = wert as { teil?: unknown; nachbarn?: unknown } | null;
    const teil = teilEin(k?.teil);
    if (teil === undefined || !Array.isArray(k?.nachbarn)) return undefined;
    const nachbarn = k.nachbarn.map(teilEin);
    return nachbarn.every((n): n is Teil => n !== undefined) ? { teil, nachbarn } : undefined;
}

function formEin(wert: unknown): WegForm | undefined {
    if (wert === undefined || wert === null) return undefined;
    const f = wert as { ursprung?: unknown; vereinfacht?: { von?: unknown; staerke?: unknown } };
    const jetzt = kurveEin(wert);
    const ursprung = kurveEin(f.ursprung);
    if (jetzt === undefined || ursprung === undefined) return undefined;
    const von = punkteEin(f.vereinfacht?.von);
    const staerke = f.vereinfacht?.staerke;
    return {
        ...jetzt,
        ursprung,
        ...(von !== undefined && typeof staerke === "number" ? { vereinfacht: { von, staerke } } : {}),
    };
}

/** Die geänderten Teile zweier Feldstände, in den Namen von Konflikt und Fuß. */
function unterschiede(a: WegFelder, b: WegFelder): string[] {
    const raus: string[] = [];
    if (a.name.trim() !== b.name.trim()) raus.push("name");
    if (a.subtype !== b.subtype || artenWechsel(a.arten, b.arten).length > 0) raus.push("wegart");
    if (a.mark !== b.mark) raus.push("kennzeichen");
    if (a.labelVisible !== b.labelVisible) raus.push("nameAufKarte");
    if (tunnelWechsel(a.tunnel, b.tunnel).length > 0) raus.push("tunnel");
    if (reisenWechsel(a.reisen, b.reisen).length > 0) raus.push("reisen");
    if (weitereWechsel(a.weitere, b.weitere).length > 0) raus.push("weitere");
    if (richtungWechsel(a.richtung, b.richtung).length > 0) raus.push("richtung");
    return raus;
}

/** Ein gesicherter Stand der Reisemittel eines Abschnitts, grob geprüft (Liste, Domäne, Fenster). */
const reisenGueltig = (r: unknown): boolean => {
    const x = r as Partial<EditorPathReisen> | null;
    return (
        typeof x === "object" &&
        x !== null &&
        (x.liste === null || (Array.isArray(x.liste) && x.liste.every((m) => typeof m === "string"))) &&
        (x.domaene === null || typeof x.domaene === "string") &&
        typeof x.fenster === "object" &&
        x.fenster !== null
    );
};

export function createWegArt(fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init)): WegArt {
    let letzte: PathUpdateReceipt | undefined;
    return {
        sperrArt: "path",
        quittung: () => letzte,
        async lade(id, signal) {
            const antwort = await fetcher(editorPathStreetUrl(id), {
                signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`Weg ${id}: ${String(antwort.status)}`);
            return (await antwort.json()) as EditorPathStreet;
        },
        felder: felderAus,
        operation(d, start, jetzt, operationId) {
            // Tunnel und Reisemittel nur an den Abschnitten, deren Stand sich bewegt hat; die Reisemittel dann ganz (F16 „A“).
            const tunnel = new Set(tunnelWechsel(start.felder.tunnel, jetzt.felder.tunnel));
            const reisen = new Set(reisenWechsel(start.felder.reisen, jetzt.felder.reisen));
            // Die weiteren Straßennamen ebenso nur an Abschnitten, deren Liste sich geändert hat, dann vollständig (WI-0302).
            const weitere = new Set(weitereWechsel(start.felder.weitere, jetzt.felder.weitere));
            // Die Wegart für alle, wenn danach alle gleich sind (oben, ↺ oder die Tafel am letzten Abschnitt); sonst je Abschnitt (die
            // Tafel, Vorschlag 3 Schritt 3).
            const fuerAlle =
                jetzt.felder.subtype !== start.felder.subtype &&
                wegartWaehlbarFuer(d) &&
                wegartWaehlbar(jetzt.felder.subtype);
            // Die Fließrichtung nur an Abschnitten, die nach dieser Operation ein Fluss sind.
            const richtung = new Set(
                richtungWechsel(start.felder.richtung, jetzt.felder.richtung).filter((id) =>
                    istFluss(jetzt.felder.arten[id] ?? ""),
                ),
            );
            const artJe = new Set(
                fuerAlle
                    ? []
                    : artenWechsel(start.felder.arten, jetzt.felder.arten).filter((id) =>
                          wegartWaehlbar(jetzt.felder.arten[id] ?? ""),
                      ),
            );
            const reisenVon = (id: string): PathReisenBody | undefined => {
                const r = jetzt.felder.reisen[id];
                return r === undefined || r.geschrieben !== true || r.liste === null
                    ? undefined
                    : { liste: [...r.liste], fenster: { ...r.fenster } as PathReisenBody["fenster"] };
            };
            const body: { -readonly [K in keyof PathUpdateBody]: PathUpdateBody[K] } = {
                operationId,
                sections: d.segments.map((teil) => {
                    const r = reisen.has(teil.id) ? reisenVon(teil.id) : undefined;
                    return {
                        publicId: teil.id,
                        baseRevision: teil.revision,
                        ...(tunnel.has(teil.id) ? { tunnel: jetzt.felder.tunnel[teil.id] === true } : {}),
                        ...(r !== undefined ? { reisen: r } : {}),
                        ...(artJe.has(teil.id) ? wahlImKoerper(jetzt.felder.arten[teil.id] ?? "") : {}),
                        ...(richtung.has(teil.id) ? { flowDirection: jetzt.felder.richtung[teil.id] ?? null } : {}),
                        ...(weitere.has(teil.id)
                            ? { weitere: (jetzt.felder.weitere[teil.id] ?? []).map((w) => w.key) }
                            : {}),
                    };
                }),
            };
            // ↺ geht als `{ revert: "wiki" }` (der Server holt den Wert aus dem Artikel), sonst der Wert (WI-0225 §7).
            const zumWiki = (feld: (typeof WEG_HERKUNFT_FELDER)[number]): boolean =>
                jetzt.felder.herkunft[feld] === "wiki";
            const name = jetzt.felder.name.trim();
            if (name !== start.felder.name.trim()) body.name = zumWiki("name") ? { revert: "wiki" } : name;
            if (fuerAlle) {
                if (zumWiki("subtype")) body.subtype = { revert: "wiki" };
                else Object.assign(body, wahlImKoerper(jetzt.felder.subtype));
            }
            if (jetzt.felder.mark !== start.felder.mark && nurLandwege(d))
                body.mark = zumWiki("mark") ? { revert: "wiki" } : (jetzt.felder.mark ?? "");
            if (jetzt.felder.labelVisible !== start.felder.labelVisible && jetzt.felder.labelVisible !== null)
                body.labelVisible = jetzt.felder.labelVisible;
            // Die Kurve nur an einem Abschnitt dieser Straße (sonst lehnt der Server ab).
            const kurve = jetzt.form === undefined ? undefined : kurveAus(jetzt.form);
            if (kurve !== undefined && d.segments.some((teil) => teil.id === kurve.publicId)) body.shape = kurve;
            return body.name === undefined &&
                body.subtype === undefined &&
                body.mark === undefined &&
                body.labelVisible === undefined &&
                body.shape === undefined &&
                !body.sections.some(
                    (teil) =>
                        teil.tunnel !== undefined ||
                        teil.reisen !== undefined ||
                        teil.subtype !== undefined ||
                        teil.bach !== undefined ||
                        teil.flowDirection !== undefined ||
                        teil.weitere !== undefined,
                )
                ? undefined
                : body;
        },
        async schreibe(id, body) {
            const antwort = await sende(editorPathUpdateUrl(id), body, "POST", fetcher);
            letzte = antwort.ok ? (antwort.quittung as PathUpdateReceipt) : undefined;
            if (antwort.ok) return antwort;
            // Eine Absage zu den weiteren Straßennamen sagt der Fuß in der Sprache der Seite, nicht im Satz des Servers.
            const satz = weitereAbsageSatz(antwort.fehler);
            return satz === undefined ? antwort : { ...antwort, fehler: { ...antwort.fehler, message: satz } };
        },
        geaendert: (d, stand) => [
            ...unterschiede(felderAus(d), stand.felder),
            ...(stand.form !== undefined && kurveAus(stand.form) !== undefined ? ["form"] : []),
        ],
        fremde: (vorher, jetzt) => [
            ...unterschiede(felderAus(vorher), felderAus(jetzt)),
            ...(abschnitteBewegt(vorher, jetzt) ? ["form"] : []),
        ],
        aufNeuenStand(vorher, jetzt, stand) {
            const alt = felderAus(vorher);
            const neu = felderAus(jetzt);
            const eigene = new Set(unterschiede(alt, stand.felder));
            // Die Herkunft folgt ihrem Feld: das eigene behält die des Entwurfs, sonst gilt die neue.
            const TEIL = { name: "name", subtype: "wegart", mark: "kennzeichen" } as const;
            const herkunft: Partial<Record<string, FeldHerkunft>> = {};
            for (const feld of WEG_HERKUNFT_FELDER) {
                const h = eigene.has(TEIL[feld]) ? stand.felder.herkunft[feld] : neu.herkunft[feld];
                if (h !== undefined) herkunft[feld] = h;
            }
            return {
                felder: {
                    name: eigene.has("name") ? stand.felder.name : neu.name,
                    subtype: eigene.has("wegart") ? stand.felder.subtype : neu.subtype,
                    mark: eigene.has("kennzeichen") ? stand.felder.mark : neu.mark,
                    labelVisible: eigene.has("nameAufKarte") ? stand.felder.labelVisible : neu.labelVisible,
                    // Je Abschnitt: das eigene Kästchen bleibt, sonst gilt der neue Stand.
                    tunnel: Object.fromEntries(
                        Object.entries(neu.tunnel).map(([id, an]) => [
                            id,
                            (stand.felder.tunnel[id] === true) !== (alt.tunnel[id] === true)
                                ? stand.felder.tunnel[id] === true
                                : an,
                        ]),
                    ),
                    // Der Wegtyp je Abschnitt: der eigene bleibt, sonst gilt der neue Stand.
                    arten: Object.fromEntries(
                        Object.entries(neu.arten).map(([id, art]) => [
                            id,
                            stand.felder.arten[id] !== undefined && stand.felder.arten[id] !== alt.arten[id]
                                ? stand.felder.arten[id]
                                : art,
                        ]),
                    ),
                    // Die Fließrichtung je Abschnitt: die eigene bleibt, sonst gilt der neue Stand.
                    richtung: Object.fromEntries(
                        Object.entries(neu.richtung).map(([id, r]) => [
                            id,
                            (stand.felder.richtung[id] ?? null) !== (alt.richtung[id] ?? null)
                                ? (stand.felder.richtung[id] ?? null)
                                : r,
                        ]),
                    ),
                    // Die weiteren Straßennamen je Abschnitt: die eigene Liste bleibt, sonst gilt der neue Stand.
                    weitere: Object.fromEntries(
                        Object.entries(neu.weitere).map(([id, liste]) => [
                            id,
                            stand.felder.weitere[id] !== undefined &&
                            !weitereGleich(stand.felder.weitere[id], alt.weitere[id])
                                ? stand.felder.weitere[id]
                                : liste,
                        ]),
                    ),
                    // Ebenso die Reisemittel: die eigene Änderung bleibt, sonst gilt der neue Stand.
                    reisen: Object.fromEntries(
                        Object.entries(neu.reisen).map(([id, r]) => [
                            id,
                            reisenWechsel(
                                { [id]: alt.reisen[id] ?? OHNE_REISEN },
                                { [id]: stand.felder.reisen[id] ?? OHNE_REISEN },
                            ).length > 0
                                ? (stand.felder.reisen[id] ?? r)
                                : r,
                        ]),
                    ),
                    herkunft,
                },
                // Die Form bleibt; ihr Abschnitt schreibt ohnehin gegen seine Revision aus dem neuen Stand (`sections`).
                form: stand.form,
            };
        },
        sicherung: {
            version: 9,
            aus: (stand) => ({ felder: stand.felder, form: stand.form }),
            ein(wert) {
                const s = wert as { felder?: Partial<WegFelder>; form?: unknown } | null;
                const felder = s?.felder;
                if (
                    felder === undefined ||
                    typeof felder.name !== "string" ||
                    typeof felder.subtype !== "string" ||
                    !(felder.mark === null || felder.mark === "karawanenroute") ||
                    !(typeof felder.labelVisible === "boolean" || felder.labelVisible === null) ||
                    typeof felder.tunnel !== "object" ||
                    felder.tunnel === null ||
                    !Object.values(felder.tunnel).every((an) => typeof an === "boolean") ||
                    typeof felder.reisen !== "object" ||
                    felder.reisen === null ||
                    typeof felder.arten !== "object" ||
                    felder.arten === null ||
                    !Object.values(felder.arten).every((art) => typeof art === "string") ||
                    typeof felder.richtung !== "object" ||
                    felder.richtung === null ||
                    !Object.values(felder.richtung).every((r) => r === null || r === "forward" || r === "reverse") ||
                    !Object.values(felder.reisen).every(reisenGueltig) ||
                    !weitereGueltig(felder.weitere) ||
                    typeof felder.herkunft !== "object" ||
                    felder.herkunft === null ||
                    !Object.values(felder.herkunft).every((h) => h === "wiki" || h === "manual")
                )
                    return undefined;
                const form = formEin(s?.form);
                if (s?.form !== undefined && s.form !== null && form === undefined) return undefined;
                return {
                    felder: {
                        name: felder.name,
                        subtype: felder.subtype,
                        mark: felder.mark,
                        labelVisible: felder.labelVisible,
                        tunnel: { ...felder.tunnel },
                        reisen: { ...felder.reisen },
                        arten: { ...felder.arten },
                        richtung: { ...felder.richtung },
                        weitere: { ...felder.weitere },
                        herkunft: { ...felder.herkunft },
                    },
                    form,
                };
            },
        },
    };
}
