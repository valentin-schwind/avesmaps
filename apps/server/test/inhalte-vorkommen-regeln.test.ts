import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
    INHALTE_VORKOMMEN_ORTE_URL,
    INHALTE_VORKOMMEN_UMRISS_URL,
    InhalteVorkommen,
    InhalteVorkommenAendernBody,
    InhalteVorkommenFlaechen,
    InhalteVorkommenLageOrte,
    InhalteVorkommenUmriss,
    type InhalteVorkommenAendernBody as AendernBody,
    type InhalteVorkommenRegelBedingung,
    WikisyncRegelListe,
    type WikisyncRegelBedingung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ApiError } from "../src/http/api-error.ts";
import { inhalteOperation } from "../src/inhalte/operation.ts";
import { leseVorkommen } from "../src/inhalte/vorkommen-lesen.ts";
import { sucheVorkommenFlaechen, sucheVorkommenOrte } from "../src/inhalte/vorkommen-regeln-lesen.ts";
import { aendereVorkommen, legeVorkommenAn } from "../src/inhalte/vorkommen-schreiben.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { runWikiVorschauJob, type VorschauAblage } from "../src/jobs/wiki-dump-jobs.ts";
import { leseNamespaceTafel } from "../src/kanon/tafel.ts";
import { ruleKeyOf } from "../src/migration/lore-keys.ts";
import { schreibeFehllauf, schreibeLauf } from "../src/wiki/abgleich/ablage.ts";
import { ladeBekannteTitel, ladeFlaechenTitel, ladeObjekte } from "../src/wiki/abgleich/lokal.ts";
import { wikisyncBereiche } from "../src/wiki/abgleich/schalter-lesen.ts";
import { aendereBegriffe, leseRegelListe } from "../src/wiki/regeln/anzeige.ts";
import { ladeRegelKontext } from "../src/wiki/regeln/laden.ts";
import { uebernimmRegeln } from "../src/wiki/regeln/uebernehmen.ts";
import { ladeZuweisungen } from "../src/wiki/vorschau/zuweisungen.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";
import { baueDump, neuerOrdner, type FixtureSeite } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Der Regeleditor im Reiter „Vorkommen“ (WI-0254 `--weiter`, Paket R, Bezug WI-0253 §26) gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS (alle Vorlagen unter `src/db/`): Die App-Rolle schreibt
 * die Regeln (anlegen, ersetzen, still legen, beleben) und liest den Vorschlag des WikiSync; die Jobs-Rolle rechnet ihn im Lauf der Vorschau. Die Welt ist erfunden, nichts davon berührt eine Umgebung.
 *
 * Dazu die Lage zu einer Linie (Migration 0250): Spalten, Fingerabdruck mit sechstem Feld (Orte sortiert), Prüfung der Orte, Protokoll, Lesemodell, Suche nach Orten und die zwei Routen (Recht, ETag/304).
 *
 * Problemfälle: Der Fingerabdruck einer übernommenen Wiki-Regel weicht von dem der Ableitung ab (dann erkennt die nächste Ableitung sie nicht als „gleich“ und schlägt sie noch einmal vor); die App-Rolle scheitert an
 * einem Recht, das lokal als Besitzer fehlt (42501); eine Regeländerung macht den GANZEN Eintrag zu einem der Redaktion (R6); der WikiSync belebt eine Regel, die die Redaktion still legte; ein zweiter
 * Fingerabdruck scheitert mit 23505 statt die stille Zeile zu beleben; ajv wandelt ein leeres Feld still um.
 */

const ENV = "inhaltereg";
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
    altlast: uuid("a", 3),
};
const F = {
    aventurien: uuid("b", 1),
    meridiana: uuid("b", 2),
    orkland: uuid("b", 3),
    bornland: uuid("b", 4),
    fluss: uuid("b", 5),
    klimaband: uuid("b", 6),
    still: uuid("b", 7),
    bergwald: uuid("b", 8),
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
        titel: "Altlast",
        ns: 0,
        text: `{{Infobox Tierart\n|Name=Altlast\n|Vorkommen=${BREMSE_LEBENSRAUM}\n|Verbreitung=${BREMSE_VERBREITUNG}\n}}`,
    },
    { titel: "Meridiana", ns: 0, text: "{{Infobox Region\n|Name=Meridiana\n|Region=[[Aventurien]]\n}}" },
    { titel: "Orkland", ns: 0, text: "{{Infobox Region\n|Name=Orkland\n|Region=[[Aventurien]]\n}}" },
    { titel: "Bornland (Region)", ns: 0, text: "{{Infobox Region\n|Name=Bornland\n|Region=[[Aventurien]]\n}}" },
    { titel: "Der Große Fluss", ns: 0, text: "{{Infobox Fluss\n|Name=Der Große Fluss\n|Region=[[Aventurien]]\n}}" },
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

/** Eine Bedingung des Vorschlags als Bedingung im Körper: genau das, was das Fenster beim „Übernehmen“ schickt. */
function fuerKoerper(bedingungen: readonly WikisyncRegelBedingung[]): InhalteVorkommenRegelBedingung[] {
    return bedingungen.map((b) => ({
        verknuepfung: b.verknuepfung,
        arten: b.arten.map((a) => ({ ebene: a.ebene, art: a.art })),
        ...(b.flaeche === null
            ? {}
            : b.flaeche.offen
              ? { wartetAuf: b.flaeche.titel ?? b.flaeche.name }
              : { flaeche: b.flaeche.kennung as string }),
        ...(b.klima === null ? {} : { klima: { von: b.klima.von, bis: b.klima.bis } }),
    }));
}

describe("Regeln im Körper: Fastifys ajv wandelt nichts still um (docs/regeln/entwicklung.md, ohne Datenbank)", () => {
    it('🪤 ein leeres Feld oder ein null in einer Regel ist 400, nie ein stilles Umwandeln; eine 0 wird zur Nummer "0", ein fremdes Feld fällt weg; ein gültiger Körper kommt unverändert an', async () => {
        // `buildApp` setzt keine eigenen ajv-Optionen: Eine Route mit dem Schema des Vertrags prüft den Körper genauso (wie `territory-detail-vertrag.test.ts`); der Rauchtest der Schreibwege schickt gültige
        // Körper durch die echte Route.
        const app = Fastify();
        let angekommen: unknown;
        app.post("/probe", { schema: { body: InhalteVorkommenAendernBody } }, async (request) => {
            angekommen = request.body;
            return {};
        });
        const gut = (regel: unknown): Record<string, unknown> => ({
            operationId: randomUUID(),
            baseRevision: 1,
            regeln: [regel],
        });
        const bedingung = { verknuepfung: "und", arten: [{ ebene: "vegetation", art: "wald" }] };
        const hinzu = (bedingungen: unknown, mehr: Record<string, unknown> = {}): Record<string, unknown> => ({
            op: "add",
            relation: "verbreitung",
            bedingungen,
            ...mehr,
        });
        try {
            const ok = gut(
                hinzu(
                    [
                        { ...bedingung, klima: { von: "boreal", bis: "gemaessigt" } },
                        { ...bedingung, flaeche: F.meridiana },
                    ],
                    {
                        ersetzt: "12",
                        wikiBasis: "a".repeat(64),
                    },
                ),
            );
            expect((await app.inject({ method: "POST", url: "/probe", payload: ok })).statusCode).toBe(200);
            expect(angekommen).toEqual(ok);
            // Eine gültige Lage (ein Ort, zwei Orte, in jeder der vier Richtungen) kommt unverändert an.
            for (const richtung of ["nord", "sued", "ost", "west"]) {
                for (const orte of [[F.meridiana], [F.meridiana, F.orkland]]) {
                    const mitLage = gut(hinzu([{ verknuepfung: "und", arten: [], lage: { richtung, orte } }]));
                    angekommen = undefined;
                    expect((await app.inject({ method: "POST", url: "/probe", payload: mitLage })).statusCode).toBe(
                        200,
                    );
                    expect(angekommen).toEqual(mitLage);
                }
            }
            const abgelehnt: Record<string, unknown>[] = [
                gut(hinzu([{ ...bedingung, flaeche: "" }])),
                gut(hinzu([{ ...bedingung, flaeche: null }])),
                gut(hinzu([{ ...bedingung, wartetAuf: "" }])),
                gut(hinzu([{ ...bedingung, wartetAuf: null }])),
                gut(hinzu([{ ...bedingung, klima: null }])),
                gut(hinzu([{ ...bedingung, klima: { von: "boreal" } }])),
                // Die Lage (Migration 0250): nie null, 1 bis 2 Orte als Kennung, vier Richtungen.
                gut(hinzu([{ ...bedingung, lage: null }])),
                gut(hinzu([{ ...bedingung, lage: { richtung: "sued" } }])),
                gut(hinzu([{ ...bedingung, lage: { richtung: "sued", orte: [] } }])),
                gut(hinzu([{ ...bedingung, lage: { richtung: "sued", orte: [F.meridiana, F.orkland, F.bornland] } }])),
                gut(hinzu([{ ...bedingung, lage: { richtung: "nordost", orte: [F.meridiana] } }])),
                gut(hinzu([{ ...bedingung, lage: { richtung: "sued", orte: [""] } }])),
                gut(hinzu([{ ...bedingung, lage: { richtung: "sued", orte: ["Gareth"] } }])),
                gut(hinzu([{ ...bedingung, lage: { richtung: "sued", orte: [null] } }])),
                gut(hinzu([bedingung], { ersetzt: "" })),
                gut(hinzu([bedingung], { ersetzt: null })),
                gut(hinzu([bedingung], { wikiBasis: "" })),
                gut(hinzu([bedingung], { wikiBasis: null })),
                gut(hinzu([])),
                gut(hinzu(null)),
                gut({ op: "remove", ruleId: "" }),
                gut({ op: "remove", ruleId: null }),
                gut({ op: "remove" }),
            ];
            for (const [index, payload] of abgelehnt.entries()) {
                const antwort = await app.inject({ method: "POST", url: "/probe", payload });
                expect(antwort.statusCode, `Fall ${String(index)}: ${JSON.stringify(payload["regeln"])}`).toBe(400);
            }
            // Ein fremdes Feld streift ajv still ab (dokumentiert, kein 400): Ein Tippfehler im Namen eines Felds ginge also verloren, darum steht die Form des Körpers im Vertrag und im Test der Oberfläche.
            angekommen = undefined;
            expect(
                (await app.inject({ method: "POST", url: "/probe", payload: gut(hinzu([{ ...bedingung, fremd: 1 }])) }))
                    .statusCode,
            ).toBe(200);
            expect((angekommen as { regeln: unknown[] }).regeln).toEqual([hinzu([bedingung])]);
            // Eine 0 ist keine Regelnummer: ajv macht daraus die Zeichenkette "0"; der Server findet keine Regel mit dieser Nummer und antwortet 400 (unten, `ruleId:unknown`), er deutet sie nie als „nichts“.
            angekommen = undefined;
            expect(
                (await app.inject({ method: "POST", url: "/probe", payload: gut({ op: "remove", ruleId: 0 }) }))
                    .statusCode,
            ).toBe(200);
            expect(angekommen).toMatchObject({ regeln: [{ op: "remove", ruleId: "0" }] });
        } finally {
            await app.close();
        }
    });
});

describeWithCluster("Regeln eines Vorkommens im Fenster „Inhalte bearbeiten“ (Wegwerf-Cluster)", () => {
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

    async function legeEintrag(db: Database, id: string, art: string, name: string, artikel: string): Promise<string> {
        const [zeile] = await db<{ id: string }[]>`
            INSERT INTO lore_entry (public_id, wiki_key, kind, name, wiki_title, wiki_url, legacy_origin, state, source_system, is_active)
            VALUES (${id}::uuid, ${artikel.toLowerCase().replaceAll(" ", "-")}, ${art}, ${name}, ${artikel}, ${wiki(artikel)}, 'wiki', 'active', 'legacy', TRUE)
            RETURNING id::text AS id
        `;
        return zeile!.id;
    }

    async function legeFlaeche(
        db: Database,
        id: string,
        name: string,
        titel: string | null,
        ebene = "derographisch",
        art = "region",
    ): Promise<void> {
        await db`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, wiki_url)
            VALUES (${id}::uuid, 'aventuria', ${name}, ${ebene}, ${art}, ${titel === null ? null : wiki(titel)})
        `;
    }

    /** Eine Regel aus Legacy oder dem WikiSync (ohne Zutun der App): Herkunft, Kette über Flächen und Arten, Fingerabdruck. */
    async function legeRegel(
        eintrag: string,
        herkunft: "manual" | "wiki_verbreitung",
        schluessel: string,
        kette: { flaeche: string; arten?: string[]; join?: string }[],
        zustand: { system?: string; state?: string; abgang?: string | null } = {},
    ): Promise<string> {
        const state = zustand.state ?? "active";
        const [regel] = await admin()<{ id: string }[]>`
            INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order, legacy_origin, state, source_system, is_active, retired_at, retired_origin)
            VALUES (${eintrag}::bigint, ${schluessel}, 'verbreitung', 0, ${herkunft}, ${state}, ${zustand.system ?? "legacy"}, ${state === "active"},
                    ${state === "active" ? null : new Date()}, ${state === "active" ? null : (zustand.abgang ?? "editor")})
            RETURNING id::text AS id
        `;
        for (const [seq, bedingung] of kette.entries()) {
            const [term] = await admin()<{ id: string }[]>`
                INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, area_region_id)
                VALUES (${regel!.id}::bigint, ${seq}, ${bedingung.join ?? (seq === 0 ? "und" : "oder")},
                        (SELECT id FROM region WHERE public_id = ${bedingung.flaeche}::uuid))
                RETURNING id::text AS id
            `;
            for (const art of bedingung.arten ?? []) {
                await admin()`INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type) VALUES (${term!.id}::bigint, 'vegetation', ${art})`;
            }
        }
        return regel!.id;
    }

    async function neueWelt(): Promise<{ altlast: string; bremse: string; wirsel: string }> {
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
        await legeFlaeche(db, F.bornland, "Bornland", "Bornland (Region)");
        // Der Große Fluss hat keinen Wiki-Schlüssel (F4): nur sein Name ist bekannt.
        await legeFlaeche(db, F.fluss, "Der Große Fluss", null);
        await legeFlaeche(db, F.klimaband, "Gemäßigtes Band", null, "klima", "gemaessigt");
        await legeFlaeche(db, F.still, "Stille Fläche", null);
        await db`UPDATE region SET is_active = FALSE WHERE public_id = ${F.still}::uuid`;
        await legeFlaeche(db, F.bergwald, "Bergwald", null, "vegetation", "wald");
        const bremse = await legeEintrag(db, E.bremse, "fauna", "Bremse", "Bremse");
        const wirsel = await legeEintrag(db, E.wirsel, "flora", "Wirselkraut", "Wirselkraut");
        const altlast = await legeEintrag(db, E.altlast, "fauna", "Altlast", "Altlast");
        // Eine alte, vom Wiki abgeleitete Regel mit anderer Kette (ihr Fingerabdruck ist erfunden): die Ableitung schlägt `geaendert` vor.
        await legeRegel(altlast, "wiki_verbreitung", "2".repeat(64), [{ flaeche: F.meridiana, arten: ["wald"] }]);
        return { altlast, bremse, wirsel };
    }

    const liste = async () => leseRegelListe(app(), { limit: 100 }, new Date());
    const vorschlagId = async (name: string): Promise<number> => {
        const eins = (await liste()).vorschlaege.find((v) => v.eintrag.name === name);
        if (eins === undefined) throw new Error(`kein Vorschlag für ${name}`);
        return eins.id;
    };
    const regelnVon = async (id: string) =>
        wert<{
            id: string;
            relation: string;
            state: string;
            herkunft: string;
            system: string;
            abgang: string | null;
            terme: number;
            key: string;
            basis: string | null;
            sortierung: number;
        }>(
            `SELECT r.id::text AS id, r.relation, r.state, r.legacy_origin AS herkunft, r.source_system AS system, r.retired_origin AS abgang, r.rule_key AS key,
                    r.wiki_basis_key AS basis, r.sort_order::int AS sortierung, (SELECT count(*)::int FROM lore_rule_term t WHERE t.lore_rule_id = r.id) AS terme
               FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${id}' ORDER BY r.id`,
        );
    const eintragZeile = async (id: string) =>
        (
            await wert<{ revision: number; source_system: string }>(
                `SELECT revision::int AS revision, source_system FROM lore_entry WHERE public_id = '${id}'`,
            )
        )[0]!;

    async function aendere(id: string, body: Omit<AendernBody, "operationId" | "baseRevision">, revision?: number) {
        const stand = revision ?? (await eintragZeile(id)).revision;
        return aendereVorkommen(app(), akteur, id, { operationId: randomUUID(), baseRevision: stand, ...body });
    }
    const fehler = async (work: Promise<unknown>): Promise<ApiError> => {
        try {
            await work;
        } catch (error) {
            if (error instanceof ApiError) return error;
            throw error;
        }
        throw new Error("ging durch");
    };
    const pfade = (e: ApiError): string[] =>
        ((e.details as { issues?: { path: string; rule: string }[] } | undefined)?.issues ?? []).map(
            (i) => `${i.path}:${i.rule}`,
        );

    async function uebernehmenWikiSync(lauf: number, ids: number[]) {
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

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("inhalte-regeln");
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
            schreibeFehllauf: (eingabe, fehlerText) => schreibeFehllauf(j, eingabe, fehlerText),
            ausloeser: () => Promise.resolve("jobs-cli"),
        };
    }, 240_000);
    afterAll(async () => {
        await ordner?.weg();
        await cluster?.stop();
    }, 60_000);

    it("🔴 Vorschlag am Eintrag: das Lesemodell nennt Lauf, Beziehung, Schlüssel und Bedingungen; passt zum Schema; ohne Lauf fehlt er", async () => {
        await neueWelt();
        expect((await leseVorkommen(app(), E.bremse))!.wikiVorschlag).toBeUndefined();
        const lauf = await vorschau();
        const eintrag = (await leseVorkommen(app(), E.bremse))!;
        // Das Schema der Antwort kennt jedes Feld (Fastify streift sonst ab, ein Feld zu viel verwürfe die Antwort mit 500).
        expect([...Value.Errors(InhalteVorkommen, eintrag)].map((e) => e.path)).toEqual([]);
        expect(eintrag.wikiVorschlag).toMatchObject({
            lauf,
            veraltet: false,
            typ: "vollstaendig",
            vorgewaehlt: true,
            sperre: null,
        });
        expect(eintrag.wikiVorschlag!.am).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
        const regel = eintrag.wikiVorschlag!.regeln[0]!;
        expect(regel).toMatchObject({ beziehung: "verbreitung", status: "neu", aktuell: true, bisherIds: [] });
        expect(regel.schluessel).toMatch(/^[0-9a-f]{64}$/u);
        expect(
            regel.bedingungen.map((b) => [b.verknuepfung, b.flaeche?.name, b.arten.map((a) => a.art).join("|")]),
        ).toEqual([
            ["und", "Meridiana", "steppe|suempfe_moore"],
            ["oder", "Orkland", "steppe|suempfe_moore"],
        ]);
        expect(eintrag.wikiVorschlag!.original.length).toBeGreaterThan(0);
        // Altlast: eine alte Wiki-Regel; der Vorschlag nennt sie als bisher.
        const altlast = (await leseVorkommen(app(), E.altlast))!;
        const alt = (await regelnVon(E.altlast))[0]!;
        expect(altlast.wikiVorschlag!.regeln[0]).toMatchObject({
            status: "geaendert",
            bisherIds: [alt.id],
            aktuell: true,
        });
        // Die Begriffstafel ändert sich: der Vorschlag ist veraltet.
        await app().begin((tx) =>
            aendereBegriffe(tx, {
                aenderungen: [{ wort: "gewässer", pillen: ["topographie|see"] }],
                baseRevision: 1,
                actor: { personId: person, label: "Test" },
            }),
        );
        expect((await leseVorkommen(app(), E.bremse))!.wikiVorschlag!.veraltet).toBe(true);
    });

    it("🔴 Bremse: „Vorschlag übernehmen“ legt die Regel mit dem Fingerabdruck der Ableitung an (Gegenprobe), die nächste Ableitung nennt sie „gleich“; der Eintrag bleibt Legacys (R6)", async () => {
        await neueWelt();
        await vorschau();
        const vorher = (await leseVorkommen(app(), E.bremse))!;
        const vorschlag = vorher.wikiVorschlag!.regeln[0]!;
        const alt = await eintragZeile(E.bremse);
        const quittung = await aendere(E.bremse, {
            regeln: [{ op: "add", relation: "verbreitung", bedingungen: fuerKoerper(vorschlag.bedingungen) }],
        });
        expect(quittung.affected).toEqual([{ kind: "lore", id: E.bremse, revision: alt.revision + 1 }]);
        const regeln = await regelnVon(E.bremse);
        expect(regeln).toHaveLength(1);
        // Der Fingerabdruck ist der des Vorschlags, die Herkunft die des Wikis (es ist die Wiki-Regel), die Regel gehört der Redaktion.
        expect(regeln[0]).toMatchObject({
            key: vorschlag.schluessel,
            herkunft: "wiki_verbreitung",
            system: "editor",
            state: "active",
            abgang: null,
            basis: null,
            terme: 2,
        });
        const arten = await zahl(
            `SELECT count(*)::int AS n FROM lore_rule_term_type y JOIN lore_rule_term t ON t.id = y.lore_rule_term_id JOIN lore_rule r ON r.id = t.lore_rule_id
               JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${E.bremse}'`,
        );
        expect(arten).toBe(4);
        // R6: Nur die Regel gehört der Redaktion; der Eintrag bleibt einer des Legacy-Zugs.
        expect(await eintragZeile(E.bremse)).toMatchObject({ source_system: "legacy", revision: alt.revision + 1 });
        // Das Protokoll: eine Operation, `changes.rules` mit vorher und nachher.
        const audit = await wert<{
            action: string;
            changes: { rules: { before: unknown[]; after: { ruleKey: string; state: string }[] } };
        }>(`SELECT action, changes FROM map_audit_event WHERE lore_public_id = '${E.bremse}'`);
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ action: "lore.updated" });
        expect(audit[0]!.changes.rules.before).toEqual([]);
        expect(audit[0]!.changes.rules.after[0]).toMatchObject({ ruleKey: vorschlag.schluessel, state: "active" });
        // Das Lesemodell: Die Regel ist die Wiki-Regel, ohne Basis; der Vorschlag aus dem alten Lauf gilt nicht mehr (die Beziehung hat sich bewegt).
        const danach = (await leseVorkommen(app(), E.bremse))!;
        expect(danach.regeln).toHaveLength(1);
        expect(danach.regeln[0]).toMatchObject({ ruleKey: vorschlag.schluessel, ursprung: "wiki", state: "active" });
        expect(danach.regeln[0]).not.toHaveProperty("wikiBasis");
        expect(danach.wikiVorschlag!.regeln[0]!.aktuell).toBe(false);
        expect([...Value.Errors(InhalteVorkommen, danach)].map((e) => e.path)).toEqual([]);
        // Die nächste Ableitung erkennt dieselbe Kette: kein Vorschlag mehr für die Bremse.
        await vorschau();
        expect((await liste()).vorschlaege.map((v) => v.eintrag.name)).not.toContain("Bremse");
        expect((await leseVorkommen(app(), E.bremse))!.wikiVorschlag).toBeUndefined();
    });

    it("🔴 Wirselkraut: `ohne` und die wartende Fläche (`wartetAuf`) ergeben denselben Fingerabdruck wie die Ableitung (`wiki:<titel klein>`); nach dem Übernehmen heißt der Vorschlag „gleich“", async () => {
        await neueWelt();
        await vorschau();
        const vorschlag = (await leseVorkommen(app(), E.wirsel))!.wikiVorschlag!.regeln[0]!;
        expect(vorschlag.bedingungen.map((b) => b.verknuepfung)).toEqual(["und", "ohne", "ohne", "oder", "oder"]);
        expect(vorschlag.bedingungen.some((b) => b.flaeche?.offen === true)).toBe(true);
        await aendere(E.wirsel, {
            regeln: [{ op: "add", relation: "verbreitung", bedingungen: fuerKoerper(vorschlag.bedingungen) }],
        });
        const regeln = await regelnVon(E.wirsel);
        expect(regeln).toEqual([
            expect.objectContaining({
                key: vorschlag.schluessel,
                herkunft: "wiki_verbreitung",
                system: "editor",
                terme: 5,
            }),
        ]);
        const terme = await wert<{ join_op: string; area: string | null; titel: string | null }>(
            `SELECT t.join_op, t.area_region_id::text AS area, t.wiki_area_title AS titel FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id
               JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${E.wirsel}' ORDER BY t.seq`,
        );
        expect(terme.map((t) => t.join_op)).toEqual(["und", "ohne", "ohne", "oder", "oder"]);
        expect(terme.filter((t) => t.titel !== null)).toEqual([
            expect.objectContaining({ titel: "Der Große Fluss", area: null }),
        ]);
        // Das Lesen kennt `ohne` und die wartende Fläche.
        const gelesen = (await leseVorkommen(app(), E.wirsel))!;
        expect(gelesen.regeln[0]!.bedingungen.map((b) => b.joinOp)).toEqual(["und", "ohne", "ohne", "oder", "oder"]);
        expect(gelesen.regeln[0]!.bedingungen.filter((b) => b.wartetAuf !== undefined)).toEqual([
            expect.objectContaining({ wartetAuf: "Der Große Fluss" }),
        ]);
        await vorschau();
        expect((await liste()).vorschlaege.map((v) => v.eintrag.name)).not.toContain("Wirselkraut");
    });

    it("🔴 Ändern mit Basis: eine Regel von Hand ersetzt die Wiki-Regel und merkt sich ihre Fassung; die nächste Ableitung steht als „Das Wiki sagt seitdem …“ (`wikiJetzt`) daran; ↺ stellt die Wiki-Fassung her", async () => {
        await neueWelt();
        await vorschau();
        const alt = (await regelnVon(E.altlast))[0]!;
        const vorschlag = (await leseVorkommen(app(), E.altlast))!.wikiVorschlag!.regeln[0]!;
        // Die Redaktion macht aus der alten Wiki-Regel (Meridiana, Wald) eine eigene: Bornland statt Meridiana.
        await aendere(E.altlast, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    ersetzt: alt.id,
                    bedingungen: [
                        { verknuepfung: "und", arten: [{ ebene: "vegetation", art: "wald" }], flaeche: F.bornland },
                    ],
                },
            ],
        });
        const regeln = await regelnVon(E.altlast);
        expect(regeln.map((r) => [r.id === alt.id, r.state, r.herkunft, r.system, r.abgang, r.basis])).toEqual([
            [true, "retired", "wiki_verbreitung", "legacy", "editor", null],
            [false, "active", "manual", "editor", null, "2".repeat(64)],
        ]);
        // Die neue Regel steht an der Stelle der alten (Reihenfolge), der Eintrag bleibt einer des Legacy-Zugs.
        expect(regeln[1]!.sortierung).toBe(alt.sortierung);
        expect((await eintragZeile(E.altlast)).source_system).toBe("legacy");
        const gelesen = (await leseVorkommen(app(), E.altlast))!;
        const vonHand = gelesen.regeln.find((r) => r.ursprung === "manual")!;
        expect(vonHand.wikiBasis).toMatchObject({ schluessel: "2".repeat(64) });
        expect(vonHand.wikiBasis!.bedingungen!.map((b) => b.flaeche?.name)).toEqual(["Meridiana"]);
        // Der Lauf kennt die Regel von Hand noch nicht: ohne neue Ableitung gibt es kein `wikiJetzt`, und der alte Vorschlag gilt nicht mehr.
        expect(vonHand.wikiJetzt).toBeUndefined();
        expect(gelesen.wikiVorschlag!.regeln[0]!.aktuell).toBe(false);
        // Die WikiSync-Übernahme des alten Laufs überschreibt die Regel von Hand nicht.
        const altLauf = gelesen.wikiVorschlag!.lauf;
        const uebernahme = await uebernehmenWikiSync(altLauf, [await vorschlagId("Altlast")]);
        expect(uebernahme.warnings.map((w) => w.code)).toEqual(["manuell"]);
        expect((await regelnVon(E.altlast)).map((r) => r.state)).toEqual(["retired", "active"]);
        // Die nächste Ableitung: Die Beziehung trägt eine Regel von Hand, der Vorschlag ist ein Hinweis (Status manuell) und gilt.
        await vorschau();
        const jetzt = (await leseVorkommen(app(), E.altlast))!;
        const hinweis = jetzt.wikiVorschlag!.regeln[0]!;
        expect(hinweis).toMatchObject({ status: "manuell", aktuell: true, schluessel: vorschlag.schluessel });
        const mitJetzt = jetzt.regeln.find((r) => r.ursprung === "manual")!;
        expect(mitJetzt.wikiJetzt).toMatchObject({ schluessel: vorschlag.schluessel, geaendert: true });
        expect(mitJetzt.wikiJetzt!.bedingungen.map((b) => b.flaeche?.name)).toEqual(["Meridiana", "Orkland"]);
        expect([...Value.Errors(InhalteVorkommen, jetzt)].map((e) => e.path)).toEqual([]);
        // ↺ Wiki-Fassung: die Regel von Hand weicht der Fassung, die das Wiki jetzt ergibt (derselbe Fingerabdruck wie die Ableitung, Herkunft Wiki).
        await aendere(E.altlast, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    ersetzt: mitJetzt.ruleId,
                    bedingungen: fuerKoerper(mitJetzt.wikiJetzt!.bedingungen),
                },
            ],
        });
        const hergestellt = await regelnVon(E.altlast);
        expect(
            hergestellt.map((r) => [r.state, r.herkunft, r.system, r.abgang, r.key === vorschlag.schluessel]),
        ).toEqual([
            ["retired", "wiki_verbreitung", "legacy", "editor", false],
            ["retired", "manual", "editor", "editor", false],
            ["active", "wiki_verbreitung", "editor", null, true],
        ]);
        await vorschau();
        expect((await liste()).vorschlaege.map((v) => v.eintrag.name)).not.toContain("Altlast");
    });

    it("🔴 Beleben statt 23505: derselbe Fingerabdruck belebt die still gelegte Zeile, auch die einer Wiki-Regel; ein zweiter aktiver Fingerabdruck wird mit `regel_besteht` abgewiesen", async () => {
        await neueWelt();
        await vorschau();
        const vorschlag = (await leseVorkommen(app(), E.bremse))!.wikiVorschlag!.regeln[0]!;
        const kette = fuerKoerper(vorschlag.bedingungen);
        await aendere(E.bremse, { regeln: [{ op: "add", relation: "verbreitung", bedingungen: kette }] });
        const wikiRegel = (await regelnVon(E.bremse))[0]!;
        // Die Redaktion ändert die Wiki-Regel: Die Wiki-Regel liegt still, die neue trägt ihre Fassung als Basis.
        await aendere(E.bremse, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    ersetzt: wikiRegel.id,
                    bedingungen: [
                        { verknuepfung: "und", arten: [{ ebene: "vegetation", art: "steppe" }], flaeche: F.bornland },
                    ],
                },
            ],
        });
        const nachAenderung = await regelnVon(E.bremse);
        expect(nachAenderung.map((r) => [r.state, r.herkunft, r.basis])).toEqual([
            ["retired", "wiki_verbreitung", null],
            ["active", "manual", wikiRegel.key],
        ]);
        // Dieselbe Kette noch einmal: Es gibt sie schon.
        const doppelt = await fehler(
            aendere(E.bremse, {
                regeln: [
                    {
                        op: "add",
                        relation: "verbreitung",
                        bedingungen: [
                            {
                                verknuepfung: "und",
                                arten: [{ ebene: "vegetation", art: "steppe" }],
                                flaeche: F.bornland,
                            },
                        ],
                    },
                ],
            }),
        );
        expect(doppelt).toMatchObject({ statusCode: 400, code: "regel_besteht" });
        // ↺: Die Wiki-Fassung kommt zurück, die Zeile lebt wieder auf (keine zweite, kein 23505), die Regel von Hand liegt still.
        await aendere(E.bremse, {
            regeln: [{ op: "add", relation: "verbreitung", ersetzt: nachAenderung[1]!.id, bedingungen: kette }],
        });
        const danach = await regelnVon(E.bremse);
        expect(danach.map((r) => [r.id === wikiRegel.id, r.state, r.abgang])).toEqual([
            [true, "active", null],
            [false, "retired", "editor"],
        ]);
        // Dieselbe Kette, die ersetzte Regel ist schon diese: nichts zu ändern.
        const revision = (await eintragZeile(E.bremse)).revision;
        await aendere(E.bremse, {
            regeln: [{ op: "add", relation: "verbreitung", ersetzt: wikiRegel.id, bedingungen: kette }],
        });
        expect((await eintragZeile(E.bremse)).revision).toBe(revision);
    });

    it("🔴 Entfernen legt still, es löscht nie: eine Regel aus Legacy oder dem WikiSync wird unterdrückt, eine eigene gelöst; die Übernahme des WikiSync belebt keine, die die Redaktion still legte", async () => {
        const { altlast } = await neueWelt();
        const lauf0 = await vorschau();
        // Eine Regel des WikiSync (source_system wikisync) für die Bremse, eine aus Legacy (Altlast), eine eigene (Wirselkraut).
        await uebernehmenWikiSync(lauf0, [await vorschlagId("Bremse")]);
        const vomWikiSync = (await regelnVon(E.bremse))[0]!;
        expect(vomWikiSync).toMatchObject({ system: "wikisync", herkunft: "wiki_verbreitung", state: "active" });
        const aus = await legeRegel(altlast, "manual", "3".repeat(64), [{ flaeche: F.orkland, arten: ["steppe"] }]);
        await aendere(E.bremse, { regeln: [{ op: "remove", ruleId: vomWikiSync.id }] });
        await aendere(E.altlast, { regeln: [{ op: "remove", ruleId: aus }] });
        expect((await regelnVon(E.bremse)).map((r) => [r.state, r.abgang])).toEqual([["suppressed", "editor"]]);
        expect((await regelnVon(E.altlast)).map((r) => [r.state, r.abgang])).toEqual([
            ["active", null],
            ["suppressed", "editor"],
        ]);
        const eigene = (await leseVorkommen(app(), E.wirsel))!.wikiVorschlag!.regeln[0]!;
        await aendere(E.wirsel, {
            regeln: [{ op: "add", relation: "verbreitung", bedingungen: fuerKoerper(eigene.bedingungen) }],
        });
        await aendere(E.wirsel, { regeln: [{ op: "remove", ruleId: (await regelnVon(E.wirsel))[0]!.id }] });
        expect((await regelnVon(E.wirsel)).map((r) => [r.state, r.abgang])).toEqual([["retired", "editor"]]);
        // Zweimal dieselbe Regel entfernen: schon still. Eine fremde Nummer: gibt es nicht.
        expect(pfade(await fehler(aendere(E.bremse, { regeln: [{ op: "remove", ruleId: vomWikiSync.id }] })))).toEqual([
            "regeln.0.ruleId:state",
        ]);
        expect(pfade(await fehler(aendere(E.bremse, { regeln: [{ op: "remove", ruleId: "999999" }] })))).toEqual([
            "regeln.0.ruleId:unknown",
        ]);
        // Der WikiSync leitet die Bremse neu ab (keine aktive Regel mehr, `neu`): Die Übernahme belebt die unterdrückte Regel nicht und legt nichts daneben.
        const lauf1 = await vorschau();
        const neu = (await liste()).vorschlaege.find((v) => v.eintrag.name === "Bremse")!;
        expect(neu).toMatchObject({ status: "neu", waehlbar: true });
        const uebernahme = await uebernehmenWikiSync(lauf1, [neu.id]);
        expect(uebernahme.warnings.map((w) => w.code)).toEqual(["manuell"]);
        expect((await regelnVon(E.bremse)).map((r) => [r.state, r.abgang])).toEqual([["suppressed", "editor"]]);
        // Der Vorschlag im Eintrag gilt nicht mehr „aktuell“: Die Redaktion hat diesen Schlüssel selbst still gelegt.
        expect((await leseVorkommen(app(), E.bremse))!.wikiVorschlag!.regeln[0]!.aktuell).toBe(false);
    });

    it("🔴 WikiSync belebt nur, was der WikiSync still legte (`retired_origin = wikisync`): Eine Wiki-Regel, die die Redaktion still legte, bleibt es, auch wenn daneben eine andere Wiki-Regel steht", async () => {
        const { bremse } = await neueWelt();
        // Eine andere Wiki-Regel steht aktiv da (erfundener Fingerabdruck); das Wiki sagt etwas anderes: `geaendert`.
        await legeRegel(bremse, "wiki_verbreitung", "5".repeat(64), [{ flaeche: F.meridiana, arten: ["wald"] }]);
        const lauf = await vorschau();
        const vorschlag = (await liste()).vorschlaege.find((v) => v.eintrag.name === "Bremse")!;
        expect(vorschlag.regeln[0]).toMatchObject({ status: "geaendert" });
        // Die Zeile mit dem vorgeschlagenen Fingerabdruck gibt es schon: vom WikiSync angelegt, von der Redaktion still gelegt.
        const eintrag = await leseVorkommen(app(), E.bremse);
        const schluessel = eintrag!.wikiVorschlag!.regeln[0]!.schluessel!;
        await legeRegel(bremse, "wiki_verbreitung", schluessel, [{ flaeche: F.meridiana, arten: ["steppe"] }], {
            system: "wikisync",
            state: "retired",
            abgang: "editor",
        });
        const uebernahme = await uebernehmenWikiSync(lauf, [vorschlag.id]);
        expect(uebernahme.warnings.map((w) => w.code)).toEqual(["regel_besteht"]);
        expect((await regelnVon(E.bremse)).map((r) => [r.key.slice(0, 1), r.state, r.abgang])).toEqual([
            ["5", "active", null],
            [schluessel.slice(0, 1), "retired", "editor"],
        ]);
        // Dagegen belebt sie, was sie selbst still legte (die Rücknahme-Regel bleibt, wie sie war).
        await admin()`UPDATE lore_rule SET retired_origin = 'wikisync' WHERE rule_key = ${schluessel}`;
        const nochmal = await uebernehmenWikiSync(lauf, [vorschlag.id]);
        expect(nochmal.warnings).toEqual([]);
        expect((await regelnVon(E.bremse)).map((r) => [r.state, r.abgang])).toEqual([
            ["retired", "wikisync"],
            ["active", null],
        ]);
    });

    it("🔴 Prüfung: jede falsche Regel ist 400 mit dem Pfad, nichts wird geschrieben; die Revision zählt nicht; veraltet ist 409; ein unterdrückter Eintrag lässt sich nicht ändern", async () => {
        const { altlast } = await neueWelt();
        await vorschau();
        const alt = (await regelnVon(E.altlast))[0]!;
        const vorher = await eintragZeile(E.bremse);
        const wald = { ebene: "vegetation", art: "wald" };
        const einzeln = (b: Partial<InhalteVorkommenRegelBedingung>, mehr: Record<string, unknown> = {}) => ({
            regeln: [
                {
                    op: "add" as const,
                    relation: "verbreitung" as const,
                    bedingungen: [{ verknuepfung: "und" as const, arten: [wald], ...b }],
                    ...mehr,
                },
            ],
        });
        const faelle: [string, Parameters<typeof aendere>[1], string][] = [
            [
                "eine Landschaftsart, die es nicht gibt",
                einzeln({ arten: [{ ebene: "vegetation", art: "gibtesnicht" }] }),
                "regeln.0.bedingungen.0.arten:enum",
            ],
            [
                "eine Ebene, die es nicht gibt",
                einzeln({ arten: [{ ebene: "fantasie", art: "wald" }] }),
                "regeln.0.bedingungen.0.arten:enum",
            ],
            [
                "eine Klimazone, die es nicht gibt",
                einzeln({ klima: { von: "heiss", bis: "tropisch" } }),
                "regeln.0.bedingungen.0.klima:enum",
            ],
            [
                "eine Klimaspanne von warm nach kalt",
                einzeln({ klima: { von: "tropisch", bis: "polar" } }),
                "regeln.0.bedingungen.0.klima:order",
            ],
            ["eine Bedingung ohne Fläche, Art und Klima", einzeln({ arten: [] }), "regeln.0.bedingungen.0:required"],
            [
                "eine Fläche, die es nicht gibt",
                einzeln({ flaeche: randomUUID() }),
                "regeln.0.bedingungen.0.flaeche:unknown",
            ],
            ["eine stille Fläche", einzeln({ flaeche: F.still }), "regeln.0.bedingungen.0.flaeche:state"],
            ["ein Klimaband als Fläche", einzeln({ flaeche: F.klimaband }), "regeln.0.bedingungen.0.flaeche:layer"],
            [
                "Fläche und wartende Fläche zugleich",
                einzeln({ flaeche: F.meridiana, wartetAuf: "Meridiana" }),
                "regeln.0.bedingungen.0:exclusive",
            ],
            [
                "eine wartende Fläche, die der Eintrag nicht kennt",
                einzeln({ wartetAuf: "Irgendwo im Nichts" }),
                "regeln.0.bedingungen.0.wartetAuf:unknown",
            ],
            [
                "die Regelnummer 0 (ajv macht aus einer 0 die Zeichenkette)",
                { regeln: [{ op: "remove", ruleId: "0" }] },
                "regeln.0.ruleId:unknown",
            ],
            ["eine Regel, die es nicht gibt (ersetzt)", einzeln({}, { ersetzt: "999999" }), "regeln.0.ersetzt:unknown"],
            [
                "eine Wiki-Fassung, die der Eintrag nicht kennt",
                einzeln({}, { wikiBasis: "e".repeat(64) }),
                "regeln.0.wikiBasis:unknown",
            ],
        ];
        for (const [was, body, erwartet] of faelle) {
            const e = await fehler(aendere(E.altlast, body));
            expect(e.statusCode, was).toBe(400);
            expect(e.code, was).toBe("validation_failed");
            expect(pfade(e), was).toEqual([erwartet]);
        }
        // Zu viele Bedingungen (mehr als 25) kommen am Server nicht durch, auch am Schema vorbei.
        const zuViele = Array.from({ length: 26 }, () => ({ verknuepfung: "und" as const, arten: [wald] }));
        expect(
            pfade(
                await fehler(
                    aendere(E.altlast, { regeln: [{ op: "add", relation: "verbreitung", bedingungen: zuViele }] }),
                ),
            ),
        ).toEqual(["regeln.0.bedingungen:size"]);
        // Eine wartende Fläche, die der Eintrag aus dem Vorschlag kennt, geht durch; eine, die inzwischen eine Fläche der Karte trägt, nicht.
        await legeFlaeche(admin(), uuid("b", 20), "Der Große Fluss (neu)", "Der Große Fluss");
        const mitFluss = await fehler(aendere(E.wirsel, einzeln({ wartetAuf: "Der Große Fluss" })));
        expect(pfade(mitFluss)).toEqual(["regeln.0.bedingungen.0.wartetAuf:state"]);
        // Eine stille Regel lässt sich weder ersetzen noch noch einmal entfernen.
        await aendere(E.altlast, { regeln: [{ op: "remove", ruleId: alt.id }] });
        expect(pfade(await fehler(aendere(E.altlast, einzeln({}, { ersetzt: alt.id }))))).toEqual([
            "regeln.0.ersetzt:state",
        ]);
        // Ein veralteter Stand ist 409 mit wer und wann, und es steht nichts da.
        const stand = (await eintragZeile(E.altlast)).revision;
        const alter = await fehler(aendere(E.altlast, einzeln({ flaeche: F.orkland }), stand - 1));
        expect(alter).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        expect(await zahl(`SELECT count(*)::int AS n FROM lore_rule WHERE lore_entry_id = ${altlast}`)).toBe(1);
        // Nichts davon hat die Bremse berührt.
        expect(await eintragZeile(E.bremse)).toEqual(vorher);
        // Ein unterdrückter Eintrag lässt sich nur zurückholen.
        await aendere(E.altlast, { fields: { aktiv: false } });
        expect(pfade(await fehler(aendere(E.altlast, einzeln({ flaeche: F.orkland }))))).toEqual(["fields:state"]);
        // Eine Anfrage mit ausschließlich einer leeren Regelliste ist keine Änderung.
        expect(pfade(await fehler(aendere(E.bremse, { regeln: [] })))).toEqual(["fields:required"]);
    });

    it("🔴 Ein Eintrag ohne Wiki-Artikel: der Fingerabdruck geht über `avesmaps:<Kennung>`; Arten doppelt gegeben zählen einmal; die Reihenfolge der Arten ändert ihn nicht", async () => {
        await neueWelt();
        const angelegt = await legeVorkommenAn(app(), akteur, {
            operationId: randomUUID(),
            name: "Hausmoos",
            art: "flora",
        });
        const id = angelegt.publicId;
        await aendere(id, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    bedingungen: [
                        {
                            verknuepfung: "ohne",
                            arten: [
                                { ebene: "vegetation", art: "wald" },
                                { ebene: "topographie", art: "gebirge" },
                                { ebene: "vegetation", art: "wald" },
                            ],
                            klima: { von: "boreal", bis: "gemaessigt" },
                            flaeche: F.bergwald,
                        },
                    ],
                },
            ],
        });
        const erwartet = ruleKeyOf(`avesmaps:${id}`, "verbreitung", [
            {
                joinOp: "und",
                areaPublicId: F.bergwald,
                climateFrom: "boreal",
                climateTo: "gemaessigt",
                types: [
                    { layer: "topographie", type: "gebirge" },
                    { layer: "vegetation", type: "wald" },
                ],
            },
        ]);
        const regeln = await regelnVon(id);
        expect(regeln).toEqual([
            expect.objectContaining({ key: erwartet, herkunft: "manual", system: "editor", terme: 1 }),
        ]);
        // Die erste Bedingung steht immer als `und`, auch wenn der Körper `ohne` sagte; die Arten stehen einmal da.
        expect(
            await wert<{ join_op: string; n: number }>(
                `SELECT t.join_op, (SELECT count(*)::int FROM lore_rule_term_type y WHERE y.lore_rule_term_id = t.id) AS n FROM lore_rule_term t
                   JOIN lore_rule r ON r.id = t.lore_rule_id JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${id}'`,
            ),
        ).toEqual([{ join_op: "und", n: 2 }]);
        // Dieselbe Kette mit den Arten in anderer Reihenfolge ist dieselbe Regel.
        const doppelt = await fehler(
            aendere(id, {
                regeln: [
                    {
                        op: "add",
                        relation: "verbreitung",
                        bedingungen: [
                            {
                                verknuepfung: "und",
                                arten: [
                                    { ebene: "topographie", art: "gebirge" },
                                    { ebene: "vegetation", art: "wald" },
                                ],
                                klima: { von: "boreal", bis: "gemaessigt" },
                                flaeche: F.bergwald,
                            },
                        ],
                    },
                ],
            }),
        );
        expect(doppelt.code).toBe("regel_besteht");
        // Der Eintrag war schon einer der Redaktion und bleibt es; das Lesemodell nennt die Regel.
        expect((await leseVorkommen(app(), id))!.regeln[0]).toMatchObject({ ruleKey: erwartet, ursprung: "manual" });
    });

    it("🔴 Eine Regel aus Legacy lässt sich ändern, auch wenn sie eine Kennung oder Art trägt, die die Tafeln nicht (mehr) kennen; eine fremde nicht", async () => {
        const { altlast } = await neueWelt();
        // Eine Regel aus Legacy mit einer stillen Fläche (sie bleibt als Kennung stehen) und einer Art außerhalb unserer Tafel.
        const regel = await legeRegel(altlast, "manual", "4".repeat(64), [{ flaeche: F.still }]);
        const term = (
            await wert<{ id: string }>(`SELECT id::text AS id FROM lore_rule_term WHERE lore_rule_id = ${regel}`)
        )[0]!;
        await admin()`INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type) VALUES (${term.id}::bigint, 'vegetation', 'kraterlandschaft')`;
        const gelesen = (await leseVorkommen(app(), E.altlast))!.regeln.find((r) => r.ruleId === regel)!;
        expect(gelesen.bedingungen[0]).toMatchObject({
            flaeche: { kennung: F.still },
            arten: [{ art: "kraterlandschaft" }],
        });
        // Dieselbe Fläche und Art in der neuen Regel, dazu eine zweite Bedingung: erlaubt, weil die ersetzte Regel sie schon trug.
        await aendere(E.altlast, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    ersetzt: regel,
                    bedingungen: [
                        {
                            verknuepfung: "und",
                            arten: [{ ebene: "vegetation", art: "kraterlandschaft" }],
                            flaeche: F.still,
                        },
                        { verknuepfung: "oder", arten: [{ ebene: "vegetation", art: "wald" }], flaeche: F.meridiana },
                    ],
                },
            ],
        });
        expect((await regelnVon(E.altlast)).map((r) => [r.state, r.herkunft, r.terme])).toEqual([
            ["active", "wiki_verbreitung", 1],
            ["retired", "manual", 1],
            ["active", "manual", 2],
        ]);
        // Ohne die ersetzte Regel dürfte die stille Fläche und die fremde Art nicht hinein.
        const e = await fehler(
            aendere(E.altlast, {
                regeln: [
                    {
                        op: "add",
                        relation: "regionen",
                        bedingungen: [
                            { verknuepfung: "und", arten: [{ ebene: "vegetation", art: "kraterlandschaft" }] },
                        ],
                    },
                ],
            }),
        );
        expect(pfade(e)).toEqual(["regeln.0.bedingungen.0.arten:enum"]);
    });

    it("🔴 Rechte: Die App-Rolle schreibt Regeln, Bedingungen und Arten (INSERT) und legt still (UPDATE der fünf Zustandsspalten), ohne 42501; sie ändert die Kette nie und löscht nie", async () => {
        await neueWelt();
        await vorschau();
        const kette = fuerKoerper((await leseVorkommen(app(), E.wirsel))!.wikiVorschlag!.regeln[0]!.bedingungen);
        // Alle Wege im Wegwerf-Cluster als App-Rolle: anlegen, ersetzen (still legen), entfernen (still legen), beleben.
        await aendere(E.wirsel, { regeln: [{ op: "add", relation: "verbreitung", bedingungen: kette }] });
        const erste = (await regelnVon(E.wirsel))[0]!;
        await aendere(E.wirsel, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    ersetzt: erste.id,
                    bedingungen: [
                        { verknuepfung: "und", arten: [{ ebene: "vegetation", art: "steppe" }], flaeche: F.aventurien },
                    ],
                },
            ],
        });
        await aendere(E.wirsel, { regeln: [{ op: "add", relation: "verbreitung", bedingungen: kette }] });
        const zweite = (await regelnVon(E.wirsel)).find((r) => r.state === "active" && r.herkunft === "manual")!;
        await aendere(E.wirsel, { regeln: [{ op: "remove", ruleId: zweite.id }] });
        // Die Wiki-Regel lebt wieder auf (derselbe Fingerabdruck), die Regel von Hand liegt still.
        expect((await regelnVon(E.wirsel)).map((r) => [r.state, r.abgang])).toEqual([
            ["active", null],
            ["retired", "editor"],
        ]);
        // Die Rechte stehen im Katalog: Was die App nicht darf, scheitert mit 42501 (Gegenprobe der Spalten).
        const verboten = [
            "DELETE FROM lore_rule WHERE false",
            "UPDATE lore_rule SET rule_key = 'x' WHERE false",
            "UPDATE lore_rule SET wiki_basis_key = 'x' WHERE false",
            "UPDATE lore_rule SET legacy_origin = 'manual' WHERE false",
            "UPDATE lore_rule_term SET join_op = 'oder' WHERE false",
            "DELETE FROM lore_rule_term WHERE false",
            "DELETE FROM lore_rule_term_type WHERE false",
        ];
        for (const anweisung of verboten)
            await expect(app().unsafe(anweisung), anweisung).rejects.toMatchObject({ code: "42501" });
        await app().unsafe(
            "UPDATE lore_rule SET state = state, is_active = is_active, retired_at = retired_at, retired_origin = retired_origin, updated_at = updated_at WHERE false",
        );
    });

    it("🔴 Flächensuche: aktive Landschaften außerhalb der Klima-Ebene mit Ebene, Art und Wiki-Titel; Teil des Namens; ohne Text die ersten nach Name; `%` ist ein Zeichen", async () => {
        await neueWelt();
        const antwort = await sucheVorkommenFlaechen(app(), "mer", 8);
        expect(antwort.items).toEqual([
            { kennung: F.meridiana, name: "Meridiana", ebene: "derographisch", art: "region", wikiTitel: "Meridiana" },
        ]);
        expect([...Value.Errors(InhalteVorkommenFlaechen, antwort)].map((e) => e.path)).toEqual([]);
        // Eine Fläche ohne Wiki-Artikel hat keinen Titel; stille Flächen und Klimabänder fehlen.
        const bergwald = await sucheVorkommenFlaechen(app(), "Bergwald", 8);
        expect(bergwald.items).toEqual([{ kennung: F.bergwald, name: "Bergwald", ebene: "vegetation", art: "wald" }]);
        expect((await sucheVorkommenFlaechen(app(), "Stille", 8)).items).toEqual([]);
        expect((await sucheVorkommenFlaechen(app(), "Gemäßigtes", 8)).items).toEqual([]);
        // Der genaue Name vor dem Anfang vor dem Teil; ohne Text die ersten nach Name, begrenzt.
        await legeFlaeche(admin(), uuid("b", 30), "Orklandsteppe", null);
        expect((await sucheVorkommenFlaechen(app(), "orkland", 8)).items.map((f) => f.name)).toEqual([
            "Orkland",
            "Orklandsteppe",
        ]);
        const alle = await sucheVorkommenFlaechen(app(), undefined, 3);
        expect(alle.items.map((f) => f.name)).toEqual(["Aventurien", "Bergwald", "Bornland"]);
        expect((await sucheVorkommenFlaechen(app(), "%", 8)).items).toEqual([]);
        expect((await sucheVorkommenFlaechen(app(), "  ", 2)).items).toHaveLength(2);
    });

    // -----------------------------------------------------------------------------------------------------------------------------------------------------------------
    // Die Lage zu einer Linie (WI-0254, Migration 0250)
    // -----------------------------------------------------------------------------------------------------------------------------------------------------------------

    const O = {
        gareth: uuid("c", 1),
        havena: uuid("c", 2),
        perricum: uuid("c", 3),
        dorf: uuid("c", 4),
        gebaeude: uuid("c", 5),
        viertel: uuid("c", 6),
        still: uuid("c", 7),
    };

    async function legeOrt(
        id: string,
        name: string,
        subtype: string,
        x: number,
        y: number,
        aktiv = true,
    ): Promise<void> {
        await admin()`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${id}::uuid, 'aventuria', ${name}, ${subtype}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'lagetest', ${aktiv})
        `;
    }

    /** Die Welt mit sieben Orten: drei Siedlungen verschiedener Größe, ein Dorf, ein Gebäude, ein Stadtviertel und eine stille Stadt. */
    async function neueWeltMitOrten() {
        const welt = await neueWelt();
        await legeOrt(O.gareth, "Gareth", "metropole", 413.5, 280.25);
        await legeOrt(O.havena, "Havena", "grossstadt", 150, 300.125);
        await legeOrt(O.perricum, "Perricum", "stadt", 300, 100);
        await legeOrt(O.dorf, "Kuhdorf", "dorf", 500, 450);
        await legeOrt(O.gebaeude, "Garether Tempel", "gebaeude", 413, 281);
        await legeOrt(O.viertel, "Garether Altstadt", "stadtviertel", 414, 282);
        await legeOrt(O.still, "Stilldorf", "stadt", 200, 200, false);
        return welt;
    }

    const lageBed = (
        richtung: "nord" | "sued" | "ost" | "west",
        orte: string[],
        mehr: Partial<InhalteVorkommenRegelBedingung> = {},
    ): InhalteVorkommenRegelBedingung => ({ verknuepfung: "und", arten: [], lage: { richtung, orte }, ...mehr });

    const termSpalten = async (id: string) =>
        wert<{ seq: number; richtung: string | null; a: string | null; b: string | null }>(
            `SELECT t.seq::int AS seq, t.line_direction AS richtung, pa.public_id::text AS a, pb.public_id::text AS b
               FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id JOIN lore_entry e ON e.id = r.lore_entry_id
               LEFT JOIN place pa ON pa.id = t.line_place_a_id LEFT JOIN place pb ON pb.id = t.line_place_b_id
              WHERE e.public_id = '${id}' ORDER BY r.id, t.seq`,
        );

    it("🔴 Lage: eine Bedingung mit Fläche und Lage, eine nur mit Lage (zwei Orte); Spalten, Lesemodell, Fingerabdruck (nachgerechnet) und Protokoll; eine Regel ohne Lage behält ihren Schlüssel", async () => {
        await neueWeltMitOrten();
        const quittung = await aendere(E.bremse, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    bedingungen: [
                        lageBed("sued", [O.gareth], { flaeche: F.meridiana }),
                        { ...lageBed("west", [O.havena, O.gareth]), verknuepfung: "oder" },
                    ],
                },
            ],
        });
        expect(quittung.affected).toHaveLength(1);
        // Die Spalten: Richtung und die Orte in der Reihenfolge des Körpers (A, B); ohne Lage alle drei leer.
        expect(await termSpalten(E.bremse)).toEqual([
            { seq: 0, richtung: "sued", a: O.gareth, b: null },
            { seq: 1, richtung: "west", a: O.havena, b: O.gareth },
        ]);
        // Der Fingerabdruck: das sechste Feld nur mit Lage, die Orte sortiert (A–B ist B–A).
        const erwartet = ruleKeyOf("bremse", "verbreitung", [
            {
                joinOp: "und",
                areaPublicId: F.meridiana,
                climateFrom: null,
                climateTo: null,
                types: [],
                lage: { richtung: "sued", orte: [O.gareth] },
            },
            {
                joinOp: "oder",
                areaPublicId: null,
                climateFrom: null,
                climateTo: null,
                types: [],
                lage: { richtung: "west", orte: [O.gareth, O.havena] },
            },
        ]);
        const ohneLage = ruleKeyOf("bremse", "verbreitung", [
            { joinOp: "und", areaPublicId: F.meridiana, climateFrom: null, climateTo: null, types: [] },
            { joinOp: "oder", areaPublicId: null, climateFrom: null, climateTo: null, types: [] },
        ]);
        const regeln = await regelnVon(E.bremse);
        expect(regeln).toHaveLength(1);
        expect(regeln[0]).toMatchObject({ key: erwartet, herkunft: "manual", system: "editor", terme: 2 });
        expect(erwartet).not.toBe(ohneLage);
        // Das Lesemodell: Richtung und Orte mit Kennung, Name und Stelle (zwei Nachkommastellen); die Antwort passt zum Schema.
        const gelesen = (await leseVorkommen(app(), E.bremse))!;
        expect([...Value.Errors(InhalteVorkommen, gelesen)].map((e) => e.path)).toEqual([]);
        expect(gelesen.regeln[0]!.bedingungen[0]).toMatchObject({
            joinOp: "und",
            flaeche: { kennung: F.meridiana },
            lage: { richtung: "sued", orte: [{ kennung: O.gareth, name: "Gareth", x: 413.5, y: 280.25 }] },
        });
        expect(gelesen.regeln[0]!.bedingungen[1]).toMatchObject({
            joinOp: "oder",
            lage: {
                richtung: "west",
                orte: [
                    { kennung: O.havena, name: "Havena", x: 150, y: 300.13 },
                    { kennung: O.gareth, name: "Gareth", x: 413.5, y: 280.25 },
                ],
            },
        });
        expect(gelesen.regeln[0]!.bedingungen[1]).not.toHaveProperty("flaeche");
        // Das Protokoll: `lage` nur an der Bedingung mit Lage, `richtung:kennungen` (klein, sortiert, Schrägstrich).
        const audit = await wert<{
            changes: { rules: { after: { ruleKey: string; bedingungen: Record<string, unknown>[] }[] } };
        }>(`SELECT changes FROM map_audit_event WHERE lore_public_id = '${E.bremse}'`);
        const nachher = audit[0]!.changes.rules.after[0]!;
        expect(nachher.ruleKey).toBe(erwartet);
        expect(nachher.bedingungen[0]!["lage"]).toBe(`sued:${O.gareth}`);
        expect(nachher.bedingungen[1]!["lage"]).toBe(`west:${[O.gareth, O.havena].sort().join("/")}`);
        // Eine Regel ohne Lage ist die alte: derselbe Schlüssel wie ohne das Feld, keine Lage in den Spalten, im Lesemodell und im Protokoll.
        await aendere(E.wirsel, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "vegetation", art: "wald" }] }],
                },
            ],
        });
        expect((await regelnVon(E.wirsel))[0]!.key).toBe(
            ruleKeyOf("wirselkraut", "verbreitung", [
                {
                    joinOp: "und",
                    areaPublicId: null,
                    climateFrom: null,
                    climateTo: null,
                    types: [{ layer: "vegetation", type: "wald" }],
                },
            ]),
        );
        expect(await termSpalten(E.wirsel)).toEqual([{ seq: 0, richtung: null, a: null, b: null }]);
        const alt = (await leseVorkommen(app(), E.wirsel))!;
        expect(alt.regeln[0]!.bedingungen[0]).not.toHaveProperty("lage");
        const altAudit = await wert<{ changes: { rules: { after: { bedingungen: Record<string, unknown>[] }[] } } }>(
            `SELECT changes FROM map_audit_event WHERE lore_public_id = '${E.wirsel}'`,
        );
        expect(altAudit[0]!.changes.rules.after[0]!.bedingungen[0]).not.toHaveProperty("lage");
    });

    it("🔴 Lage: vertauschte Orte sind dieselbe Regel (`regel_besteht`); eine andere Richtung, ein Ort weniger oder ein anderer Ort sind andere Regeln", async () => {
        await neueWeltMitOrten();
        await aendere(E.bremse, {
            regeln: [{ op: "add", relation: "verbreitung", bedingungen: [lageBed("nord", [O.gareth, O.perricum])] }],
        });
        const vertauscht = await fehler(
            aendere(E.bremse, {
                regeln: [
                    { op: "add", relation: "verbreitung", bedingungen: [lageBed("nord", [O.perricum, O.gareth])] },
                ],
            }),
        );
        expect(vertauscht.code).toBe("regel_besteht");
        for (const andere of [
            lageBed("sued", [O.gareth, O.perricum]),
            lageBed("nord", [O.gareth]),
            lageBed("nord", [O.gareth, O.havena]),
        ]) {
            await aendere(E.bremse, { regeln: [{ op: "add", relation: "verbreitung", bedingungen: [andere] }] });
        }
        expect((await regelnVon(E.bremse)).filter((r) => r.state === "active")).toHaveLength(4);
        expect(new Set((await regelnVon(E.bremse)).map((r) => r.key)).size).toBe(4);
    });

    it("🔴 Lage: jede falsche Lage ist 400 mit dem Pfad und schreibt nichts (unbekannter, stiller und doppelter Ort, Gebäude, Stadtviertel, keine oder drei Orte, falsche Schreibweise); ein Ort der ersetzten Regel darf bleiben", async () => {
        await neueWeltMitOrten();
        const vorher = await zahl("SELECT count(*)::int AS n FROM lore_rule");
        const probe = async (bedingung: InhalteVorkommenRegelBedingung): Promise<string[]> =>
            pfade(
                await fehler(
                    aendere(E.bremse, {
                        regeln: [{ op: "add", relation: "verbreitung", bedingungen: [bedingung] }],
                    }),
                ),
            );
        const pfad = "regeln.0.bedingungen.0";
        expect(await probe(lageBed("sued", [uuid("c", 99)]))).toEqual([`${pfad}.lage.orte.0:unknown`]);
        expect(await probe(lageBed("sued", [O.gareth, uuid("c", 99)]))).toEqual([`${pfad}.lage.orte.1:unknown`]);
        expect(await probe(lageBed("sued", [O.still]))).toEqual([`${pfad}.lage.orte.0:state`]);
        expect(await probe(lageBed("sued", [O.gebaeude]))).toEqual([`${pfad}.lage.orte.0:kind`]);
        expect(await probe(lageBed("sued", [O.gareth, O.viertel]))).toEqual([`${pfad}.lage.orte.1:kind`]);
        expect(await probe(lageBed("sued", [O.gareth, O.gareth]))).toEqual([`${pfad}.lage.orte:duplicate`]);
        expect(await probe(lageBed("sued", []))).toEqual([`${pfad}.lage.orte:size`]);
        expect(await probe(lageBed("sued", [O.gareth, O.havena, O.perricum]))).toEqual([`${pfad}.lage.orte:size`]);
        expect(await probe(lageBed("sued", [O.gareth.toUpperCase()]))).toEqual([`${pfad}.lage.orte.0:format`]);
        // Ohne Fläche, Art, Klima und Lage träfe die Bedingung alles; MIT Lage ist sie gültig (oben).
        expect(await probe({ verknuepfung: "und", arten: [] })).toEqual([`${pfad}:required`]);
        expect(await zahl("SELECT count(*)::int AS n FROM lore_rule")).toBe(vorher);
        // Die Ausnahme: ein Ort, den die ersetzte Regel schon trug, darf bleiben, auch wenn er seither still gelegt wurde.
        await aendere(E.bremse, {
            regeln: [{ op: "add", relation: "verbreitung", bedingungen: [lageBed("ost", [O.perricum])] }],
        });
        await admin()`UPDATE place SET is_active = FALSE WHERE public_id = ${O.perricum}::uuid`;
        const alte = (await regelnVon(E.bremse))[0]!;
        await aendere(E.bremse, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    ersetzt: alte.id,
                    bedingungen: [lageBed("ost", [O.perricum], { klima: { von: "boreal", bis: "gemaessigt" } })],
                },
            ],
        });
        expect((await regelnVon(E.bremse)).map((r) => r.state)).toEqual(["retired", "active"]);
        // Ohne die ersetzte Regel ist derselbe stille Ort nicht mehr erlaubt.
        const ohneErsetzt = await fehler(
            aendere(E.bremse, {
                regeln: [{ op: "add", relation: "verbreitung", bedingungen: [lageBed("west", [O.perricum])] }],
            }),
        );
        expect(pfade(ohneErsetzt)).toEqual([`${pfad}.lage.orte.0:state`]);
    });

    it("🔴 Lage: Entfernen legt still wie bei jeder Regel, die Lage bleibt im Lesemodell; derselbe Fingerabdruck belebt die stille Zeile", async () => {
        await neueWeltMitOrten();
        await aendere(E.bremse, {
            regeln: [{ op: "add", relation: "verbreitung", bedingungen: [lageBed("sued", [O.havena])] }],
        });
        const id = (await regelnVon(E.bremse))[0]!.id;
        await aendere(E.bremse, { regeln: [{ op: "remove", ruleId: id }] });
        const still = (await leseVorkommen(app(), E.bremse))!.regeln[0]!;
        expect(still).toMatchObject({ state: "retired" });
        expect(still.bedingungen[0]!.lage).toMatchObject({ richtung: "sued", orte: [{ name: "Havena" }] });
        await aendere(E.bremse, {
            regeln: [{ op: "add", relation: "verbreitung", bedingungen: [lageBed("sued", [O.havena])] }],
        });
        expect((await regelnVon(E.bremse)).map((r) => r.state)).toEqual(["active"]);
    });

    it("🔴 Lage: Die Ableitung (Jobs-Rolle, ohne 42501) liest eine Regel mit Lage als „bisher“ und trägt sie ins Protokoll; die Liste der Vorschläge gibt sie nach außen und passt zum Schema", async () => {
        await neueWeltMitOrten();
        await aendere(E.bremse, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    bedingungen: [lageBed("west", [O.gareth, O.havena], { flaeche: F.meridiana })],
                },
            ],
        });
        await vorschau();
        const antwort = await liste();
        expect([...Value.Errors(WikisyncRegelListe, antwort)].map((e) => e.path)).toEqual([]);
        const bremse = antwort.vorschlaege.find((v) => v.eintrag.name === "Bremse")!;
        // Die Regel von Hand bleibt; der Vorschlag des Wikis steht daneben, und „bisher“ kennt die Lage der Regel von Hand.
        expect(bremse.regeln[0]).toMatchObject({ status: "manuell" });
        expect(bremse.regeln[0]!.bisher![0]).toMatchObject({
            flaeche: { kennung: F.meridiana },
            lage: {
                richtung: "west",
                orte: [
                    { kennung: O.gareth, name: "Gareth", x: 413.5, y: 280.25 },
                    { kennung: O.havena, name: "Havena", x: 150, y: 300.13 },
                ],
            },
        });
        // Der Vorschlag selbst hat (noch) keine Lage: Das Feld fehlt, es ist nie `null`.
        expect(bremse.regeln[0]!.bedingungen.every((b) => !("lage" in b))).toBe(true);
    });

    it("🔴 Orte-Suche: aktive Siedlungen, genauer Name vor Anfang vor Teil, bei gleichem Rang die Größe vor dem Namen; ohne Text die Metropolen und Großstädte; `%` ist ein Zeichen", async () => {
        await neueWeltMitOrten();
        await legeOrt(uuid("c", 20), "Rahja", "dorf", 10, 10);
        await legeOrt(uuid("c", 21), "Rahjasee", "stadt", 20, 20);
        await legeOrt(uuid("c", 22), "Hohe Rahja", "metropole", 30, 30);
        await legeOrt(uuid("c", 23), "Perainefurt", "dorf", 40, 40);
        const namen = async (q: string | undefined, limit = 8) =>
            (await sucheVorkommenOrte(app(), q, limit)).items.map((o) => o.name);
        // Rang: genauer Name, dann Anfang, dann irgendwo im Namen.
        expect(await namen("rahja")).toEqual(["Rahja", "Rahjasee", "Hohe Rahja"]);
        // Bei gleichem Rang entscheidet die Größe (Stadt vor Dorf), nicht der Name (Perainefurt käme alphabetisch zuerst).
        expect(await namen("per")).toEqual(["Perricum", "Perainefurt"]);
        // Gebäude, Stadtviertel und stille Orte gehören nicht zur Wahl.
        expect(await namen("Gareth")).toEqual(["Gareth"]);
        expect(await namen("Stilldorf")).toEqual([]);
        // Ohne Text: Metropolen vor Großstädten, je nach Name; Städte und Dörfer nicht.
        expect(await namen(undefined)).toEqual(["Gareth", "Hohe Rahja", "Havena"]);
        expect(await namen("  ", 2)).toEqual(["Gareth", "Hohe Rahja"]);
        expect(await namen("%")).toEqual([]);
        const antwort = await sucheVorkommenOrte(app(), "Havena", 8);
        expect(antwort.items).toEqual([{ kennung: O.havena, name: "Havena", art: "grossstadt", x: 150, y: 300.13 }]);
        expect([...Value.Errors(InhalteVorkommenLageOrte, antwort)].map((e) => e.path)).toEqual([]);
    });

    it("🔴 Routen der Lage: Orte und Umriss nur mit Anmeldung und ab Reviewer; Orte mit Rang und Grenze; Umriss mit ETag, 304 und neuem Stand nach einer Änderung der Karte; ohne Fläche 404", async () => {
        await neueWeltMitOrten();
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: "lage-routen",
            databaseUrl: undefined,
            tileRoot: undefined,
            auth: TEST_AUTH,
        };
        const server = buildApp({ config, database: app(), logStream: { write: () => undefined } });
        await server.ready();
        const fixture = authFixture(admin());
        try {
            const cookie = async (rolle: "tester" | "reviewer"): Promise<string> => {
                const jemand = await fixture.person(rolle, { name: `Lage ${rolle}` });
                return (await fixture.session(jemand.id, { passkeyMinutesAgo: 1 })).cookie;
            };
            const holen = (url: string, wer?: string, kopf: Record<string, string> = {}) =>
                server.inject({
                    method: "GET",
                    url,
                    headers: { ...kopf, ...(wer === undefined ? {} : { cookie: wer }) },
                });
            const tester = await cookie("tester");
            const reviewer = await cookie("reviewer");
            // Ohne Anmeldung 401, als Tester 403, ab Reviewer 200 (Recht `use_editor_menu`, wie alle Fenster des Editorpanels).
            for (const url of [`${INHALTE_VORKOMMEN_ORTE_URL}?q=gar`, INHALTE_VORKOMMEN_UMRISS_URL]) {
                expect((await holen(url)).statusCode, url).toBe(401);
                expect((await holen(url, tester)).statusCode, url).toBe(403);
            }
            // Orte: Rang und Grenze, nicht zwischengespeichert, die Antwort passt zum Schema.
            const orte = await holen(`${INHALTE_VORKOMMEN_ORTE_URL}?q=gar&limit=1`, reviewer);
            expect(orte.statusCode).toBe(200);
            expect(orte.headers["cache-control"]).toBe("private, no-cache");
            expect((orte.json() as { items: { name: string }[] }).items.map((o) => o.name)).toEqual(["Gareth"]);
            expect([...Value.Errors(InhalteVorkommenLageOrte, orte.json())].map((e) => e.path)).toEqual([]);
            expect((await holen(`${INHALTE_VORKOMMEN_ORTE_URL}?limit=0`, reviewer)).statusCode).toBe(400);
            expect((await holen(`${INHALTE_VORKOMMEN_ORTE_URL}?limit=21`, reviewer)).statusCode).toBe(400);
            const ohneText = await holen(INHALTE_VORKOMMEN_ORTE_URL, reviewer);
            expect((ohneText.json() as { items: { name: string }[] }).items.map((o) => o.name)).toEqual([
                "Gareth",
                "Havena",
            ]);
            // Umriss: ohne Fläche der Region „Aventurien“ gibt es keinen.
            expect((await holen(INHALTE_VORKOMMEN_UMRISS_URL, reviewer)).statusCode).toBe(404);
            await admin()`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom)
                SELECT ${uuid("d", 1)}::uuid, 'aventuria', r.id, ST_GeomFromText('POLYGON((100 100, 700 100, 700 600, 100 600, 100 100))', 0)
                  FROM region r WHERE r.public_id = ${F.aventurien}::uuid
            `;
            const erste = await holen(INHALTE_VORKOMMEN_UMRISS_URL, reviewer);
            expect(erste.statusCode).toBe(200);
            expect(erste.headers["cache-control"]).toBe("private, max-age=3600");
            const etag = erste.headers["etag"] as string;
            expect(etag).toMatch(/^"u[0-9a-f]{16}"$/);
            const umriss = erste.json() as { pfad: string; rahmen: Record<string, number> };
            expect([...Value.Errors(InhalteVorkommenUmriss, umriss)].map((e) => e.path)).toEqual([]);
            expect(umriss.pfad.startsWith("M")).toBe(true);
            expect(umriss.rahmen).toEqual({ x0: 100, x1: 700, y0: 100, y1: 600 });
            // Bedingt: derselbe Stand antwortet 304 (Node schickt bei 304 keinen Inhalt); ein anderer ETag bekommt den Umriss.
            const bedingt = await holen(INHALTE_VORKOMMEN_UMRISS_URL, reviewer, { "if-none-match": etag });
            expect(bedingt.statusCode).toBe(304);
            expect((await holen(INHALTE_VORKOMMEN_UMRISS_URL, reviewer, { "if-none-match": '"u0"' })).statusCode).toBe(
                200,
            );
            // Die Karte ändert sich (die Fläche wird größer): neuer Stand, neuer ETag, der alte bekommt wieder den Umriss.
            await admin()`
                UPDATE region_area SET geom = ST_GeomFromText('POLYGON((100 100, 800 100, 800 600, 100 600, 100 100))', 0), updated_at = now() + interval '1 second'
                 WHERE public_id = ${uuid("d", 1)}::uuid
            `;
            const zweite = await holen(INHALTE_VORKOMMEN_UMRISS_URL, reviewer, { "if-none-match": etag });
            expect(zweite.statusCode).toBe(200);
            expect(zweite.headers["etag"]).not.toBe(etag);
            expect((zweite.json() as { rahmen: Record<string, number> }).rahmen["x1"]).toBe(800);
        } finally {
            await fixture.cleanup();
            await server.close();
        }
    });
});
