// Die Prüfbank: schwere Testläufe auf diesem Rechner warten aufeinander, statt gleichzeitig zu laufen.
//
// 🔴 Anlass (Betreiber 2026-10-17, über die Hauptorchestrierung: „die sitzungen können ruhig aufeinander warten, muss nicht alles
// parallel laufen“): Vier bis sieben `vor-dem-push -- --tests` und Playwright-Läufe gleichzeitig machten aus Minuten über eine Stunde
// und aus grünen Fällen Zeitüberschreitungen (5 bis 70 s gegen eine Vorgabe von 5 s). Ein Rot, das nur die Last meldet, sagt nichts
// über den Commit.
//
// Wie: Eine einzige Sperrdatei `pruefbank.json` unter `C:\avesmaps3d-data\pruefbank` (neben `claims`, ÜBER dem Repository,
// überschreibbar mit `AVESMAPS_PRUEFBANK_DIR`). Wer sie anlegen kann (`wx`, atomar), prüft; wer sie findet, schreibt EINE Zeile
// („wartet auf den Prüflauf von <Sitzung> …, Platz n in der Warteschlange“) und fragt alle zwei Sekunden neu. Sie wird auch bei Abbruch
// freigegeben (Signale, `exit`).
//
// 🔴 Reihenfolge (Medienverwaltung 2026-10-17: ihr Lauf wurde 147 min lang überholt): Wer wartet, legt unter `warteschlange/` ein Ticket
// mit Zeitstempel an, und nur das älteste Ticket darf die Sperre nehmen. Tickets toter Prozesse räumt jeder Aufrufer weg. Läufe, die
// vor dieser Änderung gestartet wurden, kennen die Warteschlange nicht und fragen weiter ohne Ticket.
//
// Vorrang für einen dringenden Hotfix (Stage-Fehler, Sicherheit): `AVESMAPS_PRUEFBANK_VORRANG=1`. Das Ticket kommt vor alle Wartenden;
// der laufende Halter wird nicht verdrängt. Wer gar nicht warten kann, nimmt `AVESMAPS_PRUEFBANK=aus` (und wertet Zeitüberschreitungen
// danach nicht ungeprüft).
//
// 🪤 Eine Bank mit Bremse, wie die Anspruchsliste, keine harte Sperre: Eine Sperre ohne lebenden Prozess (PID) oder älter als zwei
// Stunden gilt als verwaist und wird übernommen; ein Lauf, den man nicht warten lassen will, setzt `AVESMAPS_PRUEFBANK=aus`. Übernehmen
// zwei Wartende dieselbe verwaiste Sperre im selben Millisekundenfenster, laufen sie ausnahmsweise zusammen: das ist der Zustand von
// vorher, kein Schaden.
//
// 🔴 Keine blockierende Prüfung im Sinn von `apps/server/src/blocking-checks.ts` (AGENTS.md „Blockierende Prüfungen im Betrieb“): Sie
// hält keinen Import, keine Ableitung und keinen Prüflauf der Anwendung an, nur unsere eigenen Testläufe auf diesem Rechner.
//
// Aufruf für beliebige schwere Befehle (Playwright, ein ganzer `npm test`):
//
//   npm run bank -- npx playwright test e2e/playmode.spec.ts --workers=1
//   npm run bank -- --art "Browserlauf Playmode" npm test
//
// `vor-dem-push --tests` nimmt die Bank selbst, nur für den Testteil. Lint, `shared`-Bau und Typcheck davor laufen an einer eigenen,
// kleineren Bank mit zwei Plätzen (`plaetze`, Ordner `vorlauf/`, Titel „Vorlauf“; Hauptorchestrierung 2026-10-18 nach der Messung der
// Arbeitshygiene: Ohne Sperre liefen bis zu 88 Node-Prozesse mit 12,2 GB, der freie Arbeitsspeicher fiel auf 0,43 GB). Mit mehreren
// Plätzen gibt es je Platz eine Datei `platz-<n>.json`, und die ersten n Tickets dürfen sich einen freien nehmen.
//
// Wer dran ist, sieht eine Lagezeile („Rechner: RAM frei … von … GB, C: frei … GB (… %)“) und unter 8 GB freiem Arbeitsspeicher oder
// 5 % freiem Platz die Warnung „Rechner knapp“ (`RAM_FREI_MIN_BYTES`, `PLATZ_FREI_MIN_ANTEIL`): Zeitüberschreitungen sind dann
// kein Urteil über den Commit. Es wird nur gemeldet, nie angehalten.
//
// 🔴 Der lokale Release-Test (`release-runner.ts`, Stunden lang) steht NICHT an dieser Bank, sondern hält seine eigene Sperre
// `<Datenwurzel>\release-werkzeug\.release-runs\aktiv` (ein Ordner, mit `mkdir` angelegt; bei einem Absturz bleibt er sichtbar stehen).
// Browserläufe und Datenbank-Cluster anderer Sitzungen am Vormittag des 2026-10-24 störten so einen laufenden Release-Test (Befund WI-0248,
// Lauf f80bb5c83: Zeitüberschreitungen unter fremder Last). Das Warten darauf hielt am selben Tag aber die Entwicklung stundenlang auf; der
// Betreiber (2026-10-24): „Tests dürfen die übrige Entwicklung nicht unnötig lahmlegen“, neue Blockaden nur mit seiner Zustimmung. Darum wartet
// die Bank NICHT mehr von selbst; nur mit `AVESMAPS_PRUEFBANK_WARTET_AUF_RELEASE=1` wartet die schwere Bank (ein Platz) und schreibt eine Zeile,
// worauf. Stört fremde Last einen Release-Test, wiederholt „Rote Teile wiederholen“ nur den betroffenen Teil.
//
// 🪤 Eine tote Sperre darf die Bank nie ewig halten. Maßstab ist der des Abholers (`release-abholer.ts`, `lebtRunnerProzess`): Besteht die
// Sperre, aber kein `node.exe` mit `release-runner.ts` in der Befehlszeile lebt, ist sie tot. Die Bank sagt das in einer Zeile, wartet nicht
// und entsperrt nichts (wie der Abholer). Lässt sich die Prozessliste nicht lesen, gilt die Zeitgrenze des Runners (zwölf Stunden).
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { lebtRunnerProzess, releaseTestStand } from "./release-abholer.ts";

/** Nach dieser Zeit gilt eine Sperre als verwaist, auch wenn ihr Prozess noch läuft (hängender Lauf). */
export const VERWAIST_NACH_MS = 2 * 60 * 60 * 1000;
/**
 * Unter diesen Werten meldet die Bank „Rechner knapp“ (Hauptorchestrierung 2026-10-17, nachdem viele gleichzeitige Läufe den
 * Arbeitsspeicher aufbrauchten und die Auslagerungsdatei auf 63 GB wuchs): weniger freier Arbeitsspeicher oder weniger freier
 * Platz auf der Platte. Nur eine Zeile, nie ein Halt.
 */
export const RAM_FREI_MIN_BYTES = 8 * 1024 ** 3;
export const PLATZ_FREI_MIN_ANTEIL = 0.05;
/** Eine Sperrdatei, die sich nicht lesen lässt, ist so lange „gerade angelegt“; danach verwaist. */
const UNLESBAR_NACH_MS = 10_000;
const STANDARD_ORDNER = "C:\\avesmaps3d-data\\pruefbank";
const DATEI = "pruefbank.json";
const WARTESCHLANGE = "warteschlange";

/** Was in der Sperrdatei steht: wer prüft, was, seit wann. */
export interface Halter {
    readonly pid: number;
    readonly sitzung: string;
    readonly art: string;
    readonly commit: string;
    readonly seit: string;
    readonly token: string;
    /**
     * Bis wann der Halter die Bank höchstens hält (ISO), wenn er es selbst angesagt hat (`haltHoechstensMs`). Dann gilt nicht die
     * Zwei-Stunden-Frist, sondern diese Zeit; ein toter Prozess wird weiter sofort übernommen.
     */
    readonly bis?: string;
}

export interface BankOptionen {
    /** Name der Sitzung oder Arbeitskopie, wie ihn die anderen in der Wartezeile lesen. */
    readonly sitzung: string;
    /** Was geprüft wird („vor-dem-push --tests“, „Browserlauf …“). */
    readonly art: string;
    readonly commit?: string;
    readonly ordner?: string;
    /** Wie viele gleichzeitig dürfen (Vorgabe 1: die Prüfbank selbst, Datei `pruefbank.json`; mehr: je Platz `platz-<n>.json`). */
    readonly plaetze?: number;
    /** Wie die Zeilen beginnen („Prüfbank“, „Vorlauf“). */
    readonly titel?: string;
    /** `true` oder `AVESMAPS_PRUEFBANK=aus`: nicht anstellen. */
    readonly aus?: boolean;
    /**
     * `true` oder `AVESMAPS_PRUEFBANK_VORRANG=1`: das Ticket kommt vor alle Wartenden ohne Vorrang (ein dringender Hotfix). Der
     * laufende Halter wird nicht verdrängt; mehrere mit Vorrang reihen sich unter sich nach der Zeit ein.
     */
    readonly vorrang?: boolean;
    readonly sag?: (zeile: string) => void;
    readonly pollMs?: number;
    readonly meldeAlleMs?: number;
    readonly verwaistNachMs?: number;
    /**
     * Wie lange dieser Lauf die Bank höchstens hält (der Sammellauf: Stunden). Steht als `bis` in der Sperre und ersetzt dort die
     * Zwei-Stunden-Frist (`VERWAIST_NACH_MS`): Sonst übernahm ein Wartender nach zwei Stunden einen lebenden, langen Lauf, und beide liefen
     * nebeneinander (Sammellauf 2026-10-19 ab 02:18, die Last trieb die Browserfälle ins Zeitlimit).
     */
    readonly haltHoechstensMs?: number;
    /**
     * Wartet diese Bank, solange ein Release-Test läuft (Sperre `.release-runs\aktiv`, siehe Kopf)? Vorgabe: nein, außer mit
     * `AVESMAPS_PRUEFBANK_WARTET_AUF_RELEASE=1` (Betreiber 2026-10-24: Tests legen die übrige Entwicklung nicht lahm).
     */
    readonly wartetAufReleaseTest?: boolean;
    /** Nur für Tests: die Uhr und die Frage, ob ein Prozess lebt. */
    readonly jetzt?: () => number;
    readonly lebt?: (pid: number) => boolean;
    readonly lage?: () => Lage | undefined;
    /** Nur für Tests: wo die Sperre des Release-Tests liegt (Vorgabe: neben dem Bankordner) und ob ihr Runner lebt. */
    readonly releaseLaeufe?: string;
    readonly lebtRunner?: () => boolean | undefined;
}

/** Wie voll der Rechner ist, in Bytes: Arbeitsspeicher und die Platte, auf der die Repositories liegen. */
export interface Lage {
    readonly ramFrei: number;
    readonly ramGesamt: number;
    readonly platzFrei: number;
    readonly platzGesamt: number;
    readonly platte: string;
}

export interface Bank {
    /** Wurde die Sperre wirklich genommen? `false` heißt: ausgeschaltet, der Lauf geht ungeschützt los. */
    readonly gehalten: boolean;
    readonly gewartetMs: number;
    /** Gibt die Sperre frei (nur die eigene, nie die eines anderen). Mehrfach rufbar. */
    gibFrei(): void;
}

export function bankOrdner(env: NodeJS.ProcessEnv = process.env): string {
    return env["AVESMAPS_PRUEFBANK_DIR"] ?? STANDARD_ORDNER;
}

/** Liest freien Arbeitsspeicher und freien Platz der Platte; `undefined`, wenn das Betriebssystem es nicht hergibt. */
export function liesLage(platte: string = process.platform === "win32" ? "C:\\" : "/"): Lage | undefined {
    try {
        const platz = statfsSync(platte);
        return {
            ramFrei: freemem(),
            ramGesamt: totalmem(),
            platzFrei: platz.bavail * platz.bsize,
            platzGesamt: platz.blocks * platz.bsize,
            platte,
        };
    } catch {
        return undefined;
    }
}

const gb = (bytes: number): string => (bytes / 1024 ** 3).toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** Die Zeilen für die Bank: immer eine Lagezeile, bei knappem Rechner eine Warnzeile dazu. */
export function lageZeilen(lage: Lage | undefined, titel = "Prüfbank"): string[] {
    if (lage === undefined) return [];
    const anteil = lage.platzGesamt > 0 ? lage.platzFrei / lage.platzGesamt : 1;
    const prozent = (anteil * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 });
    const zeilen = [
        `  ${titel}: Rechner: RAM frei ${gb(lage.ramFrei)} von ${gb(lage.ramGesamt)} GB, ${lage.platte} frei ${gb(lage.platzFrei)} von ${gb(lage.platzGesamt)} GB (${prozent} %).`,
    ];
    const knapp: string[] = [];
    if (lage.ramFrei < RAM_FREI_MIN_BYTES) knapp.push(`weniger als ${gb(RAM_FREI_MIN_BYTES)} GB RAM frei`);
    if (anteil < PLATZ_FREI_MIN_ANTEIL)
        knapp.push(`weniger als ${String(PLATZ_FREI_MIN_ANTEIL * 100)} % Platz auf ${lage.platte} frei`);
    if (knapp.length > 0) {
        zeilen.push(
            `  ${titel}: Rechner knapp (${knapp.join(", ")}): Zeitüberschreitungen sind dann kein Urteil über den Commit.`,
        );
    }
    return zeilen;
}

/** Läuft der Prozess noch? Ein Fehler außer „gibt es nicht“ (etwa EPERM) heißt: Er läuft, nur unter einem anderen Konto. */
export function lebtProzess(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (fehler) {
        return (fehler as NodeJS.ErrnoException).code !== "ESRCH";
    }
}

/** Warum eine Sperre verwaist ist, oder `undefined`, wenn sie gilt. */
export function verwaistGrund(
    halter: Halter,
    jetzt: number,
    lebt: (pid: number) => boolean,
    verwaistNachMs: number = VERWAIST_NACH_MS,
): string | undefined {
    if (!lebt(halter.pid)) return `Prozess ${String(halter.pid)} läuft nicht mehr`;
    const bis = halter.bis === undefined ? Number.NaN : Date.parse(halter.bis);
    if (Number.isFinite(bis)) {
        return jetzt > bis ? `über die angesagte Zeit (bis ${halter.bis ?? ""})` : undefined;
    }
    const seit = Date.parse(halter.seit);
    if (Number.isFinite(seit) && jetzt - seit > verwaistNachMs) {
        return `älter als ${String(Math.round(verwaistNachMs / 60_000))} min`;
    }
    return undefined;
}

/**
 * Der Runner beendet sich spätestens nach zwölf Stunden selbst (`release-runner.ts`, `deadline`); die halbe Stunde darüber ist Spielraum für sein
 * Aufräumen. Eine ältere Sperre gehört keinem Lauf mehr, auch wenn sich die Prozessliste nicht lesen ließ.
 */
export const RELEASE_SPERRE_MAX_MS = 12.5 * 60 * 60 * 1000;
/** So selten fragt die Bank nach, ob der Runner lebt: Das ist eine PowerShell-Abfrage der Prozessliste (Sekunden), die Sperre selbst ist ein `existsSync`. */
export const RELEASE_LEBT_ALLE_MS = 60_000;

/** Wie es um die Sperre des Release-Tests steht: keine, ein lebender Lauf (wartet), oder eine tote Sperre (nicht warten). */
export type ReleaseSperre =
    | { readonly zustand: "keine" }
    | {
          readonly zustand: "laeuft";
          /** Der laufende Commit und Schritt laut `status.json` des jüngsten Laufs; fehlt, wenn er sich nicht lesen ließ. */
          readonly sha?: string;
          readonly start?: string;
          readonly schritt?: string;
      }
    | { readonly zustand: "tot"; readonly grund: string };

/** Wo die Sperre des Release-Tests liegt: im Werkzeugklon neben dem Bankordner (`<Datenwurzel>\release-werkzeug\.release-runs`). */
export function releaseLaeufeOrdner(bankOrdnerPfad: string = bankOrdner()): string {
    return join(dirname(bankOrdnerPfad), "release-werkzeug", ".release-runs");
}

/**
 * Warten oder nicht? Die Sperre `aktiv` ist ein Ordner, den der Runner mit `mkdir` anlegt (`release-runner.ts`) und bei einem Absturz stehen lässt.
 * Ob ein Lauf dahinter lebt, entscheidet der Abholer mit `lebtRunnerProzess` (ein `node.exe` mit `release-runner.ts` in der Befehlszeile): `false`
 * heißt tot. `undefined` (kein Windows, Abfrage gescheitert) ist kein Beweis für tot; dann gilt nur die Zeitgrenze des Runners.
 */
export function pruefeReleaseSperre(
    laeufe: string,
    optionen: {
        readonly jetzt?: () => number;
        readonly lebtRunner?: () => boolean | undefined;
        /** Sha, Start und Schritt des Laufs für die Wartezeile; nur lesend, darf scheitern. */
        readonly stand?: (laeufe: string) => { sha?: string; start?: string; schritt?: string } | undefined;
    } = {},
): ReleaseSperre {
    const sperre = join(laeufe, "aktiv");
    if (!existsSync(sperre)) return { zustand: "keine" };
    const jetzt = optionen.jetzt ?? Date.now;
    const lebt = (optionen.lebtRunner ?? lebtRunnerProzess)();
    if (lebt === false)
        return { zustand: "tot", grund: "kein Prozess mit release-runner.ts in der Befehlszeile läuft" };
    try {
        const alterMs = jetzt() - statSync(sperre).mtimeMs;
        if (alterMs > RELEASE_SPERRE_MAX_MS)
            return {
                zustand: "tot",
                grund: `die Sperre ist ${String(Math.round(alterMs / 3_600_000))} Stunden alt, der Runner endet nach zwölf`,
            };
    } catch {
        // Zwischen existsSync und statSync verschwunden: Der Lauf ist gerade fertig geworden.
        return { zustand: "keine" };
    }
    const stand = (optionen.stand ?? standDesReleaseLaufs)(laeufe);
    return {
        zustand: "laeuft",
        ...(stand?.sha === undefined ? {} : { sha: stand.sha }),
        ...(stand?.start === undefined ? {} : { start: stand.start }),
        ...(stand?.schritt === undefined ? {} : { schritt: stand.schritt }),
    };
}

/** Der jüngste Lauf im Werkzeugklon, nur lesend (`releaseTestStand` des Abholers). Scheitert das Lesen, fehlen die Angaben, die Sperre gilt trotzdem. */
function standDesReleaseLaufs(laeufe: string): { sha?: string; start?: string; schritt?: string } | undefined {
    try {
        const klon = dirname(laeufe);
        const lauf = releaseTestStand(undefined, { klon, daten: dirname(klon) });
        return {
            ...(lauf.sha === undefined ? {} : { sha: lauf.sha }),
            ...(lauf.start === undefined ? {} : { start: lauf.start }),
            ...(lauf.schritt === undefined ? {} : { schritt: lauf.schritt }),
        };
    } catch {
        return undefined;
    }
}

type Gelesen = { art: "halter"; halter: Halter } | { art: "unlesbar"; alterMs: number } | { art: "fehlt" };

function lies(datei: string, jetzt: number): Gelesen {
    let text: string;
    try {
        text = readFileSync(datei, "utf8");
    } catch (fehler) {
        if ((fehler as NodeJS.ErrnoException).code === "ENOENT") return { art: "fehlt" };
        return { art: "unlesbar", alterMs: UNLESBAR_NACH_MS + 1 };
    }
    try {
        const roh = JSON.parse(text) as Partial<Halter>;
        if (typeof roh.pid === "number" && typeof roh.token === "string") {
            return {
                art: "halter",
                halter: {
                    pid: roh.pid,
                    sitzung: roh.sitzung ?? "unbekannt",
                    art: roh.art ?? "Prüflauf",
                    commit: roh.commit ?? "",
                    seit: roh.seit ?? "",
                    token: roh.token,
                    ...(typeof roh.bis === "string" ? { bis: roh.bis } : {}),
                },
            };
        }
    } catch {
        /* halb geschrieben oder fremder Inhalt */
    }
    let alterMs = UNLESBAR_NACH_MS + 1;
    try {
        alterMs = jetzt - statSync(datei).mtimeMs;
    } catch {
        /* weg: der nächste Versuch legt sie an */
    }
    return { art: "unlesbar", alterMs };
}

/** Die Tickets der Wartenden, älteste zuerst; Tickets toter Prozesse (und lange unlesbare) räumt jeder Aufrufer weg. */
function lebendeTickets(ordner: string, jetzt: number, lebt: (pid: number) => boolean): string[] {
    let namen: string[];
    try {
        namen = readdirSync(ordner);
    } catch {
        return [];
    }
    const lebende: string[] = [];
    for (const name of namen.filter((n) => n.endsWith(".json")).sort()) {
        const pfad = join(ordner, name);
        const gelesen = lies(pfad, jetzt);
        if (gelesen.art === "fehlt") continue;
        const tot = gelesen.art === "halter" ? !lebt(gelesen.halter.pid) : gelesen.alterMs > UNLESBAR_NACH_MS;
        if (tot) {
            rmSync(pfad, { force: true });
            continue;
        }
        lebende.push(name);
    }
    return lebende;
}

const gehalteneBaenke = new Set<() => void>();
let abschlussHaken = false;
/** Ein einziger `exit`-Haken für alle Bänke des Prozesses: Auch ein hartes `process.exit` gibt die Sperre frei. */
function haengeAbschlussHakenAn(): void {
    if (abschlussHaken) return;
    abschlussHaken = true;
    process.on("exit", () => {
        for (const frei of [...gehalteneBaenke]) frei();
    });
}

const schlafen = (ms: number): Promise<void> => new Promise((fertig) => setTimeout(fertig, ms));

function uhrzeit(iso: string): string {
    const zeit = new Date(iso);
    return Number.isNaN(zeit.getTime())
        ? "unbekannt"
        : zeit.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Stellt sich an und kehrt zurück, sobald die Sperre dem Aufrufer gehört (oder die Bank aus ist). `gibFrei()` am Ende, auch im
 * Fehlerfall (`finally`).
 */
export async function nimmBank(optionen: BankOptionen): Promise<Bank> {
    const jetzt = optionen.jetzt ?? Date.now;
    const lebt = optionen.lebt ?? lebtProzess;
    const sag = optionen.sag ?? ((zeile: string) => process.stdout.write(`${zeile}\n`));
    const pollMs = optionen.pollMs ?? 2000;
    const meldeAlleMs = optionen.meldeAlleMs ?? 60_000;
    const start = jetzt();
    const aus =
        optionen.aus === true || ["aus", "0", "off"].includes((process.env["AVESMAPS_PRUEFBANK"] ?? "").toLowerCase());
    if (aus) return { gehalten: false, gewartetMs: 0, gibFrei: () => undefined };

    const titel = optionen.titel ?? "Prüfbank";
    const plaetze = Math.max(1, Math.floor(optionen.plaetze ?? 1));
    const ordner = optionen.ordner ?? bankOrdner();
    const dateien =
        plaetze === 1
            ? [join(ordner, DATEI)]
            : Array.from({ length: plaetze }, (_, nummer) => join(ordner, `platz-${String(nummer + 1)}.json`));
    let datei = dateien[0] ?? join(ordner, DATEI);
    mkdirSync(ordner, { recursive: true });
    const meins: Halter = {
        pid: process.pid,
        sitzung: optionen.sitzung,
        art: optionen.art,
        commit: optionen.commit ?? "",
        seit: new Date(jetzt()).toISOString(),
        token: randomBytes(8).toString("hex"),
    };

    // Die Warteschlange (Medienverwaltung 2026-10-17: Ihr Lauf wurde über 147 min von immer anderen überholt, weil jeder, der nach der
    // Freigabe zuerst fragte, die Sperre bekam): Wer wartet, legt ein Ticket mit Zeitstempel an, und nur der Älteste darf die Sperre
    // nehmen. Die Sperre selbst bleibt der atomare Ausschluss (`wx`); ein verpasster Rang kostet höchstens Fairness, nie die Regel.
    haengeAbschlussHakenAn();
    const ticketOrdner = join(ordner, WARTESCHLANGE);
    mkdirSync(ticketOrdner, { recursive: true });
    const vorrang =
        optionen.vorrang === true ||
        ["1", "ja", "an", "true"].includes((process.env["AVESMAPS_PRUEFBANK_VORRANG"] ?? "").toLowerCase());
    if (vorrang) sag(`  ${titel}: mit Vorrang angestellt (vor allen Wartenden ohne Vorrang).`);
    // Der Name sortiert: erst der Rang („0“ Vorrang, „1“ gewöhnlich), dann die Zeit. Tickets der Fassung davor (nur die Zeit) stehen
    // vor den gewöhnlichen und hinter denen mit Vorrang.
    const ticketName = `${vorrang ? "0" : "1"}${String(jetzt()).padStart(15, "0")}-${meins.token}.json`;
    const ticket = join(ticketOrdner, ticketName);
    const legeTicketAn = (): void => {
        writeFileSync(ticket, JSON.stringify(meins));
    };
    const raeumeTicketAuf = (): void => {
        gehalteneBaenke.delete(raeumeTicketAuf);
        rmSync(ticket, { force: true });
    };
    legeTicketAn();
    gehalteneBaenke.add(raeumeTicketAuf);

    // Nur auf Wunsch geht der Release-Test vor (siehe Kopf): Solange seine Sperre steht und ein Runner lebt, nimmt kein Ticket die Bank. Die Sperre selbst
    // ist ein `existsSync` je Runde; ob der Runner lebt, ist eine PowerShell-Abfrage und wird nur alle `RELEASE_LEBT_ALLE_MS` wiederholt.
    const wartetAufRelease =
        optionen.wartetAufReleaseTest ?? process.env["AVESMAPS_PRUEFBANK_WARTET_AUF_RELEASE"] === "1";
    const releaseLaeufe = optionen.releaseLaeufe ?? releaseLaeufeOrdner(ordner);
    const lebtRunner = optionen.lebtRunner ?? lebtRunnerProzess;
    let lebtGeprueft = Number.NEGATIVE_INFINITY;
    let lebtAntwort: boolean | undefined;
    let lebtFuerSperre = Number.NaN;
    const lebtGepuffert = (): boolean | undefined => {
        // Die Antwort gilt für DIESE Sperre: Entsteht binnen der Frist eine neue (ein neuer Lauf), wird neu gefragt. Sonst hielte eine
        // „tot“-Antwort der alten Sperre den frischen Lauf für tot.
        let sperreVon = Number.NaN;
        try {
            sperreVon = statSync(join(releaseLaeufe, "aktiv")).mtimeMs;
        } catch {
            /* ohne Sperre fragt pruefeReleaseSperre gar nicht erst */
        }
        if (sperreVon !== lebtFuerSperre || jetzt() - lebtGeprueft >= RELEASE_LEBT_ALLE_MS) {
            lebtAntwort = lebtRunner();
            lebtGeprueft = jetzt();
            lebtFuerSperre = sperreVon;
        }
        return lebtAntwort;
    };
    let releaseGewartet = false;
    let letzteReleaseMeldung = Number.NEGATIVE_INFINITY;
    let toteSperreGemeldet = false;

    let letzteMeldung = Number.NEGATIVE_INFINITY;
    try {
        for (;;) {
            const reihe = lebendeTickets(ticketOrdner, jetzt(), lebt);
            const rang = reihe.indexOf(ticketName);
            if (rang === -1) {
                // Das eigene Ticket hat jemand als verwaist weggenommen (etwa halb geschrieben gelesen): neu anlegen.
                legeTicketAn();
                continue;
            }
            if (wartetAufRelease) {
                const release = pruefeReleaseSperre(releaseLaeufe, { jetzt, lebtRunner: lebtGepuffert });
                if (release.zustand === "tot" && !toteSperreGemeldet) {
                    // Wie der Abholer: melden, nicht warten, nicht entsperren. Wer sie wegräumt, prüft vorher selbst.
                    toteSperreGemeldet = true;
                    sag(
                        `  ${titel}: Die Sperre ${join(releaseLaeufe, "aktiv")} besteht, aber kein Release-Lauf lebt (${release.grund}); ich warte nicht und entsperre nicht. Erst prüfen, dann die Sperre von Hand entfernen.`,
                    );
                }
                if (release.zustand === "laeuft") {
                    releaseGewartet = true;
                    if (jetzt() - letzteReleaseMeldung >= meldeAlleMs) {
                        const wartetMin = Math.max(0, Math.round((jetzt() - start) / 60_000));
                        const was = [
                            release.sha === undefined ? undefined : `Commit ${release.sha.slice(0, 12)}`,
                            release.schritt === undefined ? undefined : `Schritt ${release.schritt}`,
                            release.start === undefined ? undefined : `seit ${uhrzeit(release.start)}`,
                        ].filter((teil): teil is string => teil !== undefined);
                        sag(
                            letzteReleaseMeldung === Number.NEGATIVE_INFINITY
                                ? `  ${titel}: wartet auf den Release-Test${was.length === 0 ? "" : ` (${was.join(", ")})`}; er läuft Stunden und wird nicht gestört.`
                                : `  ${titel}: wartet weiter auf den Release-Test (${String(wartetMin)} min).`,
                        );
                        letzteReleaseMeldung = jetzt();
                    }
                    await schlafen(pollMs);
                    continue;
                }
            }
            // Erst die Plätze lesen: belegt, frei oder verwaist. Dran ist, wer weiter vorn steht, als Plätze frei sind; so bleibt die
            // Reihenfolge auch mit mehreren Plätzen streng (wird EIN Platz frei, darf nur der Erste, nicht die ersten zwei rangeln).
            const halterListe: Halter[] = [];
            let frei = 0;
            let kurz = false;
            for (const kandidat of dateien) {
                const gelesen = lies(kandidat, jetzt());
                if (gelesen.art === "fehlt") {
                    frei += 1;
                    continue;
                }
                if (gelesen.art === "unlesbar") {
                    if (gelesen.alterMs > UNLESBAR_NACH_MS) {
                        rmSync(kandidat, { force: true });
                        frei += 1;
                    } else kurz = true;
                    continue;
                }
                const halter = gelesen.halter;
                const grund = verwaistGrund(halter, jetzt(), lebt, optionen.verwaistNachMs);
                if (grund !== undefined) {
                    // Nur wegnehmen, was noch dasselbe ist: Hat in der Zwischenzeit ein anderer übernommen, bleibt seine Sperre stehen.
                    const nochDa = lies(kandidat, jetzt());
                    if (nochDa.art === "halter" && nochDa.halter.token === halter.token) {
                        rmSync(kandidat, { force: true });
                        sag(`  ${titel}: Sperre von ${halter.sitzung} (${halter.art}) übernommen: ${grund}.`);
                        frei += 1;
                    }
                    continue;
                }
                halterListe.push(halter);
            }
            if (rang < frei) {
                let genommen: string | undefined;
                for (const kandidat of dateien) {
                    try {
                        // 🪤 `seit` der Sperre ist der Augenblick, an dem der Halter sie bekommt, nicht der, an dem er sich angestellt hat:
                        // Wer 75 min wartete, galt sonst nach 45 min Lauf als verwaist (zwei Stunden ab Anstellen) und wurde überholt
                        // (Hauptorchestrierung 2026-10-17: „Halter seit 21:53“, Lauf erst ab 23:08).
                        const bekommen = jetzt();
                        const bis =
                            optionen.haltHoechstensMs === undefined
                                ? {}
                                : { bis: new Date(bekommen + optionen.haltHoechstensMs).toISOString() };
                        writeFileSync(
                            kandidat,
                            JSON.stringify({ ...meins, seit: new Date(bekommen).toISOString(), ...bis }),
                            {
                                flag: "wx",
                            },
                        );
                        genommen = kandidat;
                        break;
                    } catch (fehler) {
                        if ((fehler as NodeJS.ErrnoException).code !== "EEXIST") throw fehler;
                    }
                }
                if (genommen !== undefined) {
                    datei = genommen;
                    break;
                }
                continue; // ein anderer war schneller: neu lesen
            }
            if (kurz) {
                await schlafen(Math.min(pollMs, 200));
                continue;
            }
            if (halterListe.length > 0 && jetzt() - letzteMeldung >= meldeAlleMs) {
                const wartetMin = Math.max(0, Math.round((jetzt() - start) / 60_000));
                const platz = rang === 0 ? "als Nächster dran" : `Platz ${String(rang + 1)} in der Warteschlange`;
                const wer = (halter: Halter): string =>
                    `${halter.sitzung} (${halter.art}${halter.commit === "" ? "" : `, Commit ${halter.commit}`}, PID ${String(halter.pid)}) seit ${uhrzeit(halter.seit)}`;
                sag(
                    letzteMeldung === Number.NEGATIVE_INFINITY
                        ? `  ${titel}: wartet auf den Prüflauf von ${halterListe.map(wer).join(" und ")}; ${platz}.`
                        : `  ${titel}: wartet weiter auf ${halterListe.map((halter) => halter.sitzung).join(" und ")} (${String(wartetMin)} min; ${platz}).`,
                );
                letzteMeldung = jetzt();
            }
            await schlafen(pollMs);
        }
    } finally {
        raeumeTicketAuf();
    }

    const gewartetMs = jetzt() - start;
    if (letzteMeldung !== Number.NEGATIVE_INFINITY || releaseGewartet)
        sag(`  ${titel}: dran nach ${String(Math.round(gewartetMs / 1000))} s.`);
    for (const zeile of lageZeilen((optionen.lage ?? liesLage)(), titel)) sag(zeile);
    let frei = false;
    const gibFrei = (): void => {
        if (frei) return;
        frei = true;
        gehalteneBaenke.delete(gibFrei);
        const gelesen = lies(datei, jetzt());
        if (gelesen.art === "halter" && gelesen.halter.token === meins.token) rmSync(datei, { force: true });
    };
    gehalteneBaenke.add(gibFrei);
    return { gehalten: true, gewartetMs, gibFrei };
}

/**
 * Unter Windows läuft `npm` und `npx` nur über die Shell (`.cmd`). Node setzt die Argumente dort ohne Anführungszeichen zusammen
 * (und warnt, DEP0190): Eine Zeile mit Leerzeichen („node -e "…"“) zerbräche. Darum wird die Zeile hier selbst gebaut.
 */
function starte(befehl: string, args: string[]): ChildProcess {
    if (process.platform !== "win32") return spawn(befehl, args, { stdio: "inherit" });
    const maskiere = (teil: string): string => (/[\s"&|<>^()%]/.test(teil) ? `"${teil.replace(/"/g, '\\"')}"` : teil);
    return spawn([befehl, ...args].map(maskiere).join(" "), { stdio: "inherit", shell: true });
}

/** Der Befehlszeilenaufruf: `npm run bank -- [--art "<Text>"] <befehl> [argumente…]`. */
async function main(argumente: string[]): Promise<number> {
    let art = process.env["AVESMAPS_PRUEFBANK_ART"] ?? "";
    const rest = [...argumente];
    if (rest[0] === "--art") {
        art = rest[1] ?? art;
        rest.splice(0, 2);
    }
    const [befehl, ...args] = rest;
    if (befehl === undefined) {
        process.stderr.write('Aufruf: npm run bank -- [--art "<Text>"] <befehl> [argumente…]\n');
        return 2;
    }
    const bank = await nimmBank({
        sitzung: basename(process.cwd()),
        art: art === "" ? [befehl, ...args].join(" ").slice(0, 60) : art,
    });
    for (const [signal, code] of [
        ["SIGINT", 130],
        ["SIGTERM", 143],
        ["SIGBREAK", 149],
        ["SIGHUP", 129],
    ] as const) {
        process.on(signal, () => {
            bank.gibFrei();
            process.exit(code);
        });
    }
    return await new Promise<number>((fertig) => {
        const kind = starte(befehl, args);
        kind.on("error", (fehler) => {
            process.stderr.write(`Prüfbank: ${befehl} ließ sich nicht starten: ${fehler.message}\n`);
            fertig(127);
        });
        kind.on("exit", (code, signal) => fertig(code ?? (signal === null ? 1 : 128)));
    }).finally(() => {
        bank.gibFrei();
    });
}

// Nur als Skript gestartet (nicht beim Einlesen durch `vor-dem-push.ts` oder einen Test).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(await main(process.argv.slice(2)));
}
