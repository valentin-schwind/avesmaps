import { Type, type Static } from "@sinclair/typebox";
import { SPRACHE_SCHLUESSEL_MUSTER } from "@avesmaps3d/shared";

/**
 * Die Antwortschemas der Sprachen-Routen (WI-0261 S2), serverseitig wie `typen.ts`. Der Schlüssel einer Sprache hat dieselbe Form
 * wie die Bedingung der Tafel (`sprache_schluessel_format`, Migration 0254); das Muster steht seit dem Spracheditor (S5d) im Vertrag.
 */

const Herkunft = Type.Union([Type.Literal("sprachenkarte"), Type.Literal("redaktion")]);

export const SpracheEintragSchema = Type.Object({
    id: Type.String(),
    schluessel: Type.String(),
    name: Type.String(),
    legende: Type.Union([Type.String(), Type.Null()]),
    farbe: Type.String(),
    reihenfolge: Type.Integer(),
    herkunft: Herkunft,
    revision: Type.Integer(),
    anzahlTeilflaechen: Type.Integer(),
    flaeche: Type.Number(),
});

export const SprachTeilflaecheSchema = Type.Object({
    id: Type.String(),
    herkunft: Herkunft,
    flaeche: Type.Number(),
    bbox: Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]),
});

export const SpracheMitTeilflaechenSchema = Type.Composite([
    SpracheEintragSchema,
    Type.Object({ teilflaechen: Type.Array(SprachTeilflaecheSchema) }),
]);

/** Die Zahlen der Treffer einer Sprache je Art (WI-0261 S4), ab dem Mindestanteil der Karteneinstellungen. */
export const SprachTrefferSchema = Type.Object({
    orte: Type.Integer({ minimum: 0 }),
    gebiete: Type.Integer({ minimum: 0 }),
    regionen: Type.Integer({ minimum: 0 }),
    wege: Type.Integer({ minimum: 0 }),
});

/** `GET /api/sprachen/:schluessel`: die Sprache mit Teilflächen und den Zahlen ihrer Treffer. */
export const SpracheMitTrefferSchema = Type.Composite([
    SpracheMitTeilflaechenSchema,
    Type.Object({ treffer: SprachTrefferSchema }),
]);

export const SprachenListeSchema = Type.Object({ sprachen: Type.Array(SpracheEintragSchema) });
export type SprachenListe = Static<typeof SprachenListeSchema>;

export const SpracheParamsSchema = Type.Object({
    schluessel: Type.String({ pattern: SPRACHE_SCHLUESSEL_MUSTER, minLength: 1, maxLength: 64 }),
});
