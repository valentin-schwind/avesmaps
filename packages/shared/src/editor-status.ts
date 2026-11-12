import { Type, type Static } from "@sinclair/typebox";

/**
 * Ob und wie die Karte gerade bearbeitet werden darf (WI-0128 E9; EDIT-0001 §4.6, §5.1 N1, §6.2).
 *
 * - `MAP_EDITING` (Server): `off` oder `testwelt`. **Vorgabe `off`**, lokal (`RELEASE_ID` fehlt oder ist `dev`) `testwelt`. Stage und Production setzen
 *   `testwelt` (Claudio; Production seit 2026-11-02, Vali: „Bearbeiten in Production einschalten“, `ops/production/map-editing.sh`). Der Wert heißt nur intern so: In Production zeigt der Editor „Live-Karte“.
 * - `off`: jede Schreibroute des Ortseditors antwortet 423 `map_editing_off`, nichts wird geschrieben. Die Kartensperre der
 *   Systemsteuerung (423 `map_locked`, SYS-4) wirkt zusätzlich in jeder Umgebung.
 * - `testwelt`: Operationen schreiben in die Datenbank dieser Umgebung; auf der Stage kann das Auffrischen die Karte zurücksetzen (E14).
 * - Während der Zug importiert, antwortet ein Speichern 503 `map_import_running` mit `Retry-After`, ohne zu schreiben (E10).
 *
 * `GET /api/editor/status` nennt den Modus (Recht `use_editor_menu`); der Ortseditor zeigt danach seinen Hinweis.
 */

export const EDITOR_STATUS_URL = "/api/editor/status";

export const MAP_EDITING_MODES = ["off", "testwelt"] as const;
export type MapEditingMode = (typeof MAP_EDITING_MODES)[number];

export const EditorStatus = Type.Object(
    {
        mapEditing: Type.Union(MAP_EDITING_MODES.map((mode) => Type.Literal(mode))),
        /** Die Umgebung dieser Instanz (`development`, `staging`, `production`, `test`); ohne benannte Umgebung fehlt sie. */
        environment: Type.Optional(Type.String()),
        /** Ob „In Landmarke umwandeln …“ hier schon geht (WI-0271 L8): in Production erst nach dem Cutoff der Orte, sonst immer. Der Server prüft es beim Schreiben noch einmal. */
        umwandelnFrei: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
);
export type EditorStatus = Static<typeof EditorStatus>;

/** Die Fehlercodes des Bearbeitens der Karte mit ihrem HTTP-Status (Muster `API_ERROR_STATUS`). */
export const MAP_EDITING_ERROR_STATUS = {
    map_editing_off: 423,
    map_import_running: 503,
} as const;
export type MapEditingErrorCode = keyof typeof MAP_EDITING_ERROR_STATUS;
