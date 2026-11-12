import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BIS_ZUR_VORLAGE, FUNKTIONEN, TAFELN, type Stufe } from "./support/public-rechte.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Rechte der App-Rolle in `public` als Positivliste (WI-0200; Review S9-02 Schritt 1; Betreiber 2026-10-16: „test is ok,
 * solange es den betrieb nicht anhält.“). Muster: `auth-schema.test.ts` („jede Tabelle des Schemas steht in auth-grants.psql“).
 *
 * Auf einem Wegwerf-Cluster mit den Rollen des VPS, dem Rechtewerkzeug und ALLEN Vorlagen unter `src/db/*.psql` (wie
 * `schreibwege-app-rolle.test.ts`) steht jede Tafel, Sicht und Funktion in `public` gegen die Tafel in `support/public-rechte.ts`:
 *
 * - 🔴 Problemfälle: eine neue Tafel, Sicht oder Funktion ohne Eintrag (das Default-Privileg gäbe ihr still alle Schreibrechte); die App
 *   darf mehr, als die Tafel sagt; sie darf TRUNCATE, REFERENCES oder TRIGGER; sie benutzt die Sequenz einer Tafel, die sie nur liest.
 * - Soll-Fälle: jede Stufe stimmt, ausgenommen die benannten Abweichungen in `BIS_ZUR_VORLAGE`, die erst Claudios Vorlage schließt.
 * - Erwartungsfall: eine erledigte Ausnahme wird rot, damit die Liste nur schrumpft.
 *
 * 🪤 Das ist ein Test, kein Tor im Betrieb: Er läuft in `npm test` und hält weder Stage noch Import noch Rollout an.
 */

const ENV = "rechtetafel";
const describeWithCluster = postgresBin ? describe : describe.skip;
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const TAFEL_DATEI = "apps/server/test/support/public-rechte.ts";
const AUSNAHME_TAFELN = new Set(BIS_ZUR_VORLAGE.tafeln);
const AUSNAHME_FUNKTIONEN = new Set(BIS_ZUR_VORLAGE.funktionen);
const AUSNAHME_SEQUENZEN = new Set(BIS_ZUR_VORLAGE.sequenzen);

interface Relation {
    name: string;
    kind: string;
    s: boolean;
    i: boolean;
    u: boolean;
    d: boolean;
    nie: string[];
}

/** Die Stufe, die die Rechte einer Relation ergeben (siehe `Stufe`); Spaltenrechte zählen wie Rechte an der Tafel. */
function stufeAus(relation: Relation): Stufe {
    if (relation.u || relation.d) return "schreiben";
    if (relation.i) return "anhaengen";
    return relation.s ? "lesen" : "keine";
}

describe("Rechtetafel der App-Rolle in public (ohne Datenbank)", () => {
    it("jede Ausnahme gehört zu einem Eintrag, der weniger erlaubt, als die App heute darf", () => {
        expect(
            BIS_ZUR_VORLAGE.tafeln.filter((name) => TAFELN[name] === undefined || TAFELN[name] === "schreiben"),
        ).toEqual([]);
        expect(BIS_ZUR_VORLAGE.funktionen.filter((name) => FUNKTIONEN[name] !== false)).toEqual([]);
        expect(new Set(BIS_ZUR_VORLAGE.tafeln).size).toBe(BIS_ZUR_VORLAGE.tafeln.length);
        expect(new Set(BIS_ZUR_VORLAGE.funktionen).size).toBe(BIS_ZUR_VORLAGE.funktionen.length);
        expect(new Set(BIS_ZUR_VORLAGE.sequenzen).size).toBe(BIS_ZUR_VORLAGE.sequenzen.length);
    });
});

describeWithCluster("Rechtetafel der App-Rolle in public (Wegwerf-Cluster mit allen Vorlagen)", () => {
    let cluster: VpsCluster;
    let relationen: Relation[];
    let funktionen: { name: string; ausfuehren: boolean }[];
    let sequenzen: { tafel: string; sequenz: string; offen: boolean }[];

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        const app = cluster.roles.app;
        // Ohne PostGIS: spatial_ref_sys und die Sichten der Erweiterung gehören nicht zur Anwendung.
        relationen = await cluster.admin.unsafe<Relation[]>(
            `SELECT c.relname AS name, c.relkind::text AS kind,
                    has_table_privilege($1, c.oid, 'SELECT') OR has_any_column_privilege($1, c.oid, 'SELECT') AS s,
                    has_table_privilege($1, c.oid, 'INSERT') OR has_any_column_privilege($1, c.oid, 'INSERT') AS i,
                    has_table_privilege($1, c.oid, 'UPDATE') OR has_any_column_privilege($1, c.oid, 'UPDATE') AS u,
                    has_table_privilege($1, c.oid, 'DELETE') AS d,
                    array_remove(ARRAY[
                        CASE WHEN has_table_privilege($1, c.oid, 'TRUNCATE') THEN 'TRUNCATE' END,
                        CASE WHEN has_table_privilege($1, c.oid, 'REFERENCES') OR has_any_column_privilege($1, c.oid, 'REFERENCES')
                             THEN 'REFERENCES' END,
                        CASE WHEN has_table_privilege($1, c.oid, 'TRIGGER') THEN 'TRIGGER' END
                    ], NULL) AS nie
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                 WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
              ORDER BY 1`,
            [app],
        );
        funktionen = await cluster.admin.unsafe<{ name: string; ausfuehren: boolean }[]>(
            `SELECT p.proname AS name, bool_or(has_function_privilege($1, p.oid, 'EXECUTE')) AS ausfuehren
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = $2
                AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                 WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
              GROUP BY p.proname ORDER BY 1`,
            [app, cluster.roles.migrate],
        );
        // Sequenzen mit ihrer Tafel (Identitäts- und serial-Spalten); offen = die App kann sie ziehen (USAGE) oder setzen (UPDATE).
        sequenzen = await cluster.admin.unsafe<{ tafel: string; sequenz: string; offen: boolean }[]>(
            `SELECT t.relname AS tafel, s.relname AS sequenz,
                    has_sequence_privilege($1, s.oid, 'USAGE') OR has_sequence_privilege($1, s.oid, 'UPDATE') AS offen
               FROM pg_class s
               JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = s.oid AND d.deptype IN ('a', 'i')
               JOIN pg_class t ON t.oid = d.refobjid
               JOIN pg_namespace n ON n.oid = s.relnamespace
              WHERE s.relkind = 'S' AND n.nspname = 'public'
              ORDER BY 1, 2`,
            [app],
        );
    }, 240_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 jede Tafel und Sicht in public steht in der Rechtetafel, und jeder Eintrag gibt es", () => {
        expect(relationen.length).toBeGreaterThanOrEqual(170);
        const ohneEintrag = relationen.map((r) => r.name).filter((name) => TAFELN[name] === undefined);
        expect(
            ohneEintrag,
            `Neue Tafel oder Sicht ohne Eintrag in ${TAFEL_DATEI}: dort nach ihrem echten Schreibweg einordnen`,
        ).toEqual([]);
        const vorhanden = new Set(relationen.map((r) => r.name));
        expect(
            Object.keys(TAFELN).filter((name) => !vorhanden.has(name)),
            "Eintrag ohne Tafel",
        ).toEqual([]);
    });

    it("🔴 jede Funktion der Migrationsrolle in public steht in der Rechtetafel, und jeder Eintrag gibt es", () => {
        expect(funktionen.length).toBeGreaterThanOrEqual(50);
        const ohneEintrag = funktionen.map((f) => f.name).filter((name) => FUNKTIONEN[name] === undefined);
        expect(ohneEintrag, `Neue Funktion ohne Eintrag in ${TAFEL_DATEI}: ausführen ja oder nein`).toEqual([]);
        const vorhanden = new Set(funktionen.map((f) => f.name));
        expect(
            Object.keys(FUNKTIONEN).filter((name) => !vorhanden.has(name)),
            "Eintrag ohne Funktion",
        ).toEqual([]);
    });

    it("🔴 die App darf an jeder Tafel und Sicht genau ihre Stufe, ausgenommen die benannten Abweichungen bis zur Vorlage", () => {
        const abweichungen = relationen
            .filter((r) => TAFELN[r.name] !== undefined && !AUSNAHME_TAFELN.has(r.name))
            .filter((r) => stufeAus(r) !== TAFELN[r.name])
            .map((r) => `${r.name}: darf ${stufeAus(r)}, Tafel sagt ${TAFELN[r.name]}`);
        expect(abweichungen).toEqual([]);
    });

    it("🔴 TRUNCATE, REFERENCES und TRIGGER hat die App an keiner Tafel", () => {
        expect(relationen.filter((r) => r.nie.length > 0).map((r) => `${r.name}: ${r.nie.join(", ")}`)).toEqual([]);
    });

    it("🔴 die App führt genau die Funktionen aus, die die Tafel nennt, ausgenommen die benannten Abweichungen bis zur Vorlage", () => {
        const abweichungen = funktionen
            .filter((f) => FUNKTIONEN[f.name] !== undefined && !AUSNAHME_FUNKTIONEN.has(f.name))
            .filter((f) => f.ausfuehren !== FUNKTIONEN[f.name])
            .map(
                (f) =>
                    `${f.name}: ausführen ${f.ausfuehren ? "ja" : "nein"}, Tafel sagt ${FUNKTIONEN[f.name] ? "ja" : "nein"}`,
            );
        expect(abweichungen).toEqual([]);
    });

    it("🔴 die Sequenz einer Tafel, die die App nur liest, kann sie weder ziehen noch setzen", () => {
        const offen = sequenzen
            .filter((row) => row.offen && (TAFELN[row.tafel] === "lesen" || TAFELN[row.tafel] === "keine"))
            .filter((row) => !AUSNAHME_TAFELN.has(row.tafel) && !AUSNAHME_SEQUENZEN.has(row.sequenz))
            .map((row) => `${row.sequenz} (${row.tafel}, ${TAFELN[row.tafel]})`);
        expect(offen).toEqual([]);
    });

    it("jede Ausnahme bis zur Vorlage besteht noch (sonst die Zeile in BIS_ZUR_VORLAGE streichen)", () => {
        const erledigt = {
            tafeln: relationen
                .filter((r) => AUSNAHME_TAFELN.has(r.name) && stufeAus(r) === TAFELN[r.name])
                .map((r) => r.name),
            funktionen: funktionen
                .filter((f) => AUSNAHME_FUNKTIONEN.has(f.name) && f.ausfuehren === FUNKTIONEN[f.name])
                .map((f) => f.name),
            sequenzen: [...AUSNAHME_SEQUENZEN].filter(
                (name) => !sequenzen.some((row) => row.sequenz === name && row.offen),
            ),
        };
        expect(erledigt).toEqual({ tafeln: [], funktionen: [], sequenzen: [] });
    });
});
