import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GEFAHREN_ARTEN } from "@avesmaps3d/shared";
import { createLandscape } from "../src/editor/landscape-create.ts";
import { listEditorLandscapes, readEditorLandscape } from "../src/editor/landscapes.ts";
import { updateLandscape } from "../src/editor/landscape-update.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { areaDetail } from "../src/subjects/detail-area.ts";
import { buildSubjectIndex } from "../src/subjects/subject-index.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Gefahrenlage einer Landschaft (WI-0308 Paket 1): Migration 0341, Schreibweg `landscape.update` mit Protokoll und ↺. Im Wegwerf-Cluster
 * wie auf dem VPS. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank, und kein Wert landet an einer echten Fläche.
 *
 * Problemfälle: Eine neue Fläche ist nicht ungefährlich; die Arten stehen in der Folge der Eingabe statt des Katalogs; die Revision zählt
 * nicht und ein zweiter Editor überschreibt still; ↺ lässt die Gefahrenlage stehen; eine unbekannte Art kommt in die Datenbank; eine
 * Fläche, die das Merkmal verliert (Klima), verliert auch den Wert (Vali, Antwort 10: er ruht).
 */

const ENV = "gefahren";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

describe("Katalog und Migration sagen dasselbe (WI-0308)", () => {
    it("🔴 der CHECK der Migration nennt genau die zwölf Arten des Katalogs, in derselben Folge", () => {
        const text = readFileSync(
            fileURLToPath(new URL("../migrations/0341_region_gefahrenlage.sql", import.meta.url)),
            "utf8",
        );
        const liste = /hazards <@ ARRAY\[([\s\S]*?)\]::text\[\]/u.exec(text)?.[1] ?? "";
        const arten = [...liste.matchAll(/'([a-z_]+)'/gu)].map((treffer) => treffer[1]);
        expect(arten).toEqual([...GEFAHREN_ARTEN]);
        expect(GEFAHREN_ARTEN).toHaveLength(12);
    });
});

describeWithCluster("Gefahrenlage einer Landschaft (WI-0308, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
    let x = 100;
    const lege = async (name: string): Promise<string> => {
        x += 10;
        const { publicId } = await createLandscape(cluster!.app, thomas, {
            operationId: randomUUID(),
            layer: "vegetation",
            ring: [
                [x, 100],
                [x + 5, 100],
                [x + 5, 105],
            ],
        });
        await cluster!
            .admin`UPDATE region SET region_type = 'wald', name = ${name} WHERE public_id = ${publicId}::uuid`;
        return publicId;
    };
    const stand = async (id: string) => {
        const [r] = await cluster!.admin<{ hazards: string[]; revision: number }[]>`
            SELECT hazards, revision::int AS revision FROM region WHERE public_id = ${id}::uuid
        `;
        return r!;
    };
    const setze = async (id: string, hazards: string[]) => {
        const revision = (await stand(id)).revision;
        return updateLandscape(cluster!.app, thomas, id, {
            operationId: randomUUID(),
            baseRevision: revision,
            changes: { hazards: hazards as never },
        });
    };
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
    }, 300_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 eine neue Fläche ist ungefährlich: leer in der Tafel, ohne Angabe in Detail und Liste", async () => {
        const id = await lege("Erlenhain");
        expect((await stand(id)).hazards).toEqual([]);
        expect((await readEditorLandscape(cluster!.app, id))?.hazards).toBeUndefined();
        const zeile = (await listEditorLandscapes(cluster!.app)).rows.find((row) => row.id === id);
        expect(zeile?.hazards).toBeUndefined();
    });

    it("🔴 zwei Arten in beliebiger Folge: gespeichert in der Folge des Katalogs, Revision +1, ein Protokolleintrag, keine Ableitung", async () => {
        const id = await lege("Dunkelforst");
        const vorher = await stand(id);
        const quittung = await setze(id, ["kreaturen", "kriminalitaet"]);
        const nachher = await stand(id);
        expect(nachher.hazards).toEqual(["kriminalitaet", "kreaturen"]);
        expect(nachher.revision).toBe(vorher.revision + 1);
        // Die Gefahrenlage ändert keine Fläche und keinen Namen: keine Schriftläufe, nur die Kachelrevision.
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["tiles"]);
        const protokoll = await cluster!.admin<{ action: string; changes: Record<string, unknown> }[]>`
            SELECT action, changes FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid ORDER BY id
        `;
        expect(protokoll).toEqual([
            {
                action: "region.updated",
                changes: { hazards: { before: [], after: ["kriminalitaet", "kreaturen"] } },
            },
        ]);
        const [operation] = await cluster!.admin<{ summary: string }[]>`
            SELECT summary FROM map_operation WHERE operation_id = ${quittung.operationId}::uuid
        `;
        expect(operation!.summary).toBe("Dunkelforst: Gefahrenlage geändert");
        expect((await readEditorLandscape(cluster!.app, id))?.hazards).toEqual(["kriminalitaet", "kreaturen"]);
        const zeile = (await listEditorLandscapes(cluster!.app)).rows.find((row) => row.id === id);
        expect(zeile?.hazards).toEqual(["kriminalitaet", "kreaturen"]);
    });

    it("🔴 „ungefährlich“ leert die Auswahl; dieselbe Auswahl noch einmal schreibt nichts", async () => {
        const id = await lege("Nebelsumpf");
        await setze(id, ["seuche"]);
        const mit = await stand(id);
        await setze(id, ["seuche"]);
        expect((await stand(id)).revision).toBe(mit.revision);
        await setze(id, []);
        expect(await stand(id)).toEqual({ hazards: [], revision: mit.revision + 1 });
    });

    it("🔴 gegen eine alte Revision: 409, nichts geschrieben", async () => {
        const id = await lege("Graukamm");
        const alt = (await stand(id)).revision;
        await setze(id, ["wildnis"]);
        const antwort = await fehler(
            updateLandscape(cluster!.app, thomas, id, {
                operationId: randomUUID(),
                baseRevision: alt,
                changes: { hazards: ["kriegsgebiet"] },
            }),
        );
        expect(antwort.statusCode).toBe(409);
        expect((await stand(id)).hazards).toEqual(["wildnis"]);
    });

    it("🔴 ↺ nimmt die Gefahrenlage zurück und ist selbst wieder ein Eintrag mit Revision", async () => {
        const id = await lege("Schattenwald");
        await setze(id, ["daemonisch"]);
        const zweite = await setze(id, ["daemonisch", "unerforscht"]);
        const vor = await stand(id);
        await nimmFlaecheZurueck(cluster!.app, thomas, id, { operationId: randomUUID(), reverts: zweite.operationId });
        expect(await stand(id)).toEqual({ hazards: ["daemonisch"], revision: vor.revision + 1 });
    });

    it("🔴 die Datenbank nimmt keine unbekannte Art an (CHECK), auch nicht am Schreibweg vorbei", async () => {
        const id = await lege("Irrlichtmoor");
        await expect(
            cluster!.admin`UPDATE region SET hazards = ARRAY['drachen']::text[] WHERE public_id = ${id}::uuid`,
        ).rejects.toThrow(/region_hazards_known/u);
        expect((await stand(id)).hazards).toEqual([]);
    });

    it("🔴 Kachel (0342): `region_gefahr_tile` liefert nur Flächen mit wirksamer Gefahrenlage, sonst nichts; `region_area_tile` bleibt gleich", async () => {
        const kachelHat = async (): Promise<boolean> => {
            const [zeile] = await cluster!.admin<{ hat: boolean }[]>`
                SELECT length(region_gefahr_tile(0, 0, 0, '{}'::json)) > 0 AS hat
            `;
            return zeile!.hat;
        };
        const flaechen = async (): Promise<string> => {
            const [zeile] = await cluster!.admin<
                { md5: string }[]
            >`SELECT md5(region_area_tile(0, 0, 0, '{}'::json)) AS md5`;
            return zeile!.md5;
        };
        // Ohne Gefahrenlage im ganzen Cluster: eine leere Kachel.
        await cluster!.admin`UPDATE region SET hazards = '{}'`;
        expect(await kachelHat()).toBe(false);
        const id = await lege("Kachelforst");
        const ohne = await flaechen();
        await setze(id, ["kriegsgebiet"]);
        expect(await kachelHat()).toBe(true);
        // Die Flächenkachel nennt `gefahr` nicht: dieselben Bytes mit und ohne Gefahrenlage.
        expect(await flaechen()).toBe(ohne);
        const [zeile] = await cluster!.admin<{ gefahr: boolean | null }[]>`
            SELECT e.gefahr FROM region_area_eckig_render e
              JOIN region r ON r.public_id = e.region_public_id WHERE r.public_id = ${id}::uuid
        `;
        expect(zeile?.gefahr).toBe(true);
        // In einer Ebene ohne Wirkung ruht sie: kein `gefahr`, der Wert bleibt.
        await cluster!
            .admin`UPDATE region SET region_layer = 'klima', region_type = NULL WHERE public_id = ${id}::uuid`;
        expect(await kachelHat()).toBe(false);
        await cluster!
            .admin`UPDATE region SET region_layer = 'vegetation', region_type = 'wald' WHERE public_id = ${id}::uuid`;
        expect(await kachelHat()).toBe(true);
        await setze(id, []);
        expect(await kachelHat()).toBe(false);
    });

    it("🔴 Infopanel: `gefahr` mit den Arten der Fläche in der Folge des Katalogs; ohne Gefahrenlage fehlt es", async () => {
        const id = await lege("Panelforst");
        const detail = async () => areaDetail(cluster!.app, await buildSubjectIndex(cluster!.app, "0123456789ab"), id);
        expect((await detail())?.gefahr).toBeUndefined();
        await setze(id, ["wildnis", "kriegsgebiet"]);
        expect((await detail())?.gefahr).toEqual({ arten: ["kriegsgebiet", "wildnis"] });
        await setze(id, []);
        expect((await detail())?.gefahr).toBeUndefined();
    });

    it("🔴 in Klima ruht die Gefahrenlage: gespeichert, aber der Editor führt die Fläche nicht; zurück in der Vegetation gilt sie wieder", async () => {
        const id = await lege("Mittellande");
        await setze(id, ["extremwetter"]);
        await cluster!
            .admin`UPDATE region SET region_layer = 'klima', region_type = NULL WHERE public_id = ${id}::uuid`;
        expect((await stand(id)).hazards).toEqual(["extremwetter"]);
        expect(await readEditorLandscape(cluster!.app, id)).toBeUndefined();
        expect((await fehler(setze(id, []))).statusCode).toBe(404);
        await cluster!
            .admin`UPDATE region SET region_layer = 'vegetation', region_type = 'wald' WHERE public_id = ${id}::uuid`;
        expect((await readEditorLandscape(cluster!.app, id))?.hazards).toEqual(["extremwetter"]);
    });
});
