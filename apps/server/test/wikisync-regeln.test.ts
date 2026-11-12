import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { WikisyncRegelFlaechen, WikisyncRegelListe, type WikisyncRegelVorschlag } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { ladeZustaende } from "../src/editor/history-status.ts";
import { mapOperation, type MapActor } from "../src/editor/map-operation.ts";
import { inhalteOperation } from "../src/inhalte/operation.ts";
import { leseVorkommen } from "../src/inhalte/vorkommen-lesen.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeFlaechenTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { importRegions } from "../src/migration/region-import.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { regelSchluessel, type Bed } from "../src/wiki/regeln/ableiten.ts";
import { aendereBegriffe, leseBegriffe, leseRegelListe } from "../src/wiki/regeln/anzeige.ts";
import { BEGRIFFE_VORGABE } from "../src/wiki/regeln/begriffe.ts";
import {
    OPERATION_WIEDER,
    OPERATION_ZUWEISEN,
    OPERATION_ZURUECK,
    leseOffeneFlaechen,
    nimmFlaecheZuweisungZurueck,
    stelleFlaecheZuweisungWiederHer,
    weiseFlaecheZu,
    wiederherstellungSteht,
    zuweisungSteht,
} from "../src/wiki/regeln/flaechen.ts";
import { ladeRegelKontext } from "../src/wiki/regeln/laden.ts";
import { nimmRegelnZurueck, stelleRegelnWiederHer, uebernimmRegeln } from "../src/wiki/regeln/uebernehmen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { baueDump, neuerOrdner, type FixtureSeite } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Regelvorschläge der Vorkommen und die Begriffstafel (WI-0253 Scheibe Regelvorschläge, §24) gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS (alle Vorlagen unter `src/db/`). Die
 * Jobs-Rolle rechnet die Vorschläge im Lauf der Vorschau, die App-Rolle liest sie, speichert die Begriffstafel und übernimmt die ausgewählten Vorschläge. Die Welt ist erfunden.
 * 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder in eine Umgebung; keiner fragt das Wiki.
 *
 * - **Ableitung:** Ein Lauf der Vorschau (Bereich `vorkommen`) legt Kopf, Vorschläge und Wörter ab, schreibt aber in keine Fachtafel (`lore_rule` bleibt, wie sie war).
 * - **Pflichtfälle (Akzeptanzkriterium 6):** vollständig (Bremse, vorgewählt), unvollständig (Aranische Wassernuss), negiert (Wachtel), Wirselkraut mit `ohne` und der offenen Fläche, mehrdeutig (Krebsschere),
 *   wartend (F4), eine Regel der Redaktion, ein Eintrag der Redaktion, geändert, entfallen.
 * - **Begriffstafel (F5):** Startwerte, eine Pille speichert sofort (Revision hebt der Trigger), die Liste ist danach veraltet, die nächste Ableitung liest die Tafel, ↺ löscht die Zeile.
 * - **Wortfamilien (F5):** Die Formen eines Worts sind eine Zeile; jede Form wird angenommen und unter dem Kopfwort gespeichert, die Suche findet auch über die Formen, eine ältere Zeile unter einer Nicht-Kopf-Form gilt und wird beim Schreiben abgeräumt.
 * - **Übernahme:** nur die ausgewählten; manuelle Regel und Eintrag der Redaktion bleiben; ein bewegter Stand bleibt liegen; Rücknahme je Übernahme; Rechte der App und der Jobs-Rolle.
 * - **Fläche zuweisen (§25):** Eine Fläche gleichen Namens ohne Wiki-Schlüssel bekommt den Artikel, auf den eine Regel wartet; die nächste Ableitung findet sie. Verweigert wird bei vorhandenem Schlüssel, anderem
 *   Namen, einem Titel ohne passenden Kandidaten im Protokoll, einem Artikel, den schon eine Fläche trägt, und mehreren gleichnamigen Flächen. Die Rücknahme geht nur, solange die Zuordnung noch die Zuweisung
 *   ist. Der Legacy-Zug (Import der Landschaften) lässt eine so gesetzte Zuordnung stehen und holt sie nach der Rücknahme wieder auf Legacys Stand.
 */

const ENV = "wikisyncregeln";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const uuid = (kopf: string, nummer: number): string =>
    `${kopf}0000000-0000-4000-9000-${String(nummer).padStart(12, "0")}`;
const E = {
    bremse: uuid("a", 1),
    wirsel: uuid("a", 2),
    nuss: uuid("a", 3),
    wachtel: uuid("a", 4),
    krebs: uuid("a", 5),
    hand: uuid("a", 6),
    redaktion: uuid("a", 7),
    altlast: uuid("a", 8),
    weg: uuid("a", 9),
};
const F = {
    aventurien: uuid("b", 1),
    meridiana: uuid("b", 2),
    orkland: uuid("b", 3),
    aranien: uuid("b", 4),
    bornland: uuid("b", 5),
    maraskanRegion: uuid("b", 6),
    maraskanInsel: uuid("b", 7),
    fluss: uuid("b", 8),
    sued: uuid("b", 9),
};
const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

const BREMSE_VERBREITUNG = "[[Aventurien]]: [[Meridiana]], [[Orkland]]";
const BREMSE_LEBENSRAUM = "[[Sumpf|Sümpfe]], [[Steppe]]n (u.a.)";
const DUMP: FixtureSeite[] = [
    {
        titel: "Bremse",
        ns: 0,
        text: `{{Infobox Tierart\n|Name=Bremse\n|Vorkommen=${BREMSE_LEBENSRAUM}\n|Verbreitung=${BREMSE_VERBREITUNG}\n}}\nEine Bremse.`,
    },
    {
        titel: "Wirselkraut",
        ns: 0,
        text: "{{Infobox Pflanzenart\n|Name=Wirselkraut\n|Vorkommen=ganz Aventurien in [[Steppe]]n und [[Graslandschaft]]en\n|Verbreitung=ganz [[Aventurien]] außer Ewiges Eis und Wüste, entlang des [[Der Große Fluss|Großen Flusses]], [[Bornland (Region)|Bornland]]; [[Myranor]]\n}}\nEin Kraut.",
    },
    {
        titel: "Aranische Wassernuss",
        ns: 0,
        text: "{{Infobox Pflanzenart\n|Name=Aranische Wassernuss\n|Vorkommen=[[Sumpf|Sümpfe]], Marschen und [[Moor]]e\n|Verbreitung=häufig in [[Aranien]], südlich der Linie [[Perricum]] und [[Havena (Siedlung)|Havena]] gelegentlich\n}}\nEine Nuss.",
    },
    {
        titel: "Wachtel",
        ns: 0,
        text: "{{Infobox Tierart\n|Name=Wachtel\n|Verbreitung=[[Aventurien]], nicht [[Maraskan]]\n}}\nEin Vogel.",
    },
    {
        titel: "Krebsschere",
        ns: 0,
        text: "{{Infobox Pflanzenart\n|Name=Krebsschere\n|Vorkommen=Gewässer\n|Verbreitung=[[Südaventurien]]\n}}\nEine Wasserpflanze.",
    },
    {
        titel: "Handarbeit",
        ns: 0,
        text: `{{Infobox Tierart\n|Name=Handarbeit\n|Vorkommen=${BREMSE_LEBENSRAUM}\n|Verbreitung=${BREMSE_VERBREITUNG}\n}}`,
    },
    {
        titel: "Redaktionspflanze",
        ns: 0,
        text: `{{Infobox Pflanzenart\n|Name=Redaktionspflanze\n|Vorkommen=${BREMSE_LEBENSRAUM}\n|Verbreitung=${BREMSE_VERBREITUNG}\n}}`,
    },
    {
        titel: "Altlast",
        ns: 0,
        text: `{{Infobox Tierart\n|Name=Altlast\n|Vorkommen=${BREMSE_LEBENSRAUM}\n|Verbreitung=${BREMSE_VERBREITUNG}\n}}`,
    },
    { titel: "Weggefallen", ns: 0, text: "{{Infobox Tierart\n|Name=Weggefallen\n|Verbreitung=[[Aventurien]]: ?\n}}" },
    // Die Linkziele und ihre Arten.
    { titel: "Meridiana", ns: 0, text: "{{Infobox Region\n|Name=Meridiana\n|Region=[[Aventurien]]\n}}" },
    { titel: "Orkland", ns: 0, text: "{{Infobox Region\n|Name=Orkland\n|Region=[[Aventurien]]\n}}" },
    { titel: "Aranien", ns: 0, text: "{{Infobox Region\n|Name=Aranien\n|Region=[[Aventurien]]\n}}" },
    { titel: "Bornland (Region)", ns: 0, text: "{{Infobox Region\n|Name=Bornland\n|Region=[[Aventurien]]\n}}" },
    { titel: "Maraskan", ns: 0, text: "{{Infobox Region\n|Name=Maraskan\n|Region=[[Aventurien]]\n}}" },
    { titel: "Perricum", ns: 0, text: "{{Infobox Siedlung\n|Name=Perricum\n|Region=[[Aranien]]\n}}" },
    { titel: "Havena (Siedlung)", ns: 0, text: "{{Infobox Siedlung\n|Name=Havena\n|Region=[[Aventurien]]\n}}" },
    { titel: "Der Große Fluss", ns: 0, text: "{{Infobox Fluss\n|Name=Der Große Fluss\n|Region=[[Aventurien]]\n}}" },
    { titel: "Südaventurien", ns: 0, text: "{{Register Region}}\nSüdaventurien." },
    { titel: "Myranor", ns: 0, text: "Ein Kontinent." },
    { titel: "Steppe", ns: 0, text: "Die Steppe.\n[[Kategorie:Vegetationszone]]" },
    { titel: "Sumpf", ns: 0, text: "Der Sumpf.\n[[Kategorie:Vegetationszone]]" },
    { titel: "Moor", ns: 0, weiterleitung: "Sumpf" },
    { titel: "Graslandschaft", ns: 0, weiterleitung: "Ebene" },
    { titel: "Ebene", ns: 0, text: "Die Ebene.\n[[Kategorie:Vegetationszone]]" },
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

describeWithCluster("WikiSync Regelvorschläge und Begriffstafel (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;
    let umgebung: NodeJS.ProcessEnv;
    let ablage: VorschauAblage;

    const jobs = (): Database => cluster!.jobs;
    const admin = (): Database => cluster!.admin;
    const app = (): Database => cluster!.app;
    const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
    const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);
    const person = uuid("f", 1);
    const akteur: MapActor = { kind: "person", personId: person, environment: "development" };

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

    // ── Die Welt ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    async function legeEintrag(
        db: Database,
        id: string,
        art: string,
        name: string,
        artikel: string,
        system: "legacy" | "editor" = "legacy",
    ): Promise<string> {
        const [zeile] = await db<{ id: string }[]>`
            INSERT INTO lore_entry (public_id, wiki_key, kind, name, wiki_title, wiki_url, legacy_origin, state, source_system, is_active)
            VALUES (${id}::uuid, ${artikel.toLowerCase().replaceAll(" ", "-")}, ${art}, ${name}, ${artikel}, ${wiki(artikel)}, ${system === "editor" ? "manual" : "wiki"}, 'active', ${system}, TRUE)
            RETURNING id::text AS id
        `;
        return zeile!.id;
    }

    async function legeFlaeche(db: Database, id: string, name: string, titel: string | null): Promise<void> {
        await db`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, wiki_url)
            VALUES (${id}::uuid, 'aventuria', ${name}, 'derographisch', 'region', ${titel === null ? null : wiki(titel)})
        `;
    }

    /** Eine bestehende Regel: Herkunft, Kette (Fläche über ihre Kennung, Arten) und Fingerabdruck. */
    async function legeRegel(
        db: Database,
        eintrag: string,
        herkunft: "manual" | "wiki_verbreitung",
        schluessel: string,
        kette: { flaeche?: string; arten?: string[]; join?: string }[],
        system = "legacy",
    ): Promise<string> {
        const [regel] = await db<{ id: string }[]>`
            INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order, legacy_origin, state, source_system, is_active)
            VALUES (${eintrag}::bigint, ${schluessel}, 'verbreitung', 0, ${herkunft}, 'active', ${system}, TRUE)
            RETURNING id::text AS id
        `;
        for (const [seq, bedingung] of kette.entries()) {
            const [term] = await db<{ id: string }[]>`
                INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, area_region_id)
                VALUES (${regel!.id}::bigint, ${seq}, ${bedingung.join ?? (seq === 0 ? "und" : "oder")},
                        ${bedingung.flaeche === undefined ? null : (await db<{ id: string }[]>`SELECT id::text AS id FROM region WHERE public_id = ${bedingung.flaeche}::uuid`)[0]!.id}::bigint)
                RETURNING id::text AS id
            `;
            for (const art of bedingung.arten ?? []) {
                await db`INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type) VALUES (${term!.id}::bigint, 'vegetation', ${art})`;
            }
        }
        return regel!.id;
    }

    async function neueWelt(): Promise<void> {
        await admin()`
            TRUNCATE map_audit_event, map_operation, wikisync_regel_uebernahme_zeile, wikisync_regel_uebernahme, wikisync_regel_wort, wikisync_regel_vorschlag, wikisync_regel_lauf,
                     wikisync_uebernahme_befund, wikisync_uebernahme, wikisync_lauf_zeile, wikisync_lauf, wikisync_bereich_setting, wikisync_begriff_setting,
                     lore_place_target, lore_place, lore_entry_field_origin, lore_entry_source, lore_rule_term_type, lore_rule_term, lore_rule, wiki_lore_snapshot, lore_entry,
                     wiki_key_assignment, place_wiki_assignment, place_detail, place, region_area, map_label, region
            RESTART IDENTITY CASCADE
        `;
        await admin()`UPDATE wikisync_bereich_state SET revision = 1`;
        await admin()`UPDATE wikisync_begriff_state SET revision = 1`;
        await admin()`DELETE FROM job`;
        const db = admin();
        await legeFlaeche(db, F.aventurien, "Aventurien", "Aventurien");
        await legeFlaeche(db, F.meridiana, "Meridiana", "Meridiana");
        await legeFlaeche(db, F.orkland, "Orkland", "Orkland");
        await legeFlaeche(db, F.aranien, "Aranien", "Aranien");
        await legeFlaeche(db, F.bornland, "Bornland", "Bornland (Region)");
        await legeFlaeche(db, F.maraskanRegion, "Maraskan", "Maraskan");
        await legeFlaeche(db, F.maraskanInsel, "Maraskan (Insel)", "Maraskan");
        // Zwei Flächen ohne Wiki-Schlüssel: nur ihr Name ist bekannt (F4).
        await legeFlaeche(db, F.fluss, "Der Große Fluss", null);
        await legeFlaeche(db, F.sued, "Südaventurien", null);
        await legeEintrag(db, E.bremse, "fauna", "Bremse", "Bremse");
        await legeEintrag(db, E.wirsel, "flora", "Wirselkraut", "Wirselkraut");
        await legeEintrag(db, E.nuss, "flora", "Aranische Wassernuss", "Aranische Wassernuss");
        await legeEintrag(db, E.wachtel, "fauna", "Wachtel", "Wachtel");
        await legeEintrag(db, E.krebs, "flora", "Krebsschere", "Krebsschere");
        const hand = await legeEintrag(db, E.hand, "fauna", "Handarbeit", "Handarbeit");
        await legeEintrag(db, E.redaktion, "flora", "Redaktionspflanze", "Redaktionspflanze", "editor");
        const alt = await legeEintrag(db, E.altlast, "fauna", "Altlast", "Altlast");
        const weg = await legeEintrag(db, E.weg, "fauna", "Weggefallen", "Weggefallen");
        // Die Regel der Redaktion hat nicht dieselbe Kette wie die Ableitung.
        await legeRegel(db, hand, "manual", "1".repeat(64), [{ flaeche: F.meridiana, arten: ["wald"] }]);
        // Eine alte, vom Wiki abgeleitete Regel mit anderer Kette: `geaendert`.
        await legeRegel(db, alt, "wiki_verbreitung", "2".repeat(64), [{ flaeche: F.meridiana, arten: ["wald"] }]);
        // Eine alte Regel, zu der das Wiki nichts Abbildbares mehr sagt: `entfaellt`.
        await legeRegel(db, weg, "wiki_verbreitung", "3".repeat(64), [{ flaeche: F.orkland, arten: ["steppe"] }]);
    }

    const liste = async (abfrage: Parameters<typeof leseRegelListe>[1] = {}): Promise<WikisyncRegelListe> =>
        leseRegelListe(app(), abfrage, new Date());
    const nachName = (antwort: WikisyncRegelListe): Map<string, WikisyncRegelVorschlag> =>
        new Map(antwort.vorschlaege.map((v) => [v.eintrag.name, v]));
    const regelnVon = async (
        id: string,
    ): Promise<
        {
            relation: string;
            state: string;
            herkunft: string;
            system: string;
            abgang: string | null;
            terme: number;
            key: string;
        }[]
    > =>
        wert(
            `SELECT r.relation, r.state, r.legacy_origin AS herkunft, r.source_system AS system, r.retired_origin AS abgang, r.rule_key AS key,
                    (SELECT count(*)::int FROM lore_rule_term t WHERE t.lore_rule_id = r.id) AS terme
               FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${id}' ORDER BY r.id`,
        );

    async function uebernehmen(lauf: number, ids: number[]) {
        return inhalteOperation(
            app(),
            akteur,
            {
                operationId: randomUUID(),
                operation: "lore.rules_wikisync",
                body: { lauf, vorschlaege: ids },
                source: "wikisync",
            },
            (tx) =>
                uebernimmRegeln(tx, {
                    lauf,
                    vorschlaege: ids,
                    operationId: randomUUID(),
                    actor: { personId: person, label: "Test" },
                }),
        );
    }
    async function zuruecknehmen(uebernahme: number) {
        return inhalteOperation(
            app(),
            akteur,
            {
                operationId: randomUUID(),
                operation: "lore.rules_wikisync_undo",
                body: { uebernahme },
                source: "wikisync",
            },
            (tx) => nimmRegelnZurueck(tx, { uebernahme, actor: { personId: person, label: "Test" } }),
        );
    }

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikisync-regeln");
        await writeFile(join(ordner.pfad, "dewa_dump_small_20261001.xml"), baueDump(DUMP));
        umgebung = { WIKI_DUMP_ROOT: ordner.pfad };
        const j = cluster.jobs;
        ablage = {
            ladeObjekte: (bereiche) => ladeObjekte(j, bereiche),
            ladeBekannteTitel: () => ladeBekannteTitel(j),
            ladeFlaechenTitel: () => ladeFlaechenTitel(j),
            ladeRegelKontext: () => ladeRegelKontext(j),
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

    it("🔴 Ableitung: Die Vorschau legt Kopf, Vorschläge und Wörter ab und schreibt in keine Fachtafel; ohne Lauf ist die Antwort leer (unbekannt ist nicht null)", async () => {
        await neueWelt();
        const leer = await liste();
        expect(leer).toMatchObject({ lauf: null, zahlen: null, gesamt: 0, vorschlaege: [] });
        const regelnVorher = await zahl("SELECT count(*)::int AS n FROM lore_rule");
        const termeVorher = await zahl("SELECT count(*)::int AS n FROM lore_rule_term");
        const laufId = await vorschau();
        expect(await zahl("SELECT count(*)::int AS n FROM lore_rule")).toBe(regelnVorher);
        expect(await zahl("SELECT count(*)::int AS n FROM lore_rule_term")).toBe(termeVorher);
        const [kopf] = await wert<{ lauf_id: number; begriffe_revision: number; zahlen: Record<string, number> }>(
            `SELECT lauf_id::int, begriffe_revision::int, zahlen FROM wikisync_regel_lauf`,
        );
        expect(kopf).toMatchObject({ lauf_id: laufId, begriffe_revision: 1 });
        expect(kopf!.zahlen["vorgeschlagen"]).toBeGreaterThanOrEqual(8);
        const antwort = await liste();
        // Die Antwort passt genau zum Schema: Ein Feld zu viel (die Fläche trug ihre Nummer in der Datenbank) ließ Fastifys Serialisierer die Liste mit 500 verwerfen (Stage 2026-10-27).
        expect([...Value.Errors(WikisyncRegelListe, antwort)].map((e) => e.path)).toEqual([]);
        expect(antwort.lauf).toMatchObject({ id: laufId, begriffeRevision: 1, veraltet: false });
        const v = nachName(antwort);

        // Bremse: vollständig, vorgewählt.
        expect(v.get("Bremse")).toMatchObject({
            typ: "vollstaendig",
            status: "neu",
            vorgewaehlt: true,
            waehlbar: true,
            wartet: false,
        });
        expect(
            v
                .get("Bremse")
                ?.regeln[0]?.bedingungen.map((b) => [
                    b.verknuepfung,
                    b.flaeche?.name,
                    b.arten.map((a) => a.art).join("|"),
                ]),
        ).toEqual([
            ["und", "Meridiana", "steppe|suempfe_moore"],
            ["oder", "Orkland", "steppe|suempfe_moore"],
        ]);
        // Vorgewählt ist, was vollständig ist und etwas anlegt oder ändert: die Bremse und die Änderung an der Altlast (nie ein Entfallen).
        expect(antwort.vorgewaehlt).toEqual([v.get("Bremse")!.id, v.get("Altlast")!.id]);
        // Wirselkraut: `ohne`, die Reichweite bleibt eine Rückfrage, der Große Fluss ist offen (nur sein Name ist bekannt).
        const wirsel = v.get("Wirselkraut")!;
        expect(wirsel).toMatchObject({ typ: "wartet", wartet: true, vorgewaehlt: false, waehlbar: true });
        expect(wirsel.regeln[0]?.bedingungen.map((b) => b.verknuepfung)).toEqual([
            "und",
            "ohne",
            "ohne",
            "oder",
            "oder",
        ]);
        expect(wirsel.regeln[0]?.bedingungen[3]?.flaeche).toMatchObject({
            offen: true,
            kennung: null,
            kandidat: "Der Große Fluss",
        });
        // Aranische Wassernuss: „südlich der Linie“ als Teil mit Grund.
        expect(v.get("Aranische Wassernuss")).toMatchObject({
            typ: "unvollstaendig",
            waehlbar: true,
            vorgewaehlt: false,
        });
        expect(
            v
                .get("Aranische Wassernuss")
                ?.regeln[0]?.teile.map((t) => t.grund)
                .sort(),
        ).toEqual(["bezugspunkt", "linie"]);
        // Wachtel: negiert, beide Flächen mit dem Schlüssel Maraskan.
        expect(v.get("Wachtel")).toMatchObject({ typ: "negiert", vorgewaehlt: false });
        expect(v.get("Wachtel")?.regeln[0]?.bedingungen.map((b) => b.verknuepfung)).toEqual(["und", "ohne", "ohne"]);
        // Krebsschere: Südaventurien hat keinen Schlüssel (F4), „Gewässer“ keine Pille.
        expect(v.get("Krebsschere")).toMatchObject({ typ: "wartet", wartet: true });
        expect(v.get("Krebsschere")?.regeln[0]?.teile.map((t) => t.grund)).toEqual(["wort_offen"]);
        // Die Regel der Redaktion bleibt: nicht wählbar. Der Eintrag der Redaktion ist nicht wählbar.
        expect(v.get("Handarbeit")).toMatchObject({
            typ: "manuell",
            status: "manuell",
            waehlbar: false,
            sperre: "manuell",
        });
        expect(v.get("Redaktionspflanze")).toMatchObject({ waehlbar: false, sperre: "redaktion" });
        // Eine alte, abgeleitete Regel: geändert; zu der das Wiki nichts mehr sagt: entfällt.
        expect(v.get("Altlast")).toMatchObject({ status: "geaendert", waehlbar: true, vorgewaehlt: true });
        expect(v.get("Altlast")?.regeln[0]?.bisher?.[0]?.flaeche?.name).toBe("Meridiana");
        expect(v.get("Weggefallen")).toMatchObject({ status: "entfaellt", waehlbar: true, vorgewaehlt: false });
        // Die Wörter: Tafelwörter und ein gefundenes, das die Tafel nicht kennt, mit ihrer Zahl.
        const woerter = await wert<{ wort: string; anzahl: number; in_tafel: boolean }>(
            `SELECT wort, anzahl, in_tafel FROM wikisync_regel_wort ORDER BY wort`,
        );
        expect(woerter.find((w) => w.wort === "steppen" || w.wort === "steppe")?.in_tafel).toBe(true);
        expect(woerter.find((w) => w.wort === "gewässer")).toMatchObject({ in_tafel: true, anzahl: 1 });
        // Filter, Freitext und die Zahl am Wert.
        const nurNegiert = await liste({ typ: "negiert" });
        expect([...nachName(nurNegiert).keys()]).toEqual(["Wachtel"]);
        // Die Suche findet auch die Wörter der Bedingungen („Marschen“ steht in der Tafel und in der Bedingung der Wassernuss).
        expect((await liste({ q: "marschen" })).vorschlaege.map((x) => x.eintrag.name)).toEqual([
            "Aranische Wassernuss",
        ]);
        expect((await liste({ q: "wirsel" })).vorschlaege.map((x) => x.eintrag.name)).toEqual(["Wirselkraut"]);
        expect(antwort.facetten.typ["wartet"]).toBe(2);
        expect((await liste({ art: "flora" })).facetten.typ["negiert"]).toBeUndefined();
    });

    it("🔴 Begriffstafel: Startwerte, eine Pille speichert sofort (Revision), die Liste ist veraltet, die nächste Ableitung liest die Tafel, ↺ löscht die Zeile", async () => {
        await neueWelt();
        const erste = await vorschau();
        const tafel = await leseBegriffe(app(), { filter: "alle", limit: 300 }, new Date());
        expect(tafel).toMatchObject({ revision: 1, quelle: "datenbank", lauf: erste });
        const gewaesser = tafel.woerter.find((w) => w.wort === "gewässer");
        expect(gewaesser).toMatchObject({ pillen: [], lage: "offen", eigen: false, gesehen: 1 });
        expect(tafel.woerter.find((w) => w.wort === "heide")).toMatchObject({
            pillen: ["vegetation|heideland"],
            lage: "gleichwertig",
        });
        // Die mehrdeutigen Wörter stehen vorn (markiert).
        expect(tafel.woerter[0]?.lage).toBe("offen");
        expect(
            (await leseBegriffe(app(), { filter: "offen" }, new Date())).woerter.every(
                (w) => w.lage === "offen" && w.pillen.length === 0,
            ),
        ).toBe(true);

        const speichern = async (aenderungen: Parameters<typeof aendereBegriffe>[1]["aenderungen"], basis: number) =>
            app().begin((tx) =>
                aendereBegriffe(tx, { aenderungen, baseRevision: basis, actor: { personId: person, label: "Test" } }),
            );
        const geaendert = await speichern([{ wort: "gewässer", pillen: ["topographie|see", "topographie|meer"] }], 1);
        expect(geaendert).toEqual({ geaendert: ["gewässer"], revision: 2 });
        // Die Zeile gilt sofort, die Liste ist veraltet (sie rechnete nach Revision 1).
        const danach = await leseBegriffe(app(), { filter: "eigen" }, new Date());
        expect(danach.woerter).toEqual([
            expect.objectContaining({
                wort: "gewässer",
                pillen: ["topographie|see", "topographie|meer"],
                eigen: true,
                lage: "gleichwertig",
            }),
        ]);
        expect((await liste()).lauf).toMatchObject({ begriffeRevision: 1, veraltet: true });
        // Veraltet: ein zweiter Speicherversuch mit der alten Revision wird abgewiesen.
        await expect(speichern([{ wort: "heide", pillen: [] }], 1)).rejects.toMatchObject({ statusCode: 409 });
        // Ungültig: eine Pille, die es nicht gibt.
        await expect(speichern([{ wort: "heide", pillen: ["gibt|es-nicht"] }], 2)).rejects.toMatchObject({
            statusCode: 400,
        });
        // Die nächste Ableitung liest die Tafel: Krebsschere hat keinen mehrdeutigen Teil mehr.
        const zweite = await vorschau();
        const nach = nachName(await liste());
        expect((await liste()).lauf).toMatchObject({ id: zweite, begriffeRevision: 2, veraltet: false });
        expect(nach.get("Krebsschere")?.regeln[0]?.teile).toEqual([]);
        expect(nach.get("Krebsschere")?.regeln[0]?.bedingungen[0]?.arten.map((a) => a.art)).toEqual(["meer", "see"]);
        // Eine Pille, die dem Startwert gleicht, wird nicht gespeichert; ↺ löscht die Zeile; ein fremdes Wort ohne Pille entfällt.
        expect(
            await speichern([{ wort: "heide", pillen: ["vegetation|heideland"] }], 2).catch(
                (e: { statusCode?: number }) => e.statusCode,
            ),
        ).toBe(409);
        await speichern([{ wort: "gewässer", zuruecksetzen: true }], 2);
        expect(await zahl("SELECT count(*)::int AS n FROM wikisync_begriff_setting")).toBe(0);
        expect((await leseBegriffe(app(), { filter: "eigen" }, new Date())).gesamt).toBe(0);
        // Ein von Hand angelegtes Wort steht in der Tafel, mit Pille und ohne Startwert.
        await speichern([{ wort: "dämonisch", pillen: ["zone|tropisch"] }], 3);
        expect((await leseBegriffe(app(), { q: "dämon" }, new Date())).woerter).toEqual([
            expect.objectContaining({ wort: "dämonisch", pillen: ["zone|tropisch"], startwert: [], eigen: true }),
        ]);
    });

    it("🔴 Begriffstafel: Wortfamilien – eine Zeile je Familie, die Entscheidung liegt unter dem Kopfwort und gilt für alle Formen, die Suche findet auch über die Formen", async () => {
        await neueWelt();
        await vorschau();
        const tafel = await leseBegriffe(app(), { filter: "alle", limit: 300 }, new Date());
        const kalt = tafel.woerter.find((w) => w.wort === "kalt");
        expect(kalt).toMatchObject({
            formen: ["kalt", "kalte", "kalten", "kaltes", "kälteren"],
            pillen: ["zone|polar", "zone|subpolar", "zone|boreal"],
            lage: "naeherung",
            eigen: false,
        });
        // Die Zahl im Wiki ist die Summe der Formen (hier sah der Lauf keine: die Zählung der Analyse bei den Startwerten).
        const analyse = ["kalt", "kalte", "kalten", "kaltes", "kälteren"].reduce(
            (summe, form) => summe + (BEGRIFFE_VORGABE.get(form)?.gesehen ?? 0),
            0,
        );
        expect(kalt?.gesehen).toBe(analyse);
        // Die Formen haben keine eigene Zeile; die Zahlen zählen Familien, und genau die sieben mehrdeutigen Familien sind zu entscheiden (Brackwasser samt Zusammensetzungen ist eine).
        for (const form of ["kalte", "kälteren", "wäldern", "gewässern"])
            expect(tafel.woerter.map((w) => w.wort)).not.toContain(form);
        expect(tafel.zahlen["alle"]).toBeLessThan(BEGRIFFE_VORGABE.size);
        expect(tafel.zahlen["offen"]).toBe(7);
        expect(
            (await leseBegriffe(app(), { filter: "offen", limit: 300 }, new Date())).woerter.map((w) => w.wort).sort(),
        ).toEqual(["brackwasser", "ebene", "gewässer", "hochland", "immergrüne", "regengrüner", "wasser"].sort());
        // Die Suche findet die Familie auch über jede Form.
        const ueberForm = await leseBegriffe(app(), { q: "kälteren" }, new Date());
        expect(ueberForm.woerter.map((w) => w.wort)).toEqual(["kalt"]);

        const speichern = async (aenderungen: Parameters<typeof aendereBegriffe>[1]["aenderungen"], basis: number) =>
            app().begin((tx) =>
                aendereBegriffe(tx, { aenderungen, baseRevision: basis, actor: { personId: person, label: "Test" } }),
            );
        const zeilen = async (): Promise<string[]> =>
            (await wert<{ wort: string }>("SELECT wort FROM wikisync_begriff_setting ORDER BY wort")).map(
                (z) => z.wort,
            );

        // Jede Form der Familie wird angenommen, gespeichert wird unter dem Kopfwort.
        expect(await speichern([{ wort: "kalten", pillen: ["zone|gemaessigt"] }], 1)).toEqual({
            geaendert: ["kalt"],
            revision: 2,
        });
        expect(await zeilen()).toEqual(["kalt"]);
        const danach = await leseBegriffe(app(), { filter: "eigen" }, new Date());
        expect(danach.woerter).toEqual([
            expect.objectContaining({
                wort: "kalt",
                formen: ["kalt", "kalte", "kalten", "kaltes", "kälteren"],
                pillen: ["zone|gemaessigt"],
                eigen: true,
                lage: "gleichwertig",
            }),
        ]);
        // Zwei Formen derselben Familie in einer Anfrage sind doppelt.
        await expect(
            speichern(
                [
                    { wort: "kalt", pillen: ["zone|polar"] },
                    { wort: "kaltes", pillen: ["zone|boreal"] },
                ],
                2,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
        // Die nächste Ableitung liest die Familie: Revision 2, nicht veraltet.
        const lauf = await vorschau();
        expect((await liste()).lauf).toMatchObject({ id: lauf, begriffeRevision: 2, veraltet: false });
        // ↺ an einer anderen Form löscht die Zeile des Kopfworts.
        expect(await speichern([{ wort: "kälteren", zuruecksetzen: true }], 2)).toEqual({
            geaendert: ["kalt"],
            revision: 3,
        });
        expect(await zeilen()).toEqual([]);
        // Eine ältere Zeile unter einer Nicht-Kopf-Form gilt für die Familie, ein Speichern räumt sie ab.
        await admin()`INSERT INTO wikisync_begriff_setting (wort, pillen) VALUES ('kalte', ARRAY['zone|polar']::text[])`;
        const aelter = await leseBegriffe(app(), { q: "kalt", filter: "eigen" }, new Date());
        expect(aelter.woerter).toEqual([
            expect.objectContaining({ wort: "kalt", pillen: ["zone|polar"], eigen: true }),
        ]);
        expect(await speichern([{ wort: "kalt", pillen: ["zone|boreal"] }], aelter.revision)).toMatchObject({
            geaendert: ["kalt"],
        });
        expect(await zeilen()).toEqual(["kalt"]);
        const wieder = await leseBegriffe(app(), { q: "kalt", filter: "eigen" }, new Date());
        await speichern([{ wort: "kalt", zuruecksetzen: true }], wieder.revision);
        expect(await zeilen()).toEqual([]);
        // Ein von Hand angelegtes Wort ist seine eigene Familie, ohne Formen.
        const frisch = await leseBegriffe(app(), { limit: 1 }, new Date());
        await speichern([{ wort: "dämonisch", pillen: ["zone|tropisch"] }], frisch.revision);
        expect((await leseBegriffe(app(), { q: "dämon" }, new Date())).woerter).toEqual([
            expect.objectContaining({ wort: "dämonisch", formen: ["dämonisch"], startwert: [], eigen: true }),
        ]);
    });

    it("🔴 Übernehmen: nur die ausgewählten; Anlegen und Stilllegen; Regel der Redaktion und Eintrag der Redaktion bleiben; ein bewegter Stand bleibt liegen", async () => {
        await neueWelt();
        const lauf = await vorschau();
        const v = nachName(await liste({ limit: 100 }));
        const id = (name: string): number => v.get(name)!.id;
        const auswahl = [
            id("Bremse"),
            id("Wirselkraut"),
            id("Altlast"),
            id("Weggefallen"),
            id("Handarbeit"),
            id("Redaktionspflanze"),
        ];
        const quittung = await uebernehmen(lauf, auswahl);
        // Die Regel der Redaktion („Handarbeit“) ist nicht wählbar, der Eintrag der Redaktion bleibt ganz.
        expect(quittung.warnings.map((w) => w.code).sort()).toEqual(["nicht_waehlbar", "redaktion"]);
        const uebernahmeId = Number(quittung.affected.find((a) => a.kind === "wikisync_regel_uebernahme")!.id);

        // Bremse: eine neue Regel mit zwei Bedingungen und ihren Arten, Herkunft wiki_verbreitung, vom WikiSync.
        const bremse = await regelnVon(E.bremse);
        expect(bremse).toEqual([
            expect.objectContaining({
                state: "active",
                herkunft: "wiki_verbreitung",
                system: "wikisync",
                abgang: null,
                terme: 2,
            }),
        ]);
        const arten = await wert<{ n: number }>(
            `SELECT count(*)::int AS n FROM lore_rule_term_type y JOIN lore_rule_term t ON t.id = y.lore_rule_term_id JOIN lore_rule r ON r.id = t.lore_rule_id
               JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${E.bremse}'`,
        );
        expect(arten[0]?.n).toBe(4);
        // Wirselkraut: `ohne` und die offene Fläche mit ihrem Wiki-Namen (F4).
        const terme = await wert<{ join_op: string; area: string | null; titel: string | null }>(
            `SELECT t.join_op, t.area_region_id::text AS area, t.wiki_area_title AS titel FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id
               JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${E.wirsel}' ORDER BY t.seq`,
        );
        expect(terme.map((t) => t.join_op)).toEqual(["und", "ohne", "ohne", "oder", "oder"]);
        expect(terme.filter((t) => t.titel !== null)).toEqual([
            expect.objectContaining({ titel: "Der Große Fluss", area: null }),
        ]);
        // Das Lesen im Fenster „Inhalte bearbeiten“ kennt `ohne` und die wartende Fläche (sonst stünde `ohne` als `und` da).
        const gelesen = await leseVorkommen(app(), E.wirsel);
        const bedingungen = gelesen!.regeln.flatMap((regel) => regel.bedingungen);
        expect(bedingungen.map((b) => b.joinOp)).toEqual(["und", "ohne", "ohne", "oder", "oder"]);
        expect(bedingungen.filter((b) => b.wartetAuf !== undefined)).toEqual([
            expect.objectContaining({ wartetAuf: "Der Große Fluss" }),
        ]);
        // Altlast: die alte Regel still gelegt (vom WikiSync), eine neue angelegt. Weggefallen: die alte still gelegt, keine neue.
        expect((await regelnVon(E.altlast)).map((r) => [r.state, r.abgang, r.system])).toEqual([
            ["retired", "wikisync", "legacy"],
            ["active", null, "wikisync"],
        ]);
        expect((await regelnVon(E.weg)).map((r) => [r.state, r.abgang])).toEqual([["retired", "wikisync"]]);
        // Die Regel der Redaktion und der Eintrag der Redaktion bleiben.
        expect((await regelnVon(E.hand)).map((r) => [r.state, r.herkunft, r.system])).toEqual([
            ["active", "manual", "legacy"],
        ]);
        expect(await regelnVon(E.redaktion)).toEqual([]);
        // Nicht ausgewählt, nicht geschrieben.
        expect(await regelnVon(E.nuss)).toEqual([]);
        expect(await regelnVon(E.wachtel)).toEqual([]);
        // Das Fachprotokoll wie der Editor: eine Operation der Quelle wikisync, ein Eintrag je berührtem Vorkommen, die Revision zählt.
        const [operation] = await wert<{ source: string; action: string; summary: string }>(
            `SELECT source, action, summary FROM map_operation`,
        );
        expect(operation).toMatchObject({ source: "wikisync", action: "lore.rules_wikisync" });
        const audit = await wert<{ action: string; lore: string; changes: Record<string, unknown> }>(
            `SELECT action, lore_public_id::text AS lore, changes FROM map_audit_event ORDER BY id`,
        );
        expect(audit.map((a) => a.lore).sort()).toEqual([E.altlast, E.bremse, E.weg, E.wirsel].sort());
        expect(audit.every((a) => a.action === "lore.rules_wikisync" && "rules" in a.changes)).toBe(true);
        expect((await liste()).uebernahmen).toEqual([
            expect.objectContaining({ id: uebernahmeId, regeln: 3, stillgelegt: 2, zurueckgenommenAm: null }),
        ]);

        // Dieselbe Auswahl noch einmal: Der Stand hat sich bewegt, nichts wird doppelt angelegt.
        const nochmal = await uebernehmen(lauf, [id("Bremse"), id("Altlast")]);
        expect(nochmal.warnings.map((w) => w.code)).toEqual(["seit_vorschau_geaendert", "seit_vorschau_geaendert"]);
        expect(await regelnVon(E.bremse)).toHaveLength(1);
        expect(await regelnVon(E.altlast)).toHaveLength(2);
    });

    it("🔴 Lage zu einer Linie: Die Ableitung liest sie aus dem Wiki (Wassernuss), die Übernahme löst die Orte des Vorschlags auf die Karte und schreibt die Spalten (auch bei einer Bedingung nur mit Lage); ein stiller Ort oder ein Gebäude macht den Vorschlag veraltet; ein Protokoll ohne Lage bleibt, wie es war", async () => {
        await neueWelt();
        // Die Orte der Karte stehen VOR der Vorschau: Die Ableitung liest die Lage nur, wo jeder Ort genau eine aktive Siedlung ist.
        const ort = async (id: string, name: string, subtype: string, x: number, y: number, aktiv = true) => {
            await admin()`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${id}::uuid, 'aventuria', ${name}, ${subtype}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'lagetest', ${aktiv})
            `;
            return { kennung: id, name, x, y };
        };
        const gareth = await ort(uuid("c", 1), "Gareth", "metropole", 413.5, 280.25);
        const havena = await ort(uuid("c", 2), "Havena", "grossstadt", 150, 300);
        const still = await ort(uuid("c", 3), "Stilldorf", "dorf", 200, 200, false);
        const tempel = await ort(uuid("c", 4), "Tempel", "gebaeude", 410, 280);
        const perricum = await ort(uuid("c", 5), "Perricum", "grossstadt", 300, 120);
        const lauf = await vorschau();
        const v = nachName(await liste({ limit: 100 }));
        // Ohne Lage kennt das Protokoll das Feld nicht, und die Antwort bleibt, wie sie war.
        expect(v.get("Bremse")!.regeln[0]!.bedingungen.every((b) => !("lage" in b))).toBe(true);
        // Aranische Wassernuss: „südlich der Linie Perricum und Havena“ liest die Ableitung als Lage (Rückfrage `lage`, nicht vorgewählt).
        const nuss = v.get("Aranische Wassernuss")!;
        expect(nuss).toMatchObject({ typ: "rueckfrage", vorgewaehlt: false, waehlbar: true });
        expect(nuss.regeln[0]!.bedingungen.map((b) => b.lage)).toEqual([
            undefined,
            { richtung: "sued", orte: [perricum, havena] },
        ]);
        expect(nuss.regeln[0]!.bedingungen[1]!.rueckfragen).toContain("lage");

        /** Dem Vorschlag eines Eintrags eine Lage in die Bedingungen schreiben (das Protokoll der Ableitung; die Fälle mit stillem Ort und Gebäude liefert die Ableitung selbst nie) und den Fingerabdruck dazu rechnen. */
        async function mitLage(
            name: string,
            wikiKey: string,
            aenderung: (kette: Bed[]) => Bed[],
        ): Promise<{ id: number; kette: Bed[]; schluessel: string }> {
            const [zeile] = await wert<{
                id: number;
                payload: { regeln: { bedingungen: Bed[]; schluessel: string }[] };
            }>(
                `SELECT id::int AS id, payload FROM wikisync_regel_vorschlag WHERE lauf_id = ${String(lauf)} AND eintrag_name = '${name}'`,
            );
            const regel = zeile!.payload.regeln[0]!;
            regel.bedingungen = aenderung(regel.bedingungen);
            regel.schluessel = regelSchluessel(wikiKey, "verbreitung", regel.bedingungen);
            await admin()`UPDATE wikisync_regel_vorschlag SET payload = ${admin().json(zeile!.payload as never)} WHERE id = ${zeile!.id}`;
            return { id: zeile!.id, kette: regel.bedingungen, schluessel: regel.schluessel };
        }
        const nurLage = (verknuepfung: Bed["verknuepfung"], lage: Bed["lage"]): Bed => ({
            verknuepfung,
            flaeche: null,
            arten: [],
            klima: null,
            ...(lage === undefined ? {} : { lage }),
            woerter: [],
            rueckfragen: ["lage"],
        });

        // Bremse: die zweite Bedingung bekommt eine Lage (Süd, ein Ort), dazu eine dritte nur mit Lage (West von Havena–Gareth).
        const bremse = await mitLage("Bremse", "bremse", (kette) => [
            kette[0]!,
            { ...kette[1]!, lage: { richtung: "sued", orte: [gareth] } },
            nurLage("oder", { richtung: "west", orte: [havena, gareth] }),
        ]);
        // Wirselkraut mit einem stillen Ort, Wachtel mit einem Gebäude: beide veraltet, nichts wird geschrieben.
        const wirsel = await mitLage("Wirselkraut", "wirselkraut", (kette) => [
            { ...kette[0]!, lage: { richtung: "nord", orte: [still] } },
            ...kette.slice(1),
        ]);
        const wachtel = await mitLage("Wachtel", "wachtel", (kette) => [
            { ...kette[0]!, lage: { richtung: "ost", orte: [tempel] } },
            ...kette.slice(1),
        ]);
        // Das Lesen der Liste trägt die Lage nach außen und passt zum Schema (sonst verwürfe Fastify die Antwort mit 500).
        const antwort = await liste({ limit: 100 });
        expect([...Value.Errors(WikisyncRegelListe, antwort)].map((e) => e.path)).toEqual([]);
        expect(
            nachName(antwort)
                .get("Bremse")!
                .regeln[0]!.bedingungen.map((b) => b.lage),
        ).toEqual([undefined, { richtung: "sued", orte: [gareth] }, { richtung: "west", orte: [havena, gareth] }]);
        const quittung = await uebernehmen(lauf, [bremse.id, wirsel.id, wachtel.id, nuss.id]);
        expect(quittung.warnings.map((w) => w.code)).toEqual(["seit_vorschau_geaendert", "seit_vorschau_geaendert"]);
        const meldungen = quittung.warnings.map((w) => w.message).join(" | ");
        expect(meldungen).toContain("Stilldorf");
        expect(meldungen).toContain("Tempel");
        expect(await regelnVon(E.wirsel)).toEqual([]);
        expect(await regelnVon(E.wachtel)).toEqual([]);
        // Wassernuss (Ableitung ohne Handarbeit): zwei Bedingungen, die zweite mit der Linie durch Perricum und Havena.
        const [nussProtokoll] = await wert<{ schluessel: string }>(
            `SELECT payload->'regeln'->0->>'schluessel' AS schluessel FROM wikisync_regel_vorschlag WHERE lauf_id = ${String(lauf)} AND eintrag_name = 'Aranische Wassernuss'`,
        );
        expect(await regelnVon(E.nuss)).toEqual([
            expect.objectContaining({ key: nussProtokoll!.schluessel, terme: 2 }),
        ]);
        const nussTerme = await wert<{ seq: number; richtung: string | null; a: string | null; b: string | null }>(
            `SELECT t.seq::int AS seq, t.line_direction AS richtung, pa.public_id::text AS a, pb.public_id::text AS b
               FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id JOIN lore_entry e ON e.id = r.lore_entry_id
               LEFT JOIN place pa ON pa.id = t.line_place_a_id LEFT JOIN place pb ON pb.id = t.line_place_b_id
              WHERE e.public_id = '${E.nuss}' ORDER BY t.seq`,
        );
        expect(nussTerme).toEqual([
            { seq: 0, richtung: null, a: null, b: null },
            { seq: 1, richtung: "sued", a: perricum.kennung, b: havena.kennung },
        ]);
        // Bremse: die Regel mit dem Fingerabdruck der Ableitung und den Spalten.
        expect(await regelnVon(E.bremse)).toEqual([expect.objectContaining({ key: bremse.schluessel, terme: 3 })]);
        const terme = await wert<{ seq: number; richtung: string | null; a: string | null; b: string | null }>(
            `SELECT t.seq::int AS seq, t.line_direction AS richtung, pa.public_id::text AS a, pb.public_id::text AS b
               FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id JOIN lore_entry e ON e.id = r.lore_entry_id
               LEFT JOIN place pa ON pa.id = t.line_place_a_id LEFT JOIN place pb ON pb.id = t.line_place_b_id
              WHERE e.public_id = '${E.bremse}' ORDER BY t.seq`,
        );
        expect(terme).toEqual([
            { seq: 0, richtung: null, a: null, b: null },
            { seq: 1, richtung: "sued", a: gareth.kennung, b: null },
            { seq: 2, richtung: "west", a: havena.kennung, b: gareth.kennung },
        ]);
        // Das Fachprotokoll nennt die Lage nur dort, wo es eine gibt.
        const audit = await wert<{ changes: { rules: { after: { bedingungen: Record<string, unknown>[] }[] } } }>(
            `SELECT changes FROM map_audit_event WHERE lore_public_id = '${E.bremse}'`,
        );
        expect(audit[0]!.changes.rules.after[0]!.bedingungen.map((b) => b["lage"])).toEqual([
            undefined,
            `sued:${gareth.kennung}`,
            `west:${[gareth.kennung, havena.kennung].sort().join("/")}`,
        ]);
        // Das Lesen im Fenster „Inhalte bearbeiten“ kennt die Lage der übernommenen Regel.
        const gelesen = (await leseVorkommen(app(), E.bremse))!;
        expect(gelesen.regeln[0]!.bedingungen.map((b) => b.lage?.richtung)).toEqual([undefined, "sued", "west"]);
        // Nimmt die Redaktion einen Ort danach still, bleibt die Regel lesbar (der Ort steht mit Namen und Stelle da).
        await admin()`UPDATE place SET is_active = FALSE WHERE public_id = ${havena.kennung}::uuid`;
        expect((await leseVorkommen(app(), E.bremse))!.regeln[0]!.bedingungen[2]!.lage?.orte[0]).toMatchObject({
            name: "Havena",
        });
    });

    it("🔴 Übernehmen: eine neuere Ableitung oder eine geänderte Begriffstafel verweigert die alten Vorschläge; eine inzwischen zugewiesene Fläche macht den Vorschlag veraltet", async () => {
        await neueWelt();
        const lauf = await vorschau();
        const v = nachName(await liste({ limit: 100 }));
        // Die Fläche „Südaventurien“ bekommt ihren Wiki-Schlüssel: Die offene Bedingung der Krebsschere ist veraltet.
        await admin()`UPDATE region SET wiki_url = ${wiki("Südaventurien")} WHERE public_id = ${F.sued}::uuid`;
        const stale = await uebernehmen(lauf, [v.get("Krebsschere")!.id]);
        expect(stale.warnings).toEqual([expect.objectContaining({ code: "seit_vorschau_geaendert" })]);
        expect(await regelnVon(E.krebs)).toEqual([]);
        // Die nächste Ableitung löst die Fläche auf: kein „!“ mehr.
        const neu = await vorschau();
        const danach = nachName(await liste({ limit: 100 })).get("Krebsschere")!;
        expect(danach.wartet).toBe(false);
        // Die Fläche ist gelesen, sagt aber (ohne Art) nur, was die Ortszeile sagt: keine Bedingung, nur der mehrdeutige Teil.
        expect(danach.regeln[0]?.bedingungen).toEqual([]);
        expect(danach).toMatchObject({ typ: "mehrdeutig", waehlbar: false, sperre: "nichts" });
        // Der alte Lauf ist nicht mehr die Grundlage.
        await expect(uebernehmen(lauf, [v.get("Bremse")!.id])).rejects.toMatchObject({
            statusCode: 409,
            code: "vorschau_veraltet",
        });
        // Eine geänderte Begriffstafel: Die Vorschläge müssen erst neu abgeleitet werden.
        await app().begin((tx) =>
            aendereBegriffe(tx, {
                aenderungen: [{ wort: "gewässer", pillen: ["topographie|see"] }],
                baseRevision: 1,
                actor: { personId: person, label: "Test" },
            }),
        );
        await expect(uebernehmen(neu, [danach.id])).rejects.toMatchObject({
            statusCode: 409,
            code: "begriffe_geaendert",
        });
    });

    it("🔴 Rücknahme je Übernahme: legt die angelegten Regeln still und belebt die still gelegten; eine zweite Rücknahme wird abgewiesen", async () => {
        await neueWelt();
        const lauf = await vorschau();
        const v = nachName(await liste({ limit: 100 }));
        const quittung = await uebernehmen(lauf, [v.get("Bremse")!.id, v.get("Altlast")!.id, v.get("Weggefallen")!.id]);
        const uebernahmeId = Number(quittung.affected.find((a) => a.kind === "wikisync_regel_uebernahme")!.id);
        // Zwischen Übernahme und Rücknahme übernimmt die Redaktion die angelegte Regel des Eintrags „Altlast“ (der Editor setzt die Herkunft auf manual): Sie bleibt, wie sie ist.
        await admin()`UPDATE lore_rule SET legacy_origin = 'manual' WHERE lore_entry_id = (SELECT id FROM lore_entry WHERE public_id = ${E.altlast}::uuid) AND state = 'active'`;
        const zurueck = await zuruecknehmen(uebernahmeId);
        expect(zurueck.warnings.map((w) => w.code)).toEqual(["seit_uebernahme_geaendert", "seit_uebernahme_geaendert"]);
        expect((await regelnVon(E.bremse)).map((r) => r.state)).toEqual(["retired"]);
        // Altlast: Die Regel, die die Redaktion übernommen hat, bleibt aktiv; die alte, die die Übernahme still legte, lebt nicht daneben auf.
        expect((await regelnVon(E.altlast)).map((r) => [r.state, r.herkunft])).toEqual([
            ["retired", "wiki_verbreitung"],
            ["active", "manual"],
        ]);
        expect((await regelnVon(E.weg)).map((r) => [r.state, r.abgang])).toEqual([["active", null]]);
        expect((await liste()).uebernahmen[0]?.zurueckgenommenAm).not.toBeNull();
        await expect(zuruecknehmen(uebernahmeId)).rejects.toMatchObject({
            statusCode: 409,
            code: "schon_zurueckgenommen",
        });
        await expect(zuruecknehmen(999)).rejects.toMatchObject({ statusCode: 404 });
    });

    it("🔴 B8e: die Gegenrichtung der Rücknahme stellt die Übernahme wieder her (angelegte Regeln leben auf, alte werden still gelegt), je Zeile nur, wo alles noch so dasteht; ohne etwas Wiederherzustellendes 409 und nichts geschrieben; die Kette der Operationen gibt den Zustand in „Änderungen“", async () => {
        await neueWelt();
        const lauf = await vorschau();
        const v = nachName(await liste({ limit: 100 }));
        const quittung = await uebernehmen(lauf, [v.get("Bremse")!.id, v.get("Altlast")!.id, v.get("Weggefallen")!.id]);
        const uebernahmeId = Number(quittung.affected.find((a) => a.kind === "wikisync_regel_uebernahme")!.id);
        // Der Kopf der Übernahme nennt die Operation an der Karte (die Route gibt beiden dieselbe Kennung; der Hilfsweg dieses Tests zwei verschiedene).
        await admin()`UPDATE wikisync_regel_uebernahme SET operation_id = ${quittung.operationId}::uuid WHERE id = ${uebernahmeId}`;
        const stand = async (): Promise<Record<string, [string, string, string | null][]>> => ({
            bremse: (await regelnVon(E.bremse)).map((r) => [r.state, r.herkunft, r.abgang]),
            altlast: (await regelnVon(E.altlast)).map((r) => [r.state, r.herkunft, r.abgang]),
            weg: (await regelnVon(E.weg)).map((r) => [r.state, r.herkunft, r.abgang]),
        });
        const wiederherstellen = (uebernahme: number) =>
            inhalteOperation(
                app(),
                akteur,
                {
                    operationId: randomUUID(),
                    operation: "lore.rules_wikisync_redo",
                    body: { uebernahme },
                    source: "wikisync",
                },
                (tx) => stelleRegelnWiederHer(tx, { uebernahme, actor: { personId: person, label: "Test" } }),
            );
        const kopf = async (): Promise<boolean> =>
            (
                await wert<{ z: boolean }>(
                    `SELECT zurueckgenommen_am IS NOT NULL AS z FROM wikisync_regel_uebernahme WHERE id = ${uebernahmeId}`,
                )
            )[0]!.z;
        const nachUebernahme = await stand();

        // Solange die Übernahme gilt, gibt es nichts wiederherzustellen.
        await expect(wiederherstellen(uebernahmeId)).rejects.toMatchObject({
            statusCode: 409,
            code: "nicht_zurueckgenommen",
        });
        const undo = await zuruecknehmen(uebernahmeId);
        const nachRuecknahme = await stand();
        expect(nachRuecknahme).not.toEqual(nachUebernahme);
        expect(await kopf()).toBe(true);

        // Wiederherstellen: derselbe Stand wie nach der Übernahme, ohne neue Regeln; der Kopf gilt wieder.
        const redo = await wiederherstellen(uebernahmeId);
        expect(redo.warnings).toEqual([]);
        expect(await stand()).toEqual(nachUebernahme);
        expect(await kopf()).toBe(false);
        expect(redo.affected.find((a) => a.kind === "wikisync_regel_uebernahme")?.id).toBe(String(uebernahmeId));
        const protokoll = await wert<{
            action: string;
            changes: { rules: { before: { state: string }[]; after: { state: string }[] } };
        }>(`SELECT action, changes FROM map_audit_event WHERE operation_id = '${redo.operationId}' ORDER BY id`);
        expect(protokoll.length).toBeGreaterThan(0);
        for (const eintrag of protokoll) {
            expect(eintrag.action).toBe("lore.rules_wikisync_redo");
            // Vorher und Nachher kehren sich um gegen die Rücknahme: Was sie belebte, wird still gelegt, und umgekehrt.
            expect(eintrag.changes.rules.before.map((r) => r.state)).not.toEqual(
                eintrag.changes.rules.after.map((r) => r.state),
            );
        }

        // Und wieder zurücknehmen geht (die Rücknahme der Gegenrichtung ist die Rücknahme selbst).
        const undo2 = await zuruecknehmen(uebernahmeId);
        expect(undo2.warnings).toEqual([]);
        expect(await stand()).toEqual(nachRuecknahme);
        expect(await kopf()).toBe(true);

        // Die Kette in „Änderungen“: Übernahme, Rücknahme, Gegenrichtung, Rücknahme; nur das letzte Glied ist rücknehmbar, jedes nennt das davor.
        const zustaende = await ladeZustaende(
            app(),
            [
                { operationId: quittung.operationId, source: "wikisync", operation: "lore.rules_wikisync" },
                { operationId: undo.operationId, source: "wikisync", operation: "lore.rules_wikisync_undo" },
                { operationId: redo.operationId, source: "wikisync", operation: "lore.rules_wikisync_redo" },
                { operationId: undo2.operationId, source: "wikisync", operation: "lore.rules_wikisync_undo" },
            ],
            undefined,
        );
        const z = (id: string) => zustaende.get(id)!;
        expect(z(quittung.operationId).status).toBe("bereits_zurueckgenommen");
        expect(z(quittung.operationId).revertedBy?.operationId).toBe(undo2.operationId);
        expect(z(undo.operationId)).toMatchObject({
            status: "bereits_zurueckgenommen",
            reverts: [quittung.operationId],
        });
        expect(z(undo.operationId).revertedBy?.operationId).toBe(redo.operationId);
        expect(z(redo.operationId)).toMatchObject({ status: "bereits_zurueckgenommen", reverts: [undo.operationId] });
        expect(z(redo.operationId).revertedBy?.operationId).toBe(undo2.operationId);
        expect(z(undo2.operationId)).toMatchObject({ status: "ruecknehmbar", reverts: [redo.operationId] });
        expect(z(undo2.operationId).revertedBy).toBeUndefined();

        // Hat die Redaktion die alte Regel, die die Rücknahme belebte, inzwischen übernommen, bleibt diese Zeile, wie sie ist (eine Warnung); die übrigen kommen wieder.
        await admin()`UPDATE lore_rule SET legacy_origin = 'manual' WHERE lore_entry_id = (SELECT id FROM lore_entry WHERE public_id = ${E.altlast}::uuid) AND state = 'active'`;
        const teil = await wiederherstellen(uebernahmeId);
        expect(teil.warnings.map((w) => w.code)).toEqual(["seit_uebernahme_geaendert"]);
        const teilStand = await stand();
        expect(teilStand["bremse"]).toEqual(nachUebernahme["bremse"]);
        expect(teilStand["weg"]).toEqual(nachUebernahme["weg"]);
        expect(teilStand["altlast"]).toEqual(
            nachRuecknahme["altlast"]!.map((r) => (r[0] === "active" ? ["active", "manual", null] : r)),
        );
        expect(await kopf()).toBe(false);

        // Steht gar nichts mehr so da, ist es 409 und nichts wird geschrieben; die Übernahme bleibt zurückgenommen.
        await zuruecknehmen(uebernahmeId);
        await admin()`UPDATE lore_rule SET legacy_origin = 'manual'`;
        const vorher = await stand();
        await expect(wiederherstellen(uebernahmeId)).rejects.toMatchObject({
            statusCode: 409,
            code: "nichts_wiederherzustellen",
        });
        expect(await stand()).toEqual(vorher);
        expect(await kopf()).toBe(true);
    });

    it("🔴 Rechte: Die App löscht nie eine Regel und ändert nie eine Bedingung; die Jobs-Rolle schreibt keine Regel; Protokoll und Begriffstafel schreibt, wer es soll", async () => {
        await neueWelt();
        await vorschau();
        const verbotenApp = [
            "DELETE FROM lore_rule WHERE false",
            "TRUNCATE lore_rule",
            "UPDATE lore_rule SET rule_key = 'x' WHERE false",
            "UPDATE lore_rule SET legacy_origin = 'manual' WHERE false",
            "UPDATE lore_rule SET lore_entry_id = 1 WHERE false",
            "DELETE FROM lore_rule_term WHERE false",
            "UPDATE lore_rule_term SET join_op = 'oder' WHERE false",
            "DELETE FROM lore_rule_term_type WHERE false",
            "UPDATE lore_rule_term_type SET region_type = 'x' WHERE false",
            "INSERT INTO wikisync_regel_lauf (lauf_id, zahlen) VALUES (1, '{}')",
            "INSERT INTO wikisync_regel_vorschlag (lauf_id, position, lore_entry_id, eintrag_name, art, typ, status, wartet, vorgewaehlt, waehlbar, suchtext, payload) VALUES (1, 0, 1, 'x', 'fauna', 'manuell', 'neu', false, false, false, '', '{}')",
            "DELETE FROM wikisync_regel_vorschlag WHERE false",
            "UPDATE wikisync_regel_vorschlag SET waehlbar = true WHERE false",
            "INSERT INTO wikisync_regel_wort (lauf_id, wort, anzahl, in_tafel) VALUES (1, 'x', 1, true)",
            "DELETE FROM wikisync_regel_uebernahme WHERE false",
            "UPDATE wikisync_regel_uebernahme SET lauf_id = 1 WHERE false",
            "UPDATE wikisync_regel_uebernahme_zeile SET relation = 'herkunft' WHERE false",
            "DELETE FROM wikisync_regel_uebernahme_zeile WHERE false",
            "TRUNCATE wikisync_begriff_setting",
            "INSERT INTO wikisync_begriff_state (id) VALUES (2)",
            "DELETE FROM wikisync_begriff_state",
        ];
        for (const anweisung of verbotenApp) {
            await expect(app().unsafe(anweisung), anweisung).rejects.toMatchObject({ code: "42501" });
        }
        const erlaubtApp = [
            "UPDATE lore_rule SET state = state WHERE false",
            "UPDATE lore_rule SET retired_origin = 'wikisync' WHERE false",
            "INSERT INTO wikisync_begriff_setting (wort, pillen) VALUES ('zzz', ARRAY[]::text[]) ON CONFLICT DO NOTHING",
            "DELETE FROM wikisync_begriff_setting WHERE wort = 'zzz'",
            "UPDATE wikisync_begriff_state SET updated_at = updated_at WHERE false",
        ];
        for (const anweisung of erlaubtApp) await app().unsafe(anweisung);
        const verbotenJobs = [
            "INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order) VALUES (1, repeat('a', 64), 'verbreitung', 0)",
            "UPDATE lore_rule SET state = 'retired' WHERE false",
            "INSERT INTO wikisync_begriff_setting (wort, pillen) VALUES ('yyy', ARRAY[]::text[])",
            "INSERT INTO wikisync_regel_uebernahme (lauf_id) VALUES (1)",
        ];
        for (const anweisung of verbotenJobs) {
            await expect(jobs().unsafe(anweisung), anweisung).rejects.toMatchObject({ code: "42501" });
        }
        // Die Ableitung der Vorschau räumt mit dem Lauf ab: Ein älterer Lauf entfällt samt seinen Vorschlägen (Fremdschlüssel, nicht die Jobs-Rolle).
        await vorschau();
        await vorschau();
        await vorschau();
        expect(await zahl("SELECT count(*)::int AS n FROM wikisync_regel_lauf")).toBe(2);
        expect(
            await zahl(
                "SELECT count(*)::int AS n FROM wikisync_regel_vorschlag v WHERE NOT EXISTS (SELECT 1 FROM wikisync_lauf l WHERE l.id = v.lauf_id)",
            ),
        ).toBe(0);
    });

    // ── Eine Fläche ohne Wiki-Schlüssel bekommt ihren Artikel (§25) ─────────────────────────────────────────────────────────────────
    const zuweisen = (kennung: string, titel: string, operationId: string = randomUUID()) =>
        mapOperation(
            app(),
            akteur,
            {
                operationId,
                operation: OPERATION_ZUWEISEN,
                mapDomainId: "aventuria",
                body: { flaeche: kennung, titel },
                source: "wikisync",
            },
            (tx) => weiseFlaecheZu(tx, { kennung, titel }),
        );
    const flaecheZuruecknehmen = (kennung: string) =>
        mapOperation(
            app(),
            akteur,
            {
                operationId: randomUUID(),
                operation: OPERATION_ZURUECK,
                mapDomainId: "aventuria",
                body: { flaeche: kennung },
                source: "wikisync",
            },
            (tx) => nimmFlaecheZuweisungZurueck(tx, { kennung }),
        );
    const regionZeile = async (kennung: string) =>
        (
            await wert<{ wiki_url: string | null; wiki_region_key: string | null; revision: number }>(
                `SELECT wiki_url, wiki_region_key, revision::int AS revision FROM region WHERE public_id = '${kennung}'`,
            )
        )[0]!;
    const x2Zeilen = (kennung: string) =>
        wert<{ wiki_key: string; source_system: string; is_active: boolean; retired_origin: string | null }>(
            `SELECT wiki_key, source_system, is_active, retired_origin FROM wiki_key_assignment WHERE legacy_art = 'landschaft' AND object_public_id = '${kennung}'`,
        );
    const protokoll = (kennung: string) =>
        wert<{ action: string; changes: Record<string, unknown>; op: string; source: string }>(
            `SELECT e.action, e.changes, o.action AS op, o.source FROM map_audit_event e JOIN map_operation o ON o.operation_id = e.operation_id WHERE e.region_public_id = '${kennung}' ORDER BY e.id`,
        );

    it("🔴 Fläche zuweisen: Der Server prüft alles selbst (kein vorhandener Schlüssel wird überschrieben, Name und Titel gehören zum Protokoll), schreibt Adresse, Tafel X2 und Fachprotokoll; die nächste Ableitung findet die Fläche; die Rücknahme geht nur, solange die Zuordnung noch so dasteht", async () => {
        await neueWelt();
        await admin()`DELETE FROM wiki_region_snapshot`;
        const lauf = await vorschau();
        const uebersicht = await leseOffeneFlaechen(app(), new Date());
        expect([...Value.Errors(WikisyncRegelFlaechen, uebersicht)].map((e) => e.path)).toEqual([]);
        expect(uebersicht.lauf).toBe(lauf);
        // Die offenen Flächen mit Kandidat: der Große Fluss (Wirselkraut) und Südaventurien (Krebsschere); Bornland und Maraskan tragen ihren Artikel schon.
        expect(uebersicht.flaechen.map((f) => [f.name, f.titel, f.zustand, f.vorschlaege])).toEqual(
            expect.arrayContaining([
                ["Der Große Fluss", "Der Große Fluss", "zuweisbar", 1],
                ["Südaventurien", "Südaventurien", "zuweisbar", 1],
            ]),
        );
        expect(uebersicht.flaechen.find((f) => f.name === "Der Große Fluss")).toMatchObject({
            kennung: F.fluss,
            zuruecknehmbar: false,
            zugewiesenAm: null,
        });
        expect((await liste()).lauf).toMatchObject({ veraltet: false, flaechenGeaendert: false });

        // Verweigert, und nichts ist geschrieben.
        await expect(zuweisen(F.fluss, "Ein anderer Artikel")).rejects.toMatchObject({
            statusCode: 409,
            code: "kein_kandidat",
        });
        await expect(zuweisen(F.sued, "Der Große Fluss")).rejects.toMatchObject({ code: "kein_kandidat" });
        await expect(zuweisen(F.aventurien, "Aventurien")).rejects.toMatchObject({
            statusCode: 409,
            code: "flaeche_hat_schluessel",
        });
        await expect(zuweisen(uuid("c", 99), "Der Große Fluss")).rejects.toMatchObject({ statusCode: 404 });
        expect(await regionZeile(F.fluss)).toMatchObject({ wiki_url: null, wiki_region_key: null });
        expect(await x2Zeilen(F.fluss)).toEqual([]);
        expect(await protokoll(F.fluss)).toEqual([]);

        // Zuweisen: Adresse aus dem Titel (der Wiki-Stand kennt den Artikel nicht), kein Schlüssel geraten.
        const vorher = (await regionZeile(F.fluss)).revision;
        const quittung = await zuweisen(F.fluss, "Der Große Fluss");
        expect(quittung.affected).toEqual([{ kind: "landscape", id: F.fluss, revision: vorher + 1 }]);
        expect(quittung.warnings.map((w) => w.code)).toEqual(["kein_wiki_stand"]);
        expect(await regionZeile(F.fluss)).toMatchObject({
            wiki_url: wiki("Der Große Fluss"),
            wiki_region_key: null,
            revision: vorher + 1,
        });
        expect(await x2Zeilen(F.fluss)).toEqual([
            expect.objectContaining({ source_system: "avesmaps3d", is_active: true }),
        ]);
        expect(await protokoll(F.fluss)).toEqual([
            {
                action: "region.wiki_zugewiesen",
                changes: { wiki: { before: null, after: "Der Große Fluss" } },
                op: OPERATION_ZUWEISEN,
                source: "wikisync",
            },
        ]);
        // Nie ein vorhandener Schlüssel: ein zweites Zuweisen wird verweigert.
        await expect(zuweisen(F.fluss, "Der Große Fluss")).rejects.toMatchObject({ code: "flaeche_hat_schluessel" });
        expect(await protokoll(F.fluss)).toHaveLength(1);

        // Die Liste gilt als veraltet, und die Übersicht kennt die Zuweisung samt Rücknahme.
        expect((await liste()).lauf).toMatchObject({ veraltet: false, flaechenGeaendert: true });
        const danach = (await leseOffeneFlaechen(app(), new Date())).flaechen.find((f) => f.name === "Der Große Fluss");
        expect(danach).toMatchObject({ zustand: "zugewiesen", zuruecknehmbar: true, kennung: F.fluss });
        expect(danach?.zugewiesenAm).not.toBeNull();

        // Die nächste Ableitung findet die Fläche über ihren Artikel: kein „!“ mehr an der Bedingung, und der Lauf ist wieder aktuell.
        await vorschau();
        const wirsel = nachName(await liste({ limit: 100 })).get("Wirselkraut")!;
        const bedingung = wirsel.regeln[0]?.bedingungen.find((b) => b.flaeche?.name === "Der Große Fluss");
        expect(bedingung?.flaeche).toMatchObject({ offen: false, kennung: F.fluss, kandidat: null });
        expect((await liste()).lauf).toMatchObject({ flaechenGeaendert: false });
        expect((await leseOffeneFlaechen(app(), new Date())).flaechen.map((f) => f.name)).not.toContain(
            "Der Große Fluss",
        );

        // Rücknahme: Der Schlüssel ist wieder leer, die Tafel X2 still gelegt (nicht gelöscht), das Fachprotokoll nennt es.
        await flaecheZuruecknehmen(F.fluss);
        expect(await regionZeile(F.fluss)).toMatchObject({ wiki_url: null, wiki_region_key: null });
        expect(await x2Zeilen(F.fluss)).toEqual([
            expect.objectContaining({ is_active: false, retired_origin: "editor" }),
        ]);
        expect((await protokoll(F.fluss)).map((p) => p.action)).toEqual([
            "region.wiki_zugewiesen",
            "region.wiki_entfernt",
        ]);
        await expect(flaecheZuruecknehmen(F.fluss)).rejects.toMatchObject({
            statusCode: 409,
            code: "nicht_zuruecknehmbar",
        });

        // Hat jemand die Zuordnung seitdem anders gesetzt, bleibt sie: Zurücknehmen nur, wo der Artikel noch so dasteht.
        await vorschau();
        await zuweisen(F.fluss, "Der Große Fluss");
        await admin()`UPDATE region SET wiki_url = ${wiki("Ein anderer Fluss")} WHERE public_id = ${F.fluss}::uuid`;
        await expect(flaecheZuruecknehmen(F.fluss)).rejects.toMatchObject({ code: "nicht_zuruecknehmbar" });
        expect((await regionZeile(F.fluss)).wiki_url).toBe(wiki("Ein anderer Fluss"));
    });

    it("🔴 B8e: das ↺ an der Zuweisung einer Fläche: die Vorprüfung sagt, ob die Zuweisung noch so dasteht; die Rücknahme gilt genau dieser Zuweisung und stellt die Zuordnung von vorher her (Schlüssel leer, Tafel X2 still gelegt); der Zustand in „Änderungen“ folgt dem nächsten Ereignis der Fläche", async () => {
        await neueWelt();
        await admin()`DELETE FROM wiki_region_snapshot`;
        await vorschau();
        const zuweisung = await zuweisen(F.fluss, "Der Große Fluss");
        const zustand = async (operationId: string, operation: string) =>
            (await ladeZustaende(app(), [{ operationId, source: "wikisync", operation }], undefined)).get(operationId)!;

        // Vorprüfung: Die Zuweisung steht (diese Operation ist die jüngste Zuordnung und der Artikel steht noch so da); eine andere Operation nicht.
        expect(await zuweisungSteht(app(), F.fluss, zuweisung.operationId)).toEqual({
            steht: true,
            vorhanden: true,
            name: "Der Große Fluss",
        });
        expect((await zuweisungSteht(app(), F.fluss, randomUUID())).steht).toBe(false);
        expect(await zuweisungSteht(app(), uuid("c", 99), zuweisung.operationId)).toMatchObject({
            steht: false,
            vorhanden: false,
        });
        expect(await zustand(zuweisung.operationId, OPERATION_ZUWEISEN)).toMatchObject({ status: "ruecknehmbar" });

        // Die Rücknahme nennt die Zuweisung: Eine andere Operation ist 409, und nichts ist geschrieben.
        const zurueck = (operationId: string | undefined, id: string = randomUUID()) =>
            mapOperation(
                app(),
                akteur,
                {
                    operationId: id,
                    operation: OPERATION_ZURUECK,
                    mapDomainId: "aventuria",
                    body: { flaeche: F.fluss },
                    source: "wikisync",
                },
                (tx) =>
                    nimmFlaecheZuweisungZurueck(tx, {
                        kennung: F.fluss,
                        ...(operationId === undefined ? {} : { operationId }),
                    }),
            );
        await expect(zurueck(randomUUID())).rejects.toMatchObject({ statusCode: 409, code: "nicht_zuruecknehmbar" });
        expect(await regionZeile(F.fluss)).toMatchObject({ wiki_url: wiki("Der Große Fluss") });

        const rueck = await zurueck(zuweisung.operationId);
        // Die Zuordnung von vorher: Adresse und Schlüssel leer, die Zeile der Tafel X2 still gelegt (nie gelöscht).
        expect(await regionZeile(F.fluss)).toMatchObject({ wiki_url: null, wiki_region_key: null });
        expect(await x2Zeilen(F.fluss)).toEqual([expect.objectContaining({ is_active: false })]);
        expect((await protokoll(F.fluss)).map((p) => [p.action, p.op])).toEqual([
            ["region.wiki_zugewiesen", OPERATION_ZUWEISEN],
            ["region.wiki_entfernt", OPERATION_ZURUECK],
        ]);
        // Danach: Die Zuweisung ist zurückgenommen (mit der Rücknahme des Regelfensters als Rücknahme), die Rücknahme selbst ist seit B8e2 rücknehmbar (stellt die Zuweisung wieder her).
        expect(await zustand(zuweisung.operationId, OPERATION_ZUWEISEN)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: { operationId: rueck.operationId },
        });
        expect(await zustand(rueck.operationId, OPERATION_ZURUECK)).toMatchObject({
            status: "ruecknehmbar",
            reverts: [zuweisung.operationId],
        });
        expect((await zuweisungSteht(app(), F.fluss, zuweisung.operationId)).steht).toBe(false);
        await expect(zurueck(zuweisung.operationId)).rejects.toMatchObject({ code: "nicht_zuruecknehmbar" });

        // Wird derselbe Artikel erneut zugewiesen, gilt die neue Zuweisung; die erste bleibt zurückgenommen.
        const zweite = await zuweisen(F.fluss, "Der Große Fluss");
        expect(await zustand(zweite.operationId, OPERATION_ZUWEISEN)).toMatchObject({ status: "ruecknehmbar" });
        expect(await zustand(zuweisung.operationId, OPERATION_ZUWEISEN)).toMatchObject({
            status: "bereits_zurueckgenommen",
        });
        // Hat jemand die Zuordnung seither geändert (hier: ein anderer Artikel steht an der Fläche), steht die Zuweisung nicht mehr.
        await admin()`UPDATE region SET wiki_url = ${wiki("Anderer Artikel")} WHERE public_id = ${F.fluss}`;
        expect((await zuweisungSteht(app(), F.fluss, zweite.operationId)).steht).toBe(false);
        await expect(zurueck(zweite.operationId)).rejects.toMatchObject({ code: "nicht_zuruecknehmbar" });
    });

    it("🔴 B8e2: das ↺ an der Rücknahme einer Zuweisung stellt dieselbe Zuweisung wieder her (Artikel, Adresse, Schlüssel, dieselbe X2-Zeile belebt); die Kette Zuweisen → Zurück → Wieder → Zurück → Wieder; streng, wenn die Fläche seither eine andere Zuordnung hat", async () => {
        await neueWelt();
        await vorschau();
        await admin()`INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name) VALUES ('suedaventurien', ${wiki("Südaventurien")}, 'Südaventurien')`;
        const zustand = async (operationId: string, operation: string) =>
            (await ladeZustaende(app(), [{ operationId, source: "wikisync", operation }], undefined)).get(operationId)!;
        const x2 = () =>
            wert<{ id: string; wiki_key: string; wiki_url: string; wiki_title: string | null; is_active: boolean }>(
                `SELECT id::text, wiki_key, wiki_url, wiki_title, is_active FROM wiki_key_assignment WHERE legacy_art = 'landschaft' AND object_public_id = '${F.sued}'`,
            );
        const zurueck = (operationId: string) =>
            mapOperation(
                app(),
                akteur,
                {
                    operationId: randomUUID(),
                    operation: OPERATION_ZURUECK,
                    mapDomainId: "aventuria",
                    body: { flaeche: F.sued },
                    source: "wikisync",
                },
                (tx) => nimmFlaecheZuweisungZurueck(tx, { kennung: F.sued, operationId }),
            );
        const wieder = (operationId: string) =>
            mapOperation(
                app(),
                akteur,
                {
                    operationId: randomUUID(),
                    operation: OPERATION_WIEDER,
                    mapDomainId: "aventuria",
                    body: { flaeche: F.sued },
                    source: "wikisync",
                },
                (tx) => stelleFlaecheZuweisungWiederHer(tx, { kennung: F.sued, operationId }),
            );
        const zugewiesen = {
            wiki_url: wiki("Südaventurien"),
            wiki_region_key: "suedaventurien",
        };

        // Zuweisen → Zurück: die Zeile der Tafel X2 ist da und still.
        const s = await zuweisen(F.sued, "Südaventurien");
        const [zeile] = await x2();
        expect(zeile).toMatchObject({ wiki_key: "wiki:suedaventurien", is_active: true });
        const z = await zurueck(s.operationId);
        expect(await regionZeile(F.sued)).toMatchObject({ wiki_url: null, wiki_region_key: null });
        expect(await x2()).toEqual([{ ...zeile!, is_active: false }]);
        // Die Rücknahme hat jetzt ein ↺: rücknehmbar, nennt die Zuweisung; die Vorprüfung sagt, dass die Wiederherstellung steht.
        expect(await zustand(z.operationId, OPERATION_ZURUECK)).toMatchObject({
            status: "ruecknehmbar",
            reverts: [s.operationId],
        });
        expect(await wiederherstellungSteht(app(), F.sued, z.operationId)).toEqual({
            steht: true,
            vorhanden: true,
            name: "Südaventurien",
        });
        expect((await wiederherstellungSteht(app(), F.sued, randomUUID())).steht).toBe(false);
        expect((await wiederherstellungSteht(app(), F.sued, s.operationId)).steht).toBe(false);

        // Wieder: derselbe Artikel, dieselbe Adresse, derselbe Schlüssel, dieselbe X2-Zeile (dieselbe Nummer, belebt, kein zweites Anlegen).
        const w = await wieder(z.operationId);
        expect(await regionZeile(F.sued)).toMatchObject(zugewiesen);
        expect(await x2()).toEqual([zeile]);
        expect((await protokoll(F.sued)).map((p) => [p.action, p.op, p.changes])).toEqual([
            ["region.wiki_zugewiesen", OPERATION_ZUWEISEN, { wiki: { before: null, after: "Südaventurien" } }],
            ["region.wiki_entfernt", OPERATION_ZURUECK, { wiki: { before: "Südaventurien", after: null } }],
            ["region.wiki_zugewiesen", OPERATION_WIEDER, { wiki: { before: null, after: "Südaventurien" } }],
        ]);
        expect(w.warnings).toEqual([]);
        // Die Liste: Zuweisung durch die Rücknahme zurückgenommen, die Rücknahme durch die Wiederherstellung, die Wiederherstellung rücknehmbar (sie nennt die Rücknahme).
        expect(await zustand(s.operationId, OPERATION_ZUWEISEN)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: { operationId: z.operationId },
        });
        expect(await zustand(z.operationId, OPERATION_ZURUECK)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: { operationId: w.operationId },
        });
        expect(await zustand(w.operationId, OPERATION_WIEDER)).toMatchObject({
            status: "ruecknehmbar",
            reverts: [z.operationId],
        });
        // Das Regelfenster sieht sie als Zuweisung, die sich zurücknehmen lässt.
        expect((await zuweisungSteht(app(), F.sued, w.operationId)).steht).toBe(true);
        expect((await wiederherstellungSteht(app(), F.sued, z.operationId)).steht).toBe(false);

        // Zurück → Wieder, noch einmal: Die Wiederherstellung geht mit demselben Weg zurück, deren Rücknahme stellt wieder her.
        const z2 = await zurueck(w.operationId);
        expect(await regionZeile(F.sued)).toMatchObject({ wiki_url: null, wiki_region_key: null });
        expect(await zustand(w.operationId, OPERATION_WIEDER)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: { operationId: z2.operationId },
        });
        expect(await zustand(z2.operationId, OPERATION_ZURUECK)).toMatchObject({
            status: "ruecknehmbar",
            reverts: [w.operationId],
        });
        const w2 = await wieder(z2.operationId);
        expect(await regionZeile(F.sued)).toMatchObject(zugewiesen);
        expect(await x2()).toEqual([zeile]);
        expect(await zustand(w2.operationId, OPERATION_WIEDER)).toMatchObject({ status: "ruecknehmbar" });

        // Streng: Eine Rücknahme, die nicht die jüngste Zuordnung ist, lässt sich nicht wiederherstellen (409, nichts geschrieben).
        await expect(wieder(z.operationId)).rejects.toMatchObject({ statusCode: 409, code: "nicht_wiederherstellbar" });
        const z3 = await zurueck(w2.operationId);
        const eintraege = (await protokoll(F.sued)).length;
        // Hat die Fläche seither eine andere Zuordnung bekommen, auch ohne Ereignis (Import), ist es 409.
        await admin()`UPDATE region SET wiki_url = ${wiki("Anderer Artikel")} WHERE public_id = ${F.sued}`;
        expect((await wiederherstellungSteht(app(), F.sued, z3.operationId)).steht).toBe(false);
        await expect(wieder(z3.operationId)).rejects.toMatchObject({
            statusCode: 409,
            code: "nicht_wiederherstellbar",
        });
        await admin()`UPDATE region SET wiki_url = NULL WHERE public_id = ${F.sued}`;
        // Trägt inzwischen eine andere Fläche den Artikel, ist es ebenso 409.
        const zweite = uuid("b", 21);
        await legeFlaeche(admin(), zweite, "Zweite Fläche", "Südaventurien");
        await expect(wieder(z3.operationId)).rejects.toMatchObject({
            statusCode: 409,
            code: "nicht_wiederherstellbar",
        });
        await admin()`DELETE FROM region WHERE public_id = ${zweite}`;
        expect(await regionZeile(F.sued)).toMatchObject({ wiki_url: null, wiki_region_key: null });
        expect(await x2()).toEqual([{ ...zeile!, is_active: false }]);
        expect(await protokoll(F.sued)).toHaveLength(eintraege);

        // Ist der Wiki-Stand inzwischen weg, kommt der Schlüssel aus der X2-Zeile (der des Stands, nicht aus der Adresse geraten).
        await admin()`DELETE FROM wiki_region_snapshot`;
        const w3 = await wieder(z3.operationId);
        expect(await regionZeile(F.sued)).toMatchObject(zugewiesen);
        expect(await x2()).toEqual([zeile]);
        expect(w3.warnings.map((eine) => eine.code)).toEqual(["kein_wiki_stand"]);
        // Fehlt die X2-Zeile ganz, legt die Wiederherstellung sie an (wie das Zuweisen).
        const z4 = await zurueck(w3.operationId);
        await admin()`DELETE FROM wiki_key_assignment WHERE legacy_art = 'landschaft' AND object_public_id = ${F.sued}`;
        await wieder(z4.operationId);
        expect(await x2()).toEqual([expect.objectContaining({ is_active: true })]);
    });

    it("🔴 B8e2: ohne Wiki-Stand hatte die Fläche keinen Schlüssel, und die Wiederherstellung rät keinen; die X2-Zeile trägt den Schlüssel aus der Adresse und bleibt dieselbe", async () => {
        await neueWelt();
        await admin()`DELETE FROM wiki_region_snapshot`;
        await vorschau();
        const s = await zuweisen(F.fluss, "Der Große Fluss");
        const vorher = await wert<{ id: string; wiki_key: string }>(
            `SELECT id::text, wiki_key FROM wiki_key_assignment WHERE legacy_art = 'landschaft' AND object_public_id = '${F.fluss}'`,
        );
        const z = await mapOperation(
            app(),
            akteur,
            {
                operationId: randomUUID(),
                operation: OPERATION_ZURUECK,
                mapDomainId: "aventuria",
                body: { flaeche: F.fluss },
                source: "wikisync",
            },
            (tx) => nimmFlaecheZuweisungZurueck(tx, { kennung: F.fluss, operationId: s.operationId }),
        );
        const w = await mapOperation(
            app(),
            akteur,
            {
                operationId: randomUUID(),
                operation: OPERATION_WIEDER,
                mapDomainId: "aventuria",
                body: { flaeche: F.fluss },
                source: "wikisync",
            },
            (tx) => stelleFlaecheZuweisungWiederHer(tx, { kennung: F.fluss, operationId: z.operationId }),
        );
        expect(w.warnings.map((eine) => eine.code)).toEqual(["kein_wiki_stand"]);
        expect(await regionZeile(F.fluss)).toMatchObject({ wiki_url: wiki("Der Große Fluss"), wiki_region_key: null });
        expect(
            await wert(
                `SELECT id::text, wiki_key FROM wiki_key_assignment WHERE legacy_art = 'landschaft' AND object_public_id = '${F.fluss}'`,
            ),
        ).toEqual(vorher);
    });

    it("🔴 Fläche zuweisen: Kennt der Wiki-Stand den Artikel, gelten seine Adresse und sein Schlüssel; ein Artikel, den schon eine Fläche trägt, geht nicht ein zweites Mal; zwei gleichnamige Flächen ohne Schlüssel sind mehrdeutig (kein Raten)", async () => {
        await neueWelt();
        await vorschau();
        await admin()`INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name) VALUES ('suedaventurien', ${wiki("Südaventurien")}, 'Südaventurien')`;
        const quittung = await zuweisen(F.sued, "Südaventurien");
        expect(quittung.warnings).toEqual([]);
        expect(await regionZeile(F.sued)).toMatchObject({
            wiki_url: wiki("Südaventurien"),
            wiki_region_key: "suedaventurien",
        });
        expect(await x2Zeilen(F.sued)).toEqual([
            expect.objectContaining({ wiki_key: "wiki:suedaventurien", source_system: "avesmaps3d", is_active: true }),
        ]);

        // Eine zweite Fläche gleichen Namens: Der Artikel ist vergeben (auch wenn die Ableitung noch „offen“ sagt).
        const zweite = uuid("b", 20);
        await legeFlaeche(admin(), zweite, "Südaventurien", null);
        await expect(zuweisen(zweite, "Südaventurien")).rejects.toMatchObject({
            statusCode: 409,
            code: "titel_vergeben",
        });
        // Rücknahme, danach tragen zwei Flächen gleichen Namens keinen Schlüssel: Kein Name sagt, welche gemeint ist.
        await flaecheZuruecknehmen(F.sued);
        await expect(zuweisen(F.sued, "Südaventurien")).rejects.toMatchObject({ code: "mehrdeutig" });
        const mehrdeutig = (await leseOffeneFlaechen(app(), new Date())).flaechen.find(
            (f) => f.name === "Südaventurien",
        );
        expect(mehrdeutig).toMatchObject({ zustand: "mehrdeutig", kennung: null });
        expect(await regionZeile(F.sued)).toMatchObject({ wiki_url: null, wiki_region_key: null });
    });

    it("🔴 Schutz vor dem Legacy-Zug: Eine zugewiesene Zuordnung überlebt den Import der Landschaften; ohne Zuweisung gilt Legacys Wert; nach der Rücknahme wieder Legacys Wert", async () => {
        await neueWelt();
        await admin()`DELETE FROM wiki_region_snapshot`;
        await vorschau();
        await zuweisen(F.sued, "Südaventurien");
        const quadrat = (x: number): number[][][] => [
            [
                [x, 100],
                [x + 10, 100],
                [x + 10, 110],
                [x, 110],
                [x, 100],
            ],
        ];
        const legacyRegion = (id: string, name: string, key: string): Record<string, unknown> => ({
            public_id: id,
            name,
            kind: "derographisch",
            region_type: "region",
            area_count: 1,
            wiki_url: `https://de.wiki-aventurica.de/wiki/Legacy_${key}`,
            wiki_region_key: `legacy-${key}`,
        });
        const punkt = (id: string, name: string, region: string, x: number): Record<string, unknown> => ({
            geometry: { type: "Point", coordinates: [x, 105] },
            properties: { feature_type: "label", public_id: id, name, ecosystem_region_public_id: region },
        });
        const regions = {
            ok: true,
            regions: [legacyRegion(F.sued, "Südaventurien", "sued"), legacyRegion(F.orkland, "Orkland", "ork")],
        };
        const areas = {
            ok: true,
            revision: 9001,
            truncated: false,
            areas: [
                {
                    public_id: uuid("d", 1),
                    region_public_id: F.sued,
                    geometry: { type: "Polygon", coordinates: quadrat(100) },
                },
                {
                    public_id: uuid("d", 2),
                    region_public_id: F.orkland,
                    geometry: { type: "Polygon", coordinates: quadrat(200) },
                },
            ],
        };
        const labels = {
            ok: true,
            revision: 9002,
            features: [
                punkt(uuid("e", 1), "Südaventurien", F.sued, 105),
                punkt(uuid("e", 2), "Orkland", F.orkland, 205),
            ],
        };
        // Der Import nimmt die Sperre der Kartendomäne auf einer eigenen Verbindung und schreibt auf einer zweiten: Der Pool des Clusters (eine Verbindung) reichte dafür nicht.
        const optionen = cluster!.admin.options;
        const zug = createDatabase(
            `postgres://${cluster!.roles.migrate}@${String(optionen.host[0])}:${String(optionen.port[0])}/${String(optionen.database)}`,
            { max: 3 },
        );
        const importieren = () => importRegions(zug, regions as never, areas as never, labels as never);
        try {
            await importieren();
            // Südaventurien hat eine Zuweisung von Hand und behält sie; Orkland hat keine und folgt Legacy.
            expect(await regionZeile(F.sued)).toMatchObject({ wiki_url: wiki("Südaventurien"), wiki_region_key: null });
            expect(await regionZeile(F.orkland)).toMatchObject({
                wiki_url: "https://de.wiki-aventurica.de/wiki/Legacy_ork",
                wiki_region_key: "legacy-ork",
            });
            // Ein zweiter Lauf ändert nichts mehr (kein Wechsel zwischen den Werten).
            const zweiter = await importieren();
            expect(zweiter.regions.updated).toBe(0);
            expect(await regionZeile(F.sued)).toMatchObject({ wiki_url: wiki("Südaventurien") });
            // Nach der Rücknahme gilt Legacys Wert wieder.
            await flaecheZuruecknehmen(F.sued);
            await importieren();
            expect(await regionZeile(F.sued)).toMatchObject({
                wiki_url: "https://de.wiki-aventurica.de/wiki/Legacy_sued",
                wiki_region_key: "legacy-sued",
            });
        } finally {
            await zug.end({ timeout: 5 });
        }
    }, 60_000);
});
