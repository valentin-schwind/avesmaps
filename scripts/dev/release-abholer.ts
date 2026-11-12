// Der Starter des Release-Tests auf dem Entwicklungsrechner (WI-0248 R2, WI-0228 D).
//
//   node scripts/dev/release-abholer.ts --commit <sha40>      ausdrücklicher Start für genau diesen Commit
//   node scripts/dev/release-abholer.ts --wiederholen <sha40> rote Teile wiederholen (WI-0248): derselbe Stand, die grünen Teile des früheren Laufs
//                                                              werden übernommen, wenn die Umgebung dieselbe ist; nur rote oder fehlende laufen neu
//   node scripts/dev/release-abholer.ts                        ohne --commit: der jüngste offene Auftrag aus refs/notes/release-auftrag
//   node scripts/dev/release-abholer.ts --stand [<sha40>]      nur lesen: Stand des jüngsten (oder dieses) Laufs
//   node scripts/dev/release-abholer.ts --kandidat --json     nur lesen: jüngster Stage-Stand und jüngster Auftrag aus den Notizen (holt nur Notizen)
//   node scripts/dev/release-abholer.ts --abbrechen <sha40>   legt im laufenden Ergebnisordner die Datei ABBRUCH an (der Runner beendet dann alles selbst)
//   node scripts/dev/release-abholer.ts --bericht [<sha40>]   nur lesen: der eine Bericht des Laufs (`bericht.md`, `release-seite.ts`, WI-0248)
//
// 🔴 Die Freigabe (WI-0248; Vali 2026-10-26: „Nein das passiert automatisch, sobald der test grün war“): Der Start in der lokalen Systemsteuerung IST
// die Production-Freigabe. Nur der lokale Server ruft dafür, mit dem Passkey des Betreibers:
//   --freigeben <sha40> --kennung RT-<uuid> --von <Name>              schreibt die Freigabe nach refs/notes/release-auftrag (`release-freigabe.ts`)
//   --commit <sha40> --freigabe RT-<uuid>                             startet den Lauf dieser Freigabe (die Kennung geht in den Nachweis)
//   --freigabe-beenden <sha40> --kennung RT-<uuid> --grund <Satz>     beendet sie ohne Grün (Abbruch, gescheiterter Start, rot)
// Ein Start von Hand (ohne `--freigabe`) prüft nur; sein Grün geht nicht von selbst nach Production.
//
// 🔴 Der Volltest (WI-0264; Vali 2026-10-31: „Schnelltest und Volltest“): Der Ausführer der Warteschlange startet ihn in zwei Teilen nacheinander,
//   --commit <sha40> --volltest tor      Teil 1: der Schnelltest (Profil `tor`), nur Bericht
//   --commit <sha40> --volltest voll     Teil 2: der volle Lauf (Profil `voll`), nur Bericht, mit dem Bericht von Teil 1 auf seiner Seite
// Beide laufen auch für einen grün geprüften Stand (der frühere Ordner wird umbenannt), schreiben keine Notiz nach origin und liefern nie aus; ein
// grüner Lauf des Volltests zählt umgekehrt nie als grün geprüfter Stand eines Schnelltests.
//   weitere Angaben: --trocken (nur entscheiden), --daten <Datenwurzel>, --klon <Werkzeugklon>, --json (Ergebnis als EINE JSON-Zeile, für die
//   lokale Systemsteuerung; die Ausgabe ohne --json bleibt unverändert)
//
// 🔴 Betreiberentscheidung (Vali, 2026-10-23): Keine geplante Windows-Aufgabe. Den Release-Test löst der Betreiber ausdrücklich aus (mit dem
// Knopf der lokalen Systemsteuerung, WI-0248 L, oder mit diesem Befehl). Die Datei ist ein einmaliger Starter, kein Dauerprozess: Sie ist in
// Sekunden fertig, startet höchstens den Runner unabhängig und endet mit einer Zeile (gestartet und Pfad der status.json, oder der Grund,
// warum nicht). Der lokale Server ruft sie als eigenen Prozess auf (`--json`); die Logik steht in `starteReleaseTest`, `releaseTestStand` und
// `releaseTestAnsicht` (Schritte, Dauer, Bericht: `release-bericht.ts`).
//
// Ablauf von `starteReleaseTest`:
//   1. Werkzeugklon (`C:\avesmaps3d-data\release-werkzeug`) anlegen, falls er fehlt (git clone der Remote des aufrufenden Repositorys).
//      Der Befehl ist deshalb aus jedem Checkout aufrufbar, der diese Datei hat; alles Weitere geschieht im Klon, nicht im Hauptcheckout,
//      dessen Stand unter den Sitzungen wechselt.
//   2. Ohne `commit`: `refs/notes/release-auftrag` von Origin holen und den jüngsten gültigen `auftrag` wählen (ein `abgebrochen` für denselben
//      Commit gewinnt); gibt es keinen, endet der Aufruf mit einem klaren Satz. Das Ergebnis des Commits kommt aus `refs/notes/sammellauf`.
//   3. Nichts tun, wenn der Commit schon grün geprüft ist oder irgendein Lauf aktiv ist (`.release-runs/aktiv`). Eine Sperre ohne lebenden
//      Prozess wird gemeldet, aber nie entsperrt.
//   4. Sonst: den Klon nachziehen (nur ohne aktiven Lauf), das Testpaket bauen (`release-fixtures.ts`), einen früheren nicht grünen Lauf derselben
//      SHA nach `.release-runs/<sha>-<Start>` umbenennen (abgeräumt wird erst beim Start des Runners, `release-aufraeumen.ts`), den Runner unabhängig starten (`release-start.ps1`).
//
// 🔴 Der Startvermerk (WI-0248 L, Fehlerbehebung 2026-10-23): Der Start dauert Minuten (Testpaket bauen) und der Starter läuft als eigener, vom
// aufrufenden Server abgelöster Prozess (der Server startet ihn `detached`; unter Windows hängt sonst jedes Kind an der Prozessgruppe des Servers
// und stirbt mit ihm, auch beim Neustart von `node --watch`). Sein Stand steht deshalb nicht im Speicher des Servers, sondern in einer Datei:
// `<Datenwurzel>\release-abholer\start\<sha>.json` (`baut` mit der Prozessnummer des Starters, dann `gestartet` oder `fehler` mit dem Grund).
// `releaseTestAnsicht` liest sie (`startvorgang`); ein `baut` ohne lebenden Starter gilt als gescheitert. Ein zweiter Start neben einem lebenden
// `baut` wird abgewiesen (Status `laeuft`).
//
// Nur Node-Bordmittel; weder dieser Starter noch Runner, Testpaket und Auswertung brauchen im Klon ein `npm install`.
// Protokoll: `<Datenwurzel>\release-abholer\abholer.log` (eine Zeile je Handlung).
import { execFileSync, spawnSync } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    BROWSER_SCHRITTE,
    baueFehlerBericht,
    baueTeileAnsicht,
    berechneFortschritt,
    erwarteteDauern,
    erwarteteFaelle,
    istSchrittId,
    leseProfil,
    leseSchrittzeiten,
    leseTeileStatus,
    RELEASE_SCHRITTE,
    schritteAusFehlerText,
    schritteJeProfil,
    type FehlerBericht,
    type Fortschritt,
    type SchrittId,
    type TeilAnsicht,
} from "./release-bericht.ts";
import { gibSperreFrei } from "./release-ende.ts";
import {
    abbruchNotiz,
    entscheideFreigabe,
    freigabeNotiz,
    KENNUNG_MUSTER,
    parseFreigabe,
    unterschreibeNotiz,
    waehleFreigabe,
    type FreigabeZustand,
} from "./release-freigabe.ts";
import { bereinigeGrund } from "./release-grund.ts";
import { leseLaufBuch, type LaufBuch, type LaufBuchWiederholung } from "./release-laufbuch.ts";
import { releaseAusNotiz, releaseProzess } from "./release-nachweis.ts";
import { fingerprint } from "./release-pruefsumme.ts";
import { leseBerichtSeite, OFFEN_QUELLE } from "./release-seite.ts";
import { leseTeileDatei } from "./release-teile.ts";
import { laeufeFuer, uebernehmbareTeile, type AltLauf } from "./release-wiederholen.ts";
import { stageAusNotiz } from "./sammellauf-auswertung.ts";

export const STANDARD_DATEN = "C:/avesmaps3d-data";
/** Die Remote, wenn das aufrufende Repository keine kennt. */
export const STANDARD_REMOTE = "https://github.com/valentin-schwind/avesmaps3D.git";
/** Obergrenze für einen Aufruf von der Kommandozeile; der Runner läuft davon unabhängig weiter. */
export const START_GRENZE_MS = 20 * 60_000;
const FIXTURES_GRENZE_MS = 15 * 60_000;
const STATUS_WARTE_MS = 60_000;

// ───────────────────────── Reine Teile: Notizen lesen, wählen, entscheiden ─────────────────────────

export interface Auftrag {
    readonly sha: string;
    readonly zeit: string;
    readonly ops: string;
}
export interface AuftragsZeile extends Auftrag {
    readonly art: "auftrag" | "abgebrochen";
}

const AUFTRAG_ZEILE =
    /^([0-9a-f]{40}) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z) (auftrag|abgebrochen) (OPS-\d{6,})$/;

/** Die ERSTE Zeile einer Notiz in `refs/notes/release-auftrag`, streng: `<sha40> <ISO-Zeit UTC> auftrag|abgebrochen <OPS-ID>`. */
export function parseAuftragsNotiz(text: string): AuftragsZeile | undefined {
    const erste = text.split("\n", 1)[0]?.replace(/\r$/, "") ?? "";
    const treffer = AUFTRAG_ZEILE.exec(erste);
    if (treffer === null) return undefined;
    const [, sha, zeit, art, ops] = treffer;
    if (sha === undefined || zeit === undefined || ops === undefined) return undefined;
    if (!Number.isFinite(Date.parse(zeit))) return undefined;
    return { sha, zeit, ops, art: art === "abgebrochen" ? "abgebrochen" : "auftrag" };
}

/**
 * Der jüngste gültige Auftrag. `objekt` ist der Commit, an dem die Notiz hängt: Nennt die Zeile einen anderen, ist sie ungültig. Ein
 * `abgebrochen` für einen Commit gewinnt gegen jeden `auftrag` desselben Commits. Kaputte Zeilen zählen nicht und stören nichts.
 */
export function waehleAuftrag(
    notizen: readonly { readonly objekt: string; readonly text: string }[],
): Auftrag | undefined {
    const zeilen: AuftragsZeile[] = [];
    for (const n of notizen) {
        const z = parseAuftragsNotiz(n.text);
        if (z !== undefined && z.sha === n.objekt) zeilen.push(z);
    }
    const abgebrochen = new Set(zeilen.filter((z) => z.art === "abgebrochen").map((z) => z.sha));
    const offen = zeilen.filter((z) => z.art === "auftrag" && !abgebrochen.has(z.sha));
    offen.sort((a, b) => Date.parse(b.zeit) - Date.parse(a.zeit) || (a.sha < b.sha ? 1 : -1));
    const erster = offen[0];
    return erster === undefined ? undefined : { sha: erster.sha, zeit: erster.zeit, ops: erster.ops };
}

export type ErgebnisStatus = "gruen" | "rot" | "offen";

/**
 * Das Urteil in einer Notiz von `refs/notes/sammellauf`: erste Zeile `<sha40> <ISO-Zeit> gruen|rot|offen`. Zwei Einschränkungen:
 *  - Notizen des früheren periodischen Sammellaufs (zweite Zeile „Sammellauf (WI-0228)…“) sind kein Ergebnis eines Release-Laufs.
 *  - `gruen` zählt nur als gültiger Nachweis Version 3 (derselbe Leser wie bei Claudio); ein unlesbares Grün stoppt keinen neuen Lauf.
 */
export function parseErgebnisNotiz(text: string, sha: string): ErgebnisStatus | undefined {
    return leseErgebnisNotiz(text, sha)?.status;
}

export interface ErgebnisNotiz {
    readonly status: ErgebnisStatus;
    /** Die Zeit der ersten Zeile (Ende des Laufs, Uhr des Rechners), in Millisekunden. */
    readonly zeit: number;
}

/** Wie `parseErgebnisNotiz`, mit der Zeit der Notiz. */
export function leseErgebnisNotiz(text: string, sha: string): ErgebnisNotiz | undefined {
    const zeilen = text.trim().split(/\r?\n/);
    const treffer = /^([0-9a-f]{40}) (\d{4}-\d{2}-\d{2}T[0-9:.]+Z) (gruen|rot|offen)$/.exec(zeilen[0] ?? "");
    if (treffer === null || treffer[1] !== sha) return undefined;
    const zeit = Date.parse(treffer[2] ?? "");
    if (!Number.isFinite(zeit)) return undefined;
    if ((zeilen[1] ?? "").startsWith("Sammellauf (WI-0228)")) return undefined;
    const status = treffer[3];
    if (status === "gruen") return releaseAusNotiz(text, sha) === undefined ? undefined : { status: "gruen", zeit };
    return { status: status === "rot" ? "rot" : "offen", zeit };
}

/** Der frühere Lauf zu einer SHA, soweit er sich feststellen lässt. */
export interface VorigerLauf {
    /** Sein Start in Millisekunden (für den Namen des verschobenen Ordners). */
    readonly start: number;
    /** Der Lauf war grün und hat sein Urteil nach origin geschrieben (ein grüner Lauf des Volltests zählt nicht: Er schrieb keine Notiz). */
    readonly gruen: boolean;
    /** Ein Lauf des Volltests (`nurBericht` in `status.json`, WI-0264). Fehlt bei Läufen aus der Zeit davor. */
    readonly nurBericht?: boolean;
    /** Das Prüfprofil laut `status.json`. */
    readonly profil?: string;
}

export interface Eingabe {
    /** Das Urteil auf Origin (`refs/notes/sammellauf`) für diese SHA. */
    readonly ergebnis: ErgebnisStatus | undefined;
    /** `.release-runs/<sha>` besteht schon: Es gab einen Lauf (oder einen Startversuch). */
    readonly laufOrdner: boolean;
    /** `.release-runs/aktiv` besteht: Ein Lauf ist aktiv oder abgestürzt. */
    readonly sperre: boolean;
    /** Der frühere Lauf (aus `.release-runs/<sha>`, ohne Ordner aus der roten Ergebnisnotiz); `undefined`, wenn keiner feststellbar ist. */
    readonly vorigerLauf?: VorigerLauf | undefined;
    /** Ein Teil des Volltests (WI-0264): Er prüft auch einen grün geprüften Stand, nur die Sperre hält ihn an. */
    readonly volltest?: boolean;
}
export type Entscheidung =
    | {
          readonly aktion: "starten";
          /** Es gab schon einen nicht grünen Lauf zu dieser SHA: Der ausdrückliche Start ersetzt ihn, sein Ordner wird umbenannt. */
          readonly neuerVersuch: boolean;
      }
    | { readonly aktion: "nichts"; readonly grund: "gruen" | "sperre" };

/**
 * Wann startet ein ausdrücklich ausgelöster Lauf? Nie, wenn die SHA grün ist (Urteil auf Origin oder grüner Lauf-Ordner), nie neben einem
 * aktiven Lauf (Sperre, auch der einer anderen SHA). Sonst immer: Auch nach Rot, Abbruch oder Zeitüberschreitung ist ein ausdrücklicher Start
 * ein neuer Versuch; der alte Ergebnisordner bleibt unter neuem Namen erhalten.
 */
export function entscheide(e: Eingabe): Entscheidung {
    // Der Volltest (WI-0264) will gerade auch den grün geprüften Stand vollständig sehen; ein früherer Ordner der SHA wird umbenannt.
    if (e.volltest === true)
        return e.sperre ? { aktion: "nichts", grund: "sperre" } : { aktion: "starten", neuerVersuch: e.laufOrdner };
    if (e.ergebnis === "gruen" || e.vorigerLauf?.gruen === true) return { aktion: "nichts", grund: "gruen" };
    if (e.sperre) return { aktion: "nichts", grund: "sperre" };
    return { aktion: "starten", neuerVersuch: e.laufOrdner || e.ergebnis === "rot" };
}

/** `20261023T101500Z` aus Millisekunden: der Zeitanteil im Namen eines verschobenen Laufordners. */
export function kompakteZeit(ms: number): string {
    return new Date(ms)
        .toISOString()
        .replace(/\.\d+Z$/, "Z")
        .replace(/[-:]/g, "");
}

/** Liest den früheren Lauf aus seinem Ordner (`status.json` des Runners); ohne lesbaren Status gilt er als nicht grün. */
export function leseVorigenLauf(ordner: string): VorigerLauf {
    let status: { status?: unknown; start?: unknown; nurBericht?: unknown; profil?: unknown } = {};
    try {
        const roh: unknown = JSON.parse(readFileSync(join(ordner, "status.json"), "utf8"));
        if (typeof roh === "object" && roh !== null) status = roh as typeof status;
    } catch {
        /* Kein lesbarer Status: Der Lauf ist nicht grün. */
    }
    let start = typeof status.start === "string" ? Date.parse(status.start) : Number.NaN;
    if (!Number.isFinite(start)) {
        const s = statSync(ordner);
        start = s.birthtimeMs > 0 ? s.birthtimeMs : s.mtimeMs;
    }
    // 🔴 Ein grüner Lauf des Volltests ist kein grün geprüfter Stand (WI-0264): Er schrieb keine Notiz, Claudios Abholer sähe nie ein Grün. Ein
    // Schnelltest danach muss also laufen, sonst wartete seine Freigabe ewig.
    const nurBericht = status.nurBericht === true;
    return {
        start,
        gruen: status.status === "gruen" && !nurBericht,
        nurBericht,
        ...(typeof status.profil === "string" ? { profil: status.profil } : {}),
    };
}

/** Verschiebt den Ordner eines früheren Laufs nach `<sha>-<Start kompakt>` (gelöscht wird hier nichts; ältere Ordner räumt der Runner beim Start ab) und gibt den neuen Namen zurück. */
export function archiviereLauf(laeufe: string, sha: string, startMs: number): string {
    const stamm = `${sha}-${kompakteZeit(startMs)}`;
    let name = stamm;
    for (let n = 2; existsSync(join(laeufe, name)); n += 1) name = `${stamm}-${String(n)}`;
    renameSync(join(laeufe, sha), join(laeufe, name));
    return name;
}

// ───────────────────────── Der Stand eines Laufs (nur lesen) ─────────────────────────

export type StandZustand = "keiner" | "laeuft" | "gruen" | "rot" | "abgebrochen";

export interface ReleaseTestStand {
    readonly zustand: StandZustand;
    readonly sha?: string;
    /** Der aktuelle Schritt eines laufenden Laufs: der Name des zuletzt beschriebenen Schrittprotokolls (`installation`, `tests`, `browser-2` …). */
    readonly schritt?: string;
    /** Die fertigen grünen Teile (`voll`, `browser-1` …) laut `status.json`. */
    readonly fertigeTeile: readonly string[];
    readonly start?: string;
    readonly ende?: string;
    /** Bei Rot oder Abbruch der Grund: erste Zeile von `fehler.txt` (ohne Pfade und Adressen) oder der Satz zum Status. */
    readonly grund?: string;
    readonly statuspfad?: string;
    /** `.release-runs/aktiv` besteht. */
    readonly sperre: boolean;
}

/** Der Lauf mit dem jüngsten Start unter `.release-runs` (nur Ordner mit `status.json`); `undefined`, wenn es keinen gibt. Nur lesen. */
export function juengsterLauf(laeufe: string): { readonly name: string; readonly start: number } | undefined {
    if (!existsSync(laeufe)) return undefined;
    let beste: { name: string; start: number } | undefined;
    for (const name of readdirSync(laeufe)) {
        if (!/^[0-9a-f]{40}$/.test(name) || !existsSync(join(laeufe, name, "status.json"))) continue;
        const start = leseVorigenLauf(join(laeufe, name)).start;
        if (beste === undefined || start > beste.start) beste = { name, start };
    }
    return beste;
}

/** Die Endzustände in `status.json`, ab denen ein Lauf nichts mehr tut. */
const ENDZUSTAENDE: ReadonlySet<string> = new Set(["gruen", "rot", "abgebrochen", "timeout"]);

/** Der Lauf, dem die Sperre gehört: der jüngste Laufordner (Beginn laut `status.json`, sonst Alter des Ordners), auch einer ohne `status.json`. Nur lesen. */
export function zugehoerigerLauf(
    laeufe: string,
): { readonly name: string; readonly status?: string; readonly ende?: string } | undefined {
    if (!existsSync(laeufe)) return undefined;
    let beste: { name: string; start: number; status?: string; ende?: string } | undefined;
    for (const name of readdirSync(laeufe)) {
        if (!/^[0-9a-f]{40}$/.test(name)) continue;
        const ordner = join(laeufe, name);
        let roh: { status?: unknown; start?: unknown; ende?: unknown } = {};
        try {
            const gelesen: unknown = JSON.parse(readFileSync(join(ordner, "status.json"), "utf8"));
            if (typeof gelesen === "object" && gelesen !== null) roh = gelesen as typeof roh;
        } catch {
            /* Kein lesbarer Status: Der Ordner zählt über sein Alter, ohne Endzustand. */
        }
        let start = typeof roh.start === "string" ? Date.parse(roh.start) : Number.NaN;
        if (!Number.isFinite(start)) {
            try {
                const s = statSync(ordner);
                start = s.birthtimeMs > 0 ? s.birthtimeMs : s.mtimeMs;
            } catch {
                continue;
            }
        }
        if (beste === undefined || start > beste.start)
            beste = {
                name,
                start,
                ...(typeof roh.status === "string" ? { status: roh.status } : {}),
                ...(typeof roh.ende === "string" ? { ende: roh.ende } : {}),
            };
    }
    return beste === undefined
        ? undefined
        : {
              name: beste.name,
              ...(beste.status === undefined ? {} : { status: beste.status }),
              ...(beste.ende === undefined ? {} : { ende: beste.ende }),
          };
}

/**
 * Wie es um die Sperre `.release-runs/aktiv` steht (nur lesen):
 *  - `keine`: Es gibt keine.
 *  - `lebt`: Es lebt ein Runner, oder es ließ sich nicht feststellen (Prozessliste nicht lesbar): Die Sperre gilt.
 *  - `frei`: Kein Runner lebt UND der zugehörige Lauf steht nachweislich in einem Endzustand (`status.json` mit `ende` und `gruen`, `rot`,
 *    `abgebrochen` oder `timeout`): Die Sperre ist ein Überbleibsel und darf freigegeben werden.
 *  - `offen`: Kein Runner lebt, aber der Lauf hat keinen Endzustand (Absturz) oder ist nicht zu finden: melden, nicht entsperren.
 * „Runner lebt“ heißt hier dasselbe wie bei der Prüfbank (`lebtRunnerProzess`: ein `node.exe` mit `release-runner.ts` in der Befehlszeile).
 */
export type SperrePruefung =
    | { readonly art: "keine" }
    | { readonly art: "lebt" }
    | { readonly art: "frei"; readonly sha: string; readonly status: string; readonly ende: string }
    | { readonly art: "offen"; readonly grund: string };

export function pruefeSperre(laeufe: string, lebtRunner: () => boolean | undefined): SperrePruefung {
    if (!existsSync(join(laeufe, "aktiv"))) return { art: "keine" };
    if (lebtRunner() !== false) return { art: "lebt" };
    const lauf = zugehoerigerLauf(laeufe);
    if (lauf === undefined) return { art: "offen", grund: "zur Sperre gehört kein Laufordner" };
    const kurzSha = lauf.name.slice(0, 12);
    if (lauf.status === undefined) return { art: "offen", grund: `der Lauf ${kurzSha} hat keine lesbare status.json` };
    if (!ENDZUSTAENDE.has(lauf.status) || lauf.ende === undefined || lauf.ende === "")
        return {
            art: "offen",
            grund: `der Lauf ${kurzSha} hat keinen Endzustand (Status ${lauf.status}): abgestürzt`,
        };
    return { art: "frei", sha: lauf.name, status: lauf.status, ende: lauf.ende };
}

/**
 * Der Stand des Release-Tests für eine SHA, ohne sie: des jüngsten Laufs im Werkzeugklon. Nur lesen, keine Nebenwirkung (kein Git,
 * kein Netz, nichts wird angelegt). Ohne Lauf: `zustand` ist `keiner`. Ein Lauf, dessen Status „läuft“ sagt, aber ohne Sperre, ist abgebrochen.
 */
export function releaseTestStand(
    sha?: string,
    optionen: { readonly klon?: string; readonly daten?: string } = {},
): ReleaseTestStand {
    const daten = resolve(optionen.daten ?? process.env["AVESMAPS_DATEN"] ?? STANDARD_DATEN);
    const klon = resolve(optionen.klon ?? join(daten, "release-werkzeug"));
    const laeufe = join(klon, ".release-runs");
    const sperre = existsSync(join(laeufe, "aktiv"));
    const keiner: ReleaseTestStand =
        sha === undefined
            ? { zustand: "keiner", fertigeTeile: [], sperre }
            : { zustand: "keiner", sha, fertigeTeile: [], sperre };
    if (!existsSync(laeufe)) return keiner;
    const gewaehlt = sha ?? juengsterLauf(laeufe)?.name;
    if (gewaehlt === undefined) return keiner;
    const ordner = join(laeufe, gewaehlt);
    const statuspfad = join(ordner, "status.json");
    if (!existsSync(statuspfad)) return { ...keiner, sha: gewaehlt };
    let roh: {
        status?: unknown;
        start?: unknown;
        ende?: unknown;
        teile?: unknown;
    } = {};
    try {
        const gelesen: unknown = JSON.parse(readFileSync(statuspfad, "utf8"));
        if (typeof gelesen === "object" && gelesen !== null) roh = gelesen as typeof roh;
    } catch {
        /* Halb geschriebener oder kaputter Status: wie „ohne Ergebnis“ behandeln. */
    }
    const rohStatus = typeof roh.status === "string" ? roh.status : "";
    const zustand: StandZustand =
        rohStatus === "gruen"
            ? "gruen"
            : rohStatus === "abgebrochen"
              ? "abgebrochen"
              : rohStatus === "laeuft"
                ? sperre
                    ? "laeuft"
                    : "abgebrochen"
                : "rot";
    const fertigeTeile = Array.isArray(roh.teile)
        ? roh.teile.flatMap((t: unknown) => {
              const teil = t as { klasse?: unknown; status?: unknown } | null;
              return teil !== null &&
                  typeof teil === "object" &&
                  teil.status === "gruen" &&
                  typeof teil.klasse === "string"
                  ? [teil.klasse]
                  : [];
          })
        : [];
    let schritt: string | undefined;
    if (zustand === "laeuft") {
        let juengste = -Infinity;
        for (const name of readdirSync(ordner)) {
            if (!name.endsWith(".log")) continue;
            const m = statSync(join(ordner, name)).mtimeMs;
            if (m > juengste) {
                juengste = m;
                schritt = name.replace(/\.log$/, "");
            }
        }
    }
    let grund: string | undefined;
    if (zustand === "rot" || zustand === "abgebrochen") {
        try {
            grund = bereinigeGrund(readFileSync(join(ordner, "fehler.txt"), "utf8"));
        } catch {
            grund =
                rohStatus === "timeout"
                    ? "Gesamtzeit von zwölf Stunden überschritten"
                    : rohStatus === "abgebrochen"
                      ? "Lauf abgebrochen (ABBRUCH im Ergebnisordner)"
                      : rohStatus === "laeuft"
                        ? "Der Lauf endete ohne Ergebnis"
                        : "Lauf fehlgeschlagen";
        }
    }
    return {
        zustand,
        sha: gewaehlt,
        ...(schritt === undefined ? {} : { schritt }),
        fertigeTeile,
        ...(typeof roh.start === "string" ? { start: roh.start } : {}),
        ...(typeof roh.ende === "string" && roh.ende !== "" ? { ende: roh.ende } : {}),
        ...(grund === undefined ? {} : { grund }),
        statuspfad,
        sperre,
    };
}

/** Die Orte, die `releaseTestStand` und die Ansicht gemeinsam auflösen. */
function orte(optionen: { readonly klon?: string; readonly daten?: string }): { daten: string; klon: string } {
    const daten = resolve(optionen.daten ?? process.env["AVESMAPS_DATEN"] ?? STANDARD_DATEN);
    return { daten, klon: resolve(optionen.klon ?? join(daten, "release-werkzeug")) };
}

/** Der Stand eines Laufs wie `releaseTestStand`, dazu Schritte mit Zeiten, erwartete Dauer, Fortschritt und bei Rot der Bericht (WI-0248 L). */
export interface ReleaseTestAnsicht extends Fortschritt {
    readonly zustand: StandZustand;
    readonly sha?: string;
    readonly schritt?: string;
    readonly fertigeTeile: readonly string[];
    readonly start?: string;
    readonly ende?: string;
    readonly grund?: string;
    /** Der Ergebnisordner des Laufs (für die vollständigen Berichte); fehlt ohne Lauf. */
    readonly ordner?: string;
    readonly sperre: boolean;
    /** Nur bei einem laufenden Lauf, wenn feststellbar: lebt sein Prozess? `false`: abgestürzt, die Sperre bleibt zur Diagnose stehen. */
    readonly lebt?: boolean;
    /** Der Zeitpunkt, auf den sich die Zeiten beziehen (ISO). */
    readonly jetzt: string;
    readonly fehler?: FehlerBericht;
    /** Der jüngste Start, soweit er noch zählt (`baut`, `fehler`): aus der Startdatei, nicht aus dem Speicher des Servers. */
    readonly startvorgang?: Startvorgang;
    /**
     * Die vier Browserteile nach Thema (WI-0248): Name, Bereiche, Zahl der Fälle, Zustand und Zeit. Aus dem Laufbuch des Laufs (`teile.json`), ohne
     * Lauf aus `release-teile.json`; fehlt, wo keine Zuordnung zu lesen ist.
     */
    readonly teile?: readonly TeilAnsicht[];
    /** Was die Wiederholung aus dem früheren Lauf übernahm und warum sie gegebenenfalls nichts übernahm; fehlt bei einem Lauf ohne Wiederholung. */
    readonly wiederholung?: LaufBuchWiederholung;
    /** Dieser Lauf ist zu Ende und nicht grün, und kein Lauf hält die Sperre: „Rote Teile wiederholen“ (`--wiederholen <sha>`) ist möglich. */
    readonly wiederholbar?: boolean;
    /** Das Prüfprofil des Laufs laut `status.json` (`tor`, `B`, `voll`); fehlt ohne Lauf oder bei Läufen aus der Zeit davor. */
    readonly profil?: string;
    /** Ein Teil des Volltests (WI-0264): nur Bericht, liefert nichts aus; fehlt sonst. */
    readonly volltest?: true;
    /** Teil 2 des Volltests: wie Teil 1 (der Schnelltest) endete, mit dem Grund bei Rot. */
    readonly vorlauf?: { readonly zustand: StandZustand; readonly grund?: string };
}

/** Teil 1 eines Volltests, wie Teil 2 ihn in `status.json` nennt: Zustand und bei Rot der Grund aus seinem Ordner. Nur lesen, wirft nie. */
function leseVorlaufStand(ordner: string): ReleaseTestAnsicht["vorlauf"] {
    let roh: { vorlauf?: { ordner?: unknown; status?: unknown } } = {};
    try {
        const gelesen: unknown = JSON.parse(readFileSync(join(ordner, "status.json"), "utf8"));
        if (typeof gelesen === "object" && gelesen !== null) roh = gelesen as typeof roh;
    } catch {
        return undefined;
    }
    const v = roh.vorlauf;
    if (typeof v !== "object" || v === null || typeof v.ordner !== "string" || typeof v.status !== "string")
        return undefined;
    const zustand: StandZustand = v.status === "gruen" ? "gruen" : v.status === "abgebrochen" ? "abgebrochen" : "rot";
    if (zustand === "gruen") return { zustand };
    let grund: string | undefined;
    try {
        grund = bereinigeGrund(readFileSync(join(dirname(ordner), v.ordner, "fehler.txt"), "utf8"));
    } catch {
        grund = undefined;
    }
    return grund === undefined || grund === "" ? { zustand } : { zustand, grund };
}

/** Die Teile aus `release-teile.json` des Werkzeugklons, sonst dieses Checkouts: die Anzeige vor und neben einem Lauf. Leer, wo keine Zuordnung zu lesen ist. */
function teileAusRepository(klon: string): { id: string; name: string; bereiche: readonly string[] }[] {
    for (const wurzel of [klon, resolve(fileURLToPath(new URL("../../", import.meta.url)))]) {
        try {
            return leseTeileDatei(wurzel).teile.map((t) => ({ id: t.id, name: t.name, bereiche: t.bereiche }));
        } catch {
            /* Dort liegt keine brauchbare Zuordnung: die nächste Quelle. */
        }
    }
    return [];
}

/** Die Schritte, die ein Laufbuch oder `fehler.txt` als rot, übernommen oder entfallen führen. */
function schrittMengen(
    buch: LaufBuch | undefined,
    fehlerText: string,
    teileStatus: readonly { klasse: string; status: string }[],
    profil: string | null | undefined,
): { rot: SchrittId[]; uebernommen: SchrittId[]; uebersprungen: SchrittId[] } {
    const aus = schritteAusFehlerText(fehlerText);
    const rot: SchrittId[] = [...aus.rot];
    const uebersprungen: SchrittId[] = [...aus.uebersprungen];
    const uebernommen: SchrittId[] = [];
    const nimm = (liste: SchrittId[], id: string): void => {
        if (istSchrittId(id) && !liste.includes(id)) liste.push(id);
    };
    for (const [id, s] of Object.entries(buch?.schritte ?? {})) {
        if (s.status === "rot") nimm(rot, id);
        else if (s.status === "uebersprungen") nimm(uebersprungen, id);
        else if (s.status === "uebernommen") nimm(uebernommen, id);
    }
    // Ein Browserteil, den das Laufbuch nicht führt, gehört nicht zum Prüfprofil des Laufs (B fährt nur `kern`, `voll` die vier nach Thema, das Tor
    // nur `kern-echt`): kein offener Schritt, der die erwartete Dauer aufbläht.
    if (buch !== undefined && buch.teile.length > 0) {
        const gefuehrt = new Set(buch.teile.map((t) => t.id));
        for (const id of BROWSER_SCHRITTE) if (!gefuehrt.has(id)) nimm(uebersprungen, id);
    }
    // Ebenso jeder Schritt, den das Prüfprofil nie fährt (das Tor: Format, Vitest, Besucherpaket; B und `voll`: `daten`). Rot oder übernommen bleibt er,
    // was er ist.
    if (profil !== null) {
        const faehrt = new Set<string>(schritteJeProfil(profil));
        for (const id of RELEASE_SCHRITTE)
            if (!faehrt.has(id) && !rot.includes(id) && !uebernommen.includes(id)) nimm(uebersprungen, id);
    }
    // Ein Browserteil, den `status.json` rot oder entfallen nennt, ist auch dann rot, wenn das Laufbuch fehlt (Lauf aus der Zeit davor).
    for (const t of teileStatus) {
        if (t.status === "rot") nimm(rot, t.klasse);
        else if (t.status === "uebersprungen") nimm(uebersprungen, t.klasse);
    }
    return { rot, uebernommen, uebersprungen };
}

/**
 * Die Ansicht der lokalen Oberfläche (`--stand --json`). Nur lesen wie `releaseTestStand`: kein Git, kein Netz, nichts wird angelegt. Ohne Lauf
 * zeigt sie die erwartete Dauer aus den früheren Läufen (oder die feste Schätzung) und alle Schritte offen.
 */
export function releaseTestAnsicht(
    sha?: string,
    optionen: {
        readonly klon?: string;
        readonly daten?: string;
        readonly jetzt?: () => number;
        /** Lebt ein Runner-Prozess? Vorgabe: die Abfrage der Prozesse; nur bei einem laufenden Lauf gefragt. */
        readonly lebtRunner?: () => boolean | undefined;
        /** Lebt der Starter mit dieser Prozessnummer? Vorgabe: die Abfrage des Prozesses. */
        readonly lebtStarter?: (pid: number) => boolean;
    } = {},
): ReleaseTestAnsicht {
    const jetzt = (optionen.jetzt ?? Date.now)();
    const stand = releaseTestStand(sha, optionen);
    const { klon } = orte(optionen);
    const erwartung = erwarteteDauern(join(klon, ".release-runs"));
    const ordner = stand.statuspfad === undefined ? undefined : dirname(stand.statuspfad);
    const start = stand.start === undefined ? Number.NaN : Date.parse(stand.start);
    let zeiten: ReturnType<typeof leseSchrittzeiten> = [];
    let laufEnde: number | null = null;
    if (ordner !== undefined && Number.isFinite(start)) {
        if (stand.zustand !== "laeuft") {
            const ende = stand.ende === undefined ? Number.NaN : Date.parse(stand.ende);
            // Ohne Ende im Status (abgestürzter Lauf) gilt die letzte Änderung des Status.
            laufEnde = Number.isFinite(ende) ? ende : statSync(stand.statuspfad ?? ordner).mtimeMs;
        }
        zeiten = leseSchrittzeiten(ordner, start, laufEnde, stand.zustand === "gruen");
    }
    const fehler =
        ordner !== undefined && (stand.zustand === "rot" || stand.zustand === "abgebrochen")
            ? baueFehlerBericht(ordner, stand.grund ?? "", zeiten.at(-1)?.id)
            : undefined;
    const lebt = stand.zustand === "laeuft" ? (optionen.lebtRunner ?? lebtRunnerProzess)() : undefined;
    const startvorgang = leseStartvorgang({ ...optionen, jetzt: () => jetzt });
    // Das Laufbuch und die Teile laut Status: rot, übernommen oder entfallen kann seit WI-0248 mehr als ein Schritt sein, und der Lauf geht weiter.
    const buch = ordner === undefined ? undefined : leseLaufBuch(ordner);
    const teileStatus = ordner === undefined ? [] : leseTeileStatus(ordner);
    let fehlerText = "";
    if (ordner !== undefined && (stand.zustand === "rot" || stand.zustand === "abgebrochen")) {
        try {
            fehlerText = readFileSync(join(ordner, "fehler.txt"), "utf8");
        } catch {
            /* Abbruch und Zeitgrenze lassen keine Meldung zurück. */
        }
    }
    // Ohne Lauf (`null`) gibt es nichts zu entfallen; ein Lauf ohne Profil in der Status-Datei stammt aus der Zeit davor (`voll`).
    const profil = ordner === undefined ? null : leseProfil(ordner);
    const mengen = schrittMengen(buch, fehlerText, teileStatus, profil);
    const fortschritt = berechneFortschritt({
        zeiten,
        erwartung,
        zustand: stand.zustand,
        jetzt,
        fehlerSchritt: fehler?.schritt ?? undefined,
        fehlerSchritte: mengen.rot,
        uebernommen: mengen.uebernommen,
        uebersprungen: mengen.uebersprungen,
    });
    const definitionen = buch?.teile ?? teileAusRepository(klon);
    const teile =
        definitionen.length === 0
            ? undefined
            : baueTeileAnsicht({
                  definitionen,
                  laufbuch: buch,
                  teileStatus,
                  schritte: fortschritt.schritte,
                  ordner,
                  erwartet: erwarteteFaelle(join(klon, ".release-runs")),
              });
    // Ein Lauf des Volltests (WI-0264) wird nicht wiederholt: „Rote Teile wiederholen“ gehört zum Schnelltest und gibt frei; der Volltest startet neu.
    const volltest = ordner !== undefined && leseVorigenLauf(ordner).nurBericht === true;
    const vorlauf = volltest && ordner !== undefined ? leseVorlaufStand(ordner) : undefined;
    const wiederholbar = (stand.zustand === "rot" || stand.zustand === "abgebrochen") && !stand.sperre && !volltest;
    return {
        zustand: stand.zustand,
        ...(stand.sha === undefined ? {} : { sha: stand.sha }),
        ...(stand.schritt === undefined ? {} : { schritt: stand.schritt }),
        fertigeTeile: stand.fertigeTeile,
        ...(stand.start === undefined ? {} : { start: stand.start }),
        ...(stand.ende === undefined ? {} : { ende: stand.ende }),
        ...(stand.grund === undefined ? {} : { grund: stand.grund }),
        ...(ordner === undefined ? {} : { ordner }),
        sperre: stand.sperre,
        ...(lebt === undefined ? {} : { lebt }),
        jetzt: new Date(jetzt).toISOString(),
        ...fortschritt,
        ...(fehler === undefined ? {} : { fehler }),
        ...(startvorgang === undefined ? {} : { startvorgang }),
        ...(teile === undefined ? {} : { teile }),
        ...(buch?.wiederholung == null ? {} : { wiederholung: buch.wiederholung }),
        ...(stand.zustand === "keiner" ? {} : { wiederholbar }),
        ...(profil === null || profil === undefined ? {} : { profil }),
        ...(volltest ? { volltest: true as const } : {}),
        ...(vorlauf === undefined ? {} : { vorlauf }),
    };
}

export interface AbbruchErgebnis {
    readonly status: "abbruch-angefordert" | "kein-lauf" | "fehler";
    readonly sha?: string;
    readonly grund: string;
}

/**
 * Bricht einen laufenden Release-Test ab, indem sie die leere Datei `ABBRUCH` in seinen Ergebnisordner legt (so beschreibt es WI-0228: Der Runner
 * prüft sie jede Sekunde und beendet dann seinen ganzen Prozessbaum, schreibt den Status `abgebrochen` und die rote Notiz). Sie beendet selbst
 * keinen Prozess. Nur für einen Lauf, der läuft (Status `laeuft` und gehaltene Sperre); sonst `kein-lauf`, und nichts wird angelegt.
 */
export function abbrecheReleaseTest(
    sha: string,
    optionen: { readonly klon?: string; readonly daten?: string; readonly jetzt?: () => Date } = {},
): AbbruchErgebnis {
    if (!/^[0-9a-f]{40}$/.test(sha))
        return {
            status: "fehler",
            grund: "--abbrechen benötigt eine vollständige SHA (40 Hexziffern, kleingeschrieben)",
        };
    const { daten } = orte(optionen);
    const stand = releaseTestStand(sha, optionen);
    if (stand.zustand !== "laeuft" || stand.statuspfad === undefined)
        return {
            status: "kein-lauf",
            sha,
            grund: `Für ${sha.slice(0, 12)} läuft kein Release-Test; nichts abgebrochen.`,
        };
    const marke = join(dirname(stand.statuspfad), "ABBRUCH");
    if (existsSync(marke))
        return {
            status: "abbruch-angefordert",
            sha,
            grund: `Der Abbruch für ${sha.slice(0, 12)} ist schon angefordert; der Lauf beendet sich gleich.`,
        };
    try {
        writeFileSync(marke, "");
    } catch (e) {
        return { status: "fehler", sha, grund: `ABBRUCH nicht angelegt: ${kurz(e)}` };
    }
    const protokollOrdner = join(daten, "release-abholer");
    mkdirSync(protokollOrdner, { recursive: true });
    schreibeProtokoll(
        join(protokollOrdner, "abholer.log"),
        `Abbruch angefordert für ${sha.slice(0, 12)} (Datei ABBRUCH im Ergebnisordner)`,
        (optionen.jetzt ?? ((): Date => new Date()))(),
    );
    return {
        status: "abbruch-angefordert",
        sha,
        grund: `Abbruch für ${sha.slice(0, 12)} angefordert; der Lauf beendet sich in wenigen Sekunden.`,
    };
}

// ───────────────────────── Git ─────────────────────────

/** Nie nach einem Kennwort fragen, auch nicht in einem Fenster: Ein einmaliger Starter hat oft niemanden davor (Server, Aufgabe). */
const GIT_UMGEBUNG: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" };

function git(repo: string, args: readonly string[], timeout = 90_000): string {
    return execFileSync("git", [...args], {
        cwd: repo,
        env: GIT_UMGEBUNG,
        encoding: "utf8",
        timeout,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
    }).trim();
}

const kurz = (e: unknown): string =>
    (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 240);

/** Alle Notizen eines Verweises: der Commit, an dem sie hängen, und ihr Text (je höchstens 4 KiB). */
export function leseNotizen(repo: string, ref: string): { objekt: string; text: string }[] {
    const liste = git(repo, ["notes", `--ref=${ref}`, "list"]);
    const paare = liste
        .split(/\r?\n/)
        .map((z) => z.trim().split(" "))
        .filter(
            (p): p is [string, string] =>
                p.length === 2 && /^[0-9a-f]{40}$/.test(p[0] ?? "") && /^[0-9a-f]{40}$/.test(p[1] ?? ""),
        );
    if (paare.length === 0) return [];
    const lauf = spawnSync("git", ["cat-file", "--batch"], {
        cwd: repo,
        env: GIT_UMGEBUNG,
        input: `${paare.map((p) => p[0]).join("\n")}\n`,
        timeout: 60_000,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
    });
    if (lauf.status !== 0) throw new Error("git cat-file --batch scheiterte");
    const aus = lauf.stdout;
    const ergebnis: { objekt: string; text: string }[] = [];
    let pos = 0;
    for (const [, objekt] of paare) {
        const ende = aus.indexOf(0x0a, pos);
        if (ende < 0) break;
        const kopf = aus.subarray(pos, ende).toString("utf8").split(" ");
        const groesse = Number(kopf[2]);
        if (kopf[1] !== "blob" || !Number.isInteger(groesse)) {
            pos = ende + 1;
            continue;
        }
        const inhalt = aus.subarray(ende + 1, ende + 1 + groesse);
        ergebnis.push({ objekt, text: inhalt.subarray(0, 4096).toString("utf8") });
        pos = ende + 1 + groesse + 1;
    }
    return ergebnis;
}

const AUFTRAG_REF = "abholer-auftrag";
const ERGEBNIS_REF = "abholer-sammellauf";
const STAGE_REF = "abholer-stage";

/**
 * Holt die Notizen eines Verweises von Origin in einen eigenen lokalen Verweis (`refs/notes/<lokal>`) und liest sie. `undefined`: Origin kennt
 * den Verweis nicht. Ein Fetch-Fehler wirft. Es werden nur Notizen geholt, nie Zweige oder die Arbeitskopie.
 */
function holeNotizenVonOrigin(
    repo: string,
    fern: string,
    lokalName: string,
): { objekt: string; text: string }[] | undefined {
    if (git(repo, ["ls-remote", "origin", `refs/notes/${fern}`]) === "") {
        const lokal = `refs/notes/${lokalName}`;
        if (git(repo, ["for-each-ref", "--format=%(refname)", lokal]) !== "") git(repo, ["update-ref", "-d", lokal]);
        return undefined;
    }
    git(repo, ["fetch", "--no-tags", "--quiet", "origin", `+refs/notes/${fern}:refs/notes/${lokalName}`]);
    return leseNotizen(repo, lokalName);
}

/** Holt die Auftragsnotizen. `undefined`: Origin kennt den Verweis nicht (es gibt keinen Auftrag). Ein Fetch-Fehler wirft. */
function holeAuftragsnotizen(repo: string): { objekt: string; text: string }[] | undefined {
    return holeNotizenVonOrigin(repo, "release-auftrag", AUFTRAG_REF);
}

// ───────────────────────── Der Kandidat (nur lesen) ─────────────────────────

export interface StageStand {
    readonly sha: string;
    readonly zeit: string;
}
/**
 * Die jüngste Freigabe (WI-0248, Vali 2026-10-26: der Start des Release-Tests ist die Freigabe) und was aus ihr wird, nach derselben Regel wie
 * Claudios Abholer (`entscheideFreigabe` in `release-freigabe.ts`): wartet, läuft, rot, grün (wird ausgeliefert), abgebrochen.
 */
export interface KandidatFreigabe {
    readonly sha: string;
    readonly zeit: string;
    readonly kennung: string;
    /** Wer freigegeben hat; `null` bei einem Abbruch (die Notiz trägt dann den Grund). */
    readonly von: string | null;
    readonly zustand: Exclude<FreigabeZustand, "keine">;
    readonly ausliefern: boolean;
    readonly grund: string;
}
export interface Kandidat {
    /** Die jüngste Stage-Notiz (`refs/notes/stage`, Claudio): der zuletzt grün ausgerollte Stand; `null`, wenn es keine gibt. */
    readonly stage: StageStand | null;
    /** Der jüngste offene Auftrag aus `refs/notes/release-auftrag` (die früheren Nacht-Freigaben der Stage, `OPS-…`); `null`, wenn es keinen gibt. */
    readonly auftrag: Auftrag | null;
    /** Die jüngste Freigabe aus dem Start des Release-Tests (`RT-…`); fehlt, wenn es keine gibt. */
    readonly freigabe?: KandidatFreigabe;
}

/**
 * Die jüngste gültige Stage-Notiz: erste Zeile `<sha40> <ISO-Zeit> stage`, und die SHA ist der Commit, an dem die Notiz hängt. Kaputte Zeilen
 * zählen nicht. Bei gleicher Zeit gewinnt die größere SHA, damit die Wahl nicht von der Reihenfolge der Notizen abhängt.
 */
export function waehleStage(
    notizen: readonly { readonly objekt: string; readonly text: string }[],
): StageStand | undefined {
    let beste: { sha: string; zeit: string; ms: number } | undefined;
    for (const n of notizen) {
        const stand = stageAusNotiz(n.text);
        if (stand === undefined || stand.sha !== n.objekt) continue;
        const ms = Date.parse(stand.zeit);
        if (!Number.isFinite(ms)) continue;
        if (beste === undefined || ms > beste.ms || (ms === beste.ms && stand.sha > beste.sha))
            beste = { sha: stand.sha, zeit: stand.zeit, ms };
    }
    return beste === undefined ? undefined : { sha: beste.sha, zeit: beste.zeit };
}

/**
 * Liest Stage-Stand und Auftrag aus den Notizen auf Origin. Holt dafür nur Notizen (in eigene Verweise `refs/notes/abholer-*`), verändert weder
 * Zweige noch Arbeitskopie und startet nichts. Ein Fetch-Fehler wirft.
 */
export function leseKandidat(repo: string): Kandidat {
    const stage = holeNotizenVonOrigin(repo, "stage", STAGE_REF);
    const auftraege = holeAuftragsnotizen(repo);
    const freigabe = auftraege === undefined ? undefined : waehleFreigabe(auftraege);
    const kandidat: Kandidat = {
        stage: (stage === undefined ? undefined : waehleStage(stage)) ?? null,
        auftrag: (auftraege === undefined ? undefined : waehleAuftrag(auftraege)) ?? null,
    };
    if (freigabe === undefined) return kandidat;
    const e = entscheideFreigabe(freigabe, holeErgebnisText(repo, freigabe.sha));
    if (e.zustand === "keine") return kandidat;
    return {
        ...kandidat,
        freigabe: {
            sha: freigabe.sha,
            zeit: freigabe.zeit,
            kennung: freigabe.kennung,
            von: freigabe.von,
            zustand: e.zustand,
            ausliefern: e.ausliefern,
            grund: e.grund,
        },
    };
}

/** Der Text der Notiz des Runners zu einem Commit aus `refs/notes/sammellauf` auf Origin; `undefined` ohne Notiz. Ein Fetch-Fehler wirft. */
function holeErgebnisText(repo: string, sha: string): string | undefined {
    const fern = git(repo, ["ls-remote", "origin", "refs/notes/sammellauf"]);
    if (fern === "") return undefined;
    git(repo, ["fetch", "--no-tags", "--quiet", "origin", `+refs/notes/sammellauf:refs/notes/${ERGEBNIS_REF}`]);
    try {
        return git(repo, ["notes", `--ref=${ERGEBNIS_REF}`, "show", sha]);
    } catch {
        return undefined;
    }
}

/** Das Ergebnis des Runners zu einem Commit aus `refs/notes/sammellauf` auf Origin. Ein Fetch-Fehler wirft. */
function holeErgebnis(repo: string, sha: string): ErgebnisNotiz | undefined {
    const text = holeErgebnisText(repo, sha);
    return text === undefined ? undefined : leseErgebnisNotiz(text, sha);
}

// ───────────────────────── Die Freigabe schreiben (WI-0248) ─────────────────────────

/** Der eigene lokale Verweis, über den die Freigabe geschrieben wird (der geteilte `refs/notes/release-auftrag` des Repositorys bleibt unberührt). */
const FREIGABE_LOKAL = "abholer-freigabe";
const FREIGABE_VERSUCHE = 3;

export type FreigabeSchreibStatus = "geschrieben" | "unveraendert" | "fehler";
export interface FreigabeSchreibErgebnis {
    readonly status: FreigabeSchreibStatus;
    readonly sha: string;
    readonly kennung: string;
    readonly grund: string;
    /** Dieser Starter kennt die Freigabe (WI-0248); ein älterer antwortet ohne das Zeichen und wird übergangen. */
    readonly freigabe: true;
}

/** Das Repository, in dem der Starter Notizen liest und schreibt: der Werkzeugklon, solange es ihn gibt, sonst das Repository dieser Datei. */
export function notizRepo(
    o: { readonly klon?: string; readonly daten?: string; readonly quelle?: string } = {},
): string {
    const { klon } = orte(o);
    return existsSync(join(klon, ".git"))
        ? klon
        : resolve(o.quelle ?? fileURLToPath(new URL("../../", import.meta.url)));
}

/**
 * Schreibt eine Notiz an `sha` in `refs/notes/release-auftrag` auf Origin: holen (in einen eigenen Verweis), prüfen (`darf` sieht die vorhandene Notiz
 * an diesem Commit), schreiben, schieben; ein abgewiesener Push (jemand schrieb dazwischen) holt neu und versucht es wieder. Wirft nicht.
 */
function schreibeAuftragsnotiz(
    repo: string,
    sha: string,
    text: string,
    kennung: string,
    darf: (vorhanden: string | undefined) => string | null,
): FreigabeSchreibErgebnis {
    const lokal = `refs/notes/${FREIGABE_LOKAL}`;
    const datei = join(tmpdir(), `avesmaps-freigabe-${String(process.pid)}-${sha.slice(0, 12)}.txt`);
    let letzter = "";
    try {
        writeFileSync(datei, text, "utf8");
        for (let versuch = 1; versuch <= FREIGABE_VERSUCHE; versuch++) {
            try {
                if (git(repo, ["ls-remote", "origin", "refs/notes/release-auftrag"]) === "") {
                    if (git(repo, ["for-each-ref", "--format=%(refname)", lokal]) !== "")
                        git(repo, ["update-ref", "-d", lokal]);
                } else git(repo, ["fetch", "--no-tags", "--quiet", "origin", `+refs/notes/release-auftrag:${lokal}`]);
                try {
                    git(repo, ["cat-file", "-e", `${sha}^{commit}`]);
                } catch {
                    git(repo, [
                        "fetch",
                        "--no-tags",
                        "--quiet",
                        "origin",
                        "+refs/heads/master:refs/remotes/origin/master",
                    ]);
                }
                let vorhanden: string | undefined;
                try {
                    vorhanden = git(repo, ["notes", `--ref=${FREIGABE_LOKAL}`, "show", sha]);
                } catch {
                    vorhanden = undefined;
                }
                const nicht = darf(vorhanden);
                if (nicht !== null) return { status: "unveraendert", sha, kennung, grund: nicht, freigabe: true };
                git(repo, ["notes", `--ref=${FREIGABE_LOKAL}`, "add", "-f", "-F", datei, sha]);
                git(repo, ["push", "--quiet", "origin", `${lokal}:refs/notes/release-auftrag`]);
                return {
                    status: "geschrieben",
                    sha,
                    kennung,
                    grund: `Notiz an ${sha.slice(0, 12)} auf origin geschrieben`,
                    freigabe: true,
                };
            } catch (e) {
                letzter = kurz(e);
            }
        }
        return {
            status: "fehler",
            sha,
            kennung,
            grund: `Die Notiz ließ sich nicht auf origin schreiben: ${letzter}`,
            freigabe: true,
        };
    } catch (e) {
        return { status: "fehler", sha, kennung, grund: kurz(e), freigabe: true };
    } finally {
        rmSync(datei, { force: true });
    }
}

/**
 * Wo der private Schlüssel der Freigabe liegt (Weg B): `RELEASE_FREIGABE_SCHLUESSEL`, sonst `<Daten>/geheim/release-freigabe.key`. Nie im Repository;
 * angelegt von `release-schluessel.ts erzeuge`.
 */
export function freigabeSchluesselPfad(o: { readonly daten?: string }): string {
    const eigen = process.env["RELEASE_FREIGABE_SCHLUESSEL"];
    if (eigen !== undefined && eigen !== "") return resolve(eigen);
    return join(resolve(o.daten ?? process.env["AVESMAPS_DATEN"] ?? STANDARD_DATEN), "geheim", "release-freigabe.key");
}

/**
 * Die Freigabe für Production, geschrieben mit dem Start des Release-Tests (WI-0248): `<sha40> <Zeit> auftrag RT-<…>` und `von <Name>` an genau diesem
 * Commit, darunter `sig <Base64>` mit dem Schlüssel des Entwicklungsrechners (Weg B). Ohne Schlüssel bleibt sie unterschriftslos wie bisher: Der Test
 * läuft, nur liefert der Korridor dann nicht von selbst aus (der Knopf auf der Stage bleibt). Eine neue Freigabe desselben Commits ersetzt die alte.
 * Wirft nicht.
 */
export function schreibeFreigabe(o: {
    readonly sha: string;
    readonly kennung: string;
    readonly von: string;
    readonly zeit?: string;
    readonly klon?: string;
    readonly daten?: string;
    readonly quelle?: string;
}): FreigabeSchreibErgebnis {
    let text: string;
    try {
        text = freigabeNotiz({ sha: o.sha, zeit: o.zeit ?? new Date().toISOString(), kennung: o.kennung, von: o.von });
    } catch (e) {
        return { status: "fehler", sha: o.sha, kennung: o.kennung, grund: kurz(e), freigabe: true };
    }
    const pfad = freigabeSchluesselPfad(o);
    let unterschrift = "ohne Unterschrift: kein Schlüssel";
    if (existsSync(pfad)) {
        try {
            text = unterschreibeNotiz(text, readFileSync(pfad, "utf8"));
            unterschrift = "unterschrieben";
        } catch (e) {
            unterschrift = `ohne Unterschrift: ${kurz(e)}`;
        }
    }
    const ergebnis = schreibeAuftragsnotiz(notizRepo(o), o.sha, text, o.kennung, () => null);
    protokolliere(
        o,
        `Freigabe ${o.kennung} für ${o.sha.slice(0, 12)}: ${ergebnis.status} (${ergebnis.grund}), ${unterschrift}`,
    );
    return ergebnis;
}

/**
 * Beendet eine Freigabe ohne grünes Ergebnis (Abbruch, gescheiterter Start, rot): `abgebrochen RT-<…>` mit dem Grund. Nur, solange an diesem Commit
 * noch GENAU diese Freigabe steht; eine neuere (ein neuer Druck) bleibt unberührt (`unveraendert`). Wirft nicht.
 */
export function beendeFreigabe(o: {
    readonly sha: string;
    readonly kennung: string;
    readonly grund: string;
    readonly klon?: string;
    readonly daten?: string;
    readonly quelle?: string;
}): FreigabeSchreibErgebnis {
    let text: string;
    try {
        text = abbruchNotiz({ sha: o.sha, zeit: new Date().toISOString(), kennung: o.kennung, grund: o.grund });
    } catch (e) {
        return { status: "fehler", sha: o.sha, kennung: o.kennung, grund: kurz(e), freigabe: true };
    }
    const ergebnis = schreibeAuftragsnotiz(notizRepo(o), o.sha, text, o.kennung, (vorhanden) => {
        const f = vorhanden === undefined ? undefined : parseFreigabe(vorhanden, o.sha);
        if (f === undefined || f.kennung !== o.kennung)
            return "An diesem Stand steht nicht (mehr) diese Freigabe; nichts geändert.";
        if (f.art === "abgebrochen") return "Die Freigabe ist schon beendet.";
        return null;
    });
    protokolliere(o, `Freigabe ${o.kennung} für ${o.sha.slice(0, 12)} beendet: ${ergebnis.status} (${ergebnis.grund})`);
    return ergebnis;
}

/** Eine Zeile ins Protokoll des Starters; ein Fehler dabei hält nichts an. */
function protokolliere(o: { readonly daten?: string }, text: string): void {
    try {
        const ordner = join(resolve(o.daten ?? process.env["AVESMAPS_DATEN"] ?? STANDARD_DATEN), "release-abholer");
        mkdirSync(ordner, { recursive: true });
        schreibeProtokoll(join(ordner, "abholer.log"), text);
    } catch {
        /* das Protokoll hilft der Diagnose */
    }
}

// ───────────────────────── Der eine Bericht (WI-0248) ─────────────────────────

export interface BerichtAntwort {
    readonly status: "bericht" | "kein-bericht";
    readonly sha?: string;
    /** Die Seite als Markdown (`bericht.md`). */
    readonly text?: string;
    readonly ordner?: string;
    readonly grund?: string;
}

/**
 * Der Bericht eines Laufs: `bericht.md` aus seinem Ergebnisordner (für `sha` der Ordner `.release-runs/<sha>`, sonst der jüngste Lauf). Fehlt die Datei
 * (ein Lauf von vorher, oder er läuft noch), wird sie aus dem Ordner gebaut, ohne sie zu schreiben. Nur lesen.
 */
export function leseBericht(
    sha: string | undefined,
    o: { readonly klon?: string; readonly daten?: string } = {},
): BerichtAntwort {
    const { klon } = orte(o);
    const laeufe = join(klon, ".release-runs");
    const name = sha ?? juengsterLauf(laeufe)?.name;
    if (name === undefined) return { status: "kein-bericht", grund: "Es gibt noch keinen Lauf." };
    const ordner = join(laeufe, name);
    // Der Ordner heißt `<sha40>` oder `<sha40>-<Zeit>`.
    const pruef = name.slice(0, 40);
    const text = leseBerichtSeite(ordner, () => {
        const datei = join(ordner, "checkout", ...OFFEN_QUELLE.split("/"));
        try {
            return existsSync(datei)
                ? readFileSync(datei, "utf8")
                : git(klon, ["show", `${pruef}:${OFFEN_QUELLE}`], 30_000);
        } catch {
            return null;
        }
    });
    if (text === undefined)
        return { status: "kein-bericht", grund: `Für ${name.slice(0, 12)} gibt es keinen Ergebnisordner.` };
    return { status: "bericht", sha: name.slice(0, 40), text, ordner };
}

/**
 * Legt den Werkzeugklon an, wenn er fehlt: `git clone` der Remote von `quelle` (dem aufrufenden Repository; sonst die Vorgabe), dazu Name
 * und Adresse für die Notizen, die der Runner schreibt (Werte von `quelle`, sonst Claudia). Ein vorhandener Ordner ohne Git wird nie angefasst.
 */
export function sichereKlon(klon: string, quelle: string): boolean {
    if (existsSync(join(klon, ".git"))) return false;
    if (existsSync(klon) && readdirSync(klon).length > 0)
        throw new Error(`${klon} existiert, ist aber kein Git-Klon; nichts angelegt`);
    let remote = STANDARD_REMOTE;
    try {
        remote = git(quelle, ["remote", "get-url", "origin"]) || STANDARD_REMOTE;
    } catch {
        /* Das aufrufende Verzeichnis hat keine Remote: die Vorgabe. */
    }
    mkdirSync(dirname(klon), { recursive: true });
    git(dirname(klon), ["clone", "--quiet", remote, klon], 900_000);
    for (const [schluessel, vorgabe] of [
        ["user.name", "Claudia"],
        ["user.email", "claudia@avesmaps3d.local"],
    ] as const) {
        let wert: string = vorgabe;
        try {
            wert = git(quelle, ["config", "--get", schluessel]) || vorgabe;
        } catch {
            /* nicht gesetzt: die Vorgabe */
        }
        git(klon, ["config", schluessel, wert]);
    }
    return true;
}

// ───────────────────────── Protokoll ─────────────────────────

/** Hängt eine Zeile an das Protokoll, außer sie ist (ohne Zeitstempel) dieselbe wie die letzte: ein Zustand, der anhält, steht einmal da. */
export function schreibeProtokoll(datei: string, text: string, jetzt: Date = new Date()): boolean {
    const zeile = text.replace(/\s+/g, " ").trim();
    try {
        const alt = readFileSync(datei, "utf8").trimEnd().split(/\r?\n/).pop() ?? "";
        if (alt.replace(/^\S+ /, "") === zeile) return false;
    } catch {
        /* noch kein Protokoll */
    }
    appendFileSync(datei, `${jetzt.toISOString()} ${zeile}\n`);
    return true;
}

// ───────────────────────── Der Startvermerk ─────────────────────────

/**
 * Wie lange ein Start höchstens dauert: die Zeitgrenze des Starters plus Reserve. Ein `baut`, das älter ist, gilt als beendet, auch wenn die
 * Prozessnummer noch vergeben ist (Windows vergibt Nummern wieder).
 */
export const STARTVERMERK_MAX_MS = START_GRENZE_MS + 5 * 60_000;

export type StartvermerkZustand = "baut" | "gestartet" | "fehler";

/** Die Datei `start/<sha>.json`: was der Starter über einen Start weiß. Der Starter schreibt sie, nie der Server. */
export interface Startvermerk {
    readonly sha: string;
    /** Beginn des Starts (ISO, Uhr des Rechners). */
    readonly seit: string;
    readonly zustand: StartvermerkZustand;
    /** Bei `fehler` der Satz zum Grund, bei `gestartet` was gestartet wurde (oder warum nichts); sonst `null`. */
    readonly grund: string | null;
    /** Die Prozessnummer des Starters: Lebt sie nicht mehr und steht noch `baut` da, ist der Starter beendet worden. */
    readonly pid: number;
}

/** Der Start, wie die Oberfläche ihn braucht (`ReleaseTestStartvorgang` in `packages/shared`; ein Test hält beide Formen gleich). */
export interface Startvorgang {
    readonly commit: string;
    readonly seit: string;
    readonly zustand: StartvermerkZustand;
    readonly grund: string | null;
}

/** Der Ordner der Startvermerke: `<Datenwurzel>/release-abholer/start`. */
export function startvermerkOrdner(daten: string): string {
    return join(daten, "release-abholer", "start");
}

/** Lebt der Prozess mit dieser Nummer? `EPERM` heißt: ja, aber nicht unser. */
export function lebtPid(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === "EPERM";
    }
}

/**
 * Schreibt den Vermerk ganz oder gar nicht (erst eine Hilfsdatei, dann umbenennen): Ein Leser sieht nie eine halbe Datei. Wirft nicht: Der Vermerk
 * hilft der Anzeige und ist nie der Grund, einen Start zu verweigern oder abzubrechen. Gibt `false` zurück, wenn er nicht geschrieben wurde.
 */
export function schreibeStartvermerk(daten: string, vermerk: Startvermerk): boolean {
    const ordner = startvermerkOrdner(daten);
    const ziel = join(ordner, `${vermerk.sha}.json`);
    const hilfe = join(ordner, `.${vermerk.sha}.${String(process.pid)}.tmp`);
    try {
        mkdirSync(ordner, { recursive: true });
        writeFileSync(hilfe, `${JSON.stringify(vermerk)}\n`);
        try {
            renameSync(hilfe, ziel);
        } catch {
            // Ein Leser hält die Zieldatei gerade offen (Windows): dann direkt schreiben.
            writeFileSync(ziel, `${JSON.stringify(vermerk)}\n`);
            rmSync(hilfe, { force: true });
        }
        return true;
    } catch {
        return false;
    }
}

/** Alle lesbaren Vermerke, der jüngste zuerst. Kaputte Dateien, fremde Namen und Vermerke, deren Name nicht zur SHA passt, zählen nicht. */
export function leseStartvermerke(daten: string): Startvermerk[] {
    const ordner = startvermerkOrdner(daten);
    let namen: string[];
    try {
        namen = readdirSync(ordner).filter((n) => /^[0-9a-f]{40}\.json$/.test(n));
    } catch {
        return [];
    }
    const vermerke: Startvermerk[] = [];
    for (const name of namen.slice(0, 200)) {
        try {
            const roh: unknown = JSON.parse(readFileSync(join(ordner, name), "utf8"));
            if (typeof roh !== "object" || roh === null) continue;
            const v = roh as Record<string, unknown>;
            if (
                v["sha"] !== name.slice(0, 40) ||
                typeof v["seit"] !== "string" ||
                !Number.isFinite(Date.parse(v["seit"])) ||
                (v["zustand"] !== "baut" && v["zustand"] !== "gestartet" && v["zustand"] !== "fehler") ||
                !(v["grund"] === null || typeof v["grund"] === "string") ||
                !Number.isInteger(v["pid"])
            )
                continue;
            vermerke.push({
                sha: v["sha"],
                seit: v["seit"],
                zustand: v["zustand"],
                grund: v["grund"],
                pid: v["pid"] as number,
            });
        } catch {
            /* halb geschrieben oder kaputt: zählt nicht */
        }
    }
    return vermerke.sort((a, b) => Date.parse(b.seit) - Date.parse(a.seit) || (a.sha < b.sha ? 1 : -1));
}

/** Ein Vermerk `baut` mit lebendem Starter, der nicht zu diesem Prozess gehört und die Zeitgrenze nicht überschritten hat. */
function lebenderStart(
    vermerke: readonly Startvermerk[],
    jetzt: number,
    lebt: (pid: number) => boolean,
    ausser: number,
): Startvermerk | undefined {
    return vermerke.find(
        (v) =>
            v.zustand === "baut" &&
            v.pid !== ausser &&
            jetzt - Date.parse(v.seit) <= STARTVERMERK_MAX_MS &&
            lebt(v.pid),
    );
}

/**
 * Der jüngste Start, soweit er noch zählt: `baut` (der Starter lebt) oder `fehler` (mit Grund). Nur lesen, keine Nebenwirkung.
 * - `baut` ohne lebenden Starter (Prozess beendet, etwa mit dem Neustart des Rechners) oder über der Zeitgrenze gilt als `fehler`.
 * - `gestartet` zählt nicht: Dann steht der Lauf selbst da.
 * - Ein Start, der VOR dem Start des jüngsten Laufs liegt, zählt nicht: Der Lauf ist neuer, der Start erledigt.
 */
export function leseStartvorgang(
    optionen: {
        readonly daten?: string;
        readonly klon?: string;
        readonly jetzt?: () => number;
        readonly lebtStarter?: (pid: number) => boolean;
    } = {},
): Startvorgang | undefined {
    const { daten, klon } = orte(optionen);
    const jetzt = (optionen.jetzt ?? Date.now)();
    const lebt = optionen.lebtStarter ?? lebtPid;
    const vermerk = leseStartvermerke(daten)[0];
    if (vermerk === undefined) return undefined;
    const seit = Date.parse(vermerk.seit);
    if (seit <= (juengsterLauf(join(klon, ".release-runs"))?.start ?? -Infinity)) return undefined;
    let zustand = vermerk.zustand;
    let grund = vermerk.grund;
    if (zustand === "baut") {
        if (jetzt - seit > STARTVERMERK_MAX_MS) {
            zustand = "fehler";
            grund = "Der Start hat die Zeitgrenze überschritten, ohne dass der Runner lief.";
        } else if (!lebt(vermerk.pid)) {
            zustand = "fehler";
            grund = `Der Starter wurde beendet, bevor der Runner lief (sein Prozess ${String(vermerk.pid)} lebt nicht mehr). Ausgabe: release-abholer\\starter-${vermerk.sha.slice(0, 12)}.log`;
        }
    }
    if (zustand === "gestartet") return undefined;
    return { commit: vermerk.sha, seit: vermerk.seit, zustand, grund };
}

/** Der Vermerk, den dieser Prozess gerade offen hält (nur einer je Prozess); die Zeitgrenze und ein Absturz schließen ihn als `fehler`. */
let offenerVermerk: { readonly daten: string; readonly vermerk: Startvermerk } | undefined;

/** Schließt den offenen Vermerk dieses Prozesses als `fehler`. Für die Zeitgrenze und unerwartete Fehler des Aufrufs von der Kommandozeile. */
export function schliesseOffenenStartvermerk(grund: string): void {
    if (offenerVermerk === undefined) return;
    const { daten, vermerk } = offenerVermerk;
    offenerVermerk = undefined;
    schreibeStartvermerk(daten, { ...vermerk, zustand: "fehler", grund: grund.slice(0, 300) });
}

// ───────────────────────── Der Start ─────────────────────────

export interface StartOptionen {
    /** Die SHA (40 Hexziffern), für die der Release-Test ausdrücklich gestartet wird. Ohne: der jüngste offene Auftrag aus `refs/notes/release-auftrag`. */
    readonly commit?: string;
    /** Die Datenwurzel (Vorgabe `AVESMAPS_DATEN`, sonst `C:/avesmaps3d-data`): `release-abholer\` (Protokoll), `release-fixtures\` (Pakete), `release-werkzeug\` (Klon). */
    readonly daten?: string;
    /** Der Werkzeugklon (Vorgabe `<Datenwurzel>\release-werkzeug`). */
    readonly klon?: string;
    /** Das Repository, aus dem ein fehlender Klon Remote und Git-Identität bekommt (Vorgabe: das, in dem diese Datei liegt). */
    readonly quelle?: string;
    /** Nur entscheiden, nichts bauen oder starten. */
    readonly trocken?: boolean;
    readonly jetzt?: () => Date;
    /** Das Testpaket bauen (Ordner zurück). Vorgabe: `release-fixtures.ts` als Kindprozess mit Zeitgrenze. */
    readonly baueFixtures?: (sha: string) => Promise<string>;
    /** Den Runner unabhängig starten (PID zurück). Vorgabe: `release-start.ps1`. `uebernehmen` ist bei einer Wiederholung der Ordnername des früheren Laufs. */
    readonly starteRunner?: (
        sha: string,
        fixtures: string,
        uebernehmen?: string,
        freigabe?: string,
        volltest?: VolltestStart,
    ) => Promise<number | undefined>;
    /**
     * Ein Teil des Volltests (WI-0264; Vali 2026-10-31: „Schnelltest und Volltest“): `tor` (Teil 1, der Schnelltest) oder `voll` (Teil 2, der volle
     * Lauf). Der Runner läuft mit diesem Profil und nur als Bericht (keine Notiz nach origin, nie eine Auslieferung); auch ein grün geprüfter Stand
     * läuft. Nie mit `freigabe` oder `wiederholen`. Teil 2 nennt dem Runner den Lauf von Teil 1, wenn er ihn vorfindet (`--vorlauf`).
     */
    readonly volltest?: VolltestTeil;
    /**
     * Die Kennung der Freigabe (`RT-…`, WI-0248), mit der ein Betreiber den Test gestartet hat: Der Runner trägt sie in den Nachweis, und nur dann geht
     * ein grüner Lauf automatisch nach Production. Ohne: ein Lauf von Hand, keine Auslieferung.
     */
    readonly freigabe?: string;
    /**
     * „Rote Teile wiederholen“ (WI-0248): Für `commit` laufen nur die roten oder fehlenden Teile des früheren Laufs neu; die grünen übernimmt der Runner,
     * wenn die Umgebung dieselbe ist. Braucht `commit`. Ohne früheren, nicht grünen Lauf: Ergebnis `kein-roter-lauf`.
     */
    readonly wiederholen?: boolean;
    /** Lebt ein Runner-Prozess? `undefined`: nicht feststellbar. */
    readonly lebtRunner?: () => boolean | undefined;
    /** Wie lange auf `status.json` des gestarteten Runners gewartet wird. */
    readonly statusWarteMs?: number;
    /** Lebt der Starter mit dieser Prozessnummer? Vorgabe: die Abfrage des Prozesses (für den Vermerk eines anderen Starts). */
    readonly lebtStarter?: (pid: number) => boolean;
}
export type StartStatus =
    | "gestartet"
    | "laeuft"
    | "gruen"
    | "kein-auftrag"
    | "kein-roter-lauf"
    | "sperre-ohne-prozess"
    | "trocken"
    | "fehler";
export interface StartErgebnis {
    readonly status: StartStatus;
    /** Die SHA, um die es ging (leer bei `kein-auftrag` und bei `fehler` vor der Wahl). */
    readonly sha?: string;
    /** Ein Satz: bei `gestartet` was gestartet wurde, sonst der Grund, warum nicht. */
    readonly grund: string;
    /** Pfad der `status.json` des Laufs (bei `gestartet`; bei `laeuft` die des aktiven Laufs). */
    readonly statuspfad?: string;
    readonly pid?: number;
    /** Die OPS-ID, wenn der Auftrag aus der Notiz kam. */
    readonly ops?: string;
    /** Ein früherer nicht grüner Lauf derselben SHA wurde umbenannt: sein neuer Ordnername. */
    readonly verschoben?: string;
    /**
     * Nur bei einer Wiederholung: der frühere Lauf, den sie fortsetzt (Ordnername unter `.release-runs`), und die Teile, die sie übernehmen KANN
     * (grün, mit Beleg, Rohbericht unverändert). Ob sie es tut, entscheidet der Runner nach dem Vergleich der Umgebung.
     */
    readonly wiederholt?: { readonly von: string; readonly uebernehmbar: readonly string[] };
    /**
     * Dieser Starter führt Startvermerke (`start/<sha>.json`) und liefert sie mit `--stand --json` als `startvorgang`. Der Server wählt für den
     * Start bevorzugt einen Starter mit diesem Zeichen: Ein älterer Starter im Werkzeugklon würde den Start nach einem Neustart des Servers nicht
     * mehr zeigen können.
     */
    readonly startvermerk?: true;
    /** Dieser Starter kennt die Freigabe (WI-0248: `--freigabe`, `--freigeben`, `--freigabe-beenden`, `--bericht`); der Server bevorzugt ihn. */
    readonly freigabe?: true;
    /**
     * Dieser Starter kennt den Volltest (WI-0264: `--volltest tor|voll`). 🔴 Ein älterer läse `--volltest` nicht und startete einen gewöhnlichen Lauf,
     * der seine Notiz nach origin schreibt; der Server startet einen Volltest darum nur mit einem Starter, der dieses Zeichen trägt.
     */
    readonly volltest?: true;
    /** Teil 2 des Volltests: der Ordner von Teil 1, den der Runner als Vorlauf bekam. */
    readonly vorlauf?: string;
}

/** Die Teile des Volltests: erst der Schnelltest (`tor`), dann der volle Lauf (`voll`). */
export const VOLLTEST_TEILE = ["tor", "voll"] as const;
export type VolltestTeil = (typeof VOLLTEST_TEILE)[number];
/** Was der Runner für einen Teil des Volltests bekommt: das Profil, nur Bericht, und bei Teil 2 den Ordner von Teil 1. */
export interface VolltestStart {
    readonly profil: VolltestTeil;
    readonly vorlauf?: string;
}

/** Gibt es einen Runner-Prozess? Windows: ein `node.exe` mit `release-runner.ts` in der Befehlszeile. */
export function lebtRunnerProzess(): boolean | undefined {
    if (process.platform !== "win32") return undefined;
    const lauf = spawnSync(
        "powershell.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*release-runner.ts*' }).Count",
        ],
        { encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    if (lauf.status !== 0) return undefined;
    const anzahl = Number(lauf.stdout.trim());
    return Number.isInteger(anzahl) ? anzahl > 0 : undefined;
}

function standardBaueFixtures(klon: string, daten: string): (sha: string) => Promise<string> {
    return async (sha) => {
        const log = join(daten, "release-abholer", `fixtures-${sha.slice(0, 12)}.log`);
        writeFileSync(log, "");
        const code = await releaseProzess(
            process.execPath,
            [join(klon, "scripts", "dev", "release-fixtures.ts"), "--commit", sha, "--aus", daten, "--werkzeug", klon],
            { cwd: klon, env: process.env, log, timeoutMs: FIXTURES_GRENZE_MS },
        );
        if (code !== 0) {
            const ende = readFileSync(log, "utf8").trim().split(/\r?\n/).slice(-2).join(" | ");
            throw new Error(`Testpaket nicht gebaut (Exit ${String(code)}): ${ende}`);
        }
        return join(daten, "release-fixtures", sha);
    };
}

function standardStarteRunner(
    klon: string,
): (
    sha: string,
    fixtures: string,
    uebernehmen?: string,
    freigabe?: string,
    volltest?: VolltestStart,
) => Promise<number | undefined> {
    return (sha, fixtures, uebernehmen, freigabe, volltest) => {
        if (process.platform !== "win32") throw new Error("Der Runner-Start ist nur auf Windows eingerichtet");
        const ausgabe = execFileSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                join(klon, "scripts", "dev", "release-start.ps1"),
                "-Commit",
                sha,
                "-Fixtures",
                fixtures,
                ...(uebernehmen === undefined ? [] : ["-Uebernehmen", uebernehmen]),
                ...(freigabe === undefined ? [] : ["-Freigabe", freigabe]),
                ...(volltest === undefined
                    ? []
                    : [
                          "-Profil",
                          volltest.profil,
                          "-NurBericht",
                          ...(volltest.vorlauf === undefined ? [] : ["-Vorlauf", volltest.vorlauf]),
                      ]),
            ],
            { cwd: klon, env: GIT_UMGEBUNG, encoding: "utf8", timeout: 60_000, windowsHide: true },
        );
        const pid = /PID (\d+)/.exec(ausgabe)?.[1];
        return Promise.resolve(pid === undefined ? undefined : Number(pid));
    };
}

const warte = (ms: number): Promise<void> => new Promise((fertig) => setTimeout(fertig, ms));

/**
 * Startet den Release-Test (Ablauf oben). Wirft nicht: Jeder Fehler wird Ergebnis `fehler` mit einem Satz und steht im Protokoll.
 * Ohne `commit` entscheidet der jüngste offene Auftrag aus `refs/notes/release-auftrag`; gibt es keinen, ist das Ergebnis `kein-auftrag`.
 *
 * Ein echter Start (nicht `trocken`) führt den Startvermerk: `baut` mit der Prozessnummer, sobald die SHA feststeht, und am Ende `gestartet` oder
 * `fehler` mit dem Grund. Ein Start, neben dem ein anderer Starter noch `baut`, wird abgewiesen (Status `laeuft`).
 */
export async function starteReleaseTest(o: StartOptionen = {}): Promise<StartErgebnis> {
    const daten = resolve(o.daten ?? process.env["AVESMAPS_DATEN"] ?? STANDARD_DATEN);
    const jetzt = o.jetzt ?? ((): Date => new Date());
    const lebt = o.lebtStarter ?? lebtPid;
    const halter: { vermerk: Startvermerk | undefined } = { vermerk: undefined };
    /** Steht die SHA fest: einen anderen lebenden Start abweisen, sonst den eigenen Vermerk anlegen. */
    const beginne = (sha: string): StartErgebnis | undefined => {
        const fremd = lebenderStart(leseStartvermerke(daten), jetzt().getTime(), lebt, process.pid);
        if (fremd !== undefined)
            return {
                status: "laeuft",
                sha,
                grund: `Ein anderer Start baut gerade das Testpaket (${fremd.sha.slice(0, 12)}, seit ${fremd.seit}); nichts gestartet.`,
            };
        if (o.trocken === true) return undefined;
        const neu: Startvermerk = { sha, seit: jetzt().toISOString(), zustand: "baut", grund: null, pid: process.pid };
        halter.vermerk = neu;
        schreibeStartvermerk(daten, neu);
        offenerVermerk = { daten, vermerk: neu };
        return undefined;
    };
    let ergebnis: StartErgebnis;
    try {
        ergebnis = await starteKern(o, beginne);
    } catch (e) {
        // Der Kern wirft nicht; kommt doch etwas durch, ist der Vermerk trotzdem zu schließen.
        ergebnis = {
            status: "fehler",
            grund: kurz(e),
            ...(halter.vermerk === undefined ? {} : { sha: halter.vermerk.sha }),
        };
    }
    const vermerk = halter.vermerk;
    if (vermerk !== undefined && offenerVermerk?.vermerk === vermerk) {
        offenerVermerk = undefined;
        // `laeuft` und `gruen` heißen: Es ist nichts mehr zu bauen; der Lauf selbst zeigt den Stand.
        const gelungen = ["gestartet", "laeuft", "gruen"].includes(ergebnis.status);
        schreibeStartvermerk(daten, {
            ...vermerk,
            zustand: gelungen ? "gestartet" : "fehler",
            grund: ergebnis.grund.slice(0, 300),
        });
    }
    return { ...ergebnis, startvermerk: true, freigabe: true, volltest: true };
}

async function starteKern(
    o: StartOptionen,
    beginne: (sha: string) => StartErgebnis | undefined,
): Promise<StartErgebnis> {
    const jetzt = o.jetzt ?? ((): Date => new Date());
    const daten = resolve(o.daten ?? process.env["AVESMAPS_DATEN"] ?? STANDARD_DATEN);
    const klon = resolve(o.klon ?? join(daten, "release-werkzeug"));
    const quelle = resolve(o.quelle ?? fileURLToPath(new URL("../../", import.meta.url)));
    const protokollOrdner = join(daten, "release-abholer");
    mkdirSync(protokollOrdner, { recursive: true });
    const protokoll = (text: string): void => {
        schreibeProtokoll(join(protokollOrdner, "abholer.log"), text, jetzt());
    };
    const fehler = (grund: string, sha?: string, ops?: string): StartErgebnis => {
        protokoll(
            `Fehler${sha === undefined ? "" : ` (${ops === undefined ? "" : `${ops}, `}${sha.slice(0, 12)})`}: ${grund}`,
        );
        return {
            status: "fehler",
            grund,
            ...(sha === undefined ? {} : { sha }),
            ...(ops === undefined ? {} : { ops }),
        };
    };

    if (o.freigabe !== undefined && !KENNUNG_MUSTER.test(o.freigabe))
        return fehler("--freigabe benötigt eine Kennung RT-<uuid>");
    if (o.commit !== undefined && !/^[0-9a-f]{40}$/.test(o.commit))
        return fehler("--commit benötigt eine vollständige SHA (40 Hexziffern, kleingeschrieben)");
    // 🔴 Der Volltest (WI-0264) prüft nur: nie mit einer Freigabe, nie als Wiederholung eines Schnelltests, nur für einen genannten Stand.
    if (o.volltest !== undefined) {
        if (!(VOLLTEST_TEILE as readonly string[]).includes(o.volltest))
            return fehler("--volltest braucht tor oder voll");
        if (o.freigabe !== undefined) return fehler("Ein Volltest gibt nichts frei: --volltest ohne --freigabe");
        if (o.wiederholen === true)
            return fehler("Ein Volltest wiederholt keine roten Teile: --volltest ohne --wiederholen");
        if (o.commit === undefined) return fehler("--volltest braucht --commit <sha40>");
    }
    // Der Vermerk steht VOR dem Klon und den Notizen (die dauern Sekunden bis Minuten): Die Oberfläche sieht den Start sofort.
    if (o.commit !== undefined) {
        const abgewiesen = beginne(o.commit);
        if (abgewiesen !== undefined) return abgewiesen;
    }
    try {
        if (sichereKlon(klon, quelle)) protokoll(`Werkzeugklon angelegt: ${klon}`);
    } catch (e) {
        return fehler(`Werkzeugklon nicht bereit: ${kurz(e)}`);
    }

    // 1. Welche SHA, und was sagt Origin dazu? Kein Rückgriff auf alte lokale Notizen: Was nicht frisch geholt ist, gilt nicht.
    let sha = o.commit;
    let ops: string | undefined;
    let ergebnis: ErgebnisNotiz | undefined;
    try {
        if (sha === undefined) {
            const notizen = holeAuftragsnotizen(klon);
            const auftrag = notizen === undefined ? undefined : waehleAuftrag(notizen);
            if (auftrag === undefined)
                return {
                    status: "kein-auftrag",
                    grund:
                        "Es gibt keinen offenen Auftrag in refs/notes/release-auftrag und --commit ist nicht angegeben. " +
                        "Aufruf: node scripts/dev/release-abholer.ts --commit <sha40>",
                };
            sha = auftrag.sha;
            ops = auftrag.ops;
            const abgewiesen = beginne(sha);
            if (abgewiesen !== undefined) return { ...abgewiesen, ops };
        }
        ergebnis = holeErgebnis(klon, sha);
    } catch (e) {
        return fehler(`Notizen nicht geholt: ${kurz(e)}`, sha, ops);
    }
    const teilName = o.volltest === "tor" ? "Volltest Teil 1, " : o.volltest === "voll" ? "Volltest Teil 2, " : "";
    const kennung = `${teilName}${ops === undefined ? "" : `${ops}, `}${sha.slice(0, 12)}`;
    const mitOps = ops === undefined ? {} : { ops };

    // 2. Entscheiden.
    const laeufe = join(klon, ".release-runs");
    const laufOrdner = existsSync(join(laeufe, sha));
    const vorigerLauf: VorigerLauf | undefined = laufOrdner
        ? leseVorigenLauf(join(laeufe, sha))
        : ergebnis?.status === "rot"
          ? { start: ergebnis.zeit, gruen: false }
          : undefined;
    // 🔴 Eine Sperre ohne lebenden Runner, deren Lauf nachweislich zu Ende ist (Abbruch, Rot, Zeit, Grün), ist ein Überbleibsel und darf weg (WI-0248: Der Abbruch
    // über die Karte ließ die Sperre stehen, und Valis nächster Start wurde abgewiesen). Ein Lauf ohne Endzustand (Absturz) bleibt: melden, nicht entsperren.
    // Eine Vorprüfung (`trocken`) ändert nichts: Sie sagt nur, dass sie die Sperre freigeben WÜRDE.
    let sperrePruefung = pruefeSperre(laeufe, o.lebtRunner ?? lebtRunnerProzess);
    if (sperrePruefung.art === "frei" && o.trocken !== true) {
        if (gibSperreFrei(join(laeufe, "aktiv"))) {
            protokoll(
                `Die Sperre .release-runs\\aktiv gehörte dem Lauf ${sperrePruefung.sha.slice(0, 12)} (${sperrePruefung.status}, beendet ${sperrePruefung.ende}); kein Release-Lauf lebt, die Sperre ist freigegeben (${kennung}).`,
            );
        } else {
            sperrePruefung = { art: "offen", grund: "die Sperre ließ sich nicht entfernen" };
        }
    }
    const sperreSteht = sperrePruefung.art === "lebt" || sperrePruefung.art === "offen";
    const entscheidung = entscheide({
        ergebnis: ergebnis?.status,
        laufOrdner,
        sperre: sperreSteht,
        vorigerLauf,
        volltest: o.volltest !== undefined,
    });
    if (entscheidung.aktion === "nichts") {
        if (entscheidung.grund === "gruen") {
            const stand = releaseTestStand(sha, { klon, daten });
            return {
                status: "gruen",
                sha,
                grund: `Der Stand ${kennung} ist schon grün geprüft; nichts gestartet.`,
                ...(stand.statuspfad === undefined || !laufOrdner ? {} : { statuspfad: stand.statuspfad }),
                ...mitOps,
            };
        }
        const aktiv = releaseTestStand(undefined, { klon, daten });
        const mitPfad = aktiv.statuspfad === undefined ? {} : { statuspfad: aktiv.statuspfad };
        if (sperrePruefung.art === "offen") {
            const grund = `Die Sperre .release-runs\\aktiv besteht, aber kein Release-Lauf lebt (${sperrePruefung.grund}); nichts gestartet und nicht entsperrt (${kennung}). Erst prüfen, dann die Sperre von Hand entfernen.`;
            protokoll(grund);
            return { status: "sperre-ohne-prozess", sha, grund, ...mitPfad, ...mitOps };
        }
        return {
            status: "laeuft",
            sha,
            grund: `Ein Release-Lauf ist aktiv${aktiv.sha === undefined ? "" : ` (${aktiv.sha.slice(0, 12)})`}; nichts gestartet (${kennung}).`,
            ...mitPfad,
            ...mitOps,
        };
    }
    // Eine Wiederholung braucht einen früheren Lauf derselben SHA, der nicht grün ist und auf diesem Rechner liegt (die Rohberichte der grünen Teile).
    let frueher: AltLauf | undefined;
    let wiederholt: StartErgebnis["wiederholt"];
    if (o.wiederholen === true) {
        // Ein Lauf des Volltests ist nie der, den „Rote Teile wiederholen“ fortsetzt (WI-0264): anderes Profil, und er schrieb keine Notiz.
        frueher = laeufeFuer(laeufe, sha).find((l) => l.status !== "gruen" && !l.nurBericht);
        if (frueher === undefined) {
            const grund = `Für ${kennung} liegt auf diesem Rechner kein früherer Lauf, der nicht grün ist; nichts zu wiederholen.`;
            protokoll(grund);
            return { status: "kein-roter-lauf", sha, grund, ...mitOps };
        }
        wiederholt = { von: frueher.name, uebernehmbar: [...uebernehmbareTeile(frueher, fingerprint).gut] };
    }
    if (o.trocken === true)
        return {
            status: "trocken",
            sha,
            grund:
                wiederholt === undefined
                    ? `Würde ${kennung} ${entscheidung.neuerVersuch ? "neu " : ""}starten.${sperrePruefung.art === "frei" ? ` Die Sperre des beendeten Laufs ${sperrePruefung.sha.slice(0, 12)} würde zuerst freigegeben.` : ""}`
                    : `Würde ${kennung} wiederholen: ${wiederholt.uebernehmbar.length === 0 ? "kein grüner Teil lässt sich übernehmen" : `übernehmbar ${wiederholt.uebernehmbar.join(", ")}`}; der Rest läuft neu (bei veränderter Umgebung alles).`,
            ...(wiederholt === undefined ? {} : { wiederholt }),
            ...mitOps,
        };

    // 3. Starten.
    try {
        // Werkzeug nachziehen: Es läuft kein Lauf (Sperre geprüft), also darf der Klon wechseln.
        git(klon, ["fetch", "--no-tags", "--quiet", "origin", "+refs/heads/master:refs/remotes/origin/master"]);
        git(klon, ["checkout", "--detach", "--quiet", "origin/master"]);
        try {
            git(klon, ["merge-base", "--is-ancestor", sha, "origin/master"]);
        } catch {
            return fehler(`Der Stand ${sha} ist nicht in origin/master; nichts gestartet`, sha, ops);
        }
        const fixtures = await (o.baueFixtures ?? standardBaueFixtures(klon, daten))(sha);
        protokoll(`Testpaket für ${kennung} bereit: ${fixtures}`);
        let verschoben: string | undefined;
        if (entscheidung.neuerVersuch && laufOrdner && vorigerLauf !== undefined) {
            // Ausdrücklicher neuer Start nach einem nicht grünen Lauf (beim Volltest nach jedem Lauf): Der alte Ergebnisordner bleibt erhalten, unter neuem Namen.
            verschoben = archiviereLauf(laeufe, sha, vorigerLauf.start);
            protokoll(
                `Neuer Start für ${kennung} nach ${vorigerLauf.gruen ? "grünem" : "nicht grünem"} Lauf; früherer Lauf liegt jetzt in .release-runs/${verschoben}`,
            );
        }
        // Bei einer Wiederholung heißt der frühere Lauf jetzt so, wie er unter `.release-runs` liegt: umbenannt, wenn er `<sha>` hieß.
        const uebernehmen = frueher === undefined ? undefined : frueher.name === sha ? verschoben : frueher.name;
        if (frueher !== undefined) protokoll(`Wiederholung für ${kennung} von ${uebernehmen ?? frueher.name}`);
        // Teil 2 des Volltests: Der eben umbenannte Ordner ist Teil 1, wenn er ein Lauf des Volltests im Profil `tor` war. Sein Bericht kommt auf die Seite.
        const vorlauf =
            o.volltest === "voll" &&
            verschoben !== undefined &&
            vorigerLauf?.nurBericht === true &&
            vorigerLauf.profil === "tor"
                ? verschoben
                : undefined;
        const volltest: VolltestStart | undefined =
            o.volltest === undefined
                ? undefined
                : { profil: o.volltest, ...(vorlauf === undefined ? {} : { vorlauf }) };
        const pid = await (o.starteRunner ?? standardStarteRunner(klon))(
            sha,
            fixtures,
            uebernehmen,
            o.freigabe,
            volltest,
        );
        // Der Runner legt seinen Ordner und seinen Status in den ersten Sekunden an; ohne sie ist der Start gescheitert.
        const statuspfad = join(laeufe, sha, "status.json");
        const wartezeit = o.statusWarteMs ?? STATUS_WARTE_MS;
        const bis = Date.now() + wartezeit;
        while (!existsSync(statuspfad) && Date.now() < bis) await warte(1000);
        if (!existsSync(statuspfad))
            return fehler(
                `Runner gestartet${pid === undefined ? "" : ` (PID ${String(pid)})`}, aber kein Status nach ${String(Math.round(wartezeit / 1000))} s: .release-runs/${sha} prüfen`,
                sha,
                ops,
            );
        const grund = `Release-Test für ${kennung} ${wiederholt === undefined ? "" : "(Wiederholung) "}gestartet${pid === undefined ? "" : ` (PID ${String(pid)})`}; Status: ${statuspfad}`;
        protokoll(grund);
        return {
            status: "gestartet",
            sha,
            grund,
            statuspfad,
            ...(pid === undefined ? {} : { pid }),
            ...(verschoben === undefined ? {} : { verschoben }),
            ...(vorlauf === undefined ? {} : { vorlauf }),
            // Der frühere Lauf heißt jetzt so, wie der Runner ihn bekam (nach dem Umbenennen), nicht mehr `<sha>`.
            ...(wiederholt === undefined ? {} : { wiederholt: { ...wiederholt, von: uebernehmen ?? wiederholt.von } }),
            ...mitOps,
        };
    } catch (e) {
        return fehler(kurz(e), sha, ops);
    }
}

// ───────────────────────── Aufruf ─────────────────────────

function istHauptprogramm(): boolean {
    const datei = process.argv[1];
    return datei !== undefined && pathToFileURL(resolve(datei)).href === import.meta.url;
}

if (istHauptprogramm()) {
    // Ruft der lokale Server den Starter auf und stirbt dabei (Neustart mit `node --watch`), bricht die Röhre zu stdout. Der Runner läuft dann schon
    // unabhängig; der Starter soll daran nicht mit einem Absturz enden.
    process.stdout.on("error", () => undefined);
    const argv = process.argv.slice(2);
    const wert = (name: string): string | undefined => {
        const i = argv.indexOf(name);
        const naechster = i >= 0 ? argv[i + 1] : undefined;
        return naechster !== undefined && !naechster.startsWith("--") ? naechster : undefined;
    };
    const daten = wert("--daten");
    const klon = wert("--klon");
    const orteOptionen = {
        ...(daten === undefined ? {} : { daten }),
        ...(klon === undefined ? {} : { klon }),
    };
    // Mit --json steht das Ergebnis als EINE JSON-Zeile auf stdout (für die lokale Systemsteuerung); ohne bleibt die Ausgabe, wie sie war.
    const json = argv.includes("--json");
    const ausgabe = (text: string, objekt: unknown): void => {
        process.stdout.write(`${json ? JSON.stringify(objekt) : text}\n`);
    };
    // Wer den Starter beendet oder abstürzen sieht, soll den Grund in der Oberfläche lesen, nicht erst nach dem Tod des Prozesses raten müssen.
    const bricheAb = (grund: string): never => {
        schliesseOffenenStartvermerk(grund);
        process.stderr.write(`Fehler: ${grund}\n`);
        process.exit(1);
    };
    const grenze = setTimeout(() => {
        bricheAb("Zeitgrenze erreicht, Starter beendet (ein schon gestarteter Runner läuft weiter)");
    }, START_GRENZE_MS);
    grenze.unref();
    process.on("uncaughtException", (e) => bricheAb(`Der Starter ist abgestürzt: ${kurz(e)}`));
    process.on("unhandledRejection", (e) => bricheAb(`Der Starter ist abgestürzt: ${kurz(e)}`));
    for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const)
        process.once(signal, () => bricheAb(`Der Starter wurde beendet (${signal})`));
    // WI-0248: Die Freigabe schreiben und beenden, den Bericht lesen. Der Server ruft sie mit `--trocken` (ein älterer Starter entscheidet dann nur und
    // startet nichts); für diese drei heißt `--trocken` nichts.
    if (argv.includes("--freigeben") || argv.includes("--freigabe-beenden")) {
        const beenden = argv.includes("--freigabe-beenden");
        const sha = wert(beenden ? "--freigabe-beenden" : "--freigeben") ?? "";
        const kennung = wert("--kennung") ?? "";
        const ergebnis: FreigabeSchreibErgebnis = !/^[0-9a-f]{40}$/u.test(sha)
            ? { status: "fehler", sha, kennung, grund: "Die Freigabe braucht eine vollständige SHA.", freigabe: true }
            : !KENNUNG_MUSTER.test(kennung)
              ? { status: "fehler", sha, kennung, grund: "--kennung braucht RT-<uuid>.", freigabe: true }
              : beenden
                ? beendeFreigabe({ sha, kennung, grund: wert("--grund") ?? "abgebrochen", ...orteOptionen })
                : schreibeFreigabe({
                      sha,
                      kennung,
                      von: wert("--von") ?? "",
                      ...(wert("--zeit") === undefined ? {} : { zeit: wert("--zeit") as string }),
                      ...orteOptionen,
                  });
        ausgabe(`${ergebnis.status}: ${ergebnis.grund}`, ergebnis);
        process.exitCode = ergebnis.status === "fehler" ? 1 : 0;
    } else if (argv.includes("--bericht")) {
        const sha = wert("--bericht");
        const ergebnis = leseBericht(sha, orteOptionen);
        ausgabe(ergebnis.text ?? `${ergebnis.status}: ${ergebnis.grund ?? ""}`, ergebnis);
        process.exitCode = ergebnis.status === "bericht" ? 0 : 1;
    } else if (argv.includes("--kandidat")) {
        // Nur lesen: holt Notizen. Ohne Werkzeugklon liest er im Repository dieser Datei (der Klon entsteht erst beim Start).
        const klonOrt = orte(orteOptionen).klon;
        const quelle = resolve(fileURLToPath(new URL("../../", import.meta.url)));
        const repo = existsSync(join(klonOrt, ".git")) ? klonOrt : quelle;
        try {
            const kandidat = leseKandidat(repo);
            ausgabe(
                [
                    kandidat.stage === null
                        ? "Stage: kein Stand bekannt"
                        : `Stage: ${kandidat.stage.sha} (${kandidat.stage.zeit})`,
                    kandidat.auftrag === null
                        ? "Auftrag: keiner"
                        : `Auftrag: ${kandidat.auftrag.sha} (${kandidat.auftrag.zeit}, ${kandidat.auftrag.ops})`,
                ].join("\n"),
                kandidat,
            );
        } catch (e) {
            const grund = `Notizen nicht geholt: ${kurz(e)}`;
            ausgabe(`fehler: ${grund}`, { fehler: grund });
            process.exitCode = 1;
        }
    } else if (argv.includes("--abbrechen")) {
        const sha = wert("--abbrechen");
        const ergebnis: AbbruchErgebnis =
            sha === undefined
                ? {
                      status: "fehler",
                      grund: "--abbrechen benötigt eine SHA. Aufruf: node release-abholer.ts --abbrechen <sha40>",
                  }
                : abbrecheReleaseTest(sha, orteOptionen);
        ausgabe(`${ergebnis.status}: ${ergebnis.grund}`, ergebnis);
        process.exitCode = ergebnis.status === "abbruch-angefordert" ? 0 : 1;
    } else if (argv.includes("--stand")) {
        if (json) {
            ausgabe("", releaseTestAnsicht(wert("--stand"), orteOptionen));
        } else {
            const stand = releaseTestStand(wert("--stand"), orteOptionen);
            const teile = [
                stand.zustand,
                stand.sha === undefined ? undefined : `Commit ${stand.sha.slice(0, 12)}`,
                stand.schritt === undefined ? undefined : `Schritt ${stand.schritt}`,
                stand.fertigeTeile.length === 0 ? undefined : `fertig: ${stand.fertigeTeile.join(", ")}`,
                stand.start === undefined ? undefined : `Start ${stand.start}`,
                stand.ende === undefined ? undefined : `Ende ${stand.ende}`,
                stand.grund === undefined ? undefined : `Grund: ${stand.grund}`,
                stand.statuspfad === undefined ? undefined : `Status: ${stand.statuspfad}`,
            ].filter((t): t is string => t !== undefined);
            process.stdout.write(`${teile.join(" · ")}\n`);
        }
    } else {
        // `--wiederholen <sha>` ist ein Start für genau diese SHA, der die grünen Teile des früheren Laufs übernimmt (WI-0248).
        const wiederholen = argv.includes("--wiederholen");
        const commit = wiederholen ? wert("--wiederholen") : wert("--commit");
        if ((argv.includes("--commit") || wiederholen) && commit === undefined) {
            const grund = wiederholen
                ? "--wiederholen benötigt eine SHA. Aufruf: node release-abholer.ts --wiederholen <sha40>"
                : "--commit benötigt eine SHA. Aufruf: node release-abholer.ts --commit <sha40>";
            if (json) ausgabe("", { status: "fehler", grund });
            else process.stderr.write(`Fehler: ${grund}\n`);
            process.exitCode = 1;
        } else {
            const freigabe = wert("--freigabe");
            // `--volltest tor|voll` (WI-0264): ein Teil des Volltests; ein anderer Wert wird von `starteReleaseTest` abgewiesen, nie still ein Schnelltest.
            const volltest = argv.includes("--volltest") ? (wert("--volltest") ?? "") : undefined;
            const ergebnis = await starteReleaseTest({
                ...(commit === undefined ? {} : { commit }),
                ...orteOptionen,
                trocken: argv.includes("--trocken"),
                ...(wiederholen ? { wiederholen: true } : {}),
                ...(freigabe === undefined ? {} : { freigabe }),
                ...(volltest === undefined ? {} : { volltest: volltest as VolltestTeil }),
            });
            ausgabe(`${ergebnis.status}: ${ergebnis.grund}`, ergebnis);
            process.exitCode = ["gestartet", "laeuft", "gruen", "trocken"].includes(ergebnis.status) ? 0 : 1;
        }
    }
}
