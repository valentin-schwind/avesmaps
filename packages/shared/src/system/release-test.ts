import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "../operation.ts";

/**
 * Der Release-Test auf dem Entwicklungsrechner, ausgelöst in der lokalen Systemsteuerung (WI-0248 Paket L; Betreiber 2026-10-23: „du richtest
 * keine windows aufgabe ein, du sagst mir konkret den befehl, den ich auf der oberfläche in localhost auslösen kann“).
 *
 *     GET  /api/admin/system/release-test            Kandidat, Stand des Laufs, Startvorgang      switch_environment (V)
 *     POST /api/admin/system/release-test/starten    { operationId, commit }                      release_to_production + Passkey (Stufe S)
 *     POST /api/admin/system/release-test/abbrechen  { operationId, commit }                      switch_environment (V), ohne Passkey
 *     GET  /api/admin/system/release-test/bericht    ?commit=<sha40>                              switch_environment (V)
 *
 * - 🔴 **Der Start ist die Production-Freigabe** (WI-0248; Vali 2026-10-26: „1. Wann getestet wird: WENN ICH DAS WILL“, „3. … Nein das passiert
 *   automatisch, sobald der test grün war“). Darum verlangt er das Recht der Freigabe und den Passkey: In derselben Handlung steht die Freigabe für genau
 *   diesen Stand mit der Person in `refs/notes/release-auftrag`, und ist der Lauf grün, liefert Claudios Abholer genau diese SHA aus, ohne weiteren
 *   Knopf. Rot heißt: nichts außer dem Bericht. Abbrechen beendet auch die Freigabe.
 * - 🔴 **Zwei Knöpfe: „Schnelltest“ und „Volltest“** (WI-0264; Vali 2026-10-31: „Schnelltest und Volltest“). Der Schnelltest ist der Start oben
 *   (Profil `tor`, Freigabe). Der Volltest ist derselbe Aufruf mit `volltest: true`: Er prüft nacheinander den Schnelltest und den vollen Lauf
 *   (Profil `voll`), gibt nichts frei, schreibt keine Notiz nach origin und liefert nie aus; am Ende steht nur der Bericht. Dasselbe Recht und derselbe
 *   Passkey (er belegt den Rechner Stunden), derselbe Platz in der Warteschlange: Es läuft immer nur einer von beiden.
 *
 * - 🔴 **Nur lokal.** Die Routen gibt es nur auf der lokalen Entwicklungsumgebung (`AVESMAPS_ENV=development` mit `RELEASE_ID=dev`); auf Stage und
 *   Production sind sie nicht registriert und antworten 404. Die Oberfläche zeigt die Karte nur, wo die Route antwortet.
 * - 🔴 **Der Server rechnet nichts.** Er ruft den Starter des Release-Tests (`scripts/dev/release-abholer.ts`) als eigenen Prozess und gibt
 *   weiter, was dieser mit `--json` liefert (Kandidat aus `refs/notes/stage` und `refs/notes/release-auftrag`, Stand, Schritte, Dauer, Bericht).
 *   Der Runner läuft unabhängig vom Server weiter.
 * - Kein Pfad zu Zugangsdaten: Was der Starter liefert, ist bereinigt (Verbindungsadressen mit Kennwort, Token); der Server reicht nur die
 *   bekannten Felder weiter.
 */

const strict = { additionalProperties: false } as const;
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const RELEASE_TEST_URL = "/api/admin/system/release-test";

/**
 * Die Schritte des Runners in seiner Reihenfolge (`scripts/dev/release-bericht.ts`, `RELEASE_SCHRITTE`; ein Test hält beide Listen gleich).
 * `vorbereitung` ist alles vor dem ersten Protokoll: Testpaket kopieren, Kandidaten auschecken.
 */
export const RELEASE_TEST_SCHRITTE = [
    "vorbereitung",
    "installation",
    "shared",
    "lint",
    "format",
    "typen",
    "korpus-laden",
    "tests",
    "bau",
    "besucherpaket",
    "daten",
    "browser-1",
    "browser-2",
    "browser-3",
    "browser-4",
    "kern",
    "kern-echt",
] as const;
export type ReleaseTestSchrittId = (typeof RELEASE_TEST_SCHRITTE)[number];

export const RELEASE_TEST_LAUF_ZUSTAENDE = ["keiner", "laeuft", "gruen", "rot", "abgebrochen"] as const;
export type ReleaseTestLaufZustand = (typeof RELEASE_TEST_LAUF_ZUSTAENDE)[number];

export const RELEASE_TEST_SHA_MUSTER = "^[0-9a-f]{40}$";

/** Ein Schritt des Runners: Zustand, verstrichene und erwartete Zeit. */
export const ReleaseTestSchritt = Type.Object(
    {
        id: literals(RELEASE_TEST_SCHRITTE),
        /**
         * `uebernommen`: der Schritt gehört zu einem Teil, den eine Wiederholung aus dem früheren Lauf übernahm (lief nicht neu, zählt nicht zur
         * Erwartung). `uebersprungen`: er lief nicht, weil seine Voraussetzung fehlte (Besucherpaket ohne Bau, Browserteil ohne Martin).
         */
        zustand: literals(["fertig", "laeuft", "offen", "fehler", "uebernommen", "uebersprungen"] as const),
        /** Beginn (ISO), nur bei Schritten, die begonnen haben. */
        start: Type.Optional(Type.String()),
        /** Verstrichene Zeit des Schritts bis jetzt (läuft er) oder bis zu seinem Ende. */
        dauerMs: Type.Optional(Type.Number({ minimum: 0 })),
        /** Die erwartete Dauer: aus dem jüngsten Lauf, in dem der Schritt ganz lief, sonst die feste Schätzung des Starters. */
        erwartetMs: Type.Number({ minimum: 0 }),
        /** `true`: `erwartetMs` ist die feste Schätzung, kein gemessener Wert. */
        schaetzung: Type.Boolean(),
    },
    strict,
);
export type ReleaseTestSchritt = Static<typeof ReleaseTestSchritt>;

/**
 * Ein roter Testfall im Bericht: Datei, Name (leer, wenn die ganze Datei nicht lief) und die ersten Zeilen der Meldung. Seit WI-0248 läuft der
 * Lauf bis zum Ende, und die Fälle stammen aus ALLEN Teilen, die nicht grün sind: `teil` nennt den Schritt (`tests` für Vitest, `browser-n`),
 * `teilName` seinen deutschen Namen (die Oberfläche übersetzt über `teil`). Beide fehlen bei Berichten, die den Teil nicht kannten.
 */
export const ReleaseTestRoterFall = Type.Object(
    {
        datei: Type.String(),
        name: Type.String(),
        meldung: Type.Array(Type.String(), { maxItems: 12 }),
        teil: Type.Optional(literals(RELEASE_TEST_SCHRITTE)),
        teilName: Type.Optional(Type.String()),
    },
    strict,
);
export type ReleaseTestRoterFall = Static<typeof ReleaseTestRoterFall>;

/** Der Bericht zu einem roten oder abgebrochenen Lauf (bereinigt: keine Zugangsdaten). */
export const ReleaseTestFehler = Type.Object(
    {
        schritt: Nullable(literals(RELEASE_TEST_SCHRITTE)),
        grund: Type.String(),
        faelle: Type.Array(ReleaseTestRoterFall, { maxItems: 20 }),
        faelleGesamt: Type.Integer({ minimum: 0 }),
        protokollEnde: Type.Array(Type.String(), { maxItems: 60 }),
    },
    strict,
);
export type ReleaseTestFehler = Static<typeof ReleaseTestFehler>;

/**
 * Der Stand eines Starts. Zwischen dem Knopf und dem ersten Status des Runners vergehen Minuten (Testpaket bauen), in denen es noch keinen
 * Ergebnisordner gibt. 🔴 Der Stand lebt in einer Datei des Starters (`<Datenwurzel>/release-abholer/start/<sha>.json`), nicht im Speicher des
 * Servers: Ein Neustart des Servers (`node --watch`) darf ihn nicht vergessen machen. `baut`: der Starter arbeitet und sein Prozess lebt;
 * `gestartet`: der Runner läuft; `fehler`: der Start ist gescheitert (der Starter meldet den Grund; endete sein Prozess ohne Vermerk, steht das
 * da). Der Server reicht diesen Stand nur weiter und führt für den Moment zwischen Start und erstem Vermerk eine Brücke im Speicher.
 */
export const ReleaseTestStartvorgang = Type.Object(
    {
        commit: Type.String({ pattern: RELEASE_TEST_SHA_MUSTER }),
        seit: Type.String(),
        zustand: literals(["baut", "gestartet", "fehler"] as const),
        grund: Nullable(Type.String()),
    },
    strict,
);
export type ReleaseTestStartvorgang = Static<typeof ReleaseTestStartvorgang>;

/**
 * Die Browserteile: die vier nach Thema (`apps/web/e2e/release-teile.json`, Prüfprofil `voll`), die Stichprobe der Kernabläufe
 * (`kern`, `release-kern.json`, Prüfprofil B seit 2026-10-24) und die Kernabläufe des Release-Tors gegen den echten Server (`kern-echt`,
 * `release-tor.json`, Prüfprofil `tor` seit WI-0264); ihre Kennungen sind die des Nachweises Version 3. `daten` (Migrationen und Rechte auf echten
 * Daten) ist kein Browserteil, sondern ein Schritt des Tors.
 */
export const RELEASE_TEST_BROWSERTEILE = [
    "browser-1",
    "browser-2",
    "browser-3",
    "browser-4",
    "kern",
    "kern-echt",
] as const;
export type ReleaseTestBrowserteilId = (typeof RELEASE_TEST_BROWSERTEILE)[number];

/**
 * Ein Browserteil für die Karte: Name, Bereiche, Zahl der Fälle, Zustand und Zeit. `name` ist der deutsche Name der Zuordnung; die Oberfläche
 * zeigt ihn und die `bereiche` (Kennungen) in der Sprache der Seite.
 */
export const ReleaseTestTeil = Type.Object(
    {
        id: literals(RELEASE_TEST_BROWSERTEILE),
        name: Type.String(),
        bereiche: Type.Array(Type.String(), { maxItems: 12 }),
        zustand: literals(["offen", "laeuft", "gruen", "rot", "uebersprungen"] as const),
        /** Der Teil kommt aus einem früheren Lauf (Wiederholung) und lief in diesem nicht neu. */
        uebernommen: Type.Boolean(),
        /** Wie viele Spec-Dateien der Teil umfasst. */
        specs: Type.Optional(Type.Integer({ minimum: 0 })),
        /** Wie viele Fälle der Teil umfasst: aus seinem Bericht; solange er fehlt aus dem jüngsten früheren Lauf (dann `faelleSchaetzung`). */
        faelle: Type.Optional(Type.Integer({ minimum: 0 })),
        faelleSchaetzung: Type.Optional(Type.Boolean()),
        /** Wie viele Fälle rot (oder wackelig) waren; nur mit Bericht. */
        rot: Type.Optional(Type.Integer({ minimum: 0 })),
        /** Verstrichene Zeit des Teils (läuft er, bis jetzt). */
        dauerMs: Type.Optional(Type.Number({ minimum: 0 })),
        /** Die erwartete Zeit des Teils (0, wenn er übernommen wurde). */
        erwartetMs: Type.Number({ minimum: 0 }),
        /** Bei einem entfallenen Teil der Grund. */
        grund: Type.Optional(Type.String()),
    },
    strict,
);
export type ReleaseTestTeil = Static<typeof ReleaseTestTeil>;

/** Was eine Wiederholung aus dem früheren Lauf übernahm (Teile `voll`, `browser-n`), was neu lief und warum sie nichts übernahm. */
export const ReleaseTestWiederholung = Type.Object(
    {
        von: Type.String(),
        uebernommen: Type.Array(Type.String(), { maxItems: 8 }),
        neu: Type.Array(Type.String(), { maxItems: 8 }),
        grund: Nullable(Type.String()),
    },
    strict,
);
export type ReleaseTestWiederholung = Static<typeof ReleaseTestWiederholung>;

/** Der Stand des jüngsten Laufs im Werkzeugklon: `--stand --json` des Starters. */
export const ReleaseTestLauf = Type.Object(
    {
        zustand: literals(RELEASE_TEST_LAUF_ZUSTAENDE),
        sha: Type.Optional(Type.String({ pattern: RELEASE_TEST_SHA_MUSTER })),
        /** Das zuletzt beschriebene Protokoll eines laufenden Laufs. */
        schritt: Type.Optional(Type.String()),
        fertigeTeile: Type.Array(Type.String()),
        start: Type.Optional(Type.String()),
        ende: Type.Optional(Type.String()),
        /** Bei Rot oder Abbruch der Satz zum Grund: erste Zeile, ohne Pfade und Adressen. */
        grund: Type.Optional(Type.String()),
        /** Der Ergebnisordner auf dem Rechner (für die vollständigen Berichte). */
        ordner: Type.Optional(Type.String()),
        /** Die Sperre `.release-runs/aktiv` besteht. */
        sperre: Type.Boolean(),
        /** Nur bei einem laufenden Lauf: lebt sein Prozess? `false`: abgestürzt, die Sperre bleibt zur Diagnose stehen (nie automatisch entsperrt). */
        lebt: Type.Optional(Type.Boolean()),
        /** Der Zeitpunkt, auf den sich die Zeiten beziehen (ISO). */
        jetzt: Type.String(),
        schritte: Type.Array(ReleaseTestSchritt),
        /** Die erwartete Dauer des ganzen Laufs. */
        erwartetMs: Type.Number({ minimum: 0 }),
        /** Mindestens ein Schritt rechnet noch mit der festen Schätzung. */
        erwartetSchaetzung: Type.Boolean(),
        /** 0 bis 1 nach erwarteter Dauer. */
        fortschritt: Type.Number({ minimum: 0, maximum: 1 }),
        /** Wie lange es noch dauert; nur solange der Lauf läuft. */
        verbleibendMs: Type.Optional(Type.Number({ minimum: 0 })),
        fehler: Type.Optional(ReleaseTestFehler),
        /**
         * Der jüngste Start, soweit er noch zählt (`baut`, `fehler`; ein gestarteter steht als Lauf da): aus der Startdatei des Starters, nicht aus dem
         * Speicher des Servers. Fehlt bei einem Starter, der noch keine Startdateien kennt. Der Server nimmt ihn aus dem Lauf heraus und legt ihn in `start`.
         */
        startvorgang: Type.Optional(ReleaseTestStartvorgang),
        /** Die vier Browserteile nach Thema; fehlt bei einem Starter, der sie noch nicht kennt. */
        teile: Type.Optional(Type.Array(ReleaseTestTeil, { maxItems: 8 })),
        /** Fehlt bei einem Lauf ohne Wiederholung. */
        wiederholung: Type.Optional(ReleaseTestWiederholung),
        /** Der Lauf ist zu Ende und nicht grün, und keine Sperre hält an: „Rote Teile wiederholen“ ist möglich (der Server prüft es erneut). */
        wiederholbar: Type.Optional(Type.Boolean()),
        /** Das Prüfprofil des Laufs (`tor`, `B`, `voll`); fehlt bei einem Starter, der es nicht meldet. */
        profil: Type.Optional(Type.String()),
        /** Ein Teil des Volltests (WI-0264): nur Bericht, liefert nichts aus. */
        volltest: Type.Optional(Type.Literal(true)),
        /** Teil 2 des Volltests: wie Teil 1 (der Schnelltest) endete; bei Rot mit dem Grund. */
        vorlauf: Type.Optional(
            Type.Object(
                { zustand: literals(RELEASE_TEST_LAUF_ZUSTAENDE), grund: Type.Optional(Type.String()) },
                strict,
            ),
        ),
    },
    strict,
);
export type ReleaseTestLauf = Static<typeof ReleaseTestLauf>;

/**
 * Was aus einer Freigabe wird (WI-0248; Vali 2026-10-26: der Start des Release-Tests ist die Freigabe, „Nein das passiert automatisch, sobald der test
 * grün war“), nach der Regel von `scripts/dev/release-freigabe.ts`, die auch Claudios Abholer anwendet: `wartet` (der Test hat noch nicht begonnen),
 * `laeuft`, `rot`, `gruen` (genau diese SHA wird ausgeliefert), `abgebrochen` (Abbruch, gescheiterter Start, rot), `fremd` (grün, aber aus einem
 * anderen Lauf: nichts), `ungueltig` (eine grüne Zeile ohne gültigen Nachweis: nichts).
 */
export const RELEASE_FREIGABE_ZUSTAENDE = [
    "wartet",
    "laeuft",
    "rot",
    "gruen",
    "abgebrochen",
    "fremd",
    "ungueltig",
] as const;
export type ReleaseFreigabeZustand = (typeof RELEASE_FREIGABE_ZUSTAENDE)[number];

/** Die Kennung einer Freigabe: `RT-` und die öffentliche Kennung des Auftrags `release_test`. */
export const RELEASE_FREIGABE_KENNUNG_MUSTER = "^RT-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/** Die jüngste Freigabe aus dem Start des Release-Tests und ihr Zustand (Notiz `refs/notes/release-auftrag`, Urteil `refs/notes/sammellauf`). */
export const ReleaseTestFreigabe = Type.Object(
    {
        sha: Type.String({ pattern: RELEASE_TEST_SHA_MUSTER }),
        zeit: Type.String(),
        kennung: Type.String({ pattern: RELEASE_FREIGABE_KENNUNG_MUSTER }),
        /** Wer freigegeben hat; `null` bei einem Abbruch (die Notiz trägt dann den Grund). */
        von: Nullable(Type.String({ maxLength: 80 })),
        zustand: literals(RELEASE_FREIGABE_ZUSTAENDE),
        /** Nur bei `gruen`: genau `sha` wird ausgeliefert. */
        ausliefern: Type.Boolean(),
        grund: Type.String({ maxLength: 400 }),
    },
    strict,
);
export type ReleaseTestFreigabe = Static<typeof ReleaseTestFreigabe>;

/**
 * Der Kandidat: der zuletzt grün ausgerollte Stage-Stand, der frühere Auftrag der Stage (`OPS-…`, die Nacht-Freigaben bis WI-0248) und die jüngste
 * Freigabe aus dem Start des Release-Tests (`--kandidat --json`).
 */
export const ReleaseTestKandidat = Type.Object(
    {
        stage: Nullable(
            Type.Object({ sha: Type.String({ pattern: RELEASE_TEST_SHA_MUSTER }), zeit: Type.String() }, strict),
        ),
        auftrag: Nullable(
            Type.Object(
                { sha: Type.String({ pattern: RELEASE_TEST_SHA_MUSTER }), zeit: Type.String(), ops: Type.String() },
                strict,
            ),
        ),
        /** Fehlt, wenn es keine gibt oder der Starter sie noch nicht kennt. */
        freigabe: Type.Optional(ReleaseTestFreigabe),
    },
    strict,
);
export type ReleaseTestKandidat = Static<typeof ReleaseTestKandidat>;

/** `GET /api/admin/system/release-test/bericht?commit=<sha40>`: der eine Bericht des Laufs (`bericht.md`), als Markdown. */
export const ReleaseTestBerichtQuery = Type.Object(
    { commit: Type.Optional(Type.String({ pattern: RELEASE_TEST_SHA_MUSTER })) },
    strict,
);
export const ReleaseTestBericht = Type.Object(
    {
        commit: Type.String({ pattern: RELEASE_TEST_SHA_MUSTER }),
        /** Die Seite: was rot ist, aus allen Teilen, und darunter, was offen ist. */
        text: Type.String({ maxLength: 4 * 1024 * 1024 }),
        ordner: Nullable(Type.String()),
    },
    strict,
);
export type ReleaseTestBericht = Static<typeof ReleaseTestBericht>;

/** Die Jobart des Release-Tests in der Warteschlange und ihr Ref (höchstens einer wartet oder läuft, `release_test_einreihen`, Migration 0228). */
export const RELEASE_TEST_JOB_KIND = "release_test";
export const RELEASE_TEST_JOB_REF = "release-test";

/**
 * Der Auftrag `release_test` in der Warteschlange (WI-0248; Vali 2026-10-26: „Release-Test starten“ reiht ein, statt sofort zu starten). Er steht
 * da, solange er wartet oder läuft:
 *
 * - `wartet`: eingereiht; `platz` ist der Platz in der Reihe (1 = als Nächstes), `wartetAuf` die Art des laufenden Auftrags, hinter dem er steht,
 *   `grund` der Wartegrund der Warteschlange (`waits_queue_paused` …). Beides `null`, wo nichts davon bekannt ist.
 * - `laeuft`: der Ausführer hat ihn übernommen und folgt dem Starter und dem Runner; was der Lauf tut, steht in `start` und `lauf`.
 *
 * `abbruch`: der Abbruch ist angefordert, der Ausführer beendet den Lauf.
 */
export const ReleaseTestAuftrag = Type.Object(
    {
        id: Type.String(),
        zustand: literals(["wartet", "laeuft"] as const),
        commit: Type.String({ pattern: RELEASE_TEST_SHA_MUSTER }),
        wiederholen: Type.Boolean(),
        /** Der Volltest (WI-0264): Schnelltest und voller Lauf nacheinander, nur Bericht. */
        volltest: Type.Optional(Type.Boolean()),
        /** Seit wann er eingereiht ist (ISO). */
        seit: Type.String(),
        platz: Nullable(Type.Integer({ minimum: 1 })),
        wartetAuf: Nullable(Type.String()),
        grund: Nullable(Type.String()),
        abbruch: Type.Boolean(),
    },
    strict,
);
export type ReleaseTestAuftrag = Static<typeof ReleaseTestAuftrag>;

/** `GET /api/admin/system/release-test`. */
export const ReleaseTestSicht = Type.Object(
    {
        now: Type.String(),
        /** `false`: der Starter ließ sich nicht lesen oder lieferte nichts Brauchbares; `fehler` sagt, was. */
        verfuegbar: Type.Boolean(),
        /** Der Satz zu `verfuegbar: false` oder zu einem Kandidaten, der sich nicht lesen ließ; sonst `null`. */
        fehler: Nullable(Type.String()),
        kandidat: Nullable(ReleaseTestKandidat),
        lauf: Nullable(ReleaseTestLauf),
        start: Nullable(ReleaseTestStartvorgang),
        /** Der Auftrag in der Warteschlange, solange er wartet oder läuft (WI-0248); fehlt sonst. */
        auftrag: Type.Optional(Nullable(ReleaseTestAuftrag)),
    },
    strict,
);
export type ReleaseTestSicht = Static<typeof ReleaseTestSicht>;

/**
 * `POST …/starten` — genau dieser Stand wird vollständig geprüft. 🔴 `commit` ist der Stand, den die Oberfläche gesehen hat: Der Server lehnt
 * jeden Stand ab, der weder der jüngste Stage-Stand noch der jüngste Auftrag ist (409 `release_test_stale`).
 *
 * `wiederholen: true` (WI-0248, „Rote Teile wiederholen“): derselbe Stand, aber nur die roten oder fehlenden Teile laufen neu; die grünen übernimmt
 * der Runner aus dem früheren Lauf, wenn die Umgebung dieselbe ist. Gibt es für den Stand keinen früheren, nicht grünen Lauf, antwortet der Server
 * mit 409 `release_test_kein_roter_lauf`. Passkey wie beim Start.
 *
 * `volltest: true` (WI-0264, Knopf „Volltest“): erst der Schnelltest, dann der volle Lauf, nur Bericht; KEINE Freigabe, nichts geht nach Production.
 * Nie zusammen mit `wiederholen` (400). Auch ein schon grün geprüfter Stand wird geprüft.
 */
export const ReleaseTestStartBody = Type.Object(
    {
        operationId: OperationId,
        commit: Type.String({ pattern: RELEASE_TEST_SHA_MUSTER }),
        wiederholen: Type.Optional(Type.Boolean()),
        volltest: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type ReleaseTestStartBody = Static<typeof ReleaseTestStartBody>;

/** `POST …/abbrechen` — der laufende Test dieses Standes wird beendet (die sichere Richtung: ohne Passkey). */
export const ReleaseTestAbbrechenBody = Type.Object(
    { operationId: OperationId, commit: Type.String({ pattern: RELEASE_TEST_SHA_MUSTER }) },
    strict,
);
export type ReleaseTestAbbrechenBody = Static<typeof ReleaseTestAbbrechenBody>;

/**
 * Die Fachcodes (ADR-0018): `release_test_unavailable` (503) der Starter ließ sich nicht aufrufen; `release_test_stale` (409) der Kandidat hat sich
 * bewegt; `release_test_laeuft` (409) es läuft schon ein Test oder ein Start; `release_test_gruen` (409) dieser Stand ist schon grün geprüft;
 * `release_test_sperre` (409) eine Sperre ohne lebenden Prozess; `release_test_kein_lauf` (409) Abbrechen, wo nichts läuft;
 * `release_test_kein_roter_lauf` (409) Wiederholen, wo es keinen früheren, nicht grünen Lauf dieses Standes gibt;
 * `release_test_fehler` (502) der Starter meldet, warum nichts startet.
 */
export const RELEASE_TEST_ERROR_STATUS = {
    release_test_unavailable: 503,
    release_test_stale: 409,
    release_test_laeuft: 409,
    release_test_gruen: 409,
    release_test_sperre: 409,
    release_test_kein_lauf: 409,
    release_test_kein_roter_lauf: 409,
    release_test_fehler: 502,
    /** Die Freigabe ließ sich nicht nach origin schreiben (WI-0248): Dann startet auch kein Test, denn ohne Freigabe ginge sein Grün nirgendwohin. */
    release_test_freigabe: 503,
    /** Für diesen Stand gibt es keinen Bericht (kein Ergebnisordner). */
    release_test_kein_bericht: 404,
} as const;
export type ReleaseTestErrorCode = keyof typeof RELEASE_TEST_ERROR_STATUS;

/**
 * Welcher Stand wird geprüft? 🔴 Der aktuelle Stage-Stand (WI-0248, Vali 2026-10-26: „Release-Test starten“ prüft und gibt frei, was auf der Stage
 * steht), sonst die jüngste Freigabe, sonst der frühere Auftrag der Stage. Eine Regel für Server, Oberfläche und Tests. `null`, wenn keiner bekannt ist.
 */
export function releaseTestCommit(kandidat: ReleaseTestKandidat | null): string | null {
    return kandidat?.stage?.sha ?? kandidat?.freigabe?.sha ?? kandidat?.auftrag?.sha ?? null;
}

/** Läuft gerade ein Test oder ein Start, oder wartet ein Auftrag in der Warteschlange? Dann sind Starten und ein zweiter Start gesperrt. */
export function releaseTestBeschaeftigt(sicht: ReleaseTestSicht | null): boolean {
    if (sicht === null) return false;
    return (sicht.auftrag ?? null) !== null || sicht.lauf?.zustand === "laeuft" || sicht.start?.zustand === "baut";
}
