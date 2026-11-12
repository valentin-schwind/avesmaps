import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    gebrauchteDatenbank,
    MELDUNGEN_VAR,
    merkeSkip,
    skipGrund,
    skipZeilen,
    stelleJobsAufTestdatenbank,
    TESTDB_VAR,
    zaehleSkips,
} from "./support/test-umgebung.ts";

// 🪤 Diese Datei nennt die Variablen nur über Konstanten und Vorlagen. Stünde der Name der Testdatenbank wörtlich hier, nähme
// sie die Sperre der Testdatenbank (vitest.setup.ts), und ein wörtliches Lesen der Entwicklungsdatenbank zählte sie selbst als
// übersprungen. Beides ist Erkennung am Quelltext, und genau die wird hier geprüft.
const DEV_VAR = "DATABASE_URL";

describe("Testumgebung (WI-0189)", () => {
    const aufzuraeumen: string[] = [];
    afterEach(() => {
        for (const dir of aufzuraeumen.splice(0)) rmSync(dir, { recursive: true, force: true });
    });
    const neuesVerzeichnis = (): string => {
        const dir = mkdtempSync(join(tmpdir(), "avesmaps3d-umgebung-test-"));
        aufzuraeumen.push(dir);
        return dir;
    };

    it("stellt Kindprozesse von Jobarten auf die Testdatenbank, ohne eine gesetzte Vorgabe zu überschreiben", () => {
        const env: NodeJS.ProcessEnv = { [TESTDB_VAR]: "postgres://test", [DEV_VAR]: "postgres://dev" };
        expect(stelleJobsAufTestdatenbank(env)).toBe(true);
        expect(env["JOBS_DATABASE_URL"]).toBe("postgres://test");
        expect(env[DEV_VAR]).toBe("postgres://dev");

        const gesetzt: NodeJS.ProcessEnv = { [TESTDB_VAR]: "postgres://test", JOBS_DATABASE_URL: "postgres://eigen" };
        expect(stelleJobsAufTestdatenbank(gesetzt)).toBe(false);
        expect(gesetzt["JOBS_DATABASE_URL"]).toBe("postgres://eigen");

        const ohne: NodeJS.ProcessEnv = { [DEV_VAR]: "postgres://dev" };
        expect(stelleJobsAufTestdatenbank(ohne)).toBe(false);
        expect(ohne["JOBS_DATABASE_URL"]).toBeUndefined();
    });

    it("dieser Lauf schreibt mit Testdatenbank auch die Jobs-Kinder dorthin", () => {
        if (!process.env[TESTDB_VAR]) return;
        expect(process.env["JOBS_DATABASE_URL"]).toBeTruthy();
    });

    it("erkennt am Quelltext, welche Datenbank eine Testdatei braucht", () => {
        expect(gebrauchteDatenbank(`const url = process.env["${TESTDB_VAR}"];`)).toBe("testdatenbank");
        expect(gebrauchteDatenbank(`const url = process.env["${DEV_VAR}"];`)).toBe("entwicklungsdatenbank");
        expect(gebrauchteDatenbank(`const url = process.env.${DEV_VAR};`)).toBe("entwicklungsdatenbank");
        // Wer beide liest, biegt die Entwicklungsdatenbank für ein Kind um und braucht die Testdatenbank.
        expect(gebrauchteDatenbank(`process.env["${TESTDB_VAR}"]; process.env["${DEV_VAR}"] = x;`)).toBe(
            "testdatenbank",
        );
        expect(gebrauchteDatenbank(`expect(1).toBe(1);`)).toBeNull();
    });

    it("nennt den Grund nur, wenn die gebrauchte Datenbank fehlt, und nur für Servertests", () => {
        const dir = neuesVerzeichnis();
        const server = join(dir, "apps", "server", "test");
        mkdirSync(server, { recursive: true });
        const datei = join(server, "x.test.ts").replace(/\\/g, "/");
        writeFileSync(datei, `const url = process.env["${TESTDB_VAR}"];`);
        expect(skipGrund(datei, {})).toBe("testdatenbank");
        expect(skipGrund(datei, { [TESTDB_VAR]: "postgres://test" })).toBeNull();
        expect(skipGrund(datei.replace("/apps/server/test/", "/apps/web/test/"), {})).toBeNull();
    });

    it("zählt je Datei einmal und schreibt eine Zeile je Grund, sonst nichts", () => {
        const dir = neuesVerzeichnis();
        const env = { [MELDUNGEN_VAR]: dir };
        merkeSkip("testdatenbank", "/a/apps/server/test/a.test.ts", env);
        merkeSkip("testdatenbank", "/a/apps/server/test/a.test.ts", env);
        merkeSkip("testdatenbank", "/a/apps/server/test/b.test.ts", env);
        merkeSkip("entwicklungsdatenbank", "/a/apps/server/test/c.test.ts", env);
        const zahl = zaehleSkips(dir);
        expect(zahl).toEqual({ testdatenbank: 2, entwicklungsdatenbank: 1 });
        const zeilen = skipZeilen(zahl);
        expect(zeilen).toHaveLength(2);
        expect(zeilen[0]).toContain("2 Testdatei(en)");
        expect(zeilen[1]).toContain("Routing-Korpus");
        expect(skipZeilen({ testdatenbank: 0, entwicklungsdatenbank: 0 })).toEqual([]);
    });

    it("schreibt ohne Meldeverzeichnis nichts", () => {
        expect(() => merkeSkip("testdatenbank", "/a/apps/server/test/a.test.ts", {})).not.toThrow();
    });
});
