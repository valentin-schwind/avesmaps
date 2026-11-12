import type { MapPoint } from "./map-domain.ts";

/**
 * Das Gradnetz (WI-0273, OPS-069): inoffizielle Längen- und Breitengrade über Aventurien, wie auf einer echten Karte.
 *
 * 🔴 **Der Nullpunkt liegt in Gareth, das Maß ist das von DereGlobus** (Betreiber 2026-10-31: erst „DereGlobus“ im Entwurf,
 * Fassung 1, dann „kannst du das gradnetz mit 0 auf gareth legen“). DereGlobus legt Aventurien als Plattkarte auf den Erdglobus.
 * Die Umrechnung nach `aventuria-v1` ist affin in Länge und Breite, gefittet an 1.658 gleichnamigen Orten mit einem Median von
 * 0,23 km (`C:\avesmaps3d-data\dereglobus\BERICHT.md` §3, `analyse/transform.json`). Von dort stammen Maß und Lage der Achsen;
 * verschoben ist nur der Ursprung, von DereGlobus' 0° nach Gareth. Ein Grad Breite misst so gut 100 km, ein Grad Länge gut 90 km.
 *
 * Das Netz ist reine Anzeige: abgeleitet, nie Grundlage für Entfernungen, Routen oder gespeicherte Geometrie.
 */

/** Gareth in `aventuria-v1`: der Nullpunkt des Gradnetzes und die Mitte eines Feldes im Hexraster (`apps/web/src/map/hexraster.ts`). */
export const GARETH_KARTENPUNKT: MapPoint = { x: 551.625, y: 532.969 };

/**
 * Grad → Kartenraum: `x = c.x + lon·lon.x + lat·lat.x`, ebenso `y` (Einheiten zu 3 km, y nach Norden). `lon` und `lat` sind die
 * Achsen von DereGlobus; `c` war dort sein 0° (x 438,07 · y −466,92) und ist jetzt Gareth.
 */
export const GRADNETZ_UMRECHNUNG = {
    c: GARETH_KARTENPUNKT,
    lon: { x: 30.323408076309743, y: 0.009853588007324277 },
    lat: { x: 0.002504503358657928, y: 33.580804974296655 },
} as const;

const T = GRADNETZ_UMRECHNUNG;
const DET = T.lon.x * T.lat.y - T.lat.x * T.lon.y;
const EXTENT = 1024;

export interface Grad {
    lon: number;
    lat: number;
}

export function kartenpunktAusGrad(grad: Grad): MapPoint {
    return {
        x: T.c.x + T.lon.x * grad.lon + T.lat.x * grad.lat,
        y: T.c.y + T.lon.y * grad.lon + T.lat.y * grad.lat,
    };
}

export function gradAusKartenpunkt(punkt: MapPoint): Grad {
    const dx = punkt.x - T.c.x;
    const dy = punkt.y - T.c.y;
    return { lon: (dx * T.lat.y - T.lat.x * dy) / DET, lat: (T.lon.x * dy - dx * T.lon.y) / DET };
}

/**
 * Die Stufen des Netzes, grob nach fein. Jede ist ein Vielfaches der nächsten (10°, 5°, 1°, 30′, 15′, 5′): Eine Linie bleibt
 * stehen, wenn die feinere dazukommt, und wird dann zur Hauptlinie. Eine Stufe erscheint, sobald ihre Linien auf dem Schirm
 * `GRADNETZ_ABSTAND_PX` auseinanderliegen (Entwurf: „bis Bogenminuten“).
 */
export const GRADNETZ_SCHRITTE = [10, 5, 1, 1 / 2, 1 / 4, 1 / 12] as const;
export const GRADNETZ_ABSTAND_PX = 90;

/** Bildpunkte je Grad bei Zoom 0: Die Welt misst `512 · 2^z` Bildpunkte über 1024 Einheiten; das engere der beiden Maße. */
const PX_JE_GRAD_ZOOM_0 = (Math.min(T.lon.x, T.lat.y) * 512) / EXTENT;

export interface GradnetzStufe {
    /** Abstand der Linien in Grad. */
    schritt: number;
    /** Ab diesem Kartenzoom steht die Stufe; die gröbste immer. */
    abZoom: number;
}

export const GRADNETZ_STUFEN: readonly GradnetzStufe[] = GRADNETZ_SCHRITTE.map((schritt, index) => ({
    schritt,
    abZoom: index === 0 ? 0 : Math.log2(GRADNETZ_ABSTAND_PX / (schritt * PX_JE_GRAD_ZOOM_0)),
}));

/** Die feinste Stufe, die bei diesem Zoom steht (Index in `GRADNETZ_STUFEN`). */
export function gradnetzStufe(zoom: number): number {
    let stufe = 0;
    GRADNETZ_STUFEN.forEach((s, index) => {
        if (zoom >= s.abZoom) stufe = index;
    });
    return stufe;
}

export interface GradnetzLinie {
    achse: "lon" | "lat";
    /** Der Wert in Grad: Länge (Ost positiv) oder Breite (Nord positiv). */
    wert: number;
    /** Die gröbste Stufe, zu der die Linie gehört: Ab deren Zoom steht sie. */
    stufe: number;
    von: MapPoint;
    bis: MapPoint;
}

/** Feinster Schritt als ganze Teile eines Grads, damit die Zuordnung zu den Stufen ohne Rundungsfehler bleibt. */
const TEILE = 12;
const TEILE_JE_STUFE = GRADNETZ_SCHRITTE.map((schritt) => Math.round(schritt * TEILE));

/** Alle Linien über den ganzen Kartenraum, auf das Quadrat 0…1024 beschnitten (Liang-Barsky). */
export function gradnetzLinien(): GradnetzLinie[] {
    const ecken = [
        { x: 0, y: 0 },
        { x: EXTENT, y: 0 },
        { x: 0, y: EXTENT },
        { x: EXTENT, y: EXTENT },
    ].map(gradAusKartenpunkt);
    const spanne = (achse: "lon" | "lat"): [number, number] => {
        const werte = ecken.map((e) => e[achse]);
        return [Math.min(...werte), Math.max(...werte)];
    };
    const lon = spanne("lon");
    const lat = spanne("lat");
    const linien: GradnetzLinie[] = [];
    for (const achse of ["lon", "lat"] as const) {
        const [lo, hi] = achse === "lon" ? lon : lat;
        for (let k = Math.ceil(lo * TEILE); k <= Math.floor(hi * TEILE); k += 1) {
            const wert = k / TEILE;
            const quer = achse === "lon" ? lat : lon;
            const a = kartenpunktAusGrad(achse === "lon" ? { lon: wert, lat: quer[0] } : { lon: quer[0], lat: wert });
            const b = kartenpunktAusGrad(achse === "lon" ? { lon: wert, lat: quer[1] } : { lon: quer[1], lat: wert });
            const strecke = beschneide(a, b);
            if (!strecke) continue;
            const stufe = TEILE_JE_STUFE.findIndex((teile) => k % teile === 0);
            linien.push({ achse, wert, stufe, von: strecke[0], bis: strecke[1] });
        }
    }
    return linien;
}

function beschneide(a: MapPoint, b: MapPoint): [MapPoint, MapPoint] | undefined {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const kanten: [number, number][] = [
        [-dx, a.x],
        [dx, EXTENT - a.x],
        [-dy, a.y],
        [dy, EXTENT - a.y],
    ];
    for (const [p, q] of kanten) {
        if (p === 0) {
            if (q < 0) return undefined;
            continue;
        }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return undefined;
    }
    return [
        { x: a.x + t0 * dx, y: a.y + t0 * dy },
        { x: a.x + t1 * dx, y: a.y + t1 * dy },
    ];
}

/** Die Buchstaben der Himmelsrichtungen; sie kommen aus der Sprache der Oberfläche (Ost ist im Französischen „E“, West „O“). */
export interface Himmelsrichtungen {
    nord: string;
    sued: string;
    ost: string;
    west: string;
}

/**
 * Die Grade eines Punktes, immer mit Minuten: `0° 09′ S`, `12° 00′ O`, genau auf dem Nullpunkt `0° 00′`. Für „Was ist hier?“
 * im Infopanel (Betreiber 2026-10-31: „die gradnetz koordinaten ausgeben“); eine Bogenminute misst knapp 2 km.
 */
export function gradPunktText(wert: number, achse: "lon" | "lat", richtung: Himmelsrichtungen): string {
    const gesamt = Math.round(Math.abs(wert) * 60);
    const grad = Math.floor(gesamt / 60);
    const minuten = gesamt % 60;
    const zahl = `${String(grad)}° ${String(minuten).padStart(2, "0")}′`;
    if (gesamt === 0) return zahl;
    const seite =
        achse === "lat" ? (wert > 0 ? richtung.nord : richtung.sued) : wert > 0 ? richtung.ost : richtung.west;
    return `${zahl} ${seite}`;
}

/** `29° 30′ N`, `3° W`, `0°`. Minuten nur, wenn sie gefragt sind und nicht null. */
export function gradText(wert: number, achse: "lon" | "lat", mitMinuten: boolean, richtung: Himmelsrichtungen): string {
    const betrag = Math.abs(wert);
    let grad = Math.floor(betrag + 1e-9);
    let minuten = Math.round((betrag - grad) * 60);
    if (minuten === 60) {
        grad += 1;
        minuten = 0;
    }
    if (grad === 0 && minuten === 0) return "0°";
    const seite =
        achse === "lat" ? (wert > 0 ? richtung.nord : richtung.sued) : wert > 0 ? richtung.ost : richtung.west;
    const zahl =
        mitMinuten && minuten !== 0 ? `${String(grad)}° ${String(minuten).padStart(2, "0")}′` : `${String(grad)}°`;
    return `${zahl} ${seite}`;
}
