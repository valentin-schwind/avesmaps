/**
 * M9 (Hardening Review 2026-09-28): ein kleiner Vertrag statt eines durchgereichten Besucher-Booleans.
 * Bisher las `app.vue` das URL-Flag der Besucher-Vorschau direkt und reichte einen Boolean durch mehrere
 * Aufrufer (`place-layers.ts`, `search-client.ts`, `spotlight-search.vue`, `planner-link.ts`,
 * `getVisibleMapSeries`); serverseitig ein eigenes `editor`-Query-Flag (`routes/search.ts`). Ein
 * späterer Auth-Einbau müsste jede dieser Stellen erneut anfassen. `ViewerContext` benennt stattdessen,
 * WOFÜR ein Viewer Rechte braucht - die Frage bleibt dieselbe, wenn es Rollen gibt; dann liefert die
 * Laufzeit die Antwort, nicht mehr die Adresse.
 *
 * Es gibt noch keine Rollen (AGENTS.md, „Seewege und Strömungspfeile: nur im Editormodus"). Bis dahin ist
 * jeder Viewer entweder Editor (jede Capability) oder Besucher (keine) - das Modell selbst unterscheidet
 * aber schon einzelne Capabilities, damit ein Rollenkatalog später nur hier andockt, ohne jeden Aufrufer
 * erneut zu ändern.
 */
export type ViewerCapability =
    /** Serien mit `visibility: "EDITOR_ONLY"` in der Auswahl zeigen (Kartenserie `old`). */
    | "view_editor_series"
    /** Die Strömungspfeile auf den Flüssen zeichnen. */
    | "view_flow_directions"
    /** Einen Seeweg über seinen genauen Namen finden (Seewege sind nicht geheim, nur Editorwerkzeug). */
    | "search_sea_route_names"
    /**
     * Die Auswahl lokal fixieren (WI-0063 P5, Betreiber 2026-10-04): Die Leertaste hält den gewählten Gegenstand fest, bis
     * sie ihn löst; normale Kartenklicks wechseln ihn dann nicht. Nur ein Editor kennt es, ein Besucher hat die Leertaste
     * für die Suche. Es ist KEINE Sperre gegen andere (kein Soft Lock, Kapitel 7): nur die eigene Auswahl.
     */
    | "pin_selection"
    /**
     * Das Floating Menu am angeklickten Objekt benutzen (WI-0063 P9, Betreiber 2026-10-04): Ein Linksklick auf ein Kartenobjekt
     * öffnet am Rechner zusätzlich ein kleines Menü mit den direkten Actions des Objekts (`apps/web/src/editor-menu/`). Ein
     * Besucher hat es nie. Das ist die Fähigkeit für das MENÜ; jede Action trägt zusätzlich ihre eigene Fähigkeit (`capability` im
     * Descriptor), die ein Schritt von Phase 6 hier ergänzt, wenn er seine erste Schreibaktion einhängt.
     */
    | "use_editor_menu"
    /**
     * Die Medienverwaltung öffnen (WI-0068 P3, Betreiber 2026-10-09: „MAM öffnen und private Angaben lesen“ ist EIN Recht, ab
     * Reviewer): der Eintrag „Medien …“ im Hauptmenü und der Knopf am Wappen und am Kopfbild im Infopanel. Dieselbe Capability
     * prüft der Server an jeder Route `/api/editor/media…`; hier steuert sie nur, ob die Oberfläche den Weg anbietet.
     */
    | "view_media_private"
    /**
     * Kartenobjekte bearbeiten (WI-0128, EDIT-0001 §4.1; Katalog ab Editor): Das Verb „Orte bearbeiten“ öffnet den Ortseditor zum
     * Schreiben, ohne dieses Recht „nur lesen“ (Reviewer). Geprüft wird jede Operation am Server.
     */
    | "edit_map_objects"
    /** Die Lage eines Kartenobjekts ändern (WI-0128, „✥ Ort verschieben“); ohne dieses Recht fehlt der Knopf mit Satz. */
    | "edit_map_geometry"
    /** Die Karte nach Fach (WI-0279): Eigenschaften und Form der Herrschaftsgebiete und der Derographie, das Gebirge. */
    | "edit_territories"
    | "edit_territory_form"
    | "edit_landscapes"
    | "edit_landscape_form"
    | "edit_mountains";

export interface ViewerContext {
    /** Woher diese Einschätzung kommt (URL-Flag, eine feste Vorgabe, …) - zur Fehlersuche, keine Zugriffskontrolle. */
    readonly source: string;
    can(capability: ViewerCapability): boolean;
}

const ALL_CAPABILITIES: readonly ViewerCapability[] = [
    "view_editor_series",
    "view_flow_directions",
    "search_sea_route_names",
    "pin_selection",
    "use_editor_menu",
    "view_media_private",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_territory_form",
    "edit_landscapes",
    "edit_landscape_form",
    "edit_mountains",
];

function viewerContext(source: string, capabilities: ReadonlySet<ViewerCapability>): ViewerContext {
    return { source, can: (capability) => capabilities.has(capability) };
}

/** Jede Capability - der heutige Editor-Fall (jeder, der eine passwortgeschützte Instanz erreicht hat). */
export function editorViewer(source: string): ViewerContext {
    return viewerContext(source, new Set(ALL_CAPABILITIES));
}

/**
 * Genau die Capabilities einer Sitzung (WI-0120 A9): Der Server nennt sie in `GET /api/auth/session`; was der Client nicht
 * kennt, fällt weg. Geprüft wird weiter am Server, das hier steuert nur die Ansicht.
 */
export function sessionViewer(source: string, capabilities: Iterable<string>): ViewerContext {
    const known = new Set<string>(ALL_CAPABILITIES);
    return viewerContext(
        source,
        new Set([...capabilities].filter((name): name is ViewerCapability => known.has(name))),
    );
}

/** Keine Capability - der heutige Besucher-Fall (die Besucher-Vorschau in der Adresse, keine Zugriffskontrolle). */
export function visitorViewer(source: string): ViewerContext {
    return viewerContext(source, new Set());
}
