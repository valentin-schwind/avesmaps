import { Type, type Static } from "@sinclair/typebox";
import { OperationId, OperationReceipt, UUID_PATTERN } from "./operation.ts";

/**
 * **„Flächen vereinigen ›“** (WI-0252; Betreiber 2026-10-24, wörtlich: „dasselbe bei flächen. ich kann mehrere flächen markieren aber noch
 * nicht vereinigen. unter anlegen "Hier hinzufügen" soll im kontextmenü (bei der mehrfachauswahl von objekte) "Flächen vereinigen" stehen
 * das Untermenü bestimmt wessen einstellungen übernommen werden“). Dasselbe Konzept wie „Wege verbinden ›“ (`editor-path-sammel.ts`):
 * vereinigen und im Untermenü wählen, wessen Einstellungen das Ergebnis trägt. Mehrfach wählbar sind Landschaften (Derographie) und
 * Herrschaftsgebiete; je Art eine Adresse:
 *
 *     GET   /api/editor/landscapes/vereinigen?ids=…    geht das? sonst der Grund                  use_editor_menu
 *     POST  /api/editor/landscapes/vereinigen          landscape.merge                           edit_map_objects + edit_map_geometry
 *     GET   /api/editor/territories/vereinigen?ids=…   geht das? sonst der Grund                  use_editor_menu
 *     POST  /api/editor/territories/vereinigen         territory.merge                           edit_map_objects + edit_map_geometry
 *
 * - **Gleiche Art:** Landschaften derselben Ebene und Art, Gebiete derselben Art unter demselben Obergebiet (die Ebene im Baum), alle auf
 *   derselben Karte und mit Fläche (`art`, `karte`, `leer`). Bei Gebieten zusätzlich dieselbe Gültigkeit und dieselben Zoombänder aller
 *   Flächen (`zeit`): Eine vereinigte Fläche trägt nur eine.
 * - **Wirklich vereinigt:** Die Teilflächen, die einander berühren oder überlappen (bis auf den Fangradius `FLAECHEN_FANG`), werden EINE
 *   Fläche. Gemeinsame Kanten fallen weg, eine Ecke, die kaum neben einer anderen liegt, rastet auf sie ein (Stoßpunkte werden ein Punkt),
 *   schmale Spalten zwischen ihnen schließen sich. Getrennte Teile bleiben getrennt: Eine Teilfläche der Vorlage, die nichts berührt, bleibt
 *   wie sie ist; eine Gruppe ohne Fläche der Vorlage kommt als weiteres Polygon zur größten Teilfläche der Vorlage (beide Modelle kennen
 *   Mehrfachpolygone, wie „Mit anderer Fläche › vereinigen“).
 * - 🔴 **Nachbarn bleiben angeschlossen:** Jede Ecke einer anderen Fläche derselben Ebene (bei Gebieten: jeder anderen), die auf einer
 *   Ecke der vereinigten lag, liegt danach auf einer Ecke des Ergebnisses. Sonst geht es nicht (`nachbar`). Eine Ecke, die ein Nachbar
 *   teilt, rastet nie ein.
 * - **Die Vorlage** (`vorlage`, die Wahl im Untermenü) behält Zeile, Kennung und alle Einstellungen. Die anderen: Eine Landschaft geht samt
 *   Beschriftungen von der Karte wie bei „Mit anderer Fläche › vereinigen“ (endet an einer ihrer Beschriftungen eine Kraftlinie, geht es
 *   nicht: `kraftlinie`); ein Gebiet verliert nur seine Flächen (wie „Entfernen › Von der Karte“), sein Eintrag mit Untergebieten,
 *   Ansprüchen, Hauptstadt und Wiki bleibt.
 * - EINE Operation gegen die Revisionen, die die Prüfung las (`objekte`), nie über eine fremde Sperre. ↺ im Verlauf der Vorlage über die
 *   vorhandene Rücknahme (`…/:id/restore` mit `reverts`).
 */
export const EDITOR_LANDSCAPES_VEREINIGEN_URL = "/api/editor/landscapes/vereinigen";
export const EDITOR_TERRITORIES_VEREINIGEN_URL = "/api/editor/territories/vereinigen";

/** So viele Flächen vereinigt eine Operation höchstens (die Prüfung steht in der Adresse). */
export const FLAECHEN_VEREINIGEN_MAX = 30;

/**
 * Der Fangradius beim Vereinigen in Karteneinheiten: so weit auseinander gelten zwei Ecken als ein Stoßpunkt und zwei Flächen als
 * berührend; so schmal ist ein Spalt, der sich schließt. Derselbe Wert wie der Fangradius der Wegenden (`END_SNAP`).
 */
export const FLAECHEN_FANG = 0.02;

/**
 * Warum Vereinigen nicht geht: zu wenige oder zu viele, nicht auf der Karte, verschiedene Art, ohne Fläche, ein Nachbar verlöre den
 * Anschluss, eine Kraftlinie endet an einer Beschriftung, die ginge, verschiedene Gültigkeit oder Zoombänder.
 */
export const FLAECHEN_VEREINIGEN_GRUENDE = ["anzahl", "karte", "art", "leer", "nachbar", "kraftlinie", "zeit"] as const;
export type FlaechenVereinigenGrund = (typeof FLAECHEN_VEREINIGEN_GRUENDE)[number];

const strict = { additionalProperties: false } as const;
const Kennung = Type.String({ pattern: UUID_PATTERN });

export const FlaechenVereinigenQuery = Type.Object(
    {
        /** Die Kennungen der gewählten Landschaften oder Gebiete, mit Komma getrennt. */
        ids: Type.String({ pattern: `^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,${String(FLAECHEN_VEREINIGEN_MAX - 1)}}$` }),
    },
    strict,
);
export type FlaechenVereinigenQuery = Static<typeof FlaechenVereinigenQuery>;

const Objekt = Type.Object({ publicId: Kennung, baseRevision: Type.Integer({ minimum: 1 }) }, strict);

/** Die Antwort der Prüfung: geht es, sonst der Grund; dazu je gewähltem Objekt seine Revision und wie viele Teilflächen mitgehen. */
export const FlaechenVereinigenPruefung = Type.Object(
    {
        geht: Type.Boolean(),
        grund: Type.Optional(Type.Union(FLAECHEN_VEREINIGEN_GRUENDE.map((g) => Type.Literal(g)))),
        objekte: Type.Array(
            Type.Object(
                {
                    publicId: Kennung,
                    revision: Type.Integer({ minimum: 1 }),
                    name: Type.String(),
                    /** Die Art (Landschaft: `region_type`, Gebiet: `territory_type`), wie die Liste sie nennt. */
                    art: Type.String(),
                    flaechen: Type.Integer({ minimum: 0 }),
                },
                strict,
            ),
        ),
        /**
         * Wer Vorlage sein kann, in der Folge von `objekte`; fehlt, wenn es nicht geht. Endet an einer Beschriftung einer Landschaft eine
         * Kraftlinie, kann nur sie Vorlage sein: Die übrigen gehen samt Beschriftungen von der Karte.
         */
        vorlagen: Type.Optional(Type.Array(Kennung)),
    },
    strict,
);
export type FlaechenVereinigenPruefung = Static<typeof FlaechenVereinigenPruefung>;

export const FlaechenVereinigenBody = Type.Object(
    {
        operationId: OperationId,
        objects: Type.Array(Objekt, { minItems: 2, maxItems: FLAECHEN_VEREINIGEN_MAX }),
        /** Wessen Einstellungen die vereinigte Fläche trägt: eine der genannten. */
        vorlage: Kennung,
    },
    strict,
);
export type FlaechenVereinigenBody = Static<typeof FlaechenVereinigenBody>;

/** Die Quittung nennt die Vorlage: Dort öffnet das Fenster das Ergebnis. */
export const FlaechenVereinigenReceipt = Type.Object({ ...OperationReceipt.properties, publicId: Kennung }, strict);
export type FlaechenVereinigenReceipt = Static<typeof FlaechenVereinigenReceipt>;
