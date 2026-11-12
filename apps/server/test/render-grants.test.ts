import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Leserechte auf den `*_render`-Relationen, an echtem PostgreSQL gemessen.
 *
 * Claudio hat auf dem VPS gemessen, dass `DROP VIEW` + `CREATE VIEW` der Martin-Rolle das
 * Leserecht nimmt (Handover `2026-09-20-runtime-foundation.md`). Das ist die unangenehme Sorte
 * Fehler: die Migration laeuft durch, die Pruefung ist gruen, und die Karte bleibt leer.
 *
 * Diese Datei haelt den Mechanismus fest, damit er nicht noch einmal ueberrascht. Die Rechte
 * selbst setzt der Deployweg (`avesmaps3d-postmigrate`), nicht die Anwendungsmigration: eine
 * Migration bleibt deployment- und rollenneutral, es steht kein `avesmaps3d_stage_tiles` in ihr.
 *
 * 🪤 Der vollstaendige Nachweis - dass die Rolle `_tiles` eine neu angelegte Renderrelation nach
 * Migration und Postmigrate wirklich lesen kann - gehoert auf den VPS: hier fehlt die Rolle, und
 * die Testrolle darf keine anlegen. Lokal wird deshalb der Mechanismus gepinnt, dort die Wirkung.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

/**
 * Migrationen, die eine `*_render`-Sicht loeschen und neu anlegen und damit das Leserecht
 * mitnehmen. Eine Liste, kein Verbot: sie sind ausgeliefert und ihr Recht stellt der Postmigrate
 * wieder her. Kommt eine neue dazu, faellt dieser Test - und dann ist zu entscheiden, ob sie sich
 * als `CREATE OR REPLACE VIEW` schreiben laesst.
 */
const KNOWN_DROPPERS = ["0005_place_render_typed", "0007_place_render_overrides", "0009_place_render_flags"];

/** Layer names and diagnostic strings are not table access. Inspect the body, not its signature. */
function mentionsTable(body: string, table: string): boolean {
    const sql = body.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
    const identifier = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${identifier}\\b`, "i").test(sql);
}

describe("Renderrelationen und ihre Leserechte", () => {
    it("detects table references but not MVT names, diagnostics or comments", () => {
        expect(mentionsTable("SELECT * FROM public.path_label_run", "path_label_run")).toBe(true);
        expect(mentionsTable('SELECT * FROM "public"."path_label_run"', "path_label_run")).toBe(true);
        expect(mentionsTable("SELECT * FROM x JOIN path_label_run r ON true", "path_label_run")).toBe(true);
        expect(
            mentionsTable("SELECT ST_AsMVT(source, 'path_label_run') FROM path_label_run_render", "path_label_run"),
        ).toBe(false);
        expect(
            mentionsTable(
                "RAISE EXCEPTION 'climate_band isn''t writable'; -- climate_band\n/* climate_band */",
                "climate_band",
            ),
        ).toBe(false);
    });

    it("nennt genau die Migrationen, die eine Renderansicht loeschen statt sie zu ersetzen", async () => {
        const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
        const droppers: string[] = [];
        for (const file of files) {
            const sql = await readFile(new URL(file, `file://${migrationsDirectory.replace(/\\/g, "/")}`), "utf8");
            if (/DROP\s+VIEW\s+(IF\s+EXISTS\s+)?\w*_render/i.test(sql)) {
                droppers.push(file.replace(/\.sql$/, ""));
            }
        }
        expect(droppers).toEqual(KNOWN_DROPPERS);
    });

    it("legt in keiner Migration einen Rollennamen fest", async () => {
        const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql"));
        const offenders: string[] = [];
        for (const file of files) {
            const sql = await readFile(new URL(file, `file://${migrationsDirectory.replace(/\\/g, "/")}`), "utf8");
            // Eine Migration, die eine Umgebungsrolle kennt, laeuft in der anderen Umgebung nicht.
            if (/avesmaps3d_(stage|staging|prod|production)_\w+/i.test(sql)) {
                offenders.push(file);
            }
        }
        expect(offenders).toEqual([]);
    });
});

/**
 * Ein fester search_path: der des Hauses (`public, pg_temp`) oder der strengere ohne `public` (`pg_catalog, pg_temp`), bei dem jeder Name
 * voll qualifiziert steht (Migrationen 0083, 0087, 0106, 0107). Beide lassen kein fremdes Objekt vor die eigenen Tabellen.
 */
const FESTE_SUCHPFADE = ["search_path=public, pg_temp", "search_path=pg_catalog, pg_temp"];

/** Funktionen, die als Aufrufer laufen dürfen: die der Warteschlange und Trigger, die keine Sicht ruft (Begründung je Eintrag). */
const QUEUE_INVOKER_FUNCTIONS: Readonly<Record<string, string>> = {
    job_insert: "legt Jobs an; nur wer in job schreiben darf, ruft sie (die App geht über job_enqueue)",
    job_event_add: "schreibt das Ereignis zum Zustandswechsel; nur die Jobs-Rolle",
    // WI-0209 B1 (0145): ein Trigger an `territory`, keine Sicht ruft ihn; er läuft beim Schreiben als die schreibende Rolle, die
    // `territory` lesen darf.
    territory_no_cycle:
        "Trigger gegen Zyklen im Gebietsbaum; läuft beim Schreiben von territory als die schreibende Rolle",
    // WI-0287 Punkt 5 (0320): vier Auslöser, die die Rechte und die Entstehung einer erzeugten Kartenvorschau der Karte folgen lassen. Sie feuern beim Schreiben
    // von media_rights und media_asset als die schreibende Rolle (App, Migration, Medienzug), die beide Tafeln lesen und schreiben darf; keine Renderansicht und
    // keine Kachelfunktion ruft sie. Als Besitzerin liefen sie ohne Not mit mehr Recht (Auslöserfunktionen ruft niemand direkt: EXECUTE ist für PUBLIC widerrufen).
    media_rights_folgt_quelle:
        "Auslöser an media_rights: die Rechte einer erzeugten Vorschau sind die ihrer Karte; läuft als die schreibende Rolle",
    media_rights_an_erzeugte:
        "Auslöser an media_rights: zieht die Rechte der erzeugten Vorschauen nach; läuft als die schreibende Rolle",
    media_asset_entstehung_folgt_quelle:
        "Auslöser an media_asset: die Entstehung einer erzeugten Vorschau ist die ihrer Karte; läuft als die schreibende Rolle",
    media_asset_entstehung_an_erzeugte:
        "Auslöser an media_asset: zieht die Entstehung der erzeugten Vorschauen nach; läuft als die schreibende Rolle",
};

describeWithDatabase("Rechte an einer Renderansicht", () => {
    let database: Database;
    const view = "wi0004_grant_probe_render";

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
    });

    afterAll(async () => {
        await database.unsafe(`DROP VIEW IF EXISTS ${view}`);
        await database.end({ timeout: 5 });
    });

    /**
     * Der Befund selbst. Geprueft wird die Zugriffsliste der Relation, denn genau dort haengt das
     * Recht - und genau deshalb verschwindet es mit der Relation.
     */
    it("verliert das Leserecht bei DROP VIEW und behaelt es bei CREATE OR REPLACE VIEW", async () => {
        // Gemeint ist das Recht von PUBLIC (Eintrag ohne Rollennamen: `=r/besitzer`). Ein Teilstring `=r/` träfe auch das
        // Leserecht einer benannten Rolle (`rolle=r/besitzer`), das Standardrechte der Datenbank jeder neuen Sicht mitgeben
        // (etwa die Lesestufe der Jobs-Rolle; lokal kann eine solche Vorgabe aus den früheren Handskripten noch stehen, WI-0189).
        const acl = async (): Promise<string[]> => {
            const [row] = await database<{ acl: string[] | null }[]>`
                SELECT relacl::text[] AS acl FROM pg_class WHERE relname = ${view}
            `;
            return (row?.acl ?? []).filter((entry) => entry.startsWith("=r/"));
        };

        await database.unsafe(`DROP VIEW IF EXISTS ${view}`);
        await database.unsafe(`CREATE VIEW ${view} AS SELECT 1 AS eins`);
        await database.unsafe(`GRANT SELECT ON ${view} TO PUBLIC`);
        expect(await acl(), "das Recht ist gesetzt").toHaveLength(1);

        // Kompatibel ersetzt: das Recht ueberlebt. Deshalb ist dieser Weg vorzuziehen.
        await database.unsafe(`CREATE OR REPLACE VIEW ${view} AS SELECT 1 AS eins`);
        expect(await acl(), "CREATE OR REPLACE behaelt das Recht").toHaveLength(1);

        // Geloescht und neu angelegt: das Recht ist weg, ohne dass irgendetwas fehlschlaegt.
        await database.unsafe(`DROP VIEW ${view}`);
        await database.unsafe(`CREATE VIEW ${view} AS SELECT 1 AS eins`);
        expect(await acl(), "DROP + CREATE nimmt das Recht mit").toHaveLength(0);

        // Und der Postmigrate stellt es wieder her - hier als dieselbe Anweisung, die er faehrt.
        await database.unsafe(`GRANT SELECT ON ${view} TO PUBLIC`);
        expect(await acl(), "der Postmigrate holt es zurueck").toHaveLength(1);
    });

    /**
     * Die Namenskonvention ist der Vertrag mit Martin: die Rolle `_tiles` bekommt Rechte auf
     * Relationen, die auf `_render` enden. Eine Renderansicht, die anders heisst, waere fuer den
     * Postmigrate unsichtbar.
     */
    it("nennt jede Renderansicht nach der Konvention", async () => {
        const views = await database<{ relname: string }[]>`
            SELECT c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'v' AND n.nspname = 'public'
              AND c.relname NOT LIKE 'pg_%'
        `;
        const rendering = views.filter((row) => /render/i.test(row.relname)).map((row) => row.relname);
        expect(rendering.length, "es gibt ueberhaupt Renderansichten").toBeGreaterThan(0);
        for (const name of rendering) {
            expect(name.endsWith("_render"), `${name} folgt der Konvention *_render`).toBe(true);
        }
    });

    /**
     * 💣 Eine Funktion, die aus einer Renderansicht heraus eine Basistabelle liest, MUSS
     * `SECURITY DEFINER` tragen.
     *
     * Auf Staging gemessen (Claudio, Handover 2026-09-21): PostgreSQL prueft EXECUTE auf eine
     * Funktion INNERHALB einer Sicht als AUFRUFER, nicht als Sichtbesitzer - anders als den
     * Lesezugriff auf eine Tabelle. Die Kachelrolle hat auf Basistabellen bewusst kein SELECT, also
     * faellt der Rumpf mit `permission denied for table` aus.
     *
     * 🪤 Und zwar erst mit echten Daten. Auf einer leeren Datenbank laeuft der Rumpf nie, der Deploy
     * wird gruen, und die Karte bleibt spaeter leer. Lokal faellt es ueberhaupt nicht auf, weil
     * Martin hier als Eigentuemer verbindet - deshalb steht die Zusicherung als Test und nicht als
     * Beobachtung.
     */
    it("laesst keine Funktion mit Tabellenzugriff als Aufrufer laufen", async () => {
        const risky = await database<
            { proname: string; prosecdef: boolean; body: string; proconfig: string[] | null }[]
        >`
            SELECT p.proname, p.prosecdef, p.prosrc AS body, p.proconfig
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
        `;
        // Gesucht sind Funktionen, die eine unserer Basistabellen lesen. PostGIS-Aufrufe und Zugriffe
        // auf eine *_render-Sicht sind unkritisch: die Sicht liest ihre Tabellen als Besitzerin.
        const tables = await database<{ relname: string }[]>`
            SELECT c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relname NOT LIKE 'pg_%'
              AND c.relname <> 'schema_migration'
        `;
        const readers = risky.filter((row) => tables.some((table) => mentionsTable(row.body, table.relname)));
        expect(readers.length, "the guard must find actual table readers").toBeGreaterThan(0);
        const offenders = readers
            .filter((row) => !row.prosecdef || !FESTE_SUCHPFADE.some((pfad) => row.proconfig?.includes(pfad)))
            .filter((row) => !(row.proname in QUEUE_INVOKER_FUNCTIONS))
            .map((row) => row.proname);
        expect(offenders).toEqual([]);
    });

    /**
     * Die Warteschlange (WI-0074, Migration 0070): `job_insert` und `job_event_add` lesen und schreiben `job` und laufen BEWUSST als
     * Aufrufer. Nur die Jobs-Rolle hat Schreibrecht auf `job*`; die einzige Tür der App-Rolle ist `job_enqueue` (SECURITY DEFINER,
     * fester search_path, der Test oben prüft sie). Liefen die Hilfsfunktionen als Besitzerin, könnte die App sie wegen des
     * Standard-EXECUTE direkt rufen und an `job_enqueue` und seiner Liste erlaubter Arten vorbei einreihen.
     *
     * 🔴 Die Ausnahme darf kein Loch für Kacheln sein: Keine Renderansicht und keine Kachelfunktion ruft sie auf.
     */
    it("die Queue-Hilfsfunktionen laufen als Aufrufer, und kein Kachelweg ruft sie auf", async () => {
        const names = Object.keys(QUEUE_INVOKER_FUNCTIONS);
        const defined = await database<{ proname: string; prosecdef: boolean }[]>`
            SELECT proname, prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND proname = ANY(${database.array(names, 1009)}::text[])
        `;
        expect(defined.map((row) => row.proname).sort()).toEqual([...names].sort());
        expect(defined.filter((row) => row.prosecdef)).toEqual([]);
        const callers = await database<{ name: string }[]>`
            SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE '%_render'
              AND pg_get_viewdef(c.oid) ~ 'job_(insert|event_add)'
            UNION ALL
            SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype = 'bytea'::regtype AND p.prosrc ~ 'job_(insert|event_add)'
        `;
        expect(callers).toEqual([]);
    });
});

describeWithDatabase("Kachelfunktionen und ihre Hilfsfunktionen", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        // Wie `render-definitions.test.ts`: gemessen wird der Stand nach ALLEN Migrationen, auch auf einer frischen Datenbank.
        await migrate(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    /**
     * 💣 Hotfix Stage 2026-09-30: `territory_tile` rief in PL/pgSQL `territory_band_for_zoom` auf, und die
     * Kachelrolle durfte sie nicht ausführen („permission denied for function“). Das Rechtewerkzeug gibt ihr
     * EXECUTE nur auf Funktionen mit Martin-Signatur und auf Funktionen, die eine `*_render`-SICHT aufruft
     * (über `pg_depend`). Ein Aufruf INNERHALB einer Funktion steht dort nicht.
     *
     * Diese Prüfung ist die schnelle Schwester von `tile-function-grants.test.ts`: sie sucht in der
     * Testdatenbank, wo jede Funktion steht, die die Kachelrolle aufrufen darf, und verlangt von ihr
     * entweder SECURITY DEFINER (der Rumpf läuft als Eigentümerin, der Aufruf der Hilfsfunktion kommt von
     * dort) oder keinen Aufruf einer eigenen Funktion. Der Beweis mit echter Rolle steht im anderen Test;
     * diese Prüfung läuft überall, wo es eine Testdatenbank gibt.
     */
    it("🔴 lässt keine Funktion als Aufrufer laufen, die die Kachelrolle aufruft und selbst eine eigene Funktion aufruft", async () => {
        const eigene = await database<
            { proname: string; prosecdef: boolean; prosrc: string; proconfig: string[] | null; erreichbar: boolean }[]
        >`
            SELECT p.proname, p.prosecdef, p.prosrc, p.proconfig,
                   (
                       (p.prorettype = 'bytea'::regtype AND p.pronargs IN (3, 4)
                           AND p.proargtypes[0] = 'integer'::regtype AND p.proargtypes[1] = 'integer'::regtype
                           AND p.proargtypes[2] = 'integer'::regtype
                           AND (p.pronargs = 3 OR p.proargtypes[3] = 'json'::regtype))
                       OR EXISTS (
                           SELECT 1 FROM pg_depend d
                           JOIN pg_rewrite r ON r.oid = d.objid
                           JOIN pg_class c ON c.oid = r.ev_class
                           WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_proc'::regclass
                             AND d.refobjid = p.oid AND c.relkind = 'v' AND c.relname ~ '_render$'
                       )
                   ) AS erreichbar
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
        `;
        expect(
            eigene.filter((funktion) => funktion.erreichbar).length,
            "es gibt überhaupt Funktionen für die Kachelrolle",
        ).toBeGreaterThan(5);

        const verstoesse: string[] = [];
        for (const aufrufer of eigene.filter((funktion) => funktion.erreichbar)) {
            if (aufrufer.prosecdef) {
                expect(aufrufer.proconfig, `${aufrufer.proname}: fixed search_path`).toContain(
                    "search_path=public, pg_temp",
                );
                continue;
            }
            for (const ziel of eigene) {
                if (
                    ziel.proname !== aufrufer.proname &&
                    new RegExp(`\\b${ziel.proname}\\s*\\(`).test(aufrufer.prosrc)
                ) {
                    verstoesse.push(`${aufrufer.proname} ruft ${ziel.proname} auf, ohne SECURITY DEFINER`);
                }
            }
        }
        expect(verstoesse).toEqual([]);
    });
});

describe("Kachelfunktionen und der Rechtevertrag", () => {
    /**
     * 💣 CLAUDIOS BEFUND VOM 2026-09-22. `path_label_run_tile` (Migration 0023) las direkt aus der
     * Tabelle `path_label_run`, und der Staging-Deploy ist daran gescheitert:
     * „permission denied for table path_label_run".
     *
     * 🪤 Der Unterschied ist subtil. Eine SICHT läuft mit den Rechten ihres BESITZERS — deshalb
     * darf `path_render` die Tabelle `path` lesen, obwohl die Kachelrolle das nicht darf. Eine
     * FUNKTION ohne `SECURITY DEFINER` läuft mit den Rechten des AUFRUFERS und sieht nur, was die
     * Kachelrolle sehen darf: Relationen auf `_render`.
     *
     * Der Vertrag steht in `ops/runtime/runtime-foundation.sh` als Namensmuster. Dieser Test prüft
     * ihn im REPOSITORIUM, damit der nächste Fall vor dem Deploy auffällt und nicht darin.
     */
    it("🔴 lassen Kachelfunktionen nur aus *_render-Relationen lesen", async () => {
        const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
        const verstoesse: string[] = [];
        const funktion = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+_tile)\s*\([\s\S]*?\$\$;/gi;

        // 🪤 Geprüft wird der GÜLTIGE Stand, nicht die Geschichte. Eine Migration, die später
        // ersetzt wurde, darf den Test nicht dauerhaft rot halten — sonst wird er abgeschaltet
        // statt gelesen. Maßgeblich ist die letzte Fassung jeder Funktion, weil `CREATE OR
        // REPLACE` sie überschreibt; genau so steht sie am Ende auch in der Datenbank.
        const letzteFassung = new Map<string, { file: string; rumpf: string }>();

        for (const file of files) {
            const sql = await readFile(new URL(file, `file://${migrationsDirectory.replace(/\\/g, "/")}`), "utf8");
            for (const treffer of sql.matchAll(funktion)) {
                // Nur der Rumpf zählt. Der Kommentarkopf erklärt den Vertrag und nennt die
                // Tabellennamen absichtlich — er darf den Test nicht auslösen.
                letzteFassung.set(treffer[1] as string, { file, rumpf: treffer[0].replace(/--[^\n]*/g, "") });
            }
        }

        for (const [name, eintrag] of letzteFassung) {
            for (const quelle of eintrag.rumpf.matchAll(/\bFROM\s+([a-z_][a-z0-9_]*)/gi)) {
                const relation = (quelle[1] as string).toLowerCase();
                // Unterabfragen und LATERAL-Hilfen tragen hier keinen Relationsnamen.
                if (relation === "select" || relation === "lateral") {
                    continue;
                }
                if (!relation.endsWith("_render")) {
                    verstoesse.push(`${eintrag.file}: ${name} liest ${relation}`);
                }
            }
        }
        expect(verstoesse).toEqual([]);
    });
});
