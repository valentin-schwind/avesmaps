import { Type, type Static } from "@sinclair/typebox";

/**
 * Kartografie einer Kartendomäne: Farben, Deckkräfte und Kanten der Flächen.
 *
 * 🔴 Das ist die EINZIGE Stelle für Farbwerte der Landschaften und Klimabänder. Vorher standen sie
 * als Literale in `apps/web/src/map/landscape-layers.ts`, und 25 Landschaftsarten teilten sich drei
 * Farben — eine je Ebene. Ein Wald sah aus wie ein Gebirge, sobald beide in derselben Ebene lagen.
 *
 * Was hier NICHT steht, und zwar mit Absicht:
 *
 * | Wert | wo er hingehört |
 * |---|---|
 * | Schriftgrößen je Zoomstufe | `config/zoom-bands/` — dieselbe Tafel wie für Ortsklassen |
 * | Sichtbarkeit und Zoomband eines Features | am Feature (`label_min_zoom`, `label_max_zoom`) |
 * | Kollisionspriorität | WI-0007, nicht hier |
 *
 * Diese Trennung ist der Kern: Farbe ist Kartografie, Größe ist ein Zoomband, Sichtbarkeit ist eine
 * redaktionelle Eigenschaft. Wer sie in eine Tabelle zieht, kann später keine davon einzeln ändern.
 */

/** Wie eine Ebene den Rastergrund überdeckt. */
export const CartographyLayer = Type.Object(
    {
        /** Zeichenreihenfolge von unten nach oben. */
        order: Type.Integer({ minimum: 0 }),
        fillOpacity: Type.Number({ minimum: 0, maximum: 1 }),
        /**
         * Die Deckkraft in der eigenen Ansicht, wenn die Ebene allein gewählt ist. Dort steht sie ohne die
         * anderen und darf kräftig sein (Betreiber 2026-09-28: Vegetation „soll wirklich sichtbar sein“).
         * Fehlt der Wert, gilt `fillOpacity`.
         */
        fillOpacityAlone: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        lineOpacity: Type.Number({ minimum: 0, maximum: 1 }),
        /** Die Kantenbreite dieser Ebene statt `global.lineWidth`. */
        lineWidth: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        /** Eine gestrichelte Kante: Strich und Lücke in Kantenbreiten (MapLibre `line-dasharray`). */
        lineDash: Type.Optional(Type.Array(Type.Number({ exclusiveMinimum: 0 }), { minItems: 2, maxItems: 4 })),
    },
    { additionalProperties: false },
);

/** Eine Landschaftsart: Ebene und Farbton. Die Deckkraft kommt von der Ebene. */
export const CartographyType = Type.Object(
    {
        layer: Type.String(),
        fill: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
        /**
         * Der Ton ihres NAMENS auf der Karte.
         *
         * 🪤 Nicht dieselbe Farbe wie `fill`, und das ist kein Versehen: die Fläche liegt als Lasur
         * über dem Gelände, der Name steht darauf. Legacy führt beide getrennt (MCS-015).
         *
         * Fehlt der Wert, gilt die Vorgabe der Beschriftungsfamilie aus dem Designkanon. Genau so
         * verhält sich Legacy für die Arten, die seine Tafel nicht kennt.
         */
        labelColor: Type.Optional(Type.String({ pattern: "^#[0-9a-f]{6}$" })),
        /** Versalien. Legacy setzt sie für genau fünf Arten, nicht für die Regionsuntertypen. */
        labelUppercase: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
);

export const MapCartography = Type.Object(
    {
        schemaVersion: Type.Integer({ exclusiveMinimum: 0 }),
        mapDomain: Type.String(),
        layers: Type.Record(Type.String(), CartographyLayer),
        global: Type.Object(
            {
                lineWidth: Type.Number({ exclusiveMinimum: 0 }),
                /** Anteil, um den die Kantenfarbe gegenüber der Füllfarbe abgedunkelt wird. */
                lineDarken: Type.Number({ minimum: 0, maximum: 1 }),
                /**
                 * 🔧 Vorläufig. Schriftfarbe und Saum einer Beschriftung gelten für JEDE
                 * Kartendomäne und gehören deshalb in den Designkanon
                 * (`config/design-canon/avesmaps.json`, Familie `landscape`), nicht in die
                 * Kartografie einer einzelnen Domäne. Sie stehen hier, solange die
                 * Beschriftungslayer noch nicht auf den Kanon umgestellt sind (MCS-015).
                 */
                textColor: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
                haloColor: Type.String({ pattern: "^#[0-9a-f]{6}$" }),
                haloWidth: Type.Number({ minimum: 0 }),
            },
            { additionalProperties: false },
        ),
        types: Type.Record(Type.String(), CartographyType),
        climateZones: Type.Record(Type.String(), Type.String({ pattern: "^#[0-9a-f]{6}$" })),
        provenance: Type.Object(
            {
                baselineId: Type.String(),
                findings: Type.Array(Type.String()),
                legacyEvidence: Type.String(),
                note: Type.String(),
            },
            { additionalProperties: false },
        ),
    },
    { $id: "MapCartography", additionalProperties: true },
);

export type MapCartography = Static<typeof MapCartography>;
export type CartographyType = Static<typeof CartographyType>;
export type CartographyLayer = Static<typeof CartographyLayer>;

/**
 * Die Kantenfarbe aus der Füllfarbe.
 *
 * 🪤 Eine zweite gepflegte Farbliste wäre eine zweite Gelegenheit, sie auseinanderlaufen zu lassen.
 * Die Kante trägt die Form — ohne sie verschwimmen zwei gleichfarbige Nachbarflächen zu einer —,
 * aber sie ist kein eigener Gestaltungswert, sondern dieselbe Farbe, nur dunkler.
 */
export function darkenColour(hex: string, amount: number): string {
    const value = hex.replace("#", "");
    const channel = (offset: number): string => {
        const raw = Number.parseInt(value.slice(offset, offset + 2), 16);
        const darker = Math.max(0, Math.round(raw * (1 - amount)));
        return darker.toString(16).padStart(2, "0");
    };
    return `#${channel(0)}${channel(2)}${channel(4)}`;
}
