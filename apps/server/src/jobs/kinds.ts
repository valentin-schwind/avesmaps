import {
    ABZUG_JOB_ART,
    ABZUG_PHASEN,
    FREIGABE_JOB_KIND,
    FREIGABE_PHASEN,
    RELEASE_TEST_JOB_KIND,
    WIKI_DUMP_HOLEN_ART,
    WIKI_DUMP_HOLEN_PHASEN,
    type FreigabePhase,
    type JobsConfig,
} from "@avesmaps3d/shared";
import type { JobOrigin } from "@avesmaps3d/shared";
import { SPRACHE_MISCH_PHASE, SPRACHE_TREFFER_JOB_KIND, SPRACHE_TREFFER_PHASEN } from "../sprachen/treffer-auftrag.ts";

/**
 * Der Katalog der Jobarten (JOBS-0001 4.4). Etappe 2 (WI-0125) bringt die Gelände-Jobs. In Etappe 1 gab es drei: `probe` (Selbsttest für Tests und das Messtor),
 * `import` (aufgezeichnet: der tägliche Zug, `legacy:update`, die Rollout-Ableitungen) und die Marke `rollout`
 * (aufgezeichnet: der Korridor schaltet gerade die Server um). Gelände-Jobs kommen mit Etappe 2. Dazu kommt `media_derive`
 * (WI-0063 MEDIA-M7): die Rasterpipeline der Medien, ein gewöhnlicher Job in der Queue. Und `auth_retention` (WI-0120 A12): die
 * tägliche Aufbewahrung der Anmeldedaten, aufgezeichnet.
 *
 * Jeder Slot nimmt nur Arten an, die er KENNT (`kind` und `kind_version`) und lässt fremde Zeilen unberührt, statt sie scheitern zu
 * lassen: So können zwei Versionen nebeneinander laufen (Blue/Green).
 */

export interface JobKindSpec {
    kind: string;
    version: number;
    /** `queued`: der Worker holt und rechnet ihn. `recorded`: ein bestehender Ablauf meldet sich selbst. */
    origin: JobOrigin;
    /** Threads je Job; fehlt der Wert, gilt `config.threads[kind]`, sonst unbekannt (die Art läuft allein). */
    threads: number | null;
    /** Hält der Job die geteilte Sperre der Kartendomäne, solange er läuft (die exklusiven Ableitungen weichen)? */
    holdsSharedDomainLock: boolean;
    /**
     * Belegt ein laufender Job dieser Art einen Platz in der Zulassung (Bereich, Parallelität, Threads, Speicher)? Fehlt der
     * Wert, ja.
     *
     * 🔴 `false` nur für Läufe, die BEOBACHTEN und nichts rechnen: die Marke `rollout` und die Auslieferung `stage_rollout`
     * (dazu die Freigabe und die Prüfung nach dem Push, die außerhalb der Warteschlange rechnen; Begründung an ihrer Art).
     * Sie tragen den Fußabdruck `domain` (jeder aufgezeichnete Lauf tut das), und `domain` überlappt alles — stünde so ein Lauf
     * in der Zulassung, wartete jeder Job hinter ihm. Bei `stage_rollout` wäre das ein Stillstand mit Ansage: Die Auslieferung
     * wartet auf die Geländerechnung, und die Geländerechnung wartete auf die Auslieferung.
     */
    claimsSlot?: boolean;
    /**
     * Die Phasen dieser Art in ihrer Reihenfolge, mit grobem Fortschritt (0 bis 1). Daraus nimmt der Recorder den Anteil, wenn
     * der Aufrufer keinen nennt; eine fremde Phase lässt den Anteil stehen (wie `job_sync_phase`, Migration 0098). Eine Art ohne
     * diese Tafel meldet ihren Fortschritt selbst oder gar nicht.
     */
    phases?: readonly { readonly name: string; readonly progress: number }[];
    /** Der Speicherschlüssel in `memExpectedMb`, `memReportWarnMb` und `expectedDurationS`; `null`: kostet nichts. */
    memoryKey(input: Record<string, unknown>, phase: string | null): string | null;
    /**
     * Eine eigene Erwartung aus der Eingabe (der Ballast einer Probe), in MB. Sie hat Vorrang vor der Tafel des Profils:
     * Die Probe KENNT ihren Ballast, die Queue rät nichts.
     */
    expectedMb?(input: Record<string, unknown>, config: JobsConfig): number | null;
    /**
     * Eine eigene erwartete Dauer aus der Eingabe, in Sekunden (der Release-Test kennt sie aus seinen früheren Läufen). Sie gilt, solange die
     * Art keinen Verlauf hat, und vor dem Startwert des Profils; `null`: keine.
     */
    expectedDurationS?(input: Record<string, unknown>): number | null;
    /** Lernt die Erwartung aus den letzten Läufen (nur nach oben, 4.7)? */
    learnsFromHistory: boolean;
    /**
     * Umgebungsvariablen, die der Job-Prozess dieser Art zusätzlich bekommt. Eine Variable, die der Aufseher selbst gesetzt
     * hat (etwa in der Unit), gewinnt: der Betrieb entscheidet, die Art liefert nur den Vorgabewert.
     */
    childEnv?: Readonly<Record<string, string>>;
}

/** Wie viel Ballast eine Probe höchstens anlegt (MB): die Probe läuft im Messwerkzeug, nicht frei. */
export const PROBE_MAX_BALLAST_MB = 4096;

function asNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Die Probe: schläft in Phasen, legt Speicherballast an (in Schritten von 256 MB, wie im Messwerkzeug), stürzt auf Wunsch
 * ab. Ihre Erwartung ist der Ballast plus der Grundbedarf eines Node-Prozesses (`memExpectedMb.probe_base`, Claudio:
 * 41 MB): Sie KENNT sie, also steht kein Befund `budget_exceeded` an jeder Probe.
 */
const probe: JobKindSpec = {
    kind: "probe",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => null,
    expectedMb: (input, config) => {
        const ballast = asNumber(input["ballastMb"]) ?? 0;
        const understate = asNumber(input["understateMb"]) ?? 0;
        const base = config.memExpectedMb["probe_base"];
        // Ohne Grundbedarf im Profil ist die Erwartung unbekannt: die Probe läuft dann allein.
        if (base === undefined) return null;
        return Math.max(0, Math.round(ballast + base - understate));
    },
    learnsFromHistory: false,
};

/** Phasen des Imports (Schritte I1 bis I19), die mehr kosten als der Rest: I11 Gelände, I13 Anzeigehöhen, I19 Landflächen. */
const IMPORT_PHASE_KEYS: Readonly<Record<string, string>> = {
    I11: "terrain_full",
    I13: "display_heights",
    I19: "land_smooth",
};

const importKind: JobKindSpec = {
    kind: "import",
    version: 1,
    origin: "recorded",
    threads: null,
    holdsSharedDomainLock: false,
    memoryKey: (_input, phase) => (phase !== null ? (IMPORT_PHASE_KEYS[phase] ?? "import") : "import"),
    learnsFromHistory: false,
};

const rollout: JobKindSpec = {
    kind: "rollout",
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    // Die Marke ist kein Job mit Bedarf: sie wirkt allein über `rolloutActive` (JOBS-0001 4.5 Bedingung 5).
    claimsSlot: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/** Die Jobart der Auslieferung auf die Stage und die Kennung ihres Laufs (eine je Umgebung, `external_ref`). */
export const STAGE_ROLLOUT_KIND = "stage_rollout";
export const STAGE_ROLLOUT_REF = "stage-rollout";

/**
 * Die Phasen der Auslieferung (Claudio, `handovers/2026-10-13-auslieferung-in-der-warteschlange.md`), in der Reihenfolge, in der
 * `ops/deploy/auto-stage.sh` sie durchläuft. Der Anteil ist grob, wie bei den Abgleichen (Betreiber 2026-10-10: „grob reicht,
 * einfach ein fortschrittsbalken“):
 *
 * - `wartet`: der Stand ist gebaut-bereit, aber ein Job läuft (Geländerechnung) — der Grund steht als Freitext in `wait_reason`
 *   und wird bei jedem Takt (10 min) neu gemeldet, was zugleich das Lebenszeichen ist;
 * - `bauen`: `build-release.sh`; `migrieren`: `corridor-migrate` und `postmigrate`; `umschalten`: `corridor-release install`
 *   (dabei setzt der Korridor zusätzlich die kurze Marke `rollout`); `proben`: Readiness, Routenproben, Journal.
 */
export const STAGE_ROLLOUT_PHASES = [
    { name: "wartet", progress: 0.05 },
    { name: "bauen", progress: 0.3 },
    { name: "migrieren", progress: 0.5 },
    { name: "umschalten", progress: 0.7 },
    { name: "proben", progress: 0.9 },
] as const;

/**
 * Die Auslieferung eines Stands auf die Stage als aufgezeichneter Job (WI-0143; Betreiber 2026-10-13: „sie soll auch in der
 * warte schlange angezeigt werden, dafür ist die doch da. für jobs, die länger brauchen“).
 *
 * `auto-stage.sh` meldet sich selbst — Start, Phasen, Ende —, damit die Auslieferung mit Stand, Feature-Liste und Wartezeit auf
 * der Statusseite steht wie jeder lange Job. Sie rechnet nichts in der Queue (`threads: 0`, kein Speicherschlüssel) und belegt
 * keinen Platz (`claimsSlot: false`): Der Rollout stellt sich HINTER die Warteschlange, er stellt sich nicht in sie.
 *
 * Die vorhandene Marke `rollout` bleibt, was sie ist (Q3): das kurze Fenster des Umschaltens, in dem die Zulassung nur Jobs bis
 * 300 MB zulässt. `stage_rollout` ist die ganze Auslieferung von außen gesehen, `rollout` der Augenblick in ihrer Mitte.
 */
const stageRollout: JobKindSpec = {
    kind: STAGE_ROLLOUT_KIND,
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    claimsSlot: false,
    memoryKey: () => null,
    learnsFromHistory: false,
    phases: STAGE_ROLLOUT_PHASES,
};

/**
 * Der grobe Fortschritt je Phase einer Production-Freigabe (WI-0204); die Namen stehen in `FREIGABE_PHASEN` (shared), damit Abholer,
 * Route und Oberfläche dieselben benutzen. `zurueck` steht beim Umschalten: Ein Rückweg ist dort, wo eine Freigabe umschaltet.
 */
const PRODUCTION_FREIGABE_PROGRESS: Readonly<Record<FreigabePhase, number>> = {
    abgeholt: 0.05,
    vorbereiten: 0.2,
    migrieren: 0.4,
    rechte: 0.55,
    umschalten: 0.7,
    zurueck: 0.7,
    proben: 0.9,
};

/**
 * Die Production-Freigabe als aufgezeichneter Job (WI-0204; Betreiber 2026-10-16 zum Knopf „Alles nach Production“: „also
 * fortschritt und live aktualisiert, wie der stand ist“).
 *
 * Claudios Abholer (`ops/production/freigabe-abholer.sh`) meldet Start, Phasen und Ende in der Datenbank der STAGE, mit dem Ref
 * `freigabe-<OPS>`; die Route der Freigabe liest den Job zum Vorgang. Wie `stage_rollout` beobachtet er nur: Der Korridor arbeitet
 * außerhalb der Warteschlange, also belegt der Lauf keinen Platz (`claimsSlot: false`) und hält keinen Job auf.
 *
 * Seit WI-0248 (Vali 2026-10-26) kündigt der Knopf den Lauf an: In derselben Transaktion wie der Vorgang steht ein Auftrag mit der Person als
 * `QUEUED` (Herkunft `recorded`, Grund `waits_pickup`, `freigabe_auftrag_einreihen`, Migration 0228). Der Dirigent plant ihn nicht (nur `queued`),
 * die Schätzung rechnet ihn nicht. Claudios `record start` übernimmt ihn (`uebernimmAngekuendigt`); erlischt der Vorgang vorher, endet er als
 * `CANCELLED` (Auslöser `freigabe_auftrag`).
 */
const productionFreigabe: JobKindSpec = {
    kind: FREIGABE_JOB_KIND,
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    claimsSlot: false,
    memoryKey: () => null,
    learnsFromHistory: false,
    phases: FREIGABE_PHASEN.map((name) => ({ name, progress: PRODUCTION_FREIGABE_PROGRESS[name] })),
};

/** Die Jobart der Prüfung nach dem Push; ihr Lauf heißt `pruefung-<sha8>` (`external_ref`), nur in der Stage. */
export const PRUEFUNG_NACH_PUSH_KIND = "pruefung_nach_push";

/**
 * Die Schritte der Prüfung in der Reihenfolge von `ops/deploy/pruefung-nach-push.sh` (Claudio,
 * `handovers/2026-10-17-pruefung-nach-push-gebaut-an-claudia.md`); der erste rote beendet den Lauf. Der Anteil ist grob, die Tests
 * brauchen die meiste Zeit.
 */
export const PRUEFUNG_NACH_PUSH_PHASES = [
    { name: "bauen", progress: 0.05 },
    { name: "format", progress: 0.1 },
    { name: "lint", progress: 0.2 },
    { name: "typecheck", progress: 0.35 },
    { name: "tests", progress: 0.5 },
] as const;

/**
 * Die Prüfung nach dem Push als aufgezeichneter Job (Betreiber 2026-10-16 auf Review-Frage 2: „nein die prüfung geschieht auf
 * dem server, aber sie muss stattfinden und als ergebnis an die glocke gehen“; Andocken an die Warteschlange 2026-10-17,
 * Koordination auf Claudios Vorschlag). `auto-stage.sh` stößt sie in seinem Ruhefenster an, und sie meldet sich selbst wie die
 * Auslieferung: Start, Schritte, Ende. Das Urteil geht weiter allein über die Glocke (`pruefung_rot`, `pruefung_gruen`).
 *
 * Sie rechnet, aber außerhalb der Warteschlange und nur, wenn dort nichts wartet; den Speicher hält ihr Skript selbst (startet
 * erst ab 2500 MB frei, bricht unter 1200 MB ohne Urteil ab). Deshalb belegt sie keinen Platz (`claimsSlot: false`): Stünde sie
 * mit dem Fußabdruck `domain` in der Zulassung, wartete jeder Job rund 20 Minuten hinter einer Prüfung, die nichts anhalten darf.
 */
const pruefungNachPush: JobKindSpec = {
    kind: PRUEFUNG_NACH_PUSH_KIND,
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    claimsSlot: false,
    memoryKey: () => null,
    learnsFromHistory: false,
    phases: PRUEFUNG_NACH_PUSH_PHASES,
};

/**
 * Der Release-Test des Entwicklungsrechners als Auftrag der lokalen Warteschlange (WI-0248; Vali 2026-10-26: der Release-Test wird ein schwerer
 * Auftrag, damit kein Gelände neben ihm rechnet und ihn wacklig macht; `jobs/release-test-job.ts`). Eingereiht von „Release-Test starten“ und „Rote
 * Teile wiederholen“ der lokalen Systemsteuerung (`release_test_einreihen`, Migration 0228), mit der Person.
 *
 * Der Ausführer rechnet nichts: Er ruft den Starter des Release-Tests (`scripts/dev/release-abholer.ts`) abgelöst und folgt dem Stand des Runners, bis
 * der Lauf endet. Schritt, Anteil und Restzeit des Runners werden Phase, Fortschritt und `eta_at` des Auftrags. Der Lauf selbst überlebt den Ausführer
 * (abgelöst); ein Neustart des Dirigenten gibt den Auftrag zurück, und der nächste Ausführer hängt sich an denselben Lauf.
 *
 * 🔴 **Unbekannt heißt allein.** Threads und Speicher stehen bewusst nicht im Profil: Neben dem Test (zwei Browser-Worker, eigener Martin, eigene
 * Datenbank) startet kein anderer Auftrag des Rechners, und solange ein anderer läuft, wartet er. Schwer ist er ohnehin (nicht in `LEICHTE_ARTEN`).
 * Keine Domänensperre: Er fasst die Daten des Rechners nicht an, er prüft gegen Wegwerf-Datenbanken.
 */
const releaseTest: JobKindSpec = {
    kind: RELEASE_TEST_JOB_KIND,
    version: 1,
    origin: "queued",
    threads: null,
    holdsSharedDomainLock: false,
    // Ein eigener Schlüssel ohne Wert im Profil: Die Erwartung ist unbekannt (nicht 0), also kein Befund `budget_exceeded` am Ausführer, der nur
    // dem Runner folgt, und die Zulassung lässt ihn allein laufen.
    memoryKey: () => "release_test",
    expectedDurationS: (input) => {
        const erwartet = asNumber(input["erwartetS"]);
        return erwartet !== null && erwartet > 0 ? erwartet : null;
    },
    learnsFromHistory: false,
};

/** Der Speicherschlüssel der Kartensammlung im Vollbild (`map_full`): verlustfrei und ohne Verkleinerung, der teuerste Fall. */
export const MEDIA_DERIVE_FULL_KEY = "media_derive_map_full";

/**
 * Die Rasterpipeline der Medien (WI-0063 MEDIA-M7, `jobs/media-derive.ts`): ein Bild prüfen, in sein Profil rendern, ablegen.
 *
 * Claudio (`handovers/2026-10-04-media-m7-sharp-antwort.md`): Jobart in DERSELBEN Queue, damit es EINE Speichergrenze gibt und die
 * Zulassung einen Bildauftrag neben `terrain_full` verhindert; `sharp.concurrency(1)` (im Code der Pipeline) und ein kleiner
 * `UV_THREADPOOL_SIZE`, sonst nimmt sich libvips jeden Kern. Die Erwartung (`memExpectedMb`), die Threads und die Parallelität
 * stehen im Profil (`config/jobs/`); fehlt der Wert, läuft die Art allein.
 *
 * Zwei Speicherschlüssel, weil die Rollen verschieden viel kosten (lokal gemessen, Kindprozess, `concurrency(1)`): ein Wappen,
 * Kopfbild, eine Vorschau oder ein Cover bis 16 MP braucht rund 100 bis 120 MB Spitze; `map_full` (Pixel erhalten, verlustfrei
 * kodiert, 16 MP) rund 480 MB, denn der verlustfreie Kodierer hält das ganze Bild.
 */
const mediaDerive: JobKindSpec = {
    kind: "media_derive",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: (input) => (input["role"] === "map_full" ? MEDIA_DERIVE_FULL_KEY : "media_derive"),
    // Größere Bilder kosten mehr: die Queue lernt die Erwartung nur nach oben.
    learnsFromHistory: true,
    childEnv: { UV_THREADPOOL_SIZE: "2" },
};

/**
 * Der Abgleich der Dateien eines Assets (WI-0068 P4a, `jobs/media-settle.ts`): dieselbe Rasterpipeline wie `media_derive`, also
 * dieselben Speicherschlüssel und dieselbe Thread-Grenze; dazu schreibt er seine Zeilen selbst (`media_file`, `technical_state`).
 * Eingereiht von den Operationen der Medienverwaltung, mit der Person als Auslöser.
 */
const mediaSettle: JobKindSpec = {
    kind: "media_settle",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: (input) => (input["role"] === "map_full" ? MEDIA_DERIVE_FULL_KEY : "media_derive"),
    learnsFromHistory: true,
    childEnv: { UV_THREADPOOL_SIZE: "2" },
};

/**
 * „Vorschau erzeugen“ (WI-0287 Punkt 5, `jobs/kartenvorschau-job.ts`): das Original einer erzeugten Kartenvorschau aus ihrer Karte rechnen und den Abgleich einreihen.
 * Dieselbe Rasterpipeline wie `media_settle`, also derselbe Speicherschlüssel und dieselbe Thread-Grenze. Er liest eine Kartendatei (bis 50 MB, ein PDF bis 16 MP auf der
 * ersten Seite) und schreibt eine kleine Datei (WebP, lange Kante 1200 px), verlustbehaftet wie jede Vorschau: Der Schlüssel `media_derive` (nicht der der verlustfreien
 * Vollkarte) trägt ihn, die Queue lernt nach oben. Eingereiht von der Operation mit der Person als Auslöser.
 */
const kartenvorschauErzeugen: JobKindSpec = {
    kind: "citymap_preview_generate",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => "media_derive",
    learnsFromHistory: true,
    childEnv: { UV_THREADPOOL_SIZE: "2" },
};

/**
 * Die Aufbewahrung der Anmeldedaten (WI-0120 A12, `auth/retention.ts`): einmal am Tag ein Aufruf von
 * `avesmaps_auth.purge_expired()`. Aufgezeichnet, nicht gerechnet: Der Worker ruft die Funktion selbst und meldet Start und Ende, damit
 * sie auf der Statusseite steht (Claudio 2026-10-09). Sie kostet keinen nennenswerten Speicher und hält keine Sperre der Kartendomäne.
 */
const authRetention: JobKindSpec = {
    kind: "auth_retention",
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Die Aufbewahrung des Betreiber-Kanals (WI-0124, `kanal/aufbewahrung.ts`, KANAL-0001 §3.1): einmal am Tag die fälligen Bilder löschen
 * und abgelaufene Meldungen auf ihren Rest leeren. Aufgezeichnet wie `auth_retention`, ohne Sperre der Kartendomäne.
 */
const kanalAufbewahrung: JobKindSpec = {
    kind: "kanal_aufbewahrung",
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Die Aufbewahrung der Community (WI-0268, `community/aufbewahrung.ts`, Fachkonzept §10.2): einmal am Tag erledigte Vorgänge archivieren,
 * Kontaktdaten nach 90 Tagen entfernen und den Papierkorb nach seiner Frist leeren. Aufgezeichnet wie `kanal_aufbewahrung`, ohne Sperre der
 * Kartendomäne.
 */
const communityAufbewahrung: JobKindSpec = {
    kind: "community_aufbewahrung",
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Eine ausgehende Mail der Community senden (WI-0268 C6a, `jobs/community-mail-job.ts`, Fachkonzept §3.4): ein Aufruf des Mailservers, eine Handvoll Zeilen in der Datenbank (nur über zwei Funktionen der Jobs-Rolle).
 * Leicht, kein Rechnen, keine Karte: kein Speicherschlüssel, keine Sperre der Domäne (`holdsSharedDomainLock: false`), und er wartet nicht hinter einem Legacy-Zug von 20 Minuten. Ein Auftrag je Mail; ein vorübergehender
 * Fehler reiht den nächsten Versuch mit Abstand ein. Akteur `community`, also kein Editor-Job: Eine Kartensperre hält ihn nicht an.
 */
const communityMailVersand: JobKindSpec = {
    kind: "community_mail_versand",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Einen Beitrag des Social Hubs an einen fremden Kanal senden oder dort zurücknehmen (WI-0268 C12a, `jobs/social-senden-job.ts`, Fachkonzept §15.7): ein, höchstens zwei Aufrufe der Instanz (bei einem Bild
 * zuerst das Hochladen), eine Handvoll Zeilen in der Datenbank (nur über zwei Funktionen der Jobs-Rolle) und eine Bilddatei zum Lesen. Für Instagram einmal ein Bild neu kodieren (C12b: die JPEG-Fassung neben der
 * WebP, `sharp`, ein Bild zur Zeit, wie beim Mailabruf). Leicht, keine Karte: kein Speicherschlüssel, keine Sperre der Domäne, kein Warten hinter einem Legacy-Zug. Ein Auftrag je Sendung; ein vorübergehender Fehler
 * reiht den nächsten Versuch mit Abstand ein. Akteur `community`, also kein Editor-Job.
 */
const socialSenden: JobKindSpec = {
    kind: "social_senden",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Das Postfach der Community lesend abholen (WI-0268 C6b, `jobs/community-mail-abruf-job.ts`, Fachkonzept §3.4): höchstens 50 Mails je Lauf, jede wird ein Vorgang oder hängt sich an einen. Ein Aufruf des
 * Mailservers, Bilder neu kodieren (`sharp`, eine Mail zur Zeit), Dateien in die Ablage, Zeilen in die Datenbank über vier Funktionen der Jobs-Rolle. Kein Rechnen auf der Karte: kein Speicherschlüssel, keine Sperre
 * der Domäne, kein Warten hinter einem Legacy-Zug. Die Pflege reiht ihn alle fünf Minuten ein, aber nur, wenn der Abruf konfiguriert ist; Akteur `community`, also kein Editor-Job.
 */
const communityMailAbruf: JobKindSpec = {
    kind: "community_mail_abruf",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Die Aufbewahrung der Reisebilder (WI-0272 S2, `photobox/aufbewahrung.ts`, Fachkonzept §5.5 und §13): einmal am Tag offene Einreichungen nach 60 Tagen
 * verfallen lassen, beendete 30 Tage danach samt Bild und Angaben löschen und danach die Dateien entfernen. Aufgezeichnet wie `community_aufbewahrung`,
 * ohne Sperre der Kartendomäne.
 */
const photoboxAufbewahrung: JobKindSpec = {
    kind: "photobox_aufbewahrung",
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Die Aufbewahrung der Kartenvorschläge (WI-0275 B2, `kartenvorschlag/aufbewahrung.ts`): einmal am Tag nie hochgeladene und gescheiterte Vorschläge nach 7 Tagen,
 * abgelehnte und zurückgezogene nach 30 Tagen samt Werk löschen und danach die Dateien entfernen. Aufgezeichnet wie `photobox_aufbewahrung` (keine queued-Jobart,
 * kein Auftrag für den Wrapper), ohne Sperre der Kartendomäne.
 */
const kartenvorschlagAufbewahrung: JobKindSpec = {
    kind: "kartenvorschlag_aufbewahrung",
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Ein Bildschirmfoto des Betreiber-Kanals neu kodieren (WI-0124, `kanal/bild-job.ts`, KANAL-0001 §6.1): dieselbe Rasterpipeline wie
 * `media_derive`, also derselbe Speicherschlüssel und dieselbe Thread-Grenze; keine Sperre der Kartendomäne, Akteur `kanal`.
 */
const kanalBild: JobKindSpec = {
    kind: "kanal_bild",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => "media_derive",
    learnsFromHistory: true,
    childEnv: { UV_THREADPOOL_SIZE: "2" },
};

/**
 * Das Gelände im Fußabdruck einer Änderung (JOBS-0001 4.4, WI-0125, `jobs/terrain-local-job.ts`): rechnet und legt einen Kandidaten ab,
 * veröffentlicht nichts. Die grobe Stufe läuft voll (R0), deshalb erwartet er wie ein voller Lauf (`terrain_full`, Klasse „voll“, bis
 * Claudio die Klassen nach Zahl der Rechenkacheln misst, MS18). Drei Threads: die Erosion mit 2 Workern plus Hauptthread (WI-0227,
 * Claudio 2026-10-18); V12 läuft davor mit zwei, nie zugleich.
 */
const terrainLocal: JobKindSpec = {
    kind: "terrain_local",
    version: 1,
    origin: "queued",
    threads: 3,
    holdsSharedDomainLock: true,
    memoryKey: () => "terrain_full",
    learnsFromHistory: true,
};

/**
 * Den Kandidaten eines `terrain_local` veröffentlichen (WI-0125, `terrain/domain/local-publish.ts`): Master, Kacheln und Wegprofile
 * des Bereichs in EINER Transaktion. Erwartung wie „nur Veröffentlichen“ (`terrain_publish_only`): der Master liegt zweimal im
 * Speicher (lesen, einsetzen, kodieren), die Pyramide einmal.
 */
const demPublish: JobKindSpec = {
    kind: "dem_publish",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => "terrain_publish_only",
    learnsFromHistory: true,
};

/** Die Höhenlinien und Höhenstufen (I13) als Glied der Kette (WI-0125); in Etappe 2 ohne Entprellung. */
const displayHeights: JobKindSpec = {
    kind: "display_heights",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => "display_heights",
    learnsFromHistory: true,
};

/** Beobachtet nur, ob der Routing-Worker die neue Revision geladen hat (WI-0125): kein Speicher, keine Sperre. */
const routingReload: JobKindSpec = {
    kind: "routing_reload",
    version: 1,
    origin: "queued",
    threads: 0,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Der gesammelte volle Lauf (D6 = B, WI-0125): `derive:terrain` als Job, danach gilt wieder bytegleich der volle Lauf. Er nimmt die
 * EXKLUSIVE Sperre selbst (wie die Kommandozeile); die Queue hält ihn mit dem Bereich `domain` von allen anderen Gelände-Jobs fern.
 *
 * 🔴 Kein Sonderweg mehr (Vali 2026-11-07: „die soll den sonderweg abschaffen“; Claudios `c31c03fde`, Migration 0325): Die App rechnet
 * diese Art in beiden Umgebungen selbst, und die zwei Nachfolger (`routing_reload`, `display_heights`) laufen danach als eigene
 * Aufträge. Bis dahin holte in Production Claudios Abholer sie über den Korridor ab (WI-0154, Migration 0129), und sein Ende schloss
 * die Nachfolger ohne eigenen Lauf mit ab; nach Fassung 19 fehlten dadurch die Anzeigehöhen. Kein `job_sync_*` nimmt sie seit 0325 an.
 */
const terrainFull: JobKindSpec = {
    kind: "terrain_full",
    version: 1,
    origin: "queued",
    // Wie `terrain_local`: Erosion mit 2 Workern plus Hauptthread (WI-0227).
    threads: 3,
    holdsSharedDomainLock: false,
    memoryKey: () => "terrain_full",
    learnsFromHistory: true,
};

/**
 * Die Messung eines Entwurfs des Geländerezepts (WI-0127 SYS-13, SYS-0001 §9c.5): ein voller Generatorlauf im Speicher, nichts
 * veröffentlicht. Bedarf wie der volle Lauf (MS5, 1.400 MB); drei Threads wie der volle Lauf (Erosion mit 2 Workern, WI-0227, Claudio
 * 2026-10-18), das ganze Budget des Hosts, also nie neben dem Zug oder einem anderen Geländejob. Mit einer Person als Auslöser wartet er
 * unter Kartensperre.
 */
const terrainPreview: JobKindSpec = {
    kind: "terrain_preview",
    version: 1,
    origin: "queued",
    threads: 3,
    holdsSharedDomainLock: false,
    memoryKey: () => "terrain_full",
    learnsFromHistory: false,
};

/**
 * Die Quarantäne der Mediendateien (WI-0127 SYS-10 b3, `jobs/media-quarantine-job.ts`): nach einer Umschaltung eines Bilder-Schalters
 * die ganze Menge neu; eine Abfrage über alle Verwendungen und Umbenennungen im Dateisystem, kein Rendern, kaum Speicher.
 */
const mediaQuarantine: JobKindSpec = {
    kind: "media_quarantine",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * „Alle bytegleichen Duplikate zusammenführen“ (WI-0068, Betreiber 2026-10-17; `media-editor/merge-all.ts`): je Gruppe eine kurze
 * Transaktion, keine Rasterarbeit, also leicht (Claudio 2026-10-17). Eingereiht mit der Person als Auslöser: Unter Kartensperre
 * wartet er wie jede Editor-Operation.
 */
const mediaMergeAll: JobKindSpec = {
    kind: "media_merge_all",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Die Aufträge der Abgleiche (WI-0127 SYS-14, SYS-0001 §9b): Der Betreiber drückt in der Verwaltung „⇄ Jetzt abgleichen“, die Route
 * reiht mit der Person als Auslöser ein (`job_enqueue`, Migration 0094), der Handler startet das vorhandene Werkzeug als eigenen
 * Prozess (`abgleiche/job.ts`).
 *
 * - `legacy_pull`: der Zug (`legacy:update --auftrag`), Phasen I1 bis I28 wie der aufgezeichnete `import`, also dieselben
 *   Speicherschlüssel.
 * - `legacy_zug`: derselbe Zug für EINE Kategorie (`legacy:update --kategorie <k> --auftrag`, WI-0141).
 * - `legacy_media`: die Medien aus Legacy (Manifest, Metadaten, Dateien holen, verarbeiten).
 *
 * Beide laufen ALLEIN (Threads unbekannt): neben keinem anderen Job, auch nicht neben einem `legacy:update` auf Zuruf, der sich als
 * `import` aufzeichnet. Die Sperre der Domäne halten sie nicht; der Zug nimmt die exklusiven Sperren seiner Ableitungen selbst, wie
 * auf der Kommandozeile. 🪤 Die Spitze RSS misst der Job-Prozess an sich selbst, nicht am Prozess des Werkzeugs: Die Zahl auf der
 * Statusseite ist für diese Arten zu klein. Unter Kartensperre warten sie nicht (`isEditorJob`, Betreiber 2026-10-10 Frage 3).
 */
const legacyPull: JobKindSpec = {
    kind: "legacy_pull",
    version: 1,
    origin: "queued",
    threads: null,
    holdsSharedDomainLock: false,
    memoryKey: (_input, phase) => (phase !== null ? (IMPORT_PHASE_KEYS[phase] ?? "import") : "import"),
    learnsFromHistory: false,
};

/**
 * Der Legacy-Zug EINER Kategorie (`legacy_zug`, WI-0141; Betreiber 2026-10-13: „knopf legacy zug, aber jede kategorie einzeln“).
 * Dieselbe Art für alle drei Kategorien, unterschieden an der Eingabe (`input_ref.kategorie`): Sie schreiben dieselben Kartentafeln,
 * also darf immer nur einer laufen, und EINE Art in der Warteschlange sagt das von sich aus.
 *
 * Kosten wie `legacy_pull` — der Zug läuft mit denselben Schritten, nur mit weniger davon. Landschaften tragen die Geländekette mit
 * (I10 bis I13) und sind damit die teuerste Kategorie; die Phasenschlüssel sind dieselben.
 */
const legacyZug: JobKindSpec = {
    kind: "legacy_zug",
    version: 1,
    origin: "queued",
    threads: null,
    holdsSharedDomainLock: false,
    memoryKey: (_input, phase) => (phase !== null ? (IMPORT_PHASE_KEYS[phase] ?? "import") : "import"),
    learnsFromHistory: false,
};

const legacyMedia: JobKindSpec = {
    kind: "legacy_media",
    version: 1,
    origin: "queued",
    threads: null,
    holdsSharedDomainLock: false,
    memoryKey: () => "media_derive",
    learnsFromHistory: false,
};

/**
 * Der Production-Zug auf der Stage (`production_pull`, WI-0144; Betreiber 2026-10-14: „ich will auf der stage den button
 * "Production-Zug holen" … für die stage ist production die einzige wahrheit“). Die Route reiht ihn mit der Person als Auslöser
 * ein, Claudios Abholer übernimmt ihn über `job_sync_claim` und spielt Daten, Kacheln und Medien von Production ein
 * (`ops/production/production-zug-abholer.sh`, `corridor-import production-zug`).
 *
 * 🔴 **Er steht bewusst NICHT in `JOB_HANDLERS`.** Rechnen kann ihn nur der Korridor: Production zu lesen hat die Anwendung keinen
 * Weg, und sie soll auch keinen bekommen (dasselbe Argument wie bei der Freigabe-Statusdatei). `ABGLEICHE` lässt für diese Quelle
 * darum kein `worker` zu, und ein verirrter Auftrag endet sauber mit `unknown_kind` (`jobs/child.ts`) statt mit einem halben Zug.
 *
 * Kosten trägt dieser Prozess keine (der Korridor rechnet außerhalb), aber er belegt seinen Platz: `claimsSlot` bleibt Vorgabe,
 * damit während des Zugs keine Geländerechnung auf dieselben Tafeln läuft. Threads unbekannt heißt „läuft allein“.
 */
const productionPull: JobKindSpec = {
    kind: "production_pull",
    version: 1,
    origin: "queued",
    threads: null,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
    phases: [
        { name: "holen", progress: 0 },
        { name: "einspielen", progress: 0.2 },
        { name: "proben", progress: 0.9 },
    ],
};

/**
 * Die Wegprofile nach einer Kartenoperation (WI-0128 E13, `jobs/path-profile-job.ts`; EDIT-0001 N6): rechnet nur die Wege, deren
 * Geometrie sich geändert hat, gegen den geltenden Master. Liest den Master (4.096² Werte) und schreibt Profile; er hält die geteilte
 * Sperre der Domäne, damit ein Import oder eine volle Ableitung nicht unter ihm wechselt. Ohne Wert im Profil (`memExpectedMb`) läuft
 * er allein; den Wert für Stage misst Claudio (N6).
 */
const pathProfile: JobKindSpec = {
    kind: "path_profile",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => "path_profile",
    learnsFromHistory: true,
};

/**
 * Die Folgen einer gespeicherten Landschaft (WI-0178 B3, `jobs/landschaft-folgen-job.ts`): `land_smooth` rundet die geänderten Flächen
 * und ihre Nachbarn, `label_runs` die Schriftläufe einer Region. Beide halten die geteilte Sperre der Domäne wie `path_profile`: Ein
 * Zug oder eine volle Ableitung wartet auf sie, sie warten auf ihn. Leicht und ohne Bereich seit WI-0283, Werte im Profil (`land_smooth`
 * noch der Startwert aus dem vollen Lauf; der Auftrag rundet nie das volle Netz).
 */
const landSmooth: JobKindSpec = {
    kind: "land_smooth",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => "land_smooth",
    learnsFromHistory: true,
};

/**
 * Die Ableitung der Herrschaftsgebiete (WI-0209 B3, `jobs/gebietsableitung-job.ts`): schwer, sie rechnet die ganze Domäne in einer
 * Transaktion neu (Stage 46 s, 95 MB). Sie hält die geteilte Sperre der Domäne wie `land_smooth`: Ein Zug (exklusiv) wartet auf sie,
 * sie auf ihn; ein Speichern im Editor (geteilt) läuft weiter. Speicher, Dauer und Parallelität im Profil nach Claudio (2026-10-17).
 */
const territoryDerive: JobKindSpec = {
    kind: "territory_derive",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => "territory_derive",
    learnsFromHistory: true,
};

/**
 * Die Ableitung des Seegraphen (WI-0153 Schnitt 7b, `jobs/seegraph-job.ts`): schwer, zwei bis fünf Minuten mit rund einem Gigabyte
 * (gemessen 2026-10-17, WI-0153 §11; der Orte-Zug auf der Stage 137 s). Sie hält die geteilte Sperre der Domäne wie
 * `territory_derive`: Ein Zug (exklusiv) wartet auf sie, sie auf ihn. Speicher, Dauer und „einer zur Zeit“ im Profil nach Claudio
 * (2026-10-17); zwei Seegraphen nebeneinander schließt `maxConcurrent` aus, neben `terrain_full` das Speicherbudget.
 */
const seaDerive: JobKindSpec = {
    kind: "sea_derive",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => "sea_derive",
    learnsFromHistory: true,
};

/**
 * Die Treffer der Sprachen (WI-0261 S4, `jobs/sprachen-treffer-job.ts`; Claudio 2026-10-30 §3): je Objekt und Sprache der Anteil, ganz in
 * PostGIS, je Art eine Transaktion (Phasen in `SPRACHE_TREFFER_PHASEN`). Er hält die geteilte Sperre der Domäne wie `territory_derive`: Ein Zug
 * (exklusiv) wartet auf ihn, er auf den Zug, und er liest nie einen halben Import. Speicher, Dauer und „einer zur Zeit“ im Profil nach Claudio §3.
 */
const spracheTreffer: JobKindSpec = {
    kind: SPRACHE_TREFFER_JOB_KIND,
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => SPRACHE_TREFFER_JOB_KIND,
    learnsFromHistory: true,
    // Dahinter die Mischgebiete (S5a), wenn der Umfang Sprachen nennt.
    phases: [...SPRACHE_TREFFER_PHASEN, SPRACHE_MISCH_PHASE].map(({ name, progress }) => ({ name, progress })),
};

/**
 * Eine Kartenserie zerlegen (WI-0220 Schnitt 3, `jobs/map-series-tile-job.ts`): ein hochgeladenes PNG von 8k bis 64k prüfen, in eine
 * WebP-Pyramide schneiden, umschalten. Schwer: gemessen auf dem VPS (Claudio 2026-10-17) 32k in 70 s mit 375 MB, 64k in 350 s mit
 * 780 MB, zwei Threads genügen (das PNG liest sich in einem Strang). Ohne Domänensperre: Er fasst keine Kartendaten an, nur Dateien
 * unter `TILE_ROOT` und zwei Spalten der Tafel `map_series`.
 */
/**
 * Die Vektorkarte zeichnen (WI-0280): liest die Kartendaten einmal, baut die Abzüge im Speicher und legt sie unter `karten-export/` ab. Fasst keine Kartendaten an
 * (Fußabdruck `tiles`), hält also keine Sperre der Domäne.
 */
const kartenSvg: JobKindSpec = {
    kind: "karten_svg",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => "karten_svg",
    learnsFromHistory: true,
    phases: [
        { name: "lesen", progress: 0 },
        { name: "bauen", progress: 0.2 },
        { name: "schreiben", progress: 0.8 },
    ],
};

const mapSeriesTile: JobKindSpec = {
    kind: "map_series_tile",
    version: 1,
    origin: "queued",
    threads: 2,
    holdsSharedDomainLock: false,
    memoryKey: () => "map_series_tile",
    learnsFromHistory: true,
    // Keine eigene Umgebung: Die Threads von libvips begrenzt der Auftrag selbst (`sharp.concurrency(2)`).
};

/**
 * Eine Kartenserie nach Production übernehmen (WI-0220 Schnitt 4; Vorlage Fassung 4, Weg A „von Stage übernehmen“). Die Route der Stage
 * reiht ihn ein (nur die Betreiber, `release_to_production`), Claudios Korridor führt ihn aus: Fassung und Quelle nach Production kopieren
 * und prüfen, dort `kartenserie-uebernehmen` (Einstellungen und Zeiger), Proben.
 *
 * 🔴 **Er steht bewusst NICHT in `JOB_HANDLERS`** (wie `production_pull`): Production gehört einem anderen Dienstbenutzer, und in die
 * Datenbank einer anderen Umgebung schreibt keine Anwendung. Ein verirrter Auftrag endet mit `no_handler`. Kosten trägt dieser Prozess
 * keine (der Korridor kopiert außerhalb); Threads unbekannt heißt „läuft allein“.
 */
const mapSeriesProduction: JobKindSpec = {
    kind: "map_series_production",
    version: 1,
    origin: "queued",
    threads: null,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
    phases: [
        { name: "kopieren", progress: 0 },
        { name: "einspielen", progress: 0.7 },
        { name: "proben", progress: 0.9 },
    ],
};

/**
 * Der Abzug für lokal (WI-0251; Vali 2026-10-24: „ja von stage und production, aber ohne die accounts, statistiken und alle kartendaten auch“).
 * Die Route auf Stage und Production reiht ihn ein (Recht `create_backup`, frischer Passkey), Claudios Korridor führt ihn aus: der Plan aus
 * `scripts/ops/abzug-plan.ts` in EINER lesenden Transaktion, die Tafeln als Tar in die Ablage `ABZUG_ROOT`.
 *
 * 🔴 **Er steht bewusst NICHT in `JOB_HANDLERS`** (wie `production_pull` und `map_series_production`): Die Anwendung exportiert nicht selbst, sie
 * liest keinen Bestand ihrer Datenbank in eine Datei. Ein verirrter Auftrag endet mit `no_handler`. Kosten trägt dieser Prozess keine (der Korridor
 * rechnet außerhalb); Threads unbekannt heißt „läuft allein“.
 */
const abzugLokal: JobKindSpec = {
    kind: ABZUG_JOB_ART,
    version: 1,
    origin: "queued",
    threads: null,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
    phases: ABZUG_PHASEN,
};

/**
 * Das Holen des Wiki-Dumps (WI-0253 §22; Vali 2026-10-27 zu „Dump holen“: „das stimmt ja nicht, wir haben ihn heute mittag zusammen geholt“). Die Route der Systemsteuerung reiht ihn mit der Person als Auslöser
 * ein (Recht `fetch_wiki_dump`, nur der Betreiber; in Production mit frischem Passkey), Claudios Korridor führt ihn aus (`ops/production/wiki-einrichten.sh --dump-holen`: Sperrdatei, Datei mit
 * Endung `.part`, `bzip2 -t`, Umbenennen, zwei Stände bleiben) und meldet Phasen und Ende über `job_sync_phase` und `job_sync_finish` (Migration 0246).
 *
 * 🔴 **Er steht bewusst NICHT in `JOB_HANDLERS`** (wie `production_pull` und `abzug_lokal`): Der Abruf beim Wiki Aventurica und das Schreiben in den Dump-Ordner des Servers gehören dem Korridor, nicht der
 * Anwendung (der Dump-Zugang liegt als Datei nur für root, `wiki-dump.json`). Ein verirrter Auftrag endet mit `no_handler`. Er ist SCHWER (nicht in `LEICHTE_ARTEN`): Der Wrapper hält seine Liste der
 * leichten Arten gleich (Korridor-Test C6p), und das Holen ist selten und kurz. Kosten trägt dieser Prozess keine; Threads unbekannt heißt „läuft allein“.
 */
const wikiDumpHolen: JobKindSpec = {
    kind: WIKI_DUMP_HOLEN_ART,
    version: 1,
    origin: "queued",
    threads: null,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
    phases: WIKI_DUMP_HOLEN_PHASEN,
};

/**
 * Der Papierkorb der Kartenserien nach seiner Frist (WI-0220 Schnitt 4, `map-series/papierkorb.ts`): Kacheln und Quelle einer Serie,
 * die länger als die Frist im Papierkorb liegt, kommen weg. Aufgezeichnet von der Pflege, einmal am Tag, wie `kanal_aufbewahrung`.
 */
const mapSeriesPapierkorb: JobKindSpec = {
    kind: "map_series_papierkorb",
    version: 1,
    origin: "recorded",
    threads: 0,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

const labelRuns: JobKindSpec = {
    kind: "label_runs",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => "label_runs",
    learnsFromHistory: true,
};

/**
 * Die Wegnamen einer Kette nach einer Wege-Operation (WI-0177, `jobs/weg-folgen-job.ts`; Entscheid der Editor-Orchestrierung
 * 2026-10-17): wie `label_runs`, je Kette ein Auftrag mit 10 s Sammelzeit. Belegte Werte liefert Claudio nach den ersten Läufen.
 */
const pathLabelRuns: JobKindSpec = {
    kind: "path_label_runs",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: true,
    memoryKey: () => "path_label_runs",
    learnsFromHistory: true,
};

/**
 * Eine Meldung in der Glocke dieser Umgebung (WI-0163, `jobs/benachrichtigung-job.ts`; Betreiber 2026-10-15: „Meldungen wie „Neu auf
 * Production" sollen über die Warteschlange in die richtige Umgebung gelangen, statt dass Claudio sie direkt einträgt“). Ein einziger
 * Aufruf von `benachrichtige`: kein Bereich, keine Sperre der Domäne, kein Speicherschlüssel (kostet nichts außer dem Job-Prozess).
 * Eingereiht wird sie in der Umgebung, für die sie bestimmt ist (`benachrichtigung_einreihen`, Migration 0133).
 */
const benachrichtigung: JobKindSpec = {
    kind: "benachrichtigung",
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Das lesende Fundament des WikiSync (WI-0253 B-1, `jobs/wiki-dump-jobs.ts`): zwei LEICHTE Aufträge, die nur lesen. Sie schreiben in keine
 * Fachtafel, rufen das Wiki Aventurica nicht an (der Dump liegt als Datei im Ordner `WIKI_DUMP_ROOT`) und haben keine Route und keinen
 * Knopf, bis das Rechte-Gate (WI-0253 §6.2) entschieden ist.
 *
 * - `wiki_dump_einlesen`: liest den Dump im Strom und legt Manifest (Datei, Größe, SHA-256, Stand) und Zählungen je Namensraum als Ergebnis ab;
 * - `wiki_vorschau`: der Abgleich der Karte mit dem Dump (C): je Bereich die Planzeilen (Feld, Istwert, Wiki-Wert, Eigentümer, Wirkung) und die
 *   Befunde, als Lauf in `wikisync_lauf` / `wikisync_lauf_zeile` abgelegt (Protokolltafeln der Vorschau, keine Fachtafel); dazu wie in B-1 die Zahlen der
 *   Zuweisungen und welche Namensräume die Tafel nicht kennt (Befund).
 *
 * Kein Speicherschlüssel und keine Sperre der Domäne: Sie streamen (die Seiten einzeln, nie der ganze Dump) und fassen keine Karte an. Die
 * Erwartung für Speicher, Dauer und Parallelität im Profil misst Claudio am echten Dump (rund 253.000 Titel, 39 MB gepackt); bis dahin
 * laufen sie allein. 🪤 Eingereiht werden sie später mit `scope_kind = 'tiles'` und ohne Kacheln (kein Kartenfußabdruck), wie
 * `territory_derive` und `path_label_runs`: Mit `domain` wartete der Dump hinter jedem Zug.
 */
export const WIKI_DUMP_EINLESEN_KIND = "wiki_dump_einlesen";
export const WIKI_VORSCHAU_KIND = "wiki_vorschau";

const wikiDumpEinlesen: JobKindSpec = {
    kind: WIKI_DUMP_EINLESEN_KIND,
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

const wikiVorschau: JobKindSpec = {
    kind: WIKI_VORSCHAU_KIND,
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Der Vergleich eines einzelnen Wiki-Artikels (WI-0253 D-2, `jobs/wiki-artikel-job.ts`): ein LEICHTER Auftrag mit GENAU EINER Anfrage an die MediaWiki-API (ohne Anmeldung, im gemeinsamen Takt von 20 Sekunden)
 * und dem Plan der Objekte, die an diesem Artikel hängen; er schreibt nur seinen Vergleich (`wikisync_artikel`, Migration 0237), in keine Fachtafel. Lokal ist der Client gesperrt (`wikiAbrufErlaubt`): Der Auftrag
 * endet mit `abruf_gesperrt`, ohne eine Zeile anzulegen. Leicht, weil er fast nur auf den Takt wartet.
 */
export const WIKI_ARTIKEL_KIND = "wiki_artikel";

const wikiArtikel: JobKindSpec = {
    kind: WIKI_ARTIKEL_KIND,
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

/**
 * Die Übernahme und die Rücknahme des WikiSync (WI-0253 D-1, `jobs/wiki-uebernahme-jobs.ts`): zwei SCHWERE Aufträge, die die Karte ändern. Sie schreiben als
 * Jobs-Rolle in die Fachtafeln eines Bereichs (Orte, Wege, Gebiete, Landschaften und Kraftlinien: je Bereich ein Schreiber in `wiki/abgleich/uebernahme/`) und in die Operation an der Karte
 * (`map_operation` mit der Quelle `wikisync`); jeder Bereich in einer eigenen Transaktion.
 *
 * - **Schwer** (nicht in `LEICHTE_ARTEN`): ein Schwerer zur Zeit auf dem Host; sie warten hinter dem Zug, dem Import und der Gebietsableitung, und `exclusivePairs` in den Profilen
 *   (`config/jobs/`) hält sie auch dann auseinander, wenn eine von jenen leicht ist (`territory_derive`). Die Domänensperre nimmt die Operation selbst, geteilt und nur für die
 *   Dauer ihrer Transaktion (`map-operation.ts`): Hält der Zug sie exklusiv, scheitert die Übernahme mit `map_import_running` und wird wiederholt.
 * - **Ein Editor-Auftrag**, wenn eine Person ihn ausgelöst hat (`isEditorJob`): Die Kartensperre hält ihn an.
 * - Kein Speicherschlüssel, kein Wert in den Profilen: Die Art läuft allein, bis Claudio sie am echten Bestand misst.
 */
export const WIKI_UEBERNEHMEN_KIND = "wiki_uebernehmen";
export const WIKI_ZURUECKNEHMEN_KIND = "wiki_zuruecknehmen";

const wikiUebernehmen: JobKindSpec = {
    kind: WIKI_UEBERNEHMEN_KIND,
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

const wikiZuruecknehmen: JobKindSpec = {
    kind: WIKI_ZURUECKNEHMEN_KIND,
    version: 1,
    origin: "queued",
    threads: 1,
    holdsSharedDomainLock: false,
    memoryKey: () => null,
    learnsFromHistory: false,
};

export const JOB_KIND_CATALOG: Readonly<Record<string, JobKindSpec>> = {
    probe,
    import: importKind,
    rollout,
    stage_rollout: stageRollout,
    [FREIGABE_JOB_KIND]: productionFreigabe,
    [PRUEFUNG_NACH_PUSH_KIND]: pruefungNachPush,
    [RELEASE_TEST_JOB_KIND]: releaseTest,
    media_derive: mediaDerive,
    media_settle: mediaSettle,
    citymap_preview_generate: kartenvorschauErzeugen,
    auth_retention: authRetention,
    kanal_aufbewahrung: kanalAufbewahrung,
    community_aufbewahrung: communityAufbewahrung,
    community_mail_versand: communityMailVersand,
    community_mail_abruf: communityMailAbruf,
    social_senden: socialSenden,
    photobox_aufbewahrung: photoboxAufbewahrung,
    kartenvorschlag_aufbewahrung: kartenvorschlagAufbewahrung,
    kanal_bild: kanalBild,
    terrain_local: terrainLocal,
    dem_publish: demPublish,
    display_heights: displayHeights,
    routing_reload: routingReload,
    terrain_full: terrainFull,
    terrain_preview: terrainPreview,
    legacy_pull: legacyPull,
    legacy_zug: legacyZug,
    legacy_media: legacyMedia,
    production_pull: productionPull,
    path_profile: pathProfile,
    land_smooth: landSmooth,
    label_runs: labelRuns,
    path_label_runs: pathLabelRuns,
    territory_derive: territoryDerive,
    sea_derive: seaDerive,
    [SPRACHE_TREFFER_JOB_KIND]: spracheTreffer,
    media_quarantine: mediaQuarantine,
    media_merge_all: mediaMergeAll,
    map_series_tile: mapSeriesTile,
    karten_svg: kartenSvg,
    map_series_production: mapSeriesProduction,
    [ABZUG_JOB_ART]: abzugLokal,
    [WIKI_DUMP_HOLEN_ART]: wikiDumpHolen,
    map_series_papierkorb: mapSeriesPapierkorb,
    benachrichtigung,
    [WIKI_DUMP_EINLESEN_KIND]: wikiDumpEinlesen,
    [WIKI_VORSCHAU_KIND]: wikiVorschau,
    [WIKI_ARTIKEL_KIND]: wikiArtikel,
    [WIKI_UEBERNEHMEN_KIND]: wikiUebernehmen,
    [WIKI_ZURUECKNEHMEN_KIND]: wikiZuruecknehmen,
};

/** Kennt dieser Slot die Art in dieser Fassung? */
export function knowsKind(kind: string, version: number): boolean {
    return JOB_KIND_CATALOG[kind]?.version === version;
}

/**
 * Gehört ein laufender Job dieser Art in die Zulassung (Bereich, Parallelität, Speicher)? Eine Art, die dieser Slot nicht kennt,
 * zählt mit: Ein fremder Lauf ist im Zweifel einer mit Bedarf.
 */
export function claimsSlot(kind: string): boolean {
    return JOB_KIND_CATALOG[kind]?.claimsSlot !== false;
}

/** Der grobe Fortschritt einer Phase laut Tafel der Jobart, oder `null` (unbekannte Art, unbekannte Phase, keine Tafel). */
export function phaseProgress(kind: string, phase: string | null): number | null {
    if (phase === null) return null;
    return JOB_KIND_CATALOG[kind]?.phases?.find((entry) => entry.name === phase)?.progress ?? null;
}

/**
 * Die erwartete Spitze RSS eines Jobs für die Zulassung (MB), oder `null`: unbekannt (die Art läuft allein).
 * Das Größere aus der eigenen Erwartung beziehungsweise der Tafel des Profils und dem p95 der letzten Läufe
 * (`historyP95Mb`): Die Queue lernt NUR NACH OBEN; nach unten ändert nur Claudio den Wert, mit Messprotokoll.
 */
export function expectedMemoryMb(
    spec: JobKindSpec,
    input: Record<string, unknown>,
    phase: string | null,
    config: JobsConfig,
    historyP95Mb: number | null,
): number | null {
    const own = spec.expectedMb?.(input, config);
    let base: number | null;
    if (own !== undefined) {
        base = own;
    } else {
        const key = spec.memoryKey(input, phase);
        // Eine Art, die nichts kostet (die Marke `rollout`), erwartet 0.
        base = key === null ? 0 : (config.memExpectedMb[key] ?? null);
    }
    if (base === null) return null;
    // Das Gelernte höchstens bis zum Budget (Claudio 2026-10-19, `2026-10-19-gelaende-speicher-budget-antwort-an-claudia.md`): Läge eine
    // einzelne Erwartung darüber, wartete die Art für immer mit `waits_memory` (Schritt 6 der Zulassung). Das Budget bleibt die Summe aller.
    if (spec.learnsFromHistory && historyP95Mb !== null)
        return Math.max(base, Math.min(Math.round(historyP95Mb), config.memTotalBudgetMb ?? Number.POSITIVE_INFINITY));
    return base;
}

/** Threads eines Jobs für das CPU-Budget (`null`: unbekannt). */
export function threadsFor(spec: JobKindSpec, config: JobsConfig): number | null {
    return config.threads[spec.kind] ?? spec.threads;
}
