import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import { createLandscape } from "../src/editor/landscape-create.ts";
import { pruefeLandschaftenVereinigen, vereinigeLandschaften } from "../src/editor/landscape-vereinigen.ts";
import { readEditorLandscape } from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { restoreTerritory } from "../src/editor/territory-retire.ts";
import { pruefeGebieteVereinigen, vereinigeGebiete } from "../src/editor/territory-vereinigen.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { nimmFlaecheZurueck } from "./support/ruecknahme-derographie.ts";

/**
 * „Flächen vereinigen ›“ (WI-0252) im Wegwerf-Cluster wie auf dem VPS, geschrieben als App-Rolle. 🔴 Kein Test schreibt in
 * `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Die gemeinsame Kante bleibt als Naht stehen, oder die beiden Ecken eines Stoßes, die kaum nebeneinander liegen, bleiben
 * zwei; ein schmaler Spalt bleibt als Loch; ein Nachbar, der eine Ecke mit den vereinigten teilte, hängt danach nicht mehr daran; die
 * andere Landschaft bleibt auf der Karte; ↺ holt nicht alles zurück; verschiedene Art, Ebene, Obergebiet oder Gültigkeit gehen durch;
 * eine alte Revision oder eine fremde Sperre schreibt trotzdem.
 */

const ENV = "vereinigen";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

type Ring = [number, number][];
const quadrat = (x0: number, y0: number, x1: number, y1: number): Ring => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
];
const schluessel = ([x, y]: readonly number[]): string => `${x!.toFixed(5)} ${y!.toFixed(5)}`;
/** Wohin die Bilder der Rechnung gehen (Auftrag WI-0252): nur, wenn der Ordner genannt ist. */
const BILDER = process.env["FLAECHEN_VEREINIGEN_BILDER"];
interface Bildflaeche {
    readonly polygone: number[][][][];
    readonly farbe: string;
    readonly name: string;
}
/** Vorher und nachher nebeneinander als PNG: Flächen im Kartenraum (y nach unten wie die Karte), jede Ecke ein Punkt. */
async function zeichne(datei: string, vorher: readonly Bildflaeche[], nachher: readonly Bildflaeche[]): Promise<void> {
    if (BILDER === undefined) return;
    const [x0, y0, breite, hoehe, mass] = [495, 495, 110, 70, 8];
    const tafel = (flaechen: readonly Bildflaeche[], dx: number, titel: string): string => {
        const punkt = ([x, y]: number[]): string => `${String((x! - x0) * mass + dx)},${String((y! - y0) * mass + 40)}`;
        const teile = flaechen.map((f) => {
            const pfad = f.polygone
                .map((polygon) => polygon.map((ring) => `M${ring.map(punkt).join("L")}Z`).join(""))
                .join("");
            const ecken = f.polygone
                .flat(2)
                .map(
                    (e) =>
                        `<circle cx="${punkt(e).split(",")[0]!}" cy="${punkt(e).split(",")[1]!}" r="4" fill="#111"/>`,
                )
                .join("");
            return `<path d="${pfad}" fill="${f.farbe}" fill-opacity="0.55" stroke="#222" stroke-width="2" fill-rule="evenodd"/>${ecken}`;
        });
        const namen = flaechen
            .map(
                (f, i) =>
                    `<text x="${String(dx + 10)}" y="${String(hoehe * mass + 70 + i * 22)}" font-size="18" fill="${f.farbe}">■ ${f.name}</text>`,
            )
            .join("");
        return `<text x="${String(dx + 10)}" y="26" font-size="22" font-family="sans-serif">${titel}</text>${teile.join("")}${namen}`;
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(2 * breite * mass + 60)}" height="${String(hoehe * mass + 170)}" font-family="sans-serif">
        <rect width="100%" height="100%" fill="#fff"/>${tafel(vorher, 10, "vorher")}${tafel(nachher, breite * mass + 50, "nachher")}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(join(BILDER, datei));
}

const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string; details?: unknown }> => {
    try {
        await arbeit;
        return {};
    } catch (error) {
        return error as { statusCode?: number; code?: string; details?: unknown };
    }
};

describeWithCluster("Flächen vereinigen (WI-0252, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    let importer: Database | undefined;
    const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

    /** Eine neue Landschaft mit einer Teilfläche (Ringe ohne Schlusspunkt). */
    const lege = async (ring: Ring, layer: "vegetation" | "topographie" = "vegetation") => {
        const { publicId } = await createLandscape(cluster!.app, thomas, { operationId: randomUUID(), layer, ring });
        const detail = await readEditorLandscape(cluster!.app, publicId);
        return { id: publicId, flaeche: detail!.areas[0]!.id };
    };
    const teilflaeche = async (id: string) => {
        const [z] = await cluster!.admin<
            { aktiv: boolean; region_aktiv: boolean; geojson: string; revision: number; f: number }[]
        >`
            SELECT a.is_active AS aktiv, r.is_active AS region_aktiv, ST_AsGeoJSON(a.geom, 15) AS geojson, a.revision::int AS revision,
                   ST_Area(a.geom) AS f
              FROM region_area a JOIN region r ON r.id = a.region_id WHERE a.public_id = ${id}::uuid
        `;
        const g = JSON.parse(z!.geojson) as { type: string; coordinates: number[][][] | number[][][][] };
        const polygone = (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]) as number[][][][];
        return { ...z!, polygone, ecken: new Set(polygone.flat(2).map(schluessel)) };
    };
    const objekte = async (ids: readonly string[]) =>
        (await pruefeLandschaftenVereinigen(cluster!.app, ids)).objekte.map((o) => ({
            publicId: o.publicId,
            baseRevision: o.revision,
        }));

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const o = cluster.migrator.options as unknown as {
            host: string[];
            port: number[];
            user: string;
            database: string;
        };
        importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, { max: 3 });
        await importTerritories(importer, gebiete());
    }, 300_000);

    afterAll(async () => {
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 zwei Nachbarn mit gemeinsamer Kante werden EINE Fläche: Naht weg, der Stoß knapp daneben ein Punkt, die Nachbarn hängen weiter", async () => {
        // A und B teilen die Kante x = 540; B steht 0,01 daneben und läuft andersherum. N liegt oben an beiden, C rechts an B.
        const a = await lege(quadrat(500, 500, 540, 530));
        const b = await lege([
            [540.01, 500],
            [540.01, 530],
            [580, 530],
            [580, 500],
        ]);
        const n = await lege([
            [500, 530],
            [540, 530],
            [580, 530],
            [580, 560],
            [500, 560],
        ]);
        const c = await lege(quadrat(580, 500, 600, 530));
        const nVorher = await teilflaeche(n.flaeche);
        const cVorher = await teilflaeche(c.flaeche);

        const pruefung = await pruefeLandschaftenVereinigen(cluster!.app, [b.id, a.id]);
        expect(pruefung).toMatchObject({ geht: true, vorlagen: [b.id, a.id] });
        expect(pruefung.objekte.map((o) => o.flaechen)).toEqual([1, 1]);

        const operationId = randomUUID();
        const quittung = await vereinigeLandschaften(cluster!.app, thomas, {
            operationId,
            objects: await objekte([a.id, b.id]),
            vorlage: a.id,
        });
        expect(quittung.publicId).toBe(a.id);
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toContain("land_smooth");

        const ergebnis = await teilflaeche(a.flaeche);
        expect(ergebnis.polygone).toHaveLength(1);
        expect(ergebnis.polygone[0]).toHaveLength(1);
        expect(ergebnis.f).toBeCloseTo(80 * 30, 6);
        // Die Naht ist weg: keine Ecke mehr bei x = 540,01; die Stoßecken oben und unten je einmal.
        const ring = ergebnis.polygone[0]![0]!.slice(0, -1).map(schluessel);
        expect(ring.some((k) => k.startsWith("540.01000"))).toBe(false);
        expect(ring.filter((k) => k === schluessel([540, 530]))).toHaveLength(1);
        // Die Nachbarn sind unberührt und hängen an jeder Ecke, die sie teilten.
        expect(await teilflaeche(n.flaeche)).toMatchObject({ revision: nVorher.revision, geojson: nVorher.geojson });
        expect(await teilflaeche(c.flaeche)).toMatchObject({ revision: cVorher.revision, geojson: cVorher.geojson });
        for (const k of [
            [500, 530],
            [540, 530],
            [580, 530],
            [580, 500],
        ].map(schluessel))
            expect(ergebnis.ecken).toContain(k);
        const nach = (await teilflaeche(n.flaeche)).polygone;
        const cNach = (await teilflaeche(c.flaeche)).polygone;
        await zeichne(
            "flaechen-vereinigen-rechnung.png",
            [
                { polygone: [[quadrat(500, 500, 540, 530)]], farbe: "#2e7d32", name: "A (Vorlage)" },
                {
                    polygone: [
                        [
                            [
                                [540.01, 500],
                                [540.01, 530],
                                [580, 530],
                                [580, 500],
                            ],
                        ],
                    ],
                    farbe: "#66bb6a",
                    name: "B, 0,01 daneben",
                },
                { polygone: nach, farbe: "#8d6e63", name: "Nachbar N" },
                { polygone: cNach, farbe: "#5c6bc0", name: "Nachbar C" },
            ],
            [
                { polygone: ergebnis.polygone, farbe: "#2e7d32", name: "A ∪ B" },
                { polygone: nach, farbe: "#8d6e63", name: "Nachbar N, unverändert" },
                { polygone: cNach, farbe: "#5c6bc0", name: "Nachbar C, unverändert" },
            ],
        );
        // B ist samt Landschaft von der Karte.
        expect(await teilflaeche(b.flaeche)).toMatchObject({ aktiv: false, region_aktiv: false });
        const protokoll = await cluster!.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
        expect(protokoll.map((z) => z.action).slice(0, 3)).toEqual(["area.merged", "area.retired", "region.retired"]);

        // ↺ im Verlauf der Vorlage holt alles zurück.
        await nimmFlaecheZurueck(cluster!.app, thomas, a.id, { operationId: randomUUID(), reverts: operationId });
        expect((await teilflaeche(a.flaeche)).f).toBeCloseTo(40 * 30, 6);
        expect(await teilflaeche(b.flaeche)).toMatchObject({ aktiv: true, region_aktiv: true });
    });

    it("🔴 getrennte Teile: beide Modelle kennen Mehrfachpolygone, die ferne Fläche kommt als zweites Polygon zur Vorlage", async () => {
        const a = await lege(quadrat(500, 600, 520, 620));
        const b = await lege(quadrat(560, 600, 580, 620));
        expect(await pruefeLandschaftenVereinigen(cluster!.app, [a.id, b.id])).toMatchObject({ geht: true });
        await vereinigeLandschaften(cluster!.app, thomas, {
            operationId: randomUUID(),
            objects: await objekte([a.id, b.id]),
            vorlage: b.id,
        });
        const ergebnis = await teilflaeche(b.flaeche);
        expect(ergebnis.polygone).toHaveLength(2);
        expect(ergebnis.f).toBeCloseTo(2 * 20 * 20, 6);
        expect(await teilflaeche(a.flaeche)).toMatchObject({ aktiv: false, region_aktiv: false });
    });

    it("🔴 echte Ränder: Eine Fläche, deren Rand sich selbst kreuzt, bricht die Prüfung nicht ab; sie wird gültig gemacht und vereinigt (GEOS „side location conflict“, 500)", async () => {
        // Die echten Gebirge haben solche Schleifen (gemessen in der Wegwerf-Welt: `GEOSUnaryUnion: TopologyException`, die Prüfung
        // antwortete 500 und das Menü blieb grau); die sauberen Quadrate der übrigen Fälle zeigten es nie.
        const a = await lege(quadrat(500, 900, 540, 940));
        const b = await lege(quadrat(520, 900, 560, 940));
        await cluster!.admin`
            UPDATE region_area SET geom = ST_GeomFromText('POLYGON((500 900,540 900,500 940,540 940,500 900))')
             WHERE public_id = ${a.flaeche}::uuid
        `;
        const pruefung = await pruefeLandschaftenVereinigen(cluster!.app, [a.id, b.id]);
        expect(pruefung).toMatchObject({ geht: true, vorlagen: [a.id, b.id] });
        await vereinigeLandschaften(cluster!.app, thomas, {
            operationId: randomUUID(),
            objects: await objekte([a.id, b.id]),
            vorlage: b.id,
        });
        const ergebnis = await teilflaeche(b.flaeche);
        // Beide Dreiecke der Schleife und das Quadrat darüber sind EINE gültige Fläche.
        expect(
            await cluster!
                .admin`SELECT ST_IsValid(geom) AS gueltig FROM region_area WHERE public_id = ${b.flaeche}::uuid`,
        ).toEqual([{ gueltig: true }]);
        expect(ergebnis.f).toBeGreaterThan(40 * 40);
    });

    it("🔴 grau: verschiedene Art oder Ebene; ein Nachbar, dessen Ecke danach im Inneren läge", async () => {
        const a = await lege(quadrat(500, 700, 520, 720));
        const b = await lege(quadrat(520, 700, 540, 720));
        await cluster!.admin`UPDATE region SET region_type = 'Wald' WHERE public_id = ${a.id}::uuid`;
        expect(await pruefeLandschaftenVereinigen(cluster!.app, [a.id, b.id])).toMatchObject({
            geht: false,
            grund: "art",
        });
        const huegel = await lege(quadrat(540, 700, 560, 720), "topographie");
        expect(await pruefeLandschaftenVereinigen(cluster!.app, [b.id, huegel.id])).toMatchObject({
            geht: false,
            grund: "art",
        });
        // D überdeckt die rechte Kante von E; N teilt E's Ecke (620, 720), die danach mitten in der vereinigten Fläche läge.
        const e = await lege(quadrat(600, 700, 620, 720));
        const d = await lege(quadrat(610, 695, 640, 725));
        await lege([
            [620, 720],
            [625, 720],
            [625, 740],
            [620, 740],
        ]);
        expect(await pruefeLandschaftenVereinigen(cluster!.app, [e.id, d.id])).toMatchObject({
            geht: false,
            grund: "nachbar",
        });
    });

    it("🔴 alte Revision 409 `edit_conflict`, fremde Sperre 409 `object_locked`, Vorlage außerhalb 400; nichts ist geschrieben", async () => {
        const a = await lege(quadrat(500, 800, 520, 820));
        const b = await lege(quadrat(520, 800, 540, 820));
        const stand = await objekte([a.id, b.id]);
        expect(
            await fehler(
                vereinigeLandschaften(cluster!.app, thomas, {
                    operationId: randomUUID(),
                    objects: stand.map((o) => (o.publicId === b.id ? { ...o, baseRevision: o.baseRevision + 7 } : o)),
                    vorlage: a.id,
                }),
            ),
        ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        expect(
            await fehler(
                vereinigeLandschaften(cluster!.app, thomas, {
                    operationId: randomUUID(),
                    objects: stand,
                    vorlage: randomUUID(),
                }),
            ),
        ).toMatchObject({ statusCode: 400, code: "validation_failed" });
        await takeEditorLock(cluster!.app, {
            kind: "landscape",
            id: b.id,
            part: "felder",
            personId: randomUUID(),
            personName: "Rondra",
            run: randomUUID(),
        });
        expect(
            await fehler(
                vereinigeLandschaften(cluster!.app, thomas, {
                    operationId: randomUUID(),
                    objects: stand,
                    vorlage: a.id,
                }),
            ),
        ).toMatchObject({ statusCode: 409, code: "object_locked" });
        expect(await teilflaeche(b.flaeche)).toMatchObject({ aktiv: true });
        expect((await teilflaeche(a.flaeche)).f).toBeCloseTo(400, 6);
    });

    // --- Herrschaftsgebiete -------------------------------------------------------------------------------------------------------

    const gebietZeile = async (id: string) => {
        const [z] = await cluster!.admin<{ revision: number; aktiv: boolean; name: string }[]>`
            SELECT revision::int AS revision, is_active AS aktiv, name FROM territory WHERE public_id = ${id}::uuid
        `;
        return z!;
    };
    const gebietsflaeche = async (id: string) => {
        const [z] = await cluster!.admin<{ aktiv: boolean; f: number; geojson: string; revision: number }[]>`
            SELECT is_active AS aktiv, ST_Area(geom) AS f, ST_AsGeoJSON(geom, 15) AS geojson, revision::int AS revision
              FROM territory_area WHERE public_id = ${id}::uuid
        `;
        return z!;
    };
    const gebietsObjekte = async (ids: readonly string[]) =>
        (await pruefeGebieteVereinigen(cluster!.app, ids)).objekte.map((o) => ({
            publicId: o.publicId,
            baseRevision: o.revision,
        }));

    it("🔴 zwei Baronien mit gemeinsamer Grenze: EINE Fläche für die Vorlage, die andere verliert nur ihre Fläche; ↺ holt sie zurück", async () => {
        const nachbarVorher = await gebietsflaeche(NACHBAR_FLAECHE);
        const vorher = await gebietZeile(ORT);
        expect(await pruefeGebieteVereinigen(cluster!.app, [WEST_B, ORT])).toMatchObject({ geht: true });
        const operationId = randomUUID();
        const quittung = await vereinigeGebiete(cluster!.app, thomas, {
            operationId,
            objects: await gebietsObjekte([WEST_B, ORT]),
            vorlage: WEST_B,
        });
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toContain("territory_derive");
        expect((await gebietsflaeche(WEST_B_FLAECHE)).f).toBeCloseTo(240 * 30, 6);
        expect(await gebietsflaeche(ORT_FLAECHE)).toMatchObject({ aktiv: false });
        // Das Gebiet selbst bleibt mit allen Bezügen; der Nachbar ist unberührt.
        expect(await gebietZeile(ORT)).toEqual(vorher);
        expect(await gebietsflaeche(NACHBAR_FLAECHE)).toMatchObject({ revision: nachbarVorher.revision });

        await restoreTerritory(cluster!.app, thomas, WEST_B, { operationId: randomUUID(), reverts: operationId });
        expect((await gebietsflaeche(WEST_B_FLAECHE)).f).toBeCloseTo(120 * 30, 6);
        expect(await gebietsflaeche(ORT_FLAECHE)).toMatchObject({ aktiv: true });
    });

    it("🔴 grau: verschiedene Art, anderes Obergebiet, andere Gültigkeit", async () => {
        expect(await pruefeGebieteVereinigen(cluster!.app, [WEST_B, GRAFSCHAFT])).toMatchObject({
            geht: false,
            grund: "art",
        });
        expect(await pruefeGebieteVereinigen(cluster!.app, [WEST_B, OST_B])).toMatchObject({
            geht: false,
            grund: "art",
        });
        await cluster!.admin`UPDATE territory SET valid_to_bf = 1040 WHERE public_id = ${NACHBAR}::uuid`;
        expect(await pruefeGebieteVereinigen(cluster!.app, [ORT, NACHBAR])).toMatchObject({
            geht: false,
            grund: "zeit",
        });
    });
});

// --- Herrschaftsgebiete als Import wie in `territory-retire.test.ts` ----------------------------------------------------------------

const ID = (n: number): string => `e5e5e5e5-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const WEST = ID(2);
const OST = ID(3);
const WEST_B = ID(4);
const ORT = ID(5);
const NACHBAR = ID(6);
const OST_B = ID(7);
const GRAFSCHAFT = ID(8);
const WEST_B_FLAECHE = ID(0xa4);
const ORT_FLAECHE = ID(0xa5);
const NACHBAR_FLAECHE = ID(0xa6);
const OST_B_FLAECHE = ID(0xa7);
const GRAFSCHAFT_FLAECHE = ID(0xa8);

function gebiet(id: string, name: string, eltern: string | null, type = "Baronie"): Record<string, unknown> {
    return {
        public_id: id,
        name,
        short_name: "",
        type,
        wiki_type: type,
        parent_public_id: eltern,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: null,
        max_zoom: null,
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-24 01:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}
function gebietsFlaeche(id: string, territory: string, ring: Ring): Record<string, unknown> {
    return {
        public_id: id,
        territory_public_id: territory,
        geometry: { type: "Polygon", coordinates: [[...ring, ring[0]!]] },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: null,
        max_zoom: null,
        updated_at: "2026-10-24 01:00:00",
    };
}
/** Ein Reich mit zwei Provinzen; unter West drei Baronien in einer Reihe und eine Grafschaft, unter Ost eine Baronie. */
function gebiete(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-vereinigen",
        territories: [
            gebiet(REICH, "Reich", null, "Kaiserreich"),
            gebiet(WEST, "Provinz West", REICH, "Provinz"),
            gebiet(OST, "Provinz Ost", REICH, "Provinz"),
            gebiet(WEST_B, "Baronie West", WEST),
            gebiet(ORT, "Baronie Ort", WEST),
            gebiet(NACHBAR, "Baronie Nachbar", WEST),
            gebiet(OST_B, "Baronie Ost", OST),
            gebiet(GRAFSCHAFT, "Grafschaft", WEST, "Grafschaft"),
        ],
        geometries: [
            gebietsFlaeche(WEST_B_FLAECHE, WEST_B, quadrat(300, 300, 420, 330)),
            gebietsFlaeche(ORT_FLAECHE, ORT, quadrat(420, 300, 540, 330)),
            gebietsFlaeche(NACHBAR_FLAECHE, NACHBAR, quadrat(300, 330, 540, 360)),
            gebietsFlaeche(OST_B_FLAECHE, OST_B, quadrat(600, 300, 640, 330)),
            gebietsFlaeche(GRAFSCHAFT_FLAECHE, GRAFSCHAFT, quadrat(300, 260, 420, 300)),
        ],
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}
