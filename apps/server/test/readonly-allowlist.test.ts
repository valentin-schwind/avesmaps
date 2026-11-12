import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * ADR-0010: Was Claudio lesen darf, bestimmt eine Allowlist von Schemata — und in ihr liegt nichts Geheimes.
 *
 * `ops/db-readonly/claudio-readonly.sh` gibt der Rolle `claudio` SELECT auf alles in den Schemata der Allowlist,
 * auch auf alles, was eine Migration dort KÜNFTIG anlegt (Default-Privilegien). Legte eine Migration Konten,
 * Sitzungen, Capability-Links, Tokens oder Geheimnis-Hashes dorthin, wären sie ab dem nächsten Deploy für Claudio
 * lesbar, ohne dass es jemand bemerkt (Anforderung #8, Handover `2026-09-23-db-lesezugriff-claudio.md`). Solche
 * Daten gehören in ein eigenes Schema außerhalb der Allowlist.
 *
 * 🪤 Eine Sicht liest mit den Rechten ihrer Besitzerin. Eine Sicht in `public` über ein geschütztes Schema öffnet
 * es für jeden, der die Sicht lesen darf — `ops/db-readonly/test/run-sql-test.sh` belegt das am echten Server.
 *
 * ⭐ Das ist ein Stolperdraht, kein Beweis: er erkennt sensible Daten an ihren Namen. Schlägt er an, wird
 * entschieden — die Tabelle kommt ins geschützte Schema, oder die Ausnahme steht mit Begründung in
 * `BEWUSST_LESBAR`. Den Test abzuschwächen ist keine der beiden Möglichkeiten.
 *
 * Zieht eine Tabelle ins geschützte Schema um, bleibt die alte im Überlapp eines Release stehen (erst erweitern, dann umstellen,
 * dann entfernen). In der Zeit nimmt das Skript sie Claudio wieder weg (`AUSGENOMMEN`, ADR-0010 Nachtrag 2026-11-07); nur dann
 * zählt sie hier nicht. Die Zeile steht wie die Allowlist genau einmal im Skript.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const scriptPath = fileURLToPath(new URL("../../../ops/db-readonly/claudio-readonly.sh", import.meta.url));
const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Die Allowlist steht genau einmal im Skript; eine zweite Quelle würde auseinanderlaufen. */
async function readAllowlist(): Promise<string[]> {
    const script = await readFile(scriptPath, "utf8");
    const match = /^readonly SCHEMAS="([^"]+)"/m.exec(script);
    if (!match?.[1]) {
        throw new Error("readonly SCHEMAS=... fehlt in ops/db-readonly/claudio-readonly.sh");
    }
    return match[1].split(/\s+/).filter((name) => name.length > 0);
}

/** Tafeln in der Allowlist, die das Skript Claudio wieder entzieht (`schema.relation`); auch sie stehen genau einmal im Skript. */
async function readAusgenommen(): Promise<string[]> {
    const script = await readFile(scriptPath, "utf8");
    const zeilen = script.match(/^readonly AUSGENOMMEN=.*$/gm) ?? [];
    const match = /^readonly AUSGENOMMEN="([^"]*)"/.exec(zeilen[0] ?? "");
    if (zeilen.length !== 1 || match?.[1] === undefined) {
        throw new Error(
            'readonly AUSGENOMMEN="..." fehlt in ops/db-readonly/claudio-readonly.sh oder steht dort mehrfach',
        );
    }
    return match[1].split(/\s+/).filter((name) => name.length > 0);
}

/** Namensteile, an denen Konten, Sitzungen, Capability-Links, Tokens und Geheimnisse zu erkennen sind. */
const SENSIBLE_RELATIONEN = new Set([
    "account",
    "accounts",
    "user",
    "users",
    "session",
    "sessions",
    "credential",
    "credentials",
    "token",
    "tokens",
    "capability",
    "capabilities",
    "invitation",
    "invitations",
    "secret",
    "secrets",
    "login",
    "logins",
    "oauth",
    "password",
    "passwords",
]);
const SENSIBLE_SPALTEN = new Set([
    "password",
    "passwd",
    "secret",
    "token",
    "credential",
    "credentials",
    "salt",
    "session",
    "otp",
    "totp",
    "email",
    "mail",
    "discord",
    "cookie",
    "nonce",
    "oauth",
    "ip",
]);
const SENSIBLER_SCHLUESSEL = /(^|_)(api|private|access|secret|signing)_?key(_|$)/;

/**
 * Bewusst lesbare Ausnahmen, jede mit Begründung: `schema.relation` oder `schema.relation.spalte`.
 * ADR-0010 Punkt 4: eine Ausnahme nur mit Begründung; der Test selbst bleibt unverändert.
 */
const BEWUSST_LESBAR = new Map<string, string>([
    [
        "public.discord_zustellung.nonce",
        // WI-0255, Migration 0221. Kein Token im Sinne der ADR: Discords `nonce` ist eine Wiederholungsmarke (Tag und sechs Zufallsbytes,
        // `discord/zustellung.ts` `neueNonce`), keine Anmeldung und kein Schlüssel. Sie steht ohnehin im Nachrichtenkörper `inhalt`
        // derselben Zeile (`discord/rest.ts` `nachrichtAus`), ist also über diese Tafel ohnehin lesbar. Bot-Schlüssel und Kanal liegen nie
        // in der Datenbank. Spaltenrechte gibt es nicht (ADR-0010); eine Umbenennung nur der Wache wegen schützte nichts.
        "Wiederholungsmarke der Discord-Nachricht; steht auch in `inhalt`, kein Geheimnis",
    ],
]);

function istSensibel(name: string, woerter: Set<string>): boolean {
    return name.split("_").some((teil) => woerter.has(teil)) || SENSIBLER_SCHLUESSEL.test(name);
}

describe("Lesezugriff für Claudio: die Allowlist (ADR-0010)", () => {
    it("🔴 öffnet genau public und avesmaps_ops", async () => {
        // Wer sie erweitert, entscheidet über Anforderung #8 neu: erst ADR-0010, dann diese Zeile.
        expect(await readAllowlist()).toEqual(["public", "avesmaps_ops"]);
    });

    it("nimmt nur Tafeln der Allowlist aus, jede als schema.relation", async () => {
        const allowlist = await readAllowlist();
        const falsch = (await readAusgenommen()).filter((name) => {
            const [schema, relation, ...rest] = name.split(".");
            return rest.length > 0 || !relation || !allowlist.includes(schema ?? "");
        });
        expect(falsch).toEqual([]);
    });

    it("wird von keiner Migration umgangen", async () => {
        const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
        const verstoesse: string[] = [];
        for (const file of files) {
            const sql = (await readFile(`${migrationsDirectory}${file}`, "utf8")).replace(/--[^\n]*/g, "");
            // Rechte an claudio vergibt nur das Skript; pg_read_all_data würde jedes künftige Schema mitnehmen.
            if (/\bGRANT\b[^;]*\bclaudio\b/i.test(sql) || /\bpg_read_all_data\b/i.test(sql)) {
                verstoesse.push(file);
            }
        }
        expect(verstoesse).toEqual([]);
    });
});

describeWithDatabase("Lesezugriff für Claudio: nichts Geheimes in der Allowlist (ADR-0010)", () => {
    let database: Database;
    let allowlist: string[];
    let ausgenommen: Set<string>;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        allowlist = await readAllowlist();
        ausgenommen = new Set(await readAusgenommen());
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 enthält keine Relation, die nach Konto, Sitzung, Token oder Geheimnis heißt", async () => {
        const relationen = await database<{ name: string }[]>`
            SELECT n.nspname || '.' || c.relname AS name
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY(${allowlist}) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            ORDER BY 1
        `;
        const treffer = relationen
            .map((row) => row.name)
            .filter((name) => istSensibel(name.split(".")[1] ?? "", SENSIBLE_RELATIONEN))
            .filter((name) => !BEWUSST_LESBAR.has(name) && !ausgenommen.has(name));
        expect(relationen.length, "die Migrationen haben überhaupt Relationen angelegt").toBeGreaterThan(5);
        expect(treffer).toEqual([]);
    });

    it("🔴 enthält keine Spalte für Passwörter, Tokens, Sitzungen, Schlüssel oder Kontodaten", async () => {
        const spalten = await database<{ name: string; column: string }[]>`
            SELECT table_schema || '.' || table_name AS name, column_name AS column
            FROM information_schema.columns
            WHERE table_schema = ANY(${allowlist})
            ORDER BY 1, 2
        `;
        const treffer = spalten
            .filter((row) => istSensibel(row.column, SENSIBLE_SPALTEN) && !ausgenommen.has(row.name))
            .map((row) => `${row.name}.${row.column}`)
            .filter((name) => !BEWUSST_LESBAR.has(name));
        expect(treffer).toEqual([]);
    });

    it("🔴 hat keine Sicht, die in ein Schema außerhalb der Allowlist greift", async () => {
        // Eine Sicht liest mit den Rechten ihrer Besitzerin: über sie wäre ein geschütztes Schema für claudio offen.
        const erlaubt = [...allowlist, "pg_catalog", "information_schema"];
        const griffe = await database<{ griff: string }[]>`
            SELECT DISTINCT vn.nspname || '.' || v.relname || ' -> ' || tn.nspname || '.' || t.relname AS griff
            FROM pg_class v
            JOIN pg_namespace vn ON vn.oid = v.relnamespace
            JOIN pg_rewrite r ON r.ev_class = v.oid
            JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid AND d.refclassid = 'pg_class'::regclass
            JOIN pg_class t ON t.oid = d.refobjid
            JOIN pg_namespace tn ON tn.oid = t.relnamespace
            WHERE v.relkind IN ('v', 'm') AND vn.nspname = ANY(${allowlist}) AND t.oid <> v.oid
              AND tn.nspname <> ALL(${erlaubt})
            ORDER BY 1
        `;
        expect(griffe.map((row) => row.griff)).toEqual([]);
    });
});
