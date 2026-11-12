/**
 * Massigkeit je Typ (Hauptorchestrierung 2026-10-20: „Mittel und 95-%-Höhe in einem belegten Band je Typ“). Gemessen als
 * hypsometrisches Integral HI = Mittelhöhe / Höchsthöhe; der Flächenrand liegt auf 0, darum ist das Minimum 0.
 *
 * Quellen (Notiz `topographie-19-test/gebirgs-presets-quellen.md` §1.2 und §2):
 * - Stadien nach Strahler (1952), belegt bei Prashanth u. a., Gondwana Geol. Soc.: ab 0,6 jung (massig, Hochflächen erhalten),
 *   0,3 bzw. 0,35 bis 0,6 reif, darunter Altersstadium mit Restbergen.
 * - Alpen gegen das Copernicus-DEM rund 0,5 (Legacy #L169-172).
 * - Aventurien, Legacy live 2026-09-04: Rote Sichel 0,276, Finsterkamm 0,233.
 * - Ziel je Typ: der End-HI der kalibrierten V12-Presets („am Ende“ in der Notiz), der dort gegen diese Quellen geprüft ist.
 * Breite des Bands: ± 0,08 (VORSCHLAG), nach unten nie unter das Stadium des Typs.
 */
export interface HiBand {
    ziel: number;
    min: number;
    max: number;
    /** Herkunft im Vorschlag; die Fassung führt sie nicht. */
    quelle?: string;
}

/** Auf Hundertstel, damit die Fassung dieselbe Zahl führt (0,42 − 0,08 ist in Gleitkomma 0,33999…). */
const hundertstel = (v: number): number => Math.round(v * 100) / 100;
const band = (
    ziel: number,
    quelle: string,
    min = hundertstel(ziel - 0.08),
    max = hundertstel(ziel + 0.08),
): HiBand => ({
    ziel,
    min,
    max,
    quelle,
});

/** VORSCHLAG. */
export const HI_BAND_VORSCHLAG: Readonly<Record<string, HiBand>> = {
    kammgebirge: band(0.44, "reif nach Strahler; V12 am Ende 0,44"),
    gratgebirge: band(0.45, "reif; V12 am Ende 0,45 (60 × 20 E)"),
    kettengebirge: band(0.5, "Alpen rund 0,5 (Legacy, Copernicus-DEM); V12 am Ende 0,51"),
    kuppengebirge: band(0.44, "reif; V12 am Ende 0,44"),
    massengebirge: band(0.45, "geschlossene Erhebung, reif; V12 am Ende 0,41, offen bis 0,46–0,51"),
    plateaugebirge: band(0.64, "jung nach Strahler (ab 0,6); V12 am Ende 0,66", 0.58, 0.72),
    rumpfgebirge: band(0.3, "Altersstadium; Aventurien 0,23–0,28 (Legacy); V12 am Ende 0,32", 0.22, 0.38),
    schild: band(0.62, "Tafel, fast alles auf einer Höhe; V12 am Ende 0,65", 0.55, 0.72),
    inselberg: band(0.2, "Monadnock-Stadium (bis 0,3); V12 am Ende 0,19", 0.12, 0.3),
    karst: band(0.42, "reif; V12 (Rorwhed, abgenommen) am Ende 0,41"),
    bergland: band(0.42, "ohne eigene Quelle: Mitte des reifen Stadiums (Betreiberentscheid 2026-10-18 zum Typ)"),
};

/** Erosion und Täler senken das Mittel; die Grundform zielt darum etwas höher (an Blutzinnen und Trollzacken gemessen). */
export const HI_VERLUST_LANDSCHAFT = 0.93;

/** HI = Mittel / Höchstwert über die Fläche. */
export function hypsometrischesIntegral(h: ArrayLike<number>, drin: ArrayLike<number>): number {
    let summe = 0;
    let n = 0;
    let max = 0;
    for (let k = 0; k < h.length; k++) {
        if (!drin[k]) continue;
        const v = h[k] as number;
        summe += v;
        n++;
        if (v > max) max = v;
    }
    return n && max > 0 ? summe / n / max : 0;
}
