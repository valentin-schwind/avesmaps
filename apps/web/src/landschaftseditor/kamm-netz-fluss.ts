import {
    bogen,
    gleicheLage,
    pointInGeometry,
    seeSpiegel,
    type EditorGebirge,
    type V12Geometry,
    type WasserHoehe,
} from "@avesmaps3d/shared";
import type { Punkt } from "../map/geometrie/geometrie";
import type { Gewaesser } from "./kamm-netz-wasser";

/**
 * Der Fluss als Tal im Kammeditor und im Profil (WI-0259, OPS-071; Vali 2026-10-30: „flüsse sind automatische kammtäler …, deren verlauf im
 * kammeditor auch in der höhe verändert werden kann“; Probierseite abgenommen: „der kammeditor mit dem editierbaren flussprofil passt“): reine
 * Rechnung, die Karte und Profil teilen, damit „!“ und Gelb dasselbe sagen.
 *
 * - **Wirksame Höhe** je Stützpunkt, so wie das Gelände sie liest (`flussMarken`/`flussHoeheAn` in `rueckennetz/wasser.ts`, `eigeneZiele` in
 *   `treffen.ts`): eigene Höhen an den Stützpunkten, dazwischen linear nach Bogenlänge, davor und dahinter die Höhe des Geländes. Ein See mit
 *   eigener Höhe zählt (Vali 2026-10-30, „wie das profil MIT see aussieht“) wie ein Stück mit fester Höhe: Jeder Punkt des Flusses in ihm trägt
 *   den Spiegel, flach.
 * - **Steigen:** Ein Punkt steigt, wenn der Fluss in Fließrichtung vor ihm tiefer liegt (mehr als `STEIGT_AB` Schritt) und beide im Lauf der
 *   eigenen Höhen liegen (vom Punkt vor der ersten bis zum Punkt nach der letzten festen Höhe). Ohne feste Höhe steigt nichts: Das Gelände
 *   läuft nach der Regel „Flüsse fallen“ ohnehin bergab.
 * - **Fließrichtung:** die des Wegs (`dir`: `forward` = Zeichenrichtung, `reverse` dagegen); ohne Angabe vom höheren zum tieferen Ende des
 *   Geländes, wie die Wegfindung sie rät (`river-network.ts`, (b)); bei Gleichstand oder ohne Gelände die Zeichenrichtung.
 */

/** Bis zu diesem Unterschied (Schritt) zählt ein Stück noch als eben. */
export const STEIGT_AB = 0.5;

export interface FlussQuelle {
    readonly p: readonly (readonly [number, number])[];
    readonly dir?: "forward" | "reverse" | null | undefined;
}

/** Was um den Fluss herum zählt: die Höhen nach Lage, die Seen und die Fläche des Gebirges. */
export interface FlussUmfeld {
    readonly flussHoehen?: readonly WasserHoehe[] | undefined;
    readonly seeHoehen?: readonly WasserHoehe[] | undefined;
    readonly seen: readonly { readonly g?: V12Geometry | null | undefined }[];
    readonly flaeche?: V12Geometry | null | undefined;
}

export interface FlussPunktAnsicht {
    readonly at: Punkt;
    /** Bogenlänge ab dem ersten Stützpunkt (E). */
    readonly s: number;
    /** In der Fläche des Gebirges (nur dort lässt sich die Höhe setzen). */
    readonly drin: boolean;
    /** Der See (Index in `seen`), in dem der Punkt liegt, sonst −1. */
    readonly see: number;
    /** Die eigene Höhe des Stützpunkts; nie im See. */
    readonly eigen: number | null;
    /** Fest: die eigene Höhe, im See mit eigener Höhe der Spiegel. */
    readonly fest: number | null;
    /** Die Höhe des Geländes an diesem Punkt, wenn bekannt. */
    readonly gelaende: number | undefined;
    /** Die wirksame Höhe; `undefined`, wenn weder eine feste noch die des Geländes bekannt ist. */
    readonly hoehe: number | undefined;
    /** Der Fluss steigt in Fließrichtung vor diesem Punkt. */
    readonly steigt: boolean;
}

export interface FlussAnsicht {
    readonly punkte: readonly FlussPunktAnsicht[];
    /** Länge des ganzen Flusswegs (E). */
    readonly gesamt: number;
    /** Fließt der Fluss in Zeichenrichtung (vom ersten zum letzten Punkt)? */
    readonly vorwaerts: boolean;
    /** Der Lauf der eigenen Höhen: vom Punkt vor der ersten bis zum Punkt nach der letzten festen Höhe; −1 ohne feste Höhe. */
    readonly von: number;
    readonly bis: number;
    /** Die höchste und die tiefste wirksame Höhe; `undefined` ohne Höhe. */
    readonly hoechste: number | undefined;
    readonly tiefste: number | undefined;
    /** Die Seen (Index in `seen`), in die der Fluss steigt: ihr Spiegel liegt höher als der Fluss davor. */
    readonly seenSteigen: readonly number[];
    /** Hat der Fluss eine feste Höhe (eigene am Stützpunkt oder den Spiegel eines Sees mit eigener Höhe)? */
    readonly eigeneHoehen: boolean;
}

/**
 * Die Ansicht eines Flusses: wirksame Höhe und Steigen je Stützpunkt. `gelaende` liefert die Höhe des Geländes am Stützpunkt `i` (die
 * Vorschau der Karte oder das Höhenmodell im Profil), `undefined` ohne.
 */
export function flussAnsicht(
    fluss: FlussQuelle,
    umfeld: FlussUmfeld,
    gelaende: (i: number) => number | undefined,
): FlussAnsicht {
    const p = fluss.p;
    const n = p.length;
    const s = bogen(p);
    const spiegel = seeSpiegel(umfeld.seen, umfeld.seeHoehen);
    const see = p.map((q) => umfeld.seen.findIndex((e) => !!e.g && pointInGeometry([q[0], q[1]], e.g)));
    const fest: (number | null)[] = p.map((q, i) => {
        if (see[i]! >= 0) return spiegel[see[i]!] ?? null;
        return umfeld.flussHoehen?.find((w) => gleicheLage(w, q))?.h ?? null;
    });
    const eigen = p.map((q, i) =>
        see[i]! >= 0 ? null : (umfeld.flussHoehen?.find((w) => gleicheLage(w, q))?.h ?? null),
    );
    const g = p.map((_, i) => {
        const h = gelaende(i);
        return h === undefined || !Number.isFinite(h) ? undefined : h;
    });
    const gesetzt = fest.flatMap((h, i) => (h === null ? [] : [i]));
    const hoehe: (number | undefined)[] = g.slice();
    let von = -1;
    let bis = -1;
    if (gesetzt.length > 0) {
        const erste = gesetzt[0]!;
        const letzte = gesetzt[gesetzt.length - 1]!;
        let a = erste;
        for (let i = erste; i <= letzte; i++) {
            if (fest[i] !== null) {
                hoehe[i] = fest[i]!;
                a = i;
                continue;
            }
            let b = i + 1;
            while (fest[b] === null) b++;
            const spanne = s[b]! - s[a]!;
            hoehe[i] = spanne < 1e-12 ? fest[b]! : fest[a]! + ((fest[b]! - fest[a]!) * (s[i]! - s[a]!)) / spanne;
        }
        von = Math.max(0, erste - 1);
        bis = Math.min(n - 1, letzte + 1);
    }
    // Die Fließrichtung: aus den Daten, sonst vom höheren zum tieferen Ende des Geländes.
    let vorwaerts = true;
    if (fluss.dir === "reverse") vorwaerts = false;
    else if (fluss.dir !== "forward") {
        const ersteBekannt = g.find((h) => h !== undefined);
        const letzteBekannt = [...g].reverse().find((h) => h !== undefined);
        if (ersteBekannt !== undefined && letzteBekannt !== undefined) vorwaerts = ersteBekannt >= letzteBekannt;
    }
    const steigt = p.map((_, j) => {
        if (von < 0) return false;
        const davor = vorwaerts ? j - 1 : j + 1;
        if (davor < von || davor > bis || j < von || j > bis) return false;
        const hier = hoehe[j];
        const dort = hoehe[davor];
        return hier !== undefined && dort !== undefined && hier > dort + STEIGT_AB;
    });
    const seenSteigen = new Set<number>();
    steigt.forEach((st, j) => {
        if (!st || see[j]! < 0) return;
        const davor = vorwaerts ? j - 1 : j + 1;
        if (see[davor] !== see[j]) seenSteigen.add(see[j]!);
    });
    const bekannt = hoehe.filter((h): h is number => h !== undefined);
    const mitGelaende = [...bekannt, ...g.filter((h): h is number => h !== undefined)];
    return {
        punkte: p.map((q, i): FlussPunktAnsicht => ({
            at: { x: q[0], y: q[1] },
            s: s[i]!,
            drin: umfeld.flaeche ? pointInGeometry([q[0], q[1]], umfeld.flaeche) : true,
            see: see[i]!,
            eigen: eigen[i]!,
            fest: fest[i]!,
            gelaende: g[i],
            hoehe: hoehe[i],
            steigt: steigt[i]!,
        })),
        gesamt: s[n - 1] ?? 0,
        vorwaerts,
        von,
        bis,
        hoechste: mitGelaende.length > 0 ? Math.max(...mitGelaende) : undefined,
        tiefste: mitGelaende.length > 0 ? Math.min(...mitGelaende) : undefined,
        seenSteigen: [...seenSteigen],
        eigeneHoehen: gesetzt.length > 0,
    };
}

/** Quelle, Mündung und Gefälle aus den wirksamen Höhen: höchste und tiefste Stelle des Flusses. */
export function flussHoehenZahlen(a: FlussAnsicht): { quelle: number; muendung: number; gefaelle: number } | undefined {
    const h = a.punkte.flatMap((q) => (q.hoehe === undefined ? [] : [q.hoehe]));
    if (h.length < 2) return undefined;
    const quelle = Math.max(...h);
    const muendung = Math.min(...h);
    return { quelle, muendung, gefaelle: quelle - muendung };
}

/** Der Teil (Index in `gew.teile`) und der Index darin zu einem Punkt des Flusswegs `k` des Flusses `fluss`; `undefined`, wenn er in keinem liegt. */
export function teilImFluss(gew: Gewaesser, fluss: number, k: number): { teil: number; index: number } | undefined {
    for (let t = 0; t < gew.teile.length; t++) {
        const e = gew.teile[t]!;
        if (e.art !== "fluss" || e.herkunft !== fluss) continue;
        if (k >= e.ab && k < e.ab + e.punkte.length) return { teil: t, index: k - e.ab };
    }
    return undefined;
}

/** Der Teil (Index in `gew.teile`) eines Sees (Index in `eingabe.seen`). */
export function teilImSee(gew: Gewaesser, see: number): number | undefined {
    const t = gew.teile.findIndex((e) => e.art === "see" && e.herkunft === see);
    return t < 0 ? undefined : t;
}

/** Wie viele verschiedene Flüsse die Teile des Gewässers berühren. */
export const zahlDerFluesse = (gew: Gewaesser): number =>
    new Set(gew.teile.filter((t) => t.art === "fluss").map((t) => t.herkunft)).size;

/** Ist der Fluss `k`-ter Punkt ein Ende des Wegs, und welches? `quelle`/`muendung` nach der Fließrichtung. */
export function enddeutung(a: FlussAnsicht, k: number): "quelle" | "muendung" | undefined {
    const n = a.punkte.length;
    if (k === 0) return a.vorwaerts ? "quelle" : "muendung";
    if (k === n - 1) return a.vorwaerts ? "muendung" : "quelle";
    return undefined;
}

/** Was die Karte zeichnet, solange „Wählen“ läuft (WI-0259): alles reine Lagen, die Ebenen in `kamm-netz-lage.ts` malen sie. */
export interface FlussDaten {
    /** Jeder Stützpunkt der Flüsse in der Fläche: gefüllt mit eigener Höhe, sonst hohl. */
    readonly punkte: readonly { readonly at: Punkt; readonly eigen: boolean }[];
    /** Die Punkte, vor denen der Fluss in Fließrichtung steigt („!“); dazu der Platz eines Sees, in den er steigt. */
    readonly warnungen: readonly Punkt[];
    /** „Quelle“ und „Mündung“ an den Enden des Flusswegs, soweit sie in der Fläche liegen. */
    readonly enden: readonly { readonly at: Punkt; readonly text: string }[];
    /** Die Seen mit ihrem Griff ↕ (am Platz des Sees). */
    readonly seen: readonly { readonly at: Punkt; readonly gewaehlt: boolean }[];
}

export const KEIN_FLUSS: FlussDaten = { punkte: [], warnungen: [], enden: [], seen: [] };

type Eingabe = EditorGebirge["eingabe"];
type NetzMitWasser = {
    flussHoehen?: readonly WasserHoehe[] | undefined;
    seeHoehen?: readonly WasserHoehe[] | undefined;
};

/** Die Ansicht jedes Flusses, von dem die Fläche ein Stück hat (Index in `eingabe.fluesse`). */
export function flussAnsichten(
    eingabe: Eingabe,
    netz: NetzMitWasser,
    gew: Gewaesser,
    gelaende: (at: Punkt) => number | undefined,
): Map<number, FlussAnsicht> {
    const aus = new Map<number, FlussAnsicht>();
    const umfeld: FlussUmfeld = {
        flussHoehen: netz.flussHoehen,
        seeHoehen: netz.seeHoehen,
        seen: eingabe.seen ?? [],
        flaeche: eingabe.geometry,
    };
    for (const teil of gew.teile) {
        if (teil.art !== "fluss" || aus.has(teil.herkunft)) continue;
        const fluss = eingabe.fluesse?.[teil.herkunft];
        if (fluss === undefined) continue;
        aus.set(
            teil.herkunft,
            flussAnsicht(fluss, umfeld, (i) => {
                const q = fluss.p[i];
                return q === undefined ? undefined : gelaende({ x: q[0], y: q[1] });
            }),
        );
    }
    return aus;
}

/** Die Zeichnung der Flüsse und Seen auf der Karte aus den Ansichten; `gewaehlt` enthält `nr:index` der gewählten Punkte. */
export function flussZeichnung(
    ansichten: ReadonlyMap<number, FlussAnsicht>,
    gew: Gewaesser,
    basis: number,
    gewaehlt: ReadonlySet<string>,
    texte: { readonly quelle: string; readonly muendung: string },
): FlussDaten {
    const punkte: { at: Punkt; eigen: boolean }[] = [];
    const warnungen: Punkt[] = [];
    const enden: { at: Punkt; text: string }[] = [];
    const seen: { at: Punkt; gewaehlt: boolean }[] = [];
    const steigendeSeen = new Set([...ansichten.values()].flatMap((a) => a.seenSteigen));
    gew.teile.forEach((teil, t) => {
        if (teil.art === "see") {
            const at = teil.punkte[0];
            if (at === undefined) return;
            seen.push({ at, gewaehlt: gewaehlt.has(`${String(basis + t)}:0`) });
            if (steigendeSeen.has(teil.herkunft)) warnungen.push(at);
            return;
        }
        const a = ansichten.get(teil.herkunft);
        teil.punkte.forEach((at, index) => {
            const k = teil.ab + index;
            const q = a?.punkte[k];
            punkte.push({ at, eigen: q?.eigen != null });
            if (q?.steigt === true) warnungen.push(at);
            const ende = a === undefined ? undefined : enddeutung(a, k);
            if (ende !== undefined) enden.push({ at, text: texte[ende] });
        });
    });
    return { punkte, warnungen, enden, seen };
}

/** Die Namen der Flüsse, die vor einem sichtbaren Punkt oder in einen See steigen (für die Gestenzeile). */
export function steigendeFluesse(
    ansichten: ReadonlyMap<number, FlussAnsicht>,
    gew: Gewaesser,
    eingabe: Eingabe,
): string[] {
    const namen: string[] = [];
    for (const [nr, a] of ansichten) {
        const sichtbar = gew.teile.some(
            (t) =>
                t.art === "fluss" &&
                t.herkunft === nr &&
                t.punkte.some((_, index) => a.punkte[t.ab + index]?.steigt === true),
        );
        const name = eingabe.fluesse?.[nr]?.n;
        if ((sichtbar || a.seenSteigen.length > 0) && name !== undefined && !namen.includes(name)) namen.push(name);
    }
    return namen;
}
