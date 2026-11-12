import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pathChainKey, type SubjectDetail, type SubjectFact } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase } from "../src/database.ts";
import { rechneSprachTreffer } from "../src/jobs/sprachen-treffer-job.ts";
import { feldVerweise, hauptHuelle, wikiLinksVon } from "../src/subjects/detail-sprache.ts";
import { spracheAdresse } from "../src/wiki/abgleich/sprachen.ts";
import { wikiSchluesselFuerTitel } from "../src/wiki/schluessel.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Infobox einer Sprache und die Zeile „Sprachen“ der übrigen Infoboxen (WI-0261 S5b) gegen echtes PostGIS: Wegwerf-Cluster mit allen Rollen, die Treffer
 * gerechnet als Jobs-Rolle (S4), gelesen über die Routen der App. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Die Felder kommen aus einem anderen als dem ERSTEN Artikel; eine Sprache ohne Wiki-Zuordnung fehlt oder trägt erfundene Felder; ein zugeordneter
 * Artikel oder eine Vorstufe gilt als Dialekt, ein Artikel einer fremden Familie auch; der Mindestanteil wirkt nicht (oder auf Orte); ein verborgener Ort steht
 * in der Liste; ein namenloser Weg steht in der Liste oder fehlt in der Zahl; gleichnamige Regionen zählen doppelt, eine Vegetation zählt als „Region“; das
 * Kameraziel springt auf eine ferne Insel; die Zeile „Sprachen“ einer Landschaft oder eines Wegs aus mehreren Teilen nimmt den Anteil des größten Teils statt des
 * gewichteten; die Antwort verletzt das Schema der Route.
 *
 * Die kleine Welt (Karteneinheiten): Sprache A deckt 300–400 × 300–400 und eine kleine Insel bei 600/600, Sprache B (von der Redaktion, ohne Wiki) 400–500 ×
 * 300–400.
 */

const ENV = "sprinfobox";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `77777785-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ORT = { a: ID(1), b: ID(2), verborgen: ID(3), metropole: ID(4), abseits: ID(5) };
const GEBIET = { baronie: ID(0x10), grafschaft: ID(0x11) };
const REGION = { gegend: ID(0x20), gegendFern: ID(0x21), wald: ID(0x22) };
const WEG = { a: ID(0x30), b: ID(0x31), namenlos: ID(0x32) };
const QUELLE = "e0619e909dcc".padEnd(64, "0");

const quadrat = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

const feld = (detail: SubjectDetail, field: SubjectFact["field"]): SubjectFact | undefined =>
    detail.facts?.find((fact) => fact.field === field);

describe("Kameraziel und Wiki-Links der Sprach-Infobox (rein)", () => {
    it("die Hülle trägt die größten Teile bis 85 % der Fläche, eine ferne Insel zieht sie nicht weg", () => {
        expect(
            hauptHuelle([
                { flaeche: 100, bbox: [600, 600, 610, 610] },
                { flaeche: 10_000, bbox: [300, 300, 400, 400] },
            ]),
        ).toEqual([300, 300, 400, 400]);
        // Zwei gleich große Teile: Erst beide zusammen tragen 85 %.
        expect(
            hauptHuelle([
                { flaeche: 50, bbox: [0, 0, 10, 10] },
                { flaeche: 50, bbox: [20, 20, 30, 30] },
            ]),
        ).toEqual([0, 0, 30, 30]);
        expect(hauptHuelle([])).toBeNull();
    });

    it("liest Ziel und Text der Wiki-Links eines rohen Felds", () => {
        expect(
            wikiLinksVon("[[Mittelreich|Neues Reich]], [[Horasreich]] und [[Bornland#Norden|Norden]] sowie Text"),
        ).toEqual([
            { ziel: "Mittelreich", text: "Neues Reich" },
            { ziel: "Horasreich", text: "Horasreich" },
            { ziel: "Bornland", text: "Norden" },
        ]);
    });

    it("verlinkt im bereinigten Feld nur, was über den Wiki-Key genau EIN Objekt trägt; die Stelle zählt im bereinigten Text", () => {
        const baronie = { kind: "territory" as const, id: GEBIET.baronie };
        const index = {
            wikiKeys: {
                byKey: new Map([
                    [wikiSchluesselFuerTitel("S5b Baronie"), [{ kind: "territory" as const, ref: baronie }]],
                    [
                        wikiSchluesselFuerTitel("Doppelt"),
                        [
                            { kind: "territory" as const, ref: baronie },
                            { kind: "territory" as const, ref: { kind: "territory" as const, id: GEBIET.grafschaft } },
                        ],
                    ],
                ]),
                pageKeys: new Map<string, string>(),
            },
        };
        expect(
            feldVerweise(index, "Fremdland, S5b Baronie, Doppelt", "[[Fremdland]], [[S5b Baronie]], [[Doppelt]]"),
        ).toEqual([{ text: "S5b Baronie", ref: baronie, at: 11 }]);
        expect(feldVerweise(index, "S5b Baronie", null)).toEqual([]);
    });
});

describeWithCluster(
    "Infobox einer Sprache und Zeile „Sprachen“ (WI-0261 S5b, Wegwerf-Cluster)",
    { timeout: 300_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let app: FastifyInstance | undefined;
        const sprache = { a: "", b: "" };

        const db = (): VpsCluster => cluster!;
        const hole = async (url: string): Promise<SubjectDetail> => {
            const antwort = await app!.inject({ url });
            expect(antwort.statusCode, `${url}: ${antwort.body}`).toBe(200);
            return antwort.json<SubjectDetail>();
        };

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const m = cluster.migrator;
            const punkt = (x: number, y: number) => m`ST_SetSRID(ST_MakePoint(${x}, ${y}), 0)`;
            await m`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
            VALUES (${ORT.a}, 'aventuria', 'S5b Alphadorf', 'dorf', ${punkt(350, 350)}, 'test', TRUE, FALSE),
                   (${ORT.b}, 'aventuria', 'S5b Betadorf', 'dorf', ${punkt(450, 350)}, 'test', TRUE, FALSE),
                   (${ORT.verborgen}, 'aventuria', 'S5b Versteck', 'dorf', ${punkt(360, 360)}, 'test', TRUE, TRUE),
                   (${ORT.metropole}, 'aventuria', 'S5b Zentrum', 'metropole', ${punkt(330, 330)}, 'test', TRUE, FALSE),
                   (${ORT.abseits}, 'aventuria', 'S5b Abseits', 'dorf', ${punkt(800, 800)}, 'test', TRUE, FALSE)
        `;
            // Die Baronie liegt je zur Hälfte in A und B; die Grafschaft streift A nur zu 2 % (unter dem Mindestanteil von 5 %).
            for (const [id, name, wkt] of [
                [GEBIET.baronie, "S5b Baronie", quadrat(300, 300, 500, 350)],
                [GEBIET.grafschaft, "S5b Grafschaft", quadrat(398, 350, 498, 360)],
            ] as const) {
                const [gebiet] = await m<{ id: string }[]>`
                INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
                VALUES (${id}, 'aventuria', ${name}, '#336699', 0.5, 'test') RETURNING id::text
            `;
                await m`
                INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system)
                VALUES (gen_random_uuid(), ${gebiet!.id}, 'aventuria', ST_GeomFromText(${wkt}, 0), 'test')
            `;
            }
            // Die Amtssprache des Artikels verlinkt die Baronie über ihren Wiki-Key (Zuordnung X2), nie über den Namen.
            await m`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key)
            VALUES ('gebiet', ${GEBIET.baronie}, ${wikiSchluesselFuerTitel("S5b Baronie")})
        `;
            const region = async (id: string, name: string, layer: string, typ: string, wkt: string): Promise<void> => {
                const [zeile] = await m<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                VALUES (${id}, 'aventuria', ${name}, ${layer}, ${typ}, TRUE) RETURNING id::text
            `;
                await m`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (gen_random_uuid(), 'aventuria', ${zeile!.id}, ST_GeomFromText(${wkt}, 0), TRUE)
            `;
            };
            // Zwei gleichnamige Regionen sind EINE Landschaft (WI-0047): 10 000 E² ganz in A, 2 500 E² ohne Sprache → A trägt 80 % der Landschaft.
            await region(REGION.gegend, "S5b Gegend", "derographisch", "region", quadrat(300, 300, 400, 400));
            await region(REGION.gegendFern, "S5b Gegend", "derographisch", "region", quadrat(600, 300, 650, 350));
            // Ein Wald zählt für seine eigene Zeile, aber nicht als „Region“ der Sprache.
            await region(REGION.wald, "S5b Wald", "vegetation", "wald", quadrat(380, 300, 480, 400));
            await m`
            INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${WEG.a}, 'aventuria', 'S5b Straße', 'Strasse', ST_GeomFromText('LINESTRING(310 390,390 390)', 0), 'test', TRUE),
                   (${WEG.b}, 'aventuria', 'S5b Straße', 'Strasse', ST_GeomFromText('LINESTRING(410 390,490 390)', 0), 'test', TRUE),
                   (${WEG.namenlos}, 'aventuria', '', 'Pfad', ST_GeomFromText('LINESTRING(320 320,330 320)', 0), 'test', TRUE)
        `;

            // Die Sprachen: A (Karte) mit großer Fläche und kleiner ferner Insel, B (Redaktion) daneben.
            for (const [k, schluessel, name, farbe, herkunft] of [
                ["a", "s5btest-alpha", "S5b Alpha", "#aa0000", "sprachenkarte"],
                ["b", "s5btest-beta", "S5b Beta", "#00aa00", "redaktion"],
            ] as const) {
                const [zeile] = await m<{ id: string }[]>`
                INSERT INTO sprache (schluessel, name, farbe, reihenfolge, herkunft)
                VALUES (${schluessel}, ${name}, ${farbe}, 1, ${herkunft}) RETURNING public_id::text AS id
            `;
                sprache[k] = zeile!.id;
            }
            const flaeche = async (schluessel: string, wkt: string, herkunft: string): Promise<void> => {
                await m`
                INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft, quelle_revision)
                VALUES (gen_random_uuid(), (SELECT id FROM sprache WHERE schluessel = ${schluessel}), 'aventuria', ST_GeomFromText(${wkt}, 0), ${herkunft},
                        ${herkunft === "sprachenkarte" ? QUELLE : null})
            `;
            };
            await flaeche("s5btest-alpha", quadrat(300, 300, 400, 400), "sprachenkarte");
            await flaeche("s5btest-alpha", quadrat(600, 600, 610, 610), "sprachenkarte");
            await flaeche("s5btest-beta", quadrat(400, 300, 500, 400), "redaktion");

            // Die Wiki-Artikel: A trägt „S5b Alpha“ (Stelle 0) und „S5b Alphisch“ (Stelle 1). Unzugeordnet in derselben Familie: eine Mundart (Dialekt) und die
            // Vorstufe; in einer fremden Familie ein weiterer Artikel.
            const artikel = async (
                titel: string,
                felder: Record<string, string | string[] | null>,
            ): Promise<string> => {
                const [zeile] = await m<{ id: string }[]>`
                INSERT INTO wiki_sprache_artikel (schluessel, titel, name, sprachfamilie, vorstufen, schrift, sprecheranzahl, offizielle_sprache,
                                                  offizielle_sprache_roh, weitere_verbreitung, kurzbeschreibung, navigation, unbekannt)
                VALUES (${titel.toLowerCase()}, ${titel}, ${titel}, ${felder["familie"] ?? null}, ${felder["vorstufen"] ?? null},
                        ${felder["schrift"] ?? null}, ${felder["sprecher"] ?? null}, ${felder["amt"] ?? null}, ${felder["amtRoh"] ?? null},
                        ${felder["verbreitung"] ?? null}, ${felder["kurz"] ?? null}, ${(felder["navigation"] as string[] | undefined) ?? []}::text[],
                        '{}'::text[])
                RETURNING id::text
            `;
                return zeile!.id;
            };
            const familie = ["Nav Sprachfamilie Alpha"];
            const erster = await artikel("S5b Alpha", {
                familie: "Sprachfamilie Alpha",
                vorstufen: "S5b Uralpha",
                schrift: "Alphazeichen",
                sprecher: "Viele",
                amt: "S5b Baronie, Fremdland",
                amtRoh: "[[S5b Baronie]], [[Fremdland]]",
                verbreitung: "Überall im Testland",
                kurz: "Alpha ist die Sprache der Probe.",
                navigation: familie,
            });
            const zweiter = await artikel("S5b Alphisch", {
                familie: "Falsche Familie",
                kurz: "Nicht der erste.",
                navigation: familie,
            });
            await artikel("S5b Mundart", { navigation: familie });
            await artikel("S5b Uralpha", { navigation: familie });
            await artikel("S5b Fremd", { navigation: ["Nav Sprachfamilie Fremd"] });
            await m`
            INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
            VALUES ((SELECT id FROM sprache WHERE schluessel = 's5btest-alpha'), ${erster}::bigint, 0, 'import'),
                   ((SELECT id FROM sprache WHERE schluessel = 's5btest-alpha'), ${zweiter}::bigint, 1, 'import')
        `;

            expect(await rechneSprachTreffer(cluster.jobs, "aventuria", { alle: true })).toMatchObject({
                status: "gerechnet",
            });

            const o = cluster.app.options as unknown as {
                host: string[];
                port: number[];
                user: string;
                database: string;
            };
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

        it("die Infobox mit Wiki-Zuordnung: Kopf, Felder des ERSTEN Artikels, Dialekte, Wikizeile, Kameraziel, Quellen", async () => {
            const detail = await hole(`/api/subjects/sprache/${sprache.a}`);
            expect(detail.subject).toEqual({ kind: "sprache", id: sprache.a });
            expect(detail.title).toBe("S5b Alpha");
            // Zwei Artikel: eine Sprachgruppe (O1); die Familie des ersten.
            expect(detail.subtitle).toEqual([
                { part: "type", key: "sprachgruppe" },
                { part: "kind", text: "Sprachfamilie Alpha" },
            ]);
            expect(detail.facts?.map((fact) => fact.field)).toEqual([
                "description",
                "sprachfamilie",
                "vorstufen",
                "schrift",
                "dialekte",
                "sprecheranzahl",
                "amtssprache",
                "weitereVerbreitung",
            ]);
            expect(feld(detail, "description")).toMatchObject({
                value: "Alpha ist die Sprache der Probe.",
                provenance: { kind: "wiki", wikiUrl: spracheAdresse("S5b Alpha") },
            });
            // Dialekte: dieselbe Familie, keiner Sprache zugeordnet, nicht die Vorstufe, nicht die fremde Familie.
            expect(feld(detail, "dialekte")).toMatchObject({ values: ["S5b Mundart"] });
            // Die Amtssprache bleibt Text, solange die Baronie keine abgeleitete Form hat (ohne Form kein Ziel, `wiki-key-lookup.ts`); die Verweise prüft der reine
            // Fall oben.
            expect(feld(detail, "amtssprache")).toMatchObject({ value: "S5b Baronie, Fremdland" });
            expect(feld(detail, "amtssprache")).not.toHaveProperty("links");
            expect(detail.wiki?.url).toBe(spracheAdresse("S5b Alpha"));
            // Die ferne Insel (1 % der Fläche) zieht die Kamera nicht weg.
            expect(detail.target?.bounds).toEqual([300, 300, 400, 400]);
            expect(detail.sprache).toMatchObject({
                schluessel: "s5btest-alpha",
                farbe: "#aa0000",
                artikel: [
                    { titel: "S5b Alpha", url: spracheAdresse("S5b Alpha") },
                    { titel: "S5b Alphisch", url: spracheAdresse("S5b Alphisch") },
                ],
                gegenden: 2,
                herkunft: ["sprachenkarte"],
            });
        });

        it("die Treffer ab dem Mindestanteil: Gebiete, Regionen der Derographie als Landschaft, sichtbare Orte, Wege als Straße", async () => {
            const treffer = (await hole(`/api/subjects/sprache/${sprache.a}`)).sprache?.treffer ?? [];
            expect(treffer.map((liste) => [liste.art, liste.anzahl])).toEqual([
                ["territory", 1],
                ["region", 1],
                ["place", 2],
                ["path", 2],
            ]);
            const [gebiete, regionen, orte, wege] = treffer;
            expect(gebiete?.eintraege).toEqual([
                { ref: { kind: "territory", id: GEBIET.baronie }, name: "S5b Baronie", anteil: 0.5 },
            ]);
            // Die beiden gleichnamigen Regionen sind EINE Landschaft; der Wald ist keine „Region“.
            expect(regionen?.eintraege).toEqual([
                {
                    ref: { kind: "area", id: REGION.gegend, group: [REGION.gegendFern] },
                    name: "S5b Gegend",
                    anteil: 1,
                },
            ]);
            // Die Metropole vor dem Dorf (Klassenordnung der Suche); der verborgene Ort fehlt.
            expect(orte?.eintraege.map((ort) => ort.name)).toEqual(["S5b Zentrum", "S5b Alphadorf"]);
            // Der namenlose Abschnitt zählt, steht aber nicht in der Liste.
            expect(wege?.eintraege).toEqual([
                { ref: { kind: "path", chain: pathChainKey("S5b Straße") }, name: "S5b Straße" },
            ]);

            // Bei 0 % zählt jede Berührung: auch die Grafschaft (2 %).
            await db().admin`
            INSERT INTO map_setting (key, value, changed_at, changed_by_label) VALUES ('sprachenMindestanteil', '0'::jsonb, now(), 'test')
        `;
            try {
                const alle = (await hole(`/api/subjects/sprache/${sprache.a}`)).sprache?.treffer ?? [];
                expect(alle.find((liste) => liste.art === "territory")?.anzahl).toBe(2);
            } finally {
                await db().admin`DELETE FROM map_setting WHERE key = 'sprachenMindestanteil'`;
            }
        });

        it("die Infobox ohne Wiki-Zuordnung: nur Name, Fläche und Treffer", async () => {
            const detail = await hole(`/api/subjects/sprache/${sprache.b}`);
            expect(detail.title).toBe("S5b Beta");
            expect(detail.subtitle).toEqual([{ part: "type", key: "sprache" }]);
            expect(detail.facts).toBeUndefined();
            expect(detail.wiki).toBeUndefined();
            expect(detail.sprache).toMatchObject({ artikel: [], gegenden: 1, herkunft: ["redaktion"] });
            // B berührt die Gegend nur an ihrer Kante (kein Anteil) und deckt den Wald, der keine „Region“ ist: keine Zeile „Regionen“.
            expect(detail.sprache?.treffer.map((liste) => liste.art)).toEqual(["territory", "place", "path"]);
        });

        it("eine unbekannte oder stillgelegte Sprache ist 404", async () => {
            expect((await app!.inject({ url: `/api/subjects/sprache/${ID(0x99)}` })).statusCode).toBe(404);
            await db().migrator`
            UPDATE sprache SET is_active = FALSE, state = 'retired', retired_at = now(), retired_origin = 'editor' WHERE public_id = ${sprache.b}::uuid
        `;
            try {
                expect((await app!.inject({ url: `/api/subjects/sprache/${sprache.b}` })).statusCode).toBe(404);
            } finally {
                await db().migrator`
                UPDATE sprache SET is_active = TRUE, state = 'active', retired_at = NULL, retired_origin = NULL WHERE public_id = ${sprache.b}::uuid
            `;
            }
        });

        it("🔴 die Zeile „Sprachen“ an Ort, Gebiet, Landschaft und Weg: verlinkt, mit Farbe, der gewichtete Anteil der Gruppe", async () => {
            const ort = await hole(`/api/subjects/place/${ORT.a}`);
            expect(ort.sprachen).toEqual([
                { ref: { kind: "sprache", id: sprache.a }, name: "S5b Alpha", farbe: "#aa0000", anteil: 1 },
            ]);
            const gebiet = await hole(`/api/subjects/territory/${GEBIET.baronie}`);
            expect(gebiet.sprachen?.map((zeile) => [zeile.name, zeile.anteil])).toEqual([
                ["S5b Alpha", 0.5],
                ["S5b Beta", 0.5],
            ]);
            // Die Grafschaft liegt zu 98 % in B; A (2 %) liegt unter dem Mindestanteil.
            expect(
                (await hole(`/api/subjects/territory/${GEBIET.grafschaft}`)).sprachen?.map((zeile) => zeile.name),
            ).toEqual(["S5b Beta"]);
            // Die Landschaft aus zwei Regionen: 10 000 von 12 500 E² in A.
            const landschaft = await hole(`/api/subjects/area/${REGION.gegend}`);
            expect(landschaft.sprachen).toHaveLength(1);
            expect(landschaft.sprachen?.[0]?.anteil).toBeCloseTo(0.8, 6);
            // Die Straße aus zwei gleich langen Abschnitten, je einer in A und B.
            const weg = await hole(`/api/subjects/path/${encodeURIComponent(pathChainKey("S5b Straße"))}`);
            expect(weg.sprachen?.map((zeile) => [zeile.name, Number(zeile.anteil.toFixed(6))])).toEqual([
                ["S5b Alpha", 0.5],
                ["S5b Beta", 0.5],
            ]);
            // Ohne Treffer fehlt das Feld (die Zeile entfällt).
            expect((await hole(`/api/subjects/place/${ORT.abseits}`)).sprachen).toBeUndefined();
        });
    },
);
