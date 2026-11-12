import { Type, type Static, type TLiteral, type TUnion } from "@sinclair/typebox";
import { INHALTE_VORKOMMEN_ARTEN, INHALTE_VORKOMMEN_BEZIEHUNGEN } from "./inhalte-vorkommen.ts";
import { UUID_PATTERN } from "./operation.ts";

/**
 * Die Auswertung der Vorkommensregeln (WI-0257, Scheibe S1): was ein Eintrag auf der Karte trifft und was ein Gegenstand der Karte an Einträgen trägt. Die Typen stehen hier, damit
 * Server (`apps/server/src/vorkommen/`), Panel, Suche und Routenplaner dieselbe Form lesen; eine Route gibt es noch nicht.
 *
 * 🔴 **Eine Regel ist eine Geometrie.** Jede Bedingung ergibt eine Fläche: die aktiven, nicht verborgenen Landschaften einer ihrer Arten (Ebene `klima` nie), geschnitten mit der Rahmenfläche, dem
 * Klimaband der Spanne und der Halbebene der Lage. Die Kette läuft streng von links nach rechts ohne Vorrang: `und` schneidet, `oder` vereinigt, `ohne` zieht ab. Daraus folgen zwei Richtungen,
 * die dieselbe Auswertung sind:
 *
 * - **A, Eintrag → Karte** (`trefferDesEintrags`): die Landschaften, die die Geometrie einer Regel berühren, ganz oder angeschnitten (dann mit der zugeschnittenen Form), dazu die Siedlungen darin.
 * - **B, Gegenstand → Einträge** (`eintraegeAmPunkt`, `eintraegeAnPunkten`, `eintraegeAnFlaechen`): für einen Kartenpunkt exakt als Kette von Wahrheitswerten je Bedingung.
 *
 * Zusage (vom Test an Stichproben geprüft): Ein Punkt liegt in der leuchtenden Geometrie aus A genau dann, wenn B an diesem Punkt die Regel nennt.
 */

const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });
const oneOf = <T extends string>(werte: readonly T[]): TUnion<TLiteral<T>[]> =>
    Type.Union(werte.map((wert) => Type.Literal(wert)));

/** Ein Punkt der Karte in Kartenkoordinaten (`y` nach Norden). */
export const VorkommenPunkt = Type.Object({ x: Type.Number(), y: Type.Number() }, strict);
export type VorkommenPunkt = Static<typeof VorkommenPunkt>;

/** Ein Rahmen in Kartenkoordinaten, für den Flug der Kamera. */
export const VorkommenRahmen = Type.Object(
    { x0: Type.Number(), y0: Type.Number(), x1: Type.Number(), y1: Type.Number() },
    strict,
);
export type VorkommenRahmen = Static<typeof VorkommenRahmen>;

// ---------------------------------------------------------------------------------------------------------------------
// Richtung B: Gegenstand → Einträge
// ---------------------------------------------------------------------------------------------------------------------

/** Eine Regel, die den Gegenstand trifft: Kennung und Fingerabdruck (`lore_rule.rule_key`). */
export const VorkommenRegelBezug = Type.Object(
    { ruleId: Type.String({ pattern: "^[0-9]{1,18}$" }), ruleKey: Type.String({ pattern: "^[0-9a-f]{64}$" }) },
    strict,
);
export type VorkommenRegelBezug = Static<typeof VorkommenRegelBezug>;

/**
 * Ein Eintrag, der den Gegenstand durch Regeln trifft, je Beziehung mit den treffenden Regeln. Mehrere Regeln derselben Beziehung gelten als Vereinigung: Eine genügt, sie stehen alle da.
 * `id` ist `lore_entry.id` (wie das Panel sie führt), `eintragId` die Kennung der Schnittstelle (`lore_entry.public_id`).
 */
export const VorkommenEintragTreffer = Type.Object(
    {
        id: Type.String({ pattern: "^[0-9]{1,18}$" }),
        eintragId: Uuid(),
        art: oneOf(INHALTE_VORKOMMEN_ARTEN),
        beziehungen: Type.Array(
            Type.Object(
                { beziehung: oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN), regeln: Type.Array(VorkommenRegelBezug) },
                strict,
            ),
        ),
    },
    strict,
);
export type VorkommenEintragTreffer = Static<typeof VorkommenEintragTreffer>;

/** Die Einträge an einem Punkt (bei einer Fläche als Gegenstand an dem Punkt, über den sie entschieden wird). */
export const VorkommenAmPunkt = Type.Object(
    { punkt: VorkommenPunkt, eintraege: Type.Array(VorkommenEintragTreffer) },
    strict,
);
export type VorkommenAmPunkt = Static<typeof VorkommenAmPunkt>;

// ---------------------------------------------------------------------------------------------------------------------
// Richtung A: Eintrag → Karte
// ---------------------------------------------------------------------------------------------------------------------

/** `ganz`: Die Landschaft liegt ganz in der Geometrie der Regel (die Karte lässt sie über den Kachelfilter leuchten). `angeschnitten`: Nur ein Teil, die Form liegt bei. */
export const VORKOMMEN_SCHNITTE = ["ganz", "angeschnitten"] as const;
export type VorkommenSchnitt = (typeof VORKOMMEN_SCHNITTE)[number];

/** Eine zugeschnittene Form (GeoJSON, Kartenkoordinaten, eine Nachkommastelle, vereinfacht). */
export const VorkommenForm = Type.Object(
    {
        type: Type.Union([Type.Literal("Polygon"), Type.Literal("MultiPolygon")]),
        coordinates: Type.Array(Type.Unknown()),
    },
    strict,
);
export type VorkommenForm = Static<typeof VorkommenForm>;

/**
 * Eine Landschaft, die die Geometrie einer Regel berührt. `regionId` ist `region.id`, `publicId` die Kennung der Karte (`region.public_id`). Eine ganze Landschaft trägt nur die Kennung; eine
 * angeschnittene trägt `form`, den Teil der Landschaft in der Geometrie der Regel, und `rahmen` dazu.
 */
export const VorkommenLandschaft = Type.Object(
    {
        regionId: Type.String({ pattern: "^[0-9]{1,18}$" }),
        publicId: Uuid(),
        name: Type.String(),
        schnitt: oneOf(VORKOMMEN_SCHNITTE),
        form: Type.Optional(VorkommenForm),
        rahmen: VorkommenRahmen,
    },
    strict,
);
export type VorkommenLandschaft = Static<typeof VorkommenLandschaft>;

/** Eine Siedlung in der Geometrie der Regel. */
export const VorkommenSiedlung = Type.Object(
    {
        placeId: Type.String({ pattern: "^[0-9]{1,18}$" }),
        publicId: Uuid(),
        name: Type.String(),
        art: Type.String(),
        x: Type.Number(),
        y: Type.Number(),
    },
    strict,
);
export type VorkommenSiedlung = Static<typeof VorkommenSiedlung>;

/** Was eine Regel auf der Karte trifft. */
export const VorkommenRegelTreffer = Type.Object(
    {
        ruleId: Type.String({ pattern: "^[0-9]{1,18}$" }),
        ruleKey: Type.String({ pattern: "^[0-9a-f]{64}$" }),
        beziehung: oneOf(INHALTE_VORKOMMEN_BEZIEHUNGEN),
        landschaften: Type.Array(VorkommenLandschaft),
        /**
         * Der Teil der Geometrie, der zu keiner Landschaft gehört (eine Bedingung nur mit Klima oder Lage, etwa „südlich von Gareth“): ein Stück der Karte, kein Gegenstand. Fehlt, wo es ihn nicht gibt.
         */
        rest: Type.Optional(Type.Object({ form: VorkommenForm, rahmen: VorkommenRahmen }, strict)),
        siedlungen: Type.Array(VorkommenSiedlung),
        /** Der gemeinsame Rahmen aller Treffer der Regel; `null`, wo sie nichts trifft. */
        rahmen: Type.Union([VorkommenRahmen, Type.Null()]),
        /** Wie viele Bedingungen auf eine Fläche zeigen, die es nicht mehr gibt, nicht aktiv oder verborgen ist (die Bedingung trifft dann nichts, sie schränkt nie ab). */
        verwaiste: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type VorkommenRegelTreffer = Static<typeof VorkommenRegelTreffer>;

/** Was ein Eintrag auf der Karte trifft, je Regel; `rahmen` ist der gemeinsame Rahmen für den Flug. */
export const VorkommenTreffer = Type.Object(
    {
        id: Type.String({ pattern: "^[0-9]{1,18}$" }),
        eintragId: Uuid(),
        regeln: Type.Array(VorkommenRegelTreffer),
        rahmen: Type.Union([VorkommenRahmen, Type.Null()]),
    },
    strict,
);
export type VorkommenTreffer = Static<typeof VorkommenTreffer>;

/**
 * Ein zusätzlicher Rahmen für A („Wirselkraut in Bornland“, „Wald südlich von Gareth“): Die Geometrie jeder Regel wird auf ihn zugeschnitten.
 * Nennt der Rahmen mehrere Teile, gilt ihr Schnitt.
 */
export interface VorkommenZusatzRahmen {
    /** Landschaften des Rahmens, als `region.public_id` oder `region.id`; ihre Flächen werden vereinigt. */
    regionIds?: readonly string[];
    /** Ein Herrschaftsgebiet (`territory.id`) als Rahmen; seine feinste Form. */
    territoryId?: number;
    /**
     * Die Lage zu einer Linie (WI-0257 S3a, „südlich von Gareth“): die Halbebene durch einen Ort, die Linie gehört dazu (`halbebene.ts`, dieselbe Rechnung
     * wie die Lage einer Regel). Ein Ort ergibt die waagerechte (Nord, Süd) oder senkrechte (Ost, West) Linie durch ihn.
     */
    lage?: { richtung: "nord" | "sued" | "ost" | "west"; ort: VorkommenPunkt };
    /**
     * „Zwischen zwei Orten“ (WI-0253 §27 B): zwei Bedingungen mit UND, „südlich von A UND nördlich von B“ (A der nördlichere Ort) – der Streifen zwischen den beiden
     * waagerechten Linien; liegen die Orte eher ost-west auseinander, der Streifen zwischen den senkrechten Linien („östlich von A UND westlich von B“). `halbebene.ts`, `zwischenHalbebenen`.
     */
    zwischen?: { a: VorkommenPunkt; b: VorkommenPunkt };
}

export interface VorkommenOptionen {
    rahmen?: VorkommenZusatzRahmen;
    /** Nachkommastellen der Formen (Vorgabe 1). */
    nachkommastellen?: number;
    /** Der Kartenstand, wenn der Aufrufer ihn eben gelesen hat (`ermittleKartenstand`): spart die Abfrage, wenn er mehrere Einträge nacheinander rechnet. */
    stand?: string;
}
