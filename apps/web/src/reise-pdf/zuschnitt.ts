import type { Kasten } from "../screenshot/kartenbild";

/**
 * Der Zuschnitt des Kartenbilds (WI-0306): welches Rechteck der aufgenommenen Leinwand auf das Deckblatt kommt. Rein, in CSS-Pixeln des
 * Kartenbehälters; die Aufnahme rechnet sie mit ihrer Dichte in Bildpunkte um.
 *
 * - **Ausschnitt:** das größte Rechteck im Verhältnis des Felds in der freien Fläche (was neben Planer und Infopanel zu sehen ist), mittig.
 * - **Ganze Route:** der Umriss der Route mit Rand (`ROUTE_RAND`, mindestens `ROUTE_RAND_MIN`), auf das Verhältnis des Felds geweitet und
 *   möglichst in der freien Fläche; reicht sie nicht, darf er bis an den Rand des Behälters gehen (die Leinwand zeichnet auch unter dem
 *   Planer). Größer als der Behälter wird er nie: Dann das größte Rechteck im Behälter um die Mitte der Route.
 */

/** Der Rand um den Umriss der Route, als Anteil seiner Größe. */
export const ROUTE_RAND = 0.1;
/** Und mindestens so viele CSS-Pixel. */
export const ROUTE_RAND_MIN = 24;
/** Ein Zuschnitt um eine sehr kleine Route ist mindestens so breit wie dieser Anteil der freien Fläche. */
export const ROUTE_MIN_ANTEIL = 0.3;

/** Das größte Rechteck im Verhältnis `r` (Breite durch Höhe) in `rahmen`, mittig um `mitte`, ganz in `rahmen`. */
export function groesstesIn(
    rahmen: Kasten,
    r: number,
    mitte = { x: rahmen.x + rahmen.w / 2, y: rahmen.y + rahmen.h / 2 },
): Kasten {
    const w = Math.min(rahmen.w, rahmen.h * r);
    const h = w / r;
    return schiebeIn({ x: mitte.x - w / 2, y: mitte.y - h / 2, w, h }, rahmen);
}

/** Verschiebt `kasten` in `rahmen`, ohne seine Größe zu ändern (er muss hineinpassen). */
export function schiebeIn(kasten: Kasten, rahmen: Kasten): Kasten {
    const x = Math.min(Math.max(kasten.x, rahmen.x), rahmen.x + rahmen.w - kasten.w);
    const y = Math.min(Math.max(kasten.y, rahmen.y), rahmen.y + rahmen.h - kasten.h);
    return { x, y, w: kasten.w, h: kasten.h };
}

export function zuschnitt(
    modus: "route" | "ausschnitt",
    r: number,
    behaelter: Kasten,
    frei: Kasten,
    route?: Kasten,
): Kasten {
    if (modus === "ausschnitt" || route === undefined) return groesstesIn(frei, r);
    const rand = Math.max(ROUTE_RAND_MIN, Math.max(route.w, route.h) * ROUTE_RAND);
    let w = Math.max(route.w + 2 * rand, frei.w * ROUTE_MIN_ANTEIL);
    let h = route.h + 2 * rand;
    if (w / h < r) w = h * r;
    else h = w / r;
    const mitte = { x: route.x + route.w / 2, y: route.y + route.h / 2 };
    if (w > behaelter.w || h > behaelter.h) return groesstesIn(behaelter, r, mitte);
    const kasten = { x: mitte.x - w / 2, y: mitte.y - h / 2, w, h };
    return w <= frei.w && h <= frei.h ? schiebeIn(kasten, frei) : schiebeIn(kasten, behaelter);
}

/** Der Umriss von Punkten des Bildschirms. */
export function umriss(punkte: readonly { x: number; y: number }[]): Kasten | undefined {
    if (punkte.length === 0) return undefined;
    const xs = punkte.map((p) => p.x);
    const ys = punkte.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Liegt `innen` mit `rand` CSS-Pixeln Abstand ganz in `aussen`? */
export function liegtIn(innen: Kasten, aussen: Kasten, rand: number): boolean {
    return (
        innen.x >= aussen.x + rand &&
        innen.y >= aussen.y + rand &&
        innen.x + innen.w <= aussen.x + aussen.w - rand &&
        innen.y + innen.h <= aussen.y + aussen.h - rand
    );
}
