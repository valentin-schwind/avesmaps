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
import { importLore } from "../src/migration/lore-import.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeFlaechenTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { baueDump, neuerOrdner, type FixtureSeite } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Vorkommen im WikiSync (WI-0253, Scheibe Vorkommen, §23) gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS (alle Vorlagen unter `src/db/`). Die Jobs-Rolle rechnet und schreibt,
 * die Welt ist erfunden. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder in eine Umgebung; keiner fragt das Wiki.
 *
 * - **Vorschau:** Felder des Eintrags nach Vermerk, der Wiki-Stand (Rohtexte), Ortszeilen mit Rolle; ein Eintrag der Redaktion und einer ohne Wiki-Artikel; fehlender, umgeleiteter und andersartiger Artikel;
 *   ein Artikel ohne Eintrag ist ein Befund.
 * - **Übernahme:** Name, Gruppe (füllt, setzt den Vermerk „wiki“); unbelegter und eigener Wert bleiben; Ortszeilen: Rolle gesetzt, neu angelegt (nur `ort` trifft), still gelegt, Weiterleitung aufgelöst;
 *   manuelle Zeile und Tombstone bleiben. Eine Operation der Quelle `wikisync`, die Revision zählt, keine Ableitung; der zweite Lauf ohne Operation.
 * - **Rücknahme:** stellt Werte, Rollen, Zustand und Treffer her, den Wiki-Stand wieder auf „unbekannt“.
 * - **Rechte:** kein DELETE, nie Schlüssel oder Art, die App liest den Wiki-Stand nur. **Legacy-Zug:** Gehören die Vorkommen dem WikiSync, lässt Schritt I25 sie aus.
 */

const ENV = "wikisyncvork";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const uuid = (kopf: string, nummer: number): string =>
    `${kopf}0000000-0000-4000-9000-${String(nummer).padStart(12, "0")}`;
const E = {
    kauz: uuid("a", 1),
    zwerge: uuid("a", 2),
    redaktion: uuid("a", 3),
    ohneArtikel: uuid("a", 4),
    verschwunden: uuid("a", 5),
    andereArt: uuid("a", 6),
};
const O = {
    weiden: uuid("b", 1),
    perricum: uuid("b", 2),
    maraskan: uuid("b", 3),
    riva: uuid("b", 4),
    gareth: uuid("b", 5),
    thorwal: uuid("b", 6),
    ambossberge: uuid("b", 7),
};
const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

const DUMP: FixtureSeite[] = [
    {
        titel: "Waldkauz",
        ns: 0,
        text: [
            "{{Infobox Tierart",
            "|Name=Waldkauz",
            "|Art=[[Vogel]]",
            "|Weitere Namen=Eulenvogel",
            "|Vorkommen=[[Wald]]",
            "|Verbreitung=[[Weiden]], [[Perricum]], nicht [[Maraskan]], zwischen [[Riva]] und [[Gareth]], [[Myranor]]; [[Thorwal]], [[Nivesenlande]]",
            "}}",
            "{{Thumb|Waldkauz.jpg|Ein Bild, das nicht zählt}}",
            "Der '''Waldkauz''' ruft in der [[Nacht]]. Man hört ihn weit über die Felder.<ref>Ein Beleg.</ref> Er jagt kleine Nager. Ein vierter Satz fällt weg.",
        ].join("\n"),
    },
    {
        titel: "Zwerge",
        ns: 0,
        text: "{{Infobox Spezies\n|Name=Zwerge\n|Regionen=[[Ambossberge]]\n}}\nZwerge sind ein kleines Volk. Sie leben in den [[Ambossberge|Bergen]].",
    },
    {
        titel: "Im Auftrag der Redaktion",
        ns: 0,
        text: "{{Infobox Pflanzenart\n|Name=Redaktionspflanze\n|Art=Kraut\n|Verbreitung=[[Weiden]], [[Gareth]]\n}}\nEine Pflanze, die es nur im Wiki gibt.",
    },
    // Die Unterseite „Liste“ der Zwerge (WI-0299): Sie kommt in ihren Wiki-Stand; der Waldkauz hat keine.
    { titel: "Zwerge/Liste", ns: 0, text: "Bekannte Zwerge: [[Angrosch]]." },
    // Ein Artikel, dessen Infobox eine andere Art nennt als der Eintrag.
    { titel: "Wechselbalg", ns: 0, text: "{{Infobox Pflanzenart\n|Name=Wechselbalg\n|Verbreitung=[[Weiden]]\n}}" },
    // Ein Artikel ohne Eintrag.
    { titel: "Blaumeise", ns: 0, text: "{{Infobox Tierart\n|Name=Blaumeise\n|Verbreitung=[[Weiden]]\n}}" },
    // Linkziele und ihre Arten.
    { titel: "Weiden", ns: 0, text: "{{Infobox Region\n|Name=Weiden\n|Region=[[Aventurien]]\n}}\nWeiden." },
    { titel: "Aranien", ns: 0, text: "{{Infobox Region\n|Name=Aranien\n|Region=[[Aventurien]]\n}}" },
    { titel: "Perricum", ns: 0, text: "{{Infobox Siedlung\n|Name=Perricum\n|Region=[[Aranien]]\n}}" },
    { titel: "Maraskan", ns: 0, text: "{{Infobox Region\n|Name=Maraskan\n|Region=[[Aventurien]]\n}}" },
    { titel: "Riva", ns: 0, text: "{{Infobox Siedlung\n|Name=Riva\n|Region=[[Aventurien]]\n}}" },
    { titel: "Gareth", ns: 0, text: "{{Infobox Siedlung\n|Name=Gareth\n|Region=[[Aventurien]]\n}}" },
    { titel: "Ambossberge", ns: 0, text: "{{Infobox Region\n|Name=Ambossberge\n|Region=[[Aventurien]]\n}}" },
    { titel: "Nivesenlande", ns: 0, text: "{{Infobox Region\n|Name=Nivesenlande\n|Region=[[Aventurien]]\n}}" },
    { titel: "Thorwal", ns: 0, weiterleitung: "Thorwal (Region)" },
    { titel: "Thorwal (Region)", ns: 0, text: "{{Infobox Region\n|Name=Thorwal\n|Region=[[Aventurien]]\n}}" },
];

/** Eine Ortszeile des Bestands: Kennung (nur für den Test), Schlüssel, Beziehung, Stelle, Herkunft, Zustand, Rolle, wer sie still legte. */
interface Zeile {
    key: string;
    beziehung?: string;
    stelle: number;
    herkunft?: "wiki" | "manual" | "unknown";
    zustand?: "active" | "retired" | "suppressed";
    rolle?: string | null;
    stillVon?: string;
    system?: "legacy" | "editor" | "wikisync";
    ziel?: "editor" | "legacy_import";
}

function kontext(input: Record<string, unknown>, jobPublicId: string = randomUUID()): JobContext {
    return {
        input,
        attempt: 1,
        job: { id: 1, publicId: jobPublicId, leaseNo: 1, mapDomainId: "aventuria" },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    };
}

describeWithCluster("WikiSync Vorkommen: Vorschau, Übernahme und Rücknahme (Wegwerf-Cluster)", () => {
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
        const ergebnis = await runWikiVorschauJob(kontext({ bereiche: ["vorkommen"] }), {
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
        (await runWikiUebernehmenJob(kontext({ bereiche: ["vorkommen"] }), {
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
        return (await runWikiZuruecknehmenJob(kontext({ bereich: "vorkommen", lauf, uebernahme }, job!.public_id), {
            environment: einsatz,
            mitDatenbank: (arbeit) => arbeit(jobs()),
        })) as never;
    }

    // ── Die Welt ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    async function legeOrteAn(db: Database): Promise<void> {
        let x = 100;
        const ort = async (id: string, name: string, schluessel: string): Promise<void> => {
            x += 3;
            await db`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom)
                VALUES (${id}::uuid, 'aventuria', ${name}, 'dorf', ST_SetSRID(ST_MakePoint(${x}, 120), 0))
            `;
            await db`
                INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key) VALUES ('siedlung', ${id}::uuid, ${`wiki:${schluessel}`})
            `;
        };
        await ort(O.weiden, "Weiden", "weiden");
        await ort(O.perricum, "Perricum", "perricum");
        await ort(O.maraskan, "Maraskan", "maraskan");
        await ort(O.riva, "Riva", "riva");
        await ort(O.gareth, "Gareth", "gareth");
        await ort(O.thorwal, "Thorwal", "thorwal-region");
        await ort(O.ambossberge, "Ambossberge", "ambossberge");
    }

    async function legeEintrag(
        db: Database,
        id: string,
        art: string,
        spalten: {
            name: string;
            adresse: string | null;
            gruppe?: string | null;
            typ?: string | null;
            lebensraum?: string | null;
            synonyme?: string | null;
            continent?: string | null;
            kurzbeschreibung?: string | null;
            vermerke?: Record<string, "wiki" | "manual">;
            system?: "legacy" | "editor";
            zustand?: "active" | "suppressed";
        },
        zeilen: Zeile[] = [],
    ): Promise<void> {
        const system = spalten.system ?? "legacy";
        const [eintrag] = await db<{ id: string }[]>`
            INSERT INTO lore_entry (public_id, wiki_key, kind, name, wiki_title, wiki_url, gruppe, typ, lebensraum, synonyme, continent, kurzbeschreibung, legacy_origin, state, source_system, is_active,
                                    retired_at, retired_origin)
            VALUES (${id}::uuid, ${spalten.adresse === null ? null : spalten.name.toLowerCase().replaceAll(" ", "-")}, ${art}, ${spalten.name},
                    ${spalten.adresse === null ? null : spalten.name}, ${spalten.adresse}, ${spalten.gruppe ?? null}, ${spalten.typ ?? null},
                    ${spalten.lebensraum ?? null}, ${spalten.synonyme ?? null}, ${spalten.continent ?? null}, ${spalten.kurzbeschreibung ?? null}, ${system === "editor" ? "manual" : "wiki"},
                    ${spalten.zustand ?? "active"}, ${system}, ${(spalten.zustand ?? "active") === "active"},
                    ${(spalten.zustand ?? "active") === "active" ? null : new Date().toISOString()}, ${(spalten.zustand ?? "active") === "active" ? null : "editor"})
            RETURNING id::text AS id
        `;
        for (const [feld, origin] of Object.entries(spalten.vermerke ?? {})) {
            await db`INSERT INTO lore_entry_field_origin (lore_entry_id, field, origin) VALUES (${eintrag!.id}::bigint, ${feld}, ${origin})`;
        }
        for (const z of zeilen) {
            const zustand = z.zustand ?? "active";
            const aktiv = zustand === "active";
            const [reihe] = await db<{ id: string }[]>`
                INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count, target_origin,
                                        legacy_origin, state, source_system, is_active, retired_at, retired_origin, role)
                VALUES (${eintrag!.id}::bigint, ${z.key}, ${z.beziehung ?? "verbreitung"}, ${z.key}, ${z.stelle}, 'other', 'unmatched', 0, ${z.ziel ?? "legacy_import"},
                        ${z.herkunft ?? "wiki"}, ${zustand}, ${z.system ?? "legacy"}, ${aktiv}, ${aktiv ? null : new Date().toISOString()},
                        ${aktiv ? null : (z.stillVon ?? "legacy")}, ${z.rolle ?? null})
                RETURNING id::text AS id
            `;
            // Wie der Zug es schreibt: Ein aktiver Ort mit Träger trifft.
            const [traeger] = await db<{ id: string }[]>`
                SELECT p.id::text AS id FROM place p JOIN wiki_key_assignment x ON x.object_public_id = p.public_id AND x.wiki_key = ${`wiki:${z.key}`}
            `;
            if (aktiv && traeger !== undefined && (z.rolle ?? "ort") === "ort") {
                await db`INSERT INTO lore_place_target (lore_place_id, place_id) VALUES (${reihe!.id}::bigint, ${traeger.id}::bigint)`;
                await db`UPDATE lore_place SET target_state = 'resolved', target_count = 1 WHERE id = ${reihe!.id}::bigint`;
            }
        }
    }

    async function legeWeltAn(db: Database): Promise<void> {
        await legeOrteAn(db);
        // Waldkauz: Name folgt dem Wiki (Vermerk), Gruppe leer (füllen), Lebensraum ohne Vermerk (Befund), Synonyme eigen (manual).
        await legeEintrag(
            db,
            E.kauz,
            "fauna",
            {
                name: "Eule",
                adresse: wiki("Waldkauz"),
                lebensraum: "Wald",
                synonyme: "Kauz",
                vermerke: { name: "wiki", synonyme: "manual" },
            },
            [
                { key: "weiden", stelle: 0 },
                { key: "perricum", stelle: 1 },
                { key: "maraskan", stelle: 2 },
                // Legacy führt den Link unter dem Schlüssel des alten Titels (Weiterleitung nicht aufgelöst), ohne Treffer.
                { key: "thorwal", stelle: 3 },
                { key: "alt", stelle: 4 },
                { key: "handgemacht", stelle: 9999, herkunft: "manual", system: "editor", ziel: "editor" },
                { key: "nivesenlande", stelle: 5, zustand: "suppressed", stillVon: "legacy" },
            ],
        );
        await legeEintrag(
            db,
            E.zwerge,
            "spezies",
            {
                name: "Zwerge",
                adresse: wiki("Zwerge"),
                // Die Kurzbeschreibung steht von Hand da: Das Wiki füllt sie nicht, auch wenn es eine hat.
                kurzbeschreibung: "Von Hand geschrieben.",
                vermerke: { name: "wiki", kurzbeschreibung: "manual" },
            },
            [{ key: "ambossberge", beziehung: "regionen", stelle: 0 }],
        );
        await legeEintrag(
            db,
            E.redaktion,
            "flora",
            {
                name: "Meine Pflanze",
                adresse: wiki("Im Auftrag der Redaktion"),
                system: "editor",
                gruppe: "Mein Kraut",
                kurzbeschreibung: "Meine eigene Beschreibung.",
            },
            [{ key: "weiden", stelle: 0, herkunft: "manual", system: "editor" }],
        );
        await legeEintrag(db, E.ohneArtikel, "ware", { name: "Selbstgemacht", adresse: null, system: "editor" });
        await legeEintrag(db, E.verschwunden, "fauna", {
            name: "Verschwunden",
            adresse: wiki("Verschwunden"),
            vermerke: { name: "wiki" },
        });
        await legeEintrag(db, E.andereArt, "fauna", {
            name: "Wechselbalg",
            adresse: wiki("Wechselbalg"),
            vermerke: { name: "wiki" },
        });
    }

    async function neueWelt(): Promise<void> {
        await admin()`
            TRUNCATE map_audit_event, map_operation, wikisync_uebernahme_befund, wikisync_uebernahme, wikisync_lauf_zeile, wikisync_lauf, wikisync_bereich_setting,
                     lore_place_target, lore_place, lore_entry_field_origin, lore_entry_source, lore_rule_term_type, lore_rule_term, lore_rule, wiki_lore_snapshot, lore_entry,
                     wiki_key_assignment, place_wiki_assignment, place_detail, place
            RESTART IDENTITY CASCADE
        `;
        await admin()`UPDATE wikisync_bereich_state SET revision = 1`;
        await admin()`DELETE FROM job`;
        await legeWeltAn(admin());
    }

    const eintrag = async (id: string): Promise<Record<string, unknown>> =>
        (
            await wert<Record<string, unknown>>(
                `SELECT name, kind, gruppe, typ, lebensraum, synonyme, continent, kurzbeschreibung, wiki_url, source_system, revision::int AS revision,
                        (SELECT coalesce(jsonb_object_agg(o.field, o.origin), '{}'::jsonb) FROM lore_entry_field_origin o WHERE o.lore_entry_id = e.id) AS vermerke
                   FROM lore_entry e WHERE public_id = '${id}'`,
            )
        )[0]!;
    /** Die Ortszeilen eines Eintrags: Schlüssel → Beziehung, Zustand, Rolle, wer still legte, Trefferzahl, Herkunft. */
    const zeilen = async (id: string): Promise<Record<string, Record<string, unknown>>> => {
        const reihen = await wert<Record<string, unknown>>(
            `SELECT p.place_wiki_key AS schluessel, p.relation, p.state, p.role, p.retired_origin, p.target_state, p.target_count::int AS treffer, p.key_class,
                    (SELECT count(*)::int FROM lore_place_target t WHERE t.lore_place_id = p.id) AS ziele, p.legacy_origin, p.source_system, p.sort_order::int AS stelle,
                    p.place_title AS titel
               FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id WHERE e.public_id = '${id}' ORDER BY p.sort_order, p.id`,
        );
        return Object.fromEntries(reihen.map((reihe) => [String(reihe["schluessel"]), reihe]));
    };
    const stand = async (id: string): Promise<Record<string, unknown> | undefined> =>
        (
            await wert<Record<string, unknown>>(
                `SELECT s.name, s.gruppe, s.typ, s.lebensraum, s.synonyme, s.continent, s.kurzbeschreibung, s.verbreitung_roh, s.herkunft_roh, s.regionen_roh, s.vorkommen_roh, s.liste,
                        (SELECT array_agg(f ORDER BY f) FROM unnest(s.unbekannt) f) AS unbekannt
                   FROM wiki_lore_snapshot s JOIN lore_entry e ON e.id = s.lore_entry_id WHERE e.public_id = '${id}'`,
            )
        )[0];

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-vorkommen");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(DUMP));
        umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekte(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
            ladeFlaechenTitel: () => ladeFlaechenTitel(j),
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

    it("🔴 Vorschau: Felder nach Vermerk, Wiki-Stand, Ortszeilen mit Rolle; Eintrag der Redaktion, ohne Artikel, fehlend, andere Art, neuer Artikel", async () => {
        await neueWelt();
        const laufId = await vorschau();
        const [lauf] = await wert<{ zahlen: Record<string, Record<string, unknown>> }>(
            `SELECT zahlen FROM wikisync_lauf WHERE id = ${String(laufId)}`,
        );
        expect(lauf!.zahlen["vorkommen"]).toMatchObject({
            objekte: 6,
            mitAdresse: 5,
            // Der Eintrag der Redaktion ohne Wiki-Artikel wird nur gezählt, nie verglichen.
            kennungOhneWikiAdresse: 1,
            gefunden: 4,
            nichtImDump: 1,
            neueArtikel: 1,
            // Waldkauz: Weiden, Perricum (ort), Maraskan (ausgenommen), Riva, Gareth (bezugspunkt), Myranor (andere_welt), Thorwal (ort), Nivesenlande (ort, Tombstone); dazu Ambossberge der Zwerge und Weiden, Gareth der Pflanze der Redaktion.
            rollen: { ort: 7, ausgenommen: 1, bezugspunkt: 2, andere_welt: 1 },
            weiterleitungen: 1,
            rueckfragen: 0,
        });
        const zeilen = await wert<{
            objekt_id: string | null;
            objekt_name: string;
            feld: string | null;
            eigentuemer: string;
            wirkung: string;
            status: string;
            befund: string | null;
            grund: string | null;
            alt: string | null;
            neu: string | null;
        }>(
            `SELECT objekt_id::text, objekt_name, feld, eigentuemer, wirkung, status, befund, grund, alt, neu FROM wikisync_lauf_zeile
              WHERE lauf_id = ${String(laufId)} AND bereich = 'vorkommen' ORDER BY id`,
        );
        const von = (id: string): string[] =>
            zeilen
                .filter(
                    (zeile) => zeile.objekt_id === id && zeile.feld !== null && !zeile.feld.startsWith("ortszeile_"),
                )
                .map((zeile) => `${zeile.feld}:${zeile.eigentuemer}:${zeile.wirkung}`);
        // Waldkauz: Name folgt (Vermerk wiki), Gruppe füllt, Lebensraum ohne Vermerk = Befund, Synonyme eigen; dazu die Rohtexte des Wiki-Stands.
        expect(von(E.kauz)).toEqual([
            "name:wiki:uebernommen",
            "gruppe:wiki:uebernommen",
            "lebensraum:unbekannt:befund",
            "synonyme:manual:eigen",
            // Die Kurzbeschreibung kommt aus dem Text des Artikels: höchstens drei Sätze, ohne Bild und Einzelnachweis; der Eintrag hat keine und keinen Vermerk.
            "kurzbeschreibung:wiki:uebernommen",
            "roh_verbreitung:wiki:uebernommen",
            "roh_vorkommen:wiki:uebernommen",
        ]);
        expect(zeilen.find((zeile) => zeile.objekt_id === E.kauz && zeile.feld === "kurzbeschreibung")).toMatchObject({
            alt: null,
            neu: "Der Waldkauz ruft in der Nacht. Man hört ihn weit über die Felder. Er jagt kleine Nager.",
        });
        // Die Redaktion und der Vermerk „von Hand“ halten ihre Beschreibung: Das Wiki ändert sie nicht, die Abweichung ist eine eigene Entscheidung.
        for (const id of [E.redaktion, E.zwerge])
            expect(von(id).filter((zeile) => zeile.startsWith("kurzbeschreibung:"))).toEqual([
                "kurzbeschreibung:manual:eigen",
            ]);
        // Der Eintrag der Redaktion: jede Abweichung ist eine eigene Entscheidung.
        expect(
            von(E.redaktion).every((zeile) => zeile.includes(":manual:eigen") || zeile.includes(":wiki:uebernommen")),
        ).toBe(true);
        expect(von(E.redaktion).filter((zeile) => zeile.startsWith("name:") || zeile.startsWith("gruppe:"))).toEqual([
            "name:manual:eigen",
            "gruppe:manual:eigen",
        ]);
        // Befunde zum Artikel.
        const befunde = zeilen
            .filter((zeile) => zeile.feld === null)
            .map((zeile) => [zeile.objekt_name, zeile.befund, zeile.grund]);
        expect(befunde).toEqual([
            ["Verschwunden", "artikel_nicht_im_dump", null],
            ["Wechselbalg", "infobox_kaputt", "andere_art:flora"],
            ["Blaumeise", "neuer_artikel", "Infobox Tierart"],
        ]);
        // Ortszeilen des Waldkauzes: Rolle, angelegt, ersetzt, still gelegt; Tombstone und Handarbeit bleiben.
        const orte = zeilen.filter(
            (zeile) => zeile.objekt_id === E.kauz && zeile.feld?.startsWith("ortszeile_") === true,
        );
        const kurz = orte.map((zeile) => {
            const bis = (w: string | null): string => (w === null ? "-" : w.split(" · ").slice(-2).join(":"));
            return `${bis(zeile.alt)}>${bis(zeile.neu)} ${zeile.eigentuemer}/${zeile.wirkung}/${zeile.status}`;
        });
        // In der Reihenfolge des Artikels. Weiden und Perricum stimmen (keine Zeile); der Bestand ohne Rolle gilt als Ort.
        expect(kurz).toEqual([
            "ort:maraskan>ausgenommen:maraskan wiki/uebernommen/geaendert",
            "->bezugspunkt:riva wiki/uebernommen/neu",
            "->bezugspunkt:gareth wiki/uebernommen/neu",
            "->andere_welt:myranor wiki/uebernommen/neu",
            // Die Weiterleitung am Ziel ist aufgelöst: Legacy führt den Link unter dem alten Schlüssel, der WikiSync setzt die Zeile auf den Artikel dahinter.
            "ort:thorwal>ort:thorwal-region wiki/uebernommen/geaendert",
            // Die Zeile des Tombstones ist ein Befund und wird nie angelegt.
            "->ort:nivesenlande unterdrueckt/befund/unterdrueckt",
            "ort:alt>- wiki/uebernommen/zu_entfernen",
        ]);
        // Die manuelle Zeile sieht der Abgleich nicht.
        expect(
            orte.some(
                (zeile) => zeile.neu?.includes("handgemacht") === true || zeile.alt?.includes("handgemacht") === true,
            ),
        ).toBe(false);
        // Angelegt wird in der Vorschau nichts.
        expect(await zahl(`SELECT count(*)::int AS n FROM lore_place`)).toBe(9);
        expect(await zahl(`SELECT count(*)::int AS n FROM wiki_lore_snapshot`)).toBe(0);
    });

    it("🔴 Übernahme: Felder nach Vermerk, Ortszeilen mit Rolle (nur ‚ort‘ trifft), angelegt und still gelegt, Weiterleitung aufgelöst; Tombstone, Handarbeit und Redaktion bleiben; zweiter Lauf ohne Operation", async () => {
        await neueWelt();
        const laufId = await vorschau();
        const vorher = {
            kauz: await eintrag(E.kauz),
            zwerge: await eintrag(E.zwerge),
            redaktion: await eintrag(E.redaktion),
            ohneArtikel: await eintrag(E.ohneArtikel),
        };
        const redaktionZeilen = await zeilen(E.redaktion);
        const ergebnis = await uebernehmen();
        expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
        // Kauz: Name, Gruppe, Lebensraum (Wiki-Stand), Synonyme (Wiki-Stand), Kurzbeschreibung, zwei Rohtexte; Zwerge: ein Rohtext, die Kurzbeschreibung (nur im Wiki-Stand, die Hand hält sie) und
        // die Unterseite „Liste“ (WI-0299, nur im Wiki-Stand); dazu sechs Schritte an den Ortszeilen.
        expect(ergebnis.bereiche[0]!.zahlen).toMatchObject({
            objekte: 2,
            felder: 16,
            liste: 6,
            angelegt: 4,
            stillgelegt: 2,
        });
        const uebernahmeId = ergebnis.bereiche[0]!.uebernahme!;

        // Die Felder: der Name folgt dem Wiki (Vermerk), die leere Gruppe wird gefüllt und bekommt den Vermerk; unbelegter und eigener Wert bleiben.
        expect(await eintrag(E.kauz)).toMatchObject({
            name: "Waldkauz",
            gruppe: "[[Vogel]]",
            lebensraum: "Wald",
            synonyme: "Kauz",
            continent: null,
            // Die Kurzbeschreibung aus dem Wiki-Text: drei Sätze, ohne Bild, Einzelnachweis und Auszeichnung, mit dem Vermerk „wiki“.
            kurzbeschreibung:
                "Der Waldkauz ruft in der Nacht. Man hört ihn weit über die Felder. Er jagt kleine Nager.",
            vermerke: { name: "wiki", gruppe: "wiki", synonyme: "manual", kurzbeschreibung: "wiki" },
            revision: (vorher.kauz["revision"] as number) + 1,
            kind: "fauna",
            wiki_url: vorher.kauz["wiki_url"],
            source_system: "legacy",
        });
        // Der Wiki-Stand: die Wiki-Werte der gelesenen Felder und die Rohtexte; was nie gelesen wurde, bleibt „unbekannt“.
        expect(await stand(E.kauz)).toMatchObject({
            name: "Waldkauz",
            gruppe: "[[Vogel]]",
            typ: null,
            lebensraum: "[[Wald]]",
            synonyme: "Eulenvogel",
            verbreitung_roh:
                "[[Weiden]], [[Perricum]], nicht [[Maraskan]], zwischen [[Riva]] und [[Gareth]], [[Myranor]]; [[Thorwal]], [[Nivesenlande]]",
            vorkommen_roh: "[[Wald]]",
            kurzbeschreibung:
                "Der Waldkauz ruft in der Nacht. Man hört ihn weit über die Felder. Er jagt kleine Nager.",
            // Ohne Unterseite „Liste“ (WI-0299) gibt es nichts zu schreiben: Das Feld bleibt unbekannt, wie Kontinent und Typ.
            liste: null,
            unbekannt: ["continent", "liste", "roh_herkunft", "roh_regionen", "typ"],
        });
        // Die Zwerge: Die Beschreibung von Hand bleibt (Vermerk „von Hand“), der Wiki-Stand hält, was das Wiki sagt.
        expect(await eintrag(E.zwerge)).toMatchObject({
            kurzbeschreibung: "Von Hand geschrieben.",
            vermerke: { name: "wiki", kurzbeschreibung: "manual" },
        });
        expect(await stand(E.zwerge)).toMatchObject({
            regionen_roh: "[[Ambossberge]]",
            name: null,
            kurzbeschreibung: "Zwerge sind ein kleines Volk. Sie leben in den Bergen.",
            // Die Unterseite aus dem Dump (WI-0299): der Titel, wie der Dump ihn führt.
            liste: "Zwerge/Liste",
        });
        // 🔴 Die Redaktion bleibt, samt Revision und Liste; der Eintrag ohne Artikel auch.
        expect(await eintrag(E.redaktion)).toEqual(vorher.redaktion);
        expect(await zeilen(E.redaktion)).toEqual(redaktionZeilen);
        expect(await eintrag(E.ohneArtikel)).toEqual(vorher.ohneArtikel);
        expect(await stand(E.redaktion)).toBeUndefined();

        // Die Ortszeilen.
        const z = await zeilen(E.kauz);
        // Unverändert: Weiden und Perricum behalten Rolle (keine), Herkunft und Treffer.
        expect(z["weiden"]).toMatchObject({
            state: "active",
            role: null,
            ziele: 1,
            target_state: "resolved",
            legacy_origin: "wiki",
        });
        expect(z["perricum"]).toMatchObject({ state: "active", role: null, ziele: 1 });
        // Maraskan wird ausgenommen: Der Link bleibt, der Treffer geht.
        expect(z["maraskan"]).toMatchObject({
            state: "active",
            role: "ausgenommen",
            ziele: 0,
            target_state: "unmatched",
            treffer: 0,
            key_class: "other",
        });
        // Neu: Riva und Gareth sind Bezugspunkte (die Träger gibt es, sie treffen trotzdem nicht), Myranor ist eine andere Welt (kein Kontinentbegriff, der „überall“ gälte).
        for (const schluessel of ["riva", "gareth", "myranor"]) {
            expect(z[schluessel], schluessel).toMatchObject({
                state: "active",
                legacy_origin: "wiki",
                source_system: "wikisync",
                ziele: 0,
                target_state: "unmatched",
                key_class: "other",
            });
        }
        expect(z["riva"]!["role"]).toBe("bezugspunkt");
        expect(z["gareth"]!["role"]).toBe("bezugspunkt");
        expect(z["myranor"]!["role"]).toBe("andere_welt");
        // Die Stellen laufen hinter der letzten Zeile des Wikis weiter (von Hand hinzugefügte tragen 9999).
        expect([z["riva"]!["stelle"], z["gareth"]!["stelle"], z["myranor"]!["stelle"]]).toEqual([6, 7, 8]);
        // Die Weiterleitung ist aufgelöst: die alte Zeile still gelegt (vom WikiSync), die neue trifft den Artikel dahinter.
        expect(z["thorwal"]).toMatchObject({ state: "retired", retired_origin: "wikisync" });
        expect(z["thorwal-region"]).toMatchObject({
            state: "active",
            role: "ort",
            ziele: 1,
            target_state: "resolved",
            source_system: "wikisync",
        });
        // Nicht mehr genannt: still gelegt, nie gelöscht.
        expect(z["alt"]).toMatchObject({ state: "retired", retired_origin: "wikisync" });
        // Die Handarbeit und der Tombstone bleiben, wie sie waren; der Tombstone lebt nicht auf.
        expect(z["handgemacht"]).toMatchObject({
            state: "active",
            legacy_origin: "manual",
            source_system: "editor",
            stelle: 9999,
            role: null,
        });
        expect(z["nivesenlande"]).toMatchObject({ state: "suppressed", retired_origin: "legacy" });
        expect(await zahl(`SELECT count(*)::int AS n FROM lore_place`)).toBe(13);
        // Die Zwerge: nur der Wiki-Stand (ihre Zeile stimmt).
        expect((await zeilen(E.zwerge))["ambossberge"]).toMatchObject({ state: "active", role: null, ziele: 1 });

        // Eine Operation der Quelle wikisync mit einem Eintrag je berührtem Eintrag; keine Ableitung.
        const [op] = await wert<{ source: string; action: string; operation_id: string }>(
            `SELECT source, action, operation_id::text FROM map_operation ORDER BY seq DESC LIMIT 1`,
        );
        expect(op).toMatchObject({ source: "wikisync", action: "wikisync.uebernehmen" });
        const eintraege = await wert<{
            lore: string;
            revision_before: number;
            revision_after: number;
            changes: Record<string, { before: unknown; after: unknown }>;
        }>(
            `SELECT lore_public_id::text AS lore, revision_before::int, revision_after::int, changes FROM map_audit_event
              WHERE operation_id = '${op!.operation_id}' AND action = 'lore.wikisync_uebernommen' ORDER BY lore_public_id`,
        );
        expect(eintraege.map((e) => e.lore)).toEqual([E.kauz, E.zwerge]);
        const kauz = eintraege[0]!;
        expect(kauz.revision_after).toBe(kauz.revision_before + 1);
        expect(kauz.changes["name"]).toEqual({ before: "Eule", after: "Waldkauz" });
        expect(kauz.changes["gruppe"]).toEqual({ before: null, after: "[[Vogel]]" });
        expect(kauz.changes["wikiName"]).toEqual({ before: null, after: "Waldkauz" });
        expect(kauz.changes["wikiNameUnbekannt"]).toEqual({ before: true, after: false });
        expect(kauz.changes["kurzbeschreibung"]).toEqual({
            before: null,
            after: "Der Waldkauz ruft in der Nacht. Man hört ihn weit über die Felder. Er jagt kleine Nager.",
        });
        expect(kauz.changes["wikiKurzbeschreibungUnbekannt"]).toEqual({ before: true, after: false });
        const orte = kauz.changes["places"] as {
            before: { role: string; state: string; wikiKey: string }[];
            after: { role: string; state: string; wikiKey: string }[];
        };
        expect(orte.after.map((o) => `${o.wikiKey}:${o.state}:${o.role}`).sort()).toEqual([
            "alt:retired:ort",
            "gareth:active:bezugspunkt",
            "maraskan:active:ausgenommen",
            "myranor:active:andere_welt",
            "riva:active:bezugspunkt",
            "thorwal-region:active:ort",
            "thorwal:retired:ort",
        ]);
        expect(orte.before.map((o) => `${o.wikiKey}:${o.state}:${o.role}`).sort()).toEqual([
            "alt:active:ort",
            "maraskan:active:ort",
            "thorwal:active:ort",
        ]);
        expect(
            await zahl(`SELECT count(*)::int AS n FROM job WHERE state = 'QUEUED' AND kind NOT LIKE 'wiki\\_%'`),
        ).toBe(0);

        // Der zweite Lauf ändert nichts: Der Wiki-Stand macht das Wiki nicht zum Dauerbefund (Lebensraum ohne Vermerk, eigene Synonyme).
        const zweiter = await vorschau();
        const zeilenNoch = await wert<{ feld: string; wirkung: string }>(
            `SELECT feld, wirkung FROM wikisync_lauf_zeile WHERE lauf_id = ${String(zweiter)} AND objekt_id = '${E.kauz}' AND feld IS NOT NULL ORDER BY id`,
        );
        // Nur der Tombstone bleibt eine Nachricht (das Wiki nennt Nivesenlande weiter); keine Felder, keine anderen Orte.
        expect(zeilenNoch.map((zeile) => zeile.feld.slice(0, 10))).toEqual(["ortszeile_"]);
        const noch = await uebernehmen();
        expect(noch.bereiche[0]).toMatchObject({ status: "fertig", operationId: null });

        // Rücknahme: Werte, Rollen, Zustand und Treffer kehren zurück; der Wiki-Stand wird wieder „unbekannt“.
        const rueck = await zuruecknehmen(laufId, uebernahmeId);
        expect(rueck.status).toBe("fertig");
        expect(await eintrag(E.kauz)).toMatchObject({
            name: "Eule",
            gruppe: null,
            synonyme: "Kauz",
            lebensraum: "Wald",
            kurzbeschreibung: null,
        });
        const nach = await zeilen(E.kauz);
        expect(nach["maraskan"]).toMatchObject({
            state: "active",
            role: "ort",
            ziele: 1,
            target_state: "resolved",
            key_class: "other",
        });
        for (const schluessel of ["riva", "gareth", "myranor", "thorwal-region"]) {
            expect(nach[schluessel], schluessel).toMatchObject({ state: "retired", retired_origin: "wikisync" });
        }
        expect(nach["thorwal"]).toMatchObject({ state: "active", role: "ort" });
        expect(nach["alt"]).toMatchObject({ state: "active" });
        expect(nach["handgemacht"]).toMatchObject({ state: "active", legacy_origin: "manual" });
        expect(nach["nivesenlande"]).toMatchObject({ state: "suppressed" });
        expect(await stand(E.kauz)).toMatchObject({
            name: null,
            gruppe: null,
            lebensraum: null,
            kurzbeschreibung: null,
            verbreitung_roh: null,
            unbekannt: [
                "continent",
                "gruppe",
                "kurzbeschreibung",
                "lebensraum",
                "liste",
                "name",
                "roh_herkunft",
                "roh_regionen",
                "roh_verbreitung",
                "roh_vorkommen",
                "synonyme",
                "typ",
            ],
        });
        // Die Zwerge: Die Rücknahme nimmt auch die Unterseite „Liste“ aus dem Wiki-Stand (WI-0299).
        expect(await stand(E.zwerge)).toMatchObject({ liste: null });
        expect((await stand(E.zwerge))?.["unbekannt"]).toContain("liste");
        expect(await eintrag(E.redaktion)).toEqual(vorher.redaktion);
    });

    it("🔴 Stand von jetzt: Was sich seit der Vorschau änderte, wird nicht überschrieben (Name von Hand, Zeile der Redaktion, Zeile schon fort)", async () => {
        await neueWelt();
        await vorschau();
        // Seit der Vorschau: Die Redaktion hat den Namen gesetzt (manual), Maraskan zur eigenen Zeile gemacht und 'alt' entfernt.
        await admin()`UPDATE lore_entry SET name = 'Handarbeit' WHERE public_id = ${E.kauz}::uuid`;
        await admin()`
            UPDATE lore_entry_field_origin SET origin = 'manual'
             WHERE field = 'name' AND lore_entry_id = (SELECT id FROM lore_entry WHERE public_id = ${E.kauz}::uuid)
        `;
        await admin()`
            UPDATE lore_place SET legacy_origin = 'manual', source_system = 'editor', target_origin = 'editor'
             WHERE place_wiki_key = 'maraskan' AND lore_entry_id = (SELECT id FROM lore_entry WHERE public_id = ${E.kauz}::uuid)
        `;
        await admin()`
            UPDATE lore_place SET state = 'suppressed', is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE place_wiki_key = 'alt' AND lore_entry_id = (SELECT id FROM lore_entry WHERE public_id = ${E.kauz}::uuid)
        `;
        const ergebnis = await uebernehmen();
        expect(ergebnis.bereiche[0]).toMatchObject({ status: "fertig" });
        expect(await eintrag(E.kauz)).toMatchObject({ name: "Handarbeit", gruppe: "[[Vogel]]" });
        const z = await zeilen(E.kauz);
        // Maraskan gehört der Redaktion: Rolle und Treffer bleiben; 'alt' bleibt, wie die Redaktion es ließ (Tombstone).
        expect(z["maraskan"]).toMatchObject({ role: null, ziele: 1, legacy_origin: "manual" });
        expect(z["alt"]).toMatchObject({ state: "suppressed", retired_origin: "editor" });
        const befunde = await wert<{ feld: string; befund: string }>(
            `SELECT feld, befund FROM wikisync_uebernahme_befund WHERE uebernahme_id = ${String(ergebnis.bereiche[0]!.uebernahme)} ORDER BY id`,
        );
        expect(befunde.filter((befund) => befund.feld === "name")).toEqual([
            { feld: "name", befund: "seit_vorschau_geaendert" },
        ]);
        expect(befunde.filter((befund) => befund.feld.startsWith("ortszeile_")).length).toBe(1);
        // Die übrigen Zeilen wurden trotzdem geschrieben (jede Zeile für sich).
        expect(z["riva"]).toMatchObject({ state: "active", role: "bezugspunkt" });
    });

    it("🔴 Legacy-Zug: Gehören die Vorkommen dem WikiSync, lässt Schritt I25 sie aus", async () => {
        await neueWelt();
        const vorherN = await zahl(`SELECT count(*)::int AS n FROM lore_place`);
        const bericht = await importLore(cluster!.migrator, {
            entries: [],
            places: [],
            rules: [],
            sources: [],
            links: [],
        });
        expect(bericht.skipped).toBe(true);
        expect(bericht.findings.map((befund) => befund.code)).toContain("bereich_wikisync");
        expect(await zahl(`SELECT count(*)::int AS n FROM lore_place`)).toBe(vorherN);
    });

    it("🔴 Rechte: Die Jobs-Rolle schreibt Felder, Rolle und Zustand, nie Schlüssel, Art, Adresse oder Herkunft, löscht nichts außer Treffern; die App liest den Wiki-Stand nur", async () => {
        await neueWelt();
        const verboten = [
            "UPDATE lore_entry SET kind = 'flora' WHERE false",
            "UPDATE lore_entry SET wiki_url = 'https://x.example/' WHERE false",
            "UPDATE lore_entry SET wiki_key = 'x' WHERE false",
            "UPDATE lore_entry SET source_system = 'editor' WHERE false",
            "UPDATE lore_entry SET state = 'retired' WHERE false",
            "UPDATE lore_entry SET editor_note = 'x' WHERE false",
            "DELETE FROM lore_entry WHERE false",
            "UPDATE lore_place SET place_wiki_key = 'x' WHERE false",
            "UPDATE lore_place SET relation = 'herkunft' WHERE false",
            "UPDATE lore_place SET lore_entry_id = 1 WHERE false",
            "UPDATE lore_place SET target_origin = 'editor' WHERE false",
            "UPDATE lore_place SET source_system = 'editor' WHERE false",
            "UPDATE lore_place SET legacy_origin = 'manual' WHERE false",
            "UPDATE lore_place SET sort_order = 1 WHERE false",
            "DELETE FROM lore_place WHERE false",
            "UPDATE lore_place_target SET place_id = 1 WHERE false",
            "DELETE FROM wiki_lore_snapshot WHERE false",
            "UPDATE wiki_lore_snapshot SET lore_entry_id = 1 WHERE false",
            "DELETE FROM lore_entry_field_origin WHERE false",
            "UPDATE lore_entry_field_origin SET origin = 'wiki' WHERE false",
            "DELETE FROM feature_source WHERE false",
        ];
        for (const sql of verboten) {
            await expect(jobs().unsafe(sql), sql).rejects.toMatchObject({ code: "42501" });
        }
        const erlaubt = [
            "UPDATE lore_entry SET name = name, gruppe = gruppe, typ = typ, lebensraum = lebensraum, synonyme = synonyme, continent = continent, kurzbeschreibung = kurzbeschreibung, revision = revision WHERE false",
            "INSERT INTO lore_entry_field_origin (lore_entry_id, field, origin) SELECT 1, 'kurzbeschreibung', 'wiki' WHERE false",
            "INSERT INTO lore_entry_field_origin (lore_entry_id, field, origin) SELECT 1, 'name', 'wiki' WHERE false",
            "UPDATE lore_place SET role = 'teil', place_title = place_title, key_class = key_class, target_state = target_state, target_count = target_count, state = state, is_active = is_active, retired_at = retired_at, retired_origin = retired_origin, updated_at = now() WHERE false",
            "INSERT INTO lore_place_target (lore_place_id, place_id) SELECT 1, 1 WHERE false",
            "DELETE FROM lore_place_target WHERE false",
            "INSERT INTO wiki_lore_snapshot (lore_entry_id) SELECT 1 WHERE false",
            "UPDATE wiki_lore_snapshot SET name = 'x', kurzbeschreibung = 'x', verbreitung_roh = 'x', unbekannt = unbekannt, updated_at = now() WHERE false",
        ];
        for (const sql of erlaubt) await expect(jobs().unsafe(sql), sql).resolves.toBeDefined();
        // Die App liest den Wiki-Stand und schreibt ihn nie.
        await expect(cluster!.app`SELECT count(*)::int AS n FROM wiki_lore_snapshot`).resolves.toBeDefined();
        for (const sql of [
            "INSERT INTO wiki_lore_snapshot (lore_entry_id) SELECT 1 WHERE false",
            "UPDATE wiki_lore_snapshot SET name = 'x' WHERE false",
            "DELETE FROM wiki_lore_snapshot WHERE false",
        ]) {
            await expect(cluster!.app.unsafe(sql), sql).rejects.toMatchObject({ code: "42501" });
        }
    });
});
