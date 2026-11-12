import { fileURLToPath } from "node:url";
import { SEARCH_VORKOMMEN_SICHTBAR, SearchResponse } from "@avesmaps3d/shared";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { search } from "../src/search/search.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Landmarken in der Spotlight-Suche (WI-0271 L6) gegen echtes PostGIS: Wegwerf-Cluster mit allen Rollen. 🔴 Keine Zeile einer neuen Art in `avesmaps3d_dev` oder
 * in der geteilten Testdatenbank.
 *
 * Problemfälle: Eine Höhle wird nicht gefunden, weil die Suche nur Gipfel kennt; eine stillgelegte oder auf der Karte ausgeblendete Landmarke taucht auf; Akzent und ß
 * verhindern den Treffer; der genaue Name steht hinter längeren; die Landmarken drängen als fünfte Trefferart in `hits` (die Photobox kennt nur vier) oder die Sektion
 * steht ohne Treffer da; die Antwort verletzt das Schema der Route.
 */

const ENV = "lmsuche";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = {
    hoehle: "c8c8c8c8-0271-4006-8000-000000000001",
    gipfel: "c8c8c8c8-0271-4006-8000-000000000002",
    quelle: "c8c8c8c8-0271-4006-8000-000000000003",
    verborgen: "c8c8c8c8-0271-4006-8000-000000000004",
    ohneText: "c8c8c8c8-0271-4006-8000-00000000000a",
    alt: "c8c8c8c8-0271-4006-8000-000000000005",
} as const;

describeWithCluster("Landmarken in der Suche (WI-0271 L6, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    const suche = (q: string): Promise<SearchResponse> => search(cluster!.app, q);
    const namen = (antwort: SearchResponse): string[] => antwort.landmarken?.hits.map((hit) => hit.name) ?? [];

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        const landmarke = async (
            id: string,
            name: string,
            art: string,
            x: number,
            optionen: { hoehe?: number; beschriftung?: boolean; merkmale?: string[]; aktiv?: boolean } = {},
        ): Promise<void> => {
            await m`
                INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt, show_name, merkmale, is_active)
                VALUES (${id}::uuid, 'aventuria', ${name}, ${art}, ST_SetSRID(ST_MakePoint(${x}, 515), 0), ${optionen.hoehe ?? null},
                        ${optionen.beschriftung ?? true}, ${optionen.merkmale ?? []}::text[], ${optionen.aktiv ?? true})
            `;
        };
        await landmarke(ID.hoehle, "L6 Drachenhöhle", "hoehle", 510);
        await landmarke(ID.gipfel, "L6 Drachenzahn", "berggipfel", 520, { hoehe: 2500 });
        await landmarke(ID.quelle, "L6 Straßenquelle", "quelle", 530);
        await landmarke(ID.verborgen, "L6 Felsnadel", "berggipfel", 540, {
            beschriftung: false,
            merkmale: ["nur_gelaende"],
        });
        await landmarke(ID.ohneText, "L6 Stummquelle", "quelle", 545, { beschriftung: false });
        await landmarke(ID.alt, "L6 Drachengrab", "krater", 550, { aktiv: false });
        for (let n = 1; n <= 7; n += 1)
            await landmarke(`c8c8c8c8-0271-4006-8000-00000000010${String(n)}`, `L6 Fels ${String(n)}`, "fels", 560 + n);
    }, 300_000);

    afterAll(async () => {
        await cluster?.stop();
    });

    it("🔴 jede Art wird gefunden, mit Art und Punkt, in der eigenen Sektion; `hits` bleibt ohne Landmarken", async () => {
        const antwort = await suche("L6 Drachen");
        expect(Value.Check(SearchResponse, antwort)).toBe(true);
        expect(antwort.landmarken).toEqual({
            hits: [
                { id: ID.gipfel, name: "L6 Drachenzahn", art: "berggipfel", x: 520, y: 515 },
                { id: ID.hoehle, name: "L6 Drachenhöhle", art: "hoehle", x: 510, y: 515 },
            ],
            total: 2,
        });
        expect(antwort.hits.map((hit) => hit.kind)).not.toContain("landmarke");
    });

    it("🔴 „Auf der Karte anzeigen“ aus nimmt nur den Text: Die Landmarke bleibt auffindbar (WI-0271 §18)", async () => {
        expect(namen(await suche("Stummquelle"))).toEqual(["L6 Stummquelle"]);
    });

    it("🔴 ein Hilfspunkt („nur Gelände“) und eine stillgelegte Landmarke fehlen", async () => {
        expect((await suche("Felsnadel")).landmarken).toBeUndefined();
        expect((await suche("Drachengrab")).landmarken).toBeUndefined();
    });

    it("gefaltet: ohne Umlaut und ß findet sie trotzdem", async () => {
        expect(namen(await suche("drachenhohle"))).toEqual(["L6 Drachenhöhle"]);
        expect(namen(await suche("Strassenquelle"))).toEqual(["L6 Straßenquelle"]);
    });

    it("der genaue Name steht vorn, der Deckel liefert fünf und zählt alle", async () => {
        const antwort = await suche("L6 Fels");
        expect(antwort.landmarken?.hits).toHaveLength(SEARCH_VORKOMMEN_SICHTBAR);
        expect(antwort.landmarken?.total).toBe(7);
        expect(namen(await suche("L6 Fels 3"))[0]).toBe("L6 Fels 3");
    });

    it("ohne Treffer fehlt die Sektion ganz", async () => {
        expect(await suche("Nichtsdergleichen")).not.toHaveProperty("landmarken");
    });
});
