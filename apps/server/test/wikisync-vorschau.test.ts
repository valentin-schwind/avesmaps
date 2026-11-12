import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIKISYNC_BERICHT_URL, wikiNamespaceTafel, type WikisyncBericht } from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { Database } from "../src/database.ts";
import { JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { raeumeAb, schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { WIKISYNC_PARSER_VERSION } from "../src/wiki/abgleich/plan.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { baueDump, neuerOrdner, type FixtureSeite } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Vorschau des WikiSync (WI-0253 C) gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS (Muster `zoombaender.test.ts`): der Auftrag
 * `wiki_vorschau` als Jobs-Rolle, die Läufe in `wikisync_lauf` / `wikisync_lauf_zeile`, der Bericht als App-Rolle.
 *
 * - **Soll:** Der Auftrag liest die Zuordnungen und Felder von Ort, Weg, Landschaft, Gebiet, Kraftlinie und Gipfel, rechnet den Plan und legt EINEN Lauf mit
 *   gepinntem Dump (Datei, SHA-256, Stand) und Tafel-Revision ab; der Bericht liefert ihn gefiltert; die Route verlangt das Recht ab `tester`.
 * - **🔴 Die Vorschau schreibt keine Fachtafel:** ein Hash über jede Tafel außer den Läufen und der Warteschlange ist vor und nach den Läufen gleich.
 * - **Idempotenz:** derselbe Dump zweimal ergibt dieselben Zeilen; es stehen je Bereich höchstens zwei fertige Läufe da.
 * - **Rechte:** die App-Rolle liest nur, die Jobs-Rolle schreibt die zwei Tafeln und sonst keine; ein Fehlschlag wird als Lauf sichtbar, ein abgeschnittener
 *   Dump rechnet nichts.
 */

const ENV = "wikisync";
const grants = [fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url))];
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0253-c-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    auth: TEST_AUTH,
};

const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

const DUMP: FixtureSeite[] = [
    {
        titel: "Gareth",
        ns: 0,
        text: "{{Infobox Siedlung\n|Name=Gareth\n|Einwohner=ca. 7.400\n|Herrscher=Kaiserin Rohaja\n|Region=[[Garetien]]\n|Staat=[[Mittelreich]]\n|Handelszone=[[Mittelreich]]\n}}\nDie Stadt Gareth.",
    },
    { titel: "Havena", ns: 0, text: "{{Infobox Siedlung\n|Name=Havena\n|Einwohner=5.000\n}}\nHavena." },
    { titel: "Nostria (Stadt)", ns: 0, text: "{{Infobox Siedlung\n|Name=Nostria\n}}\nNostria." },
    {
        titel: "Reichsstraße 1",
        ns: 0,
        text: "{{Infobox Straße\n|Name=Reichsstraße 1\n|Art=Reichsstraße\n|Länge=400 Meilen\n|Verlauf=\n{{Straße|[[Gareth]]}}\n{{Straße|[[Angbar]]}}\n}}\nDie Reichsstraße.",
    },
    {
        titel: "Weidener Linie",
        ns: 0,
        text: "{{Infobox Kraftlinie\n|Name=Weidener Linie\n|Stärke=regional\n}}\nEine Linie.",
    },
    {
        titel: "Koschberge",
        ns: 0,
        text: "{{Infobox Region\n|Name=Koschberge\n|Art=Gebirge\n|Region=Kosch\n|Nord=[[Ferdok]]\n}}\nDie Koschberge.",
    },
    { titel: "Gipfelberg", ns: 0, text: "{{Infobox Region\n|Name=Gipfelberg\n|Art=Berg\n}}\nEin Berg." },
    {
        titel: "Herzogtum Weiden",
        ns: 0,
        text: "{{Infobox Staat\n|Name=Herzogtum Weiden\n|Staat=[[Mittelreich]]\n|Hauptstadt=[[Weiden]]\n|Oberhaupt=Herzog\n|Gründungsdatum={{BF|1000}}\n}}\nWeiden.",
    },
    { titel: "Reichsstadt Gareth", ns: 0, weiterleitung: "Gareth" },
    { titel: "Wengenholm", ns: 0, text: "{{Infobox Siedlung\n|Name=Wengenholm\n}}\nWengenholm." },
    { titel: "Bekannter Ort", ns: 0, text: "{{Infobox Siedlung\n|Name=Bekannter Ort\n}}\nDie Registry kennt ihn." },
];

const ID = {
    gareth: "a0000000-0000-4000-8000-000000000001",
    nostria: "a0000000-0000-4000-8000-000000000002",
    havena: "a0000000-0000-4000-8000-000000000003",
    eigenkennung: "a0000000-0000-4000-8000-000000000004",
    selem: "a0000000-0000-4000-8000-000000000005",
    weg1: "b0000000-0000-4000-8000-000000000001",
    weg2: "b0000000-0000-4000-8000-000000000002",
    weg3: "b0000000-0000-4000-8000-000000000003",
    linie: "c0000000-0000-4000-8000-000000000001",
    landschaft: "d0000000-0000-4000-8000-000000000001",
    gebiet: "e0000000-0000-4000-8000-000000000001",
    gipfel: "f0000000-0000-4000-8000-000000000001",
};

/** Eine kleine Welt in der Ecke der Karte (x 100 bis 190, y 100 bis 200), mit Zuordnungen, Schnappschüssen und Herkunft. */
async function legeWeltAn(db: Database): Promise<void> {
    await db`
        INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_name, description, einwohner, oberhaupt, region_text, staat_text, handelszone)
        VALUES ('gareth', ${wiki("Gareth")}, 'Gareth', 'Die Stadt Gareth.', 'ca. 7.200', 'Kaiser Hal', 'Garetien', 'Reich', NULL),
               ('havena', ${wiki("Havena")}, 'Havena', NULL, NULL, NULL, NULL, NULL, NULL)
    `;
    await db`
        INSERT INTO place (public_id, map_domain_id, name, subtype, geom)
        VALUES (${ID.gareth}, 'aventuria', 'Gareth', 'metropole', ST_SetSRID(ST_MakePoint(120, 120), 0)),
               (${ID.nostria}, 'aventuria', 'Nostria', 'stadt', ST_SetSRID(ST_MakePoint(121, 120), 0)),
               (${ID.havena}, 'aventuria', 'Havena', 'stadt', ST_SetSRID(ST_MakePoint(122, 120), 0)),
               (${ID.eigenkennung}, 'aventuria', 'Eigener Ort', 'dorf', ST_SetSRID(ST_MakePoint(123, 120), 0)),
               (${ID.selem}, 'aventuria', 'Selem', 'dorf', ST_SetSRID(ST_MakePoint(124, 120), 0))
    `;
    await db`
        INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
        SELECT p.id, ${wiki("Gareth")}, (SELECT id FROM wiki_settlement_snapshot WHERE wiki_key = 'gareth'), 'assigned', 'legacy_editor'
          FROM place p WHERE p.public_id = ${ID.gareth}
        UNION ALL SELECT p.id, NULL, NULL, 'suppressed', 'editor' FROM place p WHERE p.public_id = ${ID.nostria}
        UNION ALL SELECT p.id, ${wiki("Havena")}, NULL, 'address_only', 'unknown' FROM place p WHERE p.public_id = ${ID.havena}
        UNION ALL SELECT p.id, ${wiki("Selem")}, NULL, 'address_only', 'unknown' FROM place p WHERE p.public_id = ${ID.selem}
    `;
    await db`
        INSERT INTO place_detail (place_id, einwohner, einwohner_origin, oberhaupt, oberhaupt_origin, lage)
        SELECT p.id, 'ca. 7.200', 'wiki', 'Kaiser Hal', 'manual', 'Garetien' FROM place p WHERE p.public_id = ${ID.gareth}
    `;
    // Die Zuordnungstafel X2: Nostria trug eine Adresse, bevor die Redaktion die Zuordnung unterdrückte; „Eigener Ort“ hat nur einen eigenen Schlüssel.
    await db`
        INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns)
        VALUES ('siedlung', ${ID.nostria}, 'wiki:nostria-stadt', ${wiki("Nostria (Stadt)")}, 'Nostria (Stadt)', 0),
               ('siedlung', ${ID.eigenkennung}, 'wiki:eigener-ort', NULL, NULL, NULL)
    `;
    await db`
        INSERT INTO wiki_settlement_registry (wiki_key, title, ns, wiki_url, settlement_class)
        VALUES ('wiki:bekannter-ort', 'Bekannter Ort', 0, ${wiki("Bekannter Ort")}, 'dorf')
    `;

    // Wege: drei Abschnitte, ein Artikel
    await db`
        INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art, lage, verlauf, laenge)
        VALUES ('reichsstrasse-1', ${wiki("Reichsstraße 1")}, 'Reichsstraße 1', 'strasse', 'Reichsstraße', NULL, 'Gareth', '400 Meilen')
    `;
    await db`
        INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system)
        VALUES (${ID.weg1}, 'aventuria', 'Reichsstr. 1', 'Reichsstrasse', ST_SetSRID(ST_GeomFromText('LINESTRING(110 110, 111 111)'), 0), 'legacy'),
               (${ID.weg2}, 'aventuria', 'Reichsstr. 1', 'Reichsstrasse', ST_SetSRID(ST_GeomFromText('LINESTRING(111 111, 112 112)'), 0), 'legacy'),
               (${ID.weg3}, 'aventuria', 'Reichsstraße 1', 'Reichsstrasse', ST_SetSRID(ST_GeomFromText('LINESTRING(112 112, 113 113)'), 0), 'legacy')
    `;
    await db`
        INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
        SELECT p.id, 'main', ${wiki("Reichsstraße 1")}, (SELECT id FROM wiki_path_snapshot WHERE wiki_key = 'reichsstrasse-1'), 'assigned', 'legacy_editor'
          FROM path p WHERE p.public_id IN (${ID.weg1}, ${ID.weg2}, ${ID.weg3})
    `;

    // Kraftlinie: getrennt
    await db`
        INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system)
        VALUES (${ID.linie}, 'aventuria', 'Weidener Linie', ${randomUUID()}, ${randomUUID()},
                ST_SetSRID(ST_GeomFromText('LINESTRING(130 130, 131 131)'), 0), ST_SetSRID(ST_GeomFromText('LINESTRING(130 130, 131 131)'), 0), 'legacy')
    `;
    await db`
        INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
        SELECT id, NULL, NULL, 'separated', 'editor' FROM powerline WHERE public_id = ${ID.linie}
    `;
    await db`
        INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns)
        VALUES ('kraftlinie', ${ID.linie}, 'wiki:weidener-linie', ${wiki("Weidener Linie")}, 'Weidener Linie', 0)
    `;

    // Landschaft mit Schnappschuss und Nachbarn
    await db`
        INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, art, region_parent, affiliation_staat)
        VALUES ('koschberge', ${wiki("Koschberge")}, 'Koschberge', 'Gebirge|Hügel', 'Kosch', NULL)
    `;
    await db`
        INSERT INTO wiki_region_snapshot_neighbor (snapshot_id, direction, position, name)
        SELECT id, 'N', 0, 'Ferdok' FROM wiki_region_snapshot WHERE wiki_key = 'koschberge'
    `;
    await db`
        INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, wiki_url, wiki_region_key)
        VALUES (${ID.landschaft}, 'aventuria', 'Koschberge', 'derographisch', 'gebirge', ${wiki("Koschberge")}, 'koschberge')
    `;

    // Gipfel
    await db`
        INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom)
        VALUES (${ID.gipfel}, 'aventuria', 'Gipfelberg', 'berggipfel', ST_SetSRID(ST_MakePoint(140, 140), 0))
    `;
    await db`
        INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
        SELECT id, ${wiki("Gipfelberg")}, NULL, 'address_only', 'unknown' FROM terrain_peak WHERE public_id = ${ID.gipfel}
    `;

    // Gebiet: Detail mit Vermerken, Schnappschuss mit einem unbekannten Feld
    await db`
        INSERT INTO territory (public_id, map_domain_id, name, color, opacity, wiki_key, wiki_url)
        VALUES (${ID.gebiet}, 'aventuria', 'Herzogtum Weiden', '#336699', 0.7, 'wiki:herzogtum-weiden', ${wiki("Herzogtum Weiden")})
    `;
    await db`
        INSERT INTO territory_detail (territory_id, capital_name, ruler, form_of_government)
        SELECT id, 'Weidener Hauptstadt', 'Herzogin', 'Erbmonarchie' FROM territory WHERE public_id = ${ID.gebiet}
    `;
    await db`
        INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
        SELECT d.id, f.field, f.origin
          FROM territory_detail d
          JOIN territory t ON t.id = d.territory_id AND t.public_id = ${ID.gebiet}
         CROSS JOIN (VALUES ('capital_name', 'override'), ('ruler', 'wiki')) AS f(field, origin)
    `;
    await db`
        INSERT INTO wiki_territory_snapshot (wiki_key, ruler, founded_text, dissolved_text)
        VALUES ('wiki:herzogtum-weiden', 'Herzogin', '1000 BF', 'besteht')
    `;
    await db`
        INSERT INTO wiki_territory_snapshot_unknown (snapshot_id, field)
        SELECT id, 'capital_name' FROM wiki_territory_snapshot WHERE wiki_key = 'wiki:herzogtum-weiden'
    `;
}

/** Ein Abdruck jeder Tafel in `public` außer den Läufen und der Warteschlange: Die Vorschau darf keine ändern. */
async function fachtafelHash(db: Database): Promise<Record<string, string>> {
    const tafeln = await db<{ name: string }[]>`
        SELECT tablename AS name FROM pg_tables
         WHERE schemaname = 'public' AND tablename NOT LIKE 'wikisync\_%' AND tablename NOT LIKE 'job%' AND tablename <> 'spatial_ref_sys'
         ORDER BY tablename
    `;
    const hashes: Record<string, string> = {};
    for (const { name } of tafeln) {
        const [zeile] = await db.unsafe<{ h: string }[]>(
            `SELECT coalesce(md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))), '-') AS h FROM public."${name}" t`,
        );
        hashes[name] = zeile?.h ?? "?";
    }
    return hashes;
}

/** Eine Zeile ohne ihre Nummer und die des Laufs: Die ändern sich mit jedem Lauf, der Inhalt nicht. */
function zeileOhneNummern(
    zeile: WikisyncBericht["zeilen"][number],
): Omit<WikisyncBericht["zeilen"][number], "id" | "laufId"> {
    const kopie: Partial<WikisyncBericht["zeilen"][number]> = { ...zeile };
    delete kopie.id;
    delete kopie.laufId;
    return kopie as Omit<WikisyncBericht["zeilen"][number], "id" | "laufId">;
}

function context(input: Record<string, unknown> = {}): JobContext & { phasen: string[] } {
    const phasen: string[] = [];
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: (name) => {
            phasen.push(name);
            return Promise.resolve();
        },
        checkpoint: () => undefined,
        phasen,
    };
}

describeWithCluster("WikiSync-Vorschau: Auftrag, Läufe und Bericht (Wegwerf-Cluster, Rollen wie auf dem VPS)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let umgebung: NodeJS.ProcessEnv;
    let ablage: VorschauAblage;
    const protokoll: string[] = [];
    let tester: { cookie: string };
    let editor: { cookie: string };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
        await seedMapDomains(cluster.migrator);
        await legeWeltAn(cluster.migrator);
        ordner = await neuerOrdner("wikisync-vorschau");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(DUMP));
        umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
        // Der Auftrag läuft als Jobs-Rolle: dieselbe Verbindung wie sein Worker.
        const jobs = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekte(jobs, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(jobs),
            ladeWikisyncBereiche: () => wikisyncBereiche(jobs),
            schreibe: (eingabe) => schreibeLauf(jobs, eingabe),
            schreibeFehllauf: (eingabe, fehler) => schreibeFehllauf(jobs, eingabe, fehler),
            ausloeser: () => Promise.resolve("jobs-cli"),
        };
        fixture = authFixture(cluster.admin);
        app = buildApp({
            config,
            database: cluster.app,
            logStream: { write: (zeile: string) => void protokoll.push(zeile) },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
        });
        await app.ready();
        const person = async (role: "tester" | "editor", name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "basic" });
            return { cookie };
        };
        tester = await person("tester", "Tessa");
        editor = await person("editor", "Edora");
    }, 240_000);
    afterAll(async () => {
        await app?.close();
        await ordner?.weg();
        await cluster?.stop();
    }, 60_000);

    const vorschau = (input: Record<string, unknown> = {}, ablageHier: VorschauAblage = ablage) =>
        runWikiVorschauJob(context(input), {
            environment: umgebung,
            ladeZuweisungen: () => ladeZuweisungen(cluster!.jobs),
            ladeTafel: async () => {
                const stand = await leseNamespaceTafel(cluster!.jobs);
                return {
                    revision: stand.revision,
                    quelle: stand.revision === null ? "vorgabe" : "datenbank",
                    namensraeume: stand.namensraeume,
                };
            },
            ablage: ablageHier,
        });
    const bericht = async (abfrage = "", cookie = tester.cookie): Promise<WikisyncBericht> => {
        const antwort = await app.inject({
            method: "GET",
            url: `${WIKISYNC_BERICHT_URL}${abfrage}`,
            headers: { cookie },
        });
        expect(antwort.statusCode, `${antwort.body} ${protokoll.slice(-2).join(" ")}`).toBe(200);
        return antwort.json<WikisyncBericht>();
    };

    it("🔴 ohne Lauf ist der Bericht leer, ohne Fehler", async () => {
        const leer = await bericht();
        expect(leer).toMatchObject({
            laeufe: [],
            gesamt: 0,
            zeilen: [],
            facetten: { wirkung: {}, eigentuemer: {}, status: {}, befund: {} },
        });
    });

    it("🔴 der Auftrag legt EINEN Lauf mit gepinntem Dump an und schreibt in keine Fachtafel", async () => {
        const vorher = await fachtafelHash(cluster!.admin);
        const kontext = context();
        const ergebnis = await runWikiVorschauJob(kontext, {
            environment: umgebung,
            ladeZuweisungen: () => ladeZuweisungen(cluster!.jobs),
            ladeTafel: async () => ({ revision: 7, quelle: "datenbank", namensraeume: wikiNamespaceTafel() }),
            ablage,
        });
        expect(kontext.phasen).toEqual(["zuweisungen", "kategorien", "dump", "vergleichen", "ablegen"]);
        expect(ergebnis["lauf"]).toMatchObject({
            id: expect.any(Number) as number,
            bereiche: [
                "ort",
                "weg",
                "gebiet",
                "region",
                "gipfel",
                "kraftlinie",
                "literatur",
                "quelle",
                "vorkommen",
                "sprachen",
            ],
        });
        expect(ergebnis["quelle"]).toMatchObject({
            datei: "dewa_dump_small_20261001.xml",
            seiten: DUMP.length,
            stand: { wert: "2026-10-01", quelle: "dateiname" },
        });

        const nachher = await fachtafelHash(cluster!.admin);
        expect(nachher).toEqual(vorher);
        expect(Object.keys(vorher).length).toBeGreaterThan(30);

        const laeufe = await cluster!.admin<
            {
                status: string;
                dump_datei: string;
                dump_sha256: string;
                tafel_revision: number | null;
                parser_version: string;
                ausgeloest_label: string | null;
            }[]
        >`SELECT status, dump_datei, dump_sha256, tafel_revision::int, parser_version, ausgeloest_label FROM wikisync_lauf`;
        expect(laeufe).toHaveLength(1);
        expect(laeufe[0]).toMatchObject({
            status: "fertig",
            dump_datei: "dewa_dump_small_20261001.xml",
            tafel_revision: 7,
            parser_version: WIKISYNC_PARSER_VERSION,
            ausgeloest_label: "jobs-cli",
        });
        expect(laeufe[0]?.dump_sha256).toMatch(/^[0-9a-f]{64}$/u);
    });

    it("der Bericht: die Felder mit Eigentümer und Wirkung, die Befunde zu den Artikeln, die Zahlen je Bereich – und kein Wikitext", async () => {
        const gesamt = await bericht("?limit=500");
        expect(gesamt.laeufe).toHaveLength(1);
        expect(gesamt.laeufe[0]).toMatchObject({
            status: "fertig",
            tafelRevision: 7,
            dump: { datei: "dewa_dump_small_20261001.xml", seiten: DUMP.length },
        });
        const zeile = (bereich: string, objektId: string | null, feld: string | null) =>
            gesamt.zeilen.find((z) => z.bereich === bereich && z.objektId === objektId && z.feld === feld);

        // Ort: wiki-eigen -> übernommen; manuell -> eigen; Feld nur im Schnappschuss -> wiki
        expect(zeile("ort", ID.gareth, "einwohner")).toMatchObject({
            alt: "ca. 7.200",
            neu: "ca. 7.400",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
        });
        expect(zeile("ort", ID.gareth, "oberhaupt")).toMatchObject({
            alt: "Kaiser Hal",
            neu: "Kaiserin Rohaja",
            eigentuemer: "manual",
            wirkung: "eigen",
        });
        expect(zeile("ort", ID.gareth, "staat_text")).toMatchObject({
            alt: "Reich",
            neu: "Mittelreich",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
        });
        // Befunde: unterdrückt (mit Adresse aus X2), nicht im Dump, ohne Schnappschuss alles neu
        expect(zeile("ort", ID.nostria, null)).toMatchObject({
            befund: "zuordnung_gesperrt",
            eigentuemer: "unterdrueckt",
            wirkung: "befund",
        });
        expect(zeile("ort", ID.selem, null)).toMatchObject({ befund: "artikel_nicht_im_dump", status: "zu_entfernen" });
        expect(zeile("ort", ID.havena, "einwohner")).toMatchObject({ alt: null, neu: "5.000", status: "neu" });
        // Weg: drei Abschnitte, zwei mit demselben Namen -> eine Zeile mit der Zahl; der Verlauf einmal je Artikel
        const wegName = gesamt.zeilen.filter((z) => z.bereich === "weg" && z.feld === "name");
        expect(wegName).toHaveLength(0); // Der Wiki-Name steht im Schnappschuss; er hat sich nicht bewegt, der abweichende eigene Name ist unbekannt -> keine Nachricht
        expect(gesamt.zeilen.filter((z) => z.bereich === "weg" && z.feld === "verlauf")).toMatchObject([
            { objekte: 3, alt: "Gareth", neu: "Gareth → Angbar" },
        ]);
        // Kraftlinie getrennt, Landschaft, Gipfel, Gebiet
        expect(zeile("kraftlinie", ID.linie, null)).toMatchObject({
            befund: "zuordnung_gesperrt",
            eigentuemer: "getrennt",
        });
        // Landschaft: Art (der Schnappschuss führt „Gebirge|Hügel“, gelesen wird die erste Komponente), Region und Nachbar im Norden stimmen; die Beschreibung fehlt noch.
        expect(zeile("region", ID.landschaft, "art")).toBeUndefined();
        expect(zeile("region", ID.landschaft, "region_parent")).toBeUndefined();
        expect(zeile("region", ID.landschaft, "nachbar_n")).toBeUndefined();
        expect(zeile("region", ID.landschaft, "description")).toMatchObject({
            alt: null,
            neu: "Die Koschberge.",
            status: "neu",
            eigentuemer: "wiki",
        });
        // Der Gipfel hängt nur mit einer Adresse am Artikel: Was er liest, ist ein Befund (kein Wiki-Stand), nie eine Übernahme.
        const gipfelZeilen = gesamt.zeilen.filter((z) => z.bereich === "gipfel" && z.objektArt === "peak");
        expect(gipfelZeilen.length).toBeGreaterThan(0);
        expect(gipfelZeilen.every((z) => z.wirkung === "befund")).toBe(true);
        // Seit WI-0271 (668e91c8d) ist der Bereich „Landmarken“ EIN Bereich: Die Kandidaten nur im Wiki (`landmarke_artikel`) stehen als Wiki-Stand daneben; auf die Karte
        // kommen sie allein durch einen Menschen („Auf der Karte setzen“), die Vorschau schreibt in keine Fachtafel.
        const kandidaten = gesamt.zeilen.filter((z) => z.bereich === "gipfel" && z.objektArt !== "peak");
        expect(kandidaten.every((z) => z.objektArt === "landmarke_artikel" && z.eigentuemer === "wiki")).toBe(true);
        expect(zeile("gebiet", ID.gebiet, "capital_name")).toMatchObject({
            alt: "Weidener Hauptstadt",
            neu: "Weiden",
            eigentuemer: "manual",
            wirkung: "eigen",
        });
        expect(zeile("gebiet", ID.gebiet, "ruler")).toMatchObject({
            alt: "Herzogin",
            neu: "Herzog",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
        });
        expect(zeile("gebiet", ID.gebiet, "form_of_government")).toBeUndefined();
        // Neue Artikel: nur die ohne Karte und ohne Registry, als Befund; angelegt wird nichts
        const neu = gesamt.zeilen.filter((z) => z.befund === "neuer_artikel").map((z) => [z.bereich, z.artikel]);
        expect(neu).toContainEqual(["ort", "Wengenholm"]);
        expect(neu).not.toContainEqual(["ort", "Bekannter Ort"]);
        expect(neu).not.toContainEqual(["ort", "Gareth"]);
        // Die Zahlen je Bereich
        const ort = gesamt.laeufe[0]?.zahlen["ort"];
        expect(ort).toMatchObject({
            objekte: 5,
            mitAdresse: 3,
            gefunden: 2,
            nichtImDump: 1,
            gesperrt: 1,
            kennungOhneWikiAdresse: 1,
        });
        expect(ort?.mitAdresse).toBe(
            (ort?.gefunden ?? 0) + (ort?.umgeleitet ?? 0) + (ort?.nichtImDump ?? 0) + (ort?.mehrdeutig ?? 0),
        );
        // 🔴 Kein Wikitext in keiner Zeile
        const text = JSON.stringify(gesamt.zeilen);
        // Der Name einer Infobox darf im Grund stehen („Infobox Siedlung“ bei einem neuen Artikel); Vorlagen, Links, Einzelnachweise und Parameter nie.
        expect(text).not.toMatch(/\{\{|\[\[|<ref|\|\s*Name\s*=/u);
    });

    it("die Filter: Bereich, Wirkung, Eigentümer, Befund und Freitext; die Zahl am Wert; die Seite", async () => {
        const uebernommen = await bericht("?wirkung=uebernommen&limit=500");
        expect(uebernommen.zeilen.length).toBeGreaterThan(2);
        expect(uebernommen.zeilen.every((z) => z.wirkung === "uebernommen")).toBe(true);
        expect(uebernommen.gesamt).toBe(uebernommen.zeilen.length);
        const gebiet = await bericht("?bereich=gebiet");
        expect(gebiet.zeilen.every((z) => z.bereich === "gebiet")).toBe(true);
        // Die Zahl am Wert ist nach Bereich eingeschränkt, nicht nach den anderen Filtern.
        expect(Object.values(gebiet.facetten.wirkung).reduce((a, b) => a + b, 0)).toBe(gebiet.gesamt);
        const gesperrt = await bericht("?befund=zuordnung_gesperrt");
        expect(gesperrt.zeilen.map((z) => z.eigentuemer).sort()).toEqual(["getrennt", "unterdrueckt"]);
        const eigen = await bericht("?eigentuemer=manual");
        expect(eigen.zeilen.every((z) => z.eigentuemer === "manual")).toBe(true);
        const suche = await bericht("?q=nostria");
        expect(suche.zeilen.map((z) => z.objektId)).toEqual([ID.nostria]);
        // Sonderzeichen sind Zeichen, kein Muster
        expect((await bericht("?q=%25")).gesamt).toBe(0);
        const seite = await bericht("?limit=2&offset=1");
        const alle = await bericht("?limit=500");
        expect(seite.zeilen.map((z) => z.id)).toEqual(alle.zeilen.slice(1, 3).map((z) => z.id));
        expect(seite.gesamt).toBe(alle.gesamt);
    });

    it("🔴 die Route verlangt das Recht ab Tester: ohne Anmeldung 401, mit Tester und Editor 200; eine ungültige Abfrage 400", async () => {
        const ohne = await app.inject({ method: "GET", url: WIKISYNC_BERICHT_URL });
        expect(ohne.statusCode).toBe(401);
        expect(ohne.json<{ error: { code: string } }>().error.code).toBe("unauthenticated");
        expect(
            (await app.inject({ method: "GET", url: WIKISYNC_BERICHT_URL, headers: { cookie: tester.cookie } }))
                .statusCode,
        ).toBe(200);
        expect(
            (await app.inject({ method: "GET", url: WIKISYNC_BERICHT_URL, headers: { cookie: editor.cookie } }))
                .statusCode,
        ).toBe(200);
        const kaputt = await app.inject({
            method: "GET",
            url: `${WIKISYNC_BERICHT_URL}?bereich=unbekannt`,
            headers: { cookie: tester.cookie },
        });
        expect(kaputt.statusCode).toBe(400);
        const zuviel = await app.inject({
            method: "GET",
            url: `${WIKISYNC_BERICHT_URL}?limit=501`,
            headers: { cookie: tester.cookie },
        });
        expect(zuviel.statusCode).toBe(400);
        // Es gibt in C keine Schreibroute zum WikiSync.
        const schreiben = await app.inject({
            method: "POST",
            url: WIKISYNC_BERICHT_URL,
            headers: { cookie: tester.cookie, origin: TEST_ORIGIN },
            payload: {},
        });
        expect(schreiben.statusCode).toBe(404);
    });

    it("🔴 Idempotenz: derselbe Dump noch einmal ergibt dieselben Zeilen, ältere Läufe fallen ab (höchstens zwei je Bereich), die Fachtafeln bleiben gleich", async () => {
        const vorher = await fachtafelHash(cluster!.admin);
        const erster = await bericht("?limit=500");
        await vorschau();
        await vorschau();
        await vorschau();
        const zweiter = await bericht("?limit=500");
        const ohneNummern = (b: WikisyncBericht) => JSON.stringify(b.zeilen.map(zeileOhneNummern));
        expect(ohneNummern(zweiter)).toBe(ohneNummern(erster));
        expect(zweiter.laeufe[0]!.id).toBeGreaterThan(erster.laeufe[0]!.id);
        const laeufe = await cluster!.admin<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM wikisync_lauf WHERE status = 'fertig'`;
        expect(laeufe[0]?.n).toBe(2);
        const zeilen = await cluster!.admin<
            { n: number }[]
        >`SELECT count(DISTINCT lauf_id)::int AS n FROM wikisync_lauf_zeile`;
        expect(zeilen[0]?.n).toBe(2);
        expect(await fachtafelHash(cluster!.admin)).toEqual(vorher);
    });

    it("ein Lauf nur für einzelne Bereiche ersetzt nur diese im Bericht; die anderen behalten ihren Lauf", async () => {
        const vorher = await bericht("?limit=500");
        await vorschau({ bereiche: ["gebiet"] });
        const nachher = await bericht("?limit=500");
        expect(nachher.laeufe.map((l) => l.bereiche).sort()).toEqual(
            [
                ["gebiet"],
                [
                    "ort",
                    "weg",
                    "gebiet",
                    "region",
                    "gipfel",
                    "kraftlinie",
                    "literatur",
                    "quelle",
                    "vorkommen",
                    "sprachen",
                ],
            ].sort(),
        );
        const gebiet = (b: WikisyncBericht) =>
            JSON.stringify(b.zeilen.filter((z) => z.bereich === "gebiet").map(zeileOhneNummern));
        expect(gebiet(nachher)).toBe(gebiet(vorher));
        expect(nachher.zeilen.filter((z) => z.bereich === "ort").length).toBe(
            vorher.zeilen.filter((z) => z.bereich === "ort").length,
        );
    });

    it("die Eingabe wird streng geprüft: ein unbekannter Bereich oder ein Feld, das es nicht gibt, ist ein Eingabefehler ohne Lauf", async () => {
        const vorher = await cluster!.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM wikisync_lauf`;
        for (const kaputt of [
            { bereiche: ["orte"] },
            { bereiche: [] },
            { legacyBereiche: ["ort"] },
            { ausgeloestVon: "" },
            { pfad: "/" },
        ]) {
            await expect(vorschau(kaputt as Record<string, unknown>)).rejects.toBeInstanceOf(JobFailure);
        }
        const nachher = await cluster!.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM wikisync_lauf`;
        expect(nachher[0]?.n).toBe(vorher[0]?.n);
    });

    it("🔴 ein abgeschnittener Dump rechnet nichts: ein Fehllauf mit dem Grund, der Bericht zeigt weiter den letzten guten Lauf", async () => {
        const vorherBericht = await bericht("?limit=500");
        const abgeschnitten = await neuerOrdner("wikisync-abgeschnitten");
        try {
            await writeFile(
                join(abgeschnitten.pfad, "dewa_dump_small_20261101.xml"),
                baueDump(DUMP, { abgeschnitten: true }),
            );
            const hash = await fachtafelHash(cluster!.admin);
            await expect(
                runWikiVorschauJob(context(), {
                    environment: { WIKI_DUMP_ROOT: abgeschnitten.pfad },
                    ladeZuweisungen: () => ladeZuweisungen(cluster!.jobs),
                    ladeTafel: async () => ({ revision: null, quelle: "vorgabe", namensraeume: wikiNamespaceTafel() }),
                    ablage,
                }),
            ).rejects.toMatchObject({ code: "dump_unvollstaendig" });
            const fehl = await cluster!.admin<{ status: string; fehler: string; dump_sha256: string | null }[]>`
                SELECT status, fehler, dump_sha256 FROM wikisync_lauf WHERE status = 'fehlgeschlagen'
            `;
            expect(fehl).toHaveLength(1);
            expect(fehl[0]?.fehler).toContain("abgeschnitten");
            const nachherBericht = await bericht("?limit=500");
            expect(nachherBericht.laeufe).toEqual(vorherBericht.laeufe);
            expect(await fachtafelHash(cluster!.admin)).toEqual(hash);
        } finally {
            await abgeschnitten.weg();
        }
    });

    it("🔴 Rechte: die App liest nur, die Jobs-Rolle schreibt die zwei Tafeln und sonst keine Fachtafel", async () => {
        const c = cluster!;
        for (const tafel of ["wikisync_lauf", "wikisync_lauf_zeile"]) {
            expect(await c.granted(c.roles.app, tafel), `App ${tafel}`).toEqual(["SELECT"]);
        }
        expect(await c.granted(c.roles.jobs, "wikisync_lauf")).toEqual(
            expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]),
        );
        expect(await c.granted(c.roles.jobs, "wikisync_lauf_zeile")).toEqual(
            expect.arrayContaining(["SELECT", "INSERT"]),
        );
        // Keine Fachtafel: die Jobs-Rolle darf in keine der Tafeln schreiben, die der Abgleich liest. 🔴 Ausgenommen ist seit D-1 `powerline`: Die Übernahme schreibt
        // Name und Beschreibung der Kraftlinie und deren Wiki-Stand; `wikisync-uebernahme.test.ts` hält fest, GENAU welche Spalten. Den Vermerk (`field_origin`) schreibt sie nie.
        for (const tafel of [
            "place",
            "place_detail",
            "path",
            "territory_detail",
            "field_origin",
            "wiki_settlement_snapshot",
            "region",
        ]) {
            const rechte = await c.granted(c.roles.jobs, tafel);
            expect(rechte, tafel).not.toContain("INSERT");
            expect(rechte, tafel).not.toContain("UPDATE");
            expect(rechte, tafel).not.toContain("DELETE");
        }
        const codes = await c.codesAs(c.app, [
            "INSERT INTO wikisync_lauf (bereiche, parser_version) VALUES (ARRAY['ort'], 'x')",
            "DELETE FROM wikisync_lauf",
            "UPDATE wikisync_lauf_zeile SET objekte = 1",
        ]);
        expect(codes).toEqual(["42501", "42501", "42501"]);
        // Das Abräumen der Jobs-Rolle fällt samt Zeilen (ON DELETE CASCADE), auch ohne eigenes DELETE-Recht auf der Zeilentafel.
        expect(await raeumeAb(c.jobs)).toBeGreaterThanOrEqual(0);
    });
});
