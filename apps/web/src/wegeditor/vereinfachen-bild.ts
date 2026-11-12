import type { Bild } from "../map/geometrie/bild";
import type { GeometrieArt, Punkt, Teil, Ziel } from "../map/geometrie/geometrie";
import { amOrt, deckungsgleich } from "../map/geometrie/rechnung";

/**
 * Was „Wegkurve vereinfachen“ festhält und zeigt (WI-0177 W3; Probierblatt P5). Gezeichnet wird mit der gemeinsamen Schicht des
 * Geometrie-Moduls (`map/geometrie/schicht.ts`), ohne Anfasser zum Ziehen: Der Regler ist die einzige Eingabe.
 */

/**
 * Die Punkte, die beim Vereinfachen bleiben (Betreiber 2026-10-16, „Nein, fest“): die Enden, Punkte an einem Ort und Knoten mit
 * anderen Wegen (deckungsgleich mit einem ihrer Stützpunkte). So hält jeder Anschluss, und nichts zieht mit.
 */
export function festeIndizes(punkte: readonly Punkt[], orte: readonly Punkt[], ziele: readonly Ziel[]): number[] {
    const ecken = ziele.filter((ziel) => ziel.art === "ecke").map((ziel) => ziel.at);
    const raus: number[] = [];
    punkte.forEach((p, i) => {
        const ende = i === 0 || i === punkte.length - 1;
        if (ende || amOrt(p, orte) || ecken.some((e) => deckungsgleich(e, p))) raus.push(i);
    });
    return raus;
}

/**
 * Die Vorschau: der alte Verlauf blass gestrichelt, der neue knallrot, die bleibenden Punkte als Anfasser (feste groß), die
 * wegfallenden als leere Ringe.
 */
export function vereinfachenBild(art: GeometrieArt, start: Teil, jetzt: Teil, fest: readonly number[]): Bild {
    const feste = fest.map((i) => start.punkte[i]).filter((p): p is Punkt => p !== undefined);
    return {
        linien: [
            { coords: art.rundung(start.punkte), rolle: "alt", objekt: start.objekt, nr: start.nr },
            { coords: art.rundung(jetzt.punkte), rolle: "kante", objekt: jetzt.objekt, nr: jetzt.nr },
        ],
        anfasser: jetzt.punkte.map((at, index) => ({
            at,
            ende: feste.some((f) => deckungsgleich(f, at)),
            stelle: { objekt: jetzt.objekt, nr: jetzt.nr, index },
        })),
        andock: start.punkte.filter((p) => !jetzt.punkte.some((q) => deckungsgleich(p, q))),
        ringe: [],
    };
}
