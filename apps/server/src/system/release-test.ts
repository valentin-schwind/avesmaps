import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "@sinclair/typebox/value";
import {
    RELEASE_TEST_ERROR_STATUS,
    ReleaseTestKandidat,
    ReleaseTestLauf,
    releaseTestCommit,
    type ReleaseTestErrorCode,
    type ReleaseTestSicht,
} from "@avesmaps3d/shared";
import { ApiError } from "../http/api-error.ts";
import { starteAbgeloest, type AbgeloesterStart } from "./release-test-prozess.ts";

/**
 * Der Release-Test auf dem Entwicklungsrechner (WI-0248 L), serverseitig. Die Routen gibt es nur lokal (`config.releaseTest`).
 *
 * - 🔴 **Der Server rechnet nichts und importiert nichts aus `scripts/dev`.** Er ruft den Starter des Release-Tests
 *   (`scripts/dev/release-abholer.ts`) als eigenen Prozess (`node <starter> …`, Argumentliste, nie eine Shell, Zeitgrenze) und liest dessen
 *   JSON-Zeile (`--json`). Kandidat, Stand, Schritte, Dauer und Bericht rechnet der Starter.
 * - 🔴 **Gestartet wird über die Warteschlange** (Vali 2026-10-26): Die Route prüft vor (`pruefeStart`, `--trocken`) und reiht einen schweren
 *   Auftrag `release_test` mit der Person ein; den Starter ruft erst der Ausführer, wenn der schwere Platz frei ist (`jobs/release-test-job.ts`, mit
 *   `starteStarter` und `createStarterZugang` aus dieser Datei). So rechnet kein Gelände neben dem Test.
 * - 🔴 **Der Starter und der Runner überleben ihren Aufrufer.** Der Starter läuft abgelöst (`release-test-prozess.ts`: `detached`, `unref`, Ausgabe
 *   in eine Datei `starter-<sha12>.log`); den Runner startet der Starter selbst unabhängig (`release-start.ps1`). Ein Neustart des Ausführers oder
 *   des Servers lässt Testpaket-Bau und Test unberührt; der nächste Ausführer hängt sich an denselben Lauf.
 * - 🔴 **Der Stand eines Starts steht in einer Datei, nicht im Speicher.** Der Starter führt `start/<sha>.json` (`baut` mit seiner Prozessnummer,
 *   dann `gestartet` oder `fehler` mit dem Grund) und liefert sie mit `--stand --json` als `startvorgang`.
 * - 🔴 **Eine saubere Umgebung für das Kind.** Der Starter und der Runner dahinter bekommen nur die Systemvariablen und die Orte der
 *   Werkzeuge, nie die Umgebung des Aufrufers: Dort stehen `DATABASE_URL` der Entwicklungsdatenbank, Schlüssel und Geheimnisse. Der Runner
 *   prüft gegen eigene Wegwerf-Datenbanken und hat die Adresse der Entwicklungsdatenbank nicht zu kennen.
 * - **Ältere Starter** (im Werkzeugklon, bis er das nächste Mal nachgezogen wurde) kennen `--json`, `--kandidat` und `--abbrechen` noch
 *   nicht und würden stattdessen einen Test STARTEN. Darum steht in jedem Aufruf außer dem Start selbst `--trocken`: Ein alter Starter
 *   entscheidet dann nur und gibt Text aus, den der Server als „zu alt“ liest, und der nächste Starter wird gefragt. Gestartet wird nur
 *   mit dem Starter, der die Vorprüfung als JSON beantwortet hat.
 * - 🔴 **Die Freigabe** (WI-0248; Vali 2026-10-26: der Start ist die Production-Freigabe, die Auslieferung folgt automatisch bei Grün): Die Vorprüfung
 *   nimmt nur einen Starter, der die Freigabe kennt (`kenntFreigabe`); derselbe schreibt sie (`freigeben`, `--freigeben`), und der Ausführer startet mit
 *   ihm den Lauf mit ihrer Kennung (`--freigabe RT-<Auftrag>`). Endet der Auftrag ohne Grün, beendet er sie (`beendeFreigabe`, `--freigabe-beenden`).
 *   Ob ausgeliefert wird, entscheidet Claudios Abholer nach `scripts/dev/release-freigabe.ts`; der Server liefert nichts aus.
 * - 🔴 **Der Volltest** (WI-0264; Vali 2026-10-31: „Schnelltest und Volltest“): Vorprüfung und Start nur mit einem Starter, der ihn kennt
 *   (`kenntVolltest`; ein älterer läse `--volltest` nicht und startete einen gewöhnlichen Lauf mit Notiz nach origin). Keine Freigabe, kein Beenden
 *   einer Freigabe: Ein Volltest berührt `refs/notes/release-auftrag` und `refs/notes/sammellauf` nie.
 */

/** Die Datenwurzel des Starters (`AVESMAPS_DATEN`, sonst `C:/avesmaps3d-data`): dort liegt der Werkzeugklon `release-werkzeug`. */
export const STANDARD_DATEN = "C:/avesmaps3d-data";

/** Der Ordner, in dem der Starter sein Protokoll und seine Startvermerke führt: `<Datenwurzel>/release-abholer`. */
export function ausgabeOrdnerPfad(env: NodeJS.ProcessEnv = process.env): string {
    return `${(env["AVESMAPS_DATEN"] ?? STANDARD_DATEN).replace(/[\\/]+$/u, "")}/release-abholer`;
}

/** Der Starter im Werkzeugklon, wie der Starter selbst ihn findet: `<Datenwurzel>/release-werkzeug/scripts/dev/release-abholer.ts`. */
export function klonStarterPfad(env: NodeJS.ProcessEnv = process.env): string {
    return `${(env["AVESMAPS_DATEN"] ?? STANDARD_DATEN).replace(/[\\/]+$/u, "")}/release-werkzeug/scripts/dev/release-abholer.ts`;
}

/** Der Starter dieses Checkouts: er legt den Werkzeugklon an, wenn er fehlt. */
export const EIGENER_STARTER = fileURLToPath(new URL("../../../../scripts/dev/release-abholer.ts", import.meta.url));

/** Wie lange eine Abfrage höchstens dauert (Notizen holen, Stand lesen). */
const LESEN_GRENZE_MS = 60_000;
/** Der Kandidat ändert sich selten; Notizen holen kostet einen Aufruf von Git gegen GitHub. */
const KANDIDAT_GUELTIG_MS = 60_000;
const AUSGABE_MAX = 8 * 1024 * 1024;

/** Die Umgebungsvariablen, die das Kind bekommt: das System und die Orte der Werkzeuge. Namen ohne Rücksicht auf die Schreibweise (Windows). */
const KIND_UMGEBUNG = new Set(
    [
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "SYSTEMDRIVE",
        "WINDIR",
        "COMSPEC",
        "OS",
        "USERPROFILE",
        "USERNAME",
        "USERDOMAIN",
        "HOME",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "PROGRAMW6432",
        "COMMONPROGRAMFILES",
        "COMMONPROGRAMFILES(X86)",
        "COMMONPROGRAMW6432",
        "TEMP",
        "TMP",
        "TMPDIR",
        "COMPUTERNAME",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
        "LANG",
        "LC_ALL",
        // Die Orte der Werkzeuge des Release-Tests.
        "AVESMAPS_DATEN",
        "PG_BIN_DIR",
        "MARTIN_BIN",
        "MARTIN_POOL_SIZE",
        "PLAYWRIGHT_BROWSERS_PATH",
    ].map((name) => name.toUpperCase()),
);

/** Die Umgebung des Kindes: nur erlaubte Namen aus `quelle`. */
export function kindUmgebung(quelle: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const aus: NodeJS.ProcessEnv = {};
    for (const [name, wert] of Object.entries(quelle)) {
        if (wert !== undefined && KIND_UMGEBUNG.has(name.toUpperCase())) aus[name] = wert;
    }
    return aus;
}

export interface StarterAntwort {
    readonly code: number | null;
    readonly stdout: string;
}

/** Ruft den Starter auf. Wirft, wenn der Prozess nicht startet oder die Zeitgrenze erreicht ist. Tests ersetzen den Aufruf. */
export type StarterAusfuehrer = (
    starter: string,
    argumente: readonly string[],
    grenzeMs: number,
) => Promise<StarterAntwort>;

/** Der echte Aufruf: `node <starter> <argumente>` ohne Shell, mit der bereinigten Umgebung; nach der Zeitgrenze wird der Starter beendet. */
export const standardAusfuehrer: StarterAusfuehrer = (starter, argumente, grenzeMs) =>
    new Promise((fertig, fehler) => {
        const kind = spawn(process.execPath, [starter, ...argumente], {
            env: kindUmgebung(),
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
        });
        const teile: Buffer[] = [];
        let groesse = 0;
        kind.stdout.on("data", (teil: Buffer) => {
            groesse += teil.length;
            if (groesse <= AUSGABE_MAX) teile.push(teil);
        });
        const uhr = setTimeout(() => {
            kind.kill();
            fehler(new Error("Zeitgrenze des Starters erreicht"));
        }, grenzeMs);
        kind.once("error", (e) => {
            clearTimeout(uhr);
            fehler(e);
        });
        kind.once("close", (code) => {
            clearTimeout(uhr);
            fertig({ code, stdout: Buffer.concat(teile).toString("utf8") });
        });
    });

/** Die letzte nicht leere Zeile als JSON-Objekt; `undefined`, wenn sie keines ist (ein älterer Starter schreibt Text). */
export function letztesJson(text: string): Record<string, unknown> | undefined {
    const zeile = text
        .split(/\r?\n/)
        .map((z) => z.trim())
        .filter((z) => z !== "")
        .at(-1);
    if (zeile === undefined || !zeile.startsWith("{")) return undefined;
    try {
        const wert: unknown = JSON.parse(zeile);
        return typeof wert === "object" && wert !== null && !Array.isArray(wert)
            ? (wert as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

const fachfehler = (code: ReleaseTestErrorCode, text: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(RELEASE_TEST_ERROR_STATUS[code], code, text, details);

/** Startet den Starter als eigenen, abgelösten Prozess mit der Ausgabe in `ausgabeDatei`. Tests ersetzen den Aufruf. */
export type StarterAbloeser = (starter: string, argumente: readonly string[], ausgabeDatei: string) => AbgeloesterStart;

/** Der echte Aufruf: `node <starter> <argumente>` abgelöst, mit der bereinigten Umgebung, Ausgabe in eine Datei. */
export const standardAbloeser: StarterAbloeser = (starter, argumente, ausgabeDatei) =>
    starteAbgeloest(process.execPath, [starter, ...argumente], { ausgabeDatei, env: kindUmgebung() });

export interface StarterZugangOptionen {
    /** Der Starter aus der Konfiguration (`RELEASE_TEST_STARTER`); ohne ihn gilt der Werkzeugklon, dann dieser Checkout. */
    readonly starter: string | undefined;
    readonly ausfuehren?: StarterAusfuehrer;
    /** Gibt es diese Datei? Tests ersetzen die Prüfung. */
    readonly existiert?: (pfad: string) => boolean;
    readonly warn?: (meldung: string) => void;
    readonly klonStarter?: string;
    readonly eigenerStarter?: string;
}

/** Eine Antwort des Starters: die JSON-Zeile und welcher Starter sie gab, oder warum keiner antwortete. */
export type StarterAntwortWert =
    { readonly wert: Record<string, unknown>; readonly starter: string } | { readonly fehler: string };

/** Der Zugang zu den Startern: Server und Ausführer fragen sie auf dieselbe Weise. */
export interface StarterZugang {
    /**
     * Fragt die Starter der Reihe nach, bis einer eine JSON-Zeile liefert. Ein älterer Starter schreibt Text; dann kommt der nächste dran.
     * Mit `bevorzugt` zählt die erste Antwort, die es erfüllt; liefert keiner eine solche, gilt die erste lesbare. Wirft nicht.
     */
    frage(
        argumente: readonly string[],
        grenzeMs?: number,
        bevorzugt?: (wert: Record<string, unknown>) => boolean,
    ): Promise<StarterAntwortWert>;
    /** Der Stand des jüngsten Laufs (`--stand --json`), mit dem Startvorgang darin; wirft nicht. */
    lauf(): Promise<{ readonly lauf: ReleaseTestLauf | null; readonly fehler: string | null }>;
    /** Fragt genau diesen Starter (den, der die Vorprüfung beantwortet hat). Wirft nicht. */
    frageBei(starter: string, argumente: readonly string[], grenzeMs?: number): Promise<StarterAntwortWert>;
}

export function createStarterZugang(optionen: StarterZugangOptionen): StarterZugang {
    const ausfuehren = optionen.ausfuehren ?? standardAusfuehrer;
    const existiert = optionen.existiert ?? existsSync;
    const warn = optionen.warn ?? ((): void => undefined);
    const klonStarter = optionen.klonStarter ?? klonStarterPfad();
    const eigenerStarter = optionen.eigenerStarter ?? EIGENER_STARTER;

    /** Die Starter in der Reihenfolge, in der sie gefragt werden. */
    function starterListe(): string[] {
        const liste =
            optionen.starter !== undefined && optionen.starter !== ""
                ? [optionen.starter]
                : [klonStarter, eigenerStarter];
        return [...new Set(liste)].filter((pfad) => existiert(pfad));
    }

    async function frage(
        argumente: readonly string[],
        grenzeMs = LESEN_GRENZE_MS,
        bevorzugt?: (wert: Record<string, unknown>) => boolean,
    ): Promise<StarterAntwortWert> {
        const liste = starterListe();
        if (liste.length === 0) return { fehler: "Der Starter des Release-Tests wurde nicht gefunden." };
        let grund = "Der Starter lieferte keine lesbare Antwort.";
        let erste: { readonly wert: Record<string, unknown>; readonly starter: string } | undefined;
        for (const starter of liste) {
            try {
                const antwort = await ausfuehren(starter, argumente, grenzeMs);
                const wert = letztesJson(antwort.stdout);
                if (wert !== undefined) {
                    if (bevorzugt === undefined || bevorzugt(wert)) return { wert, starter };
                    erste ??= { wert, starter };
                    continue;
                }
                grund =
                    "Der Starter lieferte keine lesbare Antwort (zu alt? Der Werkzeugklon zieht beim nächsten Start nach).";
            } catch (e) {
                grund = `Der Starter ließ sich nicht aufrufen: ${e instanceof Error ? e.message : "unbekannter Fehler"}`;
            }
        }
        if (erste !== undefined) return erste;
        warn(grund);
        return { fehler: grund };
    }

    return {
        frage,
        async frageBei(starter, argumente, grenzeMs = LESEN_GRENZE_MS) {
            try {
                const wert = letztesJson((await ausfuehren(starter, argumente, grenzeMs)).stdout);
                return wert === undefined
                    ? { fehler: "Der Starter lieferte keine lesbare Antwort." }
                    : { wert, starter };
            } catch (e) {
                return {
                    fehler: `Der Starter ließ sich nicht aufrufen: ${e instanceof Error ? e.message : "unbekannter Fehler"}`,
                };
            }
        },
        async lauf() {
            const antwort = await frage(["--stand", "--json"]);
            if ("fehler" in antwort) return { lauf: null, fehler: antwort.fehler };
            const bereinigt = Value.Clean(ReleaseTestLauf, structuredClone(antwort.wert));
            return Value.Check(ReleaseTestLauf, bereinigt)
                ? { lauf: bereinigt, fehler: null }
                : { lauf: null, fehler: "Der Stand des Starters hatte eine unbekannte Form." };
        },
    };
}

/** Die Vorprüfung eines Starts bevorzugt einen Starter, der Startvermerke führt: Der Werkzeugklon kann älter sein als dieser Checkout. */
export const fuehrtStartvermerke = (wert: Record<string, unknown>): boolean => wert["startvermerk"] === true;

/**
 * Ein Starter, der die Freigabe kennt (WI-0248: `--freigabe`, `--freigeben`, `--freigabe-beenden`, `--bericht`). Ein älterer (der Werkzeugklon vor dem
 * nächsten Nachziehen) würde einen Lauf OHNE Kennung starten, dessen Grün nicht ausgeliefert wird; darum zählt beim Start nur seine Antwort.
 */
export const kenntFreigabe = (wert: Record<string, unknown>): boolean =>
    wert["freigabe"] === true && wert["startvermerk"] === true;

/** Ein Starter, der den Volltest kennt (WI-0264: `--volltest tor|voll`, nur Bericht). Nur mit ihm startet ein Volltest. */
export const kenntVolltest = (wert: Record<string, unknown>): boolean =>
    kenntFreigabe(wert) && wert["volltest"] === true;

/** Die Teile des Volltests (WI-0264): erst der Schnelltest (`tor`), dann der volle Lauf (`voll`). */
export type VolltestTeil = "tor" | "voll";

/**
 * Die Angaben des Starters für einen Start oder eine Wiederholung dieses Standes; `trocken` nur entscheiden; `freigabe` die Kennung der Freigabe;
 * `volltest` ein Teil des Volltests (nie zusammen mit `freigabe` oder `wiederholen`).
 */
export function startArgumente(
    commit: string,
    wiederholen: boolean,
    trocken: boolean,
    freigabe?: string,
    volltest?: VolltestTeil,
): string[] {
    if (volltest !== undefined && (freigabe !== undefined || wiederholen))
        throw new Error("Ein Volltest startet ohne Freigabe und ohne Wiederholung");
    return [
        wiederholen ? "--wiederholen" : "--commit",
        commit,
        ...(freigabe === undefined ? [] : ["--freigabe", freigabe]),
        ...(volltest === undefined ? [] : ["--volltest", volltest]),
        ...(trocken ? ["--trocken"] : []),
        "--json",
    ];
}

/** Die Kennung der Freigabe zu einem Auftrag `release_test`: `RT-` und seine öffentliche Kennung (dieselbe in Notiz, Nachweis und Protokoll). */
export const freigabeKennung = (auftragId: string): string => `RT-${auftragId}`;

/**
 * Startet den Starter abgelöst mit dem Commit (der eigentliche Start, nach einer Vorprüfung mit DEMSELBEN Starter). Die Ausgabe geht nach
 * `<ausgabeOrdner>/starter-<sha12>.log`. Wirft, wenn die Ausgabedatei nicht angelegt werden kann; `ende` lehnt ab, wenn der Prozess nicht startet.
 */
export function starteStarter(
    starter: string,
    commit: string,
    wiederholen: boolean,
    optionen: {
        readonly ausgabeOrdner?: string | undefined;
        readonly abloesen?: StarterAbloeser | undefined;
        readonly freigabe?: string | undefined;
        readonly volltest?: VolltestTeil | undefined;
    } = {},
): AbgeloesterStart {
    return (optionen.abloesen ?? standardAbloeser)(
        starter,
        startArgumente(commit, wiederholen, false, optionen.freigabe, optionen.volltest),
        join(optionen.ausgabeOrdner ?? ausgabeOrdnerPfad(), `starter-${commit.slice(0, 12)}.log`),
    );
}

/**
 * Schreibt die Freigabe (oder beendet sie) über den Starter (WI-0248). Antwortet nur ein Starter, der sie kennt, mit `geschrieben`, ist sie auf origin;
 * `unveraendert` heißt beim Beenden: An dem Stand steht schon eine andere oder keine Freigabe mehr. Wirft nicht; `fehler` mit Satz sonst.
 */
export async function schreibeFreigabeUeber(
    zugang: StarterZugang,
    argumente: readonly string[],
    starter?: string,
): Promise<{ readonly status: "geschrieben" | "unveraendert" | "fehler"; readonly grund: string }> {
    const voll = [...argumente, "--trocken", "--json"];
    const antwort =
        starter === undefined
            ? await zugang.frage(voll, LESEN_GRENZE_MS * 2, (w) => w["freigabe"] === true)
            : await zugang.frageBei(starter, voll, LESEN_GRENZE_MS * 2);
    if ("fehler" in antwort) return { status: "fehler", grund: antwort.fehler };
    const status = antwort.wert["status"];
    const grund = typeof antwort.wert["grund"] === "string" ? antwort.wert["grund"].slice(0, 300) : "";
    if (antwort.wert["freigabe"] !== true)
        return {
            status: "fehler",
            grund: "Kein Starter kennt die Freigabe (zu alt? Der Werkzeugklon zieht beim nächsten Start nach).",
        };
    if (status === "geschrieben" || status === "unveraendert") return { status, grund };
    return { status: "fehler", grund: grund === "" ? "Der Starter schrieb die Freigabe nicht." : grund };
}

/** Beendet die Freigabe eines Auftrags ohne grünes Ergebnis (Abbruch, gescheiterter Start, rot). Für Route und Ausführer. Wirft nicht. */
export function beendeFreigabe(
    zugang: StarterZugang,
    commit: string,
    kennung: string,
    grund: string,
): Promise<{ readonly status: "geschrieben" | "unveraendert" | "fehler"; readonly grund: string }> {
    return schreibeFreigabeUeber(zugang, [
        "--freigabe-beenden",
        commit,
        "--kennung",
        kennung,
        "--grund",
        grund.slice(0, 200),
    ]);
}

export interface ReleaseTestDienstOptionen extends StarterZugangOptionen {
    readonly jetzt?: () => number;
}

/** Das Ergebnis der Vorprüfung: Dieser Starter darf diesen Commit starten. Ein Schein, der einmal gilt (eingereiht) oder verworfen wird. */
export interface Startschein {
    readonly commit: string;
    readonly starter: string;
    /** „Rote Teile wiederholen“ (WI-0248): Der Starter übernimmt die grünen Teile des früheren Laufs derselben SHA. */
    readonly wiederholen: boolean;
    /** Die erwartete Dauer eines Laufs laut Starter (aus den früheren Läufen), in Sekunden; `null`: keine bekannt. */
    readonly erwartetS: number | null;
    /**
     * Der Stand ist schon grün geprüft (WI-0248): Der Druck gibt ihn trotzdem frei, ohne neuen Lauf (`release-freigabe.ts`: ein Grün von vor der
     * Freigabe wird ausgeliefert); der Auftrag endet gleich grün.
     */
    readonly schonGruen: boolean;
    /** Der Volltest (WI-0264): nur Bericht, keine Freigabe; der Starter kennt ihn (`kenntVolltest`). */
    readonly volltest: boolean;
}

export interface ReleaseTestDienst {
    /**
     * Die Sicht der Oberfläche: Kandidat, Stand des Laufs, laufender Start. Wirft nicht. Der Kandidat kommt aus dem Gedächtnis (bis zu einer Minute alt);
     * mit `frisch` werden die Notizen neu geholt: So liest die Karte unmittelbar vor einem Start, ob der Stand noch der ist, den sie zeigt. Den Auftrag in
     * der Warteschlange legt die Route dazu.
     */
    sicht(optionen?: { readonly frisch?: boolean }): Promise<ReleaseTestSicht>;
    /**
     * Die Vorprüfung eines Starts: Ist der Kandidat noch der, den die Oberfläche sah? Läuft nichts, ist der Stand nicht grün, hängt keine Sperre?
     * Dauert Sekunden (Notizen holen) und gehört darum VOR die Verwaltungshandlung, die einreiht. Wirft `ApiError` mit Fachcode.
     * Mit `wiederholen` zusätzlich: Gibt es einen früheren, nicht grünen Lauf dieses Standes auf dem Rechner (sonst `release_test_kein_roter_lauf`)?
     */
    pruefeStart(commit: string, wiederholen?: boolean, volltest?: boolean): Promise<Startschein>;
    /** Gibt den Schein zurück, ob er eingereiht wurde oder nicht: Die nächste Vorprüfung ist wieder möglich. */
    verwirf(schein: Startschein): void;
    /** Beendet den laufenden Test dieses Commits (Datei ABBRUCH im Ergebnisordner). Wirft `ApiError` mit Fachcode. */
    abbrechen(commit: string): Promise<void>;
    /**
     * Schreibt die Freigabe für genau diesen Stand mit der Person nach `refs/notes/release-auftrag` (WI-0248: der Start IST die Freigabe). Wirft
     * `ApiError` `release_test_freigabe`, wenn sie nicht auf origin steht; dann startet auch kein Test.
     */
    freigeben(schein: Startschein, kennung: string, von: string): Promise<void>;
    /** Beendet die Freigabe ohne Grün (Abbrechen). Wirft nicht; was geschah, steht im Ergebnis. */
    freigabeBeenden(
        commit: string,
        kennung: string,
        grund: string,
    ): Promise<{ readonly status: "geschrieben" | "unveraendert" | "fehler"; readonly grund: string }>;
    /** Der eine Bericht eines Laufs (`bericht.md`); ohne `commit` der des jüngsten Laufs. Wirft `ApiError` mit Fachcode. */
    bericht(
        commit?: string,
    ): Promise<{ readonly commit: string; readonly text: string; readonly ordner: string | null }>;
}

/** Der Lauf ohne den Startvorgang: Die Oberfläche bekommt ihn als `start` neben dem Lauf, nicht darin. */
function ohneStartvorgang(lauf: ReleaseTestLauf): ReleaseTestLauf {
    const kopie = { ...lauf };
    delete kopie.startvorgang;
    return kopie;
}

export function createReleaseTestDienst(optionen: ReleaseTestDienstOptionen): ReleaseTestDienst {
    const jetzt = optionen.jetzt ?? Date.now;
    const zugang = createStarterZugang(optionen);
    const { frage } = zugang;

    /** Eine Vorprüfung, ein offener Schein oder ein Abbruch ist unterwegs: kein zweiter Aufruf gleichzeitig. */
    let beschaeftigt = false;
    let offenerSchein: Startschein | null = null;
    let kandidatCache: {
        readonly bis: number;
        readonly antwort: ReleaseTestSicht["kandidat"];
        readonly fehler: string | null;
    } | null = null;

    async function ladeKandidat(
        frisch: boolean,
    ): Promise<{ kandidat: ReleaseTestSicht["kandidat"]; fehler: string | null }> {
        const t = jetzt();
        if (!frisch && kandidatCache !== null && kandidatCache.bis > t)
            return { kandidat: kandidatCache.antwort, fehler: kandidatCache.fehler };
        // `--trocken` schützt vor einem alten Starter, der `--kandidat` nicht kennt und sonst einen Test starten würde.
        const antwort = await frage(["--kandidat", "--trocken", "--json"]);
        let ergebnis: { kandidat: ReleaseTestSicht["kandidat"]; fehler: string | null };
        if ("fehler" in antwort) ergebnis = { kandidat: null, fehler: antwort.fehler };
        else if (typeof antwort.wert["fehler"] === "string")
            ergebnis = {
                kandidat: null,
                fehler: `Die Notizen ließen sich nicht lesen: ${antwort.wert["fehler"].slice(0, 200)}`,
            };
        else {
            const bereinigt = Value.Clean(ReleaseTestKandidat, structuredClone(antwort.wert));
            ergebnis = Value.Check(ReleaseTestKandidat, bereinigt)
                ? { kandidat: bereinigt, fehler: null }
                : { kandidat: null, fehler: "Der Kandidat des Starters hatte eine unbekannte Form." };
        }
        // Nur ein gelesener Kandidat wird gemerkt; ein Fehler wird beim nächsten Aufruf neu versucht.
        kandidatCache =
            ergebnis.fehler === null
                ? { bis: t + KANDIDAT_GUELTIG_MS, antwort: ergebnis.kandidat, fehler: null }
                : null;
        return ergebnis;
    }

    return {
        async sicht(optionen = {}) {
            const [k, l] = await Promise.all([ladeKandidat(optionen.frisch === true), zugang.lauf()]);
            return {
                now: new Date(jetzt()).toISOString(),
                verfuegbar: l.lauf !== null,
                fehler: l.fehler ?? k.fehler,
                kandidat: k.kandidat,
                lauf: l.lauf === null ? null : ohneStartvorgang(l.lauf),
                // Ein gelungener Start steht im Ergebnisordner des Runners; `start` gilt nur für die Zeit davor und für Fehler.
                start: l.lauf?.startvorgang ?? null,
            };
        },

        async pruefeStart(commit, wiederholen = false, volltest = false) {
            if (volltest && wiederholen)
                throw new ApiError(400, "validation_failed", "Ein Volltest wiederholt keine roten Teile.");
            if (beschaeftigt)
                throw fachfehler("release_test_laeuft", "Es läuft schon ein Start oder ein Release-Test.");
            beschaeftigt = true;
            let schein: Startschein | undefined;
            try {
                const k = await ladeKandidat(true);
                if (k.kandidat === null)
                    throw fachfehler("release_test_fehler", "Der Kandidat ließ sich nicht lesen.", { grund: k.fehler });
                if (
                    commit !== k.kandidat.stage?.sha &&
                    commit !== k.kandidat.freigabe?.sha &&
                    commit !== k.kandidat.auftrag?.sha
                )
                    throw fachfehler(
                        "release_test_stale",
                        "Der Kandidat hat sich seitdem bewegt. Bitte die Karte neu laden.",
                        {
                            kandidat: releaseTestCommit(k.kandidat),
                        },
                    );
                // Die Vorprüfung entscheidet nur (Sperre, grüner Stand, Klon); sie baut nichts und startet nichts. 🔴 Sie fragt bevorzugt einen Starter,
                // der die Freigabe kennt (WI-0248): Mit ihm startet der Ausführer später den Lauf, und nur dann trägt der Nachweis die Kennung.
                // Der Volltest fragt mit Teil 1 (`--volltest tor`) und nur einen Starter, der ihn kennt (WI-0264).
                const kennt = volltest ? kenntVolltest : kenntFreigabe;
                const vor = await frage(
                    startArgumente(commit, wiederholen, true, undefined, volltest ? "tor" : undefined),
                    LESEN_GRENZE_MS * 2,
                    kennt,
                );
                if ("fehler" in vor) throw fachfehler("release_test_unavailable", vor.fehler);
                if (!kennt(vor.wert))
                    throw fachfehler(
                        "release_test_unavailable",
                        volltest
                            ? "Kein Starter kennt den Volltest (zu alt? Den Hauptcheckout nachziehen oder den Werkzeugklon)."
                            : "Kein Starter kennt die Freigabe (zu alt? Den Hauptcheckout nachziehen oder den Werkzeugklon).",
                    );
                const status = vor.wert["status"];
                const grund = typeof vor.wert["grund"] === "string" ? vor.wert["grund"].slice(0, 300) : "";
                // Schon grün (WI-0248): kein neuer Lauf, aber der Druck gibt den Stand frei; ausgeliefert wird das vorhandene Grün dieser SHA.
                const schonGruen = status === "gruen" && !wiederholen && !volltest;
                if (status === "gruen" && wiederholen)
                    throw fachfehler("release_test_gruen", "Dieser Stand ist schon grün geprüft.", { grund });
                if (status === "laeuft")
                    throw fachfehler("release_test_laeuft", "Es läuft schon ein Release-Test.", { grund });
                if (status === "sperre-ohne-prozess")
                    throw fachfehler("release_test_sperre", "Eine Sperre ohne lebenden Prozess hält den Start an.", {
                        grund,
                    });
                if (status === "kein-roter-lauf")
                    throw fachfehler(
                        "release_test_kein_roter_lauf",
                        "Für diesen Stand gibt es keinen früheren Lauf, der nicht grün ist; nichts zu wiederholen.",
                        { grund },
                    );
                if (status !== "trocken" && !schonGruen)
                    throw fachfehler("release_test_fehler", "Der Starter nimmt den Start nicht an.", { grund });
                // Die erwartete Dauer nennt der Stand (aus den früheren Läufen); sie wird die Schätzung des Auftrags.
                const l = await zugang.lauf();
                const erwartetMs = l.lauf?.erwartetMs ?? 0;
                schein = {
                    commit,
                    starter: vor.starter,
                    wiederholen,
                    // Der Volltest dauert zwei Läufe, deren zweiter keine gemessene Dauer hat: keine Schätzung, statt einer falschen.
                    erwartetS: volltest
                        ? null
                        : schonGruen
                          ? 60
                          : erwartetMs > 0
                            ? Math.round(erwartetMs / 1000)
                            : null,
                    schonGruen,
                    volltest,
                };
                offenerSchein = schein;
                return schein;
            } finally {
                // Ohne Schein (ein Fehler) ist nichts mehr unterwegs; mit Schein hält `offenerSchein` die Tür zu, bis er verworfen wird.
                if (schein === undefined) beschaeftigt = false;
            }
        },

        verwirf(schein) {
            if (offenerSchein !== schein) return;
            offenerSchein = null;
            beschaeftigt = false;
            kandidatCache = null;
        },

        async abbrechen(commit) {
            if (beschaeftigt) throw fachfehler("release_test_laeuft", "Ein Start oder Abbruch ist gerade unterwegs.");
            beschaeftigt = true;
            try {
                // `--trocken` schützt vor einem alten Starter, der `--abbrechen` nicht kennt und sonst einen Test starten würde.
                const antwort = await frage(["--abbrechen", commit, "--trocken", "--json"]);
                if ("fehler" in antwort) throw fachfehler("release_test_unavailable", antwort.fehler);
                const status = antwort.wert["status"];
                const grund = typeof antwort.wert["grund"] === "string" ? antwort.wert["grund"].slice(0, 300) : "";
                if (status === "abbruch-angefordert") return;
                if (status === "kein-lauf")
                    throw fachfehler("release_test_kein_lauf", "Für diesen Stand läuft kein Release-Test.", { grund });
                throw fachfehler("release_test_fehler", "Der Abbruch ließ sich nicht anfordern.", { grund });
            } finally {
                beschaeftigt = false;
            }
        },

        async freigeben(schein, kennung, von) {
            // Derselbe Starter wie in der Vorprüfung: Er kennt die Freigabe (`kenntFreigabe`), und ein älterer wird nicht erst gefragt.
            const ergebnis = await schreibeFreigabeUeber(
                zugang,
                ["--freigeben", schein.commit, "--kennung", kennung, "--von", von],
                schein.starter,
            );
            // Die Freigabe ist danach eine andere: Der Kandidat wird beim nächsten Blick neu gelesen.
            kandidatCache = null;
            if (ergebnis.status !== "geschrieben")
                throw fachfehler(
                    "release_test_freigabe",
                    "Die Freigabe ließ sich nicht nach origin schreiben; nichts gestartet.",
                    { grund: ergebnis.grund },
                );
        },

        async freigabeBeenden(commit, kennung, grund) {
            const ergebnis = await beendeFreigabe(zugang, commit, kennung, grund);
            kandidatCache = null;
            return ergebnis;
        },

        async bericht(commit) {
            const antwort = await frage(
                ["--bericht", ...(commit === undefined ? [] : [commit]), "--trocken", "--json"],
                LESEN_GRENZE_MS,
                (w) => w["status"] === "bericht" || w["status"] === "kein-bericht",
            );
            if ("fehler" in antwort) throw fachfehler("release_test_unavailable", antwort.fehler);
            const w = antwort.wert;
            if (w["status"] !== "bericht" || typeof w["text"] !== "string" || typeof w["sha"] !== "string")
                throw fachfehler(
                    "release_test_kein_bericht",
                    "Für diesen Stand gibt es keinen Bericht.",
                    typeof w["grund"] === "string" ? { grund: w["grund"].slice(0, 300) } : undefined,
                );
            return {
                commit: w["sha"],
                text: w["text"],
                ordner: typeof w["ordner"] === "string" ? w["ordner"] : null,
            };
        },
    };
}
