import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { releaseEditorLock, takeEditorLock } from "../src/editor/editor-lock.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { restorePlace } from "../src/editor/place-removal.ts";
import { deletePlaces, sammelPlaces } from "../src/editor/place-sammel.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Mehrfachauswahl der Ortsliste (WI-0237, EDIT-0003 T57): ↺ auf Wiki-Werte (`place.sammel`) und „Ganz löschen“ (`place.delete`) für
 * mehrere Orte, so wie auf dem VPS: Wegwerf-Cluster mit Migrations-, App- und Jobs-Rolle und den Vorlagen, geschrieben als App-Rolle.
 * 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Die Operation schreibt je Ort eine eigene statt EINER; ↺ fasst einen Ort an, der schon auf den Wiki-Werten steht, oder
 * scheitert an einem Ort ohne Wiki-Namen; ein Fehler an einem Ort lässt die anderen halb geändert; der Fehler nennt nicht, welcher Ort;
 * eine Kraftlinie am Ort sperrt einzeln, aber nicht in der Mehrfachauswahl; ein anderer bearbeitet einen der Orte gerade; ↺ unter
 * „Änderungen“ holt nach dem Löschen mehrerer nicht jeden Ort einzeln zurück; die Stätten gehen nicht mit oder nicht zurück.
 */

const ENV = "ortsammel";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const A = "c7c7c7c7-0000-4000-8000-000000000001";
const B = "c7c7c7c7-0000-4000-8000-000000000002";
const C = "c7c7c7c7-0000-4000-8000-000000000003";
const D = "c7c7c7c7-0000-4000-8000-000000000004";
const KRAFT = "c7c7c7c7-0000-4000-8000-000000000005";

describeWithCluster("Mehrfachauswahl der Ortsliste (WI-0237, Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

    const ort = async (publicId: string) => {
        const [z] = await cluster!.admin<
            { name: string; is_active: boolean; revision: number; oberhaupt: string | null; einwohner: string | null }[]
        >`
            SELECT p.name, p.is_active, p.revision::int AS revision, d.oberhaupt, d.einwohner
              FROM place p LEFT JOIN place_detail d ON d.place_id = p.id WHERE p.public_id = ${publicId}::uuid
        `;
        return z!;
    };
    const auswahl = async (...ids: string[]) =>
        Promise.all(ids.map(async (id) => ({ id, baseRevision: (await ort(id)).revision })));
    const fehler = async (
        arbeit: Promise<unknown>,
    ): Promise<{ statusCode?: number; code?: string; message?: string; details?: Record<string, unknown> }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string; message?: string };
        }
    };
    const audit = async (operationId: string) =>
        cluster!.admin<{ action: string; place: string; op: string }[]>`
            SELECT e.action, e.place_public_id::text AS place, o.action AS op
              FROM map_audit_event e JOIN map_operation o ON o.operation_id = e.operation_id
             WHERE e.operation_id = ${operationId}::uuid ORDER BY e.place_public_id
        `;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const sql = cluster.admin;
        await sql`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${A}, 'aventuria', 'Eigenname A', 'dorf', ST_SetSRID(ST_MakePoint(441, 442), 0), 'test', TRUE),
                   (${B}, 'aventuria', 'Burgau', 'dorf', ST_SetSRID(ST_MakePoint(451, 452), 0), 'test', TRUE),
                   (${C}, 'aventuria', 'Cellingen', 'dorf', ST_SetSRID(ST_MakePoint(461, 462), 0), 'test', TRUE),
                   (${D}, 'aventuria', 'Dornfeld', 'dorf', ST_SetSRID(ST_MakePoint(471, 472), 0), 'test', TRUE),
                   (${KRAFT}, 'aventuria', 'Kraftort', 'dorf', ST_SetSRID(ST_MakePoint(481, 482), 0), 'test', TRUE)
        `;
        // Wiki-Stand: A heißt im Wiki „Ahornwald“ und hat Oberhaupt „Graf Wiki“; B hat Einwohner „300“ laut Wiki; C steht schon auf
        // den Wiki-Werten; D hat keinen Wiki-Artikel (kein Wiki-Name).
        for (const [id, name, oberhaupt, einwohner] of [
            [A, "Ahornwald", "Graf Wiki", null],
            [B, "Burgau", null, "300"],
            [C, "Cellingen", null, null],
        ] as const) {
            const [schnappschuss] = await sql<{ id: string }[]>`
                INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, settlement_class,
                                                      settlement_class_guessed, oberhaupt, einwohner, synced_at)
                VALUES (${`w237-${id}`}, ${`https://de.wiki-aventurica.de/wiki/${name}`}, ${name}, ${name}, 'dorf', FALSE,
                        ${oberhaupt}, ${einwohner}, now())
                RETURNING id::text
            `;
            await sql`
                INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT id, ${`https://de.wiki-aventurica.de/wiki/${name}`}, ${schnappschuss!.id}, 'assigned', 'unknown'
                  FROM place WHERE public_id = ${id}::uuid
            `;
        }
        // Eigene Werte: A mit eigenem Oberhaupt, B mit eigenen Einwohnern.
        await sql`
            INSERT INTO place_detail (place_id, oberhaupt, oberhaupt_origin)
            SELECT id, 'Gräfin Eigen', 'manual' FROM place WHERE public_id = ${A}::uuid
        `;
        await sql`
            INSERT INTO place_detail (place_id, einwohner, einwohner_origin)
            SELECT id, '999', 'manual' FROM place WHERE public_id = ${B}::uuid
        `;
        // C steht ganz auf den Wiki-Werten: der Name samt Herkunft (WI-0225, Modell c: Wert UND Herkunft).
        await sql`INSERT INTO field_origin (object_kind, object_id, field, origin) VALUES ('place', ${C}::uuid, 'name', 'wiki')`;
        // An „Kraftort“ endet eine Kraftlinie.
        await sql`
            INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${randomUUID()}::uuid, 'aventuria', 'Probeader', ${KRAFT}::uuid, ${D}::uuid,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(481, 482), ST_MakePoint(471, 472)), 0),
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(481, 482), ST_MakePoint(471, 472)), 0), 'test')
        `;
    }, 240_000);

    afterAll(async () => {
        await cluster?.stop();
    });

    it("🔴 ↺ auf Wiki-Werte: EINE Operation, ein Eintrag je geändertem Ort; wer schon auf Wiki steht, bleibt unberührt", async () => {
        const operationId = randomUUID();
        const vorherC = (await ort(C)).revision;
        const quittung = await sammelPlaces(cluster!.app, thomas, {
            operationId,
            orte: await auswahl(A, B, C, D),
            wiki: ["name", "oberhaupt", "einwohner"],
        });
        expect((await ort(A)).name).toBe("Ahornwald");
        expect((await ort(A)).oberhaupt).toBe("Graf Wiki");
        expect((await ort(B)).einwohner).toBe("300");
        expect((await ort(C)).revision).toBe(vorherC);
        // D ohne Wiki-Artikel: Name bleibt (kein Wiki-Name), kein Fehler.
        expect((await ort(D)).name).toBe("Dornfeld");
        const eintraege = await audit(operationId);
        expect(eintraege.every((e) => e.op === "place.sammel" && e.action === "place.updated")).toBe(true);
        expect(eintraege.map((e) => e.place)).toEqual(expect.arrayContaining([A, B]));
        expect(eintraege.map((e) => e.place)).not.toContain(C);
        expect(quittung.affected.map((a) => a.id)).toEqual(expect.arrayContaining([A, B]));
        expect(quittung.warnings.map((w) => w.code)).toContain("sammel_teilweise");
        const [herkunft] = await cluster!.admin<{ origin: string }[]>`
            SELECT fo.origin FROM field_origin fo WHERE fo.object_kind = 'place' AND fo.object_id = ${A}::uuid AND fo.field = 'name'
        `;
        expect(herkunft?.origin).toBe("wiki");

        // Steht schon alles auf Wiki: abgewiesen statt einer leeren Operation.
        expect(
            await fehler(
                sammelPlaces(cluster!.app, thomas, {
                    operationId: randomUUID(),
                    orte: await auswahl(C),
                    wiki: ["name"],
                }),
            ),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
    });

    it("🔴 alles oder nichts: eine alte Revision, ein doppelter Ort oder ein fremd bearbeiteter Ort lassen ALLE unberührt", async () => {
        await cluster!.admin`UPDATE place_detail SET oberhaupt = 'Wieder eigen', oberhaupt_origin = 'manual'
                              WHERE place_id = (SELECT id FROM place WHERE public_id = ${A}::uuid)`;
        const veraltet = [...(await auswahl(A)), { id: B, baseRevision: (await ort(B)).revision - 1 }];
        expect(
            await fehler(
                sammelPlaces(cluster!.app, thomas, { operationId: randomUUID(), orte: veraltet, wiki: ["oberhaupt"] }),
            ),
        ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        expect((await ort(A)).oberhaupt).toBe("Wieder eigen");

        const doppelt = [...(await auswahl(A)), ...(await auswahl(A))];
        expect(
            await fehler(
                sammelPlaces(cluster!.app, thomas, { operationId: randomUUID(), orte: doppelt, wiki: ["oberhaupt"] }),
            ),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });

        const run = randomUUID();
        await takeEditorLock(cluster!.app, {
            kind: "place",
            id: B,
            part: "felder",
            run,
            personId: randomUUID(),
            personName: "Anna",
        });
        expect(
            await fehler(
                sammelPlaces(cluster!.app, thomas, {
                    operationId: randomUUID(),
                    orte: await auswahl(A, B),
                    wiki: ["oberhaupt"],
                }),
            ),
        ).toMatchObject({ statusCode: 409, code: "object_locked" });
        expect(
            await fehler(deletePlaces(cluster!.app, thomas, { operationId: randomUUID(), orte: await auswahl(A, B) })),
        ).toMatchObject({ statusCode: 409, code: "object_locked" });
        await releaseEditorLock(cluster!.app, run, { kind: "place", id: B });
        expect((await ort(A)).oberhaupt).toBe("Wieder eigen");
        expect((await ort(A)).is_active).toBe(true);
        expect((await ort(B)).is_active).toBe(true);
    });

    it("🔴 eine Kraftlinie an EINEM Ort sperrt das Löschen aller, und der Fehler nennt den Ort", async () => {
        const nein = await fehler(
            deletePlaces(cluster!.app, thomas, { operationId: randomUUID(), orte: await auswahl(C, KRAFT) }),
        );
        expect(nein).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(nein.message).toContain("Kraftort");
        expect(nein.details).toMatchObject({ field: "kraftlinien", publicId: KRAFT });
        expect((await ort(C)).is_active).toBe(true);
    });

    it("🔴 „Ganz löschen“ für mehrere: EINE Operation `place.delete`, ↺ unter „Änderungen“ holt jeden Ort einzeln zurück", async () => {
        const operationId = randomUUID();
        const quittung = await deletePlaces(cluster!.app, thomas, { operationId, orte: await auswahl(B, C) });
        expect((await ort(B)).is_active).toBe(false);
        expect((await ort(C)).is_active).toBe(false);
        expect(quittung.affected.map((a) => a.id).sort()).toEqual([B, C]);
        expect(quittung.derivedWork).toContainEqual({ kind: "routing", state: "pending" });
        const eintraege = await audit(operationId);
        expect(eintraege).toEqual([
            { action: "place.deleted", place: B, op: "place.delete" },
            { action: "place.deleted", place: C, op: "place.delete" },
        ]);
        // ↺ je Ort, wie die Seite „Änderungen“ es für jeden Ort der Operation ruft.
        await restorePlace(cluster!.app, thomas, B, { operationId: randomUUID(), reverts: operationId });
        expect((await ort(B)).is_active).toBe(true);
        expect((await ort(C)).is_active).toBe(false);
        await restorePlace(cluster!.app, thomas, C, { operationId: randomUUID(), reverts: operationId });
        expect((await ort(C)).is_active).toBe(true);

        // Schon gelöscht: nennt den Ort.
        const zweimal = randomUUID();
        await deletePlaces(cluster!.app, thomas, { operationId: zweimal, orte: await auswahl(C) });
        const nein = await fehler(
            deletePlaces(cluster!.app, thomas, { operationId: randomUUID(), orte: await auswahl(C) }),
        );
        expect(nein.statusCode === 400 || nein.statusCode === 404).toBe(true);
        await restorePlace(cluster!.app, thomas, C, { operationId: randomUUID(), reverts: zweimal });
    });
});
