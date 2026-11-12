import type { WetterJahrSpalte } from "@avesmaps3d/shared";
import type { GpuZeiten } from "./zeitmessung";

/** Die Einblendungen, die die Schalter im Auge setzen (`wetter-ebene.ts`, `setze`), dazu die Hebungsfarbe der Windpartikel. */
export interface WetterEinblendungen {
    regenkarte: boolean;
    schnee: boolean;
    linie: boolean;
    partikel: boolean;
    wolken: boolean;
    pfarbe: boolean;
    meer: boolean;
    niederschlag: boolean;
}

/**
 * Die Werte des Wettermodells, die die Engine liest: die Kennungen aus `WETTERMODELL_PANELE` (`packages/shared/src/wetter/modell.ts`).
 * Ausdehnung und Raster der Stufen, Takt, gröbste Auflösung und `klimaWeich` gelten nur beim Entstehen (Folge `neustart`).
 */
export interface WetterModellCfg {
    conf: number;
    tempo: number;
    oro: number;
    schicht: number;
    kern: number;
    auge: number;
    density: number;
    scale: number;
    schleier: number;
    schatten: number;
    pmenge: number;
    phell: number;
    plang: number;
    pbreit: number;
    mmenge: number;
    mhell: number;
    mlang: number;
    mbreit: number;
    nmenge: number;
    nhell: number;
    ngross: number;
    nahAb: number;
    nahVoll: number;
    sunAz: number;
    exposure: number;
    shafts: number;
    schneeHang: number;
    klimaWeich: number;
    steps: number;
    /** Die Wolkenauflösung: `"auto"` (im Wettermodell 0) oder der Anteil. */
    res: number | "auto";
    takt: number;
    fpsGrob: number;
    fpsFein: number;
    resMin: number;
    mittelAb: number;
    mittelVoll: number;
    feinAb: number;
    feinVoll: number;
    eFern: number;
    eMittel: number;
    eNah: number;
    rFern: number;
    rMittel: number;
    rNah: number;
}

/** Die jahreszeitlichen Werte (`WETTER_JAHR_SPALTEN`); der Jahreslauf (`wetter-jahr.ts`) schreibt sie in jedem Bild. */
export type WetterJahrCfg = { -readonly [K in WetterJahrSpalte]: number };

/** Werte nur der Geräteprofile, nicht im Wettermodell: die Auflösung, mit der die Automatik beginnt (Vorgabe 0,5; Telefon 0,25). */
export interface WetterProfilCfg {
    resStart?: number;
}

/** `cfg` der Engine: Wettermodell, Jahreswerte und Einblendungen. Die Engine liest es in jedem Schritt oder Bild. */
export type WetterCfg = WetterModellCfg & WetterJahrCfg & WetterEinblendungen & WetterProfilCfg;

/** Ein Icon als Antrieb (`setzeQuellen`, aus `wetter-symbole.ts`): Wind, Wirbel oder Meeresströmung. */
export interface WetterQuelle {
    readonly kind: string;
    /** Lage und Reichweite in Karteneinheiten. */
    readonly x: number;
    readonly z: number;
    readonly r: number;
    /** Richtung im Bogenmaß, 0 ist Osten. */
    readonly dir: number;
    readonly s: number;
    /** Drehsinn der Wirbel. */
    readonly spin: number;
}

/** Was `stand()` meldet: Fortschritt, Leistung, Kamera und Fehler. */
export interface WetterEngineStand {
    readonly bereit: boolean;
    readonly gpu: string;
    readonly fps: number;
    readonly W: number;
    readonly H: number;
    readonly CW: number;
    readonly CH: number;
    /** Die Wolkenauflösung als Anteil. */
    readonly anteil: number;
    /** Wetterschritte je Sekunde. */
    readonly takt: number;
    /** Die Zellgröße der laufenden Stufen in Schritt. */
    readonly stufen: number[];
    readonly dist: number;
    readonly hs: number;
    readonly tx: number;
    readonly tz: number;
    readonly eye: readonly number[];
    readonly peak: number;
    /** Die Temperatur auf Meereshöhe unter der Kamera. */
    readonly sn: number;
    readonly boden: number;
    readonly partikelZahl: number;
    readonly fehler: string | null;
}

/** Die Verteilung eines Werts in einer Lage (`messeWind`). */
export interface Verteilung {
    readonly n: number;
    readonly mitte: number;
    readonly p95: number;
}

/** Die Windmessung der Werkzeuge (`messeWind`): Tempo je Lage, Höhen, Meeresströmung, Wetter nach Vegetation und Lage, Wirbel. */
export interface WindMessung {
    /** 🪤 Wie im Prototyp: Hier steht die Meeresströmung (über Meer und Land), sie überschreibt das Windtempo über dem Meer. */
    readonly meer: Readonly<Record<string, Verteilung>>;
    readonly land: Verteilung;
    readonly kamm: Verteilung;
    readonly hoehen: { readonly p50: number; readonly p90: number; readonly p99: number; readonly max: number };
    readonly vegetation: Readonly<
        Record<
            string,
            {
                readonly n: number;
                readonly wolke: number;
                readonly regen: number;
                readonly dampf: number;
                readonly temp: number;
            }
        >
    >;
    readonly wetter: Readonly<
        Record<
            string,
            {
                readonly n: number;
                readonly wolke: number;
                readonly regen: number;
                readonly dampf: number;
                readonly waerme: number;
                readonly basis: number;
                readonly oben: number;
                readonly bedeckt: number;
            }
        >
    >;
    readonly wirbel: readonly {
        readonly x: number;
        readonly z: number;
        readonly augeKm: number;
        readonly profil: number[][];
    }[];
}

/** Die Engine, wie `wetter-ebene.ts`, `wetter-jahr.ts`, `wetter-symbole.ts` und die Messwerkzeuge sie sehen. */
export interface WetterEngine {
    readonly cfg: WetterCfg;
    readonly sg: Float32Array;
    ein(): void;
    aus(): void;
    sonneGeaendert(): void;
    neuStart(): void;
    /** So viele Einschwing-Schritte zusätzlich, verteilt auf `ms`; mehrere Aufrufe hintereinander summieren sich bis zu einem vollen Einschwingen. */
    zeitraffer(n: number, ms: number): void;
    setPause(p: boolean): void;
    messeWind(): Promise<WindMessung>;
    gpuZeiten(bilder?: number, mitFinish?: boolean): Promise<GpuZeiten>;
    messeDeckung(): Promise<number>;
    /** Wolkenbild in einem festen Weltausschnitt um die Bildmitte: gleiches Raster bei jedem Zoom, deshalb direkt vergleichbar. */
    messeFenster(r: number, n?: number, y?: number): Promise<{ deck: number[]; hell: number[] }>;
    hoehe(x: number, z: number): number;
    vegetation(x: number, z: number): number;
    klimazone(x: number, z: number): number;
    vegetationAn(an: boolean): void;
    istPause(): boolean;
    setzeQuellen(alle: readonly WetterQuelle[]): void;
    projekt(x: number, y: number, z: number): { x: number; y: number } | null;
    aufEbene(px: number, py: number, y: number): { x: number; z: number } | null;
    stand(): WetterEngineStand;
}
