import { Type, type Static } from "@sinclair/typebox";

/**
 * Wie die Karte einen Flug zeichnet (WI-0051 F3): die gerundete Form eines Flugabschnitts und, geneigt,
 * die Flugbahn im Raum samt Bodenspur und Loten.
 *
 * 🔴 Nur Darstellung. Weg, Länge und Zeit eines Flugs rechnet der Server (F1, F2); hier steht, wie hoch die
 * Bahn über der Karte schwebt und wie sie gezeichnet wird. Die Farben stehen im Designkanon (`route`,
 * `routeFlight`, `routeSelected`, `routeHalo`), die Breiten der Bahn ebenfalls (`route.width`,
 * `route.haloWidth`).
 *
 * 💣 Das Schema verbietet zusätzliche Felder, wie die Tafel der Kraftlinien: Ein Tippfehler fiele sonst still
 * auf einen Vorgabewert zurück, und die Bahn sähe fast richtig aus.
 */

const Anteil = Type.Number({ minimum: 0, maximum: 1 });
const Px = Type.Number({ exclusiveMinimum: 0 });

export const FlightCartography = Type.Object(
    {
        $comment: Type.Optional(Type.String()),
        schemaVersion: Type.Literal(1),
        mapDomain: Type.String(),
        $formComment: Type.Optional(Type.String()),
        /** Die Form eines Flugabschnitts, flach wie geneigt dieselbe. */
        form: Type.Object(
            {
                /** Wie oft die Ecken des Wegs abgeschnitten werden (Chaikin); 0 lässt die Knicke stehen. */
                eckenRunden: Type.Integer({ minimum: 0, maximum: 6 }),
            },
            { additionalProperties: false },
        ),
        $bahnComment: Type.Optional(Type.String()),
        /**
         * Das Höhenprofil der Bahn im echten Maßstab: Reisehöhe und beide Höchstgrenzen (über Grund, über dem Meer)
         * kommen aus der Route, der Mindestabstand aus dem Reisemodell; hier steht nur, wie sie steigt, sinkt und die
         * Höhe hält.
         */
        bahn: Type.Object(
            {
                /** Steigen und Sinken: Höhe je Strecke, beides im echten Maßstab (1 : 4 ist 0,25). */
                steigung: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
                /** Der Bedarf gilt so viele Karteneinheiten voraus und zurück (± E). */
                haltenEinheiten: Type.Number({ minimum: 0 }),
            },
            { additionalProperties: false },
        ),
        $probenComment: Type.Optional(Type.String()),
        /** Wie dicht die Bahn abgetastet wird; jede Probe ist eine Höhenabfrage, wenn das Gelände wechselt. */
        proben: Type.Object(
            {
                jeAbschnittMindestens: Type.Integer({ minimum: 32 }),
                jeAbschnittHoechstens: Type.Integer({ minimum: 32 }),
                jeRouteHoechstens: Type.Integer({ minimum: 32 }),
                /** Frühestens nach so vielen Millisekunden wird nach neuen Höhenkacheln wieder abgetastet. */
                neuFruehestensMs: Type.Integer({ minimum: 0 }),
            },
            { additionalProperties: false },
        ),
        $zeichnungComment: Type.Optional(Type.String()),
        zeichnung: Type.Object(
            {
                /** Die Bodenspur unter der Bahn, gestrichelt in der Farbe der Bahn. */
                bodenspur: Type.Object(
                    {
                        breitePx: Px,
                        /** Ein Strich samt runder Enden, dann die Lücke, in Pixeln der Bildmitte. */
                        strichPx: Px,
                        lueckePx: Px,
                        deckkraft: Anteil,
                    },
                    { additionalProperties: false },
                ),
                /** Die hellen Lote zwischen Boden und Bahn. */
                lote: Type.Object(
                    {
                        breitePx: Px,
                        deckkraft: Anteil,
                        /** Kein Lot enger als so viele Pixel; dazwischen blendet ein neues ein. */
                        abstandPx: Px,
                        /** Höchstens so viele Teile je Abschnitt, eine Zweierpotenz. */
                        teileHoechstens: Type.Integer({ minimum: 2, maximum: 256 }),
                    },
                    { additionalProperties: false },
                ),
                /** So viele Pixel hebt die Ebene Bahn und Spur für den Tiefentest an, damit sie am Hang nicht einsinken. */
                anhebenPx: Type.Number({ minimum: 0 }),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type FlightCartography = Static<typeof FlightCartography>;
