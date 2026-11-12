import { snowlineHeight } from "../transport-rules.ts";
import type { TravelModel } from "../travel-model.ts";
import { WETTER_UNBESTIMMT_TAG } from "./jahr.ts";

/**
 * Die Schneefallgrenze des Wetters (WI-0288 Stufe 5; Betreiber 2026-11-07: Sie „stimmt mit der Schneefallgrenze nach Klimazonen der
 * Wegfindung überein“, „Best of“ beider).
 *
 * - **Quelle ist die Wegfindung:** `snowlineHeight` mit der Tafel `schneegrenze` des Reisemodells, je Klimazone und Tag, auf 100 Schritt
 *   gerundet. Dieselbe Zahl zeichnet das Höhenprofil des Planers und prüft der Router. Das Wetter zeigt sie als Linie unter „Prüfen“, lässt
 *   darüber Schnee fallen und liegen.
 * - **Vom Wetter kommt, was die Wegfindung nicht kennt**, und das nur auf der Wetterseite: Sonnenhänge halten den Schnee höher, der Rand der
 *   Decke ist unruhig, steile Hänge bleiben frei, und frisch gefallener Schnee liegt auch darunter, bis er taut (`apps/web/src/map/wetter/engine/`).
 * - **„Unbestimmt“** (kein Reisebeginn) hat in der Wegfindung keine Schneegrenze; das Wetter nimmt dafür `WETTER_UNBESTIMMT_TAG`.
 *
 * Die Engine liest die Zone je Ort aus einem Raster der Klimabänder: 0 heißt keine Zone, 1 bis n die Zonen in der Folge von
 * `WETTER_KLIMAZONEN`. Eine Zone ohne Zeile in der Tafel bekommt keine Grenze (−1); dort und ohne Zone gilt die eigene Grenze des Wetters.
 */

/** Die Klimazonen in der Folge der Tafel `schneegrenze.zonen` (vom Pol zum Äquator); ihr Platz + 1 ist ihr Wert im Raster. */
export function wetterKlimazonen(model: TravelModel): readonly string[] {
    return Object.keys(model.schneegrenze.wert.zonen);
}

/** Der Wert einer Zone im Raster: 1 bis n, 0 für eine Zone, die die Tafel nicht kennt. */
export function wetterKlimazonenWert(model: TravelModel, zone: string | null | undefined): number {
    return zone ? wetterKlimazonen(model).indexOf(zone) + 1 : 0;
}

/** Der Tag, für den die Wegfindung rechnet: das Datum des Wetters, „unbestimmt“ als `WETTER_UNBESTIMMT_TAG`. */
export const wetterSchneeTag = (tag: number | null): number => tag ?? WETTER_UNBESTIMMT_TAG;

/**
 * Die Schneefallgrenze je Rasterwert in Schritt an einem Tag des Wetters (mit Bruchteil, `null`: unbestimmt): Platz 0 (keine Zone) und
 * Zonen ohne Zeile tragen −1.
 */
export function wetterSchneegrenzen(model: TravelModel, tag: number | null): number[] {
    const tagImJahr = wetterSchneeTag(tag);
    return [-1, ...wetterKlimazonen(model).map((zone) => snowlineHeight(model, zone, tagImJahr) ?? -1)];
}
