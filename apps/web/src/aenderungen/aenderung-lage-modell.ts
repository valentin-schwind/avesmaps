import { MAP_CHANGES_LAGE_MIT_MAX, SEARCH_FIT_MAX_ZOOM, placeNearZoom, type MapChangeLage } from "@avesmaps3d/shared";
import type { KartenBild, KartenTeil } from "./aenderung-karte-modell";

/**
 * Wo die Gegenstände einer Änderung HEUTE liegen, ohne Vue und ohne MapLibre (WI-0265 B9; Vali 2026-11-01: „kannst du bei den änderungensitems immer (wenn möglich) 'Auf Karte anzeigen' machen, sodass die
 * Ansicht hinfliegt, wo die Änderung war? sonst muss man ewig suchen“).
 *
 * Woher der Ort einer Änderung kommt, in dieser Reihenfolge (`aenderung-karte-zeigen.ts` führt sie aus, hier steht, was sich ohne Netz und ohne Karte entscheiden lässt):
 *
 * | Quelle | Wann | Auf der Karte |
 * |---|---|---|
 * | (a) das Protokoll | die Änderung trägt Geometrie (`geometry`, `position`, Netz) | Vorher und Nachher (`aenderung-karte-modell.ts`) |
 * | (b) die Datenbank | sonst: der Server sagt, wo die Gegenstände jetzt liegen | der heutige Ort als Punkt oder Umriss |
 * | (c) keine | auch der Server weiß keine Lage (ein Werk ohne Orte, ein Ort ohne Lage) | kein Bild: der Knopf sagt es kurz |
 *
 * 🔴 **Nie ein „Vorher“ erfinden** (Fachvertrag Gate 4, U11): Der heutige Ort steht auf der Karte als „heute“, nicht als früherer Zustand.
 */

/** Ein Kasten in Kartenkoordinaten (`aventuria-v1`): `[minX, minY, maxX, maxY]`. */
export type Grenzen = readonly [number, number, number, number];

/**
 * Wie klein ein Kasten höchstens ist, damit die Kamera ihn wie einen PUNKT behandelt (Kartenpunkte; die Karte misst 1024 × 1024): Ein Ort, ein Gipfel, ein Kraftlinienpunkt. Ein Kasten
 * darunter wird für die Kamera auf diese Kantenlänge aufgezogen (MapLibre rechnet mit einem Kasten ohne Fläche keinen Zoom), und sie fährt so nah heran wie an einen Ort.
 */
export const MINDEST_KANTE = 6;

const istZahl = (wert: unknown): wert is number => typeof wert === "number" && Number.isFinite(wert);

/** Ist das ein geordneter Kasten aus endlichen Zahlen? */
export function istGrenzen(wert: unknown): wert is Grenzen {
    if (!Array.isArray(wert) || wert.length !== 4 || !wert.every(istZahl)) return false;
    const [x0, y0, x1, y1] = wert as number[];
    return x0! <= x1! && y0! <= y1!;
}

/** Hat der Kasten (fast) keine Fläche: ein Ort, ein Gipfel, ein Kraftlinienpunkt? */
export const istPunktartig = ([x0, y0, x1, y1]: Grenzen): boolean => x1 - x0 < MINDEST_KANTE && y1 - y0 < MINDEST_KANTE;

/** Der Kasten mit mindestens `MINDEST_KANTE` Kantenlänge je Richtung, um dieselbe Mitte; für die Kamera. */
export function mitMindestkante([x0, y0, x1, y1]: Grenzen): Grenzen {
    const breit = (a: number, b: number): [number, number] => {
        if (b - a >= MINDEST_KANTE) return [a, b];
        const mitte = (a + b) / 2;
        return [mitte - MINDEST_KANTE / 2, mitte + MINDEST_KANTE / 2];
    };
    const [ax, bx] = breit(x0, x1);
    const [ay, by] = breit(y0, y1);
    return [ax, ay, bx, by];
}

/**
 * Wie nah und wie weit die Kamera fährt: auf einen Weg, eine Fläche, eine Gruppe von Orten so nah wie auf einen Weg (`SEARCH_FIT_MAX_ZOOM.weg`, wie bei Vorher und Nachher); auf einen PUNKT so nah wie auf einen Ort
 * unbekannter Klasse (`placeNearZoom`: Dort stehen schon die Namen der Nachbarn), und mindestens so nah: Eine Karte, die weit weg steht, fährt hin und nicht nur ein Stück.
 *
 * 🔴 **Nie so weit hinaus, dass ein Kartenrand ins Bild kommt** (WI-0265 B9b/B9c; Production 2026-11-01: Ein Lauf über 608 Sprachartikel hat einen Kasten um ganz Aventurien, und die Karte fuhr bis an ihren Rand
 * hinaus): `minZoom` ist die Stufe, bei der das Kartenbild die freie Fläche gerade noch ganz füllt (`fillZoom` in `map/camera/visible-area.ts`, von der Überlagerung aus dem Zaun der Karte und der freien Fläche berechnet:
 * am Rechner liegt sie höher als am schmalen Telefon). Die Kamera rechnet `max(Passstufe, minZoom)`: Jeder Kasten, der bei dieser Stufe ins Bild passt, wird ganz gezeigt; erst ein Kasten, der größer ist als das
 * füllende Kartenbild, wird angeschnitten und liegt mit seiner Mitte im Bild (der Kartenzaun, `constrainToVisible`, hält die Mitte so, dass kein Kartenrand erscheint). Die Stufe darf den Deckel nach innen nicht überschreiten
 * (`maxZoom`). Ohne Angabe (keine Karte, keine Fläche) gibt es keinen unteren Deckel.
 */
export function flugOptionen(grenzen: Grenzen | undefined, minZoom?: number): { maxZoom: number; minZoom?: number } {
    if (grenzen !== undefined && istPunktartig(grenzen)) {
        const nah = placeNearZoom(undefined);
        return { maxZoom: nah, minZoom: nah };
    }
    const maxZoom = SEARCH_FIT_MAX_ZOOM.weg;
    if (minZoom === undefined || !Number.isFinite(minZoom)) return { maxZoom };
    return { maxZoom, minZoom: Math.min(minZoom, maxZoom) };
}

/**
 * Das Bild des heutigen Ortes aus der Antwort des Servers: ein Punkt, wenn der Kasten keine Fläche hat, sonst sein Umriss. `undefined`, wenn der Server keine Lage kennt (keine Gegenstände mit Lage)
 * oder etwas Unbrauchbares schickt.
 */
export function bildAusLage(lage: MapChangeLage): KartenBild | undefined {
    const grenzen = lage.grenzen;
    if (!istGrenzen(grenzen) || lage.gegenstaende <= 0) return undefined;
    const [x0, y0, x1, y1] = grenzen;
    const teile: KartenTeil[] = istPunktartig(grenzen)
        ? [{ art: "punkt", punkt: [(x0 + x1) / 2, (y0 + y1) / 2] }]
        : [
              {
                  art: "linie",
                  punkte: [
                      [x0, y0],
                      [x1, y0],
                      [x1, y1],
                      [x0, y1],
                      [x0, y0],
                  ],
              },
          ];
    return {
        vorher: [],
        nachher: [],
        verschiebungen: [],
        hinweise: { vorherFehlt: false, vorherTeilweise: false, nachherTeilweise: false },
        grenzen,
        heute: { teile, stillgelegt: lage.stillgelegt > 0, gegenstaende: lage.gegenstaende },
    };
}

/** Kann diese Änderung einen Ort haben? Jede Art von Gegenstand kann (auch Inhalte über ihre Träger); eine Operation ohne Gegenstand nicht. */
export const kannLageHaben = (gegenstaende: readonly { readonly kind: string }[]): boolean => gegenstaende.length > 0;

/** Die Frage an den Server für eine Serie: die erste Operation und die weiteren (höchstens `MAP_CHANGES_LAGE_MIT_MAX`). */
export function lageFrage(operationIds: readonly string[]): { operationId: string; mit: string[] } | undefined {
    const ids = [...new Set(operationIds)];
    const erste = ids[0];
    if (erste === undefined) return undefined;
    return { operationId: erste, mit: ids.slice(1, 1 + MAP_CHANGES_LAGE_MIT_MAX) };
}
