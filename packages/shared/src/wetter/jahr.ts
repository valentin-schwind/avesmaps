import { CALENDAR_MONTHS, DAYS_PER_MONTH, DAYS_PER_YEAR } from "../calendar.ts";
import type { WetterEinheit } from "./modell.ts";

/**
 * Die Jahreszeit des Wetters (WI-0288 Stufe 2): die Werte, die sich mit dem Datum ändern, und die 14 Presets, die sie halten. Server und
 * Browser lesen DIESE Tafel; die Oberfläche (Wetter-Editor, Stufe 3) holt Namen und Sätze aus der Sprachtafel.
 *
 * - **14 feste Presets** (Betreiber 2026-11-07): eines je Monat am 15., eines am 3. Tag des Namenlosen und genau eines
 *   „unbestimmt“, der Kartenstandard ohne Reisebeginn. **Neue dürfen Editoren anlegen** (Betreiber 2026-11-08, siehe unten
 *   `wetterFreierTag`): immer mit einem Tag, nie unbestimmt; die 14 bleiben und lassen sich nicht entfernen. Ein Preset hält NUR die jahreszeitlichen Werte (`WETTER_JAHR_SPALTEN`); die Icons
 *   gelten ganzjährig (`symbole.ts`), alles Übrige steht im Wettermodell (`modell.ts`).
 * - **Zeitpunkte sind eindeutig.** Ein Preset lässt sich auf einen anderen Tag legen; liegt dort schon eines (oder ist „unbestimmt“
 *   gewählt), tauschen beide. Genau eines bleibt unbestimmt.
 * - **Die Vorgaben stehen im Code** (Map Mutation Guard): „unbestimmt“ trägt `WETTER_UNBESTIMMT`, die datierten die Jahrestafel des
 *   Prototyps an ihrem Tag, auf vier Stellen gerundet wie in der abgenommenen Probierseite. Eine leere Tafel heißt Vorgaben; erst die erste
 *   Änderung eines Editors schreibt alle 14 (Server, `apps/server/src/wetter/stand.ts`).
 * - **Zwischen zwei Presets wird weich übergeblendet** (`wetterGeltung`), wie in der Probierseite. Die frühere Sonderregel des Prototyps
 *   (die Tage des Namenlosen nur in einem schmalen Fenster um den Jahreswechsel) entfällt: Das Preset des Namenlosen ist ein Preset wie
 *   jedes andere. Am Tag eines Presets gilt es genau; dazwischen weichen die Werte um wenige Prozent von der alten Fünf-Punkte-Tafel ab.
 */

/** Die Werte, die ein Preset hält, in der Reihenfolge der Engine (`apps/web/src/map/wetter/engine/`, `cfg`). */
export const WETTER_JAHR_SPALTEN = [
    "tn",
    "ts",
    "sunEl",
    "sunPower",
    "feucht",
    "evap",
    "regen",
    "cov",
    "thick",
    "wind",
    "wellen",
    "front",
    "tief",
    "stuerme",
    "evapMeer",
] as const;
export type WetterJahrSpalte = (typeof WETTER_JAHR_SPALTEN)[number];
export type WetterJahreswerte = Readonly<Record<WetterJahrSpalte, number>>;

export const WETTER_JAHR_GRUPPEN = ["temperatur", "licht", "feuchte", "wind"] as const;
export type WetterJahrGruppe = (typeof WETTER_JAHR_GRUPPEN)[number];

export interface WetterJahrWert {
    readonly id: WetterJahrSpalte;
    readonly gruppe: WetterJahrGruppe;
    readonly min: number;
    readonly max: number;
    /** Die Schrittweite eines Reglers; keine Ganzzahlpflicht am Server. */
    readonly schritt: number;
    readonly einheit: WetterEinheit;
    /** Nachkommastellen der Anzeige. */
    readonly stellen: number;
    /** Die Anzeige rechnet mal diesem Faktor (Anteil 0,7 → 70 %). */
    readonly faktor?: number;
}

/**
 * Die Grenzen je Wert: großzügiger als die Regler des Prototyps (dort in Klammern), Spannen aus der abgenommenen Probierseite
 * (`review/wetter-editor/`, nicht versioniert; Betreiber 2026-11-07: „Alle Werte sind zurücksetzbar, die Grenzen großzügig“).
 */
export const WETTER_JAHR_WERTE: readonly WetterJahrWert[] = [
    // Temperatur auf Meereshöhe am Nordrand und am Südrand; dazwischen gleichmäßig, je 1.000 m Höhe 6,5 °C kälter. (−35 bis 25; −5 bis 40)
    { id: "tn", gruppe: "temperatur", min: -50, max: 35, schritt: 0.1, einheit: "celsius", stellen: 1 },
    { id: "ts", gruppe: "temperatur", min: -20, max: 50, schritt: 0.1, einheit: "celsius", stellen: 1 },
    // Sonnenhöhe und Lichtstärke. (−4 bis 85; 0,3 bis 2,5)
    { id: "sunEl", gruppe: "licht", min: -10, max: 90, schritt: 0.5, einheit: "grad", stellen: 1 },
    { id: "sunPower", gruppe: "licht", min: 0, max: 4, schritt: 0.05, einheit: "faktor", stellen: 2 },
    // Grundfeuchte (30 bis 95 %), Verdunstung über Vegetation und über Meer, Abregnen (je 0 bis 3), Bedeckung (0,5 bis 6), Wolkenmächtigkeit
    // (1.000 bis 14.000 m).
    { id: "feucht", gruppe: "feuchte", min: 0.1, max: 1, schritt: 0.01, einheit: "prozent", stellen: 0, faktor: 100 },
    { id: "evap", gruppe: "feuchte", min: 0, max: 5, schritt: 0.05, einheit: "faktor", stellen: 2 },
    { id: "evapMeer", gruppe: "feuchte", min: 0, max: 5, schritt: 0.05, einheit: "faktor", stellen: 2 },
    { id: "regen", gruppe: "feuchte", min: 0, max: 5, schritt: 0.05, einheit: "faktor", stellen: 2 },
    { id: "cov", gruppe: "feuchte", min: 0, max: 10, schritt: 0.05, einheit: "faktor", stellen: 2 },
    { id: "thick", gruppe: "feuchte", min: 500, max: 20000, schritt: 100, einheit: "meter", stellen: 0 },
    // Grundströmung, Wetterlagen, Hebung an Fronten und in Wirbeln, Sturmstärke der Wirbel-Icons (je 0 bis 3).
    { id: "wind", gruppe: "wind", min: 0, max: 5, schritt: 0.05, einheit: "faktor", stellen: 2 },
    { id: "wellen", gruppe: "wind", min: 0, max: 5, schritt: 0.05, einheit: "faktor", stellen: 2 },
    { id: "front", gruppe: "wind", min: 0, max: 5, schritt: 0.05, einheit: "faktor", stellen: 2 },
    { id: "tief", gruppe: "wind", min: 0, max: 5, schritt: 0.05, einheit: "faktor", stellen: 2 },
    { id: "stuerme", gruppe: "wind", min: 0, max: 5, schritt: 0.05, einheit: "faktor", stellen: 2 },
];

export const wetterJahrWert = (id: string): WetterJahrWert | undefined =>
    WETTER_JAHR_WERTE.find((wert) => wert.id === id);

/** Liegt die Eingabe in den Grenzen ihres Werts? Nicht endlich: nein. */
export function wetterJahrImRahmen(wert: WetterJahrWert, eingabe: unknown): eingabe is number {
    return typeof eingabe === "number" && Number.isFinite(eingabe) && eingabe >= wert.min && eingabe <= wert.max;
}

/**
 * Der Kartenstandard: das Preset „unbestimmt“, ohne Reisebeginn. Die Zahlen sind die jahreszeitlichen Werte von `WETTER_VORGABEN` aus dem
 * Prototyp (dort stehen sie seit WI-0288 Stufe 2 nicht mehr, die Engine liest sie von hier).
 */
export const WETTER_UNBESTIMMT: WetterJahreswerte = Object.freeze({
    tn: -6,
    ts: 30,
    sunEl: 38,
    sunPower: 1.25,
    feucht: 0.7,
    evap: 1.3,
    regen: 1.1,
    cov: 1,
    thick: 4400,
    wind: 0.55,
    wellen: 2.55,
    front: 2.2,
    tief: 0.95,
    stuerme: 1,
    evapMeer: 1.3,
});

/**
 * Der Tag, für den „unbestimmt“ steht, wo ein Datum gebraucht wird (WI-0288 Stufe 5: die Schneefallgrenze der Wegfindung kennt nur Tage).
 * Das Preset „unbestimmt“ stammt aus dem Stützpunkt an diesem Tag der Jahrestafel des Prototyps, dem 15. Rahja (Übergang Frühjahr zu Sommer).
 */
export const WETTER_UNBESTIMMT_TAG = 345;

// ---------- Die Jahrestafel des Prototyps: nur noch die Herkunft der datierten Vorgaben ----------

interface Stuetzpunkt extends Record<WetterJahrSpalte, number> {
    tag: number;
}

/** Eine Zeile aus 14 Werten in der Reihenfolge der Spalten; das Meer verdunstet wie die Vegetation, solange es keinen eigenen Wert hat. */
function stuetzpunkt(tag: number, werte: readonly number[]): Stuetzpunkt {
    const zeile = Object.fromEntries(WETTER_JAHR_SPALTEN.map((k, i) => [k, werte[i]])) as Record<
        WetterJahrSpalte,
        number | undefined
    >;
    zeile.evapMeer ??= zeile.evap;
    return { tag, ...(zeile as Record<WetterJahrSpalte, number>) };
}

/**
 * Hochsommer, Herbst, Hochwinter, Frühling und der Übergang Frühjahr zu Sommer (der ist `WETTER_UNBESTIMMT`), dazu die Zeile der Tage des
 * Namenlosen. Setzungen des Prototyps, keine Regelwerksangaben; nur die Sonnenhöhe folgt dem Kalender (`project-control/discovery/wi-0288-wetter-messung/README.md`).
 */
const ALTE_TAFEL: readonly Stuetzpunkt[] = [
    stuetzpunkt(30, [2, 34, 38, 1.3, 0.62, 1.5, 0.9, 0.85, 5600, 0.45, 1.8, 1.4, 1.1, 0.9]),
    stuetzpunkt(120, [-12, 28, 22, 1.1, 0.75, 1.1, 1.25, 1.15, 4200, 0.7, 3, 2.6, 1.1, 1.35]),
    stuetzpunkt(210, [-28, 22, 16, 0.95, 0.72, 0.7, 0.9, 1.05, 3000, 0.75, 2.6, 2.4, 0.8, 0.8]),
    stuetzpunkt(285, [-14, 26, 29, 1.15, 0.72, 1.1, 1.2, 1.05, 3800, 0.6, 2.6, 2.3, 0.9, 1.05]),
    { tag: WETTER_UNBESTIMMT_TAG, ...WETTER_UNBESTIMMT },
];
const ALTE_NAMENLOSE = stuetzpunkt(361, [-6, 30, 38, 0.75, 0.85, 1.6, 1.6, 1.5, 6000, 1, 3.4, 3, 1.4, 1.6]);

const glatt = (x: number): number => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
};

/** Der Wert der alten Jahrestafel an einem Tag: zwischen den Stützpunkten übergeblendet, um die Tage des Namenlosen zu deren Zeile hin. */
function alterJahreswert(k: WetterJahrSpalte, tag: number): number {
    let i = ALTE_TAFEL.findIndex((z) => z.tag > tag);
    i = i <= 0 ? ALTE_TAFEL.length - 1 : i - 1;
    const a = ALTE_TAFEL[i]!;
    const b = ALTE_TAFEL[(i + 1) % ALTE_TAFEL.length]!;
    const s = glatt(
        ((tag - a.tag + DAYS_PER_YEAR) % DAYS_PER_YEAR) / ((b.tag - a.tag + DAYS_PER_YEAR) % DAYS_PER_YEAR),
    );
    const n = tag >= 358 ? glatt((tag - 358) / 3) : tag <= 4 ? 1 - glatt((tag - 1) / 3) : 0;
    const v = a[k] + (b[k] - a[k]) * s;
    return v + (ALTE_NAMENLOSE[k] - v) * n;
}

const rund = (x: number): number => Math.round(x * 10000) / 10000;

// ---------- Die 14 Presets ----------

/** Die Kennung eines Presets aus seinem ersten Platz: `p-u` (unbestimmt), `p-praios` … `p-rahja`, `p-namenlos`. Sie wandert nicht mit. */
export const WETTER_PRESET_ID_MUSTER = "^p-[a-z]{1,12}$";

/** Ein Preset; `tag` ist der Tag im Jahr (1 bis 365, `calendar.ts`), `null` heißt unbestimmt. */
export interface WetterPresetWerte {
    readonly id: string;
    readonly tag: number | null;
    readonly werte: WetterJahreswerte;
}

/** Der Tag eines Presets am 15. eines Monats, Praios ist der erste; das Preset des Namenlosen liegt am 3. Tag (363). */
export const WETTER_PRESET_TAG_NAMENLOS = 12 * DAYS_PER_MONTH + 3;

function datiert(id: string, tag: number): WetterPresetWerte {
    return {
        id,
        tag,
        werte: Object.freeze(
            Object.fromEntries(WETTER_JAHR_SPALTEN.map((k) => [k, rund(alterJahreswert(k, tag))])),
        ) as WetterJahreswerte,
    };
}

/** Die Vorgaben der 14 Presets, in der Reihenfolge der Probierseite: „unbestimmt“, die zwölf Monate, der Namenlose. */
export const WETTER_PRESET_VORGABEN: readonly WetterPresetWerte[] = Object.freeze([
    { id: "p-u", tag: null, werte: WETTER_UNBESTIMMT },
    ...CALENDAR_MONTHS.map((monat, i) => datiert(`p-${monat}`, i * DAYS_PER_MONTH + 15)),
    datiert("p-namenlos", WETTER_PRESET_TAG_NAMENLOS),
]);

export const WETTER_PRESET_IDS: readonly string[] = WETTER_PRESET_VORGABEN.map((preset) => preset.id);

export const wetterPresetVorgabe = (id: string): WetterPresetWerte | undefined =>
    WETTER_PRESET_VORGABEN.find((preset) => preset.id === id);

/** Ist das ein Tag im Jahr (ganz, 1 bis 365)? */
export const istWetterTag = (tag: unknown): tag is number =>
    typeof tag === "number" && Number.isInteger(tag) && tag >= 1 && tag <= DAYS_PER_YEAR;

/**
 * Welche Presets an einem Tag gelten, mit ihrem Anteil (Summe 1): ohne Reisebeginn das unbestimmte, am Tag eines Presets genau dieses, sonst
 * die zwei Nachbarn im Jahreslauf, weich übergeblendet (Probierseite `geltung`). Ohne datiertes Preset gilt das unbestimmte.
 */
export function wetterGeltung(
    presets: readonly Pick<WetterPresetWerte, "id" | "tag">[],
    tag: number | null,
): { id: string; anteil: number }[] {
    const unbestimmt = presets.find((preset) => preset.tag === null) ?? presets[0];
    const datierte = presets
        .filter((preset): preset is { id: string; tag: number } => preset.tag !== null)
        .sort((a, b) => a.tag - b.tag);
    if (tag === null || datierte.length === 0) return unbestimmt ? [{ id: unbestimmt.id, anteil: 1 }] : [];
    const genau = datierte.find((preset) => preset.tag === tag);
    if (genau) return [{ id: genau.id, anteil: 1 }];
    const a = [...datierte].reverse().find((preset) => preset.tag < tag) ?? datierte[datierte.length - 1]!;
    const b = datierte.find((preset) => preset.tag > tag) ?? datierte[0]!;
    if (a.id === b.id) return [{ id: a.id, anteil: 1 }];
    const spanne = (b.tag - a.tag + DAYS_PER_YEAR) % DAYS_PER_YEAR || DAYS_PER_YEAR;
    const x = glatt(((tag - a.tag + DAYS_PER_YEAR) % DAYS_PER_YEAR) / spanne);
    return [
        { id: a.id, anteil: 1 - x },
        { id: b.id, anteil: x },
    ];
}

/** Die jahreszeitlichen Werte an einem Tag (`null`: unbestimmt), aus den Presets übergeblendet. */
export function wetterJahreswerte(presets: readonly WetterPresetWerte[], tag: number | null): WetterJahreswerte {
    const werte = Object.fromEntries(WETTER_JAHR_SPALTEN.map((k) => [k, 0])) as Record<WetterJahrSpalte, number>;
    const geltung = wetterGeltung(presets, tag);
    if (geltung.length === 0) return WETTER_UNBESTIMMT;
    for (const { id, anteil } of geltung) {
        const preset = presets.find((p) => p.id === id)!;
        for (const k of WETTER_JAHR_SPALTEN) werte[k] += preset.werte[k] * anteil;
    }
    return werte;
}

// ---------- Angelegte Presets (WI-0288, Wetter-Editor) ----------

/**
 * Ein Tag für ein neues Preset (Betreiber 2026-11-08: „neben wind, wirbel und meeresströmungen will auch neue presets erlauben. solang es
 * ein datum hat, interpolieren die einstellungen automatisch mit den andern.“): der gewünschte Tag (der Reisebeginn im Editor), wenn er
 * frei ist, sonst die Mitte der größten Lücke zwischen zwei benachbarten datierten Presets, zyklisch über das Jahr (bei gleich großen
 * Lücken die erste im Kalender). `null`, wenn alle 365 Tage belegt sind. Das unbestimmte Preset hat keinen Tag und zählt nicht.
 */
export function wetterFreierTag(
    presets: readonly Pick<WetterPresetWerte, "tag">[],
    wunsch: number | null,
): number | null {
    const tage = [...new Set(presets.map((preset) => preset.tag).filter((tag): tag is number => tag !== null))].sort(
        (a, b) => a - b,
    );
    if (wunsch !== null && istWetterTag(wunsch) && !tage.includes(wunsch)) return wunsch;
    if (tage.length === 0) return wunsch !== null && istWetterTag(wunsch) ? wunsch : WETTER_UNBESTIMMT_TAG;
    if (tage.length >= DAYS_PER_YEAR) return null;
    let beste = { von: tage[0]!, luecke: 0 };
    tage.forEach((von, i) => {
        const bis = i + 1 < tage.length ? tage[i + 1]! : tage[0]! + DAYS_PER_YEAR;
        const luecke = bis - von;
        if (luecke > beste.luecke) beste = { von, luecke };
    });
    return ((beste.von + Math.floor(beste.luecke / 2) - 1) % DAYS_PER_YEAR) + 1;
}

/**
 * Die Werte eines neuen Presets: die am Tag gerade übergeblendeten Werte aller bisherigen Presets, auf vier Stellen gerundet und in die
 * Grenzen jeder Spalte geklemmt. So ändert sich am Wetter nichts, bis jemand das neue Preset verstellt. Server (beim Anlegen) und
 * Oberfläche (für die Anzeige bis zum nächsten Laden) rechnen mit DIESER Regel.
 */
export function wetterNeuePresetWerte(presets: readonly WetterPresetWerte[], tag: number): WetterJahreswerte {
    const gemischt = wetterJahreswerte(presets, tag);
    return Object.fromEntries(
        WETTER_JAHR_SPALTEN.map((k) => {
            const grenzen = wetterJahrWert(k)!;
            return [k, Math.min(grenzen.max, Math.max(grenzen.min, rund(gemischt[k])))];
        }),
    ) as WetterJahreswerte;
}

/** Eine Kennung, die ein Editor angelegt hat: dem Muster nach gültig und keine der 14 Vorgaben. */
export const istAngelegtePresetId = (id: string): boolean =>
    new RegExp(WETTER_PRESET_ID_MUSTER).test(id) && !WETTER_PRESET_IDS.includes(id);
