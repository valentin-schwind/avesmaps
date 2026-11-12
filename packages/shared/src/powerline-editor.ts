import { Type, type Static } from "@sinclair/typebox";
import { FeldHerkuenfte } from "./feld-herkunft.ts";
import { EDITOR_LANDSCAPE_CIRCLES, editorLandscapeCircle, type EditorLandscapeCircle } from "./landscape-editor.ts";
import { UUID_PATTERN } from "./operation.ts";
import { PowerlineEndKind } from "./powerline-network.ts";
import { WikiArtikel } from "./wiki-zuordnung.ts";

/**
 * Der Lesepfad des Kraftlinien-Editors (WI-0205 Paket K1), nach dem Muster der Landschaften (`landscape-editor.ts`).
 *
 * - 🔴 Recht `use_editor_menu` (ab Reviewer), am Server über `protect`; ohne Recht 403 vor jeder Abfrage.
 * - **Eine Kraftlinie ist die Gruppe ihrer Abschnitte gleichen Namens** (Legacy, Owner 23.07.: „Linie = alle ihre Segmente“); ein
 *   Abschnitt mit leerem Namen ist eine Linie für sich. Ihre Kennung im Editor ist der **Anker**, die kleinste öffentliche Kennung
 *   ihrer Abschnitte (Legacy hängt so auch die Quellen an). 🪤 Das Infopanel gruppiert anders, nach dem Wiki-Artikel
 *   (`apps/server/src/subjects/detail-powerline.ts`); eine Linie mit Teilzuordnung zeigt dort zwei Gruppen.
 * - **Der Kreis je Abschnitt** (Betreiber wählte „Je Abschnitt“, EDIT-0003 T28 (1)): links die Hälfte für das Wiki, voll nur, wenn
 *   JEDER Abschnitt den Artikel trägt; rechts die für die Karte. Dieselben vier Zustände und Füllungen wie bei Landschaften und Orten
 *   (T26 (5)). Wie viele Abschnitte den Artikel tragen, nennt die Zeile, wenn es nur ein Teil ist.
 * - **Gestalt** wie Legacy (`powerline-topology.js`): Strang, Ring, verzweigt oder in Teilen; gerechnet aus den Abschnitten
 *   (`kraftlinienGestalt`), auf dem Server für die Liste und im Client für die Kette der Nodices.
 * - Koordinaten sind MCS `aventuria-v1`. Jeder Abschnitt trägt seine Revision (Migration 0143, Paket K4); gespeichert wird gegen alle
 *   Revisionen der Linie (`powerline-editor-ops.ts`, Paket K6).
 */

export const EDITOR_POWERLINES_URL = "/api/editor/powerlines";

/** Die vier Zustände des Kreises, dieselben wie in allen Listen (EDIT-0003 T26 (5)). */
export const EDITOR_POWERLINE_CIRCLES = EDITOR_LANDSCAPE_CIRCLES;
export type EditorPowerlineCircle = EditorLandscapeCircle;

export const POWERLINE_SHAPES = ["strang", "ring", "verzweigt", "teile"] as const;
export type PowerlineShape = (typeof POWERLINE_SHAPES)[number];

const strict = { additionalProperties: false } as const;
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
const PublicId = () => Type.String({ pattern: UUID_PATTERN });
const Rahmen = Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]);

const Wiki = Type.Object(
    {
        url: Type.String({ minLength: 1 }),
        /** Der Titel des Artikels aus Legacys Abzug (`wiki_powerline_snapshot.name`); fehlt ohne Abzug. */
        title: Type.Optional(Type.String()),
    },
    strict,
);

export const EditorPowerlineRow = Type.Object(
    {
        /** Der Anker: die kleinste öffentliche Kennung der Abschnitte. */
        id: PublicId(),
        name: Type.String(),
        circle: Union(EDITOR_POWERLINE_CIRCLES),
        shape: Union(POWERLINE_SHAPES),
        segments: Type.Integer({ minimum: 1 }),
        nodes: Type.Integer({ minimum: 0 }),
        /** Der Artikel, den mindestens ein Abschnitt trägt. */
        wiki: Type.Optional(Wiki),
        /** Wie viele Abschnitte den Artikel tragen; nur da, wenn es ein Teil ist (mehr als keiner, weniger als alle). */
        wikiSegments: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Die zwei Enden eines Strangs, West vor Ost: ihr Name, leer für einen Kraftlinienpunkt ohne Namen. */
        ends: Type.Optional(Type.Tuple([Type.String(), Type.String()])),
        /** Wie viele Knoten im Bestand fehlen (Verweise ins Leere, Befund KL2); fehlt bei keinem. */
        missingNodes: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Der Rahmen der gezeichneten Bahn zum Hinfliegen: [x0, y0, x1, y1]. */
        bounds: Type.Optional(Rahmen),
        /** Woher die Linie stammt, wenn nicht aus Legacy (`powerline.source_system`). */
        source: Type.Optional(Type.String()),
        /** Von der Karte genommen (K10): steht unter „Nicht auf der Karte“, der Kreis ist ◐ oder ○. */
        offMap: Type.Optional(Type.Literal(true)),
        /** Ganz gelöscht (K10, EDIT-0003 T54): steht nur unter „Gelöscht“ und zählt in keiner Legende; der Verlauf holt sie zurück. */
        deleted: Type.Optional(Type.Literal(true)),
    },
    strict,
);
export type EditorPowerlineRow = Static<typeof EditorPowerlineRow>;

export const EditorPowerlineList = Type.Object({ rows: Type.Array(EditorPowerlineRow) }, strict);
export type EditorPowerlineList = Static<typeof EditorPowerlineList>;

/** Ein Abschnitt der Linie: von Knoten zu Knoten, mit seiner Kurve und seinem Artikel. */
export const EditorPowerlineSegment = Type.Object(
    {
        id: PublicId(),
        from: Type.String(),
        to: Type.String(),
        /** Der Bogen in Prozent der Sehne, wie gespeichert; `null` heißt „nie gespeichert“ und zeichnet gerade. */
        curve: Type.Union([Type.Number(), Type.Null()]),
        /** „Name auf der Karte anzeigen“ (`powerline.label_visible`). */
        labelVisible: Type.Boolean(),
        /** Die Fachrevision des Abschnitts (Trigger `powerline_revision`, 0143); gegen sie wird gespeichert. */
        revision: Type.Integer({ minimum: 1 }),
        /** Die Beschreibung (KF1); fehlt, wenn keine. */
        description: Type.Optional(Type.String()),
        /** Der Artikel dieses Abschnitts; fehlt ohne Zuordnung. */
        wiki: Type.Optional(Wiki),
        /**
         * Woher Name und Beschreibung dieses Abschnitts kommen (`field_origin`, WI-0225 Modell c; je Abschnitt, Orchestrierung
         * 2026-10-18); fehlt ohne Vermerk. Die Linie fasst zusammen: „folgt dem Wiki“ nur, wenn alle Abschnitte wiki tragen.
         */
        herkunft: Type.Optional(FeldHerkuenfte),
    },
    strict,
);
export type EditorPowerlineSegment = Static<typeof EditorPowerlineSegment>;

/** Ein Knoten der Linie: ein Ort, ein Label, ein Kraftlinienpunkt, oder fehlend. */
export const EditorPowerlineNode = Type.Object(
    {
        id: Type.String(),
        kind: PowerlineEndKind,
        /** Der Name eines Orts oder Labels; ein Kraftlinienpunkt hat keinen. */
        name: Type.Optional(Type.String()),
        x: Type.Optional(Type.Number()),
        y: Type.Optional(Type.Number()),
        /** Das Merkmal Nodix (Ort und Label); ein Kraftlinienpunkt ist immer einer. Nur ein Nodix ist Ziel einer neuen Linie. */
        nodix: Type.Boolean(),
        /** Die anderen Linien, die hier enden („trifft:“). */
        meets: Type.Array(Type.String()),
    },
    strict,
);
export type EditorPowerlineNode = Static<typeof EditorPowerlineNode>;

export const EditorPowerlineDetail = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        circle: Union(EDITOR_POWERLINE_CIRCLES),
        shape: Union(POWERLINE_SHAPES),
        wiki: Type.Optional(Wiki),
        /** Die Beschreibung der Linie (KF1): die erste gesetzte ihrer Abschnitte, wie Legacys `fieldSample`; fehlt, wenn keine. */
        description: Type.Optional(Type.String()),
        segments: Type.Array(EditorPowerlineSegment, { minItems: 1 }),
        nodes: Type.Array(EditorPowerlineNode),
        bounds: Type.Optional(Rahmen),
        source: Type.Optional(Type.String()),
        /** Nicht auf der Karte (K10): von der Karte genommen oder gelöscht; fehlt auf der Karte. */
        state: Type.Optional(Union(["abgenommen", "geloescht"] as const)),
        /**
         * Der Artikel der Linie mit seinen Wiki-Werten (WI-0205, je LINIE wie Legacy: der des ersten Abschnitts, der einen trägt), für die
         * Wiki-Zuordnung im Fenster; fehlt ohne Artikel oder ohne Abzug.
         */
        article: Type.Optional(WikiArtikel),
        /** Wie viele Abschnitte den Artikel tragen, nur bei einer Teilzuordnung (mehr als keiner, weniger als alle). */
        articleSegments: Type.Optional(Type.Integer({ minimum: 1 })),
    },
    strict,
);
export type EditorPowerlineDetail = Static<typeof EditorPowerlineDetail>;

/** Der Kreis einer Kraftlinie: links „jeder Abschnitt trägt den Artikel“, rechts „auf der Karte“ (T28 (1), T26 (5)). */
export function editorPowerlineCircle(placed: boolean, everySegmentWiki: boolean): EditorPowerlineCircle {
    return editorLandscapeCircle(placed, everySegmentWiki);
}

/** Ein Abschnitt für die Gestalt: seine Kennung und seine zwei Knoten. */
export interface GestaltAbschnitt {
    readonly id: string;
    readonly from: string;
    readonly to: string;
}

/** Ein Glied der Kette: ein Knoten oder ein Abschnitt; `zurueck` am letzten Knoten eines Rings. */
export type KettenGlied = { readonly knoten: string; readonly zurueck?: true } | { readonly abschnitt: string };

export interface KraftlinienGestalt {
    readonly shape: PowerlineShape;
    /** Die Knoten mit genau einem Abschnitt. */
    readonly enden: readonly string[];
    /** Wie viele zusammenhängende Teile. */
    readonly teile: number;
    /** Bei Strang und Ring die Folge Knoten, Abschnitt, Knoten …, vom westlichen Ende her; sonst leer. */
    readonly kette: readonly KettenGlied[];
}

/**
 * Die Gestalt einer Linie aus ihren Abschnitten (Legacy `powerline-topology.js`): ungerichteter Graph über die Knoten; mehr als ein
 * zusammenhängender Teil ist „in Teilen“, sonst jeder Knoten mit höchstens zwei Abschnitten ein Strang (oder ein Ring, wenn es so viele
 * Abschnitte wie Knoten gibt), sonst verzweigt. `lage` stellt die Kette vom westlichen Ende her; ohne Lage vom kleinsten Knoten. Reine
 * Rechnung.
 */
export function kraftlinienGestalt(
    abschnitte: readonly GestaltAbschnitt[],
    lage?: (knoten: string) => readonly [number, number] | undefined,
): KraftlinienGestalt {
    const nachbarn = new Map<string, { nach: string; abschnitt: string }[]>();
    const kante = (von: string, nach: string, abschnitt: string): void => {
        const liste = nachbarn.get(von);
        if (liste) liste.push({ nach, abschnitt });
        else nachbarn.set(von, [{ nach, abschnitt }]);
    };
    for (const a of abschnitte) {
        kante(a.from, a.to, a.id);
        kante(a.to, a.from, a.id);
    }
    const knoten = [...nachbarn.keys()];
    if (knoten.length === 0) return { shape: "strang", enden: [], teile: 0, kette: [] };

    const gesehen = new Set<string>();
    let teile = 0;
    for (const start of knoten) {
        if (gesehen.has(start)) continue;
        teile += 1;
        const offen = [start];
        gesehen.add(start);
        while (offen.length > 0) {
            for (const { nach } of nachbarn.get(offen.pop() as string) ?? []) {
                if (!gesehen.has(nach)) {
                    gesehen.add(nach);
                    offen.push(nach);
                }
            }
        }
    }
    const grad = (k: string): number => nachbarn.get(k)?.length ?? 0;
    const enden = knoten.filter((k) => grad(k) === 1);
    let shape: PowerlineShape;
    if (teile > 1) shape = "teile";
    else if (knoten.every((k) => grad(k) <= 2)) shape = abschnitte.length === knoten.length ? "ring" : "strang";
    else shape = "verzweigt";

    const westlich = (kandidaten: readonly string[]): string =>
        [...kandidaten].sort((p, q) => {
            const a = lage?.(p)?.[0];
            const b = lage?.(q)?.[0];
            if (a !== undefined && b !== undefined && a !== b) return a - b;
            return p < q ? -1 : p > q ? 1 : 0;
        })[0] as string;
    const kette = (start: string, ring: boolean): KettenGlied[] => {
        const folge: KettenGlied[] = [{ knoten: start }];
        const benutzt = new Set<string>();
        let jetzt = start;
        for (;;) {
            const weiter = (nachbarn.get(jetzt) ?? []).find((e) => !benutzt.has(e.abschnitt));
            if (weiter === undefined) break;
            benutzt.add(weiter.abschnitt);
            folge.push({ abschnitt: weiter.abschnitt });
            if (ring && weiter.nach === start) {
                folge.push({ knoten: start, zurueck: true });
                break;
            }
            folge.push({ knoten: weiter.nach });
            jetzt = weiter.nach;
        }
        return folge;
    };
    return {
        shape,
        enden,
        teile,
        kette:
            shape === "strang"
                ? kette(westlich(enden.length > 0 ? enden : knoten), false)
                : shape === "ring"
                  ? kette(westlich(knoten), true)
                  : [],
    };
}
