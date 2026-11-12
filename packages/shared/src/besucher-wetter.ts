/**
 * Was die anonyme Besucherstatistik vom experimentellen Wetter erfährt (WI-0288; Betreiber 2026-11-08: „da das feature noch
 * experimentell ist würd ich gerne in production zusätzlich ein paar daten erheben, insbesondere die frametimes, fps der leute - ob
 * sie das feature nutzen usw.“ und „schalten sie das feature ein/aus, bisschen was zur nutzung und bisschen was zur performacnce
 * des experimentellen wetters“).
 *
 * 🔴 **Nur grobe Klassen aus einer festen Menge, nie ein Messwert und nie ein Name.** Die Bildrate kommt als Korb, die Grafikkarte als
 * Familie („nvidia“, „adreno“ …), das Gerät als „rechner“ oder „telefon“. Jede Ausprägung steht als `gerät:klasse` in EINER Zeile;
 * die Zeilen einer Meldung bleiben einzeln, es gibt kein Merkmal aus mehreren Messwerten, das eine Person erkennbar machte.
 *
 * 🪤 Die Klassen passen in die Form `schluessel` des Zählers (Buchstabe vorn, Ziffern, `-` und `:` erlaubt). „unter 15“ heißt deshalb
 * `u15`, „60 und mehr“ `ab60`; das Panel schreibt sie wieder als „<15“ und „60+“ (`statistik-namen.ts`).
 *
 * Gezählt wird je Seitenaufruf, nicht je Person und Tag: Die Frage ist „wie läuft das Wetter auf den Geräten“, und ein Gerät mit zwei
 * Aufrufen am Tag läuft zweimal an.
 */

/** Die Geräteklasse des Wetters: dieselbe Entscheidung wie das Telefon-Profil der Engine (`phoneViewport`). */
export const WETTER_GERAETE = ["rechner", "telefon"] as const;
export type WetterGeraet = (typeof WETTER_GERAETE)[number];

/** Die Metriken, die nur das Wetter sendet. Die Wetterschalter selbst zählen als `display_toggle` (`wetter_<id>:on|off`). */
export const WETTER_METRIKEN = [
    "wetter_lauf",
    "wetter_start",
    "wetter_bildrate",
    "wetter_spitze",
    "wetter_aufloesung",
    "wetter_gpu",
    "wetter_fehler",
] as const;
export type WetterMetrik = (typeof WETTER_METRIKEN)[number];

/**
 * Die Klassen aus ihren Grenzen, aufsteigend, wie das Panel sie zeigt: `u<erste>`, `a-b` …, `ab<letzte>`, mit Endung (`s` für Sekunden).
 * Feines Raster (Betreiber 2026-11-08: „du kannst gerne ein feineres binning und mehrere kategorien in einem histogramm (z.b. FPS in 10
 * ms schritte auf Telefon, PC...)“): Bildrate in Schritten von 10 bis 120 (Bildschirme mit 120 Hz), Bildzeit-Spitze in Schritten von
 * 10 ms bis 100, Start in Sekunden bis 10, darüber gröber.
 */
function klassenAus(grenzen: readonly number[], endung = ""): string[] {
    return [
        `u${String(grenzen[0])}${endung}`,
        ...grenzen.slice(1).map((grenze, i) => `${String(grenzen[i])}-${String(grenze)}${endung}`),
        `ab${String(grenzen[grenzen.length - 1])}${endung}`,
    ];
}
const BILDRATE_GRENZEN = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120] as const;
const SPITZE_GRENZEN = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const START_GRENZEN_S = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30] as const;

export const WETTER_BILDRATE_KLASSEN: readonly string[] = klassenAus(BILDRATE_GRENZEN);
export const WETTER_SPITZE_KLASSEN: readonly string[] = klassenAus(SPITZE_GRENZEN);
export const WETTER_START_KLASSEN: readonly string[] = klassenAus(START_GRENZEN_S, "s");
export const WETTER_GPU_FAMILIEN = [
    "nvidia",
    "amd",
    "intel",
    "apple",
    "adreno",
    "mali",
    "powervr",
    "software",
    "andere",
    "unbekannt",
] as const;
export const WETTER_FEHLER_ARTEN = [
    "gleitkomma",
    "bildpuffer",
    "shader",
    "kachel",
    "webgl2",
    "laden",
    "andere",
] as const;

/** Der Korb, in den `wert` fällt: `grenzen[i]` ist die Obergrenze (exklusiv) von `klassen[i]`, die letzte Klasse nimmt den Rest. */
function korb<K extends string>(wert: number, grenzen: readonly number[], klassen: readonly K[]): K {
    const i = grenzen.findIndex((grenze) => wert < grenze);
    return klassen[i === -1 ? klassen.length - 1 : i]!;
}

/** Bilder je Sekunde (Median) als Korb. Keine endliche Zahl zählt als der unterste. */
export const wetterBildrateKlasse = (fps: number): string =>
    korb(Number.isFinite(fps) ? fps : 0, BILDRATE_GRENZEN, WETTER_BILDRATE_KLASSEN);

/** Der Abstand der Bilder in Millisekunden (95. Perzentil) als Korb. */
export const wetterSpitzeKlasse = (ms: number): string =>
    korb(Number.isFinite(ms) ? ms : 0, SPITZE_GRENZEN, WETTER_SPITZE_KLASSEN);

/** Dauer vom ersten Einschalten bis zum ersten `bereit`, in Millisekunden, als Korb. */
export const wetterStartKlasse = (ms: number): string =>
    korb(
        Number.isFinite(ms) ? ms : 0,
        START_GRENZEN_S.map((s) => s * 1000),
        WETTER_START_KLASSEN,
    );

/** Die Wolkenauflösung (Anteil 0..1) als ganze fünf Prozent: `0.27` wird `"25"`. */
export function wetterAufloesungKlasse(anteil: number): string {
    const prozent = Number.isFinite(anteil) ? Math.min(100, Math.max(0, anteil * 100)) : 0;
    return String(Math.round(prozent / 5) * 5);
}

/**
 * Die Familie einer Grafikkarte aus dem Namen, den `WEBGL_debug_renderer_info` nennt. Der Name selbst geht nie raus.
 *
 * 🪤 Software zuerst: SwiftShader und llvmpipe melden sich oft als „ANGLE (Google, Vulkan … SwiftShader …)“ oder tragen den Namen
 * einer echten Marke im Text. Gesucht wird an Wortgrenzen, wo ein Kürzel kurz ist (`ati`, `mali`).
 */
export function wetterGpuFamilie(name: string): (typeof WETTER_GPU_FAMILIEN)[number] {
    const text = name.trim().toLowerCase();
    if (text === "") return "unbekannt";
    if (/swiftshader|llvmpipe|softpipe|microsoft basic render|software/.test(text)) return "software";
    if (/nvidia|geforce|quadro|\b[rg]tx\b/.test(text)) return "nvidia";
    if (/\bamd\b|radeon|\bati\b/.test(text)) return "amd";
    if (/\bintel\b/.test(text)) return "intel";
    if (/\bapple\b/.test(text)) return "apple";
    if (/adreno|qualcomm/.test(text)) return "adreno";
    if (/\bmali\b|mali-/.test(text)) return "mali";
    if (/powervr|imagination/.test(text)) return "powervr";
    return "andere";
}

/** Die Art eines Engine-Fehlers aus seinem Text; kein Freitext, sondern eine feste Menge. */
export function wetterFehlerArt(text: string): (typeof WETTER_FEHLER_ARTEN)[number] {
    const roh = text.toLowerCase();
    if (/gleitkomma/.test(roh)) return "gleitkomma";
    if (/bildpuffer|framebuffer/.test(roh)) return "bildpuffer";
    if (/shader|programm/.test(roh)) return "shader";
    if (/kachel/.test(roh)) return "kachel";
    if (/webgl|kontext/.test(roh)) return "webgl2";
    return "andere";
}

/** Die Ausprägung, wie sie reist: `rechner:30-45`; ohne Klasse nur das Gerät (`wetter_lauf`). */
export const wetterDimension = (geraet: WetterGeraet, klasse?: string): string =>
    klasse === undefined ? geraet : `${geraet}:${klasse}`;

/**
 * Die Form einer Wetter-Ausprägung, die der Server annimmt: ein Gerät, dahinter höchstens eine Klasse aus Buchstaben, Ziffern und
 * Bindestrich. Strenger als die allgemeine `schluessel`-Form: Gemeldet wurde hier nie etwas anderes als diese Menge.
 */
export const WETTER_DIMENSION_FORM = /^(rechner|telefon)(:[A-Za-z0-9-]{1,12})?$/;

/** Die Zählkennung eines Wetterschalters im Auge, im Stil der übrigen (`schalterKennung`): `wetter_wolken:on`. */
export const wetterSchalterKennung = (id: string, an: boolean): string => `wetter_${id}:${an ? "on" : "off"}`;
