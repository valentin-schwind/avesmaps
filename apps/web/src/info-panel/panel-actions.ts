import type { ComputedRef } from "vue";
import type {
    HeaderGraphic,
    MamBasket,
    MamEinreichung,
    MediaTypeImageVariant,
    SubjectDetail,
    SubjectRef,
    SubjectTarget,
    WaypointHit,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { ToastTone } from "../feedback/toast";
import type {
    ActionRun,
    CatalogTarget,
    HeaderOrt,
    ReviewReportTarget,
    ReviewTarget,
    SuggestTarget,
} from "./panel-types";
import type { ShownSubject, SubjectSelection } from "./subject-selection";

/**
 * Die Handlungen der Aktionskacheln (WI-0063 P6): Das Modell beschreibt, was eine Kachel tut (`ActionRun`), diese Datei führt es über die
 * VORHANDENEN Nähte aus - keine neue Planerlogik, keine zweite Kamera, kein eigener Meldungsweg.
 *
 * - **Reiseziel hinzufügen / entfernen:** der Planer (`addPlace`, `addMapPoint`, `removeWaypoint`). 🔴 DIESELBEN zwei Nähte bedient das
 *   Kartenmenü (WI-0100): `addPlace` für „Ziel hinzufügen“ auf einem Ort, `addMapPoint` für „Hierher reisen“ auf der freien Fläche.
 * - **Link teilen:** die Zwischenablage über `copyToClipboard` (noch im Klick angestoßen, Safari verlangt das) und der Meldungsweg mit Link
 *   (`showLinkToast`): Der Link steht greifbar in der Meldung, auch wenn die Zwischenablage nicht mitspielt (Betreiber 2026-09-24).
 * - **Anzeigen:** die Kamera über `flyToSubject` - die ganze Gruppe wird eingepasst und angeflogen, nie ein Sprung.
 * - **Entfernen** (Kartenpunkt): die Auswahl endet, und mit ihr der Tropfen.
 * - **Weg als Route** (P7, B12): die Orte der Straße ersetzen die Wegpunkte des Planers (`planner.replaceWaypoints`), der Planer geht auf.
 * - **Pfeile der Etappe** (P7, E13): `planner.stepStage` wählt die vorige oder nächste Etappe; gold, Kamera und Panel folgen daraus.
 * - **Eigenes Bild hinzufügen** (WI-0272 S5): das Einreichungsfenster der Reisebilder geht auf, mit dem Ort als Bezug und seiner Lage als Stelle (`openReisebild`; das Fenster gehört der Seite, `photobox/`).
 * - **Kartensammlung / Literatur anzeigen** (WI-0118): das Fenster zum Abschnitt geht auf, bei Bedarf mit einem aufgeklappten Eintrag. Das
 *   Fenster gehört der Seite (`app.vue`), nicht dem Panel; hier steht nur die Naht.
 *
 * - **Änderungen vorschlagen** (WI-0268 C2): das Meldeformular der Besucher geht auf, mit dem Objekt als Bezug (`openSuggest`; das Fenster gehört der Seite, `community/`).
 * - **Bewertung schreiben / Bewertung melden** (WI-0269 C10): die Fenster der Besucher gehen auf (`openReview`, `openReviewReport`); **Teilen** an einer Bewertung kopiert den Link (am Telefon öffnet
 *   es das Teilen-Menü des Geräts, `shareNative`).
 *
 * 🔴 Diese Datei kennt weiterhin keinen Schreibpfad: „Änderungen vorschlagen“ öffnet nur das Formular, und das Formular sendet an die Community-Route (`community/api.ts`), die an der Karte
 * nichts ändert (ein Vorschlag wird gezeigt, nie angewandt). Bis WI-0268 war die Kachel gesperrt (WI-0063 4.1); „Karte vorschlagen“ bleibt es.
 */

export interface PanelActions {
    /** Steht der Ort (oder die Kartenstelle) als Reiseziel in der Reise des Planers? Reaktiv: liest die Wegpunkte. */
    isDestination(id: string): boolean;
    run(run: ActionRun, shown: ShownSubject): void;
}

export interface PanelActionDeps {
    planner: {
        filled: ComputedRef<readonly WaypointHit[]>;
        waypoints: readonly { key: number; place: WaypointHit | null }[];
        addPlace(place: WaypointHit): boolean;
        addMapPoint(point: { x: number; y: number }): boolean;
        removeWaypoint(key: number): void;
        /** „Weg als Route“: Die Orte ersetzen die Wegpunkte der Reise, dann wird gerechnet (Legacy `resetWaypointInputs`). */
        replaceWaypoints(places: readonly WaypointHit[]): Promise<void>;
        /** Die Pfeile einer Etappe: die vorige oder nächste Etappe wählen (gold, die Karte fliegt hin). */
        stepStage(step: 1 | -1): void;
    };
    selection: Pick<SubjectSelection, "closeSubject">;
    /** Die Kamera fliegt zum Ziel (`flyToSubject`, nur über `camera.ts`). */
    fly(ref: SubjectRef, target: SubjectTarget | undefined): void;
    /** In die Zwischenablage, im Klick angestoßen (`copyToClipboard`). */
    copy(text: Promise<string>): Promise<boolean>;
    /** Meldung; mit `link` steht er greifbar darin. */
    notify(text: string, tone: ToastTone, link?: string): void;
    /** Am Rechner geht der Planer auf, damit man das Reiseziel sieht; am Telefon decken Panel und Planer einander. */
    revealPlanner(): void;
    /** Ein Kartenpunkt als erste Zeile einer neuen Reise ist der Start: Ein Hinweis sagt, dass noch ein Ziel fehlt. */
    startSet(): void;
    /** Das Katalogfenster („Kartensammlung von …“, „Literatur zu …“) geht auf; mit `focus` steht dieser Eintrag vergrößert da. */
    openCatalog(target: CatalogTarget): void;
    /** Das Meldeformular geht auf, mit diesem Objekt als Bezug (WI-0268 C2). */
    openSuggest(target: SuggestTarget): void;
    /** Das Fenster „Karte vorschlagen“ geht auf, für die Kartensammlung dieses Gegenstands (WI-0275 Stufe C). */
    openSuggestMap(target: { ref: SubjectRef; name: string; hatKarten: boolean }): void;
    /** Das Formular „Bewertung schreiben“ geht auf (WI-0269 C10). */
    openReview(target: ReviewTarget): void;
    /** Das Fenster „Bewertung melden“ geht auf (WI-0269 C10). */
    openReviewReport(target: ReviewReportTarget): void;
    /** Das Teilen-Menü des Geräts, wo es eines gibt (Telefon); `false`, wenn es keines gibt oder abgebrochen wurde: dann kopiert „Teilen“ den Link. */
    shareNative?(url: string, title: string): Promise<boolean>;
    /**
     * Die Medienverwaltung geht auf (WI-0068 P3): das Asset im Inspector, die Treffer auf das Fachobjekt beschränkt, aus dem der Einstieg
     * kam. Ohne die Naht (Besucher) gibt es den Knopf nicht.
     */
    openMedia?(target: MediaEntry): void;
    /**
     * Das Einreichungsfenster der Reisebilder geht auf (WI-0272 S5): die Stelle ist die Lage des Ortes, der Ort der Bezug. Dieselbe Naht wie „Eigenes Bild hinzufügen“ im Kartenmenü (`reisebildBesucher.oeffne`).
     */
    openReisebild?(ort: HeaderOrt): void;
}

/** Wohin der Kontext-Einstieg führt: ein Asset, dazu das Fachobjekt (Ort oder Gebiet), dessen Medien die Liste zeigt. */
export interface MediaEntry {
    asset?: string;
    von?: { kind: "place" | "territory"; id: string; name: string };
    /** Ein Prüfkorb statt der Facette des Typs (Reisebilder, WI-0272 S5: `photobox_uploads`), mit dem Teil des Korbs. */
    korb?: MamBasket;
    einreichung?: MamEinreichung;
    /** Das Medienobjekt „Typbilder“ an dieser Kategorie (das ⚙ auf der Grafik der Art, WI-0272 S5). */
    typbild?: HeaderGraphic;
    /** Dazu die Variante (WI-0281): im Modus „Ohne KI“ die Ohne-KI-Variante; ohne Angabe die KI-Variante. */
    typbildVariante?: MediaTypeImageVariant;
}

/** Das Fachobjekt hinter dem Panel, soweit die Medienverwaltung es als „verwendet von“ kennt (Ort, Gebiet). */
export function mediaSubjectOf(ref: SubjectRef): { kind: "place" | "territory"; id: string } | undefined {
    return ref.kind === "place" || ref.kind === "territory" ? { kind: ref.kind, id: ref.id } : undefined;
}

export function createPanelActions(deps: PanelActionDeps): PanelActions {
    const { planner } = deps;
    /** Den Link in die Zwischenablage und in die Meldung; „Link zur Bewertung kopiert.“ bei einer Bewertung. */
    const kopiere = (run: Extract<ActionRun, { type: "share" }>): void => {
        void deps
            .copy(Promise.resolve(run.url))
            .then((copied) =>
                deps.notify(
                    t(
                        copied
                            ? run.what === "pin"
                                ? "infoPanel.share.pinCopied"
                                : run.what === "review"
                                  ? "bewertungen.teilen.kopiert"
                                  : "infoPanel.share.placeCopied"
                            : "infoPanel.share.copyFailed",
                    ),
                    copied ? "success" : "warning",
                    run.url,
                ),
            );
    };
    return {
        isDestination: (id) => planner.filled.value.some((place) => place.id === id),
        run(run, shown) {
            switch (run.type) {
                case "addPlace":
                    // Legacy `fillLastEmptyWaypointOrAppend`; ein Ort, der schon Wegpunkt ist, wird nicht zweimal eingetragen.
                    planner.addPlace(run.hit);
                    deps.revealPlanner();
                    return;
                case "addMapPoint":
                    // Wie „Hierher reisen“ im Kartenmenü: Wer der Erste ist, ist der Start, und ein Hinweis sagt, dass ein Ziel fehlt.
                    if (planner.addMapPoint({ x: run.x, y: run.y })) deps.startSet();
                    deps.revealPlanner();
                    return;
                case "removeDestination": {
                    const row = planner.waypoints.find((entry) => entry.place?.id === run.id);
                    if (row !== undefined) planner.removeWaypoint(row.key);
                    return;
                }
                case "share": {
                    // Noch im Klick angestoßen: Der Link steht schon fest, die Zwischenablage bekommt ihn in der Geste.
                    if (run.what === "review" && deps.shareNative !== undefined) {
                        // Am Telefon das Teilen-Menü des Geräts (Bedienkonzept §6.3); ohne eines, oder abgebrochen, kopiert „Teilen“ den Link.
                        const title = t("bewertungen.teilen.menuTitel", { name: (shown.title ?? "").trim() });
                        void deps.shareNative(run.url, title).then((geteilt) => {
                            if (!geteilt) kopiere(run);
                        });
                        return;
                    }
                    kopiere(run);
                    return;
                }
                case "review":
                    deps.openReview({
                        ortId: run.ortId,
                        ortName: run.ortName,
                        ...(run.sterne === undefined ? {} : { sterne: run.sterne }),
                    });
                    return;
                case "reviewReport":
                    deps.openReviewReport({ ortId: run.ortId, ortName: run.ortName, bewertung: run.bewertung });
                    return;
                case "suggest":
                    deps.openSuggest({
                        objektArt: run.objektArt,
                        objektId: run.objektId,
                        name: run.name,
                        ...(run.typ === undefined ? {} : { typ: run.typ }),
                        ...(run.lage === undefined ? {} : { lage: run.lage }),
                    });
                    return;
                case "show":
                    // Die ganze Gruppe: Weg oder Kraftlinie, nicht das angeklickte Stück - das Ziel der Antwort trägt ihre Grenzen.
                    deps.fly(shown.ref, (shown.answer as SubjectDetail | undefined)?.target);
                    return;
                case "pathAsRoute":
                    // Legacy `path-as-route`: Die Orte der Straße ERSETZEN die Wegpunkte - auch Kartenpunkte und eine bestehende Reise -,
                    // danach wird gerechnet und die Route eingepasst (die Kamera fliegt, `planner.restore`-Naht).
                    void planner.replaceWaypoints(run.places);
                    deps.revealPlanner();
                    return;
                case "stageStep":
                    // Die Etappe wählt der Planer (gold, die Karte fliegt hin); das Panel folgt über `bindPlannerStage`.
                    planner.stepStage(run.step);
                    return;
                case "closePoint":
                    deps.selection.closeSubject({ source: "context" });
                    return;
                case "openCatalog":
                    deps.openCatalog({
                        section: run.section,
                        ref: run.ref,
                        name: run.name,
                        ...(run.focus === undefined ? {} : { focus: run.focus }),
                    });
                    return;
                case "suggestMap":
                    deps.openSuggestMap({ ref: run.ref, name: run.name, hatKarten: run.hatKarten });
                    return;
                case "reisebildHinzufuegen":
                    deps.openReisebild?.(run.ort);
                    return;
                case "openReisebilder":
                    // Ein Reisebild hängt an keinem Fachobjekt (`photobox_media`): kein „verwendet von“, sonst bliebe die Liste leer.
                    deps.openMedia?.({
                        korb: "photobox_uploads",
                        einreichung: run.einreichung ?? "offen",
                        ...(run.asset === undefined ? {} : { asset: run.asset }),
                    });
                    return;
                case "openTypbild":
                    deps.openMedia?.({
                        typbild: run.kategorie,
                        ...(run.variante === undefined ? {} : { typbildVariante: run.variante }),
                    });
                    return;
                case "openMedia": {
                    const von = mediaSubjectOf(shown.ref);
                    deps.openMedia?.({
                        asset: run.asset,
                        ...(von === undefined ? {} : { von: { ...von, name: run.name } }),
                    });
                    return;
                }
            }
        },
    };
}
