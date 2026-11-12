// Die Tests des eigenen Bereichs für die leichte Stufe von `vor-dem-push -- --tests` (WI-0228).
//
// 🔴 Anlass (Betreiber 2026-10-18, über die Hauptorchestrierung; er wählte „A, ab jetzt immer“): Der volle Testlauf wandert vom einzelnen
// Push in den Sammellauf nach dem Push (`scripts/dev/sammellauf.ts`). Vor dem Push prüft jede Sitzung nur noch, was ihre Änderung berühren kann:
// Lint, Format, Typcheck und die Tests ihres Bereichs, ohne Prüfbank, in wenigen Minuten. Was durch diese Auswahl fällt, fängt der Sammellauf.
//
// Die Auswahl ist die Vereinigung aus (je geänderter Datei):
//   1. geänderte Testdateien selbst;
//   2. `apps/server/src/<ordner>/…`: die Servertests, die aus dem Fach-Ordner importieren oder namensverwandt sind (wie `db-auswahl.ts`);
//   3. `apps/server/src/<datei>` (Wurzel), `packages/shared/src/…`, `scripts/…`, `apps/server/src/db/…`, `apps/server/test/support/…`: die Tests,
//      deren Text den Pfad (ohne Endung) nennt oder die namensverwandt sind;
//   4. `config/<ordner>/…`: die Tests, deren Text `config/<ordner>` nennt;
//   5. eine Migration: die Datenbanktests, die eine ihrer Tabellen, Sichten, Funktionen oder Typen nennen (ohne zu allgemeine wie `path`),
//      die Tests, die die Datei nennen, und die Wächter über Schema, Sichten und Rechte;
//   6. Weboberfläche: alle Tests unter `apps/web/test` und `packages/shared/test` (die Stufe „web“ in einem);
//   7. Doku: die Tests, die Doku lesen;
//   8. `config/…`, Rechtedateien (`apps/server/src/db/*grants*.psql`) und `apps/server/src/auth/…`: zusätzlich die Wächter der Schreibwege
//      (`schreibwege-app-rolle`, `system-protokollpflicht`), auch wenn sie die Datei nicht nennen (WI-0289);
//   9. immer: die Regelwerk-Wächter.
// Wurzeldateien (npm, Vitest, TypeScript) und `ops/` wählen nichts: Den Typcheck fährt jede Stufe, den Rest der Sammellauf.
//
// 🪤 Eine Heuristik aus den Quelltexten wie `db-auswahl.ts`, kein Abhängigkeitsgraph; ein neuer Test gehört von selbst dazu.
import { abhaengigeTests } from "./abhaengige-tests.ts";
import { importiertAus, namensverwandt, stammVon, testNameVon } from "./db-auswahl.ts";
import type { TestDatei } from "./pruef-auswahl.ts";

export interface BereichAuswahl {
    /** Alle gewählten Testdateien (mit und ohne Datenbank), sortiert. */
    readonly dateien: readonly string[];
    /** Warum, in Stichworten für die Zeile im Lauf. */
    readonly gruende: readonly string[];
}

const DOKU = /^(docs\/|project-control\/|review\/|\.claude\/)|\.md$/;
const LIEST_DOKU = /project-control|docs\/(regeln|design|planning)|AGENTS\.md|CLAUDE\.md/;
const REGELWERK = /(^|\/)regelwerk-[^/]+\.test\.ts$/;
const WEB_TESTS = /^(apps\/web\/test|packages\/shared\/test)\//;
const SERVER_TESTS = /^apps\/server\/test\/[^/]+\.test\.ts$/;
const MIGRATION = /^apps\/server\/migrations\/[^/]+\.sql$/;
const SERVER_ORDNER = /^apps\/server\/src\/([^/]+)\/.+$/;
const NENNT_PFAD =
    /^(apps\/server\/src\/[^/]+$|packages\/shared\/|scripts\/|apps\/server\/src\/db\/|apps\/server\/test\/support\/)/;
const CONFIG = /^config\/([^/]+)\//;
/** Die Wächter über Schema, Sichten und Rechte: Jede Migration kann sie berühren, auch ohne eines ihrer Objekte zu nennen. */
const SCHEMA_WAECHTER =
    /(^|\/)(render-definitions|render-grants|map-grants|public-rechte-app-rolle|schreibwege-app-rolle)\.test\.ts$/;
/**
 * Die Wächter der Schreibwege: Sie fahren jeden Schreibweg als App-Rolle. Was ein Schreibweg darf, hängt an Schaltern in `config/`, an den
 * Rechtedateien und an den Rollen, ohne dass einer dieser Tests die Datei nennt. Anlass (WI-0289): `1fa9f6223` (2026-11-07) setzte Fassung 19
 * in `config/terrain/aventuria.json` unter `accepted`, der Schreibweg `hoehenmodell/test` gab damit 409, und erst der Release-Test fand es.
 * Die Pfadregel hatte für die Datei nur die vier Tests gewählt, die `config/terrain` wörtlich nennen.
 */
const SCHREIBWEG_WAECHTER = /(^|\/)(schreibwege-app-rolle|system-protokollpflicht)\.test\.ts$/;
const BERUEHRT_SCHREIBWEGE = /^(config\/|apps\/server\/src\/auth\/|apps\/server\/src\/db\/[^/]*grants[^/]*\.psql$)/;

/** Schlüsselwörter, die hinter `ON` oder `CREATE …` stehen können und keinen Test auswählen sollen. */
const ZU_ALLGEMEIN = new Set([
    "public",
    "if",
    "not",
    "exists",
    "only",
    "conflict",
    "delete",
    "update",
    "insert",
    "commit",
    "each",
    "true",
    "false",
    "null",
]);

/**
 * Nennt ein Objekt mehr Datenbanktests als das, ist es zu allgemein (`path`, `place`: fast jeder Test legt sie an) und wählt nichts; die
 * übrigen Objekte derselben Migration wählen weiter. Bleibt keines, wählt das seltenste.
 */
export const OBJEKT_HOECHSTENS = 40;

/** Die Tabellen, Sichten, Funktionen und Typen, die eine Migration anlegt, ändert oder mit Rechten versieht (ohne Schema). */
export function objekteDerMigration(sql: string): string[] {
    const namen = new Set<string>();
    const name = '"?([a-z_]\\w*)"?(?:\\."?([a-z_]\\w*)"?)?';
    const muster = [
        new RegExp(
            `\\b(?:CREATE|ALTER|DROP)\\s+(?:OR\\s+REPLACE\\s+)?(?:UNLOGGED\\s+)?(?:MATERIALIZED\\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TYPE|SEQUENCE|TRIGGER|INDEX)\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?(?:ONLY\\s+)?${name}`,
            "gi",
        ),
        new RegExp(
            `\\bON\\s+(?:(?:TABLE|VIEW|MATERIALIZED\\s+VIEW|FUNCTION|SEQUENCE|COLUMN|TYPE)\\s+)?(?:ONLY\\s+)?${name}`,
            "gi",
        ),
        new RegExp(`\\bREFERENCES\\s+${name}`, "gi"),
    ];
    for (const m of muster) {
        for (const treffer of sql.matchAll(m)) {
            const erster = (treffer[1] ?? "").toLowerCase();
            const zweiter = (treffer[2] ?? "").toLowerCase();
            // `public.x` → x; `tabelle.spalte` (COMMENT ON COLUMN) → tabelle; Aliase (`ON v.path_id`) fallen unter drei Zeichen weg.
            const objekt = erster === "public" && zweiter !== "" ? zweiter : erster;
            if (objekt.length >= 3 && !ZU_ALLGEMEIN.has(objekt)) namen.add(objekt);
        }
    }
    return [...namen].sort();
}

const wort = (name: string): RegExp => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

/** Die Datenbanktests einer Migration: je Objekt die Dateien, die es nennen, ohne zu allgemeine Objekte (`OBJEKT_HOECHSTENS`). */
function dateienDerMigration(
    objekte: readonly string[],
    datenbankDateien: readonly string[],
    text: Map<string, string>,
): string[] {
    const je = objekte
        .map((o) => ({ o, dateien: datenbankDateien.filter((d) => wort(o).test(text.get(d) ?? "")) }))
        .filter((e) => e.dateien.length > 0);
    const genau = je.filter((e) => e.dateien.length <= OBJEKT_HOECHSTENS);
    const gewaehlt = genau.length > 0 ? genau : je.sort((a, b) => a.dateien.length - b.dateien.length).slice(0, 1);
    return [...new Set(gewaehlt.flatMap((e) => e.dateien))];
}

/** Die Tests des Bereichs für die geänderten Dateien. `liesDatei` liest eine Datei des geprüften Stands (für Migrationen). */
export function waehleBereich(optionen: {
    readonly geaendert: readonly string[];
    readonly quellen?: readonly TestDatei[];
    readonly testDateien: readonly TestDatei[];
    readonly datenbankDateien: readonly string[];
    readonly liesDatei: (pfad: string) => string | undefined;
}): BereichAuswahl {
    const { testDateien, datenbankDateien, liesDatei } = optionen;
    const pfade = [...new Set(optionen.geaendert.map((p) => p.split("\\").join("/")))];
    const alle = testDateien.map((t) => t.pfad);
    const text = new Map(testDateien.map((t) => [t.pfad, t.text] as const));
    const gewaehlt = new Set<string>();
    const gruende = new Set<string>();
    const nimm = (dateien: Iterable<string>, grund: string): void => {
        let neu = 0;
        for (const d of dateien) {
            if (!gewaehlt.has(d)) neu += 1;
            gewaehlt.add(d);
        }
        if (neu > 0) gruende.add(grund);
    };

    if (optionen.quellen !== undefined)
        nimm(abhaengigeTests(pfade, optionen.quellen), "transitive Importabhängigkeiten");
    for (const pfad of pfade) {
        if (alle.includes(pfad)) nimm([pfad], "geänderte Tests");
        if (BERUEHRT_SCHREIBWEGE.test(pfad)) {
            nimm(
                alle.filter((d) => SCHREIBWEG_WAECHTER.test(d)),
                "Schreibweg-Wächter (Rechte, Rollen, config)",
            );
        }
        const ordner = SERVER_ORDNER.exec(pfad)?.[1];
        if (
            ordner !== undefined &&
            ordner !== "db" &&
            (optionen.quellen === undefined || /^(auth|editor|routing|system)$/.test(ordner))
        ) {
            const quelle = stammVon(pfad);
            nimm(
                alle.filter(
                    (d) =>
                        SERVER_TESTS.test(d) &&
                        (importiertAus(text.get(d) ?? "", ordner) || namensverwandt(testNameVon(d), quelle)),
                ),
                `Fach-Ordner ${ordner}`,
            );
            continue;
        }
        if (NENNT_PFAD.test(pfad)) {
            const ohneEndung = pfad.replace(/\.[^./]+$/, "");
            const kurz = ohneEndung.replace(/^(apps\/server|packages\/shared)\//, "");
            const quelle = stammVon(pfad);
            nimm(
                alle.filter((d) => {
                    const inhalt = text.get(d) ?? "";
                    return (
                        inhalt.includes(ohneEndung) || inhalt.includes(kurz) || namensverwandt(testNameVon(d), quelle)
                    );
                }),
                `nennt ${quelle}`,
            );
            continue;
        }
        const config = CONFIG.exec(pfad)?.[1];
        if (config !== undefined) {
            nimm(
                alle.filter((d) => (text.get(d) ?? "").includes(`config/${config}`)),
                `config/${config}`,
            );
            continue;
        }
        if (MIGRATION.test(pfad)) {
            const objekte = objekteDerMigration(liesDatei(pfad) ?? "");
            const datei = pfad.replace(/^.*\//, "");
            nimm(
                dateienDerMigration(objekte, datenbankDateien, text),
                `Migration ${datei.replace(/\.sql$/, "")} (${String(objekte.length)} Objekte)`,
            );
            nimm(
                alle.filter((d) => (text.get(d) ?? "").includes(datei) || SCHEMA_WAECHTER.test(d)),
                `nennt ${datei}, Schema-Wächter`,
            );
            continue;
        }
        if (pfad.startsWith("apps/web/")) {
            if (optionen.quellen !== undefined) {
                const quelle = stammVon(pfad);
                nimm(
                    alle.filter((d) => (text.get(d) ?? "").includes(pfad) || namensverwandt(testNameVon(d), quelle)),
                    `Web-Leser ${quelle}`,
                );
                continue;
            }
            nimm(
                alle.filter((d) => WEB_TESTS.test(d)),
                "Weboberfläche",
            );
            continue;
        }
        if (DOKU.test(pfad)) {
            nimm(
                alle.filter((d) => LIEST_DOKU.test(text.get(d) ?? "")),
                "Doku",
            );
        }
    }
    nimm(
        alle.filter((d) => REGELWERK.test(d)),
        "Regelwerk-Wächter",
    );
    return { dateien: alle.filter((d) => gewaehlt.has(d)).sort(), gruende: [...gruende] };
}
