<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, useTemplateRef, watch } from "vue";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// 💣 Der Worker MUSS als Asset importiert werden, sonst fehlt er im Production-Build.
//
// MapLibre baut seine Worker-URL selbst zusammen: `new URL(`./${name}`, import.meta.url)`, wobei
// `name` aus einer Bedingung kommt. Dieses Muster kann kein Bundler statisch aufloesen - die Datei
// wird deshalb nicht emittiert, und der Worker-Request laeuft in den SPA-Fallback: HTTP **200** mit
// `text/html` statt JavaScript.
//
// 🪤 Der Fehlermodus ist der unangenehmste, den es gibt: MapLibre startet, der Canvas steht, die
// Karte reagiert auf die Maus - und der Style wird NIE fertig geladen. Keine Ausnahme, keine
// Fehlermeldung in der Konsole, kein einziger Vektorkachel-Request. Auf Stage sah das aus wie ein
// Daten- oder Rechteproblem, war aber eine fehlende Datei. Und weil der Server 200 antwortet,
// findet ein `curl` auf die Kachelquellen daran nichts.
//
// 🪤 `?worker&url`, NICHT `?url`. Der erste Anlauf nahm `?url` - damit kopiert Vite genau die eine
// Datei und loest ihre Imports NICHT auf. Der Worker ist aber ein Modul-Worker: er importiert
// `./maplibre-gl-shared.mjs`, und die fehlte weiter im Artefakt. Ergebnis auf Stage: der Worker
// selbst kam mit 200 und `text/javascript` an, sein Import lief ins 404, und `new Worker()` scheiterte
// mit einem Error-Event OHNE Meldung. Der Fehler sah damit genauso aus wie vorher.
//
// `?worker&url` buendelt den Worker samt Abhaengigkeiten und liefert die URL des Ergebnisses.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

maplibregl.setWorkerUrl(maplibreWorkerUrl);
// Jede Geländekachel unter ihrer eigenen Revision (WI-0125, JOBS-0001 V2): vor dem ersten Stil angemeldet.
// `?kachelprotokoll=aus` lässt es weg (nur im Entwicklungsbuild, `map/flug-probe.ts`): dann lädt MapLibre die Höhenkacheln
// wieder selbst, in seinen Arbeitern statt im Hauptthread.
if (!kachelprotokollAus()) installTerrainTileProtocol(maplibregl.addProtocol);
// Wie viele Kachelbilder gleichzeitig unterwegs sein duerfen: die Steilheit, mit der der Speicher gefuellt wird.
const PARALLEL_GRENZE = parallelGrenze();
if (PARALLEL_GRENZE !== undefined) maplibregl.setMaxParallelImageRequests(PARALLEL_GRENZE);
// Die Neigung ist der groesste Kostentreiber des Gelaendes (`camera/camera-math.ts`, `setMaxPitch`).
setMaxPitch(maxNeigung());
import {
    EDITOR_LANDSCAPE_LAYERS,
    AVENTURIA,
    AVENTURIA_TRAVEL_MODEL,
    ANSICHT_FUER_BILDNAMEN,
    getVisibleMapSeries,
    nurUnterNurKarte,
    DEFAULT_LANDSCAPE_SELECTION,
    DEFAULT_MAP_VIEW,
    DEFAULT_TOPOGRAPHY_VARIANT,
    type DisplayHeightPointer,
    type TerritoryPointer,
    type LandscapeSelection,
    type TopographyVariant,
    type MapView,
    composeView,
    createRenderProjection,
    fromRenderLngLat,
    renderBounds,
    PLACE_ZOOM_FLOOR,
    parsePathChain,
    pathReaderName,
    placeNearZoom,
    SEARCH_FIT_MAX_ZOOM,
    renderZoomForBand,
    FLY_MAX_BAND,
    MAX_VIEW_BAND,
    mapPointId,
    subjectKey,
    toRenderLngLat,
    EDITORPANEL,
    verbModus,
    type MapBounds,
    type MapPoint,
    type RasterPyramidPointer,
    type TerrainDemPointer,
    type RouteResponse,
} from "@avesmaps3d/shared";
import { loadRasterPointer } from "./map/basemap";
import {
    flaechenEbenenImStil,
    LANDSCAPE_RUN_SOURCE_ID,
    LANDSCAPE_SOURCE_ID,
    landscapeFillLayerId,
    MAP_LABEL_SOURCE_ID,
    WATER_SOURCE_ID,
} from "./map/landscape-layers";
import { TERRITORY_FILL_LAYER_ID } from "./map/territory-layers";
import { buildPlaceStyle, PLACE_SOURCE_ID, PLACE_MARKER_LAYERS } from "./map/place-layers";
import { createCamera, type Camera } from "./map/camera/camera";
import { setMaxPitch, setZoomKurve } from "./map/camera/camera-math";
import { HINWEIS_MIN_BREITE, HINWEIS_RAND, hinweisPlatz, type HinweisPlatz } from "./controls/kamera-hinweis-platz";
import {
    constrainToVisible,
    createVisibleArea,
    freieFlaeche,
    freieMitte,
    isLayoutMove,
    leavesGap,
    NO_INSETS,
    visibleRect,
    type Insets,
    type VisibleArea,
} from "./map/camera/visible-area";
import { installGradnetzRahmen, type GradnetzRahmen } from "./map/gradnetz-rahmen";
import { HEXRASTER_LEER, installHexraster, type Hexraster } from "./map/hexraster";
import { istVerdeckt } from "./wegeditor/weg-verdeckt";
import { cameraMapOptions } from "./map/camera/camera-options";
import { installPointerControls } from "./map/camera/pointer-controls";
import { createInteractionCoordinator } from "./map/interaction/coordinator";
import { areaLayersInView, ownersInView, pathPreviewOutlined } from "./map/interaction/priorities";
import {
    climateOwner,
    contextOwner,
    emptyOwner,
    placeOwner,
    routeOwner,
    type SelectedPlace,
} from "./map/interaction/owners";
import type { MapInteractionCoordinator } from "./map/interaction/types";
import { mapLocale } from "./map/map-locale";
import CameraControls from "./controls/camera-controls.vue";
import { coarsePointer } from "./controls/camera-settings";
import MapFan from "./controls/map-fan.vue";
import { installKeyboard } from "./keyboard/install-keyboard";
import { createEscapeCascade, ESCAPE_CASCADE_KEY } from "./keyboard/escape-cascade";
import { FENSTER_ESC_VORHER } from "./fenster/fenster-esc";
import { installAtmosphere, withAtmosphere } from "./map/atmosphere/atmosphere";
import { installFlugMelder } from "./map/flug-melder";
import {
    bildpunktdichte,
    drapeGuete,
    flugbahnAus,
    gelaendeAus,
    gelaendeStufe,
    kachelprotokollAus,
    deckend,
    dunstAus,
    reliefAus,
    eigeneEbenenAus,
    ohneEbenen,
    maxNeigung,
    kachelSpeicher,
    pillenAus,
    parallelGrenze,
} from "./map/flug-probe";
import { installPowerlineArcs, type PowerlineArcsController } from "./map/powerline-arcs";
import { installRoutePills, type RoutePillsController } from "./map/route-pills";
import { installFlightArcs, type FlightArcsController } from "./map/flight-arcs";
import { installTravelerLayer, type TravelerFlightHeight, type TravelerLayerController } from "./map/traveler-layer";
import { whenStyleTakesChanges } from "./map/style-ready";
import { registerRuntimeImages } from "./map/runtime-images";
import {
    HILLSHADE_SOURCE_ID,
    installTerrain,
    TERRAIN_SOURCE_ID,
    terrainShare,
    withTerrain,
    GELAENDE_STUFEN,
} from "./map/terrain/terrain";
import { startTerrainLive } from "./map/terrain/terrain-live";
import { applyTerrainPointer, installTerrainTileProtocol } from "./map/terrain/terrain-tiles";
import { loadTerrainPointer } from "./map/terrain/terrain-pointer";
import { displayHeightFor, loadDisplayHeightPointer } from "./map/terrain/display-height-pointer";
import { loadTerritoryPointer } from "./map/territory-pointer";
import { territoryBandForZoom, territoryBandLead, watchTerritoryBand } from "./map/territory-band";
import { claimHatchImageResolver } from "./map/claim-hatch-images";
import {
    SPRACHE_MISCH_SOURCE_ID,
    SPRACHE_MISCH_SOURCE_LAYER,
    SPRACHE_SOURCE_ID,
    SPRACHE_SOURCE_LAYER,
    SPRACHEN_QUELLEN_NACH_ART,
    sprachMischImageResolver,
} from "./map/sprachen-layers";
import { installSprachLabels } from "./map/sprachen-labels";
import { createSprachLeuchten, SPRACH_LEUCHTEN_ZUGANG, withSprachLeuchten } from "./map/sprachen-leuchten";
import { useSprachenStand } from "./map/sprachen-stand";
import { useSprachWahl } from "./map/sprachen-wahl";
import { createSpracheditorFuerSeite } from "./spracheditor/spracheditor-anbindung";
import { createSprachKartenmenue } from "./spracheditor/sprache-kartenmenue";
import { SPRACH_KOPIE } from "./spracheditor/sprachflaeche-kopieren";
import SpracheditorSeite from "./spracheditor/spracheditor-seite.vue";
import { createWetterKartenmenue } from "./wettereditor/wetter-kartenmenue";
import { createWettereditorHuelle } from "./wettereditor/wettereditor-huelle";
import WettereditorSeite from "./wettereditor/wettereditor-seite.vue";
import { installVorkommenNamen } from "./map/vorkommen-namen";
import { vorkommenZeichenResolver } from "./map/vorkommen-zeichen-bild";
import { installStyleImageResolvers } from "./map/style-image-resolver";
import { coatImageResolver } from "./map/territory-coat-images";
import { loadTerritoryCoats } from "./map/territory-coats";
import HeightLegend from "./controls/height-legend.vue";
import SprachenLegende from "./controls/sprachen-legende.vue";
import { sprachenLegendeZeigen } from "./map/sprachen-legende-schalter";
import { detectSoftwareRendering } from "./map/terrain/software-rendering";
import { installLabelTuner } from "./map/label-tuner";
import { formatViewState, parseViewState, readViewChoices, sameViewState, type ViewState } from "./map/view-state";
import { isDefaultDisplay, queryWithoutDisplayParams, readAddressDisplay } from "./map/display-state";
import { installHashFolgen } from "./map/hash-folgen";
import { ansichtFuerHinflug, createAnsichtWechsel } from "./map/hinflug-ansicht";
import { useDisplayChoices } from "./map/display-choices";
import { LEGACY_VIEW_PARAMS, openingView } from "./map/legacy-view";
import { startansicht } from "./map/start-view";
import { kartenserienKatalog } from "./map/kartenserien-stand";
import { bootstrapViewer, VIEWER_CONTEXT_KEY } from "./viewer/bootstrap-viewer";
import { einmalOffen } from "./einmal-offen";
import { REISE_PDF_KARTE } from "./reise-pdf/karte-zugang";
import {
    CitymapsFenster,
    CommunityBesucher,
    CommunityRedaktion,
    HinweiseFenster,
    KartenScreenshot,
    KartenvorschlagFenster,
    ladeBauteilVor,
    LiteratureFenster,
    ReisebildBesucher,
    ReisebilderHost,
    ReisebilderKnopf,
    InhalteFenster,
    MedienFenster,
    MedienStelleHinweis,
    MessFenster,
    AppKopfleiste,
    EditorFloatingMenu,
    EditorPanel,
    LandschaftseditorFenster,
    UntergrundRegler,
    GebietseditorFenster,
    KraftlinieneditorFenster,
    WegeditorFenster,
    OrtseditorFenster,
    HandgriffGruppe,
    ladeWettereditor,
    wettereditorGeladen,
} from "./nachladen";
import { installiereMedienAdresse, medienOffen, oeffneMedien, type MedienZiel } from "./medien/medien-oeffnen";
import type { MedienKartenziel } from "./medien/medien-zustand";
import {
    INHALTE_GEGENSTAND,
    INHALTE_WERKZEUG,
    inhalteQuelleWunsch,
    inhalteReiterWunsch,
    reiterAus,
    type InhalteReiter,
} from "./inhalte/inhalte-oeffnen";
import type { HinweiseZiel } from "./legal/hinweise-ziel";
import { hinweisAusSuche } from "./legal/hinweis-adresse";
import NeuigkeitenFenster from "./news/neuigkeiten-fenster.vue";
import AuthFensterHost from "./auth/auth-fenster-host.vue";
import { isEditorAddress, publicMapUrl } from "./auth/entry";
import { authState, signInExpected } from "./auth/session-state";
import CornerLinks from "./controls/corner-links.vue";
import ScaleBar from "./scale/scale-bar.vue";
import DisplayMenu from "./controls/display-menu.vue";
import { cascade, lakesAreAreas, lockedSwitches } from "./map/map-display";
import { fetchOutline, outlineZoom, serverAreaLookup, useAreaRevision, type Outline } from "./map/area-lookup";
import SpotlightSearch from "./search/spotlight-search.vue";
import { focusForHit } from "./search/search-focus";
import { createSuchLeuchten, SUCH_LEUCHTEN_ZUGANG, type SuchLeuchtenZugang } from "./search/such-leuchten-steuerung";
import { KATEGORIE_ZEICHEN } from "./search/vorkommen-ansicht";
import InfoEintragPille from "./info-panel/info-eintrag-pille.vue";
import InfoVorkommenSammel from "./info-panel/info-vorkommen-sammel.vue";
import { createUnterwegsAuswahl, UNTERWEGS_AUSWAHL } from "./route-planner/unterwegs-auswahl";
import { EINTRAG_OEFFNEN } from "./info-panel/eintrag-oeffnen";
import { leuchtenAusschnitt, vorkommenAusschnitt, withSuchLeuchten } from "./map/such-leuchten";
import type {
    EditorLock,
    InhalteVorkommenArt,
    SearchGebietHit,
    SearchHit,
    SearchLandmarkeHit,
    SearchLeuchtAnfrage,
    SearchLeuchtenBegriff,
    SearchVorkommenHit,
    SearchZielHit,
    SubjectRef,
    WaypointHit,
    EditorLandmarkenKandidat,
    EditorWikiEintrag,
} from "@avesmaps3d/shared";
import RoutePlanner from "./route-planner/route-planner.vue";
import RoutePlayer from "./route-planner/route-player.vue";
import { createPlanner, type PlannerMapState } from "./route-planner/use-planner";
import { usePlaymode } from "./route-planner/use-playmode";
import { createTravelerView } from "./map/traveler-view";
import { withPlannerLink } from "./route-planner/planner-link";
import { umwandelnMeldung } from "./ortseditor/ort-umwandeln";
import { landmarkeAlsZiel, MAP_POINT_SUBTYPE, mapPointNames } from "./route-planner/planner-model";
import { copyToClipboard, readShareCode, useShareLink } from "./route-planner/use-share-link";
import { selectedAir } from "./route-planner/air-profiles";
import {
    candidateTypeLabel,
    landscapeTypeLabel,
    useRouteLandscapes,
    type LandscapeEntry,
    type TerritoryEntry,
} from "./route-planner/route-landscapes";
import {
    AREA_SELECTION_FILL_LAYER_ID,
    areaIds,
    areaLabel,
    type AreaSelection,
    type DrawnArea,
} from "./map/area-selection";
import {
    installAreaSelection,
    landscapesAt,
    outlineArea,
    selectionOf,
    type AreaChoices,
} from "./map/area-selection-input";
import { installPathSelection } from "./map/path-selection-input";
import {
    installPowerlineSelection,
    type PowerlineCandidate,
    type PowerlineChoices,
} from "./map/powerline-selection-input";
import {
    LEY_NODE_SOURCE_ID,
    NODIX_HIT_LAYER_ID,
    POWERLINE_HIT_WIDTH,
    POWERLINE_SOURCE_ID,
} from "./map/powerline-layers";
import {
    EMPTY_ROUTE_LAYER,
    ROUTE_HIT_WIDTH,
    routeRenderBounds,
    updateRouteData,
    withRoute,
    type RouteLayerData,
} from "./map/route-layers";
import ToastHost from "./feedback/toast-host.vue";
import LoadingBar from "./feedback/loading-bar.vue";
import KarteGestoert from "./map/karte-gestoert.vue";
import { installKartenStoerung } from "./map/karte-gestoert";
import { installKachelWiederholung } from "./map/kachel-wiederholung";
import { showLinkToast, showToast } from "./feedback/toast";
import { phoneViewport } from "./controls/phone-viewport";
import MapContextMenu, { type MapContextAction } from "./controls/map-context-menu.vue";
import type { ScreenshotRaster } from "./screenshot/karten-screenshot.vue";
import AreaHoverChip from "./controls/area-hover-chip.vue";
import AreaChoiceMenu from "./controls/area-choice-menu.vue";
import { areaChoiceList, linkChoiceList, powerlineChoiceList } from "./controls/choice-list";
import { editorActions } from "./editor-menu/actions";
import { createEditorMenu } from "./editor-menu/editor-menu";
import InfoPanel from "./info-panel/info-panel.vue";
import { createWerkzeugfenster } from "./editor-panel/werkzeugfenster";
import { createKarteninhaltZahlen } from "./editor-panel/karteninhalte-zahlen";
import { inhalteListen } from "./inhalte/inhalte-listen";
import { kachelFuerAnsicht, kachelGruppen } from "./editor-panel/karteninhalte-kacheln";
import { auswahlEndetMitFenster, auswahlEndetMitKachel, zugegangen } from "./editor-panel/editor-auswahl";
import { merkeMessfensterOffen, messfensterOeffnetBeimLaden } from "./system/messfenster-merker";
import { meldeQuelle } from "./system/ungespeichert";
import EntwurfLeiste from "./fenster/entwurf-leiste.vue";
import EbenenLeiste from "./landschaftseditor/ebenen-leiste.vue";
import { ebenenZaehlung, gipfelGegenstand, gipfelVon, stapelUmschalten } from "./landschaftseditor/landschaften-liste";
import { neueFlaecheEbenen } from "./landschaftseditor/neue-flaeche-ebenen";
import { derographieAndockung } from "./landschaftseditor/neue-flaeche-derographie";
import { beobachteUntergrund, untergrundImStil } from "./landschaftseditor/untergrund-karte";
import { beobachteHoehenlinien, hoehenlinienImStil } from "./landschaftseditor/hoehenlinien-schalter";
import { entwurfsSpeicher } from "./fenster/entwurf-sicherung";
import { createEckenFuerSeite } from "./landschaftseditor/ecken-anbindung";
import { createAuswahlIsolieren, isoliereStil, nurIsolierte } from "./landschaftseditor/auswahl-isolieren";
import { createFlaecheVereinfachenFuerSeite } from "./landschaftseditor/flaeche-vereinfachen-anbindung";
import FlaecheVereinfachenLeiste from "./landschaftseditor/flaeche-vereinfachen-leiste.vue";
import { createFlaecheVerschiebenFuerSeite } from "./landschaftseditor/flaeche-verschieben-anbindung";
import FlaecheVerschiebenLeiste from "./landschaftseditor/flaeche-verschieben-leiste.vue";
import { createFlaecheMalenFuerSeite } from "./landschaftseditor/flaeche-malen-anbindung";
import FlaecheMalenLeiste from "./landschaftseditor/flaeche-malen-leiste.vue";
import KammNetzLeiste from "./landschaftseditor/kamm-netz-leiste.vue";
import { createKammNetz } from "./landschaftseditor/kamm-netz-anbindung";
import type { KopierZiel } from "./landschaftseditor/landschaft-kopieren";
import type { LandschaftSammelFelder } from "./landschaftseditor/landschaft-sammel";
import type { SammelEntwurf } from "./fenster/sammel";
import { createBeschriftungZiehen } from "./landschaftseditor/beschriftung-ziehen";
import { createGipfelZiehen } from "./landschaftseditor/gipfel-ziehen";
import { gipfelBesitzer, type GipfelAufKarte } from "./landschaftseditor/gipfel-besitzer";
import { gipfelHandgriffe, gipfelSubjekt } from "./editor-menu/handgriffe-gipfel";
import { PEAK_LAYER_ID, PEAK_SOURCE_ID } from "./map/topography-layers";
import { eckenHinweis } from "./landschaftseditor/ecken-texte";
import { createGebietsformFuerSeite } from "./gebietseditor/gebietsform-anbindung";
import { GRUND_FLAECHE, GRUND_GEBIET, GRUND_SPRACHE } from "./editor-menu/sonderrolle-grund";
import { createZoombaenderFuerSeite, zoomFuerBand, zoombandHinweis } from "./gebietseditor/zoombaender-anbindung";
import ZoombaenderLeiste from "./gebietseditor/zoombaender-leiste.vue";
import { entwurfsTaste } from "./fenster/entwurf-kern";
import { formHinweis } from "./map/geometrie/formentwurf-texte";
import { createEditorSperre } from "./editor-sperre/sperre";
import { createFremdeSperren, sperrDetail, sperrKopf, sperrSchild } from "./editor-sperre/fremde-sperren";
import { createFreigabeAnfragen } from "./editor-sperre/freigabe-anfragen";
import { createFreigabeBitten } from "./editor-sperre/freigabe-bitten";
import FreigabeHinweise from "./editor-sperre/freigabe-hinweise.vue";
import { installSperreSchicht, type SperreSchicht } from "./map/sperre-schicht";
import { installVerborgeneFlaechen, VERBORGEN_EBENEN, type VerborgeneFlaechen } from "./map/verborgene-flaechen";
import { installEntwurfsFlaechen, type EntwurfsFlaechen } from "./map/entwurfs-flaechen";
import { installEntwurfsBeschriftungen, type EntwurfsBeschriftungen } from "./map/entwurfs-beschriftungen";
import { createAusstehendeGebiete, GEBIETE_EBENE } from "./gebietseditor/ausstehende-gebiete";
import { createGebietTeile, leuchtendeWahl } from "./gebietseditor/gebiet-teile";
import { installGipfelHervorhebung, type GipfelHervorhebung } from "./landschaftseditor/gipfel-hervorhebung";
import { installGebirgsNaehte, naehteSichtbar, type GebirgsNaehte } from "./landschaftseditor/gebirgs-naehte";
import { istGebirge } from "./landschaftseditor/landschaft-art";
import { sichtbarAn } from "./editor-panel/fenster-verwaltung";
import { istFluss } from "./wegeditor/weg-art";
import { installAenderungenKarte } from "./map/aenderungen-overlay";
import { installGebirgeVorschau, type GebirgeVorschauKarte } from "./landschaftseditor/gebirge-vorschau-karte";
import { installAblageHinweis } from "./fenster/ablage-hinweis";
import { leistenbreite, leistenplatz, type LeistenAnlass, type Leistenplatz } from "./fenster/leistenplatz";
import { entwurfsFlaechen } from "./landschaftseditor/entwurf-ebene";
import { gespeicherteBeschriftungen, gezogeneBeschriftungen } from "./landschaftseditor/gezogene-beschriftungen";
import { EDITOR_LANDSCAPES_HIDDEN_URL, type EditorHiddenLandscape } from "@avesmaps3d/shared";
import type { SperrKastenInhalt } from "./editor-menu/kartenmenue";
import { createLandschaftseditorSteuerung } from "./landschaftseditor/landschaftseditor-steuerung";
import { createGebietseditorSteuerung, type GebietReiter } from "./gebietseditor/gebietseditor-steuerung";
import { createMehrfachMarkierung, folgeMehrfachauswahl, markiert, type MehrfachZiel } from "./map/mehrfach-markierung";
import { umschalteAufKarte } from "./editor-liste/mehrfachauswahl";
import { GEBIET_EBENEN, gebieteAm, gebieteAus } from "./gebietseditor/gebiete-am-punkt";
import { installGebietWechsel } from "./gebietseditor/gebiet-wechsel";
import { gebietHandgriffe, gebietSubjekt, neuesGebietEintrag } from "./editor-menu/handgriffe-gebiet";
import { createKraftlinieneditorSteuerung } from "./kraftlinieneditor/kraftlinieneditor-steuerung";
import { createKraftlinieKurveFuerSeite } from "./kraftlinieneditor/kraftlinie-anbindung";
import { kraftlinieHandgriffe } from "./editor-menu/handgriffe-kraftlinie";
import {
    kraftlinienAm,
    kraftlinienpunktAm,
    kraftlinienpunktSubjekt,
    kraftlinieSubjekt,
} from "./kraftlinieneditor/kraftlinie-am-punkt";
import { createKraftlinienpunktEntfernen } from "./kraftlinieneditor/kraftlinienpunkt-entfernen";
import { createKraftlinienpunktVerschiebenFuerSeite } from "./kraftlinieneditor/kraftlinienpunkt-verschieben";
import { createNeueKraftlinieFuerSeite } from "./kraftlinieneditor/neue-kraftlinie-anbindung";
import { createKraftlinienDaten } from "./kraftlinieneditor/kraftlinien-daten";
import { createKraftlinienpunktSetzen } from "./kraftlinieneditor/kraftlinienpunkt-setzen";
import { createGipfelDaten } from "./landschaftseditor/gipfel-daten";
import { createLandmarkeSetzen } from "./landschaftseditor/landmarke-setzen";
import LandmarkeSetzenLeiste from "./landschaftseditor/landmarke-setzen-leiste.vue";
import { beschriftungGrund, createBeschriftungen } from "./landschaftseditor/beschriftung-anlegen";
import NeueKraftlinieLeiste from "./kraftlinieneditor/neue-kraftlinie-leiste.vue";
import { createWegeditorSteuerung } from "./wegeditor/wegeditor-steuerung";
import { artName as wegArtName } from "./wegeditor/wege-liste";
import { createOrtseditorDaten } from "./ortseditor/ortseditor-daten";
import { createOrtseditorSteuerung, type OrtseditorHinflug } from "./ortseditor/ortseditor-steuerung";
import { freiFuer, type Ziellage } from "./editor-panel/hinflug";
import { listenOeffnung, type Listenwahl } from "./editor-panel/listenwahl";
import { createListenSchalter, listeImModus } from "./fenster/listen-schalter";
import { createOrtVerschieben } from "./ortseditor/ort-verschieben";
import OrtVerschiebenLeiste from "./ortseditor/ort-verschieben-leiste.vue";
import { createOrtSperre } from "./ortseditor/ort-sperre";
import { createOrtSetzen } from "./ortseditor/ort-setzen";
import { fuehreAus, handgriffZeilen } from "./editor-menu/action";
import { modusGrund, ortHandgriffe, ortSubjekt, type OrtWirkung } from "./editor-menu/handgriffe-ort";
import {
    anlegenEintraege,
    griffAbschnitte,
    griffAn,
    kartenAbschnitte,
    legeAn,
    type EditorAbschnitt,
} from "./editor-menu/kartenmenue";
import { flaecheHandgriffe, flaecheSubjekt } from "./editor-menu/handgriffe-flaeche";
import { artNebenName, unnamedCandidateLabel } from "./i18n/unnamed";
import type { EditorMenuSubject } from "./editor-menu/action";
import { subjectOf } from "./editor-menu/subject-identity";
import { verbergen } from "./ortseditor/ort-handgriffe";
import { geometrieBelegt, geometrieModus } from "./map/geometrie/besitzer";
import { vergissEinzug, zeigeNachEinzug } from "./map/geometrie/kamera";
import { installOrtVerschieben } from "./map/geometrie/ort";
import WegkurveLeiste from "./wegeditor/wegkurve-leiste.vue";
import NeuerWegLeiste from "./wegeditor/neuer-weg-leiste.vue";
import WegEntfernenFenster from "./wegeditor/weg-entfernen-fenster.vue";
import { createWegAbschnitte } from "./wegeditor/weg-abschnitte";
import { createWegHierTeilen, einheitenJePixel, UMKREIS_FANGRADIEN } from "./wegeditor/weg-hier-teilen";
import { createAbschnitteLeuchten, type AbschnitteBild } from "./wegeditor/abschnitte-leuchten";
import { GANZE_STRASSE } from "./editor-menu/handgriffe-weg";
import type { EditorMenuVorschau } from "./editor-menu/editor-menu";
import { createWegEntfernen, type EntfernenZiel, type WegEntfernenWahl } from "./wegeditor/weg-entfernen";
import { createWegeditorDaten } from "./wegeditor/wegeditor-daten";
import { createNeuerWegFuerSeite } from "./wegeditor/neuer-weg-anbindung";
import AnlegenSchild from "./map/geometrie/anlegen-schild.vue";
import { createNeueFlaecheFuerSeite, sichtbareEbenen } from "./map/geometrie/neue-flaeche-anbindung";
import NeueFlaecheLeiste from "./map/geometrie/neue-flaeche-leiste.vue";
import { createMitAnderer } from "./landschaftseditor/mit-anderer-flaeche";
import {
    VEREINIGEN_EINTRAG,
    createFlaechenVereinigen,
    type FlaechenAuswahl,
    type VereinigenEintrag,
} from "./map/flaechen-vereinigen";
import { createFlaechenLeuchten } from "./map/flaechen-leuchten";
import { createGebietTeileLeuchten } from "./map/gebiet-teile-leuchten";
import MitAndererLeiste from "./landschaftseditor/mit-anderer-leiste.vue";
import { createUnterflaechen } from "./landschaftseditor/unterflaechen";
import UnterflaechenLeiste from "./landschaftseditor/unterflaechen-leiste.vue";
import { createZerschneiden } from "./landschaftseditor/zerschneiden";
import ZerschneidenLeiste from "./landschaftseditor/zerschneiden-leiste.vue";
import { createGebietAnlegenFuerSeite } from "./gebietseditor/neue-flaeche-gebiet-anbindung";
import { createWegkurveFuerSeite } from "./wegeditor/wegkurve-anbindung";
import { wegHandgriffe, wegSubjekt } from "./editor-menu/handgriffe-weg";
import { wegAm, wegeAm } from "./wegeditor/weg-am-punkt";
import {
    flaechenWahlListe,
    installObjektDoppelklick,
    loeseAusAn,
    type DoppelklickSeite,
} from "./editor-menu/doppelklick";
import type { AreaCandidate } from "./map/area-candidates";
import { meldungText, wegName } from "./wegeditor/wegeditor-texte";
import { installPlaceDrop, installPlaceSet } from "./map/place-set";
import {
    createEditRevision,
    createRevisionsDrossel,
    ladeKachelStand,
    mitStand,
    quellenFuer,
} from "./map/edit-revision";
import { PATH_LABEL_SOURCE_ID, PATH_SOURCE_ID } from "./map/path-layers";
import { browserSpeicher, createNavStand, navRechte, oeffnetBeimLaden } from "./editor-panel/editor-panel-nav";
import { merkeBewertungsLink } from "./info-panel/bewertung-ziel";
import { createObjectLink } from "./info-panel/object-link";
import { createPanelActions, type MediaEntry } from "./info-panel/panel-actions";
import { BESUCHER_BREITE, NEBEN_PANEL, besucher as communityBesucher } from "./community/community-besucher";
import { installLageVorschlag } from "./community/lage-vorschlag";
import { reisebildBesucher } from "./photobox/reisebild-besucher";
import { kartenvorschlagBesucher } from "./kartenvorschlag/kartenvorschlag-besucher";
import { installStelleLayer } from "./photobox/stelle-layer";
import { reisebilderImStil, starteReisebilder } from "./photobox/reisebilder-start";
import { holeMedienFensterZurueck, medienStelle } from "./medien/medien-stelle";
import { installMedienStelle } from "./medien/medien-stelle-layer";
import {
    BEITRAG_WERKZEUG,
    BEWERTUNG_WERKZEUG,
    KARTENVORSCHLAG_WERKZEUG,
    NEUE_MAIL_WERKZEUG,
    redaktion as communityRedaktion,
    VORGANG_WERKZEUG,
} from "./community/redaktion";
import { verbindeRedaktion } from "./community/redaktion-anbindung";
import { installVorgangLage } from "./community/redaktion-lage";
import type { CatalogTarget } from "./info-panel/panel-types";
import { bindPlannerStage, stageRefOf } from "./info-panel/planner-binding";
import { keepPlannerAndPanelApart } from "./info-panel/phone-exclusion";
import type { PresentedSelection } from "./info-panel/presentation";
import { createSubjectClient } from "./info-panel/subject-client";
import { flyToSubject } from "./info-panel/subject-camera";
import {
    presentationOfHit,
    subjectRefOfArea,
    subjectRefOfHit,
    subjectRefOfPlace,
    subjectRefOfPoint,
} from "./info-panel/subject-refs";
import { createSubjectSelection, type KnownSubject, type SubjectSource } from "./info-panel/subject-selection";
import { updateMapPin, withMapPin } from "./map/map-pin-layer";
import { GEFAHR_KACHEL_URL, GEFAHR_QUELLE, withGefahren } from "./map/gefahr-schicht";
import { checksAllowedBySession, useMapChecks } from "./map/map-checks";
import { withMapChecks } from "./map/map-checks-layers";
import { installWetter, wetterIconName, wetterIconSchild } from "./map/wetter/wetter-schalter";
import { installWasser } from "./map/wasser/wasser-schalter";
import { areaPointerHint, type PointerHint } from "./map/pointer-hint";
import WaypointSnapLabel from "./map/waypoint-snap-label.vue";
import type { BorderStep } from "./route-planner/travel-cost-view";
import { createRouteBorderLabels, type RouteBorderLabels } from "./map/route-border-labels";
import { installClimateLabels, type AreaLabels, type ClimateLabels } from "./map/area-labels";
import { installAreaSelectionName, type AreaSelectionName } from "./map/area-selection-name";
import { installWaypointDrag, type SnapLabel } from "./map/waypoint-drag";
import { updateMeasure, withMeasure } from "./measure/measure-layers";
import { installMeasure } from "./measure/measure-input";
import { createMeasureMarker, type MeasureMarker } from "./measure/measure-marker";
import { isPending, measureMiles, withHandleAt, type Measurement } from "./measure/measure-state";
import { fetchNearestPlace } from "./route-planner/route-client";
import { formatNumber, isMessageKey, locale, t, tPlural } from "./i18n/i18n";
import { beobachteKarte, meldeEinmal, setzeAnsicht, starteBesuchsmeldung } from "./besuch/besuch-melden";
import { beobachteKartenfehler } from "./besuch/fehler-karte";

const space = AVENTURIA.coordinateSpace;
const domainBounds = renderBounds(space);
/** Der Kartenzaun: Aventurien in Renderkoordinaten. */
const AVENTURIA_FENCE = {
    west: domainBounds.southWest.lng,
    south: domainBounds.southWest.lat,
    east: domainBounds.northEast.lng,
    north: domainBounds.northEast.lat,
};
/** Die Karte reicht bis Stufe 8,5: Stufe 8 mit Spielraum für die Gelände-Nachrechnung (WI-0129; Überzoom über der z8-Kachel). */
const MAX_ZOOM = renderZoomForBand(MAX_VIEW_BAND);
/** Wie nah eine Fahrt ohne eigenen Deckel fliegt (Grenzübertritt, Route einpassen): Stufe 7, wie bisher. */
const FLY_MAX_ZOOM = renderZoomForBand(FLY_MAX_BAND);
/** MapLibres Vorgabe für den kleinsten Zoom; die Karte setzt keinen eigenen. */
const MAPLIBRE_MIN_ZOOM = -2;
// Both tile kinds are reached on our own origin under one prefix; who answers behind it is a
// deployment question, not the application's (ADR-0004).
// Die Kachelfunktion statt der Sicht (WI-0283): dieselbe Schicht `place_render`, aber sie filtert über den Index.
const tileUrl = `/tiles/vector/place_tile/{z}/{x}/{y}`;
// Gegenden, Wege und Wasser kommen aus Kachelfunktionen, die unter Stufe 8 vereinfachen; die Schichten heißen wie die Sichten (WI-0266, 0261).
const landscapeUrl = `/tiles/vector/region_area_tile/{z}/{x}/{y}`;
// Die Schriftlaeufe kommen aus einer Funktionsquelle, nicht aus einer Sicht: der Zuschnitt haengt
// am Zoom, und eine Sicht kennt kein z (ADR-0007).
const landscapeRunUrl = `/tiles/vector/landscape_label_run_tile/{z}/{x}/{y}`;
const mapLabelUrl = `/tiles/vector/map_label_render/{z}/{x}/{y}`;
// Die Klimabänder schreibt nur der Import (`migration/climate.ts`), ein Ereignis gibt es dafür nicht: Der feste Stand erlaubt Nginx die zehn
// Minuten im Browser (WI-0283 H3); nach einem Import sind sie spätestens dann frisch.
const climateUrl = mitStand(`/tiles/vector/climate_band_render/{z}/{x}/{y}`, "1");
const pathUrl = `/tiles/vector/path_tile/{z}/{x}/{y}`;
const pathLabelUrl = `/tiles/vector/path_label_run_tile/{z}/{x}/{y}`;
// Die Kraftlinien (WI-0025): Linien und Namen aus derselben Sicht, die Knoten aus ihrer eigenen (0040).
const powerlineUrl = `/tiles/vector/powerline_render/{z}/{x}/{y}`;
const leyNodeUrl = `/tiles/vector/ley_node_tile/{z}/{x}/{y}`;
/** Die Sprachen (WI-0261 S5a): Flächen und Mischgebiete; der Auftrag `sprache_treffer` meldet neue Mischgebiete (Art `sprache`). */
const sprachenUrl = `/tiles/vector/${SPRACHE_SOURCE_LAYER}/{z}/{x}/{y}`;
const sprachenMischUrl = `/tiles/vector/${SPRACHE_MISCH_SOURCE_LAYER}/{z}/{x}/{y}`;
/**
 * Orte, Wege und Wegnamen ändert der Ortseditor, Flächen, Schriftläufe, Namen und Wasser der Landschaftseditor samt seinen Aufträgen:
 * Ihre Kacheln tragen nach einer Operation die Revision `?r=` (WI-0128 E13, WI-0178 B3), Auswahl und Umrisse ebenso.
 */
/** Seen und Meere aus der geglätteten Quelle: Eine Landschaft, die zu oder von See und Meer wechselt, ändert sie (EDIT-0003 T50). */
const waterUrl = `/tiles/vector/terrain_water_tile/{z}/{x}/{y}`;
/** Gipfel und Vulkane (WI-0055); der Derographie-Editor ändert sie (WI-0178 P2). */
const peakUrl = `/tiles/vector/terrain_peak_render/{z}/{x}/{y}`;
const editRevision = createEditRevision({
    [PLACE_SOURCE_ID]: tileUrl,
    [PATH_SOURCE_ID]: pathUrl,
    [PATH_LABEL_SOURCE_ID]: pathLabelUrl,
    [LANDSCAPE_SOURCE_ID]: landscapeUrl,
    [LANDSCAPE_RUN_SOURCE_ID]: landscapeRunUrl,
    [MAP_LABEL_SOURCE_ID]: mapLabelUrl,
    // Die Kraftlinien (WI-0205 K5): Bahn und Knoten nach einer Operation neu; die Bögen laden ihr Netz neu (`hoere` unten).
    [POWERLINE_SOURCE_ID]: powerlineUrl,
    [LEY_NODE_SOURCE_ID]: leyNodeUrl,
    [WATER_SOURCE_ID]: waterUrl,
    [PEAK_SOURCE_ID]: peakUrl,
    [SPRACHE_SOURCE_ID]: sprachenUrl,
    [SPRACHE_MISCH_SOURCE_ID]: sprachenMischUrl,
    // Die gefährlichen Gebiete (WI-0308): ihre Schraffur folgt jeder Änderung der Gefahrenlage.
    [GEFAHR_QUELLE]: GEFAHR_KACHEL_URL,
});
/** Was eine Wegänderung neu lädt (WI-0177, Thomas 2.3): Wege und Wegnamen, keine Orte. */
const WEGE_QUELLEN = [PATH_SOURCE_ID, PATH_LABEL_SOURCE_ID];
/**
 * Was eine Operation der Derographie neu lädt (Editor-Orchestrierung 2026-10-19, wie die Wege): Flächen, Schriftläufe, Kartennamen,
 * Gewässer und Gipfel. Die Kachelsichten von Orten, Wegen, Wegnamen und Kraftlinien lesen keine Landschaft (am Schema geprüft); nach
 * jedem „Fertig“ lud die Karte sonst auch sie neu, bei kleinem Zoom Dutzende Kacheln.
 */
const DEROGRAPHIE_QUELLEN = [
    LANDSCAPE_SOURCE_ID,
    LANDSCAPE_RUN_SOURCE_ID,
    MAP_LABEL_SOURCE_ID,
    WATER_SOURCE_ID,
    PEAK_SOURCE_ID,
    GEFAHR_QUELLE,
];
/** Welche Quellen ein fremdes Ereignis nach den Arten in `affected` neu lädt (`quellenFuer`); eine Art ohne Eintrag lädt alle. */
const QUELLEN_NACH_ART = {
    path: WEGE_QUELLEN,
    region: DEROGRAPHIE_QUELLEN,
    // Die Folgeaufträge einer Landschaft (`label_runs`) melden diese Art; ohne Eintrag luden sie nach jedem „Fertig“ alle Quellen (WI-0283 H3).
    landscape: DEROGRAPHIE_QUELLEN,
    area: DEROGRAPHIE_QUELLEN,
    label: DEROGRAPHIE_QUELLEN,
    peak: DEROGRAPHIE_QUELLEN,
    // Der Auftrag `sprache_treffer` nach neuen Mischgebieten (WI-0261 S5a) und der Spracheditor (S5d): nur die Kacheln der Sprachen.
    ...SPRACHEN_QUELLEN_NACH_ART,
};
/** Fremde Ereignisse `map.changed` höchstens alle 3 s, die letzte gewinnt (Hauptorchestrierung 2026-10-19); die eigene Quittung sofort. */
const fremdeRevision = createRevisionsDrossel({
    abstandMs: 3000,
    anwenden: (revision, nur) => editRevision.advance(map, revision, nur),
});
useAreaRevision(() => editRevision.current);
editRevision.hoere((revision) => powerlineArcs?.neuLaden(revision), [POWERLINE_SOURCE_ID, LEY_NODE_SOURCE_ID]);
// Die Verborgenen (T41) mit jeder neuen Kachelrevision der Landschaften neu.
editRevision.hoere(() => void ladeVerborgene(), [LANDSCAPE_SOURCE_ID]);
/** Die Topographie (WI-0055): Höhenlinien aus Martin, die Gipfel oben (`peakUrl`). */
const contourUrl = `/tiles/vector/terrain_contour_tile/{z}/{x}/{y}`;
const contourDetailUrl = `/tiles/vector/terrain_contour_detail_tile/{z}/{x}/{y}`;
const heightBandUrl = `/tiles/vector/terrain_height_band_tile/{z}/{x}/{y}`;

// 🔴 `old` traegt seine Ortsnamen IM RASTER. Unter unseren Vektorlabels stuende jeder Name
// doppelt - deshalb ist die Serie eine Arbeitshilfe fuer Editoren und darf im fertigen Produkt
// NIE erscheinen, genau wie in der Legacy-Anwendung.
//
// M9 (Hardening Review 2026-09-28): `bootstrapViewer()` ist die einzige Stelle, die das URL-Flag der
// Besucher-Vorschau liest (vorher stand das hier). Der ViewerContext geht per provide/inject an
// Nachfahren; Aufrufer, die keine Vue-Komponenten sind (etwa `buildPlaceStyle`), bekommen weiter
// einen Wert, den `app.vue` selbst aus `viewer.can(...)` berechnet.
const viewer = bootstrapViewer();
// Die Kopfleiste steht, sobald die Anmeldung eingerichtet ist (Sitzung vor dem Start gelesen, `main.ts`).
// Der Editor-Balken nur im Editor-Modus (`/edit`, `?editor=true`, Legacys `?edit=1`; Betreiber 2026-10-09): Die Karte ohne ihn ist
// die öffentliche Karte, auch für angemeldete Personen. Einstiegslinks (`/anmelden`, `/einladung#…`) führen nach `/edit`.
// Auch ohne Antwort des Servers, damit „Anmelden“ dasteht (WI-0203); nur ohne eingerichtete Anmeldung (lokal) fehlt sie.
const withHeader = signInExpected(authState.value) && isEditorAddress(globalThis.location);
provide(VIEWER_CONTEXT_KEY, viewer);
/**
 * Escape arbeitet von innen nach außen (WI-0063 4.10): EINE geordnete Kaskade für Menüs, Infopanel und Auswahl
 * (`keyboard/escape-cascade.ts`). Die Menüs melden sich selbst an (`inject`), die Stufen für Panel und Auswahl weiter unten.
 */
const escapeCascade = createEscapeCascade();
provide(ESCAPE_CASCADE_KEY, escapeCascade);
// Die Serien kommen zur Laufzeit aus der Systemsteuerung (WI-0220, `map/kartenserien-stand.ts`), gelesen vor dem Start.
const seriesOptions = computed(() => getVisibleMapSeries(viewer, kartenserienKatalog()));
const seriesIds = seriesOptions.value.map((option) => option.id);
/**
 * Die Serien, die dieser Betrachter nur unter „Nur Karte“ sieht (Beschriftung im Bild, Betreiber 2026-11-10: „unter dem Reiter "Nur
 * Karte" die Karte "Old" auch für Frontendnutzer freischalten“). Editoren haben keine.
 */
const nurKarteSerien = computed(
    () => new Set(seriesOptions.value.filter((s) => nurUnterNurKarte(viewer, s)).map((s) => s.id)),
);
/** Was der Fächer anbietet: dieselben Serien, die nur unter „Nur Karte“ markiert. */
const fanSerien = computed(() =>
    seriesOptions.value.map((s) => (nurKarteSerien.value.has(s.id) ? { ...s, nurKarte: true } : s)),
);

// Ein geteilter Link bestimmt den ersten Blick; ohne ihn startet die Karte, wo die Karteneinstellungen es sagen (WI-0166:
// über dem Namen „Aventurien“ auf Zoom 2,5, vorher Gareth auf Zoom 5). Gelesen hat sie `main.ts` vor dem Start.
const START_VIEW = startansicht();
// Die Zoomkurve aus den Standardwerten: wie steil die Kamera beim Zoomen mitkippt (`camera/camera-math.ts`, `setZoomKurve`).
setZoomKurve(START_VIEW.zoomKurve);
const DEFAULT_VIEW: ViewState = {
    center: START_VIEW.startPosition,
    zoom: START_VIEW.startZoom,
    series: kartenserienKatalog().defaultSeries,
    view: DEFAULT_MAP_VIEW,
    landscape: DEFAULT_LANDSCAPE_SELECTION,
};
const addressSearch = globalThis.location?.search ?? "";
const addressHash = globalThis.location?.hash ?? "";
const linkedView = parseViewState(addressHash, seriesIds, DEFAULT_VIEW.series);
// 🔴 Legacys Parameter für Ansicht und Untergrund (`mapLayerMode`, `mapstyle`, `toggleBorders`) öffnen dieselbe Ansicht
// wie in Legacy, wo unsere Adresse nichts sagt (WI-0072).
const initialView = openingView(linkedView, DEFAULT_VIEW, addressSearch, addressHash, seriesIds, [
    ...nurKarteSerien.value,
]);
/**
 * Darf dieser Betrachter die Editorwerkzeuge sehen und schalten (Strömungsrichtungen, Kachelraster)? Dieselbe Frage
 * wie im Auge-Menü; für Besucher gelten diese Schalter in einer Adresse nicht (Betreiber 2026-09-28).
 */
const viewerIsEditor = viewer.can("view_flow_directions");
/**
 * Die Medienverwaltung (WI-0068 P3): nur im Editor-Modus mit `view_media_private` (ab Reviewer). Ein tiefer Link `?medien=<asset>`
 * öffnet sie beim Laden; danach hält `medien-oeffnen.ts` die Adresse nach. Was jemand darf, prüft der Server an jeder Route.
 */
const medienErlaubt = viewer.can("view_media_private");
const stopMedienAdresse = installiereMedienAdresse(medienErlaubt);
// Die Schalter des Auge-Menüs aus der Adresse (WI-0072): der Hash zuerst, Legacys Query (`?togglePaths=0`) als Rückfall.
const linkedDisplay = readAddressDisplay(addressSearch, addressHash);
// Danach gehören sie dem Hash (`formatViewState`). In der Query stehen zu lassen hieße, dass ein zurückgelegter Schalter
// beim Neuladen wieder gälte.
{
    const rest = queryWithoutDisplayParams(addressSearch, LEGACY_VIEW_PARAMS);
    if (rest !== addressSearch && globalThis.history?.replaceState) {
        globalThis.history.replaceState(null, "", `${globalThis.location.pathname}${rest}${addressHash}`);
    }
}

const seriesId = ref(initialView.series);

/**
 * Welche Revision der Grundkarte gilt, sagt `current.json` der Serie (ADR-0008).
 *
 * 🪤 Scheitert das Lesen, zeichnet die Karte OHNE Gelände weiter und sagt es in der Konsole: Orte
 * und Wege bleiben benutzbar, und eine Karte ohne Grund ist als Fehler sichtbar.
 */
const readBasemap = async (id: string): Promise<RasterPyramidPointer | undefined> => {
    try {
        return await loadRasterPointer(id);
    } catch (error) {
        console.error(`Grundkarte ${id}: Zeiger nicht lesbar`, error instanceof Error ? error.message : error);
        return undefined;
    }
};
// ⭐ Schon beim Aufsetzen losschicken, nicht erst beim Einhängen: die Anfrage läuft, während Vue die
// Seite aufbaut, und die Karte wartet höchstens auf den Rest davon.
const initialBasemap = readBasemap(initialView.series);
let basemap: RasterPyramidPointer | undefined;
/**
 * Das Gelände der geneigten Karte (WI-0049). Es gilt für jede Serie, deshalb nur einmal gelesen.
 *
 * 🪤 Scheitert das Lesen, bleibt die Karte flach und sagt es in der Konsole, wie bei der Grundkarte.
 * Ohne Grafikkarte wird gar nicht erst gelesen: Dann bleibt sie flach, auch geneigt (Betreiber
 * 2026-09-27, „3: A“).
 */
const softwareRendering = detectSoftwareRendering();
if (softwareRendering) {
    console.warn(`Gelände aus: keine Grafikkarte (${softwareRendering})`);
}
// `?gelaende=aus` nur im Entwicklungsbuild (`map/flug-probe.ts`): derselbe Zustand wie der Inhaltsschalter `map.terrain3d`.
const initialTerrain =
    softwareRendering || gelaendeAus()
        ? Promise.resolve(undefined)
        : loadTerrainPointer().then(
              (pointer) => {
                  // Kein Gelände ist ein Zustand, kein Fehler (Stage und Production ohne /tiles/terrain/dem/): nur ein
                  // Hinweis, kein Rot für jeden Besucher (Koordination 2026-09-27).
                  // eslint-disable-next-line no-console -- bewusst info, siehe oben
                  if (!pointer) console.info("Gelände aus: kein Zeiger");
                  return pointer;
              },
              (error: unknown) => {
                  console.error("Gelände: Zeiger nicht lesbar", error instanceof Error ? error.message : error);
                  return undefined;
              },
          );
let terrain: TerrainDemPointer | undefined;
/**
 * Der Zeiger der Anzeigehöhen (WI-0055): Gibt es Höhenlinien und Höhenstufen? Anders als Gelände und Relief
 * auch ohne Grafikkarte: Es sind flache Linien und Flächen. Fehlt er, zeigt die Topographie keine Höhenstufen.
 */
const initialDisplayHeight = loadDisplayHeightPointer().then(
    (pointer) => {
        // eslint-disable-next-line no-console -- bewusst info wie beim Relief: keine Höhenstufen sind ein Zustand
        if (!pointer) console.info("Höhenstufen aus: kein Zeiger");
        return pointer;
    },
    (error: unknown) => {
        console.error("Höhenstufen: Zeiger nicht lesbar", error instanceof Error ? error.message : error);
        return undefined;
    },
);
let displayHeight: DisplayHeightPointer | undefined;
/** Der Zeiger der Anzeigehöhen, wie der Server ihn nennt, vor dem Abgleich mit dem Gelände (WI-0125: für neue Kacheln im Betrieb). */
let rawDisplayHeight: DisplayHeightPointer | undefined;
/** Höhenlinien und Höhenstufen tragen die Revision ihres Zeigers (WI-0283 H3): Ein neuer Stand ist eine neue Adresse. */
const mitAnzeigehoehe = (url: string): string =>
    displayHeight === undefined ? url : mitStand(url, displayHeight.revision);
/** Die Kachelrevisionen, bevor der erste Stil entsteht (WI-0283 H3); ohne Antwort startet die Karte ohne Revision. */
const initialKachelStand = ladeKachelStand();
/**
 * Der Zeiger der Herrschaftsgebiete (WI-0062, ADR-0014): Gibt es abgeleitete Flächen und Grenzen, und welche Revision gilt?
 * Anders als Gelände und Relief auch ohne Grafikkarte: Es sind flache Flächen und Linien. Fehlt er (nichts abgeleitet, oder
 * ein Import hat die Ableitung entwertet), zeigt die Karte keine Gebiete und der Fächer lässt „Politisch“ ausgegraut -
 * keine alten Gebiete, sondern keine.
 */
const initialTerritories = loadTerritoryPointer().then(
    (pointer) => {
        // eslint-disable-next-line no-console -- bewusst info wie bei den Höhenstufen: keine Gebiete sind ein Zustand
        if (!pointer) console.info("Politisch aus: kein Zeiger");
        return pointer;
    },
    (error: unknown) => {
        console.error("Politisch: Zeiger nicht lesbar", error instanceof Error ? error.message : error);
        return undefined;
    },
);
let territories: TerritoryPointer | undefined;
/**
 * Welche Gebiete ein öffentliches Wappen tragen (WI-0121): Kennung des Gebiets → Bildname. Gelesen zugleich mit dem Zeiger und
 * vor dem Aufbau des Stils, damit die Namen nicht springen, wenn das Wappen nachkäme. Scheitert das Lesen, baut die Karte
 * ohne Wappen - die Namen stehen dann allein, wie sie standen.
 */
const initialTerritoryCoats = loadTerritoryCoats().then(
    (coats) => coats,
    (error: unknown) => {
        console.error("Wappen der Gebiete: Liste nicht lesbar", error instanceof Error ? error.message : error);
        return {} as Record<string, string>;
    },
);
let territoryCoats: Record<string, string> = {};
/** Sind Gebietskacheln da? Ohne sie bleibt die Ansicht „Politisch“ im Fächer gesperrt. */
const territoriesReady = ref(false);
let removeTerrain: (() => void) | undefined;
let removeKartenStoerung: (() => void) | undefined;
let removeKachelWiederholung: (() => void) | undefined;
let stopTerrainLive: (() => void) | undefined;
let unmounted = false;
/**
 * Der Koordinator der Karteninteraktion (M8): hört einmal je Zeigerereignis und gibt es an den Besitzer mit dem
 * höchsten Rang (`map/interaction/`). Er gehört dieser Karte und stirbt mit ihr.
 */
let interaction: MapInteractionCoordinator | undefined;
let removePointerControls: (() => void) | undefined;
let removeAtmosphere: (() => void) | undefined;
let stopFlugMelder: (() => void) | undefined;
let removeTerritoryBand: (() => void) | undefined;
let removeStyleImageResolvers: (() => void) | undefined;
let removeInteractionOwners: (() => void) | undefined;
let removeAreaSelection: (() => void) | undefined;
let gradnetzRahmen: GradnetzRahmen | undefined;
let hexrasterLinien: Hexraster | undefined;
let removeDoppelklick: (() => void) | undefined;
let removePathSelection: (() => void) | undefined;
let removePowerlineSelection: (() => void) | undefined;
let stopAreaChoicesWatch: (() => void) | undefined;
let stopPowerlineChoicesWatch: (() => void) | undefined;
let stopPowerlineHighlightWatch: (() => void) | undefined;
let removeWaypointDrag: (() => void) | undefined;
let removeMeasure: (() => void) | undefined;
/** Die Wertkapsel der Entfernungsmessung, ein MapLibre-Marker in der Mitte der Strecke (WI-0095). */
let measureMarker: MeasureMarker | undefined;
/** Schraffur und Schild der Sperren anderer (WI-0178 S3); nur im Editor-Modus. */
let sperreSchicht: SperreSchicht | undefined;
/** Die für Besucher verborgenen Landschaften, schraffiert mit Auge (WI-0178 T41): nur für Editoren, aus der Zusatzschicht der App. */
let verborgeneFlaechen: VerborgeneFlaechen | undefined;
let verborgeneZeilen: readonly EditorHiddenLandscape[] = [];
/** Die Verborgenen zeigen; mit „Auswahl isolieren“ nur die bearbeitete (WI-0178). */
function zeigeVerborgene(): void {
    verborgeneFlaechen?.zeige(nurIsolierte(verborgeneZeilen, isolieren.flaeche.value, (zeile) => zeile.id));
}
async function ladeVerborgene(): Promise<void> {
    if (verborgeneFlaechen === undefined) return;
    try {
        const antwort = await fetch(EDITOR_LANDSCAPES_HIDDEN_URL, {
            cache: "no-store",
            headers: { accept: "application/json" },
        });
        if (!antwort.ok) return;
        const rows = ((await antwort.json()) as { rows?: unknown }).rows;
        verborgeneZeilen = Array.isArray(rows) ? (rows as EditorHiddenLandscape[]) : [];
        zeigeVerborgene();
    } catch {
        // Ohne Antwort bleibt die Schicht, wie sie war.
    }
}
let powerlineArcs: PowerlineArcsController | undefined;
let routePills: RoutePillsController | undefined;
let borderLabels: RouteBorderLabels | undefined;
/** Die Flugbahn im Raum, nur geneigt (WI-0051 F3). */
let flightArcs: FlightArcsController | undefined;
/** Der Pfeil des Playmodes, eine eigene Ebene im selben Bild wie die Kamera (WI-0031). */
let travelerLayer: TravelerLayerController | undefined;
/** Die Namen der Klimazonen, mittig im sichtbaren Teil ihres Bandes (WI-0012, Nachtrag 2026-10-05). */
let climateLabels: ClimateLabels | undefined;
/** Die Namen der Sprachen, wie die der Klimazonen (WI-0261 E5). */
let sprachLabels: AreaLabels | undefined;
/** Die Namen der gewählten Vorkommen in ihrer Farbe, wie die der Sprachen (WI-0257 S5). */
let vorkommenNamen: AreaLabels | undefined;
/** Ob die gewählte Fläche einen eigenen, versetzten Namen braucht - oder ihr gewöhnlicher im Bild steht (WI-0093). */
let areaSelectionName: AreaSelectionName | undefined;
/**
 * Zeichnen die Bögen die Kraftlinien (WI-0025 Stufe 2)? Dann verlässt der Stil die flachen Leuchtlagen;
 * bis dahin, und wenn die Bögen scheitern, bleiben sie als Rückfall stehen.
 */
const powerlineArcsReady = ref(false);
/**
 * Die eine Kamera-Schnittstelle (WI-0016, WI-0039): Steuerring, 3D-Knopf, Tastatur, Suche, Planer und
 * Playmode. Sie zielt in die sichtbare Kartenfläche, die `visibleArea` misst.
 */
const camera = shallowRef<Camera | undefined>(undefined);
let visibleArea: VisibleArea | undefined;
const search = useTemplateRef<InstanceType<typeof SpotlightSearch>>("search");
/** Das Fenster „Hinweise“ (WI-0045): offen oder zu, und ob es bei der Bedienung aufgeht („?“). */
const notesOpen = ref(false);
/** Was erst beim ersten Öffnen lädt und dann eingehängt bleibt (WI-0235, `nachladen.ts`). */
const notesEingehaengt = einmalOffen(() => notesOpen.value);
const communityBesucherEingehaengt = einmalOffen(() => communityBesucher.anzeige.value);
const reisebildBesucherEingehaengt = einmalOffen(() => reisebildBesucher.anzeige.value);
/** „Karte vorschlagen“ und seine Statusseite (WI-0275 Stufe C): ein modales Fenster, das erst beim ersten Öffnen lädt. */
const kartenvorschlagAnzeige = kartenvorschlagBesucher.anzeige;
const kartenvorschlagEingehaengt = einmalOffen(() => kartenvorschlagAnzeige.value);
const screenshotEingehaengt = ref(false);
/** Das Fenster „Neuigkeiten“ (WI-0139); es lädt erst beim Öffnen. */
const newsOpen = ref(false);
const notesSection = ref<HinweiseZiel | null>(null);
function openNotes(section: HinweiseZiel | null): void {
    notesSection.value = section;
    notesOpen.value = true;
}
// Ein Link auf eine Stelle der Hinweise (`?hinweis=`): Das Fenster geht dort auf. Der Hash gehört der Kamera und bleibt unberührt.
const hinweisAusLink = hinweisAusSuche(globalThis.location?.search ?? "");
if (hinweisAusLink !== null) openNotes(hinweisAusLink);
/**
 * Die Katalogfenster „Kartensammlung von …“ und „Literatur zu …“ (WI-0118): ein Fenster je Abschnitt, geöffnet über die Kacheln unter den
 * Streifen und über einen Klick auf eine Kachel des Streifens. `catalogTarget` sagt, für wen sie aufgehen und - bei einem Klick auf eine
 * Kachel - welcher Eintrag vergrößert dasteht. Es ist EIN Ziel für beide: Es kann immer nur eines offen sein (beide sind modal).
 */
const citymapsOpen = ref(false);
const literatureOpen = ref(false);
const citymapsEingehaengt = einmalOffen(() => citymapsOpen.value);
const literatureEingehaengt = einmalOffen(() => literatureOpen.value);
const catalogTarget = ref<CatalogTarget | undefined>(undefined);
// Die Tastatur wirkt ab dem Laden, auch bevor die Karte steht: F öffnet die Suche sofort.
const removeKeyboard = installKeyboard({
    viewer,
    camera: () => camera.value,
    openSearch: () => void search.value?.show(),
    // Leertaste im Editor: die Auswahl lokal fixieren oder lösen (WI-0063 4.11); Besucher haben dafür die Suche.
    pinSelection: () => void subjects.togglePin(),
    openHelp: () => openNotes("bedienung"),
    choosePlaces: (tier) => {
        // Gesperrt heißt auch für die Taste gesperrt (Legacy: dort sind die Knöpfe `disabled`).
        if (!lockedSwitches(mapView.value).has("places")) {
            displayChoices.choose({ ...display.value, placeLevel: cascade(display.value.placeLevel, tier) });
        }
    },
    planner: {
        addDestination: () => void plannerPanel.value?.addDestination(),
        optimize: (kind) => plannerPanel.value?.setOptimize(kind),
        stepStage: (step) => planner.stepStage(step),
    },
    escape: () => void escapeCascade.run(),
});

/** Was der Kartenfächer einstellt (WI-0009, seit WI-0024 1:1 wie Legacy): Ansicht und Landschaftsebene. */
const mapView = ref<MapView>(initialView.view);
// Eine Serie mit Beschriftung im Bild sehen Besucher nur unter „Nur Karte“ (`nurKarteSerien`): Wer die Ansicht wechselt oder einen
// Kurzlink mit einer anderen Ansicht öffnet, bekommt die Vorgabe. Sonst stünde jeder Name doppelt.
watch([mapView, seriesId], ([ansicht, serie]) => {
    if (ansicht !== ANSICHT_FUER_BILDNAMEN && nurKarteSerien.value.has(serie)) seriesId.value = DEFAULT_VIEW.series;
});
/** Wo der einmalige Kamera-Hinweis steht; `null`: Er passt gerade nirgends ganz in die freie Fläche und wartet. */
const kameraHinweisPlatz = shallowRef<HinweisPlatz | null>(null);
/**
 * Wo die Hinweise zur Bitte um Freigabe stehen (WI-0262): ohne Platz unten in der Mitte wie der Toast (Vali 2026-10-30); am Telefon oben
 * unter der Kopfleiste der Karte, weil unten die Knöpfe des Fensters liegen.
 */
const freigabeHinweisPlatz = shallowRef<HinweisPlatz | null>(null);
/**
 * Ein Link auf „Politisch“, solange die Gebiete fehlen (Fund des Betreibers 2026-10-19: abgemeldet beantwortet die Stage-Tür auch den
 * Gebietszeiger): Die Karte zeigt die Standardansicht, die Adresse behält die verlinkte, damit Anmeldung und Discord-Umweg sie
 * zurückbringen. Kommen die Gebiete, gilt sie; schaltet jemand selbst um, seine Wahl.
 */
let politischVerlinkt = false;
watch(mapView, (neu) => {
    if (neu !== DEFAULT_MAP_VIEW) politischVerlinkt = false;
});
const landscapeSelection = ref<LandscapeSelection>(initialView.landscape);
// Die Verborgenen (T41) folgen den Ebenen der Karte.
watch([mapView, landscapeSelection], () => void nextTick(zeigeVerborgene));
/** Die Unterwahl der Topographie (WI-0055): Höhenlinien oder Höhenstufen, gemerkt wie die Ebene. */
const topographyVariant = ref<TopographyVariant>(initialView.topography ?? DEFAULT_TOPOGRAPHY_VARIANT);
/** Sind Höhenkacheln da? Ohne sie gibt es keine Höhenstufen und keine Legende. */
const displayHeightReady = ref(false);
/**
 * Die Legende der Höhenstufen steht nur, wo die Höhenstufen auch gezeichnet werden, und nicht am Telefon
 * (Betreiber 2026-09-28: „auf dem handy nimmt die legende zuviel platz ein und zahlen werden sowieso gezeigt“).
 */
const heightLegend = computed(
    () =>
        displayHeightReady.value &&
        !phoneViewport.value &&
        composeView(mapView.value, landscapeSelection.value, topographyVariant.value).heightTints,
);
/** Die Klimazone aus der Suche. Sie steht kräftiger, bis man in die Karte klickt (2026-09-23). */
const highlightedClimateZone = ref<string | undefined>(undefined);
/**
 * Die gewählte Fläche (WI-0043): aus der Suche, aus dem Planer oder per Klick auf die Karte. Sie leuchtet in
 * jeder Ansicht, bis eine andere gewählt oder in die freie Karte geklickt wird.
 */
const areaSelection = ref<AreaSelection | undefined>(undefined);
/**
 * Der Tropfen einer freien Kartenstelle „Was ist hier?“ (WI-0063 4.9): nur, solange sie der gewählte Subject ist.
 */
const mapPin = shallowRef<MapPoint | undefined>(undefined);
/**
 * Das EINE Zeiger-Schild für jede Art des Zeigens (WI-0063 4.5, Guide §15.3): Name und Art, passiv. Beim Zeigen auf eine
 * Fläche zugleich die Antwort auf „welche Fläche ein Klick wählen würde“ (WI-0043 Stufe 2, „A“).
 */
const pointerHint = shallowRef<PointerHint | undefined>(undefined);
/** Nach dem Klick, wo mehrere Flächen liegen: die Liste (Stufe 2, „C“). */
const areaChoices = ref<AreaChoices | undefined>(undefined);
/**
 * Die gewählte Kraftlinie, mit ihrem Namen: Sie leuchtet in der Kraftlinien-Ansicht heller (WI-0063 P8). Eine Kraftlinie ist die Gruppe
 * ihrer Segmente, die Karte kennt sie am Namen.
 */
const selectedPowerline = ref<string | undefined>(undefined);
/** Nach dem Klick, wo mehrere Kraftlinien liegen: dieselbe Liste wie bei den Flächen. */
const powerlineChoices = ref<PowerlineChoices | undefined>(undefined);

/**
 * Ein Eintrag der Liste wählt seine Fläche; ihr Name steht, wo ihre Beschriftung steht. 🔴 Ohne Klickpunkt, also ohne Menü am Objekt
 * (EDIT-0003 T25, WI-0178 A4): Die Handgriffe einer Fläche stehen für Editoren im Untermenü ihres Eintrags; eine zweite Karte an
 * anderer Stelle gibt es nicht.
 */
function chooseArea(id: string): void {
    const candidate = areaChoices.value?.candidates.find((entry) => entry.id === id);
    if (!map || !areaChoices.value || !candidate) return;
    openArea(selectionOf(map, candidate, areaChoices.value.point), "map");
}

/**
 * Eine Fläche, ein Weg oder ein Gebiet wird der gewählte Subject (WI-0063 P5): über dieselbe Naht wie jeder Klick. Die
 * Fläche leuchtet sofort, wie vorher; was das Panel zeigt, kommt mit der Antwort. Ein Weg ohne Kettenschlüssel hat keinen
 * Subject und bleibt eine bloße Markierung.
 */
function openArea(area: AreaSelection, source: SubjectSource = "map", anchor?: { x: number; y: number }): void {
    const ref = subjectRefOfArea(area);
    if (ref === undefined) {
        areaSelection.value = area;
        return;
    }
    // 🪤 Der vorläufige Titel ist der Name der KACHEL, und bei einem Weg steht dort der rohe Griff („Pfad-3443“).
    // Er wird deshalb hier gelesen wie eine Fläche (die kommt bereits als `null`, `landscapeReaderName` sitzt in
    // `area-selection.ts`): ohne Namen kein Titel, und das Panel setzt „Unbezeichneter Pfad“ ein (WI-0105).
    const knownTitle = area.kind === "path" ? pathReaderName(area.name ?? "", area.type) : area.name;
    subjects.openSubject(ref, {
        source,
        camera: "none",
        known: { ...(knownTitle === null ? {} : { title: knownTitle }), presentation: { area } },
        ...(anchor === undefined ? {} : { anchor }),
    });
}

/**
 * Eine Kraftlinie wird der gewählte Subject (WI-0063 P8): über dieselbe Naht wie jeder Klick, mit dem Segment als Anker (der Server
 * löst zur Gruppe auf). Sie leuchtet sofort; was das Panel zeigt, kommt mit der Antwort. Die Kamera bleibt, wie bei jedem Klick.
 */
function openPowerline(
    line: PowerlineCandidate,
    source: SubjectSource = "map",
    anchor?: { x: number; y: number },
): void {
    subjects.openSubject(
        { kind: "powerline", anchor: line.id },
        {
            source,
            camera: "none",
            known: {
                ...(line.name === "" ? {} : { title: line.name }),
                // Eine namenlose Linie ist nur sie selbst: Die Karte kennt eine Gruppe am Namen und hätte keine zu leuchten.
                presentation: line.name === "" ? {} : { powerline: { name: line.name } },
            },
            ...(anchor === undefined ? {} : { anchor }),
        },
    );
}

/** Ein Eintrag der Liste wählt seine Kraftlinie; die Liste ist dem Klick verbunden, der sie öffnete (dort hängt das Editor-Menü). */
function choosePowerline(id: string): void {
    const choices = powerlineChoices.value;
    const line = choices?.candidates.find((entry) => entry.id === id);
    if (choices && line) openPowerline(line, "map", choices.screen);
}

/** Zeigen oder Fokus auf einem Eintrag umreißt seine Fläche oder seinen Fluss auf der Karte. */
function previewArea(id: string | undefined): void {
    if (!map) return;
    outlineArea(map, id === undefined ? undefined : areaChoices.value?.candidates.find((entry) => entry.id === id));
}

function closeAreaChoices(): void {
    areaChoices.value = undefined;
    previewArea(undefined);
}
/** Die Auswahllisten, schon in der Sprache der Seite (`controls/choice-list.ts`): die Flächen am Klick und die Treffer eines Links. */
/** Eine Fläche aus Kachel oder Liste als Gegenstand der Handgriffe: eine Landschaft (WI-0178 A4) oder ein Herrschaftsgebiet (WI-0209 A4). */
function flaechenSubjekt(kandidat: AreaCandidate): EditorMenuSubject {
    const titel = kandidat.name ?? unnamedCandidateLabel(kandidat);
    const subjekt = kandidat.kind === "territory" ? gebietSubjekt : flaecheSubjekt;
    // Heißt die Fläche nur nach ihrer Art („Wald“, OPS-073), steht die Art nicht noch einmal als Untertitel des Menüs.
    return subjekt(kandidat, titel, artNebenName(titel, candidateTypeLabel(kandidat)) || undefined);
}
/**
 * Die Liste „Hier liegen N Flächen“ beim Linksklick: für Editoren dieselbe wie im Frontend, ein Eintrag wählt seine Fläche, ohne Untermenü
 * (WI-0178, Betreiber 2026-10-21, wörtlich: „Das Hier liegen 3 Flächen soll aber bleiben und bei der auswahl die fläche halt auswählen“,
 * „aber keine untermenüs mehr haben“). Das Editor-Menü gibt es beim Rechtsklick.
 */
const areaChoiceMenu = computed(() => (areaChoices.value ? areaChoiceList(areaChoices.value) : undefined));
const powerlineChoiceMenu = computed(() =>
    powerlineChoices.value ? powerlineChoiceList(powerlineChoices.value) : undefined,
);
const linkChoiceMenu = computed(() => {
    const choices = objectLink.choices.value;
    return choices === undefined ? undefined : linkChoiceList(choices.entries, freeMapCentre());
});

/** Die Mitte der freien Kartenfläche in Fensterkoordinaten: dort geht eine Liste auf, die keinen Zeiger hat (ein Link). */
function freeMapCentre(): { x: number; y: number } {
    const canvas = map?.getCanvas();
    if (!map || !canvas) return { x: globalThis.innerWidth / 2, y: globalThis.innerHeight / 3 };
    const box = canvas.getBoundingClientRect();
    const centre = visibleArea?.centre() ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    return { x: box.left + centre.x, y: box.top + centre.y };
}

/** Ein Treffer der Link-Liste öffnet seinen Gegenstand. */
function chooseLink(id: string): void {
    const entry = objectLink.choices.value?.entries.find((candidate) => subjectKey(candidate.ref) === id);
    if (entry) objectLink.choose(entry.ref);
}

/** Die Auswahl samt Namen in der Sprache der Seite: Eine namenlose Fläche heißt nach ihrer Art. */
const drawnArea = computed((): DrawnArea | undefined => {
    const area = areaSelection.value;
    if (!area || (area.kind === "landscape" && !display.value.layers)) return undefined;
    return { ...area, label: areaLabel(area, landscapeTypeLabel) };
});

/**
 * Die Schalter des Auge-Menüs (WI-0028). 🔴 DIE ANSICHT GEWINNT (Legacy, Owner 12.08.2026): jeder
 * Wechsel setzt sie auf die Vorgaben der neuen Ansicht zurück. Nur was jemand in den Landschaften
 * einstellt, gilt für den Besuch (Legacy, Owner 09.09.2026) - im Speicher, nicht in der Adresse. Die
 * Klimazonen haben eine eigene Vorgabe; was der Mensch selbst umgelegt hat, bleibt (`display-choices.ts`).
 * Am Anfang die Vorgaben, darüber das, was die geöffnete Adresse sagt (WI-0072).
 */
const displayChoices = useDisplayChoices({
    view: mapView,
    layer: landscapeSelection,
    editor: viewerIsEditor,
    linked: linkedDisplay,
});
const display = displayChoices.display;
const tileGrid = displayChoices.tileGrid;
/** Das Gradnetz (WI-0273): Linien im Stil, Rahmen und Grade auf eigener Leinwand (`map/gradnetz-rahmen.ts`). */
const gradnetz = displayChoices.gradnetz;
watch([gradnetz, locale], () => gradnetzRahmen?.zeichne());
/** Das Hexraster (WI-0273): schließt das Gradnetz aus; die Feldgröße stellt der Regler im Auge (`map/hexraster.ts`). */
const hexraster = displayChoices.hexraster;
/** Der Screenshot der Karte (WI-0274): Sein Raster sind die Schalter Hexraster und Gradnetz, nur für die Aufnahme umgestellt. */
const kartenScreenshot = useTemplateRef<InstanceType<typeof KartenScreenshot>>("kartenScreenshot");
const screenshotRaster = {
    lies: (): ScreenshotRaster => (hexraster.value ? "hex" : gradnetz.value ? "grid" : "aus"),
    setze: (wert: ScreenshotRaster): void => {
        gradnetz.value = wert === "grid";
        hexraster.value = wert === "hex";
    },
};
const hexMeilen = displayChoices.hexMeilen;
/**
 * Die Legende der Sprachen (WI-0261 S5a) steht, wo die Ebene „Sprachen“ ihre Flächen zeigt, es Sprachen gibt und das Auge
 * „Sprachenlegende“ an ist (Betreiber 2026-10-31, `map/sprachen-legende-schalter.ts`, Vorgabe aus); geladen wird erst
 * dann, und neu, wenn die Kacheln der Sprachen eine neue Revision bekommen (eine neue Farbe steht in Karte und Legende zugleich).
 */
const sprachenGezeigt = (): boolean =>
    mapView.value === "landscapes" && landscapeSelection.value === "sprachen" && display.value.layers;
const sprachenStand = useSprachenStand(sprachenGezeigt);
editRevision.hoere(() => sprachenStand.neuLaden(), [SPRACHE_SOURCE_ID]);
const sprachLegende = computed(
    () => sprachenLegendeZeigen.value && sprachenGezeigt() && sprachenStand.zeilen.value.length > 0,
);
/**
 * Das Leuchten der Flächen der gewählten Sprache (WI-0261 S5c, `map/sprachen-leuchten.ts`): Eine neu gewählte Sprache leuchtet, „Alle zeigen“ in ihrer Infobox schaltet es um und fliegt auf die
 * Hauptteile; es endet mit der Infobox (`present`, `clearPresentation`, also auch mit Escape).
 */
const sprachLeuchten = createSprachLeuchten();
/** Die Wahl einer Sprache aus Karte, Menü am Zeiger, Legende und Suche (WI-0261 S5b, S5c, `map/sprachen-wahl.ts`). */
const sprachWahl = useSprachWahl({
    open: (ref, options) => subjects.openSubject(ref, options),
    hint: (hint) => (pointerHint.value = hint),
    leuchte: (schluessel) => sprachLeuchten.zeige(schluessel),
});
provide(SPRACH_LEUCHTEN_ZUGANG, {
    schluessel: sprachLeuchten.schluessel,
    schalte: (schluessel, flug) => {
        if (!sprachLeuchten.schalte(schluessel) || flug === undefined) return;
        whenMapReady(() => {
            if (camera.value) flyToSubject(camera.value, flug.ref, flug.target);
        });
    },
});
/** Die Prüfhaken im Auge (WI-0131): ab Reviewer, je Person im Browser gemerkt, nie in der Adresse. */
const { enabled: mapChecksOn, results: mapCheckResults } = useMapChecks({
    allowed: viewer.can("use_editor_menu"),
    personId: authState.value.person?.id,
});
watch(
    () => display.value.layers,
    (visible) => {
        if (visible) return;
        // Ohne Landschaftsflächen gibt es keine gewählte Landschaft mehr: Auswahl und Panel enden mit ihr.
        if (subjects.selected.value?.kind === "area") subjects.closeSubject({ source: "context" });
        closeAreaChoices();
        pointerHint.value = undefined;
    },
);
/** Was von den Schaltern die Vorgabe der Ansicht verlässt: das, was Adresse und Kurzlink tragen (WI-0072). */
const currentDisplayDeviation = displayChoices.deviation;

/**
 * Fragt die Kartenauswahl in dieser Ansicht den Server (WI-0058)? Nur wo die Karte keine Landschaftsflächen
 * zeichnet (Höhenstufen): Dort lädt sie deren Kacheln nicht mehr nur fürs Anklicken. Seen zählen, solange der
 * Schalter „Flüsse und Seen“ sie zeigt.
 */
const areaLookup = computed(() => {
    if (!display.value.layers) return undefined;
    const composition = composeView(mapView.value, landscapeSelection.value, topographyVariant.value);
    return serverAreaLookup(
        composition,
        composition.contours,
        !(lakesAreAreas(mapView.value) && !display.value.rivers),
    );
});
/** Der Umriss der gewählten Fläche vom Server, wo die Karte ihn nicht aus Kacheln hat (WI-0058). */
const areaOutline = ref<Outline | undefined>(undefined);
/** Für welche Zoomstufe der Umriss geholt ist: Wer weiter heranzoomt, bekommt einen feineren. */
let areaOutlineZoom = -1;
let areaOutlineRequest = 0;
async function loadAreaOutline(): Promise<void> {
    const request = ++areaOutlineRequest;
    const area = areaSelection.value;
    const lookup = areaLookup.value;
    if (!area || area.kind !== "landscape" || !lookup || !map) {
        areaOutline.value = undefined;
        areaOutlineZoom = -1;
        return;
    }
    const zoom = map.getZoom();
    try {
        const outline = await fetchOutline(areaIds(area), zoom, lookup.smooth);
        if (request !== areaOutlineRequest) return;
        areaOutline.value = outline;
        areaOutlineZoom = outlineZoom(zoom);
    } catch {
        // Ohne Umriss leuchtet nur der Name; ein neuer Versuch kommt mit der nächsten Auswahl oder Zoomstufe.
    }
}

/**
 * Das Leuchten eines Suchtreffers (WI-0257 S3b, `search/such-leuchten-steuerung.ts`): ganze Gegenden golden, angeschnittene als Form, Orte als Ring. Es hängt am Stil (`withSuchLeuchten`),
 * bleibt beim Schwenken stehen und endet mit jedem anderen Subject, einem Klick in die freie Karte (`clearPresentation`) und einer neuen Suche.
 */
const suchLeuchten = createSuchLeuchten();
/** Eine Anfrage leuchten lassen und die Kamera auf ihren Rahmen fliegen lassen (nie springen). */
async function leuchteAnfrage(anfrage: SearchLeuchtAnfrage): Promise<void> {
    const antwort = await suchLeuchten.zeige(anfrage);
    const box = antwort === undefined ? undefined : leuchtenAusschnitt(antwort);
    if (box === undefined) return;
    whenMapReady(() => void camera.value?.showBounds(box, { maxZoom: SEARCH_FIT_MAX_ZOOM.landschaft }));
}
const suchLeuchtenZugang: SuchLeuchtenZugang = {
    bild: suchLeuchten.bild,
    aktiv: suchLeuchten.aktiv,
    waehle: (anfrage) => {
        void leuchteAnfrage(anfrage);
        // Am Telefon deckte das Panel des Eintrags die Karte, auf der es nun leuchtet: Es klappt ein, die Pille „Eintrag öffnen“ holt es zurück (WI-0260, wie nach der Wahl in der Suche).
        if (phoneViewport.value && subjects.selected.value?.kind === "loreEntry") subjects.collapsePanel();
    },
    // Ohne Flug: „Vorkommen unterwegs“ in den Routendetails lässt leuchten (WI-0257 S4, S5: alle gewählten zusammen); wohin die Kamera fliegt, sagt die Auswahl (`fliegeZu`).
    zeige: (anfrage) => suchLeuchten.zeige(anfrage),
    zeigeVereinigt: (anfragen, farben) => suchLeuchten.zeigeVereinigt(anfragen, farben),
    leuchtenVon: (anfrage) => suchLeuchten.leuchtenVon(anfrage),
    beende: () => suchLeuchten.beende(),
};
provide(SUCH_LEUCHTEN_ZUGANG, suchLeuchtenZugang);

/**
 * Die Auswahl in „Vorkommen unterwegs“ (WI-0257 S5, `route-planner/unterwegs-auswahl.ts`): Sie gehört der App, weil Planer und Infopanel sie beide zeigen - der Planer die Kästchen und
 * gefärbten Etappen, das Panel ab zwei gewählten den Sammelscreen „Ausgewählte Vorkommen“. Eine Infobox öffnet sie über `zeigeEintrag` (am Telefon eingeklappt mit der Pille).
 */
const unterwegsAuswahl = createUnterwegsAuswahl({
    zugang: suchLeuchtenZugang,
    oeffneEintrag: (id, name, kind) => zeigeEintrag(id, name, kind),
    // Am Rechner zählt nur ein Panel, das vorn steht; am Telefon steht es eingeklappt hinter der Karte, das ist dort die Regel.
    eintragImPanel: () => {
        const offen = subjects.selected.value;
        if (offen?.kind !== "loreEntry" || subjects.slot.value !== "info") return undefined;
        return phoneViewport.value || subjects.panelVisible.value ? offen.id : undefined;
    },
    // Hinzunehmen und Öffnen fliegen zum Vorkommen (Vali 2026-10-30, `unterwegs-auswahl.ts`), wie der Flug der Suche: Rahmen samt Orten, Panels als Ränder.
    fliegeZu: (leuchten) => {
        const box = vorkommenAusschnitt(leuchten);
        if (box !== undefined)
            whenMapReady(() => void camera.value?.showBounds(box, { maxZoom: SEARCH_FIT_MAX_ZOOM.landschaft }));
    },
});
provide(UNTERWEGS_AUSWAHL, unterwegsAuswahl);
// Der Name eines Vorkommens in der Infobox öffnet dessen Infobox wie ein Treffer der Suche (`info-lore-entry.vue`): dieselbe Funktion `zeigeEintrag`.
provide(EINTRAG_OEFFNEN, (id, name, kind) => zeigeEintrag(id, name, kind));

const container = useTemplateRef<HTMLDivElement>("mapContainer");
/** Der angeklickte Ort: Sein Kern steht gold, bis ein Klick daneben geht (Legacy `setActiveLocationMarker`). */
const selectedPlace = ref<SelectedPlace | undefined>(undefined);

/** Das offene Infopanel oder Editorpanel steht am Rechner neben den Bedienelementen am rechten Rand: Sie fahren nach links. */
const panelShifts = computed(
    () =>
        (subjects.slotOpen.value || communityBesucher.angedockt.value || reisebildBesucher.angedockt.value) &&
        !phoneViewport.value,
);
/**
 * Eingeklappt steht nur die Lasche „Info“ an der Bildschirmkante, oben neben dem Ring: Der Ring rückt um ihre Breite
 * (Betreiber 2026-10-04: „der navigationskreis verschwindet unter der lasche“). Am Telefon gibt es keine Lasche.
 */
const tabShifts = computed(
    () =>
        (subjects.hasContent.value || editorNav !== undefined) &&
        !subjects.slotOpen.value &&
        !communityBesucher.angedockt.value &&
        !reisebildBesucher.angedockt.value &&
        !phoneViewport.value,
);

/**
 * Die Darstellungszustände der Karte werden aus dem EINEN gewählten Subject gespeist (WI-0063 11.1, `info-panel/`): der
 * goldene Ortskern, die leuchtende Fläche oder der leuchtende Weg, der Tropfen und die Etappe des Planers. Was die Auswahl nicht
 * nennt, endet; die Etappe gehört dem Planer und bleibt, wenn sie nicht genannt ist (wie Esc und Leerklick sie immer ließen).
 */
function present(next: PresentedSelection): void {
    // Ein anderer Subject ersetzt das Leuchten der Suche (es folgt dem Eintrag; `chooseVorkommen` startet es nach dem Öffnen neu).
    suchLeuchten.beende();
    // Die Ansicht, in der der Subject zu sehen ist - nur, wo die Auswahl nicht von der Karte kam (Link, Planer).
    if (next.view !== undefined && (next.view !== "political" || territoriesReady.value)) mapView.value = next.view;
    // Die Landschaftsebene danach (ein Ansichtswechsel setzt die Schalter zurück): ein Klimaband liegt nur auf „Klima“.
    if (next.landscape !== undefined) landscapeSelection.value = next.landscape;
    // Die Klimazone der Suche steht kräftiger, bis eine andere Auswahl kommt; die Auswahl nennt sie oder sie endet.
    highlightedClimateZone.value = next.climate;
    areaSelection.value = next.area;
    areaChoices.value = undefined;
    selectedPowerline.value = next.powerline?.name;
    powerlineChoices.value = undefined;
    sprachWahl.gewaehlt.value = next.sprache;
    sprachLeuchten.folge(next.sprache);
    selectedPlace.value = next.place;
    mapPin.value = next.pin;
    if (next.stage !== undefined) planner.selectStage(next.stage, false);
}

/**
 * Nichts ist mehr gewählt: Fläche, Weg, Klimazone, Ort und Tropfen (Leerklick, Esc: WI-0044, Legacy). Die Etappe bleibt.
 */
function clearPresentation(): void {
    suchLeuchten.beende();
    areaSelection.value = undefined;
    areaChoices.value = undefined;
    selectedPowerline.value = undefined;
    powerlineChoices.value = undefined;
    highlightedClimateZone.value = undefined;
    sprachWahl.gewaehlt.value = undefined;
    sprachLeuchten.beende();
    selectedPlace.value = undefined;
    mapPin.value = undefined;
}
let map: maplibregl.Map | undefined;
/** Die Karte hat ihr `load` gemeldet: Stil und Kamera stehen, Fahrten dürfen los. */
let mapReady = false;
/**
 * Dieselbe Karte als Ref, für Bauteile, die sie selbst abfragen statt sie gezeigt zu bekommen
 * (heute die Maßstabsleiste, WI-0096). 🪤 Gesetzt erst im `load`: Vorher hat `unproject` keinen Stand,
 * den eine Leiste ablesen könnte.
 */
const mapHandle = shallowRef<maplibregl.Map | undefined>(undefined);
// „Reise als PDF“ (WI-0306): Leinwand, Kamera und Ansicht für das Kartenbild des Deckblatts; das Fenster schaltet vorübergehend um und stellt zurück.
provide(REISE_PDF_KARTE, {
    karte: () => map,
    kamera: () => camera.value,
    ansicht: () => ({
        view: mapView.value,
        landscape: landscapeSelection.value,
        topography: topographyVariant.value,
        series: seriesId.value,
    }),
    setzeAnsicht: (ansicht) => {
        mapView.value = ansicht.view;
        landscapeSelection.value = ansicht.landscape;
        topographyVariant.value = ansicht.topography;
        seriesId.value = ansicht.series;
    },
    serien: () => fanSerien.value,
    vorgabeSerie: () => DEFAULT_VIEW.series,
    politischBereit: () => territoriesReady.value,
});

/**
 * Der Routenplaner (WI-0017). Er kennt die Karte nicht: Er meldet, was sie zeigen soll, und hier
 * wird es umgesetzt - in den Stil, in die Kamera, in die Adresse.
 *
 * ⭐ Am Rechner fährt er herein, sobald die Karte steht (Legacy A1); am Telefon startet er zu (A2).
 */
const plannerPanel = useTemplateRef<InstanceType<typeof RoutePlanner>>("plannerPanel");
const plannerOpen = ref(false);

/**
 * Das Kontextmenü der Karte (Rechtsklick, am Finger langer Druck): wo es aufgeht und welcher
 * Kartenpunkt gemeint ist.
 */
const contextMenuAt = ref<{ x: number; y: number } | null>(null);
/** Das Namensschild über einer Wegpunktmarke, die beim Ziehen auf einem Ort einrastet (WI-0052). */
const snapLabel = ref<SnapLabel | null>(null);
/**
 * Die Entfernungsmessung (WI-0095, Finding MCS-030): EINE Messung, zwei Punkte, keine Kette - wie Legacy.
 * Sie lebt hier, weil das Kartenmenü sie beginnt und löscht und die Karte sie zeichnet.
 */
const measurement = ref<Measurement | undefined>(undefined);
let contextPoint: MapPoint | undefined;
/** Der Ort unter dem Rechtsklick, wenn einer da war (WI-0100): Er entscheidet die Reisezeile des Menüs. */
let contextPlace: SelectedPlace | undefined;
/** Die Landmarke unter dem Rechtsklick als Ziel (WI-0271 L6): Sie bietet „Ziel hinzufügen“ wie ein Ort (`landmarkeAlsZiel`). */
let contextLandmarke: WaypointHit | undefined;
/** Dasselbe als Zustand für die Hülle - das Menü fragt nur, OB ein Ort gemeint ist, nicht welcher. */
const contextAtPlace = ref(false);
let routeLayer: RouteLayerData = EMPTY_ROUTE_LAYER;
let pendingCamera: (() => void) | undefined;

/** Die Karte steht, und die Panels stehen auch: Fahrten zielen in die richtige Fläche. */
let cameraReady = false;

/**
 * Eine Kamerafahrt wartet, bis die Karte steht - eine Route aus dem Link kommt oft vor ihr an.
 *
 * 🪤 Und bis Vue gezeichnet hat: Mit der Route erscheint am Telefon die schwebende Leiste, und die
 * Fahrt muss sie schon als Rand kennen (WI-0039).
 */
function whenMapReady(move: () => void): void {
    if (cameraReady && camera.value) {
        void nextTick(move);
    } else {
        pendingCamera = move;
    }
}

/**
 * Die Mindestnähe beim Anfliegen (WI-0039, E2): ein Ort nach seiner Klasse, dieselbe Regel wie die Suche.
 * Ein Kartenpunkt hat keine Klasse; für ihn gilt der Boden (Legacy `?pin`: `max(z, 4)`).
 */
function nearZoomOf(place: { subtype?: string | null }): number {
    return place.subtype === MAP_POINT_SUBTYPE ? renderZoomForBand(PLACE_ZOOM_FLOOR) : placeNearZoom(place.subtype);
}

/** Ein Ausschnitt in Kartenkoordinaten als Grenzen in Renderkoordinaten: Südwest, Nordost. */
const renderBox = ([minX, minY, maxX, maxY]: MapBounds): [[number, number], [number, number]] => {
    const a = toRenderLngLat(space, { x: minX, y: minY });
    const b = toRenderLngLat(space, { x: maxX, y: maxY });
    return [
        [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat)],
        [Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)],
    ];
};

const renderPosition = (point: { x: number; y: number }): [number, number] => {
    const lngLat = toRenderLngLat(space, point);
    return [lngLat.lng, lngLat.lat];
};

/**
 * Ein geänderter Hash im offenen Tab gilt wie beim Laden (`map/hash-folgen.ts`): Ansicht, Ebene, Topographie, Serie, Schalter, Ausschnitt.
 * „Politisch“ ohne Gebiete bleibt wie beim Laden in der Adresse und zeigt die Standardkarte.
 */
const stopHashFolgen = installHashFolgen(
    seriesIds,
    () => seriesId.value,
    ({ wahl, lage, anzeige }) => {
        if (wahl.view === "political" && !territoriesReady.value) {
            mapView.value = DEFAULT_MAP_VIEW;
            politischVerlinkt = true;
        } else if (wahl.view !== undefined) mapView.value = wahl.view;
        if (wahl.landscape !== undefined) landscapeSelection.value = wahl.landscape;
        if (wahl.topography !== undefined) topographyVariant.value = wahl.topography;
        if (wahl.series !== undefined) seriesId.value = wahl.series;
        if (!isDefaultDisplay(anzeige)) displayChoices.adopt(anzeige);
        if (lage !== undefined) camera.value?.showView(renderPosition(lage.center), lage.zoom);
    },
);

/** Die Namensschilder der Grenzübertritte stehen, wo die Marken stehen: dieselbe Liste, dasselbe Häkchen. */
const showBorderLabels = (layer: RouteLayerData): void =>
    borderLabels?.show(
        (layer.borders ?? []).map((border) => ({
            lngLat: renderPosition(border),
            from: border.from ?? "",
            to: border.to ?? "",
        })),
    );

/**
 * Die Auswahl und der rechte Slot (WI-0063 P5, `info-panel/`): genau EIN gewählter Subject, EINE Öffnungsnaht. Karte, Suche,
 * Objektlink, Planer und Kontextmenü öffnen alle über `subjects.openSubject`; die Darstellung der Karte (`present`) und die
 * Kamera (`flyToSubject`, nur über `camera.ts`, nie ein Sprung) sind Wirkungen davon. `app.vue` kennt keine Art des Subjects.
 */
const subjects = createSubjectSelection({
    canPin: viewer.can("pin_selection"),
    // Das Editor-Menü (WI-0063 P9) hängt an der Öffnung, nicht an einer Art: Eine Öffnung der Karte mit Klickpunkt meldet sich dort.
    // Der Ortseditor (WI-0128 E7) hört mit: Ein anderes Objekt der Karte holt das Infopanel vor ihn.
    onOpened: (ref, options) => {
        editorMenu.subjectOpened(ref, options);
        // Im Editor-Modus öffnet ein Klick auf einen Ort oder eine Fläche ihr Fenster (T34 (1)), nicht während eines Modus.
        const editorKlick = editorKlickFrei();
        // Die Fläche zuerst: Nimmt der Landschaftseditor den Klick, holt der Ortseditor nicht das Infopanel vor sich (das tut er für jedes
        // andere Objekt). Wie am Ort nur, wenn die Lasche „Editor“ vorn ist (Angleichung der Orchestrierung an 182a8519).
        if (landschaftseditor.geoeffnet(ref, options, editorKlick && subjects.slot.value === "editor")) {
            subjects.showEditor();
            holeGeklicktesHervor("landschaftseditor", options);
            return;
        }
        // Ein offenes Wege-Fenster folgt einem Weg (WI-0177 W5a); öffnen tut es der Klick nicht (`wegeditor-steuerung.ts`).
        if (wegeFenster.geoeffnet(ref, options, editorKlick && subjects.slot.value === "editor")) {
            subjects.showEditor();
            holeGeklicktesHervor("wegeditor", options);
            return;
        }
        // Ein Gebiet öffnet den Gebietseditor an sich wie die Fläche ihren (WI-0209, T34 (1)).
        if (gebietseditor.geoeffnet(ref, options, editorKlick && subjects.slot.value === "editor")) {
            subjects.showEditor();
            holeGeklicktesHervor("gebietseditor", options);
            return;
        }
        // Eine Kraftlinie öffnet den Kraftlinien-Editor an sich, nur mit den Eigenschaften (WI-0205 K3, T34 (1), Variante A).
        if (kraftlinieneditor.geoeffnet(ref, options, editorKlick && subjects.slot.value === "editor")) {
            subjects.showEditor();
            holeGeklicktesHervor("kraftlinieneditor", options);
            return;
        }
        // Ein offenes Sprachfenster folgt einer Sprache (WI-0261 S5d2, wie das Wege-Fenster); öffnen tut es der Klick nicht.
        if (spracheditor.geoeffnet(ref, options, editorKlick && subjects.slot.value === "editor")) {
            subjects.showEditor();
            return;
        }
        if (ortseditor.geoeffnet(ref, options, editorKlick)) {
            subjects.showEditor();
            holeGeklicktesHervor("ortseditor", options);
        }
    },
    effects: {
        present,
        clear: clearPresentation,
        fly: (ref, target) =>
            whenMapReady(() => {
                if (camera.value) flyToSubject(camera.value, ref, target);
            }),
    },
});
/**
 * Das Editor-Menü am angeklickten Objekt (WI-0063 P9, `editor-menu/`): Actions als Daten (`editorActions()`), nur für Editoren am
 * Rechner, nie bei erfasstem Zeiger, und nur wo mindestens eine Action sichtbar ist - heute gibt es keine, also öffnet es für niemanden.
 */
/**
 * Abschnitte im Menü am Weg (WI-0177, EDIT-0003 T49): die Abschnitte der Straße als Untermenü „n · Von – Bis“, geladen über den Lesepfad
 * des Wege-Fensters und nach jeder Änderung an der Karte neu; Zeigen lässt den Abschnitt leuchten, ein offenes Untermenü nummeriert sie.
 */
const wegAbschnitte = createWegAbschnitte(createWegeditorDaten(), {
    bild: () => {
        if (!map || !mapReady) return undefined;
        const rahmen = map.getBounds();
        const a = fromRenderLngLat(space, rahmen.getSouthWest());
        const b = fromRenderLngLat(space, rahmen.getNorthEast());
        return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    },
    texte: () => ({ abzweig: t("wegeditor.abschnitte.abzweig"), ausserhalb: t("wegeditor.abschnitte.ausserhalb") }),
});
editRevision.hoere(() => wegAbschnitte.vergiss(), WEGE_QUELLEN);
/** „Weg hier teilen“ am Rechtsklick auf den Weg (Thomas 2.1, Betreiber 2026-10-19 A); `weg-hier-teilen.ts`. */
const wegHierTeilen = createWegHierTeilen(createWegeditorDaten());
editRevision.hoere(() => wegHierTeilen.vergiss(), WEGE_QUELLEN);
/** Der Umkreis um den Rechtsklick, in dem „Weg hier teilen“ einen inneren Stützpunkt sucht, in Karteneinheiten. */
const teilUmkreis = (at: MapPoint | undefined): number =>
    at === undefined || !map ? 0 : UMKREIS_FANGRADIEN * startansicht().fangradius * einheitenJePixel(map, at);
/** „Wege verbinden ›“ (WI-0252): EINE Operation; danach steht der verbundene Weg im Fenster, ↺ im Verlauf. */
async function wegeVerbinden(vorlage: string): Promise<void> {
    const n = wegeFenster.verbindenAbschnitte().length;
    const antwort = await wegeFenster.verbinde(vorlage);
    if (!antwort.ok) {
        showToast(antwort.satz, "warning");
        return;
    }
    subjects.showEditor();
    showToast(tPlural("wegeditor.verbinden.fertig", n, { n: String(n) }), "success");
}
async function wegHierTeilenAm(abschnitt: string, name: string): Promise<void> {
    const at = contextPoint;
    const antwort = await wegHierTeilen.teile(abschnitt, at, teilUmkreis(at));
    if (antwort === undefined) return;
    if (!antwort.ok) {
        showToast(antwort.fehler.message, "warning");
        return;
    }
    if (antwort.quittung.mapRevision !== undefined)
        editRevision.advance(map, antwort.quittung.mapRevision, WEGE_QUELLEN);
    wegeFenster.neuLaden();
    showToast(meldungText({ art: "geteilt", publicId: abschnitt, name, hinten: antwort.quittung.publicId }), "success");
}
const abschnitteLeuchten = createAbschnitteLeuchten(() => (mapReady ? map : undefined));
/**
 * „Flächen vereinigen ›“ (WI-0252; Betreiber 2026-10-24: „unter anlegen "Hier hinzufügen" soll im kontextmenü (bei der mehrfachauswahl von
 * objekte) "Flächen vereinigen" stehen das Untermenü bestimmt wessen einstellungen übernommen werden“): die Prüfung je Auswahl und das
 * Leuchten der gezeigten Vorlage. Jede neue Kachelrevision macht die Prüfungen alt.
 */
const flaechenVereinigen = createFlaechenVereinigen();
const flaechenLeuchten = createFlaechenLeuchten(() => (mapReady ? map : undefined));
editRevision.hoere(() => flaechenVereinigen.vergiss());
/** Die angehakten Landschaften, sonst die angehakten Gebiete, je mindestens zwei; unter dem Rechtsklick ein Gebiet: zuerst die Gebiete. */
function flaechenAuswahl(): FlaechenAuswahl | undefined {
    const stand = mehrfachMarkierung.stand.value;
    const landschaften = markiert(stand, "landscape");
    const gebiete = markiert(stand, "territory");
    const unter = contextFlaechen[0]?.ref.kind;
    if (gebiete.length >= 2 && (unter === "territory" || landschaften.length < 2))
        return { art: "territory", ids: [...gebiete] };
    if (landschaften.length >= 2) return { art: "landscape", ids: [...landschaften] };
    return undefined;
}
/** Der Eintrag unter „Hier hinzufügen ›“; grau, solange ein Modus läuft oder diese Sitzung nicht schreiben darf. */
function flaechenVereinigenEintrag(): VereinigenEintrag | undefined {
    return flaechenVereinigen.eintrag(
        flaechenAuswahl(),
        (art, typ) => candidateTypeLabel({ kind: art, type: typ }),
        ortHandgriffLage().laeuft
            ? "ortseditor.handgriff.grund.laeuft"
            : zeichenGrund(flaechenAuswahl()?.art === "territory" ? "gebiet" : "flaeche"),
    );
}
/** Die Wahl im Untermenü: EINE Operation; danach ist die Mehrfachauswahl aufgehoben und die Vorlage steht im Fenster, ↺ im Verlauf. */
async function flaechenVereinigenAus(vorlage: string): Promise<void> {
    const auswahl = flaechenAuswahl();
    if (auswahl === undefined) return;
    const antwort = await flaechenVereinigen.vereinige(auswahl, vorlage);
    if (!antwort.ok) {
        showToast(antwort.satz, "warning");
        return;
    }
    mehrfachMarkierung.hebeAuf();
    subjects.showEditor();
    if (auswahl.art === "landscape") {
        flaecheGeschrieben(antwort.quittung, auswahl.ids);
        landschaftseditor.oeffneFuer(vorlage);
    } else {
        if (antwort.quittung.mapRevision !== undefined) editRevision.advance(map, antwort.quittung.mapRevision);
        gebietseditor.neuLaden();
        gebietseditor.oeffneFuer(vorlage);
    }
    showToast(tPlural("ortseditor.vereinigen.fertig", antwort.n, { n: String(antwort.n) }), "success");
}
/** Ein Untermenü der Abschnitte ist offen (am Abschnitt `anker`), eine Wahl darin gezeigt; sonst nichts auf der Karte. */
function zeigeAbschnitte(anker: string | undefined, griff: string | undefined, wahl: string | undefined): void {
    // „Flächen vereinigen ›“ (WI-0252): die gezeigte Vorlage leuchtet; die Abschnitte der Wege zeigen, was ihr Fenster zeigt.
    const flaechen = griff === VEREINIGEN_EINTRAG ? flaechenAuswahl() : undefined;
    flaechenLeuchten.zeige(
        flaechen === undefined || wahl === undefined ? undefined : { art: flaechen.art, hervor: [wahl] },
    );
    if (griff === VEREINIGEN_EINTRAG) {
        abschnitteLeuchten.zeige(fensterAbschnitte.value);
        return;
    }
    // „Wege verbinden ›“ (WI-0252): Das Untermenü nennt die gewählten Abschnitte, auch aus mehreren Wegen; der gezeigte leuchtet hervor.
    if (griff === "weg-verbinden") {
        abschnitteLeuchten.zeige({ ids: wegeFenster.verbindenAbschnitte(), hervor: wahl === undefined ? [] : [wahl] });
        return;
    }
    const abschnitte = anker !== undefined && griff?.startsWith("weg-") ? wegAbschnitte.fuer(anker) : undefined;
    if (abschnitte === undefined || abschnitte.length === 0) {
        abschnitteLeuchten.zeige(fensterAbschnitte.value);
        return;
    }
    abschnitteLeuchten.zeige({
        ids: abschnitte.map((a) => a.publicId),
        hervor: wahl === undefined || wahl === GANZE_STRASSE ? [] : [wahl],
    });
}
const ankerVon = (subject: EditorMenuVorschau["subject"] | undefined): string | undefined =>
    subject?.ref.kind === "path" && "anchor" in subject.ref ? subject.ref.anchor : undefined;
const editorMenu = createEditorMenu({
    viewer,
    vorschau: (jetzt) => zeigeAbschnitte(ankerVon(jetzt?.subject), jetzt?.griff, jetzt?.wahl),
    // Die Handgriffe kommen aus dem Register (O1, `editor-menu/handgriffe-ort.ts`); am Objekt steht nur, was gerade geht.
    actions: () => editorActions(handgriffRegister()),
    selection: subjects,
    available: () => !phoneViewport.value,
    captured: () => interaction?.captured(),
    // Solange das Menü offen ist, ruht das Zeigen auf der Karte (M8: ein Menü lässt es ruhen).
    holdPointer: () => interaction?.suspendHover("editor-menu") ?? (() => undefined),
});
// Escape, von innen nach außen (WI-0063 4.10): eine laufende Editoraktion ist ein Haken für Phase 6; dann das Editor-Menü (hier),
// die Menüs (melden sich selbst), das sichtbare Infopanel samt Auswahl, sonst die Auswahl der Karte.
const stopEditorMenuEscape = editorMenu.attachEscape(escapeCascade);
/**
 * 🔴 **Eine bewusste Abweichung von Legacy** (WI-0095 F1, dem Betreiber auf dem Blatt vorgelegt): Legacy kennt zur Messung
 * keine Escape-Taste - eine halb begonnene Messung bleibt dort stehen, bis jemand das Kartenmenü wieder
 * aufmacht und löscht. Die Stufe `action` dieser Kaskade ist aber genau dafür freigehalten („eine laufende
 * Editoraktion (Werkzeug) bricht ab", `keyboard/escape-cascade.ts`), und eine Messung, die auf ihren zweiten
 * Punkt wartet, IST eine laufende Werkzeugaktion.
 *
 * Darum bricht Escape nur die **wartende** Messung ab. Eine FERTIGE Messung bleibt stehen - sonst nähme
 * Escape zwei Dinge auf einmal weg und die Auswahl der Karte käme nie mehr dran.
 */
escapeCascade.register("action", () => {
    if (!isPending(measurement.value)) return false;
    clearMeasure();
    return true;
});
/**
 * Das Editorpanel (WI-0128 E3, EDIT-0001 §3.2): Reiter und Schiene aus dem Navigationsregister, gemerkt je Knoten, Tiefer Link
 * `?tab=`. Nur im Editor-Modus mit `use_editor_menu` (ab Reviewer).
 *
 * 🔴 **Kein Build-Schalter mehr** (Betreiber 2026-10-13: „alles was auf der stage funktioniert und freigegeben wurde TAUCHT AUCH
 * PRODUCTION AUF“, und davor „editorpanel beinhaltet doch alles - wie soll ich da überhaupt was sehen?“). Bis dahin hing das ganze
 * Panel an `import.meta.env.DEV` (D23). Zwei Fehler in einer Zeile:
 *
 * 1. **Die Hülle trug mehr als den Ortseditor.** „Status“ (Besucherstatistik, WI-0138) und „Änderungen“ (E17) haben mit ihm nichts zu
 *    tun und waren drei Tage lang im ausgelieferten Build mit abgeschaltet — der Server zählte Besucher, und niemand kam an die Zahlen.
 * 2. **Ein Build-Schalter kann nicht freigegeben werden.** Was `DEV` abschaltet, ist nicht im Build und geht mit keiner Freigabe nach
 *    Production. Das verletzt die Entscheidung zu FREIGABE-0001 (Betreiber 2026-10-13): „Unfertiges geht ausgeschaltet mit, statt
 *    draußen zu bleiben (wie `MAP_EDITING`, D23, die Inhaltsschalter) — damit bleibt ‚Alles nach Production‘ der Normalfall.“
 *
 * D23 („später auf stage bau fertig“, 2026-10-10) ist deshalb jetzt ein LAUFZEIT-Schalter: `MAP_EDITING` je Umgebung (E9). Ohne
 * Wert ist er außerhalb der Entwicklung `off` (`mapEditingMode`; seit dem Betreiberentscheid vom 2026-10-15 darf auch Production
 * `testwelt`, ausdrücklich gesetzt), der Server lehnt dann jedes Schreiben mit 423 `map_editing_off` ab, und die Handgriffe am Ort
 * stehen mit ihrem Sperrgrund da. Der Ortseditor reist also mit und ist dort, wo er nicht gewollt ist, aus.
 */
const editorPanelRechte = navRechte(viewer, authState.value);
const editorNav = viewer.can("use_editor_menu")
    ? createNavStand({
          tafel: EDITORPANEL,
          rechte: editorPanelRechte,
          search: addressSearch,
          speicher: browserSpeicher(),
      })
    : undefined;
/** Die Werkzeuge, die es schon gibt; das Verb eines anderen ist mit Satz gesperrt. */
const editorWerkzeuge: ReadonlySet<string> = new Set<string>([
    "ortseditor",
    "landschaftseditor",
    "kraftlinieneditor",
    "wegeditor",
    "gebietseditor",
    "spracheditor",
    "wettereditor",
    INHALTE_WERKZEUG,
]);
if (editorNav && oeffnetBeimLaden(editorNav, phoneViewport.value)) subjects.showEditor();
const stopEditorMerken = watch(subjects.editorVisible, (vorn) => editorNav?.merkeOffen(vorn));

/**
 * Die Werkzeugfenster (WI-0128 E6, D14, D15): Der Ortseditor in drei Lagen, mehrere zugleich; die Ablage steht unter „Offene
 * Bearbeitungen“ im Editorpanel. Kommt das Infopanel nach vorn oder geht das Editorpanel zu, wird das angedockte Fenster abgelegt
 * (D14: „Die Lasche ‚Info‘ versenkt einen angedockten Ortseditor ebenso“); sein Entwurf bleibt.
 */
const werkzeugfenster = createWerkzeugfenster(browserSpeicher());
// ✕ legt einen Entwurf ab, nie verwirft er ihn (F1): Ein Hinweis sagt einmal, wo er liegt (Orchestrierung 2026-10-18, Betreiber bestätigt).
installAblageHinweis(werkzeugfenster, () => showToast(t("entwurf.abgelegt")));
/**
 * Der Schalter der Liste je Fenster (WI-0128 P1, für jedes Werkzeugfenster mit Liste seit EDIT-0003): 🔴 EINE Quelle für die wirklich
 * gezeichnete Breite eines angedockten Fensters - das Fenster selbst, die Laschen „Info“/„Editor“ samt Eckknöpfen (`slotBreite`) und
 * die freie Kartenfläche des Hinflugs lesen sie alle hier, statt die 960 px je für sich anzunehmen.
 */
const listenSchalter = createListenSchalter(browserSpeicher());
/**
 * „✎ Ecken bearbeiten“ (WI-0178 C1): das Geometrie-Modul mit der Art Fläche. Die Andockziele kommen aus den Ebenen, die die Karte
 * zeigt (T27 (1)); gespeichert wird mit C2. Esc bricht ab (Stufe `action`), Strg+Z und Strg+Y gehen im Entwurf zurück und vor.
 */
/** Die Sperre während der Bearbeitung (EDIT-0003 §4): EINE je Fenster des Browsers, für alle Editoren. */
const editorSperre = createEditorSperre();
/**
 * Der Landschaftseditor (WI-0178 A3, B2): je Landschaft ein Fenster mit EINEM Entwurf für Felder und Form (O3, EDIT-0003 T44); „Fertig“
 * schreibt `landscape.update`. Ohne Recht oder mit `MAP_EDITING` aus lesend.
 */
const landschaftseditor = createLandschaftseditorSteuerung(werkzeugfenster, undefined, listenSchalter, {
    sperre: editorSperre,
    geaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision, DEROGRAPHIE_QUELLEN);
    },
    gipfelGeaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision, [...DEROGRAPHIE_QUELLEN, ...WEGE_QUELLEN]);
    },
    speicher: entwurfsSpeicher(),
    darfSchreiben: () => verbModus(EDITORPANEL, "regionen", editorPanelRechte) === "bearbeiten",
    // Fenster mit Ebenenwechsel im Entwurf aus dem Bild: die Karte zurück in die gespeicherte Ebene (Fund „Tal am Donnerkessel“).
    ebene: {
        zeigt: (ebene) => mapView.value === "landscapes" && landscapeSelection.value === ebene,
        stelle: (ebene) => hinflugAnsicht(ansichtFuerHinflug({ art: "landschaft", ebene })),
    },
});
// Gemeinsame Grenzen auf der Karte (OPS-000089): nur im Editor-Modus (Einbindung unten), solange jemand Gebirge bearbeitet und die
// Topographie zu sehen ist; dann an allen Gebirgen. Ein Gebirge ist es, sobald Ebene und Art im Entwurf es sagen, sonst laut Liste.
let gebirgsNaehte: GebirgsNaehte | undefined;
const gebirgeImFenster = (id: string): boolean => {
    const felder = landschaftseditor.bearbeitungVon(id)?.stand.value?.felder;
    if (felder !== undefined) return istGebirge(felder);
    const zeile = landschaftseditor.liste.value?.rows.find((row) => row.id === id);
    return zeile !== undefined && istGebirge({ ebene: zeile.layer, art: zeile.type });
};
const naehteZeigen = (): boolean =>
    naehteSichtbar({
        ansicht: mapView.value,
        ebene: landscapeSelection.value,
        flaechen: display.value.layers,
        gebirge: sichtbarAn(landschaftseditor.fenster.value, gebirgeImFenster),
    });
watch(naehteZeigen, () => void nextTick(() => gebirgsNaehte?.zeige(naehteZeigen())));
// Nach dem Speichern ändern sich auch die gemeinsamen Grenzen (OPS-000089).
watch(
    () => landschaftseditor.liste.value,
    () => gebirgsNaehte?.lade(),
);
/**
 * Gespeicherte Gebietsflächen, bis die Ableitung sie zeichnet (WI-0209; Betreiber 2026-10-19: „sofort von der karte verschwunden“):
 * gestrichelt über dieselbe Schicht wie die Flächen im Entwurf. Die Farbe kennt die Liste des Gebietseditors (erst beim Zeichnen gelesen).
 */
const ausstehendeGebiete = createAusstehendeGebiete({
    farbe: (id) => gebietseditor.liste.value?.rows.find((row) => row.id === id)?.color,
});
/** Flächen im Entwurf mit neuer Ebene oder Art: gestrichelt in der Ebene und Farbe des Entwurfs (Betreiber 2026-10-18, „A“). */
let entwurfsSchicht: EntwurfsFlaechen | undefined;
const entwurfsZeichnung = computed(() => [
    ...ausstehendeGebiete.flaechen.value,
    ...entwurfsFlaechen(
        // Auch abgelegte Entwürfe: Sie sind „im Entwurf“, bis „Fertig“ oder Verwerfen (Weg des Funds: Bragensrode legte das Tal ab).
        landschaftseditor.fenster.value.map((eintrag) => landschaftseditor.bearbeitungVon(eintrag.gegenstand)),
    ),
]);
/** Die Flächen im Entwurf zeigen; mit „Auswahl isolieren“ nur die bearbeitete (WI-0178). */
function zeigeEntwurfsflaechen(): void {
    entwurfsSchicht?.zeige(nurIsolierte(entwurfsZeichnung.value, isolieren.flaeche.value, (flaeche) => flaeche.id));
}
watch(entwurfsZeichnung, zeigeEntwurfsflaechen);
/** Verschobene Beschriftungen an ihrer Lage im Entwurf, nach „Fertig“ bis die Kachel nachkommt (WI-0178 C4, Betreiber 2026-10-18). */
let entwurfsBeschriftungen: EntwurfsBeschriftungen | undefined;
const gezogen = computed(() =>
    gezogeneBeschriftungen(
        landschaftseditor.fenster.value.map((eintrag) => landschaftseditor.bearbeitungVon(eintrag.gegenstand)),
    ),
);
watch(gezogen, (jetzt, vorher) => {
    const gespeichert = gespeicherteBeschriftungen(
        vorher,
        jetzt,
        (id) => landschaftseditor.bearbeitungVon(id)?.zustand.value.art === "gespeichert",
    );
    entwurfsBeschriftungen?.halte(gespeichert, editRevision.current);
    entwurfsBeschriftungen?.zeige(jetzt);
});
/** Der Ring um einen Gipfel, den die Gipfelliste eines Gebirges gerade überfährt (WI-0178 P5). */
let gipfelRing: GipfelHervorhebung | undefined;
/** Die Grundform eines Gebirges im Entwurf (P6), im Umriss auf der Karte. */
let gebirgeVorschau: GebirgeVorschauKarte | undefined;
/**
 * Das Wege-Fenster (WI-0177 W5a, W5b): je Straße ein Fenster mit EINEM Entwurf für ihre Felder (O3, EDIT-0003 T44); „Fertig“ schreibt
 * `path.update`. Ohne Recht oder mit `MAP_EDITING` aus lesend. Ändert sich an Wegen etwas, lesen Liste und Straßen ohne laufende
 * Bearbeitung neu (`neuLaden`).
 */
const wegeFenster = createWegeditorSteuerung(werkzeugfenster, undefined, listenSchalter, {
    sperre: editorSperre,
    geaendert: (revision) => {
        if (revision === undefined) return;
        editRevision.advance(map, revision, WEGE_QUELLEN);
        // Das Infopanel liest den gezeigten Weg neu (wie der Ortseditor seinen Ort): Ein neuer Name steht sonst nie dort, und die
        // Markierung folgt der neuen Kette (`subject-selection.ts`, `folgeKette`).
        if (subjects.shown.value?.ref.kind === "path") subjects.auffrischen();
    },
    speicher: entwurfsSpeicher(),
    darfSchreiben: () => verbModus(EDITORPANEL, "wege", editorPanelRechte) === "bearbeiten",
});
editRevision.hoere(() => wegeFenster.neuLaden(), WEGE_QUELLEN);
/**
 * Die Seen beim Bearbeiten eines Flusses (OPS-000116): Solange ein Wege-Fenster an einem Fluss oder Bach steht, zeigt die Karte die Seen
 * auch dort, wo sie sonst keine eigenen zeichnet (`StyleOptions.seenBeimFluss`). Ein Fluss ist es, sobald ein Abschnitt im Entwurf
 * Fluss oder Bach ist, sonst laut Liste.
 */
const flussImFenster = (id: string): boolean => {
    const felder = wegeFenster.bearbeitungVon(id)?.stand.value?.felder;
    if (felder !== undefined) return Object.values(felder.arten).some(istFluss);
    const zeile = wegeFenster.liste.value?.rows.find((row) => row.id === id);
    return zeile !== undefined && [zeile.subtype, ...(zeile.subtypes ?? [])].some(istFluss);
};
const seenBeimFluss = computed(() => sichtbarAn(wegeFenster.fenster.value, flussImFenster));
/**
 * Die Abschnitte der Straße im vordersten Wege-Fenster auf der Karte: ihre Nummern, die gewählten leuchten (Leiste (W) (1) (2) …,
 * P6 Variante C; Betreiber 2026-10-19 am echten Fenster). Ein offenes Untermenü der Abschnitte geht vor; danach kommt dieses Bild zurück.
 */
const fensterAbschnitte = computed<AbschnitteBild | undefined>(() => {
    const id = wegeFenster.auswahl.value;
    const strasse = wegeFenster.bearbeitungVon(id)?.detail.value;
    if (id === undefined || strasse === undefined || strasse.segments.length < 2 || strasse.offMap || strasse.deleted)
        return undefined;
    const wahl = wegeFenster.abschnittsWahl(id);
    return { ids: strasse.segments.map((abschnitt) => abschnitt.id), hervor: wahl === null ? [] : [...wahl] };
});
/** Was der Straßen-Assistent (WI-0310) zeigt: Solange er etwas zeigt, geht es dem Bild des Wege-Fensters vor. */
const assistentBild = shallowRef<AbschnitteBild | undefined>(undefined);
watch(fensterAbschnitte, (bild) => {
    if (contextMenuAt.value === null) abschnitteLeuchten.zeige(assistentBild.value ?? bild);
});
/** Läuft gerade ein Modus der Wege (Wegkurve, Neuer Weg)? Dann gehören Esc und Strg+Z ihm, nicht den Feldern. */
const wegModusLaeuft = (): boolean => wegkurve.laufend.value !== undefined || neuerWeg.laufend.value !== undefined;
// Esc, Strg+Z und Strg+Y gelten der Bearbeitung der Felder, solange kein Modus der Form läuft (O3, R2, T44; nie im Textfeld).
escapeCascade.register("action", () =>
    laufenderEntwurf() === undefined && kammNetz.laufend.value === undefined ? landschaftseditor.esc() : false,
);
escapeCascade.register("action", () =>
    laufenderEntwurf() === undefined && !wegModusLaeuft() ? wegeFenster.esc() : false,
);
function landschaftTasten(event: KeyboardEvent): void {
    if (laufenderEntwurf() !== undefined) return;
    if (landschaftseditor.taste(event) || (!wegModusLaeuft() && wegeFenster.taste(event))) event.preventDefault();
}
document.addEventListener("keydown", landschaftTasten);
/**
 * Der Kraftlinien-Editor (WI-0205 K2, K6, K8 auf O3): je Linie ein Fenster mit EINEM Entwurf für Felder und Kurve (EDIT-0003 T44);
 * „Fertig“ schreibt `powerline.update_line`. Ohne Recht oder mit `MAP_EDITING` aus lesend.
 */
const kraftlinieneditor = createKraftlinieneditorSteuerung(werkzeugfenster, undefined, listenSchalter, {
    sperre: editorSperre,
    geaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision);
    },
    speicher: entwurfsSpeicher(),
    darfSchreiben: () => verbModus(EDITORPANEL, "kraftlinien", editorPanelRechte) === "bearbeiten",
});
/**
 * Der Gebietseditor (WI-0209 A3, B2): je Gebiet ein Fenster mit EINEM Entwurf (O3, EDIT-0003 T44); „Fertig“ schreibt `territory.update`.
 * Ohne Recht oder mit `MAP_EDITING` aus lesend. Esc, Strg+Z und Strg+Y wie bei der Landschaft.
 */
const gebietseditor = createGebietseditorSteuerung(werkzeugfenster, undefined, listenSchalter, {
    sperre: editorSperre,
    geaendert: (revision, gebiet) => {
        if (revision !== undefined) editRevision.advance(map, revision);
        // Das Infopanel liest das Gebiet neu (wie Orte und Wege): Ein neuer Name stand sonst nie dort (Betreiber 2026-10-19).
        if (gebiet !== undefined) subjects.auffrischen({ kind: "territory", id: gebiet });
    },
    speicher: entwurfsSpeicher(),
    darfSchreiben: () => verbModus(EDITORPANEL, "territorien", editorPanelRechte) === "bearbeiten",
});
escapeCascade.register("action", () => (laufenderEntwurf() === undefined ? gebietseditor.esc() : false));
/** Der Spracheditor (WI-0261 S5d2): je Sprache ein Fenster mit EINEM Entwurf der Felder; Teilflächen über das Geometrie-Modul. */
const spracheDarf = (): boolean => verbModus(EDITORPANEL, "sprachen", editorPanelRechte) === "bearbeiten";
const spracheditor = createSpracheditorFuerSeite({
    werkzeugfenster,
    listenSchalter,
    sperre: editorSperre,
    karte: () =>
        map && mapReady && interaction && camera.value ? { map, interaction, camera: camera.value } : undefined,
    geaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision, SPRACHEN_QUELLEN_NACH_ART.sprache);
    },
    speicher: entwurfsSpeicher(),
    darfSchreiben: spracheDarf,
    starteNeueFlaeche: (auftrag) => neueFlaeche.starte(auftrag),
    ansicht: (ziel) => hinflugAnsicht(ziel),
    leuchte: (schluessel) => sprachLeuchten.zeige(schluessel),
    fliege: (bounds) =>
        void camera.value?.showBounds(renderBox([...bounds]), {
            maxZoom: FLY_MAX_ZOOM,
            free: freiNebenWerkzeug("spracheditor"),
        }),
    melde: (text, ton) => showToast(text, ton),
    zeigeEditor: () => subjects.showEditor(),
});
escapeCascade.register("action", () => (laufenderEntwurf() === undefined ? spracheditor.esc() : false));
/**
 * Der Wetter-Editor (WI-0288 Stufe 3): EIN Fenster für Presets und Icons, ohne Entwurf; jede Änderung speichert sofort. Hier steht nur seine Hülle, die
 * Steuerung lädt nach (Besucherpaket, `wettereditor/wettereditor-huelle.ts`).
 */
const wettereditor = createWettereditorHuelle(
    {
        werkzeugfenster,
        darf: () => verbModus(EDITORPANEL, "wetter", editorPanelRechte) === "bearbeiten",
        reisebeginn: () => planner.options.departure,
        mitte: () => (map ? (freieMitte(map) ?? visibleArea?.centreLocation()) : undefined),
        fliege: (lngLat) => void camera.value?.showPoint(lngLat, camera.value.state().zoom),
        // Das gewählte Icon zeigt sein Infopanel im Hintergrund, die Lasche „Info“ holt es vor (wie die Wahl im Ortseditor, `still`). Ohne Wiki-Verweis
        // hat es keins; dann geht ein Infopanel eines anderen Icons zu, damit dort nicht das falsche steht.
        zeigeInfo: (symbol) => {
            const wiki = symbol.wikiTitel ?? "";
            if (wiki !== "")
                subjects.openSubject(
                    { kind: "wetterSymbol", id: symbol.id },
                    {
                        source: "link",
                        camera: "none",
                        still: true,
                        known: { title: wetterIconName({ name: symbol.name ?? "", wiki }), presentation: {} },
                    },
                );
            else if (subjects.selected.value?.kind === "wetterSymbol") subjects.closeSubject({ source: "link" });
        },
    },
    { laden: ladeWettereditor, geladen: wettereditorGeladen },
);
// Das Ziel „Sprache“ im Blatt „Fläche kopieren“ der Derographie (WI-0261, Betreiber 2026-10-31: „Ja, bauen“).
provide(SPRACH_KOPIE, spracheditor.kopieAusLandschaft);
/**
 * Die Sprachflächen im Kartenmenü (WI-0261 Stufe 1): ihre Handgriffe, „Neue Teilfläche“ und die Sprachen unter dem Rechtsklick; „Form ändern ›“,
 * „Mit anderer Fläche ›“ und „Unterflächen ›“ (Stufe 2 und 3) mit denselben Modi wie an der Fläche.
 */
const sprachMenue = createSprachKartenmenue({
    editor: spracheditor,
    lage: () => ({
        bearbeiten: ortseditor.bearbeiten.value,
        laeuft: ortHandgriffLage().laeuft || laufenderEntwurf() !== undefined,
    }),
    darf: spracheDarf,
    gezeigt: sprachenGezeigt,
    zeigeEditor: () => subjects.showEditor(),
    formen: () => ({
        verschieben: flaecheVerschieben,
        malen: flaecheMalen,
        vereinfachen: flaecheVereinfachen,
        zerschneiden,
        mitAnderer,
        unterflaechen,
    }),
});
/** Die Wetter-Icons im Kartenmenü (WI-0288): ihre Handgriffe und das Icon unter dem Rechtsklick, gebunden an den Wetter-Editor. */
const wetterMenue = createWetterKartenmenue({
    editor: wettereditor,
    lage: () => ({
        bearbeiten: ortseditor.bearbeiten.value,
        laeuft: ortHandgriffLage().laeuft || laufenderEntwurf() !== undefined,
    }),
    zeigeEditor: () => subjects.showEditor(),
});
// Was in den Listen der Editoren angehakt ist, leuchtet gelb auf der Karte (`map/mehrfach-markierung.ts`, Betreiber 2026-10-20); ein
// Umschalt-Klick auf ein Gebiet hakt es an oder ab, solange ein Gebietsfenster offen ist.
const mehrfachMarkierung = createMehrfachMarkierung();
folgeMehrfachauswahl(
    mehrfachMarkierung,
    "gebiete",
    "territory",
    () => gebietseditor.mehrfachauswahl.an.value,
    () => gebietseditor.mehrfachauswahl.angehakt.value,
);
folgeMehrfachauswahl(
    mehrfachMarkierung,
    "kraftlinien",
    "powerline",
    () => kraftlinieneditor.mehrfachAngehakt.value.length > 0,
    () => kraftlinieneditor.mehrfachAngehakt.value,
);
/** Was in den Bögen glüht: die gewählte Kraftlinie und die angehakten (ihre Namen; eine Linie ist ihr Name). */
const kraftlinienGlut = computed((): readonly string[] => {
    const namen = new Set<string>(selectedPowerline.value === undefined ? [] : [selectedPowerline.value]);
    const zeilen = kraftlinieneditor.liste.value?.rows ?? [];
    for (const anker of markiert(mehrfachMarkierung.stand.value, "powerline")) {
        const zeile = zeilen.find((row) => row.id === anker);
        if (zeile !== undefined) namen.add(zeile.name);
    }
    return [...namen];
});
mehrfachMarkierung.ziel("territory", {
    bereit: () => gebietseditor.fenster.value.some((eintrag) => eintrag.lage !== "versenkt"),
    umschalten: (id) => gebietseditor.mehrfachauswahl.umschalten(id),
    aufheben: () => {
        const war = gebietseditor.mehrfachauswahl.an.value || gebietseditor.mehrfachauswahl.angehakt.value.length > 0;
        if (war) gebietseditor.mehrfachauswahl.setzeAn(false);
        return war;
    },
});
// Die Wege wie die Kraftlinien (WI-0252): Ein Umschalt-Klick hakt die Straße des Abschnitts im vordersten sichtbaren Fenster an oder ab; was
// angehakt ist, leuchtet golden wie ein gewählter Weg.
folgeMehrfachauswahl(
    mehrfachMarkierung,
    "wege",
    "path",
    () => wegeFenster.markierung.value.length > 0,
    () => wegeFenster.markierung.value,
);
mehrfachMarkierung.ziel("path", {
    bereit: () => wegeFenster.umschaltBereit(),
    umschalten: (marke) => wegeFenster.umschalteAufKarte(marke),
    aufheben: () => wegeFenster.aufheben(),
});
// Kraftlinien hakt der Umschalt-Klick im vordersten sichtbaren Fenster an oder ab (Betreiber 2026-10-20: „umschalten soll eigentlich
// ermöglichen die einzelnen objekte auf der karte zusätzlich auszuwählen“). Landschaften, Gipfel und Orte melden ihr Ziel aus dem Fenster.
mehrfachMarkierung.ziel("powerline", {
    bereit: () => kraftlinieneditor.fenster.value.some((eintrag) => eintrag.lage !== "versenkt"),
    umschalten: (anker) => {
        const vorn = kraftlinieneditor.fenster.value.filter((eintrag) => eintrag.lage !== "versenkt").at(-1);
        if (vorn === undefined) return;
        const stand = kraftlinieneditor.mehrfachVon(vorn.id);
        kraftlinieneditor.setzeAngehakt(
            vorn.id,
            umschalteAufKarte({ an: stand.mehrfach, angehakt: stand.angehakt }, vorn.gegenstand, anker),
        );
        kraftlinieneditor.setzeMehrfach(vorn.id, true);
    },
    aufheben: () => {
        const an = kraftlinieneditor.fenster.value.filter((eintrag) => {
            const stand = kraftlinieneditor.mehrfachVon(eintrag.id);
            return stand.mehrfach || stand.angehakt.length > 0;
        });
        for (const eintrag of an) {
            kraftlinieneditor.setzeAngehakt(eintrag.id, []);
            kraftlinieneditor.setzeMehrfach(eintrag.id, false);
        }
        return an.length > 0;
    },
});
/**
 * 🔴 Die Mehrfachauswahl aufheben, für alle Editoren an EINER Stelle (Betreiber 2026-10-24, wörtlich: „ESC soll in allen fällen
 * mehrfachauswahlen wieder aufheben, auch ein klick ins leere oder woanders muss eine mehrfachauswahl aufheben.“; `mehrfach-markierung.ts`):
 * Esc in der Stufe `multi-selection` (nach offenen Menüs, laufenden Aktionen und dem Menü am Objekt), und jeder Klick ohne Umschalt in
 * die Karte, solange kein Modus läuft: ins Leere hebt er sie auf, auf ein Objekt ersetzt er sie durch dieses eine (der Klick wählt danach
 * wie immer). Klicks im Fenster sind keine Klicks in die Karte.
 */
escapeCascade.register("multi-selection", () => mehrfachMarkierung.hebeAuf());
// Mit dem Fokus im Werkzeugfenster (nach einem Haken in der Liste) erreicht Esc die Kaskade nicht: Dort geht die Auswahl vor dem Schließen.
provide(FENSTER_ESC_VORHER, () => mehrfachMarkierung.hebeAuf());
function klickHebtMehrfachAuf(umschalt: boolean | undefined): void {
    if (umschalt !== true && editorKlickFrei()) mehrfachMarkierung.hebeAuf();
}
/**
 * Ein Umschalt-Klick auf einen Ort, Gipfel oder eine Kraftlinie: `true`, wenn ein offenes Editor-Fenster ihn als Häkchen genommen hat.
 * Sonst fällt er im Koordinator durch zum Objekt darunter (`umschalt` der Besitzer, WI-0209).
 */
function umschaltNimmt(art: "place" | "peak" | "powerline", id: string): boolean {
    return editorKlickFrei() && mehrfachMarkierung.umschalteAufKarte(art, id);
}
/** Nimmt ein Editor den Klick auf die Karte (T34 (1))? Im Editor-Modus, solange kein Modus läuft. */
function editorKlickFrei(): boolean {
    return (
        editorNav !== undefined &&
        viewer.can("use_editor_menu") &&
        ecken.laufend.value === undefined &&
        flaecheVereinfachen.laufend.value === undefined &&
        flaecheVerschieben.laufend.value === undefined &&
        flaecheMalen.laufend.value === undefined &&
        gebietsform.laufend.value === undefined &&
        ortVerschieben.laufend.value === undefined &&
        ortSetzen.laufend.value === undefined &&
        wegkurve.laufend.value === undefined &&
        kraftlinieKurve.laufend.value === undefined &&
        kammNetz.laufend.value === undefined
    );
}
function gebietTasten(event: KeyboardEvent): void {
    if (laufenderEntwurf() === undefined && (gebietseditor.taste(event) || spracheditor.taste(event)))
        event.preventDefault();
}
document.addEventListener("keydown", gebietTasten);
/**
 * „Trotzdem schließen“ unter „Offene Bearbeitungen“ (WI-0231): Verwerfen nimmt dem Fenster seinen Entwurf mit Sperre und Sicherung, nicht nur
 * die Zeile; sonst stünde er nach dem Neuladen wieder da. Der Ortseditor hält seinen Entwurf im Fenster selbst, er geht mit ihm.
 */
const entwurfImFenster: Record<
    string,
    (id: string | undefined) => { antworte(wahl: "verwerfen"): Promise<void> } | undefined
> = {
    landschaftseditor: (id) => landschaftseditor.bearbeitungVon(id),
    wegeditor: (id) => wegeFenster.bearbeitungVon(id),
    kraftlinieneditor: (id) => kraftlinieneditor.bearbeitungVon(id),
    gebietseditor: (id) => gebietseditor.bearbeitungVon(id),
    spracheditor: (id) => spracheditor.bearbeitungVon(id),
};
werkzeugfenster.beimVerwerfen(
    (fenster) => void entwurfImFenster[fenster.werkzeug]?.(fenster.gegenstand)?.antworte("verwerfen"),
);
/**
 * Die Sperre der Orte (WI-0208): „Ort verschieben“ und die Entwürfe der Ortseditor-Fenster halten sie gemeinsam; frei wird ein Ort,
 * wenn keiner mehr hält. Hält ein anderer ihn, sagt der Satz wer, woran und seit wann.
 */
const ortSperre = {
    ort: createOrtSperre(editorSperre),
    gesperrt: (sperre: EditorLock) => `${sperrKopf(sperre)}. ${sperrDetail(sperre)}`,
    fehler: t("sperre.fehler"),
    verloren: t("sperre.verloren"),
    freigabeKonflikt: t("sperre.freigabe.grund.konflikt"),
};
/** Die Sperren der anderen an Landschaften, für Kartenmenü und Karte (S3); nur im Editor-Modus, im Takt des Herzschlags. */
const fremdeSperren = createFremdeSperren({
    sperre: editorSperre,
    art: "landscape",
    aktiv: () => editorNav !== undefined,
});
/** Dasselbe für Orte (WI-0215): Schild auf der Karte, Kasten im Kartenmenü, „Ort verschieben“ gesperrt. */
const fremdeOrtSperren = createFremdeSperren({
    sperre: editorSperre,
    art: "place",
    aktiv: () => editorNav !== undefined,
});
/** Dasselbe an Linien (WI-0205 K11, Anzeige): Wege und Kraftlinien, Spur und Schild auf der Karte, Kasten im Kartenmenü. */
const fremdeWegSperren = createFremdeSperren({
    sperre: editorSperre,
    art: "path",
    aktiv: () => editorNav !== undefined,
});
const fremdeKraftlinienSperren = createFremdeSperren({
    sperre: editorSperre,
    art: "powerline",
    aktiv: () => editorNav !== undefined,
});
const alleFremdenSperren = [fremdeSperren, fremdeOrtSperren, fremdeWegSperren, fremdeKraftlinienSperren];
/** Der Name des Gegenstands je Sperre, wie das Menü ihn zeigte (für den Hinweis nach „Aufheben“). */
const sperrNamen = new Map<string, string>();
/** Zeichnet den Kasten zur Sperre neu, solange das Kartenmenü offen steht (gesetzt, wenn es aufgeht). */
let kastenNeuZeichnen: (() => void) | undefined;
/**
 * Freigabe erbitten (WI-0262, OPS-000059), beim Bittenden: der Knopf im Kasten zur Sperre und der Stand der Anfrage; die Antwort kommt
 * als Meldung. Beim Inhaber: die Hinweise mit „Freigeben“ und „Später“ (Bitten kommen mit dem Herzschlag der Sperre, ohne eigenen Takt).
 */
const freigabeBitten = createFreigabeBitten({
    sperre: editorSperre,
    fremde: alleFremdenSperren,
    melde: (text, ton) => showToast(text, ton),
    name: (_kind, id) => sperrNamen.get(id),
    neu: () => kastenNeuZeichnen?.(),
});
const freigabeAnfragen = createFreigabeAnfragen({ sperre: editorSperre });
/** Der Kasten zur Sperre einer Fläche, eines Orts, eines Wegs oder einer Kraftlinie im Kartenmenü; für Admins mit Aufheben (EDIT-0003 §4). */
function sperrKastenVon(subject: EditorMenuSubject): SperrKastenInhalt | undefined {
    const ref = subject.ref;
    const gefunden =
        ref.kind === "area"
            ? { art: "landscape" as const, sperre: fremdeSperren.von(ref.id) }
            : ref.kind === "place"
              ? { art: "place" as const, sperre: fremdeOrtSperren.von(ref.id) }
              : ref.kind === "path"
                ? // Eine ganze Straße (nur `chain`) trägt keinen Abschnitt: kein Kasten.
                  {
                      art: "path" as const,
                      sperre: "anchor" in ref ? fremdeWegSperren.vonAbschnitt(ref.anchor) : undefined,
                  }
                : ref.kind === "powerline"
                  ? { art: "powerline" as const, sperre: fremdeKraftlinienSperren.vonAbschnitt(ref.anchor) }
                  : undefined;
    const sperre = gefunden?.sperre;
    if (gefunden === undefined || sperre === undefined) return undefined;
    const art = gefunden.art;
    sperrNamen.set(sperre.id, subject.title);
    return {
        kopf: sperrKopf(sperre),
        detail: sperrDetail(sperre),
        freigabe: freigabeBitten.kasten(sperre),
        frage: navRechte(viewer, authState.value).includes("manage_people")
            ? t("sperre.aufheben.frage", { wer: sperre.person.name })
            : undefined,
        ziel: { kind: art, id: sperre.id },
    };
}
/** Die Sperren anderer auf der Karte: Schraffur und Schild, beim Überfahren wer, seit wann und ab wann frei. */
function zeigeSperren(): void {
    // Je Art aus ihrer Liste: Eine Sperre steht nie zweimal da, auch wenn eine Antwort mehr nennt als ihre Art.
    const sperren = [
        // Mit „Auswahl isolieren“ nur die Schraffur der bearbeiteten Fläche (WI-0178); Orte, Wege und Kraftlinien bleiben.
        ...nurIsolierte(
            fremdeSperren.liste.value.filter((sperre) => sperre.kind === "landscape"),
            isolieren.flaeche.value,
            (sperre) => sperre.id,
        ),
        ...fremdeOrtSperren.liste.value.filter((sperre) => sperre.kind === "place"),
        ...fremdeWegSperren.liste.value.filter((sperre) => sperre.kind === "path"),
        ...fremdeKraftlinienSperren.liste.value.filter((sperre) => sperre.kind === "powerline"),
    ];
    sperreSchicht?.zeige(sperren, (sperre) => ({
        schild: sperrSchild(sperre),
        titel: `${sperrKopf(sperre)}. ${sperrDetail(sperre)}`,
    }));
}
watch(
    alleFremdenSperren.map((fremde) => fremde.liste),
    zeigeSperren,
);
// Eine andere Ebene der Karte zeigt andere Landschaften: Schraffur und Schilder folgen ihr.
watch([mapView, landscapeSelection], () => void nextTick(zeigeSperren));
/** „Freigabe erbitten“ im Kasten zur Sperre: Die Anfrage geht an den Inhaber; das Menü bleibt offen und zeigt ihren Stand. */
function bitteUmFreigabe(ziel: SperrKastenInhalt["ziel"]): void {
    const sperre = alleFremdenSperren.find((fremde) => fremde.art === ziel.kind)?.von(ziel.id);
    if (sperre !== undefined) void freigabeBitten.bitte(sperre);
}
/** „Aufheben“ im Kasten (nur Admins): Wer gesperrt hatte, verliert die Sperre beim nächsten Herzschlag; sein Entwurf bleibt. */
async function hebeSperreAuf(ziel: SperrKastenInhalt["ziel"]): Promise<void> {
    const name =
        sperrNamen.get(ziel.id) ??
        (ziel.kind === "place"
            ? (contextPlace?.name ?? "")
            : (contextFlaechen.find((flaeche) => flaeche.ref.kind === "area" && flaeche.ref.id === ziel.id)?.title ??
              ""));
    contextMenuAt.value = null;
    const ok = await editorSperre.hebeAuf(ziel);
    showToast(ok ? t("sperre.aufgehoben", { name }) : t("sperre.aufhebenFehler"), ok ? undefined : "warning");
    await Promise.all(alleFremdenSperren.map((fremde) => fremde.frisch()));
}
const ecken = createEckenFuerSeite({
    sperre: editorSperre,
    karte: () =>
        map && mapReady && interaction && camera.value ? { map, interaction, camera: camera.value } : undefined,
    ebenen: () => sichtbareEbenen(mapView.value, landscapeSelection.value),
    // EIN Entwurf (O3, T44): Der Modus hängt an der Bearbeitung der Landschaft und öffnet dabei ihr Fenster (D19).
    bearbeitung: (id) => {
        landschaftseditor.oeffneFuer(id);
        return landschaftseditor.bearbeitungVon(id);
    },
    gespeichert: (name) => showToast(t("landschaftseditor.ecken.gespeichert", { name }), "success"),
    getragen: (id) =>
        landschaftseditor.fenster.value.some((eintrag) => eintrag.gegenstand === id && eintrag.lage !== "versenkt"),
});
/**
 * „Auswahl isolieren“ in der Leiste „Ecken bearbeiten“ (WI-0178, Vali 2026-11-09): nur die bearbeitete Fläche, bis der Modus endet;
 * Andocken bleibt (`landschaftseditor/auswahl-isolieren.ts`). Der Stil filtert in `composeStyle`, die Schichten daneben hier.
 */
const isolieren = createAuswahlIsolieren({ laufend: () => ecken.laufend.value?.id, tasten: window });
watch(isolieren.flaeche, () => {
    zeigeVerborgene();
    zeigeSperren();
    zeigeEntwurfsflaechen();
});
/** „Fläche vereinfachen“ (WI-0233): am EINEN Entwurf der Landschaft wie „Ecken bearbeiten“, mit dem Regler der Wegkurve. */
const flaecheVereinfachen = createFlaecheVereinfachenFuerSeite({
    karte: () => (map && mapReady && camera.value ? { map, camera: camera.value } : undefined),
    ebenen: () => EDITOR_LANDSCAPE_LAYERS,
    bearbeitung: (id) => {
        ecken.beende();
        landschaftseditor.oeffneFuer(id);
        return landschaftseditor.bearbeitungVon(id);
    },
    getragen: (id) =>
        landschaftseditor.fenster.value.some((eintrag) => eintrag.gegenstand === id && eintrag.lage !== "versenkt"),
});
/** „Verschieben“ (WI-0178 Werkzeug 7): die Teilfläche unter dem Kartenmenü hängt an der Maus, abgesetzt im EINEN Entwurf der Landschaft. */
const flaecheVerschieben = createFlaecheVerschiebenFuerSeite({
    karte: () =>
        map && mapReady && camera.value && interaction ? { map, camera: camera.value, interaction } : undefined,
    ebenen: () => EDITOR_LANDSCAPE_LAYERS,
    bearbeitung: (id) => {
        ecken.beende();
        landschaftseditor.oeffneFuer(id);
        return landschaftseditor.bearbeitungVon(id);
    },
    getragen: (id) =>
        landschaftseditor.fenster.value.some((eintrag) => eintrag.gegenstand === id && eintrag.lage !== "versenkt"),
});
/** „Fläche malen“ und „Fläche radieren“ (WI-0178 Werkzeug 6): der Pinsel an der Teilfläche unter dem Kartenmenü, jeder Strich ein Schritt. */
const flaecheMalen = createFlaecheMalenFuerSeite({
    karte: () =>
        map && mapReady && camera.value && interaction ? { map, camera: camera.value, interaction } : undefined,
    ebenen: () => EDITOR_LANDSCAPE_LAYERS,
    bearbeitung: (id) => {
        ecken.beende();
        landschaftseditor.oeffneFuer(id);
        return landschaftseditor.bearbeitungVon(id);
    },
    getragen: (id) =>
        landschaftseditor.fenster.value.some((eintrag) => eintrag.gegenstand === id && eintrag.lage !== "versenkt"),
});
/** „Auf der Karte verschieben“ an einer Beschriftung (WI-0178 C4): ein Punkt im EINEN Entwurf der Fläche. */
const beschriftungZiehen = createBeschriftungZiehen({
    karte: () => (map && mapReady && interaction ? { map, interaction } : undefined),
    bearbeitung: (id) => {
        ecken.beende();
        landschaftseditor.oeffneFuer(id, "beschriftungen");
        return landschaftseditor.bearbeitungVon(id);
    },
    offen: (id) => landschaftseditor.bearbeitungVon(id) !== undefined,
    fangradius: () => startansicht().fangradius,
});
/** „Auf der Karte verschieben“ am Gipfel (WI-0178 P2): ein Punkt im EINEN Entwurf des Gipfels. */
const gipfelZiehen = createGipfelZiehen({
    karte: () => (map && mapReady && interaction ? { map, interaction } : undefined),
    bearbeitung: (gegenstand) => landschaftseditor.gipfelBearbeitungVon(gegenstand),
    offen: (gegenstand) => landschaftseditor.gipfelBearbeitungVon(gegenstand) !== undefined,
    fangradius: () => startansicht().fangradius,
});
/** „Kämme zeichnen“ (WI-0245 D2, EDIT-0003 §6 „Gebirgsnetz“): das Netz eines Gebirges im EINEN Entwurf der Landschaft. */
const kammNetz = createKammNetz({
    karte: () =>
        map && mapReady && interaction && camera.value ? { map, interaction, camera: camera.value } : undefined,
    bearbeitung: (id) => {
        ecken.beende();
        landschaftseditor.oeffneFuer(id);
        return landschaftseditor.bearbeitungVon(id);
    },
    getragen: (id) =>
        landschaftseditor.fenster.value.some((eintrag) => eintrag.gegenstand === id && eintrag.lage !== "versenkt"),
    fangradius: () => startansicht().fangradius,
    farben: () => {
        const stil = getComputedStyle(document.documentElement);
        return {
            kamm: stil.getPropertyValue("--color-edit-edge"),
            tal: stil.getPropertyValue("--color-profile-river"),
            gewaehlt: stil.getPropertyValue("--color-map-selection"),
            rand: stil.getPropertyValue("--color-panel"),
            // Die Höhen über den Punkten (WI-0249): eigene kräftig, die des Geländes blass.
            text: stil.getPropertyValue("--color-text-strong"),
            blass: stil.getPropertyValue("--color-text-muted"),
        };
    },
});
escapeCascade.register("action", () => kammNetz.abbrechen());
/**
 * „Gebietsform bearbeiten“ (WI-0209 C1): derselbe Formentwurf mit der Art Gebiet (`map/geometrie/formentwurf.ts`); an einem abgeleiteten
 * Gebiet bearbeitet er die Baronie unter dem Klickpunkt (`gebietPunkt`). Geschrieben wird mit C2.
 */
const gebietsform = createGebietsformFuerSeite({
    sperre: editorSperre,
    karte: () =>
        map && mapReady && interaction && camera.value ? { map, interaction, camera: camera.value } : undefined,
    // EIN Entwurf (O3, T44; WI-0209 B2): Der Modus hängt an der Bearbeitung des Gebiets und öffnet dabei sein Fenster (D19).
    bearbeitung: (id) => {
        gebietseditor.oeffneFuer(id);
        return gebietseditor.bearbeitungVon(id);
    },
    gespeichert: (name) => showToast(t("landschaftseditor.ecken.gespeichert", { name }), "success"),
    ausstehend: (flaechen) => ausstehendeGebiete.merke(flaechen),
});
/**
 * „Unterpolygone löschen …“ im Kartenmenü (OPS-000075, `gebietseditor/gebiet-teile.ts`): Die Teile der Fläche eines Gebiets unter dem Rechtsklick werden
 * beim Öffnen des Menüs gelesen, danach baut es sich noch einmal; Zeigen einer Zeile lässt genau diesen Teil rot leuchten. Geschrieben wird mit dem
 * vorhandenen `territory.update`, ↺ in „Änderungen“ holt den Teil zurück. Jede neue Kachelrevision macht das Gelesene alt.
 */
const gebietTeile = createGebietTeile();
const gebietTeileLeuchten = createGebietTeileLeuchten(() => (mapReady ? map : undefined));
editRevision.hoere(() => gebietTeile.vergiss());
/** Das Untermenü von „Unterpolygone löschen …“ meldet Eintrag und Zeile; der gezeigte (sonst der vorgewählte) Teil leuchtet rot. */
function zeigeTeile(eintrag: string | undefined, unter: string | undefined): void {
    const einziges = gebietGeklickt?.ids.length === 1 ? gebietGeklickt.ids[0] : undefined;
    const gemeint = leuchtendeWahl(unter, eintrag, einziges);
    gebietTeileLeuchten.zeige(gemeint === undefined ? undefined : gebietTeile.umriss(gemeint.gebiet, gemeint.wahl));
}
/** Die gewählte Zeile: Der Teil geht sofort (EINE Operation), die Karte zeigt die geschriebene Fläche, bis die Ableitung sie zeichnet. */
async function gebietTeilLoeschen(id: string, wahl: string): Promise<void> {
    const antwort = await gebietTeile.loesche(id, wahl);
    if (!antwort.ok) {
        showToast(antwort.satz, "warning");
        return;
    }
    if (antwort.quittung.mapRevision !== undefined) editRevision.advance(map, antwort.quittung.mapRevision);
    ausstehendeGebiete.merke([antwort.flaeche]);
    showToast(t("gebietseditor.unterpolygone.geloescht", { name: antwort.name }), "success");
}
/** „Zoombänder bearbeiten“ im Reiter „Hierarchie“ (WI-0209 D2): ein Entwurf über die Spannen mehrerer Gebiete, „Fertig“ schreibt EINE Operation. */
const zoombaender = createZoombaenderFuerSeite({
    sperre: editorSperre,
    lage: () => ortHandgriffLage(),
    geaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision);
    },
    gespeichert: () => gebietseditor.neuLaden(),
    karte: () => (map && mapReady ? map : undefined),
});
/** „Entfernen“ eines Gebiets (WI-0209 D3): über die Steuerung, danach der Hinweis. */
async function gebietEntfernen(
    id: string,
    stage: "off_map" | "retire",
    children: "up" | "along" | "root" | undefined,
): Promise<{ ok: true } | { ok: false; satz: string }> {
    const name = gebietseditor.bearbeitungVon(id)?.detail.value?.name ?? "";
    const antwort = await gebietseditor.entferne(id, stage, children);
    if (antwort.ok)
        showToast(
            t(stage === "off_map" ? "gebietseditor.entfernen.genommen" : "gebietseditor.entfernen.geloescht", { name }),
            "success",
        );
    return antwort;
}
watch(zoombaender.meldung, (meldung) => {
    if (meldung === undefined) return;
    const { text, ton } = zoombandHinweis(meldung);
    showToast(text, ton);
});
/** Die Entwürfe der Seite (Fläche, Gebiet, Zoombänder); höchstens einer läuft, und Leiste, Esc und Strg+Z gelten ihm. */
const formentwuerfe = [
    ecken,
    gebietsform,
    zoombaender,
    flaecheVereinfachen,
    flaecheVerschieben,
    flaecheMalen,
    spracheditor.form,
] as const;
const laufenderEntwurf = () => formentwuerfe.find((entwurf) => entwurf.laufend.value !== undefined);
escapeCascade.register("action", () => laufenderEntwurf()?.abbrechen() ?? false);
watch(ecken.meldung, (meldung) => {
    if (meldung === undefined) return;
    const { text, ton } = eckenHinweis(meldung);
    showToast(text, ton);
});
watch(gebietsform.meldung, (meldung) => {
    if (meldung === undefined) return;
    const { text, ton } = formHinweis(meldung, { ladefehler: "gebietseditor.form.ladefehler" });
    showToast(text, ton);
});
/** Strg+Z und Strg+Y (Mac ⌘) im Entwurf, nie in einem Textfeld (T27 (7), `entwurfsTaste`). */
function entwurfTasten(event: KeyboardEvent): void {
    const entwurf = laufenderEntwurf();
    if (entwurf?.laufend.value?.phase !== "bereit") return;
    const taste = entwurfsTaste(event);
    if (taste === undefined) return;
    event.preventDefault();
    if (taste === "wieder") entwurf.wieder();
    else entwurf.zurueck();
}
document.addEventListener("keydown", entwurfTasten);
/**
 * Wo zuletzt Gebiete angeklickt wurden (Kartenmenü, Doppelklick): An einem abgeleiteten Gebiet führt „Gebietsform bearbeiten“ zur
 * Baronie darunter (T23 Frage 2). Sonst der Anker der Auswahl, wenn das Gebiet gewählt ist.
 */
let gebietGeklickt: { ids: readonly string[]; at: MapPoint } | undefined;
function gebietPunkt(id: string): MapPoint | undefined {
    if (gebietGeklickt?.ids.includes(id) === true) return gebietGeklickt.at;
    const auswahl = areaSelection.value;
    return auswahl?.kind === "territory" && auswahl.id === id ? auswahl.anchor : undefined;
}

meldeQuelle(() => werkzeugfenster.stand.value.fenster.some((fenster) => fenster.ungespeichert)); // „Neu laden“ fragt dann nach (WI-0136)
/**
 * 🔴 EINE Rechnung der freien Fläche für jeden Hinflug aus einem Editor (WI-0128 E7, WI-0218 Nachbesserung, `editor-panel/hinflug.ts`):
 * Ziel ist die Mitte der Karte, die nach der Landung frei ist - neben den Panels UND dem Fenster des Editors. Gemessen wird hier, wo das
 * DOM ist; Orte, Wege, Landschaften, Herrschaftsgebiete und Kraftlinien rufen alle diese Stelle.
 */
function freiNachLandungFuer(ziel: Ziellage): Insets {
    if (!map) return NO_INSETS;
    return freiFuer(ziel, {
        karte: map.getContainer(),
        bedeckt: () => visibleArea?.covered() ?? NO_INSETS,
        gezeichnet: (id) => {
            const fenster = werkzeugfenster.stand.value.fenster.find((x) => x.id === id);
            return fenster ? document.querySelector<HTMLElement>(`[data-testid="${fenster.werkzeug}-${id}"]`) : null;
        },
        einzug: (id) => listenSchalter.einzug(id),
    });
}
/**
 * Die freie Fläche neben dem vordersten sichtbaren Editorfenster, gleich welches Werkzeug (die Überlagerung der Änderungen, WI-0265 B6d: Sie fliegt aus dem Detail eines Verlaufs in
 * einem Fenster); ohne eines deckt nur das Editorpanel.
 */
function freiNebenVorderstemFenster(): Insets {
    const offen = werkzeugfenster.stand.value.fenster
        .filter((fenster) => fenster.lage !== "versenkt")
        .sort((a, b) => b.vorn - a.vorn)[0];
    return freiNachLandungFuer(
        offen ? { lage: offen.lage, box: offen.box, id: offen.id, werkzeug: offen.werkzeug } : { lage: "versenkt" },
    );
}
/** Die freie Fläche neben dem vordersten sichtbaren Fenster eines Werkzeugs; ohne eines deckt nur das Editorpanel. */
function freiNebenWerkzeug(werkzeug: string): Insets {
    const offen = werkzeugfenster.stand.value.fenster
        .filter((fenster) => fenster.werkzeug === werkzeug && fenster.lage !== "versenkt")
        .sort((a, b) => b.vorn - a.vorn)[0];
    return freiNachLandungFuer(
        offen ? { lage: offen.lage, box: offen.box, id: offen.id, werkzeug } : { lage: "versenkt", werkzeug },
    );
}
/**
 * Ein Klick auf der Karte hat ein Editorfenster geöffnet oder ihm einen Gegenstand gegeben (WI-0218 Nachbesserung; Betreiber 2026-10-17
 * über die Orchestrierung: „ok, aber beachte dass bei angedockten editoren ein klick auf die ziel objekte ebenfalls nicht in der
 * bildmitte erfolgen sollen“). Liegt die Stelle des Klicks danach unter dem Fenster, holt die Kamera sie sanft in die Mitte der freien
 * Fläche; liegt sie frei, bewegt sich nichts. Zoom, Drehung und Neigung bleiben (`onlyIfCovered`).
 */
function holeGeklicktesHervor(werkzeug: string, options: { anchor?: { x: number; y: number } }): void {
    const kamera = camera.value;
    if (!map || !mapReady || !kamera || options.anchor === undefined) return;
    const leinwand = map.getCanvas().getBoundingClientRect();
    const stelle = map.unproject([options.anchor.x - leinwand.left, options.anchor.y - leinwand.top]);
    void kamera.showPoint([stelle.lng, stelle.lat], kamera.state().zoom, {
        free: freiNebenWerkzeug(werkzeug),
        onlyIfCovered: true,
    });
}
/** Die Ansicht eines Hinflugs der Editoren (EDIT-0003 T32 (1)): EINE Stelle für jeden Editor, „Politisch“ nur mit Gebieten. */
const hinflugAnsicht = createAnsichtWechsel({
    view: mapView,
    landscape: landscapeSelection,
    politischBereit: () => territoriesReady.value,
});
/**
 * Umgekehrt folgt die gewählte Kachel der Karteninhalte der Ansicht der Karte, beim Öffnen eines Links und bei jedem Wechsel über den
 * Fächer (Betreiber 2026-10-19, `kachelFuerAnsicht`). Nur im Bereich „Karteninhalte“ und nur, wenn die Kachel nicht schon passt: Die
 * Wahl einer Kachel stellt die Ansicht und landet hier bei derselben Kachel, nichts schaukelt.
 */
const kachelJeAnsicht = new Map<MapView, string>();
/**
 * Nennt die Adresse selbst eine Ansicht (`#view=…` oder Legacys Parameter), folgt die Kachel eines `?tab=` ihr. Sonst stellt die Kachel
 * aus dem Link beim Laden die Ansicht wie ein Klick auf sie: `?tab=landschaftseditor` öffnet auf „Landschaften“, `?tab=kraftlinieneditor`
 * auf „Kraftlinien“ (Basislinie des Optimierers 2026-10-19: vorher setzte die Wache die Kachel aus dem Link auf die der Standardansicht
 * zurück).
 */
const ansichtVerlinkt =
    readViewChoices(addressHash, seriesIds).view !== undefined || initialView.view !== DEFAULT_VIEW.view;
watch(
    [mapView, () => editorNav?.gewaehlt(null)],
    ([ansicht, bereich], vorher) => {
        if (editorNav === undefined || bereich !== "karteninhalte") return;
        const jetzt = editorNav.gewaehlt("karteninhalte");
        // Der erste Lauf (`immediate`): Vue reicht bei mehreren Quellen `[]` als alten Wert, nicht `undefined`.
        if (vorher?.[0] === undefined && editorNav.ausLink && !ansichtVerlinkt) {
            const ausLink = kachelGruppen(editorPanelRechte)
                .flatMap((gruppe) => gruppe.kacheln)
                .find((kachel) => kachel.id === jetzt && kachel.gebaut)?.ansicht;
            if (ausLink !== undefined && ausLink.view !== ansicht) {
                hinflugAnsicht(ausLink);
                // „Politisch“ ohne Gebiete bleibt, wo es ist; dann gilt die Kachel aus dem Link trotzdem.
                return;
            }
        }
        // Die Kachel der Ansicht, die gerade geht, bleibt gemerkt: zurück auf „Standard“ stehen wieder die Wege, nicht die Orte.
        if (vorher?.[0] !== undefined && jetzt !== undefined) kachelJeAnsicht.set(vorher[0], jetzt);
        const ziel = kachelFuerAnsicht(ansicht, jetzt, editorPanelRechte, kachelJeAnsicht.get(ansicht));
        if (ziel !== undefined && ziel !== jetzt) editorNav.waehle(ziel);
    },
    { immediate: true },
);
/** Die gelbe Auswahl eines Editors endet mit seinem letzten Fenster und mit seiner Kachel (`editor-panel/editor-auswahl.ts`). */
if (editorNav !== undefined) {
    const nav = editorNav;
    watch(
        () => werkzeugfenster.stand.value.fenster.map((fenster) => fenster.werkzeug),
        (jetzt, vorher) => {
            if (auswahlEndetMitFenster(subjects.selected.value?.kind, zugegangen(vorher, jetzt)))
                subjects.closeSubject();
        },
    );
    watch(
        () => nav.gewaehlt("karteninhalte"),
        (jetzt, vorher) => {
            if (jetzt !== vorher && auswahlEndetMitKachel(subjects.selected.value?.kind, vorher))
                subjects.closeSubject();
        },
    );
}
/**
 * Die Landschaftsliste stellt die Karte auf die Ebene der Landschaft (EDIT-0003 T32 (1), F17): schon der Einfachklick wechselt die
 * Ansicht, ohne Flug; Doppelklick und Enter fliegen dazu zum Rahmen der Flächen.
 */
function landschaftAnsicht(id: string | undefined): void {
    // Ein Gipfel steht in der Topographie (P3).
    const ebene =
        gipfelVon(id) !== undefined
            ? "topographie"
            : landschaftseditor.liste.value?.rows.find((zeile) => zeile.id === id)?.layer;
    if (ebene !== undefined) hinflugAnsicht(ansichtFuerHinflug({ art: "landschaft", ebene }));
}
function waehleLandschaft(id: string | undefined, fensterId?: string): void {
    landschaftseditor.waehle(id, fensterId);
    landschaftAnsicht(id);
    const zeile = landschaftseditor.liste.value?.rows.find((x) => x.id === id);
    markiereInListe(zeile && { art: "landschaft", ...zeile });
}
/**
 * Ein Klick in der Liste eines Editors lässt das Objekt auf der Karte aufleuchten wie ein Klick auf das Objekt selbst (WI-0218 Nachbesserung,
 * `editor-panel/listenwahl.ts`: EIN Weg für Landschaften, Gebiete, Wege und Kraftlinien; die Ortsliste wählt schon so).
 */
function markiereInListe(wahl: Listenwahl | undefined): void {
    if (!map || !mapReady || wahl === undefined) return;
    const oeffnung = listenOeffnung(map, wahl);
    if (oeffnung !== undefined) subjects.openSubject(oeffnung.ref, oeffnung.options);
}
function fliegeZuLandschaft(bounds: [number, number, number, number]): void {
    landschaftAnsicht(landschaftseditor.auswahl.value);
    // Der Zoom kommt aus der Ausdehnung der Fläche in der freien Fläche (WI-0218 Nachbesserung; Betreiber 2026-10-17 über die
    // Orchestrierung: „wär gut, wenn sich die zoomstufe beim doppeltklicken auf eine fläche an der größe der fläche orientiert, sodass sie
    // schön im sichtfeld ist“). Gedeckelt nur wie jeder Flug auf der höchsten Flugstufe; bis dahin stand hier Stufe 4 der Suche
    // (`SEARCH_FIT_MAX_ZOOM.landschaft`), und ein kleines Tal blieb „total winzig“.
    void camera.value?.showBounds(renderBox(bounds), {
        maxZoom: FLY_MAX_ZOOM,
        free: freiNebenWerkzeug("landschaftseditor"),
    });
}
/** Doppelklick und Enter an einem Gipfel der Liste (P3): hin zu seinem Punkt, so nah wie ein Landschaftstreffer der Suche. */
function zeigeGipfel(x: number, y: number): void {
    landschaftAnsicht(landschaftseditor.auswahl.value);
    void camera.value?.showPoint(renderPosition({ x, y }), SEARCH_FIT_MAX_ZOOM.landschaft, {
        free: freiNebenWerkzeug("landschaftseditor"),
    });
}
/** Die Kraftlinienliste stellt die Karte auf die Ansicht „Kraftlinien“ (F17, T32), schon beim Einfachklick, ohne Flug. */
function waehleKraftlinie(id: string | undefined, fensterId?: string): void {
    kraftlinieneditor.waehle(id, fensterId);
    if (id !== undefined) hinflugAnsicht(ansichtFuerHinflug({ art: "kraftlinie" }));
    const zeile = kraftlinieneditor.liste.value?.rows.find((x) => x.id === id);
    markiereInListe(zeile && { art: "kraftlinie", id: zeile.id, name: zeile.name });
}
/** „zeigen“ am Nodix im Fenster: hin zu diesem Punkt. */
function zeigeKraftlinienPunkt(x: number, y: number): void {
    void camera.value?.showPoint(renderPosition({ x, y }), SEARCH_FIT_MAX_ZOOM.weg, {
        free: freiNebenWerkzeug("kraftlinieneditor"),
    });
}
/** Die Gebietsliste stellt die Karte auf „Politisch“ (F17, T32), schon beim Einfachklick, ohne Flug. */
function waehleGebiet(id: string | undefined, fensterId?: string, reiter?: GebietReiter): void {
    gebietseditor.waehle(id, fensterId, reiter);
    if (id !== undefined) hinflugAnsicht(ansichtFuerHinflug({ art: "herrschaftsgebiet" }));
    const zeile = gebietseditor.liste.value?.rows.find((x) => x.id === id);
    markiereInListe(zeile && { art: "gebiet", ...zeile });
}
function fliegeZuGebiet(bounds: [number, number, number, number]): void {
    hinflugAnsicht(ansichtFuerHinflug({ art: "herrschaftsgebiet" }));
    // Wie die Landschaft: der Zoom aus der Ausdehnung (WI-0218 Nachbesserung).
    void camera.value?.showBounds(renderBox(bounds), {
        maxZoom: FLY_MAX_ZOOM,
        free: freiNebenWerkzeug("gebietseditor"),
    });
}
/** Klick auf eine Bandspalte im Reiter „Hierarchie“ (D2): die Karte zeigt dieses Band, in der Ansicht „Politisch“. */
function zeigeGebietsband(band: number): void {
    hinflugAnsicht(ansichtFuerHinflug({ art: "herrschaftsgebiet" }));
    const kamera = camera.value;
    if (kamera !== undefined) kamera.zoomBy(zoomFuerBand(band) - kamera.state().zoom);
}
function fliegeZuKraftlinie(bounds: [number, number, number, number]): void {
    hinflugAnsicht(ansichtFuerHinflug({ art: "kraftlinie" }));
    void camera.value?.showBounds(renderBox(bounds), {
        maxZoom: SEARCH_FIT_MAX_ZOOM.weg,
        free: freiNebenWerkzeug("kraftlinieneditor"),
    });
}
/** Die Wegeliste stellt die Karte auf „Standard“ (F17, T32), schon beim Einfachklick, ohne Flug. */
function waehleWeg(id: string | undefined, fensterId?: string): void {
    wegeFenster.waehle(id, fensterId);
    if (id !== undefined) hinflugAnsicht(ansichtFuerHinflug({ art: "weg" }));
    if (id !== undefined) holeWegWennVerdeckt(id);
    const zeile = wegeFenster.liste.value?.rows.find((x) => x.id === id);
    markiereInListe(zeile && { art: "weg", ...zeile });
}
/** Ein geteilter Abschnitt im Wege-Fenster (WI-0302): das Fenster an seiner eigenen Straße, dort genau dieser Abschnitt gewählt. */
function oeffneGeteiltenAbschnitt(anker: string, abschnitt: string, fensterId: string): void {
    waehleWeg(anker, fensterId);
    wegeFenster.ganzerWeg(anker);
    wegeFenster.schalteAbschnitt(anker, abschnitt);
}
/**
 * Ein Klick in der Wege-Liste holt den Weg in die freie Fläche, wenn er ganz oder fast ganz verdeckt ist (Betreiber 2026-10-19 „Ja,
 * wenn verdeckt (Empfehlung)“, `weg-verdeckt.ts`); sonst steht die Karte (EDIT-0001 D17). Bleibt neben Fenster und Panels keine Lücke,
 * fliegt nichts: Dort wäre der Weg auch danach verdeckt.
 */
function holeWegWennVerdeckt(id: string): void {
    const bounds = wegeFenster.liste.value?.rows.find((x) => x.id === id)?.bounds;
    if (!map || !mapReady || bounds === undefined) return;
    const leinwand = map.getCanvas();
    const groesse = { width: leinwand.clientWidth, height: leinwand.clientHeight };
    const frei = freiNebenWerkzeug("wegeditor");
    if (!leavesGap(groesse, frei)) return;
    const karte = map;
    const [a, b] = renderBox(bounds);
    const ecken = [a, b, [a[0], b[1]], [b[0], a[1]]].map((ecke) => karte.project(ecke as [number, number]));
    const rahmen = {
        left: Math.min(...ecken.map((p) => p.x)),
        top: Math.min(...ecken.map((p) => p.y)),
        right: Math.max(...ecken.map((p) => p.x)),
        bottom: Math.max(...ecken.map((p) => p.y)),
    };
    if (istVerdeckt(rahmen, visibleRect(groesse, frei))) fliegeZuWeg(bounds);
}
function fliegeZuWeg(bounds: [number, number, number, number]): void {
    hinflugAnsicht(ansichtFuerHinflug({ art: "weg" }));
    void camera.value?.showBounds(renderBox(bounds), {
        maxZoom: SEARCH_FIT_MAX_ZOOM.weg,
        free: freiNebenWerkzeug("wegeditor"),
    });
}
const ortseditorHinflug: OrtseditorHinflug = {
    zeige(ort, ziel, optionen) {
        const kamera = camera.value;
        if (!map || !mapReady || !kamera || ort.x === undefined || ort.y === undefined) return Promise.resolve(false);
        // Vor dem Flug: Der Ort landet in der Ansicht, in der er zu sehen ist.
        if (optionen?.ansicht) hinflugAnsicht(optionen.ansicht);
        const frei = freiNachLandungFuer(ziel);
        // `zoomBleibt`: Der jetzige Zoom ist die Mindestnähe, `showPoint` holt also nicht heran (nach dem Verschieben, Betreiber
        // 2026-10-11). `immer`: auch zentrieren, wenn der Ort schon frei sichtbar ist.
        const nah = optionen?.zoomBleibt === true ? kamera.state().zoom : nearZoomOf(ort);
        return kamera.showPoint(renderPosition({ x: ort.x, y: ort.y }), nah, {
            free: frei,
            onlyIfHidden: optionen?.immer !== true,
        });
    },
};
/** Wo ein Fenster steht, als Ziel eines Flugs (E7); ein unbekanntes gilt als abgelegt: Dann deckt nur das Editorpanel. */
function ziellageVonFenster(fensterId: string): Ziellage {
    const offen = werkzeugfenster.stand.value.fenster.find((x) => x.id === fensterId && x.lage !== "versenkt");
    return offen ? { lage: offen.lage, box: offen.box, id: offen.id, werkzeug: offen.werkzeug } : { lage: "versenkt" };
}
const ortseditor = createOrtseditorSteuerung(
    subjects,
    werkzeugfenster,
    verbModus(EDITORPANEL, "orte", editorPanelRechte) !== "bearbeiten",
    ortseditorHinflug,
    listenSchalter,
);
const ortseditorDaten = createOrtseditorDaten();
/**
 * Das Fenster „Inhalte bearbeiten“ (WI-0254): EIN Werkzeugfenster für Quellen, Literatur, Vorkommen und Korpora. Das Verb eines dieser
 * Karteninhalte im Editorpanel öffnet es mit dem eigenen Reiter vorn (`inhalteReiterWunsch`); ist es schon offen, wechselt es nur den Reiter.
 * ✕ und Escape legen es mit ungespeicherten Änderungen ab (`schliesse`), ohne sie verwerfen es nie.
 */
const inhalteWerkzeug = computed(() =>
    werkzeugfenster.stand.value.fenster.find((fenster) => fenster.werkzeug === INHALTE_WERKZEUG),
);
const inhalteOffen = computed({
    get: () => inhalteWerkzeug.value !== undefined,
    set: (auf: boolean) => {
        if (!auf && inhalteWerkzeug.value) werkzeugfenster.schliesse(inhalteWerkzeug.value.id);
    },
});
const inhalteSchreibt = computed(() => verbModus(EDITORPANEL, "quellen", editorPanelRechte) === "bearbeiten");
function oeffneInhalte(reiter: InhalteReiter = reiterAus(editorNav?.gewaehlt("karteninhalte"))): void {
    inhalteReiterWunsch.value = reiter;
    werkzeugfenster.oeffne(
        {
            werkzeug: INHALTE_WERKZEUG,
            gegenstand: INHALTE_GEGENSTAND,
            titel: t("inhalte.titel"),
            nurLesen: !inhalteSchreibt.value,
        },
        "geloest",
    );
}
/** „Quelle öffnen“ in den Quellen eines Orts oder Gebiets (WI-0254 §12): das Fenster „Inhalte bearbeiten“ am Reiter Quellen, diese Quelle gewählt. */
function oeffneInhalteQuelle(sourceId: string): void {
    inhalteQuelleWunsch.value = sourceId;
    oeffneInhalte("quellen");
}
/** Das Verb im Editorpanel und ein Tiefer Link öffnen ein Werkzeug über diese EINE Stelle, für alle fünf gleich. */
function oeffneWerkzeug(werkzeug: string): void {
    if (werkzeug === "landschaftseditor") landschaftseditor.oeffneWerkzeug();
    else if (werkzeug === "kraftlinieneditor") kraftlinieneditor.oeffneWerkzeug();
    else if (werkzeug === "wegeditor") wegeFenster.oeffneWerkzeug();
    else if (werkzeug === "gebietseditor") gebietseditor.oeffneWerkzeug();
    else if (werkzeug === "spracheditor") spracheditor.oeffneWerkzeug();
    else if (werkzeug === "wettereditor") wettereditor.oeffneWerkzeug();
    else if (werkzeug === INHALTE_WERKZEUG) oeffneInhalte();
    else ortseditor.oeffneWerkzeug();
}
// Die Vorgänge der Community (WI-0268 C3, `community/redaktion-anbindung.ts`): Bezug zeigen und im Editor öffnen.
if (editorNav) {
    verbindeRedaktion({
        fenster: werkzeugfenster,
        selection: subjects,
        kamera: () => camera.value,
        bereit: whenMapReady,
        oeffneWerkzeug,
        zeigeMeldungen: (unterreiter) => {
            subjects.showEditor();
            editorNav.waehle(unterreiter ?? "meldungen");
        },
    });
}
/**
 * Ein Tiefer Link auf ein Werkzeug öffnet sein Fenster (WI-0218 Nachbesserung, EDIT-0001 §3.2; Zuteilung der Orchestrierung 2026-10-17,
 * für alle fünf gleich): Endet der Pfad aus `?tab=` auf einem Werkzeug (`?tab=landschaftseditor`, `?tab=gebietseditor` …), geht es auf
 * wie über das Verb. `?tab=ortseditor&place=<…>` öffnet den Ortseditor an diesem Ort, nachdem der Objektlink ihn aufgelöst und angeflogen
 * hat (`ortWerkzeugAusLink`, unten). Der Link wird nur gelesen, nie geschrieben (`editor-panel/editor-panel-nav.ts`); am Telefon öffnet er
 * wie das Panel nichts.
 */
const werkzeugAusLink: string | undefined =
    editorNav?.ausLink === true && !phoneViewport.value
        ? editorNav.pfad.value.filter((id) => editorWerkzeuge.has(id)).at(-1)
        : undefined;
const ortAusLink = werkzeugAusLink === "ortseditor" && new URLSearchParams(addressSearch).has("place");
if (werkzeugAusLink !== undefined && !ortAusLink) oeffneWerkzeug(werkzeugAusLink);
/** `?tab=ortseditor&place=…`: Der Objektlink hat den Ort gewählt und angeflogen; jetzt steht der Ortseditor an ihm. */
function ortWerkzeugAusLink(): void {
    const ort = subjects.selected.value;
    if (!ortAusLink || ort?.kind !== "place") return;
    ortseditor.oeffneFuer(ort.id);
    subjects.showEditor();
}
/** Die Zahlen der Kacheln „Karteninhalte“ (WI-0212): aus den Listen der Editoren und des Inhalte-Fensters, sonst einmal selbst geholt. */
const karteninhaltZahlen = createKarteninhaltZahlen({
    orte: ortseditor.liste,
    landschaften: landschaftseditor.liste,
    kraftlinien: kraftlinieneditor.liste,
    wege: wegeFenster.liste,
    herrschaftsgebiete: gebietseditor.liste,
    sprachen: spracheditor.liste,
    ...inhalteListen,
    wetter: wettereditor.bestand,
});
/**
 * „✥ Ort verschieben“ (WI-0128 E12, EDIT-0001 §4.4): ein Modus zur Zeit, auf dem Geometrie-Modul (`map/geometrie/ort.ts`, WI-0177
 * Stufe 4: dieselbe Hülle, derselbe Kringel, derselbe Fangradius wie die anderen Editoren), der Hinflug
 * zielt in die freie Fläche ohne den eingeklappten Ortseditor; nach dem Speichern lädt die Ortsliste neu. Die Kacheln folgen mit der
 * Kachelrevision (E13). Esc bricht ab, solange nichts gesendet ist (Stufe `action` der Kaskade).
 */
const ortVerschieben = createOrtVerschieben({
    api: ortseditorDaten,
    sperre: ortSperre,
    // Erst beim Fehler gefragt: Der Satz liegt im späten Teil der Tafel (`i18n/spaete-texte.ts`), ein Besucher lädt ihn sonst beim Aufbau mit.
    get ladefehler() {
        return t("ortseditor.verschieben.ladefehler");
    },
    karte: {
        // Das Fenster bleibt angedockt, nur seine Liste zieht ein (Liste beim Modus): gezielt wird neben das Fenster.
        zeige(start, fenster) {
            void ortseditorHinflug.zeige(
                { x: start.von.x, y: start.von.y, subtype: start.subtype },
                ziellageVonFenster(fenster),
            );
        },
        ein(start, losgelassen) {
            if (!map || !mapReady || !interaction) return undefined;
            return installOrtVerschieben(map, interaction, {
                start,
                losgelassen,
                fangradius: () => startansicht().fangradius,
                werkzeug: "ortseditor",
            });
        },
        geaendert(revision) {
            ortseditor.ladeListe();
            if (revision !== undefined) editRevision.advance(map, revision);
        },
        /**
         * Nach der Quittung sanft auf die neue Lage, der Zoom bleibt (Betreiber 2026-10-11: „schön wärs auch wenn nach dem
         * verschieben die ansicht auf die neue position des ortes zentriert“). In die freie Fläche neben dem Fenster, das
         * gerade wieder aufgeht; bei Abbruch und Konflikt ruft `ort-verschieben.ts` das hier gar nicht erst.
         */
        zentriere(punkt, fensterId) {
            // 🪤 Erst im nächsten Bild: In diesem Augenblick ist das Fenster noch eingeklappt und meldet sich nicht als Rand.
            // Die Kamera misst beim Start ihres Flugs die Panels; sie soll den Ortseditor messen, wie er gleich dasteht, und
            // nicht den, der gerade verschwindet.
            void nextTick(() =>
                ortseditorHinflug.zeige({ x: punkt.x, y: punkt.y }, ziellageVonFenster(fensterId), {
                    immer: true,
                    zoomBleibt: true,
                }),
            );
        },
    },
});
escapeCascade.register("action", () => ortVerschieben.abbrechen());
// „Wegkurve bearbeiten“ (WI-0177): Die Anbindung trägt alles; gestartet wird am Rechtsklick auf einen Weg (W2). Die Kurve ist die Form
// im EINEN Entwurf der Straße (W5b Schritt 3): Der Start öffnet ihr Fenster, „Fertig“ schreibt `path.update`.
const wegkurve = createWegkurveFuerSeite(
    {
        karte: () => (mapReady ? map : undefined),
        interaction: () => interaction,
        camera: () => camera.value,
        geaendert: (revision) => editRevision.advance(map, revision, WEGE_QUELLEN),
        sperre: editorSperre,
        griffMenue: (griff) => oeffneGriffMenue(griff),
        bearbeitung: (abschnitt) => {
            subjects.showEditor();
            return wegeFenster.bearbeitungFuer(abschnitt);
        },
        ebenen: () => sichtbareEbenen(mapView.value, landscapeSelection.value),
    },
    wegeFenster,
);
escapeCascade.register("action", () => wegkurve.abbrechen());
// „Neuer Weg“ (WI-0177, EDIT-0003 T40 (3)): Zeichnen ab einem Ort oder einer Stelle; danach öffnet das Wege-Fenster den neuen Weg.
const neuerWeg = createNeuerWegFuerSeite({
    karte: () => (mapReady ? map : undefined),
    interaction: () => interaction,
    geaendert: (revision) => editRevision.advance(map, revision, WEGE_QUELLEN),
    geoeffnet: (publicId) => {
        subjects.showEditor();
        wegeFenster.oeffneFuer({ anchor: publicId });
    },
    view: mapView,
    layer: landscapeSelection,
});
escapeCascade.register("action", () => neuerWeg.abbrechen());
// „Weg entfernen …“ (WI-0177 Stufe 3): das Blatt mit den zwei Stufen; „Ganz löschen“ ist weich (`path.delete`).
const wegEntfernen = createWegEntfernen(createWegeditorDaten());
/** Nach „Weg entfernen …“: die Meldung, die Karte und die Liste des Wege-Fensters neu. */
function wegEntfernt(name: string, wahl: WegEntfernenWahl, revision: number | undefined, wege?: number): void {
    if (wege !== undefined) {
        // Die Mehrfachauswahl (WI-0252) ist erledigt: Die Wege sind gelöscht oder abseits der Karte, die Sammelansicht läse sie nicht mehr.
        wegeFenster.aufheben();
        const fall =
            wahl === "loeschen" ? "wegeditor.entfernen.auswahl.fertig" : "wegeditor.entfernen.auswahl.abgenommen";
        showToast(tPlural(fall, wege, { n: String(wege) }), "success");
    } else {
        const satz = wahl === "loeschen" ? "wegeditor.entfernen.fertig" : "wegeditor.entfernen.abgenommen";
        showToast(t(satz, { name }), "success");
    }
    if (revision !== undefined) editRevision.advance(map, revision, WEGE_QUELLEN);
    wegeFenster.neuLaden();
}
/** „Zurück auf die Karte“ am genommenen Abschnitt (Stufe 3b); danach zeigt das Wege-Fenster ihn auf der Karte. */
async function wegZurueck(abschnitt: { id: string; revision: number }, name: string): Promise<void> {
    const antwort = await wegEntfernen.zurueck(abschnitt.id, abschnitt.revision);
    if (!antwort.ok) {
        showToast(antwort.fehler.message, "warning");
        return;
    }
    showToast(t("wegeditor.zurueck.fertig", { name }), "success");
    if (antwort.quittung.mapRevision !== undefined)
        editRevision.advance(map, antwort.quittung.mapRevision, WEGE_QUELLEN);
    wegeFenster.neuLaden();
    wegeFenster.oeffneFuer({ anchor: abschnitt.id });
}
// „Kurve bearbeiten“ (WI-0205 K8 auf O3): die Form der Linie an die Bearbeitung ihres Fensters; Esc, Strg+Z und Strg+Y gelten der
// Kurve, sonst der Bearbeitung der Felder, solange kein anderer Modus der Form läuft (R2, T44; nie im Textfeld).
const kraftlinieKurve = createKraftlinieKurveFuerSeite(
    { karte: () => (mapReady ? map : undefined), interaction: () => interaction, camera: () => camera.value },
    kraftlinieneditor,
);
escapeCascade.register(
    "action",
    () => kraftlinieKurve.laufend.value?.esc() ?? (laufenderEntwurf() === undefined ? kraftlinieneditor.esc() : false),
);
function kraftlinieTasten(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const kurve = kraftlinieKurve.laufend.value;
    const taste = kurve === undefined ? undefined : entwurfsTaste(event);
    if (kurve !== undefined && taste !== undefined) {
        event.preventDefault();
        if (taste === "wieder") kurve.wieder();
        else kurve.zurueck();
        return;
    }
    if (kurve === undefined && laufenderEntwurf() === undefined && kraftlinieneditor.taste(event))
        event.preventDefault();
}
document.addEventListener("keydown", kraftlinieTasten);
/** „Kurve bearbeiten“ an einer Linie (Handgriff, Doppelklick, Knopf im Fenster): erst ihr Fenster, dann die Form an die Karte. */
async function kurveAn(anker: string): Promise<void> {
    const bearbeitung = await kraftlinieneditor.oeffneFuer(anker);
    if (bearbeitung !== undefined) await kraftlinieKurve.starte(bearbeitung);
}
// „Neue Kraftlinie“ (WI-0205 K9): ab einem Nodix bis zum nächsten; danach öffnet das Kraftlinien-Fenster die neue Linie.
const neueKraftlinie = createNeueKraftlinieFuerSeite({
    karte: () => (mapReady ? map : undefined),
    interaction: () => interaction,
    geaendert: (revision) => {
        editRevision.advance(map, revision);
        kraftlinieneditor.ladeListe();
    },
    geoeffnet: (publicId) => {
        subjects.showEditor();
        void kraftlinieneditor.oeffneFuer(publicId);
    },
    view: mapView,
    layer: landscapeSelection,
});
escapeCascade.register("action", () => neueKraftlinie.abbrechen());
// „Neue Fläche“ (C3, `map/geometrie/neue-flaeche.ts`): EIN Anlegen-Ablauf für Derographie und Herrschaftsgebiete; die Andockungen reichen
// ihre Einstiege. Er stellt die Ansicht der Art ein und sperrt sie; nach „Fertig“ bleibt sie, nach einem Abbruch geht es zurück (T47).
const neueFlaeche = createNeueFlaecheFuerSeite({
    karte: () => (mapReady ? map : undefined),
    interaction: () => interaction,
    view: mapView,
    layer: landscapeSelection,
    // Eine Teilfläche einer Sprache zeichnet, wer Sprachen schreibt (`edit_languages`, auch der Linguist); die übrigen Arten nach ihrem Fach.
    grund: (andockung) => zeichenGrund(andockung.id === "sprache" ? "sprache" : undefined),
    geaendert: (revision) => editRevision.advance(map, revision),
});
escapeCascade.register("action", () => neueFlaeche.abbrechen());
/** Die Füllebenen der Landschaften und des wählbaren Wassers, die der Stil gerade trägt (Ziele von „Mit anderer Fläche ›“). */
const landschaftsFuellungen = (): string[] =>
    flaechenEbenenImStil(
        (map?.getStyle().layers ?? []).map((schicht) => schicht.id),
        areaLayersInView(mapView.value, landscapeSelection.value),
    );
// „Mit anderer Fläche ›“ (WI-0178 Werkzeug 1, Thomas 4.1): die andere Fläche auf der Karte wählen, sofort geschrieben, ↺ im Verlauf.
/** Nach einem Werkzeug an Flächen (1, 3, 5): Kachelrevision, offene Fenster der berührten Landschaften und die Liste neu. */
function flaecheGeschrieben(quittung: { mapRevision?: number | undefined }, regionen: readonly string[]): void {
    if (quittung.mapRevision !== undefined) editRevision.advance(map, quittung.mapRevision, DEROGRAPHIE_QUELLEN);
    for (const id of regionen) void landschaftseditor.bearbeitungVon(id)?.neuLesen();
    landschaftseditor.ladeListe();
}
const mitAnderer = createMitAnderer({
    karte: () => (map && mapReady && interaction ? { map, interaction } : undefined),
    flaechenEbenen: landschaftsFuellungen,
    geschrieben: (quittung, regionen) => {
        flaecheGeschrieben(quittung, regionen);
        showToast(t("landschaftseditor.mitAnderer.gespeichert", { name: quittungsName(quittung) }), "success");
    },
    melde: (text, ton) => showToast(text, ton),
});
escapeCascade.register("action", () => mitAnderer.abbrechen());
// „Unterflächen ›“ (WI-0178 Werkzeug 3, Thomas 4.1): vereinigen sofort, herauslösen und löschen über die Wahl eines Stücks, ↺ im Verlauf.
const unterflaechen = createUnterflaechen({
    karte: () => (map && mapReady && interaction ? { map, interaction } : undefined),
    geschrieben: flaecheGeschrieben,
    melde: (text, ton) => showToast(text, ton),
});
escapeCascade.register("action", () => unterflaechen.abbrechen());
// „Zerschneiden“ (WI-0178 Werkzeug 5, Betreiber 2026-10-19): die Schnittlinie im Modus „Anlegen“, „Fertig“ schneidet, ↺ im Verlauf.
const zerschneiden = createZerschneiden({
    karte: () => (map && mapReady && interaction ? { map, interaction } : undefined),
    fangradius: () => startansicht().fangradius,
    geschrieben: flaecheGeschrieben,
    melde: (text, ton) => showToast(text, ton),
});
escapeCascade.register("action", () => zerschneiden.abbrechen());
/**
 * Die Mehrfachauswahl der Derographie (EDIT-0003 T57): der Sammel-Entwurf des Fensters mit zwei oder mehr angehakten Landschaften. Seine
 * Leiste steht wie die einer Landschaft; Esc fragt bei Ungeschriebenem. Nach „Fertig“ lesen Kacheln, Fenster und Liste neu.
 */
const landschaftSammel = shallowRef<SammelEntwurf<LandschaftSammelFelder> | undefined>(undefined);
function sammelGeschrieben(quittung: {
    mapRevision?: number | undefined;
    affected: readonly { kind: string; id: string }[];
}): void {
    flaecheGeschrieben(
        quittung,
        quittung.affected.filter((x) => x.kind === "landscape").map((x) => x.id),
    );
}
escapeCascade.register("action", () => {
    const sammel = landschaftSammel.value;
    if (sammel === undefined || laufenderEntwurf() !== undefined) return false;
    if (!sammel.lage.value.aktiv && !sammel.lage.value.frage) return false;
    sammel.esc();
    return true;
});
/** „Kopieren“ im Blatt (WI-0178 Werkzeug 8): schreiben, Kacheln nachführen, und der Hinweis nennt Zielebene und Landschaft (Legacy). */
async function kopiereFlaeche(
    id: string,
    areaId: string,
    ziel: KopierZiel,
): Promise<{ ok: true } | { ok: false; satz: string }> {
    const antwort = await landschaftseditor.kopiere(id, areaId, ziel);
    if (!antwort.ok) return antwort;
    const key = `layer.${ziel.layer}`;
    const ebene = isMessageKey(key) ? t(key) : ziel.layer;
    showToast(
        t(ziel.deleteSource ? "landschaftseditor.kopieren.umgezogen" : "landschaftseditor.kopieren.kopiert", {
            ebene,
            name: antwort.quittung.name ?? "",
        }),
        "success",
    );
    return { ok: true };
}
/** Der Name der ersten Landschaft einer Quittung, wie die Liste ihn kennt. */
function quittungsName(quittung: { affected: readonly { kind: string; id: string }[] }): string {
    const id = quittung.affected.find((x) => x.kind === "landscape")?.id;
    return landschaftseditor.liste.value?.rows.find((row) => row.id === id)?.name ?? "";
}
/** Die Teilfläche dieser Landschaft unter der Stelle des Kartenmenüs; ohne Treffer keine. */
function teilflaecheAn(regionId: string): { areaId: string; name: string } | undefined {
    if (!map || !contextPoint) return undefined;
    const p = toRenderLngLat(space, contextPoint);
    for (const f of map.queryRenderedFeatures(map.project([p.lng, p.lat]), { layers: landschaftsFuellungen() })) {
        const areaId = f.properties["public_id"];
        if (f.properties["region_public_id"] === regionId && typeof areaId === "string")
            return { areaId, name: String(f.properties["name"] ?? "") };
    }
    return undefined;
}
/**
 * Warum diese Sitzung keine neue Fläche zeichnen darf (beide Rechte und `MAP_EDITING`, wie „Neuer Weg“); ohne Grund darf sie. Die Rechte hängen am Fach (WI-0279): Ohne Angabe
 * genügt eines der zwei Fächer, die Handlung selbst prüft ihres. Eine Sprache verlangt nur das Recht an den Sprachen, nie die Form der Derographie.
 */
function zeichenGrund(fach?: "gebiet" | "flaeche" | "sprache") {
    const lage = ortHandgriffLage();
    if (fach === "sprache") return spracheDarf() ? modusGrund(lage.bearbeiten) : GRUND_SPRACHE;
    const hat = (recht: string): boolean => lage.rechte.includes(recht);
    const gebiet = hat("edit_territories") && hat("edit_territory_form");
    const flaeche = hat("edit_landscapes") && hat("edit_landscape_form");
    const darf = fach === "gebiet" ? gebiet : fach === "flaeche" ? flaeche : gebiet || flaeche;
    if (darf) return modusGrund(lage.bearbeiten);
    return fach === "gebiet" ? GRUND_GEBIET : fach === "flaeche" ? GRUND_FLAECHE : "ortseditor.handgriff.grund.recht";
}
// Die Herrschaftsgebiete an „Neue Fläche“ (WI-0209 C3): neues Gebiet, Untergebiet, Grenze; danach öffnet der Gebietseditor das Gebiet.
const gebietAnlegen = createGebietAnlegenFuerSeite({
    karte: () => (mapReady ? map : undefined),
    starte: (auftrag) => neueFlaeche.starte(auftrag),
    gebieteBereit: () => territoriesReady.value,
    oeffne: (publicId) => {
        subjects.showEditor();
        gebietseditor.neuLaden();
        gebietseditor.oeffneFuer(publicId);
    },
    ausstehend: (flaeche) => ausstehendeGebiete.merke([flaeche]),
});
// „Hier hinzufügen › Neuer Kraftlinienpunkt“ (WI-0205 K9, R7): an der Stelle des Menüs, danach zeichnet die Karte ihn.
const kraftlinienpunkt = createKraftlinienpunktSetzen({
    daten: createKraftlinienDaten(),
    geaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision);
    },
    melde: (text, ton) => showToast(text, ton),
});
// „Hier hinzufügen › ▲ Landmarke setzen › <Art>“ (WI-0271 L4, Kartenmenü A): ein Punkt an der Stelle des Menüs, gespeichert mit „Fertig“
// (G4); danach das Fenster der neuen Landmarke mit markiertem Namen.
const landmarkeSetzen = createLandmarkeSetzen({
    karte: () => (map && mapReady && interaction ? { map, interaction } : undefined),
    daten: createGipfelDaten(),
    fangradius: () => startansicht().fangradius,
    geaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision, DEROGRAPHIE_QUELLEN);
    },
    gesetzt: (neu) => landschaftseditor.gipfelGesetzt(neu),
    melde: (text, ton) => showToast(text, ton),
});
escapeCascade.register("action", () => landmarkeSetzen.verwerfe());
/** „● Auf der Karte setzen“ an einem Landmarken-Kandidaten (WI-0271 L7): das Setzen in der Mitte der freien Fläche, mit Art und Namen des Artikels; „Fertig“ legt die Landmarke an. */
function setzeKandidat(kandidat: EditorLandmarkenKandidat): void {
    if (!map) return;
    const [lng, lat] = visibleArea?.centreLocation() ?? [map.getCenter().lng, map.getCenter().lat];
    landmarkeSetzen.starte(kandidat.art, fromRenderLngLat(space, { lng, lat }), {
        id: kandidat.id,
        name: kandidat.name,
    });
}
/** „● Fläche zeichnen“ an einem Wiki-Eintrag ohne Fläche (WI-0284): die gewöhnliche Zeichnung, die erste Ecke setzt der erste Klick; gespeichert hängt sie am Artikel. */
function zeichneWikiEintrag(eintrag: EditorWikiEintrag): void {
    void neueFlaeche.starte({
        andockung: derographieAndockung(eintrag.layer, {
            zusatz: UntergrundRegler,
            wikiEintrag: eintrag.id,
            geoeffnet: (neu) => landschaftseditor.angelegt(neu),
        }),
    });
}
// Beschriftungen anlegen, duplizieren, löschen und zurücksetzen (WI-0232, `landschaftseditor/beschriftung-anlegen.ts`).
const beschriftungen = createBeschriftungen({
    steuerung: landschaftseditor,
    geaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision, DEROGRAPHIE_QUELLEN);
    },
    melde: (text, ton) => showToast(text, ton),
    zoom: () => map?.getZoom() ?? 0,
});
// „Kraftlinienpunkt entfernen“ (WI-0205 K10, EDIT-0003 T52): weich, nur ohne Linie; danach zeichnet die Karte ohne ihn.
const kraftlinienpunktWeg = createKraftlinienpunktEntfernen({
    daten: createKraftlinienDaten(),
    geaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision);
    },
    melde: (text, ton) => showToast(text, ton),
});
// „Kraftlinienpunkt verschieben“ (WI-0205 K5): die Punkt-Art des Geometrie-Moduls, die Bahnen folgen; Esc vor dem Loslassen bricht ab.
const kraftlinienpunktZug = createKraftlinienpunktVerschiebenFuerSeite({
    karte: () => (mapReady ? map : undefined),
    interaction: () => interaction,
    gegenueber: (id) => powerlineArcs?.gegenueberAm(id) ?? [],
    geaendert: (revision) => {
        if (revision !== undefined) editRevision.advance(map, revision);
    },
});
escapeCascade.register("action", () => kraftlinienpunktZug.abbrechen());
// Ein Modus der Form aus einem angedockten Fenster zieht dessen Liste ein und stellt sie am Ende wieder her (EDIT-0003, Regel 7, „Liste
// beim Modus“): EINMAL für alle Modi des Geometrie-Moduls, die ihr Werkzeug nennen (Wegkurve, Ort verschieben, Ecken, Kurve der
// Kraftlinie, Grenzen; `map/geometrie/besitzer.ts`). Gemeint ist das vorderste Fenster dieses Werkzeugs. Die Zoombänder (WI-0209 D2)
// sind kein Modus des Moduls und nennen ihr Fenster selbst.
const angedockt = (id: string): boolean =>
    werkzeugfenster.stand.value.fenster.some((offen) => offen.id === id && offen.lage === "angedockt");
const modusFenster = (): string | undefined => {
    const werkzeug = geometrieModus.value?.werkzeug;
    if (werkzeug === undefined) return undefined;
    return werkzeugfenster.stand.value.fenster
        .filter((offen) => offen.werkzeug === werkzeug)
        .sort((x, y) => x.vorn - y.vorn)
        .at(-1)?.id;
};
const stopListeImModus = [
    listeImModus(listenSchalter, modusFenster, angedockt),
    listeImModus(
        listenSchalter,
        () => (zoombaender.laufend.value === undefined ? undefined : gebietseditor.fenster.value.at(-1)?.id),
        angedockt,
    ),
];
/**
 * „Kraftlinie entfernen“ bestätigt (T39, K10: von der Karte nehmen oder ganz löschen) und „Zurück auf die Karte“ oder „Zurückholen“:
 * der Wechsel, die Meldung, die Karte neu.
 */
const kraftlinieEntferntGerade = ref(false);
const KRAFTLINIE_WECHSEL_TEXT = {
    "powerline.take_off_map": "kraftlinieneditor.meldung.abgenommen",
    "powerline.retire": "kraftlinieneditor.meldung.entfernt",
    "powerline.put_on_map": "kraftlinieneditor.meldung.zurueck",
    "powerline.restore": "kraftlinieneditor.meldung.geholt",
} as const;
async function wechsleKraftlinie(wechsel: () => ReturnType<typeof kraftlinieneditor.zurueck>): Promise<void> {
    if (kraftlinieEntferntGerade.value) return;
    kraftlinieEntferntGerade.value = true;
    const ergebnis = await wechsel();
    kraftlinieEntferntGerade.value = false;
    if (!ergebnis.ok) {
        showToast(ergebnis.satz, "warning");
        return;
    }
    showToast(t(KRAFTLINIE_WECHSEL_TEXT[ergebnis.wechsel], { name: ergebnis.name }), "success");
    if (ergebnis.mapRevision !== undefined) editRevision.advance(map, ergebnis.mapRevision);
}
/** „✚ Nodix anfügen“ aus dem Kartenmenü: das Fenster der Linie öffnet den Kasten (`mal` zählt die Wünsche). */
const kraftlinieAnfuegen = shallowRef<{ anker: string; mal: number }>({ anker: "", mal: 0 });
/** Nodix herausnehmen (R5) an einer Linie: ihr Fenster, die Kurve, der Schritt; geht es nicht, sagt ein Hinweis warum. */
async function nimmAusKraftlinie(anker: string, knoten: string): Promise<void> {
    const bearbeitung = await kraftlinieneditor.oeffneFuer(anker);
    if (bearbeitung === undefined) return;
    const ergebnis = await kraftlinieKurve.nimmHeraus(bearbeitung, knoten);
    if (ergebnis === "letzter") showToast(t("kraftlinieneditor.meldung.letzter"), "warning");
}
/** Nodix anfügen an einer Linie: ohne Ziel nur die Kurve (damit die Nodices laden), mit Ziel der Schritt. */
async function fuegeAnKraftlinie(anker: string, von: string, nach: string | undefined): Promise<void> {
    const bearbeitung = await kraftlinieneditor.oeffneFuer(anker);
    if (bearbeitung === undefined) return;
    if (nach === undefined) await kraftlinieKurve.starte(bearbeitung);
    else await kraftlinieKurve.fuegeAn(bearbeitung, von, nach);
}
/**
 * Einen Ort auf die Karte setzen, der noch nicht dort steht (WI-0128 E16): Ziehen aus der Liste oder „● Auf der Karte setzen“ und ein
 * Klick. Danach öffnet er sich im Ortseditor, die Liste und die Kacheln folgen; Esc beendet den wartenden Modus.
 */
const ortSetzen = createOrtSetzen({
    api: ortseditorDaten,
    sperre: ortSperre,
    // Erst beim Fehler gefragt: Der Satz liegt im späten Teil der Tafel (`i18n/spaete-texte.ts`), ein Besucher lädt ihn sonst beim Aufbau mit.
    get ladefehler() {
        return t("ortseditor.verschieben.ladefehler");
    },
    karte: {
        ein(gesetzt) {
            if (!interaction) return undefined;
            return installPlaceSet(interaction, gesetzt);
        },
        geaendert(revision) {
            ortseditor.ladeListe();
            if (revision !== undefined) editRevision.advance(map, revision);
        },
    },
    gesetzt(fenster, id) {
        if (fenster !== undefined) ortseditor.oeffneOrt(fenster, id);
        else ortseditor.oeffneFuer(id);
    },
});
escapeCascade.register("action", () => ortSetzen.abbrechen());
const stopSetzMeldung = watch(ortSetzen.meldung, (meldung) => {
    if (meldung?.art === "gesetzt") showToast(t("ortseditor.setzen.gesetzt", { name: meldung.name }), "success");
    else if (meldung?.art === "abgelehnt") showToast(meldung.satz, "warning");
});
const ortSetzenZeile = (key: string) => ortseditor.liste.value?.rows.find((row) => row.key === key);
let removePlaceDrop: (() => void) | undefined;
/**
 * Die Handgriffe (EDIT-0002 §6, EDIT-0003 G10; Schritt O1): EIN Register (`editor-menu/`) für das Menü am Objekt, den Abschnitt im
 * Kartenmenü und die Gruppe im Infopanel; je Objektart eine Datei (heute der Ort, `handgriffe-ort.ts`). Ohne `MAP_EDITING` mit Sperrgrund
 * („ausgeschaltet“, D23). „Eigenschaften bearbeiten“ und „Ort verschieben“ öffnen den Ort im Ortseditor (die Lasche „Editor“ kommt nach
 * vorn), „Verbergen“ schreibt sofort.
 */
const ortHandgriffLage = () => ({
    rechte: editorPanelRechte,
    bearbeiten: ortseditor.bearbeiten.value,
    laeuft:
        ortVerschieben.laufend.value !== undefined ||
        ecken.laufend.value !== undefined ||
        flaecheVereinfachen.laufend.value !== undefined ||
        flaecheVerschieben.laufend.value !== undefined ||
        flaecheMalen.laufend.value !== undefined ||
        gebietsform.laufend.value !== undefined ||
        zoombaender.laufend.value !== undefined ||
        wegkurve.laufend.value !== undefined ||
        neuerWeg.laufend.value !== undefined ||
        neueKraftlinie.laufend.value !== undefined ||
        neueFlaeche.laufend.value !== undefined ||
        gipfelZiehen.laufend.value !== undefined ||
        landmarkeSetzen.laufend.value !== undefined ||
        kammNetz.laufend.value !== undefined,
    sperreVon: (id: string) => fremdeOrtSperren.von(id),
});
const ortWirkung: OrtWirkung = {
    bearbeiten(id) {
        subjects.showEditor();
        ortseditor.oeffneFuer(id);
    },
    verschieben(id) {
        subjects.showEditor();
        void ortVerschieben.starte(ortseditor.oeffneFuer(id), id);
    },
    verbergen(id, ja) {
        void verbergen(ortseditorDaten, id, ja, undefined, t("ortseditor.handgriff.ladefehler")).then((ergebnis) => {
            if (!ergebnis.ok) {
                showToast(ergebnis.satz, "warning");
                return;
            }
            const satz = ja ? "ortseditor.handgriff.verborgen" : "ortseditor.handgriff.gezeigt";
            showToast(t(satz, { name: ergebnis.name, revision: String(ergebnis.revision) }), "success");
            if (ergebnis.mapRevision !== undefined) editRevision.advance(map, ergebnis.mapRevision);
            ortseditor.ladeListe();
        });
    },
};
/** „Verbergen“ und „Zurückholen“ an einer Landschaft (T41 (4)): sofort geschrieben, der Hinweis nennt Name und Revision, wie am Ort. */
function verbirgLandschaft(id: string, ja: boolean): void {
    void landschaftseditor.verberge(id, ja).then((ergebnis) => {
        if (!ergebnis.ok) {
            showToast(ergebnis.satz, "warning");
            return;
        }
        const satz = ja ? "landschaftseditor.griff.verborgen" : "landschaftseditor.griff.gezeigt";
        showToast(t(satz, { name: ergebnis.name, revision: String(ergebnis.revision) }), "success");
    });
}
/**
 * Die Modi der Form im Entwurf einer Landschaft (EDIT-0003 T58 (3)): Läuft einer, gehen die anderen an derselben Landschaft weiter. Der
 * Wechsel beendet den laufenden, ohne zu verwerfen (`beende` hängt nur die Form ab), der neue übernimmt den Formentwurf der Bearbeitung,
 * und ↶ ↷ gehen über den Wechsel hinweg.
 */
const flaechenFormmodi = [ecken, flaecheVereinfachen, flaecheVerschieben, flaecheMalen] as const;
function formWechsel(regionId: string): void {
    for (const modus of flaechenFormmodi) if (modus.laufend.value?.id === regionId) modus.beende();
}
// Die Fläche (WI-0178 A4, `editor-menu/handgriffe-flaeche.ts`): „Beschriftung …“ öffnet den Landschaftseditor an ihr.
const handgriffListe = editorNav
    ? [
          ...ortHandgriffe(ortHandgriffLage, ortWirkung),
          ...flaecheHandgriffe(
              () => ({
                  rechte: editorPanelRechte,
                  bearbeiten: ortseditor.bearbeiten.value,
                  laeuft:
                      ortVerschieben.laufend.value !== undefined ||
                      ecken.laufend.value !== undefined ||
                      flaecheVereinfachen.laufend.value !== undefined ||
                      flaecheVerschieben.laufend.value !== undefined ||
                      flaecheMalen.laufend.value !== undefined ||
                      gebietsform.laufend.value !== undefined ||
                      wegkurve.laufend.value !== undefined ||
                      neuerWeg.laufend.value !== undefined ||
                      neueKraftlinie.laufend.value !== undefined ||
                      neueFlaeche.laufend.value !== undefined ||
                      mitAnderer.laufend.value !== undefined ||
                      unterflaechen.laufend.value !== undefined ||
                      zerschneiden.laufend.value !== undefined ||
                      kammNetz.laufend.value !== undefined,
                  formmodusAn: (id) => flaechenFormmodi.some((modus) => modus.laufend.value?.id === id),
                  sperreVon: (id) => fremdeSperren.von(id),
                  verborgen: (id) => verborgeneFlaechen?.hat(id) === true,
                  beschriftungGrund: (id) => beschriftungGrund(landschaftseditor.liste.value, id),
                  gebirge: (id) =>
                      landschaftseditor.liste.value?.rows.some(
                          (row) => row.id === id && row.layer === "topographie" && row.type === "gebirge",
                      ) === true,
              }),
              {
                  oeffnen: (id) => {
                      subjects.showEditor();
                      landschaftseditor.oeffneFuer(id);
                  },
                  beschriftung: (id) => landschaftseditor.oeffneFuer(id, "beschriftungen"),
                  ecken: (id) => {
                      formWechsel(id);
                      void ecken.starte(id);
                  },
                  vereinfachen: (id) => {
                      formWechsel(id);
                      void flaecheVereinfachen.starte(id);
                  },
                  platz: (id, wohin) => {
                      subjects.showEditor();
                      landschaftseditor.aendere(id, (felder) => ({ ...felder, platz: wohin }));
                  },
                  klicksperre: (id) => {
                      subjects.showEditor();
                      landschaftseditor.aendere(id, (felder) => ({ ...felder, gesperrt: true }));
                  },
                  entfernen: (id) => {
                      subjects.showEditor();
                      landschaftseditor.oeffneEntfernen(id);
                  },
                  verbergen: verbirgLandschaft,
                  beschriftungNeu: (id) => void beschriftungen.neuHier(id, contextPoint),
                  mitAnderer: (id, operation) => {
                      const quelle = teilflaecheAn(id);
                      if (quelle !== undefined) mitAnderer.starte({ regionId: id, ...quelle, operation });
                  },
                  zerschneiden: (id) => {
                      const quelle = teilflaecheAn(id);
                      if (quelle !== undefined) void zerschneiden.starte({ regionId: id, areaId: quelle.areaId });
                  },
                  verschieben: (id) => {
                      const griff = contextPoint;
                      const quelle = teilflaecheAn(id);
                      if (quelle === undefined || griff === undefined) return;
                      formWechsel(id);
                      void flaecheVerschieben.starte(id, quelle.areaId, griff);
                  },
                  malen: (id, art) => {
                      const quelle = teilflaecheAn(id);
                      if (quelle === undefined) return;
                      formWechsel(id);
                      void flaecheMalen.starte(id, quelle.areaId, art);
                  },
                  kopieren: (id) => {
                      const quelle = teilflaecheAn(id);
                      if (quelle === undefined) return;
                      subjects.showEditor();
                      landschaftseditor.oeffneKopieren(id, quelle.areaId);
                  },
                  unterflaechen: (id, operation) => {
                      const punkt = contextPoint;
                      const quelle = teilflaecheAn(id);
                      if (quelle === undefined) return;
                      if (operation === "vereinigen")
                          void unterflaechen.vereinige({ regionId: id, areaId: quelle.areaId });
                      else void unterflaechen.starte({ regionId: id, areaId: quelle.areaId, operation, punkt });
                  },
                  kaemme: (id) => {
                      subjects.showEditor();
                      kammNetz.starte(id, teilflaecheAn(id)?.areaId);
                  },
              },
          ),
          // Der Weg (WI-0177 W2, `editor-menu/handgriffe-weg.ts`): „Wegkurve bearbeiten“ am Abschnitt unter dem Rechtsklick.
          ...wegHandgriffe(
              () => ({
                  ...ortHandgriffLage(),
                  abschnitt: areaSelection.value?.kind === "path" ? areaSelection.value.segment : undefined,
                  griff: griffStelle,
                  wahlen: (subject) => {
                      const anker = ankerVon(subject);
                      return anker === undefined ? [] : wegAbschnitte.wahlen(anker);
                  },
                  finger: phoneViewport.value,
                  ganzeStrasse: (n) => t("wegeditor.abschnitte.ganzeStrasse", { n: String(n) }),
                  sperreVon: (id) => fremdeWegSperren.vonAbschnitt(id),
                  teilstelle: (id) => wegHierTeilen.stelle(id, contextPoint, teilUmkreis(contextPoint)),
                  inAuswahl: (id) => wegeFenster.inAuswahl(id),
                  inMehrfach: (id) => wegeFenster.inMehrfach(id),
                  verbinden: (id) =>
                      wegeFenster.verbindenAn(id, { abzweig: t("wegeditor.abschnitte.abzweig"), art: wegArtName }),
              }),
              {
                  eigenschaften: (weg) => {
                      subjects.showEditor();
                      wegeFenster.oeffneFuer(weg);
                  },
                  // „Auswahl zu neuem Weg …“ (WI-0252): die Rückfrage im vordersten Wege-Fenster.
                  neuerWeg: () => {
                      subjects.showEditor();
                      wegeFenster.frageNeuerWeg();
                  },
                  // „Wege verbinden ›“ (WI-0252): sofort, die Wahl im Untermenü ist die Vorlage; ↺ im Verlauf.
                  verbinden: (vorlage) => void wegeVerbinden(vorlage),
                  wegkurve: (id) => void wegkurve.starte(id),
                  vereinfachen: (id) => void wegkurve.starte(id, "vereinfachen"),
                  neuAbOrt: (id) => void neuerWeg.starte({ ort: id }),
                  teilen: (index) => void wegkurve.teile(index),
                  teilenAmWeg: (id, name) => void wegHierTeilenAm(id, name),
                  entfernen: (id) => void wegEntfernen.bitte(id),
                  // „Weg entfernen …“ an der Mehrfachauswahl (WI-0252): alle angehakten Wege, mit frisch gelesenen Revisionen.
                  entfernenAuswahl: () => void wegEntfernen.bitteAuswahl(() => wegeFenster.entfernenAuswahl()),
                  entfernenStrasse: (id) => {
                      const abschnitte = wegAbschnitte.fuer(id);
                      if (abschnitte !== undefined && abschnitte.length > 0) void wegEntfernen.bitteStrasse(abschnitte);
                  },
                  stuetzpunktEntfernen: (index) => wegkurve.entferneStuetzpunkt(index),
              },
          ),
          // Das Herrschaftsgebiet (WI-0209 A4, `editor-menu/handgriffe-gebiet.ts`): „Eigenschaften bearbeiten“ öffnet den Gebietseditor
          // an ihm und stellt „Politisch“ wie ein Klick in seiner Liste (F17, T32); „Gebietsform bearbeiten“ kommt mit C1.
          ...gebietHandgriffe(ortHandgriffLage, {
              oeffnen: (id) => {
                  subjects.showEditor();
                  gebietseditor.oeffneFuer(id);
                  hinflugAnsicht(ansichtFuerHinflug({ art: "herrschaftsgebiet" }));
              },
              gebietsform: (id) => void gebietsform.starteAm(id, gebietPunkt(id)),
              // „Unterpolygone löschen …“ (OPS-000075): die Zeilen, die das Menü beim Öffnen gelesen hat, und die Wahl.
              teile: (id) => gebietTeile.wahlen(id),
              teilLoeschen: (id, wahl) => void gebietTeilLoeschen(id, wahl),
          }),
          // Die Kraftlinien (WI-0205 K3, EDIT-0003 T39): am Nodix-Ort in der Ansicht „Kraftlinien“ „Neue Kraftlinie“ und
          // „Kraftlinie entfernen ›“ mit Auswahl der Linien dort; die Nachfrage steht im Kraftlinien-Fenster.
          ...kraftlinieHandgriffe(
              () => ({
                  ...ortHandgriffLage(),
                  linienAm: (knoten: string) => powerlineArcs?.linienAm(knoten) ?? [],
                  sperreVon: (abschnitt: string) => fremdeKraftlinienSperren.vonAbschnitt(abschnitt),
              }),
              {
                  entfernen: (anker) => {
                      subjects.showEditor();
                      void kraftlinieneditor.frageEntfernen(anker);
                  },
                  eigenschaften: (anker) => {
                      subjects.showEditor();
                      void kraftlinieneditor.oeffneFuer(anker);
                  },
                  kurve: (anker) => void kurveAn(anker),
                  anfuegen: (anker) => {
                      subjects.showEditor();
                      void kraftlinieneditor.oeffneFuer(anker).then((bearbeitung) => {
                          if (bearbeitung !== undefined)
                              kraftlinieAnfuegen.value = {
                                  anker: bearbeitung.id,
                                  mal: kraftlinieAnfuegen.value.mal + 1,
                              };
                      });
                  },
                  herausnehmen: (anker, knoten) => {
                      subjects.showEditor();
                      void nimmAusKraftlinie(anker, knoten);
                  },
                  punktEntfernen: (knoten) => void kraftlinienpunktWeg.entferne(knoten),
                  punktVerschieben: (knoten) => void kraftlinienpunktZug.starte(knoten),
                  neu: (knoten) => void neueKraftlinie.starte({ knoten }),
              },
          ),
          // Am Gipfel (WI-0178 P2, Fassung 16): „Eigenschaften bearbeiten“ und „Auf der Karte verschieben“ (Doppelklick).
          ...gipfelHandgriffe(() => ({ ...ortHandgriffLage(), sperreVon: undefined }), {
              eigenschaften: (id, name) => {
                  subjects.showEditor();
                  landschaftseditor.oeffneGipfel(id, name);
              },
              verschieben: (id, name) => {
                  subjects.showEditor();
                  landschaftseditor.oeffneGipfel(id, name);
                  gipfelZiehen.starte(gipfelGegenstand(id));
              },
              entfernen: (id, name) => {
                  subjects.showEditor();
                  landschaftseditor.oeffneGipfel(id, name);
                  landschaftseditor.oeffneEntfernen(gipfelGegenstand(id));
              },
          }),
          // An der Sprachfläche (WI-0261 Stufe 1, `editor-menu/handgriffe-sprache.ts`): nur im Kartenmenü, an der Teilfläche unter dem Zeiger.
          ...sprachMenue.handgriffe,
          // Am Wetter-Icon (WI-0288, `editor-menu/handgriffe-wetter.ts`): Eigenschaften, Verbergen und Zurückholen, Entfernen.
          ...wetterMenue.handgriffe,
      ]
    : [];
function handgriffRegister(): typeof handgriffListe {
    return handgriffListe;
}
// „In Landmarke umwandeln …“ (WI-0271 L8): Danach steht die Landmarke da, und ihr Fenster öffnet sich: Dort legt der Editor die Art fest.
watch(umwandelnMeldung, (meldung) => {
    if (meldung === undefined) return;
    subjects.showEditor();
    landschaftseditor.oeffneGipfel(meldung.peakId, meldung.name);
});
/** „Anlegen · Hier hinzufügen ›“ an der angeklickten Stelle (EDIT-0002 §4.6). */
const anlegenListe = editorNav
    ? anlegenEintraege(
          ortHandgriffLage,
          (punkt) => {
              subjects.showEditor();
              ortseditor.neuerOrt(undefined, punkt);
          },
          (punkt) => void neuerWeg.starte({ punkt }),
          // „Neue Kraftlinie“ (WI-0205 K9, Ansicht Standard): stellt auf die Kraftlinien, am Nodix im Fangradius der Stelle des Menüs,
          // sonst setzt der erste Klick auf einen Nodix den Anfang.
          (punkt) => void neueKraftlinie.starte({ bei: punkt, wechsel: true }),
          // „Neuer Kraftlinienpunkt“ (WI-0205 K9): nur, wo die Kraftlinien gezeichnet sind.
          {
              sichtbar: () => composeView(mapView.value, landscapeSelection.value).powerlines,
              setze: (punkt) => void kraftlinienpunkt.setze(punkt),
          },
          // „Neue Fläche ›“ (WI-0178 T47): die Ebenen der Derographie; gezeichnet wird mit dem gemeinsamen Ablauf C3.
          neueFlaecheEbenen({
              lage: ortHandgriffLage,
              ansicht: () => ({ view: mapView.value, auswahl: landscapeSelection.value }),
              starte: (ebene, punkt) =>
                  void neueFlaeche.starte({
                      andockung: derographieAndockung(ebene, {
                          zusatz: UntergrundRegler,
                          geoeffnet: (neu) => landschaftseditor.angelegt(neu),
                      }),
                      anfang: punkt,
                  }),
          }),
          // „Neues Herrschaftsgebiet“ (WI-0209 C3): eigener Eintrag, zeichnet mit dem gemeinsamen Ablauf und wechselt auf Politisch.
          neuesGebietEintrag(ortHandgriffLage, (punkt) => gebietAnlegen.neu(punkt)),
          // „▲ Landmarke setzen ›“ (WI-0271 L4, Kartenmenü A): überall, wo die Karte Landmarken zeichnet (Betreiber 2026-11-11, OPS-000111).
          {
              sichtbar: () => composeView(mapView.value, landscapeSelection.value).peaks !== "none",
              setze: (art, punkt) => landmarkeSetzen.starte(art, punkt),
          },
          // „Neuer Fluss/Bach ›“ (WI-0177, Plan Fluss/Bach): das Zeichnen von „Neuer Weg“ mit der Art.
          (punkt, art) => void neuerWeg.starte({ punkt, art }),
      )
    : [];
// „Neue Teilfläche“ an die Sprache des vordersten Sprachfensters (WI-0261 Stufe 1): nur in Derographie › Sprachen.
if (editorNav) anlegenListe.push(sprachMenue.anlegen);
// Die Gruppe im Infopanel braucht den Stand des Bearbeitens auch ohne offenen Ortseditor: Er sagt, ob `MAP_EDITING` hier an ist.
if (editorNav) ortseditor.ladeStand();
/** Die Abschnitte für Editoren im Kartenmenü, beim Öffnen gesetzt (am Objekt und „Anlegen“, auf freier Fläche nur „Anlegen“). */
const kontextEditor = shallowRef<readonly EditorAbschnitt[] | undefined>(undefined);
/**
 * Die Flächen unter dem Rechtsklick, als Gegenstände der Handgriffe (WI-0178 A4): Landschaften und die Herrschaftsgebiete, die das
 * Band dort zeigt (WI-0209 A4); am Ort und auf freier Karte keine.
 */
let contextFlaechen: EditorMenuSubject[] = [];
/** Der Abschnitt eines Wegs unter dem Rechtsklick (WI-0177 W2); Legacys Folge: Ort vor Weg vor Fläche. */
let contextWeg: EditorMenuSubject | undefined;
/** Mehrere Wege unter dem Rechtsklick: „Hier laufen N Wege“ (EDIT-0003 T25), je Straße der Abschnitt dort. */
let contextWege: EditorMenuSubject[] = [];
/** Die Kraftlinien unter dem Rechtsklick (WI-0205 K3): eine wie der Weg, mehrere „Hier laufen N Kraftlinien“. */
let contextKraftlinien: EditorMenuSubject[] = [];
/** Der Kraftlinienpunkt unter dem Rechtsklick (WI-0205 K10, EDIT-0003 T52); er geht den Linien vor, die an ihm enden. */
let contextKraftlinienpunkt: EditorMenuSubject | undefined;
/** Der Gipfel unter dem Rechtsklick (WI-0178 P2): Er geht den Linien und Flächen darunter vor, wie beim Klick. */
let contextGipfel: EditorMenuSubject | undefined;
/** Die Sprachen unter dem Rechtsklick (WI-0261 Stufe 1): nur, wo sonst nichts liegt; mehrere „Hier liegen N Sprachen“. */
let contextSprachen: EditorMenuSubject[] = [];
/** Das Wetter-Icon unter dem Rechtsklick (WI-0288): Es liegt über allem auf der Karte und geht darum allem vor. */
let contextWetter: EditorMenuSubject | undefined;
/** Die Kraftlinien unter einem Punkt der Leinwand, wie der Klick sie nähme (nur in ihrer Ansicht), als Gegenstände der Handgriffe. */
function kraftlinienAmPunkt(punkt: { x: number; y: number }): EditorMenuSubject[] {
    if (!map) return [];
    return kraftlinienAm(map, punkt, {
        sichtbar: composeView(mapView.value, landscapeSelection.value).powerlines,
        reichweite: (coarsePointer ? POWERLINE_HIT_WIDTH.touch : POWERLINE_HIT_WIDTH.pointer) / 2,
        gezeichnet: (bei, reichweite) => powerlineArcs?.hit(bei, reichweite),
    }).map((linie) => kraftlinieSubjekt(linie, t("infoPanel.powerline")));
}
/** Am Griff eines laufenden Modus (Rechtsklick auf einen Stützpunkt der Wegkurve): sein Gegenstand und der Griff selbst. */
let kontextAmGriff: EditorMenuSubject | undefined;
let griffStelle: { index: number; ende: boolean; ungespeichert: boolean } | undefined;
/** Das Kartenmenü in der Form „nur Editor-Karte“ (Festlegung der Editor-Orchestrierung 2026-10-17). */
const kontextNurEditor = ref(false);
/**
 * Das Kartenmenü am Stützpunkt der Wegkurve (EDIT-0003 T24 (3), R7): nur die Handgriffe des Griffs (`situativ` im Register), ohne die
 * Karte der Besucher. Beim Zeichnen bleibt der Rechtsklick „letzter Punkt zurück“ (T24 (4)).
 */
function oeffneGriffMenue(griff: {
    publicId: string;
    name: string;
    index: number;
    ende: boolean;
    ungespeichert: boolean;
    screen: { x: number; y: number };
}): void {
    const subject: EditorMenuSubject = {
        ref: { kind: "path", anchor: griff.publicId },
        title: griff.name,
        art: undefined,
        answer: undefined,
    };
    griffStelle = { index: griff.index, ende: griff.ende, ungespeichert: griff.ungespeichert };
    const abschnitte = griffAbschnitte(
        handgriffRegister(),
        subject,
        t("wegeditor.griff.stuetzpunkt", { n: String(griff.index + 1) }),
        (key, params) => t(key, params),
    );
    if (abschnitte.length === 0) return;
    contextPoint = undefined;
    contextPlace = undefined;
    contextLandmarke = undefined;
    contextWeg = undefined;
    contextWege = [];
    contextKraftlinien = [];
    contextKraftlinienpunkt = undefined;
    contextGipfel = undefined;
    contextWetter = undefined;
    contextFlaechen = [];
    contextAtPlace.value = false;
    kontextAmGriff = subject;
    kontextEditor.value = abschnitte;
    kontextNurEditor.value = true;
    contextMenuAt.value = griff.screen;
}
/** Ein Eintrag aus den Abschnitten des Kartenmenüs: „Hier hinzufügen ›“ an der Stelle, sonst ein Handgriff am Objekt. */
function kontextGriff(id: string): void {
    if (kontextAmGriff) {
        fuehreAus(handgriffRegister(), id, kontextAmGriff, viewer);
        return;
    }
    if (id.startsWith(`${VEREINIGEN_EINTRAG}#`)) {
        void flaechenVereinigenAus(id.slice(VEREINIGEN_EINTRAG.length + 1));
        return;
    }
    if (contextPoint && legeAn(anlegenListe, id, { x: contextPoint.x, y: contextPoint.y })) return;
    if (contextWetter) {
        fuehreAus(handgriffRegister(), id, contextWetter, viewer);
        return;
    }
    if (contextPlace) {
        fuehreAus(handgriffRegister(), id, ortSubjekt(contextPlace), viewer);
        return;
    }
    if (contextGipfel) {
        fuehreAus(handgriffRegister(), id, contextGipfel, viewer);
        return;
    }
    if (contextKraftlinienpunkt) {
        fuehreAus(handgriffRegister(), id, contextKraftlinienpunkt, viewer);
        return;
    }
    if (contextWeg) {
        fuehreAus(handgriffRegister(), id, contextWeg, viewer);
        return;
    }
    const liste = [contextKraftlinien, contextWege, contextFlaechen, contextSprachen].find((x) => x.length > 0) ?? [];
    const { griff, gegenstand } = griffAn(id, liste);
    if (gegenstand) fuehreAus(handgriffRegister(), griff, gegenstand, viewer);
}
/** „Welche Fläche bearbeiten?“ (EDIT-0003 §2a): die Flächen unter einem Doppelklick, wo mehrere liegen. */
const doppelklickWahl = shallowRef<
    { flaechen: readonly EditorMenuSubject[]; screen: { x: number; y: number } } | undefined
>(undefined);
/** Die Flächen unter dem letzten Doppelklick, für die Umrandung beim Zeigen in der Liste. */
let doppelklickKandidaten: AreaCandidate[] = [];
/**
 * Der gemeinsame Doppelklick auf Objekte (WI-0177, EDIT-0003 R3, `editor-menu/doppelklick.ts`): gesucht wie im Kartenmenü, Ort vor
 * Weg vor Fläche (Landschaften und die Herrschaftsgebiete, die das Band zeigt, WI-0209 A4). Im Modus ins Leere heißt er „Fertig“.
 */
const doppelklickSeite: DoppelklickSeite = {
    aktiv: () => editorNav !== undefined && viewer.can("use_editor_menu"),
    layers: () => [...PLACE_MARKER_LAYERS, PEAK_LAYER_ID, ...GEBIET_EBENEN],
    // Im Modus ins Leere heißt der Doppelklick „Fertig“: Wegkurve (WI-0177) und Ecken bearbeiten (WI-0178 C2).
    modus: () =>
        wegkurve.laufend.value?.phase === "bereit"
            ? { fertig: () => void wegkurve.fertig() }
            : ecken.laufend.value?.phase === "bereit"
              ? { fertig: () => void landschaftseditor.bearbeitungVon(ecken.laufend.value?.id)?.fertig() }
              : kraftlinieLeiste.value !== undefined
                ? { fertig: () => void kraftlinieLeiste.value?.bearbeitung.fertig() }
                : gebietsform.laufend.value?.phase === "bereit"
                  ? { fertig: () => void gebietseditor.bearbeitungVon(gebietsform.laufend.value?.id)?.fertig() }
                  : landschaftseditor.aktiv.value !== undefined
                    ? { fertig: () => void landschaftseditor.aktiv.value?.fertig() }
                    : (gebietseditor.sammelAktiv.value ?? gebietseditor.aktiv.value) !== undefined
                      ? { fertig: () => void (gebietseditor.sammelAktiv.value ?? gebietseditor.aktiv.value)?.fertig() }
                      : undefined,
    ziel: (context) => {
        const ort = context.features(PLACE_MARKER_LAYERS)[0]?.properties;
        if (ort !== undefined) {
            const id = String(ort["public_id"] ?? "");
            return {
                einzeln: ortSubjekt({
                    id,
                    name: String(ort["name"] ?? ""),
                    hidden: ort["is_hidden"] === true,
                    subtype: String(ort["subtype"] ?? ""),
                }),
                flaechen: [],
            };
        }
        // Ein Gipfel nach dem Ort (Rang `peak`): der Doppelklick verschiebt ihn (WI-0178 P2, Fassung 16).
        const gipfel = context.features([PEAK_LAYER_ID])[0]?.properties;
        if (gipfel !== undefined && String(gipfel["public_id"] ?? "") !== "")
            return {
                einzeln: gipfelSubjekt({
                    id: String(gipfel["public_id"]),
                    name: String(gipfel["name"] ?? ""),
                    subtype: String(gipfel["subtype"] ?? ""),
                }),
                flaechen: [],
            };
        // Kraftlinie vor Weg (Rang `powerline` vor `path`): die nächste Linie unter dem Zeiger, in ihrer Ansicht (WI-0205 K3).
        const [linie] = kraftlinienAmPunkt(context.point);
        if (linie !== undefined) return { einzeln: linie, flaechen: [] };
        const weg = map ? wegAm(map, context.lngLat) : undefined;
        if (weg !== undefined) return { einzeln: wegSubjekt(weg, wegName(weg)), flaechen: [] };
        const gebiete = gebieteAus(context.features(GEBIET_EBENEN));
        gebietGeklickt = { ids: gebiete.map((gebiet) => gebiet.id), at: fromRenderLngLat(space, context.lngLat) };
        doppelklickKandidaten = [
            ...(map
                ? landscapesAt(map, context.lngLat, {
                      landscapeAreas: () => display.value.layers,
                      areaLayers: () => areaLayersInView(mapView.value, landscapeSelection.value),
                  })
                : []),
            ...gebiete,
        ].sort((a, b) => a.area - b.area);
        return { flaechen: doppelklickKandidaten.map(flaechenSubjekt) };
    },
    // Am Herrschaftsgebiet stellt der Doppelklick „Politisch“ (T32 (1)), auch wo eine andere Ansicht Gebiete nur dazu zeigt.
    ansicht: (subject) => {
        if (subject.ref.kind === "territory") hinflugAnsicht(ansichtFuerHinflug({ art: "herrschaftsgebiet" }));
    },
    actions: () => handgriffRegister(),
    viewer,
    waehle: (flaechen, screen) => {
        doppelklickWahl.value = { flaechen, screen };
    },
    grund: (text) => showToast(t(text), "warning"),
};
// „Kämme zeichnen“ (WI-0245 D2): beim Wählen heißt der Doppelklick ins Leere „Fertig“; beim Zeichnen gehört er dem Kamm, nicht der
// Bearbeitung der Landschaft. Außen eingehängt, damit die Kette oben bleibt, wie sie ist.
const doppelklickModusOhneKaemme = doppelklickSeite.modus.bind(doppelklickSeite);
doppelklickSeite.modus = () => {
    const kaemme = kammNetz.laufend.value;
    if (kaemme === undefined) return doppelklickModusOhneKaemme();
    return { fertig: () => (kaemme.werkzeug === "waehlen" ? void kaemme.bearbeitung.fertig() : undefined) };
};
const doppelklickMenu = computed(() =>
    doppelklickWahl.value === undefined
        ? undefined
        : flaechenWahlListe(doppelklickWahl.value.flaechen, doppelklickWahl.value.screen, (key) => t(key)),
);
function schliesseDoppelklickWahl(): void {
    doppelklickWahl.value = undefined;
    if (map) outlineArea(map, undefined);
}
function doppelklickFlaeche(id: string): void {
    const flaeche = doppelklickWahl.value?.flaechen.find((f) => "id" in f.ref && f.ref.id === id);
    schliesseDoppelklickWahl();
    if (flaeche !== undefined) loeseAusAn(doppelklickSeite, flaeche);
}
function doppelklickVorschau(id: string | undefined): void {
    if (map) outlineArea(map, id === undefined ? undefined : doppelklickKandidaten.find((c) => c.id === id));
}
// Wird das Fenster des Modus geschlossen oder abgelegt, endet der Modus, solange nichts ungespeichert ist (F1, „Schließen verwirft nie“).
const stopVerschiebenFenster = watch(
    () => {
        const laufend = ortVerschieben.laufend.value;
        return laufend === undefined || (laufend.art !== "laedt" && laufend.lage.ungespeichert > 0)
            ? true
            : werkzeugfenster.stand.value.fenster.some((x) => x.id === laufend.fenster && x.lage !== "versenkt");
    },
    (offen) => {
        if (!offen) ortVerschieben.beende();
    },
);
// Die Lasche „Info“ legt den angedockten Ortseditor ab, die Lasche „Editor“ holt ihn zurück (EDIT-0001 §4.5 Nr. 6).
const stopWerkzeugLaschen = watch(subjects.editorVisible, (vorn) => {
    if (vorn) werkzeugfenster.editorLasche();
    else werkzeugfenster.infoLasche();
});
/**
 * Die Medienverwaltung aus dem Ortseditor (WI-0128 E6, Koordination 2026-10-10): ein Werkzeugfenster neben ihm, gelöst, wenn nichts
 * gemerkt ist; es meldet sich bei derselben Verwaltung an (rechts höchstens eins angedockt, Ablage unter „Offene Bearbeitungen“).
 * 🔴 Aus dem Hauptmenü und über den tiefen Link `?medien=` bleibt es modal wie bisher: Dort gibt es keinen Eintrag in der Verwaltung.
 */
const medienWerkzeug = computed(() =>
    werkzeugfenster.stand.value.fenster.find((fenster) => fenster.werkzeug === "medien"),
);
function oeffneMedienWerkzeug(ziel: MedienZiel): void {
    oeffneMedien(ziel);
    werkzeugfenster.oeffne(
        { werkzeug: "medien", gegenstand: "medien", titel: t("medien.titel"), nurLesen: false },
        "geloest",
    );
}
// ✕ oder Escape am Werkzeugfenster schließt es auch in der Verwaltung; ✕ unter „Offene Bearbeitungen“ schließt das Fenster.
const stopMedienWerkzeug = watch(medienOffen, (offen) => {
    if (!offen && medienWerkzeug.value) werkzeugfenster.verwirf(medienWerkzeug.value.id);
});
const stopMedienAblage = watch(medienWerkzeug, (jetzt, vorher) => {
    if (jetzt === undefined && vorher !== undefined) medienOffen.value = false;
});
// Die Kartenwahl in der Korrektur einer Einreichung (WI-0272 S3, `medien-stelle.ts`) schließt die Medienverwaltung, und oben verwirft die Seite ihr Werkzeugfenster. Endet die Wahl, steht es wieder in Lage
// und Größe von vorher, bevor die Verwaltung aufgeht (sync: Die Wahl setzt `waehlen` vor `medienOffen`).
const stopMedienWahl = watch(
    medienStelle.waehlen,
    (waehlt) => {
        const vorher = waehlt ? undefined : medienStelle.nimmFenster();
        if (vorher !== undefined) holeMedienFensterZurueck(werkzeugfenster, vorher, t("medien.titel"));
    },
    { flush: "sync" },
);

/**
 * Die Messwerte (WI-0138 V15): derselbe Block, den der Reiter „Status“ angedockt zeigt, als Werkzeugfenster über der Karte.
 * Der Knopf „lösen“ im Reiter ist seine Tür; von da an gehört es der Verwaltung wie jedes andere Fenster - andocken,
 * ablegen und die gemerkte Lage kommen von dort (Betreiber 2026-10-13: „am rechten rand andocken … funktioniert nicht“).
 */
const messwerteOffen = ref(false);
const messwerteWerkzeug = computed(() =>
    werkzeugfenster.stand.value.fenster.find((fenster) => fenster.werkzeug === "messwerte"),
);
function oeffneMesswerte(): void {
    messwerteOffen.value = true;
    werkzeugfenster.oeffne(
        { werkzeug: "messwerte", gegenstand: "messwerte", titel: t("messwerte.titel"), nurLesen: true },
        "geloest",
    );
}
const stopMesswerteFenster = watch(messwerteOffen, (offen) => {
    if (!offen && messwerteWerkzeug.value) werkzeugfenster.verwirf(messwerteWerkzeug.value.id);
});
const stopMesswerteAblage = watch(messwerteWerkzeug, (jetzt, vorher) => {
    if (jetzt === undefined && vorher !== undefined) messwerteOffen.value = false;
});
/**
 * Offen bleibt offen (WI-0150, Kanal OPS-000002): Wer das Messfenster beim Arbeiten im Blick hat, hat es nach dem
 * Neuladen wieder - wie das Editorpanel. Wo es steht, merkt die Fensterverwaltung; ob es offen war, der Merker.
 */
const stopMesswerteMerken = watch(messwerteOffen, (offen) => merkeMessfensterOffen(browserSpeicher(), offen));
if (editorNav && messfensterOeffnetBeimLaden(browserSpeicher(), phoneViewport.value)) oeffneMesswerte();
/**
 * Woran die angemeldete Person gerade sitzt (WI-0141b): das Spezifischste gewinnt — ein offenes Werkzeugfenster vor dem
 * Reiter des Panels, der Reiter vor der Karte. Ohne Editorrecht bleibt es bei der Karte, die der Melder selbst aus der
 * Adresse liest.
 */
const stopAnsichtMelden = watch(
    () => {
        if (!editorNav) return undefined;
        const fenster = werkzeugfenster.stand.value.fenster.find((eintrag) => eintrag.lage !== "versenkt");
        if (fenster?.werkzeug === "ortseditor") return "editor.orte" as const;
        if (fenster?.werkzeug === "medien") return "editor.medien" as const;
        if (!subjects.editorVisible.value) return undefined;
        const reiter = editorNav.pfad.value[0];
        if (reiter === "aenderungen") return "editor.aenderungen" as const;
        if (reiter === "karteninhalte") return "editor.karteninhalte" as const;
        if (reiter === "status") return "editor.status" as const;
        return undefined;
    },
    (ansicht) => setzeAnsicht(ansicht),
    { immediate: true },
);
/**
 * Ein angedocktes Werkzeugfenster ist breiter als das Panel (Ortseditor 960, Medienverwaltung 1240): Die Laschen „Info“ und „Editor“ und
 * die Eckknöpfe rücken an seine linke Kante, sonst lägen sie darunter (gemessen 2026-10-10). Die Breite ist die benannte des Fensters.
 */
/** Werkzeuge ohne einziehbare Liste; alle anderen Werkzeugfenster (Orte, Landschaften, Kraftlinien, Wege) melden ihren Schalter. */
const OHNE_LISTE = new Set([
    "medien",
    "messwerte",
    INHALTE_WERKZEUG,
    VORGANG_WERKZEUG,
    BEWERTUNG_WERKZEUG,
    KARTENVORSCHLAG_WERKZEUG,
    BEITRAG_WERKZEUG,
    NEUE_MAIL_WERKZEUG,
]);
const mitListe = (werkzeug: string): boolean => !OHNE_LISTE.has(werkzeug);
const slotBreite = computed(() => {
    const rechts = werkzeugfenster.stand.value.fenster.find((fenster) => fenster.lage === "angedockt");
    if (phoneViewport.value) return undefined;
    // Ein angedocktes Fenster der Besucher (Meldeformular, Statusseite; WI-0268 C2) trägt die Breite „entscheiden“ und rückt Laschen und Eckknöpfe wie jedes andere.
    // Neben einem offenen Info- oder Editorpanel steht es links davon (Betreiber 2026-10-31): Dann rücken sie um beide Breiten.
    if (!rechts) {
        if (!communityBesucher.angedockt.value && !reisebildBesucher.angedockt.value) return undefined;
        return subjects.slotOpen.value ? `calc(${NEBEN_PANEL} + ${BESUCHER_BREITE})` : BESUCHER_BREITE;
    }
    // Jedes Werkzeug trägt seine benannte Breite aus dem Kanon; wer hier fehlt, ist ein Werkzeugfenster von 960 px. Das Wege-Fenster ist
    // „wege“ breit wie beim Hinflug (`BREITE_JE_WERKZEUG` in `editor-panel/hinflug.ts`); ohne den Eintrag stand die Lasche 160 px daneben.
    const breite =
        {
            medien: "medien",
            messwerte: "entscheiden",
            wegeditor: "wege",
            [INHALTE_WERKZEUG]: "medien",
            [VORGANG_WERKZEUG]: "entscheiden",
            [BEWERTUNG_WERKZEUG]: "entscheiden",
            [KARTENVORSCHLAG_WERKZEUG]: "entscheiden",
            [NEUE_MAIL_WERKZEUG]: "entscheiden",
        }[rechts.werkzeug] ?? "werkzeug";
    // Ein Vorgang der Community steht links NEBEN dem Panel (`community/community-redaktion.vue`): Laschen und Eckknöpfe rücken um dessen Breite weiter.
    const daneben =
        rechts.werkzeug === VORGANG_WERKZEUG ||
        rechts.werkzeug === BEWERTUNG_WERKZEUG ||
        rechts.werkzeug === KARTENVORSCHLAG_WERKZEUG ||
        rechts.werkzeug === BEITRAG_WERKZEUG ||
        rechts.werkzeug === NEUE_MAIL_WERKZEUG
            ? " + var(--community-rand, 0px)"
            : "";
    // Mit eingezogener Ortsliste rücken Laschen und Eckknöpfe um die Listenbreite nach rechts mit (P1).
    const einzug = mitListe(rechts.werkzeug) && listenSchalter.zu(rechts.id) ? " - var(--avm-fenster-inspektor)" : "";
    return `min(calc(var(--avm-fenster-${breite})${einzug}${daneben}), 100vw - var(--avesmaps-tab-w))`;
});
/**
 * Die Leiste eines Modus (WI-0178 C1, EDIT-0003 §2a): oben mittig über der freien Karte, zwischen dem, was die Panels decken; die
 * Bunde rücken um ihre Höhe (oben am Rechner, unten am Telefon), statt unter ihr zu liegen. Gemessen beim Start, wenn ein Panel
 * auf- oder zugeht und wenn das Fenster seine Größe ändert.
 */
const modusRand = shallowRef<{ links: number; rechts: number; imFenster?: boolean }>({ links: 0, rechts: 0 });
/**
 * Die Leiste der Bearbeitung einer Landschaft (O3, T44): mit „Ecken bearbeiten“ dessen Titel und Gesten, sonst die der Felder; „Fertig“
 * schreibt Felder und Form als `landscape.update`. Läuft ein anderer Formentwurf (Gebiet, Zoombänder), steht sie nicht.
 */
const landschaftLeiste = computed(() => {
    // „Kämme zeichnen“ trägt die Bearbeitung in seiner eigenen Leiste (`kamm-netz-leiste.vue`).
    if (kammNetz.laufend.value !== undefined) return undefined;
    const laeuft = laufenderEntwurf();
    if (laeuft !== undefined && laeuft !== ecken) return undefined;
    // Die Mehrfachauswahl (T57): Ihre Leiste steht, sobald etwas für alle geändert ist oder geschrieben wird.
    const sammel = landschaftSammel.value;
    if (laeuft === undefined && sammel !== undefined) {
        const art = sammel.zustand.value.art;
        if (sammel.lage.value.aktiv || sammel.lage.value.frage || art === "speichert" || art === "abgelehnt")
            return {
                bearbeitung: sammel,
                zeichen: "bearbeiten" as const,
                titel: t("landschaftseditor.mehrfach.leiste"),
                objekt: t("landschaftseditor.mehrfach.gewaehlt", { n: formatNumber(sammel.ids.length, 0) }),
                gesten: t("entwurf.gestenFelder"),
                isoliert: undefined,
                testid: "landschaft-sammel-leiste",
            };
    }
    const flaeche = ecken.laufend.value;
    if (flaeche !== undefined) {
        const bearbeitung = landschaftseditor.bearbeitungVon(flaeche.id);
        if (flaeche.phase === "laedt" || bearbeitung === undefined) return undefined;
        return {
            bearbeitung,
            zeichen: "gebietsform" as const,
            titel: t("landschaftseditor.ecken.titel"),
            objekt: flaeche.name,
            gesten: phoneViewport.value
                ? t("landschaftseditor.ecken.gestenFinger")
                : `${t("landschaftseditor.ecken.gesten")} · ${t("landschaftseditor.ecken.gestenIsolieren")}`,
            // „Auswahl isolieren“ (WI-0178): der Umschalter steht nur hier.
            isoliert: isolieren.an.value,
            testid: "ecken-leiste",
        };
    }
    const bearbeitung = landschaftseditor.aktiv.value;
    if (bearbeitung === undefined) return undefined;
    return {
        bearbeitung,
        zeichen: "bearbeiten" as const,
        titel: t("entwurf.felder"),
        objekt: bearbeitung.detail.value?.name ?? "",
        gesten: t("entwurf.gestenFelder"),
        isoliert: undefined,
        testid: "landschaft-leiste",
    };
});
/**
 * Die Leiste einer Kraftlinie (O3): mit der Kurve „Kurve bearbeiten“, sonst die Felder des vordersten Kraftlinienfensters, solange es
 * bearbeitet wird und kein anderer Modus der Form läuft; sonst die Mehrfachauswahl des vordersten Fensters (WI-0238, T57), solange ihr
 * ↺ für alle ungeschrieben ist („Fertig“ schreibt EINE Operation).
 */
const kraftlinieLeiste = computed(() => {
    const kurve = kraftlinieKurve.laufend.value;
    if (kurve !== undefined)
        return kurve.lage.value.aktiv
            ? { bearbeitung: kurve, form: true, objekt: kurve.detail.value?.name ?? "" }
            : undefined;
    if (laufenderEntwurf() !== undefined) return undefined;
    const felder = kraftlinieneditor.aktiv.value;
    if (felder !== undefined) return { bearbeitung: felder, form: false, objekt: felder.detail.value?.name ?? "" };
    const sammel = kraftlinieneditor.sammelAktiv.value;
    if (sammel === undefined) return undefined;
    const n = sammel.ids.length;
    return {
        bearbeitung: sammel.entwurf,
        form: false,
        objekt: tPlural("kraftlinieneditor.sammel.gewaehlt", n, { n: formatNumber(n, 0) }),
    };
});
/**
 * Die Leiste der Bearbeitung eines Gebiets (WI-0209 B2, O3, T44): mit „Grenzen bearbeiten“ dessen Titel, die Obergebiete, deren Grenze
 * sich mitändert (C1, Frage 1), und die Gesten; sonst die der Felder. „Fertig“ schreibt Felder und Form als `territory.update`. Läuft ein
 * anderer Formentwurf (Fläche, Zoombänder), steht sie nicht.
 */
const gebietLeiste = computed(() => {
    const laeuft = laufenderEntwurf();
    if (laeuft !== undefined && laeuft !== gebietsform) return undefined;
    const gebiet = gebietsform.laufend.value;
    if (gebiet !== undefined) {
        const bearbeitung = gebietseditor.bearbeitungVon(gebiet.id);
        if (gebiet.phase === "laedt" || bearbeitung === undefined) return undefined;
        const gesten = phoneViewport.value
            ? t("landschaftseditor.ecken.gestenFinger")
            : t("landschaftseditor.ecken.gesten");
        const ober = gebietsform.obergebiete.value;
        const namen = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(ober);
        return {
            bearbeitung,
            zeichen: "gebietsform" as const,
            titel: t("gebietseditor.form.titel"),
            objekt: gebiet.name,
            gesten: [
                ...(ober.length === 0 ? [] : [t("gebietseditor.form.obergebiete", { namen })]),
                gesten,
                t("gebietseditor.form.wechsel"),
            ].join(" "),
            testid: "grenzen-leiste",
        };
    }
    // Die Mehrfachauswahl (EDIT-0003 T57) geht der Bearbeitung des Gebiets vor: „Fertig“ schreibt für alle gewählten.
    const sammel = gebietseditor.sammelAktiv.value;
    if (sammel !== undefined)
        return {
            bearbeitung: sammel,
            zeichen: "bearbeiten" as const,
            titel: t("entwurf.felder"),
            objekt: t("gebietseditor.sammel.gewaehlt", { n: formatNumber(sammel.ids.length, 0) }),
            gesten: t("entwurf.gestenFelder"),
            testid: "gebiet-leiste",
        };
    const bearbeitung = gebietseditor.aktiv.value;
    if (bearbeitung === undefined) return undefined;
    return {
        bearbeitung,
        zeichen: "bearbeiten" as const,
        titel: t("entwurf.felder"),
        objekt: bearbeitung.detail.value?.name ?? "",
        gesten: t("entwurf.gestenFelder"),
        testid: "gebiet-leiste",
    };
});
/** Die Leiste der Felder einer Straße (W5b), solange sie bearbeitet wird und kein Modus läuft; eine Landschaft geht vor. */
const wegeFelderLeiste = computed(
    () =>
        wegeFenster.aktiv.value !== undefined &&
        landschaftLeiste.value === undefined &&
        kraftlinieLeiste.value === undefined &&
        gebietLeiste.value === undefined &&
        laufenderEntwurf() === undefined &&
        !wegModusLaeuft(),
);
const modusHoeheGemessen = ref(0);
const modusLaeuft = computed(
    () =>
        landschaftLeiste.value !== undefined ||
        gebietLeiste.value !== undefined ||
        wegeFelderLeiste.value ||
        (ecken.laufend.value !== undefined && ecken.laufend.value.phase !== "laedt") ||
        flaecheVereinfachen.laufend.value?.phase === "bereit" ||
        flaecheVerschieben.laufend.value?.phase === "bereit" ||
        flaecheMalen.laufend.value?.phase === "bereit" ||
        kammNetz.laufend.value !== undefined ||
        zoombaender.laufend.value !== undefined ||
        (wegkurve.laufend.value !== undefined && wegkurve.laufend.value.phase !== "laedt") ||
        (neuerWeg.laufend.value !== undefined && neuerWeg.laufend.value.phase !== "laedt") ||
        mitAnderer.laufend.value !== undefined ||
        unterflaechen.laufend.value !== undefined ||
        zerschneiden.laufend.value !== undefined ||
        (neueKraftlinie.laufend.value !== undefined && neueKraftlinie.laufend.value.phase !== "laedt") ||
        (neueFlaeche.laufend.value !== undefined && neueFlaeche.laufend.value.phase !== "laedt") ||
        kraftlinieLeiste.value !== undefined,
);
/**
 * Die Ebenenleiste oben (WI-0178 T41 (2), `landschaftseditor/ebenen-leiste.vue`): für Editoren am Rechner in „Landschaften“, auch während ein
 * Modus läuft (WI-0225, Betreiber 2026-10-20 über die Editor-Orchestrierung, wörtlich: „die leiste mit "alle", "region", "vegetation", usw.
 * darf nicht verschwinden, wenn die bearbeitungen der gebirgseigenschaften (oder anderer tools) eingeblendet wird“). Die Leiste des Modus
 * steht dann darunter auf derselben Bühne (`--avm-leiste-oben`), auch wenn sie selbst ins Fenster geht (T45 (3)); das Rad rückt unter beide.
 */
const ebenenleisteZeigen = computed(
    () => editorNav !== undefined && !phoneViewport.value && mapView.value === "landscapes",
);
const ebenenHoehe = ref(0);
/** Was sie zählt: die für Klicks gesperrten und die für Besucher verborgenen Landschaften der gewählten Ebene, die auf der Karte stehen. */
const ebenenZaehler = computed(() =>
    ebenenZaehlung(landschaftseditor.liste.value?.rows ?? [], landscapeSelection.value),
);
watch(
    ebenenleisteZeigen,
    (an) => {
        if (an && landschaftseditor.liste.value === undefined) landschaftseditor.ladeListe();
    },
    { immediate: true },
);
/** ☰: die Liste der Landschaften nach ihrer Reihenfolge, wie Legacys Fenster „Reihenfolge und Sperren“. */
function ebenenStapel(): void {
    if (stapelUmschalten(landschaftseditor.listenEinstellung, landschaftseditor.fenster.value.length > 0))
        landschaftseditor.oeffneWerkzeug();
}
/** Das Auge mit Zahl: die Liste, gefiltert auf „verborgen“ (Blatt G, T41 (5)). */
function ebenenVerborgene(): void {
    const filter = new Map(landschaftseditor.listenEinstellung.filter.value);
    filter.set("sichtbarkeit", new Set(["verborgen"]));
    landschaftseditor.listenEinstellung.filter.value = filter;
    landschaftseditor.oeffneWerkzeug();
}
/** Abstand der Modusleiste unter der Ebenenleiste, wie der des Rads unter der Leiste (`--space-6`, 8 px im Kanon). */
const MODUS_UNTER_EBENEN_PX = 8;
/** Was oben über der Karte steht: die Ebenenleiste, darunter die Leiste des Modus (im Fenster meldet sie 0). */
const ebenenOben = computed(() => (ebenenleisteZeigen.value ? ebenenHoehe.value : 0));
const modusHoehe = computed(() => {
    const modus = modusLaeuft.value ? modusHoeheGemessen.value : 0;
    return ebenenOben.value + (ebenenOben.value > 0 && modus > 0 ? MODUS_UNTER_EBENEN_PX : 0) + modus;
});
/** Wo die Leiste steht, solange sie steht (EDIT-0003 T45 (3), `fenster/leistenplatz.ts`): einmal gewählt, nur mit der Größe neu. */
let leisteSteht: Leistenplatz | undefined;
function messeModusRand(anlass: LeistenAnlass = "sonst"): void {
    if (!modusLaeuft.value && !ebenenleisteZeigen.value) {
        leisteSteht = undefined;
        return;
    }
    const bedeckt = visibleArea?.covered() ?? NO_INSETS;
    // Keine Lücke neben Planer und angedocktem Fenster: dieselbe Leiste steht dann unten im angedockten Fenster.
    const karte = map?.getCanvas();
    const angedockt = document.querySelector('[data-lage="angedockt"] [data-modusleiste-ziel]') !== null;
    leisteSteht =
        karte === undefined
            ? "karte"
            : leistenplatz(
                  leisteSteht,
                  anlass,
                  { width: karte.clientWidth, height: karte.clientHeight },
                  bedeckt,
                  angedockt,
                  leistenbreite(),
              );
    modusRand.value = { links: bedeckt.left, rechts: bedeckt.right, imFenster: leisteSteht === "fenster" };
}
watch(
    [modusLaeuft, ebenenleisteZeigen, panelShifts, tabShifts, plannerOpen, slotBreite],
    ([laeuft, ebenen], [lief, ebenenVorher]) =>
        void nextTick(() => messeModusRand(laeuft !== lief || ebenen !== ebenenVorher ? "neu" : "sonst")),
);
const beiGroesse = (): void => messeModusRand("groesse");
globalThis.addEventListener("resize", beiGroesse);
/** Zieht ein Fenster seine Liste ein (Modus, EDIT-0003 Regel 7), wandert seine Kante 220 ms lang; erst danach steht der Rand der Leiste. */
function nachEinzug(event: TransitionEvent): void {
    if (event.propertyName !== "--avm-fenster-einzug") return;
    messeModusRand();
    // Der Modus hat beim Start eingepasst, als die Liste noch offen stand: jetzt mit der freien Fläche daneben (WI-0218 §10).
    if (geometrieModus.value !== undefined) zeigeNachEinzug();
}
document.addEventListener("transitionend", nachEinzug);
// Bei „Bewegung reduzieren“ springt die Kante ohne Übergang, und kein `transitionend` kommt: dann gleich nach dem Zeichnen.
watch(
    () => {
        const id = modusFenster();
        return id !== undefined && listenSchalter.zu(id);
    },
    (zu) => {
        if (zu && globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true)
            void nextTick(() => requestAnimationFrame(() => zeigeNachEinzug()));
    },
);
watch(geometrieModus, (modus) => {
    if (modus === undefined) vergissEinzug();
});
/** Die Ortseditoren, das vorderste zuletzt: Es steht über den anderen. */
const ortseditorFenster = computed(() =>
    werkzeugfenster.stand.value.fenster
        .filter((fenster) => fenster.werkzeug === "ortseditor")
        .sort((a, b) => a.vorn - b.vorn),
);
// Ein neues Editor-Fenster übernimmt die zuletzt gelegte Stellung der Liste; ein schon offenes behält seine eigene (P1).
const stopListenSchalter = watch(
    () =>
        werkzeugfenster.stand.value.fenster
            .filter((fenster) => mitListe(fenster.werkzeug))
            .map((fenster) => [fenster.id, fenster.werkzeug] as const),
    (offene) => {
        // Je Werkzeug die eigene Vorgabe: Die Stellung der Landschaftsliste legt nicht die der Ortsliste um.
        for (const [id, werkzeug] of offene) listenSchalter.melde(id, werkzeug);
    },
    { immediate: true },
);
escapeCascade.register("info-panel", () => subjects.escapeVisible());
escapeCascade.register("map-selection", () => subjects.escapeSelection());
/** Die Legacy-Objektlinks der Wiki Aventurica (WI-0063 4.6): `siedlung`, `staat`, `region`, `strasse`, `fluss`, `place`, `pin`. */
const objectLink = createObjectLink({
    selection: subjects,
    client: createSubjectClient(),
    notify: (text) => showToast(text, "warning"),
});

const planner = createPlanner({
    showOnMap: (state: PlannerMapState) => {
        routeLayer = state;
        if (map && mapReady) {
            updateRouteData(map, routeLayer);
            showBorderLabels(routeLayer);
        }
    },
    fitRoute: (route: RouteResponse, stage?: number) => {
        const bounds = routeRenderBounds(route, stage);
        if (bounds) {
            whenMapReady(() => camera.value?.showBounds(bounds, { maxZoom: FLY_MAX_ZOOM }));
        }
    },
    // Ein einzelner Wegpunkt: Punkt zeigen (WI-0039, E2 löst MCS-020 D4 ab).
    showPlace: (place) => whenMapReady(() => camera.value?.showPoint(renderPosition(place), nearZoomOf(place))),
    notify: (message) => showToast(message, "warning"),
    // 🔴 Die Reise steht in der Query, der Blick bleibt im Hash (Kamera-Sitzung 2026-09-23).
    writeAddress: (query) => {
        const search = withPlannerLink(globalThis.location.search, query);
        if (search === globalThis.location.search) {
            return;
        }
        globalThis.history.replaceState(
            null,
            "",
            `${globalThis.location.pathname}${search}${globalThis.location.hash}`,
        );
    },
});
/**
 * Der Tropfen, wie er gezeichnet wird: die gewählte Kartenstelle - außer sie ist schon ein Wegpunkt der Route (Betreiber
 * 2026-10-09: „fragezeichen sieht super aus, verschwindet aber nicht, wenn ich "Reiseziel hinfügen" mach“). Dann trägt der
 * Tropfen der Route die Stelle; zwei Zeichen auf einem Punkt wären zwei Aussagen. Dieselbe Frage wie die Kachel im Panel
 * (`isDestination`, `panel-actions.ts`): Kennung der Kartenstelle gegen die Wegpunkte. Fällt das Ziel wieder weg und die Stelle
 * ist noch gewählt, steht das Fragezeichen wieder.
 */
const drawnPin = computed(() => {
    const pin = mapPin.value;
    if (pin === undefined) return undefined;
    const id = mapPointId(pin);
    return planner.filled.value.some((place) => place.id === id) ? undefined : pin;
});

/**
 * Die Landschaften und Gebiete je Etappe (WI-0035): EINE Abfrage je Route, die der Planer UND das Infopanel lesen (WI-0063 27.13: Eine
 * Etappe nennt ihre Landschaften und Gebiete, ohne die Frage ein zweites Mal zu stellen).
 */
const landscapes = useRouteLandscapes(() => planner.route.value);

/**
 * Die Aktionskacheln des Infopanels (WI-0063 P6): Reiseziel hinzufügen und entfernen, Link teilen, Anzeigen. Sie laufen über die
 * vorhandenen Nähte - den Planer, die Zwischenablage samt Meldungsweg und die Kamera -, nicht über eine eigene Logik. Am Rechner geht
 * der Planer auf, damit man das Reiseziel sieht; am Telefon decken Panel und Planer einander (`keepPlannerAndPanelApart`).
 */
/**
 * Wie die Kartenpunkte der Reise heißen, nach Kennung (WI-0087 P9): dieselbe Quelle, aus der die Wegpunkteingabe
 * und die Etappenliste ihre Namen nehmen. Das Infopanel löst damit die Teilstrecke im Kopf auf.
 */
const plannerPointNames = computed(() => mapPointNames(planner.waypoints));

const panelActions = createPanelActions({
    planner,
    selection: subjects,
    fly: (ref, target) =>
        whenMapReady(() => {
            if (camera.value) flyToSubject(camera.value, ref, target);
        }),
    copy: copyToClipboard,
    notify: (text, tone, link) => (link === undefined ? showToast(text, tone) : showLinkToast(text, link, tone)),
    revealPlanner: () => {
        if (!phoneViewport.value) plannerOpen.value = true;
    },
    startSet: () => showToast(t("travelHere.startSet")),
    // „Änderungen vorschlagen“ (WI-0268 C2): das Meldeformular der Besucher, mit dem Objekt als Bezug.
    openSuggest: (target) => communityBesucher.oeffneMeldung({ art: "objekt", ...target }),
    // „Karte vorschlagen“ (WI-0275 Stufe C): das Fenster der Besucher zur Kartensammlung; nur ein Ort hat eine öffentliche Kennung, die der Server als `placeId` nimmt.
    openSuggestMap: (target) =>
        kartenvorschlagBesucher.oeffne({
            ...(target.ref.kind === "place" ? { id: target.ref.id } : {}),
            name: target.name,
            hatKarten: target.hatKarten,
        }),
    // „Bewertung schreiben“ und „⚑ Bewertung melden“ (WI-0269 C10): die Fenster der Besucher; „Teilen“ an einer Bewertung öffnet am Telefon das Teilen-Menü des Geräts.
    openReview: (target) => communityBesucher.oeffneBewertung(target),
    openReviewReport: (target) => communityBesucher.oeffneBewertungMelden(target),
    shareNative: async (url, title) => {
        if (!phoneViewport.value || typeof globalThis.navigator?.share !== "function") return false;
        try {
            await globalThis.navigator.share({ url, title });
            return true;
        } catch (error) {
            // Abgebrochen heißt: nichts kopieren; alles andere fällt auf den kopierten Link zurück.
            return error instanceof DOMException && error.name === "AbortError";
        }
    },
    openCatalog: (target) => {
        catalogTarget.value = target;
        if (target.section === "citymaps") citymapsOpen.value = true;
        else literatureOpen.value = true;
    },
    ...(medienErlaubt ? { openMedia: (target: MediaEntry) => oeffneMedien(target) } : {}),
    // „+ Eigenes Bild hinzufügen“ im Kopf eines Ortes (WI-0272 S5): dieselbe Naht wie der Eintrag im Kartenmenü (`onContextAction`, "photobox"); die Stelle ist die Lage des Ortes, der Ort der Bezug.
    openReisebild: (ort) =>
        void ladeBauteilVor(ReisebildBesucher).then(() => reisebildBesucher.oeffne({ x: ort.x, y: ort.y }, ort)),
});

/**
 * „Auf Karte zeigen“ aus der Medienverwaltung (WI-0068 P3, P0 Frage 3): Das Fenster ist schon zu; das Fachobjekt öffnet über die EINE
 * Öffnungsnaht, und die Kamera fliegt zu ihm (`camera: "target"`, `camera.ts`, sichtbare Fläche) - wie ein Objektlink. Eine Region am
 * Eintrag der Kartensammlung (WI-0287 Stufe 3) öffnet als Fläche (`area`), wie ein Klick in die Derographie.
 */
function medienAufKarte(ziel: MedienKartenziel): void {
    const ref: SubjectRef | undefined =
        ziel.kind === "region"
            ? { kind: "area", id: ziel.id }
            : ziel.kind === "place" || ziel.kind === "territory"
              ? { kind: ziel.kind, id: ziel.id }
              : undefined;
    if (ref === undefined) return;
    subjects.openSubject(ref, { source: "link", camera: "target", known: { title: ziel.name } });
}

// 🪤 Die Marken der Grenzübertritte gehen mit der Route, beim Neuladen und beim Ausschalten des Häkchens (WI-0065
// Z3 C), NICHT mit dem Planer: Am Telefon deckt er die Karte, man sieht sie erst, wenn er zu ist (Betreiber 2026-10-03).

/**
 * Der Playmode (WI-0031): spielt die Route des Planers ab. Der Pfeil und die folgende Kamera leben
 * auf der Karte; die Leiste unter dem Planer steuert. Auf einem Flug fliegen beide geneigt in der Höhe,
 * die die Flugbahn gerade zeichnet (WI-0051 F3).
 */
const flightHeightOf: TravelerFlightHeight = (position) =>
    position.segment === undefined || position.along === undefined
        ? undefined
        : flightArcs?.heightAt(position.segment, position.along);
const travelerView = createTravelerView(
    () => (mapReady ? map : undefined),
    () => camera.value,
    undefined,
    flightHeightOf,
    () => interaction,
);
const playmode = usePlaymode(planner.route, travelerView);
/*
 * Die Wiedergabe zählt (`play`, WI-0159, BESUCH-0001 §13 D „Lohnt die dritte Dimension?“): einmal je Besuch, wie die Neigung.
 * 🪤 Außen eingehängt, nicht in `usePlaymode`: Dort beginnt die Wiedergabe über vier Wege (▶, Leertaste, Leiste, Etappe), und
 * `use-playmode.ts` bleibt, was sein Kopf zusagt - Rechnung ohne Seiteneffekt. Ein Wächter auf `playing` trifft alle vier.
 */
watch(playmode.playing, (laeuft) => {
    if (laeuft) meldeEinmal("play");
});

/*
 * Etappe und Pfeil gehören zusammen (Betreiber 2026-09-24): Die Etappe, in der der Pfeil gerade
 * ist, steht gold in Liste und Karte; und wer eine Etappe wählt - in der Liste, auf der Karte, mit
 * Bild ↑/↓ -, setzt den Pfeil an ihren Anfang. `flush: "sync"`, damit die eigene Wahl des
 * Playmodes als solche erkannt wird und nicht zurückspringt.
 */
let stageFromPlaymode = false;
watch(playmode.stage, (stage) => {
    if (stage === null || stage === planner.selectedStage.value) {
        return;
    }
    stageFromPlaymode = true;
    planner.selectStage(stage, false);
    stageFromPlaymode = false;
});
watch(
    planner.selectedStage,
    (stage) => {
        if (stage !== null && !stageFromPlaymode) {
            playmode.showStage(stage);
        }
    },
    { flush: "sync" },
);
// Eine Etappe ist ein Subject (WI-0063 4.7): Wer sie wählt - Zeile, Linie, Tasten -, öffnet ihre Information im Infopanel; die
// Wiedergabe öffnet nie, folgt aber einer offenen. Am Telefon schließen Planer und Panel einander aus.
const stopPlannerBinding = bindPlannerStage(subjects, planner, () => stageFromPlaymode);
const stopPhoneExclusion = keepPlannerAndPanelApart(subjects, plannerOpen, phoneViewport);

/**
 * Das Kontextmenü geht auf: wo (Fenster), welcher Kartenpunkt gemeint ist - und, auf einem Ort, welcher Ort
 * (WI-0100). Zu geht es mit jeder Kartenbewegung.
 *
 * 🔴 Der Kartenpunkt wird AUCH über einem Ort gesetzt: „Was ist hier?“, „Nächsten Ort finden“ und „Entfernung
 * messen“ meinen weiter die angeklickte Stelle. Nur die Reisezeile unterscheidet.
 */
function openContextMenu(
    screen: { x: number; y: number },
    lngLat: { lng: number; lat: number },
    place?: SelectedPlace,
    gipfel?: GipfelAufKarte,
): void {
    contextPoint = fromRenderLngLat(space, lngLat);
    contextPlace = place;
    contextLandmarke =
        place === undefined && gipfel !== undefined
            ? landmarkeAlsZiel(gipfel, fromRenderLngLat(space, gipfel.lngLat ?? lngLat))
            : undefined;
    kontextAmGriff = undefined;
    kontextNurEditor.value = false;
    // Zwei Karten statt zwei Menüs (EDIT-0003 T25, WI-0178 A4): Der Rechtsklick wählt den Ort wie ein Klick, und der hätte das Menü am
    // Objekt geöffnet. Dessen Einträge stehen schon in der Karte der Editoren.
    editorMenu.close();
    contextAtPlace.value = place !== undefined || contextLandmarke !== undefined;
    // Eine Kraftlinie geht dem Weg vor (Rang `powerline` vor `path`, nur in ihrer Ansicht); gemeint ist der Abschnitt dort (WI-0205 K3).
    const kraftlinien = editorNav && place === undefined && map ? kraftlinienAmPunkt(map.project(lngLat)) : [];
    contextKraftlinien = kraftlinien;
    // Ein Weg unter dem Punkt geht den Flächen vor (Legacy: Ort vor Weg vor Fläche); gemeint ist der Abschnitt dort (WI-0177 W2).
    const wege = (editorNav && place === undefined && kraftlinien.length === 0 && map ? wegeAm(map, lngLat) : []).map(
        (weg) => wegSubjekt(weg, wegName(weg)),
    );
    contextWeg = wege.length === 1 ? wege[0] : undefined;
    contextWege = wege.length > 1 ? wege : [];
    // Die Flächen unter dem Punkt, wie ein Klick sie nähme: nur gezeichnete der Ebene, die die Karte zeigt (T27 (1)), und die
    // Herrschaftsgebiete, die das Band dort zeigt (WI-0209 A4, T23 Frage 2), kleinste zuerst.
    contextFlaechen =
        editorNav && place === undefined && wege.length === 0 && kraftlinien.length === 0 && map
            ? [
                  // Die für Besucher verborgenen (T41) trifft der Rechtsklick der Editoren auch: Ihr Menü bietet „Zurückholen“.
                  ...landscapesAt(
                      map,
                      lngLat,
                      {
                          landscapeAreas: () => display.value.layers,
                          areaLayers: () => areaLayersInView(mapView.value, landscapeSelection.value),
                      },
                      verborgeneFlaechen === undefined ? [] : [VERBORGEN_EBENEN.flaeche],
                  ),
                  ...gebieteAm(map, lngLat),
              ]
                  .sort((a, b) => a.area - b.area)
                  .map(flaechenSubjekt)
            : [];
    // Ein Kraftlinienpunkt geht den Linien vor, die an ihm enden (WI-0205 K10, EDIT-0003 T52; nur wo die Knoten gezeichnet sind).
    const punktId = editorNav && place === undefined && map ? kraftlinienpunktAm(map, map.project(lngLat)) : undefined;
    contextKraftlinienpunkt =
        punktId === undefined ? undefined : kraftlinienpunktSubjekt(punktId, t("kraftlinieneditor.punkt"));
    if (contextKraftlinienpunkt !== undefined)
        [contextKraftlinien, contextWeg, contextWege, contextFlaechen] = [[], undefined, [], []];
    // Ein Gipfel (WI-0178 P2) geht allem darunter vor, wie sein Rang beim Klick.
    contextGipfel = editorNav && place === undefined && gipfel !== undefined ? gipfelSubjekt(gipfel) : undefined;
    if (contextGipfel !== undefined)
        [contextKraftlinienpunkt, contextKraftlinien, contextWeg, contextWege, contextFlaechen] = [
            undefined,
            [],
            undefined,
            [],
            [],
        ];
    // Die Sprachflächen (WI-0261 Stufe 1, `spracheditor/sprache-kartenmenue.ts`): wie die Flächen, nur wo sonst nichts liegt, in der Ebene Sprachen.
    const nichtsSonst =
        place === undefined &&
        contextGipfel === undefined &&
        contextKraftlinienpunkt === undefined &&
        contextWeg === undefined &&
        contextWege.length + contextKraftlinien.length + contextFlaechen.length === 0;
    contextSprachen = sprachMenue.am(editorNav && nichtsSonst ? map : undefined, lngLat);
    // Ein Wetter-Icon (WI-0288) liegt über allem auf der Karte: Seine Handgriffe gehen allem darunter vor, auch einem Ort.
    contextWetter = editorNav && map ? wetterMenue.am(map.project(lngLat)) : undefined;
    if (contextWetter !== undefined)
        [
            contextGipfel,
            contextKraftlinienpunkt,
            contextKraftlinien,
            contextWeg,
            contextWege,
            contextFlaechen,
            contextSprachen,
        ] = [undefined, undefined, [], undefined, [], [], []];
    gebietGeklickt = {
        ids: contextFlaechen.flatMap((f) => (f.ref.kind === "territory" ? [f.ref.id] : [])),
        at: contextPoint,
    };
    const abschnitte = (): readonly EditorAbschnitt[] | undefined =>
        editorNav
            ? kartenAbschnitte({
                  actions: handgriffRegister(),
                  subject:
                      contextWetter ??
                      (place === undefined
                          ? (contextGipfel ?? contextKraftlinienpunkt ?? contextWeg)
                          : ortSubjekt(place)),
                  liste:
                      contextKraftlinien.length > 0
                          ? { id: "kraftlinien", titel: "powerlineChoice.count", gegenstaende: contextKraftlinien }
                          : contextWege.length > 0
                            ? { id: "wege", titel: "wegeditor.hierLaufen", gegenstaende: contextWege }
                            : contextSprachen.length > 0
                              ? sprachMenue.liste(contextSprachen)
                              : { id: "flaechen", titel: "areaChoice.count", gegenstaende: contextFlaechen },
                  anlegen: anlegenListe,
                  uebersetze: (key, params) => t(key, params),
                  sperreVon: sperrKastenVon,
                  ansicht: mapView.value,
                  // „Neuer Kraftlinienpunkt“ nur, wo kein Nodix und keine Kraftlinie liegt (F21); ein Weg oder eine Fläche dort belegt nicht.
                  frei: place === undefined && contextKraftlinienpunkt === undefined && contextKraftlinien.length === 0,
                  vereinigen: flaechenVereinigenEintrag(),
              })
            : undefined;
    kontextEditor.value = abschnitte();
    contextMenuAt.value = screen;
    // Die Sperren frisch fragen; steht DIESES Menü noch, kommt ein neuer Kasten (oder fällt ein alter weg). 🪤 Verglichen wird mit dem
    // Wert, den `contextMenuAt` jetzt trägt: `ref` macht aus dem Punkt einen Proxy, der nie `screen` selbst ist.
    const offenAm = contextMenuAt.value;
    kastenNeuZeichnen = () => {
        if (contextMenuAt.value === offenAm) kontextEditor.value = abschnitte();
    };
    const zuFragen = [
        ...(contextFlaechen.length > 0 && place === undefined ? [fremdeSperren] : []),
        ...(place !== undefined ? [fremdeOrtSperren] : []),
        ...(contextWeg !== undefined || contextWege.length > 0 ? [fremdeWegSperren] : []),
        ...(contextKraftlinien.length > 0 ? [fremdeKraftlinienSperren] : []),
    ];
    if (editorNav && zuFragen.length > 0)
        void Promise.all(zuFragen.map((fremde) => fremde.frisch())).then(() => {
            if (contextMenuAt.value === offenAm) kontextEditor.value = abschnitte();
        });
    // Am Finger trägt das Blatt die Abschnitte der Straße (T49): Sobald sie geladen sind, kommen die Einträge noch einmal.
    const wegAnker = (contextWege.length > 0 ? contextWege : contextWeg ? [contextWeg] : []).flatMap(
        (weg) => ankerVon(weg) ?? [],
    );
    if (editorNav && phoneViewport.value && place === undefined && wegAnker.length > 0)
        void Promise.all(wegAnker.map((anker) => wegAbschnitte.bereit(anker))).then(() => {
            if (contextMenuAt.value === offenAm) kontextEditor.value = abschnitte();
        });
    // „Weg hier teilen“ braucht die Punkte des Abschnitts: Sobald sie gelesen sind, kommen die Einträge noch einmal.
    if (editorNav && place === undefined && wegAnker.length > 0)
        void Promise.all(wegAnker.map((anker) => wegHierTeilen.bereit(anker))).then(() => {
            if (contextMenuAt.value === offenAm) kontextEditor.value = abschnitte();
        });
    // „Wege verbinden ›“ (WI-0252) braucht die Prüfung der Auswahl: Sobald sie da ist, kommen die Einträge noch einmal.
    if (editorNav && place === undefined && wegAnker.length > 0)
        void wegeFenster.verbindenBereit().then(() => {
            if (contextMenuAt.value === offenAm) kontextEditor.value = abschnitte();
        });
    // „Flächen vereinigen ›“ (WI-0252) braucht die Prüfung der Auswahl: Sobald sie da ist, kommen die Einträge noch einmal.
    if (editorNav)
        void flaechenVereinigen.bereit(flaechenAuswahl()).then(() => {
            if (contextMenuAt.value === offenAm) kontextEditor.value = abschnitte();
        });
    // „Unterpolygone löschen …“ (OPS-000075) braucht die Teile der Fläche jedes Gebiets unter dem Punkt: Sobald sie gelesen sind, kommen die Einträge
    // noch einmal. Gelesen wird nur mit beiden Rechten, die das Schreiben verlangt (der Lesepfad verlangt `edit_territory_form`).
    if (
        editorNav &&
        gebietGeklickt.ids.length > 0 &&
        viewer.can("edit_territory_form") &&
        viewer.can("edit_territories")
    )
        void gebietTeile.bereit(gebietGeklickt.ids, contextPoint).then(() => {
            if (contextMenuAt.value === offenAm) kontextEditor.value = abschnitte();
        });
}

/**
 * Die Entfernungsmessung zeichnen: Linie, Griffe und die Wertkapsel in der Mitte (WI-0095).
 * EINE Stelle - jede Änderung der Messung geht hier durch, egal ob Menü, Klick oder Ziehen.
 */
function showMeasure(): void {
    if (map && mapReady) updateMeasure(map, measurement.value);
    measureMarker?.show(measurement.value);
}

/** Legacy `startDistanceMeasurementAt`: Eine neue Messung LÖSCHT die alte - es gibt immer nur eine. */
function startMeasure(at: MapPoint): void {
    measurement.value = { start: at };
    showMeasure();
    showToast(t("measure.startSet"));
}

/** Legacy `clearDistanceMeasurement`: Meldet nur, wenn es wirklich etwas zu löschen gab. */
function clearMeasure(): boolean {
    if (measurement.value === undefined) return false;
    measurement.value = undefined;
    showMeasure();
    return true;
}

/** Was ein Eintrag des Kontextmenüs tut (Legacy `map-features-what-is-here.js`, route-travel-here.js). */
async function onContextAction(action: MapContextAction): Promise<void> {
    // Löschen braucht keine Stelle auf der Karte - es betrifft die Messung, nicht den Punkt.
    if (action === "measure-clear") {
        if (clearMeasure()) showToast(t("measure.cleared"), "success");
        return;
    }
    // Der Screenshot braucht keine Stelle: Er nimmt die Karte auf, wie sie steht (WI-0274).
    if (action === "screenshot") {
        // Das Bauteil lädt beim ersten Mal nach (WI-0235) und muss stehen, bevor es den Aufruf bekommt.
        void ladeBauteilVor(KartenScreenshot).then(async () => {
            screenshotEingehaengt.value = true;
            await nextTick();
            kartenScreenshot.value?.oeffne();
        });
        return;
    }
    // „Meine Reisebilder“ braucht ebenfalls keine Stelle: Es öffnet die Liste der Einreichungen, deren Link dieses Gerät gemerkt hat (WI-0272, Entwurf 9).
    if (action === "meine-reisebilder") {
        reisebildBesucher.oeffneMeine();
        return;
    }
    const point = contextPoint;
    if (!point) {
        return;
    }
    if (action === "measure") {
        // Legacy: der erste Punkt sitzt an der Stelle des Rechtsklicks, der zweite kommt per Klick.
        startMeasure(point);
    } else if (action === "travel-here") {
        /*
         * „Hierher reisen“ auf der FREIEN FLÄCHE (Legacy `travelToMapPoint`): eine Zeile, und wer der Erste ist, ist
         * der Start. 🔴 Das HÄNGT AN, es ersetzt nichts: `addMapPoint` füllt die letzte leere Zeile, sonst eine neue
         * (`fillLastEmptyWaypointOrAppend`). Dieselbe Naht wie die Aktionskachel „Reiseziel hinzufügen“ eines
         * Kartenpunkts (`info-panel/panel-actions.ts`, `addMapPoint`).
         */
        if (planner.addMapPoint(point)) {
            showToast(t("travelHere.startSet"));
        }
        if (!phoneViewport.value) {
            plannerOpen.value = true;
        }
    } else if (action === "add-destination") {
        /*
         * „Ziel hinzufügen“ auf einem ORT (WI-0100, Betreiber 2026-10-07: „fügt einen ort hinzu (wie ‚Reiseziel
         * hinzufügen‘)“): 🔴 DIESELBE Naht wie die gleichnamige Aktionskachel des Infopanels - `planner.addPlace`
         * mit demselben Wegpunkt, den `panel-action-model.ts` dort baut. Keine zweite Fassung.
         *
         * 🪤 **Keine Meldung, und das ist gemessen, nicht gesetzt:** Die Kachel zeigt bei einem Ort ebenfalls keine
         * (`panel-actions.ts` ruft `startSet` nur im Kartenpunktfall). `travelHere.startSet` spricht ausdrücklich
         * vom „Kartenpunkt“ und gehört dorthin.
         */
        const ziel = contextPlace ? { ...contextPlace, hidden: false } : contextLandmarke;
        if (ziel) {
            planner.addPlace(ziel);
            if (!phoneViewport.value) {
                plannerOpen.value = true;
            }
        }
    } else if (action === "nearest") {
        try {
            const near = await fetchNearestPlace(point);
            if (!near.place || near.distance === null) {
                showToast(t("nearest.none"), "warning");
                return;
            }
            const { id, name, subtype, x, y } = near.place;
            const place = { id, name, subtype, x, y };
            const ref = subjectRefOfPlace(place);
            if (ref) {
                subjects.openSubject(ref, {
                    source: "context",
                    camera: "none",
                    known: { title: name, presentation: { place } },
                });
            }
            whenMapReady(() => camera.value?.showPoint(renderPosition(near.place!), nearZoomOf(near.place!)));
            showToast(
                t("nearest.found", {
                    name,
                    miles: formatNumber(near.distance * AVENTURIA_TRAVEL_MODEL.meilenJeKarteneinheit.wert, 1),
                }),
            );
        } catch {
            showToast(t("nearest.failed"), "warning");
        }
    } else if (action === "what-is-here") {
        // „Was ist hier?“ (WI-0063 4.9): ein Kartenpunkt an der Stelle des Rechtsklicks, mit Tropfen und Kontext.
        // 🔴 Seit WI-0108 ist das der EINZIGE Weg dorthin - am Finger wie am Rechner, über dieselbe Stelle.
        openPoint(point);
    } else if (action === "search") {
        void search.value?.show();
    } else if (action === "photobox") {
        // „Eigenes Bild hinzufügen“ (WI-0272 S2b): das Formular der Reisebilder mit der Stelle; ein Ort unter dem Rechtsklick ist der Bezug, sonst findet die Steuerung den nächsten.
        // 🪤 Vorher auflösen: `stelle-layer.ts` misst das Fenster im nächsten Takt für den Flug zur Stelle (WI-0235).
        const ortAmPunkt = contextPlace;
        void ladeBauteilVor(ReisebildBesucher).then(() => reisebildBesucher.oeffne(point, ortAmPunkt));
    } else if (action === "report") {
        // „Hier etwas melden“ (WI-0268 C2): das Formular mit der Stelle; ein Ort unter dem Rechtsklick ist die zweite Wahl, sonst findet die Steuerung den nächsten.
        communityBesucher.oeffneStelle(
            point,
            contextPlace === undefined
                ? undefined
                : {
                      id: contextPlace.id,
                      name: contextPlace.name,
                      typ: contextPlace.subtype,
                      lage: { x: contextPlace.x, y: contextPlace.y },
                  },
        );
    }
}

/**
 * Eine freie Kartenstelle wird der gewählte Subject - sofern sie innerhalb der Karte liegt. Gerufen wird das vom
 * Menüeintrag „Was ist hier?“, und nur von ihm: Die Quelle ist deshalb immer `context` (WI-0108; vorher kam der lange
 * Druck mit `map`, und ZWEI Quellen für dieselbe Sache wären zwei Verhalten).
 *
 * 🔴 „Was ist hier?“ nennt nur die aktive Ansicht (Nachtrag zu WI-0083, Betreiber 2026-10-05 „ja“): Der Punkt nimmt die
 * teilnehmenden Landschaftsebenen mit zum Server - DIESELBE Tafel, aus der der Besitzer `area` sie bekommt
 * (`areaLayersInView`), keine zweite Liste. Ohne Tafel (Standard, Politisch, Kraftlinien, Nur Karte) fragt er wie bisher.
 */
function openPoint(point: MapPoint): void {
    const ref = subjectRefOfPoint(point);
    if (ref === undefined) return;
    const layers = areaLayersInView(mapView.value, landscapeSelection.value);
    const inView = ref.kind === "mapPoint" && layers !== undefined ? { ...ref, layers: [...layers] } : ref;
    subjects.openSubject(inView, { source: "context", camera: "none" });
}

/**
 * Ein Landschaftsname im Planer fliegt zu seiner Beschriftung (WI-0035) - GENAU wie ein Landschaftstreffer
 * der Suche (Legacy `focusSpotlightLabel`): Standardansicht, Flug. Eine zweite Fassung liefe beim
 * nächsten Regelwechsel auseinander.
 */
function showLandscape(entry: LandscapeEntry): void {
    if (!entry.target) return;
    const { label, x, y, zoom } = entry.target;
    // Der Eintrag trägt seine Region (`key`) und deren Art: Die Fläche leuchtet wie nach der Suche (WI-0043, AC2).
    // Ohne Beschriftung ist die Region selbst das Ziel, wie ihr Treffer in der Suche (WI-0047, E1).
    jumpTo({
        kind: "landschaft",
        id: label ?? entry.key,
        name: entry.name,
        ...(entry.type === "" ? {} : { subtype: entry.type }),
        x,
        y,
        zoom,
        region: entry.key,
        // Die ganze Region, wie nach der Suche (WI-0044).
        ...(entry.target.bounds === undefined ? {} : { bounds: entry.target.bounds }),
    });
}

async function showTerritory(entry: TerritoryEntry): Promise<void> {
    if (!entry.target || planner.stale.value) return;
    const target = entry.target;
    if (phoneViewport.value) plannerOpen.value = false;
    mapView.value = "political";
    await nextTick();
    openArea(
        {
            kind: "territory",
            id: entry.id,
            name: entry.name,
            type: target.type,
            anchor: { x: target.x, y: target.y },
        },
        "planner",
    );
    const zoom = renderZoomForBand(target.band) - territoryBandLead() + 0.5;
    whenMapReady(() => camera.value?.showView(renderPosition(target), zoom));
}

async function showBorder(step: BorderStep): Promise<void> {
    if (planner.stale.value) return;
    const route = planner.route.value;
    if (phoneViewport.value) {
        plannerOpen.value = false;
        await nextTick();
    }
    if (planner.stale.value || planner.route.value !== route) return;
    planner.setShowBorders(true);
    // Der gewählte Übertritt hat sein Schild vor allen anderen (Rang, Guide §15.3).
    borderLabels?.prefer(renderPosition(step));
    whenMapReady(() => camera.value?.showPoint(renderPosition(step), FLY_MAX_ZOOM));
}

/**
 * Eine Nennung in der Etappenliste öffnet ihren Gegenstand (WI-0087 P2): Ort, Kartenpunkt, Weg oder Gebiet - über
 * dieselbe EINE Öffnungsnaht wie Karte, Suche, Objektlink und Kontextmenü, und die Kamera fliegt zum Ziel der
 * Antwort (`flyToSubject`, nie ein Sprung). Der Planer bleibt offen (Legacy E7).
 *
 * 🪤 **Vorher flog hier NUR die Kamera**, `openSubject` wurde nie gerufen - deshalb blieb das Panel leer
 * (Betreiber 2026-10-05: „elemente in den etappen z.b. städtenamen kann man derzeit zwar anklicken, das infopanel
 * zeigt aber nichts an"). Die Etappenliste war die einzige Ausnahme von der Naht; jetzt ist sie keine mehr.
 */
function showStageSubject(ref: SubjectRef): void {
    subjects.openSubject(ref, { source: "planner", camera: "target" });
}

/**
 * Der Kurzlink (WI-0034): 🔗 im Planer legt ihn an, `?s=<code>` beim Laden öffnet ihn. Mit der Reise
 * reisen Serie, Ansicht und Ebene, der Ausschnitt nicht (wie Legacy).
 */
const shareLink = useShareLink({
    planner,
    currentView: () => {
        const abweichung = currentDisplayDeviation();
        return {
            series: seriesId.value,
            view: mapView.value,
            layer: landscapeSelection.value,
            ...(topographyVariant.value === DEFAULT_TOPOGRAPHY_VARIANT ? {} : { topo: topographyVariant.value }),
            ...(isDefaultDisplay(abweichung) ? {} : { display: abweichung }),
        };
    },
    applyView: (view) => {
        // Eine Serie, die dieser Betrachter nicht wählen darf (etwa `old`), bleibt, wie sie ist.
        if (seriesOptions.value.some((option) => option.id === view.series)) {
            seriesId.value = view.series;
        }
        mapView.value = view.view;
        landscapeSelection.value = view.layer;
        topographyVariant.value = view.topo ?? DEFAULT_TOPOGRAPHY_VARIANT;
        // Nach der Ansicht: Ihr Wechsel setzt die Schalter auf die Vorgaben zurück, danach gilt, was der Link sagt (WI-0072).
        displayChoices.adopt(view.display);
    },
    notify: (text, tone, link) => (link === undefined ? showToast(text, tone) : showLinkToast(text, link, tone)),
    // 🔴 Nie der Editor-Modus (`publicMapUrl`): Ein geteilter Ausschnitt gehört auf die Karte, nicht nach `/edit`.
    pageUrl: () => publicMapUrl(globalThis.location),
    copy: copyToClipboard,
    dropCode: () => {
        const params = new URLSearchParams(globalThis.location.search);
        params.delete("s");
        const rest = params.toString();
        globalThis.history.replaceState(
            null,
            "",
            `${globalThis.location.pathname}${rest === "" ? "" : `?${rest}`}${globalThis.location.hash}`,
        );
    },
});

// Eine Reise aus dem Link: zuerst ein Kurzlink `?s=`, sonst `?route=…` (auch Legacys Form). Ohne
// eigenen Blick im Link wird sie eingepasst.
const sharedCode = readShareCode(globalThis.location?.search ?? "");
const startRoute =
    sharedCode !== null
        ? shareLink.open(sharedCode)
        : planner.restore(globalThis.location?.search ?? "", linkedView === undefined);
// Danach die Objektlinks, wie Legacy (WI-0029): zuerst der Kurzlink, dann die Reise, dann `pin` und `place`, zuletzt der
// Wiki-Verweis. Ein Link, der nichts findet, sagt es; er täuscht nie die Startansicht vor (Kap. 9.57).
// Ein Link auf eine Bewertung (`?place=…&bewertung=…`, WI-0269): Der Ort öffnet wie bei jedem Objektlink; sein Panel wählt dann den Reiter „Bewertungen“ (`bewertung-ziel.ts`).
merkeBewertungsLink(globalThis.location?.search ?? "");
void startRoute
    .catch(() => undefined)
    .then(() => objectLink.open(globalThis.location?.search ?? ""))
    .then(ortWerkzeugAusLink);

/**
 * Der Stil der Karte, EINE Stelle für den ersten Aufbau und jeden Wechsel (Kamera-Sitzung
 * 2026-09-23). Himmel und Route hängen an JEDEM Stil: `setStyle` mit `diff` entfernt, was der neue
 * Stil nicht nennt.
 */
function composeStyle(): maplibregl.StyleSpecification {
    const route = withMapPin(
        withMeasure(
            withRoute(
                withAtmosphere(
                    buildPlaceStyle({
                        tileUrl: editRevision.url(tileUrl),
                        landscapeUrl: editRevision.url(landscapeUrl),
                        landscapeRunUrl: editRevision.url(landscapeRunUrl),
                        mapLabelUrl: editRevision.url(mapLabelUrl),
                        climateUrl,
                        // Die Zonennamen bringt der Stil mit, wie sie gerade stehen: Ein Stilwechsel leert sie sonst.
                        climateLabelPoints: climateLabels?.points(),
                        sprachenUrl: editRevision.url(sprachenUrl),
                        sprachenMischUrl: editRevision.url(sprachenMischUrl),
                        sprachenLabelPoints: sprachLabels?.points(),
                        pathUrl: editRevision.url(pathUrl),
                        pathLabelUrl: editRevision.url(pathLabelUrl),
                        powerlineUrl: editRevision.url(powerlineUrl),
                        leyNodeUrl: editRevision.url(leyNodeUrl),
                        powerlineArcs: powerlineArcsReady.value,
                        basemap,
                        seriesId: seriesId.value,
                        view: mapView.value,
                        landscapeSelection: landscapeSelection.value,
                        flowDirectionsVisible: viewer.can("view_flow_directions"),
                        // Verborgene Orte stehen im Editor-Modus auf jeder Stufe, für Besucher erst im Band „Verborgene Orte“ (OPS-068).
                        hiddenPlacesAlways: viewerIsEditor,
                        // Die Editoren treffen die Topographie auch in den Höhenstufen (Fund 2026-11-10): Kartenmenü, Ausschneiden, Zerschneiden.
                        flaechenTreffer: editorNav !== undefined,
                        // Die Trefferfläche der Wege ist die der Route, am Finger breiter (WI-0090) - dieselbe Zahl.
                        pathHitWidth: coarsePointer ? ROUTE_HIT_WIDTH.touch : ROUTE_HIT_WIDTH.pointer,
                        tileGrid: tileGrid.value && viewer.can("view_flow_directions"),
                        gradnetz: gradnetz.value,
                        hexraster: hexraster.value ? (hexrasterLinien?.daten() ?? HEXRASTER_LEER) : undefined,
                        highlightedClimateZone: highlightedClimateZone.value,
                        display: display.value,
                        activePlaceId: selectedPlace.value?.id,
                        areaSelection: drawnArea.value,
                        mehrfachMarkierung: mehrfachMarkierung.stand.value,
                        areaOutline: areaOutline.value,
                        contourUrl: mitAnzeigehoehe(contourUrl),
                        // Gipfel ändern sich im Editor (WI-0178 P2): die Kacheln mit der Kachelrevision.
                        peakUrl: editRevision.url(peakUrl),
                        heightBandUrl: mitAnzeigehoehe(heightBandUrl),
                        waterUrl: editRevision.url(waterUrl),
                        seenBeimFluss: seenBeimFluss.value,
                        contourDetailUrl: mitAnzeigehoehe(contourDetailUrl),
                        displayHeight,
                        territories,
                        territoryCoats,
                        // Das Band der Herrschaftsgebiete folgt dem Kamerazoom, nicht dem der Kachel (`map/territory-band.ts`).
                        cameraZoom: map?.getZoom() ?? initialView.zoom,
                        topography: topographyVariant.value,
                        locale: locale.value,
                        untergrund: untergrundImStil(editorNav !== undefined, phoneViewport.value),
                        hoehenlinien: hoehenlinienImStil(),
                    }),
                ),
                routeLayer,
                coarsePointer ? ROUTE_HIT_WIDTH.touch : ROUTE_HIT_WIDTH.pointer,
            ),
            // Die Messung hängt wie die Route an JEDEM Stil (WI-0095): `setStyle` mit `diff` entfernt sonst,
            // was der neue Stil nicht nennt - die Messung verschwände beim Wechsel der Ansicht.
            measurement.value,
        ),
        drawnPin.value,
    );
    // Das Gold der gewählten Sprache hängt wie das Leuchten der Suche an jedem Stil (WI-0261 S5c).
    // Die rote Schraffur der gefährlichen Gebiete (WI-0308) in jeder Ansicht, unter Orten, Namen und Route.
    const mitSprachen = withSprachLeuchten(
        withGefahren(route, editRevision.url(GEFAHR_KACHEL_URL)),
        sprachLeuchten.schluessel.value,
        {
            sprachenUrl: editRevision.url(sprachenUrl),
        },
    );
    // Gelände und Schattierung im Zustand der Neigung, die gerade gilt (WI-0049): sonst setzte jeder
    // Stilwechsel das Wachsen zurück.
    // In den Landschaften liest die Schattierung das Relief der ganzen Landfläche (WI-0054).
    const stil = ohneGenannte(
        withTerrain(
            // Die Prüfhaken (WI-0131): Linien unter der Route, Ringe über den Ortsmarken (`map-checks-layers.ts`).
            withSuchLeuchten(withMapChecks(mitSprachen, mapCheckResults.value), suchLeuchten.bild.value, {
                gebiete: territories,
                // Die Namen der gewählten Vorkommen bringt der Stil mit, wie sie gerade stehen (WI-0257 S5).
                namen: vorkommenNamen?.points(),
            }),
            terrain,
            terrainShare(map?.getPitch() ?? initialView.pitch ?? 0),
            // `?relief=aus` gibt den Landschaften die einfache Schattierung der Standardkarte (`map/flug-probe.ts`).
            mapView.value === "landscapes" && !reliefAus(),
            // Die Güte des Geländes: am Telefon eine andere als am Rechner (`map/flug-probe.ts`, Vorgabe heute für alle gleich).
            GELAENDE_STUFEN[gelaendeStufe(phoneViewport.value, GELAENDE_STUFEN.length)],
        ),
    );
    // „Auswahl isolieren“ (WI-0178): von den Flächen der Derographie nur die bearbeitete.
    return isoliereStil(ohneGenannte(reisebilderImStil(stil, mapView.value)), isolieren.flaeche.value);
}

/** `?ohne=` und `?derographie=aus` werfen benannte Ebenen aus dem fertigen Stil (`map/flug-probe.ts`). */
function ohneGenannte(stil: maplibregl.StyleSpecification): maplibregl.StyleSpecification {
    const woerter = ohneEbenen();
    const gefiltert =
        woerter.length === 0
            ? stil
            : { ...stil, layers: stil.layers.filter((l) => !woerter.some((w) => l.id.toLowerCase().includes(w))) };
    return deckend() ? deckendMachen(gefiltert) : gefiltert;
}

/** `rgba(r,g,b,a)` ohne Alpha; alles andere bleibt, wie es ist. */
function ohneAlpha(farbe: unknown): unknown {
    if (typeof farbe !== "string") return farbe;
    const treffer = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)$/u.exec(farbe.trim());
    return treffer ? `rgb(${treffer[1]}, ${treffer[2]}, ${treffer[3]})` : farbe;
}

/**
 * `?deckend=an`: Flächen und Linien ohne jede Durchsichtigkeit (`map/flug-probe.ts`).
 *
 * Deckkraft auf 1 und Alpha aus den Farben - nur bei EINFACHEN Werten. Ein Ausdruck (Array) bleibt stehen, weil
 * er von Zoom oder Zustand abhängt und sich nicht gefahrlos durch eine Zahl ersetzen lässt.
 */
function deckendMachen(stil: maplibregl.StyleSpecification): maplibregl.StyleSpecification {
    const layers = stil.layers.map((l) => {
        if (l.type !== "fill" && l.type !== "line" && l.type !== "background") return l;
        const paint = { ...((l as { paint?: Record<string, unknown> }).paint ?? {}) };
        for (const schluessel of ["fill-opacity", "line-opacity", "background-opacity"]) {
            if (schluessel in paint) paint[schluessel] = 1;
        }
        for (const schluessel of ["fill-color", "line-color", "background-color", "fill-outline-color"]) {
            if (schluessel in paint) paint[schluessel] = ohneAlpha(paint[schluessel]);
        }
        return { ...l, paint } as (typeof stil.layers)[number];
    });
    return { ...stil, layers };
}

onMounted(async () => {
    // Die anonyme Zählung (WI-0138): ein Seitenaufruf und danach der Takt. Sie hält nichts auf und speichert nichts im Browser.
    starteBesuchsmeldung();
    // 🔴 Die Karte entsteht erst mit dem Zeiger. Sonst wäre der Stil „fertig geladen", bevor die
    // Grundkarte darin steht - und jede Prüfung, die danach fragt, liefe gegen einen Zwischenstand.
    [basemap, terrain, displayHeight, territories, territoryCoats] = await Promise.all([
        initialBasemap,
        initialTerrain,
        initialDisplayHeight,
        initialTerritories,
        initialTerritoryCoats,
    ]);
    const kachelStand = await initialKachelStand;
    if (kachelStand !== undefined) editRevision.beginne(kachelStand, QUELLEN_NACH_ART);
    // Die Anzeigehöhen nur zum Gelände, das die Karte zeigt (Kapitel 5.32a, Regel 2): sonst keine alten Linien.
    rawDisplayHeight = displayHeight;
    displayHeight = displayHeightFor(displayHeight, terrain);
    displayHeightReady.value = displayHeight !== undefined;
    territoriesReady.value = territories !== undefined;
    // Ein Link mit `view=political`, wo es noch keine Gebietsdaten gibt: die Standardkarte statt einer leeren Ansicht.
    if (territories === undefined && mapView.value === "political") {
        politischVerlinkt = true;
        mapView.value = DEFAULT_MAP_VIEW;
    }
    if (!container.value || unmounted) {
        return;
    }

    // Wie viele Kacheln ausser Sicht gehalten werden: der Gipfel liegt im Flug, nicht im Ueberblick (`flug-probe.ts`).
    const KACHELSPEICHER = kachelSpeicher();
    map = new maplibregl.Map({
        container: container.value,
        style: composeStyle(),
        ...(KACHELSPEICHER.groesse === undefined ? {} : { maxTileCacheSize: KACHELSPEICHER.groesse }),
        // Am Telefon werden weniger Zoomstufen ausser Sicht gehalten (MapLibre haelt sonst fuenf). Ein Flug steigt von
        // Zoom 2,5 auf 7 und sammelt dabei jede Stufe mit ein; auf iOS zaehlt das in denselben Prozess, der bei rund
        // 2 GB abgeschossen wird (`flug-probe.ts`, TELEFON_VORGABE).
        ...(KACHELSPEICHER.zoomstufen !== undefined
            ? { maxTileCacheZoomLevels: KACHELSPEICHER.zoomstufen }
            : phoneViewport.value
              ? { maxTileCacheZoomLevels: 2 }
              : {}),
        center: toRenderLngLat(space, initialView.center),
        zoom: initialView.zoom,
        maxZoom: MAX_ZOOM,
        // `?dpr=` nur im Entwicklungsbuild (`map/flug-probe.ts`): Die Zwischentexturen des Geländes hängen am Quadrat dieser Zahl.
        ...((dichte): { pixelRatio?: number } => (dichte === undefined ? {} : { pixelRatio: dichte }))(
            bildpunktdichte(),
        ),
        // Drehen und Neigen (WI-0016): die Regeln stehen in `map/camera/`, nicht hier.
        ...cameraMapOptions({ zoom: initialView.zoom, bearing: initialView.bearing, pitch: initialView.pitch }),
        // Web Mercator repeats east and west because it projects a globe. Aventuria is one square
        // and ends at its edge, so the copies are switched off and the camera is fenced in.
        renderWorldCopies: false,
        maxBounds: [
            [domainBounds.southWest.lng, domainBounds.southWest.lat],
            [domainBounds.northEast.lng, domainBounds.northEast.lat],
        ],
        // 💣 Der Zaun selbst misst sich an der sichtbaren Fläche, nicht am Canvas (WI-0039): MapLibres
        // eigener kennt den Rand des Planers nicht, und der Ostrand bliebe unerreichbar. 🔴 Der Rand weicht aber nur
        // hinter Panels zurück, die ihre ganze Kante decken (`fenceInsets`, WI-0265 B9d): Unter dem halbhohen Planer
        // zeigte die Leinwand sonst leeren Hintergrund.
        transformConstrain: (lngLat, zoom) => {
            const element = map?.getCanvas() ?? container.value;
            const size = { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 };
            const fenced = constrainToVisible(
                lngLat,
                zoom,
                AVENTURIA_FENCE,
                size,
                visibleArea?.fenceInsets() ?? NO_INSETS,
                {
                    min: map?.getMinZoom() ?? MAPLIBRE_MIN_ZOOM,
                    max: MAX_ZOOM,
                },
            );
            return { center: new maplibregl.LngLat(fenced.center.lng, fenced.center.lat), zoom: fenced.zoom };
        },
        // 🔴 Keine Lizenzleiste auf der Karte (Betreiber 2026-09-24: „können wir die lizenzleiste
        // insgesamt deaktivieren? wir haben andere bestimmungen die zu nennen“, WI-0033). Bis dahin
        // stand hier ausgeklappt die Quellenzeile samt Lizenzadresse (Kap. 5.5). Die Lizenz des
        // Ulisses-Kartenpakets verlangt, dass ihre Adresse jeder Verbreitung BEILIEGT, und die
        // Kennzeichnung als Fanprojekt: beides steht unter „Hinweise“, einen Tipp entfernt - wie in
        // Legacy, das auf der Karte auch keine Leiste zeigt.
        attributionControl: false,
        locale: mapLocale(),
    });
    // 🔴 Kein `NavigationControl` mehr: der Steuerring im Bund ersetzt die Zoomknöpfe (WI-0016, D8).
    visibleArea = createVisibleArea(map);
    camera.value = createCamera(map, visibleArea);
    // Der Rahmen des Gradnetzes weicht angedockten Fenstern aus, nicht schwebenden Panels (WI-0273).
    gradnetzRahmen = installGradnetzRahmen(map, {
        sichtbar: () => gradnetz.value,
        richtung: () => ({
            nord: t("gradnetz.nord"),
            sued: t("gradnetz.sued"),
            ost: t("gradnetz.ost"),
            west: t("gradnetz.west"),
        }),
    });
    visibleArea.onCovered(() => gradnetzRahmen?.messe());
    // Das Hexraster rechnet seine Felder um die Sicht selbst nach (WI-0273).
    hexrasterLinien = installHexraster(map, { meilen: () => (hexraster.value ? hexMeilen.value : undefined) });
    // Der einmalige Kamera-Hinweis steht immer ganz in der freien Fläche (`kamera-hinweis-platz.ts`); er folgt ihr, wenn ein Panel oder
    // Fenster aufgeht oder seine Breite ändert (`onCovered`, auch ohne neuen Bezug der Mitte), und nach dessen Übergang (220 ms) noch
    // einmal, wenn der Ring an seinem Platz steht.
    const stelleHinweis = (): void => {
        if (!map) return;
        const rahmen = map.getContainer().getBoundingClientRect();
        kameraHinweisPlatz.value = hinweisPlatz(freieFlaeche(map), rahmen, globalThis.innerWidth);
        freigabeHinweisPlatz.value = phoneViewport.value
            ? {
                  top: Math.round(rahmen.top + HINWEIS_RAND),
                  right: HINWEIS_RAND,
                  maxWidth: Math.max(HINWEIS_MIN_BREITE, globalThis.innerWidth - 2 * HINWEIS_RAND),
              }
            : null;
    };
    const folgeHinweis = (): void => {
        stelleHinweis();
        setTimeout(stelleHinweis, 260);
    };
    visibleArea.onChange(folgeHinweis);
    visibleArea.onCovered(folgeHinweis);
    // Ebenen- und Modusleiste folgen dem, was Panels und Fenster wirklich decken (WI-0225, Befund T60): Das Andocken misst die Fläche erst ein
    // Bild nach Vues Takt, und die Leiste stand bis zur nächsten Größenänderung unter dem Fenster.
    visibleArea.onCovered(() => messeModusRand());
    map.on("resize", stelleHinweis);
    map.once("idle", stelleHinweis);
    stelleHinweis();
    // Wer teilnimmt, sagt die Tafel neben dem Rang (`ownersInView`): in den Klimazonen nur das Klimaband (Betreiber 2026-10-05).
    const coordinator = createInteractionCoordinator(map, {
        scope: () => ownersInView(mapView.value, landscapeSelection.value),
    });
    interaction = coordinator;
    removePointerControls = installPointerControls(map, coordinator, geometrieBelegt);
    // Im Editormodus zoomt ein Doppelklick die Karte nie (Thomas 2026-10-19 über die Editor-Orchestrierung): Dort schließt er Flächen
    // und löst Handgriffe aus (`editor-menu/doppelklick.ts`). Die Modi merken sich den Stand und stellen ihn wieder her.
    if (editorNav !== undefined) map.doubleClickZoom.disable();
    // Dunst über der fernen Karte und Himmel dahinter, sobald sie geneigt ist (WI-0016, D6).
    if (!dunstAus()) removeAtmosphere = installAtmosphere(map);
    // Nur im Entwicklungsbuild und nur mit ?melder=1 in der Adresse (`map/flug-melder.ts`).
    stopFlugMelder = installFlugMelder(map);
    // Das Band der Herrschaftsgebiete aus dem Kamerazoom, für die ganze Ansicht (WI-0062 Nachtrag), und die Bilder, die der
    // Stil nur beim Namen nennt, beim ersten Bedarf: die Muster der Schraffur umstrittener Gebiete und die Wappen (WI-0121).
    removeTerritoryBand = watchTerritoryBand(map);
    removeStyleImageResolvers = installStyleImageResolvers(map, [
        claimHatchImageResolver(map),
        coatImageResolver(map),
        // Die Schraffur der Mischgebiete je Farbpaar (WI-0261 S5a).
        sprachMischImageResolver(map),
        // Das Kategoriezeichen vor dem Namen eines gewählten Vorkommens, je Farbe (WI-0257 S5).
        vorkommenZeichenResolver(map),
    ]);
    // Die Kraftlinien als wabernde Stränge und, geneigt, als Bögen am Himmel (WI-0025 Stufe 2). Sie
    // hängen unter den Knoten, damit die Nodices und ihre Namen obenauf bleiben.
    if (!eigeneEbenenAus())
        powerlineArcs = installPowerlineArcs(map, {
            projection: createRenderProjection(space),
            active: () => composeView(mapView.value, landscapeSelection.value).powerlines,
            beforeId: NODIX_HIT_LAYER_ID,
            onReady: (ready) => {
                powerlineArcsReady.value = ready;
            },
        });
    // Querfeldein als Pillen, in jedem Bild gelegt und gerechnet (Betreiber 2026-09-24).
    if (!pillenAus()) routePills = installRoutePills(map, () => routeLayer);
    borderLabels = createRouteBorderLabels(map);
    // Die Klimanamen wandern mit der Kamera, in der freien Fläche neben den Panels.
    climateLabels = installClimateLabels(map, { insets: () => visibleArea?.keepFree() ?? {} });
    // Die Sprachnamen ebenso; sie weichen einander aus, weil sich Sprachen überlappen (WI-0261 E5).
    sprachLabels = installSprachLabels(map, { insets: () => visibleArea?.keepFree() ?? {} });
    sprachWahl.install(map);
    // Die Namen der gewählten Vorkommen ebenso, in ihrer Farbe (WI-0257 S5).
    vorkommenNamen = installVorkommenNamen(map, {
        insets: () => visibleArea?.keepFree() ?? {},
        teile: () => suchLeuchten.bild.value?.teile ?? [],
    });
    // Der Name der gewählten Landschaft tritt nur an, wo ihr gewöhnlicher Name gerade nicht gezeichnet ist (WI-0093).
    areaSelectionName = installAreaSelectionName(map, { area: () => drawnArea.value });
    // Geneigt schwebt ein Flug als Bahn im Raum, die Linie der Route tritt für ihn zurück (WI-0051 F3).
    if (!flugbahnAus()) flightArcs = installFlightArcs(map, () => routeLayer);
    // Das Wetter aus dem Auge (WI-0288): Die Engine lädt erst mit dem ersten Wetterschalter nach, nur in der Standard-Ansicht.
    installWetter(map, {
        ansicht: () => mapView.value,
        reisebeginn: () => planner.options.departure,
        // Im Replay gleitet das Wetter mit dem Reisedatum (Stufe 5): die vergangenen Tage, solange der Pfeil auf der Karte steht.
        reisetage: () => playmode.position.value?.days ?? null,
        pruefen: () => viewer.can("use_editor_menu") && checksAllowedBySession(authState.value),
        editor: () => wettereditor.anschluss.value,
        interaction: coordinator,
        // Ein Klick auf ein Icon mit Wiki-Verweis öffnet sein Infopanel (Betreiber 2026-11-08: „ja infopanel bauen“), über dieselbe Naht wie jeder Klick.
        info: {
            oeffne: (symbol, at) =>
                subjects.openSubject(
                    { kind: "wetterSymbol", id: symbol.id },
                    {
                        source: "map",
                        camera: "none",
                        known: { title: wetterIconName(symbol), presentation: {} },
                        anchor: at,
                    },
                ),
            zeige: (symbol, at) => {
                pointerHint.value = symbol === undefined || at === undefined ? undefined : wetterIconSchild(symbol, at);
            },
            offen: () => {
                const offen = subjects.selected.value;
                return offen?.kind === "wetterSymbol" ? offen.id : undefined;
            },
        },
    });
    // Das Wasser in 3D (WI-0288 Stufe 5): Meer und Seen bewegen sich, sobald die Karte geneigt ist; flach lädt nichts davon.
    installWasser(map, {
        ansicht: () => mapView.value,
        reisebeginn: () => planner.options.departure,
        reisetage: () => playmode.position.value?.days ?? null,
        erlaubt: () => startansicht().ozeanShaderAn,
    });
    // Ein neuer Stil behält den Pfeil, wo er gerade steht: Die Ebene liest ihn in jedem Bild.
    if (!eigeneEbenenAus()) travelerLayer = installTravelerLayer(map, () => travelerView.current(), flightHeightOf);
    // Gelände und Schattierung nur geneigt; bis 30° wachsen die Gebirge heraus (WI-0049, D1).
    // Die Feinheit der Zwischenbilder: die eine Zahl, an der das Telefon hängt (`DRAPE_MB` in `terrain/terrain.ts`).
    removeTerrain = installTerrain(
        map,
        () => drapeGuete() ?? GELAENDE_STUFEN[gelaendeStufe(phoneViewport.value, GELAENDE_STUFEN.length)]!.drape,
    );

    // Loading problems must be visible, not swallowed (chapter 2.16).
    map.on("error", (event) => {
        console.error("map error", event.error?.message ?? event);
    });
    // Lädt die Karte trotz geladener Seite nicht, sagt es EIN ruhiger Hinweis mit dem Satz der Störungsseite (WI-0127 SYS-6).
    removeKartenStoerung = installKartenStoerung(map);
    /*
     * Was die Karte der anonymen Zählung verrät (WI-0161): Neigung und Zoomband, beide an der Kartenruhe.
     * 🔴 Hier und nicht in `starteBesuchsmeldung`: Die Zählung beginnt oben in `onMounted`, lange vor der Karte. Bis WI-0161
     * holte sie sich `globalThis.avesmapsMap` — das Entwicklungs-Handle einige Zeilen weiter unten, das es im Release gar nicht
     * gibt. Der Haken hängte sich darum nie ein, und `tilt` hatte seit WI-0138 keine einzige Zeile.
     */
    beobachteKarte(map);
    // Fehler der Karte, Verlust des Grafikkontexts und die Worker-Falle für die Fehlererfassung (WI-0202).
    beobachteKartenfehler(map);
    // Kacheln, die ein Neustart von Tür oder Martin mit 503 scheitern ließ, kurz danach noch einmal (Thomas 4.2, Claudio 2026-10-19).
    removeKachelWiederholung = installKachelWiederholung(map);

    if (import.meta.env.DEV) {
        // Development handle for manual inspection; not shipped in a production build.
        const devGlobals = globalThis as unknown as {
            avesmapsMap?: maplibregl.Map;
            avesmapsVisibleArea?: VisibleArea;
            avesmapsPowerlineArcs?: PowerlineArcsController;
            avesmapsRoutePills?: RoutePillsController;
            avesmapsFlightArcs?: FlightArcsController;
            avesmapsTraveler?: TravelerLayerController;
            avesmapsClimateLabels?: ClimateLabels;
            avesmapsSprachLabels?: AreaLabels;
            avesmapsVorkommenNamen?: AreaLabels;
            avesmapsAreaSelectionName?: AreaSelectionName;
            avesmapsEditRevision?: typeof editRevision;
            avesmapsRenderProjection?: {
                toRenderLngLat: (point: MapPoint) => { lng: number; lat: number };
                fromRenderLngLat: (lngLat: { lng: number; lat: number }) => MapPoint;
            };
        };
        devGlobals.avesmapsMap = map;
        // Die freie Fläche (WI-0218): seit sie nicht mehr MapLibres `padding` ist, fragen die Browsertests sie hier.
        if (visibleArea) devGlobals.avesmapsVisibleArea = visibleArea;
        if (powerlineArcs) devGlobals.avesmapsPowerlineArcs = powerlineArcs;
        // Ohne `?pillen=aus` / `?flugbahn=aus` stehen sie immer; mit ihnen fehlen sie, und die Browsertests fragen nicht danach.
        if (routePills) devGlobals.avesmapsRoutePills = routePills;
        if (flightArcs) devGlobals.avesmapsFlightArcs = flightArcs;
        if (travelerLayer) devGlobals.avesmapsTraveler = travelerLayer;
        devGlobals.avesmapsClimateLabels = climateLabels;
        devGlobals.avesmapsSprachLabels = sprachLabels;
        devGlobals.avesmapsVorkommenNamen = vorkommenNamen;
        devGlobals.avesmapsAreaSelectionName = areaSelectionName;
        // Die Kachelrevision: Der Browserfall „hängende Kacheln“ (Stage 2026-10-19, Thomas 4.2) löst damit einen Wechsel aus.
        devGlobals.avesmapsEditRevision = editRevision;
        devGlobals.avesmapsRenderProjection = {
            toRenderLngLat: (point) => toRenderLngLat(space, point),
            fromRenderLngLat: (lngLat) => fromRenderLngLat(space, lngLat),
        };
        // Der Entwicklerkasten ist weg (Betreiber 2026-09-24); die Browsertests lesen den gewählten Ort hier.
        (globalThis as unknown as { avesmapsSelectedPlace?: () => SelectedPlace | undefined }).avesmapsSelectedPlace =
            () => (selectedPlace.value ? { ...selectedPlace.value } : undefined);
        // Der gewählte Subject (WI-0063): Die Browsertests lesen, was die Auswahl hält.
        (globalThis as unknown as { avesmapsSelectedSubject?: () => unknown }).avesmapsSelectedSubject = () =>
            subjects.selected.value === undefined ? undefined : { ...subjects.selected.value };
        // Und die EINE Öffnungsnaht: Ein Weg ohne Besitzer auf der Karte (Kraftlinie, bis P7) ist nur so zu öffnen. Nur Entwicklung.
        // `known` reicht nach, was die KARTE schon weiß (Name, Darstellung) - ohne das ließe sich nicht messen, wie sich das Panel
        // verhält, solange die Antwort noch kommt (WI-0088 P1).
        (
            globalThis as unknown as {
                avesmapsOpenSubject?: (ref: SubjectRef, options?: { known?: KnownSubject }) => void;
            }
        ).avesmapsOpenSubject = (ref, options) => {
            const known = options?.known;
            subjects.openSubject(ref, {
                source: "link",
                camera: "target",
                ...(known === undefined ? {} : { known }),
            });
        };
        // Und die gewählte Fläche samt dem Namen, den sie trägt (WI-0043).
        (globalThis as unknown as { avesmapsAreaSelection?: () => DrawnArea | undefined }).avesmapsAreaSelection =
            () => (drawnArea.value ? { ...drawnArea.value, anchor: { ...drawnArea.value.anchor } } : undefined);
        // Die Entfernungsmessung (WI-0095): Der Browsertest liest, welche zwei Punkte stehen und was gemessen ist.
        (
            globalThis as unknown as { avesmapsMeasurement?: () => (Measurement & { miles?: number }) | undefined }
        ).avesmapsMeasurement = () => {
            const current = measurement.value;
            if (current === undefined) return undefined;
            const value = measureMiles(current);
            return { ...current, ...(value === undefined ? {} : { miles: value }) };
        };
    }

    // Der Schriftgrößen-Regler (?labeltune=1). Ohne den Parameter tut er gar nichts.
    //
    // 🔴 Er bleibt ausdrücklich stehen (Betreiberentscheidung 2026-09-22), obwohl die fest
    // eingebaute Kalibrierung 1.5 verschwunden ist: seit pt→px und der Zoomversatz an ihrer
    // Ursache behoben sind, ist sein Wert das GEGENPRÜFEN der korrigierten Voraussetzungen, nicht
    // das Setzen einer Zahl.
    //
    // 💣 Hier stand `once("idle")`, und das war der Grund, warum der Betreiber den Regler nicht
    // fand: `idle` bedeutet „Stil geladen UND alle Kacheln da UND nichts mehr unterwegs". Hakt
    // eine einzige Kachelquelle, kommt der Zustand nie, und das Werkzeug erscheint nie - stumm,
    // ohne Fehler, auf einer Karte, die sonst funktioniert. `styledata` ist das früheste, das
    // reicht: der Regler liest Layout-Eigenschaften, und die stehen mit dem geparsten Stil.
    const karte = map;

    // 🪤 Das erste `styledata` kann noch von einem Stil kommen, der lädt (`map/style-ready.ts`): Gewartet wird auf
    // das erste, ab dem er Änderungen annimmt.
    whenStyleTakesChanges(karte, () => {
        registerRuntimeImages(karte);
        installLabelTuner(karte);
    });

    // The address follows the map, so a link can be copied at any moment. replaceState, because
    // panning is not navigation and must not fill the back button with every mouse move.
    //
    // 💣 Gebündelt, nicht bei jedem `moveend`: das Drehen mit Strg + Ziehen springt je Mausbewegung
    // (`jumpTo`), und jeder Sprung meldet ein `moveend`. Safari wirft nach 100 `replaceState` in
    // 30 s einen SecurityError - die Adresse wird deshalb erst geschrieben, wenn die Karte ruht.
    let lastWritten: ViewState | undefined;
    let writeTimer: ReturnType<typeof setTimeout> | undefined;
    const VIEW_STATE_SETTLE_MS = 150;
    const scheduleViewStateWrite = (): void => {
        clearTimeout(writeTimer);
        writeTimer = setTimeout(writeViewState, VIEW_STATE_SETTLE_MS);
    };
    const writeViewState = (): void => {
        if (!map) {
            return;
        }
        // Was in der Mitte der freien Fläche liegt, nicht in der Bildmitte (WI-0218): Dort öffnet ein Link seinen Ausschnitt.
        const [lng, lat] = visibleArea?.centreLocation() ?? [map.getCenter().lng, map.getCenter().lat];
        const view: ViewState = {
            center: fromRenderLngLat(space, { lng, lat }),
            zoom: map.getZoom(),
            series: seriesId.value,
            view: politischVerlinkt && mapView.value === DEFAULT_MAP_VIEW ? "political" : mapView.value,
            landscape: landscapeSelection.value,
            topography: topographyVariant.value,
            bearing: map.getBearing(),
            pitch: map.getPitch(),
            display: currentDisplayDeviation(),
        };
        if (sameViewState(lastWritten, view)) {
            return;
        }
        lastWritten = view;
        globalThis.history.replaceState(null, "", formatViewState(view));
    };
    map.on("moveend", scheduleViewStateWrite);
    map.on("zoomend", scheduleViewStateWrite);
    // Geht ein Panel auf oder zu, steht die Karte, aber die Mitte der freien Fläche wandert (WI-0218).
    visibleArea?.onChange(scheduleViewStateWrite);
    writeViewState();

    /**
     * Den Stil neu setzen, wenn sich Untergrund, Ansicht oder Ebene ändert.
     *
     * 🪤 `diff: true` rechnet den Unterschied aus, statt den Stil neu zu laden - Kamera, Quellen und
     * bereits geladene Kacheln bleiben. Genau deshalb muss ein Layer, der nicht mehr dazugehört,
     * AUS DEM STIL verschwinden und nicht bloß unsichtbar werden: MapLibre entfernt ihn dann samt
     * seiner Kachelanfragen.
     */
    const rebuildStyle = (): void => {
        map?.setStyle(composeStyle(), { diff: true });
        // 🪤 `diff: true` behaelt die Bildsammlung normalerweise, aber verlassen wird sich hier
        // nicht darauf: ein fehlendes Bild kostet die Pfeile lautlos.
        if (map) registerRuntimeImages(map);
        writeViewState();
    };
    // Der Regler „Untergrund“ der Editoren (WI-0178 T47): ein neuer Wert stellt nur die Deckkraft.
    beobachteUntergrund(
        () => map,
        () => mapView.value,
        rebuildStyle,
    );
    // Der Schalter „Höhenlinien“ der Editoren (WI-0236): Linien und Zahlen samt ihren Quellen aus dem Stil oder zurück.
    beobachteHoehenlinien(() => mapView.value, rebuildStyle);

    // Neue Geländekacheln ohne Neuladen (WI-0125, JOBS-0001 V5): nur die Kacheln mit neuer Revision, dazu die Anzeigehöhen nur,
    // solange sie zum gezeigten Gelände gehören (Kapitel 5.32a, Regel 2).
    const showDisplayHeight = (): void => {
        const next = displayHeightFor(rawDisplayHeight, terrain);
        if (next?.revision === displayHeight?.revision) return;
        displayHeight = next;
        displayHeightReady.value = next !== undefined;
        rebuildStyle();
    };
    void startTerrainLive({
        // Ohne Grafikkarte bleibt der Geländezeiger ungelesen (Betreiber 2026-09-27, „3: A“); Höhenlinien,
        // Höhenstufen und die Kacheln der Editoren hört die Karte trotzdem mit.
        mitGelaende: !softwareRendering,
        onTerrain: (next) => {
            if (!map || !terrain || unmounted) return;
            const before = terrain;
            terrain = next;
            if (applyTerrainPointer(map, [TERRAIN_SOURCE_ID, HILLSHADE_SOURCE_ID], before, next) === "all")
                rebuildStyle();
            showDisplayHeight();
        },
        onDisplayHeights: (pointer) => {
            rawDisplayHeight = pointer;
            showDisplayHeight();
        },
        onMapChanged: (revision, ereignis) => {
            // Gedrosselt (Thomas 2.3): Die eigene Quittung hat ihre Quellen schon geladen; nach einer reinen Wegänderung nur Wege und
            // Wegnamen, nach einer der Derographie nur ihre Quellen, und die Gebiete bleiben, wie sie sind.
            const nur = quellenFuer(ereignis?.payload["affected"], QUELLEN_NACH_ART);
            fremdeRevision.melde(revision, nur);
            if (nur !== undefined) return;
            // Hat ein Auftrag die Gebiete abgeleitet, zeichnen die Kacheln seine Flächen; die ausstehenden dieses Auftrags gehen, sobald
            // der neue Gebietszeiger da ist (sonst stünde kurz der alte Stand ohne sie).
            const gebieteAbgeleitet = ereignis?.payload["jobKind"] === "territory_derive";
            const ableitung = ereignis?.payload["jobId"];
            // B3b (WI-0209): Hat ein Auftrag `territory_derive` die Gebiete neu abgeleitet, holt die Karte den Gebietszeiger neu; nur eine
            // neue Revision baut den Stil mit den neuen Kachel-Adressen (`?rev=`) neu, wie ein neues Gelände. Bis dahin bleibt die alte
            // Ableitung sichtbar, nie „keine Gebiete“.
            const zeiger = loadTerritoryPointer();
            void zeiger.then(
                (neu) => {
                    if (unmounted || neu === undefined || neu.revision === territories?.revision) return;
                    territories = neu;
                    territoriesReady.value = true;
                    if (politischVerlinkt) mapView.value = "political";
                    rebuildStyle();
                },
                () => undefined,
            );
            if (gebieteAbgeleitet) {
                const fertig = (): void =>
                    ausstehendeGebiete.abgeleitet(typeof ableitung === "string" ? ableitung : undefined);
                void zeiger.then(fertig, fertig);
            }
        },
    }).then((stop) => {
        if (unmounted) stop();
        else stopTerrainLive = stop;
    });

    // Der Untergrund tauscht nur die Rasterquelle; Kamera, Orte und Bänder bleiben unberührt, denn
    // die Grundkarte ist ein Hintergrund, keine Daten (Kapitel 5.1).
    //
    // Die neue Serie wird erst gezeichnet, wenn ihr Zeiger da ist - bis dahin bleibt die alte stehen,
    // statt kurz ohne Gelände zu blitzen.
    let seriesRequest = 0;
    const loadSeries = async (id: string): Promise<void> => {
        const request = ++seriesRequest;
        const pointer = await readBasemap(id);
        // 🪤 Ein schnellerer zweiter Wechsel hat diesen überholt: sein Zeiger gilt, nicht dieser.
        if (request !== seriesRequest) {
            return;
        }
        basemap = pointer;
        rebuildStyle();
    };
    watch(seriesId, loadSeries);
    // 🪤 Ein Kurzlink (WI-0034) kann die Serie gesetzt haben, während die Karte noch auf ihren ersten
    // Zeiger wartete. Diesen Wechsel hat der Beobachter nicht gesehen - er wird hier nachgeholt.
    if (seriesId.value !== initialView.series) {
        void loadSeries(seriesId.value);
    }
    // Das Hexraster rechnet zuerst, damit ein Stilumbau beim Einschalten die neuen Linien schon mitbringt. Der Regler tauscht nur
    // die Daten, der Stil bleibt; die Adresse schreibt sich dann nicht von selbst.
    watch([hexraster, hexMeilen], () => {
        hexrasterLinien?.aktualisiere();
        scheduleViewStateWrite();
    });
    // Ansicht und Ebenenwahl ändern dagegen, WAS die Karte zeigt (WI-0009), die Hervorhebung WIE.
    watch(
        [
            mapView,
            landscapeSelection,
            topographyVariant,
            locale,
            highlightedClimateZone,
            sprachLeuchten.schluessel,
            display,
            tileGrid,
            gradnetz,
            hexraster,
            mapCheckResults,
            powerlineArcsReady,
            selectedPlace,
            drawnArea,
            mehrfachMarkierung.stand,
            suchLeuchten.bild,
            areaOutline,
            isolieren.flaeche,
            seenBeimFluss,
            // Der Vorzug der Bänder hängt am Gerät (`territoryBandLead`) und steckt in den Stufen der Grenzbreiten und
            // Grenznamen: ein Wechsel über die Telefongrenze (Fenstergröße eines groben Zeigers) baut den Stil neu.
            phoneViewport,
        ],
        rebuildStyle,
    );
    // Der Tropfen der Kartenstelle tauscht nur seine Daten, der Stil bleibt (WI-0063 4.9).
    watch(drawnPin, (pin) => {
        if (map && mapReady) updateMapPin(map, pin);
    });
    // WI-0058: der Umriss der Auswahl vom Server, neu bei jeder Auswahl und Ansicht, feiner beim Heranzoomen.
    watch([areaSelection, areaLookup], () => {
        areaOutline.value = undefined;
        void loadAreaOutline();
    });
    map.on("zoomend", () => {
        if (areaOutline.value && map && outlineZoom(map.getZoom()) > areaOutlineZoom) void loadAreaOutline();
    });
    // WI-0062: Die Gebiete wechseln mit dem Band (Landschaften und Wege gibt es in jedem Zoom). Wer über eine Bandgrenze
    // zoomt, behält die Auswahl, solange das Gebiet auch im neuen Band als Fläche vor ihm liegt (eine Baronie sieht in
    // den Bändern 4 bis 6 gleich aus); ist es dort keine eigene Fläche mehr, endet die Auswahl, statt als Name ohne
    // Fläche stehenzubleiben.
    let territoryBand: number | undefined;
    const currentBand = (): number => territoryBandForZoom(map?.getZoom() ?? 0);
    watch(
        areaSelection,
        (area) => {
            territoryBand = area?.kind === "territory" ? currentBand() : undefined;
        },
        { flush: "sync" },
    );
    map.on("zoomend", () => {
        const chosen = areaSelection.value;
        if (!map || chosen?.kind !== "territory" || territoryBand === undefined || currentBand() === territoryBand) {
            return;
        }
        territoryBand = currentBand();
        map.once("idle", () => {
            if (!map || areaSelection.value?.id !== chosen.id) return;
            const shown =
                map.getLayer(AREA_SELECTION_FILL_LAYER_ID) !== undefined &&
                map.queryRenderedFeatures({ layers: [AREA_SELECTION_FILL_LAYER_ID] }).length > 0;
            // Ohne eigene Fläche endet die Auswahl, und mit ihr das Panel.
            if (!shown) subjects.closeSubject({ source: "context" });
        });
    });

    // Die Karte steht: Der Planer fährt herein (am Rechner), die Route aus dem Link zieht ein, und
    // eine Fahrt, die auf die Karte gewartet hat, fährt jetzt.
    //
    // Die Fläche setzt sich erst, wenn Vue den Planer gezeichnet hat: Ein Link oder die Startansicht
    // rückt dann in die Mitte der freien Fläche (WI-0039, E3 - die einzige Stelle, an der sie rückt).
    map.once("load", () => {
        mapReady = true;
        mapHandle.value = karte;
        if (!phoneViewport.value) {
            plannerOpen.value = true;
        }
        updateRouteData(karte, routeLayer);
        updateMapPin(karte, drawnPin.value);
        showBorderLabels(routeLayer);
        void nextTick(() => {
            if (unmounted) return;
            visibleArea?.settle();
            cameraReady = true;
            const move = pendingCamera;
            pendingCamera = undefined;
            move?.();
        });
    });

    // Wer auf der Karte auf den Zeiger hört, meldet sich beim Koordinator an; den Vorrang - Ort vor Route vor
    // Fläche, der Rückfall in die freie Karte zuletzt - trägt die Rangtafel (`map/interaction/priorities.ts`).
    const removeOwners = [
        coordinator.register(
            placeOwner({
                // Tipp, Klick UND Rechtsklick (am Finger der lange Druck) wählen den Ort; das Schild beim Zeigen ist das EINE Zeiger-Schild.
                select: (place, at) => {
                    const ref = subjectRefOfPlace(place);
                    if (ref === undefined) return;
                    subjects.openSubject(ref, {
                        source: "map",
                        camera: "none",
                        known: { title: place.name, presentation: { place } },
                        anchor: at,
                    });
                },
                // Der Rechtsklick - am Finger der lange Druck - wählt oben wie der Linksklick und öffnet danach das Kartenmenü in seiner Ortsform.
                menu: (place, at, lngLat) => {
                    openContextMenu(at, lngLat, place);
                },
                hover: (hint) => {
                    pointerHint.value = hint;
                },
                umschalt: (id) => umschaltNimmt("place", id),
            }),
        ),
        // Gipfel und Vulkane (WI-0178 P2): ein Klick wählt sie, im Editor-Modus öffnet das Derographie-Fenster an ihnen; der Rechtsklick
        // öffnet danach das Kartenmenü.
        coordinator.register(
            gipfelBesitzer({
                select: (gipfel, at) => {
                    subjects.openSubject(
                        { kind: "peak", id: gipfel.id },
                        { source: "map", camera: "none", known: { title: gipfel.name }, anchor: at },
                    );
                },
                menu: (gipfel, at, lngLat) => openContextMenu(at, lngLat, undefined, gipfel),
                hover: (hint) => {
                    pointerHint.value = hint;
                },
                umschalt: (id) => umschaltNimmt("peak", id),
            }),
        ),
        // Ein Klick auf die Route wählt ihre Etappe (Legacy E6): gold auf der Karte, markiert in der Liste.
        coordinator.register(
            routeOwner({
                stale: () => planner.stale.value,
                // Die Etappe gilt wie heute (gold auf der Karte), und ihre Information öffnet im Infopanel (WI-0063 4.7).
                selectStage: (stage) =>
                    subjects.openSubject(stageRefOf(planner, stage), {
                        source: "map",
                        camera: "none",
                        known: { presentation: { stage } },
                    }),
            }),
        ),
        // Ein Klimaband (WI-0063 P8): Bänder gibt es nur in der Klimaansicht, und dort sind sie das einzige wählbare Objekt
        // (`LAYER_OWNERS`). Es öffnet sein Kopf-Panel; die Zone leuchtet wie nach dem Link aus dem Panel.
        coordinator.register(
            climateOwner({
                select: (zone, at) =>
                    subjects.openSubject(
                        { kind: "climate", band: zone.band },
                        {
                            source: "map",
                            camera: "none",
                            known: {
                                ...(zone.name === "" ? {} : { title: zone.name }),
                                presentation: { climate: zone.band },
                            },
                            anchor: at,
                        },
                    ),
                hover: (hint) => {
                    pointerHint.value = hint;
                },
            }),
        ),
        // Eine Sprache (WI-0261 S5b): nur in der Ebene „Sprachen“ gezeichnet; mehrere an einer Stelle öffnen erst das Menü am Zeiger.
        coordinator.register(sprachWahl.owner()),
        // Das Kartenmenü: der Rechtsklick am Rechner UND der lange Druck am Finger (WI-0108, Betreiber 2026-10-08:
        // „langer tap ist rechtsklick“). „Was ist hier?“ steht darin als erster Eintrag - der eigene Besitzer
        // `map-point`, der am langen Druck direkt den Kartenpunkt öffnete, ist damit weg.
        coordinator.register(contextOwner({ open: openContextMenu })),
        // Ein Klick in die freie Karte beendet die Auswahl (Legacy `_onClick`) und klappt das Panel ein.
        coordinator.register(emptyOwner({ clear: () => void subjects.closeSubject() })),
        // Jeder Klick in die Karte beendet die Hervorhebung aus der Suche (Betreiber 2026-09-23). Welcher Subject gewählt
        // bleibt, entscheidet die Auswahl: Wer ihn trifft, ersetzt ihn, die freie Karte hebt ihn auf.
        coordinator.observe("click", ({ umschalt }) => {
            highlightedClimateZone.value = undefined;
            klickHebtMehrfachAuf(umschalt);
        }),
        // 🔴 Nur Maus und Finger lösen die Kamera im Playmode vom Pfeil (Betreiber 2026-09-27: „die kamera soll nur
        // vom pfeil losgelöst sein, wenn [ich] mit maus oder touch bewusst die kartenansicht verändere“); die
        // Wiedergabe läuft weiter (WI-0053). Ring, Tasten und 3D-Knopf gehen während der Folge in die Folge
        // (`camera.ts`). 🪤 Gehört wird schon beim Aufsetzen: Jeder Folgeschritt (`jumpTo`) beendet MapLibres
        // Gesten, bevor ihr `movestart` käme - die Karte ließe sich während der Wiedergabe nicht ziehen. Der
        // Koordinator meldet Druck und Rad vor allen anderen Zuhörern der Karte (`observe("gesture")`).
        coordinator.observe("gesture", () => playmode.interrupt()),
    ];
    removeInteractionOwners = () => {
        for (const remove of removeOwners) remove();
    };
    // Eine Fläche direkt wählen; ein Klick in die freie Karte beendet die Auswahl (der Rückfall oben).
    // Stufe 2 (Betreiber 2026-09-28: „A+B+C“): Vorschau beim Zeigen, kleinste zuerst, Liste bei Überlagerung.
    removeAreaSelection = installAreaSelection(map, coordinator, {
        current: () => areaSelection.value,
        // Ein Linksklick wählt die Fläche wie im Frontend, ohne Menü (WI-0178, Betreiber 2026-10-21, wörtlich: „kannst du zum abschluss noch
        // verhindern, dass beim linksklick diese menüs kommen und nur eine normale auswahl wie im frontend passiert.“). Den Klickpunkt braucht
        // die Kamera (`holeGeklicktesHervor`); das Menü am Objekt, das er sonst öffnete, geht gleich wieder zu. Bearbeiten: Rechtsklick.
        select: (area, at) => {
            openArea(area, "map", at);
            editorMenu.close();
        },
        hint: (hint) => {
            pointerHint.value = hint === undefined ? undefined : areaPointerHint(hint);
        },
        choices: (choices) => {
            // Eine fixierte Auswahl wechselt nicht (WI-0063 4.11): Auch die Liste geht dann nicht auf.
            if (choices !== undefined && subjects.pinned.value) return;
            areaChoices.value = choices;
        },
        lookup: () => areaLookup.value,
        landscapeAreas: () => display.value.layers,
        // Nur die Flächen der aktiven Ansicht (WI-0083): dieselbe Tafel wie der `scope` des Koordinators.
        areaLayers: () => areaLayersInView(mapView.value, landscapeSelection.value),
        umschaltKlick: (area) => editorKlickFrei() && mehrfachMarkierung.umschalteAufKarte(area.kind, area.id),
    });
    // Der gemeinsame Doppelklick auf Objekte (WI-0177, EDIT-0003 R3): nur im Editor.
    if (editorNav) {
        const ohneDoppelklick = installObjektDoppelklick(map, coordinator, doppelklickSeite);
        const ohneWechsel = installGebietWechsel(coordinator, {
            laeuft: () => gebietsform.laufend.value?.phase === "bereit",
            traegt: (punkt) => gebietsform.traegt(punkt),
            layers: () => GEBIET_EBENEN,
            gebiete: (context) => gebieteAus(context.features(GEBIET_EBENEN)),
            wechsle: (id, context) => {
                const at = fromRenderLngLat(space, context.lngLat);
                const ziel = gebieteAus(context.features(GEBIET_EBENEN)).find((gebiet) => gebiet.id === id);
                const auswahl = map && ziel !== undefined ? selectionOf(map, ziel, at) : undefined;
                // Die leuchtende Fläche folgt; sonst stünde sie noch am alten Gebiet. Nur sie: `openArea` öffnete das Gebiet über die Auswahl neu, und das Fenster beendete den Modus.
                void gebietsform.wechsleAm(id, at, () => {
                    if (auswahl !== undefined) areaSelection.value = auswahl;
                });
            },
        });
        removeDoppelklick = () => {
            ohneDoppelklick();
            ohneWechsel();
        };
    }
    // Einen WEG direkt wählen (WI-0090): Straße, Pfad, Pass und Fluss, überall wo er gezeichnet ist, vor der Fläche und
    // hinter Ort, Route und Kraftlinie. 🔴 Die Auswahl ist überall gleich; der Unterschied sitzt allein in der Vorschau -
    // ein Schild immer, die gestrichelte Umrandung nur dort, wo `pathPreviewOutlined` es sagt.
    removePathSelection = installPathSelection(map, coordinator, {
        current: () => (areaSelection.value?.kind === "path" ? areaSelection.value.id : undefined),
        // Dieselbe Öffnungsnaht wie Fläche, Fluss und Gebiet: `openArea` ruft `subjects.openSubject` (WI-0063 P5).
        select: (path, at) => openArea(path, "map", at),
        hint: (hint) => {
            pointerHint.value = hint;
        },
        outline: () => pathPreviewOutlined(mapView.value),
        // Nur Wege MIT Ebene betrifft das, also die Flüsse (WI-0083 Nachtrag): dieselbe Tafel wie beim Besitzer `area`.
        layers: () => areaLayersInView(mapView.value, landscapeSelection.value),
        // Für Editoren markiert der zweite Klick den Abschnitt (WI-0177 W2b, EDIT-0003 T24 (1)).
        abschnitte: () => editorNav !== undefined && viewer.can("edit_map_geometry"),
        currentSegment: () => (areaSelection.value?.kind === "path" ? areaSelection.value.segment : undefined),
        // Umschalt-Klick (WI-0252): die Straße des Abschnitts im offenen Wege-Fenster an- oder abhaken. Die Marke ist die der Karte:
        // `name:<Name>` für eine Straße mit echtem Namen, sonst die Kennung des Abschnitts (ein Weg für sich).
        umschalt: ({ kette, abschnitt, subtype }) => {
            const name = parsePathChain(kette)?.name;
            const echt = name !== undefined && pathReaderName(name, subtype) !== null;
            const marke = echt ? kette : abschnitt;
            return marke !== undefined && editorKlickFrei() && mehrfachMarkierung.umschalteAufKarte("path", marke);
        },
    });
    // Eine Kraftlinie direkt wählen (WI-0063 P8): nur in der Kraftlinien-Ansicht, vor jeder Fläche und hinter Ort und Route. Wo die Bögen
    // gezeichnet sind, liegt die Linie dort, wo man sie sieht (auch geneigt am Himmel), sonst gilt die Trefferfläche der Kacheln.
    removePowerlineSelection = installPowerlineSelection(map, coordinator, {
        visible: () => composeView(mapView.value, landscapeSelection.value).powerlines,
        current: () => selectedPowerline.value,
        select: (line, at) => openPowerline(line, "map", at),
        umschalt: (id) => umschaltNimmt("powerline", id),
        hint: (hint) => {
            pointerHint.value = hint;
        },
        choices: (choices) => {
            // Eine fixierte Auswahl wechselt nicht (WI-0063 4.11): Auch die Liste geht dann nicht auf.
            if (choices !== undefined && subjects.pinned.value) return;
            powerlineChoices.value = choices;
        },
        reach: () => (coarsePointer ? POWERLINE_HIT_WIDTH.touch : POWERLINE_HIT_WIDTH.pointer) / 2,
        drawn: (point, reach) => powerlineArcs?.hit(point, reach),
    });
    // Die gewählte Kraftlinie glüht in den Bögen; auch eine, die vor dem ersten Bild schon gewählt war (Link). Ein gewählter
    // Nodix glüht als Knoten mit (Betreiber 2026-10-11: „beim anklicken: auch das gelb-orange“).
    stopPowerlineHighlightWatch = watch(
        [kraftlinienGlut, () => selectedPlace.value?.id],
        ([namen, ort]) => {
            powerlineArcs?.highlight(namen);
            powerlineArcs?.highlightNode(ort);
        },
        { flush: "sync", immediate: true },
    );
    // Solange die Liste der Kraftlinien offen ist, schweigt ihr Zeigen, wie bei den Flächen.
    let resumePowerlineHover: (() => void) | undefined;
    stopPowerlineChoicesWatch = watch(
        powerlineChoices,
        (choices) => {
            if (choices) {
                resumePowerlineHover ??= coordinator.suspendHover("powerline-choices", ["powerline"]);
            } else {
                resumePowerlineHover?.();
                resumePowerlineHover = undefined;
            }
        },
        { flush: "sync" },
    );
    // Solange die Liste offen ist, schweigt die Vorschau der Flächen (nur ihre; Ort und Route zeigen weiter).
    // Jeder, der die Liste schließt - Klick, Esc, Kartenbewegung, Wahl -, setzt `areaChoices` zurück.
    let resumeAreaHover: (() => void) | undefined;
    stopAreaChoicesWatch = watch(
        areaChoices,
        (choices) => {
            if (choices) {
                resumeAreaHover ??= coordinator.suspendHover("area-choices", ["area"]);
            } else {
                resumeAreaHover?.();
                resumeAreaHover = undefined;
            }
        },
        { flush: "sync" },
    );

    // Jede Kartenbewegung schließt das Kontextmenü wieder (geöffnet wird es vom Besitzer `context` oben) - und das Editor-Menü:
    // Es hängt an einem Punkt des Fensters und folgt der Karte nicht (WI-0063 P9).
    map.on("movestart", (event) => {
        // Nicht das Nachführen der sichtbaren Fläche: Geht ein Panel auf, bleibt die Karte stehen (`visible-area.ts`).
        if (isLayoutMove(event)) return;
        contextMenuAt.value = null;
        editorMenu.close();
    });
    // Jede Wegpunktmarke lässt sich ziehen und rastet auf Orten ein, Strg unterdrückt es (WI-0052).
    removeWaypointDrag = installWaypointDrag(map, coordinator, {
        current: () => routeLayer,
        placeLayers: PLACE_MARKER_LAYERS,
        drop: (key, to) => planner.moveWaypoint(key, to),
        showLabel: (label) => {
            snapLabel.value = label;
        },
    });
    // Die Entfernungsmessung (WI-0095, Finding MCS-030): Der zweite Klick setzt den Zielpunkt, beide Griffe lassen sich
    // ziehen. Begonnen und gelöscht wird im Kartenmenü, wie bei Legacy.
    measureMarker = createMeasureMarker(map);
    // „Neue Lage auf der Karte zeigen“ im Meldeformular der Besucher (WI-0268 C2, `community/lage-vorschlag.ts`); räumt sich mit der Karte selbst ab.
    installLageVorschlag(map, {
        interaction: coordinator,
        escape: escapeCascade,
        camera: () => camera.value,
        steuerung: communityBesucher,
    });
    // Die Stelle eines Reisebilds und „Stelle ändern“ im Formular „Eigenes Bild hinzufügen“ (WI-0272 S2b, `photobox/stelle-layer.ts`); räumt sich mit der Karte selbst ab.
    installStelleLayer(map, {
        interaction: coordinator,
        escape: escapeCascade,
        camera: () => camera.value,
        steuerung: reisebildBesucher,
    });
    // Die Reisebilder auf der Karte (WI-0272 S4, `photobox/reisebilder-start.ts`): nach dem ersten ruhigen Bild nachgeladen, nur in der Standardansicht.
    starteReisebilder(map, {
        interaction: coordinator,
        escape: escapeCascade,
        camera: () => camera.value,
        ansicht: () => mapView.value,
        frei: () => visibleArea?.keepFree() ?? {},
        stilNeu: rebuildStyle,
        kopfNeu: () => subjects.auffrischen(),
    });
    // „Stelle auf der Karte wählen“ in der Korrektur einer Reisebild-Einreichung durch die Redaktion (WI-0272 S3, `medien/medien-stelle-layer.ts`); nur mit dem Recht, räumt sich mit der Karte selbst ab.
    if (medienErlaubt)
        installMedienStelle(map, { interaction: coordinator, escape: escapeCascade, steuerung: medienStelle });
    if (editorNav) {
        // Der Geist der vorgeschlagenen Lage im Vorgangsfenster der Redaktion (WI-0268 C3, `community/redaktion-lage.ts`): nur zum Ansehen.
        installVorgangLage(map, { steuerung: communityRedaktion });
        const farbe = getComputedStyle(document.documentElement).getPropertyValue("--color-button-border");
        sperreSchicht = installSperreSchicht(map, farbe);
        zeigeSperren();
        // Unabhängig vom Recht beim Laden: Die Sitzung kann es erst danach kennen, und ohne Schreibrecht entsteht kein Entwurf.
        const karte = map;
        // Die Gebiete stehen in der eigenen Ebene `GEBIETE_EBENE`: gezeichnet, wo die Karte die Gebietsfüllung zeigt.
        entwurfsSchicht = installEntwurfsFlaechen(karte, (ebene) =>
            ebene === GEBIETE_EBENE
                ? karte.getLayer(TERRITORY_FILL_LAYER_ID) !== undefined
                : karte.getLayer(landscapeFillLayerId(ebene)) !== undefined,
        );
        zeigeEntwurfsflaechen();
        entwurfsBeschriftungen = installEntwurfsBeschriftungen(karte, { kachelRevision: () => editRevision.current });
        entwurfsBeschriftungen.zeige(gezogen.value);
        // Beim Kämmezeichnen liegt die Vorschau unter dem Untergrund, sein Regler wirkt über ihr (OPS-000045).
        gebirgeVorschau = installGebirgeVorschau(map);
        gipfelRing = installGipfelHervorhebung(
            map,
            getComputedStyle(document.documentElement).getPropertyValue("--color-accent-brown"),
        );
        // Vorher und Nachher einer Änderung auf der Karte (WI-0265 B5b, `map/aenderungen-overlay.ts`); räumt sich mit der Karte selbst ab.
        installAenderungenKarte(map, {
            camera: () => camera.value,
            area: visibleArea,
            escape: escapeCascade,
            phone: () => phoneViewport.value,
            panel: { zu: () => subjects.closeEditor(), auf: () => subjects.showEditor() },
            frei: freiNebenVorderstemFenster,
        });
        if (viewer.can("use_editor_menu")) {
            gebirgsNaehte = installGebirgsNaehte(map);
            gebirgsNaehte.zeige(naehteZeigen());
            verborgeneFlaechen = installVerborgeneFlaechen(map, {
                klick: (id) => {
                    subjects.showEditor();
                    landschaftseditor.oeffneFuer(id);
                },
                titel: (zeile) => t("landschaftseditor.verborgen.auge", { name: zeile.name }),
            });
            void ladeVerborgene();
        }
        for (const fremde of alleFremdenSperren) void fremde.frisch();
    }
    showMeasure();
    // Ziehen aus der Ortsliste auf die Karte (WI-0128 E16): nur mit Recht an der Geometrie und eingeschaltetem Bearbeiten.
    removePlaceDrop = installPlaceDrop(map, {
        annehmen: () =>
            editorNav !== undefined &&
            editorPanelRechte.includes("edit_map_geometry") &&
            ortseditor.bearbeiten.value?.mapEditing === "testwelt",
        abgelegt: (key, punkt) => {
            const zeile = ortSetzenZeile(key);
            if (zeile) void ortSetzen.setze(zeile, punkt);
        },
    });
    removeMeasure = installMeasure(map, coordinator, {
        current: () => measurement.value,
        complete: (at) => {
            const started = measurement.value;
            if (started === undefined) return;
            measurement.value = { ...started, end: at };
            showMeasure();
        },
        move: (handle, to) => {
            const started = measurement.value;
            if (started === undefined) return;
            measurement.value = withHandleAt(started, handle, to);
            showMeasure();
        },
    });
});

/**
 * Ein Suchtreffer ist ein Sprung dorthin (WI-0013).
 *
 * 🪤 Der Treffer trägt Kartenkoordinaten in `aventuria-v1`, nie Renderkoordinaten (ADR-0003) — die
 * Umrechnung geschieht hier, an derselben Stelle wie für jeden geteilten Link.
 *
 * Jede Suchklasse schaltet zusätzlich in ihre bevorzugte Ansicht (`focusForHit`).
 */
function jumpTo(hit: SearchHit): void {
    const focus = focusForHit(hit);
    mapView.value = focus.view;
    if (focus.landscape) {
        landscapeSelection.value = focus.landscape;
    }
    // Der Treffer wird der gewählte Subject (WI-0063 P5): Ort, Landschaft mit Region (WI-0043, leuchtet) und Weg-Kette. Ein
    // freies Label und eine Klimazone sind nur ein Sprungziel, die Klimazone bleibt Kontext (`highlightedClimateZone`); sie
    // beenden eine vorige Auswahl.
    const ref = subjectRefOfHit(hit);
    if (ref === undefined) {
        subjects.closeSubject({ source: "search" });
    } else {
        subjects.openSubject(ref, {
            source: "search",
            camera: "none",
            known: { title: hit.name, presentation: presentationOfHit(hit) },
        });
    }
    // Nach dem Schließen: Es räumt auch die Klimazone ab.
    highlightedClimateZone.value = focus.climateZone;
    // Ein Ort ist ein Punkt (Mindestnähe, nie heraus); Weg, Landschaft und Klimazone sind ein Ausschnitt
    // mit eigenem Zoom (WI-0039). Beides über die gemeinsame Kamera, nicht mehr an ihr vorbei.
    // Kennt der Treffer seinen ganzen Umriss (Weg, Landschaft), passt die Karte ihn ein, auch weit heraus
    // (WI-0044, Betreiber 2026-09-26: „ja“). Nur heran ist gedeckelt, wie in Legacy.
    const center = renderPosition(hit);
    const bounds = hit.kind === "weg" || hit.kind === "landschaft" ? hit.bounds : undefined;
    whenMapReady(() => {
        if (hit.kind === "ort") {
            camera.value?.showPoint(center, placeNearZoom(hit.subtype));
        } else if (bounds !== undefined && (hit.kind === "weg" || hit.kind === "landschaft")) {
            camera.value?.showBounds(renderBox(bounds), { maxZoom: SEARCH_FIT_MAX_ZOOM[hit.kind] });
        } else {
            camera.value?.showView(center, hit.zoom);
        }
    });
}

/**
 * Ein Vorkommen der Spotlight-Suche ist gewählt (WI-0257 S3b): Sein Panel geht auf (der Eintrag ist ein Subject wie jedes andere, `loreEntry`), und seine Gegenden leuchten; die Kamera fliegt auf den
 * gemeinsamen Rahmen. Wo der Eintrag keinen Ort auf der Karte hat, geht nur das Panel auf.
 */
function chooseVorkommen(hit: SearchVorkommenHit): void {
    zeigeEintrag(hit.id, hit.name, hit.kind);
    if (hit.kartenbezug) void leuchteAnfrage(hit.leuchten);
}

/**
 * Das Panel eines Eintrags öffnen (der Eintrag ist ein Subject wie jedes andere, `loreEntry`). Am Telefon deckte es die ganze Karte: Dort bleibt es eingeklappt, die Karte zeigt zuerst, was leuchtet,
 * und die Pille „Eintrag öffnen“ (`info-eintrag-pille.vue`) holt es nach vorn.
 *
 * 🔴 **Die EINE Hand für drei Wege:** der Treffer der Suche, eine Zeile von „Unterwegs“ in den Routendetails (`@show-eintrag` am Planer) und der Name in einer Vorkommenszeile der Infobox
 * (`EINTRAG_OEFFNEN`, `info-lore-entry.vue`). Das Öffnen ruft `present({})` und beendet damit das Leuchten der Suche: Wer danach leuchten lassen will, tut es NACH dem Öffnen.
 */
function zeigeEintrag(id: string, name: string, kind: InhalteVorkommenArt): void {
    subjects.openSubject(
        { kind: "loreEntry", id },
        { source: "search", camera: "none", known: { title: name, presentation: {} } },
    );
    eintragKopf.value = { name, kind };
    if (phoneViewport.value) subjects.collapsePanel();
}
const eintragKopf = shallowRef<{ name: string; kind: InhalteVorkommenArt } | undefined>(undefined);
/**
 * Der Sammelscreen „Ausgewählte Vorkommen“ (WI-0257 S5) steht an Stelle des Panelinhalts, solange zwei oder mehr gewählt sind und das Panel den Eintrag zeigt, den die Auswahl zuletzt
 * geöffnet hat (er liegt darunter). Wechselt das Subject, gilt wieder sein Panel.
 */
const sammelSichtbar = computed(
    () =>
        unterwegsAuswahl.ansicht.value === "sammel" &&
        unterwegsAuswahl.zeilen.value.length >= 2 &&
        subjects.selected.value?.kind === "loreEntry" &&
        subjects.selected.value.id === unterwegsAuswahl.anker.value,
);
/** Die Pille am Telefon: das Vorkommen mit „Eintrag öffnen“, beim Sammelscreen „Ausgewählte Vorkommen“ mit der Zahl der gewählten. */
const pille = computed(() => {
    if (sammelSichtbar.value) {
        const n = unterwegsAuswahl.zeilen.value.length;
        return {
            name: t("vorkommen.sammel.titel"),
            zeichen: "vorkommen" as const,
            hinweis: tPlural("planner.unterwegs.anzahl", n, { n: formatNumber(n, 0) }),
        };
    }
    const kopf = eintragKopf.value;
    return kopf === undefined
        ? undefined
        : { name: kopf.name, zeichen: KATEGORIE_ZEICHEN[kopf.kind], hinweis: t("eintrag.pille.oeffnen") };
});
/** Die Pille steht nur am Telefon, solange das Panel eines Eintrags eingeklappt hinter der Karte steht. */
const eintragPilleSichtbar = computed(
    () =>
        phoneViewport.value &&
        eintragKopf.value !== undefined &&
        subjects.selected.value?.kind === "loreEntry" &&
        subjects.slot.value === "info" &&
        !subjects.panelVisible.value &&
        // Über dem offenen Planer läge sie auf dessen Kopf (WI-0257 S5: Wer in „Vorkommen unterwegs“ mehrere wählt, bleibt im Planer); sie kommt wieder, wenn er zufährt.
        !plannerOpen.value,
);

/**
 * Eine fertige Anfrage „Begriff in Ziel“ ist gewählt: Der Eintrag (wo der Begriff einer ist) öffnet sein Panel, die Anfrage leuchtet auf das Ziel zugeschnitten. Eine Landschaftsart („Wald in Kosch“) hat
 * kein Panel; ein offenes Subject endet.
 */
function chooseZiel(begriff: SearchLeuchtenBegriff, ziel: SearchZielHit): void {
    if (ziel.leuchten === undefined) return;
    if (begriff.eintrag === undefined || begriff.kind === undefined) {
        subjects.closeSubject({ source: "search" });
    } else {
        zeigeEintrag(begriff.eintrag, begriff.name, begriff.kind);
    }
    void leuchteAnfrage(ziel.leuchten);
}

/** Ein Herrschaftsgebiet der Suche: die politische Ansicht (wo es Gebiete gibt), das Gebiet wird gewählt, die Kamera passt seinen Umriss ein. */
async function chooseGebiet(hit: SearchGebietHit): Promise<void> {
    if (territoriesReady.value) mapView.value = "political";
    await nextTick();
    openArea(
        { kind: "territory", id: hit.id, name: hit.name, type: hit.typ ?? "", anchor: { x: hit.x, y: hit.y } },
        "search",
    );
    whenMapReady(
        () => void camera.value?.showBounds(renderBox(hit.bounds), { maxZoom: SEARCH_FIT_MAX_ZOOM.landschaft }),
    );
}

/**
 * Eine Landmarke der Spotlight-Suche ist gewählt (WI-0271 L6): Ihr Panel geht auf wie nach einem Klick auf ihr Zeichen, und die Karte fliegt zum Ziel ihrer Antwort
 * (`target`, wie ein geteilter Link auf einen Gipfel).
 */
function chooseLandmarke(hit: SearchLandmarkeHit): void {
    subjects.openSubject(
        { kind: "peak", id: hit.id },
        { source: "search", camera: "target", known: { title: hit.name } },
    );
}

onBeforeUnmount(() => {
    unmounted = true;
    unterwegsAuswahl.abbauen();
    stopHashFolgen();
    removePointerControls?.();
    removeAtmosphere?.();
    stopFlugMelder?.();
    removeTerritoryBand?.();
    removeStyleImageResolvers?.();
    removeTerrain?.();
    removeKartenStoerung?.();
    removeKachelWiederholung?.();
    stopTerrainLive?.();
    removeInteractionOwners?.();
    removeAreaSelection?.();
    gradnetzRahmen?.entferne();
    gradnetzRahmen = undefined;
    hexrasterLinien?.entferne();
    hexrasterLinien = undefined;
    removeDoppelklick?.();
    removePathSelection?.();
    removePowerlineSelection?.();
    stopAreaChoicesWatch?.();
    stopPowerlineChoicesWatch?.();
    stopPowerlineHighlightWatch?.();
    removeWaypointDrag?.();
    removeMeasure?.();
    measureMarker?.destroy();
    measureMarker = undefined;
    sperreSchicht?.entferne();
    sperreSchicht = undefined;
    verborgeneFlaechen?.entferne();
    verborgeneFlaechen = undefined;
    entwurfsSchicht?.entferne();
    entwurfsSchicht = undefined;
    entwurfsBeschriftungen?.entferne();
    entwurfsBeschriftungen = undefined;
    gipfelRing?.entferne();
    gipfelRing = undefined;
    gebirgsNaehte?.entferne();
    gebirgsNaehte = undefined;
    gebirgeVorschau?.entferne();
    gebirgeVorschau = undefined;
    stopPlannerBinding();
    stopPhoneExclusion();
    stopEditorMerken();
    stopWerkzeugLaschen();
    stopListenSchalter();
    for (const stop of stopListeImModus) stop();
    stopMedienWerkzeug();
    stopMedienAblage();
    stopMedienWahl();
    stopMesswerteFenster();
    stopMesswerteAblage();
    document.removeEventListener("keydown", landschaftTasten);
    document.removeEventListener("keydown", gebietTasten);
    landschaftseditor.destroy();
    kraftlinieneditor.destroy();
    wegeFenster.destroy();
    gebietseditor.destroy();
    ecken.destroy();
    isolieren.destroy();
    flaecheVereinfachen.destroy();
    flaecheVerschieben.destroy();
    flaecheMalen.destroy();
    gebietsform.destroy();
    zoombaender.destroy();
    freigabeBitten.destroy();
    freigabeAnfragen.destroy();
    editorSperre.destroy();
    for (const fremde of alleFremdenSperren) fremde.destroy();
    document.removeEventListener("keydown", entwurfTasten);
    globalThis.removeEventListener("resize", beiGroesse);
    document.removeEventListener("transitionend", nachEinzug);
    stopMesswerteMerken();
    stopAnsichtMelden();
    ortseditor.destroy();
    karteninhaltZahlen.destroy();
    ortVerschieben.destroy();
    wegkurve.destroy();
    neuerWeg.destroy();
    neueKraftlinie.destroy();
    neueFlaeche.destroy();
    spracheditor.destroy();
    wettereditor.destroy();
    document.removeEventListener("keydown", kraftlinieTasten);
    kraftlinieKurve.destroy();
    ortSetzen.destroy();
    stopSetzMeldung();
    removePlaceDrop?.();
    stopVerschiebenFenster();
    stopEditorMenuEscape();
    stopMedienAdresse();
    editorMenu.destroy();
    subjects.destroy();
    playmode.dispose();
    powerlineArcs?.remove();
    routePills?.remove();
    borderLabels?.clear();
    climateLabels?.remove();
    climateLabels = undefined;
    sprachLabels?.remove();
    sprachLabels = undefined;
    vorkommenNamen?.remove();
    vorkommenNamen = undefined;
    areaSelectionName?.remove();
    areaSelectionName = undefined;
    flightArcs?.remove();
    travelerLayer?.remove();
    removeKeyboard();
    camera.value?.destroy();
    camera.value = undefined;
    visibleArea?.destroy();
    visibleArea = undefined;
    interaction?.destroy();
    interaction = undefined;
    map?.remove();
    map = undefined;
});
</script>

<template>
    <div
        class="app"
        :style="{
            ...(slotBreite ? { '--avm-slot-breite': slotBreite } : {}),
            ...(ebenenOben ? { '--avm-leiste-oben': `${String(ebenenOben + MODUS_UNTER_EBENEN_PX)}px` } : {}),
        }"
    >
        <div ref="mapContainer" class="map" data-testid="map"></div>
        <WaypointSnapLabel :label="snapLabel" />
        <!-- Die Eckknopf-Bunde (Guide §9): EIN Container positioniert, die Knöpfe gestalten nur sich
             selbst. Am Rechner steht der Steuerring samt 3D-Lasche oben rechts (WI-0027, Betreiber
             2026-09-23: „kannst du das navigationsrad nach oben rechts verschieben?“). Am Finger
             bleiben 3D-Knopf und Kompass unten beim Daumen, über Suchkachel und Kartenfächer
             (Betreiber 2026-09-23: „3d knopf am handy in daumennähe lassen“). -->
        <div
            v-if="camera && !coarsePointer"
            class="corner corner--top"
            :class="{ 'corner--shifted': panelShifts, 'corner--tabbed': tabShifts }"
            :style="
                modusHoehe ? { top: `calc(var(--space-10) + ${String(modusHoehe)}px + var(--space-6))` } : undefined
            "
        >
            <CameraControls :camera="camera" :hinweis-platz="kameraHinweisPlatz" />
        </div>
        <div
            class="corner"
            :class="{
                'corner--covered': phoneViewport && (plannerOpen || subjects.slotOpen.value),
                'corner--shifted': panelShifts,
            }"
            :style="
                modusHoehe && phoneViewport ? { bottom: `calc(${String(modusHoehe)}px + var(--space-6))` } : undefined
            "
        >
            <CameraControls v-if="camera && coarsePointer" :camera="camera" />
            <!-- Das Auge über der Lupe, wie Legacy (Owner 12.08.2026: „ein eigenes neues menü über dem suchen button"). -->
            <!-- Was der Mensch umlegt, ist seine Wahl (`display-choices.ts`); die Vorgaben setzt die Ansicht. -->
            <DisplayMenu
                v-model:tile-grid="tileGrid"
                v-model:gradnetz="gradnetz"
                v-model:hexraster="hexraster"
                v-model:hex-meilen="hexMeilen"
                v-model:checks="mapChecksOn"
                :display="display"
                :view="mapView"
                :layer="landscapeSelection"
                :territories-ready="territoriesReady"
                @update:display="displayChoices.choose"
            />
            <SpotlightSearch
                ref="search"
                @jump="jumpTo"
                @vorkommen="chooseVorkommen"
                @ziel="chooseZiel"
                @gebiet="chooseGebiet"
                @landmarke="chooseLandmarke"
                @sprache="sprachWahl.waehleAusSuche"
            />
            <!-- Die Legende der Höhenstufen steht über dem Fächer (WI-0055, Blatt 3): Braucht seine Unterreihe
                 Platz, rückt sie mit Auge und Lupe hoch. -->
            <HeightLegend v-if="heightLegend" />
            <!-- Die Legende der Sprachen an derselben Stelle (WI-0261 S5a), nur mit dem Auge „Sprachenlegende“; am Telefon zugeklappt. -->
            <SprachenLegende
                v-if="sprachLegende"
                :sprachen="sprachenStand.zeilen.value"
                :zugeklappt="phoneViewport"
                :gewaehlt="sprachWahl.gewaehlt.value"
                @waehle="sprachWahl.waehle"
                @zeige="sprachWahl.zeige"
            />
            <!-- Der Kartenfächer, 1:1 wie Legacys Ansichts-Kachel (WI-0024). -->
            <MapFan
                v-model:view="mapView"
                v-model:landscape-selection="landscapeSelection"
                v-model:topography="topographyVariant"
                v-model:series-id="seriesId"
                :series="fanSerien"
                :territories-ready="territoriesReady"
            />
            <!-- Die beiden Verweise als letzte Reihe, wie Legacy (WI-0028). -->
            <CornerLinks @news="newsOpen = true" @notes="openNotes(null)">
                <ReisebilderKnopf v-if="mapView === 'standard'" />
            </CornerLinks>
        </div>
        <!--
            Die Maßstabsleiste unten links (WI-0096). Legacy hat eine, wir hatten keine. Sie steht links,
            weil unten rechts der Eckbund sitzt und unten mittig der Toast auffährt; wie weit links, sagt
            die freie Kartenfläche selbst. Am Telefon tritt sie zurück wie der Bund.
        -->
        <ScaleBar
            :map="mapHandle"
            :insets="() => visibleArea?.keepFree() ?? {}"
            :covered="phoneViewport && (plannerOpen || subjects.slotOpen.value)"
            :layout="`${String(plannerOpen)}/${String(subjects.slotOpen.value)}/${String(phoneViewport)}`"
        />
        <!-- Die Leiste der Reisebilder (WI-0272 S4): über die ganze Breite am unteren Rand, nur in der Standardansicht, am Telefon nicht neben einem offenen Panel. -->
        <ReisebilderHost
            v-if="mapHandle"
            :standard="mapView === 'standard'"
            :verdeckt="phoneViewport && (plannerOpen || subjects.slotOpen.value)"
        />
        <!-- Der Routenplaner dockt links an (WI-0017) und liegt über dem Entwicklerkasten. -->
        <RoutePlanner
            ref="plannerPanel"
            v-model:open="plannerOpen"
            :planner="planner"
            :phone="phoneViewport"
            :playmode="playmode"
            :share-link="shareLink"
            :landscapes="landscapes.lines.value"
            @show-subject="showStageSubject"
            @show-landscape="showLandscape"
            @show-border="showBorder"
            @show-territory="showTerritory"
        />
        <!-- Das Infopanel am rechten Rand (WI-0063 P5): die Hülle des rechten Slots, der Inhalt kommt aus der Auswahl. -->
        <InfoPanel
            :selection="subjects"
            :phone="phoneViewport"
            :route="planner.route.value"
            :landscapes="landscapes.lines.value"
            :custom-air-name="selectedAir(planner.air).name"
            :point-names="plannerPointNames"
            :actions="panelActions"
            :standard="mapView === 'standard'"
        >
            <!-- Ab zwei gewählten in „Vorkommen unterwegs“: der Sammelscreen über dem Panel des Eintrags (WI-0257 S5). -->
            <template v-if="sammelSichtbar" #ersatz>
                <InfoVorkommenSammel
                    :zeilen="unterwegsAuswahl.zeilen.value"
                    :farben="unterwegsAuswahl.farben.value"
                    @oeffne="unterwegsAuswahl.oeffne($event)"
                    @entferne="unterwegsAuswahl.entferne($event)"
                    @leere="unterwegsAuswahl.leere()"
                />
            </template>
            <template v-if="editorNav" #bearbeiten="{ shown }">
                <HandgriffGruppe
                    v-if="
                        shown.status === 'ready' &&
                        handgriffZeilen(handgriffRegister(), subjectOf(shown), 'infopanel').length > 0
                    "
                    :zeilen="handgriffZeilen(handgriffRegister(), subjectOf(shown), 'infopanel')"
                    :nur-lesen="!editorPanelRechte.includes('edit_map_objects')"
                    @griff="(id: string) => fuehreAus(handgriffRegister(), id, subjectOf(shown), viewer)"
                />
            </template>
        </InfoPanel>
        <!-- Am Telefon: das eingeklappte Panel eines Vorkommens als Pille über der leuchtenden Karte (WI-0257 S3b). -->
        <InfoEintragPille
            v-if="eintragPilleSichtbar && pille"
            :name="pille.name"
            :zeichen="pille.zeichen"
            :hinweis="pille.hinweis"
            @oeffne="subjects.togglePanel()"
        />
        <!-- Das Editorpanel teilt den rechten Slot mit dem Infopanel (WI-0128 E3): zwei Laschen, eins offen. -->
        <EditorPanel
            v-if="editorNav"
            :selection="subjects"
            :phone="phoneViewport"
            :nav="editorNav"
            :rechte="editorPanelRechte"
            :werkzeuge="editorWerkzeuge"
            :fenster="werkzeugfenster"
            :zahlen="karteninhaltZahlen"
            @ansicht="hinflugAnsicht"
            @oeffne="oeffneWerkzeug"
            @messwerte="oeffneMesswerte()"
        />
        <!-- Die Ortseditoren (WI-0128 E6): Werkzeugfenster im rechten Slot, angedockt, gelöst oder abgelegt. -->
        <template v-if="editorNav">
            <!-- Der Landschaftseditor (WI-0178 A3), lesend; die Ebene der Karte wählt die Liste (T27 (1)). -->
            <LandschaftseditorFenster
                v-for="fenster in landschaftseditor.fenster.value"
                :key="fenster.id"
                :fenster="fenster"
                :mehrfach-ziel="(art: 'landscape' | 'peak', ziel: MehrfachZiel) => mehrfachMarkierung.ziel(art, ziel)"
                :liste-zu="listenSchalter.zu(fenster.id)"
                :liste="landschaftseditor.liste.value"
                @mehrfach="
                    (m) => {
                        mehrfachMarkierung.setze(`landschaften-${fenster.id}`, 'landscape', m.landschaften);
                        mehrfachMarkierung.setze(`gipfel-${fenster.id}`, 'peak', m.gipfel);
                    }
                "
                :lade-fehler="landschaftseditor.ladeFehler.value"
                :einstellung="landschaftseditor.listenEinstellung"
                :bearbeitung="landschaftseditor.bearbeitungVon(fenster.gegenstand)"
                :verlauf="landschaftseditor.verlaufVon(fenster.gegenstand)"
                :zieht="
                    beschriftungZiehen.laufend.value?.regionId === fenster.gegenstand
                        ? beschriftungZiehen.laufend.value?.labelId
                        : undefined
                "
                :darf="verbModus(EDITORPANEL, 'regionen', editorPanelRechte) === 'bearbeiten'"
                :darf-form="editorPanelRechte.includes('edit_landscape_form')"
                :darf-gebirge="editorPanelRechte.includes('edit_mountains')"
                :quellen-recht="editorPanelRechte.includes('manage_sources')"
                :ebene="mapView === 'landscapes' ? landscapeSelection : undefined"
                :ablage-ziel="ortseditor.ablageZiel"
                :reiter-wunsch="landschaftseditor.reiterWunsch.value"
                :entferne="
                    fenster.gegenstand === undefined
                        ? undefined
                        : (stage: 'off_map' | 'retire') => landschaftseditor.entferne(fenster.gegenstand!, stage)
                "
                :entfernen-wunsch="landschaftseditor.entfernenWunsch.value"
                :kopiere="
                    fenster.gegenstand === undefined
                        ? undefined
                        : (areaId: string, ziel: KopierZiel) => kopiereFlaeche(fenster.gegenstand!, areaId, ziel)
                "
                :kopieren-wunsch="landschaftseditor.kopierenWunsch.value"
                :entferne-alle="
                    (ids: readonly string[], stage: 'off_map' | 'retire') => landschaftseditor.entferneAlle(ids, stage)
                "
                :name-wunsch="landschaftseditor.nameWunsch.value"
                :gipfel="landschaftseditor.gipfelBearbeitungVon(fenster.gegenstand)"
                :gipfel-hoehe-im-gipfel="landschaftseditor.gipfelHoeheImGipfel"
                :gipfel-hoehe-im-gebirge="landschaftseditor.gipfelHoeheImGebirge"
                :beschriftungen="beschriftungen"
                :gipfel-zieht="
                    gipfelZiehen.laufend.value !== undefined && gipfelZiehen.laufend.value === fenster.gegenstand
                "
                @sammel="(entwurf: SammelEntwurf<LandschaftSammelFelder> | undefined) => (landschaftSammel = entwurf)"
                @sammel-geschrieben="sammelGeschrieben"
                @kopieren-gesehen="landschaftseditor.kopierenGesehen()"
                @verschiebe-gipfel="
                    (an: boolean) =>
                        an && fenster.gegenstand !== undefined
                            ? gipfelZiehen.starte(fenster.gegenstand)
                            : gipfelZiehen.beende()
                "
                @update:auswahl="(id: string | undefined) => waehleLandschaft(id, fenster.id)"
                @einzeln="(id: string) => landschaftseditor.waehle(id, fenster.id)"
                @fliege="fliegeZuLandschaft"
                @oeffne-quelle="oeffneInhalteQuelle"
                @zeige="zeigeGipfel"
                @gipfel="(id: string) => landschaftseditor.oeffneGipfel(id)"
                @gipfel-zeigen="(lage) => gipfelRing?.zeige(lage)"
                @gebirge-vorschau="(bild) => gebirgeVorschau?.zeige(bild)"
                @gebirge-vorschau-fein="(bild) => gebirgeVorschau?.zeigeFein(bild)"
                @objekt="
                    (art, id) =>
                        art === 'weg' ? wegeFenster.oeffneFuer({ anchor: id }) : landschaftseditor.oeffneFuer(id)
                "
                @kaemme-zeichnen="
                    (flaeche: string) => fenster.gegenstand && kammNetz.umschalten(fenster.gegenstand, flaeche)
                "
                :kaemme-laufen="
                    kammNetz.laufend.value !== undefined && kammNetz.laufend.value.id === fenster.gegenstand
                "
                @ebene="(ebene) => hinflugAnsicht(ansichtFuerHinflug({ art: 'landschaft', ebene }))"
                @band="(b: number) => camera?.zoomBy(zoomFuerBand(b) - camera.state().zoom)"
                @liste-zu="(zu: boolean) => listenSchalter.schalte(fenster.id, zu)"
                @lage="(lage, box) => werkzeugfenster.setzeLage(fenster.id, lage, box)"
                @box="(box) => werkzeugfenster.setzeBox(fenster.id, box)"
                @vorn="werkzeugfenster.nachVorn(fenster.id)"
                @schliesse="werkzeugfenster.schliesse(fenster.id)"
                @erneut="landschaftseditor.ladeListe()"
                @setze-kandidat="setzeKandidat"
                @zeichne-wiki-eintrag="zeichneWikiEintrag"
                @zurueckholen="fenster.gegenstand !== undefined && verbirgLandschaft(fenster.gegenstand, false)"
                @verschiebe="
                    (labelId: string | undefined) =>
                        labelId === undefined || fenster.gegenstand === undefined
                            ? beschriftungZiehen.beende()
                            : beschriftungZiehen.starte(fenster.gegenstand, labelId)
                "
            />
            <!-- Der Gebietseditor (WI-0209 A3), lesend; ein Klick in der Liste stellt die Ansicht „Politisch“ (F17). -->
            <GebietseditorFenster
                v-for="fenster in gebietseditor.fenster.value"
                :key="fenster.id"
                :fenster="fenster"
                :liste-zu="listenSchalter.zu(fenster.id)"
                :liste="gebietseditor.liste.value"
                :lade-fehler="gebietseditor.ladeFehler.value"
                :einstellung="gebietseditor.listenEinstellung"
                :bearbeitung="gebietseditor.bearbeitungVon(fenster.gegenstand)"
                :darf="verbModus(EDITORPANEL, 'territorien', editorPanelRechte) === 'bearbeiten'"
                :darf-form="editorPanelRechte.includes('edit_territory_form')"
                :quellen-recht="editorPanelRechte.includes('manage_sources')"
                :hierarchie="gebietseditor.hierarchie.value"
                :hierarchie-fehler="gebietseditor.hierarchieFehler.value"
                :baender="zoombaender"
                :baender-grund="zoombaender.grund.value"
                :befunde="gebietseditor.befunde.value"
                :ablage-ziel="ortseditor.ablageZiel"
                :medien="medienErlaubt"
                :reiter-wunsch="gebietseditor.reiterWunsch.value"
                :entferne="gebietEntfernen"
                :zeichnen="zeichenGrund('gebiet') === undefined"
                :name-markieren="gebietAnlegen.nameMarkieren.value"
                :mehrfachauswahl="
                    verbModus(EDITORPANEL, 'territorien', editorPanelRechte) === 'bearbeiten'
                        ? gebietseditor.mehrfachauswahl
                        : undefined
                "
                @untergebiet="gebietAnlegen.untergebiet"
                @grenze="gebietAnlegen.grenze"
                @name-markiert="gebietAnlegen.markiert()"
                @update:auswahl="(id: string | undefined, reiter: GebietReiter) => waehleGebiet(id, fenster.id, reiter)"
                @fliege="fliegeZuGebiet"
                @hierarchie="(id: string) => gebietseditor.hierarchieGebraucht(id)"
                @band="zeigeGebietsband"
                @mitziehen="(an: boolean) => zoombaender.ziehtMit(an)"
                @liste-zu="(zu: boolean) => listenSchalter.schalte(fenster.id, zu)"
                @medien="(id, name) => oeffneMedienWerkzeug({ von: { kind: 'territory', id, name }, rolle: 'coat' })"
                @wappen="(id: string) => gebietseditor.wappenGeaendert(id)"
                @oeffne-quelle="oeffneInhalteQuelle"
                @lage="(lage, box) => werkzeugfenster.setzeLage(fenster.id, lage, box)"
                @box="(box) => werkzeugfenster.setzeBox(fenster.id, box)"
                @vorn="werkzeugfenster.nachVorn(fenster.id)"
                @schliesse="werkzeugfenster.schliesse(fenster.id)"
                @erneut="gebietseditor.ladeListe()"
            />
            <!-- Der Kraftlinien-Editor (WI-0205 K2, K6, K8 auf O3), je Linie ein Fenster; die Liste stellt die Ansicht „Kraftlinien“ (F17). -->
            <KraftlinieneditorFenster
                v-for="fenster in kraftlinieneditor.fenster.value"
                :key="fenster.id"
                :fenster="fenster"
                :liste-zu="listenSchalter.zu(fenster.id)"
                :liste="kraftlinieneditor.liste.value"
                :lade-fehler="kraftlinieneditor.ladeFehler.value"
                :einstellung="kraftlinieneditor.listenEinstellung"
                :bearbeitung="kraftlinieneditor.bearbeitungVon(fenster.gegenstand)"
                :verlauf="kraftlinieneditor.verlaufVon(fenster.gegenstand)"
                :kurve-laeuft="
                    kraftlinieKurve.laufend.value !== undefined &&
                    kraftlinieKurve.laufend.value.id === fenster.gegenstand
                "
                :kandidaten="
                    kraftlinieKurve.laufend.value?.id === fenster.gegenstand
                        ? kraftlinieKurve.ziele.value.map((z) => ({ id: z.objekt, name: z.name }))
                        : undefined
                "
                :anfuegen-wunsch="kraftlinieAnfuegen.anker === fenster.gegenstand ? kraftlinieAnfuegen.mal : undefined"
                :ablage-ziel="ortseditor.ablageZiel"
                :darf-felder="
                    editorPanelRechte.includes('edit_map_objects') &&
                    ortseditor.bearbeiten.value?.mapEditing === 'testwelt'
                "
                :darf-form="
                    editorPanelRechte.includes('edit_map_geometry') &&
                    ortseditor.bearbeiten.value?.mapEditing === 'testwelt'
                "
                :entfernen-frage="kraftlinieneditor.entfernenFrage.value"
                :entfernt-gerade="kraftlinieEntferntGerade"
                :mehrfach="kraftlinieneditor.mehrfachVon(fenster.id)"
                :sammel="kraftlinieneditor.sammelVon(fenster.id)"
                @mehrfach="(an: boolean) => kraftlinieneditor.setzeMehrfach(fenster.id, an)"
                @angehakt="(ids: readonly string[]) => kraftlinieneditor.setzeAngehakt(fenster.id, ids)"
                @entfernen="
                    (wahl: 'abnehmen' | 'loeschen') => void wechsleKraftlinie(() => kraftlinieneditor.entferne(wahl))
                "
                @zurueck="
                    fenster.gegenstand !== undefined &&
                    void wechsleKraftlinie(() => kraftlinieneditor.zurueck(fenster.gegenstand!))
                "
                @herausnehmen="
                    (knoten: string) =>
                        fenster.gegenstand !== undefined && void nimmAusKraftlinie(fenster.gegenstand, knoten)
                "
                @anfuegen="
                    (von: string, nach: string | undefined) =>
                        fenster.gegenstand !== undefined && void fuegeAnKraftlinie(fenster.gegenstand, von, nach)
                "
                @abbrechen-entfernen="kraftlinieneditor.abbrechenEntfernen()"
                @update:auswahl="(id: string | undefined) => waehleKraftlinie(id, fenster.id)"
                @kurve="fenster.gegenstand !== undefined && void kurveAn(fenster.gegenstand)"
                @fliege="fliegeZuKraftlinie"
                @zeige="zeigeKraftlinienPunkt"
                @liste-zu="(zu: boolean) => listenSchalter.schalte(fenster.id, zu)"
                @lage="(lage, box) => werkzeugfenster.setzeLage(fenster.id, lage, box)"
                @box="(box) => werkzeugfenster.setzeBox(fenster.id, box)"
                @vorn="werkzeugfenster.nachVorn(fenster.id)"
                @schliesse="werkzeugfenster.schliesse(fenster.id)"
                @erneut="kraftlinieneditor.ladeListe()"
            />
            <!-- Das Wege-Fenster (WI-0177 W5a), lesend; ein Klick in der Liste stellt die Ansicht „Standard“ (F17). -->
            <WegeditorFenster
                v-for="fenster in wegeFenster.fenster.value"
                :key="fenster.id"
                :fenster="fenster"
                :liste-zu="listenSchalter.zu(fenster.id)"
                :liste="wegeFenster.liste.value"
                :lade-fehler="wegeFenster.ladeFehler.value"
                :einstellung="wegeFenster.listenEinstellung"
                :bearbeitung="wegeFenster.bearbeitungVon(fenster.gegenstand)"
                :verlauf="wegeFenster.verlaufVon(fenster.gegenstand)"
                :darf="verbModus(EDITORPANEL, 'wege', editorPanelRechte) === 'bearbeiten'"
                :quellen-recht="editorPanelRechte.includes('manage_sources')"
                :zurueck="viewer.can('edit_map_geometry') ? wegZurueck : undefined"
                :ablage-ziel="ortseditor.ablageZiel"
                :abschnitts-wahl="wegeFenster.abschnittsWahl(fenster.gegenstand)"
                :mehrfach="wegeFenster.mehrfachVon(fenster.id)"
                :sammel="wegeFenster.sammelVon(fenster.id)"
                :auswahl-abschnitte="wegeFenster.auswahlVon(fenster.id)"
                :neuer-weg-offen="wegeFenster.neuerWegFrage.value === fenster.id"
                :schreibe-neuen-weg="
                    verbModus(EDITORPANEL, 'wege', editorPanelRechte) === 'bearbeiten'
                        ? wegeFenster.neuerWeg
                        : undefined
                "
                @mehrfach="(an: boolean) => wegeFenster.setzeMehrfach(fenster.id, an)"
                @angehakt="(ids: readonly string[]) => wegeFenster.setzeAngehakt(fenster.id, ids)"
                @neuer-weg="wegeFenster.frageNeuerWeg(fenster.id)"
                @neuer-weg-abbrechen="wegeFenster.abbrechenNeuerWeg()"
                @entfernen="void wegEntfernen.bitteAuswahl(() => wegeFenster.entfernenAuswahl())"
                @entfernen-weg="
                    (ziel: EntfernenZiel) =>
                        void (ziel.art === 'abschnitt'
                            ? wegEntfernen.bitte(ziel.publicId)
                            : ziel.art === 'strasse' && wegEntfernen.bitteStrasse(ziel.abschnitte))
                "
                @nummer="
                    (abschnitt: string) =>
                        fenster.gegenstand && wegeFenster.schalteAbschnitt(fenster.gegenstand, abschnitt)
                "
                @ganzer-weg="() => fenster.gegenstand && wegeFenster.ganzerWeg(fenster.gegenstand)"
                @update:auswahl="(id: string | undefined) => waehleWeg(id, fenster.id)"
                @strasse="(anker: string, abschnitt: string) => oeffneGeteiltenAbschnitt(anker, abschnitt, fenster.id)"
                @fliege="fliegeZuWeg"
                @abschnitte-zeigen="
                    (bild: AbschnitteBild | undefined) => {
                        assistentBild = bild;
                        abschnitteLeuchten.zeige(bild ?? fensterAbschnitte);
                    }
                "
                @oeffne-quelle="oeffneInhalteQuelle"
                @liste-zu="(zu: boolean) => listenSchalter.schalte(fenster.id, zu)"
                @lage="(lage, box) => werkzeugfenster.setzeLage(fenster.id, lage, box)"
                @box="(box) => werkzeugfenster.setzeBox(fenster.id, box)"
                @vorn="werkzeugfenster.nachVorn(fenster.id)"
                @schliesse="werkzeugfenster.schliesse(fenster.id)"
                @erneut="wegeFenster.ladeListe()"
            />
            <OrtseditorFenster
                v-for="fenster in ortseditorFenster"
                :key="fenster.id"
                :fenster="fenster"
                :mehrfach-ziel="(ziel: MehrfachZiel) => mehrfachMarkierung.ziel('place', ziel)"
                @mehrfach-markierung="
                    (ids: readonly string[]) => mehrfachMarkierung.setze(`orte-${fenster.id}`, 'place', ids)
                "
                :stand="werkzeugfenster.stand.value"
                :liste="ortseditor.liste.value"
                :einstellung="ortseditor.listenEinstellung"
                :lade-fehler="ortseditor.ladeFehler.value"
                :bearbeiten="ortseditor.bearbeiten.value"
                :auswahl="ortseditor.auswahl.value"
                :daten="ortseditorDaten"
                :sperre="ortSperre"
                :rechte="editorPanelRechte"
                :ablage-ziel="ortseditor.ablageZiel"
                :medien-erlaubt="medienErlaubt"
                :hinweis="ortseditor.hinweis.value?.fenster === fenster.id ? ortseditor.hinweis.value.text : undefined"
                :verschiebung="
                    ortVerschieben.laufend.value?.fenster === fenster.id ? ortVerschieben.laufend.value : undefined
                "
                :verschiebe-meldung="ortVerschieben.meldung.value"
                :setzen="ortSetzen.laufend.value"
                :setz-meldung="ortSetzen.meldung.value"
                :neu="ortseditor.neu.value"
                :liste-zu="listenSchalter.zu(fenster.id)"
                kann-zeigen
                @liste-zu="(zu: boolean) => listenSchalter.schalte(fenster.id, zu)"
                @zeige="
                    (punkt: { x: number; y: number }) =>
                        void ortseditorHinflug.zeige(punkt, ziellageVonFenster(fenster.id), { immer: true })
                "
                @neu="ortseditor.neuerOrt(fenster.id)"
                @neu-fertig="ortseditor.neuFertig(fenster.id)"
                @angelegt="
                    (id: string, name: string, mitLage: boolean, revision: number | undefined) => {
                        ortseditor.neuFertig(fenster.id);
                        ortseditor.ladeListe();
                        if (revision !== undefined) editRevision.advance(map, revision);
                        ortseditor.oeffneOrt(fenster.id, id);
                        showToast(
                            t(mitLage ? 'ortseditor.neu.angelegt' : 'ortseditor.neu.angelegtOhneLage', { name }),
                            'success',
                        );
                    }
                "
                @verschiebe="(id: string) => void ortVerschieben.starte(fenster.id, id)"
                @setze="
                    (key: string) => {
                        const zeile = ortSetzenZeile(key);
                        if (zeile) ortSetzen.starte(fenster.id, zeile);
                    }
                "
                @update:auswahl="ortseditor.setzeAuswahl"
                @medien="oeffneMedienWerkzeug"
                @oeffne-quelle="oeffneInhalteQuelle"
                @oeffne="(key: string) => ortseditor.oeffneOrt(fenster.id, key)"
                @fliege="(key: string) => ortseditor.fliegeOrt(fenster.id, key)"
                @ungespeichert="(ja: boolean) => werkzeugfenster.markiere(fenster.id, { ungespeichert: ja })"
                @gespeichert="
                    (revision: number | undefined) => {
                        ortseditor.ladeListe();
                        if (revision !== undefined) editRevision.advance(map, revision);
                    }
                "
                @lage="(lage, box) => werkzeugfenster.setzeLage(fenster.id, lage, box)"
                @box="(box) => werkzeugfenster.setzeBox(fenster.id, box)"
                @vorn="werkzeugfenster.nachVorn(fenster.id)"
                @schliesse="werkzeugfenster.schliesse(fenster.id)"
                @erneut="ortseditor.ladeListe()"
            />
        </template>
        <!--
            Am Telefon deckt der offene Planer die Karte. Wer zuschauen will, klappt ihn zu - dann steht
            die Leiste des Playmodes allein oben über der Karte (WI-0031, Betreiber 2026-09-24).
        -->
        <RoutePlayer
            v-if="phoneViewport && !plannerOpen && planner.route.value?.found"
            floating
            :playmode="playmode"
            :selected-stage="planner.selectedStage.value"
        />
        <!-- Das Fenster „Hinweise“: die Hülle verlegt sich selbst nach `body` - wo es hier steht, ist gleich. -->
        <HinweiseFenster
            v-if="notesEingehaengt"
            v-model:offen="notesOpen"
            :abschnitt="notesSection"
            @news="newsOpen = true"
        />
        <NeuigkeitenFenster v-model:offen="newsOpen" />
        <AuthFensterHost />
        <!-- Die Katalogfenster (WI-0118): wie „Hinweise“ verlegen sie sich selbst nach `body`. -->
        <CitymapsFenster v-if="citymapsEingehaengt" v-model:offen="citymapsOpen" :ziel="catalogTarget" />
        <LiteratureFenster v-if="literatureEingehaengt" v-model:offen="literatureOpen" :ziel="catalogTarget" />
        <MedienFenster
            v-if="medienErlaubt"
            v-model:offen="medienOffen"
            :lage="medienWerkzeug?.lage ?? 'modal'"
            :box="medienWerkzeug?.box"
            :ablage-ziel="ortseditor.ablageZiel"
            @auf-karte="medienAufKarte"
            @oeffne-quelle="oeffneInhalteQuelle"
            @update:lage="(lage, box) => medienWerkzeug && werkzeugfenster.setzeLage(medienWerkzeug.id, lage, box)"
            @update:box="(box) => medienWerkzeug && werkzeugfenster.setzeBox(medienWerkzeug.id, box)"
            @vorn="medienWerkzeug && werkzeugfenster.nachVorn(medienWerkzeug.id)"
        />
        <!-- Die Medienverwaltung ist zu, solange die Redaktion die Stelle einer Reisebild-Einreichung auf der Karte wählt (WI-0272 S3): der Hinweis dazu. -->
        <MedienStelleHinweis v-if="medienErlaubt" />
        <!-- Das Fenster „Inhalte bearbeiten“ (WI-0254): Quellen, Literatur, Vorkommen, Korpora; Werkzeugfenster wie die Medienverwaltung. -->
        <InhalteFenster
            v-if="inhalteWerkzeug"
            v-model:offen="inhalteOffen"
            :lage="inhalteWerkzeug.lage"
            :box="inhalteWerkzeug.box"
            :ablage-ziel="ortseditor.ablageZiel"
            :darf-schreiben="inhalteSchreibt"
            @update:lage="(lage, box) => inhalteWerkzeug && werkzeugfenster.setzeLage(inhalteWerkzeug.id, lage, box)"
            @update:box="(box) => inhalteWerkzeug && werkzeugfenster.setzeBox(inhalteWerkzeug.id, box)"
            @vorn="inhalteWerkzeug && werkzeugfenster.nachVorn(inhalteWerkzeug.id)"
            @ungespeichert="
                (ja: boolean) => inhalteWerkzeug && werkzeugfenster.markiere(inhalteWerkzeug.id, { ungespeichert: ja })
            "
        />
        <!-- Meldeformular und Statusseite der Besucher (WI-0268 C2): ein Werkzeugfenster im rechten Slot, angedockt oder gelöst, ohne Ablage. -->
        <CommunityBesucher v-if="communityBesucherEingehaengt" :neben-panel="subjects.slotOpen.value" />
        <!-- Eigenes Bild hinzufügen und die Statusseite der Reisebilder (WI-0272 S2b): ebenfalls ein Besucherfenster, mit der Linie zur Stelle. -->
        <ReisebildBesucher
            v-if="reisebildBesucherEingehaengt"
            :neben-panel="subjects.slotOpen.value"
            @hinweise="openNotes"
        />
        <!-- Karte vorschlagen (WI-0275 Stufe C): modal, über der Kartensammlung, aus der es geöffnet wurde. -->
        <KartenvorschlagFenster
            v-if="kartenvorschlagEingehaengt && kartenvorschlagAnzeige !== undefined"
            :key="kartenvorschlagAnzeige.art"
            :anzeige="kartenvorschlagAnzeige"
        />
        <!-- Die Vorgänge der Redaktion (WI-0268 C3): Werkzeugfenster links neben dem Panel, angedockt, gelöst oder abgelegt. -->
        <CommunityRedaktion
            v-if="editorNav"
            :rechte="editorPanelRechte"
            :panel-offen="subjects.slotOpen.value && subjects.editorVisible.value"
        />
        <!-- Die Messwerte (WI-0138 V15): Werkzeugfenster im rechten Slot, gelöst, angedockt oder abgelegt. -->
        <MessFenster
            v-if="messwerteWerkzeug"
            v-model:offen="messwerteOffen"
            :lage="messwerteWerkzeug.lage"
            :box="messwerteWerkzeug.box"
            @update:lage="
                (lage, box) => messwerteWerkzeug && werkzeugfenster.setzeLage(messwerteWerkzeug.id, lage, box)
            "
            @update:box="(box) => messwerteWerkzeug && werkzeugfenster.setzeBox(messwerteWerkzeug.id, box)"
            @vorn="messwerteWerkzeug && werkzeugfenster.nachVorn(messwerteWerkzeug.id)"
        />
        <!-- Das Kontextmenü der Karte (Rechtsklick, am Finger langer Druck). -->
        <MapContextMenu
            :at="contextMenuAt"
            :measuring="measurement !== undefined"
            :at-place="contextAtPlace"
            :editor="kontextEditor"
            :nur-editor="kontextNurEditor"
            :standard-ansicht="mapView === 'standard'"
            @choose="onContextAction"
            @edit="kontextGriff"
            @aufheben="(ziel: SperrKastenInhalt['ziel']) => void hebeSperreAuf(ziel)"
            @bitten="bitteUmFreigabe"
            @vorschau="
                (eintrag: string | undefined, unter: string | undefined) => {
                    zeigeAbschnitte(
                        contextWeg?.ref.kind === 'path' && 'anchor' in contextWeg.ref
                            ? contextWeg.ref.anchor
                            : undefined,
                        unter?.split('#')[0]?.split('|').at(-1),
                        eintrag?.split('#')[1],
                    );
                    zeigeTeile(eintrag, unter);
                }
            "
            @close="
                () => {
                    contextMenuAt = null;
                    abschnitteLeuchten.zeige(fensterAbschnitte);
                    flaechenLeuchten.zeige(undefined);
                    gebietTeileLeuchten.zeige(undefined);
                }
            "
        />
        <!-- „Screenshot machen“ aus dem Kartenmenü (WI-0274): Auswahl mittig, dann die Aufnahme über allem. -->
        <KartenScreenshot
            v-if="screenshotEingehaengt"
            ref="kartenScreenshot"
            :karte="() => map"
            :serie="() => seriesId"
            :anzeige="screenshotRaster"
        />
        <!-- Die Leiste von „Zoombänder bearbeiten“ (WI-0209 D2), dieselbe gemeinsame Leiste. -->
        <!-- Die Ebenenleiste oben für Editoren am Rechner (WI-0178 T41 (2)); sie weicht der Leiste eines Modus. -->
        <EbenenLeiste
            v-if="ebenenleisteZeigen"
            :auswahl="landscapeSelection"
            :gesperrt="ebenenZaehler.gesperrt"
            :verborgen="ebenenZaehler.verborgen"
            :stapel-an="landschaftseditor.listenEinstellung.sortierung.value === 'reihenfolge'"
            :rand="modusRand"
            @waehle="(auswahl: LandscapeSelection) => (landscapeSelection = auswahl)"
            @stapel="ebenenStapel"
            @verborgene="ebenenVerborgene"
            @hoehe="(px: number) => (ebenenHoehe = px)"
        />
        <ZoombaenderLeiste
            :baender="zoombaender"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- Die Leiste der Felder einer Straße (WI-0177 W5b, O3): „Fertig“ schreibt `path.update`. -->
        <EntwurfLeiste
            v-if="wegeFelderLeiste && wegeFenster.aktiv.value"
            :bearbeitung="wegeFenster.aktiv.value"
            zeichen="bearbeiten"
            :titel="t('entwurf.felder')"
            :objekt="wegeFenster.aktiv.value.detail.value ? wegName(wegeFenster.aktiv.value.detail.value) : ''"
            :gesten="t('entwurf.gestenFelder')"
            :rand="modusRand"
            testid="wege-leiste"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- Die Leiste der Bearbeitung einer Landschaft (WI-0178 B2, O3): Felder und Form, „Fertig“ schreibt `landscape.update`. -->
        <EntwurfLeiste
            v-if="landschaftLeiste"
            :bearbeitung="landschaftLeiste.bearbeitung"
            :zeichen="landschaftLeiste.zeichen"
            :titel="landschaftLeiste.titel"
            :objekt="landschaftLeiste.objekt"
            :gesten="landschaftLeiste.gesten"
            :rand="modusRand"
            :isoliert="landschaftLeiste.isoliert"
            :testid="landschaftLeiste.testid"
            @isolieren="isolieren.umschalten()"
            @verworfen="isolieren.aus()"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- „Fläche vereinfachen“ (WI-0233): die Leiste der Bearbeitung der Landschaft mit dem Regler „Stärke“. -->
        <FlaecheVereinfachenLeiste
            :vereinfachen="flaecheVereinfachen"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- „Verschieben“ (WI-0178 Werkzeug 7): die Leiste der Bearbeitung der Landschaft, solange eine Teilfläche wandert. -->
        <FlaecheVerschiebenLeiste
            :verschieben="flaecheVerschieben"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- „Fläche malen“ und „Fläche radieren“ (WI-0178 Werkzeug 6): die Leiste der Bearbeitung mit der Größe des Pinsels. -->
        <FlaecheMalenLeiste
            :malen="flaecheMalen"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- „Kämme zeichnen“ (WI-0245 D2): die Leiste der Bearbeitung mit den Werkzeugen des Gebirgsnetzes. -->
        <KammNetzLeiste :netz="kammNetz" :rand="modusRand" @hoehe="(px: number) => (modusHoeheGemessen = px)" />
        <!-- Die Leiste der Bearbeitung eines Gebiets (WI-0209 B2, O3): Felder und Grenzen, „Fertig“ schreibt `territory.update`. -->
        <EntwurfLeiste
            v-if="gebietLeiste"
            :bearbeitung="gebietLeiste.bearbeitung"
            :zeichen="gebietLeiste.zeichen"
            :titel="gebietLeiste.titel"
            :objekt="gebietLeiste.objekt"
            :gesten="gebietLeiste.gesten"
            :rand="modusRand"
            :testid="gebietLeiste.testid"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- Die Leiste einer Kraftlinie (WI-0205 K6, K8 auf O3): „Fertig“ schreibt `powerline.update_line`. -->
        <EntwurfLeiste
            v-if="kraftlinieLeiste"
            :bearbeitung="kraftlinieLeiste.bearbeitung"
            :zeichen="kraftlinieLeiste.form ? 'kurve-bearbeiten' : 'bearbeiten'"
            :titel="kraftlinieLeiste.form ? t('kraftlinieneditor.bearbeiten.form') : t('entwurf.felder')"
            :objekt="kraftlinieLeiste.objekt"
            :gesten="
                !kraftlinieLeiste.form
                    ? t('entwurf.gestenFelder')
                    : phoneViewport
                      ? t('kraftlinieneditor.bearbeiten.gestenFinger')
                      : t('kraftlinieneditor.bearbeiten.gesten')
            "
            :rand="modusRand"
            testid="kraftlinie-leiste"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- Der Spracheditor (WI-0261 S5d2): seine Fenster und Leisten (Felder, „Fläche bearbeiten“). -->
        <SpracheditorSeite
            :editor="spracheditor"
            :ablage-ziel="ortseditor.ablageZiel"
            :darf="spracheDarf()"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- Der Wetter-Editor (WI-0288 Stufe 3): sein Fenster. -->
        <WettereditorSeite
            v-if="editorNav"
            :editor="wettereditor"
            :werkzeugfenster="werkzeugfenster"
            :listen-schalter="listenSchalter"
            :ablage-ziel="ortseditor.ablageZiel"
        />
        <!-- Die Leiste von „Wegkurve bearbeiten“ (WI-0177, W5b Schritt 3): die Leiste der Bearbeitung der Straße. -->
        <WegkurveLeiste :wegkurve="wegkurve" :rand="modusRand" @hoehe="(px: number) => (modusHoeheGemessen = px)" />
        <!-- „Ort verschieben“ (WI-0128 E12, EDIT-0003 G4): ein Entwurf wie die anderen Formmodi, „Fertig“ schreibt `place.move`. -->
        <OrtVerschiebenLeiste
            :verschieben="ortVerschieben"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- „Neuer Weg“ (WI-0177): dieselbe gemeinsame Leiste, dazu das Schild am Ziel. -->
        <NeuerWegLeiste :neuer-weg="neuerWeg" :rand="modusRand" @hoehe="(px: number) => (modusHoeheGemessen = px)" />
        <AnlegenSchild :schild="neuerWeg.schild.value" />
        <NeueKraftlinieLeiste
            :neue-kraftlinie="neueKraftlinie"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <AnlegenSchild :schild="neueKraftlinie.schild.value" />
        <!-- „▲ Landmarke setzen“ (WI-0271 L4): dieselbe gemeinsame Leiste, „Fertig“ legt sie an. -->
        <LandmarkeSetzenLeiste
            :setzen="landmarkeSetzen"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <!-- „Neue Fläche“ (C3): dieselbe gemeinsame Leiste; im Platz #zusatz steht das Bauteil der Andockung. -->
        <NeueFlaecheLeiste
            :neue-flaeche="neueFlaeche"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <MitAndererLeiste
            :mit-anderer="mitAnderer"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <UnterflaechenLeiste
            :unterflaechen="unterflaechen"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <ZerschneidenLeiste
            :zerschneiden="zerschneiden"
            :rand="modusRand"
            @hoehe="(px: number) => (modusHoeheGemessen = px)"
        />
        <AnlegenSchild :schild="neueFlaeche.schild.value" />
        <!-- Nur für Editoren: Das Fenster nennt schon geschlossen seinen Titel, und die Wörter des Wegeditors liegen im späten Teil der Tafel. -->
        <WegEntfernenFenster
            v-if="editorNav"
            :entfernen="wegEntfernen"
            @entfernt="
                (
                    _id: string,
                    name: string,
                    wahl: WegEntfernenWahl,
                    revision: number | undefined,
                    wege: number | undefined,
                ) => wegEntfernt(name, wahl, revision, wege)
            "
        />
        <!-- Das Editor-Menü am angeklickten Objekt (WI-0063 P9): nur für Editoren; ein Besucher bekommt die Komponente gar nicht. -->
        <EditorFloatingMenu v-if="viewer.can('use_editor_menu')" :menu="editorMenu" />
        <!-- Klick auf Flächen (WI-0043 Stufe 2): das Schild beim Zeigen und die Liste, wo mehrere liegen. -->
        <AreaHoverChip :hint="pointerHint" />
        <AreaChoiceMenu
            :choices="areaChoiceMenu"
            @choose="chooseArea"
            @preview="previewArea"
            @close="closeAreaChoices"
        />
        <!-- „Welche Fläche bearbeiten?“ nach einem Doppelklick, wo mehrere liegen (WI-0177, EDIT-0003 §2a): dieselbe Liste. -->
        <AreaChoiceMenu
            :choices="doppelklickMenu"
            @choose="doppelklickFlaeche"
            @preview="doppelklickVorschau"
            @close="schliesseDoppelklickWahl"
        />
        <!-- Die Kraftlinien an einer Stelle (WI-0063 P8): dieselbe Liste, Mehrere heißt Auswahl. -->
        <AreaChoiceMenu
            :choices="powerlineChoiceMenu"
            @choose="choosePowerline"
            @close="powerlineChoices = undefined"
        />
        <!-- Die Sprachen an einer Stelle (WI-0261 S5b): dieselbe Liste, ein Mischgebiet heißt Auswahl. -->
        <AreaChoiceMenu
            :choices="sprachWahl.menu.value"
            @choose="sprachWahl.choose"
            @preview="sprachWahl.preview"
            @close="sprachWahl.close"
        />
        <!-- Die Treffer eines mehrdeutigen Objektlinks: dieselbe Liste, Mehrdeutig heißt Auswahl, nie still gewählt. -->
        <AreaChoiceMenu :choices="linkChoiceMenu" @choose="chooseLink" @close="objectLink.dismiss()" />
        <ToastHost />
        <FreigabeHinweise
            :eintraege="freigabeAnfragen.eintraege.value"
            :platz="freigabeHinweisPlatz"
            @freigeben="(id: string) => void freigabeAnfragen.freigeben(id)"
            @spaeter="(id: string) => void freigabeAnfragen.spaeter(id)"
        />
        <KarteGestoert />
        <LoadingBar />
    </div>
    <!-- Die Kopfleiste (WI-0120 A9, Betreiber 2026-10-09: L1), sobald die Anmeldung eingerichtet ist. Sie steht im Dokument
         HINTER der Anwendung und nur im Bild oben (`order`, `#app` ist eine Spalte): Die Karte bleibt das erste Ziel der
         Tabulatortaste (AC14). Ohne eingerichtete Anmeldung bleibt die Seite wie zuvor. -->
    <AppKopfleiste v-if="withHeader" />
</template>

<style>
/*
 * 🔴 KEIN FARB-, GROESSEN- ODER ABSTANDSLITERAL IN DIESER DATEI. Alles kommt aus dem Designkanon
 * (`config/design-canon/avesmaps.json` -> `src/styles/canon.css`, WI-0014). Vorher standen hier
 * sieben eigene Farben, `system-ui` als Schrift und rem-Abstaende ohne Skala — der Anfang genau
 * der Spaltung, die Legacy einmal gekostet hat, Infobox und Routenplaner wieder zusammenzubringen.
 *
 * 🪤 Und kein `font-weight: 600`. Faculty Glyphic bringt nur den Regular mit; ein Browser, der ein
 * Fett daraus rechnet, liefert matschige Kanten. Betonung traegt die FARBE
 * (`--color-text-strong`), nicht das Gewicht — Legacys Regel, und der Grund steht in canon.css.
 */
/*
 * 🔴 Die Seite zoomt und scrollt nie, am Telefon so wenig wie am Rechner (Betreiber 2026-09-24:
 * „einfach Vollbild sein/bleiben, egal was ich anklicke“). Gezoomt wird nur die KARTE.
 * - `touch-action: manipulation`: kein Doppeltipp-Zoom auf Knöpfen. Es wirkt auf alle Kinder, die
 *   Karte bringt ihr eigenes `none` mit und behält Pinch, Drehen und Neigen.
 * - Den Pinch-Zoom der Seite fängt `main.ts` ab (iOS kennt dafür eigene Gestenereignisse).
 * - Felder am Finger mit mindestens 16 px, sonst fährt iOS beim Fokus hinein (je Feld).
 */
html,
body {
    height: 100%;
    overflow: hidden;
    overscroll-behavior: none;
}

/*
 * Die Scrollbalken folgen dem Haus, überall: dünn, warm getönt, ohne Schiene (Legacy `base.css`,
 * Betreiber 2026-09-24: „die Scrollbalken haben noch keine Farben wie Legacy“). `scrollbar-color`
 * erbt und reicht darum einmal an der Wurzel; die WebKit-Pseudoelemente erben nicht, deshalb `*`.
 */
:root {
    scrollbar-width: thin;
    scrollbar-color: var(--color-scrollbar-thumb) var(--color-scrollbar-track);
}

*::-webkit-scrollbar {
    width: 7px;
    height: 7px;
}

*::-webkit-scrollbar-track {
    background: var(--color-scrollbar-track);
}

*::-webkit-scrollbar-thumb {
    border-radius: var(--radius-sm);
    background: var(--color-scrollbar-thumb);
}

*::-webkit-scrollbar-thumb:hover {
    background: var(--color-scrollbar-thumb-hover);
}

/*
 * 🔴 EINZEILIG KÜRZEN NUR ÜBER DIESE KLASSE (Betreiber 2026-09-25: „kanns man das überall machen,
 * nicht dass es woanders wieder passiert“). `overflow: hidden` braucht der Auslassungspunkt, es
 * schneidet aber auch die Unterlängen der Hausschrift ab - g, p und j reichen unter eine knappe
 * Zeile. Die Beschneidefläche reicht deshalb `--descender-room` tiefer, der negative Rand nimmt
 * das im Fluss zurück: die Außenhöhe bleibt, nichts verschiebt sich. Ein eigenes Rezept in einem
 * Bauteil fängt `design-canon.test.ts` ab.
 */
.einzeilig {
    overflow: hidden;
    padding-bottom: var(--descender-room);
    margin-bottom: calc(-1 * var(--descender-room));
    text-overflow: ellipsis;
    white-space: nowrap;
}

/*
 * 🔴 EIN AUFGEKLAPPTER KOPF IST MIT SEINEM RUMPF EIN STÜCK (Betreiber 2026-10-06: „die unteren border corners von
 * diesen elementen sind noch rund obwohl das ding ausgeklappt ist“, am Gruppenkopf „Landweg“ der Etappenliste).
 * Zugeklappt steht der Kopf für sich und ist rundum gerundet; aufgeklappt schließt der Rumpf unmittelbar an, und die
 * unteren Ecken werden eckig - sonst sieht der Kopf aus wie ein eigenes Kärtchen auf seinem Inhalt.
 *
 * 🔴 **Die Aussage steht hier und nur hier.** Sie galt vorher an einer Stelle (`controls/avm-disclosure.vue`) und
 * fehlte an der anderen (`route-planner/route-stage-group.vue`) - genau so laufen zwei Rezepturen für dieselbe
 * Aussage auseinander. Wer einen klappbaren Kopf baut, setzt diese Klasse, solange er offen ist; `test/design-canon.test.ts`
 * hält fest, dass sie nur hier erklärt wird und dass die klappbaren Köpfe sie benutzen. (Die Fluggruppe `.flight__head` klappt nicht und trägt darum gar keine Rundung.)
 *
 * 🪤 Ohne Übergang, mit Absicht: Die Rundung gehört zum gewählten Zustand, und Guide §29.1 animiert gewählte Zustände
 * nicht. Sie wechselt im selben Bild, in dem der Rumpf zu fahren beginnt - gemessen fällt das nicht auf.
 *
 * 🪤 Der Klassenname steht ZWEIMAL im Selektor, und das ist kein Versehen: Ein Bauteil setzt seinen Radius in einem
 * scoped Stil, und Vue hängt dort ein Attribut an - die Bauteilregel wiegt damit schwerer als eine einfache Klasse.
 * Die Verdopplung hebt die Hausregel auf dieselbe Stufe, ohne `!important` und ohne dass ein Bauteil sie nachbaut.
 */
.avm-kopf-offen.avm-kopf-offen {
    border-end-start-radius: 0;
    border-end-end-radius: 0;
}

html {
    touch-action: manipulation;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
}

body {
    margin: 0;
    color: var(--color-text);
}

/*
 * 💣 Die Karte ist die ganze Seite und scrollt nie. `clip` statt `hidden`: auch kein Fokus und kein
 * Skript kann den Inhalt verschieben. Befund 2026-09-23: das gekippte 3D-Zeichen ragte 3 px über
 * den Bildrand, und die Seite bekam Scrollbalken.
 */
/*
 * 💣 `100%` durch die ganze Kette, nicht `100vh`: Auf iOS ist `100vh` höher als der sichtbare
 * Bereich, die Seite bekam dadurch einen Streifen zum Scrollen, und die Adressleiste sprang. Legacy
 * geht denselben Weg (`html, body { height: 100% }`).
 * 🪤 Nicht `position: fixed` am Container: Damit maß der Browsertest der Beschriftung bei Band 4
 * einen schmaleren Ortsnamen - die Karte rechnete anders, ohne dass man es sah.
 */
#app {
    display: flex;
    flex-direction: column;
    height: 100%;
}

/* Füllt, was die Kopfleiste übrig lässt (ohne Leiste die ganze Seite); `min-height: 0`, sonst drückt die Karte. */
.app {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: clip;
}

.map {
    position: absolute;
    inset: 0;
    /* Bauteilmaß: so breit wie der Fokusring der Bedienelemente (`--focus-ring`). */
    --map-focus-w: 3px;
}

/*
 * Der Tastaturfokus auf der Karte ist gold wie an jedem Bedienelement (WI-0016, AC14). Die Leinwand
 * füllt das Fenster, deshalb liegt der Ring innen; ein Schatten läge UNTER dem Kartenbild.
 */
.map .maplibregl-canvas:focus-visible {
    outline: var(--map-focus-w) solid var(--color-accent);
    outline-offset: calc(-1 * var(--map-focus-w));
}

/* Der Kartenfächer sitzt in der Kartenecke, wie in Legacy - nicht im Seitenpanel. Er gehört zur
   Karte, nicht zu den Angaben über sie. */
/*
 * Der Schriftgrößen-Regler (?labeltune=1).
 *
 * 🪤 Er lebt im `body`, nicht in dieser Komponente — `installLabelTuner` hängt ihn dort an, weil
 * er MapLibres Karte verstellt und nicht Vue-Zustand. Deshalb steht sein Stil hier ohne `scoped`
 * wirksam: Vue würde ein Attribut vergeben, das dieses Element nie bekommt.
 */
.label-tuner {
    /* 🪤 OBEN rechts, unter der Zoomsteuerung - nicht unten. Unten sitzt der Kartenfächer, und
       zwei Tafeln in derselben Ecke verdecken einander je nach Fensterhöhe. */
    position: fixed;
    top: 5.5rem;
    right: var(--space-10);
    z-index: var(--z-map-menu);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-10) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    font-size: var(--font-size-small);
}

.label-tuner__kopf {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.label-tuner__hinweis {
    max-width: 17rem;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
}

.label-tuner__zeile {
    display: grid;
    grid-template-columns: 6.5rem 9rem 2.5rem;
    align-items: center;
    gap: var(--space-6);
}

.label-tuner__zeile output {
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.label-tuner__reset {
    margin-top: var(--space-2);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
}

.label-tuner__reset:hover {
    background: var(--color-button-soft-hover);
}

.label-tuner__reset:active {
    background: var(--color-button-soft-active);
}

/* 🔴 Das Positionieren gehört dem Bund, das Aussehen den Knöpfen (Guide §9). */
.corner {
    position: absolute;
    right: var(--space-10);
    /* Legacy: der Kartenrand (`--avesmaps-edge-gap`, 12 px). Die 2.5rem hielten der Lizenzleiste Platz frei (WI-0033). Über der Leiste der Reisebilder, wenn sie offen ist (WI-0272 S4). */
    bottom: calc(var(--space-10) + var(--avm-reisebilder-leiste, 0px));
    z-index: var(--z-map-ui);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-4);
    /* Mit dem offenen Infopanel nach links, gleiche Zeit wie das Panel (Guide §16: 0,22 s ease, Literal). */
    transition:
        right 220ms ease,
        bottom 220ms ease;
    /*
     * 🪤 Der Bund ist so breit wie seine breiteste Reihe (unten „Neuigkeiten | Hinweise“): Sein leerer Kasten neben Auge und Lupe
     * nähme der Karte sonst jeden Klick, auch den Griff an eine Ecke (WI-0178 C1, gemessen 178 × 242 px). Nur die Knöpfe fangen.
     */
    pointer-events: none;
}

.corner > * {
    pointer-events: auto;
}

/*
 * Das offene Infopanel am rechten Rand (WI-0063 P5): Kamera-Ring oben und Eckknöpfe unten fahren mit nach links und werden
 * nie verdeckt (Legacy `right: calc(400px + 12px)`, `transition: right .22s`). Die Ansichtsknöpfe unten sitzen wie in Legacy
 * im Kartenrand neben dem Panel (Betreiber 2026-10-04: kein Abstand für die Lasche). 🔴 Nur der Ring oben rückt um die Breite
 * der Randlasche weiter: Sie steht links NEBEN dem Panel (30 px, `top: 30px`) und läge sonst über dem Ring, den Legacy an
 * dieser Stelle nicht kennt. Am Telefon treten die Knöpfe stattdessen zurück.
 */
.corner--shifted {
    right: calc(var(--avm-slot-breite, var(--avesmaps-infopanel-width)) + var(--space-10));
}

.corner--top.corner--shifted {
    right: calc(var(--avm-slot-breite, var(--avesmaps-infopanel-width)) + var(--avesmaps-tab-w) + var(--space-10));
}

/* Eingeklappt: nur die Lasche steht an der Kante, der Ring rückt um ihre Breite (dieselbe Zeit). */
.corner--top.corner--tabbed {
    right: calc(var(--avesmaps-tab-w) + var(--space-10));
}

/*
 * Am Telefon tritt der Bund zurück, solange der Planer offen ist (Legacy A2, Owner 12.08.2026): neben
 * dem Panel bleibt nur ein Streifen Karte. Kein `display: none` - erst blenden, dann verstecken, und
 * ein unsichtbarer Knopf darf keinen Tipp schlucken.
 */
.corner--covered,
.corner--covered > * {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transition:
        opacity 220ms ease,
        visibility 0s linear 220ms;
}

@media (prefers-reduced-motion: reduce) {
    .corner,
    .corner--covered {
        transition: none;
    }
}

/* Oben rechts, im selben Abstand zum Bildrand wie die Seiten. */
.corner--top {
    top: var(--space-10);
    bottom: auto;
}

/*
 * 💣 DER BUND WIRD ANGEHOBEN, NICHT DAS MENÜ (Legacy): das schwebende Auge-Menü steht im
 * Stapelkontext des Bundes und käme daraus nicht heraus. Nur solange es offen ist, schiebt sich der
 * Bund vor alles, was höher steht (die Planer-Lasche, --z-map-panel).
 */
.corner:has(.display-menu:not([hidden])) {
    z-index: var(--z-map-menu);
}

/*
 * 🔴 Der einmalige Kamera-Hinweis hebt den Bund NICHT mehr an (Editor-Orchestrierung 2026-10-19, Befund der Gebiete an ortseditor.spec
 * T6.1/T6.2): Auf `--z-map-hint` lag er beim ersten Besuch über Planer und angedocktem Fenster, gemessen bei 1280 px quer über dem Kopf
 * des Fensters (Hinweis x 428–706, Kopf y 57–102), und das Fenster ließ sich dort nicht ziehen. Der Hinweis steht jetzt fest ganz in der
 * freien Fläche (`controls/kamera-hinweis-platz.ts`) und wartet, wo er nicht ganz hinpasst.
 */
</style>
