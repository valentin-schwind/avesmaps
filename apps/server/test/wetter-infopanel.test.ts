import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { SubjectDetail, WETTER_SYMBOL_VORGABEN, wetterWikiAdresse } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase } from "../src/database.ts";
import { typeImageList } from "../src/media-editor/type-images.ts";
import { wetterKartenpunkt, wetterReichweite } from "../src/subjects/detail-wetter.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Das Infopanel eines Wetter-Icons mit Wiki-Verweis (WI-0288; Betreiber 2026-11-08: „ja infopanel bauen“) und die vier Typbilder in der Medienverwaltung, gegen echtes
 * PostgreSQL: Wegwerf-Cluster mit allen Rollen, gelesen als App-Rolle über die Route der App. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank;
 * die Zeilen der Icons legt die Migrationsrolle des Wegwerf-Clusters an (den Schreibweg prüft `wetter.test.ts`).
 *
 * Problemfälle: Ein Icon ohne Verweis, ein ausgeblendetes, ein entferntes oder eines mit einem Artikel, den es unter den Winden, Strömungen und Mahlströmen nicht gibt, bekommt
 * ein Panel; ein Wirbel mit Mahlstrom-Artikel zeigt den Wirbelsturm; die Antwort nennt, wer das Icon geändert hat; die Lage steht gespiegelt (das Wetter zählt z nach Süden);
 * die Zählung der Typbilder zählt Icons ohne Panel mit.
 *
 * Die Artikel sind erfunden (keine Texte des Wikis).
 */

const ENV = "wetterinfo";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `02889999-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ICON = {
    wind: ID(1),
    wirbel: ID(2),
    strom: ID(3),
    ohneVerweis: ID(4),
    ausgeblendet: ID(5),
    entfernt: ID(6),
    fremd: ID(7),
};

describe("Lage eines Icons auf der Karte (rein)", () => {
    it("🔴 x bleibt, z zählt nach Süden und wird zur Karten-y nach Norden", () => {
        expect(wetterKartenpunkt(341, 617)).toEqual({ x: 341, y: 407 });
        expect(wetterKartenpunkt(0, 0)).toEqual({ x: 0, y: 1024 });
        expect(wetterKartenpunkt(1024, 1024)).toEqual({ x: 1024, y: 0 });
    });

    it("die Reichweite als Ausschnitt [minX, minY, maxX, maxY], an den Rändern der Karte beschnitten", () => {
        expect(wetterReichweite(500, 500, 100)).toEqual([400, 424, 600, 624]);
        expect(wetterReichweite(30, 1000, 100)).toEqual([0, 0, 130, 124]);
    });
});

describeWithCluster("Infopanel der Wetter-Icons als App-Rolle (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let app: FastifyInstance | undefined;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen);
        const m = cluster.migrator;
        await m`
            INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, art, region_parent, description, synced_at)
            VALUES ('infowind', ${wetterWikiAdresse("Infowind (Wind)")}, 'Infowind', 'Wind', 'Probeküste',
                    'Ein erfundener Wind für die Probe.', '2026-11-01T00:00:00Z'),
                   ('infostrom', ${wetterWikiAdresse("Infostrom")}, 'Infostrom', 'Meeresströmung|Strom', NULL, NULL, NULL),
                   ('infowald', ${wetterWikiAdresse("Infowald")}, 'Infowald', 'Wald', NULL, 'Kein Wetter.', NULL)
        `;
        await m`
            INSERT INTO wiki_landmarke_artikel (schluessel, titel, name, art, wiki_art, region, kurzbeschreibung, unbekannt)
            VALUES ('infostrudel', 'Infostrudel', 'Der Infostrudel', 'strudel', 'Mahlstrom', 'Probemeer',
                    'Ein erfundener Strudel.', '{}'::text[])
        `;
        const icon = async (
            id: string,
            art: "wind" | "wirbel" | "stroemung",
            felder: { name?: string; wiki?: string; sichtbar?: boolean; entfernt?: boolean },
        ): Promise<void> => {
            const wirbel = art === "wirbel";
            await m`
                INSERT INTO weather_symbol (public_id, art, name, sichtbar, x, z, reichweite, staerke, richtung, drehsinn, wiki_titel,
                                            entfernt_at, changed_by_label)
                VALUES (${id}::uuid, ${art}, ${felder.name ?? null}, ${felder.sichtbar ?? true}, 341, 617, 150, 5,
                        ${wirbel ? null : 90}, ${wirbel ? -1 : null}, ${felder.wiki ?? null},
                        ${felder.entfernt === true ? new Date() : null}, 'Probeperson Wetter')
            `;
        };
        await icon(ICON.wind, "wind", { name: "Westwind der Probe", wiki: "Infowind (Wind)" });
        await icon(ICON.wirbel, "wirbel", { wiki: "Infostrudel" });
        await icon(ICON.strom, "stroemung", { name: "Strom der Probe", wiki: "Infostrom" });
        await icon(ICON.ohneVerweis, "wind", { name: "Ohne Verweis" });
        await icon(ICON.ausgeblendet, "wind", { name: "Ausgeblendet", wiki: "Infowind (Wind)", sichtbar: false });
        await icon(ICON.entfernt, "wind", { name: "Entfernt", wiki: "Infowind (Wind)", entfernt: true });
        await icon(ICON.fremd, "wind", { name: "Fremd", wiki: "Infowald" });

        const o = cluster.app.options as unknown as { host: string[]; port: number[]; user: string; database: string };
        app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database: createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 2,
            }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 300_000);

    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    const hole = async (id: string): Promise<{ status: number; detail: SubjectDetail; roh: string }> => {
        const antwort = await app!.inject({ url: `/api/subjects/wetter-symbol/${id}` });
        return { status: antwort.statusCode, detail: antwort.json<SubjectDetail>(), roh: antwort.body };
    };

    it("🔴 ein Wind mit Verweis: Kopf, Typ, Region und Beschreibung des Artikels, Wikizeile, Ziel; niemand, der es geändert hat", async () => {
        const { status, detail, roh } = await hole(ICON.wind);
        expect(status).toBe(200);
        expect(Value.Check(SubjectDetail, detail)).toBe(true);
        expect(detail.subject).toEqual({ kind: "wetterSymbol", id: ICON.wind });
        expect(detail.title).toBe("Westwind der Probe");
        expect(detail.subtitle).toEqual([{ part: "type", key: "wind" }]);
        expect(detail.facts?.map((fact) => [fact.field, "value" in fact ? fact.value : null])).toEqual([
            ["regionParent", "Probeküste"],
            ["description", "Ein erfundener Wind für die Probe."],
        ]);
        expect(detail.facts?.[1]?.provenance).toEqual({
            kind: "wiki",
            wikiUrl: wetterWikiAdresse("Infowind (Wind)"),
            syncedAt: "2026-11-01T00:00:00.000Z",
        });
        expect(detail.wiki).toMatchObject({ url: wetterWikiAdresse("Infowind (Wind)"), title: "Infowind (Wind)" });
        expect(detail.target).toMatchObject({ x: 341, y: 407, bounds: [191, 257, 491, 557] });
        // Keine Sektionen, kein Zähler; öffentlich lesbar und kurz im Zwischenspeicher wie jedes Subject.
        expect(detail.counts).toBeUndefined();
        expect(roh).not.toMatch(/Probeperson|changed/u);
        const antwort = await app!.inject({ url: `/api/subjects/wetter-symbol/${ICON.wind}` });
        expect(antwort.headers["cache-control"]).toBe("public, max-age=60");
    });

    it("🔴 ein Wirbel mit Mahlstrom-Artikel heißt nach dem Artikel und ist ein Mahlstrom; eine Strömung ohne Region nennt nur, was es gibt", async () => {
        const wirbel = (await hole(ICON.wirbel)).detail;
        expect(wirbel.title).toBe("Der Infostrudel");
        expect(wirbel.subtitle).toEqual([{ part: "type", key: "mahlstrom" }]);
        expect(wirbel.facts?.map((fact) => fact.field)).toEqual(["regionParent", "description"]);
        expect(wirbel.wiki).toMatchObject({ title: "Infostrudel" });

        const strom = (await hole(ICON.strom)).detail;
        expect(strom.title).toBe("Strom der Probe");
        expect(strom.subtitle).toEqual([{ part: "type", key: "stroemung" }]);
        expect(strom.facts).toBeUndefined();
        expect(strom.wiki).toMatchObject({ title: "Infostrom" });
    });

    it("🔴 kein Panel ohne Verweis, ausgeblendet, entfernt, mit fremdem Artikel oder für eine Vorgabe des Prototyps", async () => {
        for (const id of [
            ICON.ohneVerweis,
            ICON.ausgeblendet,
            ICON.entfernt,
            ICON.fremd,
            WETTER_SYMBOL_VORGABEN[0]!.id,
        ]) {
            const antwort = await app!.inject({ url: `/api/subjects/wetter-symbol/${id}` });
            expect(antwort.statusCode, id).toBe(404);
        }
        expect((await app!.inject({ url: "/api/subjects/wetter-symbol/Passat" })).statusCode).toBe(400);
    });

    it("🔴 Typbilder: die vier Kategorien zählen die Icons mit Panel, über dieselbe Zuordnung wie der Kopf", async () => {
        const liste = await typeImageList(cluster!.app);
        const zahl = (kategorie: string) => liste.items.find((item) => item.category === kategorie);
        expect(zahl("wind")).toMatchObject({ label: "Wind", objects: "other", count: 1 });
        expect(zahl("wirbelsturm")).toMatchObject({ label: "Wirbelsturm", count: 0 });
        expect(zahl("mahlstrom")).toMatchObject({ label: "Mahlstrom", count: 1 });
        expect(zahl("meeresstroemung")).toMatchObject({ label: "Meeresströmung", count: 1 });
        // Die Landmarke Strudel zählt weiter nur Landmarken.
        expect(zahl("strudel")).toMatchObject({ count: 0 });
    });
});
