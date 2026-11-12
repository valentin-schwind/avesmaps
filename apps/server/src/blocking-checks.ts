import { createFinding, type Finding } from "./findings.ts";

/**
 * Welche Prüfungen einen Import, eine Ableitung oder einen Prüflauf anhalten dürfen: EINE Liste.
 *
 * 🔴 Betreiberentscheidung 2026-10-03: „ich will nur prüfungen die ich definiert hab, du baust einfach random
 * regeln ein die den betrieb aufhalten“ und „A ich will keine gates, die alles blockieren, es sei denn ich habe sie
 * definiert“. Deshalb gilt: Eine Prüfung eines Prüfers (`verify:*`) hält nur an, wenn sie hier steht. Jede andere Prüfung
 * rechnet wie bisher - Grenzwert, Berechnung, Zahlen -, scheitert aber nicht mehr: Sie ist ein Befund (`BEFUND` im Log,
 * `findings` im Bericht) mit ihrer Meldung und den ersten Abweichlern.
 *
 * 🔴 Zweite Entscheidung am selben Tag, im Chat der Koordination, zur Vorlage der Inventur (Abschnitt F): „A auch für die
 * Prüfungen“. Empfehlung A hieß: Blockierend bleiben nur die Quellenprüfungen der Importer (Quelle unvollständig, Gebietsexport
 * unlesbar oder mit kaputtem Baum, Darstellungstafel unbrauchbar). Alle bisherigen UNKLAR-Prüfungen melden nur noch,
 * ausdrücklich auch die Randbedingungen des Höhenmodells (Seen eben, Gipfel exakt, Meer 0, Flüsse nicht bergauf, Gipfelkern im
 * Meer) und die der Anzeigehöhen. Es gibt deshalb keine Klasse UNKLAR mehr.
 *
 * 🔴 Dritte Entscheidung am selben Tag, im Chat der Koordination, auf die Frage zu den Klima-Prüfungen (A weiter anhalten oder
 * B nur melden): „B“. Auch `verify:climate/*` (15 Prüfungen) und die Rekonstruktions-Gates (A20: Verlustfreiheit,
 * Idempotenzprobe) melden nur. Damit ist `BLOCKING_CHECKS` leer, und blockierend sind nur noch die Quellenprüfungen der
 * Importer (Gruppen 5 bis 7). Die leere Liste bleibt als Ort für eine künftige Entscheidung des Betreibers.
 *
 * Hier stehen nur Prüfungen der Klasse BETREIBER. Die Klasse OHNE (keine Betreiberbasis) steht bewusst NICHT hier: Wer eine
 * neue Prüfung schreibt, bekommt sie als Befund. 🔴 Eine neue blockierende Prüfung gibt es nur mit Entscheidung des
 * Betreibers: erst die Entscheidung, dann ein Eintrag hier mit Fundstelle, und die Inventur
 * (`project-control/discovery/blockierende-pruefungen-2026-10-03.md`) führt sie mit.
 *
 * Zwei Listen: `BLOCKING_CHECKS` für die Prüfungen der Prüfer (Schlüssel `<Prüfer>/<Prüfung>`; ein `*` am Ende steht für jede
 * Prüfung mit diesem Anfang) und `BLOCKING_SOURCE_CHECKS` für die Quellen- und Rekonstruktionsprüfungen der Importer, die
 * als Programmcode (`throw`) an ihrer Stelle stehen (Schlüssel `A12` bis `A22` der Inventur). Der Test `blocking-checks.test.ts`
 * hält beide Listen und die Inventur zusammen.
 */

export type BlockingClass = "BETREIBER";

export interface BlockingEntry {
    class: BlockingClass;
    /** Fundstelle der Betreiberentscheidung, damit der Betreiber sie wiederfindet. */
    source: string;
}

const DECISION =
    "Betreiber 2026-10-03 im Chat der Koordination: „A auch für die Prüfungen“ (Empfehlung A der Inventur, Abschnitt F)";

/**
 * Die Prüfungen der Prüfer, die das Urteil kippen dürfen. Seit 2026-10-03 („B“ zu den Klima-Prüfungen) ist die Liste leer: Kein
 * Prüfer hält einen Lauf an. Ein Eintrag braucht eine Entscheidung des Betreibers (Zitat und Datum in `source`).
 */
export const BLOCKING_CHECKS: Readonly<Record<string, BlockingEntry>> = {};

/** Eine Quellenprüfung eines Importers: wo sie im Code steht, was sie verlangt. */
export interface BlockingSourceEntry extends BlockingEntry {
    where: string;
}

const quelle = (where: string): BlockingSourceEntry => ({
    class: "BETREIBER",
    source: `${DECISION}, Gruppe 5`,
    where,
});

/**
 * Die Quellenprüfungen der Importer, die den Lauf anhalten, weil er ohne eine vollständige und lesbare Quelle nichts
 * Richtiges schreiben kann: Eine unvollständige Quelle sähe für die Stilllegequote nach einer Massenlöschung aus, die jetzt
 * nur noch gemeldet wird. Schlüssel: Nummer in der Inventur (Abschnitt A). A19 ist ein technischer Abbruch und A20 (Klima)
 * meldet seit „B“ nur; beide stehen deshalb nicht hier.
 */
export const BLOCKING_SOURCE_CHECKS: Readonly<Record<string, BlockingSourceEntry>> = {
    A12: quelle("migration/places.ts assertSourceComplete: location_count fehlt oder passt nicht zur Liste"),
    A13: quelle("migration/map-features.ts assertMapFeaturesUsable: ok, Revision und Objekte"),
    A14: quelle("migration/paths.ts assertSourceComplete: ok=false, keine Liste, ganz leer (auch Kraftlinien)"),
    A15: quelle(
        "migration/regions.ts assertSourcesComplete: Regionen-, Flächen- und Kartenquelle vollständig, nicht truncated",
    ),
    A16: quelle(
        "migration/terrain.ts readTerrainSources: ecosystem-areas nicht abgeschnitten, map-features vollständig",
    ),
    A17: quelle("migration/territories.ts assertTerritorySourceComplete: ok, Stempel, Gebiete, geometries, claims"),
    A18: {
        class: "BETREIBER",
        source: `${DECISION}, Gruppe 6`,
        where: "migration/territories.ts transformTerritories: unlesbare Zeile oder kaputter Baum (Elter fehlt, Zyklus, Fläche ohne Gebiet)",
    },
    A21: {
        class: "BETREIBER",
        source: `${DECISION}, Gruppe 7`,
        where: "migration/landscape-display.ts: Antwort der Darstellungstafel unbrauchbar (kein JSON, leerer Stempel, Zahl außerhalb der Schranken)",
    },
    A22: quelle(
        "migration/legacy-update-cli.ts fetchTriple: truncated, ok oder leere Liste der Legacy-Antworten (abweichende Revisionen melden nur, Gruppe 8)",
    ),
    A24: quelle(
        "migration/uploads-list.ts parseUploadsList: ok, truncated, leere Liste oder falsche Anzahl der Aufzählung von uploads/ (WI-0086)",
    ),
};

/** Die Einträge in der Reihenfolge der Liste (für Inventur und Test). */
export function blockingEntries(): [string, BlockingEntry][] {
    return Object.entries(BLOCKING_CHECKS);
}

/** Der Eintrag, der für diese Prüfung gilt (genauer Schlüssel vor Anfangs-Stern), oder `undefined`. */
export function blockingEntry(
    verifier: string,
    check: string,
    list: Readonly<Record<string, BlockingEntry>> = BLOCKING_CHECKS,
): BlockingEntry | undefined {
    const exact = list[`${verifier}/${check}`];
    if (exact) return exact;
    for (const [key, entry] of Object.entries(list)) {
        if (key.endsWith("*") && `${verifier}/${check}`.startsWith(key.slice(0, -1))) return entry;
    }
    return undefined;
}

/** Darf diese Prüfung anhalten? Nur, wenn sie in `BLOCKING_CHECKS` steht (`list` ist für den Test des Mechanismus). */
export function isBlockingCheck(
    verifier: string,
    check: string,
    list: Readonly<Record<string, BlockingEntry>> = BLOCKING_CHECKS,
): boolean {
    return blockingEntry(verifier, check, list) !== undefined;
}

export interface SettledChecks<T> {
    /** Das Urteil: nur eine ausgefallene BLOCKIERENDE Prüfung lässt es scheitern. */
    passed: boolean;
    /** Die Prüfungen mit ihrem Merkmal `blocking`; die eigene Aussage (`passed`/`ok`) bleibt unverändert. */
    checks: (T & { blocking: boolean })[];
}

/**
 * Wendet die Liste auf die Prüfungen eines Prüfers an. Jede Prüfung behält ihr eigenes Ergebnis; neu ist, ob ein Ausfall
 * das Urteil kippt. `passedOf` liest das Ergebnis einer Prüfung (`passed`, bei `sea-verify` `ok`).
 */
export function settleWith<T extends { name: string }>(
    verifier: string,
    checks: readonly T[],
    passedOf: (check: T) => boolean,
    list: Readonly<Record<string, BlockingEntry>> = BLOCKING_CHECKS,
): SettledChecks<T> {
    const settled = checks.map((check) => ({ ...check, blocking: isBlockingCheck(verifier, check.name, list) }));
    return { passed: settled.every((check) => passedOf(check) || !check.blocking), checks: settled };
}

/** `settleWith` für Prüfungen mit dem Feld `passed` (alle Prüfer außer dem Seegraphen). */
export function settleChecks<T extends { name: string; passed: boolean }>(
    verifier: string,
    checks: readonly T[],
    list: Readonly<Record<string, BlockingEntry>> = BLOCKING_CHECKS,
): SettledChecks<T> {
    return settleWith(verifier, checks, (check) => check.passed, list);
}

/** Das Wort vor einer Prüfzeile: das Wort für „bestanden“, `FAIL` für eine blockierende, `BEFUND` für eine meldende. */
export function checkWord(passed: boolean, blocking: boolean, okWord: string): string {
    if (passed) return okWord;
    return blocking ? "FAIL" : "BEFUND";
}

/** Die Namen der ausgefallenen BLOCKIERENDEN Prüfungen, mit Komma getrennt (für die Meldung „GESCHEITERT: …“). */
export function blockingNames(
    checks: readonly { name: string; passed: boolean; blocking?: boolean | undefined }[],
): string {
    return checks
        .filter((check) => !check.passed && check.blocking !== false)
        .map((check) => check.name)
        .join(", ");
}

/**
 * Die Schlusszeile über die Befunde eines Prüflaufs, oder `undefined`, wenn es keine gibt. `passedOf` liest das Ergebnis
 * einer Prüfung (`passed`, bei `sea-verify` `ok`); `blocking` fehlt bei einer nicht eingeordneten Prüfung und gilt dann als
 * blockierend.
 */
export function befundSummary<T extends { blocking?: boolean | undefined }>(
    checks: readonly T[],
    passedOf: (check: T) => boolean,
): string | undefined {
    const count = checks.filter((check) => !passedOf(check) && check.blocking === false).length;
    return count === 0
        ? undefined
        : `${String(count)} Prüfung(en) als BEFUND gemeldet, der Lauf wurde nicht angehalten`;
}

/** Eine ausgefallene, nicht blockierende Prüfung als Befund: ihre Meldung und die ersten Abweichler. */
export function checkFinding(
    verifier: string,
    check: { name: string; detail: string; offenders?: readonly string[] | undefined },
): Finding {
    return createFinding(
        `${verifier}/${check.name}`,
        `${check.name}: ${check.detail}; der Lauf geht weiter`,
        {},
        [],
        0,
        check.offenders ?? [],
    );
}

/** Die ausgefallenen, nicht blockierenden Prüfungen als Befunde, für Bericht und Log. */
export function checkFindings<
    T extends {
        name: string;
        detail: string;
        offenders?: readonly string[] | undefined;
        blocking?: boolean | undefined;
    },
>(verifier: string, checks: readonly T[], passedOf: (check: T) => boolean): Finding[] {
    return checks
        .filter((check) => !passedOf(check) && check.blocking === false)
        .map((check) => checkFinding(verifier, check));
}
