import { Type, type Static } from "@sinclair/typebox";
import { EditorPathSaison, PATH_MARKS } from "./editor-path-update.ts";
import { FeldHerkuenfte } from "./feld-herkunft.ts";
import { pathReaderName } from "./path-names.ts";
import { parsePathChain } from "./subject.ts";
import { EDITOR_LANDSCAPE_CIRCLES } from "./landscape-editor.ts";
import { WikiArtikel } from "./wiki-zuordnung.ts";
import { UUID_PATTERN } from "./operation.ts";

/**
 * Der Lesepfad des Wege-Fensters (WI-0177 Stufe 2, W5a), nach dem Muster der Kraftlinien (`powerline-editor.ts`, WI-0205 K1).
 *
 * - 🔴 Recht `use_editor_menu` (ab Reviewer), am Server über `protect`; ohne Recht 403 vor jeder Abfrage.
 * - **Ein Weg ist sein Name** (WI-0177 Vorschlag 3 Schritt 2, Legacys Regel (c) `wpGroupKeyOf`, Owner 2026-09-15: „die selektion soll
 *   ausdrücklich über den namen - nicht über die wiki-zuweisung erfolgen“): die Abschnitte gleichen echten Namens, über Wegtypen und
 *   Kennzeichen hinweg. Ein Abschnitt ohne echten Namen (leer oder ein Griff wie „Pfad-3443“, `pathReaderName`) ist ein Weg für sich.
 *   Seine Kennung im Editor ist der **Anker**, die kleinste öffentliche Kennung seiner Abschnitte. Seewege fehlen: Die Karte zeigt sie
 *   niemandem (Betreiber 2026-09-27). Die Auswahl auf der Karte und der `PathRef` mit Kette trennen bis Schritt 2b noch nach Wegtyp.
 * - Liegt der Weg auf mehreren Wegtypen, nennt `subtype` den häufigsten, `subtypes` alle, und jeder Abschnitt der Straße seinen eigenen.
 *   Das Kennzeichen (Karawanenroute, Migration 0174, WI-0177 §30) steht an der Zeile, wenn alle Abschnitte es tragen; an der Straße trägt
 *   es zusätzlich jeder Abschnitt, der es hat (gemischt wie der Tunnel).
 * - **Der Kreis** wie in allen Listen (EDIT-0003 T26 (5), Probierblatt P5): links das Wiki, voll nur, wenn JEDER Abschnitt den Artikel
 *   trägt; rechts die Karte: leer für Abschnitte, die von der Karte genommen sind (Stufe 3b, F12, T43).
 * - **Nicht auf der Karte:** genommene Abschnitte stehen als eigene Zeilen (\`offMap\`), getrennt von den Abschnitten derselben Straße
 *   auf der Karte; ihre Straße (\`/street\`) sind die genommenen Abschnitte gleichen Namens und gleicher Art.
 * - **Gelöscht** (EDIT-0003 T54): ganz gelöschte Abschnitte ebenso als eigene Zeilen (\`deleted\`); ihr Fenster ist nur lesend, der
 *   Verlauf holt sie zurück. Dazu zählen auch Legacy-Wege, die ein Import still gelegt hat.
 * - Koordinaten sind MCS \`aventuria-v1\`.
 */

export const EDITOR_PATHS_URL = "/api/editor/paths";
/** Die Straße, zu der ein Abschnitt gehört, mit ihren Abschnitten. */
export const editorPathStreetUrl = (publicId: string): string => `/api/editor/paths/${publicId}/street`;
/** Das Flussnetz der Straße (OPS-000112): wie die Wegfindung ihre Flussabschnitte verbindet. */
export const editorPathFlussnetzUrl = (publicId: string): string => `/api/editor/paths/${publicId}/street/flussnetz`;

const strict = { additionalProperties: false } as const;
const PublicId = () => Type.String({ pattern: UUID_PATTERN });

/** Ein gespeichertes Zeitfenster wie `path.transport_seasons` (beide Enden eingeschlossen; Monat als Schlüssel, Tag 1 bis 30). */
export { EditorPathSaison };

/**
 * Was auf einem Abschnitt fährt, wie gespeichert: `liste` (`path.allowed_transports`, null ohne Liste), `domaene`
 * (`transport_domain`) und `fenster` (`transport_seasons`). Das Fenster rechnet daraus mit denselben Funktionen wie die Wegfindung
 * (`allowedTransportsForPath`, `pathSeasonWindow`), damit es nie etwas anderes zeigt, als beim Routen gilt (WI-0177, Abgleich mit der
 * Wegfindung 2026-10-19).
 */
export const EditorPathReisen = Type.Object(
    {
        liste: Type.Union([Type.Array(Type.String()), Type.Null()]),
        domaene: Type.Union([Type.String(), Type.Null()]),
        fenster: Type.Record(Type.String(), EditorPathSaison),
        /** Vom Editor vollständig geschrieben (`path.transports_written`, Migration 0208, F16 „A“): nichts erbt; fehlt sonst. */
        geschrieben: Type.Optional(Type.Literal(true)),
    },
    strict,
);
export type EditorPathReisen = Static<typeof EditorPathReisen>;
const Rahmen = Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]);
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));
/** Das Kennzeichen über dem Wegtyp; fehlt ohne. */
const Mark = () => Type.Optional(Union(PATH_MARKS));
/** Die Wegtypen einer Straße mit Kennzeichen, wenn es mehrere sind: der mit den meisten Abschnitten zuerst. */
const Untergrund = () => Type.Optional(Type.Array(Type.String(), { minItems: 2 }));

const Wiki = Type.Object(
    {
        url: Type.String({ minLength: 1 }),
        /** Der Titel des Artikels aus Legacys Abzug (\`wiki_path_snapshot.name\`); fehlt ohne Abzug. */
        title: Type.Optional(Type.String()),
    },
    strict,
);

export const EditorPathRow = Type.Object(
    {
        /** Der Anker: die kleinste öffentliche Kennung der Abschnitte. */
        id: PublicId(),
        /** Der gespeicherte Name, auch ein Griff wie „Weg-6029“; wie er heißt, entscheidet der Client (\`pathReaderName\`). */
        name: Type.String(),
        /** Der Wegtyp; mit Kennzeichen auf gemischtem Untergrund der häufigste. */
        subtype: Type.String(),
        mark: Mark(),
        subtypes: Untergrund(),
        isBach: Type.Boolean(),
        circle: Union(EDITOR_LANDSCAPE_CIRCLES),
        segments: Type.Integer({ minimum: 1 }),
        /** Der Artikel, den mindestens ein Abschnitt trägt. */
        wiki: Type.Optional(Wiki),
        /** Wie viele Abschnitte den Artikel tragen; nur da, wenn es ein Teil ist. */
        wikiSegments: Type.Optional(Type.Integer({ minimum: 1 })),
        /** Der Rahmen des Kontrollpolygons zum Hinfliegen: [x0, y0, x1, y1]. */
        bounds: Type.Optional(Rahmen),
        /** Woher der Weg stammt, wenn nicht aus Legacy (\`path.source_system\`). */
        source: Type.Optional(Type.String()),
        /** Von der Karte genommen (Stufe 3b); fehlt auf der Karte. */
        offMap: Type.Optional(Type.Literal(true)),
        /** Ganz gelöscht (T54); fehlt sonst. */
        deleted: Type.Optional(Type.Literal(true)),
    },
    strict,
);
export type EditorPathRow = Static<typeof EditorPathRow>;

export const EditorPathList = Type.Object({ rows: Type.Array(EditorPathRow) }, strict);
export type EditorPathList = Static<typeof EditorPathList>;

/**
 * Ein Abschnitt der Straße. Die Abschnitte stehen in ihrer Folge entlang der Straße (EDIT-0003 T49: „n · Von – Bis“): vom westlichen
 * freien Ende aus, Stück für Stück, bei einer Lücke weiter am nächsten westlichen Ende. `von` und `bis` nennen die Orte an den Enden in
 * dieser Richtung; ohne Ort dort (Abzweig, Kartenrand) fehlen sie.
 */
/** Ein weiterer Straßenname eines Abschnitts (WI-0302): der Wiki-Artikel, Schlüssel und Titel. */
export const EditorPathWeiterer = Type.Object(
    { key: Type.String({ minLength: 1 }), name: Type.String(), url: Type.Optional(Type.String()) },
    strict,
);
export type EditorPathWeiterer = Static<typeof EditorPathWeiterer>;

export const EditorPathStreetSegment = Type.Object(
    {
        id: PublicId(),
        revision: Type.Integer({ minimum: 1 }),
        labelVisible: Type.Boolean(),
        /** Trägt dieser Abschnitt den Artikel? */
        wiki: Type.Boolean(),
        /** Wie viele Stützpunkte er hat. */
        points: Type.Integer({ minimum: 2 }),
        /** Sein Wegtyp, nur wenn die Straße mehrere hat (`EditorPathStreet.subtypes`). */
        subtype: Type.Optional(Type.String()),
        /** Läuft durch einen Tunnel (Migration 0172); fehlt sonst. Gestrichelt auf der Karte, kein Zugang querfeldein. */
        tunnel: Type.Optional(Type.Literal(true)),
        /** Sein Kennzeichen (Karawanenroute); fehlt ohne. Eine Straße kann es nur an manchen Abschnitten tragen (gemischt). */
        mark: Mark(),
        bounds: Type.Optional(Rahmen),
        /** Der Ort am Anfang (in der Folge der Straße). */
        von: Type.Optional(Type.String()),
        /** Der Ort am Ende (in der Folge der Straße). */
        bis: Type.Optional(Type.String()),
        /**
         * Sein Wegtyp; der Server nennt ihn immer (anders als `subtype`, das nur bei mehreren steht). Er bestimmt Angebot und Vorgabe der
         * Reisemittel. Fehlt er (ältere Stände, Proben), gilt der Wegtyp der Straße.
         */
        art: Type.Optional(Type.String()),
        /** Ist der Abschnitt ein Bach (Flussweg)? Dann ist die Vorgabe „keine Boote“ (F14). */
        bach: Type.Optional(Type.Boolean()),
        /**
         * Die Fließrichtung eines Flusses (Plan Fluss/Bach, Schritt 4): `forward` in Zeichenrichtung (vom ersten zum letzten Punkt),
         * `reverse` dagegen; fehlt: offen, oder kein Fluss.
         */
        flowDirection: Type.Optional(Type.Union([Type.Literal("forward"), Type.Literal("reverse")])),
        /** Die Reisemittel des Abschnitts, wie gespeichert (`EditorPathReisen`). */
        reisen: Type.Optional(EditorPathReisen),
        /**
         * Herkunft von Name, Wegtyp und Kennzeichen an diesem Abschnitt (`field_origin`, WI-0225 §7); fehlt ohne Vermerk. Die Zeile im
         * Fenster rechnet daraus die der Straße (`herkunftDerAbschnitte`).
         */
        herkunft: Type.Optional(FeldHerkuenfte),
        /** Die weiteren Straßennamen des Abschnitts (WI-0302): seine weiteren Wiki-Artikel, nach Namen geordnet; fehlt ohne. */
        weitere: Type.Optional(Type.Array(EditorPathWeiterer)),
    },
    strict,
);
export type EditorPathStreetSegment = Static<typeof EditorPathStreetSegment>;

/**
 * Ein Abschnitt einer anderen Straße, der den Artikel DIESER Straße als weiteren Straßennamen trägt (WI-0302; Vali 2026-11-10, Option „Ja,
 * mitzählen“): Er zählt zu dieser Straße, bearbeitet wird er bei seiner eigenen. Beispiel: Sibur → Radoleth ist Abschnitt 10 des Sikramstiegs und
 * gehört zum Goldfelser Stieg.
 */
export const EditorPathGeteilt = Type.Object(
    {
        id: PublicId(),
        /** Der Name der Straße, der der Abschnitt gehört. */
        strasse: Type.String(),
        /** Ein Abschnitt jener Straße, über den das Fenster sie öffnet (ihr Anker). */
        strasseId: PublicId(),
        /** Seine Nummer in der Folge jener Straße (1-basiert), wie ihre Abschnittsliste sie zeigt. */
        nummer: Type.Integer({ minimum: 1 }),
        von: Type.Optional(Type.String()),
        bis: Type.Optional(Type.String()),
        bounds: Type.Optional(Rahmen),
    },
    strict,
);
export type EditorPathGeteilt = Static<typeof EditorPathGeteilt>;

export const EditorPathStreet = Type.Object(
    {
        id: PublicId(),
        name: Type.String(),
        /** Der Wegtyp; mit Kennzeichen auf gemischtem Untergrund der häufigste. */
        subtype: Type.String(),
        mark: Mark(),
        subtypes: Untergrund(),
        isBach: Type.Boolean(),
        circle: Union(EDITOR_LANDSCAPE_CIRCLES),
        /** „Name auf der Karte“: an allen Abschnitten gleich, sonst \`null\` (gemischt). */
        labelVisible: Type.Union([Type.Boolean(), Type.Null()]),
        wiki: Type.Optional(Wiki),
        /**
         * Der Artikel mit seinen Wiki-Werten für das Wiki-Feld (WI-0225, `fenster/wiki-feld`): `name` der Titel, `subtype` und `mark` die
         * Weg-Art des Wiki als Text (`wiki_path_snapshot.art`; die Zuordnung zu Wegtyp und Kennzeichen macht der Browser über
         * `wegtypAusWiki` und `kennzeichenAusWiki`). Ein fehlender Schlüssel heißt unbekannt. Fehlt ohne Schnappschuss.
         */
        artikel: Type.Optional(WikiArtikel),
        /** Die Abschnitte in ihrer Folge entlang der Straße (`EditorPathStreetSegment`). */
        segments: Type.Array(EditorPathStreetSegment, { minItems: 1 }),
        /** Abschnitte anderer Straßen, die den Artikel dieser Straße als weiteren Straßennamen tragen (WI-0302); fehlt ohne. Nur lesend. */
        geteilt: Type.Optional(Type.Array(EditorPathGeteilt)),
        bounds: Type.Optional(Rahmen),
        source: Type.Optional(Type.String()),
        /** Von der Karte genommen (Stufe 3b): alle Abschnitte dieser Straße. */
        offMap: Type.Optional(Type.Literal(true)),
        /** Ganz gelöscht (T54): alle Abschnitte dieser Straße; das Fenster liest nur. */
        deleted: Type.Optional(Type.Literal(true)),
    },
    strict,
);
export type EditorPathStreet = Static<typeof EditorPathStreet>;

/**
 * Das Flussnetz einer Straße für „Fließrichtung auf alle Abschnitte übernehmen“ (OPS-000112, `fliessrichtung.ts`): je Flussabschnitt seine
 * Knoten in Zeichenrichtung (Anfang, innere Teilungen, Ende) und die Länge zwischen je zwei, gerechnet mit der Topologie der Wegfindung
 * (`routing/topology.ts`, eingestellter Fangradius). Ein Knoten ist eine Kennung ohne Bedeutung für den Browser, nur zum Vergleichen.
 * Abschnitte, die kein Fluss sind, fehlen.
 */
export const EditorPathFlussnetz = Type.Object(
    {
        abschnitte: Type.Array(
            Type.Object(
                {
                    id: PublicId(),
                    knoten: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 2 }),
                    laengen: Type.Array(Type.Number({ minimum: 0 }), { minItems: 1 }),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type EditorPathFlussnetz = Static<typeof EditorPathFlussnetz>;

/**
 * Die Gruppe eines Abschnitts in der Liste: sein echter Name (Legacys Regel (c), `wpGroupKeyOf`), über Wegtypen und Kennzeichen hinweg;
 * ein Abschnitt ohne echten Namen (leer oder ein Griff, `pathReaderName`) nur er selbst. Verglichen wird der Name wie gespeichert.
 */
export function editorPathGroupKey(segment: {
    readonly publicId: string;
    readonly name: string;
    readonly subtype: string;
}): string {
    const name = pathReaderName(segment.name, segment.subtype);
    return name === null ? `#${segment.publicId}` : `name:${name}`;
}

/** Trifft die Kette der Kartenauswahl (`name:<Name>`, auch das alte `Name:Wegtyp`) diese Zeile? Ein Weg ist sein Name (Schritt 2b). */
export function editorPathRowHasChain(row: Pick<EditorPathRow, "name">, kette: string): boolean {
    return parsePathChain(kette)?.name === row.name;
}
