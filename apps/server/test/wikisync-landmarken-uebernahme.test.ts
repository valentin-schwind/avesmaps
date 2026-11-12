import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { runWikiUebernehmenJob, runWikiZuruecknehmenJob } from "../src/jobs/wiki-uebernahme-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeLandmarkenAufDerKarte, ladeObjekteDesLaufs } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { baueDump, neuerOrdner } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { DUMP, ID, legeGipfelAn, raeumeAb } from "./support/wikisync-welt.ts";

/**
 * Der EINE Bereich „Landmarken“ im WikiSync (WI-0271 L7; Betreiber 2026-11-01: „Gipfel und Vulkane“ und „Landmarken (nur im Wiki)“ zusammenlegen): `gipfel` schreibt die Landmarken der Karte und die Kandidaten ohne
 * Landmarke in einer Übernahme, einer Operation und einer Rücknahme. Gegen einen Wegwerf-Cluster mit den Rollen des VPS; die Jobs-Rolle schreibt, die Welt ist erfunden.
 *
 * Problemfälle: Die Kandidaten fehlen, weil der Lader des Bereichs sie nicht liefert; zwei Operationen oder zwei Zeilen im Protokoll, die sich getrennt zurücknehmen ließen; die Rücknahme nimmt nur eine der beiden Tafeln
 * zurück; ein Kandidat landet auf der Karte; ein Artikel, der schon an einer Landmarke hängt, kommt als Kandidat dazu; eine Änderung nur an Kandidaten löst das Gelände aus.
 */

const ENV = "wikisynclm";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const SEITEN = [
    ...DUMP,
    {
        titel: "Drachenhöhle",
        ns: 0,
        text: "{{Infobox Region\n|Name=Drachenhöhle\n|Art=Höhle\n|Region=Kosch\n}}\nDie Drachenhöhle liegt tief im Kosch.",
    },
    {
        titel: "Feuerschlund",
        ns: 0,
        text: "{{Infobox Region\n|Name=Feuerschlund\n|Art=Vulkan\n|Höhe=3.200 Schritt\n}}\nEin Vulkan.",
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

describeWithCluster("WikiSync: ein Bereich Landmarken, zwei Tafeln (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let ablage: VorschauAblage;

    const jobs = (): Database => cluster!.jobs;
    const admin = (): Database => cluster!.admin;
    const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;
    const mitJobs = <T>(arbeit: (db: Database) => Promise<T>): Promise<T> => arbeit(jobs());
    const wert = <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
    const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);

    async function vorschau(): Promise<number> {
        const ergebnis = await runWikiVorschauJob(kontext({ bereiche: ["gipfel"] }), {
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

    interface Ergebnis {
        bereiche: {
            status: string;
            operationId?: string | null;
            zahlen?: Record<string, number>;
            uebernahme: number | null;
        }[];
    }
    const uebernehmen = async (): Promise<Ergebnis["bereiche"][number]> => {
        const ergebnis = (await runWikiUebernehmenJob(kontext({ bereiche: ["gipfel"] }), {
            environment: einsatz,
            mitDatenbank: mitJobs,
        })) as unknown as Ergebnis;
        return ergebnis.bereiche[0]!;
    };

    async function zuruecknehmen(lauf: number, uebernahme: number): Promise<{ status: string; uebernahme: number }> {
        const [job] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue('wiki_zuruecknehmen', 1::smallint, 'aventuria', 'cli:test', '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        await admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${job!.public_id}::uuid`;
        return (await runWikiZuruecknehmenJob(kontext({ bereich: "gipfel", lauf, uebernahme }, job!.public_id), {
            environment: einsatz,
            mitDatenbank: mitJobs,
        })) as never;
    }

    const kandidaten = (): Promise<
        { titel: string; art: string; hoehe_schritt: number | null; is_active: boolean }[]
    > => wert(`SELECT titel, art, hoehe_schritt, is_active FROM wiki_landmarke_artikel ORDER BY titel`);
    const gipfelHoehe = async (id: string): Promise<number | null> =>
        (await wert<{ h: number | null }>(`SELECT height_schritt AS h FROM terrain_peak WHERE public_id = '${id}'`))[0]!
            .h;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-lm");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(SEITEN));
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekteDesLaufs(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
            ladeLandmarkenAufDerKarte: () => ladeLandmarkenAufDerKarte(j),
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

    it("🔴 Vorschau, Übernahme und Rücknahme laufen als ein Bereich: eine Operation, eine Protokollzeile, beide Tafeln; kein Kandidat kommt auf die Karte", async () => {
        await raeumeAb(admin());
        await legeGipfelAn(admin());
        const gipfelVorher = await zahl(`SELECT count(*)::int AS n FROM terrain_peak`);

        // Die Vorschau führt alle Zeilen unter `gipfel`; das Ingerimmsberg-Objekt hängt an der Karte und wird kein Kandidat.
        const lauf = await vorschau();
        const arten = await wert<{ objekt_art: string; bereich: string; n: string }>(
            `SELECT objekt_art, bereich, count(*) AS n FROM wikisync_lauf_zeile WHERE lauf_id = ${String(lauf)} GROUP BY 1, 2 ORDER BY 1`,
        );
        expect(arten.map((zeile) => zeile.bereich)).toEqual(arten.map(() => "gipfel"));
        expect(arten.map((zeile) => zeile.objekt_art)).toEqual(expect.arrayContaining(["landmarke_artikel", "peak"]));
        const titelDerKandidaten = await wert<{ objekt_name: string }>(
            `SELECT DISTINCT objekt_name FROM wikisync_lauf_zeile WHERE lauf_id = ${String(lauf)} AND objekt_art = 'landmarke_artikel' ORDER BY 1`,
        );
        expect(titelDerKandidaten.map((zeile) => zeile.objekt_name)).toEqual(["Drachenhöhle", "Feuerschlund"]);

        // Die Übernahme: EINE Operation, EINE Zeile; beide Tafeln geschrieben, die Karte um keinen Punkt reicher.
        const ergebnis = await uebernehmen();
        expect(ergebnis.status).toBe("fertig");
        expect(await zahl(`SELECT count(*)::int AS n FROM map_operation`)).toBe(1);
        expect(await zahl(`SELECT count(*)::int AS n FROM wikisync_uebernahme`)).toBe(1);
        expect(await kandidaten()).toEqual([
            { titel: "Drachenhöhle", art: "hoehle", hoehe_schritt: null, is_active: true },
            { titel: "Feuerschlund", art: "vulkan", hoehe_schritt: 3200, is_active: true },
        ]);
        expect(await gipfelHoehe(ID.ingerimm)).toBe(1100);
        expect(await zahl(`SELECT count(*)::int AS n FROM terrain_peak`)).toBe(gipfelVorher);
        const aktionen = await wert<{ action: string; n: string }>(
            `SELECT action, count(*) AS n FROM map_audit_event GROUP BY 1 ORDER BY 1`,
        );
        expect(aktionen.map((zeile) => zeile.action)).toEqual([
            "landmarke_artikel.wikisync_uebernommen",
            "peak.wikisync_uebernommen",
        ]);
        expect(ergebnis.zahlen).toMatchObject({ angelegt: 2 });
        expect(ergebnis.zahlen!["zeilen"]).toBeGreaterThan(0);

        // Der zweite Lauf ändert nichts.
        await vorschau();
        expect((await uebernehmen()).operationId).toBeNull();
        expect(await zahl(`SELECT count(*)::int AS n FROM map_operation`)).toBe(1);

        // Die Rücknahme: EINE Operation; die Kandidaten sind still, die Höhe ist wieder die alte.
        const rueck = await zuruecknehmen(lauf, ergebnis.uebernahme!);
        expect(rueck.status).toBe("fertig");
        expect(await zahl(`SELECT count(*)::int AS n FROM map_operation WHERE action = 'wikisync.zuruecknehmen'`)).toBe(
            1,
        );
        expect((await kandidaten()).map((zeile) => zeile.is_active)).toEqual([false, false]);
        expect(await gipfelHoehe(ID.ingerimm)).toBe(700);
        expect(await zahl(`SELECT count(*)::int AS n FROM terrain_peak`)).toBe(gipfelVorher);
        expect(
            await zahl(
                `SELECT count(*)::int AS n FROM wikisync_uebernahme WHERE id = ${String(ergebnis.uebernahme)} AND zurueckgenommen_am IS NOT NULL`,
            ),
        ).toBe(1);
    });

    it("🔴 Ändert sich nur ein Kandidat, schreibt nur sein Schreiber: eine Operation ohne Eintrag am Gipfel und ohne Gelände; die Rücknahme trifft nur ihn", async () => {
        await raeumeAb(admin());
        await legeGipfelAn(admin());
        await vorschau();
        await uebernehmen();

        await admin()`UPDATE wiki_landmarke_artikel SET region = 'Nordmarken' WHERE titel = 'Drachenhöhle'`;
        await admin()`DELETE FROM job`;
        const lauf = await vorschau();
        const ergebnis = await uebernehmen();
        expect(ergebnis.status).toBe("fertig");
        expect(ergebnis.operationId).not.toBeNull();
        expect(ergebnis.zahlen).toMatchObject({ objekte: 1, felder: 1 });
        const eintraege = await wert<{ action: string; region: unknown }>(
            `SELECT action, changes->'region' AS region FROM map_audit_event WHERE operation_id = '${ergebnis.operationId!}'`,
        );
        expect(eintraege).toEqual([
            {
                action: "landmarke_artikel.wikisync_uebernommen",
                region: { before: "Nordmarken", after: "Kosch" },
            },
        ]);
        expect(
            await zahl(`SELECT count(*)::int AS n FROM job WHERE state = 'QUEUED' AND kind NOT LIKE 'wiki\\_%'`),
        ).toBe(0);

        const hoeheVorher = await gipfelHoehe(ID.ingerimm);
        await zuruecknehmen(lauf, ergebnis.uebernahme!);
        const [region] = await wert<{ region: string }>(
            `SELECT region FROM wiki_landmarke_artikel WHERE titel = 'Drachenhöhle'`,
        );
        expect(region!.region).toBe("Nordmarken");
        expect(await gipfelHoehe(ID.ingerimm)).toBe(hoeheVorher);
    });
});
