import {
    durchhangAnteil,
    durchhangProfil,
    ecosystemTalKern,
    ECOSYSTEM_HYDRO_EROSIONSSTUFEN,
    ECOSYSTEM_HYDRO_TALSOHLE_REST,
    FORM_KAMM_E,
    kegelProminenz,
    kopfRadius,
    KOPF_PROFIL,
    KOPF_RADIUS_E,
} from "@avesmaps3d/shared";

/**
 * Die Schemata neben den Werten von „19 (Test)“ (WI-0249): feste Formen in einem Querschnitt, einer Seitenansicht oder von oben, die sich mit
 * dem Wert verformen (Betreiber 2026-10-24: „direkt den slider im schema wirken zu sehen ist außerordentlich hilfreich“). Rein, damit die Tests
 * sie ohne Browser prüfen. Wo die Rechnung eine Formel kennt (Durchhang, Kopf, Form des Rückens, Tal, Äste, hügelige Kappen, Hangdiffusion),
 * steht dieselbe Formel hier im Eindimensionalen; nur Wasser und Erosion sind von Hand gezeichnet, weil sie sich nicht in einer Formel fassen
 * lassen. Die Form des Rückens (Querschnitt, Flanke, Rand, Kamm, Sattel, Äste) steht in `hoehenmodell-vorschau-form.ts`.
 *
 * Alle Zeichnungen liegen in `SCHEMA.breite × SCHEMA.hoehe` Einheiten; die Höhe wächst nach oben (hier nach unten umgerechnet).
 */
export const SCHEMA = { breite: 200, hoehe: 100, links: 6, rechts: 194, grund: 92, skala: 78 } as const;

export type Punkt = readonly [number, number];

export interface SchemaMarke {
    x: number;
    y: number;
    art: "gipfel" | "neben";
}

export interface SchemaFigur {
    /** Die Fläche unter dem Profil mit dem Wert. */
    flaeche: string;
    /** Das Profil mit dem Wert. */
    linie: string;
    /** Gestrichelt: dasselbe ohne den Wert (ohne Durchhang, vor der Erosion, …). */
    vorher: string | null;
    /** Zwischen beiden Linien: was der Wert verändert. */
    unterschied: string | null;
    marken: SchemaMarke[];
    /** Von oben statt von der Seite: Die Grundlinie fehlt, die Fläche ist der Umriss des Gebirges. */
    draufsicht?: boolean;
}

export const zahl = (n: number): string => (Math.round(n * 10) / 10).toString();
export const linieAus = (punkte: readonly Punkt[]): string =>
    punkte.map(([x, y], i) => `${i === 0 ? "M" : "L"}${zahl(x)} ${zahl(y)}`).join(" ");
export const flaecheAus = (punkte: readonly Punkt[]): string => {
    const erster = punkte[0];
    const letzter = punkte.at(-1);
    if (erster === undefined || letzter === undefined) return "";
    return `${linieAus(punkte)} L${zahl(letzter[0])} ${SCHEMA.grund} L${zahl(erster[0])} ${SCHEMA.grund} Z`;
};
/** Die Fläche zwischen zwei Linien über denselben x. */
const zwischenAus = (oben: readonly Punkt[], unten: readonly Punkt[]): string =>
    `${linieAus(oben)} ${[...unten]
        .reverse()
        .map(([x, y]) => `L${zahl(x)} ${zahl(y)}`)
        .join(" ")} Z`;

/** Die Höhe `h` (1 = Kammhöhe) als y der Zeichnung. */
export const hoehenY = (h: number): number => SCHEMA.grund - h * SCHEMA.skala;
/** Der Anteil `u` (0 bis 1) der Breite als x der Zeichnung. */
export const anteilX = (u: number): number => SCHEMA.links + u * (SCHEMA.rechts - SCHEMA.links);

/** Profil aus Höhen (gleichmäßig über die Breite verteilt). */
const ausHoehen = (hoehen: readonly number[]): Punkt[] =>
    hoehen.map((h, i) => [anteilX(i / Math.max(1, hoehen.length - 1)), hoehenY(h)] as const);

export function figur(
    jetzt: readonly number[],
    vorher: readonly number[] | null,
    marken: readonly { u: number; h: number; art: SchemaMarke["art"] }[],
): SchemaFigur {
    const punkte = ausHoehen(jetzt);
    const davor = vorher === null ? null : ausHoehen(vorher);
    return {
        flaeche: flaecheAus(punkte),
        linie: linieAus(punkte),
        vorher: davor === null ? null : linieAus(davor),
        unterschied: davor === null ? null : zwischenAus(davor, punkte),
        marken: marken.map((m) => ({ x: anteilX(m.u), y: hoehenY(m.h), art: m.art })),
    };
}

export const glatt = (t: number): number => {
    const u = Math.max(0, Math.min(1, t));
    return u * u * (3 - 2 * u);
};
export const mische = (a: number, b: number, t: number): number => a + (b - a) * t;

// --- Durchhang -------------------------------------------------------------------------------------------------------------------------

/** Länge eines Kammstücks im Schema (E): Bei 9 E hängt ein Kamm nahezu voll durch (`durchhangAnteil`: 99 %). */
const DURCHHANG_STUECK_E = 9;
/** Höhen der drei Punkte (Anteil der Kammhöhe): zwei Gipfel, in der Mitte ein Nebengipfel, wie im Beispielgebirge der Mini-Rechnung. */
const DURCHHANG_PUNKTE = [1, 0.9, 1] as const;

/** Ein Kamm mit drei Punkten von der Seite. `tiefe` ist der Wert `form.durchhang` (Anteil der Höhe, um den die Mitte eines langen Stücks absinkt). */
export function durchhangHoehen(tiefe: number, proStueck = 40): number[] {
    const t = Math.max(0, Math.min(0.9, tiefe));
    const anteil = durchhangAnteil(DURCHHANG_STUECK_E);
    const aus: number[] = [];
    for (let s = 0; s < 2; s += 1)
        for (let i = s === 0 ? 0 : 1; i <= proStueck; i += 1) {
            const u = i / proStueck;
            const basis = mische(DURCHHANG_PUNKTE[s]!, DURCHHANG_PUNKTE[s + 1]!, u);
            aus.push(basis * (1 - t * anteil * durchhangProfil(u, DURCHHANG_STUECK_E)));
        }
    return aus;
}

export function schemaDurchhang(tiefe: number): SchemaFigur {
    return figur(durchhangHoehen(tiefe), durchhangHoehen(0), [
        { u: 0, h: DURCHHANG_PUNKTE[0], art: "gipfel" },
        { u: 0.5, h: DURCHHANG_PUNKTE[1], art: "neben" },
        { u: 1, h: DURCHHANG_PUNKTE[2], art: "gipfel" },
    ]);
}

// --- Kopf der Nebengipfel --------------------------------------------------------------------------------------------------------------

/** Breite des Ausschnitts (E), Lage von Hauptgipfel und Nebengipfel und seine Höhe (Anteil der Kammhöhe). */
const KOPF_BREITE_E = 10;
const KOPF_GIPFEL_E = 2;
const KOPF_NEBEN_E = 6.5;
const KOPF_NEBEN_H = 0.7;
/** Wie `KOPF_AUSLAUF_E` im Rückennetz (`koepfe.ts`): Die Senkung läuft hinter dem Sattel über diese Weite aus. */
export const KOPF_AUSLAUF_E = 0.75;

/** Das Gelände ohne Kopf: der Hauptgipfel mit einer Schulter, auf der der Nebengipfel nur ein Punkt am Hang ist. */
function schulterHoehe(x: number): number {
    if (x <= KOPF_GIPFEL_E) return mische(0.12, 1, glatt(x / KOPF_GIPFEL_E));
    if (x <= KOPF_NEBEN_E)
        return 1 - (1 - KOPF_NEBEN_H) * ((x - KOPF_GIPFEL_E) / (KOPF_NEBEN_E - KOPF_GIPFEL_E)) ** 1.3;
    return KOPF_NEBEN_H * (1 - ((x - KOPF_NEBEN_E) / 5) ** 1.6);
}

/** Kammhöhe des Beispiels (Schritt): Die Prominenz in Schritt, aus der die Rechnung den Radius des Kegels macht, ist `Anteil · Kammhöhe`. */
const KOPF_KAMM = 3000;
/** Profil des Kegels wie in `formeKoepfe`: ohne Neigung oben spitz (`1 − (1 − u)²`), mit ihr wie die kanonischen Gipfel (`1 − (1 − u)^1,3`). */
const kopfSpitz = (t: number): number => 1 - (1 - Math.max(0, Math.min(1, t))) ** 2;
const kopfKegel = (t: number): number => 1 - (1 - Math.max(0, Math.min(1, t))) ** KOPF_PROFIL;

/**
 * Das Gelände um den Nebengipfel mit Kopf `prominenz` (Anteil der Kammhöhe): Liegt das Gelände höher als das Kopfprofil (der Punkt, nach
 * außen um die Prominenz bis zum Sattel fallend), senkt es sich darauf; hinter dem Sattel läuft die Senkung weich aus. Ohne `neigung` liegt der
 * Sattel in `KOPF_RADIUS_E` und das Profil ist spitz. Mit ihr bekommt der Nebengipfel einen Kegel nach dem Formmodell der kanonischen Gipfel
 * (Radius = Prominenz / (Neigung · 3.000 Schritt je E), `kopfRadius`) und das Gelände darunter hebt sich zu ihm (Sockel, voll bis zur Hälfte
 * des Radius, weich aus bis zum Sattel). Dieselbe Formel wie `formeKoepfe` (`koepfe.ts`), im Eindimensionalen.
 */
export function kopfHoehen(prominenz: number, neigung = 0, proStueck = 160): number[] {
    const p = Math.max(0, prominenz);
    const mitKegel = neigung > 0;
    const radius = mitKegel ? kopfRadius(p * KOPF_KAMM, neigung) : KOPF_RADIUS_E;
    const profil = mitKegel ? kopfKegel : kopfSpitz;
    // Über der Radiusgrenze steigt der Kegel mit der Steilheit (`kegelProminenz`, WI-0249 P9), wie in `formeKoepfe`.
    const hoehe = mitKegel ? kegelProminenz(p * KOPF_KAMM, neigung) / KOPF_KAMM : p;
    const aus: number[] = [];
    for (let i = 0; i <= proStueck; i += 1) {
        const x = (i / proStueck) * KOPF_BREITE_E;
        const roh = schulterHoehe(x);
        const d = Math.abs(x - KOPF_NEBEN_E);
        if (p <= 0 || d >= radius + KOPF_AUSLAUF_E) {
            aus.push(roh);
            continue;
        }
        const deckel = KOPF_NEBEN_H - hoehe * profil(d / radius);
        const gewicht = 1 - glatt((d - radius) / KOPF_AUSLAUF_E);
        let h = Math.max(0, roh - gewicht * Math.max(0, roh - deckel));
        if (mitKegel && d < radius) {
            const unter = deckel - h;
            if (unter > 0) h += (1 - glatt((d / radius - 0.5) / 0.5)) * unter;
        }
        aus.push(h);
    }
    return aus;
}

/** Der Radius des Kopfs (E), vom Gipfelpunkt bis zum Sattel: mit der Neigung aus der Prominenz, sonst `KOPF_RADIUS_E`. */
export const kopfRadiusE = (prominenz: number, neigung: number): number =>
    neigung > 0 ? kopfRadius(Math.max(0, prominenz) * KOPF_KAMM, neigung) : KOPF_RADIUS_E;

export function schemaKopf(prominenz: number, neigung = 0, vorherNeigung: number | null = null): SchemaFigur {
    // Gestrichelt: ohne Kopf; wer an der Neigung zieht, sieht dagegen denselben Kopf ohne Neigung (wie bisher).
    const vorher = vorherNeigung === null ? kopfHoehen(0) : kopfHoehen(prominenz, vorherNeigung);
    return figur(kopfHoehen(prominenz, neigung), vorher, [
        { u: KOPF_GIPFEL_E / KOPF_BREITE_E, h: 1, art: "gipfel" },
        { u: KOPF_NEBEN_E / KOPF_BREITE_E, h: KOPF_NEBEN_H, art: "neben" },
    ]);
}

// --- Erosion im Gelände ----------------------------------------------------------------------------------------------------------------

/** Ein Rücken aus drei Kämmen mit zwei Tälern dazwischen, Breite 16 E. */
const bump = (u: number, breite: number): number => Math.max(0, 1 - (u / breite) ** 2) ** 2;
const kerbe = (u: number, breite: number): number => Math.max(0, 1 - (u / breite) ** 2) ** 2;

export function erosionVorher(proStueck = 160): number[] {
    return Array.from({ length: proStueck + 1 }, (_, i) => {
        const x = (i / proStueck) * 16;
        return Math.min(1, 0.04 + 0.96 * bump(x - 8, 3.4) + 0.58 * bump(x - 3.2, 2.7) + 0.62 * bump(x - 12.8, 2.7));
    });
}

/**
 * Nach der Erosion mit dem Anteil `faktor` (0 bis 1): Wasser schneidet die Täler ein, Gipfel und Kanten werden etwas abgetragen. Von Hand
 * gezeichnet, ohne Formel dahinter: Der Wert reicht von „bleibt wie die Vorschau“ bis „voll erodiert“.
 */
export function erosionNachher(faktor: number, proStueck = 160): number[] {
    const e = Math.max(0, Math.min(1, faktor));
    const vorher = erosionVorher(proStueck);
    return vorher.map((h, i) => {
        const x = (i / proStueck) * 16;
        const taeler = 0.3 * kerbe(x - 5.5, 1.7) + 0.3 * kerbe(x - 10.6, 1.7);
        const kuppen = 0.14 * (bump(x - 8, 1.8) + 0.8 * bump(x - 3.2, 1.4) + 0.8 * bump(x - 12.8, 1.4));
        return Math.max(0.02, h - e * (taeler + kuppen));
    });
}

export function schemaErosion(faktor: number): SchemaFigur {
    return figur(erosionNachher(faktor), erosionVorher(), []);
}

// --- Hangdiffusion ---------------------------------------------------------------------------------------------------------------------

/** Zellen des Ausschnitts: 48 Zellen zu 0,25 E, also 12 E breit. */
const DIFFUSION_ZELLEN = 48;

/** Ein Kamm im Querschnitt, scharf wie eine Saat: drei dreieckige Rücken. */
export function diffusionVorher(): number[] {
    return Array.from({ length: DIFFUSION_ZELLEN + 1 }, (_, i) =>
        Math.max(0, 1 - Math.abs(i - 24) / 11, 0.6 * (1 - Math.abs(i - 9) / 7), 0.7 * (1 - Math.abs(i - 39) / 8)),
    );
}

/**
 * Derselbe Querschnitt nach `runden` Runden Hangdiffusion mit dem Wert `diffusion`: der explizite Schritt des Geländes (jede Zelle nimmt
 * `Koeffizient · Laplace`) in stabilen Teilschritten (`generate.ts`), Rand fest. Eine gerade Rücken-Linie rutscht wie ein Querschnitt.
 */
export function diffusionNachher(diffusion: number, runden: number, zeitschritt = 1): number[] {
    let h = diffusionVorher();
    const teilschritte = Math.max(1, Math.ceil((diffusion * zeitschritt) / 0.2));
    const koeffizient = (diffusion * zeitschritt) / teilschritte;
    const gesamt = Math.max(0, Math.min(400, Math.round(runden))) * teilschritte;
    for (let s = 0; s < gesamt; s += 1) {
        const neu = h.slice();
        for (let i = 1; i < h.length - 1; i += 1)
            neu[i] = Math.max(0, h[i]! + koeffizient * (h[i - 1]! + h[i + 1]! - 2 * h[i]!));
        h = neu;
    }
    return h;
}

export function schemaDiffusion(diffusion: number, runden: number, zeitschritt = 1): SchemaFigur {
    return figur(diffusionNachher(diffusion, runden, zeitschritt), diffusionVorher(), []);
}

// --- Hügel -----------------------------------------------------------------------------------------------------------------------------

/** Die Werte der Landform „Hügel“ (`LandformRecipe` des Rezepts): Höhenspanne in Schritt, Abstand und Größe in Karteneinheiten. */
export interface HuegelRezept {
    minimum: number;
    maximum: number;
    wavelength: number;
    attempts: number;
    radiusAtMinimum: number;
    heightExponent: number;
    overlapPower: number;
}

/** Eine Kappe mit stetiger Steigung, in der Mitte und am Rand ohne Neigung (`hillCap`, `apps/server/src/terrain/domain/hills.ts`). */
export function huegelKappe(
    kappe: { x: number; y: number; radius: number; height: number },
    x: number,
    y: number,
): number {
    const quadrat = ((x - kappe.x) ** 2 + (y - kappe.y) ** 2) / (kappe.radius * kappe.radius);
    return quadrat < 1 ? kappe.height * (1 - quadrat) ** 2 : 0;
}

/**
 * Das Fenster des Hügelschemas (E): Ein Hügel, der so breit wird wie der größte, passt gut viermal hinein; mindestens 12, höchstens 40 E. Mit
 * den Hügeln der Fassung 19 (Radius 0,5 bis 2 E) sind es 16 E, mit älteren (bis 15 E) die vollen 40: So bleiben kleine Hügel auf dem Bild Hügel
 * statt einzelner Striche, und große laufen nicht über den Rand.
 */
export function huegelFenster(rezept: Pick<HuegelRezept, "radiusAtMinimum" | "maximum" | "minimum">): number {
    const radius = (rezept.radiusAtMinimum * rezept.maximum) / Math.max(1e-6, rezept.minimum);
    return Math.max(12, Math.min(40, Math.ceil(8 * radius)));
}

/**
 * Sieben Hügel auf einer Linie, fest gesetzt (Ort als Anteil des Fensters, Zufallsanteil `u` der Höhe); die Größe folgt wie im Gelände aus der
 * Höhe. Das Fenster richtet sich nach der Größe der Hügel (`huegelFenster`): 16 E bei den Hügeln der Fassung 19, bis 40 E bei großen.
 */
const HUEGEL_FEST = [
    [0.075, 0.93],
    [0.225, 0.35],
    [0.375, 0.62],
    [0.5, 0.15],
    [0.675, 0.8],
    [0.8, 0.45],
    [0.925, 0.22],
] as const;

export function huegelHoehen(rezept: HuegelRezept, proStueck = 160): number[] {
    const fenster = huegelFenster(rezept);
    const kappen = HUEGEL_FEST.map(([anteil, u]) => {
        const height = rezept.minimum + (rezept.maximum - rezept.minimum) * u ** rezept.heightExponent;
        return { x: anteil * fenster, y: 0, height, radius: (rezept.radiusAtMinimum * height) / rezept.minimum };
    });
    return Array.from({ length: proStueck + 1 }, (_, i) => {
        const x = (i / proStueck) * fenster;
        let potenzen = 0;
        for (const kappe of kappen) {
            const k = huegelKappe(kappe, x, 0);
            if (k !== 0) potenzen += k ** rezept.overlapPower;
        }
        // 1,15 mal Spanne: Überlappung hebt über die höchste Kappe, soll aber im Bild bleiben.
        return Math.min(1.05, potenzen ** (1 / rezept.overlapPower) / (1.15 * rezept.maximum));
    });
}

export function schemaHuegel(rezept: HuegelRezept): SchemaFigur {
    return figur(huegelHoehen(rezept), null, []);
}

// --- Rinnen und Tal ---------------------------------------------------------------------------------------------------------------------

/** Die Stufe des Rinnennetzes (0 bis 5) als Anteil der Erosionsschritte der höchsten Stufe. */
export const rinnenAnteil = (stufe: number): number => {
    const stufen = ECOSYSTEM_HYDRO_EROSIONSSTUFEN;
    const i = Math.max(0, Math.min(stufen.length - 1, Math.round(stufe)));
    return (stufen[i] as number) / (stufen[stufen.length - 1] as number);
};

/**
 * VORSCHLAG im Rückennetz (`GRAT_ERHALT`, `landschaft.ts`): Auf den Kämmen blendet der Erhalt zusätzlich bis zu diesem Anteil der Form vor der
 * Erosion wieder ein: `e = erhalt + (1 − erhalt) · 0,8 · Nähe zum Kamm`.
 */
export const GRAT_ERHALT = 0.8;
/** Die Kämme des Rückens im Schema der Erosion (Mitte der drei Rücken, E). */
const EROSION_KAEMME = [3.2, 8, 12.8] as const;
/** Die Nähe (1 bis 0, weich) zu einem Kamm: voll bis 0,25 E, aus bei 1 E (`FORM_KAMM_E`, wie im Rückennetz). */
export const kammNaehe = (abstand: number): number => {
    const [voll, aus] = FORM_KAMM_E;
    return 1 - glatt((abstand - voll) / aus);
};

/**
 * Die Form nach der Erosion und dem Erhalt der Grundform, wie `formeLandschaft` sie mischt (`(1 − e) · erodiert + e · vor der Erosion`, `e` auf
 * den Kämmen höher). Die Erosion selbst ist von Hand gezeichnet (`erosionNachher`), die Mischung ist die Formel des Rückennetzes.
 */
export function erhaltHoehen(erosionAnteil: number, erhalt: number, proStueck = 160): number[] {
    const vor = erosionVorher(proStueck);
    const erodiert = erosionNachher(erosionAnteil, proStueck);
    const e0 = Math.max(0, Math.min(1, erhalt));
    return vor.map((h, i) => {
        const x = (i / proStueck) * 16;
        const naehe = Math.max(...EROSION_KAEMME.map((k) => kammNaehe(Math.abs(x - k))));
        const e = e0 + (1 - e0) * GRAT_ERHALT * naehe;
        return (1 - e) * (erodiert[i] as number) + e * h;
    });
}

/** Der Erhalt der Grundform: dieselbe Erosion (höchste Stufe), gestrichelt die Form davor; je höher der Erhalt, desto mehr davon bleibt. */
export function schemaErhalt(erhalt: number): SchemaFigur {
    return figur(erhaltHoehen(1, erhalt), erosionVorher(), []);
}

/** Das Rinnennetz: ein Rücken, dem das Wasser Rinnen gräbt, mit dem Erhalt der Grundform des Typs. Von Hand gezeichnet (`erosionNachher`). */
export function schemaRinnen(stufe: number, erhalt = 0): SchemaFigur {
    return figur(erhaltHoehen(rinnenAnteil(stufe), erhalt), erosionVorher(), []);
}

/** Kammhöhe des Beispiels (Schritt): Der Einschnitt in Schritt wird an ihr gemessen. */
const TAL_KAMM = 3000;
/** Höhe des Hangs im Schema (Anteil der Kammhöhe) und halbe Breite des Ausschnitts (E). */
const TAL_HANG = 0.4;
const TAL_HALB_E = 6;

/**
 * Der Hang quer zu einem Fluss: das Tal der V12 (`valleys.ts`). Der Fluss gräbt sich um `einschnitt` Schritt ein, höchstens bis `TALSOHLE_REST`
 * der Höhe über Null; der Schnitt nimmt von der Achse zur Talbreite (halbe Breite in E) mit dem Kern `ecosystemTalKern` (Smoothstep) ab.
 */
export function talHoehen(einschnitt: number, talbreite: number, proStueck = 160): number[] {
    const tiefe = Math.min(Math.max(0, einschnitt) / TAL_KAMM, TAL_HANG * (1 - ECOSYSTEM_HYDRO_TALSOHLE_REST));
    return Array.from({ length: proStueck + 1 }, (_, i) => {
        const x = -TAL_HALB_E + (2 * TAL_HALB_E * i) / proStueck;
        return TAL_HANG - ecosystemTalKern(Math.abs(x) / Math.max(0.1, talbreite)) * tiefe;
    });
}

export function schemaTal(einschnitt: number, talbreite: number): SchemaFigur {
    return figur(talHoehen(einschnitt, talbreite), talHoehen(0, talbreite), []);
}
