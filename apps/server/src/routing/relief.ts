import type { TravelModel } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { werte } from "./einstellungen.ts";
import { continentalHeight, type ContinentalBase } from "../terrain/continental.ts";
import { coneHeightAt, DEFAULT_CONE, type ConeRule } from "../terrain/peak-cone.ts";
import type { OffroadBox } from "./offroad-grid.ts";
import { domainChordAbove } from "../terrain/domain/chord.ts";
import { domainHeightAt, domainMountainAt, type DomainHeightSource } from "../terrain/domain/read.ts";
import {
    familyStepFactor,
    HeightLine,
    SLOPE_FAMILIES,
    slopeFamily,
    starWalk,
    type SlopeFamily,
    type SlopeShape,
} from "./slope.ts";
import { mountainMembershipRows } from "./mountain-membership.ts";
import { loadDomainHeightSource } from "./terrain-load.ts";

/** Die Zelle eines Kartenpunkts in der Kiste, eingeklemmt wie `offroad-grid.indexOf`. */
function cellOf(box: OffroadBox, x: number, y: number): number {
    const column = Math.min(box.cols - 1, Math.max(0, Math.floor((x - box.minX) / box.cell)));
    const row = Math.min(box.rows - 1, Math.max(0, Math.floor((y - box.minY) / box.cell)));
    return row * box.cols + column;
}

/**
 * Das Gelände querfeldein (WI-0049 S5b, Gutachten MCS-026, Betreiber 2026-09-27: „alles ja“).
 *
 * - **In den Gebirgsflächen** gilt die GA (S. 123, „Gebirge ohne Klettern“ 0,2) als MITTEL: Faktor
 *   3,75 × P / μ_Gebirge. P ist der Leistungskilometer des Schritts, μ sein Mittel über alle Schritte im
 *   Gebirge. Ein Hang kostet mehr, ein Tal weniger; im Mittel bleibt es die GA - keine Doppelzählung.
 * - **An den freien Gipfeln** ebenso mit dem GA-Modifikator „einzelne Berge“ ×0,5: Faktor 2 × P / μ_Berg.
 * - Sonst gilt nichts davon. Unter „Kürzeste“ sucht die Suche ohne, wie Legacy.
 * - **Je Familie** (S5c): P ist der Schrittfaktor der Familie des Landmittels (`slope.ts`), μ ihr eigenes
 *   Mittel. So trifft jede Familie im Gebirge und an den Gipfeln für sich im Mittel die GA.
 * - **Sternregel** (GA S. 123, MCS-026 Punkt 6, E2): Querfeldein im Gebirge („Gebirge ohne Klettern“ mit
 *   Stern) steigt der Reiter ab, die Tiere werden geführt, und das Mittel geht mit Tempo und Steigung der
 *   Gruppe zu Fuß (`steigung.sternregel`, `starWalk`). Der Faktor trägt das Verhältnis der beiden Tempi.
 * - 🪤 **Ohne Kehrenregel taugte μ im Gebirge nur für FOOT.** Die Raster haben Klippen über 500 % (0,0004 %
 *   der Strecke); unter EQUID trugen sie 99,94 % des Mittels (μ ≈ 128.000). Mit Kehren (E1) ist es 1,53.
 *   Genutzt wird es trotzdem nicht: Jedes Tier-Mittel geht im Gebirge nach der Sternregel zu Fuß (Test in
 *   `slope-families.test.ts`).
 *
 * - **Offenes Land** (WI-0049 F5, Betreiber 2026-10-04: „A - schau ob du mit F4 kollidierst oder was von F4
 *   brauchen kannst“): Außerhalb der Gebirgsflächen kostet querfeldein jetzt ebenfalls die Steigung, aus den
 *   Höhen des Domain-Geländes. Faktor P / μ_offen mit der Familie des Landmittels (keine Sternregel: Sie gilt nur
 *   in den Gebirgsflächen) und μ_offen als Mittel von P über alle Schritte auf offenem Land (`calibrateOpen`),
 *   längengewichtet, beide Richtungen, einmal je Datenstand. Verknüpft wird wie im Gebirge: Der größere Faktor aus
 *   Wald, Sumpf, Bachbett und Gelände gewinnt. Wo kein Boden bremst, gilt P / μ_offen auch unter 1: Eine Ebene ist
 *   ein wenig schneller als das Mittel, ein Hang langsamer, und im Mittel bleibt das Tempo, wie auf der Straße, die
 *   an μ_Straße geeicht ist. Weil das einen Faktor unter 1 erlaubt, rechnet die Schätzung der Suche mit
 *   `ReliefPlane.floor` statt mit 1 und bleibt zulässig. Gebirge und freie Gipfel bleiben, wie sie sind.
 *
 * Die Gebirgsraster werden EINMAL je Datenstand geladen und von allen Anfragen geteilt (Claudio
 * 2026-09-27: 8,8 MB außerhalb des Heaps, Budget des ArrayBuffers 48/64 MB). Ohne Raster ist das Gelände
 * null, und querfeldein rechnet wie vor S5b.
 */

export const KIND_NONE = 0;
export const KIND_MOUNTAIN = 1;
export const KIND_PEAK = 2;
/**
 * Offenes Land (F5): Land mit Höhe außerhalb der Gebirgsflächen. Nur in der Ebene der Suche (`reliefPlane`); `reliefAt`
 * kennt die Art nicht, damit Flug, Schneegrenze und Profile bei „kein Gebirge“ bleiben, wie sie waren.
 */
export const KIND_OPEN = 3;

/** Wer gewinnt, wenn ein Schritt zwei Arten berührt: Gipfel vor Gebirge vor offenem Land vor nichts. */
const KIND_RANK = [0, 2, 3, 1] as const;

/** Die Art eines Schritts zwischen zwei Zellen. */
export function stepKind(a: number, b: number): number {
    return (KIND_RANK[a] ?? 0) >= (KIND_RANK[b] ?? 0) ? a : b;
}

/** Legacys Gitter (MCS-025): Zeile 0 im Süden, außerhalb der Fläche 0. */
interface HeightRaster {
    membership?: Uint8Array;
    /**
     * Die Zugehörigkeit zeilenweise: die Zeilen `from` bis `to` (ohne `to`), `width` Werte je Zeile. Die Eichung liest
     * sie streifenweise (`MEMBERSHIP_STRIPE_ROWS`) und braucht so nie das ganze Raster der Zugehörigkeit auf einmal
     * (WI-0071). Gilt, wo `membership` fehlt.
     */
    membershipRows?: (from: number, to: number) => Uint8Array;
    cell: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
    samples: Uint16Array;
    maxX: number;
    maxY: number;
}

interface Cone {
    x: number;
    y: number;
    h: number | null;
    radius: number;
}

/** Die Eichung einer Familie: ihr mittlerer Schrittfaktor im Gebirge und an den Gipfeln. */
export interface ReliefMu {
    mountain: number;
    peak: number;
}

export interface TerrainHeights {
    domain?: DomainHeightSource;
    continental?: ContinentalBase | undefined;
    rasters: readonly HeightRaster[];
    cones: readonly Cone[];
    rule: ConeRule;
    /** Die Eichung je Familie. */
    mu: Record<SlopeFamily, ReliefMu>;
    /**
     * Die Eichung des offenen Landes je Familie (F5, `calibrateOpen`): das Mittel von P über die Schritte außerhalb
     * der Gebirge. Fehlt ohne Domain-Raster; dann hat offenes Land keine Steigung, wie vor F5.
     */
    muOpen?: Record<SlopeFamily, number>;
}

/** Was der Gang querfeldein zum Gelände braucht: die Höhen und wer geht (S5c). */
export interface ReliefWorld {
    terrain: TerrainHeights;
    model: TravelModel;
    /** Das Landmittel; seine Familie und die Sternregel bestimmen die Steigung. */
    transport: string;
}

/** Die Wegart des Gangs querfeldein im Reisemodell. */
const OFFROAD_TYPE = "Querfeldein";

function bilinear(r: HeightRaster, x: number, y: number): number {
    const fx = (x - r.originX) / r.cell;
    const fy = (y - r.originY) / r.cell;
    const i = Math.min(Math.max(0, Math.floor(fx)), Math.max(0, r.width - 2));
    const j = Math.min(Math.max(0, Math.floor(fy)), Math.max(0, r.height - 2));
    const tx = Math.min(1, Math.max(0, fx - i));
    const ty = Math.min(1, Math.max(0, fy - j));
    const right = Math.min(i + 1, r.width - 1);
    const up = Math.min(j + 1, r.height - 1);
    const s = r.samples;
    const a = s[j * r.width + i] ?? 0;
    const b = s[j * r.width + right] ?? 0;
    const c = s[up * r.width + i] ?? 0;
    const d = s[up * r.width + right] ?? 0;
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** Höhe und Art an einem Punkt: Gebirge, wo ein Raster Höhe trägt, sonst Gipfel im Kegel, sonst nichts. */
export function reliefAt(
    t: Pick<TerrainHeights, "rasters" | "cones" | "rule" | "continental" | "domain">,
    x: number,
    y: number,
): { height: number; kind: number } {
    if (t.domain)
        return {
            height: domainHeightAt(t.domain, x, y),
            kind: domainMountainAt(t.domain, x, y) ? KIND_MOUNTAIN : KIND_NONE,
        };
    let height = continentalHeight(t.continental, x, y);
    let kind = KIND_NONE;
    for (const r of t.rasters) {
        if (x < r.originX || y < r.originY || x > r.maxX || y > r.maxY) continue;
        const value = bilinear(r, x, y);
        if (value > 0) {
            kind = KIND_MOUNTAIN;
            if (value > height) height = value;
        }
    }
    for (const cone of t.cones) {
        if (Math.abs(x - cone.x) >= cone.radius || Math.abs(y - cone.y) >= cone.radius) continue;
        if (Math.hypot(x - cone.x, y - cone.y) >= cone.radius) continue;
        const value = coneHeightAt(cone, x, y, t.rule);
        if (value > height) height = value;
    }
    return { height, kind };
}

/** Das Gelände einer Kiste: Höhe und Art je Zellmitte, mit allem, was ein Schritt zum Rechnen braucht. */
export interface ReliefPlane {
    height: Float32Array;
    kind: Uint8Array;
    /**
     * Zeitfaktor eines Schritts von Höhe a nach Höhe b über `runUnits`, in der Art `kind`; 0, wo die Art keinen
     * Faktor hat. Im Gebirge und an Gipfeln nie unter 1; auf offenem Land P / μ_offen, also unter 1, wo der Schritt
     * weniger bremst als der Mittelwert (F5).
     */
    step(kind: number, from: number, to: number, runUnits: number): number;
    /**
     * Der kleinste Faktor, den `step` liefern kann, höchstens 1 (auf offenem Land 1 / μ_offen, weil P nie unter 1
     * liegt). Die Schätzung der Suche rechnet mit ihm statt mit 1 und bleibt so zulässig.
     */
    floor: number;
}

/** Der Leistungskilometer eines Schritts: nur bergauf und steil bergab kosten, nie unter 1. */
export function stepFootFactor(rise: number, runUnits: number, model: TravelModel): number {
    const miles = runUnits * model.meilenJeKarteneinheit.wert;
    if (!(miles > 0)) return 1;
    const rule = model.steigung.wert;
    const schritt = miles * 1000;
    let extra = 0;
    if (rise > 0) extra = rise / rule.anstiegSchrittJeMeile;
    else if (rise < 0 && -rise / schritt > rule.steilAb) extra = -rise / rule.steilerAbstiegSchrittJeMeile;
    return 1 + extra / miles;
}

/** Der Faktor eines Schritts in der Familie; FOOT genau wie `stepFootFactor`. */
export function reliefStepFactor(family: SlopeFamily, rise: number, runUnits: number, model: TravelModel): number {
    if (family === "FOOT") return stepFootFactor(rise, runUnits, model);
    const schritt = runUnits * model.meilenJeKarteneinheit.wert * 1000;
    return schritt > 0 ? familyStepFactor(family, rise / schritt, model) : 1;
}

/** Wie ein Landmittel eine Art querfeldein rechnet: mit welcher Familie und welchem festen Faktor. */
export interface ReliefRule {
    family: SlopeFamily;
    /** GA-Faktor der Art durch μ der Familie, im Gebirge unter der Sternregel mal dem Verhältnis der Tempi. */
    scale: number;
}

/**
 * Die Regeln des Landmittels im Gebirge und an den Gipfeln. Im Gebirge greift die Sternregel: Wer dort
 * absteigt, rechnet mit Familie und Tempo seines Fußmittels. Der Gang läuft im Tempo des Mittels, also
 * trägt der Faktor das Verhältnis beider Tempi querfeldein.
 */
export function reliefRules(
    t: TerrainHeights,
    model: TravelModel,
    transport: string,
): { mountain: ReliefRule; peak: ReliefRule; open: ReliefRule | null } {
    const rule = model.steigung.wert;
    const family = slopeFamily(model, transport);
    const star = starWalk(model, transport, OFFROAD_TYPE) ?? { family, ratio: 1 };
    return {
        mountain: { family: star.family, scale: (star.ratio * rule.querfeldeinGebirge) / t.mu[star.family].mountain },
        peak: { family, scale: rule.querfeldeinEinzelnerBerg / t.mu[family].peak },
        // Offenes Land (F5): die Familie des Landmittels selbst - die Sternregel gilt nur in den Gebirgsflächen -, und
        // die GA gibt dort keinen Faktor vor (Ebene ×1): Der Faktor ist P / μ_offen, im Mittel genau 1.
        open: t.muOpen ? { family, scale: 1 / t.muOpen[family] } : null,
    };
}

export function reliefPlane(
    box: OffroadBox,
    t: TerrainHeights,
    model: TravelModel,
    transport: string,
): ReliefPlane | null {
    const rasters = t.rasters.filter(
        (r) => r.originX <= box.maxX && r.maxX >= box.minX && r.originY <= box.maxY && r.maxY >= box.minY,
    );
    const cones = t.cones.filter(
        (c) =>
            c.x + c.radius >= box.minX &&
            c.x - c.radius <= box.maxX &&
            c.y + c.radius >= box.minY &&
            c.y - c.radius <= box.maxY,
    );
    if (!t.domain && rasters.length === 0 && cones.length === 0) return null;
    const local: TerrainHeights = { ...t, rasters, cones };
    const height = new Float32Array(box.cellCount);
    const kind = new Uint8Array(box.cellCount);
    const { mountain, peak, open } = reliefRules(t, model, transport);
    // Offenes Land gibt es nur im Domain-Gelände und mit seiner Eichung; Meer und Küste auf Höhe 0 bleiben ohne Art.
    const openLand = t.domain !== undefined && open !== null;
    let any = false;
    for (let row = 0; row < box.rows; row += 1) {
        const y = box.minY + (row + 0.5) * box.cell;
        for (let column = 0; column < box.cols; column += 1) {
            const here = reliefAt(local, box.minX + (column + 0.5) * box.cell, y);
            const index = row * box.cols + column;
            height[index] = here.height;
            if (here.kind === KIND_NONE) {
                if (!openLand || !(here.height > 0)) continue;
                kind[index] = KIND_OPEN;
            } else {
                kind[index] = here.kind;
            }
            any = true;
        }
    }
    if (!any) return null;
    return {
        height,
        kind,
        step: (k, from, to, runUnits) => {
            const art = k === KIND_MOUNTAIN ? mountain : k === KIND_PEAK ? peak : k === KIND_OPEN ? open : null;
            return art ? art.scale * reliefStepFactor(art.family, to - from, runUnits, model) : 0;
        },
        floor: openLand && open !== null ? Math.min(1, open.scale) : 1,
    };
}

/** Höchstens so weit auseinander liegen zwei Höhen einer Linie querfeldein: 0,25 E, wie die Wegprofile. */
const LINE_STEP = 0.25;

/**
 * Die Höhen einer Linie querfeldein in ihrer Richtung (WI-0049 S5d): je Stück höchstens alle 0,25 E
 * abgetastet, wie die Wegprofile, mit denselben Höhen wie die Suche (Gebirgsraster und Gipfelkegel). Ein
 * Schritt zählt, wenn beide Enden Höhe tragen; der steilste Abschnitt gilt über `window` Schritt. Null, wo
 * die Linie kein Gelände berührt.
 */
export function lineShape(
    t: TerrainHeights,
    coordinates: readonly [number, number][],
    window = 750,
    collect?: (positionSchritt: number, height: number | null) => void,
): SlopeShape | null {
    // 🪤 EINMAL je Linie gelesen, nicht je Schritt (WI-0153).
    const schritt = werte().schrittPerUnit;
    const shape: SlopeShape = { ascent: 0, descent: 0, highest: -Infinity, steepest: 0 };
    const line = new HeightLine(window);
    let begin = 0;
    let any = false;
    for (let index = 1; index < coordinates.length; index += 1) {
        const [x0, y0] = coordinates[index - 1] as [number, number];
        const [x1, y1] = coordinates[index] as [number, number];
        const length = Math.hypot(x1 - x0, y1 - y0);
        const near = {
            ...t,
            rasters: t.rasters.filter(
                (r) =>
                    r.originX <= Math.max(x0, x1) &&
                    r.maxX >= Math.min(x0, x1) &&
                    r.originY <= Math.max(y0, y1) &&
                    r.maxY >= Math.min(y0, y1),
            ),
        };
        const steps = Math.max(1, Math.ceil(length / LINE_STEP));
        const run = (length / steps) * schritt;
        let previous: number | null = null;
        for (let step = 0; step <= steps; step += 1) {
            const f = step / steps;
            const here = reliefAt(near, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
            const height =
                here.kind === KIND_NONE && !t.continental && !t.domain && here.height === 0 ? null : here.height;
            line.add(begin + step * run, height);
            collect?.(begin + step * run, height);
            if (height !== null) {
                shape.highest = Math.max(shape.highest, height);
                if (previous !== null && step > 0) {
                    any = true;
                    const rise = height - previous;
                    if (rise > 0) shape.ascent += rise;
                    else shape.descent -= rise;
                }
            }
            previous = height;
        }
        begin += length * schritt;
    }
    line.close();
    shape.steepest = line.steepest;
    return any ? shape : null;
}

/**
 * Das Gelände einer Ebene, als wäre jeder Schritt eben (P = 1): dieselbe Art, derselbe Faktor der GA durch
 * μ, dieselbe Sternregel, nur ohne Steigung. Die Bezugszeit der Mehrzeit querfeldein (S5d).
 */
export function levelPlane(relief: ReliefPlane): ReliefPlane {
    return { ...relief, step: (kind, _from, _to, runUnits) => relief.step(kind, 0, 0, runUnits) };
}

/** Berührt die gerade Sehne Gebirge oder einen Gipfelkegel? In Vierteln von 0,25 E abgetastet. */
export function chordTouchesRelief(
    t: TerrainHeights,
    from: { x: number; y: number },
    to: { x: number; y: number },
): boolean {
    // Mit der Eichung des offenen Landes (F5) zählt auch Land mit Höhe außerhalb der Gebirge: Auch dort sucht der Gang,
    // ob ein Hang zu umgehen ist. Nur eine Sehne ganz auf Höhe 0 (Meer, Küste) bleibt eine Gerade.
    const open = t.domain !== undefined && t.muOpen !== undefined;
    return chordFinds(t, from, to, (here) => here.kind !== KIND_NONE || (open && here.height > 0));
}

/**
 * Läuft die gerade Sehne durch eine Gebirgsfläche (`KIND_MOUNTAIN`; ein freier Gipfel zählt nicht)? Die Stücke an den
 * Enden, `tolerance` lang, zählen nicht (WI-0258: die Sperre der Wagen, `vehicle-barrier.ts`). In Vierteln von 0,25 E
 * abgetastet wie `chordTouchesRelief`.
 */
export function chordCrossesMountain(
    t: TerrainHeights,
    from: { x: number; y: number },
    to: { x: number; y: number },
    tolerance: number,
): boolean {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length <= 2 * tolerance) return false;
    const inset = tolerance / length;
    const a = { x: from.x + (to.x - from.x) * inset, y: from.y + (to.y - from.y) * inset };
    const b = { x: to.x - (to.x - from.x) * inset, y: to.y - (to.y - from.y) * inset };
    return chordFinds(t, a, b, (here) => here.kind === KIND_MOUNTAIN);
}

/**
 * Überquert die gerade Sehne Gelände, das höher liegt als `limit` Schritt? Im Domain-DEM exakt je
 * bilinearer Zelle, sonst abgetastet wie `chordTouchesRelief`. Meereshöhe sperrt auch bei einer
 * Grenze unter null nicht. Der Flug fragt so, ob er die Luftlinie nehmen kann (WI-0051, F2).
 */
export function chordAbove(
    t: TerrainHeights,
    from: { x: number; y: number },
    to: { x: number; y: number },
    limit: number,
): boolean {
    if (t.domain) return domainChordAbove(t.domain, from, to, limit);
    return chordFinds(t, from, to, (here) => here.height > Math.max(0, limit));
}

/** Trifft die Sehne, in Vierteln von 0,25 E abgetastet, eine Stelle, auf die `hit` zutrifft? */
function chordFinds(
    t: TerrainHeights,
    from: { x: number; y: number },
    to: { x: number; y: number },
    hit: (here: { height: number; kind: number }) => boolean,
): boolean {
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    const near: TerrainHeights = {
        ...t,
        rasters: t.rasters.filter((r) => r.originX <= maxX && r.maxX >= minX && r.originY <= maxY && r.maxY >= minY),
        cones: t.cones.filter(
            (c) => c.x + c.radius >= minX && c.x - c.radius <= maxX && c.y + c.radius >= minY && c.y - c.radius <= maxY,
        ),
    };
    if (!near.domain && near.rasters.length === 0 && near.cones.length === 0 && !near.continental) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.0625));
    for (let step = 0; step <= steps; step += 1) {
        const f = step / steps;
        if (hit(reliefAt(near, from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f))) return true;
    }
    return false;
}

/**
 * Der Faktor eines Schritts nach der Boden-Regel (WI-0049 S5b): der größere aus Boden `ground` (nie unter 1, 1 ohne
 * bremsenden Boden) und Gelände gewinnt. Nur auf offenem Land (F5) ersetzt der Faktor des Geländes einen offenen Boden
 * auch dann, wenn er unter 1 liegt: Eine Ebene bremst weniger als der Mittelwert, den μ_offen trägt. Gebirge und Gipfel
 * wirken nur, wo sie bremsen, wie vor F5.
 */
export function groundWithRelief(ground: number, kind: number, slope: number): number {
    return slope > ground || (kind === KIND_OPEN && ground <= 1 && slope > 0) ? slope : ground;
}

/** Der Faktor eines Stücks von a nach b nach der Boden-Regel, gelesen an den Zellen der Kiste; `ground` ohne Gelände. */
export function reliefGroundBetween(
    box: OffroadBox,
    relief: ReliefPlane,
    ground: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): number {
    const a = cellOf(box, ax, ay);
    const b = cellOf(box, bx, by);
    const kind = stepKind(relief.kind[a] ?? 0, relief.kind[b] ?? 0);
    if (kind === KIND_NONE) return ground;
    return groundWithRelief(
        ground,
        kind,
        relief.step(kind, relief.height[a] ?? 0, relief.height[b] ?? 0, Math.hypot(bx - ax, by - ay)),
    );
}

/** So viele Rasterzeilen liest die Eichung auf einmal, wenn die Zugehörigkeit zeilenweise kommt (128 mal 4096 Byte). */
const MEMBERSHIP_STRIPE_ROWS = 128;

/** Zellen mit Höhe als Zugehörigkeit, für Raster ohne eigene (die Gebirgsraster aus Legacys Gitter). */
function heightMembers(samples: Uint16Array, first: number, last: number, width: number): Uint8Array {
    const members = new Uint8Array((last - first) * width);
    const offset = first * width;
    for (let index = 0; index < members.length; index += 1) {
        if (samples[offset + index] !== 0) members[index] = 1;
    }
    return members;
}

/**
 * Wie oft jeder Höhenunterschied zwischen zwei Nachbarzellen mit Höhe vorkommt, je Schrittlänge (gerade
 * und schräg). 💣 Über 4 Mio. Zellen: jedes Nachbarpaar einmal und ohne Aufruf im Inneren, sonst kostet
 * das Laden 500 ms. Die Höhen sind ganze Schritt, also reicht je Länge eine Zählung.
 *
 * Eine Zelle gehört dazu, wenn die Zugehörigkeit sie nennt, und ohne Zugehörigkeit, wenn ihre Höhe nicht 0 ist. Ein Lauf
 * über alle Zellen sucht die der Zugehörigkeit und zählt von dort die vier Nachbarn nach Osten, Norden, Nordosten und
 * Südosten (die anderen vier sind dieselben Paare von der anderen Seite); die meisten Zellen liegen außerhalb und kosten
 * eine Abfrage statt vier (WI-0071, Nachtrag: am 8k-Raster 1,2 bis 1,6 s vorher). Die Zählung ist ganzzahlig und
 * ordnungsunabhängig, die Längen stehen in derselben Reihenfolge in der Tafel wie vorher (sie bestimmt die Reihenfolge
 * der Summen in `calibrateRelief`).
 */
export function riseHistogram(rasters: readonly HeightRaster[]): Map<number, Uint32Array> {
    const histogram = new Map<number, Uint32Array>();
    for (const r of rasters) {
        const s = r.samples;
        // Die Zählung je Länge liegt vor den Schleifen: Osten und Norden teilen sich eine, die zwei Schrägen die andere.
        const countsOf = (di: number, dj: number): Uint32Array => {
            const run = r.cell * Math.hypot(di, dj);
            let counts = histogram.get(run);
            if (!counts) {
                counts = new Uint32Array(65536);
                histogram.set(run, counts);
            }
            return counts;
        };
        const east = countsOf(1, 0);
        const north = countsOf(0, 1);
        const northEast = countsOf(1, 1);
        const southEast = countsOf(1, -1);
        const { width, height } = r;
        // Mit zeilenweiser Zugehörigkeit in Streifen: Das Fenster reicht eine Zeile über den Streifen hinaus (die
        // Nachbarn der Randzeilen). Ein ganzes Raster der Zugehörigkeit gilt für alle Zeilen auf einmal.
        const whole = r.membershipRows === undefined && r.membership !== undefined;
        const stripe = whole ? height : MEMBERSHIP_STRIPE_ROWS;
        for (let top = 0; top < height; top += stripe) {
            const bottom = Math.min(height, top + stripe);
            const first = Math.max(0, top - 1);
            const last = Math.min(height, bottom + 1);
            const members = r.membershipRows?.(first, last) ?? r.membership ?? heightMembers(s, first, last, width);
            const base = whole ? 0 : first * width;
            for (let j = top; j < bottom; j += 1) {
                const rowStart = j * width;
                const memberRow = rowStart - base;
                const hasNorth = j + 1 < height;
                const hasSouth = j >= 1;
                for (let i = 0; i < width; i += 1) {
                    const at = memberRow + i;
                    if (members[at] !== 1) continue;
                    const index = rowStart + i;
                    const here = s[index] as number;
                    const right = i + 1 < width;
                    if (right) {
                        if (members[at + 1] === 1) {
                            const there = s[index + 1] as number;
                            const rise = there > here ? there - here : here - there;
                            east[rise] = (east[rise] as number) + 1;
                        }
                        if (hasNorth && members[at + width + 1] === 1) {
                            const there = s[index + width + 1] as number;
                            const rise = there > here ? there - here : here - there;
                            northEast[rise] = (northEast[rise] as number) + 1;
                        }
                        if (hasSouth && members[at - width + 1] === 1) {
                            const there = s[index - width + 1] as number;
                            const rise = there > here ? there - here : here - there;
                            southEast[rise] = (southEast[rise] as number) + 1;
                        }
                    }
                    if (hasNorth && members[at + width] === 1) {
                        const there = s[index + width] as number;
                        const rise = there > here ? there - here : here - there;
                        north[rise] = (north[rise] as number) + 1;
                    }
                }
            }
        }
    }
    return histogram;
}

/**
 * Das Mittel von P je Familie über ein Histogramm der Höhenunterschiede (je Schrittlänge): hin und zurück über
 * dieselbe Kante, also bergauf und bergab zugleich, nach Schrittlänge gewogen. 1 ohne einen Schritt.
 */
function histogramMean(histogram: ReadonlyMap<number, Uint32Array>, family: SlopeFamily, model: TravelModel): number {
    let weight = 0;
    let sum = 0;
    for (const [run, counts] of histogram) {
        for (let rise = 0; rise < counts.length; rise += 1) {
            const count = counts[rise] as number;
            if (count === 0) continue;
            weight += count * 2 * run;
            sum +=
                count *
                run *
                (reliefStepFactor(family, rise, run, model) + reliefStepFactor(family, -rise, run, model));
        }
    }
    return weight > 0 ? sum / weight : 1;
}

/**
 * Wie oft jeder Höhenunterschied zwischen zwei Nachbarzellen auf OFFENEM Land vorkommt (F5): beide Zellen mit Höhe
 * (Land, Meer und Küste auf 0 zählen nicht) und keine in einer Gebirgsfläche. Gezählt wird auf dem Schritt der Suche
 * (`LINE_STEP`, 0,25 E: am 8k-Raster jede zweite Zelle), denn P hängt an der Steigung des Schritts, und die Raster
 * sind feiner gekörnt als der Schritt, den die Suche und die Abtastung der Linien gehen (gemessen am Stand
 * `7a7dbe454996`: FOOT 1,086 auf Rasterzellen, 1,077 auf 0,25 E, 1,065 auf 0,5 E). Je Zelle die vier Nachbarn nach
 * Osten, Norden, Nordosten und Südosten, die anderen vier sind dieselben Paare von der anderen Seite. Streifenweise
 * wie `riseHistogram`: Das Fenster der Zugehörigkeit reicht einen Schritt über den Streifen hinaus.
 */
export function openRiseHistogram(rasters: readonly HeightRaster[]): Map<number, Uint32Array> {
    const histogram = new Map<number, Uint32Array>();
    for (const r of rasters) {
        const s = r.samples;
        const { width, height } = r;
        const step = Math.max(1, Math.round(LINE_STEP / r.cell));
        const straight = new Uint32Array(65536);
        const diagonal = new Uint32Array(65536);
        const run = r.cell * step;
        const whole = r.membershipRows === undefined && r.membership !== undefined;
        const stripe = whole ? height : MEMBERSHIP_STRIPE_ROWS;
        for (let top = 0; top < height; top += stripe) {
            const bottom = Math.min(height, top + stripe);
            const first = Math.max(0, top - step);
            const last = Math.min(height, bottom + step);
            const members = r.membershipRows?.(first, last) ?? r.membership ?? heightMembers(s, first, last, width);
            const base = whole ? 0 : first * width;
            const rowStep = step * width;
            for (let j = Math.ceil(top / step) * step; j < bottom; j += step) {
                const rowStart = j * width;
                const memberRow = rowStart - base;
                const hasNorth = j + step < height;
                const hasSouth = j - step >= 0;
                for (let i = 0; i < width; i += step) {
                    const at = memberRow + i;
                    if (members[at] === 1) continue;
                    const index = rowStart + i;
                    const here = s[index] as number;
                    if (here === 0) continue;
                    const right = i + step < width;
                    if (right) {
                        const there = s[index + step] as number;
                        if (there !== 0 && members[at + step] !== 1) {
                            const rise = there > here ? there - here : here - there;
                            straight[rise] = (straight[rise] as number) + 1;
                        }
                        if (hasNorth) {
                            const north = s[index + rowStep + step] as number;
                            if (north !== 0 && members[at + rowStep + step] !== 1) {
                                const rise = north > here ? north - here : here - north;
                                diagonal[rise] = (diagonal[rise] as number) + 1;
                            }
                        }
                        if (hasSouth) {
                            const south = s[index - rowStep + step] as number;
                            if (south !== 0 && members[at - rowStep + step] !== 1) {
                                const rise = south > here ? south - here : here - south;
                                diagonal[rise] = (diagonal[rise] as number) + 1;
                            }
                        }
                    }
                    if (hasNorth) {
                        const there = s[index + rowStep] as number;
                        if (there !== 0 && members[at + rowStep] !== 1) {
                            const rise = there > here ? there - here : here - there;
                            straight[rise] = (straight[rise] as number) + 1;
                        }
                    }
                }
            }
        }
        addCounts(histogram, run, straight);
        addCounts(histogram, run * Math.SQRT2, diagonal);
    }
    return histogram;
}

/** Zählt `counts` zur Zeile `run` des Histogramms. */
function addCounts(histogram: Map<number, Uint32Array>, run: number, counts: Uint32Array): void {
    const known = histogram.get(run);
    if (!known) {
        histogram.set(run, counts);
        return;
    }
    for (let rise = 0; rise < counts.length; rise += 1)
        known[rise] = (known[rise] as number) + (counts[rise] as number);
}

/**
 * Die Eichung des offenen Landes je Familie (F5): der Schrittfaktor P, gemittelt über alle Schritte außerhalb der
 * Gebirge (`openRiseHistogram`), hin und zurück, nach Schrittlänge gewogen - das μ_offen von P / μ_offen. Im Mittel
 * über diese Schritte ist der Faktor genau 1: Das mittlere Tempo im offenen Gelände bleibt, Hänge bremsen, eine
 * Ebene bremst weniger als der Mittelwert. 1 ohne einen Schritt (Raster ohne Land).
 */
export function calibrateOpen(rasters: readonly HeightRaster[], model: TravelModel): Record<SlopeFamily, number> {
    const histogram = openRiseHistogram(rasters);
    const result = {} as Record<SlopeFamily, number>;
    for (const family of SLOPE_FAMILIES) result[family] = histogramMean(histogram, family, model);
    return result;
}

/**
 * Die Eichung je Familie: der Schrittfaktor, gemittelt über alle acht Richtungen jeder Zelle mit Höhe,
 * nach Schrittlänge gewogen - im Gebirge auf den Rastern selbst, an den Gipfeln auf einem Gitter von
 * 0,25 E um jeden Kegel.
 */
export function calibrateRelief(
    rasters: readonly HeightRaster[],
    cones: readonly Cone[],
    rule: ConeRule,
    model: TravelModel,
): Record<SlopeFamily, ReliefMu> {
    const histogram = riseHistogram(rasters);
    const mountain = SLOPE_FAMILIES.map((family) => histogramMean(histogram, family, model));
    const directions: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
    ];
    let weight = 0;
    const peak = SLOPE_FAMILIES.map(() => 0);
    const cell = 0.25;
    const only = { rasters: [], cones, rule };
    for (const cone of cones) {
        const steps = Math.ceil(cone.radius / cell);
        for (let j = -steps; j <= steps; j += 1) {
            for (let i = -steps; i <= steps; i += 1) {
                const x = cone.x + i * cell;
                const y = cone.y + j * cell;
                if (Math.hypot(x - cone.x, y - cone.y) >= cone.radius) continue;
                const here = reliefAt(only, x, y).height;
                for (const [di, dj] of directions) {
                    const there = reliefAt(only, x + di * cell, y + dj * cell);
                    if (there.kind === KIND_NONE) continue;
                    const run = cell * Math.hypot(di, dj);
                    weight += run;
                    SLOPE_FAMILIES.forEach((family, f) => {
                        peak[f] = (peak[f] as number) + run * reliefStepFactor(family, there.height - here, run, model);
                    });
                }
            }
        }
    }
    const result = {} as Record<SlopeFamily, ReliefMu>;
    SLOPE_FAMILIES.forEach((family, f) => {
        result[family] = { mountain: mountain[f] as number, peak: weight > 0 ? (peak[f] as number) / weight : 1 };
    });
    return result;
}

/**
 * Das Gelände aus einem Domain-Raster samt Gebirgsflächen: die Eichung des Gebirges und der Gipfel (`calibrateRelief`)
 * und die des offenen Landes (`calibrateOpen`, F5), beide aus demselben Raster. So baut es der Dienst beim Laden, und
 * so bauen es die Tests.
 */
export function terrainFromDomain(
    domain: DomainHeightSource,
    model: TravelModel,
    rule: ConeRule = DEFAULT_CONE,
): TerrainHeights {
    const r = domain.raster;
    const mountainRasters: HeightRaster[] = [
        {
            ...r,
            membershipRows: (from, to) => mountainMembershipRows(domain, from, to),
            maxX: r.originX + (r.width - 1) * r.cell,
            maxY: r.originY + (r.height - 1) * r.cell,
        },
    ];
    return {
        domain,
        rasters: [],
        cones: [],
        rule,
        mu: calibrateRelief(mountainRasters, [], rule, model),
        muOpen: calibrateOpen(mountainRasters, model),
    };
}

/**
 * Lädt das Domain-Raster und die Gebirgsflächen. Null ohne Raster (vor `derive:terrain`): Dann bleibt
 * querfeldein, wie es vor S5b war.
 *
 * `previous` ist das Gelände des geltenden Stands, gerechnet mit DEMSELBEN Reisemodell (WI-0071): Das Raster wird
 * nicht noch einmal gelesen, solange es dasselbe ist, und sind auch die Gebirgsflächen dieselben, ist das Ergebnis
 * `previous` selbst - ohne Zugehörigkeitsraster und ohne Eichung neu zu rechnen.
 */
export async function loadTerrainHeights(
    database: Queryable,
    mapDomainId: string,
    model: TravelModel,
    rule: ConeRule = DEFAULT_CONE,
    previous?: TerrainHeights | null,
): Promise<TerrainHeights | null> {
    const domain = await loadDomainHeightSource(database, mapDomainId, previous?.domain);
    if (domain && domain === previous?.domain && previous.rule === rule) return previous;
    return domain ? terrainFromDomain(domain, model, rule) : null;
}
