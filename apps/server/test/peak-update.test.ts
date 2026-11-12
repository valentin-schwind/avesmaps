import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import { listEditorLandscapes } from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { createPeak } from "../src/editor/peak-create.ts";
import { readPathTargets } from "../src/editor/path-edit.ts";
import { readEditorPeak, updatePeak } from "../src/editor/peak-update.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Gipfel und Vulkane im Derographie-Editor (WI-0178 P1, `peak.update`, Migration 0205), so wie auf dem VPS: Wegwerf-Cluster, geschrieben
 * als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Die App-Rolle darf den Gipfel nicht schreiben; die Revision zählt nicht oder ein alter Stand überschreibt einen neuen; die
 * Sperre eines anderen wird übergangen; das Protokoll trägt den Gipfel nicht; eine Lage außerhalb der Karte wird gespeichert; ein leerer
 * Name; nichts zu ändern schreibt eine Operation; die Liste der Derographie (P3) zählt Gipfel als Flächen oder lässt sie aus.
 */

const ENV = "peakupd";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const GIPFEL = "c8c8c8c8-0000-4000-8000-000000000001";

describeWithCluster("Gipfel: peak.update (WI-0178 P1, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
    const vali: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
    const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string };
        }
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        await cluster.admin`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
            VALUES (${GIPFEL}::uuid, 'aventuria', 'Probezinne', 'berggipfel', ST_SetSRID(ST_MakePoint(530, 515), 0), 3200)
        `;
    }, 300_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 Höhe, Name, Anzeige und Lage in EINER Operation gegen die Revision; Protokoll am Gipfel; ein alter Stand ist 409", async () => {
        const vorher = await readEditorPeak(cluster!.app, GIPFEL);
        expect(vorher).toMatchObject({
            name: "Probezinne",
            subtype: "berggipfel",
            height: 3200,
            showName: true,
            revision: 1,
        });
        expect(vorher?.position).toEqual([530, 515]);

        const operationId = randomUUID();
        const quittung = await updatePeak(cluster!.app, thomas, GIPFEL, {
            operationId,
            baseRevision: 1,
            changes: { name: "  Hohe Probezinne ", height: 3400, showName: false, position: [531, 516] },
        });
        expect(quittung.affected).toEqual([{ kind: "peak", id: GIPFEL, revision: 2 }]);
        expect(await readEditorPeak(cluster!.app, GIPFEL)).toMatchObject({
            name: "Hohe Probezinne",
            height: 3400,
            showName: false,
            position: [531, 516],
            revision: 2,
        });
        const [zeile] = await cluster!.admin<{ action: string; changes: Record<string, unknown> }[]>`
            SELECT action, changes FROM map_audit_event WHERE operation_id = ${operationId}::uuid AND peak_public_id = ${GIPFEL}::uuid
        `;
        expect(zeile?.action).toBe("peak.updated");
        // `heightOrigin` (WI-0253 §14, 6c3896944): Wer die Höhe von Hand setzt, nimmt sie dem Wiki ab; das Fachprotokoll trägt den Vermerk
        // mit. Dieser Gipfel wurde ohne Vermerk eingefügt (eine Höhe ohne Vermerk folgt dem Wiki), also `before: null`.
        expect(Object.keys(zeile?.changes ?? {}).sort()).toEqual([
            "height",
            "heightOrigin",
            "name",
            "position",
            "showName",
        ]);
        expect(zeile?.changes["height"]).toEqual({ before: 3200, after: 3400 });
        expect(zeile?.changes["heightOrigin"]).toEqual({ before: null, after: "manual" });

        // Ein Entwurf auf Revision 1 kommt zu spät.
        expect(
            await fehler(
                updatePeak(cluster!.app, thomas, GIPFEL, {
                    operationId: randomUUID(),
                    baseRevision: 1,
                    changes: { height: 3000 },
                }),
            ),
        ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
    });

    it("🔴 OPS-000088: Flussenden auf der Marke folgen ihrer Lage in EINER Operation; Stützpunkte, andere Wege und fremd gehaltene Flüsse bleiben; die Marke ist Ziel", async () => {
        const MARKE = "c8c8c8c8-0000-4000-8000-0000000000a1";
        const AB = "c8c8c8c8-0000-4000-8000-0000000000b1";
        const AN = "c8c8c8c8-0000-4000-8000-0000000000b2";
        const QUER = "c8c8c8c8-0000-4000-8000-0000000000b3";
        const STRASSE = "c8c8c8c8-0000-4000-8000-0000000000b4";
        const GEHALTEN = "c8c8c8c8-0000-4000-8000-0000000000b5";
        const AUFEINANDER = "c8c8c8c8-0000-4000-8000-0000000000b6";
        const [X, Y] = [610, 610];
        await cluster!.admin`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
            VALUES (${MARKE}::uuid, 'aventuria', 'Flussmarke', 'berggipfel', ST_SetSRID(ST_MakePoint(${X}, ${Y}), 0), 2000)
        `;
        const weg = async (id: string, subtype: string, punkte: [number, number][]): Promise<void> => {
            const wkt = `LINESTRING(${punkte.map(([x, y]) => `${String(x)} ${String(y)}`).join(", ")})`;
            await cluster!.admin`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
                VALUES (${id}::uuid, 'aventuria', ${id.slice(-2)}, ${subtype}, FALSE, FALSE, ST_GeomFromText(${wkt}, 0), 'test-ops88', TRUE)
            `;
        };
        await weg(AB, "Flussweg", [
            [X, Y],
            [X + 5, Y],
            [X + 9, Y + 2],
        ]);
        await weg(AN, "Flussweg", [
            [X - 6, Y - 3],
            [X, Y],
        ]);
        // Der Stützpunkt mitten im Fluss liegt auf der Marke, aber kein Ende: Er bleibt.
        await weg(QUER, "Flussweg", [
            [X - 4, Y + 4],
            [X, Y],
            [X + 4, Y + 4],
        ]);
        await weg(STRASSE, "Strasse", [
            [X, Y],
            [X, Y + 8],
        ]);
        await weg(GEHALTEN, "Flussweg", [
            [X, Y],
            [X - 8, Y],
        ]);
        // Sein anderes Ende liegt schon an der neuen Lage: Anfang und Ende lägen aufeinander.
        await weg(AUFEINANDER, "Flussweg", [
            [X, Y],
            [X + 1, Y - 1],
        ]);
        const ziele = await readPathTargets(cluster!.app, AB);
        expect(ziele?.peaks.some((marke) => marke.publicId === MARKE && marke.x === X && marke.y === Y)).toBe(true);

        await takeEditorLock(cluster!.app, {
            kind: "path",
            id: GEHALTEN,
            part: "felder",
            personId: vali.kind === "person" ? vali.personId : "",
            personName: "Valentin",
            run: randomUUID(),
        });
        const operationId = randomUUID();
        const quittung = await updatePeak(cluster!.app, thomas, MARKE, {
            operationId,
            baseRevision: 1,
            changes: { position: [X + 1, Y - 1] },
        });
        const enden = await cluster!.admin<{ id: string; a: string; z: string; punkte: number; revision: number }[]>`
            SELECT public_id::text AS id, ST_AsText(ST_StartPoint(geom)) AS a, ST_AsText(ST_EndPoint(geom)) AS z,
                   ST_NPoints(geom)::int AS punkte, revision::int AS revision
              FROM path WHERE source_system = 'test-ops88'
        `;
        const von = (id: string) => enden.find((zeile) => zeile.id === id)!;
        const neu = `POINT(${String(X + 1)} ${String(Y - 1)})`;
        expect(von(AB)).toMatchObject({ a: neu, punkte: 3, revision: 2 });
        expect(von(AN)).toMatchObject({ z: neu, punkte: 2, revision: 2 });
        expect(von(QUER).revision).toBe(1);
        expect(von(STRASSE).revision).toBe(1);
        expect(von(GEHALTEN).revision).toBe(1);
        expect(von(AUFEINANDER).revision).toBe(1);
        expect(quittung.affected).toEqual(
            expect.arrayContaining([
                { kind: "peak", id: MARKE, revision: 2 },
                { kind: "path", id: AB, revision: 2 },
                { kind: "path", id: AN, revision: 2 },
            ]),
        );
        expect(quittung.warnings).toEqual([expect.objectContaining({ code: "path_end_left" })]);
        const protokoll = await cluster!.admin<{ action: string; path: string | null }[]>`
            SELECT action, path_public_id::text AS path FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY action, path
        `;
        expect(
            protokoll
                .filter((zeile) => zeile.action === "path.endpoint_moved")
                .map((zeile) => zeile.path)
                .sort(),
        ).toEqual([AB, AN].sort());
    });

    it("🔴 hält ein anderer den Gipfel, 409 `object_locked`; der Halter selbst schreibt", async () => {
        await takeEditorLock(cluster!.app, {
            kind: "peak",
            id: GIPFEL,
            part: "felder",
            personId: vali.kind === "person" ? vali.personId : "",
            personName: "Valentin",
            run: randomUUID(),
        });
        const stand = (await readEditorPeak(cluster!.app, GIPFEL))!.revision;
        expect(
            await fehler(
                updatePeak(cluster!.app, thomas, GIPFEL, {
                    operationId: randomUUID(),
                    baseRevision: stand,
                    changes: { height: 3100 },
                }),
            ),
        ).toMatchObject({ statusCode: 409, code: "object_locked" });
        const zweiteOperation = randomUUID();
        const quittung = await updatePeak(cluster!.app, vali, GIPFEL, {
            operationId: zweiteOperation,
            baseRevision: stand,
            changes: { height: 3100 },
        });
        expect(quittung.affected[0]).toMatchObject({ kind: "peak", revision: stand + 1 });
        // Der Vermerk `manual` steht seit der ersten Änderung: Das Protokoll trägt ihn nicht noch einmal.
        const [zweite] = await cluster!.admin<{ changes: Record<string, unknown> }[]>`
            SELECT changes FROM map_audit_event WHERE operation_id = ${zweiteOperation}::uuid AND peak_public_id = ${GIPFEL}::uuid
        `;
        expect(Object.keys(zweite?.changes ?? {})).toEqual(["height"]);
    });

    it("abgewiesen: Lage außerhalb der Karte, leerer Name, nichts zu ändern, ein Gipfel, den es nicht gibt", async () => {
        const stand = (await readEditorPeak(cluster!.app, GIPFEL))!;
        const fall = (changes: Parameters<typeof updatePeak>[3]["changes"], id = GIPFEL) =>
            fehler(
                updatePeak(cluster!.app, vali, id, {
                    operationId: randomUUID(),
                    baseRevision: stand.revision,
                    changes,
                }),
            );
        expect(await fall({ position: [-50, -50] })).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(await fall({ name: "   " })).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(await fall({ height: stand.height! })).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(await fall({ height: 1 }, randomUUID())).toMatchObject({ statusCode: 404, code: "not_found" });
        expect((await readEditorPeak(cluster!.app, GIPFEL))!.revision).toBe(stand.revision);
    });

    it("🔴 P3: die Liste führt Gipfel und Vulkane unter `peaks` (nicht unter `rows`), mit Höhe, Artikel wie im Infopanel und „verborgen“", async () => {
        const vulkan = "c8c8c8c8-0000-4000-8000-000000000002";
        await cluster!.admin`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, show_name, merkmale)
            VALUES (${vulkan}::uuid, 'aventuria', 'Probeschlund', 'vulkan', ST_SetSRID(ST_MakePoint(540.126, 520.5), 0), FALSE, '{nur_gelaende}')
        `;
        await cluster!.admin`
            INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, assignment_state)
            SELECT id, 'https://de.wiki-aventurica.de/wiki/Probeschlund', 'address_only' FROM terrain_peak WHERE public_id = ${vulkan}::uuid
        `;
        const liste = await listEditorLandscapes(cluster!.app);
        expect(liste.rows.some((row) => row.id === vulkan || row.id === GIPFEL)).toBe(false);
        const gipfel = liste.peaks?.find((row) => row.id === GIPFEL);
        // Die Höhe wie im Detail (die Fälle davor haben sie geändert).
        const detail = await readEditorPeak(cluster!.app, GIPFEL);
        expect(gipfel).toMatchObject({ subtype: "berggipfel", height: detail!.height, circle: "halb-rechts" });
        expect(gipfel?.wiki).toBeUndefined();
        expect(liste.peaks?.find((row) => row.id === vulkan)).toEqual({
            id: vulkan,
            name: "Probeschlund",
            subtype: "vulkan",
            circle: "voll",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Probeschlund" },
            merkmale: ["nur_gelaende"],
            hidden: true,
            position: [540.13, 520.5],
        });
    });

    it("🔴 „nur Gelände“ geht nur an Berggipfel und Vulkan; der Wechsel zu einer Art ohne Gelände nimmt es mit (WI-0271 §18)", async () => {
        const punkt = "c8c8c8c8-0000-4000-8000-000000000003";
        await cluster!.admin`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom)
            VALUES (${punkt}::uuid, 'aventuria', 'Probepunkt', 'berggipfel', ST_SetSRID(ST_MakePoint(541, 521), 0))
        `;
        const schreibe = async (changes: Parameters<typeof updatePeak>[3]["changes"]) =>
            updatePeak(cluster!.app, thomas, punkt, {
                operationId: randomUUID(),
                baseRevision: (await readEditorPeak(cluster!.app, punkt))!.revision,
                changes,
            });
        await schreibe({ merkmale: ["heilig", "nur_gelaende"] });
        expect((await readEditorPeak(cluster!.app, punkt))?.merkmale).toEqual(["heilig", "nur_gelaende"]);
        await schreibe({ subtype: "hoehle" });
        expect((await readEditorPeak(cluster!.app, punkt))?.merkmale).toEqual(["heilig"]);
        await expect(schreibe({ merkmale: ["nur_gelaende"] })).rejects.toMatchObject({ statusCode: 400 });
    });

    it("🔴 0310: Hilfspunkte bekommen „nur Gelände“ mit Operation und Protokoll und fehlen auf der Karte; Landmarken ohne Beschriftung stehen dort, Stillgelegtes bleibt unberührt", async () => {
        const hilfspunkt = "c8c8c8c8-0000-4000-8000-000000000004";
        const ohneText = "c8c8c8c8-0000-4000-8000-000000000005";
        const stillgelegt = "c8c8c8c8-0000-4000-8000-000000000006";
        await cluster!.admin`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, show_name, is_active)
            VALUES (${hilfspunkt}::uuid, 'aventuria', '1300er Probenadel', 'berggipfel', ST_SetSRID(ST_MakePoint(542, 522), 0), FALSE, TRUE),
                   (${ohneText}::uuid, 'aventuria', 'Probehöhle', 'hoehle', ST_SetSRID(ST_MakePoint(543, 523), 0), FALSE, TRUE),
                   (${stillgelegt}::uuid, 'aventuria', 'Altnadel', 'berggipfel', ST_SetSRID(ST_MakePoint(544, 524), 0), FALSE, FALSE)
        `;
        const operation = "c0271310-0271-4310-8000-000000000001";
        await cluster!.migrator.unsafe(
            readFileSync(new URL("../migrations/0310_landmarke_nur_gelaende.sql", import.meta.url), "utf8"),
        );
        const merkmale = await cluster!.admin<{ id: string; merkmale: string[] }[]>`
            SELECT public_id::text AS id, merkmale FROM terrain_peak
             WHERE public_id IN (${hilfspunkt}::uuid, ${ohneText}::uuid, ${stillgelegt}::uuid) ORDER BY public_id
        `;
        expect(merkmale.map((zeile) => zeile.merkmale)).toEqual([["nur_gelaende"], [], []]);
        const karte = await cluster!.admin`
            SELECT public_id::text AS id, show_name FROM terrain_peak_render
             WHERE public_id IN (${hilfspunkt}::uuid, ${ohneText}::uuid, ${stillgelegt}::uuid)
        `;
        expect(karte).toEqual([{ id: ohneText, show_name: false }]);
        const [op] = await cluster!.admin`
            SELECT action, source, actor_kind, actor_label FROM map_operation WHERE operation_id = ${operation}::uuid
        `;
        expect(op).toEqual({ action: "peak.update", source: "import", actor_kind: "agent", actor_label: "claudia" });
        const protokoll = await cluster!.admin`
            SELECT peak_public_id::text AS id, changes FROM map_audit_event WHERE operation_id = ${operation}::uuid AND peak_public_id = ${hilfspunkt}::uuid
        `;
        expect(protokoll).toEqual([{ id: hilfspunkt, changes: { merkmale: { before: [], after: ["nur_gelaende"] } } }]);
    });

    it("🔴 P7: „▲ Gipfel setzen …“ legt einen Berggipfel mit dem Griff „Gipfel-001“ an, EINE Operation; wiederholt dieselbe Quittung", async () => {
        const operationId = randomUUID();
        const erster = await createPeak(cluster!.app, thomas, { operationId, position: [535, 518] });
        expect(erster.name).toBe("Gipfel-001");
        expect(erster.affected).toEqual([{ kind: "peak", id: erster.publicId, revision: 1 }]);
        const gelesen = await readEditorPeak(cluster!.app, erster.publicId);
        expect(gelesen).toEqual({
            id: erster.publicId,
            name: "Gipfel-001",
            subtype: "berggipfel",
            showName: true,
            position: [535, 518],
            revision: 1,
        });
        const [herkunft] = await cluster!.admin<{ source_system: string }[]>`
            SELECT source_system FROM terrain_peak WHERE public_id = ${erster.publicId}::uuid
        `;
        expect(herkunft?.source_system).toBe("avesmaps3d");
        const [zeile] = await cluster!.admin<{ action: string; changes: Record<string, unknown> }[]>`
            SELECT action, changes FROM map_audit_event WHERE operation_id = ${operationId}::uuid
        `;
        expect(zeile?.action).toBe("peak.created");
        expect(Object.keys(zeile?.changes ?? {}).sort()).toEqual(["active", "name", "position", "subtype"]);

        // Dieselbe Kennung noch einmal: derselbe Gipfel, kein zweiter.
        const nochmal = await createPeak(cluster!.app, thomas, { operationId, position: [535, 518] });
        expect([nochmal.publicId, nochmal.name]).toEqual([erster.publicId, "Gipfel-001"]);
        const zweiter = await createPeak(cluster!.app, vali, { operationId: randomUUID(), position: [536, 519] });
        expect(zweiter.name).toBe("Gipfel-002");
        // Danach trägt er Name und Höhe über `peak.update`.
        await updatePeak(cluster!.app, vali, zweiter.publicId, {
            operationId: randomUUID(),
            baseRevision: 1,
            changes: { name: "Neue Zinne", height: 2100 },
        });
        expect(await readEditorPeak(cluster!.app, zweiter.publicId)).toMatchObject({
            name: "Neue Zinne",
            height: 2100,
        });
        expect(
            await fehler(createPeak(cluster!.app, vali, { operationId: randomUUID(), position: [-50, -50] })),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
    });

    it("🔴 503 nach Ableitung: eine Fremdschlüssel-Prüfung hält den Gipfel (FOR KEY SHARE), Speichern geht trotzdem durch", async () => {
        // `cluster.admin` hat nur eine Verbindung: den Stand vor der Sperre lesen.
        const stand = (await readEditorPeak(cluster!.app, GIPFEL))!.revision;
        await cluster!.admin.begin(async (sql) => {
            await sql`SELECT 1 FROM terrain_peak WHERE public_id = ${GIPFEL}::uuid FOR KEY SHARE`;
            const quittung = await updatePeak(cluster!.app, vali, GIPFEL, {
                operationId: randomUUID(),
                baseRevision: stand,
                changes: { height: 2950 },
            });
            expect(quittung.affected[0]).toMatchObject({ kind: "peak", revision: stand + 1 });
        });
    });
});
