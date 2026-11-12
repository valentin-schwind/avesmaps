import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { createLandscape } from "../src/editor/landscape-create.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ladeWikiEintraege } from "../src/editor/wiki-eintraege.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { runWikiUebernehmenJob, runWikiZuruecknehmenJob } from "../src/jobs/wiki-uebernahme-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeBelegteRegionArtikel, ladeObjekteDesLaufs } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { regionAnschluss } from "../src/wiki/objekt/region.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { baueDump, baueKategorienSql, neuerOrdner, schreibeKategorienDatei } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { raeumeAb } from "./support/wikisync-welt.ts";

/**
 * Die Wiki-Einträge ohne Fläche von vorn bis hinten (WI-0284), gegen einen Wegwerf-Cluster mit den Rollen des VPS. Der Fall ist Frühlingsstrand: Die Fläche liegt auf der Karte, im Wiki steht der Artikel, die Wiki-Box fand
 * ihn nicht. Die Jobs-Rolle schreibt, die App-Rolle liest und weist zu.
 *
 * Problemfälle: Der Jobs-Rolle fehlt ein Recht (lokal als Eigentümer bliebe das unbemerkt); ein zugewiesener Artikel wird im nächsten Lauf still gelegt, und die Fläche verliert ihre Wiki-Angaben; die Rücknahme lässt den
 * Eintrag stehen; ein Lauf legt von selbst eine Fläche an.
 */

const ENV = "wikisyncra";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const FLAECHE = "b9000000-0000-4000-8000-000000000001";
const SEITEN = [
    {
        titel: "Frühlingsstrand",
        ns: 0,
        text: "{{Aventurien}}\n{{Infobox Region\n|Name=Frühlingsstrand\n|Art=Insel\n|Region=[[Blutige See (Meer)|Blutige See]]\n|SÜD=[[Rulat]]\n}}\n'''Frühlingsstrand''' ist eine Insel.",
    },
    {
        titel: "Ilramwald",
        ns: 0,
        text: "{{Infobox Region\n|Name=Ilramwald\n|Art=Wald\n|Region=[[Tobrien]]\n}}\nEin Wald.",
    },
    {
        titel: "Drachenhöhle",
        ns: 0,
        text: "{{Aventurien}}{{Infobox Region\n|Name=Drachenhöhle\n|Art=Höhle\n}}\nEine Höhle.",
    },
    {
        titel: "Asucar",
        ns: 0,
        text: "{{Myranor}}{{Infobox Region\n|Name=Asucar\n|Art=Insel\n}}\nEine Insel in Myranor.",
    },
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

describeWithCluster("Wiki-Einträge ohne Fläche (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let ablage: VorschauAblage;

    const jobs = (): Database => cluster!.jobs;
    const app = (): Database => cluster!.app;
    const admin = (): Database => cluster!.admin;
    const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;
    const mitJobs = <T>(arbeit: (db: Database) => Promise<T>): Promise<T> => arbeit(jobs());

    /** Eine Vorschau des Bereichs `region`; die Kategorien-Datei im Dump-Ordner ist da (WI-0294), die Kontinente sind hier nicht die Frage. */
    async function vorschau(): Promise<number> {
        const ergebnis = await runWikiVorschauJob(kontext({ bereiche: ["region"] }), {
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
        operationId?: string | null;
        uebernahme: number | null;
    }
    const uebernehmen = async (): Promise<Bereich> =>
        (
            (await runWikiUebernehmenJob(kontext({ bereiche: ["region"] }), {
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
        return (await runWikiZuruecknehmenJob(kontext({ bereich: "region", lauf, uebernahme }, job!.public_id), {
            environment: einsatz,
            mitDatenbank: mitJobs,
        })) as never;
    }

    const eintraege = async (): Promise<string[]> => (await ladeWikiEintraege(app())).map((eintrag) => eintrag.name);

    async function legeFlaecheAn(): Promise<void> {
        await admin()`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type)
            VALUES (${FLAECHE}::uuid, 'aventuria', 'Frühlingsstrand', 'topographie', 'insel')
        `;
    }

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-ra");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(SEITEN));
        // Eine Kategorien-Datei mit einer einzigen, unbeteiligten Zeile: Die Vorschau pinnt sie, und die Übernahme des Bereichs ist frei.
        await schreibeKategorienDatei(
            join(ordner.pfad, "dump_categorylinks-20261001.sql.gz"),
            baueKategorienSql([{ von: 999_999, nach: "Unbeteiligt" }]),
        );
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekteDesLaufs(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
            ladeBelegteRegionArtikel: () => ladeBelegteRegionArtikel(j),
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

    it("🔴 Frühlingsstrand: Der Lauf legt den Eintrag an, die Wiki-Box findet ihn, zugewiesen verschwindet die Zeile und der nächste Lauf lässt den Stand der Fläche stehen", async () => {
        await raeumeAb(admin());
        await legeFlaecheAn();
        const flaechen = (): Promise<{ n: number }[]> =>
            admin()<{ n: number }[]>`SELECT count(*)::int AS n FROM region`;

        await vorschau();
        expect((await uebernehmen()).status).toBe("fertig");

        // Die Liste: keine Höhle (Landmarke), kein Myranor; Ebene und Art aus dem Artikel; die Karte um keine Fläche reicher.
        expect(await eintraege()).toEqual(["Frühlingsstrand", "Ilramwald"]);
        const [insel] = await ladeWikiEintraege(app());
        expect(insel).toMatchObject({ titel: "Frühlingsstrand", layer: "topographie", type: "insel", art: "Insel" });
        expect(insel!.kurzbeschreibung).toContain("Insel");
        expect(await flaechen()).toEqual([{ n: 1 }]);
        const [{ nachbarn }] = (await admin()`
            SELECT count(*)::int AS nachbarn FROM wiki_region_snapshot_neighbor n JOIN wiki_region_snapshot s ON s.id = n.snapshot_id WHERE s.name = 'Frühlingsstrand'
        `) as unknown as [{ nachbarn: number }];
        expect(nachbarn).toBe(1);

        // Die Wiki-Box der vorhandenen Fläche findet den Artikel und nimmt ihn: der Weg, der bisher fehlte.
        const objekt = (await regionAnschluss.lies(app(), FLAECHE))!;
        expect(objekt.artikel).toBeNull();
        const treffer = await regionAnschluss.suche(app(), objekt, "Frühlingsstrand");
        expect(treffer.map((zeile) => zeile.name)).toEqual(["Frühlingsstrand"]);
        await app().begin((tx) => regionAnschluss.weise(tx as never, objekt, treffer[0]!.key));
        expect((await regionAnschluss.lies(app(), FLAECHE))!.mitStand).toBe(true);
        expect(await eintraege()).toEqual(["Ilramwald"]);

        // 🔴 Der nächste Lauf legt den Stand der Fläche nicht still und legt keinen zweiten an.
        await vorschau();
        expect((await uebernehmen()).status).toBe("fertig");
        const staende = await admin()<
            { is_active: boolean }[]
        >`SELECT is_active FROM wiki_region_snapshot WHERE name = 'Frühlingsstrand'`;
        expect(staende).toEqual([{ is_active: true }]);
    }, 120_000);

    it("🔴 Die Rücknahme legt die Einträge still, und der nächste Lauf belebt sie", async () => {
        await raeumeAb(admin());
        const lauf = await vorschau();
        const ergebnis = await uebernehmen();
        expect(await eintraege()).toEqual(["Frühlingsstrand", "Ilramwald"]);
        const aktionen = await admin()<{ action: string; n: number }[]>`
            SELECT action, count(*)::int AS n FROM map_audit_event WHERE region_artikel_public_id IS NOT NULL GROUP BY 1
        `;
        expect(aktionen).toEqual([{ action: "region_artikel.wikisync_uebernommen", n: 2 }]);

        expect((await zuruecknehmen(lauf, ergebnis.uebernahme!)).status).toBe("fertig");
        expect(await eintraege()).toEqual([]);
        const still = await admin()<
            { retired_origin: string }[]
        >`SELECT DISTINCT retired_origin FROM wiki_region_snapshot`;
        expect(still).toEqual([{ retired_origin: "wikisync" }]);

        await vorschau();
        await uebernehmen();
        expect(await eintraege()).toEqual(["Frühlingsstrand", "Ilramwald"]);
    }, 120_000);

    it("🔴 Eine Fläche aus dem Eintrag heißt wie er, trägt seine Art und seinen Artikel; zugewiesen ist er keine Zeile mehr, ein zweites Mal geht nicht", async () => {
        await raeumeAb(admin());
        await vorschau();
        await uebernehmen();
        const [insel] = await ladeWikiEintraege(app());
        const akteur: MapActor = { kind: "system", label: "test", environment: "test" };
        const ring = [
            [700, 500],
            [701, 500],
            [701, 501],
        ] as [number, number][];
        const koerper = { layer: "topographie" as const, ring, wikiEintrag: insel!.id };

        const quittung = await createLandscape(app(), akteur, { operationId: randomUUID(), ...koerper });
        expect(quittung.name).toBe("Frühlingsstrand");
        const [flaeche] = await admin()<{ region_type: string; wiki_region_key: string; wiki_url: string }[]>`
            SELECT region_type, wiki_region_key, wiki_url FROM region WHERE public_id = ${quittung.publicId}::uuid
        `;
        expect(flaeche).toMatchObject({ region_type: "insel", wiki_url: insel!.wikiUrl });
        expect((await regionAnschluss.lies(app(), quittung.publicId))!.mitStand).toBe(true);
        expect(await eintraege()).toEqual(["Ilramwald"]);

        await expect(createLandscape(app(), akteur, { operationId: randomUUID(), ...koerper })).rejects.toMatchObject({
            code: "wiki_eintrag_belegt",
        });
    }, 120_000);
});
