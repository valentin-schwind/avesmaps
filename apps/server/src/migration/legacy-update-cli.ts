import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
    AVENTURIA,
    AVENTURIA_TRAVEL_MODEL,
    LEGACY_ZUG_KATEGORIEN,
    getJobsConfig,
    istLegacyZugKategorie,
    legacyZugKategorie,
    type LegacyZugKategorie,
} from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { jobsProfileName } from "../jobs/profile.ts";
import { sanitizeSummary } from "../jobs/child-protocol.ts";
import { JobRecorder } from "../jobs/recorder.ts";
import { mapLockWarning } from "../jobs/editor-freeze.ts";
import { bezugsBefunde, messeBezuege } from "../abgleiche/bezuege.ts";
import { FreigabeFehler, freigabeAus } from "../abgleiche/freigabe.ts";
import { entfalleneSchritte, ergebnisZeile, phaseZeile, zugAnteil } from "../abgleiche/protokoll.ts";
import { createDatabase, type Database } from "../database.ts";
import { bereicheAusgelassenBeiKategorie } from "../wiki/abgleich/schalter-lesen.ts";
import { blockingNames, checkFindings } from "../blocking-checks.ts";
import { createFinding, formatFindings, type Finding } from "../findings.ts";
import { deriveLandSmooth, landSmoothFindings } from "../areas/smooth.ts";
import { derivePathRuns } from "../derive/path-runs.ts";
import { derivePathVisuals } from "../derive/path-visual.ts";
import { deriveAll } from "../derive/refresh-label-curve.ts";
import { verifyPathRuns } from "../derive/verify-path-runs.ts";
import { verifyPathVisuals } from "../derive/verify-path-visual.ts";
import { verifyRuns } from "../derive/verify-runs.ts";
import { deriveSeaRoutes, landlessSettings } from "../routing/sea-derive.ts";
import { seaRoutesPassed, verifySeaRoutes } from "../routing/sea-verify.ts";
import { deriveTerrain } from "../terrain/derive.ts";
import { loadPublishedDomainSource } from "../terrain/domain/read.ts";
import { DEFAULT_CONE } from "../terrain/peak-cone.ts";
import { derivePathProfiles } from "../terrain/path-profiles.ts";
import { verifyTerrainDem } from "../terrain/verify-dem.ts";
import { deriveTerritories } from "../territories/derive.ts";
import { verifyTerritoryShapes } from "../territories/verify-derived.ts";
import { deriveDisplayHeights } from "../terrain/display-height/derive.ts";
import { verifyDisplayHeights } from "../terrain/display-height/verify.ts";
import { verifyCurrentDomain } from "../terrain/domain/verify-current.ts";

import {
    buildReportStamp,
    buildSetName,
    catalogFetchFailureFinding,
    catalogNotFetchedFinding,
    DEFAULT_SNAPSHOT_DIR,
    displayHeightsChanged,
    landlessPortsFinding,
    landlessPortsSection,
    legacyGetSelfHealsFinding,
    pathRunsChanged,
    powerlineProbeFinding,
    PUBLIC_CITYMAPS_ENDPOINT,
    PUBLIC_ECOSYSTEM_AREAS_ENDPOINT,
    PUBLIC_ECOSYSTEM_DISPLAY_ENDPOINT,
    PUBLIC_ECOSYSTEM_REGIONS_ENDPOINT,
    PUBLIC_GAME_LITERATURE_ENDPOINT,
    PUBLIC_LOCATION_REVIEWS_ENDPOINT,
    PUBLIC_LORE_EXPORT_ENDPOINT,
    PUBLIC_MAP_FEATURES_ENDPOINT,
    PUBLIC_MEDIA_EXPORT_ENDPOINT,
    PUBLIC_POLITICAL_TERRITORIES_ENDPOINT,
    PUBLIC_STAETTEN_ROHQUELLEN_ENDPOINT,
    PUBLIC_WIKI_LINKZIELE_ENDPOINT,
    PUBLIC_WIKI_SIEDLUNGEN_ENDPOINT,
    PUBLIC_WIKI_ZUORDNUNG_ENDPOINT,
    regionsFileStatus,
    requestTerritories,
    revisionMismatchFinding,
    revisionsMatch,
    sha256Hex,
    summarizePhase,
    terrainDeriveChanged,
    terrainDeriveOk,
} from "./legacy-update.ts";
import {
    importLandscapeDisplay,
    landscapeDisplayFromBytes,
    requestLandscapeDisplay,
    summarizeLandscapeDisplay,
    type LandscapeDisplayInput,
} from "./landscape-display.ts";
import {
    importClimate,
    losslessFinding,
    readLegacyBands,
    reconstructDividers,
    verifyReconstruction,
} from "./climate.ts";
import { locationsFromMapFeatures } from "./map-features.ts";
import { importPaths } from "./paths.ts";
import { verifyPaths } from "./verify-paths.ts";
import { importPlaces, MigrationAborted, PLACE_SUBTYPES, type ImportScope } from "./places.ts";
import { PIPELINE_STEPS, type PipelineStep } from "./pipeline-steps.ts";
import { verifyPlaces } from "./verify-places.ts";
import { importPowerlines } from "./powerlines.ts";
import { verifyPowerlines } from "./verify-powerlines.ts";
import { importRegions } from "./region-import.ts";
import { verifyRegions } from "./verify-regions.ts";
import { importTerrain, readTerrainSources } from "./terrain.ts";
import { verifyTerrain } from "./verify-terrain.ts";
import type { LegacyTerritoryPayload } from "./territories.ts";
import { importTerritories } from "./territory-import.ts";
import { verifyLandscapeDisplay } from "./verify-landscape-display.ts";
import { SUBJECT_DETAIL_TABLES, importSubjectDetails } from "./subject-details-import.ts";
import { SOURCE_TABLES, importSources } from "./sources-import.ts";
import { CITYMAP_TABLES, importCitymaps } from "./citymaps-import.ts";
import { LITERATURE_TABLES, importLiterature } from "./literature-import.ts";
import { LORE_TABLES, importLore } from "./lore-import.ts";
import { importMedia, summarizeMedia } from "./media-import.ts";
import { importReviews, summarizeReviews } from "./reviews-import.ts";
import { importStaetten, summarizeStaetten } from "./staetten-import.ts";
import {
    importStaettenRohquellen,
    onlyNamesFinding,
    summarizeStaettenRohquellen,
} from "./staetten-rohquellen-import.ts";
import { importTerritoryDetails, summarizeTerritoryDetails } from "./territory-details-import.ts";
import { WIKI_LINK_TABLES, importWikiLinkTargets } from "./wiki-link-targets-import.ts";
import { importWikiSettlements, summarizeWikiSettlements } from "./wiki-settlements-import.ts";
import { verifyCitymaps } from "./verify-citymaps.ts";
import { verifyLiterature } from "./verify-literature.ts";
import { verifyLore } from "./verify-lore.ts";
import { verifyMedia } from "./verify-media.ts";
import { verifyReviews } from "./verify-reviews.ts";
import { verifyStaetten } from "./verify-staetten.ts";
import { verifyTerritoryDetails } from "./verify-territory-details.ts";
import { verifySubjectDetails } from "./verify-subject-details.ts";
import { verifySources } from "./verify-sources.ts";
import { verifyTerritories } from "./verify-territories.ts";
import { readLegacyPlaceZones, verifyClimate } from "./verify-climate.ts";

/**
 * `npm run legacy:update` (Baustein 2, Koordination 2026-09-28, "Legacy-Daten live auf Zuruf"):
 * zieht den aktuellen Legacy-Stand und spielt ihn auf Zuruf direkt in `avesmaps3d_dev` ein.
 *
 * Der Betreiber hat den frueheren Plan (Wegwerf-Cluster, gepinnte Satzdatei je Zug, `pg_dump` vor
 * jedem Zug) ausdruecklich verworfen - "du brauchst keine staende einfrieren... bei uns lokal ist
 * (noch) nichts editiert" und "wichtig ist, dass du ... nicht ... unsere ... db mit temporaeren
 * daten ueberwuchert". Deshalb:
 *   - kein Wegwerf-Cluster, kein `pg_dump`: der Import laeuft direkt gegen `DATABASE_URL`;
 *   - ein einziges, ueberschreibbares Download-Fach (`--snapshot-dir`, Vorgabe
 *     `C:\avesmaps3d-data\legacy-snapshots\aktuell`), keine datierten Ordner mehr;
 *   - keine Satzdatei je Zug in Git - der Bericht (Markdown im Download-Fach) ist die Spur.
 *
 * Zwei Modi:
 *   npm run legacy:update                                          # nur holen und pruefen, nichts schreiben
 *   npm run legacy:update -- --operator-said "<Betreiberzitat>"     # holen UND in avesmaps3d_dev einspielen
 *
 * Dazu der Auftrag aus der Verwaltung (WI-0127 SYS-14, „Abgleiche“): Der Worker der Warteschlange startet das Werkzeug mit
 * `--auftrag <Job>` statt des Zitats. Es spielt ein wie mit Zuruf, meldet seine Schritte als `::abgleich-phase …` und am Ende
 * `::abgleich-ergebnis …` (`abgleiche/protokoll.ts`) und zeichnet sich nicht selbst als `import` auf: Der Auftrag ist schon der Job.
 *
 * Ohne `--operator-said` schreibt das Werkzeug nichts - das ist der Map Mutation Guard (CLAUDE.local.md):
 * "Kartenmutation nur mit persoenlicher, scope-genauer Betreiberfreigabe". Der Zuruf selbst ist die
 * Freigabe (Betreiber 2026-09-28: "ich sag 'jetzt zieh mal' dann ziehst du"); das Zitat kommt woertlich
 * in den Bericht.
 *
 * Die VIERTE Quelle (WI-0062, ADR-0014): Legacys Export der Herrschaftsgebiete (`political-territories-export.php`,
 * `legacy-political-territories.json`). Er ist gross und teuer fuer das Shared Hosting - auch ein 304 kostet einen
 * vollen Lesevorgang -, deshalb wird er wie die anderen nur auf Zuruf geholt, hoechstens einmal je Zug (plus die
 * Wiederholung bei abweichenden Revisionen), bedingt ueber den Inhalts-ETag im Kopf `X-Avesmaps-ETag` (als
 * `If-None-Match` zurueckgesendet, gespeichert neben der Datei) und mit hoechstens zwei Wiederholungen bei
 * `503 data_changing` (`Retry-After`). Seine `map_revision` ist die von `map-features.php`; seinen eigenen Stempel
 * `territories_revision` prueft der Import. `--territories-file` nimmt stattdessen eine schon gespeicherte Datei.
 *
 * Die FUENFTE Quelle (WI-0064): die Darstellungstafel der Landschaften (`ecosystem-display.php`,
 * `legacy-ecosystem-display.json`). Der Endpunkt liefert NUR die Uebersteuerungen der Redaktion samt Stempel (`stamp`) - klein
 * (rund 1,8 KB), deshalb einmal je Zug ohne Wiederholungsschleife und ohne bedingten Abruf (STRATO entfernt den `ETag` aus
 * Antworten mit Rumpf). Die Vorgaben stehen in Legacys Code und liegen versioniert im Repo (`config/landscape-display/`);
 * die wirksame Tafel ist beides zusammen (`packages/shared/src/landscape-display.ts`, Schritt I16). Ein leerer Stempel heisst
 * Ausfall des Endpunkts (er faellt offen aus) und bricht ab. Der Stempel gehoert nicht zu `revisionsMatch`: er ist Legacys eigene
 * Zaehlung der Tafel, kein Stand von map-features oder ecosystem-areas. `--display-file` nimmt stattdessen eine gespeicherte Datei.
 *
 * Die SECHSTE und SIEBTE Quelle (WI-0063 P3, Schritte I20 und I21): die oeffentlichen Kataloge der Spielliteratur (`game-literature.php`,
 * `game-literature.json`) und der Kartensammlung (`citymaps.php`, `citymaps.json`). Je Zug HOECHSTENS EIN Abruf je Endpunkt, ohne
 * Wiederholung und ohne bedingten Abruf (der Code kennt weder Revision noch ETag), NUR MIT `--operator-said` (ohne ihn wird nichts davon
 * geholt) und erst nach I17 und I18. Ein Ausfall, eine leere oder abgeschaltete Antwort laesst nur den Schritt entfallen (Befund, kein
 * Tor). 🔴 Der GET dieser Endpunkte schreibt in Legacy heute Schemaheilung (bei `citymaps.php` auch die Rueckfuellung color_mode); der
 * Abruf ist gebaut, aber nicht erprobt, bis der Betreiber ihn zuruft. `--literature-file` und `--citymaps-file` nehmen stattdessen eine
 * gespeicherte Antwort. Der zweite Lauf (Idempotenzprobe) nimmt dieselben Antworten, es gibt keinen zweiten Abruf.
 *
 * Die ACHTE Quelle (WI-0063 P3, Schritt I22): der Bewertungs-Export E3 (`location-reviews-export.php`, `location-reviews.json`), nur die
 * sichtbaren Bewertungen ohne Personenbezug. Wie die Kataloge: HOECHSTENS EIN Abruf je Zug, ohne Wiederholung (ein 503 laesst den Schritt
 * entfallen), NUR MIT `--operator-said`; ein Ausfall oder eine unbrauchbare Antwort laesst nur den Schritt entfallen (Befund, kein Tor).
 * Der GET ist in Legacy lesend. `--reviews-file` nimmt stattdessen eine gespeicherte Antwort. Die Gebietsdetails (I23, Export E4) brauchen
 * KEINEN weiteren Abruf: sie lesen dieselbe Gebietsdatei wie I14. Die Datei der Bewertungen traegt Autorennamen und Texte und bleibt im
 * lokalen Download-Fach; Bericht und Befunde nennen nur Kennungen und Zahlen.
 *
 * Die NEUNTE und ZEHNTE Quelle (WI-0063 27.12, Schritt I24): Legacys zwei lesende Exporte der Wiki-Linkziele (X1 `wiki-linkziele-export.php`,
 * `legacy-wiki-linkziele.json`) und der Wiki-Zuordnung (X2 `wiki-zuordnung-export.php`, `legacy-wiki-zuordnung.json`). EIN Abruf je Endpunkt und
 * Zug, NUR MIT `--operator-said`, nie in einer Schleife (X1 rund 4 MB, X2 rund 1,6 MB; auch ein 304 kostete einen vollen Lesevorgang, darum kein bedingter
 * Abruf), mit hoechstens zwei Wiederholungen bei `503 data_changing` (`Retry-After`). Beide GET schreiben in Legacy nichts (kein Selbstheilen).
 * Faellt ein Abruf aus oder ist die Antwort leer, entfaellt nur dieser Teil von I24 (Befund, kein Tor). `--wiki-linkziele-file` und
 * `--wiki-zuordnung-file` nehmen stattdessen eine gespeicherte Antwort. Der zweite Lauf (Idempotenzprobe) nimmt dieselben Antworten.
 *
 * Die ELFTE Quelle (WI-0063 P3, Schritt I25): der Voll-Export der Lore (`lore-export.php`, `lore-export.json`, Legacy E2 und E2+, rein
 * lesend). Gross und teuer fuer Legacy: HOECHSTENS EIN Abruf je Zug, ohne Wiederholung und ohne bedingten Abruf, NUR MIT
 * `--operator-said`, erst nach I24 (die Ortszeilen loesen ueber DENSELBEN Lookup nach Wiki-Key auf wie die Objektlinks, gespeist aus der
 * Zuordnung X2) und I18 (die Quellen haengen am Katalog desselben Zuges). Ein Ausfall, eine unbrauchbare, leere oder abgeschaltete Antwort oder
 * Kopfzaehler, die nicht zu den Listen passen, lassen nur den Schritt entfallen (Befund, kein Tor). `--lore-file` nimmt stattdessen eine
 * gespeicherte Antwort; der Abruf selbst schreibt in Legacy nichts.
 *
 * Die ZWOELFTE Quelle (WI-0063 MEDIA-M8, Schritt I26): das oeffentliche Medien-Manifest E5 A (`media-export.php`, `media-export.json`), nur
 * was Legacy heute jedem zeigt. Wie die Kataloge: HOECHSTENS EIN Abruf je Zug, ohne Wiederholung, NUR MIT `--operator-said`, ein Ausfall
 * oder eine unbrauchbare Antwort laesst nur den Schritt entfallen (Befund, kein Tor). Das private Manifest B (Admin-Sitzung) holt dieses
 * Werkzeug NIE: es kommt als Datei vom Betreiber (`--media-private-file`) und ist dann die Quelle (A nur der Vergleich); nur B zieht
 * zurueck, was Legacy nicht mehr nennt. `--media-file` nimmt stattdessen eine gespeicherte Antwort von A. I26 schreibt NUR Metadaten: die
 * Bytes der Medien holt der Zug nie (eigener Pfad: `legacy:media-fetch`, `migrate:media-files`). Der Schritt steht nach den Orten (I1), den
 * Gebieten (I14), den Werken (I20) und den Karten (I21): die Bindungen loesen ueber die Legacy-Kennung auf.
 *
 * Die DREIZEHNTE Quelle (WI-0128 E4, Schritt I28): Legacys lesender Export der Wiki-Siedlungsregistry (X3 `wiki-siedlungen-export.php`,
 * `legacy-wiki-siedlungen.json`), die Grundlage des Reiters „Fehlt“. Wie X1 und X2: EIN Abruf je Zug, NUR MIT `--operator-said`, ohne bedingten
 * Abruf, hoechstens zwei Wiederholungen bei `503 data_changing`; der GET schreibt in Legacy nichts. Faellt der Abruf aus oder ist die Antwort
 * unbrauchbar oder leer, entfaellt nur I28 (Befund, kein Tor). `--wiki-siedlungen-file` nimmt stattdessen eine gespeicherte Antwort. 🪤 Der
 * Endpunkt existiert erst, wenn die Anfrage `project-control/legacy-requests/2026-10-10-wiki-siedlungsregistry-export.md` in Legacy eingespielt
 * ist; bis dahin endet der Abruf mit 404 und I28 entfaellt.
 *
 * Die VIERZEHNTE Quelle (WI-0134, Teil von I27): Legacys Rohquellen-Export der Staetten (X4 `staetten-rohquellen-export.php`,
 * `legacy-staetten-rohquellen.json`), die Staetten ueber Kennungen. Dieselbe Abrufregel wie X1 bis X3 (EIN Abruf je Zug, NUR MIT
 * `--operator-said`, ohne bedingten Abruf, hoechstens zwei Wiederholungen bei `503 data_changing`); `--staetten-rohquellen-file` nimmt
 * stattdessen eine gespeicherte Antwort. Faellt der Abruf aus, schreibt I27 nur `settlement_place` aus `in_settlement_places` wie bisher
 * (Befund `staetten_nur_namen`, kein Tor). 🪤 Der Endpunkt existiert erst nach dem Einspielen der Anfrage
 * `project-control/legacy-requests/2026-10-10-staetten-rohquellen-export.md`; bis dahin endet der Abruf mit 404.
 *
 * Die ersten drei Dateien kommen live: Seit 2026-09-29 hat Legacy den oeffentlichen Regions-Export
 * (`ecosystem-regions.php`, Auftrag `project-control/legacy-requests/2026-09-28-oeffentlicher-regions-
 * export.md`). Passen die Revisionen der drei Antworten nicht zusammen (Legacy wird gerade redigiert),
 * holt das Werkzeug alle drei einmal neu; passen sie dann noch nicht, bricht es ab. `--regions-file`
 * nimmt stattdessen einen Editor-Export von Hand (`export-list-regions.js`) - nur noch als Rueckfall.
 *
 * Reihenfolge der Importer/Ableitungen/Pruefer folgt `ops/deploy/staging-import.sh` (die verbindliche
 * Quelle, Koordination 2026-09-28): Orte, Regionen, Schriftlaeufe, Klima, Wege, Wegkurve, Wegnamen,
 * Kraftlinien, Seegraph, Gelaende-Eingaben, Gelaende ableiten, Relief ableiten.
 *
 * 🔴 Korrektur 2026-09-28 (Hardening Review M5): Kraftlinien laufen NACH den Wegen aus KONVENTION, nicht
 * aus einer fachlichen Abhaengigkeit - I8 selbst ist unabhaengig (Anhang E des Befunds), nur sein
 * Verifier (V7, `verifyPowerlines`) prueft die Enden gegen Orte (I1) und die eigenen Kraftlinienpunkte
 * (`nodix`, I8), nicht gegen Kreuzungen, und der laeuft ohnehin erst ganz am Ende der Kette. Die Reihenfolge bleibt trotzdem, damit sie zu `staging-import.sh`
 * passt (`pipeline-parity.test.ts`).
 *
 * 🪤 Getestet gegen eine LEERE Datenbank faellt `verify:regions` (retirement_applied) auf eine der
 * zwoelf namentlich stillgelegten Regionen (region-import.ts): existiert sie im aktuellen Legacy-
 * Bestand nicht mehr, legt der Importer nie eine Zeile fuer sie an, die er stillzulegen haette. Gegen
 * das echte `avesmaps3d_dev` (nie leer, die Region steht dort seit einem frueheren Import) tritt das
 * nicht auf. Kein Fehler in diesem Werkzeug, nur eine Eigenschaft von retiredByDecision auf einer
 * jungfraeulichen Datenbank - beim allerersten Zug ueberhaupt waere das zu pruefen.
 */

// Nur als Programm liest es die Befehlszeile; beim bloßen import() gelten die Vorgaben (siehe unten).
const { values } = parseArgs({
    args: import.meta.main ? process.argv.slice(2) : [],
    options: {
        "operator-said": { type: "string" },
        // WI-0127 SYS-14: ein Auftrag aus der Verwaltung („Abgleiche“) statt des Zurufs; schließt --operator-said aus.
        auftrag: { type: "string" },
        // WI-0141: EINE Kategorie ziehen (landschaften, wege, orte) statt der ganzen Karte. Betreiber 2026-10-13:
        // „knopf legacy zug, aber jede kategorie einzeln (also unterkategorien ohne dass man alles ziehen darf)“.
        kategorie: { type: "string" },
        "snapshot-dir": { type: "string", default: DEFAULT_SNAPSHOT_DIR },
        "regions-file": { type: "string" },
        "territories-file": { type: "string" },
        "display-file": { type: "string" },
        // Wirkungslos seit 2026-10-03 (Betreiber): die Stilllegequote haelt keinen Zug mehr an, sie wird gemeldet.
        // Der Schalter bleibt nur angenommen, damit vorhandene Aufrufe nicht an einer unbekannten Option scheitern.
        "allow-shrink": { type: "boolean", default: false },
        "map-features-endpoint": { type: "string", default: PUBLIC_MAP_FEATURES_ENDPOINT },
        "ecosystem-areas-endpoint": { type: "string", default: PUBLIC_ECOSYSTEM_AREAS_ENDPOINT },
        "ecosystem-regions-endpoint": { type: "string", default: PUBLIC_ECOSYSTEM_REGIONS_ENDPOINT },
        "political-territories-endpoint": { type: "string", default: PUBLIC_POLITICAL_TERRITORIES_ENDPOINT },
        "ecosystem-display-endpoint": { type: "string", default: PUBLIC_ECOSYSTEM_DISPLAY_ENDPOINT },
        // WI-0063 P3 (I20, I21): Spielliteratur und Kartensammlung, je EIN Abruf, nur mit dem Zuruf des Betreibers.
        "game-literature-endpoint": { type: "string", default: PUBLIC_GAME_LITERATURE_ENDPOINT },
        "citymaps-endpoint": { type: "string", default: PUBLIC_CITYMAPS_ENDPOINT },
        // WI-0063 P3 (I22): die sichtbaren Bewertungen (E3), EIN Abruf, nur mit dem Zuruf des Betreibers.
        "reviews-endpoint": { type: "string", default: PUBLIC_LOCATION_REVIEWS_ENDPOINT },
        // Rueckfall: eine schon gespeicherte Antwort statt eines neuen Abrufs.
        "literature-file": { type: "string" },
        "citymaps-file": { type: "string" },
        "reviews-file": { type: "string" },
        // WI-0063 27.12 (I24): die Wiki-Linkziele (X1) und die Wiki-Zuordnung (X2), je EIN Abruf, nur mit dem Zuruf des Betreibers.
        "wiki-linkziele-endpoint": { type: "string", default: PUBLIC_WIKI_LINKZIELE_ENDPOINT },
        "wiki-zuordnung-endpoint": { type: "string", default: PUBLIC_WIKI_ZUORDNUNG_ENDPOINT },
        "wiki-linkziele-file": { type: "string" },
        "wiki-zuordnung-file": { type: "string" },
        // WI-0128 E4 (I28): die Wiki-Siedlungsregistry (X3), EIN Abruf, nur mit dem Zuruf des Betreibers.
        "wiki-siedlungen-endpoint": { type: "string", default: PUBLIC_WIKI_SIEDLUNGEN_ENDPOINT },
        "wiki-siedlungen-file": { type: "string" },
        // WI-0134 (I27): Legacys Rohquellen-Export der Staetten (X4), EIN Abruf, nur mit dem Zuruf des Betreibers.
        "staetten-rohquellen-endpoint": { type: "string", default: PUBLIC_STAETTEN_ROHQUELLEN_ENDPOINT },
        "staetten-rohquellen-file": { type: "string" },
        // WI-0063 P3 (I25): die Lore (E2 und E2+), EIN Abruf, nur mit dem Zuruf des Betreibers.
        "lore-endpoint": { type: "string", default: PUBLIC_LORE_EXPORT_ENDPOINT },
        "lore-file": { type: "string" },
        // WI-0063 MEDIA-M8 (I26): das oeffentliche Medien-Manifest (EIN Abruf, nur mit Zuruf); B nur als Datei vom Betreiber.
        "media-endpoint": { type: "string", default: PUBLIC_MEDIA_EXPORT_ENDPOINT },
        "media-file": { type: "string" },
        "media-private-file": { type: "string" },
    },
});

/** So viele Objekte nennt der Log je Befund; der Bericht im Download-Fach nennt alle, die der Befund traegt. */
const FINDING_LOG_OBJECTS = 20;

/**
 * Die Kategorie dieses Zugs (WI-0141) oder `null` für die ganze Karte. Eine unbekannte Kategorie bricht ab, bevor irgendetwas
 * geholt wird — namentlich `herrschaftsgebiete`: Betreiber 2026-10-13 „herrschaftsgebiete auf keinen fall -> die sind kaputt
 * durch die limitierung von strato“.
 */
const kategorie: LegacyZugKategorie | null = (() => {
    const wanted = values["kategorie"];
    if (wanted === undefined) return null;
    if (!istLegacyZugKategorie(wanted)) {
        console.error(
            `--kategorie: "${wanted}" ist keine Kategorie des Zugs (${LEGACY_ZUG_KATEGORIEN.join(", ")}). ` +
                "Herrschaftsgebiete zieht dieser Weg nie (Betreiber 2026-10-13).",
        );
        process.exit(2);
    }
    return wanted;
})();
/** Die Schritte dieses Zugs; ohne `--kategorie` läuft jeder. */
const kategorieSchritte = kategorie === null ? null : new Set(legacyZugKategorie(kategorie).schritte);
/** Die Prüfungen dieses Zugs; ohne `--kategorie` läuft jede. */
const kategoriePruefungen = kategorie === null ? null : new Set(legacyZugKategorie(kategorie).pruefungen);

const snapshotDir = values["snapshot-dir"];
// Rueckfall: ein Editor-Export von Hand. Ohne den Schalter kommen die Regionen live wie die anderen zwei.
const regionsFilePath = values["regions-file"];
// Rueckfall fuer die Gebiete: eine schon gespeicherte Datei (etwa nach einem Abruf von Hand), ohne neuen Abruf.
const territoriesFilePath = values["territories-file"];
// Rueckfall fuer die Darstellungstafel: eine schon gespeicherte Antwort, ohne neuen Abruf.
const displayFilePath = values["display-file"];
// Der Zuruf an einen Agenten (`--operator-said`) oder ein Auftrag aus der Verwaltung (`--auftrag`, WI-0127 SYS-14), nie beides
// (`abgleiche/freigabe.ts`). Beide spielen ein; der Bericht nennt, welche Freigabe galt.
const freigabe = (() => {
    try {
        return freigabeAus({ "operator-said": values["operator-said"], auftrag: values["auftrag"] });
    } catch (error) {
        if (!(error instanceof FreigabeFehler)) throw error;
        console.error(error.message);
        process.exit(2);
    }
})();
const apply = freigabe.apply;
/** Im Lauf mit `--auftrag` meldet der Zug Phasen und Ergebnis an den Job, der ihn gestartet hat (`abgleiche/protokoll.ts`). */
const meldet = freigabe.auftrag !== null;

function line(text = ""): void {
    console.log(text);
}

// ---------------------------------------------------------------------------------------------
// Schritt 1: die drei Dateien holen (zwei live, eine aus dem Download-Fach).
// ---------------------------------------------------------------------------------------------

interface FetchedJson<T> {
    payload: T;
    bytes: number;
    sha256: string;
}

async function fetchLive<T>(url: string): Promise<FetchedJson<T>> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${url}: HTTP ${String(response.status)}`);
    }
    const text = await response.text();
    return { payload: JSON.parse(text) as T, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256Hex(text) };
}

async function readSaved<T>(path: string): Promise<FetchedJson<T>> {
    const buffer = await readFile(path);
    return { payload: JSON.parse(buffer.toString("utf8")) as T, bytes: buffer.byteLength, sha256: sha256Hex(buffer) };
}

interface MapFeaturesPayloadShape {
    ok?: boolean;
    revision?: number;
    features?: unknown[];
}
interface EcosystemAreasPayloadShape {
    ok?: boolean;
    revision?: number;
    truncated?: boolean;
    areas?: unknown[];
}
interface RegionsPayloadShape {
    ok?: boolean;
    map_revision?: number;
    ecosystem_revision?: number;
    regions?: unknown[];
}

interface Triple {
    features: FetchedJson<MapFeaturesPayloadShape>;
    areas: FetchedJson<EcosystemAreasPayloadShape>;
    regions: FetchedJson<RegionsPayloadShape>;
    /** Herkunft der Regionen fuer den Bericht („live …“ oder „Editor-Export, N min alt“). */
    regionsLabel: string;
    /** Die Herrschaftsgebiete (WI-0062), vierte Quelle; `null` bei einem Zug je Kategorie (WI-0141): nie abgerufen. */
    territories: FetchedJson<LegacyTerritoryPayload> | null;
    /** Ihr Inhalts-ETag (`X-Avesmaps-ETag`) fuer den bedingten Abruf des naechsten Zugs; `null` ohne Abruf. */
    territoriesEtag: string | null;
    /** Herkunft fuer den Bericht („live …“, „304, unveraendert“, „Datei …“). */
    territoriesLabel: string;
    /** Was der Abruf meldet, ohne anzuhalten (Betreiber 2026-10-03): etwa abweichende Revisionen der Antworten. */
    findings: Finding[];
}

/**
 * Holt die Herrschaftsgebiete (WI-0062): bedingt ueber den gespeicherten ETag, mit hoechstens zwei Wiederholungen bei
 * `503 data_changing`. `conditional: false` holt unbedingt - so beim zweiten Versuch nach abweichenden Revisionen: ein 304
 * lieferte sonst den alten Stand.
 */
async function fetchTerritories(conditional: boolean): Promise<{
    territories: FetchedJson<LegacyTerritoryPayload>;
    etag: string | null;
    label: string;
}> {
    const file = `${snapshotDir}\\legacy-political-territories.json`;
    const etagFile = `${snapshotDir}\\legacy-political-territories.etag`;
    if (territoriesFilePath !== undefined) {
        if (!existsSync(territoriesFilePath)) throw new Error(`--territories-file: ${territoriesFilePath} fehlt.`);
        line(`→ lese legacy-political-territories.json (${territoriesFilePath}), kein Abruf`);
        const saved = await readSaved<LegacyTerritoryPayload>(territoriesFilePath);
        return { territories: saved, etag: null, label: `Datei ${territoriesFilePath}` };
    }
    const storedEtag =
        conditional && existsSync(file) && existsSync(etagFile) ? (await readFile(etagFile, "utf8")).trim() : "";
    line(
        `→ hole legacy-political-territories.json live (${values["political-territories-endpoint"]})` +
            (storedEtag === "" ? "" : ", bedingt"),
    );
    const answer = await requestTerritories({
        url: values["political-territories-endpoint"],
        storedEtag,
        log: line,
    });
    if (answer.kind === "not_modified") {
        line("   304: unveraendert seit dem letzten Zug, nehme die gespeicherte Datei");
        return {
            territories: await readSaved<LegacyTerritoryPayload>(file),
            etag: answer.etag,
            label: "304, unveraendert",
        };
    }
    const payload = JSON.parse(answer.text) as LegacyTerritoryPayload;
    return {
        territories: { payload, bytes: Buffer.byteLength(answer.text, "utf8"), sha256: sha256Hex(answer.text) },
        etag: answer.etag,
        label: `live, ${String(payload.map_revision)}/${String(payload.territories_revision)}`,
    };
}

/** Die Darstellungstafel (WI-0064), fuenfte Quelle: die Antwort samt Herkunft fuer den Bericht. */
interface FetchedDisplay {
    input: LandscapeDisplayInput;
    label: string;
}

/**
 * Holt die Darstellungstafel einmal. Gelesen und geprueft wird VOR dem Ablegen: eine unbrauchbare Antwort (leerer Stempel, Zahl
 * ausserhalb der Schranken) landet nicht im Download-Fach und bricht den Zug ab, bevor die grossen Quellen geholt sind.
 */
async function fetchDisplay(): Promise<FetchedDisplay> {
    if (displayFilePath !== undefined) {
        if (!existsSync(displayFilePath)) throw new Error(`--display-file: ${displayFilePath} fehlt.`);
        line(`→ lese legacy-ecosystem-display.json (${displayFilePath}), kein Abruf`);
        const input = landscapeDisplayFromBytes(await readFile(displayFilePath));
        return { input, label: `Datei ${displayFilePath}, Stempel ${input.response.stamp}` };
    }
    const url = values["ecosystem-display-endpoint"];
    line(`→ hole legacy-ecosystem-display.json live (${url})`);
    const { input, bytes } = await requestLandscapeDisplay({ url });
    await mkdir(snapshotDir, { recursive: true });
    // Die Bytes der Antwort, wie geliefert: `sha256sum` der Datei nennt denselben Wert wie der Bericht.
    await writeFile(`${snapshotDir}\\legacy-ecosystem-display.json`, bytes);
    return { input, label: `live, Stempel ${input.response.stamp}` };
}

/**
 * Ein Katalog (I20 Spielliteratur, I21 Kartensammlung): die Antwort samt Herkunft fuer den Bericht. `payload` ist `null`, wenn der Abruf
 * ausfiel; der Schritt entfaellt dann mit Befund (optional, kein Tor).
 */
interface FetchedCatalog {
    file: string;
    payload: unknown;
    bytes: number;
    sha256: string;
    label: string;
    /** Was der Abruf meldet: Selbstheilung in Legacy (Information) oder sein Scheitern. */
    findings: Finding[];
}

/**
 * Holt einen Katalog EINMAL, ohne Wiederholung und ohne bedingten Abruf (der Code kennt weder Revision noch ETag). Nur mit dem Zuruf des
 * Betreibers aufgerufen. Ein Fehler wirft nicht: Die Antwort kommt als `payload: null` mit Befund zurueck.
 */
async function fetchCatalog(
    file: string,
    url: string,
    savedPath: string | undefined,
    options: { selfHeals?: boolean } = {},
): Promise<FetchedCatalog> {
    try {
        if (savedPath !== undefined) {
            if (!existsSync(savedPath)) throw new Error(`${savedPath} fehlt`);
            line(`→ lese ${file} (${savedPath}), kein Abruf`);
            const saved = await readSaved<unknown>(savedPath);
            return {
                file,
                payload: saved.payload,
                bytes: saved.bytes,
                sha256: saved.sha256,
                label: `Datei ${savedPath}`,
                findings: [],
            };
        }
        line(`→ hole ${file} live (${url})`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const payload = JSON.parse(bytes.toString("utf8")) as unknown;
        await mkdir(snapshotDir, { recursive: true });
        // Die Bytes der Antwort, wie geliefert: `sha256sum` der Datei nennt denselben Wert wie der Bericht.
        await writeFile(`${snapshotDir}\\${file}`, bytes);
        return {
            file,
            payload,
            bytes: bytes.byteLength,
            sha256: sha256Hex(bytes),
            label: "live",
            // Der GET der Bewertungen ist lesend (kein DDL); nur die zwei Kataloge heilen in Legacy ihr Schema beim Abruf.
            findings: options.selfHeals === false ? [] : [legacyGetSelfHealsFinding(file)],
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        line(`⚠ ${file}: ${reason}; der Schritt entfaellt`);
        return {
            file,
            payload: null,
            bytes: 0,
            sha256: "",
            label: `Abruf gescheitert: ${reason}`,
            findings: [catalogFetchFailureFinding(file, reason)],
        };
    }
}

/**
 * Holt einen der zwei Wiki-Exporte (I24) EINMAL: ohne bedingten Abruf, mit hoechstens zwei Wiederholungen bei `503 data_changing` nach `Retry-After`
 * (`requestTerritories` ist dieselbe Regel). Kein Selbstheilen in Legacy, darum kein Befund dazu. Ein Fehler wirft nicht: die Antwort kommt als
 * `payload: null` mit Befund zurueck, der Teil entfaellt.
 */
async function fetchWikiExport(file: string, url: string, savedPath: string | undefined): Promise<FetchedCatalog> {
    try {
        if (savedPath !== undefined) {
            if (!existsSync(savedPath)) throw new Error(`${savedPath} fehlt`);
            line(`→ lese ${file} (${savedPath}), kein Abruf`);
            const saved = await readSaved<unknown>(savedPath);
            return {
                file,
                payload: saved.payload,
                bytes: saved.bytes,
                sha256: saved.sha256,
                label: `Datei ${savedPath}`,
                findings: [],
            };
        }
        line(`→ hole ${file} live (${url})`);
        const answer = await requestTerritories({ url, storedEtag: "", log: line });
        if (answer.kind !== "fresh") throw new Error("unerwartete Antwort 304 ohne bedingten Abruf");
        const payload = JSON.parse(answer.text) as unknown;
        await mkdir(snapshotDir, { recursive: true });
        await writeFile(`${snapshotDir}\\${file}`, answer.text, "utf8");
        return {
            file,
            payload,
            bytes: Buffer.byteLength(answer.text, "utf8"),
            sha256: sha256Hex(answer.text),
            label: "live",
            findings: [],
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        line(`⚠ ${file}: ${reason}; der Teil entfaellt`);
        return {
            file,
            payload: null,
            bytes: 0,
            sha256: "",
            label: `Abruf gescheitert: ${reason}`,
            findings: [catalogFetchFailureFinding(file, reason)],
        };
    }
}

/** Die Kataloge von I20 bis I26; ohne den Zuruf des Betreibers (`apply` falsch) wird nichts abgerufen. */
interface Catalogs {
    literature: FetchedCatalog | null;
    citymaps: FetchedCatalog | null;
    /** Die sichtbaren Bewertungen (I22, E3). */
    reviews: FetchedCatalog | null;
    /** X1, die Linkziele (I24). */
    wikiLinkziele: FetchedCatalog | null;
    /** X2, die Zuordnungstafel (I24). */
    wikiZuordnung: FetchedCatalog | null;
    /** X3, die Wiki-Siedlungsregistry (I28). */
    wikiSiedlungen: FetchedCatalog | null;
    /** X4, die Rohquellen der Staetten (I27, WI-0134). */
    staettenRohquellen: FetchedCatalog | null;
    /** Die Lore (I25, E2 und E2+). */
    lore: FetchedCatalog | null;
    /** Das oeffentliche Medien-Manifest (I26, E5 A) und, nur als Datei vom Betreiber, das private (E5 B). */
    media: FetchedCatalog | null;
    mediaPrivate: FetchedCatalog | null;
}

async function fetchRegions(): Promise<{ regions: FetchedJson<RegionsPayloadShape>; regionsLabel: string }> {
    if (regionsFilePath === undefined) {
        line(`→ hole legacy-list-regions.json live (${values["ecosystem-regions-endpoint"]})`);
        const regions = await fetchLive<RegionsPayloadShape>(values["ecosystem-regions-endpoint"]);
        const label = `live, ${String(regions.payload.map_revision)}/${String(regions.payload.ecosystem_revision)}`;
        return { regions, regionsLabel: label };
    }
    const status = regionsFileStatus(regionsFilePath);
    if (!status.present) {
        throw new Error(`--regions-file: ${regionsFilePath} fehlt.`);
    }
    line(`→ lese legacy-list-regions.json (${regionsFilePath}, ${String(status.ageMinutes)} min alt)`);
    return {
        regions: await readSaved<RegionsPayloadShape>(regionsFilePath),
        regionsLabel: `Editor-Export, ${String(status.ageMinutes)} min alt`,
    };
}

async function fetchTriple(): Promise<Triple> {
    await mkdir(snapshotDir, { recursive: true });
    for (let attempt = 1; ; attempt += 1) {
        line(`→ hole map-features.json live (${values["map-features-endpoint"]})`);
        const features = await fetchLive<MapFeaturesPayloadShape>(values["map-features-endpoint"]);
        line(`→ hole ecosystem-areas.json live (${values["ecosystem-areas-endpoint"]})`);
        const areas = await fetchLive<EcosystemAreasPayloadShape>(values["ecosystem-areas-endpoint"]);
        if (areas.payload.truncated !== false) {
            throw new Error("ecosystem-areas.json meldet sich selbst als abgeschnitten (truncated != false)");
        }
        const { regions, regionsLabel } = await fetchRegions();
        // Die Gebiete (WI-0062): beim ersten Versuch bedingt, beim zweiten unbedingt.
        // 🔴 Ein Zug je Kategorie (WI-0141) ruft `political-territories-export.php` NIE auf: Betreiber 2026-10-13
        // „herrschaftsgebiete auf keinen fall -> die sind kaputt durch die limitierung von strato“. Auch kein 304, auch keine
        // Datei — der Satz dieses Zugs trägt keine Gebietsdatei, I14/I15/I23 und ihre Prüfer entfallen damit von selbst.
        const {
            territories,
            etag: territoriesEtag,
            label: territoriesLabel,
        } = kategorie === null
            ? await fetchTerritories(attempt === 1)
            : { territories: null, etag: null, label: "nicht geholt (Zug je Kategorie)" };
        if (
            territories !== null &&
            (territories.payload.ok !== true || !Array.isArray(territories.payload.territories))
        ) {
            throw new Error(
                "legacy-political-territories.json weist sich nicht als vollstaendige Antwort aus (ok/territories)",
            );
        }
        if (
            regions.payload.ok !== true ||
            !Array.isArray(regions.payload.regions) ||
            regions.payload.regions.length === 0
        ) {
            throw new Error("legacy-list-regions.json weist sich nicht als vollstaendige Antwort aus (ok/regions)");
        }
        const consistent =
            regionsFilePath !== undefined ||
            revisionsMatch(features.payload.revision, areas.payload.revision, regions.payload, territories?.payload);
        const seen =
            `Orte ${String(features.payload.revision)}/${String(regions.payload.map_revision)}/${String(territories?.payload.map_revision ?? "-")}, ` +
            `Oekosystem ${String(areas.payload.revision)}/${String(regions.payload.ecosystem_revision)}`;
        // 🔴 Betreiber 2026-10-03 („A auch für die Prüfungen“): Verschiedene Staende der Antworten halten den Zug nicht mehr an.
        // Nach dem zweiten Abruf geht er mit den zuletzt geholten weiter, und der Bericht nennt die Revisionen als Befund.
        // Unvollstaendige Antworten (truncated, ok, leere Liste, oben) halten weiter an.
        if (consistent || attempt >= 2) {
            // Im Download-Fach ablegen, ueberschreibend (Betreiber: ein Fach, keine datierten Ordner).
            await writeFile(`${snapshotDir}\\map-features.json`, JSON.stringify(features.payload));
            await writeFile(`${snapshotDir}\\ecosystem-areas.json`, JSON.stringify(areas.payload));
            if (regionsFilePath === undefined) {
                await writeFile(`${snapshotDir}\\legacy-list-regions.json`, JSON.stringify(regions.payload));
            }
            if (territories !== null && territoriesFilePath === undefined) {
                // Datei UND ETag zusammen: der naechste Zug sendet ihn als If-None-Match. Ohne ETag der Antwort bleibt
                // die Etag-Datei leer, und der naechste Abruf ist unbedingt (nie ein ETag zu einer anderen Datei).
                await writeFile(
                    `${snapshotDir}\\legacy-political-territories.json`,
                    JSON.stringify(territories.payload),
                );
                await writeFile(`${snapshotDir}\\legacy-political-territories.etag`, territoriesEtag ?? "");
            }
            const sourceFindings = consistent
                ? []
                : [
                      revisionMismatchFinding(seen, {
                          features: features.payload.revision,
                          areas: areas.payload.revision,
                          regionsMap: regions.payload.map_revision,
                          regionsEcosystem: regions.payload.ecosystem_revision,
                          territoriesMap: territories?.payload.map_revision,
                      }),
                  ];
            for (const text of formatFindings(sourceFindings)) line(`   ${text}`);
            return {
                features,
                areas,
                regions,
                regionsLabel,
                territories,
                territoriesEtag,
                territoriesLabel,
                findings: sourceFindings,
            };
        }
        line(`⚠ Revisionen passen nicht zusammen (${seen}) - Legacy wird gerade redigiert. Hole alle vier einmal neu.`);
    }
}

// ---------------------------------------------------------------------------------------------
// Schritt 2: die Import-/Ableitungs-/Pruefkette, in der Reihenfolge von staging-import.sh.
// ---------------------------------------------------------------------------------------------

interface StepOutcome {
    id: string;
    label: string;
    ok: boolean;
    summary: string;
    changed: boolean;
    /** Was der Schritt meldet, ohne anzuhalten (Betreiber 2026-10-03): Zahlen und betroffene Objekte. */
    findings: Finding[];
    /** Ein eigener kurzer Abschnitt im Bericht (Markdown-Zeilen), aus dem ersten Lauf; heute nur I9, Häfen ohne Wasser-Zugang. */
    section?: string[];
}

class PipelineHalted extends Error {
    readonly outcomes: StepOutcome[];
    constructor(message: string, outcomes: StepOutcome[]) {
        super(message);
        this.name = "PipelineHalted";
        this.outcomes = outcomes;
    }
}

/**
 * Die Aufzeichnung des Laufs in der Queue (WI-0074, JOBS-0001 Etappe 1: `legacy:update` erscheint als `import` auf der Statusseite).
 * 🔴 Best effort, hält nie an: Der Beobachter wird nur gesetzt, wenn das Aufzeichnen gelang, und jeder Fehler darin wird vom Recorder
 * geschluckt. Er hört auf `record` unten: ist ein Schritt fertig, meldet er den NÄCHSTEN als laufende Phase (so bucht die Zulassung
 * schon während I11 die 1.400 MB des Geländes, nicht erst danach).
 */
let observeStep: ((completedId: string) => void) | undefined;
let recordingDone: () => Promise<unknown> = () => Promise.resolve();

async function runPipeline(
    database: Database,
    features: MapFeaturesPayloadShape,
    areas: EcosystemAreasPayloadShape,
    regions: RegionsPayloadShape,
    /** `null` bei einem Zug je Kategorie (WI-0141): I14, I15, I23 und ihre Prüfer entfallen dann. */
    territories: LegacyTerritoryPayload | null,
    territoriesEtag: string | null,
    display: LandscapeDisplayInput,
    catalogs: Catalogs,
    previousRun?: StepOutcome[],
): Promise<StepOutcome[]> {
    const outcomes: StepOutcome[] = [];
    const mapDomainId = AVENTURIA.mapDomain;
    // Die IDs und Labels von I1..I12 kommen aus pipeline-steps.ts (M5b, EINE Quelle fuer die
    // Ableitungsreihenfolge) - nicht als eigene Literale hier. V1..V8 (Pruefer ohne Schreibpfad, unten)
    // stehen dort nicht: Anhang E des Befunds fuehrt nur I1..I13.
    const step = (id: string): PipelineStep => {
        const found = PIPELINE_STEPS.find((candidate) => candidate.id === id);
        if (!found) throw new Error(`Unbekannter Pipeline-Schritt: ${id}`);
        return found;
    };
    const record = (
        id: string,
        label: string,
        ok: boolean,
        summary: string,
        changed: boolean,
        findings: readonly Finding[] = [],
        section?: readonly string[],
    ): StepOutcome => {
        const outcome: StepOutcome = { id, label, ok, summary, changed, findings: [...findings] };
        if (section) outcome.section = [...section];
        outcomes.push(outcome);
        observeStep?.(id);
        line(`${ok ? "✅" : "❌"} ${id} ${label}: ${summary}`);
        // Befunde stehen im Log gekürzt (die vollständige Liste steht im Bericht), der Lauf geht weiter.
        for (const text of formatFindings(outcome.findings, FINDING_LOG_OBJECTS)) line(`   ${text}`);
        if (!ok) {
            throw new PipelineHalted(`${id} ${label} fehlgeschlagen`, outcomes);
        }
        return outcome;
    };

    const passedOf = (check: { passed: boolean }): boolean => check.passed;

    /**
     * Läuft dieser Schritt in diesem Zug (WI-0141)? Ohne `--kategorie` jeder; mit `--kategorie` nur die Schritte dieser
     * Kategorie (`config/legacy-zug-kategorien.json`). 🔴 Ein Schritt, der einer anderen Kategorie gehört, steht NICHT als
     * Lücke im Bericht: Ein Zug der Orte ist vollständig, wenn die Orte vollständig sind. Lücken bleiben, was sie waren —
     * eine Quelle, die nicht kam, oder eine fehlende Migration.
     */
    const laeuft = (schritt: PipelineStep): boolean => kategorieSchritte === null || kategorieSchritte.has(schritt.id);
    /** Läuft diese Prüfung in diesem Zug? Dieselbe Regel, mit dem npm-Namen des Prüfers. */
    const pruefe = (name: string): boolean => kategoriePruefungen === null || kategoriePruefungen.has(name);
    /** Der Rechenbereich aus I11, den I13 braucht; `undefined`, solange I11 nicht gelaufen ist. */
    let terrainScope: Awaited<ReturnType<typeof deriveTerrain>>["scope"] | undefined;
    /** I17/I18 setzen sie, V12/V13 lesen sie: ohne ihren Schritt bleibt die Prüfung aus. */
    let detailsReady = false;
    let sourcesReady = false;
    let sourcesWikisync = false;
    /**
     * Die Detailschritte I20 bis I28 melden hier, ob sie gelaufen sind; ihre Prüfer (V14 und weiter) stehen weiter unten und
     * lesen es. Ein Zug je Kategorie (WI-0141) lässt die ganze Gruppe aus, dann bleibt jede Marke `false`.
     */
    let literatureRan = false;
    let citymapsRan = false;
    let reviewsRan = false;
    let territoryDetailsRan = false;
    let wikiLinksRan = false;
    let loreRan = false;
    let mediaRan = false;
    let mediaSource: unknown = null;
    let staettenRan = false;
    let staettenV2Ran = false;
    let wikiSettlementsRan = false;

    // I1 Orte
    const featuresPayload = features as unknown as { features?: unknown[] };
    const placesPayload = Array.isArray(featuresPayload.features)
        ? locationsFromMapFeatures(featuresPayload as never)
        : (features as never);
    const scope: ImportScope = {
        bounds: AVENTURIA.coordinateSpace.bounds,
        subtypes: [...PLACE_SUBTYPES],
    };
    if (laeuft(step("I1"))) {
        const placesReport = await importPlaces(database, placesPayload, scope);
        record(
            step("I1").id,
            step("I1").label,
            true,
            summarizePhase("Orte", placesReport),
            placesReport.created + placesReport.updated + placesReport.retired > 0,
            placesReport.findings,
        );
    }

    if (laeuft(step("I2"))) {
        // I2 Regionen
        const regionsReport = await importRegions(database, regions as never, areas as never, features as never);
        const regionsChanged =
            regionsReport.regions.created + regionsReport.regions.updated + regionsReport.regions.retired > 0;
        record(
            step("I2").id,
            step("I2").label,
            true,
            `Regionen ${String(regionsReport.regions.created)}/${String(regionsReport.regions.updated)}/${String(regionsReport.regions.retired)}, ` +
                `Flaechen ${String(regionsReport.areas.created)}/${String(regionsReport.areas.updated)}/${String(regionsReport.areas.retired)}, ` +
                `Labels ${String(regionsReport.labels.created)}/${String(regionsReport.labels.updated)}/${String(regionsReport.labels.retired)} ` +
                `(neu/geaendert/stillgelegt); ${String(regionsReport.primaryLabelFromReverse.length)} ueber Rueckwaertszeiger aufgeloest`,
            regionsChanged,
            regionsReport.findings,
        );
    }

    if (laeuft(step("I16"))) {
        // I16 Darstellungstafel der Landschaften (WI-0064): fuenfte Quelle. Vor den Schriftlaeufen (I3), weil deren Baender und
        // Groessen auf sie zurueckfallen, wo ein Label keinen eigenen Wert traegt (map_label_effective).
        const landscapeDisplayReport = await importLandscapeDisplay(database, display);
        record(
            step("I16").id,
            step("I16").label,
            true,
            summarizeLandscapeDisplay(landscapeDisplayReport),
            landscapeDisplayReport.changed,
        );
    }

    if (laeuft(step("I3"))) {
        // I3 Schriftlaeufe
        const runsReport = await deriveAll(database, { all: false });
        record(
            step("I3").id,
            step("I3").label,
            true,
            `${String(runsReport.written.length)} geschrieben, ${String(runsReport.unchanged)} unveraendert, ${String(runsReport.removed.length)} weggeraeumt`,
            runsReport.written.length + runsReport.removed.length > 0,
        );
    }

    if (laeuft(step("I4"))) {
        // I4 Klima
        const bands = readLegacyBands(areas);
        const places = readLegacyPlaceZones(features);
        const dividers = await reconstructDividers(database, bands);
        const lossless = await verifyReconstruction(database, bands, dividers);
        // 🔴 Betreiber 2026-10-03 („B“): Die Verlustfreiheit der Rekonstruktion und die Klima-Pruefungen halten den Zug nicht
        // mehr an; sie stehen als Befunde mit Zahlen und Zonen im Log und im Bericht.
        const losslessProblem = losslessFinding(lossless);
        const climateResult = await importClimate(database, bands);
        const climateVerify = await verifyClimate(database, bands, places);
        record(
            step("I4").id,
            step("I4").label,
            climateVerify.passed,
            `${String(climateResult.dividers)} Linien, ${String(climateResult.bands)} Baender, ${climateResult.written ? "geschrieben" : "unveraendert"}` +
                (climateVerify.passed ? "" : ` -- GESCHEITERT: ${blockingNames(climateVerify.checks)}`),
            climateResult.written,
            [
                ...(losslessProblem ? [losslessProblem] : []),
                ...checkFindings("verify:climate", climateVerify.checks, passedOf),
            ],
        );
    }

    if (laeuft(step("I5"))) {
        // I5 Wege
        const pathsReport = await importPaths(database, features as never);
        record(
            step("I5").id,
            step("I5").label,
            true,
            `${summarizePhase("Wege", pathsReport)}; ${String(pathsReport.crossingsIgnored)} Legacy-Kreuzungen gezählt, nicht übernommen (WI-0132)`,
            pathsReport.created + pathsReport.updated + pathsReport.retired > 0,
            pathsReport.findings,
        );
    }

    if (laeuft(step("I6"))) {
        // I6 Wegkurve (MUSS vor Wegnamen laufen, Contract paths.yaml)
        const visualReport = await derivePathVisuals(database, mapDomainId);
        record(
            step("I6").id,
            step("I6").label,
            true,
            `${String(visualReport.geschrieben)} geschrieben, ${String(visualReport.unveraendert)} unveraendert`,
            visualReport.geschrieben > 0,
        );
    }

    if (laeuft(step("I7"))) {
        // I7 Wegnamen-Schriftlaeufe. `derivePathRuns` loescht und rechnet jeden Lauf komplett neu - es hat
        // kein eigenes "unveraendert" wie path-visuals/derive:runs. Wie staging-import.sh (`idempotence()`,
        // "Wegnamen-Schriftlaeufe, zweiter Lauf"): "geaendert" heisst, die Zahlen weichen vom letzten Lauf
        // ab, nicht "true" auf gut Glueck (Hardening Review M5, Fund: I7 meldete bisher immer geaendert).
        const pathRunsReport = await derivePathRuns(database, mapDomainId);
        const pathRunsSummary = `Ketten ${String(pathRunsReport.chains)}, Teilstuecke ${String(pathRunsReport.parts)}, Laeufe ${String(pathRunsReport.runs)}`;
        const previousPathRuns = previousRun?.find((outcome) => outcome.id === "I7");
        record(
            step("I7").id,
            step("I7").label,
            true,
            pathRunsSummary,
            pathRunsChanged(pathRunsSummary, previousPathRuns?.summary),
        );
    }

    if (kategorieSchritte?.has("derive:path-profiles") === true) {
        // Wegprofile nach einem Wege-Zug (WI-0141, `config/legacy-zug-kategorien.json` → `wege.schritte`). Der Schritt hat bewusst
        // keine I-Nummer: Der ganze Zug rechnet die Profile in I11 mit. Ohne diesen Zweig liefe der Wege-Zug hier lokal ohne sie,
        // waehrend Claudios `kategorie-import.sh` sie nach I7 rechnet (Nachpruefung 2026-10-14 §1). Dieselbe Funktion wie
        // `derive:path-profiles`; ohne geltenden Hoehenmaster gibt es nichts zu rechnen.
        const source = await loadPublishedDomainSource(database, mapDomainId);
        if (source === null) {
            record("derive:path-profiles", "Wegprofile", true, "kein geltender Hoehenmaster, nichts zu rechnen", false);
        } else {
            const profiles = await derivePathProfiles(
                database,
                mapDomainId,
                { domain: source, rasters: [], peaks: [], rule: DEFAULT_CONE },
                AVENTURIA_TRAVEL_MODEL,
            );
            record(
                "derive:path-profiles",
                "Wegprofile",
                true,
                `Wege ${String(profiles.paths)}, gerechnet ${String(profiles.computed)}, unveraendert ${String(profiles.unchanged)}, entfernt ${String(profiles.removed)}`,
                profiles.computed > 0 || profiles.removed > 0,
            );
        }
    }

    if (laeuft(step("I8"))) {
        // I8 Kraftlinien: Reihenfolge ist Konvention (siehe Kopfkommentar), keine fachliche Abhaengigkeit auf
        // I5. Erst ein Probelauf mit dem frueheren Tor "stillgelegt 0" (wie staging-import.sh I8), dann der echte Lauf.
        // 🔴 Betreiber 2026-10-03: Das Tor haelt den Zug nicht mehr an. Der Probelauf meldet, was er stilllegen wuerde
        // (Zahlen, Kraftlinien und Kraftlinienpunkte mit Namen), und der echte Lauf folgt.
        const powerlinesProbe = await importPowerlines(database, features as never, { dryRun: true });
        line(
            `   Kraftlinien-Probelauf: wuerde anlegen ${String(powerlinesProbe.created)}, unveraendert ${String(powerlinesProbe.unchanged)}, stilllegen ${String(powerlinesProbe.retired)}; ` +
                `Kraftlinienpunkte anlegen ${String(powerlinesProbe.nodices.created)}, unveraendert ${String(powerlinesProbe.nodices.unchanged)}, stilllegen ${String(powerlinesProbe.nodices.retired)}`,
        );
        const probeFinding = powerlineProbeFinding(powerlinesProbe);
        const probeFindings: Finding[] = probeFinding ? [probeFinding] : [];
        const powerlinesReport = await importPowerlines(database, features as never);
        record(
            step("I8").id,
            step("I8").label,
            true,
            summarizePhase("Kraftlinien", powerlinesReport),
            powerlinesReport.created + powerlinesReport.updated + powerlinesReport.retired > 0,
            [...probeFindings, ...powerlinesReport.findings],
        );
    }

    if (laeuft(step("I9"))) {
        // I9 Seegraph. Die Häfen ohne Wasser-Zugang stehen als Befund im Log und als eigener Abschnitt im Bericht (WI-0060).
        const seaReport = await deriveSeaRoutes(database, mapDomainId, AVENTURIA_TRAVEL_MODEL, {});
        const landlessFinding = landlessPortsFinding(seaReport.withoutLanding, landlessSettings(seaReport));
        record(
            step("I9").id,
            step("I9").label,
            true,
            `${seaReport.written ? "geschrieben" : "unveraendert"}, ${String(seaReport.ports)} Haefen, ${String(seaReport.withoutLanding.length)} ohne Wasser-Zugang, ${String(seaReport.nodes)} Knoten, ${String(seaReport.edges)} Kanten`,
            seaReport.written,
            landlessFinding ? [landlessFinding] : [],
            landlessPortsSection(seaReport.withoutLanding, seaReport.ports, landlessSettings(seaReport)),
        );
    }

    if (laeuft(step("I10"))) {
        // I10 Gelaende-Eingaben
        const terrainSources = readTerrainSources(areas as never, features as never);
        const terrainImportReport = await importTerrain(database, terrainSources);
        const terrainVerify = await verifyTerrain(database, terrainSources, mapDomainId);
        record(
            step("I10").id,
            step("I10").label,
            terrainVerify.passed,
            `Gebirge ${String(terrainImportReport.controls.created)}/${String(terrainImportReport.controls.updated)}/${String(terrainImportReport.controls.retired)}, ` +
                `Gipfel ${String(terrainImportReport.peaks.created)}/${String(terrainImportReport.peaks.updated)}/${String(terrainImportReport.peaks.retired)}` +
                (terrainVerify.passed ? "" : ` -- GESCHEITERT: ${blockingNames(terrainVerify.checks)}`),
            terrainImportReport.controls.created +
                terrainImportReport.controls.updated +
                terrainImportReport.controls.retired >
                0 ||
                terrainImportReport.peaks.created +
                    terrainImportReport.peaks.updated +
                    terrainImportReport.peaks.retired >
                    0,
            terrainImportReport.findings,
        );
    }

    if (laeuft(step("I11"))) {
        // I11 Gelaende ableiten. onlyCurrent: true, weil legacy:update nur lokal laeuft (Betreiber: "ohne
        // Ballast" - lokal bleibt nur die aktuelle Revision, die 1-Tag-Gnadenfrist aus ADR-0008 ist eine
        // Stage-Regel).
        const terrainDeriveReport = await deriveTerrain(database, { onlyCurrent: true });
        terrainScope = terrainDeriveReport.scope;
        const terrainDemVerify = await verifyTerrainDem(database, mapDomainId);
        // Hardening Review M5, Fund: bisher zaehlte nur terrainDemVerify.passed - ein einzelnes Gebirge, dessen
        // Worker-Job wirft (report.failed), fiel sonst nicht auf, wenn die uebrigen Invarianten weiter halten.
        record(
            step("I11").id,
            step("I11").label,
            terrainDeriveOk(terrainDeriveReport.failed.length, terrainDemVerify.passed),
            `${String(terrainDeriveReport.tiles)} Kacheln, Revision ${terrainDeriveReport.revision} (neu: ${String(terrainDeriveReport.revisionChanged)}), ${String(terrainDeriveReport.computed)} gerechnet, Wegprofile ${String(terrainDeriveReport.profiles.computed)} gerechnet` +
                (terrainDeriveReport.failed.length === 0
                    ? ""
                    : ` -- FEHLGESCHLAGENE GEBIRGE: ${terrainDeriveReport.failed.map((f) => `${f.name} (${f.error})`).join(", ")}`) +
                (terrainDemVerify.passed ? "" : ` -- GESCHEITERT: ${blockingNames(terrainDemVerify.checks)}`),
            terrainDeriveChanged(terrainDeriveReport),
            // Betreiber 2026-10-03: Seen eben, Gipfel exakt, Meer 0, Flüsse nicht bergauf halten die Ableitung nicht an.
            terrainDeriveReport.domain?.constraints.findings ?? [],
        );
    }

    if (laeuft(step("I12"))) {
        // I12 independently verifies the single domain height product; no separate relief derivation.
        const domainVerify = await verifyCurrentDomain(database, mapDomainId);
        record(
            step("I12").id,
            step("I12").label,
            domainVerify.passed,
            domainVerify.checks.map((check) => check.name + ": " + check.detail).join("; "),
            false,
            checkFindings("verify:domain-terrain", domainVerify.checks, (check) => check.passed),
        );
    }

    if (laeuft(step("I13")) && terrainScope !== undefined) {
        // I13 Anzeigehöhen ableiten (WI-0055, ADR-0012), onlyCurrent wie I11/I12. Nur Darstellung (Kapitel 5.32a);
        // läuft nach dem Relief, an dessen Revision die Linien gebunden sind.
        const displayReport = await deriveDisplayHeights(database, { onlyCurrent: true, scope: terrainScope });
        const displayVerify = await verifyDisplayHeights(database, mapDomainId);
        record(
            step("I13").id,
            step("I13").label,
            displayVerify.passed,
            `${String(displayReport.contours)} Linien, Revision ${displayReport.revision} (neu: ${String(displayReport.revisionChanged)}), gerechnet: ${String(displayReport.computed)}` +
                (displayVerify.passed ? "" : ` -- GESCHEITERT: ${blockingNames(displayVerify.checks)}`),
            displayHeightsChanged(displayReport),
            checkFindings("verify:display-heights", displayVerify.checks, (check) => check.passed),
        );
    }

    if (laeuft(step("I14")) && territories !== null) {
        // I14 Herrschaftsgebiete (WI-0062, ADR-0014): die vierte Quelle. Ganz am Ende, weil nichts sonst von ihnen abhaengt;
        // Hauptstadt und Sitz sind Verweise auf Orte ohne Fremdschluessel (haengende Verweise sind ein Befund des Pruefers).
        const territoriesReport = await importTerritories(database, territories, { sourceEtag: territoriesEtag });
        record(
            step("I14").id,
            step("I14").label,
            true,
            `Gebiete ${String(territoriesReport.territories.created)}/${String(territoriesReport.territories.updated)}/${String(territoriesReport.territories.retired)}, ` +
                `Flaechen ${String(territoriesReport.areas.created)}/${String(territoriesReport.areas.updated)}/${String(territoriesReport.areas.retired)}, ` +
                `Anspruechen ${String(territoriesReport.claims.created)}/${String(territoriesReport.claims.updated)}/${String(territoriesReport.claims.retired)} ` +
                `(neu/geaendert/stillgelegt), Eltern ${String(territoriesReport.parentsChanged)} gesetzt; ` +
                `${String(territoriesReport.droppedPolygons)} entartete Polygone in ${String(territoriesReport.areasWithDroppedParts)} Flaechen ausgelassen`,
            territoriesReport.changed,
            territoriesReport.findings,
        );
    }

    if (laeuft(step("I15")) && territories !== null) {
        // I15 Gebietsflaechen ableiten: rechnet nur bei geaenderten Eingaben (Revision).
        const territoryShapes = await deriveTerritories(database);
        record(
            step("I15").id,
            step("I15").label,
            true,
            `Revision ${territoryShapes.revision} (neu: ${String(territoryShapes.revisionChanged)}), ` +
                `${territoryShapes.computed ? "gerechnet" : "unveraendert"}, ` +
                `${String(territoryShapes.bands.reduce((sum, band) => sum + band.shapes, 0))} Formen, ` +
                `${String(territoryShapes.capitals)} Hauptstaedte`,
            territoryShapes.computed,
        );
    }

    // Die Detailschritte I17, I18 und I20 bis I26 gehören keiner Kategorie: Ein Zug je Kategorie lässt sie ganz aus
    // (WI-0141); I27 und I28 fahren mit den Orten (WI-0199, weiter unten). Ohne Kategorie liegt auch die Gebietsdatei vor — das
    // `territories !== null` ist die Zusicherung dafür.
    if (kategorie === null && territories !== null) {
        // I17 Detailfelder und Wiki-Zuordnung (WI-0063 P3, D6) und I18 Quellen und Kanon (D1): dieselbe map-features.json, nach den
        // Traegern und den Herrschaftsgebieten. Fehlt die Migration (0065 beziehungsweise 0066), uebersteht der Schritt mit einem
        // Befund statt den Zug anzuhalten: eine fehlende Tabelle ist kein Quellenfehler.
        detailsReady = await tableExists(database, "place_wiki_assignment");
        if (detailsReady) {
            const detailsReport = await importSubjectDetails(database, features);
            const detailsSummary = SUBJECT_DETAIL_TABLES.map((name) => {
                const table = detailsReport.tables[name];
                return `${name} ${String(table.created)}/${String(table.updated)}/${String(table.retired)}`;
            }).join(", ");
            record(
                step("I17").id,
                step("I17").label,
                true,
                `${detailsSummary} (neu/geaendert/stillgelegt)`,
                detailsReport.changed,
                detailsReport.findings,
            );
        } else {
            record(
                step("I17").id,
                step("I17").label,
                true,
                "uebersprungen: Migration 0065_subject_details fehlt",
                false,
                [migrationMissingFinding("0065_subject_details")],
            );
        }
        sourcesReady = await tableExists(database, "place_source");
        if (sourcesReady) {
            const sourcesReport = await importSources(database, features);
            sourcesWikisync = sourcesReport.findings.some((finding) => finding.code === "bereich_wikisync");
            const sourcesSummary = sourcesReport.skipped
                ? sourcesWikisync
                    ? "uebersprungen: die Quellen gehoeren in dieser Umgebung dem WikiSync, nichts geschrieben"
                    : "uebersprungen: Quellenbloecke fehlen oder Katalog leer, nichts geschrieben"
                : SOURCE_TABLES.map((name) => {
                      const table = sourcesReport.tables[name];
                      return `${name} ${String(table.created)}/${String(table.updated)}/${String(table.retired)}`;
                  }).join(", ") +
                  ` (neu/geaendert/stillgelegt); Tombstones ${String(sourcesReport.tombstones.created)}/${String(sourcesReport.tombstones.updated)}`;
            record(
                step("I18").id,
                step("I18").label,
                true,
                sourcesSummary,
                sourcesReport.changed,
                sourcesReport.findings,
            );
        } else {
            record(step("I18").id, step("I18").label, true, "uebersprungen: Migration 0066_sources fehlt", false, [
                migrationMissingFinding("0066_sources"),
            ]);
        }
    }

    if (laeuft(step("I19"))) {
        // I19 Flaechen glaetten (WI-0055, WI-0077, Migrationen 0067 und 0072): alle Flaechen in einem Netz, dazu die Klimabaender;
        // rechnet nur bei geaenderten Eingaben, bei wenigen nur sie und ihre Nachbarn. Nur Darstellung; ein Rueckfall (Flaeche
        // behaelt ihre Ausgangsform) ist ein Befund, kein Abbruch. Fehlt die Migration, uebersteht der Schritt mit einem Befund,
        // wie I17 und I18.
        if (await tableExists(database, "region_area_smooth")) {
            const landSmooth = await deriveLandSmooth(database);
            record(
                step("I19").id,
                step("I19").label,
                true,
                `${landSmooth.computed ? `gerechnet (${landSmooth.mode})` : "unveraendert"}, ${String(landSmooth.smoothed)} von ${String(landSmooth.areas)} Flaechen geglaettet` +
                    (landSmooth.computed
                        ? `, ${String(landSmooth.sharedEdges)} gemeinsame Kanten von ${String(landSmooth.edges)} je einmal`
                        : "") +
                    (landSmooth.climate
                        ? `; Klima ${landSmooth.climate.computed ? "gerechnet" : "unveraendert"}, ${String(landSmooth.climate.smoothed)} von ${String(landSmooth.climate.bands)} Baendern`
                        : ""),
                landSmooth.computed || landSmooth.climate?.computed === true,
                landSmoothFindings(landSmooth),
            );
        } else {
            record(
                step("I19").id,
                step("I19").label,
                true,
                "uebersprungen: Migration 0067_region_area_smooth fehlt",
                false,
                [migrationMissingFinding("0067_region_area_smooth")],
            );
        }
    }

    if (kategorie === null && territories !== null) {
        // I20 Spielliteratur (WI-0063 P3, D3) und I21 Kartensammlung (D2): die Antworten der oeffentlichen Kataloge (EIN Abruf je Zug, nur
        // mit dem Zuruf des Betreibers, in `main` geholt). Die Ortsbezuege loesen gegen die Traeger auf (Orte, Gebiete, Landschaften, Wege)
        // und ueber die Wiki-Zuordnung aus I17; I21 nimmt die Quellen aus I18 und die `map-features.json` desselben Zuges. Faellt der Abruf aus,
        // ist die Antwort leer oder abgeschaltet oder fehlt die Migration, entfaellt nur der Schritt, mit Befund (kein Tor).
        if (await tableExists(database, "adventure")) {
            const catalog = catalogs.literature;
            if (catalog === null || catalog.payload === null) {
                record(
                    step("I20").id,
                    step("I20").label,
                    true,
                    "uebersprungen: kein Katalog geholt, nichts geschrieben, nichts stillgelegt",
                    false,
                    catalog?.findings ?? [catalogNotFetchedFinding("game-literature.json")],
                );
            } else {
                const report = await importLiterature(database, catalog.payload);
                literatureRan = !report.skipped;
                record(
                    step("I20").id,
                    step("I20").label,
                    true,
                    report.skipped
                        ? report.findings.some((finding) => finding.code === "bereich_wikisync")
                            ? "uebersprungen: die Literatur gehoert in dieser Umgebung dem WikiSync, nichts geschrieben"
                            : "uebersprungen: Antwort unbrauchbar, leer oder abgeschaltet, nichts geschrieben"
                        : LITERATURE_TABLES.map((name) => {
                              const table = report.tables[name];
                              return `${name} ${String(table.created)}/${String(table.updated)}/${String(table.retired)}`;
                          }).join(", ") +
                              ` (neu/geaendert/stillgelegt); Orte: ${String(report.resolution.resolved)} aufgeloest, ${String(report.resolution.unresolved)} ohne Ziel, ${String(report.resolution.unmatched)} nicht gefunden`,
                    report.changed,
                    [...catalog.findings, ...report.findings],
                );
            }
        } else {
            record(step("I20").id, step("I20").label, true, "uebersprungen: Migration 0068_literature fehlt", false, [
                migrationMissingFinding("0068_literature"),
            ]);
        }
        if (await tableExists(database, "citymap")) {
            const catalog = catalogs.citymaps;
            if (catalog === null || catalog.payload === null) {
                record(
                    step("I21").id,
                    step("I21").label,
                    true,
                    "uebersprungen: kein Katalog geholt, nichts geschrieben, nichts stillgelegt",
                    false,
                    catalog?.findings ?? [catalogNotFetchedFinding("citymaps.json")],
                );
            } else {
                const report = await importCitymaps(database, catalog.payload, { features });
                citymapsRan = !report.skipped;
                record(
                    step("I21").id,
                    step("I21").label,
                    true,
                    report.skipped
                        ? "uebersprungen: Antwort unbrauchbar, leer oder abgeschaltet, nichts geschrieben"
                        : CITYMAP_TABLES.map((name) => {
                              const table = report.tables[name];
                              return `${name} ${String(table.created)}/${String(table.updated)}/${String(table.retired)}`;
                          }).join(", ") +
                              ` (neu/geaendert/stillgelegt); Orte: ${String(report.resolution.resolved)} aufgeloest, ${String(report.resolution.unresolved)} ohne Ziel, ${String(report.resolution.unmatched)} nicht gefunden; Quellen ${report.sourcesPart}`,
                    report.changed,
                    [...catalog.findings, ...report.findings],
                );
            }
        } else {
            record(step("I21").id, step("I21").label, true, "uebersprungen: Migration 0069_citymaps fehlt", false, [
                migrationMissingFinding("0069_citymaps"),
            ]);
        }

        // I22 Bewertungen (WI-0063 P3, D4, Export E3): die Antwort von `location-reviews-export.php` (EIN Abruf je Zug, nur mit dem Zuruf des
        // Betreibers, in `main` geholt). Der Ortsbezug loest gegen aktive `place`-Zeilen aus I1 auf; was Legacy nicht mehr als sichtbar nennt,
        // wird geloescht (Datenschutz). Faellt der Abruf aus, ist die Antwort unbrauchbar, widerspruechlich oder leer ohne Beleg oder fehlt
        // die Migration, entfaellt nur der Schritt, mit Befund (kein Tor). I23 Gebietsdetails (E4) liest DIESELBE Gebietsdatei wie I14, kein
        // zweiter Abruf; der Wappenzustand wird nur durchgerechnet, geschrieben wird er vom Medienimport.
        if (await tableExists(database, "place_review")) {
            const catalog = catalogs.reviews;
            if (catalog === null || catalog.payload === null) {
                record(
                    step("I22").id,
                    step("I22").label,
                    true,
                    "uebersprungen: keine Antwort geholt, nichts geschrieben, nichts geloescht",
                    false,
                    catalog?.findings ?? [catalogNotFetchedFinding("location-reviews.json")],
                );
            } else {
                const report = await importReviews(database, catalog.payload);
                reviewsRan = !report.skipped;
                record(step("I22").id, step("I22").label, true, summarizeReviews(report), report.changed, [
                    ...catalog.findings,
                    ...report.findings,
                ]);
            }
        } else {
            record(step("I22").id, step("I22").label, true, "uebersprungen: Migration 0075_place_review fehlt", false, [
                migrationMissingFinding("0075_place_review"),
            ]);
        }
        if (await tableExists(database, "territory_detail")) {
            const report = await importTerritoryDetails(database, territories);
            territoryDetailsRan = !report.skipped;
            record(
                step("I23").id,
                step("I23").label,
                true,
                summarizeTerritoryDetails(report),
                report.changed,
                report.findings,
            );
        } else {
            record(
                step("I23").id,
                step("I23").label,
                true,
                "uebersprungen: Migration 0076_territory_detail fehlt",
                false,
                [migrationMissingFinding("0076_territory_detail")],
            );
        }

        // I24 Wiki-Linkziele (X1) und Wiki-Zuordnung (X2) (WI-0063 27.12): EIN Abruf je Endpunkt, nur mit dem Zuruf des Betreibers, in `main` geholt.
        // Der Import schreibt nur seine drei Tabellen und loest nichts gegen Traeger auf (der Leser tut es zur Laufzeit ueber den Wiki-Key). Faellt ein
        // Abruf aus oder ist eine Antwort leer, entfaellt nur dieser Teil, mit Befund (kein Tor).
        if (await tableExists(database, "wiki_key_assignment")) {
            const linkziele = catalogs.wikiLinkziele;
            const zuordnung = catalogs.wikiZuordnung;
            if (linkziele === null && zuordnung === null) {
                record(
                    step("I24").id,
                    step("I24").label,
                    true,
                    "uebersprungen: kein Abruf geholt, nichts geschrieben, nichts stillgelegt",
                    false,
                    [
                        catalogNotFetchedFinding("wiki-zuordnung-export.php"),
                        catalogNotFetchedFinding("wiki-linkziele-export.php"),
                    ],
                );
            } else {
                const report = await importWikiLinkTargets(database, {
                    linkziele: linkziele?.payload ?? null,
                    zuordnung: zuordnung?.payload ?? null,
                });
                wikiLinksRan = !(report.skipped.linkziele && report.skipped.zuordnung);
                record(
                    step("I24").id,
                    step("I24").label,
                    true,
                    wikiLinksRan
                        ? WIKI_LINK_TABLES.map((name) => {
                              const table = report.tables[name];
                              return `${name} ${String(table.created)}/${String(table.updated)}/${String(table.retired)}`;
                          }).join(", ") +
                              ` (neu/geaendert/stillgelegt); ${String(report.stats.assignments)} zugewiesene Objekte, ${String(report.stats.distinctKeys)} Keys, ${String(report.stats.pages)} Artikel, ${String(report.stats.links)} Links` +
                              (report.skipped.zuordnung ? "; Zuordnung (X2) entfaellt" : "") +
                              (report.skipped.linkziele ? "; Linkziele (X1) entfallen" : "")
                        : "uebersprungen: beide Antworten fehlen, unbrauchbar oder leer, nichts geschrieben",
                    report.changed,
                    [...(zuordnung?.findings ?? []), ...(linkziele?.findings ?? []), ...report.findings],
                );
            }
        } else {
            record(
                step("I24").id,
                step("I24").label,
                true,
                "uebersprungen: Migration 0073_wiki_link_targets fehlt",
                false,
                [migrationMissingFinding("0073_wiki_link_targets")],
            );
        }

        // I25 Lore und Vorkommen (WI-0063 P3, D5): die Antwort des Voll-Exports (EIN Abruf je Zug, nur mit dem Zuruf des Betreibers, in `main`
        // geholt). Die Ortszeilen loesen ueber DENSELBEN Lookup nach Wiki-Key auf wie die Objektlinks (Zuordnung X2 aus I24, nie ueber einen Namen),
        // die Quellen ueber den Katalog aus I18. Faellt der Abruf aus, ist die Antwort unbrauchbar, leer, abgeschaltet oder passen ihre Kopfzaehler
        // nicht, oder fehlt die Migration, entfaellt nur der Schritt, mit Befund (kein Tor).
        if (await tableExists(database, "lore_entry")) {
            const catalog = catalogs.lore;
            if (catalog === null || catalog.payload === null) {
                record(
                    step("I25").id,
                    step("I25").label,
                    true,
                    "uebersprungen: kein Katalog geholt, nichts geschrieben, nichts stillgelegt",
                    false,
                    catalog?.findings ?? [catalogNotFetchedFinding("lore-export.json")],
                );
            } else {
                const report = await importLore(database, catalog.payload, { mapRevision: features.revision });
                loreRan = !report.skipped;
                const places = report.resolution.places;
                record(
                    step("I25").id,
                    step("I25").label,
                    true,
                    report.skipped
                        ? report.findings.some((finding) => finding.code === "bereich_wikisync")
                            ? "uebersprungen: die Vorkommen gehoeren in dieser Umgebung dem WikiSync, nichts geschrieben"
                            : "uebersprungen: Antwort unbrauchbar, leer, abgeschaltet oder Kopfzaehler widersprechen, nichts geschrieben"
                        : LORE_TABLES.map((name) => {
                              const table = report.tables[name];
                              return `${name} ${String(table.created)}/${String(table.updated)}/${String(table.retired)}`;
                          }).join(", ") +
                              ` (neu/geaendert/stillgelegt); Ortszeilen: ${String(places.resolved)} aufgeloest, ${String(places.ambiguous)} mehrdeutig, ${String(places.unresolved)} Kontinentbegriffe, ${String(places.unmatched)} nicht gefunden`,
                    report.changed,
                    [...catalog.findings, ...report.findings],
                );
            }
        } else {
            record(step("I25").id, step("I25").label, true, "uebersprungen: Migration 0074_lore fehlt", false, [
                migrationMissingFinding("0074_lore"),
            ]);
        }

        // I26 Medien (WI-0063 MEDIA-M8, Export E5): NUR Metadaten (Assets, Rechte, Galerien, Bindungen, Unterdrueckungen, Freigaberegeln mit
        // Betreiberzitat), nie ein Byte. Quelle ist das private Manifest B, wenn der Betreiber die Datei gibt (dann zieht der Schritt auch
        // zurueck, was Legacy nicht mehr nennt), sonst das oeffentliche A (zieht nie zurueck). Er steht NACH den Orten (I1), den Gebieten
        // (I14), den Werken (I20) und den Karten (I21): die Bindungen loesen ueber die Legacy-Kennung auf. Faellt der Abruf aus, ist das
        // Manifest unbrauchbar oder leer oder fehlt die Migration, entfaellt nur der Schritt, mit Befund (kein Tor).
        if (await tableExists(database, "media_legacy_source")) {
            const publicCatalog = catalogs.media;
            const privateCatalog = catalogs.mediaPrivate;
            mediaSource = privateCatalog?.payload ?? publicCatalog?.payload ?? null;
            if (mediaSource === null) {
                record(
                    step("I26").id,
                    step("I26").label,
                    true,
                    "uebersprungen: kein Manifest geholt, nichts geschrieben, nichts zurueckgezogen",
                    false,
                    publicCatalog?.findings ?? [catalogNotFetchedFinding("media-export.json")],
                );
            } else {
                const report = await importMedia(database, mediaSource, {
                    publicPayload: privateCatalog?.payload != null ? (publicCatalog?.payload ?? undefined) : undefined,
                });
                mediaRan = !report.skipped;
                record(step("I26").id, step("I26").label, true, summarizeMedia(report), report.changed, [
                    ...(publicCatalog?.findings ?? []),
                    ...(privateCatalog?.findings ?? []),
                    ...report.findings,
                ]);
            }
        } else {
            record(
                step("I26").id,
                step("I26").label,
                true,
                "uebersprungen: Migration 0077_media_legacy_source fehlt",
                false,
                [migrationMissingFinding("0077_media_legacy_source")],
            );
        }
    }

    // I27 und I28 fahren seit dem 2026-10-16 auch im Zug der Orte (Betreiber „A ja“, WI-0199; `config/legacy-zug-kategorien.json`).
    // Sie brauchen nur die `map-features.json` und X2 bis X4 aus `main`, keine Gebietsdatei.
    if (laeuft(step("I27"))) {
        // I27 Staetten der Orte (WI-0109, D7): der Block `in_settlement_places` DERSELBEN `map-features.json` wie I1 - kein zweiter
        // Abruf. Der Schritt steht nach den Orten (I1), weil er die Aufloesung der Siedlungsnamen gegen deren Namen MELDET; eine
        // Spalte darauf gibt es nicht (Legacys Export traegt keine Kennung der Siedlung). Fehlt der Block oder ist er leer (Legacys
        // Erzeuger ist fail-open) oder fehlt die Migration, entfaellt nur der Schritt, mit Befund (kein Tor).
        // WI-0134: davor die Staetten ueber Kennungen aus X4 (EIN Abruf je Zug, in `main` geholt); ohne X4 oder ohne Migration 0099 bleibt
        // es beim bisherigen Teil, mit Befund (kein Tor). Eine Quelle, die der Kopf von X4 als ausgefallen meldet, legt nichts still.
        if (await tableExists(database, "settlement_place")) {
            const v2Findings: Finding[] = [];
            let v2Summary = "";
            let v2Changed = false;
            const rohquellen = catalogs.staettenRohquellen;
            if (!(await tableExists(database, "site"))) {
                v2Findings.push(migrationMissingFinding("0099_site_identities"));
            } else if (rohquellen === null || rohquellen.payload === null) {
                v2Findings.push(
                    ...(rohquellen?.findings ?? []),
                    onlyNamesFinding(rohquellen === null ? "nicht geholt" : "Abruf gescheitert"),
                );
            } else {
                const v2 = await importStaettenRohquellen(database, rohquellen.payload, {
                    sameTrain: {
                        "Wiki-Zuordnung": catalogs.wikiZuordnung?.payload,
                        "Wiki-Siedlungen": catalogs.wikiSiedlungen?.payload,
                    },
                });
                staettenV2Ran = !v2.skipped;
                v2Summary = `${summarizeStaettenRohquellen(v2)}; `;
                v2Changed = v2.changed;
                v2Findings.push(...rohquellen.findings, ...v2.findings);
            }
            const report = await importStaetten(database, features);
            staettenRan = !report.skipped || staettenV2Ran;
            record(
                step("I27").id,
                step("I27").label,
                true,
                `${v2Summary}${summarizeStaetten(report)}`,
                report.changed || v2Changed,
                [...v2Findings, ...report.findings],
            );
        } else {
            record(
                step("I27").id,
                step("I27").label,
                true,
                "uebersprungen: Migration 0078_settlement_place fehlt",
                false,
                [migrationMissingFinding("0078_settlement_place")],
            );
        }
    }

    if (laeuft(step("I28"))) {
        // I28 Wiki-Siedlungsregistry (WI-0128 E4, X3): EIN Abruf je Zug, nur mit dem Zuruf des Betreibers, in `main` geholt. Der Import schreibt nur
        // seine Tabelle und bindet nichts an einen Ort (der Leser fragt ueber den Key gegen X2); X2 desselben Zuges dient nur dem Abgleich der Staende.
        // Faellt der Abruf aus, ist die Antwort unbrauchbar oder leer oder fehlt die Migration, entfaellt nur der Schritt, mit Befund (kein Tor).
        if (await tableExists(database, "wiki_settlement_registry")) {
            const catalog = catalogs.wikiSiedlungen;
            if (catalog === null || catalog.payload === null) {
                record(
                    step("I28").id,
                    step("I28").label,
                    true,
                    "uebersprungen: keine Antwort geholt, nichts geschrieben, nichts stillgelegt",
                    false,
                    catalog?.findings ?? [catalogNotFetchedFinding("legacy-wiki-siedlungen.json")],
                );
            } else {
                const report = await importWikiSettlements(database, catalog.payload, {
                    zuordnung: catalogs.wikiZuordnung?.payload ?? undefined,
                });
                wikiSettlementsRan = !report.skipped;
                record(step("I28").id, step("I28").label, true, summarizeWikiSettlements(report), report.changed, [
                    ...catalog.findings,
                    ...report.findings,
                ]);
            }
        } else {
            record(
                step("I28").id,
                step("I28").label,
                true,
                "uebersprungen: Migration 0089_wiki_settlement_registry fehlt",
                false,
                [migrationMissingFinding("0089_wiki_settlement_registry")],
            );
        }
    }

    // Restliche Pruefer, die keinen eigenen Schreibpfad haben (V-Gruppe aus staging-import.sh).
    // 🔴 Betreiber 2026-10-03: Ein Prüfer hält den Zug nur an, wenn eine Prüfung aus `BLOCKING_CHECKS` ausfällt. Jede
    // andere ausgefallene Prüfung steht als Befund im Log und im Bericht, der Zug geht weiter. `bestanden` gilt als Urteil.
    if (pruefe("verify:places")) {
        const placesVerify = await verifyPlaces(database, placesPayload, scope);
        record(
            "V1",
            "Orte pruefen",
            placesVerify.passed,
            placesVerify.passed ? "PARITY OK" : "PARITY FAILED",
            false,
            checkFindings("verify:places", placesVerify.checks, passedOf),
        );
    }
    if (pruefe("verify:regions")) {
        const regionsVerify = await verifyRegions(database, regions as never, areas as never, features as never);
        record(
            "V2",
            "Regionen pruefen",
            regionsVerify.passed,
            regionsVerify.passed ? "Paritaet bestanden" : "Paritaet GESCHEITERT",
            false,
            checkFindings("verify:regions", regionsVerify.checks, passedOf),
        );
    }
    if (pruefe("verify:runs")) {
        const runsVerify = await verifyRuns(database);
        record(
            "V3",
            "Schriftlaeufe pruefen",
            runsVerify.passed,
            runsVerify.passed ? "Invarianten bestanden" : "Invarianten GESCHEITERT",
            false,
            checkFindings("verify:runs", runsVerify.checks, passedOf),
        );
    }
    if (pruefe("verify:paths")) {
        const pathsVerify = await verifyPaths(database, features as never);
        record(
            "V4",
            "Wege pruefen",
            pathsVerify.passed,
            pathsVerify.passed ? "PARITY OK" : "PARITY FAILED",
            false,
            checkFindings("verify:paths", pathsVerify.checks, passedOf),
        );
    }
    if (pruefe("verify:path-visuals")) {
        const pathVisualVerify = await verifyPathVisuals(database, mapDomainId);
        record(
            "V5",
            "Wegkurve pruefen",
            pathVisualVerify.passed,
            pathVisualVerify.passed ? "Zusicherungen erfuellt" : "GESCHEITERT",
            false,
            checkFindings("verify:path-visuals", pathVisualVerify.checks, passedOf),
        );
    }
    if (pruefe("verify:path-runs")) {
        const pathRunsVerify = await verifyPathRuns(database, mapDomainId);
        record(
            "V6",
            "Wegnamen-Schriftlaeufe pruefen",
            pathRunsVerify.passed,
            pathRunsVerify.passed ? "Zusicherungen erfuellt" : "GESCHEITERT",
            false,
            checkFindings("verify:path-runs", pathRunsVerify.checks, passedOf),
        );
    }
    if (pruefe("verify:powerlines")) {
        const powerlinesVerify = await verifyPowerlines(database, features as never);
        record(
            "V7",
            "Kraftlinien pruefen",
            powerlinesVerify.passed,
            powerlinesVerify.passed ? "PARITY OK" : "PARITY FAILED",
            false,
            checkFindings("verify:powerlines", powerlinesVerify.checks, passedOf),
        );
    }
    if (pruefe("verify:sea-routes")) {
        const seaChecks = await verifySeaRoutes(database, mapDomainId, AVENTURIA_TRAVEL_MODEL);
        const seaOk = seaRoutesPassed(seaChecks);
        record(
            "V8",
            "Seegraph pruefen",
            seaOk,
            seaOk ? "Seegraph in Ordnung" : "GESCHEITERT",
            false,
            checkFindings("verify:sea-routes", seaChecks, (check) => check.ok),
        );
    }
    if (territories !== null) {
        const territoriesVerify = await verifyTerritories(database, territories);
        record(
            "V9",
            "Herrschaftsgebiete pruefen",
            territoriesVerify.passed,
            territoriesVerify.passed ? "Paritaet bestanden" : "Paritaet GESCHEITERT",
            false,
            checkFindings("verify:territories", territoriesVerify.checks, passedOf),
        );
    }
    if (territories !== null) {
        const territoryShapesVerify = await verifyTerritoryShapes(database);
        record(
            "V10",
            "Gebietsflaechen pruefen",
            territoryShapesVerify.passed,
            territoryShapesVerify.passed ? "Zusicherungen erfuellt" : "GESCHEITERT",
            false,
            checkFindings("verify:territory-shapes", territoryShapesVerify.checks, passedOf),
        );
    }

    if (pruefe("verify:landscape-display")) {
        const landscapeDisplayVerify = await verifyLandscapeDisplay(database, display);
        record(
            "V11",
            "Darstellungstafel pruefen",
            landscapeDisplayVerify.passed,
            landscapeDisplayVerify.passed
                ? `Paritaet bestanden${landscapeDisplayVerify.findings.length === 0 ? "" : `; Befunde: ${landscapeDisplayVerify.findings.join("; ")}`}`
                : `Paritaet GESCHEITERT: ${blockingNames(landscapeDisplayVerify.checks)}`,
            false,
            checkFindings("verify:landscape-display", landscapeDisplayVerify.checks, passedOf),
        );
    }

    if (detailsReady) {
        const detailsVerify = await verifySubjectDetails(database, features);
        record(
            "V12",
            "Detailfelder und Wiki-Zuordnung pruefen",
            detailsVerify.passed,
            detailsVerify.passed ? "Paritaet bestanden" : "Paritaet GESCHEITERT",
            false,
            [...checkFindings("verify:subject-details", detailsVerify.checks, passedOf), ...detailsVerify.findings],
        );
    }
    // Gehören die Quellen dem WikiSync, stimmen sie nicht mehr mit Legacys Satz überein (der Titel und die Angaben der Verknüpfungen folgen dem Wiki): Der Prüfer läuft dann nicht.
    if (sourcesReady && sourcesWikisync) {
        record(
            "V13",
            "Quellen und Kanon pruefen",
            true,
            "nichts zu pruefen (die Quellen gehoeren dem WikiSync)",
            false,
            [],
        );
    } else if (sourcesReady) {
        const sourcesVerify = await verifySources(database, features);
        record(
            "V13",
            "Quellen und Kanon pruefen",
            sourcesVerify.passed,
            sourcesVerify.skipped
                ? "nichts zu pruefen (Quellenbloecke fehlen)"
                : sourcesVerify.passed
                  ? "Paritaet bestanden"
                  : "Paritaet GESCHEITERT",
            false,
            sourcesVerify.skipped ? [] : checkFindings("verify:sources", sourcesVerify.checks, passedOf),
        );
    }
    if (literatureRan && catalogs.literature !== null) {
        const literatureVerify = await verifyLiterature(database, catalogs.literature.payload);
        record(
            "V14",
            "Spielliteratur pruefen",
            literatureVerify.passed,
            literatureVerify.skipped
                ? "nichts zu pruefen (Antwort unbrauchbar, leer oder abgeschaltet)"
                : literatureVerify.passed
                  ? "Paritaet bestanden"
                  : "Paritaet GESCHEITERT",
            false,
            literatureVerify.skipped
                ? []
                : [
                      ...checkFindings("verify:literature", literatureVerify.checks, passedOf),
                      // Die Befunde der Umwandlung hat der Import schon gemeldet; nur das, was erst der Prüfer rechnet, kommt dazu.
                      ...literatureVerify.findings.filter((finding) => finding.code === "territory_path_divergent"),
                  ],
        );
    }
    if (citymapsRan && catalogs.citymaps !== null) {
        const citymapsVerify = await verifyCitymaps(database, catalogs.citymaps.payload, { features });
        record(
            "V15",
            "Kartensammlung pruefen",
            citymapsVerify.passed,
            citymapsVerify.skipped
                ? "nichts zu pruefen (Antwort unbrauchbar, leer oder abgeschaltet)"
                : citymapsVerify.passed
                  ? "Paritaet bestanden"
                  : "Paritaet GESCHEITERT",
            false,
            citymapsVerify.skipped
                ? []
                : [
                      ...checkFindings("verify:citymaps", citymapsVerify.checks, passedOf),
                      // Die Befunde der Umwandlung hat der Import schon gemeldet; nur das, was erst der Prüfer rechnet, kommt dazu.
                      ...citymapsVerify.findings.filter((finding) => finding.code === "territory_path_divergent"),
                  ],
        );
    }
    if (reviewsRan && catalogs.reviews !== null) {
        const reviewsVerify = await verifyReviews(database, catalogs.reviews.payload);
        record(
            "V16",
            "Bewertungen pruefen",
            reviewsVerify.passed,
            reviewsVerify.skipped
                ? "nichts zu pruefen (Antwort unbrauchbar, widerspruechlich oder leer ohne Beleg)"
                : reviewsVerify.passed
                  ? "Paritaet bestanden"
                  : "Paritaet GESCHEITERT",
            false,
            // Die Befunde der Umwandlung hat der Import schon gemeldet; der Pruefer meldet nur seine eigenen Ausfaelle.
            reviewsVerify.skipped ? [] : checkFindings("verify:reviews", reviewsVerify.checks, passedOf),
        );
    }
    if (territoryDetailsRan && territories !== null) {
        const detailsVerify = await verifyTerritoryDetails(database, territories);
        record(
            "V17",
            "Gebietsdetails pruefen",
            detailsVerify.passed,
            detailsVerify.skipped
                ? "nichts zu pruefen (kein Gebiet traegt detail)"
                : detailsVerify.passed
                  ? "Paritaet bestanden"
                  : "Paritaet GESCHEITERT",
            false,
            detailsVerify.skipped
                ? []
                : [
                      ...checkFindings("verify:territory-details", detailsVerify.checks, passedOf),
                      // Die Befunde der Umwandlung hat der Import schon gemeldet; nur das, was erst der Pruefer rechnet, kommt dazu.
                      ...detailsVerify.findings.filter((finding) => finding.code === "coat_columns_superseded"),
                  ],
        );
    }

    if (wikiLinksRan && catalogs.wikiLinkziele !== null && catalogs.wikiZuordnung !== null) {
        // Erst hier geladen: der Prüfer baut den Speicherindex der Subjects und zieht dessen Module nach; als Import am Kopf liesse er das bloße Laden
        // dieser Datei (apps/server/test/legacy-update-cli-import.test.ts, 5 s) länger dauern, obwohl nur ein Zug mit Zuruf ihn braucht.
        const { verifyWikiLinkTargets } = await import("./verify-wiki-link-targets.ts");
        const wikiVerify = await verifyWikiLinkTargets(database, {
            linkziele: catalogs.wikiLinkziele.payload,
            zuordnung: catalogs.wikiZuordnung.payload,
        });
        // Die Befunde der Umwandlung hat der Import schon gemeldet; hier kommt, was erst der Pruefer rechnet: der Abgleich mit den eigenen Zuweisungen,
        // die Aufloesung der Linkziele und die Ablösung der alten Verkehrswege-Tafel.
        const verifierOnly = new Set([
            "wiki_key_vs_assignment",
            "x2_object_not_on_map",
            "traffic_link_not_in_x1",
            "x1_ziele_ohne_kartenobjekt",
        ]);
        record(
            "V18",
            "Wiki-Linkziele und Zuordnung pruefen",
            wikiVerify.passed,
            wikiVerify.skipped
                ? "nichts zu pruefen (Antworten unbrauchbar oder leer)"
                : wikiVerify.passed
                  ? "Paritaet bestanden"
                  : "Paritaet GESCHEITERT",
            false,
            wikiVerify.skipped
                ? []
                : [
                      ...checkFindings("verify:wiki-links", wikiVerify.checks, passedOf),
                      ...wikiVerify.findings.filter((finding) => verifierOnly.has(finding.code)),
                  ],
        );
    }
    if (loreRan && catalogs.lore !== null) {
        const loreVerify = await verifyLore(database, catalogs.lore.payload, { mapRevision: features.revision });
        record(
            "V19",
            "Lore pruefen",
            loreVerify.passed,
            loreVerify.skipped
                ? "nichts zu pruefen (Antwort unbrauchbar, leer, abgeschaltet oder Kopfzaehler widersprechen)"
                : loreVerify.passed
                  ? "Paritaet bestanden"
                  : "Paritaet GESCHEITERT",
            false,
            loreVerify.skipped
                ? []
                : [
                      ...checkFindings("verify:lore", loreVerify.checks, passedOf),
                      // Die Befunde der Umwandlung hat der Import schon gemeldet; nur das, was erst der Pruefer rechnet, kommt dazu.
                      ...loreVerify.findings.filter((finding) =>
                          [
                              "place_target_carrier_unusable",
                              "catalog_row_without_link_after_lore",
                              "contract_numbers",
                          ].includes(finding.code),
                      ),
                  ],
        );
    }

    if (mediaRan && mediaSource !== null && territories !== null) {
        // Ohne Medienwurzel: dieser Zug fasst keine Bytes an, die Pruefung der Dateien auf der Platte macht `verify:media --media-root`.
        const mediaVerify = await verifyMedia(database, mediaSource, { territoriesPayload: territories });
        record(
            "V20",
            "Medien pruefen",
            mediaVerify.passed,
            mediaVerify.passed ? "Paritaet bestanden" : "Paritaet GESCHEITERT",
            false,
            // Die Befunde der Umwandlung hat der Import schon gemeldet; der Pruefer meldet nur seine eigenen Ausfaelle.
            checkFindings("verify:media", mediaVerify.checks, passedOf),
        );
    }
    if (staettenRan) {
        const staettenVerify = await verifyStaetten(database, features, {
            rohquellen: staettenV2Ran ? (catalogs.staettenRohquellen?.payload ?? undefined) : undefined,
        });
        record(
            "V21",
            "Staetten pruefen",
            staettenVerify.passed,
            staettenVerify.skipped
                ? "nichts zu pruefen (Block `in_settlement_places` fehlt oder ist leer)"
                : staettenVerify.passed
                  ? "Paritaet bestanden"
                  : "Paritaet GESCHEITERT",
            false,
            // Die Befunde der Umwandlung hat der Import schon gemeldet; der Pruefer meldet nur seine eigenen Ausfaelle.
            checkFindings("verify:staetten", staettenVerify.checks, passedOf),
        );
    }
    if (wikiSettlementsRan && catalogs.wikiSiedlungen?.payload != null) {
        // Erst hier geladen, wie V18: der Pruefer zieht den Leser der Ortsliste nach, den nur ein Zug mit Zuruf braucht.
        const { verifyWikiSettlements } = await import("./verify-wiki-settlements.ts");
        const settlementsVerify = await verifyWikiSettlements(database, catalogs.wikiSiedlungen.payload);
        record(
            "V22",
            "Wiki-Siedlungsregistry pruefen",
            settlementsVerify.passed,
            settlementsVerify.skipped
                ? "nichts zu pruefen (Antwort unbrauchbar oder leer)"
                : settlementsVerify.passed
                  ? "Paritaet bestanden"
                  : "Paritaet GESCHEITERT",
            false,
            // Die Befunde der Umwandlung hat der Import schon gemeldet; der Pruefer meldet nur seine eigenen Ausfaelle.
            checkFindings("verify:wiki-settlements", settlementsVerify.checks, passedOf),
        );
    }

    // V23 Naht der Kategorien (WI-0141 §3.2): nur bei einem Zug je Kategorie, read-only, Befund statt Abbruch. Was zwischen
    // zwei Kategorien nicht mehr zusammenpasst, steht mit Zahl und Namen im Bericht — und sagt damit, ob die andere Kategorie
    // nachgezogen werden sollte. Zwischen den Kategorien gibt es keinen Fremdschlüssel; ein halber Bezug kann nicht entstehen.
    if (kategorie !== null) {
        const naht = await messeBezuege(database, kategorie, mapDomainId);
        const befunde = bezugsBefunde(naht);
        record(
            "V23",
            "Naht der Kategorien pruefen",
            true,
            naht.befunde.map((befund) => `${befund.code} ${String(befund.anzahl)}`).join(", ") ||
                "keine Naht zu messen",
            false,
            befunde,
        );
    }

    return outcomes;
}

/** Gibt es die Tabelle schon (hat die Migration gelaufen)? */
async function tableExists(database: Database, table: string): Promise<boolean> {
    const [row] = await database<{ present: string | null }[]>`SELECT to_regclass(${table})::text AS present`;
    return row?.present != null;
}

function migrationMissingFinding(migration: string): Finding {
    return createFinding(
        "migration_missing",
        `Migration ${migration} ist in dieser Datenbank nicht angewendet; der Schritt uebersteht ohne Wirkung (npm run db:migrate)`,
        { migration },
    );
}

// ---------------------------------------------------------------------------------------------
// Schritt 3: Bericht schreiben.
// ---------------------------------------------------------------------------------------------

function renderReport(input: {
    setName: string;
    stamp: string;
    apply: boolean;
    /** Die Freigabe (Zuruf oder Auftrag aus der Verwaltung), siehe `freigabeAus`. */
    freigabe?: string | null | undefined;
    features: FetchedJson<MapFeaturesPayloadShape>;
    areas: FetchedJson<EcosystemAreasPayloadShape>;
    regions: FetchedJson<RegionsPayloadShape>;
    regionsLabel: string;
    /** `null` bei einem Zug je Kategorie (WI-0141): nie abgerufen, also keine Zeile in der Quellentafel. */
    territories: FetchedJson<LegacyTerritoryPayload> | null;
    territoriesLabel: string;
    display: FetchedDisplay;
    /** Die Kataloge von I20 und I21 und die Bewertungen von I22 (nur mit dem Zuruf des Betreibers geholt), siehe `fetchCatalog`. */
    catalogs?: Catalogs | undefined;
    /** Befunde des Abrufs (abweichende Revisionen), siehe `fetchTriple`. */
    sourceFindings?: Finding[] | undefined;
    firstRun?: StepOutcome[] | undefined;
    secondRun?: StepOutcome[] | undefined;
    error?: string | undefined;
}): string {
    const lines: string[] = [];
    lines.push(`# Legacy-Update ${input.setName} (${input.stamp})`);
    lines.push("");
    lines.push(
        `Modus: ${input.apply ? "**eingespielt** (avesmaps3d_dev)" : "nur geholt und geprueft, nichts geschrieben"}`,
    );
    if (input.freigabe) {
        lines.push(input.freigabe);
    }
    lines.push("");
    lines.push("## Quellen");
    lines.push("");
    lines.push("| Datei | Revision | Bytes | SHA-256 |");
    lines.push("|---|---|---|---|");
    lines.push(
        `| map-features.json | ${String(input.features.payload.revision)} | ${String(input.features.bytes)} | ${input.features.sha256} |`,
    );
    lines.push(
        `| ecosystem-areas.json | ${String(input.areas.payload.revision)} | ${String(input.areas.bytes)} | ${input.areas.sha256} |`,
    );
    lines.push(
        `| legacy-list-regions.json | ${input.regionsLabel} | ${String(input.regions.bytes)} | ${input.regions.sha256} |`,
    );
    lines.push(
        input.territories === null
            ? `| legacy-political-territories.json | ${input.territoriesLabel} | - | - |`
            : `| legacy-political-territories.json | ${input.territoriesLabel} | ${String(input.territories.bytes)} | ${input.territories.sha256} |`,
    );
    lines.push(
        `| legacy-ecosystem-display.json | ${input.display.label} | ${String(input.display.input.bytes)} | ${input.display.input.sha256} |`,
    );
    for (const catalog of [
        input.catalogs?.literature,
        input.catalogs?.citymaps,
        input.catalogs?.reviews,
        input.catalogs?.wikiZuordnung,
        input.catalogs?.wikiLinkziele,
        input.catalogs?.wikiSiedlungen,
        input.catalogs?.staettenRohquellen,
        input.catalogs?.lore,
        input.catalogs?.media,
        input.catalogs?.mediaPrivate,
    ]) {
        if (catalog) {
            lines.push(`| ${catalog.file} | ${catalog.label} | ${String(catalog.bytes)} | ${catalog.sha256} |`);
        }
    }
    lines.push("");
    if (input.error) {
        lines.push("## Abgebrochen");
        lines.push("");
        lines.push(input.error);
        lines.push("");
    }
    if (input.firstRun) {
        lines.push("## Erster Lauf");
        lines.push("");
        for (const outcome of input.firstRun) {
            lines.push(`- ${outcome.ok ? "✅" : "❌"} **${outcome.id} ${outcome.label}**: ${outcome.summary}`);
        }
        lines.push("");
        // Eigene Abschnitte einzelner Schritte (I9: Häfen ohne Wasser-Zugang, WI-0060), nur aus dem ersten Lauf.
        for (const outcome of input.firstRun) {
            if (outcome.section) lines.push(...outcome.section);
        }
    }
    // Befunde (Betreiber 2026-10-03): Prüfungen, die angeschlagen haben, ohne den Zug anzuhalten - mit allen Objekten.
    if ((input.sourceFindings ?? []).length > 0) {
        lines.push("## Befunde (Quellen, der Zug lief weiter)");
        lines.push("");
        lines.push("```");
        lines.push(...formatFindings(input.sourceFindings ?? []));
        lines.push("```");
        lines.push("");
    }
    for (const [title, outcomes] of [
        ["Erster Lauf", input.firstRun],
        ["Zweiter Lauf", input.secondRun],
    ] as const) {
        const withFindings = (outcomes ?? []).filter((outcome) => outcome.findings.length > 0);
        if (withFindings.length === 0) continue;
        lines.push(`## Befunde (${title}, der Zug lief weiter)`);
        lines.push("");
        for (const outcome of withFindings) {
            lines.push(`### ${outcome.id} ${outcome.label}`);
            lines.push("");
            lines.push("```");
            lines.push(...formatFindings(outcome.findings));
            lines.push("```");
            lines.push("");
        }
    }
    if (input.secondRun) {
        const changedOnSecond = input.secondRun.filter((outcome) => outcome.changed);
        lines.push("## Zweiter Lauf (Idempotenzprobe)");
        lines.push("");
        lines.push(
            changedOnSecond.length === 0
                ? "Nichts geaendert - der Zug ist idempotent."
                : `🔴 **Hat trotzdem etwas geaendert:** ${changedOnSecond.map((o) => `${o.id} ${o.label}`).join(", ")}`,
        );
        lines.push("");
    }
    lines.push("## Fuer Stage");
    lines.push("");
    lines.push(
        input.apply
            ? `Freigabezeile zum Kopieren, sobald Stage denselben Satz ziehen soll: \`Stage: ${input.setName} ziehen ja\``
            : "Noch nicht lokal eingespielt - kein Stage-Schritt faellig.",
    );
    lines.push("");
    return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Ablauf.
// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
    const at = new Date();
    const stamp = buildReportStamp(at);
    if (values["allow-shrink"]) {
        line("Hinweis: --allow-shrink ist wirkungslos; die Stilllegequote wird nur gemeldet (Betreiber 2026-10-03).");
    }

    // Die kleine Quelle zuerst: eine unbrauchbare Antwort bricht ab, bevor die grossen geholt sind.
    const display = await fetchDisplay();
    const {
        features,
        areas,
        regions,
        regionsLabel,
        territories,
        territoriesEtag,
        territoriesLabel,
        findings: sourceFindings,
    } = await fetchTriple();
    const setName = buildSetName(features.payload.revision ?? 0, areas.payload.revision ?? 0, at);
    line(`Satzname: ${setName}`);

    if (!apply) {
        line("");
        line("Nur geholt, nichts geschrieben (kein --operator-said). Zum Einspielen:");
        line(`  npm run legacy:update -- --operator-said "<Betreiberzitat>"`);
        const reportPath = `${snapshotDir}\\bericht-${stamp}.md`;
        await writeFile(
            reportPath,
            renderReport({
                setName,
                stamp,
                apply: false,
                features,
                areas,
                regions,
                regionsLabel,
                territories,
                territoriesLabel,
                display,
                sourceFindings,
            }),
        );
        line(`Bericht: ${reportPath}`);
        return;
    }

    const config = loadConfig();
    if (!config.databaseUrl) {
        throw new Error("DATABASE_URL ist nicht gesetzt");
    }
    const database = createDatabase(config.databaseUrl);
    // 🔴 WI-0253 D-1: Eine Kategorie, deren Bereich in dieser Umgebung dem WikiSync gehört, fährt dieser Zug nicht mehr (Vali 2026-10-25: der Legacy-Zug lässt den Bereich aus).
    // Der Start aus der Verwaltung weist sie schon ab (`abgleiche/start.ts`); das hier hält den Zug von Hand auf, bevor etwas in die Datenbank geschrieben ist.
    if (kategorie !== null) {
        const abgegeben = await bereicheAusgelassenBeiKategorie(database, kategorie);
        if (abgegeben.length > 0) {
            await database.end({ timeout: 5 });
            throw new Error(
                `Die Kategorie ${kategorie} gehört in dieser Umgebung dem WikiSync (${abgegeben.join(", ")}); der Legacy-Zug fährt sie nicht mehr.`,
            );
        }
    }
    const recorder = new JobRecorder({
        database,
        config: getJobsConfig(jobsProfileName(process.env)),
        mapDomainId: AVENTURIA.mapDomain,
        release: config.releaseId,
        warn: (message) => line(`Hinweis: ${message}`),
    });
    if (meldet) {
        // Der Auftrag ist schon ein Job der Warteschlange: kein zweiter, aufgezeichneter `import` daneben. Die Warnzeile unter
        // Kartensperre schreibt der Zug dann selbst (Betreiber 2026-10-10: der Import läuft weiter und lässt die Sperre stehen).
        const warning = await mapLockWarning(database);
        if (warning !== null) line(`Hinweis: ${warning}`);
        line(phaseZeile(PIPELINE_STEPS[0]?.id ?? "I1"));
        observeStep = (completedId) => {
            const index = PIPELINE_STEPS.findIndex((candidate) => candidate.id === completedId);
            const next = PIPELINE_STEPS[index + 1];
            if (next !== undefined) line(phaseZeile(next.id));
        };
    }
    /** Läuft schon der zweite Lauf? Für den groben Fortschritt auf der Statusseite und unter „Abgleiche“ (`zugAnteil`). */
    let zweiterLauf = false;
    const recorded = meldet
        ? null
        : await recorder.start("import", {
              label: "legacy:update (lokal)",
              externalRef: `legacy-update-${stamp}`,
              phase: PIPELINE_STEPS[0]?.id ?? null,
          });
    if (recorded) {
        // Die Meldungen laufen nacheinander (eine Kette), und das Ende wartet auf sie.
        let chain: Promise<unknown> = Promise.resolve();
        observeStep = (completedId) => {
            const index = PIPELINE_STEPS.findIndex((candidate) => candidate.id === completedId);
            const next = PIPELINE_STEPS[index + 1];
            chain = chain.then(() =>
                recorder.phase({ publicId: recorded.publicId }, "import", next?.id ?? completedId, {
                    progress: zugAnteil(next?.id ?? completedId, zweiterLauf),
                    rssMb: Math.ceil(process.memoryUsage.rss() / 1024 / 1024),
                }),
            );
        };
        recordingDone = () => chain;
    }
    if (!(globalThis as { gc?: unknown }).gc) {
        // The domain verification is read-only after the canonical terrain derivation.
        // Prozess auf, nicht per eigenem CLI-Aufruf - das npm-Skript setzt --expose-gc deshalb selbst.
        line(
            "Hinweis: ohne node --expose-gc liegt die Spitze beim Relief-Schritt (I12) hoeher (gemessen rund 50 MB mehr).",
        );
    }
    // I20 und I21: die zwei Kataloge, je EIN Abruf, nur mit dem Zuruf des Betreibers (hier ist er gegeben). Der zweite Lauf (Idempotenzprobe)
    // und ein Nachhol-Versuch der Quellen unten nehmen DIESELBEN Antworten: es gibt keinen zweiten Abruf.
    const catalogs: Catalogs = {
        literature: await fetchCatalog(
            "game-literature.json",
            values["game-literature-endpoint"],
            values["literature-file"],
        ),
        citymaps: await fetchCatalog("citymaps.json", values["citymaps-endpoint"], values["citymaps-file"]),
        // I22: die sichtbaren Bewertungen (E3), ebenfalls EIN Abruf; der GET ist lesend, also keine Meldung zur Schemaheilung.
        reviews: await fetchCatalog("location-reviews.json", values["reviews-endpoint"], values["reviews-file"], {
            selfHeals: false,
        }),
        // I24: Legacys zwei lesende Exporte der Wiki-Linkziele (X1) und der Zuordnung (X2), je EIN Abruf, ohne Selbstheilen in Legacy.
        wikiLinkziele: await fetchWikiExport(
            "legacy-wiki-linkziele.json",
            values["wiki-linkziele-endpoint"],
            values["wiki-linkziele-file"],
        ),
        wikiZuordnung: await fetchWikiExport(
            "legacy-wiki-zuordnung.json",
            values["wiki-zuordnung-endpoint"],
            values["wiki-zuordnung-file"],
        ),
        // I28: Legacys lesender Export der Wiki-Siedlungsregistry (X3), EIN Abruf nach derselben Regel wie X1 und X2.
        wikiSiedlungen: await fetchWikiExport(
            "legacy-wiki-siedlungen.json",
            values["wiki-siedlungen-endpoint"],
            values["wiki-siedlungen-file"],
        ),
        // I27 (WI-0134): Legacys Rohquellen-Export der Staetten (X4), EIN Abruf nach derselben Regel wie X1 bis X3.
        staettenRohquellen: await fetchWikiExport(
            "legacy-staetten-rohquellen.json",
            values["staetten-rohquellen-endpoint"],
            values["staetten-rohquellen-file"],
        ),
        // I25: die Lore (E2 und E2+), ebenfalls EIN Abruf; der GET ist rein lesend, also keine Meldung zur Schemaheilung.
        lore: await fetchCatalog("lore-export.json", values["lore-endpoint"], values["lore-file"], {
            selfHeals: false,
        }),
        // I26: das oeffentliche Medien-Manifest (E5 A), ebenfalls EIN Abruf, lesend. Das private (E5 B) NIE abgerufen, nur gelesen.
        media: await fetchCatalog("media-export.json", values["media-endpoint"], values["media-file"], {
            selfHeals: false,
        }),
        mediaPrivate:
            values["media-private-file"] === undefined
                ? null
                : await fetchCatalog("media-export-migration.json", "", values["media-private-file"], {
                      selfHeals: false,
                  }),
    };
    let firstRun: StepOutcome[] | undefined;
    let secondRun: StepOutcome[] | undefined;
    let errorText: string | undefined;
    // Hardening Review M5, Fund: der zweite Lauf (Idempotenzprobe) muss dieselben Dateien einspielen wie
    // der ERFOLGREICHE erste Lauf - nach einem Nachhol-Versuch (unten) sind das die frisch geholten, nicht
    // die urspruenglichen. usedFeatures/usedAreas verfolgen, welcher Stand tatsaechlich gewann.
    let usedFeatures = features;
    let usedAreas = areas;
    let usedRegions = regions;
    let usedRegionsLabel = regionsLabel;
    let usedTerritories = territories;
    let usedTerritoriesEtag = territoriesEtag;
    let usedTerritoriesLabel = territoriesLabel;
    let usedSourceFindings = sourceFindings;
    try {
        try {
            firstRun = await runPipeline(
                database,
                usedFeatures.payload,
                usedAreas.payload,
                usedRegions.payload,
                usedTerritories?.payload ?? null,
                usedTerritoriesEtag,
                display.input,
                catalogs,
            );
        } catch (error) {
            if (
                error instanceof MigrationAborted &&
                error.message.includes("region_area") &&
                error.detail !== undefined
            ) {
                // Bekannter Fall vom 2026-09-28: Legacy wird zwischen den drei Abrufen weiterredigiert,
                // eine Gebirgsflaeche fehlt noch im Regionsexport. Einmal frisch nachholen und neu versuchen.
                line(
                    "⚠ Gebirgsflaechen fehlen im Regionsbestand - Quellen sind nicht zeitgleich. Hole alle drei einmal frisch nach.",
                );
                const again = await fetchTriple();
                usedFeatures = again.features;
                usedAreas = again.areas;
                usedRegions = again.regions;
                usedRegionsLabel = again.regionsLabel;
                usedTerritories = again.territories;
                usedTerritoriesEtag = again.territoriesEtag;
                usedTerritoriesLabel = again.territoriesLabel;
                usedSourceFindings = again.findings;
                firstRun = await runPipeline(
                    database,
                    usedFeatures.payload,
                    usedAreas.payload,
                    usedRegions.payload,
                    usedTerritories?.payload ?? null,
                    usedTerritoriesEtag,
                    display.input,
                    catalogs,
                );
            } else if (error instanceof PipelineHalted) {
                firstRun = error.outcomes;
                throw error;
            } else {
                throw error;
            }
        }
        line("");
        line("→ zweiter Lauf (Idempotenzprobe)");
        zweiterLauf = true;
        if (meldet) line(phaseZeile("zweiter-lauf"));
        secondRun = await runPipeline(
            database,
            usedFeatures.payload,
            usedAreas.payload,
            usedRegions.payload,
            usedTerritories?.payload ?? null,
            usedTerritoriesEtag,
            display.input,
            catalogs,
            firstRun,
        );
    } catch (error) {
        errorText = error instanceof Error ? error.message : String(error);
        line(`❌ abgebrochen: ${errorText}`);
    } finally {
        // Das Ende melden, solange die Verbindung noch offen ist; scheitert es, bleibt es ohne Folgen für den Lauf.
        if (meldet) observeStep = undefined;
        if (recorded) {
            observeStep = undefined;
            await recordingDone();
            await recorder.finish(
                { publicId: recorded.publicId },
                "import",
                {
                    ok: errorText === undefined,
                    errorCode: errorText === undefined ? null : "pipeline_failed",
                    errorSummary: errorText === undefined ? null : sanitizeSummary(errorText),
                    rssPeakMb: Math.ceil(process.resourceUsage().maxRSS / 1024),
                },
                { phase: "I11" },
            );
        }
        await database.end({ timeout: 5 });
    }

    const reportPath = `${snapshotDir}\\bericht-${stamp}.md`;
    await writeFile(
        reportPath,
        renderReport({
            setName,
            stamp,
            apply: true,
            freigabe: freigabe.zeile,
            // usedFeatures/usedAreas, nicht die urspruenglichen: nach einem Nachhol-Versuch beschreibt der
            // Bericht sonst eine andere Datei als die tatsaechlich eingespielte (Hardening Review M5).
            features: usedFeatures,
            areas: usedAreas,
            regions: usedRegions,
            regionsLabel: usedRegionsLabel,
            territories: usedTerritories,
            territoriesLabel: usedTerritoriesLabel,
            display,
            catalogs,
            sourceFindings: usedSourceFindings,
            firstRun,
            secondRun,
            error: errorText,
        }),
    );
    line("");
    line(`Bericht: ${reportPath}`);
    if (meldet) {
        line(
            ergebnisZeile({
                luecken: entfalleneSchritte(firstRun ?? []),
                befunde: (firstRun ?? []).reduce((sum, outcome) => sum + outcome.findings.length, 0),
                satz: setName,
            }),
        );
    }
    if (errorText) {
        process.exitCode = 1;
    }
}

// 🪤 Nur als Programm laufen, nie beim bloßen import(): Ein Probeladen unter Type-Stripping holte am 2026-09-29
// live Legacys Satz und schrieb ihn ins Fach, während die Koordination einen Zug startete.
if (import.meta.main) {
    try {
        await main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
