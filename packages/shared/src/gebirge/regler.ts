import type { RueckennetzTyp } from "./rueckennetz/typen.ts";
import type { V12Controls } from "./types.ts";

/**
 * Werte, Presets und die Auflösung der Regler des Gebirge-Editors (WI-0226). Ohne TypeBox, weil diese Datei auch im Worker der Vorschau
 * rechnet; die Schemas der Leitung stehen in `vertrag.ts`. Zusammen sind beide der Vertrag: was der Reiter „Gebirge“ (Oberfläche
 * WI-0178) über ein Gebirge liest und schreibt, und womit seine Vorschau rechnet. Bauvorlage ist Fassung 16 des Entwurfs; die Entscheidungen des Betreibers vom 2026-10-17:
 *
 * - **F1 Typ als Eigenschaft:** Ein Gebirge trägt seinen Gebirgstyp (`gebirgstyp`); die Werte des Typs stehen im Preset.
 * - **F2 Werte als Abweichung:** Gespeichert wird nur, was ein Editor abweichend setzt; leer heißt „Wert des Typs“ (ohne Typ: Legacys
 *   Vorgabe der Rechnung). ↺ schickt `null`.
 * - **F3 Presets in der Fassung:** Die Presets gehören der Höhenmodell-Fassung (Gruppe `gebirgsPresets`). Hat die gültige Fassung
 *   keine Gruppe (bis Fassung 19), zeigt der Editor die Vorgabe aus diesem Code, markiert „noch nicht in der Fassung“, und die Rechnung
 *   lässt den Typ ohne Wirkung; die Fassung bleibt reproduzierbar (Editor-Orchestrierung 2026-10-18).
 * - **F9 Vorschau nur Gebirge:** grob im Browser, mit der V12 dieses Pakets im Worker (`gebirgsRegler` + `buildMountainRaster`).
 *
 * Alles hängt an der Teilfläche (`region_area.public_id`, Tafel `terrain_control`); jedes der 232 Gebirge hat genau eine (2026-10-18).
 */

/** Die Gebirgstypen in der Folge der Kacheln (Fassung 16). Die Namen kommen aus den Sprachtafeln, nie aus diesem Schlüssel. */
export const GEBIRGSTYPEN = [
    "kammgebirge",
    "gratgebirge",
    "kettengebirge",
    "kuppengebirge",
    "massengebirge",
    "plateaugebirge",
    "rumpfgebirge",
    "schild",
    "inselberg",
    "karst",
    "bergland",
] as const;
export type Gebirgstyp = (typeof GEBIRGSTYPEN)[number];

/** Die Grundmuster: „rauschen“ ist Legacys Weg und die Vorgabe, „zellen“ setzt Berge als Zellspitzen (Betreiber 2026-10-18). */
export const GEBIRGS_MUSTER = ["rauschen", "zellen"] as const;
export type GebirgsMuster = (typeof GEBIRGS_MUSTER)[number];

/** Die zehn Werte der Form in der Folge des Reiters: oben die starken (`form`), eingeklappt die schwachen (`fein`); die Kammhöhe extra. */
export const GEBIRGS_WERTE = [
    "hypsometrie",
    "plateau",
    "rauschen",
    "einschnitt",
    "erosion",
    "talbreite",
    "koernung",
    "stufen",
    "bergform",
    "sattel",
] as const;
export type GebirgsWert = (typeof GEBIRGS_WERTE)[number];

export interface GebirgsWertGrenze {
    min: number;
    max: number;
    schritt: number;
    gruppe: "form" | "fein";
}

/**
 * Grenzen und Schritte der Regler, wie Legacys Dialog (index.html#L2196 u. a.), mit einer Ausnahme: Die Zahl der Erhebungen geht bis 100
 * (Betreiber 2026-10-18: „ich glaub zahl der erhebungen will ein maximum von 100“; Legacy 24). Der Server prüft beim Schreiben dagegen.
 */
export const GEBIRGS_WERT_GRENZEN: Readonly<Record<GebirgsWert, GebirgsWertGrenze>> = {
    hypsometrie: { min: 0, max: 0.7, schritt: 0.01, gruppe: "form" },
    plateau: { min: 0, max: 1, schritt: 0.05, gruppe: "form" },
    rauschen: { min: 0, max: 1, schritt: 0.01, gruppe: "form" },
    einschnitt: { min: 0, max: 3000, schritt: 25, gruppe: "form" },
    erosion: { min: 0, max: 5, schritt: 1, gruppe: "form" },
    talbreite: { min: 0, max: 6, schritt: 0.1, gruppe: "fein" },
    koernung: { min: 1, max: 100, schritt: 0.1, gruppe: "fein" },
    stufen: { min: 1, max: 8, schritt: 1, gruppe: "fein" },
    bergform: { min: 0, max: 12, schritt: 0.1, gruppe: "fein" },
    sattel: { min: 0.3, max: 1, schritt: 0.01, gruppe: "fein" },
};

/** Die Kammhöhe (`maximalhoehe`, Schritt), der wichtigste Wert (Betreiber 2026-10-18); Grenzen wie die Tafel. */
export const GEBIRGS_KAMMHOEHE = { min: 0, max: 20000, schritt: 50 } as const;

/**
 * Was ↺ auf die Vorgabe zurücksetzt (`GebirgsAenderung.zurueck`): Typ, Muster, Kammhöhe und jeder Wert. Eine eigene Liste statt `null`
 * im Feld, weil Fastifys ajv in einer Vereinigung Zahl|null aus `null` still eine 0 macht (Editor-Orchestrierung 2026-10-18, im Muster
 * von `zoomReset` der Beschriftungen).
 */
export const GEBIRGS_ZURUECK = ["typ", "muster", "kammhoehe", ...GEBIRGS_WERTE] as const;
export type GebirgsZurueck = (typeof GEBIRGS_ZURUECK)[number];

/** Legacys Höhenstufen als Schnellwahl der Kammhöhe (`ECOSYSTEM_HYDRO_HOEHENSTUFEN`, hydrologie.js#L317-323, a7f2dac86). */
export const GEBIRGS_HOEHENSTUFEN = ["tiefland", "huegelland", "vorgebirge", "mittelgebirge", "hochgebirge"] as const;
export type GebirgsHoehenstufe = (typeof GEBIRGS_HOEHENSTUFEN)[number];

export interface GebirgsPreset {
    werte: Readonly<Record<GebirgsWert, number>>;
    muster: GebirgsMuster;
    /** Typwerte des Rückennetzes (WI-0246); fehlen sie, gilt der Vorschlag im Code (`rueckennetz/typen.ts`). */
    rueckennetz?: RueckennetzTyp;
}

export interface GebirgsPresetGruppe {
    typen: Readonly<Record<Gebirgstyp, GebirgsPreset>>;
    hoehenstufen: Readonly<Record<GebirgsHoehenstufe, number>>;
}

const legacy = (
    plateau: number,
    hypsometrie: number,
    erosion: number,
    bergform: number,
    rauschen: number,
    sattel: number,
    koernung: number,
    stufen: number,
    talbreite: number,
    einschnitt: number,
): Record<GebirgsWert, number> => ({
    hypsometrie,
    plateau,
    rauschen,
    einschnitt,
    erosion,
    talbreite,
    koernung,
    stufen,
    bergform,
    sattel,
});

/**
 * Die Vorgabe der Presets für Fassung 19 (die Fassung führt die Koordination). Legacys zehn Formen mit Legacys Zahlen
 * (`ECOSYSTEM_HYDRO_MORPHOLOGIEN`, hydrologie.js#L135, a7f2dac86; Folge der Argumente wie dort: Kammschärfe, Massigkeit, Rinnennetz,
 * Ausstrahlung, Rauschen, Durchhang, Zahl, Feinheit, Talbreite, Taltiefe), außer:
 * - **Massengebirge** rechnet mit Zellen (Betreiber 2026-10-18: „Massengebirge, Zellen = Massengebirge“);
 * - **Bergland** ist neu, mit Zellen (Betreiber 2026-10-18: „Bergland, Zellen soll -> Bergland werden“);
 * - Karst bleibt Legacys Karst („Karst, Zellen -> weg“);
 * - **Gratgebirge** schlanker und **Plateaugebirge** tafeliger nach den Quellen (der Betreiber wählte am 2026-10-20 „A Wie die Quellen
 *   (Empfehlung)“): Grat Hypsometrie 0,35, Körnung 8, Stufen 5 (Taunus: 8–9 Talausgänge auf 75 km nach Hovius; Mittel/Höchstwert am Ende
 *   0,55 → etwa 0,45, reif nach Strahler, nicht massiger als das Kammgebirge); Plateau Hypsometrie 0,70 (Schwäbische Alb: Tafel, jung
 *   nach Strahler ab 0,6; am Ende 0,55 → 0,66, Fläche über 80 % der Höhe 17 → 49 %).
 * Die Zahlen von Bergland und Massengebirge sind an der Grundform gefunden und durch Fastscape geprüft (Notizordner `topographie/`).
 */
export const GEBIRGS_PRESETS_VORGABE: GebirgsPresetGruppe = {
    typen: {
        kammgebirge: { werte: legacy(0.9, 0.45, 3, 2, 0.25, 0.95, 14, 3, 1.6, 550), muster: "rauschen" },
        gratgebirge: { werte: legacy(1, 0.35, 5, 2, 0.45, 0.88, 8, 5, 0.9, 800), muster: "rauschen" },
        kettengebirge: { werte: legacy(1, 0.4, 5, 2.5, 0.5, 0.92, 9, 4, 1.1, 1100), muster: "rauschen" },
        kuppengebirge: { werte: legacy(1, 0.33, 4, 3.5, 0.3, 0.55, 9, 4, 1.6, 450), muster: "rauschen" },
        massengebirge: { werte: legacy(0.4, 0.45, 3, 4, 0.7, 0.8, 20, 6, 1.5, 500), muster: "zellen" },
        plateaugebirge: { werte: legacy(0.25, 0.7, 1, 0.5, 0.15, 0.95, 12, 3, 1.5, 500), muster: "rauschen" },
        rumpfgebirge: { werte: legacy(0.85, 0.3, 5, 2, 0.3, 0.8, 16, 5, 2, 400), muster: "rauschen" },
        schild: { werte: legacy(0.15, 0.7, 5, 0.3, 0.12, 0.95, 20, 2, 3, 200), muster: "rauschen" },
        inselberg: { werte: legacy(1, 0.15, 5, 8, 0.2, 0.3, 14, 3, 2.5, 550), muster: "rauschen" },
        karst: { werte: legacy(0.85, 0, 4, 10.5, 0.94, 0.33, 18, 3, 3.8, 1925), muster: "rauschen" },
        bergland: { werte: legacy(0, 0.18, 5, 3, 0.8, 0.6, 18, 7, 0.8, 900), muster: "zellen" },
    },
    hoehenstufen: { tiefland: 150, huegelland: 400, vorgebirge: 800, mittelgebirge: 1500, hochgebirge: 3200 },
};

/** Was an einer Teilfläche gespeichert ist (`terrain_control`): Typ und Abweichungen; `null` heißt jeweils „Vorgabe“. */
export interface GebirgsStand {
    typ: Gebirgstyp | null;
    werte: Partial<Record<GebirgsWert, number>>;
    muster: GebirgsMuster | null;
    kammhoehe: number | null;
}

/**
 * Die Folge der Regler, wie das Gelände sie seit WI-0049 in die Eingabe schreibt. 🔴 Sie geht über `JSON.stringify` in den
 * Fingerabdruck jeder Saat ein (`terrain/inputs.ts`): Eine andere Folge rechnete alle 232 Gebirge neu, obwohl sich nichts änderte.
 */
const REGLER_FOLGE = [
    "koernung",
    "stufen",
    "erosion",
    "plateau",
    "hypsometrie",
    "maximalhoehe",
    "bergform",
    "rauschen",
    "sattel",
    "talbreite",
    "einschnitt",
] as const;

/**
 * Die Regler der V12 aus Preset und Abweichungen: der Wert des Gebirges, sonst der des Typs, sonst nicht gesetzt (Legacys Vorgabe der
 * Rechnung). Die Kammhöhe fällt ohne eigenen Wert auf die Grundhöhe der Fläche zurück. Das Muster steht nur bei „zellen“ in der
 * Eingabe; „rauschen“ ist die Vorgabe und fehlt, damit Gebirge ohne Typ ihren Fingerabdruck behalten. EINE Funktion für das Gelände
 * und die Vorschau.
 */
export function gebirgsRegler(
    preset: GebirgsPreset | null,
    stand: Pick<GebirgsStand, "werte" | "muster" | "kammhoehe">,
    grundhoehe: number | null,
): V12Controls {
    const regler: V12Controls = {};
    for (const schluessel of REGLER_FOLGE) {
        const wert =
            schluessel === "maximalhoehe"
                ? (stand.kammhoehe ?? grundhoehe)
                : (stand.werte[schluessel] ?? preset?.werte[schluessel] ?? null);
        if (wert !== null) regler[schluessel] = wert;
    }
    if ((stand.muster ?? preset?.muster) === "zellen") regler.muster = "zellen";
    return regler;
}
