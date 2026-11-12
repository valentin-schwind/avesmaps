import { Type, type Static } from "@sinclair/typebox";
import { PATH_NAME_MAX } from "./editor-path-update.ts";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * Was der Wegeditor mit einer Auswahl von Abschnitten tut (WI-0252; Betreiber 2026-10-24, wörtlich: „schön wäre, wenn es einen button
 * "Auswahl zu neuem Weg" geben könnte (bei Form bzw. im kontextmenü). bestehende zuweisungen werden aufgehoben und die neue straße kann
 * einen namen bekommen (alles was "gemischt" wird dann zu einem namen)“).
 *
 *     POST  /api/editor/paths/neuer-weg   path.regroup: die gewählten Abschnitte werden EIN neuer Weg      edit_map_objects
 *
 * **„Auswahl zu neuem Weg“** ist die Namens- und Zuweisungsaktion, keine Geometrie:
 *
 * - Ein Weg ist sein Name (WI-0177 §45). Jeder genannte Abschnitt bekommt den neuen Namen (`name`, ein echter Name, kein Griff) und
 *   verlässt damit seine bisherige Straße; die übrigen Abschnitte dort bleiben, wie sie sind.
 * - Seine Wiki-Zuordnung wird aufgehoben (`path_wiki_assignment`, `wiki_key_assignment`), stillgelegt mit Herkunft `editor`: Kein Import
 *   legt sie wieder an (Betreiberentscheidung 2026-10-10, „die entscheidung darf nicht nachträglich kompromittiert werden“). Sonst hielte
 *   der Artikel den Abschnitt im Infopanel an seiner alten Straße (Wiki-Gruppen gehen dort vor den Namensgruppen).
 * - Alle übrigen Eigenschaften bleiben je Abschnitt (Wegtyp, Tunnel, Kennzeichen, „Name auf der Karte“, Reisemittel, Bach, Fließen), die
 *   Geometrie und damit das Wegenetz auch: Die Wegfindung liest keinen Namen.
 * - EINE Operation, jeder Abschnitt gegen seine Revision (409 `edit_conflict`), nie über die Sperre eines anderen (409 `object_locked`);
 *   alle Abschnitte auf derselben Karte und auf der Karte (sonst 400). Heißt danach auch ein anderer Weg so, sind beide einer (`merged`).
 * - **↺ aus dem Verlauf** ist die Rücknahme der Wege (`POST /api/editor/paths/:id/restore-series`, `editor-ruecknahme.ts`, WI-0265 B6a2): Der Server holt Namen, Herkunft und Zuordnungen
 *   aus dem Protokoll zurück, wenn die Abschnitte noch so heißen, wie die Operation sie hinterließ (sonst 409).
 */

export const EDITOR_PATHS_NEUER_WEG_URL = "/api/editor/paths/neuer-weg";

/** So viele Abschnitte nimmt eine Operation höchstens (wie „Ganze Straße“, `PathStreetRemovalBody`). */
export const PATH_SAMMEL_MAX = 500;

const strict = { additionalProperties: false } as const;

const Abschnitt = Type.Object(
    { publicId: Type.String({ pattern: UUID_PATTERN }), baseRevision: Type.Integer({ minimum: 1 }) },
    strict,
);

/**
 * **„Weg entfernen …“ an der Mehrfachauswahl** (WI-0252; Betreiber 2026-10-25 auf der Stage: „entfernen -> ganz löschen geht noch nicht
 * mit mehrfachauswahl“): derselbe Wechsel des Stands wie an einer Straße, für mehrere Wege in EINER Operation.
 *
 *     POST  /api/editor/paths/sammel/delete        path.delete: alle gewählten Wege ganz löschen (weich)     edit_map_objects
 *     POST  /api/editor/paths/sammel/take-off-map  path.take_off_map: alle von der Karte nehmen             edit_map_geometry
 *
 * - Ein Weg ist die Straße (alle Abschnitte mit seinem Namen, WI-0177 §45): Der Körper nennt die Abschnitte ALLER gewählten Wege, jeden
 *   gegen seine Revision. 🔴 Fehlt einem genannten Weg ein Abschnitt, ist es 409 (die Straße hat sich seit dem Lesen geändert), wie bei
 *   „Ganze Straße“; Abschnitte verschiedener Karten sind 400, eine fremde Sperre 409 `object_locked`. Geht einer nicht, geht keiner.
 * - Derselbe Wechsel wie am einzelnen Weg (`path.delete`, `path.take_off_map`): Protokoll, Wegfindung (`routing` ausstehend) und Kacheln
 *   folgen wie dort. ↺ ist die Rücknahme der Wege (`POST …/:id/restore-series`) über genau die Abschnitte der Operation, auch wenn sie
 *   in mehreren Straßen liegen.
 */
export const EDITOR_PATHS_SAMMEL_DELETE_URL = "/api/editor/paths/sammel/delete";
export const EDITOR_PATHS_SAMMEL_TAKE_OFF_MAP_URL = "/api/editor/paths/sammel/take-off-map";

export const PathSammelRemovalBody = Type.Object(
    {
        operationId: OperationId,
        sections: Type.Array(Abschnitt, { minItems: 1, maxItems: PATH_SAMMEL_MAX }),
    },
    strict,
);
export type PathSammelRemovalBody = Static<typeof PathSammelRemovalBody>;

export const PathNeuerWegBody = Type.Object(
    {
        operationId: OperationId,
        /** Der Name des neuen Wegs. */
        name: Type.String({ minLength: 1, maxLength: PATH_NAME_MAX }),
        sections: Type.Array(Abschnitt, { minItems: 1, maxItems: PATH_SAMMEL_MAX }),
    },
    strict,
);
export type PathNeuerWegBody = Static<typeof PathNeuerWegBody>;

/** Die Quittung nennt den Anker des neuen Wegs (die kleinste Kennung seiner Abschnitte): Dort öffnet das Fenster ihn. */
export const PathNeuerWegReceipt = Type.Object(
    { ...OperationReceipt.properties, anker: Type.String({ pattern: UUID_PATTERN }) },
    strict,
);
export type PathNeuerWegReceipt = Static<typeof PathNeuerWegReceipt>;

/**
 * **„Wege verbinden“** (WI-0252; Betreiber 2026-10-24: „wenn ich mehrere abschnitte eines weges auswähle, sollen bei mehreren wegen, die
 * "aneinenaderhängen" beim rechtsklick über "Weg entfernen" die menü option "Wege verbinden" stehen. ähnlich wie bei "wegkurve bearbeiten"
 * kann ich dann im untermenü auswählen wessen abschnittseinstellungen dann übernommen werden sollen.“ und „bei der vereinigung sollen auch
 * wege wirklich verbunden werden - also die punkte vereinigt und die abschnitte neu sortiert werden“) ist die Geometrie-Aktion:
 *
 *     GET   /api/editor/paths/verbinden?ids=…   geht das? die Kette in ihrer Folge, sonst der Grund     use_editor_menu
 *     POST  /api/editor/paths/verbinden         path.join: die Kette wird EIN Abschnitt          edit_map_objects + edit_map_geometry
 *
 * - **Aneinander hängen** heißt: Im Wegenetz bekommen die Enden zweier Abschnitte denselben Knoten (`routing/topology.ts`, mit dem
 *   eingestellten Fangradius und Ortskasten). Die Abschnitte bilden eine offene Kette, Richtung egal, ohne Abzweig unter ihnen.
 * - **Punkte vereinigen, neu sortieren:** Die Linie entsteht in Kettenfolge, Abschnitte, die andersherum laufen, werden umgedreht; an jeder
 *   Stoßstelle wird aus den beiden Enden EIN Stützpunkt, gelegt auf den vorhandenen Knoten des Netzes (den Ort, sonst den technischen
 *   Knoten). Die Linie läuft in der Richtung der Vorlage, damit ihre Fließrichtung stimmt.
 * - **Die Vorlage** (`vorlage`, die Wahl im Untermenü) behält Zeile, Kennung und alle Abschnittseinstellungen (Name, Wegtyp, Tunnel,
 *   Kennzeichen, „Name auf der Karte“, Reisemittel, Bach, Fließen, Wiki); die anderen Abschnitte werden still gelegt wie „Ganz löschen“.
 * - 🔴 **Das Wegenetz verliert nichts:** Hängt an einer Stoßstelle noch ein anderer Weg, muss er danach an derselben Stelle der neuen Linie
 *   hängen (ein Ende darauf, T-Stoß) und ein Ort dort an ihr; ein durchgehender Weg verlöre die Verbindung (zwei durchgehende Wege
 *   verbinden nie). Geht es nicht verlustfrei, geht es nicht (`grund: "netz"`). Verglichen wird das Netz um die Kette vorher und nachher.
 * - EINE Operation, jeder Abschnitt gegen seine Revision, nie über eine fremde Sperre. ↺ ist die Rücknahme der Wege (`restore-series`): die Vorlage bekommt
 *   ihre Linie zurück, die anderen kommen wieder auf die Karte.
 */
export const EDITOR_PATHS_VERBINDEN_URL = "/api/editor/paths/verbinden";

/** So viele Abschnitte verbindet eine Operation höchstens (die Prüfung steht in der Adresse). */
export const PATH_VERBINDEN_MAX = 60;

/** Warum Verbinden nicht geht: zu wenige oder zu viele, nicht auf der Karte, Land und Wasser gemischt, keine Kette, das Netz verlöre etwas. */
export const PATH_VERBINDEN_GRUENDE = ["anzahl", "karte", "art", "kette", "netz", "punkte"] as const;
export type PathVerbindenGrund = (typeof PATH_VERBINDEN_GRUENDE)[number];

export const PathVerbindenQuery = Type.Object(
    {
        /** Die Kennungen der gewählten Abschnitte, mit Komma getrennt. */
        ids: Type.String({ pattern: `^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,${String(PATH_VERBINDEN_MAX - 1)}}$` }),
    },
    strict,
);
export type PathVerbindenQuery = Static<typeof PathVerbindenQuery>;

/** Die Antwort der Prüfung: geht es, die Kette in ihrer Folge (`umgedreht`: läuft gegen die Kette); sonst der Grund. */
export const PathVerbindenPruefung = Type.Object(
    {
        geht: Type.Boolean(),
        kette: Type.Optional(
            Type.Array(
                Type.Object({ publicId: Type.String({ pattern: UUID_PATTERN }), umgedreht: Type.Boolean() }, strict),
            ),
        ),
        grund: Type.Optional(Type.Union(PATH_VERBINDEN_GRUENDE.map((g) => Type.Literal(g)))),
    },
    strict,
);
export type PathVerbindenPruefung = Static<typeof PathVerbindenPruefung>;

export const PathVerbindenBody = Type.Object(
    {
        operationId: OperationId,
        sections: Type.Array(Abschnitt, { minItems: 2, maxItems: PATH_VERBINDEN_MAX }),
        /** Wessen Abschnittseinstellungen der verbundene Weg trägt. */
        vorlage: Type.String({ pattern: UUID_PATTERN }),
    },
    strict,
);
export type PathVerbindenBody = Static<typeof PathVerbindenBody>;

/** Die Quittung nennt den verbundenen Abschnitt (die Vorlage). */
export const PathVerbindenReceipt = Type.Object(
    { ...OperationReceipt.properties, publicId: Type.String({ pattern: UUID_PATTERN }) },
    strict,
);
export type PathVerbindenReceipt = Static<typeof PathVerbindenReceipt>;
