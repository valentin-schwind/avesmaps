// One finite Production-candidate job. Never started by a periodic task.
//
// `node scripts/dev/release-runner.ts --commit <SHA40> --fixtures <Testpaket> [--uebernehmen <früherer Lauf>]` (Starter: `release-start.ps1`,
// Abholer: `release-abholer.ts`).
//
// 🔴 Das Tor (Profil `tor`, WI-0264, Vali 2026-10-30; Vorgabe): Installation und gemeinsamer Bau, dann drei Teile auf derselben SHA in einem eigenen
// Klon: `bau` (Lint, Typen, Release-Bau), `daten` (Migrationen und Rechte auf den echten Daten des Testpakets, `schreibwege-app-rolle.test.ts`) und
// `kern-echt` (die Kernabläufe aus `apps/web/e2e/release-tor.json` im Browser gegen den Fastify des Kandidaten auf dem Korpus, als Editor angemeldet:
// `scripts/dev/tor-welt.ts` des Kandidaten legt Person und Sitzung an, `--retries=1`, ein wackeliger Fall zählt grün und steht im Bericht).
// Vitest über alle Dateien und die volle Browser-Suite halten nichts mehr auf; sie laufen nur noch auf Auftrag (`AVESMAPS_RELEASE_PROFIL=B|voll`).
//
// 🔴 Der Lauf der Profile `B` und `voll` (WI-0248 R1, WI-0228 D): Installation, Lint, Format, Typcheck, ALLE Vitests im vollen Umfang
// (`AVESMAPS_INVARIANTS=full`, null übersprungene Fälle), Release-Bau, Besucherpaket-Wächter und die Browserteile (B: die Stichprobe `kern`, `voll`:
// vier Teile), alles auf derselben SHA in einem eigenen Klon. Keine Nachläufe, keine bekannten Roten, `--retries=0`. Während des Laufs hält ein
// PowerShell-Kind den Rechner wach (`release-wach.ts`).
//
// 🔴 Browserteile nach Thema (WI-0248): Die vier Teile `browser-1` … `browser-4` sind feste Gruppen von Spec-Dateien (`apps/web/e2e/release-teile.json`,
// Logik in `release-teile.ts`), nicht mehr `--shard=n/4`. Die Kennungen und der Nachweis Version 3 sind dieselben wie vorher.
//
// 🔴 Immer bis zum Ende (WI-0248): Ein roter Schritt (Lint, Format, Typen, Vitest, Bau, Besucherpaket, ein Browserteil) bricht den Lauf nicht
// ab; die übrigen Teile laufen weiter (`release-ablauf.ts`: Reihenfolge und Buchführung). Am Ende ist der Lauf rot, und `fehler.txt` nennt jeden
// roten Schritt in einer Zeile. Ohne Installation, gemeinsamen Bau, Korpus und Testpaket läuft nichts; dort endet der Lauf wie bisher sofort.
// Zeit- und Abbruchgrenzen bleiben: ein Schritt über seiner Grenze ist rot, die Gesamtzeit (zwölf Stunden) und die Datei ABBRUCH beenden den Lauf.
//
// 🔴 Wiederholung (WI-0248, `--uebernehmen <Ordnername>`): Für DIESELBE SHA übernimmt der Lauf die grünen Teile eines früheren Laufs (Rohbericht und
// Beleg), wenn die Umgebung dieselbe ist (Fingerabdruck; `release-wiederholen.ts`), und fährt nur die roten oder fehlenden neu. Sonst läuft alles neu,
// und das Laufbuch (`teile.json`) nennt den Grund. Der Nachweis wird erst grün, wenn alle fünf Teile dieser SHA grün sind.
//
// 🔴 Testpaket (Schema 2, Vertrag in `release-testpaket.ts`): `manifest.json` (Schema, Erstellzeit, Migrationen der Quelle), `daten.dump`
// (`pg_dump -Fc`, VOLLSTÄNDIG: Schema und Daten), `tiles/`, `media/`. Der Runner spielt den Dump in einen leeren Wegwerf-Cluster ein
// (Unit-Tests haben einen eigenen, getrennten) und wendet danach die Migrationen DES KANDIDATEN vorwärts an, wie Stage und Production beim
// Update. Fehlt eine Migration der Quelle im Kandidaten, ist der Lauf rot („Testpaket neuer als der Kandidat“).
//
// 🔴 Notiz (`refs/notes/sammellauf`): `offen` sofort nach der SHA-Prüfung, noch vor den Voraussetzungen; danach `gruen` (Nachweis Version 3) oder
// `rot` mit einer kurzen, pfadfreien Begründung in der zweiten Zeile (`release-grund.ts`), auch bei fehlender Voraussetzung, Abbruch und Zeitgrenze.
// Ohne Notiz bleibt nur ein Lauf, der vor der SHA-Prüfung endet, und die Wiederverwendung eines gleichwertigen grünen Nachweises.
//
// 🔴 Aufräumen (WI-0248, `release-aufraeumen.ts`): Gleich nach der SHA-Prüfung, bevor dieser Lauf Platz braucht, räumt der Runner `.release-runs` auf:
// Es bleiben dieser Lauf und der jüngste andere (bei `--uebernehmen` der Ordner des früheren Laufs), alles Ältere fällt weg, außer es kann noch leben.
// Junctions werden zuerst gelöst, nie verfolgt. Freier Platz vorher und nachher, jede Handlung und eine Warnung unter 10 GB stehen in `aufraeumen.txt`.
// Ein Fehler dabei hält den Lauf nie an.
//
// 🔴 Routing-Gate (WI-0248, `release-routing.ts`): Vor dem Vitest-Teil vergleicht der Runner die Routing-Revision des Korpus mit der Basislinie. Weicht
// sie ab, rechnet der Code der Basislinie die Fälle auf diesem Korpus (Vergleichsstand im Laufordner), und das Gate vergleicht den Kandidaten damit;
// `bericht.md` nennt den Weg. Scheitert die Gegenprobe, ist der Vitest-Teil rot mit dem Grund.
//
// 🔴 Die Browserteile sehen einen eigenen Martin (`release-dienste.ts`) gegen diesen Korpus auf einem freien Port (`MARTIN_PORT`), nie den
// Martin des Entwicklungsstapels auf 3010. Fehlt `martin.exe`, ist der Lauf rot; lässt er sich nicht starten, entfallen die Browserteile mit Grund.
//
// 🔴 Nur Bericht (`--nur-bericht`, der Volltest der Systemsteuerung, WI-0264; Vali 2026-10-31: „Schnelltest und Volltest“): Der Lauf schreibt seine
// Notiz nur in den Ergebnisordner (`notiz.txt`), nie nach `refs/notes/sammellauf`. Sonst überschriebe er das Urteil eines freigegebenen Schnelltests
// derselben SHA, bevor Claudios Abholer es gelesen hat, und die Auslieferung bliebe stehen. `status.json` trägt `nurBericht: true`; ein solcher Lauf
// zählt für den Starter nie als grün geprüft. `--vorlauf <Ordnername>` (Teil 2 des Volltests) nennt den Lauf von Teil 1 (Profil `tor`): Er bleibt beim
// Aufräumen stehen, sein Ergebnis steht in `status.json` (`vorlauf`), und `bericht.md` enthält seinen Bericht, damit es EINE Seite bleibt.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { leseTestDateien } from "./db-tests.ts";
import { lebtPid, leseStartvermerke, STARTVERMERK_MAX_MS } from "./release-abholer.ts";
import {
    BAU_SCHRITTE,
    browserBefund,
    datenBefund,
    exitBefund,
    fuehreAus,
    TeileRot,
    VOLL_SCHRITTE,
    zeitBefund,
    type AblaufIo,
    type AblaufPlan,
    type Befund,
    type SchrittStatus,
} from "./release-ablauf.ts";
import { raeumeLaeufeAuf } from "./release-aufraeumen.ts";
import { findeMartin, starteMartin, type Dienst } from "./release-dienste.ts";
import { beendeHart, beendeKinder, gibSperreFrei } from "./release-ende.ts";
import {
    VoraussetzungFehlt,
    notizGrund,
    notizGrundTeile,
    offenNotiz,
    rotNotiz,
    vitestMeldung,
    type VitestBericht,
} from "./release-grund.ts";
import { KENNUNG_MUSTER } from "./release-freigabe.ts";
import { schreibeLaufBuch, type LaufBuch, type LaufBuchWiederholung } from "./release-laufbuch.ts";
import { OFFEN_QUELLE, schreibeBerichtSeite } from "./release-seite.ts";
import {
    releaseBelege,
    releaseGruen,
    releaseKlassen,
    releaseNotiz,
    releaseProfilAus,
    releaseProzess,
    type ReleaseNachweis,
} from "./release-nachweis.ts";
import { browserFluechtig, browserUnveraendertSeit, fingerprint, geaenderteKomponenten } from "./release-pruefsumme.ts";
import {
    ladeKern,
    ladeTor,
    ladeZuordnung,
    playwrightFilter,
    TEIL_IDS,
    TeileFehler,
    zuordnungProblem,
    type TeilZuordnung,
} from "./release-teile.ts";
import { starteWachhalten } from "./release-wach.ts";
import {
    BELEG_DATEI,
    LAUF_ORDNER,
    liesAltLauf,
    liesVorlauf,
    planeWiederholung,
    uebernimmTeile,
} from "./release-wiederholen.ts";
import {
    bereiteRoutingGateVor,
    ROUTING_PROTOKOLL,
    ROUTING_VERGLEICH_ENV,
    vitestMitRouting,
    type RoutingIo,
} from "./release-routing.ts";
import { findePostgres, spieleSaatEin, starteWegwerfDb, WEGWERF_DATENBANK, type WegwerfDb } from "./wegwerf-db.ts";
import { migrationenAusBaum, liesManifest, pruefeTestpaketManifest, spieleTestpaketEin } from "./release-testpaket.ts";

const arg = (name: string): string => process.argv[process.argv.indexOf(name) + 1] ?? "";
/** Ein Wert, der fehlen darf: `""`, wenn die Angabe nicht im Aufruf steht (`arg` läse dann `process.argv[0]`). */
const optionalesArg = (name: string): string => (process.argv.includes(name) ? arg(name) : "");
const sha = arg("--commit");
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("--commit benötigt eine vollständige unveränderliche SHA");
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const basis = join(repo, ".release-runs", sha);
mkdirSync(basis, { recursive: true });
// Exclusive finite job: a crash leaves a visible lock; no automatic retry or lock stealing.
const lock = join(repo, ".release-runs", "aktiv");
mkdirSync(lock);
// 🔴 Die Sperre ist ab hier unsere und geht auf JEDEM Weg wieder weg (WI-0248): grün, rot, Zeit, Abbruch, Ausnahme, auch eine Ausnahme vor dem `try`. Nur wenn das
// harte Ende nicht bestätigen kann, dass alle Kinder weg sind, bleibt sie zur Diagnose stehen (`sperreBehalten`). Ein Endweg, den kein `finally` sieht
// (`process.exit` im harten Ende), erreicht dieser Haken.
let sperreBehalten = false;
process.on("exit", () => {
    if (!sperreBehalten) gibSperreFrei(lock);
});
const status = join(basis, "status.json");
// Prüfprofil: `tor` (Vorgabe seit WI-0264, Vali 2026-10-30) = Bau, Daten, Kernabläufe gegen den echten Server; B (Betreiberentscheidung 2026-10-24) =
// statische Prüfung, Bau, alle Vitest-Tests und die Browser-Stichprobe der Kernabläufe; die vier Browserteile (`voll`) nur auf ausdrücklichen Auftrag
// mit AVESMAPS_RELEASE_PROFIL=voll (B: =B). Der Nachweis nennt das Profil.
const profil = releaseProfilAus(process.env);
// Die Freigabe, mit der dieser Lauf gestartet wurde (WI-0248, Vali 2026-10-26: die Auslieferung folgt automatisch bei Grün): Ihre Kennung steht im
// Nachweis, und nur ein grüner Nachweis mit der Kennung der jüngsten Freigabe geht nach Production (`release-freigabe.ts`). Ohne: von Hand gestartet.
const freigabe = optionalesArg("--freigabe");
if (freigabe !== "" && !KENNUNG_MUSTER.test(freigabe)) throw new Error("--freigabe benötigt eine Kennung RT-<uuid>");
// Der Volltest (Kopf der Datei): nur Bericht, nie eine Notiz auf origin, nie mit Freigabe.
const nurBericht = process.argv.includes("--nur-bericht");
if (nurBericht && freigabe !== "") throw new Error("--nur-bericht und --freigabe schließen sich aus");
const vorlauf = optionalesArg("--vorlauf");
if (vorlauf !== "" && (!nurBericht || !LAUF_ORDNER.test(vorlauf) || !vorlauf.startsWith(sha)))
    throw new Error("--vorlauf braucht --nur-bericht und einen Laufordner derselben SHA");
const n: ReleaseNachweis = {
    version: 3,
    sha,
    umgebung: "",
    start: new Date().toISOString(),
    ende: "",
    status: "laeuft",
    profil,
    ...(freigabe === "" ? {} : { auftrag: freigabe }),
    ...(nurBericht ? { nurBericht: true as const } : {}),
    ...(vorlauf === "" ? {} : { vorlauf: liesVorlauf(join(repo, ".release-runs", vorlauf), vorlauf) }),
    teile: [],
    belege: {},
};
/**
 * Der eine Bericht (`bericht.md`, `release-seite.ts`) an jedem Ende: „Offen“ aus `current.md` im Stand der geprüften SHA (der Klon des Kandidaten,
 * sonst `git show` im Werkzeugklon). Wirft nie.
 */
const schreibeBericht = (): void => {
    let offen: string | null;
    try {
        const datei = join(basis, "checkout", ...OFFEN_QUELLE.split("/"));
        offen = existsSync(datei)
            ? readFileSync(datei, "utf8")
            : execFileSync("git", ["show", `${sha}:${OFFEN_QUELLE}`], {
                  cwd: repo,
                  encoding: "utf8",
                  timeout: 30_000,
                  windowsHide: true,
                  stdio: ["ignore", "pipe", "ignore"],
              });
    } catch {
        offen = null;
    }
    schreibeBerichtSeite(basis, offen);
};
const speichern = (): void => {
    writeFileSync(`${status}.tmp`, JSON.stringify(n, null, 2));
    renameSync(`${status}.tmp`, status);
};
// Was beim harten Ende zuerst weg muss (Martin, Wachhalten, Wegwerf-Cluster): Der Prozessbaum-Abbruch unten lässt kein Aufräumen mehr zu.
const aufraeumer: (() => void)[] = [];
let hartBeendet = false;
const hartEnde = (grund: "abgebrochen" | "timeout"): void => {
    // Das Ende läuft synchron, aber die Uhr und die Datei ABBRUCH feuern weiter, solange es dauert (Notiz veröffentlichen): nur einmal.
    if (hartBeendet) return;
    hartBeendet = true;
    beendeHart({
        schreibeEnde: () => {
            n.status = grund;
            n.ende = new Date().toISOString();
            speichern();
            // Wie der `catch` unten: Der Grund steht auch hier in `fehler.txt`, damit die Karte ihn als Satz zeigt und nicht aus dem Status raten muss.
            writeFileSync(
                join(basis, "fehler.txt"),
                grund === "timeout"
                    ? "Gesamtzeit von zwölf Stunden überschritten"
                    : "Lauf abgebrochen (ABBRUCH im Ergebnisordner)",
            );
            schreibeBericht();
        },
        // Was der Runner selbst gestartet hat und selbst beendet (Martin, Cluster, Wachhalten); danach die Kinder samt Nachkommen, NIE der Runner selbst.
        dienste: aufraeumer,
        kinder: () => beendeKinder(process.pid).alleWeg,
        notiz: () => {
            // Eine angekündigte Prüfung endet nie als „offen“: Abbruch und Zeitgrenze sind rot (best effort, das Ende ist beschlossen).
            if (!angekuendigt) return;
            publiziere(
                rotNotiz(
                    sha,
                    n.ende,
                    grund === "timeout"
                        ? "Lauf fehlgeschlagen: Gesamtzeit von zwölf Stunden überschritten"
                        : "Lauf abgebrochen (ABBRUCH im Ergebnisordner)",
                ),
            );
        },
        sperreFrei: () => {
            gibSperreFrei(lock);
        },
        // Notbehelf (nur wenn ein Kind nicht bestätigt weg ist): der eigene Prozessbaum geht mit, die Sperre bleibt (der Abholer gibt sie später frei).
        selbstBeenden: () => {
            sperreBehalten = true;
            if (process.platform === "win32")
                spawnSync("taskkill", ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true });
        },
        verlasse: (code) => process.exit(code),
    });
};
const deadline = setTimeout(() => hartEnde("timeout"), 12 * 3600_000);
const abbrechen = setInterval(() => {
    if (existsSync(join(basis, "ABBRUCH"))) hartEnde("abgebrochen");
}, 1000);
speichern();
// Der Rechner darf während des Laufs nicht schlafen gehen; endet mit diesem Prozess, spätestens im finally.
const wach = starteWachhalten();
/** Der Cluster der Unit-Tests (Vitest) und der Korpus der Browserteile: getrennt, damit zerstörerische Fälle den Korpus nie berühren. */
let unitDb: WegwerfDb | undefined;
let korpus: WegwerfDb | undefined;
let martin: Dienst | undefined;
aufraeumer.push(
    () => wach?.beende(),
    () => martin?.beende(),
    () => unitDb?.stoppe(),
    () => korpus?.stoppe(),
);
const git = (args: string[], cwd = repo): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", timeout: 60_000, windowsHide: true }).trim();
let angekuendigt = false;
const publiziere = (text: string): void => {
    const datei = join(basis, "notiz.txt");
    writeFileSync(datei, text);
    // Der Volltest (Kopf der Datei) schreibt nur in den Ergebnisordner: nie ein Urteil über eine SHA, die gerade ausgeliefert werden soll.
    if (nurBericht) return;
    if (git(["ls-remote", "origin", "refs/notes/sammellauf"]) !== "")
        git(["fetch", "origin", "refs/notes/sammellauf:refs/notes/sammellauf"]);
    git(["notes", "--ref=sammellauf", "add", "-f", "-F", datei, sha]);
    git(["push", "origin", "refs/notes/sammellauf:refs/notes/sammellauf"]);
};
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
/**
 * Alte Laufordner räumen, bevor dieser Lauf Platz braucht (`release-aufraeumen.ts`): Es bleiben dieser Lauf und der jüngste andere, bei einer
 * Wiederholung der Ordner des früheren Laufs. Das Protokoll geht auf die Ausgabe und nach `aufraeumen.txt` im Ergebnisordner (bewusst kein `.log`:
 * So heißen die Schrittprotokolle, und die Oberfläche liest ihre Namen als Schritte). Jeder Fehler ist eine Zeile, nie ein Abbruch des Laufs; die
 * Sperre `aktiv` halten wir schon, neben uns läuft also kein anderer Runner.
 */
const raeumeAltesAuf = async (): Promise<void> => {
    const sag = (zeile: string): void => {
        process.stdout.write(`${zeile}\n`);
        try {
            appendFileSync(join(basis, "aufraeumen.txt"), `${zeile}\n`);
        } catch {
            /* Das Protokoll hilft der Diagnose und ist nie der Grund, den Lauf anzuhalten (die Platte kann gerade voll sein). */
        }
    };
    try {
        // Läuft für eine SHA noch ein Starter (Startvermerk „baut“), bleiben ihre Ordner liegen. Die Datenwurzel ist die des Werkzeugklons.
        const geschuetzteShas = new Set<string>();
        const wurzeln = [
            process.env["AVESMAPS_DATEN"],
            basename(repo) === "release-werkzeug" ? dirname(repo) : undefined,
        ];
        for (const daten of wurzeln) {
            if (daten === undefined || daten === "") continue;
            for (const v of leseStartvermerke(daten))
                if (
                    v.zustand === "baut" &&
                    v.sha !== sha &&
                    Date.now() - Date.parse(v.seit) <= STARTVERMERK_MAX_MS &&
                    lebtPid(v.pid)
                )
                    geschuetzteShas.add(v.sha);
        }
        // Bei einer Wiederholung bleibt der frühere Lauf stehen, beim Volltest Teil 1 (`--vorlauf`): Sein Bericht steht in dieser Seite.
        const frueher = optionalesArg("--uebernehmen") || vorlauf;
        await raeumeLaeufeAuf({
            laeufe: join(repo, ".release-runs"),
            aktuell: sha,
            ...(frueher === "" ? {} : { erhalten: frueher }),
            geschuetzteShas,
            sag,
        });
    } catch (e) {
        sag(
            `Aufräumen alter Läufe fehlgeschlagen (${e instanceof Error ? e.message : "Fehler"}); der Lauf geht weiter`,
        );
    }
};
const port = (): Promise<number> =>
    new Promise((ok, fail) => {
        const s = net.createServer();
        s.once("error", fail);
        s.listen(0, "127.0.0.1", () => {
            const a = s.address();
            s.close(() => (typeof a === "object" && a !== null ? ok(a.port) : fail(new Error("Port fehlt"))));
        });
    });
/** Der eine Test des Teils `daten` (Profil `tor`): alle Schreibwege als App-Rolle auf einem Cluster mit den Daten des Testpakets. */
const DATEN_TEST = "apps/server/test/schreibwege-app-rolle.test.ts";
/** Dateien, die den Maßstab des Urteils tragen und darum zum Fingerabdruck der Umgebung gehören (neben dem Runner selbst). */
const VERTRAG = [
    "release-nachweis.ts",
    "release-testpaket.ts",
    "release-grund.ts",
    "release-dienste.ts",
    "release-wach.ts",
    "release-ablauf.ts",
    "release-laufbuch.ts",
    "release-pruefsumme.ts",
    "release-teile.ts",
    "release-wiederholen.ts",
    "release-routing.ts",
    "routing-gate-rechnen.ts",
    "sammellauf-auswertung.ts",
    "wegwerf-db.ts",
    "wegwerf-db-saat.ts",
    "../../apps/web/e2e/spec-auswahl.ts",
];
try {
    if (git(["rev-parse", `${sha}^{commit}`]) !== sha) throw new Error("Kandidat unbekannt");
    git(["merge-base", "--is-ancestor", sha, "origin/master"]);
    await raeumeAltesAuf();
    // 🔴 Die Prüfung wird sofort nach der SHA-Prüfung angekündigt, noch vor den Voraussetzungen: Jeder spätere Fehler ist dann eine rote Notiz mit
    // Begründung statt eines „beauftragt“ ohne Ende. Ausnahme: Ein gleichwertiger grüner Nachweis wird nur wiederverwendet, ohne „offen“ davor.
    const ergebnis = join(basis, "ergebnis.json");
    if (!existsSync(ergebnis)) {
        publiziere(offenNotiz(sha, n.start));
        angekuendigt = true;
    }
    const fixtures = resolve(arg("--fixtures"));
    // Snapshot is copied before use. Nothing in the supplied source is ever written.
    if (
        !existsSync(join(fixtures, "daten.dump")) ||
        !existsSync(join(fixtures, "tiles")) ||
        !existsSync(join(fixtures, "media"))
    )
        throw new VoraussetzungFehlt(
            "Testpaket unvollständig: manifest.json (Schema 2), daten.dump (pg_dump -Fc, vollständig: Schema und Daten), tiles/, media/",
        );
    // Das Testpaket muss zum Kandidaten passen, bevor irgendetwas gebaut oder eingespielt wird (Vertrag: release-testpaket.ts).
    const paket = pruefeTestpaketManifest(
        liesManifest(fixtures),
        migrationenAusBaum(git(["ls-tree", "--name-only", sha, "apps/server/migrations/"])),
    );
    if (!paket.ok) throw new VoraussetzungFehlt(paket.grund);
    process.stdout.write(
        `Testpaket vom ${paket.erstellt}: ${String(paket.quelle.length)} Migrationen in der Quelle, ${String(paket.folgend.length)} folgen im Kandidaten\n`,
    );
    const bin = findePostgres();
    if (bin === undefined) throw new VoraussetzungFehlt("PostgreSQL fehlt");
    const martinBin = findeMartin();
    if (martinBin === undefined)
        throw new VoraussetzungFehlt(
            "Martin fehlt (martin.exe oder MARTIN_BIN): ohne Vektorkacheln ist kein Browserteil aussagekräftig",
        );
    const browser = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? join(process.env["LOCALAPPDATA"] ?? "", "ms-playwright");
    /** Die Bestandteile des Fingerabdrucks der Umgebung; eine Wiederholung vergleicht sie mit denen des früheren Laufs und nennt, WAS abweicht. */
    const komponenten = (): Record<string, string> => ({
        node: fingerprint(process.execPath),
        platform: `${process.platform}-${process.arch}`,
        postgres: fingerprint(dirname(bin)),
        martin: fingerprint(martinBin),
        browser: fingerprint(browser, browserFluechtig),
        fixtures: fingerprint(fixtures),
        lock: sha256(git(["show", `${sha}:package-lock.json`])),
        runner: fingerprint(fileURLToPath(import.meta.url)),
        vertrag: sha256(VERTRAG.map((p) => fingerprint(fileURLToPath(new URL(p, import.meta.url)))).join("\n")),
    });
    const umgebungVon = (k: Record<string, string>): string => sha256(JSON.stringify(k));
    const komponentenStart = komponenten();
    n.umgebung = umgebungVon(komponentenStart);
    speichern();
    if (existsSync(ergebnis)) {
        const alt = JSON.parse(readFileSync(ergebnis, "utf8")) as ReleaseNachweis;
        const belege = alt.belege ?? {};
        const altBelege = releaseBelege(alt.profil);
        const intakt =
            alt.profil === profil &&
            Object.entries(belege).length === altBelege.length &&
            Object.entries(belege).every(
                ([datei, hash]) => altBelege.includes(datei) && fingerprint(join(basis, datei)) === hash,
            );
        if (intakt && releaseGruen(alt, sha, n.umgebung)) {
            Object.assign(n, alt);
            // Die Freigabe dieses Starts gilt, nicht die des früheren Laufs.
            if (freigabe !== "") n.auftrag = freigabe;
            speichern();
            process.stdout.write("Gleichwertiger gültiger Nachweis wiederverwendet\n");
        } else throw new Error("Vorhandener Nachweis nicht gleichwertig/grün; kein automatischer Wiederholungsversuch");
    } else {
        const kopie = join(basis, "checkout");
        const daten = join(basis, "fixtures");
        // Reject symlinks through fingerprint before copying into the private test environment.
        cpSync(fixtures, daten, { recursive: true, errorOnExist: true, force: false });
        git(["clone", "--no-hardlinks", "--no-checkout", repo, kopie]);
        git(["checkout", "--detach", sha], kopie);

        // --- Plan: welche Teile laufen, welche übernimmt eine Wiederholung --------------------------------------------------------------
        // Die Teilzuordnung kommt aus dem Klon des Kandidaten: Specs und Zuordnung gehören zusammen. Ist sie unbrauchbar, laufen die übrigen Teile
        // trotzdem; die Browserteile entfallen mit dem Grund.
        let teile: readonly TeilZuordnung[];
        let zuordnungsProblem: string | null;
        try {
            if (profil === "tor") {
                teile = [ladeTor(kopie)];
                zuordnungsProblem = null;
            } else if (profil === "B") {
                teile = [ladeKern(kopie)];
                zuordnungsProblem = null;
            } else {
                const zuordnung = ladeZuordnung(kopie);
                teile = zuordnung.teile;
                zuordnungsProblem = zuordnungProblem(zuordnung);
            }
        } catch (e) {
            if (!(e instanceof TeileFehler)) throw e;
            teile =
                profil === "tor"
                    ? [{ id: "kern-echt", name: "kern-echt", bereiche: [], specs: [] }]
                    : profil === "B"
                      ? [{ id: "kern", name: "kern", bereiche: [], specs: [] }]
                      : TEIL_IDS.map((id) => ({ id, name: id, bereiche: [], specs: [] }));
            zuordnungsProblem = e.message;
        }
        let wiederholung: LaufBuchWiederholung | null = null;
        let uebernommen: readonly string[] = [];
        const frueher = optionalesArg("--uebernehmen");
        if (frueher !== "") {
            const altLauf = liesAltLauf(join(repo, ".release-runs", frueher), frueher);
            if (altLauf === undefined)
                wiederholung = {
                    von: frueher,
                    uebernommen: [],
                    neu: [...releaseKlassen(profil)],
                    grund: "Der frühere Lauf ist nicht lesbar: alle Teile laufen neu",
                };
            else {
                const w = planeWiederholung(
                    altLauf,
                    { sha, umgebung: n.umgebung, komponenten: komponentenStart },
                    fingerprint,
                    (startMs) => browserUnveraendertSeit(browser, startMs),
                    releaseKlassen(profil),
                );
                for (const eintrag of uebernimmTeile(altLauf, basis, w.uebernehmen, fingerprint)) n.teile.push(eintrag);
                uebernommen = w.uebernehmen;
                wiederholung = { von: frueher, uebernommen: w.uebernehmen, neu: w.neu, grund: w.grund };
                process.stdout.write(
                    `Wiederholung von ${frueher}: übernommen ${w.uebernehmen.join(", ") || "nichts"}${w.grund === null ? "" : ` (${w.grund})`}\n`,
                );
            }
        }
        // Das Tor (`tor`) fährt `bau`, `daten` und `kern-echt` statt `voll` und den Browserteilen von B oder `voll`.
        const tor = profil === "tor";
        const plan: AblaufPlan = {
            voll: !tor && !uebernommen.includes("voll"),
            bau: tor && !uebernommen.includes("bau"),
            daten: tor && !uebernommen.includes("daten"),
            browser: teile.filter((t) => !uebernommen.includes(t.id)),
            browserProblem: zuordnungsProblem,
        };
        // Das Laufbuch (`teile.json`): Plan, Übernahme, Fingerabdruck und das Ende jedes Schritts, damit die Systemsteuerung den Stand zeigt.
        const schritte: Record<string, { status: SchrittStatus; grund?: string }> = {};
        for (const id of uebernommen) {
            if (id === "voll") for (const s of VOLL_SCHRITTE) schritte[s] = { status: "uebernommen" };
            else if (id === "bau") for (const s of BAU_SCHRITTE) schritte[s] = { status: "uebernommen" };
            else schritte[id] = { status: "uebernommen" };
        }
        const buch: LaufBuch = {
            version: 1,
            teile: teile.map((t) => ({ id: t.id, name: t.name, bereiche: t.bereiche, specs: t.specs.length })),
            problem: zuordnungsProblem,
            komponenten: komponentenStart,
            wiederholung,
            schritte,
        };
        schreibeLaufBuch(basis, buch);
        speichern();

        // --- Umgebung der Schritte -------------------------------------------------------------------------------------------------------
        const env = { ...process.env };
        for (const k of Object.keys(env)) if (/DATABASE|TOKEN|SECRET|PASSWORD|API_KEY/.test(k)) delete env[k];
        env["CI"] = "1";
        const npm = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
        if (!existsSync(npm)) throw new VoraussetzungFehlt("npm-cli neben Node fehlt");
        /**
         * Ein Prozess mit Protokoll `<name>.log` (oder `protokoll`): sein Exitcode, oder `zeit`, wenn er seine Zeitgrenze überschritt. 🪤 Ein `.log` im
         * Ergebnisordner gilt der Oberfläche als Schritt; was kein Schritt ist (die Welt des Tors), bekommt mit `protokoll` einen anderen Namen.
         * Ein Wert `undefined` in `zusatzEnv` nimmt die Variable aus der Umgebung des Prozesses heraus.
         */
        const lauf = async (
            name: string,
            exe: string,
            args: string[],
            cwd: string,
            minuten: number,
            zusatzEnv: NodeJS.ProcessEnv = {},
            protokoll = `${name}.log`,
        ): Promise<number | "zeit"> => {
            const umgebung = { ...env, ...zusatzEnv };
            for (const [k, v] of Object.entries(zusatzEnv)) if (v === undefined) delete umgebung[k];
            try {
                return await releaseProzess(exe, args, {
                    cwd,
                    env: umgebung,
                    log: join(basis, protokoll),
                    timeoutMs: minuten * 60_000,
                });
            } catch (e) {
                if (e instanceof Error && e.message.startsWith("timeout")) return "zeit";
                throw e;
            }
        };
        /** Ein Schritt, ohne den nichts Weiteres sinnvoll ist (Installation, gemeinsamer Bau): rot beendet den Lauf sofort. */
        const hart = async (name: string, args: string[]): Promise<void> => {
            const code = await lauf(name, process.execPath, [npm, ...args], kopie, 30);
            if (code === "zeit") throw new Error(`timeout: ${name}`);
            if (code !== 0) throw new Error(`${name}: Exit ${String(code)}`);
        };
        /** Ein Schritt von `voll`: rot wird gemeldet, der Lauf geht weiter. */
        const weich = async (name: string, exe: string, args: string[]): Promise<Befund | null> => {
            const code = await lauf(name, exe, args, kopie, 30);
            if (code === "zeit") return zeitBefund(name, 30);
            return code === 0 ? null : exitBefund(name, code);
        };
        const npmWeich = (name: string, args: string[]): Promise<Befund | null> =>
            weich(name, process.execPath, [npm, ...args]);

        const nichtsZuTun = !plan.voll && plan.bau !== true && plan.daten !== true && plan.browser.length === 0;
        if (!nichtsZuTun) {
            await hart("installation", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
            await hart("shared", ["run", "build", "--workspace", "@avesmaps3d/shared"]);
        }

        // Der Korpus startet LEER: Der Dump des Testpakets bringt Schema, Journal, Kartendomänen und Daten der Quelle mit; erst danach folgen
        // die Migrationen DES KANDIDATEN vorwärts, wie bei Stage und Production (nie vorab migrieren: doppelte Schlüssel). Getrennte Cluster:
        // zerstörerische Fälle der Unit-Tests berühren den Korpus der Browserteile nie.
        if (!nichtsZuTun) {
            if (plan.voll) {
                unitDb = await starteWegwerfDb({ bin, saat: kopie, temp: basis });
                env["TEST_DATABASE_URL"] = unitDb.url;
            }
            korpus = await starteWegwerfDb({ bin, temp: basis });
            env["DATABASE_URL"] = korpus.url;
            await spieleTestpaketEin({
                bin,
                url: korpus.url,
                port: korpus.port,
                datenbank: WEGWERF_DATENBANK,
                dump: join(daten, "daten.dump"),
                arbeitsordner: basis,
                env,
            });
            spieleSaatEin(kopie, korpus.url);
        }

        // Der Beleg des Teils `bau` (Profil `tor`): Lint, Typen und Bau haben keinen Bericht eines Werkzeugs, der Runner führt darum selbst Buch
        // (`bau.json`: Schritt und Ergebnis). Er schreibt die Datei nach jedem Schritt, und der Beleg des Nachweises ist ihre Prüfsumme.
        const bauBuch: { schritt: string; ergebnis: string }[] = [];
        const bauSchritt = async (name: string, args: string[]): Promise<Befund | null> => {
            const befund = await npmWeich(name, args);
            if (plan.bau === true) {
                bauBuch.push({ schritt: name, ergebnis: befund === null ? "gruen" : befund.kurz });
                writeFileSync(
                    join(basis, "bau.json"),
                    `${JSON.stringify({ version: 1, schritte: bauBuch }, null, 2)}\n`,
                );
            }
            return befund;
        };
        const io: AblaufIo = {
            schritt: (name) => {
                if (name === "lint") return bauSchritt("lint", ["run", "lint"]);
                if (name === "format") return npmWeich("format", ["run", "format:check"]);
                if (name === "typen") return bauSchritt("typen", ["run", "typecheck"]);
                if (name === "bau") return bauSchritt("bau", ["run", "build"]);
                return weich("besucherpaket", process.execPath, [
                    join(kopie, "scripts", "dev", "paket-waechter.ts"),
                    join(kopie, "apps", "web", "dist"),
                ]);
            },
            async daten() {
                // 🔴 Der Teil `daten` (WI-0264): `schreibwege-app-rolle.test.ts` spielt den Dump des Testpakets als `migrate` in einen eigenen
                // Wegwerf-Cluster mit den Rollen des VPS ein, lässt DANN die Migrationen des Kandidaten laufen und ruft jeden Schreibweg als App-Rolle auf.
                // Er fängt Migrationen, die an echten Daten brechen, und fehlende Rechte (42501). Den Cluster legt der Test selbst an; er findet
                // PostgreSQL über PG_BIN_DIR (dasselbe, das der Runner für den Korpus benutzt).
                const bericht = join(basis, "daten.json");
                const code = await lauf(
                    "daten",
                    process.execPath,
                    [
                        join(kopie, "node_modules", "vitest", "vitest.mjs"),
                        "run",
                        DATEN_TEST,
                        "--reporter=json",
                        `--outputFile=${bericht}`,
                        "--testTimeout=30000",
                        "--hookTimeout=120000",
                    ],
                    kopie,
                    30,
                    { SCHREIBWEGE_DUMP: join(daten, "daten.dump"), PG_BIN_DIR: bin },
                );
                if (code === "zeit") return zeitBefund("daten", 30);
                let b: unknown;
                try {
                    b = JSON.parse(readFileSync(bericht, "utf8"));
                } catch {
                    b = undefined;
                }
                return datenBefund(code, b, [`${kopie}/${DATEN_TEST}`.replace(/\\/g, "/")]);
            },
            async vitest() {
                const vitestJson = join(basis, "vitest.json");
                try {
                    // 🔴 Routing-Gate (WI-0248, `release-routing.ts`): Passt die Routing-Revision des Korpus nicht zur Basislinie, rechnet der Code der
                    // Basislinie die Fälle auf diesem Korpus, und das Gate vergleicht den Kandidaten damit. Scheitert das, ist dieser Teil rot mit dem Grund.
                    const routingIo: RoutingIo = {
                        async prozess(exe, args, cwd, umgebung) {
                            try {
                                return await releaseProzess(exe, args, {
                                    cwd,
                                    env: umgebung,
                                    log: join(basis, ROUTING_PROTOKOLL),
                                    timeoutMs: 15 * 60_000,
                                });
                            } catch (e) {
                                if (e instanceof Error && e.message.startsWith("timeout")) return "zeit";
                                throw e;
                            }
                        },
                        git: (args) => git([...args], kopie),
                    };
                    const routing = await bereiteRoutingGateVor({ basis, kopie, sha, env, io: routingIo });
                    const code = await lauf(
                        "tests",
                        process.execPath,
                        [
                            join(kopie, "node_modules", "vitest", "vitest.mjs"),
                            "run",
                            "--reporter=json",
                            `--outputFile=${vitestJson}`,
                            "--testTimeout=30000",
                            "--hookTimeout=120000",
                        ],
                        kopie,
                        120,
                        // Der volle Satz der Routing-Invarianten (sonst überspringen sie, und übersprungene Fälle machen den Lauf rot); bei der Gegenprobe
                        // der Vergleichsstand des Routing-Gates.
                        {
                            AVESMAPS_INVARIANTS: "full",
                            ...(routing.vergleich === null ? {} : { [ROUTING_VERGLEICH_ENV]: routing.vergleich }),
                        },
                    );
                    if (code === "zeit") return vitestMitRouting(routing.befund, zeitBefund("tests", 120));
                    // Die Meldung nennt die Zahlen (rot, übersprungen, todo, fehlende Dateien), nicht nur, DASS etwas fehlt (`release-grund.ts`).
                    let meldung: string | null = null;
                    let lesbar = true;
                    try {
                        const v = JSON.parse(readFileSync(vitestJson, "utf8")) as VitestBericht;
                        const erwartet = leseTestDateien(kopie).map((t) => `${kopie}/${t.pfad}`.replace(/\\/g, "/"));
                        meldung = vitestMeldung(v, erwartet);
                    } catch {
                        lesbar = false;
                    }
                    if (meldung !== null) return vitestMitRouting(routing.befund, { meldung, kurz: meldung });
                    if (!lesbar) {
                        const text =
                            code === 0 ? "Vitest: Bericht fehlt oder ist unlesbar" : `tests: Exit ${String(code)}`;
                        return vitestMitRouting(routing.befund, { meldung: text, kurz: text });
                    }
                    return vitestMitRouting(routing.befund, code === 0 ? null : exitBefund("tests", code));
                } finally {
                    // Der Cluster der Unit-Tests wird nicht mehr gebraucht; die Browserteile sehen nur den Korpus.
                    unitDb?.stoppe();
                    unitDb = undefined;
                    delete env["TEST_DATABASE_URL"];
                }
            },
            async browserBereit() {
                if (korpus === undefined) return "Korpus fehlt";
                env["E2E_SERVER"] = "1";
                env["E2E_WORKERS"] = "2";
                env["TILE_ROOT"] = join(daten, "tiles");
                env["MEDIA_ROOT"] = join(daten, "media");
                // Ein eigener Martin gegen den Korpus auf freiem Port; die Test-Vite proxyt `/tiles/vector` auf MARTIN_PORT (nie der Martin auf 3010).
                try {
                    const martinPort = await port();
                    martin = await starteMartin({
                        bin: martinBin,
                        port: martinPort,
                        url: korpus.url,
                        log: join(basis, "martin.log"),
                        env,
                    });
                    env["MARTIN_PORT"] = String(martinPort);
                    // `place-slice.spec.ts` liest Martin direkt (nicht über die Vite) und nimmt sonst 127.0.0.1:3010.
                    env["VITE_TILE_BASE"] = `http://127.0.0.1:${String(martinPort)}`;
                    return null;
                } catch {
                    return "Martin ließ sich nicht starten (martin.log im Ergebnisordner)";
                }
            },
            async browser(teil) {
                env["E2E_PORT"] = String(await port());
                env["E2E_SERVER_PORT"] = String(await port());
                const bericht = join(basis, BELEG_DATEI[teil.id] ?? `${teil.id}.json`);
                env["PLAYWRIGHT_JSON_OUTPUT_NAME"] = bericht;
                // 🔴 `kern-echt` (WI-0264): Die Specs schreiben in den Korpus und gehen gegen den echten Fastify des Kandidaten. Dafür legt das Werkzeug
                // des Kandidaten (`tor-welt.ts`) vorher eine Person mit der Rolle `editor` und ihre Sitzung an und schreibt das Token in eine Datei
                // (`WELT_TOKEN_DATEI`, wie `welt.ts` sie liest). Der Fastify, den Playwright startet (`E2E_SERVER=1`), schreibt nur, wo `MAP_EDITING=testwelt`
                // gilt (sonst 423 `map_editing_off`; lokal ist das die Vorgabe, hier ausdrücklich gesetzt, damit kein Wert aus `.env` oder der Sitzung
                // alle schreibenden Fälle still abweist), und setzt das Sitzungs-Cookie ohne `Secure` nur mit `AUTH_INSECURE_COOKIE=1` (nur lokal erlaubt).
                // Die Specs schreiben alle in dieselbe Welt: ein Arbeiter (`--workers=1`), damit sie sich nicht in die Quere kommen, und ein Wiederholungsversuch
                // (`--retries=1`), der in derselben Welt läuft (die Specs müssen ihn vertragen); ein wackeliger Fall zählt grün (`WACKELIG_GRUEN`).
                const echt = teil.id === "kern-echt";
                let zusatzEnv: NodeJS.ProcessEnv = {};
                if (echt) {
                    const tokenDatei = join(basis, "welt-token.txt");
                    const welt = await lauf(
                        "tor-welt",
                        process.execPath,
                        [
                            join(kopie, "scripts", "dev", "tor-welt.ts"),
                            "--database-url",
                            korpus?.url ?? "",
                            "--token-datei",
                            tokenDatei,
                        ],
                        kopie,
                        10,
                        // 🪤 `tor-welt.ts` hält `DATABASE_URL` für die Entwicklungsdatenbank und weigert sich, wenn `--database-url` denselben Port
                        // trägt. Im Lauf ist `DATABASE_URL` der Korpus selbst, also bekommt das Werkzeug keine (der Korpus steht in `--database-url`).
                        { DATABASE_URL: undefined },
                        "tor-welt.txt",
                    );
                    if (welt !== 0 || !existsSync(tokenDatei)) {
                        const grund = welt === "zeit" ? "Zeitüberschreitung" : `Exit ${String(welt)}`;
                        const kopf = `Browserteil ${teil.id}`;
                        return {
                            meldung: `${kopf} (${teil.name}): Welt nicht angelegt (${grund}, tor-welt.txt im Ergebnisordner)`,
                            kurz: `${kopf}: Welt nicht angelegt (${grund})`,
                        };
                    }
                    zusatzEnv = { WELT_TOKEN_DATEI: tokenDatei, AUTH_INSECURE_COOKIE: "1", MAP_EDITING: "testwelt" };
                }
                const code = await lauf(
                    teil.id,
                    process.execPath,
                    [
                        join(kopie, "node_modules", "@playwright", "test", "cli.js"),
                        "test",
                        playwrightFilter(teil.specs),
                        `--retries=${echt ? "1" : "0"}`,
                        ...(echt ? ["--workers=1"] : []),
                        "--reporter=json",
                        // Je Teil ein eigener Ordner im Lauf: Playwright leert seinen Ausgabeordner beim Start, sonst löscht jeder Teil
                        // die Fehlerbilder (error-context) des vorigen.
                        `--output=${join(basis, `${teil.id}-ergebnisse`)}`,
                    ],
                    join(kopie, "apps", "web"),
                    echt ? 45 : 120,
                    zusatzEnv,
                );
                if (code === "zeit")
                    return zeitBefund(`Browserteil ${teil.id.replace("browser-", "")} (${teil.name})`, echt ? 45 : 120);
                let b: unknown;
                try {
                    b = JSON.parse(readFileSync(bericht, "utf8"));
                } catch {
                    b = undefined;
                }
                return browserBefund(teil, code, b);
            },
            beleg(klasse) {
                const datei = BELEG_DATEI[klasse];
                return datei !== undefined && existsSync(join(basis, datei))
                    ? fingerprint(join(basis, datei))
                    : undefined;
            },
        };
        if (!nichtsZuTun) {
            const fertig = await fuehreAus(sha, plan, io, {
                teil: (t) => {
                    n.teile.push(t);
                    speichern();
                },
                schritt: (id, schrittStatus, grund) => {
                    schritte[id] = { status: schrittStatus, ...(grund === undefined ? {} : { grund }) };
                    schreibeLaufBuch(basis, buch);
                },
            });
            // Rot ist der Lauf erst jetzt: Alle Teile sind gelaufen oder entfallen, die Liste der Roten ist vollständig.
            if (fertig.rot.length > 0) throw new TeileRot(fertig.rot);
        }
        const komponentenEnde = komponenten();
        if (umgebungVon(komponentenEnde) !== n.umgebung)
            throw new Error(
                `Testumgebung während des Laufs verändert: ${geaenderteKomponenten(komponentenStart, komponentenEnde).join(", ")}`,
            );
        git(["diff", "--exit-code", "HEAD"], kopie);
        if (git(["rev-parse", "HEAD"], kopie) !== sha) throw new Error("Kandidatenstand verändert");
        n.belege = Object.fromEntries(releaseBelege(profil).map((datei) => [datei, fingerprint(join(basis, datei))]));
        n.status = "gruen";
        n.ende = new Date().toISOString();
        if (!releaseGruen(n, sha, n.umgebung)) throw new Error("Nachweis unvollständig");
        writeFileSync(ergebnis, JSON.stringify(n, null, 2));
        speichern();
    }
    // Existing notes transport. No Production action; E must harden every reader before activation.
    publiziere(releaseNotiz(n));
} catch (e) {
    n.status = e instanceof Error && e.message.startsWith("timeout") ? "timeout" : "rot";
    n.ende = new Date().toISOString();
    speichern();
    writeFileSync(join(basis, "fehler.txt"), e instanceof Error ? e.message : "Runner fehlgeschlagen");
    if (angekuendigt) {
        try {
            publiziere(
                rotNotiz(
                    sha,
                    n.ende,
                    e instanceof TeileRot ? notizGrundTeile(e.eintraege.map((r) => r.kurz)) : notizGrund(e),
                ),
            );
        } catch {
            /* The already-published pending note keeps the gate closed. */
        }
    }
    process.exitCode = 1;
} finally {
    clearTimeout(deadline);
    clearInterval(abbrechen);
    // Jeder Dienst für sich: Scheitert einer, enden die übrigen und die Sperre trotzdem.
    for (const raeume of aufraeumer) {
        try {
            raeume();
        } catch {
            /* best effort: der Lauf ist zu Ende */
        }
    }
    // Der eine Bericht (WI-0248) steht, bevor die Sperre fällt: Wer danach startet oder liest, findet ihn.
    schreibeBericht();
    // Remove only our empty lock directory. Checkouts/evidence remain for diagnosis, no recursive cleanup.
    gibSperreFrei(lock);
}
