import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LandscapeCopyBody } from "@avesmaps3d/shared";
import { copyLandscape } from "../src/editor/landscape-copy.ts";
import { createLandscape } from "../src/editor/landscape-create.ts";
import { readEditorLandscape } from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";

/**
 * „Kopieren …“ (Werkzeug 8, Betreiber 2026-10-19 „wie legacy B mit haken“). Im Wegwerf-Cluster wie auf dem VPS. 🔴 Kein Test schreibt in
 * `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Die Kopie ist eine Verknüpfung (dieselbe Zeile, dieselbe Kennung) oder bewegt sich mit der Quelle; die Art der Quelle
 * reist in eine fremde Ebene; der Wiki-Artikel reist unter einem anderen Namen mit; mit Haken bleibt die Quelle stehen, oder ihre
 * Landschaft bleibt leer zurück; ein halbes Umziehen; ↺ lässt die Kopie stehen oder holt die Quelle nicht zurück.
 */

const ENV = "landcopy";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const quadrat = (x0: number, y0: number, x1: number, y1: number): string =>
    `((${String(x0)} ${String(y0)}, ${String(x1)} ${String(y0)}, ${String(x1)} ${String(y1)}, ${String(x0)} ${String(y1)}, ${String(x0)} ${String(y0)}))`;

describeWithCluster(
    "„Kopieren …“: eine echte Kopie, mit Haken ein Umziehen (Werkzeug 8, Wegwerf-Cluster)",
    { timeout: 300_000 },
    () => {
        let cluster: VpsCluster | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
        const fehler = async (
            arbeit: Promise<unknown>,
        ): Promise<{ statusCode?: number; code?: string; message?: string }> => {
            try {
                await arbeit;
                return {};
            } catch (error) {
                return error as { statusCode?: number; code?: string };
            }
        };
        const lege = async (
            layer: "vegetation" | "topographie",
            type: string,
            name: string,
            ...stuecke: string[]
        ): Promise<{ id: string; flaeche: string }> => {
            const { publicId } = await createLandscape(cluster!.app, thomas, {
                operationId: randomUUID(),
                layer,
                ring: [
                    [100, 100],
                    [101, 100],
                    [101, 101],
                ],
            });
            await cluster!
                .admin`UPDATE region SET region_type = ${type}, name = ${name} WHERE public_id = ${publicId}::uuid`;
            const flaeche = (await readEditorLandscape(cluster!.app, publicId))!.areas[0]!.id;
            await cluster!.admin`
            UPDATE region_area SET geom = ST_SetSRID(ST_GeomFromText(${`MULTIPOLYGON(${stuecke.join(", ")})`}), 0)
             WHERE public_id = ${flaeche}::uuid
        `;
            return { id: publicId, flaeche };
        };
        const stand = async (flaeche: string) => {
            const [z] = await cluster!.admin<{ revision: number; aktiv: boolean; wkt: string; region: string }[]>`
            SELECT a.revision::int AS revision, a.is_active AS aktiv, ST_AsText(ST_Normalize(ST_Multi(a.geom))) AS wkt,
                   r.public_id::text AS region
              FROM region_area a JOIN region r ON r.id = a.region_id WHERE a.public_id = ${flaeche}::uuid
        `;
            return z!;
        };
        const landschaft = async (id: string) => {
            const [r] = await cluster!.admin<
                { aktiv: boolean; name: string; layer: string; type: string | null; wiki: string | null }[]
            >`
            SELECT is_active AS aktiv, name, region_layer AS layer, region_type AS type, wiki_url AS wiki
              FROM region WHERE public_id = ${id}::uuid
        `;
            return r!;
        };
        const kopiere = async (
            quelle: { id: string; flaeche: string },
            ziel: Omit<LandscapeCopyBody, "operationId" | "areaId" | "baseRevision">,
            operationId = randomUUID(),
        ) =>
            copyLandscape(cluster!.app, thomas, quelle.id, {
                operationId,
                areaId: quelle.flaeche,
                baseRevision: (await stand(quelle.flaeche)).revision,
                ...ziel,
            });

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        }, 300_000);

        afterAll(async () => {
            await cluster?.stop();
        }, 60_000);

        it("🔴 in die Topographie als neue Landschaft: eigene Kennung, dieselbe Form, Name und Art aus dem Blatt; die Quelle bleibt; ↺ nimmt beides weg", async () => {
            const wald = await lege("vegetation", "wald", "Farindel", quadrat(500, 500, 540, 520));
            await cluster!
                .admin`UPDATE region SET wiki_url = 'https://de.wiki-aventurica.de/wiki/Farindel' WHERE public_id = ${wald.id}::uuid`;
            const vorher = await stand(wald.flaeche);
            const operationId = randomUUID();
            const quittung = await kopiere(
                wald,
                { layer: "topographie", name: "Farindel", type: "huegelland", deleteSource: false },
                operationId,
            );
            expect(quittung.name).toBe("Farindel");
            expect(quittung.areaId).not.toBe(wald.flaeche);
            expect(quittung.publicId).not.toBe(wald.id);
            // Die Art kommt aus der Zielebene, der Wiki-Artikel reist unter demselben Namen mit.
            expect(await landschaft(quittung.publicId!)).toMatchObject({
                aktiv: true,
                name: "Farindel",
                layer: "topographie",
                type: "huegelland",
                wiki: "https://de.wiki-aventurica.de/wiki/Farindel",
            });
            const kopie = await stand(quittung.areaId!);
            expect(kopie.wkt).toBe(vorher.wkt);
            expect(kopie.region).toBe(quittung.publicId);
            expect(await stand(wald.flaeche)).toEqual(vorher);
            // 🔴 Eine Kopie, keine Verknüpfung: Eine Ecke der Kopie zieht nicht die Quelle.
            await cluster!.admin`
            UPDATE region_area SET geom = ST_SetSRID(ST_GeomFromText(${`MULTIPOLYGON(${quadrat(500, 500, 545, 520)})`}), 0)
             WHERE public_id = ${quittung.areaId!}::uuid
        `;
            expect((await stand(wald.flaeche)).wkt).toBe(vorher.wkt);
            await cluster!.admin`
            UPDATE region_area SET geom = ST_SetSRID(ST_GeomFromText(${`MULTIPOLYGON(${quadrat(500, 500, 540, 520)})`}), 0)
             WHERE public_id = ${quittung.areaId!}::uuid
        `;
            const protokoll = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
            expect(protokoll.map((z) => z.action)).toEqual(["region.created", "area.copied"]);

            // ↺ steht im Verlauf der Ziellandschaft; die Kopie wurde seither geändert: 409, nichts geht.
            expect(
                await fehler(
                    nimmFlaecheZurueck(cluster!.app, thomas, quittung.publicId!, {
                        operationId: randomUUID(),
                        reverts: operationId,
                    }),
                ),
            ).toMatchObject({ statusCode: 409 });
            const zweite = randomUUID();
            const noch = await kopiere(
                wald,
                { layer: "topographie", name: "Farindel-Hügel", type: "huegelland", deleteSource: false },
                zweite,
            );
            // Anderer Name, kein Wiki-Artikel.
            expect(await landschaft(noch.publicId!)).toMatchObject({ name: "Farindel-Hügel", wiki: null });
            await nimmFlaecheZurueck(cluster!.app, thomas, noch.publicId!, {
                operationId: randomUUID(),
                reverts: zweite,
            });
            expect(await stand(noch.areaId!)).toMatchObject({ aktiv: false });
            expect(await landschaft(noch.publicId!)).toMatchObject({ aktiv: false });
            expect(await stand(wald.flaeche)).toMatchObject({ aktiv: true, wkt: vorher.wkt });
        });

        it("🔴 mit Haken in eine bestehende Landschaft: EIN Umziehen; war die Quelle die letzte, geht ihre Landschaft mit; ↺ holt sie zurück", async () => {
            const wald = await lege("vegetation", "wald", "Reichsforst", quadrat(600, 500, 640, 520));
            const huegel = await lege("topographie", "huegelland", "Hügel am Forst", quadrat(700, 500, 720, 520));
            const operationId = randomUUID();
            const quittung = await kopiere(
                wald,
                { layer: "topographie", targetId: huegel.id, deleteSource: true },
                operationId,
            );
            expect(quittung).toMatchObject({ publicId: huegel.id, name: "Hügel am Forst" });
            expect(await stand(quittung.areaId!)).toMatchObject({ aktiv: true, region: huegel.id });
            expect(await stand(wald.flaeche)).toMatchObject({ aktiv: false });
            expect(await landschaft(wald.id)).toMatchObject({ aktiv: false });
            const detail = await readEditorLandscape(cluster!.app, huegel.id);
            expect(detail!.areas.map((a) => a.id).sort()).toEqual([huegel.flaeche, quittung.areaId!].sort());
            const protokoll = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
            expect(protokoll.map((z) => z.action)).toEqual(["area.copied", "area.retired", "region.retired"]);

            await nimmFlaecheZurueck(cluster!.app, thomas, huegel.id, {
                operationId: randomUUID(),
                reverts: operationId,
            });
            expect(await stand(quittung.areaId!)).toMatchObject({ aktiv: false });
            expect(await stand(wald.flaeche)).toMatchObject({ aktiv: true });
            expect(await landschaft(wald.id)).toMatchObject({ aktiv: true });
            expect(await stand(huegel.flaeche)).toMatchObject({ aktiv: true });
        });

        it("mit Haken, aber nicht die letzte Teilfläche: nur sie geht, ihre Landschaft bleibt", async () => {
            const wald = await lege("vegetation", "wald", "Zwei Wälder", quadrat(800, 500, 810, 510));
            const zweite = randomUUID();
            await cluster!.admin`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, geometry_revision, source_system, is_active)
            SELECT ${zweite}::uuid, region_id, map_domain_id,
                   ST_SetSRID(ST_GeomFromText(${`MULTIPOLYGON(${quadrat(820, 500, 830, 510)})`}), 0), 1, 'avesmaps3d', TRUE
              FROM region_area WHERE public_id = ${wald.flaeche}::uuid
        `;
            const quittung = await kopiere(wald, {
                layer: "derographisch",
                name: "Zwei Wälder",
                type: "region",
                deleteSource: true,
            });
            expect(await stand(wald.flaeche)).toMatchObject({ aktiv: false });
            expect(await landschaft(wald.id)).toMatchObject({ aktiv: true });
            expect(await landschaft(quittung.publicId!)).toMatchObject({ layer: "derographisch", type: "region" });
        });

        it("ohne Namen, mit einer Art aus einer anderen Ebene, mit einem Ziel in einer anderen Ebene: 400; ein alter Stand 409; nichts geschrieben", async () => {
            const wald = await lege("vegetation", "wald", "Prüfwald", quadrat(900, 500, 940, 520));
            const huegel = await lege("topographie", "huegelland", "Prüfhügel", quadrat(900, 600, 940, 620));
            const rev = (await stand(wald.flaeche)).revision;
            expect(await fehler(kopiere(wald, { layer: "topographie", deleteSource: false }))).toMatchObject({
                statusCode: 400,
                message: expect.stringContaining("Namen"),
            });
            expect(
                await fehler(
                    kopiere(wald, { layer: "topographie", name: "Prüfwald", type: "wald", deleteSource: false }),
                ),
            ).toMatchObject({ statusCode: 400 });
            expect(
                await fehler(kopiere(wald, { layer: "vegetation", targetId: huegel.id, deleteSource: false })),
            ).toMatchObject({ statusCode: 400 });
            expect(
                await fehler(
                    copyLandscape(cluster!.app, thomas, wald.id, {
                        operationId: randomUUID(),
                        areaId: wald.flaeche,
                        baseRevision: rev + 1,
                        layer: "topographie",
                        name: "Prüfwald",
                        deleteSource: true,
                    }),
                ),
            ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            expect(await stand(wald.flaeche)).toMatchObject({ aktiv: true, revision: rev });
            expect((await readEditorLandscape(cluster!.app, huegel.id))!.areas).toHaveLength(1);
        });
    },
);
