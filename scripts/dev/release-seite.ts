// Der eine Bericht am Ende eines Release-Tests (WI-0248; Vali 2026-10-26, wörtlich: „Am Ende gibt es eine einzige Seite mit allem, was rot ist
// (Vitest, Kernabläufe, Browser), und darunter, was noch offen ist. Aus diesem einen Bericht behebe ich die Fehler gesammelt, ohne Runde für
// Runde. -> jub“; vorher: „dann will ich auch EIN log, wo alle fehler drinstehen, damit du sie fixen kannst, was noch gemacht werden muss“).
//
// `bericht.md` im Ergebnisordner `.release-runs/<sha>/`, geschrieben vom Runner an JEDEM Ende (grün, rot, Abbruch, Zeitgrenze); die lokale
// Systemsteuerung zeigt ihn als eine Seite (`release-abholer.ts --bericht`), Claudia liest ihn, um alles gesammelt zu beheben.
//
// 🔴 **Rot:** alles, was nicht grün ist, aus allen Teilen, die liefen: statische Prüfung (Lint, Format, Typen, aus ihren Protokollen), Vitest und die
// Browserteile (aus ihren Berichten), je Fall Datei, Name und Meldung, OHNE Kürzung auf die ersten n Fälle. Schritte ohne Fallbericht (Installation,
// Bau, Besucherpaket …) stehen mit dem Ende ihres Protokolls da, entfallene Teile mit dem Grund.
// 🔴 **Offen:** darunter, aus EINER vorhandenen Quelle, nicht aus einer neuen Liste: der Spalte „Nächster sinnvoller Schritt“ der Tafel der
// Arbeitsstränge in `project-control/state/current.md`, im Stand der geprüften SHA. Begründung: `current.md` ist nach seinem eigenen Zweck die eine
// Stelle für „woran wir arbeiten, wie weit wir sind und was als Nächstes sinnvoll ist“ und wird von der Hauptorchestrierung gepflegt; die Work Items
// führen ihren Stand frei formuliert (ein großer Teil ohne die Statuszeile der Vorlage), eine Liste daraus wäre eine erfundene Auswahl. Fehlt die
// Tafel, sagt der Bericht das, statt etwas anderes zu nehmen.
//
// 🔴 **Volltest** (WI-0264; Vali 2026-10-31: „Schnelltest und Volltest“): Teil 2 (Profil `voll`, `nurBericht`) nennt in `status.json` den Lauf von Teil 1
// (`vorlauf`, Profil `tor`). Seine Seite enthält dann den Bericht von Teil 1 vor „Offen“, damit der Volltest EINE Seite bleibt.
//
// Nur lesen, nur Node-Bordmittel; was nach außen geht, ist bereinigt (`zeileFuerAnzeige`: keine Zugangsdaten, keine Farbcodes).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
    BROWSER_SCHRITTE,
    faelleVonPlaywright,
    faelleVonVitest,
    leseDateiEnde,
    leseTeileStatus,
    neuerFaelleSammler,
    schritteAusFehlerText,
    wackeligeFaelle,
    zeileFuerAnzeige,
    type BerichtFall,
} from "./release-bericht.ts";
import { WACKELIG_GRUEN } from "./release-ablauf.ts";
import { leseLaufBuch } from "./release-laufbuch.ts";
import { leseRoutingWeg, routingZeilen } from "./release-routing.ts";

export const BERICHT_DATEI = "bericht.md";
/** Wie viele Zeilen der Meldung je Fall der Bericht trägt (die Karte zeigt sechs). */
export const SEITE_MELDUNG_ZEILEN = 12;
/** Wie viele Zeilen vom Ende eines Protokolls ein Schritt ohne Fallbericht zeigt. */
export const SEITE_PROTOKOLL_ZEILEN = 40;
/** Die Quelle von „Offen“, relativ zur Wurzel des geprüften Standes. */
export const OFFEN_QUELLE = "project-control/state/current.md";

const STATISCH = ["lint", "format", "typen"] as const;
const SCHRITT_NAME: Readonly<Record<string, string>> = {
    vorbereitung: "Vorbereitung",
    installation: "Installation",
    shared: "Gemeinsamer Bau",
    lint: "Lint",
    format: "Format",
    typen: "Typen",
    "korpus-laden": "Korpus laden",
    tests: "Vitest",
    bau: "Release-Bau",
    besucherpaket: "Besucherpaket",
    kern: "Kernabläufe (Browser)",
    daten: "Daten (Migrationen und Rechte)",
    "kern-echt": "Kernabläufe gegen den echten Server (Browser)",
};
const schrittName = (id: string): string =>
    SCHRITT_NAME[id] ?? (/^browser-\d$/u.test(id) ? `Browserteil ${id.slice(-1)}` : id);

function leseJson(pfad: string): unknown {
    try {
        return JSON.parse(readFileSync(pfad, "utf8"));
    } catch {
        return undefined;
    }
}
function leseText(pfad: string): string {
    try {
        return readFileSync(pfad, "utf8");
    } catch {
        return "";
    }
}

const relativ = (pfad: string): string => {
    const glatt = pfad.replace(/\\/gu, "/");
    const stelle = glatt.lastIndexOf("/checkout/");
    return stelle >= 0 ? glatt.slice(stelle + "/checkout/".length) : glatt;
};

// ───────────────────────── Statische Prüfung aus den Protokollen ─────────────────────────

const PFAD = /^(?:[A-Za-z]:)?[^\s:(]*[\\/][^\s:(]*\.[A-Za-z]{1,5}$/u;

/** Die Fehler aus der Ausgabe von ESLint (Form `stylish`): je Fehler (nicht Warnung) Datei, Stelle mit Regel und Meldung. */
export function faelleAusLint(protokoll: string): BerichtFall[] {
    const faelle: BerichtFall[] = [];
    let datei = "";
    for (const roh of protokoll.split(/\r?\n/u)) {
        const zeile = zeileFuerAnzeige(roh, 600);
        if (PFAD.test(zeile.trim()) && !/^\s/u.test(zeile)) {
            datei = relativ(zeile.trim());
            continue;
        }
        const t = /^\s+(\d+):(\d+)\s+error\s+(.+?)(?:\s{2,}(\S+))?\s*$/u.exec(zeile);
        if (t === null || datei === "") continue;
        faelle.push({
            datei,
            name: `[rot] ${t[1] ?? ""}:${t[2] ?? ""}${t[4] === undefined ? "" : ` ${t[4]}`}`,
            meldung: [t[3] ?? ""],
            teil: "lint",
            teilName: "Lint",
        });
    }
    return faelle;
}

/** Die Dateien, die Prettier bemängelt (`[warn] <datei>`, `[error] <datei>: …`). */
export function faelleAusFormat(protokoll: string): BerichtFall[] {
    const faelle: BerichtFall[] = [];
    for (const roh of protokoll.split(/\r?\n/u)) {
        const zeile = zeileFuerAnzeige(roh, 600);
        const warn = /^\[warn\] (\S.*)$/u.exec(zeile)?.[1];
        if (warn !== undefined && !/Code style issues|Run Prettier/u.test(warn)) {
            faelle.push({
                datei: relativ(warn.trim()),
                name: "[rot] Format",
                meldung: ["Nicht im Prettier-Format"],
                teil: "format",
                teilName: "Format",
            });
            continue;
        }
        const fehler = /^\[error\] ([^:]+): (.*)$/u.exec(zeile);
        if (fehler !== null)
            faelle.push({
                datei: relativ(fehler[1] ?? ""),
                name: "[rot] Format",
                meldung: [fehler[2] ?? ""],
                teil: "format",
                teilName: "Format",
            });
    }
    return faelle;
}

const WORKSPACE: Readonly<Record<string, string>> = {
    shared: "packages/shared",
    server: "apps/server",
    web: "apps/web",
};

/**
 * Die Fehler von `tsc`/`vue-tsc` aus `npm run typecheck` (beide Formen: `datei(z,s): error TS…` und `datei:z:s - error TS…`). Die Pfade stehen
 * relativ zum Arbeitsbereich; die Zeile `> @avesmaps3d/<name>@… typecheck` davor sagt, zu welchem. Folgezeilen (eingerückt) gehören zur Meldung.
 */
export function faelleAusTypen(protokoll: string): BerichtFall[] {
    const faelle: BerichtFall[] = [];
    let vorne = "";
    let letzter: { datei: string; name: string; meldung: string[] } | undefined;
    const ab = (): void => {
        if (letzter !== undefined) faelle.push({ ...letzter, teil: "typen", teilName: "Typen" });
        letzter = undefined;
    };
    for (const roh of protokoll.split(/\r?\n/u)) {
        const zeile = zeileFuerAnzeige(roh, 600);
        const ws = /^> @avesmaps3d\/([a-z-]+)@\S* typecheck/u.exec(zeile)?.[1];
        if (ws !== undefined) {
            ab();
            vorne = WORKSPACE[ws] === undefined ? "" : `${WORKSPACE[ws]}/`;
            continue;
        }
        if (/^> avesmaps3d@\S* typecheck/u.test(zeile) || /^> tsc -p tsconfig\.tools\.json/u.test(zeile)) vorne = "";
        const t =
            /^(\S.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/u.exec(zeile) ??
            /^(\S.*?):(\d+):(\d+) - error (TS\d+): (.*)$/u.exec(zeile);
        if (t !== null) {
            ab();
            const datei = relativ(t[1] ?? "");
            letzter = {
                datei: /^(?:[A-Za-z]:|\/)/u.test(datei) || datei.startsWith(vorne) ? datei : `${vorne}${datei}`,
                name: `[rot] ${t[2] ?? ""}:${t[3] ?? ""} ${t[4] ?? ""}`,
                meldung: [t[5] ?? ""],
            };
            continue;
        }
        if (letzter !== undefined && /^\s{2,}\S/u.test(zeile) && letzter.meldung.length < SEITE_MELDUNG_ZEILEN)
            letzter.meldung.push(zeile.trim());
        else ab();
    }
    ab();
    return faelle;
}

// ───────────────────────── Offen ─────────────────────────

export interface OffenerPunkt {
    readonly bereich: string;
    readonly schritt: string;
    readonly quelle: string | null;
}

const zelle = (text: string): string => text.replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim();

/**
 * Die offenen Punkte aus `current.md`: die Tafel, deren Kopf die Spalte „Nächster sinnvoller Schritt“ (oder „Nächster Schritt“) trägt, je Zeile Bereich,
 * Schritt und Quelle. `null`, wenn es keine solche Tafel gibt.
 */
export function offenAusCurrent(text: string): OffenerPunkt[] | null {
    const zeilen = text.split(/\r?\n/u);
    for (let i = 0; i < zeilen.length - 1; i++) {
        const kopf = zeilen[i] ?? "";
        if (!kopf.trim().startsWith("|")) continue;
        const spalten = kopf.split("|").slice(1, -1).map(zelle);
        const schrittSpalte = spalten.findIndex((s) => /^Nächster (sinnvoller )?Schritt$/u.test(s));
        if (schrittSpalte < 0 || !/^\s*\|[\s:|-]+\|\s*$/u.test(zeilen[i + 1] ?? "")) continue;
        const bereichSpalte = Math.max(
            0,
            spalten.findIndex((s) => s === "Bereich"),
        );
        const quelleSpalte = spalten.findIndex((s) => /quelle/iu.test(s));
        const punkte: OffenerPunkt[] = [];
        for (let j = i + 2; j < zeilen.length; j++) {
            const z = zeilen[j] ?? "";
            if (!z.trim().startsWith("|")) break;
            const werte = z.split("|").slice(1, -1).map(zelle);
            const schritt = werte[schrittSpalte] ?? "";
            if (schritt === "") continue;
            punkte.push({
                bereich: werte[bereichSpalte] ?? "",
                schritt,
                quelle: quelleSpalte < 0 ? null : werte[quelleSpalte] || null,
            });
        }
        return punkte;
    }
    return null;
}

// ───────────────────────── Die Seite ─────────────────────────

export interface SeitenEingabe {
    /** Der Ergebnisordner des Laufs. */
    readonly ordner: string;
    /** Der Text von `current.md` im Stand der geprüften SHA; `null`, wenn er sich nicht lesen ließ. */
    readonly offen: string | null;
}

interface StatusDatei {
    sha?: unknown;
    start?: unknown;
    ende?: unknown;
    status?: unknown;
    profil?: unknown;
    auftrag?: unknown;
    nurBericht?: unknown;
    vorlauf?: unknown;
}

/** Der Bericht von Teil 1 eines Volltests für die Seite von Teil 2: Überschriften eine Stufe tiefer, ohne seinen Teil „Offen“ (der steht unten). */
export function vorlaufAbschnitt(text: string): string[] {
    const zeilen: string[] = [];
    for (const zeile of text.split(/\r?\n/u)) {
        if (/^## Offen\b/u.test(zeile)) break;
        zeilen.push(/^#{1,5} /u.test(zeile) ? `#${zeile}` : zeile);
    }
    while (zeilen.length > 0 && zeilen.at(-1)?.trim() === "") zeilen.pop();
    return zeilen;
}

const text = (w: unknown): string | undefined => (typeof w === "string" && w !== "" ? w : undefined);

function dauer(start: string | undefined, ende: string | undefined): string {
    const ms = Date.parse(ende ?? "") - Date.parse(start ?? "");
    if (!Number.isFinite(ms) || ms < 0) return "–";
    const minuten = Math.round(ms / 60_000);
    return minuten < 60
        ? `${String(minuten)} min`
        : `${String(Math.floor(minuten / 60))} h ${String(minuten % 60)} min`;
}

/** Pfade in Meldungen ohne den Ergebnisordner davor: `…/.release-runs/<sha>/checkout/apps/x.ts:5:3` → `apps/x.ts:5:3`. */
const ohneLaufordner = (zeile: string): string =>
    zeile.replace(/(?:file:\/\/\/)?(?:[A-Za-z]:)?[^\s()]*[\\/]checkout[\\/]/gu, "");

/** Die Meldung eines Falls: ohne die Stapelzeilen von Vitest und Node, nur die erste behält die Stelle im Test. */
function meldung(zeilen: readonly string[]): string[] {
    let stapel = false;
    const aus: string[] = [];
    for (const z of zeilen) {
        if (z.trim() === "") continue;
        if (/^\s*at /u.test(z)) {
            if (stapel || /node_modules|node:internal|<anonymous>/u.test(z)) continue;
            stapel = true;
        }
        aus.push(ohneLaufordner(z));
    }
    return aus;
}

function fallZeilen(fall: BerichtFall): string[] {
    const kopf = `- \`${fall.datei}\`${fall.name === "" ? " (die ganze Datei lief nicht)" : ` — ${fall.name}`}`;
    return [kopf, ...meldung(fall.meldung).map((z) => `      ${z}`)];
}

/**
 * Baut die Seite aus dem Ergebnisordner. Wirft nicht: Was fehlt (ein Bericht, ein Protokoll), steht als Satz da. Ein grüner Lauf hat einen leeren
 * Teil „Rot“ und sagt, was mit der Freigabe geschieht.
 */
export function baueBerichtSeite(e: SeitenEingabe): string {
    const { ordner } = e;
    const status = (leseJson(join(ordner, "status.json")) ?? {}) as StatusDatei;
    const sha = text(status.sha) ?? "unbekannt";
    const zustand = text(status.status) ?? "unbekannt";
    const start = text(status.start);
    const ende = text(status.ende);
    const auftrag = text(status.auftrag);
    const nurBericht = status.nurBericht === true;
    const vorlauf =
        typeof status.vorlauf === "object" && status.vorlauf !== null
            ? text((status.vorlauf as { ordner?: unknown }).ordner)
            : undefined;
    const fehlerText = leseText(join(ordner, "fehler.txt"));
    const buch = leseLaufBuch(ordner);
    const gruen = new Set(
        leseTeileStatus(ordner)
            .filter((t) => t.status === "gruen")
            .map((t) => t.klasse),
    );
    const zeilen: string[] = [];
    const wort: Readonly<Record<string, string>> = {
        gruen: "grün",
        rot: "rot",
        abgebrochen: "abgebrochen",
        timeout: "Zeitgrenze überschritten",
        laeuft: "läuft noch",
    };

    zeilen.push(`# Release-Test ${sha.slice(0, 12)}: ${wort[zustand] ?? zustand}`, "");
    zeilen.push(`- Stand: \`${sha}\``);
    zeilen.push(`- Prüfprofil: ${text(status.profil) ?? "voll"}`);
    zeilen.push(`- Start: ${start ?? "–"} · Ende: ${ende ?? "–"} · Dauer: ${dauer(start, ende)}`);
    if (nurBericht)
        zeilen.push(
            vorlauf === undefined
                ? "- Volltest: nur Bericht; dieser Lauf liefert nichts aus und schreibt keine Notiz nach origin."
                : "- Volltest, Teil 2 (voller Lauf): nur Bericht; liefert nichts aus. Der Bericht von Teil 1 (Schnelltest) steht weiter unten.",
        );
    else if (zustand === "gruen")
        zeilen.push(
            auftrag === undefined
                ? "- Freigabe: keine (von Hand gestartet); dieser Lauf geht nicht von selbst nach Production."
                : `- Freigabe: ${auftrag}; grün, genau dieser Stand geht jetzt automatisch nach Production.`,
        );
    else
        zeilen.push(
            auftrag === undefined
                ? "- Freigabe: keine (von Hand gestartet)."
                : `- Freigabe: ${auftrag}; nicht grün, nichts geht nach Production. Der nächste Start ist wieder die Wahl des Betreibers.`,
        );
    // Welcher Weg im Routing-Gate galt (WI-0248, `release-routing.ts`): Basislinie passt, Gegenprobe mit den Ausreißern der Daten, oder gescheitert.
    const routing = leseRoutingWeg(ordner);
    if (routing !== undefined) for (const z of routingZeilen(routing)) zeilen.push(zeileFuerAnzeige(z, 400));
    zeilen.push(`- Ergebnisordner: ${relativ(ordner)}`, "");

    // --- Rot -----------------------------------------------------------------------------------------------------------
    const abschnitte: { titel: string; faelle: BerichtFall[]; protokoll?: string[]; satz?: string }[] = [];
    const { rot, uebersprungen } = schritteAusFehlerText(fehlerText);
    const rotGemeldet = new Set<string>(rot);
    const schritte = buch?.schritte ?? {};
    for (const [id, s] of Object.entries(schritte)) if (s.status === "rot") rotGemeldet.add(id);

    for (const id of STATISCH) {
        if (!rotGemeldet.has(id)) continue;
        const protokoll = leseText(join(ordner, `${id}.log`));
        const faelle =
            id === "lint"
                ? faelleAusLint(protokoll)
                : id === "format"
                  ? faelleAusFormat(protokoll)
                  : faelleAusTypen(protokoll);
        abschnitte.push({
            titel: `Statische Prüfung: ${schrittName(id)}`,
            faelle,
            ...(faelle.length === 0
                ? { protokoll: leseDateiEnde(join(ordner, `${id}.log`), SEITE_PROTOKOLL_ZEILEN) }
                : {}),
        });
    }
    if (!gruen.has("voll")) {
        const bericht = leseJson(join(ordner, "vitest.json"));
        if (bericht !== undefined) {
            const r = faelleVonVitest(
                bericht,
                undefined,
                neuerFaelleSammler(Number.POSITIVE_INFINITY, SEITE_MELDUNG_ZEILEN),
            );
            if (r.faelle.length > 0) abschnitte.push({ titel: "Vitest", faelle: r.faelle });
        } else if (rotGemeldet.has("tests")) {
            abschnitte.push({
                titel: "Vitest",
                faelle: [],
                satz: "Kein Vitest-Bericht im Ergebnisordner.",
                protokoll: leseDateiEnde(join(ordner, "tests.log"), SEITE_PROTOKOLL_ZEILEN),
            });
        }
    }
    // Der Teil `daten` des Tors: ein Vitest-Bericht (`daten.json`) mit den Fällen der Schreibwege auf den echten Daten.
    if (!gruen.has("daten")) {
        const bericht = leseJson(join(ordner, "daten.json"));
        if (bericht !== undefined) {
            const r = faelleVonVitest(
                bericht,
                undefined,
                neuerFaelleSammler(Number.POSITIVE_INFINITY, SEITE_MELDUNG_ZEILEN),
            );
            if (r.faelle.length > 0) abschnitte.push({ titel: schrittName("daten"), faelle: r.faelle });
        } else if (rotGemeldet.has("daten")) {
            abschnitte.push({
                titel: schrittName("daten"),
                faelle: [],
                satz: "Kein Bericht im Ergebnisordner.",
                protokoll: leseDateiEnde(join(ordner, "daten.log"), SEITE_PROTOKOLL_ZEILEN),
            });
        }
    }
    for (const id of BROWSER_SCHRITTE) {
        if (gruen.has(id)) continue;
        const bericht = leseJson(join(ordner, `${id}.json`));
        if (bericht === undefined) {
            if (rotGemeldet.has(id))
                abschnitte.push({
                    titel: schrittName(id),
                    faelle: [],
                    satz: "Kein Bericht im Ergebnisordner.",
                    protokoll: leseDateiEnde(join(ordner, `${id}.log`), SEITE_PROTOKOLL_ZEILEN),
                });
            continue;
        }
        const r = faelleVonPlaywright(
            bericht,
            undefined,
            neuerFaelleSammler(Number.POSITIVE_INFINITY, SEITE_MELDUNG_ZEILEN),
        );
        const name = buch?.teile.find((t) => t.id === id)?.name;
        if (r.faelle.length > 0)
            abschnitte.push({
                titel: `${schrittName(id)}${name === undefined || id === "kern" || id === "kern-echt" ? "" : ` (${name})`}`,
                faelle: r.faelle,
            });
    }
    // Schritte ohne Fallbericht: das Ende ihres Protokolls.
    for (const id of ["installation", "shared", "korpus-laden", "bau", "besucherpaket"]) {
        if (!rotGemeldet.has(id)) continue;
        abschnitte.push({
            titel: schrittName(id),
            faelle: [],
            protokoll: leseDateiEnde(join(ordner, `${id}.log`), SEITE_PROTOKOLL_ZEILEN),
        });
    }
    const gesamt = abschnitte.reduce((n, a) => n + Math.max(a.faelle.length, a.faelle.length === 0 ? 1 : 0), 0);
    zeilen.push(`## Rot (${String(gesamt)})`, "");
    if (zustand === "gruen" && abschnitte.length === 0) zeilen.push("Nichts ist rot.", "");
    else {
        // Die Meldung des Runners: eine Zeile je rotem Schritt (auch Voraussetzungen, Abbruch, Zeitgrenze).
        const meldung = fehlerText
            .split(/\r?\n/u)
            .filter((z) => z.trim() !== "")
            .map((z) => zeileFuerAnzeige(z, 400));
        if (meldung.length > 0) {
            zeilen.push("Meldung des Runners:", "");
            for (const z of meldung) zeilen.push(`    ${z}`);
            zeilen.push("");
        } else if (zustand !== "gruen")
            zeilen.push(`Der Lauf endete ${wort[zustand] ?? zustand}, ohne Meldung des Runners.`, "");
        for (const a of abschnitte) {
            zeilen.push(`### ${a.titel} (${String(a.faelle.length)})`, "");
            if (a.satz !== undefined) zeilen.push(a.satz, "");
            for (const fall of a.faelle) zeilen.push(...fallZeilen(fall));
            if (a.faelle.length > 0) zeilen.push("");
            if (a.protokoll !== undefined && a.protokoll.length > 0) {
                zeilen.push("Ende des Protokolls:", "");
                for (const z of a.protokoll) zeilen.push(`    ${z}`);
                zeilen.push("");
            }
        }
        if (uebersprungen.length > 0) {
            zeilen.push("### Nicht gelaufen", "");
            for (const z of fehlerText.split(/\r?\n/u).filter((l) => / nicht gelaufen\b/u.test(l)))
                zeilen.push(`- ${zeileFuerAnzeige(z, 400)}`);
            zeilen.push("");
        }
    }

    // --- Wackelig --------------------------------------------------------------------------------------------------------
    // Das Tor (WI-0264) zählt einen Fall, der erst im zweiten Versuch grün wurde, als grün (`kern-echt`, `--retries=1`). Er verschwindet deshalb nicht:
    // Der Bericht nennt ihn, auch in einem grünen Lauf, mit der Meldung des ersten Versuchs. Nur Teile, die so zählen, haben solche Fälle (`WACKELIG_GRUEN`).
    const wackelig: BerichtFall[] = [];
    for (const id of WACKELIG_GRUEN) {
        const bericht = leseJson(join(ordner, `${id}.json`));
        if (bericht !== undefined) wackelig.push(...wackeligeFaelle(bericht));
    }
    if (wackelig.length > 0) {
        zeilen.push(`## Wackelig (${String(wackelig.length)})`, "");
        zeilen.push(
            "Diese Fälle schlugen im ersten Versuch fehl und wurden im zweiten grün. Im Release-Tor zählen sie als grün; sie stehen hier, damit sie nicht untergehen.",
            "",
        );
        for (const fall of wackelig) zeilen.push(...fallZeilen(fall));
        zeilen.push("");
    }

    // --- Teil 1 des Volltests --------------------------------------------------------------------------------------------
    if (vorlauf !== undefined) {
        const teil1 = leseText(join(dirname(ordner), vorlauf, BERICHT_DATEI));
        zeilen.push("## Teil 1 des Volltests: Schnelltest", "");
        if (teil1 === "") zeilen.push(`Der Bericht von Teil 1 (${vorlauf}) ließ sich nicht lesen.`, "");
        else zeilen.push(...vorlaufAbschnitt(teil1), "");
    }

    // --- Offen ---------------------------------------------------------------------------------------------------------
    zeilen.push(`## Offen (aus \`${OFFEN_QUELLE}\` im Stand ${sha.slice(0, 12)})`, "");
    const punkte = e.offen === null ? null : offenAusCurrent(e.offen);
    if (punkte === null)
        zeilen.push(
            e.offen === null
                ? "Die Datei ließ sich im geprüften Stand nicht lesen."
                : "In der Datei steht keine Tafel mit der Spalte „Nächster sinnvoller Schritt“.",
        );
    else if (punkte.length === 0) zeilen.push("Die Tafel nennt keinen offenen Schritt.");
    else
        for (const p of punkte)
            zeilen.push(
                `- **${zeileFuerAnzeige(p.bereich, 200)}**: ${zeileFuerAnzeige(p.schritt, 1000)}${p.quelle === null ? "" : ` (${zeileFuerAnzeige(p.quelle, 200)})`}`,
            );
    zeilen.push("");
    return zeilen.join("\n");
}

/** Schreibt `bericht.md` in den Ergebnisordner (ganz oder gar nicht). Wirft nie: Der Bericht ist nie der Grund, dass ein Lauf anders endet. */
export function schreibeBerichtSeite(ordner: string, offen: string | null): boolean {
    try {
        const datei = join(ordner, BERICHT_DATEI);
        writeFileSync(`${datei}.tmp`, baueBerichtSeite({ ordner, offen }), "utf8");
        renameSync(`${datei}.tmp`, datei);
        return true;
    } catch {
        return false;
    }
}

/** Liest `bericht.md`, oder baut ihn aus dem Ordner, wenn er fehlt (Läufe von vorher). `undefined` ohne Ergebnisordner. */
export function leseBerichtSeite(ordner: string, offen: () => string | null): string | undefined {
    if (!existsSync(join(ordner, "status.json"))) return undefined;
    const datei = join(ordner, BERICHT_DATEI);
    if (existsSync(datei)) {
        const vorhanden = leseText(datei);
        if (vorhanden !== "") return vorhanden;
    }
    return baueBerichtSeite({ ordner, offen: offen() });
}
