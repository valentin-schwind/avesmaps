import { fbm, wertRauschen, zellMuster } from "@avesmaps3d/shared";
import { figur, kammNaehe, linieAus, SCHEMA, zahl, type Punkt, type SchemaFigur } from "./hoehenmodell-vorschau-schema";

/**
 * Die Schemata der Form des Rückens neben den Werten von „19 (Test)“ (WI-0249 P8): Querschnitt quer über den Kamm, Flanke und Kammlinie entlang
 * des Kamms, Rand eines großen Gebirges, Sattel zwischen zwei Gipfeln, die sanfte Welle der Kammhöhe und die Äste von oben. Alle rechnen mit den
 * Formeln des Rückennetzes (`hebung.ts`, `kaemme.ts`) im Eindimensionalen und am selben Beispielgebirge, das die Zeichnung beschreibt: eine
 * Ellipse von 24 × 12 E mit einem geraden Kamm zwischen zwei Gipfeln. Rein, damit die Tests es ohne Browser prüfen.
 */

/**
 * Die Werte, die die Form eines Rückens bestimmen (Typwerte des Rückennetzes und die Werte der V12, die sie übersteuern), wie die Rechnung
 * des Rückennetzes sie liest (`hebung.ts`): Breite, Schärfe (`plateau`), Talboden, Gipfelform (`bergform`), Rauschen, Körnung (als Zahl der
 * Erhebungen, `koernung`), Stufen, das Grundmuster, die Gratlinie, der Randauslauf und das Muster am Kamm.
 */
export interface FormParameter {
    breite: number;
    schaerfe: number;
    talboden: number;
    bergform: number;
    rauschen: number;
    /** Die Zahl der Erhebungen auf der längsten Seite des Gebirges (die Zellweite des Rauschens ist `Seite / Zahl`). */
    koernung: number;
    stufen: number;
    muster: "rauschen" | "zellen";
    grat: number;
    gratBreite: number;
    /** Über wie viele E das Gebirge zum Rand hin auf 0 ausläuft (`form.randBreite`). */
    randBreite: number;
    /** Anteil des Grundmusters auf dem Kamm selbst (`form.kammMuster`); 1 heißt volles Muster, 0 die gezeichnete Höhe. */
    kammMuster: number;
}

/** Das Beispielgebirge: eine Ellipse 24 × 12 E, der Kamm läuft auf y = 6 von x = 3 bis 21, die Saat ist 4711. */
export const BSP = {
    mx: 12,
    my: 6,
    rx: 11.5,
    ry: 5.5,
    kammY: 6,
    kammVon: 3,
    kammBis: 21,
    saat: 4711,
    seite: 24,
} as const;
/** `hebung.ts`: Der Sockel steigt über `max(1, 0,35 · größter Randabstand)` E vom Rand an. */
const BSP_KERN_E = Math.max(1, 0.35 * BSP.ry);
/** Die Flanke liegt so weit (E) vom Kamm; dort ist das Muster voll da (`form.kammMuster` blendet es bis 1 E am Kamm aus). */
export const FLANKE_E = 1.5;
/**
 * Die Breite eines Rückens wechselt je Kantenstück (gleiche Saat, eigene Lage; `hebung.ts`: `breite · (0,85 + 0,3 · (0,5 + 0,5 · Rauschen))`).
 * Das Beispiel hat ein einziges Stück von (3 | 6) bis (21 | 6): Sein Faktor ist hier fest.
 */
const BREITE_FAKTOR =
    0.85 + 0.3 * (0.5 + 0.5 * wertRauschen(BSP.saat + 701, (BSP.kammVon + BSP.kammBis) / 6, (2 * BSP.kammY) / 6, 1));

/** Zeichenpunkte je Schema der Form. */
const PUNKTE = 160;

/** Der Abstand (E) eines Punkts zum Umriss des Beispielgebirges, an 720 Randpunkten gemessen (gemerkt: Die Linien der Schemata sind fest). */
const abstaende = new Map<string, number>();
function randAbstand(x: number, y: number): number {
    const schluessel = `${zahl(x * 100)}|${zahl(y * 100)}`;
    const gemerkt = abstaende.get(schluessel);
    if (gemerkt !== undefined) return gemerkt;
    let kleinster = 0;
    if (((x - BSP.mx) / BSP.rx) ** 2 + ((y - BSP.my) / BSP.ry) ** 2 < 1) {
        kleinster = Infinity;
        for (let i = 0; i < 720; i += 1) {
            const w = (2 * Math.PI * i) / 720;
            kleinster = Math.min(
                kleinster,
                Math.hypot(x - BSP.mx - BSP.rx * Math.cos(w), y - BSP.my - BSP.ry * Math.sin(w)),
            );
        }
    }
    abstaende.set(schluessel, kleinster);
    return kleinster;
}

/**
 * Die Höhe (Anteil der Kammhöhe) des Beispielgebirges in einem Punkt neben dem Kamm: dieselbe Formel wie die Hebung des Rückennetzes
 * (`hebung.ts`) für einen geraden Kamm mit dem Gewicht 1, ohne Gipfel, Durchhang und Kopf. Rücken (rund gegen spitz nach Schärfe und
 * Gipfelform), Sockel (Talboden, zum Rand hin ausgeblendet), Rauschen nach Grundmuster (am Kamm nach `kammMuster` zurückgenommen), Furche
 * neben der Gratlinie, Randauslauf. `mitRauschen` lässt das Grundmuster weg (der Querschnitt zeigt die glatte Form).
 */
export function formHoehe(p: FormParameter, x: number, y: number, mitRauschen: boolean): number {
    const d = Math.abs(y - BSP.kammY);
    const ab = randAbstand(x, y);
    const kern = Math.min(1, ab / BSP_KERN_E);
    const sockel = p.talboden * kern * kern * (3 - 2 * kern);
    const u = d / (Math.max(0.3, p.breite) * BREITE_FAKTOR);
    const rund = Math.exp(-0.5 * u * u);
    const spitz = Math.max(0, 1 - u / 2.6) ** (1 + p.bergform);
    const ruecken = rund * (1 - p.schaerfe) + spitz * p.schaerfe;
    const gratBreite = Math.max(0.1, p.gratBreite);
    const furche =
        Math.min(1, p.grat) * Math.max(0, Math.exp(-0.5 * (d / 2) ** 2) - Math.exp(-0.5 * (d / gratBreite) ** 2));
    let rausch = 0;
    if (mitRauschen && p.rauschen > 0) {
        const zelle = Math.max(0.5, BSP.seite / Math.max(1, p.koernung));
        const stufen = Math.max(1, Math.min(8, Math.round(p.stufen)));
        const muster =
            p.muster === "zellen"
                ? 2 * zellMuster(BSP.saat, x, y, zelle, 0.45 * p.rauschen).c - 1
                : fbm(BSP.saat, x, y, zelle, stufen, 0.5);
        const km = Math.max(0, Math.min(1, p.kammMuster));
        rausch = p.rauschen * muster * (1 - (1 - km) * kammNaehe(d));
    }
    const z = sockel * (1 + 0.5 * rausch) + (1 - sockel) * Math.min(1, ruecken) * (1 + rausch) - furche;
    const auslauf = Math.max(0.5, Math.min(p.randBreite, 0.4 * BSP.ry));
    const fase = Math.max(0, Math.min(1, (ab - 0.24) / auslauf)) ** 0.85;
    return Math.max(0, z * fase);
}

/** Der Querschnitt quer über den Kamm in der Mitte des Beispiels (y von 0,5 bis 11,5): Rücken, Sockel und Randauslauf. */
export function querHoehen(p: FormParameter, proStueck = PUNKTE): number[] {
    return Array.from({ length: proStueck + 1 }, (_, i) => formHoehe(p, BSP.mx, 0.5 + (11 * i) / proStueck, false));
}

/** Die Linie entlang des Kamms im Abstand `abstand` (E) von ihm (x von 3 bis 21), mit dem Grundmuster. */
export function laengsHoehen(p: FormParameter, abstand: number, proStueck = PUNKTE): number[] {
    return Array.from({ length: proStueck + 1 }, (_, i) =>
        formHoehe(p, BSP.kammVon + ((BSP.kammBis - BSP.kammVon) * i) / proStueck, BSP.kammY + abstand, true),
    );
}

/** Die Flanke, `FLANKE_E` neben dem Kamm. */
export const flankenHoehen = (p: FormParameter, proStueck = PUNKTE): number[] => laengsHoehen(p, FLANKE_E, proStueck);

export function schemaQuer(mit: FormParameter, vorher: FormParameter): SchemaFigur {
    const jetzt = querHoehen(mit);
    const davor = querHoehen(vorher);
    const u = (BSP.kammY - 0.5) / 11;
    return figur(jetzt, davor, [{ u, h: jetzt[Math.round(u * PUNKTE)] ?? 1, art: "gipfel" }]);
}

/** Eine niedrige, flache Linie in eigener Höhe (die höchste Stelle von Linie und Vergleich füllt das Bild), damit ihre Schwankung zu sehen ist. */
function eigeneHoehe(jetzt: readonly number[], davor: readonly number[] | null): SchemaFigur {
    const hoechste = Math.max(1e-6, ...jetzt, ...(davor ?? []));
    const skala = 1 / (1.05 * hoechste);
    return figur(
        jetzt.map((h) => h * skala),
        davor?.map((h) => h * skala) ?? null,
        [],
    );
}

/** Die Flanke ist niedrig und flach: Sie steht in ihrer eigenen Höhe. */
export function schemaFlanke(mit: FormParameter, vorher: FormParameter | null): SchemaFigur {
    return eigeneHoehe(flankenHoehen(mit), vorher === null ? null : flankenHoehen(vorher));
}

/** Die Kammlinie selbst: Das Muster liegt dort nur, soweit `kammMuster` es zulässt. */
export function schemaKamm(mit: FormParameter, vorher: FormParameter): SchemaFigur {
    return eigeneHoehe(laengsHoehen(mit, 0), laengsHoehen(vorher, 0));
}

// --- Der Rand eines großen Gebirges ---------------------------------------------------------------------------------------------------

/** Das Gebirge im Schema des Rands ist größer als das Beispiel: Sein größter Randabstand ist 12 E (so wirkt die Randbreite bis 4,8 E). */
const RAND_MAX_E = 12;

/**
 * Von der Küste ins Land (12 E): der Sockel steigt über `max(1, 0,35 · Randabstand-Maximum)` E an und die Höhe läuft über `randBreite` E (höchstens
 * `0,4 · Randabstand-Maximum`) vom Rand auf null aus, beides wie in `hebung.ts`.
 */
export function randHoehen(randBreite: number, talboden = 0.6, proStueck = PUNKTE): number[] {
    return Array.from({ length: proStueck + 1 }, (_, i) => {
        const ab = (i / proStueck) * RAND_MAX_E;
        const kern = Math.min(1, ab / Math.max(1, 0.35 * RAND_MAX_E));
        const sockel = talboden * kern * kern * (3 - 2 * kern);
        const fase =
            Math.max(0, Math.min(1, (ab - 0.24) / Math.max(0.5, Math.min(randBreite, 0.4 * RAND_MAX_E)))) ** 0.85;
        return sockel * fase;
    });
}

export function schemaRand(randBreite: number, talboden = 0.6, vorherBreite = 0.5): SchemaFigur {
    return figur(randHoehen(randBreite, talboden), randHoehen(vorherBreite, talboden), []);
}

// --- Der Sattel zwischen zwei Gipfeln ---------------------------------------------------------------------------------------------------

/** Abstand der zwei Gipfel im Schema (E). */
const SATTEL_LAENGE_E = 16;

/**
 * Ein gezeichneter Kamm zwischen zwei gleich hohen Gipfeln von der Seite: Die Höhe sinkt von jedem Gipfel her auf `sattel` und steigt nicht wieder
 * ganz an (`sattel + (1 − sattel) · exp(−d² / 32)`, d in E zum nächsten Gipfel, `baueAusKaemmen`).
 */
export function sattelHoehen(sattel: number, proStueck = PUNKTE): number[] {
    const s = Math.max(0, Math.min(1, sattel));
    return Array.from({ length: proStueck + 1 }, (_, i) => {
        const t = (i / proStueck) * SATTEL_LAENGE_E;
        const d = Math.min(t, SATTEL_LAENGE_E - t);
        return s + (1 - s) * Math.exp(-(d * d) / 32);
    });
}

export function schemaSattel(sattel: number): SchemaFigur {
    return figur(sattelHoehen(sattel), sattelHoehen(1), [
        { u: 0, h: 1, art: "gipfel" },
        { u: 1, h: 1, art: "gipfel" },
    ]);
}

// --- Die Welle der Kammhöhe ----------------------------------------------------------------------------------------------------------

/** Die Schwankung der Kammhöhe ist so klein (bis 10 % unter der Kammhöhe), dass das Schema sie überhöht zeichnet: um diesen Faktor. */
export const WELLE_UEBERHOEHUNG = 8;
/** Die Höhe 0,9 (der tiefste Wert der Welle) steht im Schema auf diesem Anteil der Bildhöhe. */
const WELLE_UNTEN = 0.08;
const welleY = (h: number): number => WELLE_UNTEN + WELLE_UEBERHOEHUNG * (h - 0.9);

/**
 * Die Höhe entlang des Kamms: Kammhöhe mal `0,95 + 0,05 · Rauschen(Länge / (0,7 · Welle))` (`baueAusKaemmen`), also höchstens die Kammhöhe und
 * bis zu 10 % darunter; überhöht gezeichnet. Gestrichelt steht die Kammhöhe selbst.
 */
export function welleHoehen(welle: number, proStueck = PUNKTE): number[] {
    return Array.from({ length: proStueck + 1 }, (_, i) => {
        const t = ((BSP.kammBis - BSP.kammVon) * i) / proStueck;
        return welleY(0.95 + 0.05 * wertRauschen(BSP.saat + 503, t / (Math.max(1, welle) * 0.7), 0, 1));
    });
}

export function schemaWelle(welle: number): SchemaFigur {
    return figur(
        welleHoehen(welle),
        Array.from({ length: PUNKTE + 1 }, () => welleY(1)),
        [],
    );
}

// --- Die Äste von oben --------------------------------------------------------------------------------------------------------------

/** Schritt, in dem ein Kamm abgelaufen wird, und Zellweite der Wegmessung (E), wie in `baueAusKaemmen`. */
const AST_SCHRITT_E = 0.5;
const AST_ZELLE_E = 0.25;

const imBeispiel = (x: number, y: number): boolean => ((x - BSP.mx) / BSP.rx) ** 2 + ((y - BSP.my) / BSP.ry) ** 2 < 1;

/**
 * Die Seitenäste des Kamms, wie `baueAusKaemmen` sie erzeugt (derselbe Ablauf mit denselben Zufallswerten, am Beispielgebirge; ohne andere
 * Linien, an denen ein Ast enden könnte): Alle `astAbstand` E (mal 0,65 bis 1,35) geht auf jeder Seite ein Ast ab, `astLaenge` mal so lang wie
 * der Weg zum Rand. Linienzüge in E.
 */
export function astLinien(astAbstand: number, astLaenge: number): Punkt[][] {
    const aus: Punkt[][] = [];
    if (!(astAbstand > 0)) return aus;
    const saat = BSP.saat;
    const laenge = BSP.kammBis - BSP.kammVon;
    let lauf = 0.5 * astAbstand * (1 + wertRauschen(saat + 601, 0, 0.5, 1));
    for (let u = 0; u < laenge; u += AST_SCHRITT_E) {
        lauf += AST_SCHRITT_E;
        if (lauf < astAbstand) continue;
        const px = BSP.kammVon + u;
        const py = BSP.kammY;
        lauf = 0.35 * astAbstand * wertRauschen(saat + 607, px * 0.37, py * 0.53, 1);
        for (const seite of [1, -1] as const) {
            const schraeg = 0.45 * wertRauschen(saat + 619, px * 0.53, py * 0.41 + seite, 1);
            const nl = Math.hypot(schraeg, seite) || 1;
            const nx = schraeg / nl;
            const ny = seite / nl;
            let weg = 0;
            while (weg < 60 && imBeispiel(px + nx * (weg + AST_ZELLE_E), py + ny * (weg + AST_ZELLE_E)))
                weg += AST_ZELLE_E;
            if (weg < 1.5) continue;
            const ast = weg * astLaenge * (0.75 + 0.25 * wertRauschen(saat + 613, px * 0.91, py * 0.7 + seite, 1));
            const stuecke = Math.max(2, Math.round(ast / AST_SCHRITT_E));
            const linie: Punkt[] = [];
            for (let p = 0; p <= stuecke; p += 1) {
                const f = p / stuecke;
                const biege = 0.6 * Math.sin(f * Math.PI) * wertRauschen(saat + 631, px * 0.29 + p * 0.4, py * 0.31, 1);
                linie.push([px + nx * ast * f - ny * biege, py + ny * ast * f + nx * biege]);
            }
            aus.push(linie);
        }
    }
    return aus;
}

const planX = (x: number): number => SCHEMA.links + (x / BSP.seite) * (SCHEMA.rechts - SCHEMA.links);
const planY = (y: number): number => 96 - (y / 12) * 92;
const planPunkt = ([x, y]: Punkt): Punkt => [planX(x), planY(y)];

/** Das Gebirge von oben (Norden oben): Umriss, der Kamm zwischen seinen zwei Gipfeln und seine Äste. */
export function schemaAeste(astAbstand: number, astLaenge: number): SchemaFigur {
    const umriss: Punkt[] = Array.from({ length: 72 }, (_, i) => {
        const w = (2 * Math.PI * i) / 72;
        return planPunkt([BSP.mx + BSP.rx * Math.cos(w), BSP.my + BSP.ry * Math.sin(w)]);
    });
    const kamm: Punkt[] = [planPunkt([BSP.kammVon, BSP.kammY]), planPunkt([BSP.kammBis, BSP.kammY])];
    const pfade = [kamm, ...astLinien(astAbstand, astLaenge).map((l) => l.map(planPunkt))];
    return {
        flaeche: `${linieAus(umriss)} Z`,
        linie: pfade.map(linieAus).join(" "),
        vorher: null,
        unterschied: null,
        marken: [BSP.kammVon, BSP.kammBis].map((x) => {
            const [px, py] = planPunkt([x, BSP.kammY]);
            return { x: px, y: py, art: "gipfel" as const };
        }),
        draufsicht: true,
    };
}
