// Die Sicht auf einen Release-Test für die lokale Oberfläche (WI-0248 L): Schritte mit Zeiten, erwartete Dauer, Fortschritt und der Bericht zu einem
// Fehlschlag. Nur lesen: Das Modul schreibt nichts, startet nichts und braucht weder Git noch Netz. Der Starter (`release-abholer.ts`) liefert das
// Ergebnis mit `--stand --json`; die Oberfläche rechnet nichts davon neu.
//
// 🔴 Alles hier hängt an den Dateien, die der Runner (`release-runner.ts`) im Ergebnisordner `.release-runs/<sha40>/` hinterlässt:
//   - `status.json` (Start, Ende, Status), `fehler.txt` (die Meldung des Fehlschlags);
//   - je Schritt ein Protokoll `<schritt>.log`, angelegt, wenn der Schritt beginnt. Sein Anlegezeitpunkt ist der Beginn des Schritts, der Beginn des
//     nächsten ist sein Ende; der letzte Schritt endet mit dem Lauf. So braucht der Runner keine zweite Buchführung;
//   - `vitest.json` und `browser-<n>.json`, die Berichte von Vitest und Playwright;
//   - `teile.json`, das Laufbuch (`release-laufbuch.ts`): die Browserteile mit Name und Bereichen, was eine Wiederholung übernahm und wie jeder
//     Schritt endete. Ein Lauf aus der Zeit davor hat keines; dann zeigt die Ansicht, was die Protokolle hergeben.
//
// 🔴 Was nach außen geht, ist bereinigt (`bereinigeZugang`): Verbindungsadressen mit Kennwort, Zugangswerte und Token-ähnliche Zeichenfolgen
// erscheinen nie in der Sicht. Das gilt auch für den Bericht zum Kopieren: Er wird weitergereicht.
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { leseLaufBuch, type LaufBuch } from "./release-laufbuch.ts";
import { playwrightAuswertung } from "./sammellauf-auswertung.ts";

/** Die Schritte des Runners in der Reihenfolge, in der er sie fährt (`release-runner.ts`); `vorbereitung` ist alles vor dem ersten Protokoll. */
export const RELEASE_SCHRITTE = [
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
export type SchrittId = (typeof RELEASE_SCHRITTE)[number];

/**
 * Die Browserteile als Schritte: die vier nach Thema (`voll`), `kern`, die feste Stichprobe von Prüfprofil B (`release-kern.json`), und `kern-echt`,
 * die Kernabläufe des Release-Tors gegen den echten Server (Profil `tor`, `release-tor.json`). Wie `RELEASE_TEST_BROWSERTEILE` im Vertrag; ein Lauf
 * fährt nur die einen, die anderen oder den dritten, ihr Protokoll heißt `<kennung>.log`, ihr Bericht `<kennung>.json`.
 */
export const BROWSER_SCHRITTE = [
    "browser-1",
    "browser-2",
    "browser-3",
    "browser-4",
    "kern",
    "kern-echt",
] as const satisfies readonly SchrittId[];

/**
 * Der Schritt zu der Kennung in der Meldung des Runners (`Browserteil 2 …`, `Browserteil kern …`, `Browserteil kern-echt …`): die Ziffer eines
 * Themenbereichs, `kern` oder `kern-echt`. 🪤 Die Muster unten prüfen `kern-echt` vor `kern`, sonst träfe `\b` schon nach `kern`.
 */
const browserSchrittAus = (kennung: string): SchrittId | undefined => {
    const id = kennung === "kern" || kennung === "kern-echt" ? kennung : `browser-${kennung}`;
    return istSchrittId(id) ? id : undefined;
};

/**
 * Welche Schritte ein Prüfprofil fährt (`profil` aus `status.json`; fehlt es, ist es ein Lauf aus der Zeit vor den Profilen, also `voll`). Alle anderen
 * Schritte laufen in diesem Lauf nie und stehen in der Ansicht als „entfallen“ da, nicht als „offen“ (sie blähten die erwartete Dauer auf).
 */
export function schritteJeProfil(profil: string | undefined): readonly SchrittId[] {
    const gemeinsam = ["vorbereitung", "installation", "shared", "lint", "typen", "korpus-laden", "bau"] as const;
    if (profil === "tor") return [...gemeinsam, "daten", "kern-echt"];
    if (profil === "B") return [...gemeinsam, "format", "tests", "besucherpaket", "kern"];
    return [...gemeinsam, "format", "tests", "besucherpaket", "browser-1", "browser-2", "browser-3", "browser-4"];
}

/**
 * Feste Schätzwerte je Schritt, solange kein abgeschlossener Lauf eine gemessene Dauer geliefert hat (Millisekunden). 🪤 Ungemessen: Sie sind aus
 * den bekannten Größen abgeleitet (Vitest über alle Dateien rund 45 Minuten, Browser in vier Teilen); jeder gemessene Schritt ersetzt seinen
 * Wert, und die Oberfläche nennt eine Zahl, die noch auf ihnen beruht, eine „Schätzung“.
 */
export const SCHRITT_SCHAETZUNG_MS: Readonly<Record<SchrittId, number>> = {
    vorbereitung: 120_000,
    installation: 120_000,
    shared: 20_000,
    lint: 150_000,
    format: 60_000,
    typen: 300_000,
    "korpus-laden": 240_000,
    tests: 2_700_000,
    bau: 240_000,
    besucherpaket: 30_000,
    "browser-1": 1_200_000,
    "browser-2": 1_200_000,
    "browser-3": 1_200_000,
    "browser-4": 1_200_000,
    // Prüfprofil B: 103 Fälle in 7,7 Minuten im ersten Lauf (a947660).
    kern: 600_000,
    // Das Tor (WI-0264): Ziel für den ganzen Lauf unter 30 Minuten; `daten` (Cluster einrichten, Dump einspielen, jeden Schreibweg rufen) und `kern-echt`
    // (20 Kernabläufe gegen den echten Server, ein Arbeiter) ungemessen. Lint, Typen und Bau sind die Schritte von oben.
    daten: 300_000,
    "kern-echt": 600_000,
};

const SCHRITT_IDS: readonly string[] = RELEASE_SCHRITTE;
export const istSchrittId = (wert: string): wert is SchrittId => SCHRITT_IDS.includes(wert);

// ───────────────────────── Zugangsdaten bereinigen ─────────────────────────

const VERBORGEN = "<verborgen>";
const ZUGANGSNAME = "(?:token|secret|passwor[dt]|pwd|api[_-]?key|private[_-]?key|authorization|cookie|credential|salt)";

const ZUGANG_ERSETZUNGEN: readonly (readonly [RegExp, string])[] = [
    // Verbindungsadressen mit Benutzer (und Kennwort): `postgres://app:geheim@127.0.0.1/db` → `postgres://<verborgen>@127.0.0.1/db`.
    [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, `$1${VERBORGEN}@`],
    // Zuerst der Wert nach „Bearer“/„Basic“, sonst bliebe er nach `authorization: Bearer …` stehen.
    [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu, `$1 ${VERBORGEN}`],
    // `NAME=wert`, `name: wert`, `"name": "wert"` für Namen, die ein Geheimnis tragen (auch als Teil: `PGPASSWORD`, `GITHUB_TOKEN`).
    [
        new RegExp(
            `(\\b[\\w-]*${ZUGANGSNAME}[\\w-]*["']?\\s*[=:]\\s*)(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s,;&]+)`,
            "giu",
        ),
        `$1${VERBORGEN}`,
    ],
    // Bekannte Formen von Zugangswerten.
    [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, VERBORGEN],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu, VERBORGEN],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/gu, VERBORGEN],
    [/\bAKIA[0-9A-Z]{16}\b/gu, VERBORGEN],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/gu, VERBORGEN],
    // Lange Zeichenfolgen aus Klein- und Großbuchstaben und Ziffern gemischt (Token). Reines Hex bleibt: SHAs und Prüfsummen sind keine Geheimnisse.
    [/\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/gu, VERBORGEN],
];

/** Der Text ohne Zugangsdaten: Verbindungsadressen mit Kennwort, benannte Geheimnisse, Bearer-Werte und Token-ähnliche Zeichenfolgen. */
export function bereinigeZugang(text: string): string {
    let aus = text;
    for (const [muster, ersatz] of ZUGANG_ERSETZUNGEN) aus = aus.replace(muster, ersatz);
    return aus;
}

// eslint-disable-next-line no-control-regex -- ANSI-Farbcodes aus der Ausgabe der Werkzeuge
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;

/** Eine Zeile für die Anzeige: ohne Farbcodes und Zugangsdaten, auf `max` Zeichen gekürzt. */
export function zeileFuerAnzeige(zeile: string, max = 400): string {
    const sauber = bereinigeZugang(zeile.replace(ANSI, "").replace(/\r/g, "")).trimEnd();
    return sauber.length > max ? `${sauber.slice(0, max - 1)}…` : sauber;
}

// ───────────────────────── Zeiten der Schritte ─────────────────────────

export interface SchrittZeit {
    readonly id: SchrittId;
    /** Beginn in Millisekunden seit 1970. */
    readonly start: number;
    /** Ende; `null`, solange der Schritt läuft. */
    readonly ende: number | null;
    /** Das Ende ist durch den Beginn des nächsten Schritts (oder den grünen Abschluss) belegt: Die Dauer taugt als Erwartung. */
    readonly belegt: boolean;
}

function anlegezeit(pfad: string): number | undefined {
    try {
        const s = statSync(pfad);
        return Math.round(s.birthtimeMs > 0 ? Math.min(s.birthtimeMs, s.mtimeMs) : s.mtimeMs);
    } catch {
        return undefined;
    }
}

/**
 * Die Zeiten der Schritte eines Laufs aus seinen Protokollen. `laufEnde` ist das Ende des Laufs (`null`: er läuft); `gruen`: der Lauf endete
 * grün, dann ist auch das Ende des letzten Schritts belegt. Ein Schritt ohne Protokoll ist nicht gelaufen und fehlt.
 */
export function leseSchrittzeiten(
    ordner: string,
    laufStart: number,
    laufEnde: number | null,
    gruen: boolean,
): SchrittZeit[] {
    const begonnen: { id: SchrittId; start: number }[] = [];
    for (const id of RELEASE_SCHRITTE) {
        if (id === "vorbereitung") continue;
        const start = anlegezeit(join(ordner, `${id}.log`));
        if (start !== undefined) begonnen.push({ id, start });
    }
    begonnen.sort((a, b) => a.start - b.start);
    const reihe: { id: SchrittId; start: number }[] = [{ id: "vorbereitung", start: laufStart }, ...begonnen];
    return reihe.map((schritt, i) => {
        const naechster = reihe[i + 1];
        if (naechster !== undefined)
            return {
                id: schritt.id,
                start: schritt.start,
                ende: Math.max(naechster.start, schritt.start),
                belegt: true,
            };
        return {
            id: schritt.id,
            start: schritt.start,
            ende: laufEnde === null ? null : Math.max(laufEnde, schritt.start),
            belegt: gruen && laufEnde !== null,
        };
    });
}

// ───────────────────────── Erwartete Dauer ─────────────────────────

export interface Erwartung {
    readonly ms: Readonly<Record<SchrittId, number>>;
    /** Je Schritt: Der Wert ist die feste Schätzung, kein gemessener. */
    readonly schaetzung: Readonly<Record<SchrittId, boolean>>;
}

const LAUF_ORDNER = /^[0-9a-f]{40}(?:-\d{8}T\d{6}Z(?:-\d+)?)?$/u;

interface StatusDatei {
    readonly status: string;
    readonly start: number;
    readonly ende: number | null;
}

function leseStatusDatei(ordner: string): StatusDatei | undefined {
    try {
        const roh: unknown = JSON.parse(readFileSync(join(ordner, "status.json"), "utf8"));
        if (typeof roh !== "object" || roh === null) return undefined;
        const s = roh as { status?: unknown; start?: unknown; ende?: unknown };
        const start = typeof s.start === "string" ? Date.parse(s.start) : Number.NaN;
        if (!Number.isFinite(start)) return undefined;
        const ende = typeof s.ende === "string" && s.ende !== "" ? Date.parse(s.ende) : Number.NaN;
        return {
            status: typeof s.status === "string" ? s.status : "",
            start,
            ende: Number.isFinite(ende) ? ende : null,
        };
    } catch {
        return undefined;
    }
}

/**
 * Die erwartete Dauer je Schritt: die Dauer aus dem jüngsten Lauf, in dem der Schritt belegt zu Ende ging (Lauf-Ordner `<sha>` und die
 * umbenannten `<sha>-<Zeit>` unter `.release-runs`), sonst die feste Schätzung. Ein Schritt, der den Lauf rot beendete oder abgebrochen wurde,
 * zählt nicht (seine Dauer ist nicht die eines ganzen Schritts).
 */
export function erwarteteDauern(laeufe: string): Erwartung {
    const ms = { ...SCHRITT_SCHAETZUNG_MS } as Record<SchrittId, number>;
    const schaetzung = Object.fromEntries(RELEASE_SCHRITTE.map((id) => [id, true])) as Record<SchrittId, boolean>;
    let ordner: string[];
    try {
        ordner = readdirSync(laeufe).filter((name) => LAUF_ORDNER.test(name));
    } catch {
        return { ms, schaetzung };
    }
    const laeufeMitStart = ordner
        .flatMap((name) => {
            const status = leseStatusDatei(join(laeufe, name));
            return status === undefined ? [] : [{ name, status }];
        })
        .sort((a, b) => b.status.start - a.status.start);
    const gesehen = new Set<SchrittId>();
    for (const { name, status } of laeufeMitStart) {
        const zeiten = leseSchrittzeiten(join(laeufe, name), status.start, status.ende, status.status === "gruen");
        for (const z of zeiten) {
            if (gesehen.has(z.id) || !z.belegt || z.ende === null) continue;
            const dauer = z.ende - z.start;
            if (dauer < 1000) continue;
            ms[z.id] = dauer;
            schaetzung[z.id] = false;
            gesehen.add(z.id);
        }
    }
    return { ms, schaetzung };
}

// ───────────────────────── Schritte, Fortschritt ─────────────────────────

/**
 * `uebernommen`: der Schritt gehört zu einem Teil, den eine Wiederholung aus dem früheren Lauf übernahm (er lief in diesem Lauf nicht, zählt nicht
 * zur Erwartung). `uebersprungen`: er lief nicht, weil seine Voraussetzung fehlte (Besucherpaket ohne Bau, Browserteil ohne Martin).
 */
export type SchrittZustand = "fertig" | "laeuft" | "offen" | "fehler" | "uebernommen" | "uebersprungen";

export interface SchrittStand {
    readonly id: SchrittId;
    readonly zustand: SchrittZustand;
    /** Beginn (ISO) von Schritten, die begonnen haben. */
    readonly start?: string;
    /** Verstrichene Zeit des Schritts bis jetzt oder bis zu seinem Ende. */
    readonly dauerMs?: number;
    /** Die erwartete Dauer des Schritts. */
    readonly erwartetMs: number;
    /** Die erwartete Dauer ist die feste Schätzung. */
    readonly schaetzung: boolean;
}

export interface Fortschritt {
    readonly schritte: SchrittStand[];
    /** Die erwartete Dauer des ganzen Laufs. */
    readonly erwartetMs: number;
    /** Mindestens ein Schritt rechnet noch mit der festen Schätzung. */
    readonly erwartetSchaetzung: boolean;
    /** 0 bis 1, nach erwarteter Dauer: Erledigtes zählt voll, der laufende Schritt anteilig. */
    readonly fortschritt: number;
    /** Wie lange es noch dauert, solange der Lauf läuft. */
    readonly verbleibendMs?: number;
}

/**
 * Die Schritte mit Zustand und Zeit, die erwartete Gesamtdauer und der Fortschritt. `ende` ist das Ende des Laufs (`null`: läuft); `fehlerSchritt`
 * der Schritt, an dem ein roter oder abgebrochener Lauf endete (sonst der zuletzt begonnene).
 */
export function berechneFortschritt(o: {
    readonly zeiten: readonly SchrittZeit[];
    readonly erwartung: Erwartung;
    readonly zustand: "keiner" | "laeuft" | "gruen" | "rot" | "abgebrochen";
    readonly jetzt: number;
    /** Der Schritt, an dem der Lauf endete (ältere Läufe, die beim ersten roten Schritt abbrachen). */
    readonly fehlerSchritt?: SchrittId | undefined;
    /** Alle roten Schritte: Seit dem Lauf bis zum Ende können mehrere rot sein, und der Lauf geht danach weiter. */
    readonly fehlerSchritte?: readonly SchrittId[] | undefined;
    /** Schritte, die in diesem Lauf nicht liefen, weil eine Wiederholung ihren Teil übernahm. */
    readonly uebernommen?: readonly SchrittId[] | undefined;
    /** Schritte, die entfielen, weil ihre Voraussetzung fehlte. */
    readonly uebersprungen?: readonly SchrittId[] | undefined;
}): Fortschritt {
    const { zeiten, erwartung, zustand, jetzt } = o;
    const zuletzt = zeiten.at(-1)?.id;
    const rot = new Set<SchrittId>(o.fehlerSchritte ?? []);
    const uebernommen = new Set<SchrittId>(o.uebernommen ?? []);
    const uebersprungen = new Set<SchrittId>(o.uebersprungen ?? []);
    const schritte: SchrittStand[] = RELEASE_SCHRITTE.map((id) => {
        const z = zeiten.find((eintrag) => eintrag.id === id);
        // Was nicht lief, trägt keine Erwartung: Die Dauer des Laufs ist die der Schritte, die in ihm laufen.
        if (z === undefined && uebernommen.has(id))
            return { id, zustand: "uebernommen", erwartetMs: 0, schaetzung: false };
        if (z === undefined && uebersprungen.has(id))
            return { id, zustand: "uebersprungen", erwartetMs: 0, schaetzung: false };
        const erwartetMs = erwartung.ms[id];
        const schaetzung = erwartung.schaetzung[id];
        if (z === undefined || zustand === "keiner") {
            return { id, zustand: "offen", erwartetMs, schaetzung };
        }
        const start = new Date(z.start).toISOString();
        const ende = z.ende ?? (zustand === "laeuft" ? jetzt : z.start);
        const dauerMs = Math.max(0, ende - z.start);
        let schrittZustand: SchrittZustand = "fertig";
        if (rot.has(id)) schrittZustand = "fehler";
        else if (zustand === "laeuft") schrittZustand = z.ende === null ? "laeuft" : "fertig";
        else if (zustand !== "gruen" && rot.size === 0 && id === (o.fehlerSchritt ?? zuletzt))
            schrittZustand = "fehler";
        return { id, zustand: schrittZustand, start, dauerMs, erwartetMs, schaetzung };
    });
    const gesamt = schritte.reduce((summe, s) => summe + s.erwartetMs, 0);
    const erledigt = schritte.reduce((summe, s) => {
        if (s.zustand === "fertig") return summe + s.erwartetMs;
        if (s.zustand === "laeuft" || s.zustand === "fehler")
            return summe + Math.min((s.dauerMs ?? 0) / s.erwartetMs, 0.95) * s.erwartetMs;
        return summe;
    }, 0);
    const fortschritt =
        zustand === "gruen" ? 1 : zustand === "keiner" ? 0 : Math.min(gesamt > 0 ? erledigt / gesamt : 0, 0.99);
    const verbleibend =
        zustand === "laeuft"
            ? schritte.reduce((summe, s) => {
                  if (s.zustand === "offen") return summe + s.erwartetMs;
                  if (s.zustand === "laeuft") return summe + Math.max(s.erwartetMs - (s.dauerMs ?? 0), 0);
                  return summe;
              }, 0)
            : undefined;
    return {
        schritte,
        erwartetMs: gesamt,
        erwartetSchaetzung: schritte.some((s) => s.schaetzung),
        fortschritt,
        ...(verbleibend === undefined ? {} : { verbleibendMs: verbleibend }),
    };
}

// ───────────────────────── Bericht zu einem Fehlschlag ─────────────────────────

/**
 * Warum ein Fall im Bericht steht: er ist rot, übersprungen oder ein `todo` (ein Fall ohne Inhalt). Der Release-Test duldet keinen der drei;
 * ein Lauf mit 40 `todo` und sonst nur Grün ist rot, und der Bericht muss diese 40 nennen.
 */
export type FallArt = "rot" | "übersprungen" | "todo";
/** Die Reihenfolge im Bericht: zuerst das Rote, dann das Übersprungene, dann die Fälle ohne Inhalt. */
export const FALL_ARTEN: readonly FallArt[] = ["rot", "übersprungen", "todo"];

/**
 * Ein Fall des Berichts: Datei, Name und die ersten Zeilen der Meldung.
 *
 * 🪤 Die Art steht als `[rot]`, `[übersprungen]` oder `[todo]` vor dem Namen, nicht in einem eigenen Feld: Der Vertrag
 * (`ReleaseTestRoterFall`, `packages/shared`) ist streng, und der Server streicht ein unbekanntes Feld (`Value.Clean`), bevor die Karte es
 * sähe. So zeigen die Liste und „Bericht kopieren“ die Art ohne Änderung an Vertrag und Oberfläche. Der Name ist leer, wenn die ganze Datei
 * nicht lief (dann ist sie rot; der Grund steht in der Meldung).
 */
export interface BerichtFall {
    readonly datei: string;
    readonly name: string;
    readonly meldung: readonly string[];
    /** In welchem Teil der Fall steht: `tests` (Vitest) oder `browser-n`. Fehlt bei Berichten, die den Teil nicht kennen. */
    readonly teil?: string;
    /** Der Name dieses Teils, deutsch (`Alle Tests`, der Name aus `release-teile.json`); die Oberfläche übersetzt über `teil`. */
    readonly teilName?: string;
}

/** Der Teil, zu dem ein Bericht gehört: Kennung und deutscher Name, damit jeder Fall des Berichts ihn trägt. */
export interface TeilKennung {
    readonly id: string;
    readonly name: string;
}

export interface FehlerBericht {
    /** Der Schritt, an dem der Lauf endete; `null`, wenn er sich nicht feststellen lässt. */
    readonly schritt: SchrittId | null;
    /** Die Meldung des Runners (`fehler.txt`) oder der Satz zum Status, bereinigt, höchstens drei Zeilen. */
    readonly grund: string;
    /**
     * Die Fälle (höchstens `FAELLE_MAX`), aus `vitest.json` beziehungsweise `browser-<n>.json`: zuerst die roten, dann die übersprungenen,
     * dann die `todo`, jeweils mit ihrer Art im Namen (`BerichtFall`).
     */
    readonly faelle: readonly BerichtFall[];
    /** Wie viele Fälle der Bericht insgesamt nennt, rote, übersprungene und `todo` zusammen (mehr als `faelle`, wenn gekürzt). */
    readonly faelleGesamt: number;
    /** Die letzten Zeilen des Protokolls des Schritts (höchstens `PROTOKOLL_ZEILEN`), bereinigt. */
    readonly protokollEnde: readonly string[];
}

export const FAELLE_MAX = 20;
export const PROTOKOLL_ZEILEN = 60;
const MELDUNG_ZEILEN = 6;

/** Der Schritt, an dem der Lauf endete, aus der Meldung des Runners; sonst der zuletzt begonnene. */
export function fehlerSchrittAus(fehlerText: string, zuletzt: SchrittId | undefined): SchrittId | null {
    const kopf = fehlerText.split(/\r?\n/, 1)[0] ?? "";
    const exit = /^([a-z0-9-]+): (?:pg_restore )?Exit -?\d+/u.exec(kopf)?.[1];
    if (exit !== undefined && istSchrittId(exit)) return exit;
    const browser = /^Browserteil (\d|kern-echt|kern)\b/u.exec(kopf)?.[1];
    const browserSchritt = browser === undefined ? undefined : browserSchrittAus(browser);
    if (browserSchritt !== undefined) return browserSchritt;
    // „Vitest: 0 rot, 0 übersprungen, 40 todo …“ (`vitestMeldung`); die beiden älteren Sätze stehen noch in früheren Ergebnisordnern.
    if (/^Vitest: |^Volltests fehlen|^Mindestens eine erwartete Testdatei/u.test(kopf)) return "tests";
    // „Daten: 2 rot, 0 übersprungen, 0 todo“ (Teil `daten` des Tors, `datenBefund`).
    if (/^Daten: /u.test(kopf)) return "daten";
    return zuletzt ?? null;
}

/**
 * Alle roten und entfallenen Schritte aus `fehler.txt` (eine Zeile je Schritt, so schreibt der Runner sie seit WI-0248): `lint: Exit 1`,
 * `Vitest: …`, `Browserteil 2 (Name): 3 rot`, `besucherpaket nicht gelaufen: …`, `Browserteil 3 (Name) nicht gelaufen: …`. Zeilen, die zu keinem
 * Schritt passen, zählen nicht. In der Reihenfolge der Datei, ohne Doppelte.
 */
export function schritteAusFehlerText(fehlerText: string): { rot: SchrittId[]; uebersprungen: SchrittId[] } {
    const rot: SchrittId[] = [];
    const uebersprungen: SchrittId[] = [];
    const nimm = (liste: SchrittId[], id: string): void => {
        if (istSchrittId(id) && !liste.includes(id)) liste.push(id);
    };
    for (const zeile of fehlerText.split(/\r?\n/)) {
        const browserLos = /^Browserteil (\d|kern-echt|kern)\b.* nicht gelaufen\b/u.exec(zeile)?.[1];
        if (browserLos !== undefined) {
            nimm(uebersprungen, browserSchrittAus(browserLos) ?? "");
            continue;
        }
        const los = /^([a-z0-9-]+) nicht gelaufen\b/u.exec(zeile)?.[1];
        if (los !== undefined) {
            nimm(uebersprungen, los);
            continue;
        }
        const browser = /^Browserteil (\d|kern-echt|kern)\b/u.exec(zeile)?.[1];
        if (browser !== undefined) {
            nimm(rot, browserSchrittAus(browser) ?? "");
            continue;
        }
        if (/^Vitest: /u.test(zeile)) {
            nimm(rot, "tests");
            continue;
        }
        if (/^Daten: /u.test(zeile)) {
            nimm(rot, "daten");
            continue;
        }
        const schritt = /^([a-z0-9-]+): (?:pg_restore )?(?:Exit -?\d+|Zeitüberschreitung)/u.exec(zeile)?.[1];
        if (schritt !== undefined) nimm(rot, schritt);
    }
    return { rot, uebersprungen };
}

/** Die letzten `zeilen` nicht leeren Zeilen einer Datei; liest nur ihr Ende. */
export function leseDateiEnde(datei: string, zeilen = PROTOKOLL_ZEILEN, bytes = 128 * 1024): string[] {
    let fd: number;
    try {
        fd = openSync(datei, "r");
    } catch {
        return [];
    }
    try {
        const groesse = statSync(datei).size;
        const von = Math.max(0, groesse - bytes);
        const puffer = Buffer.alloc(groesse - von);
        readSync(fd, puffer, 0, puffer.length, von);
        const alle = puffer.toString("utf8").split(/\r?\n/);
        if (von > 0) alle.shift(); // die angeschnittene erste Zeile
        return alle
            .filter((z) => z.trim() !== "")
            .slice(-zeilen)
            .map((z) => zeileFuerAnzeige(z));
    } catch {
        return [];
    } finally {
        closeSync(fd);
    }
}

const nurNachCheckout = (pfad: string): string => {
    const glatt = pfad.replace(/\\/g, "/");
    const stelle = glatt.lastIndexOf("/checkout/");
    return stelle >= 0 ? glatt.slice(stelle + "/checkout/".length) : glatt;
};

const meldungsZeilen = (text: unknown, zeilen = MELDUNG_ZEILEN): string[] =>
    typeof text !== "string"
        ? []
        : text
              .replace(ANSI, "")
              .split(/\r?\n/)
              .filter((z) => z.trim() !== "")
              .slice(0, zeilen)
              .map((z) => zeileFuerAnzeige(z, 240));

/** Der Name eines Falls mit seiner Art davor (`[todo] Suite › Fall`), auf die Länge einer Zeile gekürzt; die Art bleibt beim Kürzen stehen. */
const mitArt = (art: FallArt | "wackelig", titel: string): string => zeileFuerAnzeige(`[${art}] ${titel}`, 240);

/**
 * Sammelt die Fälle eines Berichts nach Art. Gebaut wird ein Fall nur, solange seine Art noch `FAELLE_MAX` Plätze braucht (ein Lauf mit
 * tausend Fällen ohne Inhalt baut zwanzig Einträge); gezählt wird jeder. Ausgegeben werden zuerst die roten, dann die übersprungenen, dann
 * die `todo`, zusammen höchstens `FAELLE_MAX`: Das Rote verdrängt nie ein `todo`-Fall, und die `todo` verdrängen nie etwas Rotes.
 */
function sammle(
    max = FAELLE_MAX,
    zeilen = MELDUNG_ZEILEN,
): {
    nimm: (art: FallArt, baue: () => BerichtFall) => void;
    ergebnis: () => { faelle: BerichtFall[]; gesamt: number };
    /** Wie viele Zeilen der Meldung ein Fall trägt. */
    readonly zeilen: number;
} {
    const nach: Record<FallArt, BerichtFall[]> = { rot: [], übersprungen: [], todo: [] };
    let gesamt = 0;
    return {
        nimm(art, baue) {
            gesamt += 1;
            if (nach[art].length < max) nach[art].push(baue());
        },
        ergebnis: () => ({ faelle: FALL_ARTEN.flatMap((art) => nach[art]).slice(0, max), gesamt }),
        zeilen,
    };
}

/** Vitests Status eines Falls (`assertionResults[].status`) als Art im Bericht; `undefined` für einen grünen Fall. */
function artVonVitest(status: unknown): FallArt | undefined {
    if (status === "failed") return "rot";
    if (status === "todo") return "todo";
    // `pending` ist ein Fall, der nicht zu Ende lief (Vitest zählt ihn mit den übersprungenen, `numPendingTests`).
    if (status === "skipped" || status === "pending" || status === "disabled") return "übersprungen";
    return undefined;
}

/** Der Sammler der Fälle, in den mehrere Berichte (Vitest und die Browserteile) nacheinander einspeisen: Er hält insgesamt höchstens `FAELLE_MAX` Fälle je Art. */
export type FaelleSammler = ReturnType<typeof sammle>;
/**
 * Ein neuer Sammler. Die Karte nimmt die Vorgabe (`FAELLE_MAX` Fälle, kurze Meldungen); der Bericht am Ende des Laufs (`release-seite.ts`, WI-0248,
 * Vali 2026-10-26: „EIN log, wo alle fehler drinstehen“) nimmt jeden Fall (`Infinity`) mit längerer Meldung.
 */
export const neuerFaelleSammler = (max = FAELLE_MAX, zeilen = MELDUNG_ZEILEN): FaelleSammler => sammle(max, zeilen);

const mitTeil = (fall: BerichtFall, teil: TeilKennung | undefined): BerichtFall =>
    teil === undefined ? fall : { ...fall, teil: teil.id, teilName: teil.name };

/**
 * Die Fälle aus `vitest.json` (Vitest-Berichtsform `json`): rote, übersprungene und `todo`. Mit `teil` trägt jeder Fall seinen Teil; mit `gemeinsam`
 * speist der Bericht in einen gemeinsamen Sammler ein (das Ergebnis ist dann der Stand des Sammlers, nicht nur dieses Berichts).
 */
export function faelleVonVitest(
    bericht: unknown,
    teil?: TeilKennung,
    gemeinsam?: FaelleSammler,
): { faelle: BerichtFall[]; gesamt: number } {
    const sammler = gemeinsam ?? sammle();
    const roh = (bericht ?? {}) as {
        testResults?: {
            name?: unknown;
            status?: unknown;
            message?: unknown;
            assertionResults?: { status?: unknown; fullName?: unknown; title?: unknown; failureMessages?: unknown }[];
        }[];
    };
    for (const datei of roh.testResults ?? []) {
        const name = typeof datei.name === "string" ? nurNachCheckout(datei.name) : "unbekannt";
        const faelle = (datei.assertionResults ?? []).flatMap((a) => {
            const art = artVonVitest(a.status);
            return art === undefined ? [] : [{ art, fall: a }];
        });
        if (datei.status === "failed" && !faelle.some(({ art }) => art === "rot")) {
            // Die Datei lief gar nicht (Import fehlt, Absturz): ein roter Eintrag ohne Namen.
            sammler.nimm("rot", () =>
                mitTeil({ datei: name, name: "", meldung: meldungsZeilen(datei.message, sammler.zeilen) }, teil),
            );
        }
        for (const { art, fall } of faelle) {
            sammler.nimm(art, () => {
                const titel =
                    typeof fall.fullName === "string"
                        ? fall.fullName
                        : typeof fall.title === "string"
                          ? fall.title
                          : "";
                const meldung = Array.isArray(fall.failureMessages) ? fall.failureMessages[0] : undefined;
                return mitTeil(
                    { datei: name, name: mitArt(art, titel), meldung: meldungsZeilen(meldung, sammler.zeilen) },
                    teil,
                );
            });
        }
    }
    return sammler.ergebnis();
}

/** Die Fälle aus `browser-<n>.json` (Playwright-Berichtsform `json`): rote und übersprungene (Playwright kennt kein `todo`). Parameter wie bei `faelleVonVitest`. */
export function faelleVonPlaywright(
    bericht: unknown,
    teil?: TeilKennung,
    gemeinsam?: FaelleSammler,
): { faelle: BerichtFall[]; gesamt: number } {
    const sammler = gemeinsam ?? sammle();
    interface Ergebnis {
        readonly status?: string;
        readonly error?: { message?: unknown };
        readonly errors?: { message?: unknown }[];
    }
    interface Fall {
        readonly status?: string;
        readonly annotations?: readonly { readonly type?: string; readonly description?: unknown }[];
        readonly results?: readonly Ergebnis[];
    }
    interface Suite {
        readonly file?: string;
        readonly title?: string;
        readonly specs?: {
            readonly ok?: boolean;
            readonly file?: string;
            readonly title?: string;
            readonly tests?: readonly Fall[];
        }[];
        readonly suites?: readonly Suite[];
    }
    const gehe = (suite: Suite, datei: string | undefined, pfad: readonly string[]): void => {
        const hier = suite.file ?? datei;
        const titel =
            suite.file !== undefined || suite.title === undefined || suite.title === "" ? pfad : [...pfad, suite.title];
        for (const spec of suite.specs ?? []) {
            const tests = spec.tests ?? [];
            const art: FallArt | undefined =
                spec.ok === false ? "rot" : tests.some((t) => t.status === "skipped") ? "übersprungen" : undefined;
            if (art === undefined) continue;
            sammler.nimm(art, () => {
                const ergebnisse = tests.flatMap((t) => t.results ?? []);
                const schlecht =
                    ergebnisse.find((e) => e.status !== "passed" && e.status !== "skipped") ?? ergebnisse[0];
                // Ein übersprungener Fall nennt, wenn es einen gibt, den Grund der Anmerkung (`test.skip(bedingung, "Grund")`).
                const anmerkung = tests
                    .flatMap((t) => t.annotations ?? [])
                    .find((a) => a.type === "skip" || a.type === "fixme")?.description;
                return mitTeil(
                    {
                        datei: (spec.file ?? hier ?? "unbekannt").split("\\").join("/"),
                        name: mitArt(art, [...titel, spec.title ?? ""].filter((t) => t !== "").join(" › ")),
                        meldung: meldungsZeilen(
                            art === "rot" ? (schlecht?.error?.message ?? schlecht?.errors?.[0]?.message) : anmerkung,
                            sammler.zeilen,
                        ),
                    },
                    teil,
                );
            });
        }
        for (const kind of suite.suites ?? []) gehe(kind, hier, titel);
    };
    const roh = (bericht ?? {}) as { suites?: readonly Suite[] };
    for (const suite of roh.suites ?? []) gehe(suite, undefined, []);
    return sammler.ergebnis();
}

function leseJson(pfad: string): unknown {
    try {
        return JSON.parse(readFileSync(pfad, "utf8"));
    } catch {
        return undefined;
    }
}

/** Die ersten zwölf Zeilen eines Textes, bereinigt (Meldung des Runners: seit WI-0248 eine Zeile je rotem Schritt, höchstens zehn Schritte). */
function grundZeilen(text: string): string {
    return text
        .split(/\r?\n/)
        .filter((z) => z.trim() !== "")
        .slice(0, 12)
        .map((z) => zeileFuerAnzeige(z, 300))
        .join("\n");
}

/** Die Teile (`voll`, `browser-n`) laut `status.json` des Runners, mit ihrem Urteil. */
export function leseTeileStatus(ordner: string): { readonly klasse: string; readonly status: string }[] {
    const roh = leseJson(join(ordner, "status.json"));
    const teile = (roh as { teile?: unknown } | null | undefined)?.teile;
    if (!Array.isArray(teile)) return [];
    return teile.flatMap((t: unknown) => {
        const e = (t ?? {}) as { klasse?: unknown; status?: unknown };
        return typeof e.klasse === "string" && typeof e.status === "string"
            ? [{ klasse: e.klasse, status: e.status }]
            : [];
    });
}

/** Das Prüfprofil eines Laufs laut `status.json` (`tor`, `B`, `voll`); `undefined`, wenn die Datei es nicht nennt (ein Lauf aus der Zeit davor). */
export function leseProfil(ordner: string): string | undefined {
    const profil = (leseJson(join(ordner, "status.json")) as { profil?: unknown } | null | undefined)?.profil;
    return typeof profil === "string" ? profil : undefined;
}

/**
 * Die wackeligen Fälle eines Playwright-Berichts (WI-0264): Fälle, die im Wiederholungsversuch grün wurden (`status: "flaky"`). Im Tor zählen sie
 * als grün (`kern-echt`, `--retries=1`), der Bericht nennt sie trotzdem, mit der Meldung des ersten, fehlgeschlagenen Versuchs. Die Art steht wie bei
 * den übrigen Fällen als `[wackelig]` vor dem Namen (der Vertrag kennt kein eigenes Feld, siehe `BerichtFall`).
 */
export function wackeligeFaelle(bericht: unknown, teil?: TeilKennung): BerichtFall[] {
    interface Fall {
        readonly status?: string;
        readonly results?: readonly { readonly status?: string; readonly error?: { message?: unknown } }[];
    }
    interface Suite {
        readonly file?: string;
        readonly title?: string;
        readonly specs?: { readonly file?: string; readonly title?: string; readonly tests?: readonly Fall[] }[];
        readonly suites?: readonly Suite[];
    }
    const faelle: BerichtFall[] = [];
    const gehe = (suite: Suite, datei: string | undefined, pfad: readonly string[]): void => {
        const hier = suite.file ?? datei;
        const titel =
            suite.file !== undefined || suite.title === undefined || suite.title === "" ? pfad : [...pfad, suite.title];
        for (const spec of suite.specs ?? []) {
            const wackelig = (spec.tests ?? []).filter((t) => t.status === "flaky");
            if (wackelig.length === 0) continue;
            const erster = wackelig
                .flatMap((t) => t.results ?? [])
                .find((e) => e.status !== undefined && e.status !== "passed" && e.status !== "skipped");
            faelle.push(
                mitTeil(
                    {
                        datei: (spec.file ?? hier ?? "unbekannt").split("\\").join("/"),
                        name: mitArt("wackelig", [...titel, spec.title ?? ""].filter((t) => t !== "").join(" › ")),
                        meldung: meldungsZeilen(erster?.error?.message),
                    },
                    teil,
                ),
            );
        }
        for (const kind of suite.suites ?? []) gehe(kind, hier, titel);
    };
    for (const suite of (bericht as { suites?: readonly Suite[] } | null | undefined)?.suites ?? [])
        gehe(suite, undefined, []);
    return faelle;
}

/** Der Name eines Teils, deutsch, für die Fälle im Bericht: die Browserteile aus dem Laufbuch, Vitest als „Alle Tests“. */
function teilKennung(id: string, buch: LaufBuch | undefined): TeilKennung {
    if (id === "tests") return { id, name: "Alle Tests" };
    if (id === "daten") return { id, name: "Daten (Migrationen und Rechte)" };
    return { id, name: buch?.teile.find((t) => t.id === id)?.name ?? id };
}

/**
 * Der Bericht zu einem roten oder abgebrochenen Lauf: wo er endete, warum, welche Fälle rot, übersprungen oder ohne Inhalt (`todo`) sind und
 * was das Protokoll des Schritts zuletzt sagte.
 * `satz` ist der Satz zum Status, wenn der Runner keine Meldung (`fehler.txt`) hinterlassen hat (Abbruch, Zeitgrenze).
 *
 * 🔴 Seit WI-0248 läuft der Lauf bis zum Ende, und mehrere Teile können rot sein: Die Fälle kommen aus den Berichten ALLER Teile, die nicht
 * grün sind (Vitest und jeder Browserteil), zusammen höchstens `FAELLE_MAX` sichtbar, `faelleGesamt` zählt alle, jeder Fall nennt seinen Teil.
 * `schritt` ist der erste rote Schritt (so steht er in der ersten Zeile von `fehler.txt`), und das Protokollende ist das seines Protokolls.
 */
export function baueFehlerBericht(ordner: string, satz: string, zuletzt: SchrittId | undefined): FehlerBericht {
    let fehlerText = "";
    try {
        fehlerText = readFileSync(join(ordner, "fehler.txt"), "utf8");
    } catch {
        /* Abbruch und Zeitgrenze lassen keine Meldung zurück: dann gilt der Satz zum Status. */
    }
    const schritt = fehlerSchrittAus(fehlerText, zuletzt);
    const buch = leseLaufBuch(ordner);
    const gruen = new Set(
        leseTeileStatus(ordner)
            .filter((t) => t.status === "gruen")
            .map((t) => t.klasse),
    );
    const sammler = neuerFaelleSammler();
    // Vitest gehört zu `voll`; ein grüner Teil hat keinen Fall zu nennen und wird nicht gelesen (Vitests Bericht ist mehrere Megabyte groß).
    if (!gruen.has("voll")) {
        const bericht = leseJson(join(ordner, "vitest.json"));
        if (bericht !== undefined) faelleVonVitest(bericht, teilKennung("tests", buch), sammler);
    }
    // `daten` (Profil `tor`) hat wie Vitest einen Vitest-Bericht, aber seinen eigenen Teil.
    if (!gruen.has("daten")) {
        const bericht = leseJson(join(ordner, "daten.json"));
        if (bericht !== undefined) faelleVonVitest(bericht, teilKennung("daten", buch), sammler);
    }
    for (const id of BROWSER_SCHRITTE) {
        if (gruen.has(id)) continue;
        const bericht = leseJson(join(ordner, `${id}.json`));
        if (bericht !== undefined) faelleVonPlaywright(bericht, teilKennung(id, buch), sammler);
    }
    const gefunden = sammler.ergebnis();
    return {
        schritt,
        grund: fehlerText.trim() === "" ? satz : grundZeilen(fehlerText),
        faelle: gefunden.faelle,
        faelleGesamt: gefunden.gesamt,
        protokollEnde: schritt === null ? [] : leseDateiEnde(join(ordner, `${schritt}.log`)),
    };
}

// ───────────────────────── Die Browserteile in der Ansicht ─────────────────────────

/** Wie ein Browserteil in der Ansicht steht. */
export type TeilZustand = "offen" | "laeuft" | "gruen" | "rot" | "uebersprungen";

/** Ein Browserteil für die Systemsteuerung: Name, Bereiche, Zahl der Fälle, Zustand und Zeit (`ReleaseTestTeil` in `packages/shared`). */
export interface TeilAnsicht {
    readonly id: string;
    /** Der Name aus `release-teile.json`, deutsch; die Oberfläche übersetzt ihn über die Kennung. */
    readonly name: string;
    /** Kennungen der Themenbereiche; die Oberfläche übersetzt sie. */
    readonly bereiche: readonly string[];
    readonly zustand: TeilZustand;
    /** Der Teil kommt aus einem früheren Lauf (Wiederholung) und lief in diesem nicht neu. */
    readonly uebernommen: boolean;
    /** Wie viele Spec-Dateien der Teil umfasst. */
    readonly specs?: number;
    /** Wie viele Fälle der Teil umfasst: aus seinem Bericht, solange er noch nicht lief aus dem jüngsten früheren Lauf (dann `faelleSchaetzung`). */
    readonly faelle?: number;
    readonly faelleSchaetzung?: boolean;
    /** Wie viele Fälle rot (oder wackelig) waren; nur mit Bericht. */
    readonly rot?: number;
    /** Verstrichene Zeit des Teils (läuft er, bis jetzt). */
    readonly dauerMs?: number;
    /** Die erwartete Zeit des Teils (aus dem jüngsten Lauf, sonst die feste Schätzung; 0, wenn er übernommen wurde). */
    readonly erwartetMs: number;
    /** Bei einem entfallenen Teil der Grund. */
    readonly grund?: string;
}

/** Die Zahlen eines Playwright-Berichts: gelaufene Fälle insgesamt und rote (mit wackeligen). */
export function zaehleBrowserFaelle(bericht: unknown): { readonly faelle: number; readonly rot: number } {
    const { zahlen } = playwrightAuswertung(bericht);
    return {
        faelle: zahlen.erwartet + zahlen.rot + zahlen.wackelig + zahlen.uebersprungen,
        rot: zahlen.rot + zahlen.wackelig,
    };
}

/** Gemerkt nach Pfad und Änderungszeit: Die Ansicht fragt alle halbe Minute, und ein Bericht ist ein halbes Megabyte. */
const FAELLE_ZWISCHENSPEICHER = new Map<string, { readonly mtime: number; readonly faelle: number | undefined }>();

/** Die Zahl der Fälle (und der roten) im Playwright-Bericht auf der Platte; `undefined`, wenn er fehlt oder nicht lesbar ist. */
function faelleImBericht(pfad: string): { faelle: number; rot: number } | undefined {
    const bericht = leseJson(pfad);
    return bericht === undefined ? undefined : zaehleBrowserFaelle(bericht);
}

/**
 * Wie viele Fälle jeder Browserteil laut seinem jüngsten früheren Lauf hat (Schätzung, solange ein Teil noch nicht gelaufen ist). Zählt nur
 * Läufe mit Laufbuch: Vor der Einteilung nach Thema meinte `browser-2` ein anderes Viertel, seine Zahl wäre falsch.
 */
export function erwarteteFaelle(laeufe: string, ohne?: string): Readonly<Record<string, number>> {
    let namen: string[];
    try {
        namen = readdirSync(laeufe).filter((name) => LAUF_ORDNER.test(name) && name !== ohne);
    } catch {
        return {};
    }
    const mitStart = namen
        .flatMap((name) => {
            const ordner = join(laeufe, name);
            if (!existsSync(join(ordner, "teile.json"))) return [];
            const status = leseStatusDatei(ordner);
            return status === undefined ? [] : [{ ordner, start: status.start }];
        })
        .sort((a, b) => b.start - a.start)
        .slice(0, 6);
    const aus: Record<string, number> = {};
    for (const { ordner } of mitStart) {
        for (const id of BROWSER_SCHRITTE) {
            if (aus[id] !== undefined) continue;
            const pfad = join(ordner, `${id}.json`);
            if (!existsSync(pfad)) continue;
            let mtime: number;
            try {
                mtime = statSync(pfad).mtimeMs;
            } catch {
                continue;
            }
            const gemerkt = FAELLE_ZWISCHENSPEICHER.get(pfad);
            let faelle: number | undefined;
            if (gemerkt !== undefined && gemerkt.mtime === mtime) faelle = gemerkt.faelle;
            else {
                faelle = faelleImBericht(pfad)?.faelle;
                FAELLE_ZWISCHENSPEICHER.set(pfad, { mtime, faelle });
            }
            if (faelle !== undefined && faelle > 0) aus[id] = faelle;
        }
    }
    return aus;
}

/**
 * Die Browserteile für die Ansicht. `definitionen` sind die Teile (aus dem Laufbuch des Laufs, sonst aus `release-teile.json`); der Zustand eines Teils
 * kommt, in dieser Reihenfolge, aus dem Laufbuch (`schritte`), aus `status.json` (`teile`) und zuletzt aus den Schritten des Fortschritts. Die
 * Zahlen der Fälle stehen im Bericht des Teils (`browser-n.json`), solange er fehlt in `erwartet`.
 */
export function baueTeileAnsicht(o: {
    readonly definitionen: readonly {
        readonly id: string;
        readonly name: string;
        readonly bereiche: readonly string[];
        readonly specs?: number;
    }[];
    readonly laufbuch: LaufBuch | undefined;
    readonly teileStatus: readonly { readonly klasse: string; readonly status: string }[];
    readonly schritte: readonly SchrittStand[];
    readonly ordner: string | undefined;
    readonly erwartet: Readonly<Record<string, number>>;
}): TeilAnsicht[] {
    return o.definitionen.map((d): TeilAnsicht => {
        const schritt = o.schritte.find((s) => s.id === d.id);
        const buchSchritt = o.laufbuch?.schritte[d.id];
        const eintrag = o.teileStatus.find((t) => t.klasse === d.id);
        const uebernommen =
            buchSchritt?.status === "uebernommen" || (schritt?.zustand === "uebernommen" && buchSchritt === undefined);
        let zustand: TeilZustand = "offen";
        if (buchSchritt?.status === "uebersprungen" || eintrag?.status === "uebersprungen") zustand = "uebersprungen";
        else if (buchSchritt?.status === "rot" || eintrag?.status === "rot") zustand = "rot";
        else if (uebernommen || buchSchritt?.status === "gruen" || eintrag?.status === "gruen") zustand = "gruen";
        else if (schritt?.zustand === "laeuft") zustand = "laeuft";
        else if (schritt?.zustand === "fehler") zustand = "rot";
        else if (schritt?.zustand === "uebersprungen") zustand = "uebersprungen";
        else if (schritt?.zustand === "fertig" && o.laufbuch === undefined) zustand = "gruen";
        let zahlen: { faelle: number; rot: number } | undefined;
        if (o.ordner !== undefined && (zustand === "gruen" || zustand === "rot")) {
            const pfad = join(o.ordner, `${d.id}.json`);
            if (existsSync(pfad)) zahlen = faelleImBericht(pfad);
        }
        const schaetzung = zahlen === undefined ? o.erwartet[d.id] : undefined;
        const grund = zustand === "uebersprungen" ? (buchSchritt?.grund ?? undefined) : undefined;
        return {
            id: d.id,
            name: d.name,
            bereiche: d.bereiche,
            zustand,
            uebernommen,
            ...(d.specs === undefined ? {} : { specs: d.specs }),
            ...(zahlen === undefined
                ? schaetzung === undefined
                    ? {}
                    : { faelle: schaetzung, faelleSchaetzung: true }
                : { faelle: zahlen.faelle, rot: zahlen.rot }),
            ...(schritt?.dauerMs === undefined ? {} : { dauerMs: schritt.dauerMs }),
            erwartetMs: schritt?.erwartetMs ?? 0,
            ...(grund === undefined ? {} : { grund }),
        };
    });
}

/** Gibt es zu diesem Schritt ein Protokoll? (Für Tests und die Anzeige.) */
export const hatProtokoll = (ordner: string, schritt: SchrittId): boolean => existsSync(join(ordner, `${schritt}.log`));
