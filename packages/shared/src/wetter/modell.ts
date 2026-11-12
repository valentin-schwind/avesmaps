/**
 * Das Wettermodell (WI-0288 Stufe 2): alle Werte des Wetters, die nicht mit der Jahreszeit wandern, mit Vorgabe, Grenzen, Einheit und der
 * Angabe, wann eine Änderung greift. Nach dem Muster der Wegfindung (`packages/shared/src/wegfindung.ts`): Gespeichert wird nur, was
 * verstellt ist; `null` im Schreibweg setzt zurück (die Zeile fällt weg).
 *
 * - Der Betreiber hat die Werte einstellbar verlangt (2026-11-07: „Globale Werte stehen im Reiter „Wettermodell“ der Systemsteuerung …
 *   Alle Werte sind zurücksetzbar, die Grenzen großzügig.“). Das ist die Anwendung von „Regler melden“, keine Ausnahme davon.
 * - Bestand: die übrigen Regler des Prototyps und die bis Stufe 1 festen Zahlen der Engine (Stufenübergänge nach Kameraabstand, Regen und
 *   Schnee nah, Takt, Schwellen der Automatik, gröbste Wolkenauflösung, Ausdehnung und Raster der drei Stufen). Reiter und Panele, Spannen
 *   und Schritte aus der abgenommenen Probierseite (`review/wetter-editor/`, nicht versioniert).
 * - 🪤 **Regen und Schnee nah** stehen hier als Kameraabstand (wie die Stufenübergänge, 1 Einheit sind 3 km), die Probierseite zeigte sie als
 *   Zoom („ab Zoom 5, voll ab Zoom 6“). Die Engine rechnet mit dem Abstand; der Reiter (Stufe 4, `apps/web/src/wettermodell/wettermodell.ts`)
 *   zeigt ihn als fachliche Zoomstufe für eine 900 px hohe Karte (85 → 4,0, 45 → 4,9) und rechnet die getippte Stufe zurück.
 * - Namen und Sätze stehen in den Sprachtafeln (`admin.wettermodell.*`, Stufe 4); hier stehen nur Zahlen und Kennungen.
 */

/** Wie eine Zahl angezeigt wird; die Wörter dazu stehen in der Sprachtafel. */
export type WetterEinheit =
    "celsius" | "grad" | "faktor" | "prozent" | "meter" | "km" | "zahl" | "je_sekunde" | "fps" | "einheiten" | "zellen";

/**
 * Wann eine Änderung greift:
 * - `sofort`: Die Engine liest den Wert in jedem Schritt oder Bild; er gilt, sobald der Browser ihn hat (beim nächsten Einschalten des
 *   Wetters oder neuen Laden der Seite).
 * - `neustart`: Der Wert baut die Felder oder Tafeln der Engine; er gilt erst, wenn das Wetter neu entsteht, also nach dem Neuladen der Seite.
 */
export type WettermodellFolge = "sofort" | "neustart";

export const WETTERMODELL_REITER = ["wind", "partikel", "licht", "leistung"] as const;
export type WettermodellReiter = (typeof WETTERMODELL_REITER)[number];

export interface WettermodellWert {
    /** Die Kennung, unter der ein abweichender Wert gespeichert wird; für die Werte des Prototyps sein Name in `cfg`. */
    readonly id: string;
    readonly vorgabe: number;
    readonly min: number;
    readonly max: number;
    readonly schritt: number;
    readonly einheit: WetterEinheit;
    readonly stellen: number;
    readonly faktor?: number;
    readonly folge: WettermodellFolge;
    /** Nur diese Werte sind erlaubt (die Wolkenauflösung: 0 heißt automatisch). */
    readonly auswahl?: readonly number[];
}

export interface WettermodellPanel {
    /** Die Kennung des Panels; sein Titel steht in der Sprachtafel. */
    readonly id: string;
    readonly reiter: WettermodellReiter;
    readonly werte: readonly WettermodellWert[];
}

const w = (
    id: string,
    vorgabe: number,
    min: number,
    max: number,
    schritt: number,
    einheit: WetterEinheit,
    stellen: number,
    extra: { faktor?: number; folge?: WettermodellFolge; auswahl?: readonly number[] } = {},
): WettermodellWert => ({ id, vorgabe, min, max, schritt, einheit, stellen, folge: extra.folge ?? "sofort", ...extra });

/** Die Panele in der Reihenfolge des Reiters. */
export const WETTERMODELL_PANELE: readonly WettermodellPanel[] = [
    {
        id: "wind",
        reiter: "wind",
        werte: [
            // Verwirbelung, Simulationstempo (0 hält an), Hebung am Gelände, Höhe der Luftschicht (flach um Kämme herum, hoch darüber).
            w("conf", 1.35, 0, 8, 0.05, "faktor", 2),
            w("tempo", 0.1, 0, 10, 0.05, "faktor", 2),
            w("oro", 1.25, 0, 6, 0.05, "faktor", 2),
            w("schicht", 1800, 500, 20000, 100, "meter", 0),
        ],
    },
    {
        id: "wirbel",
        reiter: "wind",
        werte: [
            // Verdichtung zur Mitte eines Wirbels; Auge des Sturms (1,00 sind rund 33 km Durchmesser).
            w("kern", 0.5, 0, 2, 0.05, "faktor", 2),
            w("auge", 0.2, 0, 5, 0.05, "faktor", 2),
        ],
    },
    {
        id: "wolkenbild",
        reiter: "wind",
        werte: [
            // Nur beim Zeichnen: optische Dichte, Wolkenmaßstab, Regenschleier, Wolkenschatten am Boden.
            w("density", 0.75, 0.1, 8, 0.05, "faktor", 2),
            w("scale", 0.9, 0.2, 5, 0.05, "faktor", 2),
            w("schleier", 0.75, 0, 5, 0.05, "faktor", 2),
            // 50 % seit WI-0290 (2026-11-08): Mit 10 % war der Wolkenschatten kaum zu sehen.
            w("schatten", 0.5, 0, 1, 0.01, "prozent", 0, { faktor: 100 }),
        ],
    },
    {
        id: "windpartikel",
        reiter: "partikel",
        werte: [
            w("pmenge", 1.15, 0.05, 8, 0.05, "faktor", 2),
            w("phell", 1.1, 0.05, 4, 0.05, "faktor", 2),
            w("plang", 1, 0.1, 8, 0.05, "faktor", 2),
            w("pbreit", 1, 0.2, 6, 0.05, "faktor", 2),
        ],
    },
    {
        id: "meeresstroemung",
        reiter: "partikel",
        werte: [
            w("mmenge", 1, 0.05, 8, 0.05, "faktor", 2),
            w("mhell", 1, 0.05, 4, 0.05, "faktor", 2),
            w("mlang", 1, 0.1, 8, 0.05, "faktor", 2),
            w("mbreit", 1, 0.2, 6, 0.05, "faktor", 2),
        ],
    },
    {
        id: "regenUndSchnee",
        reiter: "partikel",
        werte: [
            w("nmenge", 1, 0.05, 8, 0.05, "faktor", 2),
            w("nhell", 1, 0.05, 4, 0.05, "faktor", 2),
            w("ngross", 1, 0.05, 6, 0.05, "faktor", 2),
            // Bis Stufe 1 fest in der Engine (`zeichneNiederschlag`, `sstep(45,85,cam.dist)`): näher als `nahAb` blendet es ein, ab `nahVoll` voll.
            w("nahAb", 85, 10, 400, 5, "einheiten", 0),
            w("nahVoll", 45, 5, 400, 5, "einheiten", 0),
        ],
    },
    {
        id: "licht",
        reiter: "licht",
        werte: [
            // Sonnenrichtung (270 ° ist Westen), Belichtung, Lichtstrahlen; Sonnenhöhe und Lichtstärke stehen in den Presets.
            w("sunAz", 250, 0, 360, 1, "grad", 0),
            w("exposure", 0.52, 0.05, 3, 0.01, "zahl", 2),
            w("shafts", 0.2, 0, 4, 0.05, "zahl", 2),
        ],
    },
    {
        id: "schneeAmBoden",
        reiter: "licht",
        werte: [
            w("schneeHang", 18, 0, 90, 1, "grad", 0),
            // Wie weich die Schneefallgrenze zwischen zwei Klimazonen übergeht (Betreiber 2026-11-08: „der übergang der klima zonen ist ziemlich
            // hart, kannst du das weicher ineinander übergehen lassen?“): Sigma des Weichzeichners in km; 0 springt an der Zonengrenze wie die Wegfindung.
            w("klimaWeich", 30, 0, 150, 5, "km", 0, { folge: "neustart" }),
        ],
    },
    {
        id: "bildqualitaet",
        reiter: "leistung",
        werte: [
            w("steps", 56, 8, 256, 4, "zahl", 0),
            // 0 heißt automatisch (`res: "auto"` in der Engine): gröber, wenn die Bildrate fällt, wieder feiner, wenn sie reicht.
            w("res", 0, 0, 1, 0, "prozent", 0, { faktor: 100, auswahl: [0, 1, 0.75, 0.5, 0.33] }),
        ],
    },
    {
        id: "automatik",
        reiter: "leistung",
        werte: [
            // Bis Stufe 1 fest: höchstens 30 Wetterschritte je Sekunde (darunter 20, 15, 10), gröber unter 36 FPS, feiner über 57, gröbste
            // Auflösung 25 %. Takt und gröbste Auflösung bauen die Stufen der Automatik beim Entstehen des Wetters.
            w("takt", 30, 5, 60, 1, "je_sekunde", 0, { folge: "neustart" }),
            w("fpsGrob", 36, 10, 60, 1, "fps", 0),
            w("fpsFein", 57, 20, 144, 1, "fps", 0),
            w("resMin", 0.25, 0.1, 1, 0.05, "prozent", 0, { faktor: 100, folge: "neustart" }),
        ],
    },
    {
        id: "detailstufen",
        reiter: "leistung",
        werte: [
            // Bis Stufe 1 fest (`updateWorld`): Die Mittelstufe blendet unter 900 ein und gilt ab 600 allein, die Feinstufe 220 und 140.
            w("mittelAb", 900, 100, 3000, 10, "einheiten", 0),
            w("mittelVoll", 600, 50, 3000, 10, "einheiten", 0),
            w("feinAb", 220, 20, 1000, 10, "einheiten", 0),
            w("feinVoll", 140, 10, 1000, 10, "einheiten", 0),
            // Ausdehnung und Raster der drei Stufen bauen die Wetterfelder (`D0`, `W0`, `WN`, `WL`): greift nach dem Neuladen.
            w("eFern", 2560, 1024, 4096, 64, "einheiten", 0, { folge: "neustart" }),
            w("eMittel", 320, 64, 1024, 16, "einheiten", 0, { folge: "neustart" }),
            w("eNah", 80, 16, 320, 8, "einheiten", 0, { folge: "neustart" }),
            w("rFern", 1536, 512, 4096, 128, "zellen", 0, { folge: "neustart" }),
            w("rMittel", 768, 256, 2048, 128, "zellen", 0, { folge: "neustart" }),
            w("rNah", 768, 256, 2048, 128, "zellen", 0, { folge: "neustart" }),
        ],
    },
];

/** Jeder Wert über alle Panele, in der Reihenfolge der Anzeige. */
export const WETTERMODELL_WERTE: readonly WettermodellWert[] = WETTERMODELL_PANELE.flatMap((panel) => panel.werte);

/** Die Kennung einer Einstellung: wie bei der Wegfindung. */
export const WETTERMODELL_ID_MUSTER = "^[a-z][A-Za-z0-9]{0,59}$";

export const wettermodellWert = (id: string): WettermodellWert | undefined =>
    WETTERMODELL_WERTE.find((wert) => wert.id === id);

export type Wettermodellwerte = Readonly<Record<string, number>>;

/** Die Vorgaben aller Werte, nach Kennung. */
export const wettermodellVorgaben = (): Wettermodellwerte =>
    Object.fromEntries(WETTERMODELL_WERTE.map((wert) => [wert.id, wert.vorgabe]));

/**
 * Wer kleiner bleiben muss als wer: Ein Übergang braucht seinen Anfang weiter draußen als sein volles Ende (`sstep(voll, ab, d)` teilte
 * sonst durch null oder kehrte sich um), und die Automatik braucht zwischen „gröber unter“ und „feiner über“ eine Lücke, sonst pendelt sie.
 */
export const WETTERMODELL_PAARE: readonly { readonly kleiner: string; readonly groesser: string }[] = [
    { kleiner: "mittelVoll", groesser: "mittelAb" },
    { kleiner: "feinVoll", groesser: "feinAb" },
    { kleiner: "nahVoll", groesser: "nahAb" },
    { kleiner: "fpsGrob", groesser: "fpsFein" },
];

/** Liegt die Eingabe in den Grenzen (und, wo es eine gibt, in der Auswahl) ihres Werts? Nicht endlich: nein. */
export function wettermodellImRahmen(wert: WettermodellWert, eingabe: unknown): eingabe is number {
    if (typeof eingabe !== "number" || !Number.isFinite(eingabe)) return false;
    if (wert.auswahl !== undefined) return wert.auswahl.includes(eingabe);
    return eingabe >= wert.min && eingabe <= wert.max;
}

/**
 * Die wirksamen Werte: die Vorgaben, überschrieben von den gespeicherten Abweichungen. Eine Kennung, die die Tafel nicht kennt, oder ein
 * Wert außerhalb seiner Grenzen wird übergangen (ein Rückweg auf ein älteres Release, eine Hand am SQL).
 */
export function wettermodellWirksam(abweichungen: Readonly<Record<string, unknown>>): Wettermodellwerte {
    const werte: Record<string, number> = { ...wettermodellVorgaben() };
    for (const [id, zahl] of Object.entries(abweichungen)) {
        const wert = wettermodellWert(id);
        if (wert !== undefined && wettermodellImRahmen(wert, zahl)) werte[id] = zahl;
    }
    return Object.freeze(werte);
}

/** Verletzen die Werte eine Reihenfolge aus `WETTERMODELL_PAARE`? Das erste verletzte Paar, sonst `undefined`. */
export function wettermodellPaarFehler(
    werte: Wettermodellwerte,
): { readonly kleiner: string; readonly groesser: string } | undefined {
    return WETTERMODELL_PAARE.find((paar) => !(werte[paar.kleiner]! < werte[paar.groesser]!));
}
