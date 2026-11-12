import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SubjectDetail } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { createSubjectService, type SubjectService } from "../src/subjects/service.ts";

/**
 * Die Kraftlinie im Infopanel ist die Gruppe ihrer Segmente gleichen Namens, wie im Editor (WI-0205, Befund K1; Auftrag der
 * Hauptorchestrierung 2026-10-18). Problemfall: Eine Linie mit Teilzuordnung (zwei Segmente tragen den Artikel, eines nicht) stand als
 * zwei Linien da, oder ein Artikel klebte zwei Linien verschiedenen Namens zusammen. Dazu die Beschreibung: Die eigene stand nie im
 * Panel, obwohl Legacy sie vor der des Wiki zeigt.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const P = "c8c8c8c8-0000-4000-8000-";
const S = { eins: `${P}000000000001`, zwei: `${P}000000000002`, drei: `${P}000000000003`, fremd: `${P}000000000004` };
const SOURCE = "test-kraftlinie-gruppe";
const WIKI = "https://de.wiki-aventurica.de/wiki/Gruppenader_Testlinie";

describeWithDatabase("Kraftlinie im Infopanel: eine Gruppe je Name", { timeout: 180_000 }, () => {
    let database: Database;
    let service: SubjectService;

    async function aufraeumen(): Promise<void> {
        await database`
            DELETE FROM powerline_wiki_assignment WHERE powerline_id IN (SELECT id FROM powerline WHERE source_system = ${SOURCE})
        `;
        await database`DELETE FROM powerline WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM wiki_powerline_snapshot WHERE wiki_key = 'gruppenader-testlinie'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await aufraeumen();
        const linie = async (id: string, name: string, x: number): Promise<string> =>
            (
                await database<{ id: string }[]>`
                    INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system)
                    VALUES (${id}::uuid, 'aventuria', ${name}, FALSE, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
                            ST_SetSRID(ST_MakeLine(ST_MakePoint(${x}, 300), ST_MakePoint(${x + 10}, 310)), 0),
                            ST_SetSRID(ST_MakeLine(ST_MakePoint(${x}, 300), ST_MakePoint(${x + 10}, 310)), 0), ${SOURCE})
                    RETURNING id::text
                `
            )[0]!.id;
        const eins = await linie(S.eins, "Gruppenader", 300);
        const zwei = await linie(S.zwei, "Gruppenader", 310);
        await linie(S.drei, "Gruppenader", 320);
        // Ein anderer Name mit demselben Artikel: früher klebte der Artikel ihn an die Gruppe.
        const fremd = await linie(S.fremd, "Andere Testader", 340);
        const [snapshot] = await database<{ id: string }[]>`
            INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, staerke, affinitaet, laenge, regionen, verlauf, description)
            VALUES ('gruppenader-testlinie', ${WIKI}, 'Gruppenader', 'stark', 'Feuer', '20 Meilen', 'Kosch', NULL, 'Eine Testader.')
            RETURNING id::text
        `;
        for (const id of [eins, zwei, fremd])
            await database`
                INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                VALUES (${id}::bigint, ${WIKI}, ${snapshot!.id}::bigint, 'assigned', 'unknown')
            `;
        service = createSubjectService(database);
    }, 180_000);

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 ein Segment ohne Artikel gehört zur Linie seines Namens; der Artikel steht an der Gruppe, die Lücke in den Abschnitten", async () => {
        for (const id of [S.eins, S.drei]) {
            const linie = await service.detail({ kind: "powerline", id });
            expect(linie).not.toBeNull();
            expect(Value.Check(SubjectDetail, linie)).toBe(true);
            expect(linie!.subject).toEqual({ kind: "powerline", anchor: S.eins });
            expect(linie!.title).toBe("Gruppenader");
            expect(linie!.facts?.map((fact) => fact.field)).toContain("staerke");
            expect(linie!.lineShape).toMatchObject({ segments: 3, segmentsWithoutWiki: 1 });
        }
    });

    it("🔴 die Beschreibung: die eigene vor der des Wiki, wie Legacy („Handgetipptes schlägt Wiki“); leer folgt dem Wiki", async () => {
        const beschreibung = async () =>
            (await service.detail({ kind: "powerline", id: S.eins }))?.facts?.filter((f) => f.field === "description");
        expect(await beschreibung()).toMatchObject([{ value: "Eine Testader.", provenance: { kind: "wiki" } }]);
        await database`UPDATE powerline SET description = 'Von Hand.' WHERE public_id = ${S.zwei}::uuid`;
        try {
            expect(await beschreibung()).toMatchObject([{ value: "Von Hand.", provenance: { kind: "editorial" } }]);
        } finally {
            await database`UPDATE powerline SET description = NULL WHERE public_id = ${S.zwei}::uuid`;
        }
    });

    it("🔴 ein anderer Name mit demselben Artikel ist eine eigene Linie", async () => {
        const andere = await service.detail({ kind: "powerline", id: S.fremd });
        expect(andere?.subject).toEqual({ kind: "powerline", anchor: S.fremd });
        expect(andere?.lineShape?.segmentsWithoutWiki).toBeUndefined();
    });
});
