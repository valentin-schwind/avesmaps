// `npm run vor-dem-push [-- <commit>] [-- --tests] [-- --voll]` (WI-0189, Review L6-01): prüft den Commit, der gepusht werden soll, in einem
// sauberen Baum statt im Arbeitsbaum. Bei mindestens vier von rund sieben Baubrüchen auf master vom 10. bis 15.10. war der
// Arbeitsbaum grün und erst der Commit rot: eine ungetrackte Datei, ein ungespeicherter Wert, Exporte aus ungepushten Commits.
// Genau das sieht ein Lauf im geteilten Checkout nicht.
//
// 🔴 Die Prüfbank (`scripts/dev/pruefbank.ts`, Betreiber 2026-10-17 „die sitzungen können ruhig aufeinander warten“): Der Testteil wartet,
// bis kein anderer Prüflauf auf diesem Rechner mehr läuft. `AVESMAPS_PRUEFBANK=aus` stellt sich nicht an.
// 🔴 Vorlauf und „überholt“ (Hauptorchestrierung 2026-10-18 nach der Messung der Arbeitshygiene): Lint, `shared`-Bau und Typcheck warten an
// einer kleinen eigenen Bank mit `VORLAUF_PLAETZE` Plätzen (davor liefen sie ungebremst, bis zu 88 Node-Prozesse mit 12,2 GB, der freie
// Arbeitsspeicher fiel auf 0,43 GB); nur Warten, nie Abbruch. Und wer an der Prüfbank drankommt, fragt nach, ob sein Commit noch der HEAD
// der Arbeitskopie ist: Wenn nicht (und der Commit nicht ausdrücklich genannt wurde), endet der Lauf mit „überholt“, Exit-Code
// `EXIT_UEBERHOLT`, kein Rot (`scripts/dev/ueberholt.ts`).
//
// 🔴 Die Pfadregel (`scripts/dev/pruef-auswahl.ts`, Hauptorchestrierung 2026-10-17): `--tests` prüft nur, was die Änderung berühren kann.
// Nur Doku, Handover und Zustand: die Regelwerk-Wächter und die Tests, die Doku lesen. Nur Weboberfläche (und Doku): Web-, shared- und
// Doku-Tests. Alles andere: die Tests des eigenen Bereichs (Stufe „bereich“, `bereich-auswahl.ts`). Die Zeile „Pfadregel: Stufe …“ im Lauf
// nennt Stufe und Grund.
// 🔴 Leicht vor dem Push, voll danach (WI-0228, Betreiber 2026-10-18 „A, ab jetzt immer“): `--tests` ist die leichte Stufe, ohne Prüfbank
// (Lint, Format und Typcheck am Vorlauf, danach die Tests des Bereichs und dessen Datenbankdateien; ein reiner Markdown-Push ohne Vorlauf; eine Migration nur mit den Dateien, die ihre Objekte
// nennen). Den vollen Lauf über alles (Server, Web, shared, alle Datenbankdateien, Browserfälle) fährt der Sammellauf nach dem Push
// (`scripts/dev/sammellauf.ts`) über `origin/master`; vor dem Push nur noch mit `--voll`, und nur der steht an der Prüfbank an.
//
// 🔴 Der volle Lauf teilt den Prozess zwischen den Testdateien (`--no-isolate`, rund die Hälfte der Zeit), in drei Durchgängen: Server,
// Web und shared, und die Dateien mit `vi.mock` isoliert (`planeDurchgaenge` in `pruef-auswahl.ts`; die Zeile im Lauf nennt, welche
// Dateien isoliert liefen). `--isoliert` erzwingt den alten, voll isolierten Lauf als Gegenprobe.
//
// 🔴 Die Handover-Köpfe prüft jeder Lauf, dessen Push `project-control/handovers/` (oder den Parser der Köpfe) berührt, in jeder Stufe, auch
// ohne `--tests` (Hauptorchestrierung 2026-10-18: ein Handover mit `status | OPEN` kam auf origin und machte den Wächter erst nach dem
// Push rot). Das ist nur `regelwerk-handover-koepfe.test.ts`, ein paar Sekunden, und sie läuft zuerst, vor dem Bau; mit `--tests` läuft
// der Wächter ohnehin in jeder Stufe mit.
//
// 🔴 Lint und Format prüft jeder Lauf (`scripts/dev/lint-auswahl.ts`, Hauptorchestrierung 2026-10-18: Claudios Prüfung nach dem Push war seit
// 05:40 am Lint rot, ihre Tests liefen drei Stunden nicht): ESLint und Prettier über die Dateien, die der Push gegenüber `origin/master` ändert;
// `--voll` und eine unbestimmbare Änderung prüfen alles (`npm run lint`, `npm run format:check`). Vor Bau und Typcheck, weil ESLint hier nicht
// typbewusst ist und keinen Bau braucht.
//
// 🔴 Datenbanktests (WI-0224, Hauptorchestrierung 2026-10-18: ein seit D2 roter Test fiel nicht auf, weil die Vorprüfung ihn ohne Datenbank
// übersprang): Die Stufe „voll“ startet einen Wegwerf-Postgres (`scripts/dev/wegwerf-db.ts`: leerer Cluster, Rolle ohne Sonderrechte, PostGIS,
// vorab Migrationen und Kartendomänen; nie die geteilte Entwicklungs- oder Testdatenbank), setzt `TEST_DATABASE_URL` darauf und fährt die nach
// der Pfadregel gewählten Dateien mit Datenbank in einem eigenen Durchgang mit (`scripts/dev/db-auswahl.ts`: Fach-Ordner → die Dateien des
// Bereichs, rund 10 bis 20 von 188; Migration, shared und Wurzel → alle; `--voll` → alle; Web, Skripte, Doku → keine und dann auch kein
// PostgreSQL nötig; der Betreiber: „diese prüfungen dauern ewig“). Der Durchgang läuft neben den anderen, wenn die Lagezeile der Prüfbank
// genug Arbeitsspeicher zeigt, sonst danach. Fehlt PostgreSQL und die Auswahl enthält Dateien, ist der Lauf rot mit Hinweis; `--ohne-datenbank`
// quittiert das bewusst. Die ⚠-Zeile trennt „fehlende Datenbank“ von „ausgelassen nach Pfadregel“. Die kleinen Stufen (doku, web) überspringen
// ihre Datenbankdateien weiter. Die fünf Dateien mit `DATABASE_URL` (Routing-Korpus, Dateninvarianten) brauchen die echten Kartendaten der
// Entwicklungsdatenbank und werden nur gemeldet. Das zweite Netz ist ein voller Datenbanklauf bei Claudio nachts auf dem VPS.
//
// 🪤 Zu Beginn beendet der Lauf Wegwerf-Postgres abgebrochener Läufe (`scripts/dev/wegwerf-cluster.ts`), deren Besitzerprozess tot ist.
//
// Ablauf: `git archive` des Commits nach `<Hauptcheckout>/.claude/worktrees/vor-dem-push-…` (lokal ausgeschlossen),
// `node_modules` des Hauptcheckouts per Junction, die eigenen Pakete (`@avesmaps3d/*`) auf die Kopie; dann `shared` bauen und
// `npm run typecheck` aus der Wurzel. `--tests` fährt zusätzlich `npm test` ohne Datenbank (die Wächter des Regelwerks, alle
// Fälle ohne Testdatenbank; die übrigen überspringen sichtbar), `--voll` dazu noch `npm run build` wie der Release-Bau und
// danach den Wächter des Besucherpakets über dessen `apps/web/dist` (`scripts/dev/paket-waechter.ts`, WI-0235).
//
// Berührt der Push Produktcode, zeigt jeder Lauf zuerst den Hinweis „Verflechtung“ (WI-0289, `scripts/dev/verflechtung.ts`): neu gegenseitige
// Bereiche, neue Dateikreise und Grenzübertritte gegenüber `origin/master`, mit den Importen, die sie schaffen. Hält nichts an.
//
// 🔴 Freiwillig und nur meldend: kein Hook ruft ihn, nichts wird angehalten. Der Exit-Code sagt dem Aufrufer, ob es grün war.
// 💣 Die Kopie enthält Junctions in den Hauptcheckout. Aufgeräumt wird deshalb erst jede Junction einzeln, dann die Kopie;
// bleibt eine Junction übrig, bleibt die Kopie liegen statt ihr zu folgen (AGENTS.md, Arbeitskopien). Ein harter Abbruch
// (TaskStop, Stop-Process) lässt kein Aufräumen mehr zu: Darum räumt jeder Lauf beim Start die Kopien toter Läufe genauso
// auf (Befund der Landschaft-Sitzung 2026-10-16: rund 200 Junctions blieben liegen, ein `rm -rf` hätte `node_modules` geleert).
import { auswahlKosten } from "./abhaengige-tests.ts";
import { leseQuellen } from "./lese-quellen.ts";
import { spawnSync } from "node:child_process";
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmdirSync,
    rmSync,
    statSync,
    symlinkSync,
    unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { waehleDbDateien, waehleDbDateienKleineStufe, type DbAuswahl } from "./db-auswahl.ts";
import { dbTestDateien, leseTestDateien } from "./db-tests.ts";
import { ROT_LINT, inStuecken, planeLintUndFormat } from "./lint-auswahl.ts";
import { starteNebenher } from "./nebenher.ts";
import { bankOrdner, liesLage, nimmBank, type Bank } from "./pruefbank.ts";
import {
    GELAENDE_SICHT_TEST,
    HANDOVER_KOPF_TEST,
    RELEASE_TEILE_TEST,
    beruehrtGelaendeLeser,
    beruehrtHandover,
    beruehrtReleaseTeile,
    datenbankParallel,
    datenbankRot,
    datenbankSatz,
    liesUebersprungene,
    mitFrist,
    nurMarkdownDoku,
    planeDurchgaenge,
    waehleTests,
    type Auswahl,
    type Durchgang,
    type Stufe,
    type TestDatei,
    type Uebersprungen,
} from "./pruef-auswahl.ts";
import { EXIT_UEBERHOLT, ueberholtZeile } from "./ueberholt.ts";
import { anzahlNeu, hinweisZeilen, istQuelle, leseGraph, vergleiche } from "./verflechtung.ts";
import { raeumeWegwerfClusterAuf } from "./wegwerf-cluster.ts";
import { findePostgres, starteWegwerfDb, umgebungMitTestdatenbank, type WegwerfDb } from "./wegwerf-db.ts";

const sag = (zeile: string): void => {
    process.stdout.write(`${zeile}\n`);
};
const argumente = process.argv.slice(2);
const voll = argumente.includes("--voll");
/** `--ohne-datenbank`: lässt den Datenbank-Durchgang der Stufe „voll“ aus und quittiert das bewusst (sonst: rot, wenn PostgreSQL fehlt). */
const ohneDatenbankQuittiert = argumente.includes("--ohne-datenbank");
/** `--isoliert`: der alte Lauf, jede Testdatei in einem frischen Prozess (Gegenprobe zum geteilten Prozess des vollen Laufs). */
const isoliert = argumente.includes("--isoliert");
/**
 * `--nur-datenbank`: nur der Datenbank-Durchgang nach der Pfadregel (WI-0224): Kopie, Lint und Format, `shared`-Bau, Wegwerf-Postgres und die Dateien,
 * die zu den geänderten gehören; ohne Typcheck und ohne die Durchgänge ohne Datenbank, ohne Prüfbank (ein bis drei Minuten). Für eine Änderung an Datenbankcode,
 * die schnell gegen eine saubere Datenbank soll; der volle Lauf (`--tests`) bleibt, was vor dem Push gilt.
 */
const nurDatenbank = argumente.includes("--nur-datenbank");
const tests = voll || nurDatenbank || argumente.includes("--tests") || argumente.includes("--auswahl");
const ref = argumente.find((a) => !a.startsWith("--")) ?? "HEAD";

function git(...args: string[]): string {
    const r = spawnSync("git", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr ?? "").trim()}`);
    return r.stdout.trim();
}

const wurzel = git("rev-parse", "--show-toplevel");
/** Plätze des Vorlaufs (Lint, `shared`-Bau, Typcheck; vue-tsc allein braucht 1,2 bis 1,6 GB): zwei gleichzeitig, die übrigen warten. */
const VORLAUF_PLAETZE = 2;
/** Ein Vorlauf dauert Minuten, mit den Tests des Bereichs selten mehr als zehn; wer den Platz eine Stunde hält, hängt. */
const VORLAUF_VERWAIST_MS = 60 * 60 * 1000;
const haupt = dirname(resolve(wurzel, git("rev-parse", "--git-common-dir")));
const sha = git("rev-parse", "--verify", `${ref}^{commit}`);
const betreff = git("log", "-1", "--format=%s", sha);
const arbeitskopien = join(haupt, ".claude", "worktrees");
const kopie = join(arbeitskopien, `vor-dem-push-${sha.slice(0, 8)}-${process.pid}`);

function verknuepfe(ziel: string, pfad: string): void {
    symlinkSync(ziel, pfad, "junction");
}

function existiert(pfad: string): boolean {
    try {
        lstatSync(pfad);
        return true;
    } catch {
        return false;
    }
}

/** Alle Junctions und Links unter `ordner`, ohne einem zu folgen (`lstat` statt `stat`). */
function verweiseUnter(ordner: string): string[] {
    const gefunden: string[] = [];
    const offen = [ordner];
    for (let aktuell = offen.pop(); aktuell !== undefined; aktuell = offen.pop()) {
        let eintraege: string[];
        try {
            eintraege = readdirSync(aktuell);
        } catch {
            continue;
        }
        for (const name of eintraege) {
            const pfad = join(aktuell, name);
            let info;
            try {
                info = lstatSync(pfad);
            } catch {
                continue;
            }
            if (info.isSymbolicLink()) gefunden.push(pfad);
            else if (info.isDirectory()) offen.push(pfad);
        }
    }
    return gefunden;
}

/**
 * Löst jede Junction unter `ordner` und löscht ihn erst danach. Bleibt auch nur eine stehen, bleibt der Ordner liegen: `rmSync`
 * folgte ihr in den Hauptcheckout. Gibt zurück, ob der Ordner weg ist.
 */
function entferneKopie(ordner: string): boolean {
    if (!existiert(ordner)) return true;
    for (const pfad of verweiseUnter(ordner)) {
        try {
            rmdirSync(pfad);
        } catch {
            try {
                unlinkSync(pfad);
            } catch {
                /* bleibt stehen, siehe unten */
            }
        }
    }
    const uebrig = verweiseUnter(ordner);
    if (uebrig.length > 0) {
        console.error(
            `vor-dem-push: ${String(uebrig.length)} Junction(s) nicht gelöst, die Kopie bleibt liegen: ${uebrig[0] ?? ""} (mit cmd /c rmdir lösen)`,
        );
        return false;
    }
    rmSync(ordner, { recursive: true, force: true });
    return true;
}

function raeumeAuf(): void {
    entferneKopie(kopie);
}

/** Läuft der Prozess noch? Ein Fehler außer „gibt es nicht“ (etwa EPERM) heißt: Er läuft, nur unter einem anderen Konto. */
function lebt(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (fehler) {
        return (fehler as NodeJS.ErrnoException).code !== "ESRCH";
    }
}

/**
 * Die Kopien abgebrochener Läufe, ohne Folgen in ihre Junctions. Die eines noch laufenden Prozesses bleiben: Andere Sitzungen
 * teilen den Hauptcheckout und prüfen vielleicht gerade selbst.
 */
function raeumeAlteKopienAuf(): void {
    let eintraege: string[];
    try {
        eintraege = readdirSync(arbeitskopien);
    } catch {
        return;
    }
    for (const name of eintraege) {
        const treffer = /^vor-dem-push-[0-9a-f]{8}-(\d+)$/.exec(name);
        if (!treffer || Number(treffer[1]) === process.pid || lebt(Number(treffer[1]))) continue;
        // 🪤 Eine fremde Kopie, die sich nicht löschen lässt (EPERM: ein anderer Prozess hält noch einen Griff darauf), hält DIESEN Lauf
        // nicht an: Sie bleibt liegen, der nächste Lauf versucht es wieder (2026-10-17, WI-0205: ein leerer Ordner eines toten Laufs).
        try {
            if (entferneKopie(join(arbeitskopien, name))) sag(`  Kopie eines abgebrochenen Laufs aufgeräumt: ${name}`);
        } catch (fehler) {
            sag(
                `  Kopie eines abgebrochenen Laufs bleibt liegen (${(fehler as NodeJS.ErrnoException).code ?? "Fehler"}): ${name}`,
            );
        }
    }
}

/** Die Workspaces der Kopie mit ihrem Paketnamen, aus der `package.json` der Wurzel (nur `ordner/*`-Muster). */
function workspaces(): { pfad: string; name: string }[] {
    const muster =
        (JSON.parse(readFileSync(join(kopie, "package.json"), "utf8")) as { workspaces?: string[] }).workspaces ?? [];
    const liste: { pfad: string; name: string }[] = [];
    for (const m of muster) {
        const ordner = m.replace(/\/\*$/, "");
        if (!existsSync(join(kopie, ordner))) continue;
        for (const eintrag of readdirSync(join(kopie, ordner))) {
            const paket = join(kopie, ordner, eintrag, "package.json");
            if (!existsSync(paket)) continue;
            const name = (JSON.parse(readFileSync(paket, "utf8")) as { name?: string }).name;
            if (name) liste.push({ pfad: `${ordner}/${eintrag}`, name });
        }
    }
    return liste;
}

function bereiteKopieVor(): void {
    mkdirSync(kopie, { recursive: true });
    // Symbolische Links (etwa die Attrappen unter ops/**/test/stubs) lassen sich unter Windows ohne Sonderrecht nicht anlegen,
    // und der Typcheck braucht sie nicht: Sie bleiben draußen.
    const links = git("ls-tree", "-r", sha)
        .split(/\r?\n/)
        .filter((z) => z.startsWith("120000 "))
        .map((z) => `:(exclude)${z.slice(z.indexOf("\t") + 1)}`);
    const archiv = spawnSync("git", ["archive", "--format=tar", sha, "--", ".", ...links], {
        cwd: wurzel,
        maxBuffer: 2 ** 30,
    });
    if (archiv.status !== 0) throw new Error(`git archive: ${archiv.stderr.toString().trim()}`);
    const entpackt = spawnSync("tar", ["-xf", "-"], { cwd: kopie, input: archiv.stdout, maxBuffer: 2 ** 26 });
    if (entpackt.status !== 0) throw new Error(`tar: ${entpackt.stderr.toString().trim()}`);

    const eigene = workspaces();
    const scopes = new Set(eigene.map((w) => w.name.split("/")[0] ?? ""));
    mkdirSync(join(kopie, "node_modules"));
    for (const eintrag of readdirSync(join(haupt, "node_modules"))) {
        if (scopes.has(eintrag) || !statSync(join(haupt, "node_modules", eintrag)).isDirectory()) continue;
        verknuepfe(join(haupt, "node_modules", eintrag), join(kopie, "node_modules", eintrag));
    }
    for (const w of eigene) {
        const [scope, name] = w.name.split("/");
        const ziel = scope && name ? join(kopie, "node_modules", scope, name) : join(kopie, "node_modules", w.name);
        mkdirSync(dirname(ziel), { recursive: true });
        verknuepfe(join(kopie, w.pfad), ziel);
        const eigeneModule = join(haupt, w.pfad, "node_modules");
        if (existsSync(eigeneModule)) verknuepfe(eigeneModule, join(kopie, w.pfad, "node_modules"));
    }
}

/** Welche Zeilen ein roter Schritt zeigt: beim Typcheck die Fehler, bei den Tests die roten Dateien und Fälle, nie Protokollzeilen. */
const ROT_TYPCHECK = /error TS|error:/;
const ROT_TESTS = /^\s*(FAIL|×)|Test Files|Tests\s|timed out|^\w*Error:/;
/** Die Kopfprüfung zeigt dazu die Handovers, die der Wächter beanstandet (`<datei>.md: <Befund>`). */
const ROT_KOEPFE = /^\s*(FAIL|×)|Test Files|Tests\s|\.md: /;

/** Wertet einen Schritt aus: eine Zeile, bei Rot die roten Zeilen; zählt die übersprungenen Datenbankdateien aus den Schlusszeilen von Vitest. */
function bewerte(name: string, status: number | null, text: string, dauer: number, rot: RegExp): boolean {
    merkeUebersprungene(liesUebersprungene(text));
    if (status === 0) {
        sag(`  ok   ${name} (${dauer} s)`);
        return true;
    }
    sag(`  ROT  ${name} (${dauer} s)`);
    const zeilen = text.split(/\r?\n/).filter((z) => z.trim() !== "");
    for (const z of zeilen.filter((z) => !z.trimStart().startsWith("{") && rot.test(z)).slice(0, 40))
        sag(`       ${z}`);
    return false;
}

function schritt(
    name: string,
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
    rot: RegExp = ROT_TYPCHECK,
    /** `true`: `args` gehen an `node` statt an `npm` (der Datenbank-Durchgang: die Dateiliste ist für eine Befehlszeile über `npm` zu lang). */
    direkt = false,
): boolean {
    const start = Date.now();
    const r = spawnSync(direkt ? process.execPath : "npm", args, {
        cwd: kopie,
        env,
        encoding: "utf8",
        shell: !direkt && process.platform === "win32",
        maxBuffer: 2 ** 28,
    });
    const dauer = Math.round((Date.now() - start) / 1000);
    return bewerte(name, r.status, `${r.stdout ?? ""}\n${r.stderr ?? ""}`, dauer, rot);
}

/** Was die Testläufe dieses Laufs mangels Datenbank übersprungen haben (die Schlusszeilen von `vitest.global-setup.ts`, je Durchgang). */
let uebersprungen: Uebersprungen = { testdatenbank: 0, entwicklungsdatenbank: 0 };

function merkeUebersprungene(neu: Uebersprungen): void {
    uebersprungen = {
        testdatenbank: uebersprungen.testdatenbank + neu.testdatenbank,
        entwicklungsdatenbank: uebersprungen.entwicklungsdatenbank + neu.entwicklungsdatenbank,
    };
}

/**
 * Die Umgebung der Testläufe ohne Datenbank: In der Kopie läuft nichts gegen die Test- oder Entwicklungsdatenbank, die andere Sitzungen
 * teilen. Die Datenbanktests der Stufe „voll“ bekommen ihre eigene (`umgebungMitTestdatenbank`, der Wegwerf-Postgres).
 */
function pruefUmgebung(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const name of ["DATABASE_URL", "TEST_DATABASE_URL", "JOBS_DATABASE_URL", "KANAL_DATABASE_URL"])
        delete env[name];
    return env;
}

/** Der Wegwerf-Postgres, solange der Datenbank-Durchgang läuft: Die Signale und das `finally` unten beenden ihn. */
let datenbank: WegwerfDb | undefined;
/** Der Datenbank-Durchgang ist gelaufen: Dann zählen die Überspringer der anderen Durchgänge (dieselben Dateien ohne Datenbank) nicht. */
let datenbankGelaufen = false;
/** Warum der Lauf rot ist, wenn es an der Datenbank liegt (für die Schlusszeile). */
let grundDatenbankRot: string | undefined;

/** Die Auswahl der Datenbankdateien (`db-auswahl.ts`): in der Stufe voll nach der Pfadregel, in den kleinen Stufen die, die geänderte Dateien nennen; `undefined` ohne Tests. */
let dbAuswahl: DbAuswahl | undefined;

/** Läuft ein Datenbank-Durchgang: Die Auswahl enthält Dateien, und `--ohne-datenbank` quittiert es nicht? Dann braucht der Lauf PostgreSQL und den Bau von `shared`. */
function datenbankNoetig(): boolean {
    return dbAuswahl !== undefined && dbAuswahl.dateien.length > 0 && !ohneDatenbankQuittiert;
}

/**
 * Was an Datenbanktests nicht lief, nach Grund getrennt: die fehlende Datenbank (kleine Stufen, `--ohne-datenbank`), die nach Pfadregel
 * ausgelassenen und die mit der Entwicklungsdatenbank. In der Stufe voll sind die Überspringer der Durchgänge ohne Datenbank erklärt: Die
 * gewählten Dateien liefen im Datenbank-Durchgang (oder fehlen mit `--ohne-datenbank`), die übrigen wurden ausgelassen.
 */
function nichtGelaufen(): { readonly fehlt: Uebersprungen; readonly ausgelassen: number } {
    if (dbAuswahl === undefined) return { fehlt: uebersprungen, ausgelassen: 0 };
    const fehlt = datenbankGelaufen ? 0 : dbAuswahl.dateien.length;
    return {
        fehlt: { testdatenbank: fehlt, entwicklungsdatenbank: uebersprungen.entwicklungsdatenbank },
        ausgelassen: dbAuswahl.ausgelassen,
    };
}

/** Die Zeile im Lauf, wenn Datenbankdateien nicht liefen, und ob der volle Lauf deshalb rot wird. */
function pruefeDatenbank(auswahl: Auswahl): boolean {
    const { fehlt, ausgelassen } = nichtGelaufen();
    const satz = datenbankSatz(fehlt, ausgelassen);
    if (satz === undefined) return true;
    sag(`  ⚠ ${satz}.`);
    const hinweise = [
        dbAuswahl === undefined
            ? "Sie laufen im vollen Lauf (Stufe voll) im Wegwerf-Postgres; sonst nur im Hauptcheckout mit .env (`npm test`)."
            : ausgelassen > 0
              ? "Die ausgelassenen laufen nicht vor dem Push; vollständig geprüft wird nur ein freigegebener Production-Kandidat (Release-Test auf dem Entwicklungsrechner, WI-0248)."
              : "",
        fehlt.entwicklungsdatenbank > 0
            ? "Die Dateien mit DATABASE_URL (Routing-Korpus, Dateninvarianten) brauchen die echten Kartendaten der Entwicklungsdatenbank und laufen nur im Hauptcheckout mit .env."
            : "",
    ].filter((h) => h !== "");
    for (const h of hinweise) sag(`    ${h}`);
    if (!datenbankRot({ voll: auswahl.stufe === "voll", quittiert: ohneDatenbankQuittiert, uebersprungen: fehlt })) {
        if (auswahl.stufe === "voll" && ohneDatenbankQuittiert && fehlt.testdatenbank > 0)
            sag("    --ohne-datenbank: bewusst ohne Datenbank quittiert.");
        return true;
    }
    sag(
        "  ROT  Datenbanktests der Stufe voll liefen nicht: mit Wegwerf-Postgres neu starten oder mit --ohne-datenbank bewusst quittieren.",
    );
    grundDatenbankRot = "Die Datenbanktests der Stufe voll liefen nicht (siehe oben).";
    return false;
}

const offen = git("status", "--porcelain")
    .split(/\r?\n/)
    .filter((z) => z !== "");
const ungetrackt = offen.filter((z) => z.startsWith("??")).length;
sag(`vor-dem-push: prüft den Commit ${sha.slice(0, 8)} („${betreff}“) in einem sauberen Baum, nicht den Arbeitsbaum.`);
if (offen.length > 0) {
    sag(
        `  Nicht im Commit: ${offen.length - ungetrackt} geänderte und ${ungetrackt} ungetrackte Datei(en) im Arbeitsbaum.`,
    );
}

/** Die Bank, solange dieser Lauf an der Reihe ist: Die Signale und das `finally` unten geben sie frei. */
let bank: Bank | undefined;
/** Die Stufe der Pfadregel, die lief (für die Schlusszeile). */
let stufe: Stufe | undefined;
/** Der Platz am Vorlauf, solange Lint, `shared`-Bau und Typcheck laufen (in den leichten Stufen auch die Tests). */
let vorlauf: Bank | undefined;
/** Die Zeile, wenn der Lauf beim Drankommen überholt war (`ueberholt.ts`). */
let ueberholt: string | undefined;

/** Die Pfade, die der zu pushende Stand gegenüber `origin/master` ändert; `undefined`, wenn das nicht zu bestimmen ist. */
function geaenderteDateien(): string[] | undefined {
    try {
        const basis = git("merge-base", "origin/master", sha);
        return git("diff", "--name-only", basis, sha)
            .split(/\r?\n/)
            .filter((z) => z !== "");
    } catch {
        return undefined;
    }
}

/** Die Argumente von `node` für den Datenbank-Durchgang: Vitest direkt mit den Dateien (zu lang für eine Befehlszeile über `npm`). */
function datenbankArgs(durchgang: Durchgang): string[] {
    return [
        join(kopie, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--testTimeout=30000",
        "--hookTimeout=120000",
        ...durchgang.args,
    ];
}

/** Startet den Wegwerf-Postgres des Datenbank-Durchgangs samt Migrationen und Kartendomänen; `undefined`, wenn er nicht hochkam (die Zeile steht dann im Lauf). */
async function starteDatenbank(bin: string): Promise<WegwerfDb | undefined> {
    try {
        const db = await starteWegwerfDb({ bin, saat: kopie });
        datenbank = db;
        sag(`  Wegwerf-Postgres läuft (Port ${String(db.port)}), Migrationen und Kartendomänen eingespielt.`);
        return db;
    } catch (fehler) {
        sag(`  ROT  Wegwerf-Postgres nicht gestartet: ${(fehler as Error).message}`);
        grundDatenbankRot = "Der Wegwerf-Postgres für die Datenbanktests kam nicht hoch (siehe oben).";
        return undefined;
    }
}

function beendeDatenbank(): void {
    nebenherAktiv?.abbrechen();
    datenbank?.stoppe();
    datenbank = undefined;
}

/** Der laufende Datenbank-Durchgang neben den anderen: Die Signale und das `finally` unten beenden ihn. */
let nebenherAktiv: { readonly fertig: Promise<boolean>; abbrechen(): void } | undefined;

/** Der Datenbank-Durchgang neben den anderen (`nebenher.ts`): ein eigener Prozess, dessen Ausgabe erst nach dem Ende bewertet wird. */
function datenbankNebenher(
    durchgang: Durchgang,
    db: WegwerfDb,
): { readonly fertig: Promise<boolean>; abbrechen(): void } {
    const lauf = starteNebenher({
        programm: process.execPath,
        args: datenbankArgs(durchgang),
        cwd: kopie,
        env: umgebungMitTestdatenbank(process.env, db.url),
    });
    return {
        fertig: lauf.fertig.then((e) =>
            bewerte(`${durchgang.name}, nebenher`, e.status, e.text, e.dauerSekunden, ROT_TESTS),
        ),
        abbrechen: lauf.abbrechen,
    };
}

/**
 * Der Testteil nach der Pfadregel; nur der volle Lauf steht an der Prüfbank an (wartet er, sagt eine Zeile, auf wen) und fährt die
 * Datenbanktests im Wegwerf-Postgres mit: neben den anderen Durchgängen, wenn die Lage der Prüfbank genug Arbeitsspeicher zeigt
 * (`datenbankParallel`), sonst danach. Fehlt PostgreSQL, ist er rot, ohne die Prüfbank zu belegen (`--ohne-datenbank` quittiert).
 */
/** Der HEAD der Arbeitskopie jetzt, mit Titel; `undefined`, wenn Git ihn nicht hergibt. */
function liesHead(): { sha: string; betreff: string } | undefined {
    try {
        const jetzt = git("-C", wurzel, "rev-parse", "HEAD");
        return { sha: jetzt, betreff: git("-C", wurzel, "log", "-1", "--format=%s", jetzt) };
    } catch {
        return undefined;
    }
}

async function testsNachPfadregel(auswahl: Auswahl): Promise<boolean> {
    const testDateien = leseTestDateien(kopie);
    // PostgreSQL braucht nur, wer Datenbankdateien wählt: Ein Push ohne Treffer (Skripte, Doku, Web) läuft auch ohne.
    const mitDatenbank = datenbankNoetig();
    const postgres = mitDatenbank ? findePostgres() : undefined;
    if (mitDatenbank && postgres === undefined) {
        sag(
            "  ROT  PostgreSQL fehlt auf diesem Rechner (initdb, postgres, pg_ctl, psql, pg_isready): Die gewählten Datenbanktests können nicht laufen. PG_BIN_DIR setzen, PostgreSQL installieren (scripts/dev/install-toolchain.ps1) oder mit --ohne-datenbank bewusst quittieren.",
        );
        grundDatenbankRot = "PostgreSQL fehlt, die gewählten Datenbanktests konnten nicht laufen (siehe oben).";
        return false;
    }
    if (auswahl.stufe === "voll" && !nurDatenbank) {
        bank = await nimmBank({ sitzung: basename(wurzel), art: "vor-dem-push --tests", commit: sha.slice(0, 8), sag });
        ueberholt = ueberholtZeile({ sha, genannt: ref !== "HEAD", headJetzt: liesHead });
        if (ueberholt !== undefined) {
            sag(ueberholt);
            return false;
        }
    }
    const plan = planeDurchgaenge({
        auswahl,
        testDateien,
        isoliert,
        datenbankDateien: postgres !== undefined ? (dbAuswahl?.dateien ?? []) : [],
    });
    sag(plan.zeile);
    const datenbankDurchgang = plan.durchgaenge.find((d) => d.datenbank === true);
    // `--nur-datenbank`: keine anderen Durchgänge, also auch nichts, neben dem der Datenbank-Durchgang laufen könnte.
    const uebrige = nurDatenbank ? [] : plan.durchgaenge.filter((d) => d.datenbank !== true);
    let db: WegwerfDb | undefined;
    if (datenbankDurchgang !== undefined && postgres !== undefined) {
        db = await starteDatenbank(postgres);
        if (db === undefined) return false;
        const lage = nurDatenbank ? { parallel: false, grund: "" } : datenbankParallel(liesLage()?.ramFrei);
        if (!nurDatenbank) {
            sag(
                `  Datenbank-Durchgang ${lage.parallel ? "neben den anderen Durchgängen" : "nach den anderen Durchgängen"} (${lage.grund}).`,
            );
        }
        if (lage.parallel) nebenherAktiv = datenbankNebenher(datenbankDurchgang, db);
    }
    try {
        for (const durchgang of uebrige) {
            const ok =
                durchgang.direkt === true
                    ? schritt(durchgang.name, datenbankArgs(durchgang), pruefUmgebung(), ROT_TESTS, true)
                    : schritt(durchgang.name, ["test", ...mitFrist(durchgang.args)], pruefUmgebung(), ROT_TESTS);
            if (!ok) return false;
        }
        if (datenbankDurchgang === undefined || db === undefined) return true;
        const ok =
            nebenherAktiv !== undefined
                ? await nebenherAktiv.fertig
                : schritt(
                      datenbankDurchgang.name,
                      datenbankArgs(datenbankDurchgang),
                      umgebungMitTestdatenbank(process.env, db.url),
                      ROT_TESTS,
                      true,
                  );
        datenbankGelaufen = true;
        return ok;
    } finally {
        beendeDatenbank();
    }
}

// Strg+C (SIGINT), Strg+Pause (SIGBREAK, nur Windows), ein beendender Aufrufer (SIGTERM) und ein geschlossenes Fenster (SIGHUP).
for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGBREAK", 149],
    ["SIGHUP", 129],
] as const) {
    process.on(signal, () => {
        beendeDatenbank();
        raeumeAuf();
        vorlauf?.gibFrei();
        bank?.gibFrei();
        process.exit(code);
    });
}

/**
 * Die Pfadregel einmal, vor dem Bau: Sie nennt Stufe und Grund und sagt, ob `shared`-Bau und Typcheck entfallen. Das tun sie nur bei
 * Stufe „doku“ und nur, wenn ausschließlich `.md`-Dateien unter `docs/`, `project-control/` oder `AGENTS.md`/`CLAUDE.md` geändert sind
 * (Hauptorchestrierung 2026-10-17): Kein Skript, keine Konfiguration und kein JSON kann dann den Typcheck ändern.
 */
/** Eine Datei des geprüften Stands aus der Kopie; `undefined`, wenn es sie dort nicht gibt. */
function liesAusKopie(pfad: string): string | undefined {
    try {
        return readFileSync(join(kopie, pfad), "utf8");
    } catch {
        return undefined;
    }
}

/** Die Datenbankdateien der Stufe „bereich“: die, die `bereich-auswahl.ts` mit den übrigen Tests des Bereichs gewählt hat. */
function dbAuswahlDesBereichs(auswahl: Auswahl, testDateien: readonly TestDatei[]): DbAuswahl {
    const dateien = auswahl.datenbankDateien ?? [];
    const gesamt = dbTestDateien(testDateien).length;
    return {
        dateien,
        alle: false,
        gesamt,
        ausgelassen: gesamt - dateien.length,
        grund: dateien.length > 0 ? "die Datenbanktests des Bereichs" : "kein Datenbanktest im Bereich",
    };
}

function bestimmeAuswahl(geaendert: string[] | undefined): { auswahl: Auswahl | undefined; ohneBau: boolean } {
    if (!tests) return { auswahl: undefined, ohneBau: false };
    const testDateien = leseTestDateien(kopie);
    const auswahl: Auswahl = nurDatenbank
        ? { stufe: "voll", grund: "--nur-datenbank", filter: [] }
        : waehleTests({ geaendert, voll, testDateien, quellen: leseQuellen(kopie), liesDatei: liesAusKopie });
    sag(`  Pfadregel: Stufe ${auswahl.stufe} (${auswahl.grund}).`);
    // Die Datenbankdateien wählt die Pfadregel in jeder Stufe (die kleinen: nur die, die geänderte Dateien nennen); die Stufe voll nach `db-auswahl.ts`.
    dbAuswahl =
        auswahl.stufe === "voll"
            ? waehleDbDateien({ geaendert, voll, testDateien })
            : auswahl.stufe === "bereich"
              ? dbAuswahlDesBereichs(auswahl, testDateien)
              : waehleDbDateienKleineStufe({ geaendert, filter: auswahl.filter, testDateien });
    stufe = auswahl.stufe;
    const dbPfade = dbTestDateien(testDateien);
    const ohneDb = testDateien
        .filter(
            (t) =>
                !dbPfade.includes(t.pfad) &&
                (auswahl.stufe === "voll" || auswahl.filter.some((f) => t.pfad === f || t.pfad.startsWith(`${f}/`))),
        )
        .map((t) => t.pfad);
    const kosten = auswahlKosten(ohneDb.length, dbAuswahl.dateien.length);
    sag(
        `  Auswahl vor Ausführung: ${ohneDb.length} ohne DB, ${dbAuswahl.dateien.length} mit DB; Schätzung einschließlich Typcheck/DB-Setup: ${kosten.sekunden} s (historische Richtwerte, keine Zusage).`,
    );
    sag(`  Gewählt: ${[...ohneDb, ...dbAuswahl.dateien].join(", ")}`);
    sag(
        `  Nicht abgedeckt: ${testDateien.length - ohneDb.length - dbAuswahl.dateien.length} Testdateien; dynamische Abhängigkeiten, Browser und echte Kartendaten sind durch die Importheuristik nicht vollständig nachgewiesen.`,
    );
    if (argumente.includes("--auswahl")) {
        sag("  Nur Auswahl: keine Prüfung ausgeführt.");
        return { auswahl, ohneBau: false };
    }
    if (!voll && kosten.gross && !argumente.includes("--grosse-auswahl-bestaetigt"))
        throw new Error(
            "BEFUND: außergewöhnlich große Vorprüfung. Auswahl eingrenzen oder nach Betreiberzustimmung --grosse-auswahl-bestaetigt verwenden; nichts geprüft.",
        );
    sag(
        `  Datenbank-Auswahl: ${String(dbAuswahl.dateien.length)} von ${String(dbAuswahl.gesamt)} Dateien (${dbAuswahl.grund}); ausgelassen nach Pfadregel: ${String(dbAuswahl.ausgelassen)}.`,
    );
    const ohneBau = auswahl.stufe === "doku" && geaendert !== undefined && nurMarkdownDoku(geaendert);
    if (ohneBau) {
        sag(
            datenbankNoetig()
                ? "  Der Typcheck entfällt: Stufe doku, nur .md unter docs/, project-control/, AGENTS.md oder CLAUDE.md. Der shared-Bau bleibt für den Datenbank-Durchgang."
                : "  Typcheck und shared-Bau entfallen: Stufe doku, und es sind nur .md unter docs/, project-control/, AGENTS.md oder CLAUDE.md geändert.",
        );
    }
    return { auswahl, ohneBau };
}

/**
 * Wächter der Regel „Neu:/Achtung:“ (AGENTS.md „Geteilter Checkout und Git“, Betreiber 2026-10-17): Jeder feat/fix-Commit sagt in der
 * Beschreibung mit `Neu: …`, was neu ist; die Meldung „Neue Version“ zeigt es. Er meldet nur, hält nichts an.
 */
function neuZeilenHinweis(): void {
    try {
        const roh = git("log", "--no-merges", "--format=%x1e%h%x1f%s%x1f%b", `origin/master..${sha}`);
        for (const block of roh.split("\x1e")) {
            const [kurz = "", titel = "", beschreibung = ""] = block.split("\x1f");
            if (!/^(feat|fix)(\(|!|:)/u.test(titel) || /^\s*Neu:\s*\S/mu.test(beschreibung)) continue;
            sag(`  Hinweis  ${kurz} ohne „Neu:“ (zeigt „Neue Version“ als unredigiert): ${titel.slice(0, 80)}`);
        }
    } catch {
        // Ohne origin/master kein Vergleich; der Hinweis ist freiwillig.
    }
}

let koepfeGeprueft = false;

/** Die Kopfprüfung der Handovers allein, wenn der Push Handovers berührt und `--tests` den Wächter nicht ohnehin fährt. */
function pruefeHandoverKoepfe(geaendert: string[] | undefined): boolean {
    if (tests || !beruehrtHandover(geaendert)) return true;
    koepfeGeprueft = true;
    return schritt(
        "Handover-Köpfe (Regelwerk-Wächter)",
        ["test", "--", HANDOVER_KOPF_TEST],
        pruefUmgebung(),
        ROT_KOEPFE,
    );
}

/**
 * Der Wächter der Release-Teile allein, wenn der Push Specs oder ihre Zuordnung berührt und `--tests` ihn nicht ohnehin fährt. Nur ein
 * Hinweis, er hält den Push nicht an (Betreiber 2026-10-24: keine neuen blockierenden Prüfungen ohne seine Zustimmung).
 */
function pruefeReleaseTeile(geaendert: string[] | undefined): boolean {
    if (tests || !beruehrtReleaseTeile(geaendert)) return true;
    schritt(
        "Hinweis: Release-Teile (jede Spec in genau einem Teil; hält den Push nicht an)",
        ["test", "--", RELEASE_TEILE_TEST],
        pruefUmgebung(),
        ROT_KOEPFE,
    );
    return true;
}

/**
 * Der Wächter der Gelände-Sicht allein, wenn der Push Geländeleser berührt und `--tests` ihn nicht ohnehin fährt (WI-0271 L1; Leserliste
 * und Form mit der Topographie-Koordination 2026-10-31). Nur ein Hinweis, er hält den Push nicht an (Betreiber 2026-10-24: keine neuen
 * blockierenden Prüfungen ohne seine Zustimmung); rot heißt: ein Geländeleser liest `terrain_peak` statt `terrain_peak_gelaende`.
 */
function pruefeGelaendeSicht(geaendert: string[] | undefined): boolean {
    if (tests || !beruehrtGelaendeLeser(geaendert)) return true;
    schritt(
        "Hinweis: Gelände-Sicht (Geländeleser nur über terrain_peak_gelaende; hält den Push nicht an)",
        ["test", "--", GELAENDE_SICHT_TEST],
        pruefUmgebung(),
        ROT_KOEPFE,
    );
    return true;
}

/** Wie viele neue Verflechtungen der Push bringt (`meldeVerflechtung`); das Ergebnis nennt die Zahl. */
let verflechtungNeu = 0;

/**
 * Hinweis Verflechtung (WI-0289, Vali 2026-11-08: „ich hab angst, dass du abhängigkeiten erzeugst“): was der Push gegenüber `origin/master`
 * neu verflicht, also neu gegenseitige Bereiche, neue Dateikreise und Grenzübertritte (`verflechtung.ts`). Nur bei Änderungen am Produktcode,
 * ein paar Sekunden. Nur ein Hinweis, er hält den Push nicht an (Betreiber 2026-10-24: keine neuen blockierenden Prüfungen ohne seine Zustimmung).
 */
function meldeVerflechtung(geaendert: string[] | undefined): void {
    if (geaendert === undefined || !geaendert.some((p) => istQuelle(p.replace(/\\/g, "/")))) return;
    try {
        const basis = git("merge-base", "origin/master", sha);
        const neu = vergleiche(leseGraph(basis, wurzel), leseGraph(sha, wurzel));
        verflechtungNeu = anzahlNeu(neu);
        sag("Hinweis: Verflechtung gegenüber origin/master (hält den Push nicht an)");
        for (const zeile of hinweisZeilen(neu)) sag(`  ${zeile}`);
    } catch (fehler) {
        sag(`  Hinweis: Verflechtung nicht gemessen: ${(fehler as Error).message}`);
    }
}

let lintGeprueft = false;

/**
 * Lint und Format (WI-0224-Nachtrag, Hauptorchestrierung 2026-10-18; `lint-auswahl.ts`): die geänderten Dateien gegen `origin/master`, bei
 * `--voll` und unbestimmbarer Änderung alles (`npm run lint`, `npm run format:check`). Läuft vor Bau und Typcheck: ESLint ist nicht
 * typbewusst und braucht keinen Bau, ein Fund soll nicht erst nach zwei Minuten Typcheck auffallen.
 */
function pruefeLintUndFormat(geaendert: string[] | undefined): boolean {
    const plan = planeLintUndFormat({ geaendert, voll, vorhanden: (pfad) => existsSync(join(kopie, pfad)) });
    const eslint = join(kopie, "node_modules", "eslint", "bin", "eslint.js");
    const prettier = join(kopie, "node_modules", "prettier", "bin", "prettier.cjs");
    // Ohne Farbcodes: Prettier und ESLint färben sonst auch in eine Pipe, und die roten Zeilen stünden mit Steuerzeichen im Lauf.
    const env = { ...pruefUmgebung(), NO_COLOR: "1", FORCE_COLOR: "0" };
    let ok = true;
    if (plan.lint.modus === "alles") {
        lintGeprueft = true;
        ok = schritt("Lint (alles: npm run lint)", ["run", "lint"], env, ROT_LINT) && ok;
    } else if (plan.lint.modus === "geaendert") {
        lintGeprueft = true;
        for (const stueck of inStuecken(plan.lint.dateien, 100)) {
            const name = `Lint (${String(stueck.length)} geänderte Dateien)`;
            ok = schritt(name, [eslint, "--no-warn-ignored", ...stueck], env, ROT_LINT, true) && ok;
        }
    }
    if (plan.format.modus === "alles") {
        lintGeprueft = true;
        ok = schritt("Format (alles: npm run format:check)", ["run", "format:check"], env, ROT_LINT) && ok;
    } else if (plan.format.modus === "geaendert") {
        lintGeprueft = true;
        for (const stueck of inStuecken(plan.format.dateien, 100)) {
            const name = `Format (${String(stueck.length)} geänderte Dateien)`;
            ok = schritt(name, [prettier, "--check", "--ignore-unknown", ...stueck], env, ROT_LINT, true) && ok;
        }
    }
    return ok;
}

let gruen = false;
let bauEntfallen = false;
try {
    neuZeilenHinweis();
    raeumeAlteKopienAuf();
    raeumeWegwerfClusterAuf(sag);
    bereiteKopieVor();
    const geaendert = geaenderteDateien();
    const { auswahl, ohneBau } = bestimmeAuswahl(geaendert);
    if (argumente.includes("--auswahl")) {
        raeumeAuf();
        process.exit(0);
    }
    meldeVerflechtung(geaendert);
    bauEntfallen = ohneBau;
    // Der Vorlauf begrenzt nur das Schwere davor: `shared`-Bau und Typcheck (vue-tsc allein 1,2 bis 1,6 GB). Ein Push ohne beides (nur
    // Markdown-Doku) stellt sich nicht an (Befund der Regel-Koordination 2026-10-18: 10 min am Vorlauf für 90 s eigene Prüfung), und die Tests
    // danach laufen außerhalb (Vorgabe der Hauptorchestrierung: „eine kleine Sperre für Lint, shared-Bau und Typcheck“).
    const ohneVorlauf = ohneBau && !datenbankNoetig();
    vorlauf = ohneVorlauf
        ? undefined
        : await nimmBank({
              ordner: join(bankOrdner(), "vorlauf"),
              plaetze: VORLAUF_PLAETZE,
              titel: "Vorlauf",
              sitzung: basename(wurzel),
              art: "vor-dem-push: Lint, shared-Bau, Typcheck",
              commit: sha.slice(0, 8),
              verwaistNachMs: VORLAUF_VERWAIST_MS,
              sag,
          });
    let vorne = false;
    try {
        vorne =
            pruefeHandoverKoepfe(geaendert) &&
            pruefeReleaseTeile(geaendert) &&
            pruefeGelaendeSicht(geaendert) &&
            pruefeLintUndFormat(geaendert) &&
            (ohneVorlauf || schritt("shared bauen", ["run", "build", "--workspace", "@avesmaps3d/shared"])) &&
            (nurDatenbank || ohneBau || schritt("Typcheck aus der Wurzel", ["run", "typecheck"]));
    } finally {
        vorlauf?.gibFrei();
    }
    gruen =
        vorne &&
        (auswahl === undefined || (await testsNachPfadregel(auswahl))) &&
        (auswahl === undefined || pruefeDatenbank(auswahl)) &&
        (!voll || schritt("Bau wie der Release (npm run build)", ["run", "build"])) &&
        (!voll ||
            schritt(
                "Besucherpaket (Wächter, WI-0235)",
                [join("scripts", "dev", "paket-waechter.ts"), join("apps", "web", "dist")],
                process.env,
                /Start-JS|ROT/,
                true,
            ));
} catch (fehler) {
    sag(`  ROT  Kopie nicht angelegt: ${(fehler as Error).message}`);
} finally {
    beendeDatenbank();
    vorlauf?.gibFrei();
    bank?.gibFrei();
    raeumeAuf();
}
if (ueberholt !== undefined) {
    sag(
        `Ergebnis: überholt. Der Commit ${sha.slice(0, 8)} ist nicht mehr der HEAD deiner Arbeitskopie; nichts geprüft, kein Urteil.`,
    );
    process.exit(EXIT_UEBERHOLT);
}
const datenbankHinweis = datenbankSatz(nichtGelaufen().fehlt, nichtGelaufen().ausgelassen);
const hinweisNichtGelaufen = `${datenbankHinweis === undefined ? "" : ` ⚠ ${datenbankHinweis}.`}${
    verflechtungNeu > 0
        ? ` ⚠ ${String(verflechtungNeu)} neue Verflechtung(en), siehe „Hinweis: Verflechtung“ oben.`
        : ""
}`;
sag(
    gruen
        ? nurDatenbank
            ? `Ergebnis: grün. Der Commit ${sha.slice(0, 8)} besteht Lint, Format und den Datenbank-Durchgang (--nur-datenbank: Typcheck und die übrigen Durchgänge entfielen).${hinweisNichtGelaufen}`
            : bauEntfallen
              ? `Ergebnis: grün. Der Commit ${sha.slice(0, 8)} besteht die Tests der Stufe doku (Bau und Typcheck entfielen: nur Markdown-Doku).${hinweisNichtGelaufen}`
              : `Ergebnis: grün. Der Commit ${sha.slice(0, 8)} baut und besteht den Typcheck${lintGeprueft ? ", Lint und Format" : ""}${tests ? `, die Tests der Stufe ${stufe ?? "voll"}` : koepfeGeprueft ? " und die Handover-Köpfe" : ""}${voll ? " und den Bau" : ""}.${hinweisNichtGelaufen}`
        : grundDatenbankRot !== undefined
          ? `Ergebnis: ROT. Der Commit ${sha.slice(0, 8)}: ${grundDatenbankRot}`
          : `Ergebnis: ROT. Der Commit ${sha.slice(0, 8)} ist nicht, was dein Arbeitsbaum zeigt, oder selbst rot; vor dem Push beheben.`,
);
process.exit(gruen ? 0 : 1);
