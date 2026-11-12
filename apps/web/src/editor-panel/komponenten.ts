import type { Component } from "vue";
import type { EDITORPANEL } from "@avesmaps3d/shared";
import EditorCommunity from "../community/editor-community.vue";
import EditorAenderungen from "./editor-aenderungen.vue";
import EditorKarteninhalte from "./editor-karteninhalte.vue";
import EditorStatus from "./editor-status.vue";

/**
 * Was der Rumpf des Editorpanels je Reiter zeigt (EDIT-0001 §3.2: „Was der Rumpf zeigt, ordnet die Oberfläche je Kennung einer
 * Komponente zu“). 🔴 `satisfies Record<…>`: Wird ein Reiter im Register aus `spaeter` ein `bereich`, ist er ohne Komponente
 * hier ein Typfehler. Spätere Reiter haben keinen Rumpf; man kann sie nicht wählen.
 */
type Bereich = Extract<(typeof EDITORPANEL)["eintraege"][number], { art: "bereich"; unter: null }>;

export const BEREICHE = {
    community: EditorCommunity,
    karteninhalte: EditorKarteninhalte,
    aenderungen: EditorAenderungen,
    status: EditorStatus,
} as const satisfies Record<Bereich["id"], Component>;

export const rumpfVon = (id: string | undefined): Component | undefined =>
    id !== undefined && id in BEREICHE ? BEREICHE[id as Bereich["id"]] : undefined;
