import {
    GEBIRGS_HOEHENSTUFEN,
    GEBIRGS_MODELL_GRENZEN,
    GEBIRGS_MODELL_WERTE,
    rechnetRueckennetz,
    rueckennetzRegler,
    rueckennetzVorgabe,
    type EditorGebirge,
    type GebirgsModellWert,
    type GebirgsNetzAenderung,
    type GebirgsZurueckAlle,
    GEBIRGSTYPEN,
    GEBIRGS_WERTE,
    GEBIRGS_WERT_GRENZEN,
    type GebirgsAenderung,
    type GebirgsHoehenstufe,
    type GebirgsMuster,
    type GebirgsPresetGruppe,
    type GebirgsStand,
    type GebirgsWert,
    type Gebirgstyp,
} from "@avesmaps3d/shared";
import { netzSkaliert } from "./kamm-netz";

/**
 * Das Gebirge im Entwurf der Fläche (WI-0178 P4; Bauvorlage Fassung 16; Vertrag WI-0226 `packages/shared/src/gebirge/`): je Teilfläche
 * ihr `GebirgsStand` (Typ und Abweichungen, `null` heißt „Vorgabe“), im EINEN Entwurf der Fläche geändert und mit „Fertig“ als
 * `GebirgsAenderung` geschrieben: nur Geändertes, ↺ als Name in `zurueck`, nie `null` im Feld (Fastifys ajv machte daraus still eine 0).
 *
 * - **F1 Typ als Eigenschaft, F2 Werte als Abweichung:** Ein Wert gilt aus dem Gebirge, sonst aus dem Preset seines Typs, sonst aus der
 *   Rechnung (`V12_VORGABE`). Wer einen Wert auf den des Presets zurückzieht, hat keine Abweichung mehr.
 * - **Typwechsel** (Fassung 16, „zurücksetzen“): Die Abweichungen fallen weg, der neue Typ gilt ganz. „Keins passt“ (kein Typ) nimmt die
 *   Werte, die eben galten, als eigene, damit das Gebirge nicht still auf die Vorgabe der Rechnung springt.
 * - **Kammhöhe:** der eigene Wert, sonst die Grundhöhe der Fläche (`EditorGebirge.grundhoehe`). Die Höhenstufen sind Schnellwahl.
 * - **Rückennetz** (WI-0245, Bauplan Gebirge D1/D3): Der Entwurf trägt dazu die Werte des Rückennetzes (`modell`: Gratlinie, Gratbreite,
 *   Talboden), das gezeichnete Netz und die Revision der Gebirgswerte, gegen die „Fertig“ schreibt (`baseRevision`). Das Preset der
 *   drei Werte ist der Vorschlag des Typs (`rueckennetzVorgabe` der Topographie, ohne Typ das Kettengebirge).
 */

/** Was der Entwurf je Teilfläche hält: der Stand der V12 und, seit WI-0245, Rückennetz und Revision (fehlen sie, gelten sie als leer). */
export type GebirgsEntwurf = GebirgsStand &
    Partial<Pick<EditorGebirge["stand"], "modell" | "netz" | "revision" | "saat">>;
type Netz = EditorGebirge["stand"]["netz"];
const LEERES_NETZ: Netz = { kaemme: [], nebengipfel: [] };
const netzVon = (stand: GebirgsEntwurf): Netz => stand.netz ?? LEERES_NETZ;
/** Hat das Gebirge im Entwurf gezeichnete Kämme? Dann rechnet es das Rückennetz, und die drei Werte stehen im Raster. */
export const hatKaemme = (stand: GebirgsEntwurf): boolean =>
    netzVon(stand).kaemme.length > 0 || (netzVon(stand).mulden?.length ?? 0) > 0;

/**
 * Rechnet die Vorschau dieses Entwurfs das Rückennetz? Wie das Gelände (`rechnetRueckennetz`): mit Kamm, Tal oder Mulde, mit Köpfen des
 * Typs (WI-0249 P2, Typwert `form.kopf` der Fassung) auch nur mit Nebengipfeln.
 */
export const rechnetMitRueckennetz = (stand: GebirgsEntwurf, gruppe: GebirgsPresetGruppe | null): boolean =>
    rechnetRueckennetz(netzVon(stand), rueckennetzRegler(gruppe, stand.typ, stand.modell ?? {}).form.kopf);

/** Die Werte der Rechnung ohne Preset und ohne eigenen Wert (V12, `packages/shared/src/gebirge/constants.ts` und `build.ts`). */
export const V12_VORGABE: Readonly<Record<GebirgsWert, number>> = {
    hypsometrie: 0,
    plateau: 1,
    rauschen: 0.35,
    einschnitt: 400,
    erosion: 3,
    talbreite: 1.5,
    koernung: 3.2,
    stufen: 3,
    bergform: 2.5,
    sattel: 0.75,
};

/** Ohne Grundhöhe (eine Fläche ohne Höhenstufe) zeigt der Reiter diese Kammhöhe, wie die Rechnung (Fassung 16). */
export const KAMMHOEHE_OHNE_GRUND = 1000;

export const GEBIRGE_LEER: GebirgsEntwurf = {
    typ: null,
    werte: {},
    muster: null,
    kammhoehe: null,
    modell: {},
    netz: LEERES_NETZ,
    revision: 0,
};

const nah = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

/** Der Wert, der gilt: aus dem Gebirge, sonst aus dem Preset seines Typs, sonst aus der Rechnung. */
export function geltenderWert(stand: GebirgsStand, presets: GebirgsPresetGruppe, wert: GebirgsWert): number {
    return (
        stand.werte[wert] ??
        (stand.typ === null ? undefined : presets.typen[stand.typ].werte[wert]) ??
        V12_VORGABE[wert]
    );
}

/** Der Wert des Presets (mit Typ) oder `undefined` (ohne Typ: Es gibt nichts, wovon er abweicht). */
export function presetWert(stand: GebirgsStand, presets: GebirgsPresetGruppe, wert: GebirgsWert): number | undefined {
    return stand.typ === null ? undefined : presets.typen[stand.typ].werte[wert];
}

/** Weicht der Wert vom Preset ab? Ohne Typ zählt jeder eigene Wert nicht als Abweichung (er IST das Gebirge). */
export function weichtAb(stand: GebirgsStand, presets: GebirgsPresetGruppe, wert: GebirgsWert): boolean {
    const eigen = stand.werte[wert];
    const preset = presetWert(stand, presets, wert);
    return eigen !== undefined && preset !== undefined && !nah(eigen, preset);
}

export function geltendesMuster(stand: GebirgsStand, presets: GebirgsPresetGruppe): GebirgsMuster {
    return stand.muster ?? (stand.typ === null ? undefined : presets.typen[stand.typ].muster) ?? "rauschen";
}

export const presetMuster = (stand: GebirgsStand, presets: GebirgsPresetGruppe): GebirgsMuster =>
    stand.typ === null ? "rauschen" : presets.typen[stand.typ].muster;

/** Die Kammhöhe, die gilt: die eigene, sonst die Grundhöhe der Fläche. */
export const geltendeKammhoehe = (stand: GebirgsStand, grundhoehe: number | null): number =>
    stand.kammhoehe ?? grundhoehe ?? KAMMHOEHE_OHNE_GRUND;

/** Die Höhenstufe mit genau dieser Höhe (Schnellwahl gedrückt), sonst keine. */
export function stufeMit(presets: GebirgsPresetGruppe, hoehe: number): GebirgsHoehenstufe | undefined {
    return GEBIRGS_HOEHENSTUFEN.find((stufe) => presets.hoehenstufen[stufe] === hoehe);
}

/** Einen Wert in seine Grenzen legen und auf seinen Schritt runden; `undefined`, wenn es keine Zahl ist. */
export function begrenzt(wert: GebirgsWert, roh: number): number | undefined {
    if (!Number.isFinite(roh)) return undefined;
    const { min, max, schritt } = GEBIRGS_WERT_GRENZEN[wert];
    const gerundet = schritt === 1 ? Math.round(roh) : roh;
    return Math.min(max, Math.max(min, gerundet));
}

/** Einen Wert setzen: Trifft er das Preset, ist die Abweichung weg (F2). */
export function mitWert<S extends GebirgsStand>(
    stand: S,
    presets: GebirgsPresetGruppe,
    wert: GebirgsWert,
    neu: number,
): S {
    const preset = presetWert(stand, presets, wert);
    const werte = { ...stand.werte, [wert]: neu };
    if (preset !== undefined && nah(neu, preset)) delete werte[wert];
    return { ...stand, werte };
}

/** ↺ an einem Wert: zurück auf das Preset (ohne Typ: auf die Rechnung). */
export function ohneWert<S extends GebirgsStand>(stand: S, wert: GebirgsWert): S {
    const werte = { ...stand.werte };
    delete werte[wert];
    return { ...stand, werte };
}

/**
 * Den Typ wechseln (Fassung 16, „zurücksetzen“); `null` ist „Keins passt“ und nimmt die geltenden Werte als eigene. Die Werte des
 * Rückennetzes (WI-0245) gehen mit: Ein Typ setzt sie zurück; „Keins passt“ behält Gratlinie und Gratbreite, wie sie galten, und einen
 * eigenen Talboden (ein abgeleiteter bleibt abgeleitet).
 */
export function mitTyp<S extends GebirgsEntwurf>(stand: S, presets: GebirgsPresetGruppe, typ: Gebirgstyp | null): S {
    if (typ === stand.typ) return stand;
    // Die Erosionsfestigkeit hängt am Gebirge, nicht am Typ: Sie bleibt beim Wechsel des Typs (WI-0249).
    const festigkeit =
        stand.modell?.erosionsfestigkeit === undefined ? {} : { erosionsfestigkeit: stand.modell.erosionsfestigkeit };
    const mitModell = stand.modell === undefined ? {} : { modell: { ...festigkeit } };
    if (typ === null) {
        const werte = Object.fromEntries(GEBIRGS_WERTE.map((wert) => [wert, geltenderWert(stand, presets, wert)]));
        const modell =
            stand.modell === undefined
                ? {}
                : {
                      modell: {
                          grat: geltenderModellwert(stand, presets, "grat"),
                          gratBreite: geltenderModellwert(stand, presets, "gratBreite"),
                          ...(stand.modell.talboden === undefined ? {} : { talboden: stand.modell.talboden }),
                          ...festigkeit,
                      },
                  };
        return { ...stand, typ: null, werte, muster: geltendesMuster(stand, presets), ...modell };
    }
    return { ...stand, typ, werte: {}, muster: null, ...mitModell };
}

/** Das Grundmuster wählen: Trifft es das des Presets, ist die Abweichung weg. */
export function mitMuster<S extends GebirgsStand>(stand: S, presets: GebirgsPresetGruppe, muster: GebirgsMuster): S {
    return { ...stand, muster: muster === presetMuster(stand, presets) && stand.typ !== null ? null : muster };
}

/** Wie viele Werte vom Preset abweichen (Kopf des Kastens „Werte“). */
export const abweichungen = (stand: GebirgsStand, presets: GebirgsPresetGruppe): number =>
    GEBIRGS_WERTE.filter((wert) => weichtAb(stand, presets, wert)).length;

/** Sind zwei Stände gleich (für „ungespeichert“ und den Konflikt)? Die Revision zählt nicht: Sie ist kein Wert. */
export function gleich(a: GebirgsEntwurf, b: GebirgsEntwurf): boolean {
    if (a.typ !== b.typ || a.muster !== b.muster || a.kammhoehe !== b.kammhoehe) return false;
    if (!GEBIRGS_WERTE.every((wert) => a.werte[wert] === b.werte[wert])) return false;
    if (!GEBIRGS_MODELL_WERTE.every((wert) => a.modell?.[wert] === b.modell?.[wert])) return false;
    if ((a.saat ?? null) !== (b.saat ?? null)) return false;
    return JSON.stringify(netzVon(a)) === JSON.stringify(netzVon(b));
}

/**
 * Was sich zwischen zwei Ständen ändert, als `GebirgsAenderung`; `undefined`, wenn nichts. Das Netz geht als Ganzes mit, sobald es
 * anders ist (ein Nebengipfel ohne eigene Höhe ohne `h`, nie `null`: ajv); geschrieben wird gegen die Revision des Starts.
 */
export function aenderungAus(start: GebirgsEntwurf, jetzt: GebirgsEntwurf): GebirgsAenderung | undefined {
    const aenderung: { -readonly [K in keyof GebirgsAenderung]: GebirgsAenderung[K] } = {};
    const zurueck: GebirgsZurueckAlle[] = [];
    if (jetzt.typ !== start.typ) {
        if (jetzt.typ === null) zurueck.push("typ");
        else aenderung.typ = jetzt.typ;
    }
    if (jetzt.muster !== start.muster) {
        if (jetzt.muster === null) zurueck.push("muster");
        else aenderung.muster = jetzt.muster;
    }
    if (jetzt.kammhoehe !== start.kammhoehe) {
        if (jetzt.kammhoehe === null) zurueck.push("kammhoehe");
        else aenderung.kammhoehe = jetzt.kammhoehe;
    }
    const werte: Partial<Record<GebirgsWert, number>> = {};
    for (const wert of GEBIRGS_WERTE) {
        const neu = jetzt.werte[wert];
        if (neu === start.werte[wert]) continue;
        if (neu === undefined) zurueck.push(wert);
        else werte[wert] = neu;
    }
    if (Object.keys(werte).length > 0) aenderung.werte = werte;
    const modell: Partial<Record<GebirgsModellWert, number>> = {};
    for (const wert of GEBIRGS_MODELL_WERTE) {
        const neu = jetzt.modell?.[wert];
        if (neu === start.modell?.[wert]) continue;
        if (neu === undefined) zurueck.push(wert);
        else modell[wert] = neu;
    }
    if (Object.keys(modell).length > 0) aenderung.modell = modell;
    // Die gewürfelte Saat (Migration 0214); `null` heißt „abgeleitet“ und geht über `zurueck`.
    if ((jetzt.saat ?? null) !== (start.saat ?? null)) {
        if (jetzt.saat === undefined || jetzt.saat === null) zurueck.push("saat");
        else aenderung.saat = jetzt.saat;
    }
    if (JSON.stringify(netzVon(jetzt)) !== JSON.stringify(netzVon(start)))
        aenderung.netz = netzZumSchreiben(netzVon(jetzt));
    if (zurueck.length > 0) aenderung.zurueck = zurueck;
    if (Object.keys(aenderung).length === 0) return undefined;
    return start.revision === undefined ? aenderung : { ...aenderung, baseRevision: start.revision };
}

/**
 * Das Netz, wie es geschrieben wird: `h` fehlt für „Vorgabe des Modells“; die Punkthöhen einer Linie (WI-0249 P9) gehen als Paare
 * `[Stelle, Höhe]` nur für Punkte mit eigener Höhe, nie als Liste mit `null` (ajv machte daraus still eine 0).
 */
export const netzZumSchreiben = (netz: Netz): GebirgsNetzAenderung => ({
    kaemme: netz.kaemme.map((kamm) => {
        const paare = (kamm.hoehen ?? []).flatMap((h, i): [number, number][] => (h === null ? [] : [[i, h]]));
        return paare.length === 0
            ? { punkte: kamm.punkte, rang: kamm.rang }
            : { punkte: kamm.punkte, rang: kamm.rang, hoehen: paare };
    }),
    nebengipfel: netz.nebengipfel.map(({ x, y, h }) => (h === null ? { x, y } : { x, y, h })),
    mulden: (netz.mulden ?? []).map(({ x, y, h }) => (h === null ? { x, y } : { x, y, h })),
    // Höhen an Flüssen und Seen (WI-0249, 0230): immer gesendet, auch leer (leer nimmt die gespeicherten weg).
    flussHoehen: (netz.flussHoehen ?? []).map(({ x, y, h }) => ({ x, y, h })),
    seeHoehen: (netz.seeHoehen ?? []).map(({ x, y, h }) => ({ x, y, h })),
});

/**
 * Der Stand nach einer Änderung im Reiter, mit den eigenen Punkthöhen des Netzes verhältnisgleich zur Kammhöhe (WI-0249 P9; Betreiber
 * 2026-10-24: Punkte mit eigener Höhe folgen einer späteren Änderung der Kammhöhe, „doch relativ dazu“): Ändert `neu` die Kammhöhe, die gilt,
 * gehen Kamm- und Talstützpunkte, Nebengipfel und Mulden mit eigener Höhe im Verhältnis neu/alt mit, im selben Schritt des Entwurfs; ↶ nimmt
 * beides zurück, „Fertig“ schreibt beides in EINER Operation. Punkte ohne eigene Höhe folgen über die Vorgabe.
 */
export function mitKammhoeheSkaliert<S extends GebirgsEntwurf>(
    vorher: GebirgsEntwurf,
    neu: S,
    grundhoehe: number | null,
): S {
    const alt = geltendeKammhoehe(vorher, grundhoehe);
    const jetzt = geltendeKammhoehe(neu, grundhoehe);
    if (alt === jetzt || neu.netz === undefined) return neu;
    const netz = netzSkaliert(neu.netz, jetzt / alt);
    return netz === neu.netz ? neu : { ...neu, netz };
}

/** Das Preset eines Werts des Rückennetzes: der Vorschlag des Typs (ohne Typ das Kettengebirge, wie die Rechnung). */
export const modellPreset = (stand: GebirgsStand, presets: GebirgsPresetGruppe, wert: GebirgsModellWert): number =>
    rueckennetzVorgabe(presets, stand.typ)[wert];

/** Der Wert des Rückennetzes, der gilt: der eigene, sonst das Preset. */
export const geltenderModellwert = (
    stand: GebirgsEntwurf,
    presets: GebirgsPresetGruppe,
    wert: GebirgsModellWert,
): number => stand.modell?.[wert] ?? modellPreset(stand, presets, wert);

/** Weicht ein Wert des Rückennetzes vom Preset ab? */
export function weichtModellAb(stand: GebirgsEntwurf, presets: GebirgsPresetGruppe, wert: GebirgsModellWert): boolean {
    const eigen = stand.modell?.[wert];
    return eigen !== undefined && !nah(eigen, modellPreset(stand, presets, wert));
}

/** Einen Wert des Rückennetzes setzen: in seine Grenzen gelegt; trifft er das Preset, ist die Abweichung weg. */
export function mitModellwert<S extends GebirgsEntwurf>(
    stand: S,
    presets: GebirgsPresetGruppe,
    wert: GebirgsModellWert,
    roh: number,
): S {
    const { min, max } = GEBIRGS_MODELL_GRENZEN[wert];
    if (!Number.isFinite(roh)) return stand;
    const neu = Math.min(max, Math.max(min, roh));
    const modell = { ...stand.modell, [wert]: neu };
    if (nah(neu, modellPreset(stand, presets, wert))) delete modell[wert];
    return { ...stand, modell };
}

/** ↺ an einem Wert des Rückennetzes: zurück auf das Preset (der Talboden: wieder abgeleitet). */
export function ohneModellwert<S extends GebirgsEntwurf>(stand: S, wert: GebirgsModellWert): S {
    const modell = { ...stand.modell };
    delete modell[wert];
    return { ...stand, modell };
}

/**
 * Das Preset, das den eigenen Werten eines Gebirges ohne Typ am nächsten liegt (Fassung 16: Marke „ähnlichstes“): Abstand je Wert in
 * Teilen seiner Spanne (`GEBIRGS_WERT_GRENZEN`), nur über die Werte, die das Gebirge selbst trägt. Mit Typ oder ohne eigenen Wert keins
 * (Fassung 16: „Zu wenige eigene Werte für einen Vorschlag“).
 */
export function aehnlichsterTyp(stand: GebirgsStand, presets: GebirgsPresetGruppe): Gebirgstyp | undefined {
    if (stand.typ !== null) return undefined;
    const eigene = GEBIRGS_WERTE.filter((wert) => stand.werte[wert] !== undefined);
    if (eigene.length === 0) return undefined;
    let bester: { typ: Gebirgstyp; abstand: number } | undefined;
    for (const typ of GEBIRGSTYPEN) {
        const abstand = eigene.reduce((summe, wert) => {
            const { min, max } = GEBIRGS_WERT_GRENZEN[wert];
            const teil = (stand.werte[wert]! - presets.typen[typ].werte[wert]) / (max - min || 1);
            return summe + teil * teil;
        }, 0);
        if (bester === undefined || abstand < bester.abstand) bester = { typ, abstand };
    }
    return bester?.typ;
}
