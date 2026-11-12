import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { LANDING_REACH } from "../routing/sea-grid.ts";
import { describeLandless, type LandlessPort, type LandlessSettings } from "../routing/sea-landless.ts";

/**
 * Reiner Baustein von `legacy:update` (WI-0049-Nachfolge, Koordination 2026-09-28): alles, was sich
 * ohne Netzwerk, Datenbank oder Prozessaufruf testen laesst. Der eigentliche Ablauf steht in
 * `legacy-update-cli.ts`.
 *
 * Der Betreiber hat den frueheren Plan (Wegwerf-Cluster, gepinnte Satzdatei je Zug, `pg_dump` vor
 * jedem Zug) ausdruecklich verworfen: "du brauchst keine staende einfrieren... bei uns lokal ist
 * (noch) nichts editiert" und "wichtig ist, dass du nicht ... unsere ... db mit temporaeren daten
 * ueberwuchert". `legacy:update` zieht deshalb direkt in `avesmaps3d_dev`, ohne Sicherungskopie und
 * ohne Satzdatei je Zug - die Freigabe ist der Zuruf selbst (`--operator-said`), das Protokoll ist
 * der Bericht.
 */

export const PUBLIC_MAP_FEATURES_ENDPOINT = "https://avesmaps.de/api/app/map-features.php";
export const PUBLIC_ECOSYSTEM_AREAS_ENDPOINT = "https://avesmaps.de/api/app/ecosystem-areas.php";
/** Legacys oeffentlicher Regions-Export (Auftrag 2026-09-28, live seit 2026-09-29); ersetzt die Editor-Datei. */
export const PUBLIC_ECOSYSTEM_REGIONS_ENDPOINT = "https://avesmaps.de/api/app/ecosystem-regions.php";
/**
 * Legacys oeffentlicher Export der Herrschaftsgebiete (Auftrag 2026-09-29, live seit 2026-09-29, WI-0062). Gross (rund
 * 2,25 MB entpackt) und teuer fuer das Shared Hosting: auch ein 304 kostet einen vollen Lesevorgang. Nur auf Zuruf holen,
 * nie in einer Schleife; bedingt ueber `X-Avesmaps-ETag` als `If-None-Match`.
 */
export const PUBLIC_POLITICAL_TERRITORIES_ENDPOINT = "https://avesmaps.de/api/app/political-territories-export.php";
/**
 * Legacys oeffentlicher Endpunkt der Darstellungstafel der Landschaften (WI-0064): NUR die Uebersteuerungen der Redaktion samt
 * Stempel, klein (rund 1,8 KB). Die Vorgaben stehen in Legacys Code und liegen versioniert im Repo (`config/landscape-display/`).
 * Ein bedingter Abruf lohnt nicht: STRATO entfernt den `ETag` aus Antworten mit Rumpf, und der Stempel steht nur im Rumpf.
 */
export const PUBLIC_ECOSYSTEM_DISPLAY_ENDPOINT = "https://avesmaps.de/api/app/ecosystem-display.php";
/**
 * Legacys oeffentliche Kataloge der Spielliteratur und der Kartensammlung (WI-0063 P3, Vertraege `literature.yaml` und `citymaps.yaml`,
 * Schritte I20 und I21). Je Zug HOECHSTENS EIN Abruf je Endpunkt, ohne Wiederholung, ohne bedingten Abruf (der Code kennt weder Revision
 * noch ETag), nie in einer Schleife, nur mit dem Zuruf des Betreibers. 🔴 `citymaps.php` schreibt beim GET heute in Legacy (Schemaheilung
 * und die einmalige Rueckfuellung color_mode, Befund `legacy_get_self_heals`), bis die Legacy-Sitzung das aendert (Auftrag 2026-10-04,
 * „GET ohne Schreibwirkung“). Dieser Abruf wird gebaut, aber nur auf Zuruf ausgefuehrt.
 */
export const PUBLIC_GAME_LITERATURE_ENDPOINT = "https://avesmaps.de/api/app/game-literature.php";
export const PUBLIC_CITYMAPS_ENDPOINT = "https://avesmaps.de/api/app/citymaps.php";
/**
 * Legacys oeffentlicher Bewertungs-Export E3 (WI-0063 P3, Vertrag `reviews.yaml`, Schritt I22): NUR die sichtbaren Bewertungen ohne
 * Personenbezug (Legacy `024e3af3d`, `api/app/location-reviews-export.php`). Klein (Groessenordnung hundert bis zweihundert Zeilen), je Zug
 * HOECHSTENS EIN Abruf, ohne Wiederholung (ein `503 data_changing` laesst den Schritt fuer diesen Zug entfallen), ohne bedingten Abruf
 * (der Inhalts-ETag steht nur im Kopf `X-Avesmaps-ETag`, den der gemeinsame Abruf nicht speichert), nie in einer Schleife, nur mit dem
 * Zuruf des Betreibers. Der GET ist in Legacy lesend (kein DDL, keine Sitzung, keine Schemaheilung).
 */
export const PUBLIC_LOCATION_REVIEWS_ENDPOINT = "https://avesmaps.de/api/app/location-reviews-export.php";
/**
 * Legacys zwei lesende Exporte der Wiki-Linkziele (X1) und der Wiki-Zuordnung Wiki-Key -> Objekt (X2), gebaut am 2026-10-05 fuer Avesmaps3D
 * (WI-0063 27.12, Schritt I24, Legacy-Commits `562638021` und `04a85a54f`: X1 je Artikel). Nur SELECT, kein Live-Abruf am Wiki, kein Selbstheilen; Staende vor und nach dem Lesen
 * (`503 data_changing`, `Retry-After`), Inhalts-ETag in `X-Avesmaps-ETag`. 🔴 X1 (rund 4 MB unkomprimiert, X2 rund 1,6 MB) ist teuer fuer das Shared
 * Hosting: auch ein 304 kostet einen vollen Lesevorgang. Nur auf Zuruf holen, hoechstens einmal je Zug und Endpunkt, nie in einer Schleife und ohne
 * bedingten Abruf. Dieser Abruf wird gebaut, aber nur auf Zuruf ausgefuehrt.
 */
export const PUBLIC_WIKI_LINKZIELE_ENDPOINT = "https://avesmaps.de/api/app/wiki-linkziele-export.php";
export const PUBLIC_WIKI_ZUORDNUNG_ENDPOINT = "https://avesmaps.de/api/app/wiki-zuordnung-export.php";
/**
 * Legacys lesender Export der Wiki-Siedlungsregistry (X3, WI-0128 E4, Schritt I28; Anfrage `project-control/legacy-requests/2026-10-10-wiki-siedlungsregistry-export.md`,
 * erst nach dem Einspielen in Legacy vorhanden): je Siedlung der Registry `wiki_sync_pages` der kanonische Wiki-Key (dieselbe Regel wie X1 und X2) und die
 * Orte, denen er zugewiesen ist. Nur SELECT, Staende vor und nach dem Lesen (`503 data_changing`), Inhalts-ETag. Gross wie X2: nur auf Zuruf, hoechstens
 * einmal je Zug, nie in einer Schleife, ohne bedingten Abruf, mit hoechstens zwei Wiederholungen bei `503 data_changing`.
 */
export const PUBLIC_WIKI_SIEDLUNGEN_ENDPOINT = "https://avesmaps.de/api/app/wiki-siedlungen-export.php";
/**
 * Legacys Rohquellen-Export der Stätten (X4, WI-0134, Teil von Schritt I27; Anfrage `project-control/legacy-requests/2026-10-10-staetten-rohquellen-export.md`,
 * erst nach dem Einspielen in Legacy vorhanden): die Rohzeilen der Quellen hinter `in_settlement_places` je mit Legacys eigener Kennung, ohne Urteil und
 * ohne Entdoppeln, `ok` je Quelle. Dieselbe Bauart und Abrufregel wie X1 bis X3: nur auf Zuruf, höchstens einmal je Zug, ohne bedingten Abruf, höchstens zwei
 * Wiederholungen bei `503 data_changing`.
 */
export const PUBLIC_STAETTEN_ROHQUELLEN_ENDPOINT = "https://avesmaps.de/api/app/staetten-rohquellen-export.php";
/**
 * Legacys Voll-Export der Lore (Natur und Waren, WI-0063 P3, Vertrag `lore.yaml`, Schritt I25; Legacy E2 und E2+, gebaut in Legacy-Commit
 * `024e3af3d`): Einträge aller Zustände, Ortszeilen samt Grabsteinen, Regeln und die Quellenverknüpfungen der Vorkommen samt Herkunft und
 * Zustand. Rein lesend (kein Schreibweg, kein DDL, harte Positivliste, `503 data_changing` bei bewegtem Bestand), aber GROSS (tausende
 * Einträge, zehntausende Verknüpfungen) und teuer für das Shared Hosting: je Zug HÖCHSTENS EIN Abruf, ohne Wiederholung und ohne
 * bedingten Abruf (STRATO entfernt den `ETag` aus Antworten mit Rumpf; auch ein 304 kostet einen vollen Lesevorgang), nie in einer
 * Schleife, nur mit dem Zuruf des Betreibers. Dieser Abruf wird gebaut, aber nur auf Zuruf ausgeführt.
 */
export const PUBLIC_LORE_EXPORT_ENDPOINT = "https://avesmaps.de/api/app/lore-export.php";
/**
 * Legacys oeffentliches Medien-Manifest E5 A (WI-0063 MEDIA-M8, Vertrag `media.yaml`, Schritt I26; Legacy `024e3af3d`,
 * `api/app/media-export.php`): NUR die Medien, die Legacy heute jedem zeigt, ohne Notiz, Urheber, Stempel, Unterdrueckung. Je Zug
 * HOECHSTENS EIN Abruf, ohne Wiederholung, nie in einer Schleife, nur mit dem Zuruf des Betreibers; der GET ist in Legacy lesend. Das
 * private Manifest B (`api/edit/migration/media-export.php`, Admin-Sitzung) holt dieses Werkzeug NIE: es kommt als Datei vom Betreiber
 * (`--media-private-file`). Die Dateien selbst (Bytes) holt dieser Zug nie: eigener Pfad `legacy:media-fetch` und `migrate:media-files`.
 */
export const PUBLIC_MEDIA_EXPORT_ENDPOINT = "https://avesmaps.de/api/app/media-export.php";

/** Das eine, überschreibbare Download-Fach des Zugs auf dem Entwicklungsrechner (`--snapshot-dir`); auch der Medienauftrag legt dort ab. */
export const DEFAULT_SNAPSHOT_DIR = "C:\\avesmaps3d-data\\legacy-snapshots\\aktuell";
/** Der Kopf, in dem der Export seinen Inhalts-ETag traegt (STRATO entfernt den echten `ETag` aus Antworten mit Rumpf). */
export const TERRITORIES_ETAG_HEADER = "x-avesmaps-etag";
/** So oft darf ein `503 data_changing` wiederholt werden (Retry-After beachten). */
export const TERRITORIES_MAX_RETRIES = 2;

/**
 * Ob drei live geholte Dateien denselben Legacy-Stand tragen: Der Regions-Export nennt `map_revision`
 * und `ecosystem_revision`, die beiden anderen je ihre `revision`. Legacy wird laufend redigiert - wer
 * zwischen den Abrufen speichert, erzeugt sonst einen gemischten Satz (Fund vom 2026-09-28).
 */
export function revisionsMatch(
    featuresRevision: number | undefined,
    areasRevision: number | undefined,
    regions: { map_revision?: number | undefined; ecosystem_revision?: number | undefined },
    territories?: { map_revision?: number | undefined },
): boolean {
    return (
        featuresRevision !== undefined &&
        areasRevision !== undefined &&
        regions.map_revision === featuresRevision &&
        regions.ecosystem_revision === areasRevision &&
        // Der Export der Gebiete traegt dieselbe `map_revision` wie `map-features.php` (Antwort 2026-09-29); Aenderungen an
        // Gebieten heben sie nicht - seinen eigenen Stempel `territories_revision` prueft nur der Import.
        (territories === undefined || territories.map_revision === featuresRevision)
    );
}

/** Ein 503 des Exports der Gebiete, das ein Wiederholen lohnt: `data_changing` mit `Retry-After` (Antwort 2026-09-29). */
export function isDataChanging(status: number, body: string): boolean {
    if (status !== 503) return false;
    try {
        const parsed = JSON.parse(body) as { error?: unknown };
        return parsed.error === "data_changing";
    } catch {
        return false;
    }
}

/** Was der Abruf der Gebiete ergibt: derselbe Stand wie beim letzten Zug (304) oder ein frischer Rumpf. */
export type TerritoriesResponse =
    { kind: "not_modified"; etag: string } | { kind: "fresh"; text: string; etag: string | null };

/**
 * Holt den Export der Herrschaftsgebiete (WI-0062): bedingt, wenn ein ETag vom letzten Zug vorliegt
 * (`If-None-Match`), mit hoechstens `TERRITORIES_MAX_RETRIES` Wiederholungen bei `503 data_changing` nach `Retry-After`.
 * Jede andere Antwort ausser 200 ist ein Fehler - nie ein stiller Rueckfall. Der Abruf ist teuer fuer Legacy: keine
 * Schleife ausser dieser einen, festen Grenze.
 */
export async function requestTerritories(options: {
    url: string;
    storedEtag: string;
    fetcher?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    log?: (text: string) => void;
}): Promise<TerritoriesResponse> {
    const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt += 1) {
        const response = await fetcher(options.url, {
            headers: options.storedEtag === "" ? {} : { "If-None-Match": options.storedEtag },
        });
        if (response.status === 304 && options.storedEtag !== "") {
            return { kind: "not_modified", etag: options.storedEtag };
        }
        const text = await response.text();
        if (isDataChanging(response.status, text) && attempt < TERRITORIES_MAX_RETRIES) {
            const wait = retryAfterMs(response.headers.get("retry-after"));
            options.log?.(`   503 data_changing: Legacy bewegt die Gebiete, warte ${String(wait / 1000)} s`);
            await sleep(wait);
            continue;
        }
        if (!response.ok) {
            throw new Error(`${options.url}: HTTP ${String(response.status)}`);
        }
        return { kind: "fresh", text, etag: response.headers.get(TERRITORIES_ETAG_HEADER) };
    }
}

/** Wie lange `Retry-After` warten heisst, in Millisekunden; ohne lesbaren Wert die 10 Sekunden aus der Antwortdatei. */
export function retryAfterMs(header: string | null): number {
    const seconds = header === null ? Number.NaN : Number(header.trim());
    return (Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) : 10) * 1000;
}

/** `map<rev>-eco<rev>-list<datum>`, wie in den bisherigen Satzdateien (ops/deploy/snapshots/). */
export function buildSetName(mapRevision: number, ecosystemRevision: number, at: Date = new Date()): string {
    if (!Number.isFinite(mapRevision) || mapRevision <= 0) {
        throw new Error(`ungueltige map_revision: ${String(mapRevision)}`);
    }
    if (!Number.isFinite(ecosystemRevision) || ecosystemRevision <= 0) {
        throw new Error(`ungueltige ecosystem_revision: ${String(ecosystemRevision)}`);
    }
    const datum = `${String(at.getFullYear())}${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
    return `map${String(Math.trunc(mapRevision))}-eco${String(Math.trunc(ecosystemRevision))}-list${datum}`;
}

/** Fuer den Bericht: `<satz>-<hhmm>`, weil "zieh mal" mehrfach am selben Tag vorkommen darf. */
export function buildReportStamp(at: Date = new Date()): string {
    return `${String(at.getHours()).padStart(2, "0")}${String(at.getMinutes()).padStart(2, "0")}`;
}

export function sha256Hex(data: Buffer | string): string {
    return createHash("sha256").update(data).digest("hex");
}

export interface RegionsFileStatus {
    present: boolean;
    path: string;
    /** Alter in Minuten seit der letzten Aenderung, nur gesetzt wenn `present`. */
    ageMinutes?: number;
}

/**
 * Ob die per Editor-Export abgelegte Regionsdatei da ist - der einzige der drei Quellen ohne
 * oeffentlichen Endpunkt (Auftrag `project-control/legacy-requests/2026-09-28-oeffentlicher-
 * regions-export.md` liegt beim Betreiber). Prueft nur Vorhandensein und Alter, nicht den Inhalt.
 */
export function regionsFileStatus(path: string, now: Date = new Date()): RegionsFileStatus {
    if (!existsSync(path)) {
        return { present: false, path };
    }
    const stat = statSync(path);
    const ageMinutes = Math.max(0, Math.round((now.getTime() - stat.mtimeMs) / 60000));
    return { present: true, path, ageMinutes };
}

/**
 * Ab wann eine schon liegende Regionsdatei als zu alt gilt, um sie ungefragt zu nehmen - grosszuegig
 * bemessen (Legacy wird oft ueber Stunden weiterredigiert, siehe der Fund vom 2026-09-28 mit einer
 * verschwundenen Gebirgsflaeche binnen 70 Minuten), aber nicht "von letzter Woche".
 */
export const REGIONS_FILE_STALE_AFTER_MINUTES = 180;

export interface ImportStepReport {
    label: string;
    /** Wie das CLI es meldet: created+updated+retired > 0 heisst "hat etwas veraendert". */
    changed: boolean;
    summary: string;
}

/**
 * Ein Feld eines migrate:*-Berichts (created/updated/unchanged/retired oder aehnlich) in eine
 * einzelne Zeile fuer den Bericht - so muss `legacy-update-cli.ts` nicht fuer jeden Importer eigene
 * Druckcode-Zeilen haben.
 */
export function summarizePhase(
    name: string,
    phase: { created?: number; updated?: number; unchanged?: number; retired?: number },
): string {
    const parts: string[] = [];
    if (phase.created !== undefined) parts.push(`${String(phase.created)} neu`);
    if (phase.updated !== undefined) parts.push(`${String(phase.updated)} geaendert`);
    if (phase.unchanged !== undefined) parts.push(`${String(phase.unchanged)} unveraendert`);
    if (phase.retired !== undefined) parts.push(`${String(phase.retired)} stillgelegt`);
    return `${name}: ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------------------------
// Kriterien der Idempotenzprobe (Hardening Review M5, 2026-09-28): vier Vergleiche, die bisher inline
// in `runPipeline` (legacy-update-cli.ts) lagen und deshalb nie getestet waren - dort laesst sich
// ohne Datenbank und `fetch` nichts unit-testen, hier schon.
// ---------------------------------------------------------------------------------------------

/**
 * I7: `derivePathRuns` loescht und rechnet jeden Lauf komplett neu, ohne eigenes "unveraendert" (anders
 * als path-visuals/derive:runs). "Geaendert" heisst deshalb wie in `staging-import.sh` (`idempotence()`,
 * "Wegnamen-Schriftlaeufe, zweiter Lauf"): die gemeldeten Zahlen weichen vom letzten Lauf ab. Vorher
 * meldete die CLI hier unbedingt `true` - der zweite Lauf sah dadurch immer wie "geaendert" aus. Ohne
 * vorherigen Lauf (erster Lauf) gibt es nichts zum Vergleichen; `true` ist dort folgenlos, weil der
 * erste Lauf im Bericht nie nach `changed` gefiltert wird.
 */
export function pathRunsChanged(summary: string, previousSummary: string | undefined): boolean {
    return previousSummary === undefined ? true : previousSummary !== summary;
}

/**
 * I11: Kriterium des zweiten Laufs wie Stage (`idempotence()`, "Gelaende ableiten"): unveraendert nur,
 * wenn NICHTS gerechnet wurde - weder Raster noch Wegprofile - und keine neue Revision entstand. Vorher
 * zaehlte hier nur `revisionChanged`, ein Teilrechenlauf ohne neue Revision waere so als unveraendert
 * durchgerutscht.
 */
export function terrainDeriveChanged(report: {
    computed: number;
    revisionChanged: boolean;
    profiles: { computed: number };
    domain?: { computed: boolean };
}): boolean {
    return (
        report.computed > 0 ||
        report.revisionChanged ||
        report.profiles.computed > 0 ||
        report.domain?.computed === true
    );
}

/**
 * I11: `ok` nur, wenn kein Gebirge im Worker fehlschlug (`report.failed`, bisher ungeprueft) UND die
 * Invarianten des Verifiers halten.
 */
export function terrainDeriveOk(failedCount: number, verifyPassed: boolean): boolean {
    return failedCount === 0 && verifyPassed;
}

/**
 * I12: Kriterium des zweiten Laufs wie Stage (`idempotence()`, "Relief"): unveraendert nur, wenn NICHT
 * gerechnet wurde (`computed=false`) und keine neue Revision entstand.
 */
export function reliefChanged(report: { computed: boolean; revisionChanged: boolean }): boolean {
    return report.computed || report.revisionChanged;
}

/** I13 (WI-0055): dasselbe Kriterium wie das Relief - gerechnet oder eine neue Revision heißt „geändert“. */
export function displayHeightsChanged(report: { computed: boolean; revisionChanged: boolean }): boolean {
    return report.computed || report.revisionChanged;
}

/**
 * Quellen: Die Antworten von Legacy tragen nach zwei Abrufen verschiedene Revisionen („Legacy wird gerade redigiert“).
 * Früher brach der Zug hier ab; seit 2026-10-03 (Betreiber: „A auch für die Prüfungen“) geht er mit den zuletzt geholten
 * Dateien weiter, und der Bericht nennt die Revisionen. Unvollständige Antworten (`truncated`, `ok`, leere Liste) halten
 * weiter an.
 */
export function revisionMismatchFinding(seen: string, revisions: Record<string, number | undefined>): Finding {
    return createFinding(
        "quellen_stand",
        `Die Legacy-Antworten tragen nach zwei Abrufen verschiedene Staende (${seen}); Legacy wird gerade redigiert. Der Zug geht mit den zuletzt geholten weiter`,
        Object.fromEntries(Object.entries(revisions).map(([key, value]) => [key, value ?? "fehlt"])),
    );
}

/**
 * I8: der Befund des Kraftlinien-Probelaufs. Früher ein Tor („stillgelegt 0“, wie `staging-import.sh` I8), das den Zug
 * anhielt; seit 2026-10-03 (Betreiber: nur Prüfungen, die er definiert hat, halten einen Zug an) meldet es nur: wie viele
 * Kraftlinien und Kraftlinienpunkte der Lauf stilllegt, mit Tabelle, öffentlicher ID und Name. Ohne Stilllegung kein Befund.
 */
export function powerlineProbeFinding(probe: {
    retired: number;
    nodices: { retired: number };
    retiredObjects: readonly FindingObject[];
}): Finding | undefined {
    if (probe.retired === 0 && probe.nodices.retired === 0) return undefined;
    return createFinding(
        "kraftlinien_probelauf",
        `Der Probelauf legt ${String(probe.retired)} Kraftlinien und ${String(probe.nodices.retired)} Kraftlinienpunkte still ` +
            "(frueheres Tor: 0, wie staging-import.sh I8); der Lauf geht weiter",
        { powerlines: probe.retired, nodix: probe.nodices.retired },
        probe.retiredObjects,
        probe.retired + probe.nodices.retired,
    );
}

/** Die Häfen ohne Anlegestelle nach Namen, wie ein Mensch sie in einer Liste sucht. */
function landlessByName(ports: readonly LandlessPort[]): LandlessPort[] {
    return [...ports].sort((a, b) => a.name.localeCompare(b.name, "de") || a.id.localeCompare(b.id));
}

/**
 * I9 (WI-0060): die Häfen ohne Wasser-Zugang als Befund. Findet die Regel H1 keine Anlegestelle, fehlt der Hafen im
 * Seegraphen und ist per Schiff nicht erreichbar, bis die Redaktion ihn an Meer oder See bindet. Kein Tor (Betreiber
 * 2026-10-03), keine Kartenänderung. Ohne solchen Hafen kein Befund.
 */
export function landlessPortsFinding(ports: readonly LandlessPort[], settings: LandlessSettings): Finding | undefined {
    if (ports.length === 0) return undefined;
    const sorted = landlessByName(ports);
    return createFinding(
        "hafen_ohne_wasser",
        `${String(ports.length)} Häfen ohne Wasser-Zugang: im Seegraphen ohne Anlegestelle, per Schiff nicht erreichbar (WI-0060); der Lauf geht weiter`,
        { haefen: ports.length },
        sorted.map((port) => ({ table: "place", publicId: port.id, name: port.name })),
        ports.length,
        sorted.map((port) => `${port.name}: ${describeLandless(port, settings)}`),
    );
}

/**
 * Der kurze Abschnitt „Häfen ohne Wasser-Zugang“ im Bericht von `legacy:update`: Zahl, dann je Hafen Name, Kennung und
 * Grund (Betreiber 2026-10-09: „wenn du ne liste hast, kannst du sie in täglicher bericht posten“). `withLanding` ist die
 * Zahl der Häfen mit Anlegestelle aus demselben Lauf.
 */
export function landlessPortsSection(
    ports: readonly LandlessPort[],
    withLanding: number,
    settings: LandlessSettings,
): string[] {
    const lines = ["## Häfen ohne Wasser-Zugang (Befund, der Zug lief weiter)", ""];
    if (ports.length === 0) {
        lines.push(`Keiner: alle ${String(withLanding)} Häfen haben eine Anlegestelle.`, "");
        return lines;
    }
    lines.push(
        `**${String(ports.length)}** von ${String(ports.length + withLanding)} Häfen haben keine Anlegestelle und sind per Schiff nicht erreichbar, ` +
            `bis die Redaktion sie an Meer oder See bindet (Regel H1: befahrbares Wasser höchstens ${String(settings.landingReach ?? LANDING_REACH)} E vom Hafen; ` +
            "E = Karteneinheit, 3 Meilen; WI-0060).",
        "",
        "| Hafen | Kennung | Grund |",
        "|---|---|---|",
    );
    const cell = (text: string): string => text.replaceAll("|", "\\|");
    for (const port of landlessByName(ports)) {
        lines.push(`| ${cell(port.name)} | ${port.id} | ${cell(describeLandless(port, settings))} |`);
    }
    lines.push("");
    return lines;
}

/**
 * I20 und I21: Der Abruf eines Katalogs ist OPTIONAL (Vertraege `literature.yaml` und `citymaps.yaml`, `quelle.quellenpruefung`):
 * Faellt er aus oder ist die Antwort kein JSON, entfaellt nur sein Schritt, mit diesem Befund. Kein neues Tor: die Quelle fehlt, es
 * wird nichts geschrieben und nichts stillgelegt, der Zug geht weiter.
 */
export function catalogFetchFailureFinding(file: string, reason: string): Finding {
    return createFinding(
        "source_block_missing",
        `${file}: der Abruf ist gescheitert oder die Antwort ist kein JSON (${reason}); der Schritt entfaellt, nichts wird geschrieben oder stillgelegt, der Zug geht weiter`,
        { datei: file, grund: reason },
    );
}

/** I20 und I21: ohne Zuruf des Betreibers wird nichts abgerufen (Betreiber 2026-09-28: Legacy live auf Zuruf). */
export function catalogNotFetchedFinding(file: string): Finding {
    return createFinding(
        "source_block_missing",
        `${file}: kein Abruf in diesem Zug (er braucht den Zuruf des Betreibers); der Schritt entfaellt, nichts wird geschrieben oder stillgelegt`,
        { datei: file, grund: "kein Abruf" },
    );
}

/** Der Abruf loest in Legacy Schemaheilung (CREATE und ALTER) aus, bei `citymaps.php` zusaetzlich die einmalige Rueckfuellung color_mode: Information. */
export function legacyGetSelfHealsFinding(file: string): Finding {
    return createFinding(
        "legacy_get_self_heals",
        `${file}: der Abruf loest in Legacy Schemaheilung (CREATE und ALTER) aus${file === "citymaps.json" ? ", dazu die einmalige Rueckfuellung color_mode" : ""}; Daten werden nicht geschrieben (Information, bis die Legacy-Sitzung den GET lesend macht)`,
        { datei: file },
    );
}
