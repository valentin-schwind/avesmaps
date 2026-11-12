import { Type, type Static } from "@sinclair/typebox";
import { AVENTURIA } from "./map-domain-registry.ts";
import { MEDIA_PUBLIC_URL_PATTERN } from "./media.ts";
import { PHOTOBOX_CREATION_KINDS, PHOTOBOX_LIMITS, PhotoboxLage } from "./photobox-sicht.ts";

/**
 * Die Reisebilder auf der Karte (WI-0272 S4, Aufgabe 23): der öffentliche Lesepfad je Ausschnitt. Der Browser fragt einen auf das Raster gerundeten
 * Ausschnitt der Welt (`GET /api/media/reisebilder?x0=…&y0=…&x1=…&y1=…`) und bekommt die freigegebenen Bilder darin als JSON, samt der Zahl, die der Knopf
 * „Reisebilder“ nennt. Kachelweise aus Martin geht es nicht (Martin kann die Entscheidung über die Veröffentlichung, `decidePublication`, nicht fragen), und die
 * Zahl im Knopf braucht die Bilder ohnehin im Browser.
 *
 * 🔴 Die Antwort nennt nur, was Besucher sehen dürfen: nie den Statusschlüssel, nie seinen Hash, nie einen Speicherschlüssel, nie die Prüfsumme des Originals, nie
 * einen internen Zustand, nie eine wartende Beschreibung oder die Nachricht der Redaktion. Ein verborgener oder inaktiver Ort wird nie genannt (das Bild gilt dann
 * als frei, sonst verriete die Route ihn). Die Adressen der Dateien sind die inhaltsversionierten Adressen unter `/media/` (`MEDIA_PUBLIC_URL_PATTERN`).
 *
 * Der Ausschnitt liegt immer auf dem Raster (`REISEBILD_RASTER`): Dasselbe Raster ergibt dieselbe Adresse, der Zwischenspeicher des Servers und der Browser
 * treffen, und ein Aufruf mit beliebigen Zahlen ließe sich nicht zwischenspeichern.
 */

/** Die Adresse des Lesepfads. Unter `/api/media/`, nicht unter `/api/photobox/`: Dort gelten Nginx-Zone und Rumpfgrenze des Einreichens, die zum Verschieben der Karte nicht passen. */
export const MEDIA_REISEBILDER_PUBLIC_URL = "/api/media/reisebilder";

/** Die Kantenlänge eines Rasterfeldes in Karteneinheiten (die Welt ist 1024 breit, also 16 Felder). */
export const REISEBILD_RASTER = 64;

/** Höchstens so viele Bilder je Antwort; mehr heißt `gekappt` (eine stabile, gleichmäßige Auswahl nach der Zufallskennung der Einreichung). */
export const REISEBILD_AUSSCHNITT_MAX = 500;

/** Lesende Aufrufe je Adresse und Stunde (Regler melden, WI §9): Das Verschieben der Karte fragt mehrfach, der Browser hält 60 s Vorrat. */
export const REISEBILD_LESEN_JE_STUNDE = 1200;

const strict = { additionalProperties: false } as const;
const { bounds: WORLD } = AVENTURIA.coordinateSpace;
const Uuid = Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" });
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

/**
 * Ein Ausschnitt der Welt: zwei Ecken in Karteneinheiten, ganze Zahlen in den Grenzen der Welt. Gültig ist er erst auf dem Raster (`ausschnittGueltig`);
 * `ausschnittAufRaster` rundet jeden Ausschnitt dorthin.
 */
export const ReisebilderAusschnitt = Type.Object(
    {
        x0: Type.Integer({ minimum: WORLD.minX, maximum: WORLD.maxX }),
        y0: Type.Integer({ minimum: WORLD.minY, maximum: WORLD.maxY }),
        x1: Type.Integer({ minimum: WORLD.minX, maximum: WORLD.maxX }),
        y1: Type.Integer({ minimum: WORLD.minY, maximum: WORLD.maxY }),
    },
    strict,
);
export type ReisebilderAusschnitt = Static<typeof ReisebilderAusschnitt>;

/** Eine Ecke eines Rahmens vor dem Runden (Zahlen, nicht nur ganze): die Sicht der Karte in Karteneinheiten. */
export interface Rahmen {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

const klemme = (wert: number, min: number, max: number): number => Math.min(max, Math.max(min, wert));

/**
 * Rundet einen Rahmen NACH AUSSEN auf Vielfache des Rasters und klemmt ihn auf die Welt: die kleinen Ecken ab, die großen auf. So liegt jeder Punkt des
 * Rahmens im Ergebnis. Liegt der Rahmen ganz außerhalb der Welt, bleibt eine leere Fläche (`x0 === x1`); `ausschnittGueltig` lehnt sie ab.
 */
export function ausschnittAufRaster(box: Rahmen): ReisebilderAusschnitt {
    const runter = (wert: number, min: number, max: number): number =>
        klemme(Math.floor(wert / REISEBILD_RASTER) * REISEBILD_RASTER, min, max);
    const hoch = (wert: number, min: number, max: number): number =>
        klemme(Math.ceil(wert / REISEBILD_RASTER) * REISEBILD_RASTER, min, max);
    return {
        x0: runter(box.x0, WORLD.minX, WORLD.maxX),
        y0: runter(box.y0, WORLD.minY, WORLD.maxY),
        x1: hoch(box.x1, WORLD.minX, WORLD.maxX),
        y1: hoch(box.y1, WORLD.minY, WORLD.maxY),
    };
}

/** Ist der Ausschnitt gültig: ganze Zahlen, Vielfache des Rasters, `x0 < x1` und `y0 < y1`, alles in der Welt? */
export function ausschnittGueltig(ausschnitt: Rahmen): boolean {
    const werte = [ausschnitt.x0, ausschnitt.y0, ausschnitt.x1, ausschnitt.y1];
    if (!werte.every((wert) => Number.isInteger(wert) && wert % REISEBILD_RASTER === 0)) return false;
    return (
        ausschnitt.x0 >= WORLD.minX &&
        ausschnitt.y0 >= WORLD.minY &&
        ausschnitt.x1 <= WORLD.maxX &&
        ausschnitt.y1 <= WORLD.maxY &&
        ausschnitt.x0 < ausschnitt.x1 &&
        ausschnitt.y0 < ausschnitt.y1
    );
}

/** Eine öffentliche Datei des Bildes: die Adresse unter `/media/` und die Maße in Pixeln. */
export const ReisebildDatei = Type.Object(
    {
        url: Type.String({ pattern: MEDIA_PUBLIC_URL_PATTERN }),
        breite: Type.Integer({ minimum: 1 }),
        hoehe: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type ReisebildDatei = Static<typeof ReisebildDatei>;

/**
 * Ein Reisebild auf der Karte; genau diese Felder, keine weiteren.
 *
 * - `id` ist die öffentliche Kennung des Bildes (`media_asset.public_id`), `lage` seine Stelle. `datei` ist die große Fassung (`photobox_2048`), `kachel` die kleine
 *   für Leiste und Kartensymbole (`photobox_kachel`); sie fehlt nur, solange der Abgleich sie noch nicht nachgezogen hat.
 * - `beschreibung` ist die geltende Fassung (nie eine wartende), `name` die freiwillige Nennung des Einreichers. `lizenz` steht nur bei `usage_grant = 'cc-by-4.0'`:
 *   CC BY verlangt die Nennung der Lizenz.
 * - `ort` steht nur, wenn die Einreichung an einem sichtbaren Ort hängt (aktiv und nicht verborgen): seine Kennung, sein Name, seine Lage und die Eigenschaften
 *   seiner Kachel, die der Markerfilter der Karte liest (`subtype`, `capitalBands`).
 */
export const ReisebildKarte = Type.Object(
    {
        id: Uuid,
        lage: PhotoboxLage,
        datei: ReisebildDatei,
        kachel: Type.Optional(ReisebildDatei),
        beschreibung: Type.String(),
        name: Type.Optional(Type.String()),
        entstehung: literals(PHOTOBOX_CREATION_KINDS),
        lizenz: Type.Optional(Type.Object({ name: Type.String(), uri: Type.Optional(Type.String()) }, strict)),
        blickrichtung: Type.Optional(Type.Integer({ minimum: 0, maximum: PHOTOBOX_LIMITS.viewDirections - 1 })),
        /** Die anonyme Zahl „Gefällt mir“ (WI-0304); fehlt sie, ist sie 0. Kein Verzeichnis, wer es war. */
        gefaellt: Type.Optional(Type.Integer({ minimum: 0 })),
        ort: Type.Optional(
            Type.Object(
                {
                    id: Uuid,
                    name: Type.String(),
                    lage: PhotoboxLage,
                    subtype: Type.String(),
                    capitalBands: Type.Optional(Type.String({ pattern: "^[0-8]+$" })),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type ReisebildKarte = Static<typeof ReisebildKarte>;

/**
 * Die Antwort des Lesepfads: `an` ist falsch, wenn Reisebilder nicht gezeigt werden (der Schalter `media.role.photobox` ist aus, oder die Instanz hat die Tafeln noch
 * nicht); dann ist `bilder` leer. `gekappt` heißt: Im Ausschnitt gibt es mehr als `REISEBILD_AUSSCHNITT_MAX` Bilder, gezeigt wird eine stabile Auswahl.
 */
export const ReisebilderAntwort = Type.Object(
    {
        an: Type.Boolean(),
        bilder: Type.Array(ReisebildKarte),
        gekappt: Type.Boolean(),
    },
    strict,
);
export type ReisebilderAntwort = Static<typeof ReisebilderAntwort>;
