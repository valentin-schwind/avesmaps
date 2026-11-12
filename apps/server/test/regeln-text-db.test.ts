import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
    INHALTE_REGELTEXT_PRUEFEN_URL,
    INHALTE_REGELTEXT_UEBERNEHMEN_URL,
    INHALTE_REGELTEXT_ZEILEN_MAX,
    InhalteRegelTextAlsText,
    InhalteRegelTextErgebnis,
    InhalteRegelTextUebernommen,
    inhalteVorkommenAlsTextUrl,
    type InhalteRegelTextErgebnis as Ergebnis,
    type InhalteRegelTextUebernommen as Uebernommen,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { ladeWelt } from "../src/inhalte/regeln-text/laden.ts";
import { pruefeText } from "../src/inhalte/regeln-text/ergebnis.ts";
import { schreibeRegelBlock } from "../src/inhalte/regeln-text/schreibe.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";
import { welt as baueWelt, type Welt } from "./support/schreibwege/welt.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „Regeln als Text“ gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS (WI-0254 §13 und §14; alle Vorlagen unter `src/db/`): Prüfen (nur lesend), Übernehmen (EINE Operation `lore.rules_text` über mehrere
 * Einträge: Regel neu, Quelle angehängt, Eintrag neu, Revision, Protokoll, Wiederholung, nichts doppelt), „Als Text“ und zurück, die Rechte und die Grenzen. Die Welt ist erfunden, nichts davon berührt eine Umgebung.
 */

const ENV = "regelntext";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const uuid = (kopf: string, nummer: number): string =>
    `${kopf}${nummer.toString(16).padStart(7, "0")}-0000-4000-9000-000000000000`;
const E = { bremse: uuid("a", 1), wirsel: uuid("a", 2), altlast: uuid("a", 3) };
const F = {
    aventurien: uuid("b", 1),
    meridiana: uuid("b", 2),
    klimaband: uuid("b", 3),
    still: uuid("b", 4),
    mondwaldFlaeche: uuid("b", 5),
};
const O = { havena: uuid("c", 1), gareth: uuid("c", 2), hafen: uuid("c", 3) };
const wiki = (titel: string): string =>
    `https://de.wiki-aventurica.de/wiki/${encodeURIComponent(titel.replaceAll(" ", "_"))}`;

describeWithCluster("Regeln als Text (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let app: ReturnType<typeof buildApp>;
    let welt: Welt;
    const admin = (): Database => cluster!.admin;
    const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);
    const zahl = async (sql: string): Promise<number> => Number((await wert<{ n: string }>(sql))[0]?.n ?? 0);
    const quellen: Record<string, string> = {};

    async function neueWelt(): Promise<void> {
        const db = admin();
        await db`
            TRUNCATE map_audit_event, map_operation, wikisync_regel_uebernahme_zeile, wikisync_regel_uebernahme, wikisync_regel_wort, wikisync_regel_vorschlag, wikisync_regel_lauf,
                     wikisync_uebernahme_befund, wikisync_uebernahme, wikisync_lauf_zeile, wikisync_lauf, wikisync_bereich_setting, wikisync_begriff_setting,
                     lore_place_target, lore_place, lore_entry_field_origin, lore_entry_source, lore_rule_term_type, lore_rule_term, lore_rule, wiki_lore_snapshot, lore_entry,
                     wiki_key_assignment, place_wiki_assignment, place_detail, place, region_area, map_label, region, feature_source
            RESTART IDENTITY CASCADE
        `;
        const flaeche = async (
            id: string,
            name: string,
            titel: string | null,
            ebene = "derographisch",
            art = "region",
            aktiv = true,
        ) =>
            db`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, wiki_url, is_active)
                VALUES (${id}::uuid, 'aventuria', ${name}, ${ebene}, ${art}, ${titel === null ? null : wiki(titel)}, ${aktiv})
            `;
        await flaeche(F.aventurien, "Aventurien", "Aventurien");
        await flaeche(F.meridiana, "Meridiana", "Meridiana");
        await flaeche(F.klimaband, "Gemäßigtes Band", null, "klima", "gemaessigt");
        await flaeche(F.still, "Stille Fläche", null, "derographisch", "region", false);
        await flaeche(F.mondwaldFlaeche, "Mondwaldfläche", null, "vegetation", "wald");
        const ort = (id: string, name: string, subtype: string, x: number, y: number) =>
            db`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${id}::uuid, 'aventuria', ${name}, ${subtype}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'regelntext', TRUE)
            `;
        await ort(O.havena, "Havena", "grossstadt", 150, 300);
        await ort(O.gareth, "Gareth", "metropole", 300, 300);
        await ort(O.hafen, "Hafenviertel", "stadtviertel", 150, 310);
        for (const [schluessel, titel, system] of [
            ["geographia", "Geographia Aventurica", "regelntext"],
            ["doppelt1", "Doppelquelle", "regelntext"],
            ["doppelt2", "Doppelquelle", "regelntext"],
        ] as const) {
            const url = `https://regelntext.example/${schluessel}`;
            const [zeile] = await db<{ public_id: string }[]>`
                INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system)
                VALUES (${`url:${createHash("sha256").update(url, "utf8").digest("hex")}`}, 'final', ${url}, ${titel}, 'briefspiel', FALSE, ${system})
                RETURNING public_id::text
            `;
            quellen[schluessel] = zeile!.public_id;
        }
        const eintrag = async (id: string, kind: string, name: string) => {
            const [zeile] = await db<{ id: string }[]>`
                INSERT INTO lore_entry (public_id, wiki_key, kind, name, wiki_title, wiki_url, legacy_origin, state, source_system, is_active)
                VALUES (${id}::uuid, ${name.toLowerCase()}, ${kind}, ${name}, ${name}, ${wiki(name)}, 'wiki', 'active', 'legacy', TRUE)
                RETURNING id::text AS id
            `;
            return zeile!.id;
        };
        await eintrag(E.bremse, "fauna", "Bremse");
        const wirsel = await eintrag(E.wirsel, "flora", "Wirselkraut");
        await eintrag(E.altlast, "fauna", "Altlast");
        // Wirselkraut wartet auf „Mondwald“, im Vorschlag des WikiSync (jüngster fertiger Lauf), und auf „Nebelwald“ in einer eigenen, still gelegten Regel.
        const [lauf] = await db<{ id: number }[]>`
            INSERT INTO wikisync_lauf (bereiche, status, dump_datei, dump_sha256, dump_stand, dump_seiten, dump_vollstaendig, parser_version, beendet_am)
            VALUES (ARRAY['ort']::text[], 'fertig', 'dump.xml', ${"a".repeat(64)}, '2026-10-01', 1, TRUE, 'regelntext-test', now())
            RETURNING id::int AS id
        `;
        await db`INSERT INTO wikisync_regel_lauf (lauf_id, begriffe_revision, zahlen) VALUES (${lauf!.id}, 1, '{}'::jsonb)`;
        await db`
            INSERT INTO wikisync_regel_vorschlag (lauf_id, position, lore_entry_id, eintrag_name, art, artikel, typ, status, wartet, vorgewaehlt, waehlbar, suchtext, payload)
            VALUES (${lauf!.id}, 0, ${wirsel}::bigint, 'Wirselkraut', 'flora', 'Wirselkraut', 'wartet', 'neu', TRUE, FALSE, FALSE, 'wirselkraut',
                    ${db.json({
                        regeln: [
                            {
                                beziehung: "verbreitung",
                                status: "neu",
                                bedingungen: [
                                    {
                                        verknuepfung: "und",
                                        flaeche: {
                                            name: "Mondwald",
                                            kennung: null,
                                            offen: true,
                                            titel: "Mondwald",
                                            kandidat: null,
                                        },
                                        arten: [],
                                        klima: null,
                                        woerter: [],
                                        rueckfragen: [],
                                    },
                                ],
                            },
                        ],
                    } as never)})
        `;
        const [regel] = await db<{ id: string }[]>`
            INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order, legacy_origin, state, source_system, is_active, retired_at, retired_origin)
            VALUES (${wirsel}::bigint, ${"9".repeat(64)}, 'herkunft', 0, 'manual', 'retired', 'editor', FALSE, now(), 'editor') RETURNING id::text AS id
        `;
        await db`INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, wiki_area_title) VALUES (${regel!.id}::bigint, 0, 'und', 'Nebelwald')`;
    }

    async function holen(url: string, cookie?: string) {
        return app.inject({
            method: "GET",
            url,
            headers: { host: "avesmaps.test", ...(cookie === undefined ? {} : { cookie }) },
        });
    }
    const eintragZeile = async (id: string) =>
        (
            await wert<{ revision: number; source_system: string; is_active: boolean }>(
                `SELECT revision::int AS revision, source_system, is_active FROM lore_entry WHERE public_id = '${id}'`,
            )
        )[0]!;
    const regelnVon = async (id: string) =>
        wert<{ relation: string; state: string; herkunft: string; system: string; terme: number }>(
            `SELECT r.relation, r.state, r.legacy_origin AS herkunft, r.source_system AS system, (SELECT count(*)::int FROM lore_rule_term t WHERE t.lore_rule_id = r.id) AS terme
               FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${id}' ORDER BY r.id`,
        );
    const pruefen = async (cookie: string, text: string) => welt.post(INHALTE_REGELTEXT_PRUEFEN_URL, cookie, { text });
    const uebernehmen = async (cookie: string, text: string, operationId: string = randomUUID()) =>
        welt.post(INHALTE_REGELTEXT_UEBERNEHMEN_URL, cookie, { operationId, text });

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: "regeln-text",
            databaseUrl: undefined,
            tileRoot: undefined,
            auth: TEST_AUTH,
            mapEditing: "testwelt",
        };
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
        welt = baueWelt(cluster, app, authFixture(cluster.admin), "");
    }, 240_000);
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    const TEXT = (): string =>
        [
            "# Stapel aus dem Buch",
            "Quelle: [[Geographia Aventurica]], S. 7",
            "Bremse (Fauna)",
            "| Verbreitung = [[Aventurien]]: [[Meridiana]]",
            "| Herkunft = nördlich von [[Havena]]",
            "Sturmwurz (Flora, neu)",
            "| Verbreitung = [[Wald]] Klima boreal bis gemäßigt",
            "Wirselkraut (Flora)",
            "| Verbreitung = [[Wald]]; [[Mondwald]] (wartet)",
        ].join("\n");

    it("🔴 Prüfen liest nur: der Plan, die Zahlen, das Schema; wartende Titel aus Vorschlag und Regeln; eine Welt ohne Schreibzeile", async () => {
        await neueWelt();
        const reviewer = await welt.jemand("reviewer");
        const vorher = {
            regeln: await zahl("SELECT count(*) AS n FROM lore_rule"),
            operationen: await zahl("SELECT count(*) AS n FROM map_operation"),
            eintraege: await zahl("SELECT count(*) AS n FROM lore_entry"),
            quellen: await zahl("SELECT count(*) AS n FROM lore_entry_source"),
        };
        const antwort = await pruefen(reviewer.cookie, TEXT());
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("private, no-store");
        const ergebnis = antwort.json<Ergebnis>();
        expect([...Value.Errors(InhalteRegelTextErgebnis, ergebnis)].map((e) => `${e.path}: ${e.message}`)).toEqual([]);
        expect(ergebnis.zahlen).toEqual({ eintraege: 3, neu: 5, schon: 0, rueckfragen: 0, fehler: 0 });
        expect(ergebnis.plan).toEqual({ regeln: 5, eintraege: 3, quellen: 3, anlegen: 1 });
        // Kommentare bleiben stehen
        expect(ergebnis.rest).toBe("# Stapel aus dem Buch");
        expect(ergebnis.eintraege.map((e) => [e.name, e.status, e.neuAnlegen, e.kennung ?? null])).toEqual([
            ["Bremse", "ok", false, E.bremse],
            ["Sturmwurz", "ok", true, null],
            ["Wirselkraut", "ok", false, E.wirsel],
        ]);
        // Wirselkraut wartet auf „Mondwald“ (Vorschlag), die Regel ist lesbar und neu
        const wirsel = ergebnis.eintraege[2]!;
        expect(wirsel.regeln[1]!.status).toBe("neu");
        expect(wirsel.regeln[1]!.bedingungen).toEqual([{ joinOp: "und", arten: [], wartetAuf: "Mondwald" }]);
        // der Titel aus einer still gelegten Regel des Eintrags zählt auch; ein fremder nicht
        const nebel = (
            await pruefen(reviewer.cookie, "Wirselkraut (Flora)\n| Verbreitung = [[Nebelwald]] (wartet)")
        ).json<Ergebnis>();
        expect(nebel.eintraege[0]!.regeln[0]!.status).toBe("neu");
        const fremd = (
            await pruefen(reviewer.cookie, "Bremse (Fauna)\n| Verbreitung = [[Mondwald]] (wartet)")
        ).json<Ergebnis>();
        expect(fremd.eintraege[0]!.regeln[0]!.status).toBe("fehler");
        // nichts wurde geschrieben
        expect({
            regeln: await zahl("SELECT count(*) AS n FROM lore_rule"),
            operationen: await zahl("SELECT count(*) AS n FROM map_operation"),
            eintraege: await zahl("SELECT count(*) AS n FROM lore_entry"),
            quellen: await zahl("SELECT count(*) AS n FROM lore_entry_source"),
        }).toEqual(vorher);
    });

    it("Prüfen: Fläche der Klima-Ebene, stille Fläche und Siedlungen: nur aktive Landschaften außerhalb der Klima-Ebene, nur Siedlungen; Rückfragen zu doppelten Quellen; Grenzen", async () => {
        const reviewer = await welt.jemand("reviewer");
        const antwort = await pruefen(
            reviewer.cookie,
            [
                "Quelle: [[Doppelquelle]]",
                "Bremse (Fauna)",
                "| Verbreitung = in [[Gemäßigtes Band]]; in [[Stille Fläche]]; südlich von [[Hafenviertel]]",
            ].join("\n"),
        );
        const e = antwort.json<Ergebnis>();
        expect(e.eintraege[0]!.regeln.map((r) => r.status)).toEqual(["fehler", "fehler", "fehler"]);
        expect(e.lose[0]!.optionen).toHaveLength(2);
        expect(e.lose[0]!.optionen[0]!.ersatz.text).toMatch(/^\[\[#[0-9a-f]{8}\|Doppelquelle\]\]$/u);
        expect(e.eintraege[0]!.quelle).toMatchObject({ status: "rueckfrage" });
        // mehr Zeilen als erlaubt: 400
        const zuViel = await pruefen(reviewer.cookie, "\n".repeat(INHALTE_REGELTEXT_ZEILEN_MAX));
        expect(zuViel.statusCode).toBe(400);
        expect(zuViel.json<{ error: { code: string } }>().error.code).toBe("validation_failed");
        expect((await pruefen(reviewer.cookie, "\n".repeat(INHALTE_REGELTEXT_ZEILEN_MAX - 1))).statusCode).toBe(200);
        expect(
            (await welt.post(INHALTE_REGELTEXT_PRUEFEN_URL, reviewer.cookie, { text: "x".repeat(200_001) })).statusCode,
        ).toBe(400);
        expect((await welt.post(INHALTE_REGELTEXT_PRUEFEN_URL, reviewer.cookie, {})).statusCode).toBe(400);
    });

    it("🔴 Übernehmen: EINE Operation über drei Einträge: Regeln neu, Quelle angehängt, Eintrag angelegt, Revision, Protokoll; die Wiederholung desselben Texts legt nichts an", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        const operationId = randomUUID();
        const revisionBremse = (await eintragZeile(E.bremse)).revision;
        const antwort = await uebernehmen(editor.cookie, TEXT(), operationId);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json<Uebernommen>();
        expect([...Value.Errors(InhalteRegelTextUebernommen, quittung)].map((e) => `${e.path}: ${e.message}`)).toEqual(
            [],
        );
        expect(quittung).toMatchObject({
            status: "applied",
            regeln: 5,
            eintraege: 3,
            quellen: 3,
            angelegt: 1,
            schon: 0,
            rest: "# Stapel aus dem Buch",
        });
        expect(quittung.affected.map((a) => a.kind)).toEqual(["lore", "lore", "lore"]);

        // Bremse: zwei Regeln von Hand, die Quelle mit Seiten, Revision +1, der Eintrag wird wegen der Quelle zu einem der Redaktion
        const bremse = await regelnVon(E.bremse);
        expect(bremse).toEqual([
            { relation: "verbreitung", state: "active", herkunft: "manual", system: "editor", terme: 2 },
            { relation: "herkunft", state: "active", herkunft: "manual", system: "editor", terme: 1 },
        ]);
        expect(await eintragZeile(E.bremse)).toMatchObject({ revision: revisionBremse + 1, source_system: "editor" });
        const quellenBremse = await wert<{
            pages: string | null;
            reference_kind: string | null;
            source_system: string;
            state: string;
        }>(
            `SELECT s.pages, s.reference_kind, s.source_system, s.state FROM lore_entry_source s JOIN lore_entry e ON e.id = s.lore_entry_id WHERE e.public_id = '${E.bremse}'`,
        );
        expect(quellenBremse).toEqual([{ pages: "7", reference_kind: null, source_system: "editor", state: "active" }]);
        // Wirselkraut: zwei Regeln, die wartende mit dem Titel des Vorschlags
        const wirsel = await regelnVon(E.wirsel);
        expect(wirsel.filter((r) => r.state === "active")).toHaveLength(2);
        expect(
            await zahl(
                `SELECT count(*) AS n FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${E.wirsel}' AND t.wiki_area_title = 'Mondwald'`,
            ),
        ).toBe(1);
        // Sturmwurz: neuer Eintrag ohne Wiki-Artikel, Revision 1, der Redaktion, mit Regel und Quelle
        const [neu] = await wert<{
            public_id: string;
            revision: number;
            source_system: string;
            wiki_key: string | null;
            kind: string;
        }>(
            "SELECT public_id::text AS public_id, revision::int AS revision, source_system, wiki_key, kind FROM lore_entry WHERE name = 'Sturmwurz'",
        );
        expect(neu).toMatchObject({ revision: 1, source_system: "editor", wiki_key: null, kind: "flora" });
        expect(await regelnVon(neu!.public_id)).toEqual([
            { relation: "verbreitung", state: "active", herkunft: "manual", system: "editor", terme: 1 },
        ]);
        expect(
            await zahl(
                `SELECT count(*) AS n FROM lore_entry_field_origin o JOIN lore_entry e ON e.id = o.lore_entry_id WHERE e.public_id = '${neu!.public_id}'`,
            ),
        ).toBe(2);
        expect(quittung.affected.map((a) => a.id).sort()).toEqual([E.bremse, E.wirsel, neu!.public_id].sort());

        // Protokoll: EINE Operation, ein Ereignis je Eintrag
        const operationen = await wert<{ action: string; source: string; summary: string }>(
            `SELECT action, source, summary FROM map_operation WHERE operation_id = '${operationId}'`,
        );
        expect(operationen).toEqual([
            {
                action: "lore.rules_text",
                source: "editor",
                summary: "Regeln als Text übernommen: 5 Regeln an 3 Einträgen, 3 Quellen angehängt, 1 Eintrag angelegt",
            },
        ]);
        const ereignisse = await wert<{
            action: string;
            revision_before: string | null;
            revision_after: string;
            rules: number;
            sources: number;
        }>(
            `SELECT action, revision_before::text, revision_after::text, jsonb_array_length(changes #> '{rules,after}') AS rules, jsonb_array_length(changes #> '{sources,after}') AS sources
               FROM map_audit_event WHERE operation_id = '${operationId}' ORDER BY id`,
        );
        expect(ereignisse.map((e) => [e.action, e.rules, e.sources])).toEqual([
            ["lore.rules_text", 2, 1],
            ["lore.created", 1, 1],
            ["lore.rules_text", 2, 1],
        ]);
        expect(ereignisse[0]!.revision_before).toBe(String(revisionBremse));
        expect(ereignisse[1]!.revision_before).toBeNull();

        // dieselbe Kennung noch einmal: dieselbe Antwort, nichts doppelt (status replayed)
        const wieder = await uebernehmen(editor.cookie, TEXT(), operationId);
        expect(wieder.statusCode).toBe(200);
        expect(wieder.json<Uebernommen>()).toMatchObject({
            status: "replayed",
            regeln: 5,
            eintraege: 3,
            quellen: 3,
            angelegt: 1,
            rest: "# Stapel aus dem Buch",
        });
        expect(await zahl("SELECT count(*) AS n FROM lore_rule WHERE state = 'active'")).toBe(5);
        // dieselbe Kennung mit anderem Text: 409
        expect((await uebernehmen(editor.cookie, "Bremse (Fauna)", operationId)).statusCode).toBe(409);

        // derselbe Text mit neuer Kennung: nichts zu übernehmen, 200 mit Nullen, keine neue Operation; der Rest nennt, was offen ist (der Kopf von Sturmwurz fragt jetzt: gibt es schon)
        const operationenVorher = await zahl("SELECT count(*) AS n FROM map_operation");
        const nochmal = await uebernehmen(editor.cookie, TEXT());
        expect(nochmal.statusCode, nochmal.body).toBe(200);
        const q2 = nochmal.json<Uebernommen>();
        expect(q2).toMatchObject({
            status: "applied",
            regeln: 0,
            eintraege: 0,
            quellen: 0,
            angelegt: 0,
            schon: 4,
            affected: [],
        });
        expect(q2.rest).toBe(
            [
                "# Stapel aus dem Buch",
                "Quelle: [[Geographia Aventurica]], S. 7",
                "Sturmwurz (Flora, neu)",
                "| Verbreitung = [[Wald]] Klima boreal bis gemäßigt",
            ].join("\n"),
        );
        expect(await zahl("SELECT count(*) AS n FROM map_operation")).toBe(operationenVorher);
        expect(await zahl("SELECT count(*) AS n FROM lore_rule WHERE state = 'active'")).toBe(5);
        expect(await zahl("SELECT count(*) AS n FROM lore_entry WHERE name = 'Sturmwurz'")).toBe(1);
        expect(await eintragZeile(E.bremse)).toMatchObject({ revision: revisionBremse + 1 });
    });

    it("Übernehmen: Fehler, Rückfragen und Vorhandenes bleiben im Rest; eine Quelle, die der Eintrag schon nennt, wird nicht noch einmal angehängt; eine stillgelegte Regel mit demselben Fingerabdruck lebt auf", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        const text = [
            "Quelle: [[Geographia Aventurica]]",
            "Altlast (Fauna)",
            "| Verbreitung = [[Aventurien]]; [[Nirgendwo]]",
            "| Herkunft = [[Wald]]",
        ].join("\n");
        const erste = (await uebernehmen(editor.cookie, text)).json<Uebernommen>();
        expect(erste).toMatchObject({ regeln: 2, eintraege: 1, quellen: 1, angelegt: 0, schon: 0 });
        expect(erste.rest).toBe(
            ["Quelle: [[Geographia Aventurica]]", "Altlast (Fauna)", "| Verbreitung = [[Nirgendwo]]"].join("\n"),
        );
        // die Quelle ist angehängt; der zweite Anlauf (neuer Rest) hängt sie nicht noch einmal an
        const zweite = (
            await uebernehmen(
                editor.cookie,
                "Quelle: [[Geographia Aventurica]]\nAltlast (Fauna)\n| Vorkommen = [[Wald]]",
            )
        ).json<Uebernommen>();
        expect(zweite).toMatchObject({ regeln: 1, quellen: 0, schon: 0, rest: "" });
        expect(
            await zahl(
                `SELECT count(*) AS n FROM lore_entry_source s JOIN lore_entry e ON e.id = s.lore_entry_id WHERE e.public_id = '${E.altlast}'`,
            ),
        ).toBe(1);
        // Rückweg: Regel still legen (Zustand der Redaktion), dann dieselbe Kette als Text: lebt auf, kein zweiter Fingerabdruck
        await admin()`UPDATE lore_rule SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor' WHERE id = (SELECT r.id FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = ${E.altlast}::uuid AND r.relation = 'vorkommen')`;
        const belebt = (
            await uebernehmen(editor.cookie, "Altlast (Fauna)\n| Vorkommen = [[Wald]]")
        ).json<Uebernommen>();
        expect(belebt).toMatchObject({ regeln: 1, schon: 0 });
        const regeln = await regelnVon(E.altlast);
        expect(regeln.filter((r) => r.relation === "vorkommen")).toEqual([
            { relation: "vorkommen", state: "active", herkunft: "manual", system: "editor", terme: 1 },
        ]);
        expect(
            await zahl(
                `SELECT count(*) AS n FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = '${E.altlast}'`,
            ),
        ).toBe(3);
    });

    it("Übernehmen: ein Eintrag mit Rückfrage legt nichts an, auch nicht seine Regeln; der Rest nennt ihn; nichts davon schreibt", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        const operationen = await zahl("SELECT count(*) AS n FROM map_operation");
        const text = "Unbekannt (Flora)\n| Verbreitung = [[Wald]]\nBremse (Fauna)\n| Verbreitung = [[Gibtesnicht]]";
        const antwort = await uebernehmen(editor.cookie, text);
        expect(antwort.statusCode).toBe(200);
        expect(antwort.json<Uebernommen>()).toMatchObject({ regeln: 0, eintraege: 0, angelegt: 0, rest: text });
        expect(await zahl("SELECT count(*) AS n FROM lore_rule")).toBe(1);
        expect(await zahl("SELECT count(*) AS n FROM map_operation")).toBe(operationen);
    });

    it("🔴 „Als Text“ und zurück: die Regeln eines Eintrags als Kurzschrift; zurückgelesen ist jede Regel schon da; unbekannte Kennung 404; lesend für Reviewer", async () => {
        await neueWelt();
        const editor = await welt.jemand("editor");
        const reviewer = await welt.jemand("reviewer");
        expect((await uebernehmen(editor.cookie, TEXT())).statusCode).toBe(200);
        const antwort = await holen(inhalteVorkommenAlsTextUrl(E.bremse), reviewer.cookie);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("private, no-cache");
        const als = antwort.json<{ text: string }>();
        expect([...Value.Errors(InhalteRegelTextAlsText, als)]).toEqual([]);
        expect(als.text).toBe(
            [
                "Bremse (Fauna)",
                "| Verbreitung = [[Aventurien]]: [[Meridiana]]",
                "| Herkunft = nördlich von [[Havena]]",
            ].join("\n"),
        );
        const zurueck = (await pruefen(reviewer.cookie, als.text)).json<Ergebnis>();
        expect(zurueck.eintraege[0]!.regeln.map((r) => [r.status, r.schon?.grund])).toEqual([
            ["schon", "bestehend"],
            ["schon", "bestehend"],
        ]);
        expect(zurueck.zahlen).toEqual({ eintraege: 1, neu: 0, schon: 2, rueckfragen: 0, fehler: 0 });
        expect(zurueck.rest).toBe("");
        // derselbe Text wie die reine Rechnung auf der Welt aus der Datenbank
        const geladen = await cluster!.app.begin((tx) => ladeWelt(tx, { nurEintrag: E.bremse }));
        expect(schreibeRegelBlock(geladen.eintragNachId.get(E.bremse)!, geladen.regelnVon(E.bremse), geladen)).toBe(
            als.text,
        );
        // Eintrag ohne Regeln: nur der Kopf; unbekannte Kennung: 404
        expect(
            (await holen(inhalteVorkommenAlsTextUrl(E.altlast), reviewer.cookie)).json<{ text: string }>().text,
        ).toBe("Altlast (Fauna)");
        expect((await holen(inhalteVorkommenAlsTextUrl(randomUUID()), reviewer.cookie)).statusCode).toBe(404);
        // der Neue (angelegt, ohne Wiki-Schlüssel) lässt sich auch als Text lesen
        const [neu] = await wert<{ public_id: string }>(
            "SELECT public_id::text AS public_id FROM lore_entry WHERE name = 'Sturmwurz'",
        );
        expect(
            (await holen(inhalteVorkommenAlsTextUrl(neu!.public_id), reviewer.cookie)).json<{ text: string }>().text,
        ).toBe("Sturmwurz (Flora)\n| Verbreitung = [[Wald]] Klima Boreale Zone bis Gemäßigte Zone");
    });

    it("🔴 Rechte: ohne Anmeldung 401, als Tester 403; Prüfen und „Als Text“ ab Reviewer, Übernehmen erst als Editor (manage_sources); ohne den Schalter MAP_EDITING 423", async () => {
        await neueWelt();
        const tester = await welt.jemand("tester");
        const reviewer = await welt.jemand("reviewer");
        const editor = await welt.jemand("editor");
        const text = "Bremse (Fauna)\n| Verbreitung = [[Aventurien]]";
        for (const url of [INHALTE_REGELTEXT_PRUEFEN_URL, INHALTE_REGELTEXT_UEBERNEHMEN_URL]) {
            const payload = url === INHALTE_REGELTEXT_PRUEFEN_URL ? { text } : { operationId: randomUUID(), text };
            expect((await welt.post(url, undefined, payload)).statusCode, url).toBe(401);
            expect((await welt.post(url, tester.cookie, payload)).statusCode, url).toBe(403);
        }
        expect((await holen(inhalteVorkommenAlsTextUrl(E.bremse))).statusCode).toBe(401);
        expect((await holen(inhalteVorkommenAlsTextUrl(E.bremse), tester.cookie)).statusCode).toBe(403);
        expect((await pruefen(reviewer.cookie, text)).statusCode).toBe(200);
        expect((await uebernehmen(reviewer.cookie, text)).statusCode).toBe(403);
        expect(await zahl("SELECT count(*) AS n FROM lore_rule")).toBe(1);
        expect((await uebernehmen(editor.cookie, text)).statusCode).toBe(200);
        expect(await zahl("SELECT count(*) AS n FROM lore_rule WHERE state = 'active'")).toBe(1);
        // die Kennung muss eine Kennung sein
        expect((await uebernehmen(editor.cookie, text, "keine-kennung")).statusCode).toBe(400);
    });

    it("die Welt aus der Datenbank, rein gerechnet: dieselbe Antwort wie die Route, Fläche und Ort nur aktiv, Klima und Viertel nie", async () => {
        await neueWelt();
        const geladen = await cluster!.app.begin((tx) => ladeWelt(tx));
        expect(geladen.flaechen.map((f) => f.name).sort()).toEqual(["Aventurien", "Meridiana", "Mondwaldfläche"]);
        expect([...geladen.orte.values()].map((o) => o.name).sort()).toEqual(["Gareth", "Havena"]);
        expect(geladen.eintraege.map((e) => [e.name, e.titel, e.wikiKey])).toEqual([
            ["Bremse", "Bremse", "bremse"],
            ["Wirselkraut", "Wirselkraut", "wirselkraut"],
            ["Altlast", "Altlast", "altlast"],
        ]);
        expect(geladen.quellen.map((q) => q.titel).sort()).toEqual([
            "Doppelquelle",
            "Doppelquelle",
            "Geographia Aventurica",
        ]);
        expect([...geladen.wartendeTitel(E.wirsel)]).toEqual([
            ["nebelwald", "Nebelwald"],
            ["mondwald", "Mondwald"],
        ]);
        expect(geladen.titelMitFlaeche.has("aventurien")).toBe(true);
        const a = pruefeText(TEXT(), geladen).ergebnis;
        const b = (await pruefen((await welt.jemand("reviewer")).cookie, TEXT())).json<Ergebnis>();
        expect(b).toEqual(a);
    });
});
