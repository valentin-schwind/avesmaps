import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { listWikiSettlementRows } from "../src/editor/wiki-settlement-rows.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { runWikiUebernehmenJob, runWikiZuruecknehmenJob } from "../src/jobs/wiki-uebernahme-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { staettenSichtSql } from "../src/subjects/sections/staetten-sicht.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteOrtArtikel, ladeBekannteTitel, ladeObjekteDesLaufs } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { ortAnschluss } from "../src/wiki/objekt/ort.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { baueDump, baueKategorienSql, neuerOrdner, schreibeKategorienDatei } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { raeumeAb } from "./support/wikisync-welt.ts";

/**
 * Die neuen Orts- und Bauwerk-Artikel von vorn bis hinten (WI-0295 Teil 2), gegen einen Wegwerf-Cluster mit den Rollen des VPS: Die Jobs-Rolle schreibt, die App-Rolle liest und weist zu. Fälle aus dem Work Item:
 * Burg Trollhammer erscheint als ◐ in der Ortsliste und in der Wiki-Box; die Magiekundliche Investigations-Cammer steht in Rommilys unter „Innerorts“; Legacys Zeilen bleiben, wie sie sind.
 *
 * Problemfälle: Der Jobs-Rolle fehlt ein Recht (lokal als Eigentümer bliebe das unbemerkt); ein zugewiesener Artikel wird im nächsten Lauf still gelegt, und der Ort verliert seinen Wiki-Stand; die Rücknahme lässt
 * die Einträge stehen; der Lauf schreibt eine Zeile Legacys um.
 */

const ENV = "wikisyncoa";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const ROMMILYS = "c2000000-0000-4000-8000-000000000001";
const BURGPLATZ = "c2000000-0000-4000-8000-000000000002";
const adresse = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

const SEITEN = [
    {
        id: 2001,
        titel: "Burg Trollhammer",
        ns: 0,
        text: "{{Infobox Bauwerk\n|Name=Burg Trollhammer\n|Art=[[Burg (Architektur)|Burg]]\n|Standort=[[Kosch]]\n}}\n'''Burg Trollhammer''' ist eine Burg im [[Kosch]].",
    },
    {
        id: 2002,
        titel: "Magiekundliche Investigations-Cammer",
        ns: 0,
        text: "{{Aventurien}}\n{{Infobox Bauwerk\n|Art=[[Lager]]\n|Standort=[[Rommilys]]\n}}\nDie Cammer ist ein Lager in [[Rommilys]].",
    },
    {
        id: 2003,
        titel: "Askanaz",
        ns: 0,
        text: "{{Myranor}}\n{{Infobox Bauwerk\n|Art=Tempel\n}}\nEin Tempel in Myranor.",
    },
    {
        id: 2004,
        titel: "Alte Burg",
        ns: 0,
        text: "{{Aventurien}}\n{{Infobox Bauwerk\n|Art=Burg\n}}\nSchon in Legacys Registry.",
    },
    {
        id: 2005,
        titel: "Rommilys",
        ns: 0,
        text: "{{Aventurien}}\n{{Infobox Siedlung\n|Name=Rommilys\n|Region=[[Darpatien]]\n}}\nEine Stadt.",
    },
];

const KATEGORIEN = [
    { von: 2001, nach: "Festung" },
    { von: 2001, nach: "Aventurien-Artikel" },
    { von: 2003, nach: "Myranor-Artikel" },
    { von: 2004, nach: "Festung" },
    { von: 2005, nach: "Großstadt" },
];

function kontext(input: Record<string, unknown>, jobPublicId: string = randomUUID()): JobContext {
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: jobPublicId, leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    };
}

describeWithCluster("Orts- und Bauwerk-Artikel ohne Ort (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let ablage: VorschauAblage;

    const jobs = (): Database => cluster!.jobs;
    const app = (): Database => cluster!.app;
    const admin = (): Database => cluster!.admin;
    const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;
    const mitJobs = <T>(arbeit: (db: Database) => Promise<T>): Promise<T> => arbeit(jobs());

    async function vorschau(): Promise<number> {
        const ergebnis = await runWikiVorschauJob(kontext({ bereiche: ["ort"] }), {
            environment: { WIKI_DUMP_ROOT: ordner.pfad },
            ladeZuweisungen: () => ladeZuweisungen(jobs()),
            ladeTafel: async () => {
                const stand = await leseNamespaceTafel(jobs());
                return {
                    revision: stand.revision,
                    quelle: stand.revision === null ? "vorgabe" : "datenbank",
                    namensraeume: stand.namensraeume,
                };
            },
            ablage,
        });
        return (ergebnis["lauf"] as { id: number }).id;
    }

    interface Bereich {
        status: string;
        uebernahme: number | null;
    }
    const uebernehmen = async (): Promise<Bereich> =>
        (
            (await runWikiUebernehmenJob(kontext({ bereiche: ["ort"] }), {
                environment: einsatz,
                mitDatenbank: mitJobs,
            })) as unknown as { bereiche: Bereich[] }
        ).bereiche[0]!;

    async function zuruecknehmen(lauf: number, uebernahme: number): Promise<{ status: string }> {
        const [job] = await app()<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue('wiki_zuruecknehmen', 1::smallint, 'aventuria', 'cli:test', '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        await admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${job!.public_id}::uuid`;
        return (await runWikiZuruecknehmenJob(kontext({ bereich: "ort", lauf, uebernahme }, job!.public_id), {
            environment: einsatz,
            mitDatenbank: mitJobs,
        })) as never;
    }

    const ortsliste = async (): Promise<string[]> =>
        (await listWikiSettlementRows(app(), "aventuria")).rows.map((zeile) => zeile.name);

    interface Legacy {
        is_active: boolean;
        updated_at: Date;
        building_type: string;
    }
    const legacyZeile = async (): Promise<Legacy> =>
        (
            await admin()<
                Legacy[]
            >`SELECT is_active, updated_at, building_type FROM wiki_settlement_registry WHERE source_system = 'legacy'`
        )[0]!;

    /** Die Welt vor dem Lauf: Rommilys auf der Karte (über X2), Legacys Zeile „Alte Burg“, ein Ort ohne Artikel für die Wiki-Box. */
    async function legeWeltAn(): Promise<void> {
        await raeumeAb(admin());
        await admin()`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom)
            VALUES (${ROMMILYS}::uuid, 'aventuria', 'Rommilys', 'grossstadt', ST_SetSRID(ST_MakePoint(700, 120), 0)),
                   (${BURGPLATZ}::uuid, 'aventuria', 'Burg am Kosch', 'gebaeude', ST_SetSRID(ST_MakePoint(703, 120), 0))
        `;
        await admin()`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns, source_system)
            VALUES ('siedlung', ${ROMMILYS}::uuid, 'wiki:rommilys', ${adresse("Rommilys")}, 'Rommilys', 0, 'legacy')
        `;
        await admin()`
            INSERT INTO wiki_settlement_registry (wiki_key, title, wiki_url, settlement_class, building_type, continent, source_system)
            VALUES ('wiki:alte-burg', 'Alte Burg', ${adresse("Alte Burg")}, 'gebaeude', 'Burg', 'Aventurien', 'legacy')
        `;
    }

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-oa");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261101.xml"), baueDump(SEITEN));
        await schreibeKategorienDatei(
            join(ordner.pfad, "dump_categorylinks-20261101.sql.gz"),
            baueKategorienSql(KATEGORIEN),
        );
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekteDesLaufs(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
            ladeBekannteOrtArtikel: () => ladeBekannteOrtArtikel(j),
            ladeWikisyncBereiche: () => wikisyncBereiche(j),
            schreibe: (eingabe) => schreibeLauf(j, eingabe),
            schreibeFehllauf: (eingabe, fehler) => schreibeFehllauf(j, eingabe, fehler),
            ausloeser: () => Promise.resolve("jobs-cli"),
        };
    }, 240_000);
    afterAll(async () => {
        await ordner?.weg();
        await cluster?.stop();
    }, 60_000);

    it("🔴 Burg Trollhammer: Ortsliste ◐, Wiki-Box, Innerorts der Cammer in Rommilys; zugewiesen bleibt der Stand des Orts, Legacys Zeile unberührt", async () => {
        await legeWeltAn();
        const legacyVorher = await legacyZeile();

        await vorschau();
        expect((await uebernehmen()).status).toBe("fertig");

        // Die Registry: zwei Einträge des WikiSync, kein Myranor, keine zweite „Alte Burg“, Rommilys (auf der Karte) nicht.
        const eintraege = await admin()<
            { title: string; building_type: string; settlement_class: string; continent: string }[]
        >`
            SELECT title, building_type, settlement_class, continent FROM wiki_settlement_registry WHERE source_system = 'wikisync' ORDER BY title
        `;
        expect(eintraege).toEqual([
            {
                title: "Burg Trollhammer",
                building_type: "Festung",
                settlement_class: "gebaeude",
                continent: "Aventurien",
            },
            {
                title: "Magiekundliche Investigations-Cammer",
                building_type: "Lager",
                settlement_class: "gebaeude",
                continent: "Aventurien",
            },
        ]);
        expect(await legacyZeile()).toEqual(legacyVorher);

        // Die Ortsliste der Editoren: die beiden als Wiki-Zeilen ohne Ort (◐), dazu Legacys Zeile wie bisher.
        const liste = (await listWikiSettlementRows(app(), "aventuria")).rows;
        expect(liste.map((zeile) => zeile.name)).toEqual([
            "Alte Burg",
            "Burg Trollhammer",
            "Magiekundliche Investigations-Cammer",
        ]);
        expect(liste.find((zeile) => zeile.name === "Burg Trollhammer")).toMatchObject({
            origin: "wiki",
            assignment: "none",
            subtype: "gebaeude",
            kind: "Festung",
        });

        // Innerorts der Besucher: Rommilys nennt die Cammer über ihre Standort-Kette.
        const innerorts = await app().unsafe<{ name: string; art: string; herkunft: string }[]>(
            `SELECT name, art, herkunft FROM (${staettenSichtSql("SELECT id FROM place WHERE public_id = $1::uuid")}) s`,
            [ROMMILYS],
        );
        expect(innerorts).toEqual([
            { name: "Magiekundliche Investigations-Cammer", art: "Lager", herkunft: "genannt" },
        ]);

        // Die Wiki-Box eines Orts ohne Artikel findet Trollhammer und weist ihn zu.
        const objekt = (await ortAnschluss.lies(app(), BURGPLATZ))!;
        const treffer = await ortAnschluss.suche(app(), objekt, "Trollhammer");
        expect(treffer).toEqual([
            expect.objectContaining({
                key: "burg-trollhammer",
                name: "Burg Trollhammer",
                werte: { groesse: "gebaeude", bauwerk: "Festung" },
            }),
        ]);
        await app().begin((tx) => ortAnschluss.weise(tx as never, objekt, treffer[0]!.key));
        expect((await ortAnschluss.lies(app(), BURGPLATZ))!.mitStand).toBe(true);
        expect(await ortsliste()).toEqual(["Alte Burg", "Magiekundliche Investigations-Cammer"]);

        // 🔴 Der nächste Lauf legt den Stand des Orts nicht still, und der Eintrag bleibt, wie er ist.
        await vorschau();
        expect((await uebernehmen()).status).toBe("fertig");
        const staende = await admin()<{ is_active: boolean }[]>`
            SELECT s.is_active FROM wiki_settlement_snapshot s WHERE s.wiki_key = 'burg-trollhammer'
        `;
        expect(staende).toEqual([{ is_active: true }]);
        const [registry] = await admin()<{ is_active: boolean }[]>`
            SELECT is_active FROM wiki_settlement_registry WHERE wiki_key = 'wiki:burg-trollhammer'
        `;
        expect(registry).toEqual({ is_active: true });
        expect(await legacyZeile()).toEqual(legacyVorher);
    }, 180_000);

    it("🔴 Die Rücknahme legt die Einträge still, und der nächste Lauf belebt sie", async () => {
        await legeWeltAn();
        const lauf = await vorschau();
        const ergebnis = await uebernehmen();
        expect(await ortsliste()).toEqual(["Alte Burg", "Burg Trollhammer", "Magiekundliche Investigations-Cammer"]);
        const aktionen = await admin()<{ action: string; n: number }[]>`
            SELECT action, count(*)::int AS n FROM map_audit_event WHERE ort_artikel_public_id IS NOT NULL GROUP BY 1
        `;
        expect(aktionen).toEqual([{ action: "ort_artikel.wikisync_uebernommen", n: 2 }]);

        expect((await zuruecknehmen(lauf, ergebnis.uebernahme!)).status).toBe("fertig");
        expect(await ortsliste()).toEqual(["Alte Burg"]);
        const still = await admin()<{ tafel: string; retired_origin: string | null }[]>`
            SELECT DISTINCT 'registry' AS tafel, retired_origin FROM wiki_settlement_registry WHERE source_system = 'wikisync'
            UNION SELECT DISTINCT 'stand', retired_origin FROM wiki_settlement_snapshot WHERE source_system = 'wikisync'
            ORDER BY 1
        `;
        expect(still).toEqual([
            { tafel: "registry", retired_origin: "wikisync" },
            { tafel: "stand", retired_origin: "wikisync" },
        ]);
        const innerorts = await app().unsafe(
            `SELECT name FROM (${staettenSichtSql("SELECT id FROM place WHERE public_id = $1::uuid")}) s`,
            [ROMMILYS],
        );
        expect(innerorts).toEqual([]);

        await vorschau();
        expect((await uebernehmen()).status).toBe("fertig");
        expect(await ortsliste()).toEqual(["Alte Burg", "Burg Trollhammer", "Magiekundliche Investigations-Cammer"]);
    }, 180_000);
});
