import { pointInGeometry, type V12Geometry } from "@avesmaps3d/shared";

/** Schritt je Karteneinheit (`SCHRITT_JE_EINHEIT`, `packages/shared/src/gebirge/constants.ts`), wie in `gebirge-vorschau-bild.ts`. */
const SCHRITT_JE_EINHEIT = 3000;

/**
 * Flüsse, Seen und Pässe eines Gebirges im Reiter „Gebirge“ (WI-0245, Lücke e zum Entwurf V16/V17): was die Eingabe der Vorschau schon
 * trägt, in Sätzen wie im Entwurf. Rein, ohne Oberfläche: Anteil eines Wegs in der Fläche, ob ein See ganz drin liegt, welche Seen ein
 * Fluss durchquert, und der Rahmen für ⌖.
 */

type Linie = readonly (readonly [number, number])[];

/** Abtastschritt in Karteneinheiten: Legacys Speicherauflösung, wie das Flussprofil im Routenplaner. */
const SCHRITT = 0.25;

/** Punkte entlang der Linie im Abstand `SCHRITT`, mit Anfang und Ende. */
export function proben(linie: Linie): [number, number][] {
    const aus: [number, number][] = [];
    for (let i = 0; i + 1 < linie.length; i++) {
        const [ax, ay] = linie[i]!;
        const [bx, by] = linie[i + 1]!;
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SCHRITT));
        for (let k = 0; k < n; k++) aus.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    }
    const ende = linie.at(-1);
    if (ende !== undefined) aus.push([ende[0], ende[1]]);
    return aus;
}

/** Welcher Anteil der Linie (0 … 1) in der Fläche liegt, nach Länge. */
export function anteilDrin(linie: Linie, flaeche: V12Geometry): number {
    let drin = 0;
    let gesamt = 0;
    for (let i = 0; i + 1 < linie.length; i++) {
        const [ax, ay] = linie[i]!;
        const [bx, by] = linie[i + 1]!;
        const laenge = Math.hypot(bx - ax, by - ay);
        if (laenge === 0) continue;
        gesamt += laenge;
        const teile = proben([linie[i]!, linie[i + 1]!]).slice(0, -1);
        const innen = teile.filter((p) => pointInGeometry(p, flaeche)).length;
        drin += (laenge * innen) / Math.max(1, teile.length);
    }
    return gesamt === 0 ? 0 : drin / gesamt;
}

/** Die äußeren Ringe einer Fläche. */
const aussenRinge = (g: V12Geometry): Linie[] =>
    ((g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][]).map((polygon) =>
        (polygon[0] ?? []).map(([x, y]) => [x ?? 0, y ?? 0] as const),
    );

/** Liegt der See ganz in der Fläche (jeder Punkt seines Umrisses)? */
export function ganzDrin(see: V12Geometry, flaeche: V12Geometry): boolean {
    return aussenRinge(see).every((ring) => ring.every(([x, y]) => pointInGeometry([x, y], flaeche)));
}

/** Durchquert die Linie den See (ein Probepunkt in ihm)? */
export function durchquert(linie: Linie, see: V12Geometry): boolean {
    return proben(linie).some((p) => pointInGeometry(p, see));
}

/** Der Rahmen [min_x, min_y, max_x, max_y] für ⌖. */
export function rahmen(punkte: Linie): [number, number, number, number] {
    const xs = punkte.map(([x]) => x);
    const ys = punkte.map(([, y]) => y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Der Rahmen einer Fläche (alle äußeren Ringe). */
export const flaechenRahmen = (g: V12Geometry): [number, number, number, number] => rahmen(aussenRinge(g).flat());

/** Ein Höhenprofil: Abstand in E ab dem ersten Punkt der Linie, Höhe in Schritt (`null` ohne Höhe). */
export interface ProfilLinie {
    readonly at: readonly number[];
    readonly h: readonly (number | null)[];
}

/** Die Lagen der Linie an den Abständen `at` (für „in der Fläche“ unter der Kurve). */
export function lagenEntlang(linie: Linie, at: readonly number[]): [number, number][] {
    const lauf = [0];
    for (let i = 1; i < linie.length; i++)
        lauf.push(lauf[i - 1]! + Math.hypot(linie[i]![0] - linie[i - 1]![0], linie[i]![1] - linie[i - 1]![1]));
    let stueck = 1;
    return at.map((s) => {
        while (stueck < linie.length - 1 && lauf[stueck]! < s) stueck++;
        const [ax, ay] = linie[Math.max(0, stueck - 1)]!;
        const [bx, by] = linie[Math.min(linie.length - 1, stueck)]!;
        const von = lauf[Math.max(0, stueck - 1)]!;
        const spanne = lauf[Math.min(linie.length - 1, stueck)]! - von;
        const t = spanne > 0 ? Math.min(1, Math.max(0, (s - von) / spanne)) : 0;
        return [ax + (bx - ax) * t, ay + (by - ay) * t];
    });
}

const bekannt = (p: ProfilLinie): { at: number; h: number }[] =>
    p.at.flatMap((at, i) => {
        const h = p.h[i];
        return h === null || h === undefined || !Number.isFinite(h) ? [] : [{ at, h }];
    });

/**
 * Quelle, Mündung und Gefälle eines Flusses. Das Höhenmodell lässt Flüsse nicht bergauf fließen (ADR-0016): Das höhere Ende ist die
 * Quelle; `umgedreht`, wenn die Linie an der Mündung beginnt (die Kurve steht dann gespiegelt, Quelle links).
 */
export function flussZahlen(
    p: ProfilLinie,
): { quelle: number; muendung: number; gefaelle: number; umgedreht: boolean } | undefined {
    const punkte = bekannt(p);
    if (punkte.length < 2) return undefined;
    const anfang = punkte[0]!.h;
    const ende = punkte.at(-1)!.h;
    const quelle = Math.max(anfang, ende);
    const muendung = Math.min(anfang, ende);
    return { quelle, muendung, gefaelle: quelle - muendung, umgedreht: anfang < ende };
}

/** Höchster Punkt, größte Steigung (Prozent, je Abtastschritt), Anstieg und Abstieg eines Passes in Schritt. */
export function passZahlen(
    p: ProfilLinie,
): { hoechster: number; steigung: number; anstieg: number; abstieg: number } | undefined {
    const punkte = bekannt(p);
    if (punkte.length < 2) return undefined;
    let anstieg = 0;
    let abstieg = 0;
    let steigung = 0;
    for (let i = 1; i < punkte.length; i++) {
        const dh = punkte[i]!.h - punkte[i - 1]!.h;
        const strecke = (punkte[i]!.at - punkte[i - 1]!.at) * SCHRITT_JE_EINHEIT;
        if (dh > 0) anstieg += dh;
        else abstieg -= dh;
        if (strecke > 0) steigung = Math.max(steigung, (Math.abs(dh) / strecke) * 100);
    }
    return { hoechster: Math.max(...punkte.map((q) => q.h)), steigung, anstieg, abstieg };
}
