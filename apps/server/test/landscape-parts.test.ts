import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLandscape } from "../src/editor/landscape-create.ts";
import { partsLandscape } from "../src/editor/landscape-parts.ts";
import { readEditorLandscape } from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";

/**
 * „Unterflächen ›“ (Werkzeug 3, Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1; Legacy `geometry-ops.js#L580-L760`). Im
 * Wegwerf-Cluster wie auf dem VPS, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Vereinigen schließt eine Lücke zwischen getrennten Stücken oder verliert eines; der falsche Teil wird herausgelöst oder
 * gelöscht (Folge der Teile anders als im Detail); die herausgelöste Landschaft trägt Namen oder Art der Quelle nicht wie „Neue Fläche“;
 * eine Fläche aus einem Stück verliert ihr letztes; ↺ lässt die neue Landschaft stehen oder überschreibt eine spätere Änderung.
 */

const ENV = "landparts";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

/** Ein Quadrat als WKT-Ring. */
const quadrat = (x0: number, y0: number, x1: number, y1: number): string =>
    `((${String(x0)} ${String(y0)}, ${String(x1)} ${String(y0)}, ${String(x1)} ${String(y1)}, ${String(x0)} ${String(y1)}, ${String(x0)} ${String(y0)}))`;

describeWithCluster(
    "„Unterflächen“: vereinigen, herauslösen, löschen (Werkzeug 3, Wegwerf-Cluster)",
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
        /** Eine neue Landschaft der Art „wald“, deren Teilfläche aus diesen Stücken besteht (in dieser Folge). */
        const lege = async (...stuecke: string[]): Promise<{ id: string; flaeche: string }> => {
            const { publicId } = await createLandscape(cluster!.app, thomas, {
                operationId: randomUUID(),
                layer: "vegetation",
                ring: [
                    [100, 100],
                    [101, 100],
                    [101, 101],
                ],
            });
            await cluster!
                .admin`UPDATE region SET region_type = 'wald', name = 'Probewald' WHERE public_id = ${publicId}::uuid`;
            const detail = await readEditorLandscape(cluster!.app, publicId);
            const flaeche = detail!.areas[0]!.id;
            await cluster!.admin`
            UPDATE region_area SET geom = ST_SetSRID(ST_GeomFromText(${`MULTIPOLYGON(${stuecke.join(", ")})`}), 0)
             WHERE public_id = ${flaeche}::uuid
        `;
            return { id: publicId, flaeche };
        };
        const stand = async (flaeche: string) => {
            const [z] = await cluster!.admin<{ revision: number; aktiv: boolean; teile: number; f: number }[]>`
            SELECT revision::int AS revision, is_active AS aktiv, ST_NumGeometries(geom)::int AS teile, ST_Area(geom) AS f
              FROM region_area WHERE public_id = ${flaeche}::uuid
        `;
            return z!;
        };

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        }, 300_000);

        afterAll(async () => {
            await cluster?.stop();
        }, 60_000);

        it("🔴 vereinigen verschmilzt, was sich berührt, und lässt getrennte Stücke getrennt; ohne Berührung oder aus einem Stück 400", async () => {
            const wald = await lege(
                quadrat(500, 500, 510, 510),
                quadrat(510, 500, 520, 510),
                quadrat(540, 500, 550, 510),
            );
            const quittung = await partsLandscape(cluster!.app, thomas, wald.id, {
                operationId: randomUUID(),
                operation: "vereinigen",
                areaId: wald.flaeche,
                baseRevision: (await stand(wald.flaeche)).revision,
            });
            expect([quittung.partsBefore, quittung.partsAfter]).toEqual([3, 2]);
            expect(await stand(wald.flaeche)).toMatchObject({ teile: 2 });
            expect((await stand(wald.flaeche)).f).toBeCloseTo(300, 6);

            const getrennt = await lege(quadrat(500, 600, 510, 610), quadrat(530, 600, 540, 610));
            expect(
                await fehler(
                    partsLandscape(cluster!.app, thomas, getrennt.id, {
                        operationId: randomUUID(),
                        operation: "vereinigen",
                        areaId: getrennt.flaeche,
                        baseRevision: (await stand(getrennt.flaeche)).revision,
                    }),
                ),
            ).toMatchObject({ statusCode: 400, message: expect.stringContaining("berühren einander nicht") });
            const eins = await lege(quadrat(500, 700, 510, 710));
            for (const operation of ["vereinigen", "loeschen"] as const)
                expect(
                    await fehler(
                        partsLandscape(cluster!.app, thomas, eins.id, {
                            operationId: randomUUID(),
                            operation,
                            areaId: eins.flaeche,
                            baseRevision: (await stand(eins.flaeche)).revision,
                            part: 0,
                        }),
                    ),
                ).toMatchObject({ statusCode: 400, message: expect.stringContaining("nur aus einer Unterfläche") });
        });

        it("🔴 herauslösen: der gewählte Teil wird eine eigene Landschaft mit Name, Ebene und Art der Quelle; ↺ nimmt die neue wieder weg", async () => {
            const wald = await lege(
                quadrat(600, 500, 610, 510),
                quadrat(620, 500, 640, 520),
                quadrat(660, 500, 665, 505),
            );
            const operationId = randomUUID();
            const quittung = await partsLandscape(cluster!.app, thomas, wald.id, {
                operationId,
                operation: "herausloesen",
                areaId: wald.flaeche,
                baseRevision: (await stand(wald.flaeche)).revision,
                part: 1,
            });
            // Kein Platzhalter: Das Stück trägt Name und Art der Quelle (Editor-Orchestrierung 2026-10-19).
            expect(quittung.name).toBe("Probewald");
            // Der mittlere Teil (20 × 20) ging, die beiden anderen blieben.
            expect(await stand(wald.flaeche)).toMatchObject({ teile: 2 });
            expect((await stand(wald.flaeche)).f).toBeCloseTo(100 + 25, 6);
            const neu = await readEditorLandscape(cluster!.app, quittung.publicId!);
            expect(neu).toMatchObject({ name: quittung.name, layer: "vegetation", type: "wald" });
            expect(neu!.areas).toHaveLength(1);
            const protokoll = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
            expect(protokoll.map((z) => z.action)).toEqual(["area.parts", "region.created", "area.created"]);

            await nimmFlaecheZurueck(cluster!.app, thomas, wald.id, {
                operationId: randomUUID(),
                reverts: operationId,
            });
            expect(await stand(wald.flaeche)).toMatchObject({ teile: 3 });
            expect(await stand(neu!.areas[0]!.id)).toMatchObject({ aktiv: false });
            const [r] = await cluster!.admin<{ aktiv: boolean }[]>`
            SELECT is_active AS aktiv FROM region WHERE public_id = ${quittung.publicId!}::uuid
        `;
            expect(r?.aktiv).toBe(false);
        });

        it("🔴 löschen nimmt genau den gewählten Teil; ↺ holt ihn zurück, ein zweites ↺ ist 409", async () => {
            const wald = await lege(quadrat(700, 500, 710, 510), quadrat(720, 500, 721, 501));
            const operationId = randomUUID();
            await partsLandscape(cluster!.app, thomas, wald.id, {
                operationId,
                operation: "loeschen",
                areaId: wald.flaeche,
                baseRevision: (await stand(wald.flaeche)).revision,
                part: 1,
            });
            expect(await stand(wald.flaeche)).toMatchObject({ teile: 1 });
            expect((await stand(wald.flaeche)).f).toBeCloseTo(100, 6);
            await nimmFlaecheZurueck(cluster!.app, thomas, wald.id, {
                operationId: randomUUID(),
                reverts: operationId,
            });
            expect(await stand(wald.flaeche)).toMatchObject({ teile: 2 });
            expect(
                await fehler(
                    nimmFlaecheZurueck(cluster!.app, thomas, wald.id, {
                        operationId: randomUUID(),
                        reverts: operationId,
                    }),
                ),
            ).toMatchObject({ statusCode: 409, code: "already_reverted" });
        });

        it("abgewiesen: ein Teil, den es nicht gibt, ohne Teil, ein alter Stand (409), eine fremde Landschaft (404)", async () => {
            const wald = await lege(quadrat(800, 500, 810, 510), quadrat(820, 500, 830, 510));
            const anders = await lege(quadrat(800, 600, 810, 610), quadrat(820, 600, 830, 610));
            const rev = (await stand(wald.flaeche)).revision;
            const fall = (part: number | undefined, baseRevision = rev, landschaft = wald.id) =>
                fehler(
                    partsLandscape(cluster!.app, thomas, landschaft, {
                        operationId: randomUUID(),
                        operation: "loeschen",
                        areaId: wald.flaeche,
                        baseRevision,
                        ...(part === undefined ? {} : { part }),
                    }),
                );
            expect(await fall(2)).toMatchObject({ statusCode: 400 });
            expect(await fall(undefined)).toMatchObject({ statusCode: 400 });
            expect(await fall(0, rev + 1)).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            expect(await fall(0, rev, anders.id)).toMatchObject({ statusCode: 404 });
            expect(await stand(wald.flaeche)).toMatchObject({ teile: 2, revision: rev });
        });
    },
);
