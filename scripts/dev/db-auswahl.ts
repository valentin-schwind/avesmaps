// Welche Datenbanktests der volle Lauf von `vor-dem-push --tests` fährt (WI-0224, Hauptorchestrierung 2026-10-18).
//
// 🔴 Anlass: Der Betreiber klagt „diese prüfungen dauern ewig“. Alle 188 Dateien mit `TEST_DATABASE_URL` brauchen im Wegwerf-Postgres 17 min; ein Push,
// der nur einen Fach-Ordner berührt, braucht sie nicht alle. Darum wählt dieselbe Pfadregel wie bei den Stufen (`pruef-auswahl.ts`), welche Dateien
// zu den geänderten gehören. Alle 188 laufen nur mit `--voll`. Das zweite Netz ist ein voller Datenbanklauf bei Claudio nachts auf dem VPS.
//
// Die Regel, die erste, die passt:
//   1. `--voll`                                        → alle
//   2. Änderung nicht bestimmbar                       → alle
//   3. Migration, `packages/shared`, `config/`, `apps/server/src/db/`, eine Datei in der Wurzel von `apps/server/src/`, ein Hilfsbauteil unter
//      `apps/server/test/support/`, eine Wurzeldatei (npm, Vitest, TypeScript) → alle: sie speisen jeden Test
//   4. sonst die Vereinigung aus
//        a) den geänderten Testdateien selbst,
//        b) den Dateien, die aus dem Fach-Ordner importieren (`apps/server/src/<ordner>/…`: „alle Dateien des Bereichs“),
//        c) den Dateien, deren Name mit dem Namen einer geänderten Quelldatei verwandt ist (einer enthält den anderen; `editor-territories.ts` →
//           `editor-territories-routes.test.ts` und `territories.test.ts`): Routen und Dienste erreichen die Tests über `buildApp`, nicht über
//           einen Import des Ordners.
//      Web, Skripte, Doku, Planung und Server-Quellen ohne Treffer wählen nichts.
//
// 🪤 Die Auswahl ist eine Heuristik aus den Quelltexten, kein Abhängigkeitsgraph: Ein Test, der eine Änderung nur über mehrere Stufen erreicht, fällt
// durch; das Netz dafür ist der volle Lauf (`--voll`, bei Claudio nachts). Sie wird aus den Dateien gelesen, nicht aus einer Liste: ein neuer Test
// gehört von selbst dazu.
import { dbTestDateien } from "./db-tests.ts";
import type { TestDatei } from "./pruef-auswahl.ts";

export interface DbAuswahl {
    /** Die gewählten Dateien mit Testdatenbank, sortiert. */
    readonly dateien: readonly string[];
    /** Alle Dateien mit Testdatenbank (`--voll`, unbestimmbar, Migration, shared …). */
    readonly alle: boolean;
    /** Zahl aller Dateien mit Testdatenbank. */
    readonly gesamt: number;
    /** Zahl der nach Pfadregel nicht gewählten. */
    readonly ausgelassen: number;
    /** Warum diese Auswahl, in einem Satz für die Zeile im Lauf. */
    readonly grund: string;
}

/** Änderungen, die jeden Datenbanktest berühren können. */
const SPEIST_ALLE = [
    /^apps\/server\/migrations\//,
    /^apps\/server\/src\/db\//,
    /^apps\/server\/src\/[^/]+$/,
    /^apps\/server\/test\/support\//,
    /^packages\/shared\//,
    /^config\//,
    /^(package\.json|package-lock\.json|vitest[^/]*|tsconfig[^/]*)$/,
];

const SERVER_ORDNER = /^apps\/server\/src\/([^/]+)\/.+$/;

/** Der Name einer Testdatei ohne Ordner und ohne `.test.ts`. */
export function testNameVon(pfad: string): string {
    return pfad.replace(/^.*\//, "").replace(/\.test\.ts$/, "");
}

/** Der Name einer Quelldatei ohne Ordner und Endung. */
export function stammVon(pfad: string): string {
    return pfad.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
}

/** Der Testname enthält den Namen der Quelldatei oder umgekehrt (nicht unter vier Zeichen: `app` steckt in jedem zweiten Namen). */
export function namensverwandt(test: string, quelle: string): boolean {
    return (quelle.length >= 4 && test.includes(quelle)) || (test.length >= 4 && quelle.includes(test));
}

/** Importiert der Test aus `apps/server/src/<ordner>/`? */
export function importiertAus(text: string, ordner: string): boolean {
    return new RegExp(`["'](?:\\.\\./)+src/${ordner}/`).test(text);
}

/** Die Datenbankdateien, die der volle Lauf fährt. */
export function waehleDbDateien(optionen: {
    readonly geaendert: readonly string[] | undefined;
    readonly voll: boolean;
    readonly testDateien: readonly TestDatei[];
}): DbAuswahl {
    const { geaendert, voll, testDateien } = optionen;
    const alleDateien = dbTestDateien(testDateien);
    const gesamt = alleDateien.length;
    const alle = (grund: string): DbAuswahl => ({ dateien: alleDateien, alle: true, gesamt, ausgelassen: 0, grund });
    if (voll) return alle("--voll");
    if (geaendert === undefined || geaendert.length === 0) return alle("Änderung nicht bestimmbar");
    const pfade = [...new Set(geaendert.map((p) => p.split("\\").join("/")))];
    const speist = pfade.find((p) => SPEIST_ALLE.some((muster) => muster.test(p)));
    if (speist !== undefined) return alle(`${speist} speist jeden Test`);

    const text = new Map(testDateien.map((t) => [t.pfad, t.text] as const));
    const gewaehlt = new Set<string>();
    const ordnerListe = new Set<string>();
    let geaenderteTests = 0;
    for (const pfad of pfade) {
        if (alleDateien.includes(pfad)) {
            gewaehlt.add(pfad);
            geaenderteTests += 1;
        }
        const ordner = SERVER_ORDNER.exec(pfad)?.[1];
        if (ordner === undefined) continue;
        ordnerListe.add(ordner);
        const quelle = stammVon(pfad);
        for (const datei of alleDateien) {
            if (importiertAus(text.get(datei) ?? "", ordner) || namensverwandt(testNameVon(datei), quelle))
                gewaehlt.add(datei);
        }
    }
    const dateien = alleDateien.filter((d) => gewaehlt.has(d));
    const teile = [
        ordnerListe.size > 0 ? `Fach-Ordner ${[...ordnerListe].sort().join(", ")}` : "",
        geaenderteTests > 0 ? `${String(geaenderteTests)} geänderte Tests` : "",
    ].filter((t) => t !== "");
    return {
        dateien,
        alle: false,
        gesamt,
        ausgelassen: gesamt - dateien.length,
        grund: teile.length > 0 ? teile.join("; ") : "keine geänderte Datei berührt einen Datenbanktest",
    };
}

/**
 * Die Datenbankdateien der kleinen Stufen (doku, web; Hauptorchestrierung 2026-10-18): Unter den Dateien, die die Stufe wählt (Tests, die Doku oder
 * Weboberfläche lesen), nur die, deren Text den Pfad oder den Ordner einer GEÄNDERTEN Datei nennt. Ein Push, den kein Datenbanktest liest (ein
 * Browserfall, eine Beschreibung), wählt nichts und braucht weder PostgreSQL noch dessen Anlauf; so bleibt eine Doku-Zeile schnell. Nicht bestimmbar: alle
 * Kandidaten der Stufe.
 */
export function waehleDbDateienKleineStufe(optionen: {
    readonly geaendert: readonly string[] | undefined;
    readonly filter: readonly string[];
    readonly testDateien: readonly TestDatei[];
}): DbAuswahl {
    const { geaendert, filter, testDateien } = optionen;
    const alleDateien = dbTestDateien(testDateien);
    const gesamt = alleDateien.length;
    const kandidaten = alleDateien.filter((datei) => filter.some((f) => datei === f || datei.startsWith(`${f}/`)));
    const text = new Map(testDateien.map((t) => [t.pfad, t.text] as const));
    const fertig = (dateien: readonly string[], grund: string): DbAuswahl => ({
        dateien,
        alle: false,
        gesamt,
        ausgelassen: gesamt - dateien.length,
        grund,
    });
    if (geaendert === undefined) return fertig(kandidaten, "Änderung nicht bestimmbar: alle Dateien der Stufe");
    const spuren = new Set<string>();
    for (const roh of geaendert) {
        const pfad = roh.split("\\").join("/");
        spuren.add(pfad);
        const ordner = pfad.includes("/") ? pfad.slice(0, pfad.lastIndexOf("/")) : "";
        if (ordner !== "") spuren.add(ordner);
    }
    const gewaehlt = kandidaten.filter((datei) => {
        const inhalt = text.get(datei) ?? "";
        return [...spuren].some((spur) => inhalt.includes(spur));
    });
    return fertig(
        gewaehlt,
        gewaehlt.length > 0
            ? `${String(gewaehlt.length)} Datenbanktests der Stufe nennen geänderte Pfade`
            : "kein Datenbanktest der Stufe nennt eine geänderte Datei",
    );
}
