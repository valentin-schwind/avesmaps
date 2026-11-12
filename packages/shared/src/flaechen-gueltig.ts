import { bereinigeRing, type RingPunkt } from "./flaechen-ringe.ts";

/**
 * Ob eine Fläche sich kreuzt oder berührt, ohne Datenbank (Vali 2026-11-10: „kann man da nochmal den fokus drauflegen, dass sowas nicht
 * wieder passiert“; die Editoren „wollen schnell editieren ohne fehler“). Der Server prüft „Fertig“ mit PostGIS (`ST_IsValidDetail`,
 * `landscape-reshape.ts`, `sprachen/editor-flaechen.ts`); der Editor prüft jeden Schritt hiermit (`apps/web/src/map/geometrie/form-regel.ts`)
 * und nimmt einen Schritt, der eine Fläche kreuzen oder sich selbst berühren ließe, gar nicht erst an.
 *
 * Geprüft wird, was beim Ziehen von Ecken entsteht, und eher zu streng als zu nachsichtig: Was der Editor hier durchlässt, darf PostGIS
 * nicht ablehnen (der Zufallstest `apps/web/test/ecken-zufall.test.ts` prüft beides gegeneinander).
 *
 * - **`schneidet_sich`:** zwei Kanten derselben Fläche kreuzen sich, auch zwischen Rand und Loch oder zwischen zwei Teilen; oder zwei Kanten
 *   verschiedener Ringe liegen ein Stück weit aufeinander.
 * - **`beruehrt_sich`:** Eine Ecke liegt auf einer anderen Kante oder Ecke DESSELBEN Rings (die Form wird eingeschnürt), oder eine Kante läuft
 *   auf ihrer Nachbarkante zurück (ein Sporn). Ein Punkt, an dem sich zwei VERSCHIEDENE Ringe berühren, ist erlaubt, wie in PostGIS.
 * - Nicht geprüft: ein Loch ganz außerhalb des Rands und Teile, die ohne Kreuzung ineinanderliegen. Das braucht den Aufbau der Polygone und
 *   entsteht beim Ziehen einzelner Ecken kaum; der Server sagt es mit Stelle.
 *
 * Gerechnet wird auf den bereinigten Ringen (`bereinigeRing`). Nahe heißt näher als `NAH` Karteneinheiten: Ein eingerasteter Punkt auf einer
 * Kante liegt in Gleitkomma nie genau darauf, PostGIS sähe dort Berührung oder Kreuzung.
 */

export type FormMangel = "schneidet_sich" | "beruehrt_sich";

/**
 * Was an einer ungültigen Form falsch ist, aus dem Grund von GEOS (`ST_IsValidDetail(…).reason`). EINE Übersetzung für alle, die PostGIS
 * fragen: die Ablehnung beim Speichern (`landscape-reshape.ts`, `territory-reshape.ts`) und die Prüfebene „Flächen kreuzen sich“ im Auge
 * (`apps/server/src/map-checks/checks.ts`).
 */
export const FORM_FEHLER_ARTEN = [
    "schneidet_sich",
    "beruehrt_sich",
    "loch_ueber_rand",
    "zu_wenig_ecken",
    "sonst",
] as const;
export type FormFehlerArt = (typeof FORM_FEHLER_ARTEN)[number];

export function formFehlerArt(grund: string | null): FormFehlerArt {
    switch (grund) {
        // Zwei Kanten kreuzen sich (eine Acht, eine Schlaufe) oder zwei Ringe derselben Fläche schneiden sich.
        case "Self-intersection":
            return "schneidet_sich";
        // Ein Ring berührt sich in einem Punkt (eine Spitze klappt auf eine Kante).
        case "Ring Self-intersection":
            return "beruehrt_sich";
        // Ein Loch liegt (zum Teil) außerhalb, teilt das Innere, oder Löcher liegen ineinander.
        case "Hole lies outside shell":
        case "Interior is disconnected":
        case "Holes are nested":
            return "loch_ueber_rand";
        // Ein Ring oder ein Teil der Fläche hat weniger als drei verschiedene Ecken (Stage 2026-11-10: 81 Landschaftsflächen mit einem
        // Teil aus zwei Ecken). Beim Speichern lehnt der Server das schon vorher als `ring_unter_drei` ab.
        case "Too few points in geometry component":
        case "Too few distinct points in geometry component":
            return "zu_wenig_ecken";
        default:
            return "sonst";
    }
}

export interface FormBefund {
    readonly art: FormMangel;
    readonly stelle: RingPunkt;
    /** Der Ring (Index in der übergebenen Liste), an dem es liegt. */
    readonly ring: number;
}

/** Näher als das gilt als berührt (Karteneinheiten; die Karte ist 1024 breit, fünf Nachkommastellen sind 1e-5). */
const NAH = 1e-7;

interface Strecke {
    readonly ring: number;
    readonly i: number;
    readonly n: number;
    readonly a: RingPunkt;
    readonly b: RingPunkt;
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
}

const minus = (p: RingPunkt, q: RingPunkt): RingPunkt => [p[0] - q[0], p[1] - q[1]];
const kreuz = (u: RingPunkt, v: RingPunkt): number => u[0] * v[1] - u[1] * v[0];
const punkt = (u: RingPunkt, v: RingPunkt): number => u[0] * v[0] + u[1] * v[1];
const laenge = (u: RingPunkt): number => Math.hypot(u[0], u[1]);

/** Der Abstand von `q` zur Strecke `a`–`b`. */
function abstand(q: RingPunkt, a: RingPunkt, b: RingPunkt): number {
    const ab = minus(b, a);
    const l2 = punkt(ab, ab);
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, punkt(minus(q, a), ab) / l2));
    return Math.hypot(q[0] - (a[0] + ab[0] * t), q[1] - (a[1] + ab[1] * t));
}

/** Seite von `q` zur Geraden durch `a`, `b`, als Abstand mit Vorzeichen (0 heißt: näher als `NAH`). */
function seite(a: RingPunkt, b: RingPunkt, q: RingPunkt): number {
    const ab = minus(b, a);
    const l = laenge(ab);
    if (l === 0) return 0;
    const d = kreuz(ab, minus(q, a)) / l;
    return Math.abs(d) <= NAH ? 0 : Math.sign(d);
}

/** Der Schnittpunkt zweier Geraden (für die Marke). */
function schnitt(a: RingPunkt, b: RingPunkt, c: RingPunkt, d: RingPunkt): RingPunkt {
    const r = minus(b, a);
    const s = minus(d, c);
    const nenner = kreuz(r, s);
    if (nenner === 0) return a;
    const t = kreuz(minus(c, a), s) / nenner;
    return [a[0] + r[0] * t, a[1] + r[1] * t];
}

/** Sind zwei Strecken eines Rings Nachbarn (teilen sie eine Ecke)? */
function nachbarn(s: Strecke, t: Strecke): RingPunkt | undefined {
    if (s.ring !== t.ring) return undefined;
    if ((s.i + 1) % s.n === t.i) return s.b;
    if ((t.i + 1) % t.n === s.i) return t.b;
    return undefined;
}

/** Was an einem Paar von Strecken nicht stimmt. */
function paar(s: Strecke, t: Strecke): FormBefund | undefined {
    const ecke = nachbarn(s, t);
    if (ecke !== undefined) {
        // Nachbarkanten: nur ein Sporn ist falsch, wenn die zweite auf der ersten zurückläuft.
        const u = ecke === s.b ? s.a : s.b;
        const w = ecke === t.a ? t.b : t.a;
        const eu = minus(u, ecke);
        const ew = minus(w, ecke);
        const quer = Math.abs(kreuz(eu, ew)) / Math.max(laenge(eu), laenge(ew), NAH);
        return quer <= NAH && punkt(eu, ew) > 0 ? { art: "beruehrt_sich", stelle: ecke, ring: s.ring } : undefined;
    }
    const d1 = seite(t.a, t.b, s.a);
    const d2 = seite(t.a, t.b, s.b);
    const d3 = seite(s.a, s.b, t.a);
    const d4 = seite(s.a, s.b, t.b);
    if (d1 * d2 < 0 && d3 * d4 < 0) return { art: "schneidet_sich", stelle: schnitt(s.a, s.b, t.a, t.b), ring: s.ring };
    // Berührung: eine Ecke auf der anderen Strecke.
    const auf = [
        abstand(s.a, t.a, t.b) <= NAH ? s.a : undefined,
        abstand(s.b, t.a, t.b) <= NAH ? s.b : undefined,
        abstand(t.a, s.a, s.b) <= NAH ? t.a : undefined,
        abstand(t.b, s.a, s.b) <= NAH ? t.b : undefined,
    ].filter((p): p is RingPunkt => p !== undefined);
    if (auf.length === 0) return undefined;
    if (s.ring === t.ring) return { art: "beruehrt_sich", stelle: auf[0]!, ring: s.ring };
    // Verschiedene Ringe dürfen sich in einem Punkt berühren, aber nicht ein Stück weit aufeinanderliegen.
    const verschieden = auf.filter((p, k) => auf.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= NAH) === k);
    return verschieden.length >= 2 ? { art: "schneidet_sich", stelle: verschieden[0]!, ring: s.ring } : undefined;
}

/**
 * Der erste Mangel der Ringe EINER Fläche (alle Ringe aller ihrer Teile, Reihenfolge egal); `relevant` beschränkt die Prüfung auf Paare, an
 * denen ein geänderter Ring beteiligt ist. Ringe unter drei Ecken bleiben außen vor (`RING_MINDESTENS`, eine eigene Regel).
 */
export function formMangel(
    ringe: readonly (readonly RingPunkt[])[],
    relevant: (ring: number) => boolean = () => true,
): FormBefund | undefined {
    const strecken: Strecke[] = [];
    ringe.forEach((roh, ring) => {
        const punkte = bereinigeRing(roh);
        if (punkte.length < 3) return;
        punkte.forEach((a, i) => {
            const b = punkte[(i + 1) % punkte.length]!;
            strecken.push({
                ring,
                i,
                n: punkte.length,
                a,
                b,
                minX: Math.min(a[0], b[0]) - NAH,
                maxX: Math.max(a[0], b[0]) + NAH,
                minY: Math.min(a[1], b[1]) - NAH,
                maxY: Math.max(a[1], b[1]) + NAH,
            });
        });
    });
    // Ein Durchlauf von links nach rechts: Nur Strecken, deren Spannen sich überlappen, werden verglichen.
    strecken.sort((s, t) => s.minX - t.minX);
    for (let k = 0; k < strecken.length; k += 1) {
        const s = strecken[k]!;
        for (let m = k + 1; m < strecken.length && strecken[m]!.minX <= s.maxX; m += 1) {
            const t = strecken[m]!;
            if (t.minY > s.maxY || t.maxY < s.minY) continue;
            if (!relevant(s.ring) && !relevant(t.ring)) continue;
            const befund = paar(s, t);
            if (befund !== undefined) return befund;
        }
    }
    return undefined;
}

/** Liegt der Punkt in der Karte? Wie der Server (`map_domain_contains`: `ST_Within` im Rechteck), also nicht auf dem Rand. */
export function imKartenraum(
    p: RingPunkt,
    grenzen: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
): boolean {
    return p[0] > grenzen.minX && p[0] < grenzen.maxX && p[1] > grenzen.minY && p[1] < grenzen.maxY;
}
