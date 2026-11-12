/**
 * Das Netz aus gezeichneten Kämmen (Entwurf; Betreiber 2026-10-20: „wir nehmen einfach ein zeichen tool mit linien, sodass wir die kämme
 * der berge, die wir jetzt auf dem untergrund sehen nachzeichnen können. du nimmst das modell um die kämme zu gebirgen aufzustapeln“).
 * Die Linien haben Vorrang und bleiben, wie gezeichnet:
 * - Ein Ende, das auf unter 0,5 E an eine andere Linie kommt, rastet auf ihr ein: ein gemeinsamer Knoten (Gabelung oder Vereinigung).
 * - Hauptkämme tragen voll, Nebenkämme etwas weniger; ein freies Ende läuft über 2 E aus.
 * - Ergänzt werden nur Äste: quer von jeder Linie zum Rand oder bis vor die nächste Linie, dazwischen die Quertäler.
 * Ohne gezeichnete Kämme erzeugt `netz.ts` das Netz selbst (Rückfall).
 */
import { wertRauschen } from "../noise.ts";
import type { Raster } from "../raster.ts";
import type { Kante, Knoten, Rueckennetz, StrukturRegler } from "./netz.ts";
import { hatPunktHoehen, KAMM_FANG_E, type NetzLinie } from "./netz-vertrag.ts";

/** Ein gezeichneter Kamm (`netz-vertrag.ts`), im Editor mit freier Kennung; Täler (`tal`) nimmt `baueAusKaemmen` nicht, sie kommen als Hindernis. */
export type GezeichneterKamm = NetzLinie & { id?: string };

const SCHRITT = 0.5;

const drin = (r: Raster, x: number, y: number): boolean => {
    const i = r.i(x);
    const j = r.j(y);
    return i >= 0 && j >= 0 && i < r.w && j < r.hh && r.drin[j * r.w + i] === 1;
};

/** Der nächste Punkt auf einem Linienzug und sein Abstand. */
function naechsterPunkt(
    punkte: readonly (readonly [number, number])[],
    x: number,
    y: number,
): { p: [number, number]; d: number } {
    let best: { p: [number, number]; d: number } = { p: [punkte[0]![0], punkte[0]![1]], d: Infinity };
    for (let s = 1; s < punkte.length; s++) {
        const [ax, ay] = punkte[s - 1]!;
        const [bx, by] = punkte[s]!;
        const vx = bx - ax;
        const vy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1e-9)));
        const p: [number, number] = [ax + t * vx, ay + t * vy];
        const d = Math.hypot(x - p[0], y - p[1]);
        if (d < best.d) best = { p, d };
    }
    return best;
}

/** Ein Punkt mit Höhe, an dem Kämme enden können: kanonischer Gipfel oder Nebengipfel (Schritt). */
export interface HoehenPunkt {
    x: number;
    y: number;
    h: number;
}

/**
 * Durchhang zwischen den Kammpunkten (WI-0249 P2; Betreiber 2026-10-23: „im moment sind kämme sehr gerade X---X---X---X — die idee ist
 * einfach ihre vertices zu stabilisieren wie nebengipfel und die kammrücken dazwischen eher abzutragen X\_/X\_/X\_/X“): Je Segment eines
 * gezeichneten Kamms sinkt die Höhe zwischen seinen zwei Punkten um `Tiefe · Profil(u)` ihrer Kammhöhe, an den Punkten selbst gar nicht.
 * Die Tiefe ist der Durchhang des Rangs (Typwerte `form.durchhang`, `form.durchhangNeben`) mal `durchhangAnteil(L)`: kurze Segmente kaum,
 * lange voll. Die Senkung selbst rechnet die Hebung (`hebe`, `senkeSaettel`): als Abzug um die Achse, nicht über das Gewicht, das sie
 * über dem Talboden staucht (Blutzinnen, Talboden 0,85: über das Gewicht sank ein Sattel von einem Zehntel Durchhang um 15 Schritt).
 */
export interface Durchhang {
    haupt: number;
    neben: number;
}
/** VORSCHLAG: Segmentlänge (E), ab der ein Kamm nahezu voll durchhängt; der Anteil ist `1 − exp(−(L / 4)²)` (2 E: 22 %, 4 E: 63 %, 6 E: 89 %). */
export const DURCHHANG_LAENGE_E = 4;
/** VORSCHLAG: Rundung des Profils an jedem Kammpunkt (E): Darunter verläuft es parabolisch, kein Knick am Punkt. */
export const DURCHHANG_RUNDUNG_E = 0.3;

/** Anteil des vollen Durchhangs an einem Segment der Länge `laenge` (E). */
export const durchhangAnteil = (laenge: number): number => 1 - Math.exp(-((laenge / DURCHHANG_LAENGE_E) ** 2));

/**
 * Das Profil des Durchhangs entlang eines Segments (u von 0 bis 1): 0 an beiden Punkten, 1 in der Mitte, symmetrisch und glatt; an den
 * Punkten über `DURCHHANG_RUNDUNG_E` gerundet (`√(sin²(πu) + ε²) − ε`, normiert). Daneben fällt es wie ein Sinusbogen: Der Sattel liegt
 * in der Mitte, ohne Stufe und ohne Kerbe.
 */
export function durchhangProfil(u: number, laenge: number): number {
    const eps = (Math.PI * DURCHHANG_RUNDUNG_E) / Math.max(laenge, 1e-6);
    const s = Math.sin(Math.PI * Math.max(0, Math.min(1, u)));
    return (Math.sqrt(s * s + eps * eps) - eps) / (Math.sqrt(1 + eps * eps) - eps);
}

/** Der Durchhang der Typwerte; ohne Werte über 0 keiner (dann rechnet das Netz wie vor dem Durchhang). */
export function durchhangAus(form: {
    durchhang?: number | undefined;
    durchhangNeben?: number | undefined;
}): Durchhang | undefined {
    const haupt = Math.max(0, Math.min(0.9, Number(form.durchhang) || 0));
    const neben = Math.max(0, Math.min(0.9, Number(form.durchhangNeben) || 0));
    return haupt > 0 || neben > 0 ? { haupt, neben } : undefined;
}

/**
 * Die Tiefe des Durchhangs je Segment jedes Kamms (Anteil der Höhe in der Segmentmitte). EINE Regel für die Saat (`baueAusKaemmen`) und das
 * Gelände (`rueckennetzNetz`, Formerhalt): Ein Segment hängt nur zwischen zwei tragenden Punkten durch, also nicht am freien Kammende
 * (dort läuft der Kamm aus wie bisher). Ein Ende trägt, wenn es an einem Gipfel oder Nebengipfel liegt oder an einer anderen Linie einrastet
 * (beides unter `KAMM_FANG_E`); jeder innere Punkt trägt. `kaemme` sind die Kämme ohne Täler. Ein Ende mit eigener Punkthöhe (WI-0249 P9)
 * trägt ebenfalls: Der Punkt ist festgelegt, das Segment hängt zwischen ihm und seinem Nachbarn durch, relativ zur Verbindung ihrer Höhen
 * (die Senkung rechnet `hebe` auf der linearen Kantenhöhe zwischen den beiden Punkten).
 */
export function durchhangTiefen(
    kaemme: readonly {
        punkte: readonly (readonly [number, number])[];
        rang: string;
        hoehen?: readonly (number | null)[] | undefined;
    }[],
    punkte: readonly { x: number; y: number }[],
    durchhang: Durchhang,
): number[][] {
    const traegt = (a: number, p: readonly [number, number]): boolean =>
        punkte.some((q) => Math.hypot(q.x - p[0], q.y - p[1]) < KAMM_FANG_E) ||
        kaemme.some(
            (andere, b) =>
                b !== a && andere.punkte.length >= 2 && naechsterPunkt(andere.punkte, p[0], p[1]).d < KAMM_FANG_E,
        );
    return kaemme.map((kamm, a) => {
        const n = kamm.punkte.length;
        if (n < 2) return [];
        const tiefe = kamm.rang === "haupt" ? durchhang.haupt : durchhang.neben;
        const eigen = (s: number): boolean => kamm.hoehen?.[s] !== null && kamm.hoehen?.[s] !== undefined;
        const vorn = tiefe > 0 && (eigen(0) || traegt(a, kamm.punkte[0]!));
        const hinten = tiefe > 0 && (eigen(n - 1) || traegt(a, kamm.punkte[n - 1]!));
        return kamm.punkte.slice(1).map((b, i) => {
            if (!(tiefe > 0) || (i === 0 && !vorn) || (i === n - 2 && !hinten)) return 0;
            const q = kamm.punkte[i]!;
            return tiefe * durchhangAnteil(Math.hypot(b[0] - q[0], b[1] - q[1]));
        });
    });
}

/** Eine gezeichnete Linie im Netz: ein Kamm mit kopierten Punkten, die das Einrasten verschiebt. */
type NetzKamm = GezeichneterKamm & { punkte: [number, number][] };

/**
 * Enden einrasten: Ein Ende, das auf unter `KAMM_FANG_E` an eine andere Linie kommt, liegt danach auf ihr (ein gemeinsamer Knoten). Verschiebt
 * die Punkte von `linien`; gibt die Knoten in ihrer Folge und je Linie, ob ihre beiden Enden frei geblieben sind.
 */
function rasteEndenEin(linien: NetzKamm[]): { knoten: Knoten[]; frei: [boolean, boolean][] } {
    const knoten: Knoten[] = [];
    const frei = linien.map((): [boolean, boolean] => [true, true]);
    linien.forEach((linie, a) => {
        const enden: [0 | 1, number][] = [
            [0, 0],
            [1, linie.punkte.length - 1],
        ];
        for (const [ende, idx] of enden) {
            const [x, y] = linie.punkte[idx]!;
            let best: { p: [number, number]; d: number } | null = null;
            linien.forEach((andere, b) => {
                if (b === a) return;
                const n = naechsterPunkt(andere.punkte, x, y);
                if (n.d < KAMM_FANG_E && (best === null || n.d < best.d)) best = n;
            });
            if (best !== null) {
                const p = (best as { p: [number, number] }).p;
                linie.punkte[idx] = [p[0], p[1]];
                frei[a]![ende] = false;
                knoten.push({ art: ende === 0 ? "gabelung" : "vereinigung", x: p[0], y: p[1] });
            }
        }
    });
    return { knoten, frei };
}

/** Die Bogenlänge bis zu jedem Punkt eines Linienzugs (E). */
function bogenlaengen(punkte: readonly (readonly [number, number])[]): number[] {
    const laenge: number[] = [0];
    for (let s = 1; s < punkte.length; s++) {
        const [ax, ay] = punkte[s - 1]!;
        const [bx, by] = punkte[s]!;
        laenge.push(laenge[s - 1]! + Math.hypot(bx - ax, by - ay));
    }
    return laenge;
}

/** Die Höhe des Gipfels oder Nebengipfels an `p` (der nächste unter `KAMM_FANG_E`), sonst `null`. */
function ankerAn(hoehenPunkte: readonly HoehenPunkt[], p: readonly [number, number]): number | null {
    let best: HoehenPunkt | null = null;
    let bd = KAMM_FANG_E;
    for (const q of hoehenPunkte) {
        const d = Math.hypot(q.x - p[0], q.y - p[1]);
        if (d < bd) {
            bd = d;
            best = q;
        }
    }
    return best === null ? null : best.h;
}

/**
 * Die Höhe am Ende einer Linie, deren anderes Ende `anker` trägt: höchstens 90 % davon, sonst die Vorgabe des Rangs (Ehernes Schwert: ein
 * Sporn vom Nebengipfel 4000 lief sonst zur Kammhöhe 5000 hinauf, der Nebengipfel war kein Gipfel mehr).
 */
const endeUnter = (anker: number, vorgabe: number): number => Math.min(vorgabe, 0.9 * anker);

/**
 * Das Gewicht je Punkt einer Linie MIT eigenen Punkthöhen (WI-0249 P9): Ein Punkt mit eigener Höhe trägt genau sie (`h / Kammhöhe`), ohne
 * Unruhe und Auslauf, ein Punkt an einem Gipfel oder Nebengipfel dessen Höhe. Dazwischen geht die Höhe über die Bogenlänge linear von einem
 * solchen Knoten zum nächsten über. Hinter dem letzten (vor dem ersten) Knoten fällt sie zu einem freien Ende hin linear ab wie ohne
 * Punkthöhen, auf `endeUnter` (Vali 2026-10-30, Raschtulswall: Der Hauptkamm blieb hinter dem Djer Tulam über 25 E auf 9.000); zu einem
 * eingerasteten Ende bleibt sie auf der Höhe des Knotens. Dort wirken die Unruhe und, an einem freien Ende ohne eigene Höhe, der Auslauf wie
 * ohne Punkthöhen. Den Durchhang zwischen den Punkten rechnet danach die Hebung (`durchhangTiefen`, `hebe`).
 */
function gewichteMitHoehen(
    linie: NetzKamm,
    laenge: readonly number[],
    hoehenPunkte: readonly HoehenPunkt[],
    frei: readonly [boolean, boolean],
    kammhoehe: number,
    unruhe: (t: number) => number,
): { gewicht: number[]; freiVorn: boolean; freiHinten: boolean } {
    const n = linie.punkte.length;
    const gesamt = laenge[n - 1] ?? 0;
    const knoten = linie.punkte.map((p, s) => linie.hoehen?.[s] ?? ankerAn(hoehenPunkte, p));
    const freiVorn = frei[0] && knoten[0] === null;
    const freiHinten = frei[1] && knoten[n - 1] === null;
    const auslauf = Math.min(2, gesamt / 2);
    const vorgabe = kammhoehe * (linie.rang === "haupt" ? 1 : 0.9);
    const gewicht = linie.punkte.map((_, s) => {
        const fest = knoten[s];
        if (fest !== null && fest !== undefined) return fest / kammhoehe;
        let i = s - 1;
        while (i >= 0 && knoten[i] === null) i--;
        let j = s + 1;
        while (j < n && knoten[j] === null) j++;
        const t = laenge[s]!;
        const hi = i >= 0 ? (knoten[i] as number) : null;
        const hj = j < n ? (knoten[j] as number) : null;
        const h =
            hi !== null && hj !== null
                ? hi + ((hj - hi) * (t - laenge[i]!)) / Math.max(1e-9, laenge[j]! - laenge[i]!)
                : hi !== null && freiHinten
                  ? hi + ((endeUnter(hi, vorgabe) - hi) * (t - laenge[i]!)) / Math.max(1e-9, gesamt - laenge[i]!)
                  : hj !== null && freiVorn
                    ? endeUnter(hj, vorgabe) + ((hj - endeUnter(hj, vorgabe)) * t) / Math.max(1e-9, laenge[j]!)
                    : (hi ?? hj ?? kammhoehe);
        const vorn = freiVorn ? Math.min(1, t / Math.max(1e-6, auslauf)) : 1;
        const hinten = freiHinten ? Math.min(1, (gesamt - t) / Math.max(1e-6, auslauf)) : 1;
        return (h / kammhoehe) * unruhe(t) * (0.6 + 0.4 * Math.min(vorn, hinten));
    });
    return { gewicht, freiVorn, freiHinten };
}

/**
 * Die Gewichte (Höhe als Anteil der Kammhöhe) je Punkt jeder gezeichneten Linie nach dem Einrasten, und ob ihre Enden frei auslaufen. EINE
 * Rechnung für die Saat (`baueAusKaemmen`, mit Unruhe) und die Vorgaben, die der Kammeditor an Punkten ohne eigene Höhe zeigt
 * (`kammPunktHoehen`, ohne Unruhe).
 */
function kammGewichte(
    linien: readonly NetzKamm[],
    frei: readonly [boolean, boolean][],
    hoehenPunkte: readonly HoehenPunkt[],
    kammhoehe: number,
    sattel: number,
    unruhe: (a: number, t: number) => number,
): { gewicht: number[]; freiVorn: boolean; freiHinten: boolean }[] {
    return linien.map((linie, a) => {
        const laenge = bogenlaengen(linie.punkte);
        if (hatPunktHoehen(linie))
            return gewichteMitHoehen(linie, laenge, hoehenPunkte, frei[a]!, kammhoehe, (t) => unruhe(a, t));
        const gesamt = laenge.at(-1) ?? 0;
        const grund = linie.rang === "haupt" ? 1 : 0.9;
        // Endet die Linie an einem Gipfel oder Nebengipfel? Dann trägt das Ende dessen Höhe.
        const vorgabe = kammhoehe * grund;
        const ankerA = ankerAn(hoehenPunkte, linie.punkte[0]!);
        const ankerB = ankerAn(hoehenPunkte, linie.punkte.at(-1)!);
        // Hängt nur ein Ende an einem Gipfel, steigt die Kante von ihm nicht an (`endeUnter`).
        const hA = ankerA ?? (ankerB !== null ? endeUnter(ankerB, vorgabe) : null);
        const hB = ankerB ?? (ankerA !== null ? endeUnter(ankerA, vorgabe) : null);
        const freiVorn = frei[a]![0] && ankerA === null;
        const freiHinten = frei[a]![1] && ankerB === null;
        const auslauf = Math.min(2, gesamt / 2);
        const gewicht = linie.punkte.map((_, s) => {
            const t = laenge[s]!;
            const basis = (hA ?? vorgabe) + ((hB ?? vorgabe) - (hA ?? vorgabe)) * (gesamt > 0 ? t / gesamt : 0);
            // Durchhang zwischen getragenen Enden wie die V12.
            const dAnker = Math.min(ankerA !== null ? t : Infinity, ankerB !== null ? gesamt - t : Infinity);
            const durchhang = Number.isFinite(dAnker) ? sattel + (1 - sattel) * Math.exp(-(dAnker * dAnker) / 32) : 1;
            const vorn = freiVorn ? Math.min(1, t / Math.max(1e-6, auslauf)) : 1;
            const hinten = freiHinten ? Math.min(1, (gesamt - t) / Math.max(1e-6, auslauf)) : 1;
            return ((basis * durchhang) / kammhoehe) * unruhe(a, t) * (0.6 + 0.4 * Math.min(vorn, hinten));
        });
        return { gewicht, freiVorn, freiHinten };
    });
}

/**
 * Die Höhe jedes Stützpunkts der gezeichneten Kämme (ohne Täler; Schritt, ungerundet), wie die Saat sie anlegt, ohne die Unruhe von ±5 %:
 * was der Kammeditor an einem Punkt ohne eigene Höhe als Vorgabe zeigt (WI-0249 P9). Eingerastet wie in `baueAusKaemmen`, in der Folge von
 * `kaemme`; eine Linie unter zwei Punkten ergibt eine leere Liste.
 */
export function kammPunktHoehen(
    kaemme: readonly GezeichneterKamm[],
    hoehenPunkte: readonly HoehenPunkt[],
    kammhoehe: number,
    sattel = 0.85,
): number[][] {
    const tragend = kaemme.map((k, i) => ({ k, i })).filter(({ k }) => k.punkte.length >= 2 && k.rang !== "tal");
    const linien: NetzKamm[] = tragend.map(({ k }) => ({
        ...k,
        punkte: k.punkte.map(([x, y]) => [x, y] as [number, number]),
    }));
    const { frei } = rasteEndenEin(linien);
    const gewichte = kammGewichte(linien, frei, hoehenPunkte, kammhoehe, sattel, () => 1);
    const aus: number[][] = kaemme.map(() => []);
    tragend.forEach(({ i }, a) => (aus[i] = gewichte[a]!.gewicht.map((g) => g * kammhoehe)));
    return aus;
}

/**
 * Stand der Regel „hinter dem letzten Knoten fällt die Linie zum freien Ende ab“ (`gewichteMitHoehen`, Vali 2026-10-30) im Fingerabdruck
 * der Saat (`terrain/inputs.ts`): nur bei Gebirgen, für die `faelltZumFreienEnde` gilt. Alle anderen behalten Fingerabdruck und Saat
 * Zeichen für Zeichen.
 */
export const KAMM_AUSLAUF_QUELLE = "kamm-auslauf@WI-0249-1";

/**
 * Läuft eine Linie mit eigenen Punkthöhen über ihren ersten oder letzten Knoten hinaus zu einem freien Ende? Nur dort rechnet
 * `gewichteMitHoehen` seit der Regel vom 2026-10-30 anders. Eingerastet wie in `baueAusKaemmen`; Knoten wie dort (eigene Höhe oder ein
 * Gipfel oder Nebengipfel unter `KAMM_FANG_E`).
 */
export function faelltZumFreienEnde(
    kaemme: readonly GezeichneterKamm[],
    punkte: readonly { x: number; y: number }[],
): boolean {
    const linien: NetzKamm[] = kaemme
        .filter((k) => k.punkte.length >= 2 && k.rang !== "tal")
        .map((k) => ({ ...k, punkte: k.punkte.map(([x, y]) => [x, y] as [number, number]) }));
    const { frei } = rasteEndenEin(linien);
    const anker = (p: readonly [number, number]): boolean =>
        punkte.some((q) => Math.hypot(q.x - p[0], q.y - p[1]) < KAMM_FANG_E);
    return linien.some((linie, a) => {
        if (!hatPunktHoehen(linie)) return false;
        const offen = (s: number): boolean =>
            (linie.hoehen?.[s] === null || linie.hoehen?.[s] === undefined) && !anker(linie.punkte[s]!);
        return (frei[a]![0] && offen(0)) || (frei[a]![1] && offen(linie.punkte.length - 1));
    });
}

/**
 * Die Höhe entlang einer Kante (Betreiber 2026-10-20: „ich bräuchte nur einen editor um die gipfelspitzen zu verbinden“): Endet sie an
 * einem Gipfel oder Nebengipfel (unter 0,5 E), trägt das Ende dessen Höhe; dazwischen linear, mit dem Durchhang der V12 zwischen Gipfeln
 * (`sattel + (1 − sattel) · exp(−d² / 32)`, d in E zum nächsten getragenen Ende, `kammHoeheAn` in `ridge.ts`). Ein Ende ohne Gipfel
 * trägt die Vorgabe des Rangs; ein freies Ende (an nichts) läuft über höchstens 2 E aus. Trägt die Linie eigene Punkthöhen (WI-0249 P9),
 * gelten sie an ihren Punkten genau (`gewichteMitHoehen`); ohne sie rechnet alles Zeichen für Zeichen wie zuvor.
 */
export function baueAusKaemmen(
    r: Raster,
    kaemme: readonly GezeichneterKamm[],
    reg: StrukturRegler,
    saat: number,
    hoehenPunkte: readonly HoehenPunkt[] = [],
    kammhoehe = 1500,
    sattel = 0.85,
    /** Gezeichnete Täler: Äste enden vor ihnen wie vor einer anderen Linie. */
    taeler: readonly { punkte: readonly (readonly [number, number])[] }[] = [],
    /** Durchhang zwischen den Kammpunkten (WI-0249 P2, `durchhangAus`); ohne ihn rechnet das Netz wie zuvor. */
    durchhang?: Durchhang,
): Rueckennetz {
    const linien: NetzKamm[] = kaemme
        .filter((k) => k.punkte.length >= 2 && k.rang !== "tal")
        .map((k) => ({ ...k, punkte: k.punkte.map(([x, y]) => [x, y] as [number, number]) }));
    // Vor dem Einrasten, wie das Gelände es sieht (`rueckennetzNetz`).
    const tiefen = durchhang ? durchhangTiefen(linien, hoehenPunkte, durchhang) : null;
    const { knoten, frei } = rasteEndenEin(linien);
    const gewichte = kammGewichte(
        linien,
        frei,
        hoehenPunkte,
        kammhoehe,
        sattel,
        (a, t) => 0.95 + 0.05 * wertRauschen(saat + 503 + a * 29, t / (reg.welle * 0.7), a * 3.1, 1),
    );
    const kanten: Kante[] = linien.map((linie, a) => {
        const { gewicht, freiVorn, freiHinten } = gewichte[a]!;
        if (tiefen) {
            if (freiVorn) tiefen[a]![0] = 0;
            if (freiHinten) tiefen[a]![linie.punkte.length - 2] = 0;
        }
        return { art: "strang", quelle: "gezeichnet", punkte: linie.punkte, gewicht };
    });
    /** Der Faktor des Durchhangs bei `u` (0 bis 1) im Segment `s` (1 bis n − 1) der Linie `a`; ohne Durchhang 1. */
    const sinkt = (a: number, s: number, u: number, l: number): number => {
        const tiefe = tiefen?.[a]?.[s - 1] ?? 0;
        return tiefe > 0 ? 1 - tiefe * durchhangProfil(u, l) : 1;
    };
    // Äste quer zu jeder Linie, bis zum Rand oder bis vor die nächste Linie.
    if (reg.astAbstand > 0) {
        linien.forEach((linie, a) => {
            let lauf = 0.5 * reg.astAbstand * (1 + wertRauschen(saat + 601 + a, a * 7.1, 0.5, 1));
            for (let s = 1; s < linie.punkte.length; s++) {
                const [ax, ay] = linie.punkte[s - 1]!;
                const [bx, by] = linie.punkte[s]!;
                const l = Math.hypot(bx - ax, by - ay);
                const dx = (bx - ax) / (l || 1);
                const dy = (by - ay) / (l || 1);
                for (let u = 0; u < l; u += SCHRITT) {
                    lauf += SCHRITT;
                    if (lauf < reg.astAbstand) continue;
                    const px = ax + dx * u;
                    const py = ay + dy * u;
                    lauf = 0.35 * reg.astAbstand * wertRauschen(saat + 607 + a, px * 0.37, py * 0.53, 1);
                    for (const seite of [1, -1] as const) {
                        const schraeg = 0.45 * wertRauschen(saat + 619, px * 0.53, py * 0.41 + seite, 1);
                        let nx = -dy * seite + dx * schraeg;
                        let ny = dx * seite + dy * schraeg;
                        const nl = Math.hypot(nx, ny) || 1;
                        nx /= nl;
                        ny /= nl;
                        // Wie weit bis zum Rand oder bis 1,2 E vor eine andere Linie?
                        let weg = 0;
                        while (weg < 60) {
                            const qx = px + nx * (weg + r.cell);
                            const qy = py + ny * (weg + r.cell);
                            if (!drin(r, qx, qy)) break;
                            if (
                                weg > 1 &&
                                (linien.some((andere, b) => b !== a && naechsterPunkt(andere.punkte, qx, qy).d < 1.2) ||
                                    taeler.some((tal) => naechsterPunkt(tal.punkte, qx, qy).d < 1.2))
                            )
                                break;
                            weg += r.cell;
                        }
                        if (weg < 1.5) continue;
                        const laenge =
                            weg *
                            reg.astLaenge *
                            (0.75 + 0.25 * wertRauschen(saat + 613, px * 0.91, py * 0.7 + seite, 1));
                        const stuecke = Math.max(2, Math.round(laenge / SCHRITT));
                        const punkte: [number, number][] = [];
                        const gew: number[] = [];
                        // Der Ast beginnt mit der Höhe seiner Linie an dieser Stelle.
                        const basis =
                            ((0.9 * ((kanten[a]!.gewicht[s - 1] ?? 0.85) + (kanten[a]!.gewicht[s] ?? 0.85))) / 2) *
                            sinkt(a, s, u / (l || 1), l);
                        for (let p = 0; p <= stuecke; p++) {
                            const f = p / stuecke;
                            const biege =
                                0.6 *
                                Math.sin(f * Math.PI) *
                                wertRauschen(saat + 631, px * 0.29 + p * 0.4, py * 0.31, 1);
                            punkte.push([px + nx * laenge * f - ny * biege, py + ny * laenge * f + nx * biege]);
                            gew.push(basis * (0.85 - 0.6 * f));
                        }
                        knoten.push({ art: "ast", x: px, y: py });
                        kanten.push({ art: "ast", quelle: "erzeugt", punkte, gewicht: gew });
                    }
                }
            }
        });
    }
    // Durchhang: Die Kammpunkte und das Gewicht bleiben; die Tiefe je Segment trägt die Kante zur Hebung (`hebe`, Senkung um die Achse).
    if (tiefen)
        linien.forEach((_, a) => {
            if (tiefen[a]!.some((t) => t > 0)) kanten[a] = { ...kanten[a]!, durchhang: tiefen[a]! };
        });
    return { leitkurve: [], kanten, knoten };
}
