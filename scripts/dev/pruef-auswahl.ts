// Die Pfadregel für `npm run vor-dem-push -- --tests`: Welche Tests kann die Änderung berühren?
//
// 🔴 Anlass (Hauptorchestrierung 2026-10-17, Messung der Arbeitshygiene): Der volle Testteil dauert 38 min (711 Dateien, 9.200 Fälle), und
// 50 % der Commits eines Tages sind reine Doku, Handover und Zustand (180 von 360), 24 % betreffen nur die Weboberfläche. Eine Doku-Zeile
// muss nicht hinter 6 volle Läufe. Das Sicherheitsnetz bleibt Claudios „Prüfung nach dem Push“ mit allem auf Linux.
//
// Die Regel, von eng nach weit (die erste, die passt):
//   1. `--voll`                                   → alles
//   2. Änderung nicht bestimmbar                  → alles
//   3. nur Doku, Handover, Zustand, Review        → „doku“: die Regelwerk-Wächter und jede Testdatei, die Dateien unter `docs/`,
//                                                   `project-control/` oder `AGENTS.md` liest
//   4. Doku und `apps/web/**`                     → „web“: `apps/web/test`, `packages/shared/test`, dazu wie bei „doku“ die Leser
//                                                   von Doku und die Servertests, die Dateien der Weboberfläche lesen
//   5. alles andere (Server, shared, config, Skripte, Migrationen, Wurzeldateien) → „bereich“: die Tests des eigenen Bereichs
//      (`bereich-auswahl.ts`, WI-0228), ohne Prüfbank. Den vollen Lauf über alles macht der Sammellauf nach dem Push
//      (`scripts/dev/sammellauf.ts`; Betreiber 2026-10-18 „A, ab jetzt immer“), vor dem Push nur noch `--voll`.
//
// 🪤 Die Dateien, die lesen, werden aus dem Quelltext der Tests gefunden (Muster unten), nicht aus einer Liste: eine neue Testdatei, die
// `docs/regeln` liest, gehört damit von selbst dazu.
import { waehleBereich } from "./bereich-auswahl.ts";
import { dbTestDateien } from "./db-tests.ts";

export type Stufe = "doku" | "web" | "bereich" | "voll";

export interface Auswahl {
    readonly stufe: Stufe;
    /** Warum diese Stufe, in einem Satz für die Zeile im Lauf. */
    readonly grund: string;
    /** Die Filter für Vitest (Pfade oder Ordner); leer bei „voll“; bei „bereich“ die Testdateien ohne Datenbank. */
    readonly filter: readonly string[];
    /** Nur bei „bereich“: die gewählten Dateien mit Testdatenbank (der Datenbank-Durchgang). */
    readonly datenbankDateien?: readonly string[];
}

export interface TestDatei {
    readonly pfad: string;
    readonly text: string;
}

/** Reine Doku: Beschreibungen, Handover, Zustand, Review-Blätter, Markdown überall. */
const DOKU = /^(docs\/|project-control\/|review\/|\.claude\/)|\.md$/;
const WEB = /^apps\/web\//;
/** Testdateien, die Dokus oder Zustandsdateien lesen: ihre Aussage hängt an deren Inhalt. */
const LIEST_DOKU = /project-control|docs\/(regeln|design|planning)|AGENTS\.md|CLAUDE\.md/;
/** Servertests, die Dateien der Weboberfläche lesen (etwa Sprachtafeln). */
const LIEST_WEB = /apps\/web|\.\.\/\.\.\/web\/|\/web\/src/;
const REGELWERK = /(^|\/)regelwerk-[^/]+\.test\.ts$/;

function pfadUnter(pfad: string, ordner: string): boolean {
    return pfad.startsWith(`${ordner}/`);
}

/**
 * Wählt die Tests für die geänderten Dateien. `geaendert` ist die Liste der Pfade relativ zur Wurzel (`/` als Trenner) oder
 * `undefined`, wenn sie sich nicht bestimmen ließ.
 */
export function waehleTests(optionen: {
    readonly geaendert: readonly string[] | undefined;
    readonly voll: boolean;
    readonly quellen?: readonly TestDatei[];
    readonly testDateien: readonly TestDatei[];
    /** Liest eine Datei des geprüften Stands (für die Objekte einer Migration in der Stufe „bereich“). */
    readonly liesDatei?: (pfad: string) => string | undefined;
}): Auswahl {
    const { geaendert, voll, testDateien } = optionen;
    if (voll) return { stufe: "voll", grund: "--voll", filter: [] };
    if (geaendert === undefined || geaendert.length === 0) {
        return { stufe: "voll", grund: "Änderung nicht bestimmbar", filter: [] };
    }
    const pfade = geaendert.map((p) => p.replace(/\\/g, "/"));
    const nurDoku = pfade.every((p) => DOKU.test(p));
    const dokuUndWeb = pfade.every((p) => DOKU.test(p) || WEB.test(p));
    const leserDoku = testDateien.filter((t) => LIEST_DOKU.test(t.text) || REGELWERK.test(t.pfad)).map((t) => t.pfad);
    if (nurDoku) {
        const filter = [...new Set(leserDoku)].sort();
        if (filter.length === 0) return { stufe: "voll", grund: "keine Doku-Tests gefunden", filter: [] };
        return {
            stufe: "doku",
            grund: `nur Doku (${String(pfade.length)} Dateien): Regelwerk-Wächter und die Tests, die Doku lesen`,
            filter,
        };
    }
    if (dokuUndWeb && optionen.quellen === undefined) {
        const leserWeb = testDateien
            .filter((t) => !pfadUnter(t.pfad, "apps/web/test") && LIEST_WEB.test(t.text))
            .map((t) => t.pfad);
        const filter = [...new Set(["apps/web/test", "packages/shared/test", ...leserDoku, ...leserWeb])].sort();
        return {
            stufe: "web",
            grund: `nur Weboberfläche und Doku (${String(pfade.length)} Dateien): Web-, shared- und Doku-Tests`,
            filter,
        };
    }
    const fremd = pfade.find((p) => !DOKU.test(p) && !WEB.test(p)) ?? "";
    const datenbank = dbTestDateien(testDateien);
    const bereich = waehleBereich({
        geaendert: pfade,
        ...(optionen.quellen === undefined ? {} : { quellen: optionen.quellen }),
        testDateien,
        datenbankDateien: datenbank,
        liesDatei: optionen.liesDatei ?? (() => undefined),
    });
    return {
        stufe: "bereich",
        grund: `berührt mehr als Doku und Web (${fremd}): die Tests des Bereichs, ${bereich.gruende.join("; ")}`,
        filter: bereich.dateien.filter((d) => !datenbank.includes(d)),
        datenbankDateien: bereich.dateien.filter((d) => datenbank.includes(d)),
    };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Die Durchgänge des vollen Laufs (Hauptorchestrierung 2026-10-17, Messung der Arbeitshygiene: 61 % der 38 min waren Aufwand je Datei,
// weil jede Datei in einem frischen Prozess läuft und alles neu lädt).
//
// 🔴 Der volle Lauf teilt den Prozess (`--no-isolate`), aber nicht blind: Gemessen auf demselben Commit gab ein einziger Durchgang ohne
// Isolierung 8 falsche Rote, weil `vi.mock` in geteiltem Prozess nicht greift, wenn eine frühere Datei das echte Modul schon geladen
// hat (nur drei Webtests benutzen es). Darum drei Durchgänge:
//   1. Server, ohne Isolierung            (Server-Zustand darf nicht in Webtests sickern: eigener Prozess)
//   2. alles andere (Web, shared), ohne Isolierung, ohne die Dateien mit `vi.mock`
//   3. die Dateien mit `vi.mock`, isoliert (die Liste kommt zur Laufzeit aus den Quelltexten: eine neue Datei mit `vi.mock` gehört
//      damit von selbst dazu)
// Gemessen (Web und shared, dreimal): 4.353 Fälle, alle grün, deckungsgleich mit dem voll isolierten Lauf; Server: gleiche Zahl Fälle und
// übersprungener Fälle, 0 rot. `--isoliert` erzwingt den alten, voll isolierten Lauf als Gegenprobe.

export interface Durchgang {
    readonly name: string;
    /** Die Argumente hinter `npm test`; beim Datenbank-Durchgang die Testdateien (hinter `vitest run`). */
    readonly args: readonly string[];
    /**
     * Der Durchgang mit den Datenbanktests: Er läuft mit der Wegwerf-Datenbank (`scripts/dev/wegwerf-db.ts`) und ruft Vitest direkt
     * auf, weil die Liste der Dateien für eine Befehlszeile über `npm` zu lang ist.
     */
    readonly datenbank?: boolean;
    /** Vitest direkt (`args` sind die Testdateien hinter `vitest run`): die Dateiliste der Stufe „bereich“ ist für `npm` zu lang. */
    readonly direkt?: boolean;
}

export interface Plan {
    readonly durchgaenge: readonly Durchgang[];
    /** Die Dateien, die isoliert liefen (leer, wenn der Lauf nirgends den Prozess teilt oder alles isoliert ist). */
    readonly isoliert: readonly string[];
    /** Die eine Zeile für den Lauf: welche Dateien isoliert liefen und warum. */
    readonly zeile: string;
}

const MOCK = /\bvi\.mock\(/;
const SERVER_ORDNER = "apps/server/test";

/** Der Plan der Durchgänge für `npm test` nach der Pfadregel; nur „voll“ ohne `--isoliert` wird aufgeteilt. */
export function planeDurchgaenge(optionen: {
    readonly auswahl: Auswahl;
    readonly testDateien: readonly TestDatei[];
    readonly isoliert: boolean;
    /**
     * Die Dateien mit Datenbank, die der Durchgang im Wegwerf-Postgres fährt (in jeder Stufe; `db-auswahl.ts` wählt sie nach der Pfadregel).
     * Leer oder fehlend: kein Durchgang, die Dateien überspringen sich.
     */
    readonly datenbankDateien?: readonly string[];
}): Plan {
    const plan = planeOhneDatenbank(optionen);
    const dateien = optionen.datenbankDateien ?? [];
    if (dateien.length === 0) return plan;
    return {
        ...plan,
        durchgaenge: [
            ...plan.durchgaenge,
            {
                name: `Datenbanktests im Wegwerf-Postgres (isoliert, ${String(dateien.length)} Dateien)`,
                args: dateien,
                datenbank: true,
            },
        ],
        zeile: `${plan.zeile}\n  Datenbanktests: ${String(dateien.length)} Dateien im Wegwerf-Postgres, isoliert (Rolle ohne Sonderrechte, Migrationen von diesem Commit).`,
    };
}

function planeOhneDatenbank(optionen: {
    readonly auswahl: Auswahl;
    readonly testDateien: readonly TestDatei[];
    readonly isoliert: boolean;
}): Plan {
    const { auswahl, testDateien, isoliert } = optionen;
    if (auswahl.stufe === "bereich") {
        return {
            durchgaenge:
                auswahl.filter.length === 0
                    ? []
                    : [
                          {
                              name: `Tests des Bereichs ohne Datenbank (isoliert, ${String(auswahl.filter.length)} Dateien)`,
                              args: auswahl.filter,
                              direkt: true,
                          },
                      ],
            isoliert: [],
            zeile: "  Isoliert liefen alle Dateien (Stufe bereich: klein genug, kein geteilter Prozess).",
        };
    }
    // Die Stufe web teilt den Prozess wie der volle Lauf (WI-0228): isoliert brauchten ihre 51 Filter unter Last 902 s, ohne Isolierung derselbe
    // Teil im vollen Lauf 37 bis 50 s. Die Dateien mit `vi.mock` und die übrigen Leser (Server- und Doku-Tests) laufen isoliert.
    if (auswahl.stufe === "web" && !isoliert) {
        const ordnerWeb: readonly string[] = auswahl.filter.filter(
            (f) => f === "apps/web/test" || f === "packages/shared/test",
        );
        const einzelne = auswahl.filter.filter((f) => !ordnerWeb.includes(f));
        const mock = testDateien
            .filter((t) => MOCK.test(t.text) && ordnerWeb.some((o) => t.pfad.startsWith(`${o}/`)))
            .map((t) => t.pfad)
            .sort();
        const durchgaenge: Durchgang[] = [
            {
                name: "Tests Web und shared (ohne Isolierung, Stufe web)",
                args: ["--", "--no-isolate", ...mock.flatMap((pfad) => ["--exclude", pfad]), ...ordnerWeb],
            },
            ...(mock.length > 0
                ? [{ name: `Tests mit vi.mock (isoliert, ${String(mock.length)} Dateien)`, args: ["--", ...mock] }]
                : []),
            ...(einzelne.length > 0
                ? [
                      {
                          name: `Tests, die Weboberfläche oder Doku lesen (isoliert, ${String(einzelne.length)} Dateien)`,
                          args: einzelne,
                          direkt: true,
                      },
                  ]
                : []),
        ];
        return {
            durchgaenge,
            isoliert: mock,
            zeile: "  Stufe web: Web und shared in einem geteilten Prozess (wie im vollen Lauf), die Dateien mit vi.mock und die übrigen Leser isoliert.",
        };
    }
    const einfach: Plan = {
        durchgaenge: [
            {
                name: `Tests ohne Datenbank (npm test${auswahl.filter.length === 0 ? "" : `, Stufe ${auswahl.stufe}, ${String(auswahl.filter.length)} Filter`})`,
                args: auswahl.filter.length === 0 ? [] : ["--", ...auswahl.filter],
            },
        ],
        isoliert: [],
        zeile: isoliert
            ? "  Isoliert liefen alle Dateien (--isoliert, der alte Lauf ohne geteilten Prozess)."
            : `  Isoliert liefen alle Dateien (Stufe ${auswahl.stufe}: klein genug, kein geteilter Prozess).`,
    };
    if (isoliert || auswahl.stufe !== "voll") return einfach;

    const mock = testDateien
        .filter((t) => MOCK.test(t.text))
        .map((t) => t.pfad)
        .sort();
    const ordner = [...new Set(testDateien.map((t) => t.pfad.replace(/\/test\/.*$/, "/test")))].sort();
    const server = ordner.filter((o) => o === SERVER_ORDNER);
    const rest = ordner.filter((o) => o !== SERVER_ORDNER);
    const ohneMock = mock.flatMap((pfad) => ["--exclude", pfad]);
    const durchgaenge: Durchgang[] = [];
    if (server.length > 0) {
        durchgaenge.push({
            name: "Tests ohne Datenbank, Durchgang Server (ohne Isolierung)",
            args: ["--", "--no-isolate", ...ohneMock, ...server],
        });
    }
    if (rest.length > 0) {
        durchgaenge.push({
            name: "Tests ohne Datenbank, Durchgang Web und shared (ohne Isolierung)",
            args: ["--", "--no-isolate", ...ohneMock, ...rest],
        });
    }
    if (mock.length > 0) {
        durchgaenge.push({
            name: `Tests ohne Datenbank, Durchgang mit vi.mock (isoliert, ${String(mock.length)} Dateien)`,
            args: ["--", ...mock],
        });
    }
    if (durchgaenge.length === 0) return einfach;
    const namen = mock.map((p) => p.replace(/^.*\//, "").replace(/\.test\.ts$/, ""));
    return {
        durchgaenge,
        isoliert: mock,
        zeile:
            mock.length === 0
                ? "  Isoliert lief nichts: keine Datei benutzt vi.mock (Server und Rest je ein Durchgang ohne Isolierung)."
                : `  Isoliert liefen ${String(mock.length)} Dateien mit vi.mock: ${namen.join(", ")}; alles andere in zwei Durchgängen ohne Isolierung (Server, Web und shared).`,
    };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Datenbanktests, die nicht liefen (Hauptorchestrierung 2026-10-18: ein seit D2 roter Test fiel nicht auf, „weil die Vorprüfung ihn ohne
// Datenbank überspringt“). Gemessen am 2026-10-18: 187 von 726 Testdateien lesen `TEST_DATABASE_URL`, 5 weitere `DATABASE_URL`. Sie laufen
// in KEINEM automatischen Lauf: `vor-dem-push` nimmt dem Testlauf die Datenbank (Absicht: keine geteilte Datenbank anfassen), die
// Prüfung nach dem Push läuft laut ihrem Kopf ohne Datenbank, ein Worktree hat kein `.env`. Vitest meldet die Zahl am Ende des Laufs
// (`vitest.global-setup.ts`), `vor-dem-push` schluckte diese Zeile aber, solange der Schritt grün war.
//
// 🔴 Seit WI-0224 (Entscheidung der Hauptorchestrierung 2026-10-18: Datenbanktests gehören in jeden vollen Testlauf vor dem Push) fährt die
// Stufe „voll“ die Dateien mit `TEST_DATABASE_URL` in einem Wegwerf-Postgres mit (`planeDurchgaenge` mit `datenbankDateien`, der Durchgang
// `datenbank`); welche, wählt `db-auswahl.ts` nach der Pfadregel (alle 188 nur mit `--voll`; Hauptorchestrierung 2026-10-18: „diese prüfungen
// dauern ewig“). Die kleinen Stufen (doku, web) wählen nur die, die geänderte Dateien nennen (`waehleDbDateienKleineStufe`). Bleiben auch die fünf Dateien mit `DATABASE_URL`: Sie brauchen
// die echten Kartendaten der Entwicklungsdatenbank und werden nur gemeldet.

export interface Uebersprungen {
    /** Dateien, die `TEST_DATABASE_URL` brauchen. */
    readonly testdatenbank: number;
    /** Dateien, die `DATABASE_URL` brauchen (Routing-Korpus, Dateninvarianten). */
    readonly entwicklungsdatenbank: number;
}

/** Die Zahlen aus den Schlusszeilen von `vitest.global-setup.ts` (`skipZeilen`); keine Zeile heißt: nichts übersprungen. */
export function liesUebersprungene(ausgabe: string): Uebersprungen {
    const summe = (muster: RegExp): number =>
        [...ausgabe.matchAll(muster)].reduce((s, m) => s + Number.parseInt(m[1] ?? "0", 10), 0);
    return {
        testdatenbank: summe(/(\d+) Testdatei\(en\) mit Datenbank/g),
        entwicklungsdatenbank: summe(/(\d+) Testdatei\(en\) gegen die Entwicklungsdatenbank/g),
    };
}

export function summeUebersprungen(u: Uebersprungen): number {
    return u.testdatenbank + u.entwicklungsdatenbank;
}

/** Ein Satz für die Zeile im Lauf und die Schlusszeile; `undefined`, wenn nichts übersprungen wurde. */
export function datenbankSatz(u: Uebersprungen, ausgelassen = 0): string | undefined {
    const teile = [
        u.testdatenbank > 0 ? `fehlende Datenbank: ${String(u.testdatenbank)}` : "",
        ausgelassen > 0 ? `ausgelassen nach Pfadregel: ${String(ausgelassen)}` : "",
        u.entwicklungsdatenbank > 0 ? `brauchen die Entwicklungsdatenbank: ${String(u.entwicklungsdatenbank)}` : "",
    ].filter((teil) => teil !== "");
    return teile.length === 0 ? undefined : `Datenbanktests nicht gelaufen (${teile.join("; ")})`;
}

/**
 * Wird der Lauf rot, weil Datenbanktests fehlten? Nur der volle Lauf (Stufe „voll“, auch `--voll`) und nur, wenn Dateien mit der
 * Testdatenbank nicht liefen und der Aufrufer es nicht mit `--ohne-datenbank` bewusst quittiert hat. Die fünf Dateien mit der
 * Entwicklungsdatenbank zählen nicht (sie brauchen echte Kartendaten und bleiben nur gemeldet); die kleinen Stufen bleiben grün und sagen es.
 */
export function datenbankRot(optionen: {
    readonly voll: boolean;
    readonly quittiert: boolean;
    readonly uebersprungen: Uebersprungen;
}): boolean {
    return optionen.voll && !optionen.quittiert && optionen.uebersprungen.testdatenbank > 0;
}

/**
 * Die Frist je Testfall der Durchgänge ohne Datenbank (wie beim Datenbank-Durchgang und in Claudios Prüfung nach dem Push). Auf einem Rechner, den
 * mehrere Sitzungen teilen, scheitert ein Fall unter Last an der Zeit statt am Code: Am 2026-10-18 war `commit-waechter` im vollen Lauf mit 15 s rot
 * (Frist 5 s), allein grün in 2 s.
 */
export const FALL_FRIST_MS = 30_000;
/**
 * Die Frist je Hook: Ein Test, der in `beforeAll` einen eigenen Wegwerf-Cluster startet (`vps-cluster.ts`), braucht unter Last mehr als die 10 s der
 * Vorgabe (`territory-reparent` war im vollen Lauf rot, allein grün in 14 s).
 */
export const HOOK_FRIST_MS = 120_000;

/** Hängt die Frist an die Argumente hinter `npm test` an; `--` kommt dazu, wo es fehlt (ein Durchgang ohne Dateiliste hat keins). */
export function mitFrist(args: readonly string[]): string[] {
    return [
        ...(args[0] === "--" ? args : ["--", ...args]),
        `--testTimeout=${String(FALL_FRIST_MS)}`,
        `--hookTimeout=${String(HOOK_FRIST_MS)}`,
    ];
}

/**
 * Wie viel Arbeitsspeicher der Datenbank-Durchgang neben den anderen Durchgängen braucht (der Vitest-Prozess und der Postgres) und wie viel
 * der Rechner danach noch frei haben soll, damit nichts in die Auslagerungsdatei kippt (Zeitüberschreitungen sind dann kein Urteil über den
 * Commit). Der Bedarf ist gemessen: Claudios nächtlicher Lauf auf dem VPS brauchte am Host rund 2,1 GB (WI-0224 §4), dazu eine Reserve von einem Fünftel.
 */
export const DB_DURCHGANG_RAM_BEDARF_BYTES = 2.5 * 1024 ** 3;
export const DB_DURCHGANG_RAM_BODEN_BYTES = 4 * 1024 ** 3;

/**
 * Läuft der Datenbank-Durchgang neben den anderen oder danach? Parallel nur, wenn zu Beginn genug Arbeitsspeicher frei ist: Bedarf plus
 * Boden. Die Entscheidung trifft das Werkzeug aus der Lagezeile der Prüfbank, nicht der Aufrufer (Hauptorchestrierung 2026-10-18).
 */
export function datenbankParallel(ramFrei: number | undefined): { parallel: boolean; grund: string } {
    const gb = (bytes: number): string => (bytes / 1024 ** 3).toLocaleString("de-DE", { maximumFractionDigits: 1 });
    const noetig = DB_DURCHGANG_RAM_BEDARF_BYTES + DB_DURCHGANG_RAM_BODEN_BYTES;
    if (ramFrei === undefined) return { parallel: false, grund: "freier Arbeitsspeicher unbekannt" };
    return ramFrei >= noetig
        ? { parallel: true, grund: `${gb(ramFrei)} GB RAM frei, nötig ${gb(noetig)} GB` }
        : { parallel: false, grund: `nur ${gb(ramFrei)} GB RAM frei, nötig ${gb(noetig)} GB` };
}

/** Der Wächter der Handover-Köpfe; `vor-dem-push` fährt ihn allein, wenn ein Push Handovers berührt und `--tests` nicht ohnehin läuft. */
export const HANDOVER_KOPF_TEST = "apps/server/test/regelwerk-handover-koepfe.test.ts";

/**
 * Berührt der Push Handovers oder den Parser ihrer Köpfe? Dann läuft die Kopfprüfung in jeder Stufe, auch ohne `--tests` und in der
 * Stufe „doku“, die den Wächter nur mit `--tests` kennt (Hauptorchestrierung 2026-10-18: ein Handover mit `status | OPEN` kam auf
 * origin und machte den Wächter erst nach dem Push rot). Nicht bestimmbar: sicherheitshalber ja, die Prüfung kostet Sekunden.
 */
export function beruehrtHandover(geaendert: readonly string[] | undefined): boolean {
    if (geaendert === undefined) return true;
    return geaendert
        .map((p) => p.split("\\").join("/"))
        .some((p) => p.startsWith("project-control/handovers/") || p === "scripts/coordination/handover-protocol.ts");
}

/** Der Wächter der Gelände-Sicht (WI-0271 L1, Migration 0268): kein Geländeleser liest `terrain_peak` direkt. */
export const GELAENDE_SICHT_TEST = "apps/server/test/terrain-peak-gelaende.test.ts";

/** Die Geländeleser außerhalb von `terrain/` und `gebirge/`, die der Wächter bewacht (Topographie-Koordination 2026-10-31). */
const GELAENDE_LESER = new Set([
    "apps/server/src/editor/landscapes.ts",
    "apps/server/src/editor/landscape-update.ts",
    "apps/server/src/editor/peak-update.ts",
    "apps/server/src/abgleiche/bezuege.ts",
    "apps/server/src/migration/terrain.ts",
    "apps/server/src/migration/verify-terrain.ts",
    GELAENDE_SICHT_TEST,
]);

/**
 * Berührt der Push einen Geländeleser von `terrain_peak`? Dann läuft der Wächter der Gelände-Sicht in jeder Stufe, auch ohne `--tests`,
 * als Hinweis (WI-0271 L1; Betreiber 2026-10-24: keine neue blockierende Prüfung ohne seine Zustimmung). Er liest nur Dateien und kostet
 * Sekunden; nicht bestimmbar: sicherheitshalber ja.
 */
export function beruehrtGelaendeLeser(geaendert: readonly string[] | undefined): boolean {
    if (geaendert === undefined) return true;
    return geaendert
        .map((p) => p.split("\\").join("/"))
        .some(
            (p) =>
                p.startsWith("apps/server/src/terrain/") ||
                p.startsWith("packages/shared/src/gebirge/") ||
                GELAENDE_LESER.has(p),
        );
}

export const RELEASE_TEILE_TEST = "apps/server/test/release-teile.test.ts";

/**
 * Berührt der Push Browser-Specs oder ihre Zuordnung zu den Release-Teilen? Dann läuft der Wächter der Teile in jeder Stufe, auch ohne
 * `--tests` (Release-Test 98e0eab, 2026-10-24: zwei neue Specs ohne Teil, alle vier Browserteile übersprungen, erst nach 1,3 h Vitest
 * gemerkt). Der Wächter liest nur Dateien und kostet Sekunden; nicht bestimmbar: sicherheitshalber ja.
 */
export function beruehrtReleaseTeile(geaendert: readonly string[] | undefined): boolean {
    if (geaendert === undefined) return true;
    return geaendert
        .map((p) => p.split("\\").join("/"))
        .some(
            (p) =>
                (p.startsWith("apps/web/e2e/") && p.endsWith(".spec.ts")) ||
                p === "apps/web/e2e/release-teile.json" ||
                p === "apps/web/e2e/spec-auswahl.ts" ||
                p === "apps/web/playwright.config.ts",
        );
}

/**
 * Nur Markdown unter `docs/`, `project-control/` oder `AGENTS.md`/`CLAUDE.md` geändert? Dann kann kein Skript, keine Konfiguration und kein
 * JSON den Typcheck ändern: `vor-dem-push` lässt in der Stufe „doku“ den `shared`-Bau und den Typcheck aus (Hauptorchestrierung
 * 2026-10-17). Enger als die Stufe „doku“ selbst, die auch Review-Blätter und Markdown überall zählt.
 */
export function nurMarkdownDoku(geaendert: readonly string[]): boolean {
    return (
        geaendert.length > 0 &&
        geaendert
            .map((p) => p.split("\\").join("/"))
            .every((p) => /^(docs|project-control)\/.+\.md$/.test(p) || /^(AGENTS|CLAUDE)\.md$/.test(p))
    );
}
