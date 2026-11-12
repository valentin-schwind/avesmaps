import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
import { ladeBekannteTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { baueDump, neuerOrdner, type FixtureSeite } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Sprachen im WikiSync (WI-0261 S3) gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS (alle Vorlagen unter `src/db/`). Die Jobs-Rolle rechnet und schreibt; die Seiten sind echte
 * Sprachartikel aus der Fixture, der Bestand ist erfunden. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder in eine Umgebung; keiner fragt das Wiki.
 *
 * - **Vorschau → Übernahme → Rücknahme:** neue aventurische Artikel werden angelegt, geänderte Felder geschrieben, verschwundene, umgeleitete und nicht mehr aventurische still gelegt, ein
 *   still gelegter belebt; eine Operation der Quelle `wikisync` mit Fachprotokoll, keine Ableitung; der zweite Lauf ohne Operation; die Rücknahme stellt alles her (Angelegtes still gelegt).
 * - 🔴 **`sprache_wiki` bleibt unberührt** (O6): Der WikiSync schreibt die Zuordnung zu einer Sprache nie.
 * - **Ohne Umschalten** gehört der Bereich dem Legacy-Zug: alles nur Vorschau, die Übernahme lehnt ab.
 * - **Rechte:** Die Jobs-Rolle schreibt den Wiki-Stand, nie den Schlüssel, löscht nie und fasst `sprache_wiki` nicht an; die App liest den Wiki-Stand nur und löscht keine Zuordnung.
 */

const ENV = "wikisyncspr";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const FIXTURE = fileURLToPath(new URL("./fixtures/wiki-sprache-seiten.json", import.meta.url));
const SEITEN = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { seiten: { titel: string; ns: number; text: string }[] })
    .seiten;
const DUMP: FixtureSeite[] = [
    ...SEITEN.map((seite) => ({ titel: seite.titel, ns: seite.ns, text: seite.text })),
    // Ein Sprachartikel, der umgezogen ist: Seine Zeile wird still gelegt, der Grund nennt das Ziel.
    { titel: "Altgarethi", ns: 0, weiterleitung: "Garethi" },
    // Eine Seite, die kein Sprachartikel ist.
    { titel: "Gareth", ns: 0, text: "{{Aventurien}}\n{{Infobox Siedlung\n|Name=Gareth\n}}" },
];

const A = {
    thorwalsch: "c0000000-0000-4000-9000-000000000001",
    horathi: "c0000000-0000-4000-9000-000000000002",
    kauderwelsch: "c0000000-0000-4000-9000-000000000003",
    tesumurrisch: "c0000000-0000-4000-9000-000000000004",
    alaani: "c0000000-0000-4000-9000-000000000005",
    altgarethi: "c0000000-0000-4000-9000-000000000006",
};
const NEU = ["Angram (Sprache)", "Bansumitisch", "Garethi", "Mholurisch", "Ta-Haya"];

function kontext(input: Record<string, unknown>, jobPublicId: string = randomUUID()): JobContext {
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: jobPublicId, leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    };
}

describeWithCluster("WikiSync Sprachen: Vorschau, Übernahme und Rücknahme (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let umgebung: NodeJS.ProcessEnv;
    let ablage: VorschauAblage;
    const einsatz = { AVESMAPS_ENV: "test" } satisfies NodeJS.ProcessEnv;

    const jobs = (): Database => cluster!.jobs;
    const admin = (): Database => cluster!.admin;
    const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
    const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);

    async function vorschau(): Promise<number> {
        const ergebnis = await runWikiVorschauJob(kontext({ bereiche: ["sprachen"] }), {
            environment: umgebung,
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

    type Ergebnis = {
        bereiche: {
            status: string;
            grund?: string;
            operationId?: string | null;
            zahlen?: Record<string, number>;
            uebernahme: number | null;
        }[];
    };
    const uebernehmen = async (): Promise<Ergebnis> =>
        (await runWikiUebernehmenJob(kontext({ bereiche: ["sprachen"] }), {
            environment: einsatz,
            mitDatenbank: (arbeit) => arbeit(jobs()),
        })) as never;

    async function zuruecknehmen(
        lauf: number,
        uebernahme: number,
    ): Promise<{ status: string; zahlen: Record<string, number> }> {
        const [job] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text AS public_id
              FROM job_enqueue('wiki_zuruecknehmen', 1::smallint, 'aventuria', 'cli:test', '{}'::jsonb, 50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        await admin()`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE public_id = ${job!.public_id}::uuid`;
        return (await runWikiZuruecknehmenJob(kontext({ bereich: "sprachen", lauf, uebernahme }, job!.public_id), {
            environment: einsatz,
            mitDatenbank: (arbeit) => arbeit(jobs()),
        })) as never;
    }

    // ── Die Welt ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    async function artikel(
        id: string,
        titel: string,
        werte: Record<string, string | string[] | null> = {},
        aktiv = true,
    ): Promise<void> {
        const spalten = { name: titel, ...werte };
        const namen = Object.keys(spalten);
        await admin().unsafe(
            `INSERT INTO wiki_sprache_artikel (public_id, schluessel, titel, unbekannt, is_active, retired_at, retired_origin, ${namen.join(", ")})
             VALUES ($1::uuid, $2, $3, '{}'::text[], $4, ${aktiv ? "NULL, NULL" : "now(), 'wikisync'"}, ${namen.map((_n, i) => `$${String(i + 5)}`).join(", ")})`,
            [id, titel.toLowerCase(), titel, aktiv, ...Object.values(spalten)] as never[],
        );
    }

    async function neueWelt(): Promise<void> {
        await admin()`
            TRUNCATE map_audit_event, map_operation, wikisync_uebernahme_befund, wikisync_uebernahme, wikisync_lauf_zeile, wikisync_lauf, wikisync_bereich_setting,
                     sprache_wiki, wiki_sprache_artikel, sprache_flaeche, sprache
            RESTART IDENTITY CASCADE
        `;
        await admin()`UPDATE wikisync_bereich_state SET revision = 1`;
        await admin()`DELETE FROM job`;
        // Thorwalsch: Das Wiki zählt jetzt mehr Sprecher, die Leiste der Familie fehlt im Bestand.
        await artikel(A.thorwalsch, "Thorwalsch", {
            sprachfamilie: "Sprachfamilie Thorwalsch",
            schrift: "Thorwaler-Runen",
            sprecheranzahl: "über 70.000",
            offizielle_sprache: "Thorwal",
            weitere_verbreitung: "Gjalskerland",
            kurzbeschreibung:
                "Thorwalsch ist die aus dem (Alt-)Hjaldingsch entstandene Sprache der Thorwaler. Je nach Region sind Einflüsse aus dem Garethi, Orkisch und Nujuka zu erkennen. Die Sprachen der Gjalsker (Gjalskisch) und Fjarninger (Fjarningsch) haben sich aus ihr entwickelt, das Alberned ist von ihr beeinflusst.",
            schrift_roh: "[[Thorwaler-Runen]]",
            offizielle_sprache_roh: "[[Thorwal (Staat)|Thorwal]]",
            weitere_verbreitung_roh: "[[Gjalskerland]]",
        });
        // Horathi: hängt an einer Sprache (sprache_wiki); die Übernahme füllt nur, was fehlt.
        await artikel(A.horathi, "Horathi", { sprachfamilie: "Garethi" });
        // Nicht mehr im Dump, nicht mehr aventurisch, umgezogen: still legen.
        await artikel(A.kauderwelsch, "Altes Kauderwelsch");
        await artikel(A.tesumurrisch, "Tesumurrisch");
        await artikel(A.altgarethi, "Altgarethi");
        // Still gelegt und wieder im Dump: beleben.
        await artikel(A.alaani, "Alaani", {}, false);
        // Eine Sprache mit zwei Pillen (Spracheditor S5, Import S6): Der WikiSync fasst sie nie an.
        await admin()`
            INSERT INTO sprache (schluessel, name, farbe, reihenfolge, herkunft) VALUES ('garethi', 'Garethi', '#ffb901', 7, 'sprachenkarte')
        `;
        await admin()`
            INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
            SELECT s.id, a.id, 0, 'import' FROM sprache s, wiki_sprache_artikel a WHERE s.schluessel = 'garethi' AND a.public_id = ${A.horathi}::uuid
        `;
        await admin()`
            INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
            SELECT s.id, a.id, 1, 'redaktion' FROM sprache s, wiki_sprache_artikel a WHERE s.schluessel = 'garethi' AND a.public_id = ${A.kauderwelsch}::uuid
        `;
    }

    const bestand = async (): Promise<Record<string, Record<string, unknown>>> =>
        Object.fromEntries(
            (
                await wert<Record<string, unknown>>(
                    `SELECT titel, public_id::text AS id, is_active, retired_origin, revision::int AS revision, name, sprachfamilie, schrift, sprecheranzahl,
                            navigation, kurzbeschreibung, schrift_roh, unbekannt
                       FROM wiki_sprache_artikel ORDER BY titel`,
                )
            ).map((zeile) => [String(zeile["titel"]), zeile]),
        );
    const zuordnung = async (): Promise<string> =>
        JSON.stringify(
            await wert(
                `SELECT id::int, sprache_id::int, wiki_sprache_artikel_id::int, position, herkunft, is_active, revision::int, updated_at::text FROM sprache_wiki ORDER BY id`,
            ),
        );

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-sprachen");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261011.xml"), baueDump(DUMP));
        umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekte(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
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

    it("🔴 Vorschau → Übernahme → Rücknahme: anlegen, ändern, still legen, beleben; sprache_wiki bleibt unberührt", async () => {
        await neueWelt();
        const zuordnungVorher = await zuordnung();
        const vorher = await bestand();

        // ── Vorschau ──
        const laufId = await vorschau();
        const [lauf] = await wert<{ zahlen: Record<string, Record<string, unknown>>; parser_version: string }>(
            `SELECT zahlen, parser_version FROM wikisync_lauf WHERE id = ${String(laufId)}`,
        );
        // Seit WI-0271 L7 (Landmarken) Stand 11, seit WI-0288 Stufe 6 (Winde) 14; die Sprachen rechnen darin wie in 10.
        expect(lauf!.parser_version).toBe("wikisync-parser-15");
        expect(lauf!.zahlen["sprachen"]).toMatchObject({
            objekte: 5,
            gefunden: 2,
            nichtImDump: 3,
            stillgelegt: 3,
            // Fünf neue Artikel und Alaani, das wieder auflebt.
            angelegt: 6,
            befunde: 0,
        });
        const artikelZeilen = await wert<{
            objekt_name: string;
            alt: string | null;
            neu: string | null;
            status: string;
            grund: string;
        }>(
            `SELECT objekt_name, alt, neu, status, grund FROM wikisync_lauf_zeile
              WHERE lauf_id = ${String(laufId)} AND bereich = 'sprachen' AND feld = 'artikel' ORDER BY objekt_name`,
        );
        expect(artikelZeilen.map((zeile) => `${zeile.objekt_name}:${zeile.status}:${zeile.grund}`)).toEqual([
            "Alaani:neu:Wieder ein aventurischer Sprachartikel im Dump: lebt wieder auf",
            "Altes Kauderwelsch:zu_entfernen:Nicht mehr im Dump: wird still gelegt",
            "Altgarethi:zu_entfernen:Weiterleitung auf Garethi: wird still gelegt",
            "Angram (Sprache):neu:Neuer aventurischer Sprachartikel: wird angelegt",
            "Bansumitisch:neu:Neuer aventurischer Sprachartikel: wird angelegt",
            "Garethi:neu:Neuer aventurischer Sprachartikel: wird angelegt",
            "Mholurisch:neu:Neuer aventurischer Sprachartikel: wird angelegt",
            "Ta-Haya:neu:Neuer aventurischer Sprachartikel: wird angelegt",
            "Tesumurrisch:zu_entfernen:Weder {{Aventurien}} noch {{Nav Sprachen}}: nicht mehr aventurisch, wird still gelegt",
        ]);
        const thorwalschZeilen = await wert<{ feld: string; alt: string | null; neu: string | null }>(
            `SELECT feld, alt, neu FROM wikisync_lauf_zeile WHERE lauf_id = ${String(laufId)} AND objekt_id = '${A.thorwalsch}' ORDER BY id`,
        );
        expect(thorwalschZeilen).toEqual([
            { feld: "sprecheranzahl", alt: "über 70.000", neu: "über 80.000" },
            { feld: "navigation", alt: null, neu: "Nav Sprachfamilie Thorwalsch" },
        ]);
        // Angelegt wird in der Vorschau nichts.
        expect(await zahl(`SELECT count(*)::int AS n FROM wiki_sprache_artikel`)).toBe(6);

        // ── Übernahme ──
        const ergebnis = await uebernehmen();
        expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
        expect(ergebnis.bereiche[0]!.zahlen).toMatchObject({ objekte: 6, angelegt: 5, befunde: 0 });
        const uebernahmeId = ergebnis.bereiche[0]!.uebernahme!;
        const nach = await bestand();
        expect(Object.keys(nach).sort()).toEqual([...Object.keys(vorher), ...NEU].sort());
        expect(nach["Garethi"]).toMatchObject({
            is_active: true,
            revision: 1,
            name: "Garethi",
            sprachfamilie: "Sprachfamilie Garethi",
            schrift: "Kusliker Zeichen",
            navigation: ["Nav Sprachfamilie Garethi"],
            schrift_roh: "[[Kusliker Zeichen]]",
            unbekannt: [],
        });
        expect(nach["Mholurisch"]).toMatchObject({ is_active: true, sprachfamilie: null, navigation: [] });
        // Geändert: genau eine neue Revision je Objekt.
        expect(nach["Thorwalsch"]).toMatchObject({
            sprecheranzahl: "über 80.000",
            navigation: ["Nav Sprachfamilie Thorwalsch"],
            revision: Number(vorher["Thorwalsch"]!["revision"]) + 1,
        });
        expect(nach["Horathi"]).toMatchObject({ sprachfamilie: "Garethi", schrift: "Kusliker Zeichen" });
        for (const titel of ["Altes Kauderwelsch", "Tesumurrisch", "Altgarethi"])
            expect(nach[titel], titel).toMatchObject({ is_active: false, retired_origin: "wikisync" });
        expect(nach["Alaani"]).toMatchObject({
            is_active: true,
            retired_origin: null,
            sprachfamilie: "Sprachfamilie Tulamidya",
        });
        // 🔴 Die Zuordnung zu den Sprachen bleibt, wie sie war, auch an einem still gelegten Artikel (O6).
        expect(await zuordnung()).toBe(zuordnungVorher);

        // Eine Operation der Quelle wikisync, ein Eintrag je Objekt; keine Ableitung.
        const [op] = await wert<{ source: string; action: string; operation_id: string; summary: string }>(
            `SELECT source, action, operation_id::text, summary FROM map_operation ORDER BY seq DESC LIMIT 1`,
        );
        expect(op).toMatchObject({ source: "wikisync", action: "wikisync.uebernehmen" });
        // 🔴 Der Titel in der Liste der „Änderungen“ zählt die angelegten Artikel mit (WI-0265 B6i): sechs Objekte des Bestands und fünf neue, nicht „0 Felder (0 Objekte)“.
        expect(op!.summary).toMatch(/^WikiSync: [1-9]\d* Felder aus dem Wiki übernommen \(11 Objekte\)$/u);
        const eintraege = await wert<{
            titel: string;
            revision_before: number | null;
            revision_after: number | null;
            changes: Record<string, { before: unknown; after: unknown }>;
        }>(
            `SELECT a.titel, e.revision_before::int, e.revision_after::int, e.changes FROM map_audit_event e
               JOIN wiki_sprache_artikel a ON a.public_id = e.sprache_artikel_public_id
              WHERE e.operation_id = '${op!.operation_id}' AND e.action = 'sprache_artikel.wikisync_uebernommen' ORDER BY a.titel`,
        );
        expect(eintraege).toHaveLength(11);
        const eintrag = (titel: string) => eintraege.find((kandidat) => kandidat.titel === titel)!;
        expect(eintrag("Thorwalsch").changes).toEqual({
            sprecheranzahl: { before: "über 70.000", after: "über 80.000" },
            navigation: { before: null, after: "Nav Sprachfamilie Thorwalsch" },
        });
        expect(eintrag("Thorwalsch").revision_after).toBe(Number(nach["Thorwalsch"]!["revision"]));
        expect(eintrag("Garethi")).toMatchObject({ revision_before: null, revision_after: 1 });
        expect(eintrag("Garethi").changes["artikel"]).toEqual({ before: null, after: "Garethi" });
        expect(eintrag("Garethi").changes["offizielleSprache"]).toMatchObject({ before: null });
        expect(eintrag("Altgarethi").changes).toEqual({ artikel: { before: "Altgarethi", after: null } });
        expect(
            await zahl(`SELECT count(*)::int AS n FROM job WHERE state = 'QUEUED' AND kind NOT LIKE 'wiki\\_%'`),
        ).toBe(0);

        // ── Der zweite Lauf ändert nichts ──
        const zweiter = await vorschau();
        expect(
            await zahl(
                `SELECT count(*)::int AS n FROM wikisync_lauf_zeile WHERE lauf_id = ${String(zweiter)} AND bereich = 'sprachen'`,
            ),
        ).toBe(0);
        const noch = await uebernehmen();
        expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });

        // ── Rücknahme ──
        const rueck = await zuruecknehmen(laufId, uebernahmeId);
        expect(rueck.status).toBe("fertig");
        const zurueck = await bestand();
        // Angelegtes ist still gelegt, nie gelöscht.
        for (const titel of NEU)
            expect(zurueck[titel], titel).toMatchObject({ is_active: false, retired_origin: "wikisync" });
        for (const titel of ["Altes Kauderwelsch", "Tesumurrisch", "Altgarethi", "Thorwalsch", "Horathi"])
            expect(zurueck[titel], titel).toMatchObject({ is_active: true, retired_origin: null });
        expect(zurueck["Thorwalsch"]).toMatchObject({ sprecheranzahl: "über 70.000", navigation: [] });
        expect(zurueck["Horathi"]).toMatchObject({ sprachfamilie: "Garethi", schrift: null });
        expect(zurueck["Alaani"]).toMatchObject({ is_active: false, retired_origin: "wikisync", sprachfamilie: null });
        expect(await zuordnung()).toBe(zuordnungVorher);

        // Nach der Rücknahme schlägt dieselbe Vorschau wieder dasselbe vor: Die still gelegten neuen Artikel leben in ihrer Zeile wieder auf.
        const dritter = await vorschau();
        const [dritteZahlen] = await wert<{ zahlen: Record<string, Record<string, unknown>> }>(
            `SELECT zahlen FROM wikisync_lauf WHERE id = ${String(dritter)}`,
        );
        expect(dritteZahlen!.zahlen["sprachen"]).toMatchObject({ angelegt: 6, stillgelegt: 3 });
        expect(await zahl(`SELECT count(*)::int AS n FROM wiki_sprache_artikel`)).toBe(11);
    });

    it("🔴 Rechte: Die Jobs-Rolle schreibt den Wiki-Stand, nie den Schlüssel, löscht nie und fasst sprache_wiki nicht an; die App liest den Wiki-Stand nur", async () => {
        await neueWelt();
        for (const sql of [
            "UPDATE wiki_sprache_artikel SET schluessel = 'x' WHERE false",
            "UPDATE wiki_sprache_artikel SET public_id = gen_random_uuid() WHERE false",
            "DELETE FROM wiki_sprache_artikel WHERE false",
            "INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft) SELECT 1, 1, 0, 'import' WHERE false",
            "UPDATE sprache_wiki SET is_active = false WHERE false",
            "DELETE FROM sprache_wiki WHERE false",
        ]) {
            await expect(jobs().unsafe(sql), sql).rejects.toMatchObject({ code: "42501" });
        }
        for (const sql of [
            "INSERT INTO wiki_sprache_artikel (schluessel, titel, name, navigation, unbekannt) SELECT 'x', 'X', 'X', '{}', '{}' WHERE false",
            "UPDATE wiki_sprache_artikel SET titel = titel, name = name, sprachfamilie = sprachfamilie, navigation = navigation, unbekannt = unbekannt, is_active = is_active, retired_at = retired_at, retired_origin = retired_origin, revision = revision, updated_at = now() WHERE false",
            "SELECT id FROM wiki_sprache_artikel FOR UPDATE",
        ]) {
            await expect(jobs().unsafe(sql), sql).resolves.toBeDefined();
        }
        // Die App liest den Wiki-Stand und schreibt ihn nie; an sprache_wiki löscht sie nicht.
        await expect(cluster!.app`SELECT count(*)::int AS n FROM wiki_sprache_artikel`).resolves.toBeDefined();
        for (const sql of [
            "INSERT INTO wiki_sprache_artikel (schluessel, titel) SELECT 'x', 'X' WHERE false",
            "UPDATE wiki_sprache_artikel SET name = 'x' WHERE false",
            "DELETE FROM wiki_sprache_artikel WHERE false",
            "DELETE FROM sprache_wiki WHERE false",
        ]) {
            await expect(cluster!.app.unsafe(sql), sql).rejects.toMatchObject({ code: "42501" });
        }
        await expect(
            cluster!.app.unsafe("UPDATE sprache_wiki SET position = position, is_active = is_active WHERE false"),
        ).resolves.toBeDefined();
    });

    it("🔴 sprache_wiki: ein Artikel gehört höchstens einer aktiven Sprache, die Stelle ist je Sprache eindeutig; still gelegt darf er wieder zugeordnet werden", async () => {
        await neueWelt();
        await admin()`
            INSERT INTO sprache (schluessel, name, farbe, reihenfolge, herkunft) VALUES ('thorwalsch', 'Thorwalsch', '#1baad4', 1, 'sprachenkarte')
        `;
        const zuordnen = (sprache: string, artikelId: string, position: number) => admin()`
            INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
            SELECT s.id, a.id, ${position}, 'redaktion' FROM sprache s, wiki_sprache_artikel a WHERE s.schluessel = ${sprache} AND a.public_id = ${artikelId}::uuid
        `;
        // Horathi hängt schon an Garethi.
        await expect(zuordnen("thorwalsch", A.horathi, 0)).rejects.toMatchObject({ code: "23505" });
        // Stelle 0 von Garethi ist besetzt.
        await expect(zuordnen("garethi", A.thorwalsch, 0)).rejects.toMatchObject({ code: "23505" });
        await zuordnen("thorwalsch", A.thorwalsch, 0);
        // Still legen (nie löschen), dann darf der Artikel an eine andere Sprache.
        await admin()`
            UPDATE sprache_wiki SET is_active = false, retired_at = now(), retired_origin = 'editor'
             WHERE wiki_sprache_artikel_id = (SELECT id FROM wiki_sprache_artikel WHERE public_id = ${A.horathi}::uuid)
        `;
        await zuordnen("thorwalsch", A.horathi, 1);
        await expect(
            admin()`UPDATE sprache_wiki SET is_active = false WHERE sprache_id = (SELECT id FROM sprache WHERE schluessel = 'thorwalsch')`,
        ).rejects.toMatchObject({ code: "23514" });
        await expect(admin()`UPDATE sprache_wiki SET herkunft = 'wikisync' WHERE true`).rejects.toMatchObject({
            code: "23514",
        });
    });
});
