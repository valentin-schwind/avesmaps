import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { landmarkWaypointId } from "@avesmaps3d/shared";
import { databaseWaypointIndex } from "../src/routing/waypoints.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Wegpunktsuche liest Landmarken aus `terrain_peak` (WI-0271 L6, §4.3), so wie auf dem VPS: Wegwerf-Cluster, gelesen als App-Rolle.
 * 🔴 Eine Zeile einer neuen Art entsteht nur hier, nie in `avesmaps3d_dev` oder der geteilten Testdatenbank.
 *
 * Problemfälle: Die App-Rolle darf `terrain_peak` nicht lesen (die Wegpunktsuche antwortet 500); Riff, Strudel oder eine stillgelegte
 * Landmarke werden vorgeschlagen oder lösen sich auf; „Kartenpunkt bei …“ nennt eine Landmarke statt eines Orts; eine Ortsantwort trägt
 * plötzlich ein Feld mehr; eine neue oder stillgelegte Landmarke bleibt bis zum Neustart unsichtbar.
 */

const ENV = "lmweg";
const DOMAIN = "aventuria";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ORT = "c1c1c1c1-0271-4000-8000-000000000001";
const HOEHLE = "c1c1c1c1-0271-4000-8000-0000000000a1";
const GIPFEL_VERBORGEN = "c1c1c1c1-0271-4000-8000-0000000000a2";
const OHNE_TEXT = "c1c1c1c1-0271-4000-8000-0000000000a9";
const RIFF = "c1c1c1c1-0271-4000-8000-0000000000f1";
const STRUDEL = "c1c1c1c1-0271-4000-8000-0000000000f2";
const STILLGELEGT = "c1c1c1c1-0271-4000-8000-0000000000f3";
const SPAETER = "c1c1c1c1-0271-4000-8000-0000000000a3";

describeWithCluster("Landmarken in der Wegpunktsuche (WI-0271 L6, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    let jetzt = 0;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        await m`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}::uuid, ${DOMAIN}, 'Drachenfurt', 'dorf', ST_SetSRID(ST_MakePoint(500, 400), 0), 'test', TRUE)
        `;
        const landmarke = (
            id: string,
            name: string,
            art: string,
            x: number,
            y: number,
            { beschriftung = true, merkmale = [] as string[], aktiv = true } = {},
        ) => m`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, show_name, merkmale, is_active)
            VALUES (${id}::uuid, ${DOMAIN}, ${name}, ${art}, ST_SetSRID(ST_MakePoint(${x}::float8, ${y}::float8), 0), ${beschriftung}, ${merkmale}::text[], ${aktiv})
        `;
        // Die Höhle liegt näher an dem Kartenpunkt (501|401) als der Ort: Der nächste Ort bleibt trotzdem der Ort.
        await landmarke(HOEHLE, "Drachenhöhle", "hoehle", 501, 401);
        await landmarke(GIPFEL_VERBORGEN, "Drachenzinne", "berggipfel", 520, 410, {
            beschriftung: false,
            merkmale: ["nur_gelaende"],
        });
        await landmarke(OHNE_TEXT, "Drachenbrunnen", "quelle", 525, 415, { beschriftung: false });
        await landmarke(RIFF, "Drachenriff", "riff", 530, 420);
        await landmarke(STRUDEL, "Drachenstrudel", "strudel", 540, 420);
        await landmarke(STILLGELEGT, "Drachenquelle", "quelle", 550, 420, { aktiv: false });
    }, 300_000);

    afterAll(async () => {
        await cluster?.stop();
    });

    const index = () => databaseWaypointIndex(cluster!.app, { recheckMs: 1000, now: () => jetzt });

    it("schlägt aktive Landmarken mit Reiseziel-Art vor, in der Rangfolge der Orte; Riff, Strudel, Stillgelegtes und Verborgenes nicht", async () => {
        const { hits } = await index().lookup("drachen", 20);
        expect(hits).toEqual([
            // „Auf der Karte anzeigen“ aus nimmt nur den Text (WI-0271 §18): Sie bleibt ein Reiseziel. „Nur Gelände“ steht nicht auf der Karte: kein Reiseziel, wie in der Spotlight-Suche.
            {
                id: landmarkWaypointId(OHNE_TEXT),
                name: "Drachenbrunnen",
                subtype: "quelle",
                hidden: false,
                x: 525,
                y: 415,
                landmark: "quelle",
            },
            { id: ORT, name: "Drachenfurt", subtype: "dorf", hidden: false, x: 500, y: 400 },
            {
                id: landmarkWaypointId(HOEHLE),
                name: "Drachenhöhle",
                subtype: "hoehle",
                hidden: false,
                x: 501,
                y: 401,
                landmark: "hoehle",
            },
        ]);
    });

    it("löst die Kennung auf (Kurzlink, Route), Riff, Strudel, Stillgelegtes und Verborgenes nicht; der nächste Ort bleibt ein Ort", async () => {
        const wegpunkte = index();
        const ids = [HOEHLE, RIFF, STRUDEL, STILLGELEGT, GIPFEL_VERBORGEN].map(landmarkWaypointId);
        expect((await wegpunkte.byIds([ORT, ...ids])).map((hit) => hit?.name ?? null)).toEqual([
            "Drachenfurt",
            "Drachenhöhle",
            null,
            null,
            null,
            null,
        ]);
        expect(
            (await wegpunkte.resolve(["Drachenfurt", ids[0]!, "Drachenhöhle"])).map((hit) => hit?.id ?? null),
        ).toEqual([ORT, ids[0], null]);
        expect((await wegpunkte.nearest(501, 401)).place?.id).toBe(ORT);
    });

    it("eine neue Landmarke ist nach der Prüffrist da, eine stillgelegte weg", async () => {
        const wegpunkte = index();
        expect((await wegpunkte.byIds([landmarkWaypointId(SPAETER)]))[0]).toBeNull();
        await cluster!.migrator`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom)
            VALUES (${SPAETER}::uuid, ${DOMAIN}, 'Silberfall', 'wasserfall', ST_SetSRID(ST_MakePoint(560, 430), 0))
        `;
        await cluster!.migrator`UPDATE terrain_peak SET is_active = FALSE WHERE public_id = ${HOEHLE}::uuid`;
        jetzt += 1000;
        expect(
            (await wegpunkte.byIds([SPAETER, HOEHLE].map(landmarkWaypointId))).map((hit) => hit?.name ?? null),
        ).toEqual(["Silberfall", null]);
    });
});
