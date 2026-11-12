// Die reinen Teile des Sammellaufs (`scripts/dev/sammellauf.ts`, WI-0228): Logs lesen, rote Dateien finden, den ersten roten Commit binär
// suchen, Schuldige benennen, die Git-Notiz schreiben. Ohne Prozesse und ohne Git, damit die Regeln einzeln prüfbar sind.

/** Ein Commit, wie der Sammellauf ihn nennt. */
export interface CommitInfo {
    readonly sha: string;
    readonly betreff: string;
    readonly autor: string;
}

/** Wer an einer roten Datei schuld ist (oder vermutlich). */
export interface Schuldiger {
    /** Die rote Testdatei, Spec oder, bei einem roten Schritt ohne Testdatei, die geänderte Datei, die die Meldung nennt. */
    readonly datei: string;
    readonly art: "test" | "browser" | "schritt";
    /** `eingegrenzt`: binär gesucht; `vermutet`: der letzte Commit an der Datei; `wackelig`: im Nachlauf grün, kein Schuldiger. */
    readonly wie: "eingegrenzt" | "vermutet" | "wackelig";
    readonly commit?: CommitInfo;
    readonly wi?: string;
    readonly sitzung?: string;
}

export interface SammellaufErgebnis {
    readonly sha: string;
    readonly start: string;
    readonly ende: string;
    readonly gruen: boolean;
    /** Das Urteil (`urteilVon`); nur „gruen“ und „rot“ schreiben eine Notiz. */
    readonly urteil: Urteil;
    /** Sekunden je Teil. */
    readonly dauer: { readonly vorDemPush: number; readonly browser?: number; readonly eingrenzen?: number };
    readonly vorDemPushExit: number | null;
    readonly roteSchritte: readonly string[];
    readonly roteTests: readonly string[];
    /** Welcher Teil der Browserfälle lief: „2/4“ (ein Viertel, reihum) oder „alle“. */
    readonly browserTeil?: string;
    /** `vor-dem-push --voll` lief nicht neu: Ein früherer Lauf auf diesem Commit war schon grün (je Commit einmal). */
    readonly vorDemPushFrueher?: boolean;
    /** Die jüngsten Viertel-Läufe, an denen das Urteil hängt (bei „gruen“ decken sie alle Viertel grün ab). */
    readonly viertel?: readonly ViertelLauf[];
    readonly browser?: {
        readonly erwartet: number;
        readonly rot: number;
        readonly wackelig: number;
        readonly uebersprungen: number;
    };
    readonly roteBrowser: readonly string[];
    /** Rote Fälle aus der Liste bekannter Roter (`sammellauf-bekannt.ts`): laufen mit, zählen nicht als rot. */
    readonly bekanntRot: readonly string[];
    readonly schuldige: readonly Schuldiger[];
    /** Der Stand, gegen den eingegrenzt wurde (letzter grüner Sammellauf); `null` beim ersten Lauf. */
    readonly letzterGruen: string | null;
}

/**
 * Das Urteil eines Laufs. 🔴 Nur „gruen“ und „rot“ schreiben eine Notiz (Vertrag mit der Koordination 2026-10-18: „Rot nur für echte
 * Testfehler; ein Abbruch durch Last oder ein überholter Lauf schreibt keine Notiz“). „wackelig“: alle roten Dateien waren im Nachlauf
 * grün; „ungeprueft“: der Lauf kam nicht zu einem Urteil (Kopie, PostgreSQL, Browserfälle nicht auswertbar). Beide wiederholt der nächste Takt.
 * „offen“: vor-dem-push grün, aber die jüngsten Viertel-Läufe decken noch nicht alle Viertel grün ab (`offeneTeile`), oder die Browserfälle
 * liefen nicht (`--ohne-browser`, `urteilVon`). 🔴 Hauptorchestrierung 2026-10-19: „Kein Lauf soll den Freigabe-Knopf ohne Browserfälle
 * öffnen.“ Darum keine Notiz; der nächste Takt nimmt den Stand mit dem nächsten Viertel wieder.
 */
export type Urteil = "gruen" | "rot" | "wackelig" | "ungeprueft" | "offen";

const TEST_SCHRITT = /^(Tests|Datenbanktests)/;
const INFRA_SCHRITT = /^(Kopie nicht angelegt|PostgreSQL fehlt|Wegwerf-Postgres)/;

export function urteilVon(o: {
    readonly vorDemPushExit: number | null;
    readonly schritte: readonly string[];
    readonly browserLief: boolean;
    /** Lieferten die Browserfälle einen Bericht mit mindestens einem gelaufenen Fall? */
    readonly browserAuswertbar: boolean;
    readonly browserRot: number;
    readonly schuldige: readonly Schuldiger[];
}): Urteil {
    if (o.schritte.some((s) => INFRA_SCHRITT.test(s))) return "ungeprueft";
    if (o.vorDemPushExit !== 0 && o.schritte.length === 0) return "ungeprueft";
    if (o.browserLief && !o.browserAuswertbar) return "ungeprueft";
    if (o.vorDemPushExit === 0 && !o.browserLief) return "offen";
    if (o.vorDemPushExit === 0 && o.browserRot === 0) return "gruen";
    // Lint, Format, Typcheck und Bau sind nicht wackelig: Ihr Rot zählt ohne Nachlauf.
    if (o.schritte.some((s) => !TEST_SCHRITT.test(s))) return "rot";
    if (o.schuldige.some((s) => s.art !== "schritt" && s.wie !== "wackelig")) return "rot";
    return "wackelig";
}

/** Die Migrationen eines Commits (Dateinamen ohne `.sql`), die in der Datenbank noch nicht eingespielt sind, sortiert. */
export function fehlendeMigrationen(imCommit: readonly string[], eingespielt: readonly string[]): string[] {
    const da = new Set(eingespielt);
    return imCommit.filter((v) => !da.has(v)).sort();
}

/**
 * 🔴 Fehlen der lokalen Datenbank der Browserfälle Migrationen des Commits, sind ihre Roten unecht (2026-10-19: ohne 0208 kein Wegenetz,
 * 22 rote Fälle in einem Viertel). Dann urteilt der Lauf „ungeprueft“ statt grün oder offen (Hauptorchestrierung 2026-10-19); ein Rot aus
 * dem vollen Lauf bleibt rot, der braucht diese Datenbank nicht.
 */
export function urteilOhneMigrationen(urteil: Urteil, fehlend: number): Urteil {
    return fehlend > 0 && urteil !== "rot" ? "ungeprueft" : urteil;
}

/** Ein Viertel der Browserfälle mit Urteil: auf welchem Commit, welche Teile (mit `--alle-browser` alle), grün oder rot. */
export interface ViertelLauf {
    readonly sha: string;
    readonly teile: readonly number[];
    readonly exitCode: number | null;
    readonly gruen: boolean;
    readonly ende: string;
}

/**
 * Nur vollständig beendete, fehlerfreie Browserberichte sind Freigabenachweise. Ein wackeliger Fall (erst im Wiederholungsversuch grün) macht
 * den Teil rot; nur mit `wackeligGruen` (das Tor-Profil, Teil `kern-echt`, WI-0264) zählt er als grün, dann aber als gelaufener Fall.
 */
export function browserTeilGruen(exitCode: number | null, bericht: unknown, wackeligGruen = false): boolean {
    if (exitCode !== 0 || bericht === null || typeof bericht !== "object") return false;
    const errors = (bericht as { errors?: unknown }).errors;
    if (errors !== undefined && (!Array.isArray(errors) || errors.length > 0)) return false;
    const { zahlen, faelle } = playwrightAuswertung(bericht);
    return (
        zahlen.erwartet + (wackeligGruen ? zahlen.wackelig : 0) > 0 &&
        zahlen.rot === 0 &&
        (wackeligGruen || zahlen.wackelig === 0) &&
        faelle.length === 0
    );
}

/** Die jüngsten Viertelläufe müssen vollständig zu genau dieser Kandidaten-SHA gehören. */
export function offeneTeile(laeufe: readonly ViertelLauf[], teile: number, sha: string): number[] {
    const fenster = laeufe.slice(-teile);
    const offen: number[] = [];
    for (let teil = 1; teil <= teile; teil += 1) {
        const lauf = fenster.findLast((l) => l.sha === sha && l.teile.includes(teil));
        if (!/^[0-9a-f]{40}$/.test(sha) || lauf?.gruen !== true || lauf.exitCode !== 0) offen.push(teil);
    }
    return offen;
}

/** Die erste Zeile einer Notiz in `refs/notes/stage` (Claudio): `<sha40> <ISO-Zeit> stage`; `undefined`, wenn sie nicht passt. */
export function stageAusNotiz(text: string): { readonly sha: string; readonly zeit: string } | undefined {
    const kopf = /^([0-9a-f]{40}) (\S+) stage\s*$/.exec(text.split("\n")[0] ?? "");
    return kopf?.[1] === undefined || kopf[2] === undefined ? undefined : { sha: kopf[1], zeit: kopf[2] };
}

/** Die roten Testdateien aus der Ausgabe von `vor-dem-push` (Vitests Zeilen „FAIL <datei> > …“). */
export function roteTestDateien(log: string): string[] {
    const gefunden = new Set<string>();
    for (const treffer of log.matchAll(/FAIL\s+((?:apps|packages)\/[^\s>]+\.test\.ts)/g)) {
        if (treffer[1] !== undefined) gefunden.add(treffer[1]);
    }
    return [...gefunden].sort();
}

/** Die roten Schritte (`  ROT  <Name> (…)`) aus der Ausgabe von `vor-dem-push`. */
export function roteSchritte(log: string): string[] {
    const gefunden: string[] = [];
    for (const treffer of log.matchAll(/^ {2}ROT {2}(.+?)(?: \(\d+ s\))?$/gm)) {
        if (treffer[1] !== undefined) gefunden.push(treffer[1].trim());
    }
    return gefunden;
}

/**
 * Bei einem roten Schritt ohne Testdatei (Lint, Format, Typcheck, Bau): die geänderten Dateien des Bereichs, deren Pfad oder Name in der
 * Ausgabe steht. Die Schuld daran bleibt „vermutet“.
 */
export function genannteDateien(log: string, geaendert: readonly string[]): string[] {
    return geaendert.filter((pfad) => {
        const name = pfad.replace(/^.*\//, "");
        return log.includes(pfad) || (name.length >= 6 && log.includes(name));
    });
}

/** Das Work Item, Paket oder der Vorgang im Titel eines Commits. */
export function wiAus(betreff: string): string | undefined {
    return /\b(WI-\d{4}[a-z]?|EDIT-\d{4}|OPS-\d+|FREIGABE-\d{4})\b/.exec(betreff)?.[1];
}

/** Ein Anspruch der Anspruchsliste (`C:\avesmaps3d-data\claims\*.json`). */
export interface Anspruch {
    readonly workItem: string;
    readonly notiz?: string;
}

/** Welche Sitzung an einem Work Item sitzt: die Notiz ihres Anspruchs. */
export function sitzungFuer(wi: string | undefined, ansprueche: readonly Anspruch[]): string | undefined {
    if (wi === undefined) return undefined;
    const basis = wi.replace(/[a-z]$/, "");
    return ansprueche.find((a) => a.workItem === wi || a.workItem === basis)?.notiz;
}

/**
 * Der erste rote Commit, binär gesucht. `commits` geht von alt nach neu und endet mit dem roten Stand; der Stand davor (der letzte grüne
 * Sammellauf) gilt als grün. `gruen(sha)` fährt die eine Datei auf diesem Stand. Höchstens `ceil(log2(n))` Läufe.
 */
export async function ersterRoterCommit(
    commits: readonly string[],
    gruen: (sha: string) => Promise<boolean>,
): Promise<{ readonly sha: string | undefined; readonly laeufe: number }> {
    if (commits.length === 0) return { sha: undefined, laeufe: 0 };
    let unten = -1; // grün (die Basis)
    let oben = commits.length - 1; // rot
    let laeufe = 0;
    while (oben - unten > 1) {
        const mitte = Math.floor((unten + oben) / 2);
        laeufe += 1;
        if (await gruen(commits[mitte] ?? "")) unten = mitte;
        else oben = mitte;
    }
    return { sha: commits[oben], laeufe };
}

/** Mehrere Playwright-JSON-Berichte (etwa die vier Viertel von `--alle-viertel`) als einer: Suiten hintereinander, Zahlen summiert. */
export function vereineBerichte(berichte: readonly unknown[]): unknown {
    interface Bericht {
        readonly suites?: readonly unknown[];
        readonly stats?: { expected?: number; unexpected?: number; flaky?: number; skipped?: number };
    }
    const liste = berichte.map((b) => (b ?? {}) as Bericht);
    const summe = (feld: "expected" | "unexpected" | "flaky" | "skipped"): number =>
        liste.reduce((n, b) => n + (b.stats?.[feld] ?? 0), 0);
    return {
        suites: liste.flatMap((b) => b.suites ?? []),
        stats: {
            expected: summe("expected"),
            unexpected: summe("unexpected"),
            flaky: summe("flaky"),
            skipped: summe("skipped"),
        },
    };
}

/**
 * Ist der Nachlauf einer Spec grün? Ein bekannter roter Fall (`sammellauf-bekannt.ts`) zählt dabei nicht: Der Nachlauf fährt die ganze Datei,
 * und eine Datei mit einem bekannten roten Fall bliebe sonst immer rot, nie „wackelig“ (Lauf 5 auf f6e7be4b, 2026-10-20: `playmode.spec.ts`
 * hieß „vermutet“ allein wegen „Kamera folgt im Gebirge ruhig“). Ohne einen roten Fall im Bericht entscheidet der Exit-Code.
 */
export function nachlaufGruen(
    status: number | null,
    bericht: unknown,
    bekannt: (datei: string, titel: string) => boolean,
): boolean {
    if (status === 0) return true;
    const { faelle } = playwrightAuswertung(bericht);
    return faelle.length > 0 && faelle.every((f) => bekannt(f.datei, f.titel));
}

/** Die roten Specs eines Playwright-JSON-Berichts (Pfade relativ zu `apps/web/e2e`) und die Zahlen. */
export function playwrightAuswertung(bericht: unknown): {
    readonly rot: string[];
    /** Jeder rote Fall mit Datei und Titelpfad (Beschreibungen und Fall, mit „ › “ verbunden). */
    readonly faelle: { datei: string; titel: string }[];
    readonly zahlen: { erwartet: number; rot: number; wackelig: number; uebersprungen: number };
} {
    const rot = new Set<string>();
    const faelle: { datei: string; titel: string }[] = [];
    interface Suite {
        readonly file?: string;
        readonly title?: string;
        readonly specs?: readonly { readonly ok?: boolean; readonly file?: string; readonly title?: string }[];
        readonly suites?: readonly Suite[];
    }
    const gehe = (suite: Suite, datei: string | undefined, pfad: readonly string[]): void => {
        const hier = suite.file ?? datei;
        // Die oberste Suite trägt den Dateinamen als Titel; erst darunter beginnen die Beschreibungen.
        const titel =
            suite.file !== undefined || suite.title === undefined || suite.title === "" ? pfad : [...pfad, suite.title];
        for (const spec of suite.specs ?? []) {
            if (spec.ok !== false) continue;
            const d = (spec.file ?? hier ?? "unbekannt").split("\\").join("/");
            rot.add(d);
            faelle.push({ datei: d, titel: [...titel, spec.title ?? ""].filter((t) => t !== "").join(" › ") });
        }
        for (const kind of suite.suites ?? []) gehe(kind, hier, titel);
    };
    const roh = (bericht ?? {}) as {
        readonly suites?: readonly Suite[];
        readonly stats?: { expected?: number; unexpected?: number; flaky?: number; skipped?: number };
    };
    for (const suite of roh.suites ?? []) gehe(suite, undefined, []);
    const s = roh.stats ?? {};
    return {
        rot: [...rot].sort(),
        faelle,
        zahlen: {
            erwartet: s.expected ?? 0,
            rot: s.unexpected ?? 0,
            wackelig: s.flaky ?? 0,
            uebersprungen: s.skipped ?? 0,
        },
    };
}

/**
 * Der Text der Git-Notiz `refs/notes/sammellauf` zu einem Stand. 🔴 Die erste Zeile ist der Vertrag mit Claudios `freigabe-stand.sh`
 * (Koordination 2026-10-18): `<sha40> <ISO-Zeit> gruen|rot`. Danach Einzelheiten für Menschen.
 */
export function notizText(e: SammellaufErgebnis): string {
    if (
        e.gruen &&
        (e.urteil !== "gruen" || e.vorDemPushExit !== 0 || offeneTeile(e.viertel ?? [], 4, e.sha).length > 0)
    ) {
        throw new Error("Unvollständiger Release-Nachweis: keine grüne Git-Notiz");
    }
    const zeilen = [`${e.sha} ${e.ende} ${e.gruen ? "gruen" : "rot"}`];
    zeilen.push(
        `Sammellauf (WI-0228): vor-dem-push --voll ${e.vorDemPushExit === 0 ? (e.vorDemPushFrueher === true ? "grün (früherer Lauf auf diesem Commit)" : "grün") : `rot (Exit ${String(e.vorDemPushExit)})`}` +
            (e.browser === undefined
                ? ", Browserfälle nicht gelaufen"
                : `, Browserfälle${e.browserTeil === undefined ? "" : ` (${e.browserTeil === "alle" ? "alle" : `Teil ${e.browserTeil}`})`} ${String(e.browser.erwartet)} grün, ${String(e.browser.rot)} rot, ${String(e.browser.wackelig)} wackelig`),
    );
    if (e.viertel !== undefined && e.viertel.length > 0)
        zeilen.push(
            `Viertel: ${e.viertel.map((l) => `Teil ${l.teile.join("+")} ${l.gruen ? "grün" : "rot"} auf ${l.sha.slice(0, 9)}`).join(", ")}`,
        );
    for (const s of e.roteSchritte) zeilen.push(`rot: Schritt ${s}`);
    for (const d of [...e.roteTests, ...e.roteBrowser]) zeilen.push(`rot: ${d}`);
    for (const d of e.bekanntRot) zeilen.push(`bekannt rot: ${d}`);
    for (const s of e.schuldige) {
        const c = s.commit;
        zeilen.push(
            `${s.wie}: ${s.datei}` +
                (c === undefined ? "" : ` -> ${c.sha.slice(0, 9)} ${c.autor}: ${c.betreff.slice(0, 90)}`) +
                (s.wi === undefined ? "" : ` [${s.wi}${s.sitzung === undefined ? "" : `, ${s.sitzung.slice(0, 60)}`}]`),
        );
    }
    if (e.letzterGruen !== null)
        zeilen.push(`eingegrenzt gegen ${e.letzterGruen.slice(0, 9)} (letzter grüner Sammellauf)`);
    return `${zeilen.join("\n")}\n`;
}
