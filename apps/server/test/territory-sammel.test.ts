import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { EditorTerritoryDetail, type TerritorySammelBody } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { readEditorTerritory, readTerritorySammelStand } from "../src/editor/territories.ts";
import { createParentTerritory } from "../src/editor/territory-create.ts";
import { restoreTerritory, retireTerritories } from "../src/editor/territory-retire.ts";
import { changeTerritoriesTogether } from "../src/editor/territory-sammel.ts";
import { updateTerritory } from "../src/editor/territory-update.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Fertig“ der Mehrfachauswahl an den Herrschaftsgebieten (EDIT-0003 T57; Operation `territory.sammel`), so wie auf dem VPS: Wegwerf-Cluster
 * mit Migrations-, App- und Jobs-Rolle, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte
 * Testdatenbank.
 *
 * Problemfälle: „Fertig“ schreibt je Gebiet eine eigene Operation; ein Gebiet, an dem sich nichts ändert, zählt seine Revision hoch; ein
 * Konflikt oder eine fremde Sperre an einem Gebiet lässt das andere geschrieben stehen; eine Spanne leert die Bänder der Flächen nicht oder
 * reiht keine Ableitung ein, eine reine Farbe oder Art reiht eine ein; ein Gebiet lässt sich unter ein gewähltes hängen.
 */

const ENV = "sammel";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `d2d2d2d2-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const GRAFSCHAFT = ID(2);
const NORD = ID(3);
const SUED = ID(4);
const NORD_FLAECHE = ID(0xa3);
const SUED_FLAECHE = ID(0xa4);

type Ring = [number, number][];
const geschlossen = (ring: Ring): Ring => [...ring, ring[0]!];

function gebiet(
    id: string,
    name: string,
    eltern: string | null,
    [min, max]: [number, number],
): Record<string, unknown> {
    return {
        public_id: id,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: eltern,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: min,
        max_zoom: max,
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-17 01:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}
function flaeche(id: string, territory: string, ring: Ring, [min, max]: [number, number]): Record<string, unknown> {
    return {
        public_id: id,
        territory_public_id: territory,
        geometry: { type: "Polygon", coordinates: [geschlossen(ring)] },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: min,
        max_zoom: max,
        updated_at: "2026-10-17 01:00:00",
    };
}
/**
 * Ein Reich (0 bis 1), seine Grafschaft (2 bis 3) und zwei Baronien (4 bis 5) mit je einer Fläche, die ihr eigenes Band 4 bis 5
 * trägt. Legacys Obergrenze 5 bleibt beim Import 5 (nur 6 wird 8): In Band 6 bis 8 zeigt die Karte hier nichts.
 */
function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-sammel",
        territories: [
            gebiet(REICH, "Reich", null, [0, 1]),
            gebiet(GRAFSCHAFT, "Grafschaft", REICH, [2, 3]),
            gebiet(NORD, "Baronie Nord", GRAFSCHAFT, [4, 5]),
            gebiet(SUED, "Baronie Süd", GRAFSCHAFT, [4, 5]),
        ],
        geometries: [
            flaeche(
                NORD_FLAECHE,
                NORD,
                [
                    [300, 300],
                    [420, 300],
                    [420, 330],
                    [300, 330],
                ],
                [4, 5],
            ),
            flaeche(
                SUED_FLAECHE,
                SUED,
                [
                    [300, 330],
                    [420, 330],
                    [420, 360],
                    [300, 360],
                ],
                [4, 5],
            ),
        ],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

interface Stand {
    revision: number;
    type: string | null;
    status: string | null;
    color: string;
    min: number | null;
    max: number | null;
    parent: string | null;
}

describeWithCluster(
    "„Fertig“ der Mehrfachauswahl: territory.sammel (EDIT-0003 T57, Wegwerf-Cluster)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        const gebietLesen = async (id: string): Promise<Stand> => {
            const [zeile] = await cluster!.admin<Stand[]>`
            SELECT t.revision::int AS revision, t.territory_type AS type, t.status_text AS status, t.color,
                   t.min_zoom AS min, t.max_zoom AS max, p.public_id::text AS parent
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id
             WHERE t.public_id = ${id}
        `;
            return zeile!;
        };
        const flaecheLesen = async (
            id: string,
        ): Promise<{ revision: number; min: number | null; max: number | null }> => {
            const [zeile] = await cluster!.admin<{ revision: number; min: number | null; max: number | null }[]>`
            SELECT revision::int AS revision, min_zoom AS min, max_zoom AS max FROM territory_area WHERE public_id = ${id}
        `;
            return zeile!;
        };
        /** Der Körper gegen die jetzigen Revisionen der Gebiete. */
        const koerper = async (
            ids: readonly string[],
            rest: Omit<TerritorySammelBody, "operationId" | "territories">,
        ): Promise<TerritorySammelBody> => ({
            operationId: randomUUID(),
            territories: await Promise.all(
                ids.map(async (id) => ({ id, baseRevision: (await gebietLesen(id)).revision })),
            ),
            ...rest,
        });
        const sammeln = async (
            ids: readonly string[],
            rest: Omit<TerritorySammelBody, "operationId" | "territories">,
        ): ReturnType<typeof changeTerritoriesTogether> =>
            changeTerritoriesTogether(cluster!.app, thomas, await koerper(ids, rest));
        const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
            try {
                await arbeit;
                return {};
            } catch (error) {
                return error as { statusCode?: number; code?: string };
            }
        };
        const operationen = async (): Promise<number> =>
            Number((await cluster!.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)[0]!.n);

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const o = cluster.migrator.options as unknown as {
                host: string[];
                port: number[];
                user: string;
                database: string;
            };
            importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 3,
            });
            await importTerritories(importer, quelle());
            await deriveTerritories(cluster.jobs, { force: true });
            // Der Wiki-Stand: nur Nord hat einen Schnappschuss (Herrscher bekannt), Süd keinen.
            await cluster.admin`INSERT INTO wiki_territory_snapshot (wiki_key, ruler) VALUES ('wiki:Baronie Nord', 'Baron Wiki')`;
        }, 240_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        it("🔴 Art, Status und Farbe für zwei Baronien: EINE Operation, je Gebiet im Verlauf, keine Ableitung", async () => {
            const nord = await gebietLesen(NORD);
            const sued = await gebietLesen(SUED);
            const vorher = await operationen();
            await cluster!.admin`DELETE FROM map_audit_event`;
            const quittung = await sammeln([NORD, SUED], {
                changes: { type: "Junkertum", status: "Lehen" },
                color: "#5dac60",
            });
            expect(await operationen()).toBe(vorher + 1);
            // Felder und Farbe: zwei Schreibwege, je einmal gezählt.
            const nachher = { type: "Junkertum", status: "Lehen", color: "#5dac60" };
            expect(await gebietLesen(NORD)).toEqual({ ...nord, ...nachher, revision: nord.revision + 2 });
            expect(await gebietLesen(SUED)).toEqual({ ...sued, ...nachher, revision: sued.revision + 2 });
            // Art und Farbe gehen in kein abgeleitetes Ergebnis ein: nur eine neue Kachelrevision.
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["tiles"]);
            expect(quittung.affected).toEqual([
                { kind: "territory", id: NORD, revision: nord.revision + 2 },
                { kind: "territory", id: SUED, revision: sued.revision + 2 },
            ]);
            const protokoll = await cluster!.admin<{ action: string; gebiet: string; changes: unknown }[]>`
            SELECT action, territory_public_id::text AS gebiet, changes FROM map_audit_event ORDER BY id
        `;
            const felder = (vorStatus: string | null) => ({
                type: { before: "Baronie", after: "Junkertum" },
                status: { before: vorStatus, after: "Lehen" },
            });
            const farbe = { color: { before: "#b2b065", after: "#5dac60" } };
            expect(protokoll).toEqual([
                { action: "territory.updated", gebiet: NORD, changes: felder(nord.status) },
                { action: "territory.display_changed", gebiet: NORD, changes: farbe },
                { action: "territory.updated", gebiet: SUED, changes: felder(sued.status) },
                { action: "territory.display_changed", gebiet: SUED, changes: farbe },
            ]);
        });

        it("🔴 ↺ im Verlauf: territory.sammel mit reverts nimmt Felder und Farbe EINES Gebiets zurück, Quelle restore", async () => {
            const vorher = await gebietLesen(SUED);
            const quittung = await sammeln([SUED], { changes: { type: "Mark" }, color: "#123456" });
            const nachher = await gebietLesen(SUED);
            const zurueck = await changeTerritoriesTogether(cluster!.app, thomas, {
                operationId: randomUUID(),
                reverts: quittung.operationId,
                territories: [{ id: SUED, baseRevision: nachher.revision }],
                changes: { type: vorher.type ?? "" },
                color: vorher.color,
            });
            expect(await gebietLesen(SUED)).toMatchObject({ type: vorher.type, color: vorher.color });
            const [op] = await cluster!.admin<{ source: string }[]>`
                SELECT source FROM map_operation WHERE operation_id = ${zurueck.operationId}::uuid
            `;
            expect(op).toEqual({ source: "restore" });
        });

        it("🔴 ein Gebiet, an dem sich nichts ändert, behält seine Revision; nichts zu ändern ist 400", async () => {
            await sammeln([NORD], { changes: { type: "Baronie" } });
            const nord = await gebietLesen(NORD);
            const sued = await gebietLesen(SUED);
            await sammeln([NORD, SUED], { changes: { type: "Baronie" } });
            expect(await gebietLesen(NORD)).toEqual(nord);
            expect(await gebietLesen(SUED)).toEqual({ ...sued, revision: sued.revision + 1, type: "Baronie" });
            expect(await fehler(sammeln([NORD, SUED], { changes: { type: "Baronie" } }))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
            });
            expect(await fehler(sammeln([NORD], {}))).toMatchObject({ statusCode: 400, code: "validation_failed" });
            expect(await fehler(sammeln([NORD, NORD], { color: "#000000" }))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
            });
        });

        it("🔴 Spanne 4 bis 8 für beide: die Flächen verlieren ihr eigenes Band, Band 7 zeigt beide, mit Ableitung", async () => {
            const nordFlaeche = await flaecheLesen(NORD_FLAECHE);
            const quittung = await sammeln([NORD, SUED], { zoom: { minZoom: 4, maxZoom: 8 } });
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
            expect(await gebietLesen(NORD)).toMatchObject({ min: 4, max: 8 });
            expect(await gebietLesen(SUED)).toMatchObject({ min: 4, max: 8 });
            expect(await flaecheLesen(NORD_FLAECHE)).toEqual({
                revision: nordFlaeche.revision + 1,
                min: null,
                max: null,
            });
            expect(await flaecheLesen(SUED_FLAECHE)).toMatchObject({ min: null, max: null });
            await deriveTerritories(cluster!.jobs);
            const band7 = await cluster!.admin<{ gebiet: string }[]>`
            SELECT t.public_id::text AS gebiet
              FROM territory_display_area da JOIN territory t ON t.id = da.territory_id
             WHERE da.band = 7 ORDER BY 1
        `;
            expect(band7.map((r) => r.gebiet)).toEqual([NORD, SUED].sort());
        });

        it("🔴 Umhängen beider unter das Reich mit Ableitung; unter ein gewähltes oder ein eigenes Untergebiet ist 400", async () => {
            const quittung = await sammeln([NORD, SUED], { changes: { parent: REICH } });
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
            expect(await gebietLesen(NORD)).toMatchObject({ parent: REICH });
            expect(await gebietLesen(SUED)).toMatchObject({ parent: REICH });
            expect(await fehler(sammeln([NORD, SUED], { changes: { parent: NORD } }))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
            });
            // Das Reich unter seine eigene Grafschaft, zusammen mit Nord.
            const reich = await gebietLesen(REICH);
            expect(await fehler(sammeln([REICH, NORD], { changes: { parent: GRAFSCHAFT } }))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
            });
            expect(await gebietLesen(REICH)).toEqual(reich);
            await sammeln([NORD, SUED], { changes: { parent: GRAFSCHAFT } });
            expect(await gebietLesen(NORD)).toMatchObject({ parent: GRAFSCHAFT });
        });

        it("🔴 ein Konflikt an einem Gebiet nimmt alles zurück: das andere bleibt, wie es war", async () => {
            const nord = await gebietLesen(NORD);
            const sued = await gebietLesen(SUED);
            expect(
                await fehler(
                    changeTerritoriesTogether(cluster!.app, thomas, {
                        operationId: randomUUID(),
                        territories: [
                            { id: NORD, baseRevision: nord.revision },
                            { id: SUED, baseRevision: sued.revision - 1 },
                        ],
                        changes: { status: "Allod" },
                        color: "#123456",
                    }),
                ),
            ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            expect(await gebietLesen(NORD)).toEqual(nord);
            expect(await gebietLesen(SUED)).toEqual(sued);
        });

        it("🔴 der Stand: Revision, Status und Wiki-Felder je Gebiet, in der Folge der Anfrage, Unbekannte fehlen", async () => {
            await updateTerritory(cluster!.app, thomas, NORD, {
                operationId: randomUUID(),
                baseRevision: (await gebietLesen(NORD)).revision,
                changes: { status: "Lehen", details: { ruler: { value: "Baron Eigen" } } },
            });
            const nord = await gebietLesen(NORD);
            const stand = await readTerritorySammelStand(cluster!.app, [SUED, NORD, ID(0xff)]);
            expect(stand.territories.map((g) => g.id)).toEqual([SUED, NORD]);
            expect(stand.territories[1]).toEqual({
                id: NORD,
                revision: nord.revision,
                status: "Lehen",
                details: { ruler: { value: "Baron Eigen", origin: "override", wiki: "Baron Wiki" } },
            });
            expect(stand.territories[0]!.details).toEqual({});
        });

        it("🔴 ↺ auf Wiki-Werte für alle: nur wo ein eigener Wert steht; ein Gebiet ohne Schnappschuss kippt nichts", async () => {
            const nord = await gebietLesen(NORD);
            const sued = await gebietLesen(SUED);
            await sammeln([NORD, SUED], { wiki: ["ruler"] });
            expect(await gebietLesen(NORD)).toMatchObject({ revision: nord.revision + 1 });
            expect(await gebietLesen(SUED)).toEqual(sued);
            const [nachher] = (await readTerritorySammelStand(cluster!.app, [NORD])).territories;
            expect(nachher!.details).toEqual({ ruler: { value: "Baron Wiki", origin: "wiki", wiki: "Baron Wiki" } });
            // Jetzt folgen beide dem Wiki: nichts zu ändern.
            expect(await fehler(sammeln([NORD, SUED], { wiki: ["ruler"] }))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
            });
        });

        it("🔴 eine fremde Sperre an einem der Gebiete: 409 object_locked, keines geschrieben", async () => {
            const anna = { personId: randomUUID(), personName: "Anna" };
            await takeEditorLock(cluster!.app, {
                kind: "territory",
                id: SUED,
                part: "form",
                run: randomUUID(),
                ...anna,
            });
            const nord = await gebietLesen(NORD);
            const sued = await gebietLesen(SUED);
            expect(await fehler(sammeln([NORD, SUED], { changes: { status: "Allod" } }))).toMatchObject({
                statusCode: 409,
                code: "object_locked",
            });
            expect(await gebietLesen(NORD)).toEqual(nord);
            expect(await gebietLesen(SUED)).toEqual(sued);
            await cluster!.admin`DELETE FROM editor_lock`;
        });

        const entfernen = async (ids: readonly string[], stage: "off_map" | "retire"): Promise<string> => {
            const operationId = randomUUID();
            await retireTerritories(cluster!.app, thomas, {
                operationId,
                territories: await Promise.all(
                    ids.map(async (id) => ({ id, baseRevision: (await gebietLesen(id)).revision })),
                ),
                stage,
            });
            return operationId;
        };
        const aktiv = async (id: string): Promise<boolean> =>
            (await cluster!.admin<{ a: boolean }[]>`SELECT is_active AS a FROM territory WHERE public_id = ${id}`)[0]!
                .a;

        it("🔴 Entfernen für alle, von der Karte: nur wer eine eigene Fläche hat; keiner mit Fläche ist 400; ↺ holt sie zurück", async () => {
            expect(await fehler(entfernen([REICH, GRAFSCHAFT], "off_map"))).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
            });
            const op = await entfernen([REICH, NORD], "off_map");
            const flaechen = await cluster!.admin<{ public_id: string; is_active: boolean }[]>`
                SELECT public_id::text AS public_id, is_active FROM territory_area ORDER BY public_id
            `;
            expect(flaechen).toEqual([
                { public_id: NORD_FLAECHE, is_active: false },
                { public_id: SUED_FLAECHE, is_active: true },
            ]);
            await restoreTerritory(cluster!.app, thomas, NORD, { operationId: randomUUID(), reverts: op });
            expect((await flaecheLesen(NORD_FLAECHE)).revision).toBeGreaterThan(0);
            expect(
                (
                    await cluster!.admin<
                        { a: boolean }[]
                    >`SELECT is_active AS a FROM territory_area WHERE public_id = ${NORD_FLAECHE}`
                )[0]!.a,
            ).toBe(true);
        });

        it("🔴 Entfernen für alle, ganz: Obergebiet vor Untergebiet, nicht gewählte rücken eine Ebene hoch; ↺ stellt den Baum wieder her", async () => {
            // In verkehrter Folge geschickt: Der Server löscht die Grafschaft zuerst, sonst hinge Süd zweimal um.
            const op = await entfernen([NORD, GRAFSCHAFT], "retire");
            expect(await aktiv(GRAFSCHAFT)).toBe(false);
            expect(await aktiv(NORD)).toBe(false);
            expect(await gebietLesen(SUED)).toMatchObject({ parent: REICH });
            const zeilen = await cluster!.admin<{ action: string; gebiet: string }[]>`
                SELECT action, territory_public_id::text AS gebiet FROM map_audit_event WHERE operation_id = ${op}::uuid ORDER BY id
            `;
            expect(zeilen.filter((z) => z.gebiet === SUED)).toEqual([{ action: "territory.updated", gebiet: SUED }]);
            await restoreTerritory(cluster!.app, thomas, NORD, { operationId: randomUUID(), reverts: op });
            expect(await aktiv(GRAFSCHAFT)).toBe(true);
            expect(await gebietLesen(NORD)).toMatchObject({ parent: GRAFSCHAFT });
            expect(await gebietLesen(SUED)).toMatchObject({ parent: GRAFSCHAFT });
        });

        it("🔴 Unter neues Obergebiet: ein Gebiet ohne Fläche, beide darunter, EINE Operation; ↺ hängt zurück und setzt es still", async () => {
            const quittung = await createParentTerritory(cluster!.app, thomas, {
                operationId: randomUUID(),
                territories: await Promise.all(
                    [NORD, SUED].map(async (id) => ({ id, baseRevision: (await gebietLesen(id)).revision })),
                ),
                parent: GRAFSCHAFT,
                color: "#a0b0c0",
                zoom: { minZoom: 2, maxZoom: 3 },
            });
            expect(quittung.name).toBe("Neues Herrschaftsgebiet");
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["territory_derive", "tiles"]);
            const neu = await gebietLesen(quittung.publicId);
            expect(neu).toMatchObject({ parent: GRAFSCHAFT, color: "#a0b0c0", min: 2, max: 3 });
            expect(await gebietLesen(NORD)).toMatchObject({ parent: quittung.publicId });
            expect(await gebietLesen(SUED)).toMatchObject({ parent: quittung.publicId });
            const [flaechen] = await cluster!.admin<{ n: number }[]>`
                SELECT count(*)::int AS n FROM territory_area a JOIN territory t ON t.id = a.territory_id WHERE t.public_id = ${quittung.publicId}::uuid
            `;
            expect(flaechen).toEqual({ n: 0 });
            // Direkt danach liest der Editor das neue Gebiet wie jedes andere (Befund an Fassung 5: dort fehlte ihm ein Feld, und die
            // Eigenschaften brachen ab): alle Felder des Details, die Untergebiete, keine Fläche, keine Detailfelder.
            const detail = await readEditorTerritory(cluster!.app, quittung.publicId);
            expect(detail).toMatchObject({
                id: quittung.publicId,
                revision: neu.revision,
                name: "Neues Herrschaftsgebiet",
                color: "#a0b0c0",
                minZoom: 2,
                maxZoom: 3,
                parents: [
                    { id: GRAFSCHAFT, name: "Grafschaft" },
                    { id: REICH, name: "Reich" },
                ],
                areas: [],
                details: {},
                claimedBy: [],
                claims: [],
            });
            expect(detail!.children.map((k) => k.id).sort()).toEqual([NORD, SUED].sort());
            expect(Value.Check(EditorTerritoryDetail, detail)).toBe(true);

            await restoreTerritory(cluster!.app, thomas, SUED, {
                operationId: randomUUID(),
                reverts: quittung.operationId,
            });
            expect(await gebietLesen(NORD)).toMatchObject({ parent: GRAFSCHAFT });
            expect(await gebietLesen(SUED)).toMatchObject({ parent: GRAFSCHAFT });
            expect(await aktiv(quittung.publicId)).toBe(false);
        });

        it("🔴 Unter neues Obergebiet: eigener Name; nie unter einem gewählten oder seinem Untergebiet (400)", async () => {
            const revisionen = async (ids: readonly string[]) =>
                Promise.all(ids.map(async (id) => ({ id, baseRevision: (await gebietLesen(id)).revision })));
            expect(
                await fehler(
                    createParentTerritory(cluster!.app, thomas, {
                        operationId: randomUUID(),
                        territories: await revisionen([NORD, SUED]),
                        parent: NORD,
                        color: "#a0b0c0",
                        zoom: { minZoom: 2, maxZoom: 3 },
                    }),
                ),
            ).toMatchObject({ statusCode: 400, code: "validation_failed" });
            expect(
                await fehler(
                    createParentTerritory(cluster!.app, thomas, {
                        operationId: randomUUID(),
                        territories: await revisionen([GRAFSCHAFT]),
                        parent: NORD,
                        color: "#a0b0c0",
                        zoom: { minZoom: 2, maxZoom: 3 },
                    }),
                ),
            ).toMatchObject({ statusCode: 400, code: "validation_failed" });
            const quittung = await createParentTerritory(cluster!.app, thomas, {
                operationId: randomUUID(),
                territories: await revisionen([GRAFSCHAFT]),
                name: "  Mark Nord  ",
                color: "#a0b0c0",
                zoom: { minZoom: 0, maxZoom: 1 },
            });
            expect(quittung.name).toBe("Mark Nord");
            expect(await gebietLesen(quittung.publicId)).toMatchObject({ parent: null });
            expect(await gebietLesen(GRAFSCHAFT)).toMatchObject({ parent: quittung.publicId });
            await restoreTerritory(cluster!.app, thomas, GRAFSCHAFT, {
                operationId: randomUUID(),
                reverts: quittung.operationId,
            });
            expect(await gebietLesen(GRAFSCHAFT)).toMatchObject({ parent: REICH });
        });

        it("🔴 Entfernen für alle: ein Konflikt an einem nimmt alles zurück", async () => {
            const nord = await gebietLesen(NORD);
            const sued = await gebietLesen(SUED);
            expect(
                await fehler(
                    retireTerritories(cluster!.app, thomas, {
                        operationId: randomUUID(),
                        territories: [
                            { id: NORD, baseRevision: nord.revision },
                            { id: SUED, baseRevision: sued.revision - 1 },
                        ],
                        stage: "retire",
                    }),
                ),
            ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            expect(await aktiv(NORD)).toBe(true);
            expect(await gebietLesen(NORD)).toEqual(nord);
        });
    },
);
