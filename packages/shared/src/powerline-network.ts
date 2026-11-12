import { Type, type Static } from "@sinclair/typebox";

/**
 * Das Netz der Kraftlinien und ihre Bögen am Himmel (WI-0025 Stufe 2).
 *
 * Betreiber 2026-09-23: „kraft linien laufen für die menschen am "himmel entlang", schweben also
 * über der landschaft, enden aber dann in nodices.“ Geneigt steigt jedes Stück als Bogen auf und
 * landet an seinen beiden Enden.
 *
 * 🔴 Jedes Ende ist ein Landepunkt: ein Ort, ein Label oder ein Kraftlinienpunkt. Stufe 2 spannte
 * die Bögen noch über Treffpunkte hinweg (Ketten von Anker zu Anker); Betreiber 2026-09-26 zu den
 * 19 Treffpunkten: „richtig, dort landen, wie bei knoten“. Die Ketten sind damit entfallen.
 */

/**
 * Woran ein Linienende hängt.
 *
 * - `place`: ein Ort.
 * - `label`: ein Label. Legacy lässt Kraftlinien an Nodix-Labels enden (Owner 2026-07-28,
 *   `powerline-anchor-delete-test.php`); bei einer Fläche trägt ihr Label das Kennzeichen. Betreiber
 *   2026-09-23: „nicht nur orte sondern auch flächen oder labels können nodix sein“.
 * - `nodix`: ein Kraftlinienpunkt, eigener Objekttyp (Betreiber 2026-09-26: „Kraftlinienpunkte a.k.a.
 *   Nodix“, nicht die Kreuzungen des Wegenetzes). Ein Knoten wie jeder andere.
 * - `landmark`: eine Landmarke (WI-0271 §17; Vali 2026-11-02: Landmarken können Nodix sein). Ein umgewandelter Ort gibt ihr seine Linien weiter.
 * - `missing`: der Knoten fehlt im Bestand (Befund KL2). Die Linie endet offen.
 */
export const PowerlineEndKind = Type.Union([
    Type.Literal("place"),
    Type.Literal("label"),
    Type.Literal("nodix"),
    Type.Literal("landmark"),
    Type.Literal("missing"),
]);
export type PowerlineEndKind = Static<typeof PowerlineEndKind>;

export const PowerlineEnd = Type.Object(
    {
        id: Type.String(),
        kind: PowerlineEndKind,
    },
    { additionalProperties: false },
);
export type PowerlineEnd = Static<typeof PowerlineEnd>;

export const PowerlineNetworkLine = Type.Object(
    {
        id: Type.String(),
        name: Type.String(),
        labelVisible: Type.Boolean(),
        /** Legacys Bogen in Prozent der Sehne; `null` heißt „nie gesetzt“, gezeichnet wie 0. */
        curve: Type.Union([Type.Number(), Type.Null()]),
        from: PowerlineEnd,
        to: PowerlineEnd,
        /** Die GEZEICHNETE Bahn (`drawn_geom`) in Kartenkoordinaten, vom Anfang zum Ende. */
        path: Type.Array(Type.Tuple([Type.Number(), Type.Number()]), { minItems: 2 }),
    },
    { additionalProperties: false },
);
export type PowerlineNetworkLine = Static<typeof PowerlineNetworkLine>;

/** Die Antwort von `GET /api/powerlines`: alle aktiven Kraftlinien, nach `public_id` geordnet. */
export const PowerlineNetwork = Type.Object(
    {
        lines: Type.Array(PowerlineNetworkLine),
    },
    { additionalProperties: false },
);
export type PowerlineNetwork = Static<typeof PowerlineNetwork>;

/**
 * Wie hoch ein Bogen über einem Punkt seines Stücks steht, in Bildschirmpixeln.
 *
 * Ein Sinusbogen über dem Stück, `share` seiner Länge hoch, und nie höher als `maxPx`: Nah dran
 * lägen lange Bögen sonst über der Kamera und wären weg (Prototyp, z6). Oben flacht der Bogen weich
 * ab, und lange Stücke werden zu Himmelsstraßen auf gleicher Höhe.
 *
 * 🔴 Dieselbe Rechnung steht als Shader in `apps/web/src/map/powerline-arcs.ts` (`hoehe`). Beide
 * lesen ihre Zahlen aus derselben Tafel.
 */
export function powerlineArcHeight(arc: { share: number; maxPx: number }, lengthPx: number, runPx: number): number {
    if (!(lengthPx > 0) || !(arc.maxPx > 0)) {
        return 0;
    }
    const anteil = Math.min(Math.max(runPx / lengthPx, 0), 1);
    const roh = arc.share * lengthPx * Math.sin(Math.PI * anteil);
    return arc.maxPx * Math.tanh(roh / arc.maxPx);
}

/**
 * Wie weit die Bögen aufgestiegen sind, 0 bis 1, nach der Neigung der Karte.
 *
 * Flach liegen sie genau auf der Legacy-Bahn, erst mit der Neigung steigen sie. `smoothstep`, damit
 * das Aufsteigen weich beginnt und weich endet.
 */
export function powerlineArcLift(pitch: number, fullFromPitch: number): number {
    if (!(fullFromPitch > 0)) {
        return pitch > 0 ? 1 : 0;
    }
    const x = Math.min(Math.max(pitch / fullFromPitch, 0), 1);
    return x * x * (3 - 2 * x);
}
