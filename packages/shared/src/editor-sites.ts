import { Type, type Static } from "@sinclair/typebox";
import { OperationId, UUID_PATTERN } from "./operation.ts";

/**
 * Die Stätten AN EINEM ORT, über Kennungen (WI-0128 E18, WI-0134, Migration 0099; Betreiberentscheid F1 = B vom 2026-10-10).
 *
 * 🔴 **Objekt, Beziehung und Evidenz bleiben getrennt** (WI-0134 §3):
 * - `bound` — die Stätten mit einer **belegten** Innerorts-Beziehung an diesem Ort (`site_settlement.place_id`). Sie entsteht nur
 *   aus Legacys gespeicherter Kennung (P1 `innerorts.ort`, P2 `settlement_public_id`) oder aus der Entscheidung eines Menschen im
 *   Editor (`origin: "editor"`). 🔴 Hier steht auch eine **stillgelegte** Stätte, deren Beziehung noch hängt (`retired`, B4):
 *   Sie verschwindet NICHT still, denn an ihr hängt womöglich die Entscheidung eines Menschen.
 * - `open` — **über die Kette hier, ohne menschliche Zuordnung**: Stätten, deren `standort`-Kette diesen Ort an ERSTER
 *   Stelle nennt (`site_named_place`). Seit dem Betreiberentscheid vom 2026-10-13 (Lesart B) sind sie im Panel sichtbar; was
 *   fehlt, ist die gespeicherte Zuordnung. 🔴 Gebunden wird trotzdem nie automatisch: Ein Link auf einen Artikel ist keine
 *   Entscheidung, und „Hierher binden“ bleibt die Handlung eines Menschen.
 *   🔴 **B2:** Ein gespeichertes „keine Stadt“ mit Herkunft `wiki` oder `gespeichert` hält eine Stätte NICHT aus dieser Liste
 *   heraus. Es heißt nur, dass Legacys Lauf keine eindeutige Stadt fand - kein Mensch hat das entschieden, und niemand darf
 *   deshalb gegen einen Editor geschützt werden (43 Punkte mit `wiki`, einer mit `manual`). Nur `manual` und `editor` sind
 *   Entscheidungen und bleiben draußen; die Herkunft reist an der Zeile mit, damit man sieht, woran man ist.
 * - `sichtbar` — wie viele Stätten das Infopanel an diesem Ort zeigt (Lesart B, beide Rohquellen samt Wiki-Registry). Die Zahl
 *   ist größer als `bound + open`: Die Registry-Einträge sind sichtbar, aber keine `site`-Objekte und darum nicht bindbar.
 *
 * 🔴 **Kennungen statt Namen:** Jede Zeile trägt `id` (unsere `site.id`) und `sourceKey` (Legacys eigene Kennung je Quelle). Ein
 * Umhängen nennt die `id`, nie einen Namen - zwei Sitze derselben Organisation heißen gleich und sind verschiedene Objekte.
 */

export const EDITOR_SITE_SOURCE_KINDS = ["punkt", "gespeichert", "weg", "sitz", "stadtteil"] as const;
export type EditorSiteSourceKind = (typeof EDITOR_SITE_SOURCE_KINDS)[number];

/** Woher die Beziehung stammt (`site_settlement.origin`); `editor` fasst kein Zug an. */
export const EDITOR_SITE_ORIGINS = ["manual", "wiki", "gespeichert", "editor"] as const;
export type EditorSiteOrigin = (typeof EDITOR_SITE_ORIGINS)[number];

const strict = { additionalProperties: false } as const;
const Union = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));

/** Die gespeicherte Beziehung einer Stätte; ohne Ort ist sie eine Entscheidung „keine Stadt“ oder trifft keinen Ort. */
export const EditorSiteRelation = Type.Object(
    {
        origin: Union(EDITOR_SITE_ORIGINS),
        /** Legacys gespeicherte Kennung der Siedlung, roh; fehlt bei „keine Stadt“ und bei einer Entscheidung des Editors. */
        legacyPublicId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
        /** Der Ort, den die Beziehung trifft; fehlt, wenn sie keinen trifft („keine Stadt“, unbekannte Kennung). */
        placePublicId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
    },
    strict,
);
export type EditorSiteRelation = Static<typeof EditorSiteRelation>;

/** Ein genannter Ort aus der Kette der Stätte (Evidenz, in der Reihenfolge des Quelltexts). */
export const EditorSiteNamedPlace = Type.Object(
    {
        /** Das Linkziel wörtlich (der Titel vor einem `|`). */
        raw: Type.String(),
        /** Legacys kanonischer Key des Ziels; fehlt, wo Legacy keinen nennt. */
        key: Type.Optional(Type.String()),
        /** Der aktive Ort, dem dieser Key zugewiesen ist (X2); fehlt, wo keiner ihn trägt. */
        placePublicId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
        /** Der Name dieses Orts, für die Anzeige. */
        placeName: Type.Optional(Type.String()),
    },
    strict,
);

export const EditorSite = Type.Object(
    {
        /** Unsere Kennung der Stätte (`site.id`), als Text. Sie benennt die Stätte in jeder Operation. */
        id: Type.String({ minLength: 1 }),
        name: Type.String(),
        /** Aus welcher Legacy-Quelle die Stätte stammt (P1 Punkt, P2 gespeichert, P3b Weg, P3c Sitz, P3d Stadtteil). */
        sourceKind: Union(EDITOR_SITE_SOURCE_KINDS),
        /** Legacys eigene Kennung der Zeile, roh. */
        sourceKey: Type.String(),
        /** Legacys Art, wörtlich; fehlt, wo Legacy keine nennt (die Anzeige setzt „Bauwerk“ ein). */
        type: Type.Optional(Type.String()),
        /** Nur P1: Legacys Ortsgröße des Punkts. */
        siteClass: Type.Optional(Type.String()),
        /** Nur P3c: die Rolle des Sitzes wörtlich und seine Reihenfolge im Artikel. */
        seat: Type.Optional(Type.Object({ role: Type.String(), order: Type.Integer() }, strict)),
        /** Der eigene Artikel der Stätte; `key` fehlt bei einer Stadtteilweiterleitung (ihr Key ist der ihrer Stadt). */
        wiki: Type.Optional(
            Type.Object({ url: Type.Optional(Type.String()), key: Type.Optional(Type.String()) }, strict),
        ),
        /** Die rohe Ortsangabe der Quelle (Lage, Sitz-Ort, Standort). */
        rawLocation: Type.Optional(Type.String()),
        /** Nur P1: Der Punkt steht in Legacy auf der Karte. */
        onMap: Type.Optional(Type.Literal(true)),
        /** Der eigene Kartenpunkt der Stätte, wenn er bei uns noch aktiv ist (⊕ springt dorthin). */
        jump: Type.Optional(Type.Object({ kind: Type.Literal("place"), id: Type.String() }, strict)),
        /** Die gespeicherte Beziehung; fehlt, solange keine gespeichert ist. */
        relation: Type.Optional(EditorSiteRelation),
        /**
         * Die Stätte selbst ist stillgelegt (B4): Ein Zug hat sie abgelöst, ihre Beziehung hängt aber noch. Ohne diese
         * Angabe verschwände die Zeile still aus dem Reiter, und niemand sähe, dass eine Entscheidung ins Leere zeigt.
         */
        retired: Type.Optional(Type.Literal(true)),
        /**
         * Der Nachfolgesitz einer stillgelegten Stätte (B4): dieselbe Organisation, neue Ortsangabe. 🔴 Erkannt wird er an
         * Legacys ZUSAMMENGESETZTER Kennung (`Organisation U+001F Ortsangabe`), nicht an einem Namen; fehlt er oder gibt es
         * mehrere, steht hier nichts, und das Umhängen verlangt eine ausdrückliche Wahl.
         */
        successor: Type.Optional(
            Type.Object(
                { id: Type.String({ minLength: 1 }), name: Type.String(), rawLocation: Type.Optional(Type.String()) },
                strict,
            ),
        ),
        /** Die genannten Orte der Kette; steht nur bei den offenen Zeilen. */
        named: Type.Optional(Type.Array(EditorSiteNamedPlace)),
    },
    strict,
);
export type EditorSite = Static<typeof EditorSite>;

export const EditorPlaceSites = Type.Object(
    {
        /** Belegte Innerorts-Beziehungen an diesem Ort. */
        bound: Type.Array(EditorSite),
        /** Stätten, deren Kette diesen Ort an erster Stelle nennt, ohne gespeicherte Beziehung: sichtbar, aber nicht gebunden. */
        open: Type.Array(EditorSite),
        /** Wie viele Stätten das Infopanel hier zeigt (Lesart B, samt Wiki-Registry): damit Reiter, API und Panel dasselbe sagen. */
        sichtbar: Type.Object({ count: Type.Integer({ minimum: 0 }) }, strict),
    },
    strict,
);
export type EditorPlaceSites = Static<typeof EditorPlaceSites>;

/** `GET /api/editor/places/:id/sites` */
export const editorPlaceSitesUrl = (publicId: string): string => `/api/editor/places/${publicId}/sites`;

/**
 * Die Operationen an einer Innerorts-Beziehung (WI-0128 E10b, EDIT-0001 G3; Abschlussauftrag 2026-10-13 §3.2.5).
 *
 * 🔴 **Nur über eine ausdrücklich gewählte Stätte und einen ausdrücklich gewählten Ort.** Nie über einen Namen, eine Adresse
 * oder ein Linkziel: `siteId` ist unsere Kennung der Stätte, der Ort steht in der Adresse der Route. Jede so entstandene
 * Beziehung trägt `origin: "editor"`, und kein Legacy-Zug fasst sie wieder an.
 *
 * - `hierher` bindet die Stätte an DIESEN Ort. War sie an einem anderen gebunden, ist das das Verlagern - und zwar als EINE
 *   Operation mit einem Protokolleintrag an beiden Orten, nicht als stille Feldmutation (G3).
 * - `loesen` nimmt die Beziehung zu diesem Ort zurück. Die Stätte bleibt eine Stätte; sie steht danach wieder offen, wo ihre
 *   Kette einen Ort nennt.
 * - `nachfolger` hängt die Beziehung einer STILLGELEGTEN Stätte auf ihren Nachfolgesitz um (B4) - in einer Operation, mit
 *   einem Protokolleintrag für beide. Ohne eindeutigen Nachfolger wird abgelehnt statt geraten.
 */
export const SITE_RELATION_WAYS = ["hierher", "loesen", "nachfolger"] as const;
export type SiteRelationWay = (typeof SITE_RELATION_WAYS)[number];

export const SiteRelationBody = Type.Object(
    {
        operationId: OperationId,
        /** Unsere Kennung der Stätte (`site.id`), wie der Lesepfad sie liefert. */
        siteId: Type.String({ pattern: "^[1-9][0-9]{0,18}$" }),
        weg: Union(SITE_RELATION_WAYS),
    },
    strict,
);
export type SiteRelationBody = Static<typeof SiteRelationBody>;

/** `POST /api/editor/places/:id/sites/relation` */
export const editorPlaceSiteRelationUrl = (publicId: string): string => `/api/editor/places/${publicId}/sites/relation`;

/**
 * „Innerorts hinzufügen“ (WI-0196, EDIT-0003 T33 (3); Betreiber 2026-10-16: „Hier will man eine Button mit dem man Gebäude/Stätten und
 * Stadtviertel, die noch nicht woanders innerorts sind, hinzufügen können. Zur Vereinfachung der Suche kann man einen "Automatische
 * Auswahl von Gebäuden/Stätten und Stadtviertel im Umkreis von N Meilen" mit N = 1 default hinzufügen“).
 *
 * Die Kandidaten sind zweierlei:
 * - `staette` — eine vorhandene Stätte (`site.id`) ohne Beziehung zu einem Ort. 🔴 Ein gespeichertes „keine Stadt“ eines MENSCHEN
 *   (`manual`, `editor`) hält sie heraus, eines Laufs (`wiki`, `gespeichert`) nicht (B2).
 * - `kartenpunkt` — ein Gebäude oder Stadtviertel der Karte (`place.public_id`), für das es noch keine Stätte gibt. Beim Hinzufügen
 *   legt der Editor sie an, so wie der Import eine für einen Punkt mit Innerorts anlegt (Betreiber 2026-10-16 auf die Frage, ob auch
 *   Kartenpunkte angeboten werden: die Antwort „Ja, auch Kartenpunkte“).
 *
 * `meilen` ist der Abstand zum Ort, nur wo der Eintrag eine Lage hat (Kartenpunkte und Stätten mit eigenem Punkt); danach wählt die
 * Vorauswahl im Umkreis. Sortiert nach Abstand, dann nach Name; ohne Lage zuletzt.
 */
export const EDITOR_SITE_CANDIDATE_KINDS = ["staette", "kartenpunkt"] as const;
export type EditorSiteCandidateKind = (typeof EDITOR_SITE_CANDIDATE_KINDS)[number];

export const EditorSiteCandidate = Type.Object(
    {
        kind: Union(EDITOR_SITE_CANDIDATE_KINDS),
        /** `staette`: unsere `site.id`; `kartenpunkt`: die `public_id` des Orts. */
        id: Type.String({ minLength: 1 }),
        name: Type.String(),
        /** Die Art wörtlich (Legacys Art der Stätte bzw. die Art des Kartenpunkts); fehlt, wo keine bekannt ist. */
        type: Type.Optional(Type.String()),
        /** `gebaeude` oder `stadtviertel`, wo bekannt (Kartenpunkt, Stätte mit eigenem Punkt). */
        siteClass: Type.Optional(Type.String()),
        /** Die Quelle einer Stätte (Punkt, gespeichert, Weg, Sitz, Stadtteil); fehlt beim Kartenpunkt. */
        sourceKind: Type.Optional(Union(EDITOR_SITE_SOURCE_KINDS)),
        /** Abstand zum Ort in Meilen; nur mit Lage. */
        meilen: Type.Optional(Type.Number({ minimum: 0 })),
    },
    strict,
);
export type EditorSiteCandidate = Static<typeof EditorSiteCandidate>;

export const EditorSiteCandidates = Type.Object({ candidates: Type.Array(EditorSiteCandidate) }, strict);
export type EditorSiteCandidates = Static<typeof EditorSiteCandidates>;

/** `GET /api/editor/places/:id/sites/candidates` */
export const editorPlaceSiteCandidatesUrl = (publicId: string): string =>
    `/api/editor/places/${publicId}/sites/candidates`;

/** Höchstens so viele Einträge in EINER Operation: genug für jede Stadt, zu wenig für ein Versehen über die halbe Karte. */
export const SITE_ADD_MAX = 200;

/**
 * `site.add` (WI-0196): die gewählten Einträge in EINER Operation an diesen Ort binden, erst mit „Fertig“. Kartenpunkte bekommen dabei
 * ihre Stätte. Wer inzwischen woanders gebunden ist, lässt die ganze Operation scheitern - geraten wird nie.
 */
export const SiteAddBody = Type.Object(
    {
        operationId: OperationId,
        sites: Type.Array(Type.String({ pattern: "^[1-9][0-9]{0,18}$" }), {
            maxItems: SITE_ADD_MAX,
            uniqueItems: true,
        }),
        places: Type.Array(Type.String({ pattern: UUID_PATTERN }), { maxItems: SITE_ADD_MAX, uniqueItems: true }),
    },
    strict,
);
export type SiteAddBody = Static<typeof SiteAddBody>;

/** `POST /api/editor/places/:id/sites/add` */
export const editorPlaceSitesAddUrl = (publicId: string): string => `/api/editor/places/${publicId}/sites/add`;
