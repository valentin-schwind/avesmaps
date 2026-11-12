/**
 * Die GESTALT der Wegpunktmarken - EINE Quelle für beide Stellen, an denen sie gezeichnet werden (WI-0087 P6,
 * Betreiber 2026-10-05: „übernimm doch nicht die bilder sondern direkt die symbole von oben").
 *
 * - Die Oberfläche zeichnet sie als Inline-SVG (`waypoint-mark.vue`): Wegpunkteingabe und Etappenliste.
 * - Die Karte braucht ein Rasterbild (MapLibre nimmt für `icon-image` kein SVG) und malt dieselben Formen auf ein
 *   Canvas (`map/route-layers.ts` `drawRouteMarkerImage`).
 *
 * 🪤 **Vorher waren das zwei Fassungen, und sie waren auseinandergelaufen** (gemessen 2026-10-05): Die Karte zog um
 * die Füllung des Rings zusätzlich eine goldene Kontur (`markerWaypointRing`, r 14,5, Breite 2) und säumte das Auge
 * damit; das SVG kannte beides nicht. Karte und Panel zeigten also nicht dasselbe Zeichen. Seit der
 * Zusammenführung gilt die Fassung der Oberfläche - „die symbole von oben" - für beide.
 *
 * 🔴 **Außenmaß und Mittelpunkt sind unantastbar.** Die Spitze des Tropfens liegt genau auf der Unterkante seines
 * viewBox und ist sein Ankerpunkt auf der Karte; `CHAIN_ANCHOR` hängt an denselben Maßen. Geändert wird nur das
 * VERHÄLTNIS von Rand zu Füllung.
 */

/**
 * Der dunkle Rand des Rings, in Einheiten seines viewBox.
 *
 * 🔴 **Gleichstand mit dem Tropfen** (Betreiber 2026-10-05: „kannst du den schwarzen rand der wegpunkte dem des
 * tropfens angleichen?"). Nachgerechnet und am Bild bestätigt:
 *
 * | | viewBox | gezeichnet bei `size` 18 | Maßstab | Rand in Einheiten | Rand in px |
 * |---|---|---|---|---|---|
 * | Ring | 34 × 34 | 18 × 18 | 0,5294 | vorher 5,0 | vorher **2,65** |
 * | Tropfen | 30 × 51 | 14 × 24 (`meet` → 0,4667) | 0,4667 | 3,5 | **1,63** |
 *
 * Der Ring trug also einen rund 60 % dickeren Rand. Gleich dick wird er bei
 * `3,5 × 0,4667 / 0,5294 = 3,084` Einheiten, also einer Füllung bei `17 − 3,084 ≈ 13,9`. Das Verhältnis der beiden
 * Maßstäbe ist von `size` unabhängig (beide wachsen linear), der Gleichstand gilt deshalb in jeder Größe.
 */
const DISC_RIM = 3.1;

/**
 * 🔴 **Die Höhe des Rings in Pixeln - EINE Größe für die Wegpunkteingabe UND die Etappenliste** (WI-0097, Betreiber
 * 2026-10-07: „die icons der wegpunktmarkierung und der tropfen sollten im routenplaner und bei den etappen gleich
 * groß sein"). Die Nadel folgt über `dropBox`.
 *
 * 🪤 **Vorher trug die Etappenliste 13 px**, die Eingabe 18 - gemessen am Bild (vierfache Pixeldichte, hell und
 * dunkel, 1280 und 360 px): Ring oben 18 × 18, unten 13 × 13; Nadel oben 14 × 24, unten 10 × 17. Die Liste war also
 * um Faktor 1,385 kleiner, und genau das hat der Betreiber gemeldet.
 *
 * 🔴 **Warum 18 gewinnt und nicht 13**, aus vorhandenen Werten abgeleitet:
 *
 * 1. Die Wegpunkteingabe ist die benannte Vorlage (Betreiber 2026-10-05: „beide sollten eigentlich so aussehen wie
 *    die symbole aus den wegpunkten"). „So aussehen" schließt die Größe ein.
 * 2. 18 war die EINE Vorgabe des gemeinsamen Bauteils, 13 eine Übersteuerung an einer Stelle. Eine Übersteuerung
 *    fällt weg, eine neue Zahl entsteht nicht.
 * 3. In der Etappenliste selbst passt 18 besser: Die Marke steht in der 20 px breiten Markenspur (`--mark-size`,
 *    bemessen nach zwei Ziffern der Etappenperle), daneben die Mediensymbole mit `--icon-md` 20 px. Die Nadel füllt
 *    die Spur bei 18 genau aus - `dropBox(18).width` 14 px plus 3 px Grund je Seite sind 20 px -, bei 13 waren es 16
 *    von 20.
 */
export const MARK_SIZE = 18;

export const WAYPOINT_MARK = {
    /** Ring für Start und Zwischenziel: Kern, Füllung, Auge - drei Kreise, kein Rand dazwischen. */
    disc: {
        viewBox: "-17 -17 34 34",
        /** Kantenlänge des viewBox in Einheiten; Breite und Höhe sind gleich. */
        units: 34,
        core: 17,
        fill: 17 - DISC_RIM,
        eye: 5.5,
    },
    /** Nadel (Tropfen) für das Ziel: Außenpfad, Innenpfad, Auge. Die Spitze sitzt auf der Unterkante. */
    drop: {
        viewBox: "-15 -51 30 51",
        width: 30,
        height: 51,
        outer: "M0,0 C-6,-14 -15,-22 -15,-36 A15,15 0 1,1 15,-36 C15,-22 6,-14 0,0 Z",
        inner: "M0,-6 C-4.5,-16 -11.5,-23 -11.5,-36 A11.5,11.5 0 1,1 11.5,-36 C11.5,-23 4.5,-16 0,-6 Z",
        eye: { cx: 0, cy: -36, r: 5.5 },
    },
    /**
     * Wo die Kette der Etappenliste an einer Marke endet, als Anteil ihrer Höhe VON OBEN: beim Ring die Mitte, bei
     * der Nadel ihr Kopf (der Kreis bei `cy = -36` im viewBox von -51 bis 0, also 15/51 von oben). Die Nadel zeigt
     * mit der Spitze auf den Boden - die Kette gehört an ihren Kopf, nicht in ihre Mitte.
     */
    chainAnchor: { wegpunkt: 0.5, ziel: 15 / 51 },
} as const;

/** Wie hoch und breit die Nadel neben einem Ring der Höhe `size` steht (gerundet wie bisher). */
export function dropBox(size: number): { width: number; height: number } {
    return { width: Math.round(size * (14 / 18)), height: Math.round(size * (24 / 18)) };
}
