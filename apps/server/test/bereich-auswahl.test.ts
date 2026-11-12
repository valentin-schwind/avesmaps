import { describe, expect, it } from "vitest";
import { OBJEKT_HOECHSTENS, objekteDerMigration, waehleBereich } from "../../../scripts/dev/bereich-auswahl.ts";
import type { TestDatei } from "../../../scripts/dev/pruef-auswahl.ts";

/**
 * Die Tests des eigenen Bereichs für die leichte Stufe von `vor-dem-push -- --tests` (`scripts/dev/bereich-auswahl.ts`, WI-0228, Betreiber
 * 2026-10-18 „A, ab jetzt immer“). Problemfälle: eine Änderung im Fach-Ordner prüft dessen Tests nicht; eine Migration wählt alle 190
 * Datenbankdateien (der alte volle Lauf) oder gar keine; ein Allerweltsobjekt wie `path` zieht fast jeden Test mit; die Regelwerk-Wächter
 * fallen weg.
 */
/** Das Merkmal eines Datenbanktests, zusammengesetzt: Stünde es wörtlich hier, hielte die Testumgebung diese Datei selbst dafür. */
const MERKMAL = ["TEST", "DATABASE", "URL"].join("_");
const DB = `process.env.${MERKMAL}`;
const TESTS: TestDatei[] = [
    { pfad: "apps/server/test/regelwerk-nummern.test.ts", text: "// Nummern" },
    {
        pfad: "apps/server/test/territory-reshape.test.ts",
        text: `import { x } from "../src/editor/territory-reshape.ts"; ${DB}`,
    },
    { pfad: "apps/server/test/editor-lock.test.ts", text: `import { y } from "../src/editor/editor-lock.ts"; ${DB}` },
    { pfad: "apps/server/test/route-api.test.ts", text: 'import { r } from "../src/routing/router.ts";' },
    { pfad: "apps/server/test/field-origin.test.ts", text: `SELECT * FROM field_origin; ${DB}` },
    { pfad: "apps/server/test/render-definitions.test.ts", text: `__snapshots__; ${DB}` },
    {
        pfad: "apps/server/test/pruefbank.test.ts",
        text: 'import { nimmBank } from "../../../scripts/dev/pruefbank.ts";',
    },
    { pfad: "apps/server/test/zoombaender.test.ts", text: 'readFileSync("config/zoom-bands/bands.json")' },
    { pfad: "apps/server/test/coordination.test.ts", text: 'join("project-control/handovers", name)' },
    { pfad: "apps/web/test/panel.test.ts", text: "// Panel" },
    { pfad: "packages/shared/test/zoom-bands.test.ts", text: "// Bänder" },
];
const datenbank = TESTS.filter((t) => t.text.includes(MERKMAL)).map((t) => t.pfad);
const waehle = (geaendert: string[], dateien: Record<string, string> = {}) =>
    waehleBereich({ geaendert, testDateien: TESTS, datenbankDateien: datenbank, liesDatei: (p) => dateien[p] });

describe("Tests des Bereichs", () => {
    it("🔴 Fach-Ordner: die Servertests, die aus ihm importieren oder namensverwandt sind; nicht die anderer Ordner", () => {
        const a = waehle(["apps/server/src/editor/territory-reshape.ts"]);
        expect(a.dateien).toContain("apps/server/test/territory-reshape.test.ts");
        expect(a.dateien).toContain("apps/server/test/editor-lock.test.ts");
        expect(a.dateien).not.toContain("apps/server/test/route-api.test.ts");
        expect(a.gruende).toContain("Fach-Ordner editor");
    });

    it("🔴 immer die Regelwerk-Wächter, auch wenn sonst nichts passt", () => {
        expect(waehle(["package.json"]).dateien).toEqual(["apps/server/test/regelwerk-nummern.test.ts"]);
    });

    it("🔴 Migration: die Datenbanktests, die ihre Objekte nennen, dazu die Schema-Wächter; nicht alle Datenbanktests", () => {
        const a = waehle(["apps/server/migrations/0183_field_origin.sql"], {
            "apps/server/migrations/0183_field_origin.sql":
                "CREATE TABLE IF NOT EXISTS public.field_origin (id int);\nGRANT SELECT ON TABLE field_origin TO avesmaps3d_app;",
        });
        expect(a.dateien).toContain("apps/server/test/field-origin.test.ts");
        expect(a.dateien, "Schema-Wächter").toContain("apps/server/test/render-definitions.test.ts");
        expect(a.dateien, "ein Datenbanktest ohne Bezug").not.toContain("apps/server/test/editor-lock.test.ts");
    });

    it("🔴 ein Allerweltsobjekt (mehr als OBJEKT_HOECHSTENS Dateien) wählt nichts, die seltenen Objekte derselben Migration weiter", () => {
        const viele: TestDatei[] = Array.from({ length: OBJEKT_HOECHSTENS + 1 }, (_, i) => ({
            pfad: `apps/server/test/p${String(i)}.test.ts`,
            text: `INSERT INTO path; ${DB}`,
        }));
        const alle = [...TESTS, ...viele, { pfad: "apps/server/test/tunnel.test.ts", text: `path_tunnel; ${DB}` }];
        const db = alle.filter((t) => t.text.includes(MERKMAL)).map((t) => t.pfad);
        const sql = "ALTER TABLE path ADD COLUMN tunnel boolean;\nCREATE TABLE path_tunnel (id int);";
        const a = waehleBereich({
            geaendert: ["apps/server/migrations/0172_path_tunnel.sql"],
            testDateien: alle,
            datenbankDateien: db,
            liesDatei: () => sql,
        });
        expect(a.dateien).toContain("apps/server/test/tunnel.test.ts");
        expect(a.dateien.filter((d) => /\/p\d+\.test\.ts$/.test(d))).toEqual([]);
        // Bleibt nur das Allerweltsobjekt, wählt das seltenste.
        const nurPath = waehleBereich({
            geaendert: ["apps/server/migrations/0172_path_tunnel.sql"],
            testDateien: alle,
            datenbankDateien: db,
            liesDatei: () => "ALTER TABLE path ADD COLUMN tunnel boolean;",
        });
        expect(nurPath.dateien.filter((d) => /\/p\d+\.test\.ts$/.test(d))).toHaveLength(OBJEKT_HOECHSTENS + 1);
    });

    it("Skripte, config, Weboberfläche und Doku wählen ihre Leser", () => {
        expect(waehle(["scripts/dev/pruefbank.ts"]).dateien).toContain("apps/server/test/pruefbank.test.ts");
        expect(waehle(["config/zoom-bands/bands.json"]).dateien).toContain("apps/server/test/zoombaender.test.ts");
        const web = waehle(["apps/web/src/x.vue"]).dateien;
        expect(web).toContain("apps/web/test/panel.test.ts");
        expect(web).toContain("packages/shared/test/zoom-bands.test.ts");
        expect(web).not.toContain("apps/server/test/route-api.test.ts");
        expect(waehle(["project-control/state/current.md"]).dateien).toContain("apps/server/test/coordination.test.ts");
    });

    it("🔴 config, Rechtedateien und Rollen wählen die Wächter der Schreibwege, auch ohne dass sie die Datei nennen (WI-0289)", () => {
        const waechter = [
            {
                pfad: "apps/server/test/schreibwege-app-rolle.test.ts",
                text: `// jeder Schreibweg als App-Rolle; ${DB}`,
            },
            { pfad: "apps/server/test/system-protokollpflicht.test.ts", text: `// Protokollpflicht; ${DB}` },
        ];
        const alle = [...TESTS, ...waechter];
        const db = alle.filter((t) => t.text.includes(MERKMAL)).map((t) => t.pfad);
        const nimm = (pfad: string) =>
            waehleBereich({ geaendert: [pfad], testDateien: alle, datenbankDateien: db, liesDatei: () => undefined });
        // Der Anlass: 1fa9f6223 änderte nur config/terrain/aventuria.json (Fassung 19 unter accepted).
        for (const pfad of [
            "config/terrain/aventuria.json",
            "config/legacy-zug-kategorien.json",
            "apps/server/src/db/system-grants.psql",
            "apps/server/src/auth/roles.ts",
        ]) {
            const a = nimm(pfad);
            expect(a.dateien, pfad).toContain("apps/server/test/schreibwege-app-rolle.test.ts");
            expect(a.dateien, pfad).toContain("apps/server/test/system-protokollpflicht.test.ts");
            expect(a.gruende, pfad).toContain("Schreibweg-Wächter (Rechte, Rollen, config)");
        }
        for (const pfad of ["apps/web/src/x.vue", "scripts/dev/pruefbank.ts", "apps/server/src/db/pool.ts"]) {
            expect(nimm(pfad).dateien, pfad).not.toContain("apps/server/test/schreibwege-app-rolle.test.ts");
        }
    });
});

describe("Objekte einer Migration", () => {
    it("🔴 Tabellen, Sichten, Funktionen und Rechte, ohne Schema, ohne Schlüsselwörter und Aliase", () => {
        const sql = [
            "ALTER TABLE public.path ADD COLUMN tunnel boolean;",
            "CREATE OR REPLACE VIEW path_render AS SELECT v.path_id FROM x v JOIN y ON v.path_id = y.id;",
            "CREATE OR REPLACE FUNCTION public.job_enqueue(kind text) RETURNS void AS $$ $$;",
            "COMMENT ON COLUMN path_revision.revision IS 'x';",
            "INSERT INTO a VALUES (1) ON CONFLICT DO NOTHING;",
            "GRANT SELECT ON TABLE field_origin TO avesmaps3d_app;",
            "ALTER TABLE b ADD CONSTRAINT fk FOREIGN KEY (c) REFERENCES public.territory(id);",
        ].join("\n");
        expect(objekteDerMigration(sql)).toEqual(
            ["b", "field_origin", "job_enqueue", "path", "path_render", "path_revision", "territory"].filter(
                (n) => n.length >= 3,
            ),
        );
    });
});
