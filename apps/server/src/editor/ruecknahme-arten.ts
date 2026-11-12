import { POWERLINE_STATE_CHANGES } from "@avesmaps3d/shared";

/**
 * Der Katalog der Operationen, die eine Familie zurücknimmt (WI-0265 B6f; Fachvertrag A.3 `nicht_ruecknehmbar(art)`, B.2): EINE Quelle für zwei Fragen.
 *
 * - **Die Liste** (`history-status.ts`): Eine Operation von Person oder Wiederherstellung, die in KEINER Familie steht, trägt `status: "nicht_ruecknehmbar"`,
 *   `statusReason: "art"`; die Oberfläche zeigt keinen ↺-Knopf, sondern den Grund. Dasselbe in SQL für den Zustandsfilter (`history.ts`, `RUECKNEHMBARE_OPERATIONEN_LISTE`).
 * - **Die Adapter** (`ruecknahme-ort.ts`, `-weg.ts`, `-gebiet.ts`, `-kraftlinie.ts` (Linie und Kraftlinienpunkt), `-flaeche.ts`, `-sprache.ts`, `-quelle.ts`, `-werk.ts`, `-korpus.ts`, `-vorkommen.ts`): Ihr `pruefeArt` unterscheidet die Art eines Mitglieds
 *   zuerst nach dem NAMEN seiner Operation und dann nach den Aktionen seiner Protokolleinträge. Die Mengen des Namens stehen nur hier; die Adapter importieren sie.
 *
 * 🔴 **Namensebene, nie Nutzlast.** Der Katalog kennt nur Namen der Operationen. Was von den Aktionen der Einträge abhängt (ein `place.update`, das auch einen Ort anlegt, ein
 * `path.update` mit Feldern UND Kurve), entscheidet weiter der Adapter in der Vorprüfung (`not_revertable`, Grund `art`). Im Zweifel bleibt eine Operation also `ruecknehmbar`:
 * lieber ein ↺, das sauber ablehnt, als ein fälschlich verstecktes. Umgekehrt ist eine Operation, deren Name in keiner Menge steht, für JEDEN Adapter `art`; das Verstecken ist
 * dort richtig und keine Vermutung.
 *
 * 🔴 **Wer eine Art zurücknehmbar macht** (WI-0265 B6g1: Quelle, Werk, Korpus; B6g2: das Vorkommen; B6g3: die Quellen eines Trägers; B8a: Anlegen, Wiederherstellen, Von der Karte nehmen und die
 * Mehrfachbearbeitung am Ort, Anlegen und Teilen am Weg; B8d: das Anlegen von Quelle, Werk, Korpus und Vorkommen und die Wiki-Box), trägt ihre Operationen HIER in die Menge
 * ihrer Familie ein (eine Zeile je Operation, bei einer neuen Familie eine Menge in `RUECKNEHMBARE_OPERATIONEN`) und baut ihren Adapter. Die Liste, der Zustandsfilter und der Adapter folgen
 * dann zugleich; es gibt keinen zweiten Ort.
 * 🪤 Ein Name hier ohne Adapter gäbe ein ↺, das immer ablehnt.
 * 🔴 Ein Anlegen (`*.create`) im Katalog macht es auch zum Mitglied einer Arbeitsserie (`arbeitsserie.ts`, `koenntMitgliedSein`): Die Serie beginnt dann mit dem Anlegen und geht als Ganzes zurück.
 */

// --- Die Rücknahmen selbst (eine je Familie, Quelle `restore`) --------------------------------------------------------------

export const RUECKNAHME_ORT_OPERATION = "place.restore_series";
export const RUECKNAHME_WEG_OPERATION = "path.restore_series";
export const RUECKNAHME_GEBIET_OPERATION = "territory.restore_series";
export const RUECKNAHME_KRAFTLINIE_OPERATION = "powerline.restore_series";
export const RUECKNAHME_NODIX_OPERATION = "nodix.restore_series";
export const RUECKNAHME_FLAECHE_OPERATION = "landscape.restore_series";
export const RUECKNAHME_GIPFEL_OPERATION = "peak.restore_series";
export const RUECKNAHME_SPRACHE_OPERATION = "sprache.restore_series";
export const RUECKNAHME_QUELLE_OPERATION = "source.restore_series";
export const RUECKNAHME_WERK_OPERATION = "work.restore_series";
export const RUECKNAHME_KORPUS_OPERATION = "corpus.restore_series";
export const RUECKNAHME_VORKOMMEN_OPERATION = "lore.restore_series";
export const RUECKNAHME_WIKIBOX_OPERATION = "wikibox.restore_series";
export const RUECKNAHME_UMWANDLUNG_OPERATION = "landmarke.restore_series";

/**
 * Die Quellen eines Kartenobjekts (`traeger.sources`, WI-0254 §12; WI-0265 B6g3): Sie gehören zur Familie ihres Trägers (Ort, Gebiet, Derographie, Weg) und teilen dessen Serie (derselbe Gegenstand,
 * dieselbe Person); darum steht der Name in der Menge jeder dieser Familien. Der Gipfel hat keine Klappbox und damit keine solche Operation.
 */
export const TRAEGER_QUELLEN_OPERATION = "traeger.sources";

// --- Ort (`ruecknahme-ort.ts`) ----------------------------------------------------------------------------------------------

/** Felder, auch die Mehrfachbearbeitung (`place.sammel`, EINE Operation über mehrere Orte; WI-0265 B8a): ganz oder gar nicht über alle Orte der Operation. */
export const ORT_FELDER_OPERATIONEN: ReadonlySet<string> = new Set([
    "place.update",
    "place.sammel",
    RUECKNAHME_ORT_OPERATION,
]);
/** Verschieben und, mit der Aktion `place.placed`, das Setzen eines Orts ohne Lage auf die Karte (WI-0265 B8a). */
export const ORT_VERSCHIEBEN_OPERATIONEN: ReadonlySet<string> = new Set(["place.move", RUECKNAHME_ORT_OPERATION]);
export const ORT_LOESCHEN_OPERATION = "place.delete";
/** Das Löschen und seine Gegenstücke: die Rücknahme eines Anlegens oder Wiederherstellens stillt den Ort wie „Ganz löschen“ und lässt sich mit demselben Weg zurücknehmen. */
export const ORT_LOESCHEN_OPERATIONEN: ReadonlySet<string> = new Set([
    ORT_LOESCHEN_OPERATION,
    RUECKNAHME_ORT_OPERATION,
]);
/** Anlegen (WI-0265 B8a): zurücknehmen heißt stilllegen. Eine Serie darf mit dem Anlegen beginnen. */
export const ORT_ANLEGEN_OPERATION = "place.create";
/** Von der Karte nehmen (WI-0265 B8a): zurück auf die Karte an die Lage davor; das Gegenstück ist das Setzen (`place.move` mit Aktion `place.placed`). */
export const ORT_ABNEHMEN_OPERATIONEN: ReadonlySet<string> = new Set(["place.take_off_map", RUECKNAHME_ORT_OPERATION]);
/** Wiederherstellen eines gelöschten Orts (`place.restore`, WI-0265 B8a): zurücknehmen heißt wieder stilllegen. */
export const ORT_WIEDERHERSTELLEN_OPERATIONEN: ReadonlySet<string> = new Set([
    "place.restore",
    RUECKNAHME_ORT_OPERATION,
]);
/** Die Quellen des Orts: die Operation `traeger.sources` und die Rücknahme (für die Rücknahme einer Rücknahme der Quellen). */
export const ORT_QUELLEN_OPERATIONEN: ReadonlySet<string> = new Set([
    TRAEGER_QUELLEN_OPERATION,
    RUECKNAHME_ORT_OPERATION,
]);

// --- Weg (`ruecknahme-weg.ts`) ----------------------------------------------------------------------------------------------

export const WEG_FELDER_OPERATIONEN: ReadonlySet<string> = new Set(["path.update", RUECKNAHME_WEG_OPERATION]);
export const WEG_KURVE_OPERATIONEN: ReadonlySet<string> = new Set([
    "path.update",
    "path.reshape",
    RUECKNAHME_WEG_OPERATION,
]);
/** Die vier Wechsel des Stands (`WEG_WECHSEL` in `path-split.ts`; ein Test hält beide gleich). */
export const WEG_STAND_OPERATIONEN: ReadonlySet<string> = new Set([
    "path.delete",
    "path.restore",
    "path.take_off_map",
    "path.put_on_map",
    RUECKNAHME_WEG_OPERATION,
]);
/**
 * Umgruppieren und Verbinden: Nur die Operation selbst (`path.regroup`, `path.join`) ist Mitglied einer Arbeitsserie. Ihre Rücknahme (`path.restore_series`) und deren Rücknahme sind seit WI-0265 B8a2 selbst
 * rücknehmbar, einzeln und in beide Richtungen; die Richtung steht im Namen der Aktion (`ruecknahme-weg.ts`).
 */
export const WEG_UMGRUPPIEREN_OPERATION = "path.regroup";
export const WEG_VERBINDEN_OPERATION = "path.join";
/** Der Straßen-Assistent (WI-0310): wie Umgruppieren; seine Rücknahme und deren Rücknahme sind selbst rücknehmbar (`ruecknahme-weg.ts`). */
export const WEG_STRASSE_OPERATION = "path.assign_street";
/** Anlegen (WI-0265 B8a): zurücknehmen heißt stilllegen, über den Wechsel des Stands „Ganz löschen“; die Rücknahme davon holt den Weg zurück. Eine Serie darf mit dem Anlegen beginnen. */
export const WEG_ANLEGEN_OPERATION = "path.create";
/** Teilen (WI-0265 B8a): zurücknehmen heißt die Teile wieder zu EINEM Weg zusammenlegen (Linie davor, der hintere Teil still gelegt); die Rücknahme davon teilt wieder. */
export const WEG_TEILEN_OPERATION = "path.split";
/** Die Quellen der Straße (`traeger.sources` am Anker) und die Rücknahme. */
export const WEG_QUELLEN_OPERATIONEN: ReadonlySet<string> = new Set([
    TRAEGER_QUELLEN_OPERATION,
    RUECKNAHME_WEG_OPERATION,
]);

// --- Gebiet (`ruecknahme-gebiet.ts`) ----------------------------------------------------------------------------------------

export const GEBIET_FELDER_OPERATIONEN: ReadonlySet<string> = new Set([
    "territory.update",
    "territory.display",
    "territory.sammel",
    RUECKNAHME_GEBIET_OPERATION,
]);
/** Die Quellen des Gebiets (`traeger.sources`) und die Rücknahme. */
export const GEBIET_QUELLEN_OPERATIONEN: ReadonlySet<string> = new Set([
    TRAEGER_QUELLEN_OPERATION,
    RUECKNAHME_GEBIET_OPERATION,
]);
/** Entfernen, „Unter neues Obergebiet …“ und Vereinigen (`ENTFERNEN_OPERATIONEN` in `territory-retire.ts`; ein Test hält beide gleich). */
export const GEBIET_ENTFERNEN_OPERATIONEN: ReadonlySet<string> = new Set([
    "territory.retire",
    "territory.create_parent",
    "territory.merge",
]);
/**
 * Anlegen eines Gebiets samt erster Fläche (`territory.create`) und „Grenze zeichnen“ an einem Gebiet ohne Fläche (`territory_area.create`; WI-0265 B8b). Die Rücknahme legt still
 * (Gebiet samt Fläche, oder die Fläche), ganz oder gar nicht; die Rücknahme dieser Rücknahme holt wieder zurück.
 */
export const GEBIET_ANLEGEN_OPERATIONEN: ReadonlySet<string> = new Set(["territory.create", "territory_area.create"]);
/** Zurückholen (`territory.restore`; WI-0265 B8b): Es stellt Entfernen, „Unter neues Obergebiet …“ oder Vereinigen zurück; seine Rücknahme macht das Entfernen noch einmal. */
export const GEBIET_ZURUECKHOLEN_OPERATION = "territory.restore";

// --- Kraftlinie (`ruecknahme-kraftlinie.ts`) --------------------------------------------------------------------------------

/** Dazu das Anlegen eines Abschnitts (`powerline.create`; WI-0265 B8b): Es legt zurück still, ein Abschnitt einer Linie mit anderen fällt heraus (`remove`), der einzige geht über den Wechsel des Stands. */
export const KRAFTLINIE_LINIE_OPERATIONEN: ReadonlySet<string> = new Set([
    "powerline.create",
    "powerline.update_line",
    RUECKNAHME_KRAFTLINIE_OPERATION,
]);
export const KRAFTLINIE_STAND_OPERATIONEN: ReadonlySet<string> = new Set([
    ...Object.keys(POWERLINE_STATE_CHANGES),
    RUECKNAHME_KRAFTLINIE_OPERATION,
]);

// --- Kraftlinienpunkt (`ruecknahme-kraftlinie.ts`, Adapter `NODIX_ADAPTER`; WI-0265 B8b) ----------------------------------------------------------

/** Anlegen, Verschieben und Entfernen eines Kraftlinienpunkts (`nodix.*`) und die Rücknahme selbst. */
export const NODIX_OPERATIONEN: ReadonlySet<string> = new Set([
    "nodix.create",
    "nodix.move",
    "nodix.retire",
    RUECKNAHME_NODIX_OPERATION,
]);

// --- Derographie und Gipfel (`ruecknahme-flaeche.ts`, `ruecknahme-gipfel.ts`, `ruecknahme-gebirge.ts`) ------------------------

/**
 * Alles, was die Derographie schreibt (WI-0265 B8c): auch das Anlegen einer Fläche (`landscape.create`, Fläche samt erster Teilfläche), einer Beschriftung (`label.create`) und eines Gipfels oder einer Landmarke
 * (`peak.create`) und das Löschen einer Beschriftung (`label.retire`). Das Anlegen geht zurück als Stilllegen (derselbe Weg wie Entfernen), nie als Löschen; die Rücknahme dieser Rücknahme belebt wieder.
 * Das Gebirge (`area.gebirge`) schreibt mit `landscape.update`; `area.gebirge_startwerte` ist ein Betreiberlauf und bleibt außen (`SYSTEMLAUF_OPERATIONEN`).
 */
export const FLAECHE_OPERATIONEN: ReadonlySet<string> = new Set([
    "landscape.create",
    "label.create",
    "label.retire",
    "landscape.update",
    // Die Quellen der Landschaft (WI-0265 B6g3).
    TRAEGER_QUELLEN_OPERATION,
    RUECKNAHME_FLAECHE_OPERATION,
    "landscape.restore",
    "landscape.retire",
    "landscape.batch",
    "landscape.boolean",
    "landscape.parts",
    "landscape.split",
    "landscape.copy",
    "landscape.merge",
    // Am Gipfel auch Art und Merkmale jeder Landmarkenart (WI-0271 L3); `peak.create` setzt einen Gipfel oder eine Landmarke (WI-0265 B8c).
    "peak.create",
    "peak.update",
    RUECKNAHME_GIPFEL_OPERATION,
    "peak.retire",
    "peak.restore",
]);

// --- Umwandlung eines Orts in eine Landmarke (`ruecknahme-umwandlung.ts`; WI-0271 L8) -----------------------------------------

/** „In Landmarke umwandeln …“ und seine Rücknahme: Die Rücknahme belebt den Ort und legt die Landmarke still, ihre Rücknahme wandelt wieder um. Eine eigene Familie: Sie berührt Ort und Landmarke zugleich. */
export const UMWANDLUNG_OPERATION = "landmarke.umwandeln";
export const UMWANDLUNG_OPERATIONEN: ReadonlySet<string> = new Set([
    UMWANDLUNG_OPERATION,
    RUECKNAHME_UMWANDLUNG_OPERATION,
]);

// --- Sprache (`ruecknahme-sprache.ts`) --------------------------------------------------------------------------------------

/**
 * Auch das Anlegen einer Sprache (`sprache.create`) und einer Teilfläche (`sprache_flaeche.create`) und eine Teilfläche der Derographie als Kopie in einer Sprache (`sprache.flaeche_aus_landschaft`; WI-0265 B8c):
 * Zurück geht das Anlegen als Stilllegen (derselbe Weg wie `sprache.retire`, `sprache_flaeche.retire`), die Rücknahme dieser Rücknahme belebt wieder. Die Derographie, aus der kopiert wurde, wird nie angefasst.
 */
export const SPRACHE_OPERATIONEN: ReadonlySet<string> = new Set([
    "sprache.create",
    "sprache_flaeche.create",
    "sprache.flaeche_aus_landschaft",
    "sprache.update",
    "sprache.wiki",
    "sprache.retire",
    "sprache.restore",
    RUECKNAHME_SPRACHE_OPERATION,
    "sprache_flaeche.reshape",
    "sprache_flaeche.parts",
    "sprache_flaeche.split",
    "sprache_flaeche.boolean",
    "sprache_flaeche.copy",
    "sprache_flaeche.retire",
    "sprache_flaeche.restore",
]);

// --- Quelle, Werk, Korpus (`ruecknahme-quelle.ts`, `-werk.ts`, `-korpus.ts`; WI-0265 B6g1, B8d) -----------------------------------------------------

/**
 * Das Ändern einer Quelle, eines Werks und eines Korpus (und ihre eigene Rücknahme) und, seit WI-0265 B8d, ihr Anlegen (`*.create`): Zurück geht das Anlegen als Stilllegen (`aktiv: false`, beim Korpus
 * `is_active`), nie als Löschen; die Rücknahme dieser Rücknahme belebt wieder. Hängt seither etwas am angelegten Inhalt (Verwendungen an Trägern, Ortszeilen eines Werks), lehnt die Vorprüfung ab
 * (Konflikt `wert`, Schlüssel `inhalt_verwendet`). Was von den Feldern des Eintrags abhängt, prüft der Adapter in der Vorprüfung (`not_revertable`, Grund `art`). Die Verwendungen einer Quelle an Trägern
 * (`links`) gehen seit B6g3 mit zurück.
 */
export const QUELLE_OPERATIONEN: ReadonlySet<string> = new Set([
    "source.create",
    "source.update",
    RUECKNAHME_QUELLE_OPERATION,
]);
export const WERK_OPERATIONEN: ReadonlySet<string> = new Set(["work.create", "work.update", RUECKNAHME_WERK_OPERATION]);
export const KORPUS_OPERATIONEN: ReadonlySet<string> = new Set([
    "corpus.create",
    "corpus.update",
    RUECKNAHME_KORPUS_OPERATION,
]);

// --- Vorkommen (`ruecknahme-vorkommen.ts`; WI-0265 B6g2, B8d) -------------------------------------------------------------------------------------

/**
 * Das Ändern eines Vorkommens (`lore.update`: Felder, Ortszeilen, Quellenverknüpfungen, Regeln), die Regeln und Quellen, die „Regeln als Text“ anlegte (`lore.rules_text`, EINE Operation über mehrere
 * Einträge) und ihre eigene Rücknahme. Seit WI-0265 B8d auch das Anlegen (`lore.create`) und ein Eintrag, den „Regeln als Text“ anlegte (die Aktion `lore.created` unter ihren Einträgen): Zurück heißt
 * stillgelegt, samt der Regeln, Ortszeilen und Quellen, die dieselbe Serie daran anlegte. Was von den Feldern der Einträge abhängt, prüft ebenfalls der Adapter.
 */
export const VORKOMMEN_OPERATIONEN: ReadonlySet<string> = new Set([
    "lore.create",
    "lore.update",
    "lore.rules_text",
    RUECKNAHME_VORKOMMEN_OPERATION,
]);

// --- Wiki-Box (`ruecknahme-wikibox.ts`; WI-0265 B8d) -------------------------------------------------------------------------------------------

/**
 * Zuweisen und Entfernen eines Wiki-Artikels in der Wiki-Box der Karteneditoren (`wikibox.zuweisen`, `wikibox.entfernen`, sechs Arten: Ort, Weg, Gebiet, Landschaft, Kraftlinie, Gipfel) und die Rücknahme davon.
 * Eine eigene Familie mit einer Adresse je Art der Box, kein Teil der Familie des Trägers (Begründung im Kopf von `ruecknahme-wikibox.ts`).
 */
export const WIKIBOX_OPERATIONEN: ReadonlySet<string> = new Set([
    "wikibox.zuweisen",
    "wikibox.entfernen",
    // Weitere Artikel eines Wegs (WI-0300).
    "wikibox.weitere_zuweisen",
    "wikibox.weitere_entfernen",
    RUECKNAHME_WIKIBOX_OPERATION,
]);

/**
 * Operationen, die zwar zurücknehmbar sind, aber nie Mitglied einer Arbeitsserie (`arbeitsserie.ts`, `koenntMitgliedSein`; WI-0265 B8d): Sie stehen als Einzeleintrag da und trennen die Serie ihres Gegenstands. Die Wiki-Box
 * ist es, weil ihr Protokoll den Träger als Gegenstand nennt, ihre Rücknahme aber über die Anschlüsse der Box läuft und nicht über den Adapter der Familie des Trägers: Eine gemischte Serie nähme keiner von beiden an.
 */
export const EINZEL_OPERATIONEN: ReadonlySet<string> = new Set([
    "wikibox.zuweisen",
    "wikibox.entfernen",
    "wikibox.weitere_zuweisen",
    "wikibox.weitere_entfernen",
    ...UMWANDLUNG_OPERATIONEN,
]);

// --- WikiSync (`ruecknahme-wikisync.ts`; WI-0265 B8d) ---------------------------------------------------------------------------------------

/**
 * Die Übernahme eines Laufs je Bereich (`wikisync.uebernehmen`, Quelle `wikisync`) und die Übernahme von Regelvorschlägen (`lore.rules_wikisync`): Ihre Rücknahme hat der WikiSync selbst (Fachvertrag F.1: Recht
 * `undo_wikisync_run`, Passkey; `wikisync_uebernahme.zurueckgenommen_am`, `wikisync_regel_uebernahme.zurueckgenommen_am`), nicht die Link-Tafel der Reiter. Das ↺ in „Änderungen“ ruft GENAU diese Rücknahme auf; der
 * Zustand der Liste liest `zurueckgenommen_am` (`history-status.ts`).
 *
 * 🔴 **Seit WI-0265 B8e lassen sich auch die Rücknahmen zurücknehmen** (`wikisync.zuruecknehmen`, `lore.rules_wikisync_undo`): Das ist die Umkehrung aus dem Fachprotokoll (die Werte der Übernahme kommen Feld für
 * Feld wieder, wo der Istwert noch der Stand nach der Rücknahme ist), keine neue Übernahme gegen das Wiki von heute. Der Lauf nimmt dazu dieselbe Rücknahme (`wiki_zuruecknehmen`, die Zeile der Rücknahme als Ziel),
 * die Regelvorschläge eine eigene Gegenrichtung (`lore.rules_wikisync_redo`, selbst wieder zurücknehmbar durch die Rücknahme). Dazu zwei Schritte, die der Editor am Objekt auslöst und die der Auftrag mit den
 * Schreibern des WikiSync schreibt: der Sync eines Objekts in der Wiki-Box (`wikisync.objekt_sync`, zurück als `wikisync.objekt_zuruecknehmen`, selbst zurücknehmbar) und die Zuweisung eines Wiki-Artikels an eine
 * Fläche ohne Schlüssel im Regelfenster (`wikisync.flaeche_zuweisen`). Auch ihre Rücknahme `wikisync.flaeche_zuruecknehmen` hat seit B8e2 ein ↺: Es stellt dieselbe Zuweisung wieder her
 * (`wikisync.flaeche_wiederherstellen`, selbst wieder zurücknehmbar durch die Rücknahme; derselbe Schlüssel, dieselbe X2-Zeile belebt).
 * Dazu „Nicht auf die Karte“ an einem Landmarken-Kandidaten (WI-0271 L7, `editor/landmarken-kandidaten.ts`): `wikisync.landmarke_unterdruecken` und `wikisync.landmarke_anbieten` sind einander die
 * Rücknahme (dieselbe Spalte, der umgekehrte Wert), jede wieder zurücknehmbar.
 * 🪤 Die Rücknahmen laufen unter dem Recht ihrer Art: die der Verwaltung (`WIKISYNC_ADMIN_OPERATIONEN`) unter `undo_wikisync_run` mit Passkey, die des Editors (`WIKISYNC_EDITOR_OPERATIONEN`) unter `edit_map_objects`.
 */
export const WIKISYNC_UEBERNAHME_OPERATION = "wikisync.uebernehmen";
export const WIKISYNC_REGELN_OPERATION = "lore.rules_wikisync";
export const WIKISYNC_LAUF_RUECKNAHME_OPERATION = "wikisync.zuruecknehmen";
export const WIKISYNC_REGELN_UNDO_OPERATION = "lore.rules_wikisync_undo";
export const WIKISYNC_REGELN_REDO_OPERATION = "lore.rules_wikisync_redo";
export const WIKISYNC_OBJEKT_OPERATION = "wikisync.objekt_sync";
export const WIKISYNC_OBJEKT_RUECKNAHME_OPERATION = "wikisync.objekt_zuruecknehmen";
export const WIKISYNC_FLAECHE_OPERATION = "wikisync.flaeche_zuweisen";
export const WIKISYNC_FLAECHE_RUECKNAHME_OPERATION = "wikisync.flaeche_zuruecknehmen";
export const WIKISYNC_FLAECHE_WIEDER_OPERATION = "wikisync.flaeche_wiederherstellen";
export const WIKISYNC_LANDMARKE_UNTERDRUECKEN_OPERATION = "wikisync.landmarke_unterdruecken";
export const WIKISYNC_LANDMARKE_ANBIETEN_OPERATION = "wikisync.landmarke_anbieten";
/** Die Operationen der Verwaltung des WikiSync: Recht `undo_wikisync_run`, frischer Passkey. */
export const WIKISYNC_ADMIN_OPERATIONEN: ReadonlySet<string> = new Set([
    WIKISYNC_UEBERNAHME_OPERATION,
    WIKISYNC_REGELN_OPERATION,
    WIKISYNC_LAUF_RUECKNAHME_OPERATION,
    WIKISYNC_REGELN_UNDO_OPERATION,
    WIKISYNC_REGELN_REDO_OPERATION,
]);
/** Die Schritte, die der Editor am Objekt auslöst (Wiki-Box, Regelfenster): Recht `edit_map_objects`. */
export const WIKISYNC_EDITOR_OPERATIONEN: ReadonlySet<string> = new Set([
    WIKISYNC_OBJEKT_OPERATION,
    WIKISYNC_OBJEKT_RUECKNAHME_OPERATION,
    WIKISYNC_FLAECHE_OPERATION,
    WIKISYNC_FLAECHE_RUECKNAHME_OPERATION,
    WIKISYNC_FLAECHE_WIEDER_OPERATION,
    WIKISYNC_LANDMARKE_UNTERDRUECKEN_OPERATION,
    WIKISYNC_LANDMARKE_ANBIETEN_OPERATION,
]);
/** Alles, was „Änderungen“ vom WikiSync zurücknimmt. */
export const WIKISYNC_OPERATIONEN: ReadonlySet<string> = new Set([
    ...WIKISYNC_ADMIN_OPERATIONEN,
    ...WIKISYNC_EDITOR_OPERATIONEN,
]);
/** Die Quelle der Operationen des WikiSync in `map_operation.source`. */
export const WIKISYNC_QUELLE = "wikisync";
/** Die Rücknahmen des WikiSync: Sie tragen den Grund (`restoreReason`) und nennen, was sie zurücknahmen. */
export const WIKISYNC_RUECKNAHMEN: ReadonlySet<string> = new Set([
    WIKISYNC_LAUF_RUECKNAHME_OPERATION,
    WIKISYNC_REGELN_UNDO_OPERATION,
    WIKISYNC_REGELN_REDO_OPERATION,
    WIKISYNC_OBJEKT_RUECKNAHME_OPERATION,
    WIKISYNC_FLAECHE_RUECKNAHME_OPERATION,
    WIKISYNC_FLAECHE_WIEDER_OPERATION,
    // Jede der beiden kann die Rücknahme der anderen sein; ein Grund steht nur, wo einer genannt wurde.
    WIKISYNC_LANDMARKE_UNTERDRUECKEN_OPERATION,
    WIKISYNC_LANDMARKE_ANBIETEN_OPERATION,
]);
/**
 * Der Sync eines Objekts und seine Rücknahme: Sie bilden eine Kette wie die Operationen der Editoren (eine Rücknahme nimmt die Operation davor zurück, eine Rücknahme der Rücknahme gibt sie wieder frei). Die
 * Rücknahme nennt die Operation, die sie zurücknimmt, in ihrer Quittung (`affected`, Art `wikisync_operation`) und nicht in der Link-Tafel: Der Auftrag schreibt als Jobs-Rolle, und die darf die Link-Tafel nicht
 * anhängen (`map-grants.psql`). `history-status.ts` liest die Kette aus den Quittungen.
 */
export const WIKISYNC_OBJEKT_OPERATIONEN: ReadonlySet<string> = new Set([
    WIKISYNC_OBJEKT_OPERATION,
    WIKISYNC_OBJEKT_RUECKNAHME_OPERATION,
]);
/** Die Art in `affected` der Quittung einer Rücknahme des Syncs eines Objekts: die Operation, die sie zurücknimmt. */
export const WIKISYNC_OPERATION_ART = "wikisync_operation";

// --- Was bewusst ohne ↺ bleibt ----------------------------------------------------------------------------------------------

/**
 * Betreiberläufe, die als `editor` mit einem Agenten als Handelndem ins Protokoll schreiben, aber keine Handlung eines Editors sind (WI-0265 B8c): Sie haben einen eigenen Rückweg mit Sicherung und Freigabe des
 * Betreibers. Sie stehen in KEINER Menge des Katalogs, die Liste zeigt sie als `nicht_ruecknehmbar` (Grund `art`); ein Test hält sie draußen.
 *
 * - `area.gebirge_startwerte` (`terrain/startwerte-cli.ts`, WI-0249): entfernt Startwerte an den Punkten der Gebirgsnetze, nur auf der Stage (`AVESMAPS_ENV=staging`), mit dem Wortlaut der Freigabe, der Zahl aus dem
 *   Trockenlauf und einer Sicherung; der Rückweg ist `--zurueckspielen <sicherung>` mit eigener Freigabe. Ein ↺ in „Änderungen“ spielte die Startwerte ohne diese Freigabe wieder ein, gegen die Entscheidung des Betreibers.
 *   🪤 Die Quelle (`map_operation.source`) bleibt `editor`: Eine eigene Quelle bräuchte eine Migration (`map_operation_source_known`) und änderte die geschriebenen Zeilen nicht.
 */
export const SYSTEMLAUF_OPERATIONEN: ReadonlySet<string> = new Set(["area.gebirge_startwerte"]);

// --- Der Katalog -----------------------------------------------------------------------------------------------------------

/**
 * Die Operationen, die ein Adapter annimmt, je Familie. 🔴 B6g andockt hier: Quelle, Werk und Korpus (`source.update`, `work.update`, `corpus.update`; B6g1) und das Vorkommen (`lore.update`,
 * `lore.rules_text`; B6g2) und die Quellen eines Trägers (`traeger.sources`, in der Menge der Familie ihres Trägers; B6g3) sind zurücknehmbar, seit B8d auch ihr Anlegen (`*.create`) und die Wiki-Box
 * (`wikibox.*`, eigene Familie, nie in einer Serie). Was in KEINER Menge steht, ist `nicht_ruecknehmbar(art)`; eine neue Menge (oder ein Eintrag in einer vorhandenen) macht es zurücknehmbar.
 */
export const RUECKNEHMBARE_OPERATIONEN: Readonly<Record<string, ReadonlySet<string>>> = {
    ort: new Set([
        ...ORT_FELDER_OPERATIONEN,
        ...ORT_VERSCHIEBEN_OPERATIONEN,
        ...ORT_LOESCHEN_OPERATIONEN,
        ORT_ANLEGEN_OPERATION,
        ...ORT_ABNEHMEN_OPERATIONEN,
        ...ORT_WIEDERHERSTELLEN_OPERATIONEN,
        ...ORT_QUELLEN_OPERATIONEN,
    ]),
    weg: new Set([
        ...WEG_FELDER_OPERATIONEN,
        ...WEG_KURVE_OPERATIONEN,
        ...WEG_STAND_OPERATIONEN,
        WEG_UMGRUPPIEREN_OPERATION,
        WEG_VERBINDEN_OPERATION,
        WEG_STRASSE_OPERATION,
        WEG_ANLEGEN_OPERATION,
        WEG_TEILEN_OPERATION,
        ...WEG_QUELLEN_OPERATIONEN,
    ]),
    gebiet: new Set([
        ...GEBIET_FELDER_OPERATIONEN,
        ...GEBIET_ENTFERNEN_OPERATIONEN,
        ...GEBIET_QUELLEN_OPERATIONEN,
        ...GEBIET_ANLEGEN_OPERATIONEN,
        GEBIET_ZURUECKHOLEN_OPERATION,
    ]),
    kraftlinie: new Set([...KRAFTLINIE_LINIE_OPERATIONEN, ...KRAFTLINIE_STAND_OPERATIONEN]),
    nodix: NODIX_OPERATIONEN,
    flaeche: FLAECHE_OPERATIONEN,
    umwandlung: UMWANDLUNG_OPERATIONEN,
    sprache: SPRACHE_OPERATIONEN,
    quelle: QUELLE_OPERATIONEN,
    werk: WERK_OPERATIONEN,
    korpus: KORPUS_OPERATIONEN,
    vorkommen: VORKOMMEN_OPERATIONEN,
    wikibox: WIKIBOX_OPERATIONEN,
    wikisync: WIKISYNC_OPERATIONEN,
};

/** Alle Operationen, die irgendeine Familie annimmt, sortiert (für SQL: `o.action = ANY(…)`). */
export const RUECKNEHMBARE_OPERATIONEN_LISTE: readonly string[] = [
    ...new Set(Object.values(RUECKNEHMBARE_OPERATIONEN).flatMap((menge) => [...menge])),
].sort();

const ALLE: ReadonlySet<string> = new Set(RUECKNEHMBARE_OPERATIONEN_LISTE);

/**
 * Ob irgendein Adapter eine Operation dieses Namens annimmt. `false` heißt: für jeden Adapter Grund `art` (Anlegen, Weg teilen, Gebiet-Form, Inhalte …). `true` ist keine Zusage:
 * Die Aktionen der Einträge prüft der Adapter erst in der Vorprüfung.
 */
export const istRuecknehmbareOperation = (operation: string): boolean => ALLE.has(operation);
