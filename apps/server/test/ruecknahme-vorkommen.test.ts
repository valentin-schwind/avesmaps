import { randomUUID } from "node:crypto";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyImportOffen } from "./support/legacy-import-offen.ts";
import {
    RuecknahmePruefung,
    RuecknahmeReceipt,
    editorVorkommenRestoreSeriesPreviewUrl,
    editorVorkommenRestoreSeriesUrl,
    type Capability,
    type InhalteVorkommenAendernBody,
    type MapHistoryEntry,
    type RuecknahmeBody,
    type RuecknahmeVorschauBody,
    type RuecknahmePruefung as Pruefung,
    type RuecknahmeReceipt as Quittung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { mapChange } from "../src/editor/history.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ruecknehmenVorkommen, vorschauVorkommen } from "../src/editor/ruecknahme-vorkommen.ts";
import type { RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { ApiError } from "../src/http/api-error.ts";
import { inhalteOperation } from "../src/inhalte/operation.ts";
import { uebernehmeRegelText } from "../src/inhalte/regeln-text/schreiben.ts";
import { aendereVorkommen, legeVorkommenAn } from "../src/inhalte/vorkommen-schreiben.ts";
import { importLore } from "../src/migration/lore-import.ts";
import { leereVorkommenIndex, vorkommenIndex } from "../src/search/vorkommen-index.ts";
import { ermittleKartenstand } from "../src/vorkommen/regeln.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import {
    C,
    answer,
    cleanLoreFixtures,
    entry,
    insertLoreFixtures,
    kraeuterRow,
    link,
    place,
    rule,
    term,
    zooRow,
} from "./support/lore-fixture.ts";

/**
 * Vorkommen zurücknehmen (WI-0265 B6g2; Fachvertrag C.2, C.3, F.1, B.2, Gate 2 und 3; Testvertrag U4 bis U9): `POST /api/editor/inhalte/vorkommen/:id/restore-series[/preview]` gegen echtes
 * PostgreSQL (`TEST_DATABASE_URL`). Die Rechte der App-Rolle prüft der Rauchtest der Schreibwege (`support/schreibwege/inhalte.ts`).
 *
 * Problemfälle: Eine Serie geht nur teilweise zurück (ein Feld, eine Ortszeile, eine Quelle, eine Regel bleibt); eine Zeile, die die Serie anlegte, wird gelöscht statt still gelegt; eine Zeile wird
 * wieder aktiv, ohne dass ihre Treffer neu gerechnet werden (Karte, Suche und Leuchten sähen es nicht); eine Fremdänderung seither bleibt unbemerkt oder wird überschrieben (auch eine Zeile, die der
 * Zug ohne Operation änderte); ein Doppelklick schreibt zweimal; eine fremde Person wird ohne Grund zurückgenommen; das Anlegen oder ein Eintrag aus „Regeln als Text“ gilt als zurücknehmbar;
 * die Rücknahme von „Regeln als Text“ über mehrere Einträge geht an einem Eintrag halb durch; eine Rücknahme der Rücknahme führt nicht zum Stand davor.
 */

FormatRegistry.Set("date-time", (wert) => !Number.isNaN(Date.parse(wert)));

const url = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = url ? describe : describe.skip;

const A = "p74t-alraune";
const S = "p74t-ork";
const wald = { kind: "vegetation", region_type: "wald" };
const steppe = { ebene: "vegetation", art: "steppe" };

describeWithDatabase("Vorkommen zurücknehmen (WI-0265 B6g2)", { timeout: 300_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    let anna: MapActor;
    let bernd: MapActor;
    let annaLeser: RuecknahmeLeser;
    let berndLeser: RuecknahmeLeser;
    let ohneRecht: RuecknahmeLeser;
    const cookies = new Map<string, string>();
    const operationen: string[] = [];
    const neu = (): string => {
        const id = randomUUID();
        operationen.push(id);
        return id;
    };
    const RECHTE: ReadonlySet<Capability> = new Set<Capability>(["use_editor_menu", "manage_sources"]);

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };

    const fehler = async (work: Promise<unknown>): Promise<ApiError> => {
        try {
            await work;
        } catch (error) {
            if (error instanceof ApiError) return error;
            throw error;
        }
        throw new Error("ging durch");
    };

    /** Eine Antwort des Exports: Alraune (Flora) mit Ortszeilen, einer Regel und einer Quelle, dazu ein Ork (Spezies) mit einer Ortszeile. */
    const antwort = () =>
        answer({
            entries: [
                entry(A, "flora", {
                    name: "P74T Alraune",
                    wiki_title: "Alraune",
                    gruppe: "Heilpflanze",
                    lebensraum: "Wald",
                    synonyme: "Mandragora",
                }),
                entry(S, "spezies", { name: "P74T Ork" }),
            ],
            places: [
                place(A, "p68t-ort-a", { sort_order: 0 }),
                place(A, "p68t-ort-geteilt", { sort_order: 1 }),
                place(A, "aventurien", { sort_order: 2 }),
                place(S, "p68t-ort-a", { relation: "vorkommen" }),
            ],
            rules: [
                rule(A, [
                    term(0, { region_types: [wald] }),
                    term(1, { join_op: "oder", climate_from: "gemaessigt", climate_to: "subtropisch" }),
                ]),
            ],
            sources: [zooRow(1), kraeuterRow(2)],
            links: [link(A, 1, { pages: "88", position: 0 })],
        });

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
        await cleanLoreFixtures(database);
        operationen.length = 0;
    }

    const anzahlOperationen = async (): Promise<number> =>
        Number((await database<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)[0]!.n);

    // --- Fixtures und Schreiben -------------------------------------------------------------------------------------------------

    const idVon = async (wikiKey: string): Promise<string> =>
        (
            await database<{ public_id: string }[]>`SELECT public_id::text FROM lore_entry WHERE wiki_key = ${wikiKey}`
        )[0]!.public_id;
    const revisionVon = async (wikiKey: string): Promise<number> =>
        (await database<{ r: number }[]>`SELECT revision::int AS r FROM lore_entry WHERE wiki_key = ${wikiKey}`)[0]!.r;
    const quelleId = async (titel: string): Promise<string> =>
        (await database<{ public_id: string }[]>`SELECT public_id::text FROM feature_source WHERE title = ${titel}`)[0]!
            .public_id;
    const zeileVon = async (wikiKey: string, ortKey: string): Promise<string> =>
        (
            await database<{ id: string }[]>`
                SELECT p.id::text FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id WHERE e.wiki_key = ${wikiKey} AND p.place_wiki_key = ${ortKey}`
        )[0]!.id;
    const regelnVon = async (wikiKey: string): Promise<string[]> =>
        (
            await database<{ id: string }[]>`
                SELECT r.id::text FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.wiki_key = ${wikiKey} AND r.state = 'active' ORDER BY r.id`
        ).map((eine) => eine.id);

    type Aenderung = Omit<InhalteVorkommenAendernBody, "operationId" | "baseRevision">;
    /** Ein „Speichern“ im Reiter Vorkommen (`lore.update`); gibt die Kennung der Operation zurück. */
    const aendere = async (akteur: MapActor, wikiKey: string, body: Aenderung): Promise<string> => {
        const operationId = neu();
        await aendereVorkommen(database, akteur, await idVon(wikiKey), {
            operationId,
            baseRevision: await revisionVon(wikiKey),
            ...body,
        } as InhalteVorkommenAendernBody);
        return operationId;
    };

    /** Der Stand eines Eintrags und seiner Zeilen, so wie ein Leser und der Importschutz ihn sehen (ohne Zeitstempel). */
    interface Aufnahme {
        eintrag: Record<string, unknown>;
        orte: Record<string, Record<string, unknown>>;
        quellen: Record<string, Record<string, unknown>>;
        regeln: Record<string, Record<string, unknown>>;
    }
    const aufnahme = async (wikiKey: string): Promise<Aufnahme> => {
        const [e] = await database<{ id: string; [spalte: string]: unknown }[]>`
            SELECT id::text AS id, name, kind, gruppe, lebensraum, synonyme, editor_note, state, is_active, source_system FROM lore_entry WHERE wiki_key = ${wikiKey}`;
        const eid = e!.id;
        const nachId = (zeilen: { id: string }[]): Record<string, Record<string, unknown>> =>
            Object.fromEntries(zeilen.map((zeile) => [zeile.id, zeile]));
        return {
            eintrag: Object.fromEntries(Object.entries(e!).filter(([schluessel]) => schluessel !== "id")),
            orte: nachId(
                await database<{ id: string }[]>`
                    SELECT p.id::text AS id, p.place_wiki_key, p.place_title, p.relation, p.state, p.is_active, p.target_state, p.target_count::int AS target_count,
                           (SELECT count(*) FROM lore_place_target t WHERE t.lore_place_id = p.id)::int AS treffer
                      FROM lore_place p WHERE p.lore_entry_id = ${eid}::bigint`,
            ),
            quellen: nachId(
                await database<{ id: string }[]>`
                    SELECT s.id::text AS id, f.title, s.state, s.is_active, s.reference_kind, s.pages, s.note
                      FROM lore_entry_source s JOIN feature_source f ON f.id = s.source_id WHERE s.lore_entry_id = ${eid}::bigint`,
            ),
            regeln: nachId(
                await database<{ id: string }[]>`
                    SELECT r.id::text AS id, r.rule_key, r.relation, r.state, r.is_active FROM lore_rule r WHERE r.lore_entry_id = ${eid}::bigint`,
            ),
        };
    };
    /** Der Stand nach der Rücknahme ist der von vorher: jede Zeile von vorher unverändert, jede neue still gelegt (nie gelöscht). */
    const gleichWieVorher = (vorher: Aufnahme, nach: Aufnahme): void => {
        // Der Eintrag gehört nach der Rücknahme der Redaktion (`source_system`, Importschutz), auch wenn er vorher aus Legacy kam; sonst gilt der Stand von vorher.
        const ohneSystem = (eintrag: Record<string, unknown>): Record<string, unknown> =>
            Object.fromEntries(Object.entries(eintrag).filter(([schluessel]) => schluessel !== "source_system"));
        expect(ohneSystem(nach.eintrag)).toEqual(ohneSystem(vorher.eintrag));
        for (const teil of ["orte", "quellen", "regeln"] as const) {
            for (const [id, zeile] of Object.entries(vorher[teil]))
                expect(nach[teil][id], `${teil} ${id}`).toEqual(zeile);
            for (const [id, zeile] of Object.entries(nach[teil]))
                if (!(id in vorher[teil]))
                    expect(zeile, `neue Zeile ${teil} ${id}`).toMatchObject({ state: "retired", is_active: false });
        }
    };

    // --- Hilfen für die Aufrufe -----------------------------------------------------------------------------------------------

    const koerper = (members: string[], extra: { operationId?: string; reason?: string } = {}): RuecknahmeBody => ({
        operationId: extra.operationId ?? neu(),
        members,
        membersHash: mitgliederHash(members),
        ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    });
    const vorbody = (members: string[]): RuecknahmeVorschauBody => ({ members, membersHash: mitgliederHash(members) });
    const eintrag = async (operationId: string): Promise<MapHistoryEntry> =>
        (await mapChange(database, operationId, { mapDomainId: "aventuria", personId: annaLeser.personId }))!;
    const vorschau = (leser: RuecknahmeLeser, id: string, members: string[]): Promise<Pruefung> =>
        vorschauVorkommen(database, id, vorbody(members), leser);
    const ruecknehmen = (
        akteur: MapActor,
        leser: RuecknahmeLeser,
        id: string,
        body: RuecknahmeBody,
    ): Promise<Quittung> => ruecknehmenVorkommen(database, akteur, leser, id, body);

    /** Zwei Schritte von Anna an der Alraune, die alles berühren: Felder, Ortszeilen (lösen, anhängen, ungeklärt, zurückholen), Quellen (anhängen, ändern, lösen) und Regeln (ersetzen). */
    const zweiSchritte = async (): Promise<{ eins: string; zwei: string }> => {
        const ortA = await zeileVon(A, "p68t-ort-a");
        const zoo = await quelleId("P74T Zoo-Botanica Aventurica");
        const kraeuter = await quelleId("P74T Kräuterkunde");
        const [regel] = await regelnVon(A);
        const eins = await aendere(anna, A, {
            fields: { name: "P74T Alraune B", gruppe: "Giftpflanze", synonyme: null },
            orte: [
                { op: "remove", rowId: ortA },
                { op: "add", kind: "territory", carrierId: C.gebietB, relation: "regionen" },
                { op: "add", name: "Irgendwo im Norden", relation: "herkunft" },
            ],
            quellen: [
                { op: "add", sourceId: kraeuter, pages: "7", referenceKind: "ausfuehrlich" },
                { op: "update", sourceId: zoo, pages: "99" },
            ],
        });
        const zwei = await aendere(anna, A, {
            fields: { lebensraum: "Moor", editorNote: "Eine Notiz" },
            orte: [{ op: "restore", rowId: ortA }],
            quellen: [{ op: "remove", sourceId: zoo }],
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    ersetzt: regel!,
                    bedingungen: [{ verknuepfung: "und", arten: [steppe] }],
                },
            ],
        });
        return { eins, zwei };
    };

    beforeAll(async () => {
        // Die Testdaten entstehen mit dem Schreibweg des Imports; der Besitz des Bereichs ist hier nicht Gegenstand.
        legacyImportOffen();
        database = createDatabase(url as string, { max: 6 });
        await migrate(database);
        fixture = authFixture(database);
        const a = await fixture.person("editor", { name: "Anna Vorkommen" });
        const b = await fixture.person("editor", { name: "Bernd Vorkommen" });
        anna = { kind: "person", personId: a.id, environment: "test" };
        bernd = { kind: "person", personId: b.id, environment: "test" };
        annaLeser = { personId: a.id, rechte: RECHTE };
        berndLeser = { personId: b.id, rechte: RECHTE };
        ohneRecht = { personId: a.id, rechte: new Set<Capability>(["use_editor_menu"]) };
        for (const [rolle, person] of [
            ["editor", a],
            ["reviewer", await fixture.person("reviewer", { name: "Rita Vorkommen" })],
        ] as const)
            cookies.set(rolle, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        app = buildApp({
            config,
            database: createDatabase(url as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        await aufraeumen();
    }, 180_000);

    beforeEach(async () => {
        await aufraeumen();
        await insertLoreFixtures(database);
        await importLore(database, antwort());
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        await app?.close();
        await aufraeumen();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    it("🔴 eine Serie geht in EINER Operation auf den Stand vor dem ersten Mitglied zurück: Felder, Ortszeilen samt Treffern, Quellen und Regeln (Quelle restore, Verknüpfung zu beiden Originalen, kein Ereignis der Karte)", async () => {
        const id = await idVon(A);
        const vorher = await aufnahme(A);
        const { eins, zwei } = await zweiSchritte();
        const geaendert = await aufnahme(A);
        expect(geaendert).not.toEqual(vorher);
        // Die Serie hat zwei Zeilen angelegt (Gebiet, ungeklärter Name), eine Quelle angehängt und eine Regel ersetzt.
        expect(Object.keys(geaendert.orte)).toHaveLength(Object.keys(vorher.orte).length + 2);
        const members = [eins, zwei];

        const vor = await vorschau(annaLeser, id, members);
        expect(vor.ergebnis).toBe("ok");
        expect(vor.offen).toEqual(members);
        expect(vor.folgen).toEqual({ gegenstaende: 1, gelaende: "keines" });
        expect(Value.Check(RuecknahmePruefung, vor)).toBe(true);
        const operationenVorher = await anzahlOperationen();

        const operationId = neu();
        const quittung = await ruecknehmen(anna, annaLeser, id, koerper(members, { operationId }));
        expect(quittung.status).toBe("applied");
        expect(quittung.reverts).toEqual(members);
        // Das Vorkommen löst weder Ableitung noch Ereignis der Karte aus (wie sein Vorwärtsweg).
        expect(quittung.mapRevision).toBeUndefined();
        expect(quittung.derivedWork).toEqual([]);
        expect(Value.Check(RuecknahmeReceipt, quittung)).toBe(true);
        expect(quittung.affected).toEqual([{ kind: "lore", id, revision: await revisionVon(A) }]);

        const nach = await aufnahme(A);
        gleichWieVorher(vorher, nach);
        // Die Regel von vorher lebt, die der Serie ist still gelegt; die Quelle der Serie ist gelöst, die alte wieder mit ihren Angaben da.
        expect(Object.values(nach.regeln).filter((r) => r["is_active"] === true)).toHaveLength(1);
        expect(Object.values(nach.quellen).map((q) => [q["title"], q["state"], q["pages"]])).toEqual(
            expect.arrayContaining([
                ["P74T Zoo-Botanica Aventurica", "active", "88"],
                ["P74T Kräuterkunde", "retired", "7"],
            ]),
        );
        expect(await anzahlOperationen()).toBe(operationenVorher + 1);

        const zeile = (
            await database<{ action: string; source: string; map_domain_id: string }[]>`
                SELECT action, source, map_domain_id FROM map_operation WHERE operation_id = ${operationId}::uuid`
        )[0]!;
        expect(zeile).toEqual({ action: "lore.restore_series", source: "restore", map_domain_id: "aventuria" });
        const links = await database<{ id: string }[]>`
            SELECT reverted_operation_id::text AS id FROM map_operation_revert_link WHERE restore_operation_id = ${operationId}::uuid ORDER BY position`;
        expect(links.map((l) => l.id)).toEqual(members);
        expect((await eintrag(eins)).status).toBe("bereits_zurueckgenommen");
        expect((await eintrag(zwei)).revertedBy?.operationId).toBe(operationId);
        const rueck = await eintrag(operationId);
        expect(rueck.source).toBe("restore");
        // Das Protokoll der Rücknahme führt vorher und nachher je Teil; ohne Grund kein `restoreReason`.
        const gegenstand = rueck.objects.find((o) => o.id === id)!;
        expect(Object.keys(gegenstand.changes).sort()).toEqual([
            "editorNote",
            "gruppe",
            "lebensraum",
            "name",
            "places",
            "rules",
            "sources",
            "synonyme",
        ]);
        expect(gegenstand.changes["name"]).toEqual({ before: "P74T Alraune B", after: "P74T Alraune" });
    });

    it("🔴 Einzeln nur das letzte Mitglied: das erste ist überholt; das letzte geht zurück und lässt die Änderungen davor stehen", async () => {
        const id = await idVon(A);
        const { eins, zwei } = await zweiSchritte();
        const nachEins = await aufnahme(A);
        const vor = await vorschau(annaLeser, id, [eins]);
        expect(vor.ergebnis).toBe("edit_conflict");
        expect(vor.konflikte[0]).toMatchObject({ art: "ueberholt" });
        const quittung = await ruecknehmen(anna, annaLeser, id, koerper([zwei]));
        expect(quittung.status).toBe("applied");
        const nach = await aufnahme(A);
        // Der Name von Schritt 1 bleibt, das Feld von Schritt 2 ist zurück.
        expect(nach.eintrag).toMatchObject({ name: "P74T Alraune B", lebensraum: "Wald", editor_note: null });
        expect(nach.eintrag).not.toEqual(nachEins.eintrag);
    });

    it("🔴 eine spätere Änderung seither: 409 edit_conflict mit wer und wann, nichts geschrieben (ganz oder gar nicht)", async () => {
        const id = await idVon(A);
        const { eins, zwei } = await zweiSchritte();
        const fremd = await aendere(bernd, A, { fields: { gruppe: "Von Bernd" } });
        const stand = await aufnahme(A);
        const members = [eins, zwei];

        const vor = await vorschau(annaLeser, id, members);
        expect(vor.ergebnis).toBe("edit_conflict");
        expect(vor.konflikte[0]).toMatchObject({ art: "spaeter", operationId: fremd, kind: "lore", id });
        expect(vor.konflikte[0]!.changedBy?.name).toBe("Bernd Vorkommen");

        const operationenVorher = await anzahlOperationen();
        const abgelehnt = await fehler(ruecknehmen(anna, annaLeser, id, koerper(members)));
        expect(abgelehnt).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        expect(await aufnahme(A)).toEqual(stand);
        expect(await anzahlOperationen()).toBe(operationenVorher);
        expect(
            await database`SELECT 1 FROM map_operation_revert_link WHERE reverted_operation_id = ANY(${members}::uuid[])`,
        ).toHaveLength(0);
    });

    it("🔴 eine Zeile, die seither ohne Operation geändert wurde (Eingriff am Rand der Schreibnaht), ist ein Konflikt der Werte: die Vorprüfung nennt die Liste, nichts wird geschrieben", async () => {
        const id = await idVon(A);
        const zoo = await quelleId("P74T Zoo-Botanica Aventurica");
        const eins = await aendere(anna, A, { quellen: [{ op: "update", sourceId: zoo, pages: "99" }] });
        // Die Seitenzahl ändert jemand an der Datenbank vorbei (etwa ein Zug); Revision und Protokoll wissen nichts davon.
        await database`
            UPDATE lore_entry_source SET pages = '123'
             WHERE lore_entry_id = (SELECT id FROM lore_entry WHERE wiki_key = ${A}) AND source_id = (SELECT id FROM feature_source WHERE public_id = ${zoo}::uuid)`;
        const vor = await vorschau(annaLeser, id, [eins]);
        expect(vor.ergebnis).toBe("edit_conflict");
        expect(vor.konflikte[0]).toMatchObject({ art: "wert", kind: "lore", id, felder: ["sources"] });
        const stand = await aufnahme(A);
        expect(await fehler(ruecknehmen(anna, annaLeser, id, koerper([eins])))).toMatchObject({
            statusCode: 409,
            code: "edit_conflict",
        });
        expect(await aufnahme(A)).toEqual(stand);
    });

    it("🔴 dasselbe für eine Ortszeile und eine Regel, die seither still gelegt wurden, ohne dass ein Protokoll davon weiß", async () => {
        const id = await idVon(A);
        const eins = await aendere(anna, A, {
            orte: [{ op: "add", name: "Irgendwo im Norden", relation: "herkunft" }],
            regeln: [{ op: "add", relation: "verbreitung", bedingungen: [{ verknuepfung: "und", arten: [steppe] }] }],
        });
        const [, neueRegel] = await regelnVon(A);
        const neueZeile = (
            await database<{ id: string }[]>`
                SELECT p.id::text FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id WHERE e.wiki_key = ${A} AND p.place_title = 'Irgendwo im Norden'`
        )[0]!.id;
        await database`UPDATE lore_rule SET state = 'suppressed', is_active = FALSE, retired_at = now(), retired_origin = 'legacy' WHERE id = ${neueRegel!}::bigint`;
        expect((await vorschau(annaLeser, id, [eins])).konflikte[0]).toMatchObject({ art: "wert", felder: ["rules"] });
        await database`UPDATE lore_rule SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL WHERE id = ${neueRegel!}::bigint`;
        await database`UPDATE lore_place SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor' WHERE id = ${neueZeile}::bigint`;
        expect((await vorschau(annaLeser, id, [eins])).konflikte[0]).toMatchObject({ art: "wert", felder: ["places"] });
        // Ist alles wieder, wie die Serie es hinterließ, steht die Prüfung auf ok.
        await database`UPDATE lore_place SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL WHERE id = ${neueZeile}::bigint`;
        expect((await vorschau(annaLeser, id, [eins])).ergebnis).toBe("ok");
    });

    it("🔴 dieselbe Kennung noch einmal (Doppelklick, Netzretry): die erste Quittung als replayed, nichts doppelt; eine neue Kennung für dieselben Mitglieder: already_reverted", async () => {
        const id = await idVon(A);
        const eins = await aendere(anna, A, { fields: { gruppe: "Zwei" } });
        const operationId = neu();
        const erste = await ruecknehmen(anna, annaLeser, id, koerper([eins], { operationId }));
        const stand = await aufnahme(A);
        const operationenVorher = await anzahlOperationen();
        const zweite = await ruecknehmen(anna, annaLeser, id, koerper([eins], { operationId }));
        expect(zweite.status).toBe("replayed");
        expect(zweite.operationId).toBe(erste.operationId);
        expect(zweite.reverts).toEqual([eins]);
        expect(await aufnahme(A)).toEqual(stand);
        expect(await anzahlOperationen()).toBe(operationenVorher);
        expect(await fehler(ruecknehmen(anna, annaLeser, id, koerper([eins])))).toMatchObject({
            statusCode: 409,
            code: "already_reverted",
        });
    });

    it("🔴 die Änderung einer anderen Person: ohne Grund 400 reason_required, mit Grund geht sie zurück und der Grund bleibt im Eintrag sichtbar (nicht als Feld des Eintrags)", async () => {
        const id = await idVon(A);
        const vorher = await aufnahme(A);
        const eins = await aendere(anna, A, { fields: { gruppe: "Giftpflanze" } });
        const vor = await vorschau(berndLeser, id, [eins]);
        expect(vor.ergebnis).toBe("ok");
        expect(vor.reasonRequired).toBe(true);
        expect(vor.fremdePersonen.map((p) => p.name)).toEqual(["Anna Vorkommen"]);

        const operationenVorher = await anzahlOperationen();
        expect(await fehler(ruecknehmen(bernd, berndLeser, id, koerper([eins])))).toMatchObject({
            statusCode: 400,
            code: "reason_required",
        });
        expect(await anzahlOperationen()).toBe(operationenVorher);

        const operationId = neu();
        const quittung = await ruecknehmen(
            bernd,
            berndLeser,
            id,
            koerper([eins], { operationId, reason: "Falsche Angabe" }),
        );
        expect(quittung.status).toBe("applied");
        gleichWieVorher(vorher, await aufnahme(A));
        expect((await eintrag(eins)).revertedBy).toMatchObject({ operationId, reason: "Falsche Angabe" });
        const rueck = await eintrag(operationId);
        expect(rueck.reason).toBe("Falsche Angabe");
        expect(rueck.actor.name).toBe("Bernd Vorkommen");
        // `restoreReason` steht im Protokoll (Positivliste), und nur als Grund: Die Rücknahme der Rücknahme liest es nie als Feld des Eintrags.
        expect(rueck.objects[0]!.changes["restoreReason"]).toEqual({ after: "Falsche Angabe" });
        // Die Rücknahme von Bernd ist für Anna die einer anderen Person: wieder Pflichtgrund.
        expect(await fehler(ruecknehmen(anna, annaLeser, id, koerper([operationId])))).toMatchObject({
            statusCode: 400,
            code: "reason_required",
        });
        const nochmal = await ruecknehmen(anna, annaLeser, id, koerper([operationId], { reason: "Doch richtig" }));
        expect(nochmal.status).toBe("applied");
        expect((await aufnahme(A)).eintrag).toMatchObject({ gruppe: "Giftpflanze" });
    });

    it("🔴 ohne das Recht manage_sources: 403, nichts erfährt die Person über den Stand", async () => {
        const id = await idVon(A);
        const eins = await aendere(anna, A, { fields: { gruppe: "Giftpflanze" } });
        const vor = await vorschau(ohneRecht, id, [eins]);
        expect(vor.ergebnis).toBe("forbidden");
        expect(vor.fehlendeRechte).toEqual(["manage_sources"]);
        const abgelehnt = await fehler(ruecknehmen(anna, ohneRecht, id, koerper([eins])));
        expect(abgelehnt).toMatchObject({ statusCode: 403, code: "forbidden" });
    });

    /** Ein Eintrag der Lore ohne Wiki-Schlüssel (angelegt im Editor): sein Zustand, so wie die Suche und der Importschutz ihn sehen. */
    const eintragStand = async (id: string) =>
        (
            await database`
                SELECT name, gruppe, kind, state, is_active, source_system, retired_origin, wiki_key, revision::int AS revision
                  FROM lore_entry WHERE public_id = ${id}::uuid`
        )[0]!;
    const imIndex = async (id: string): Promise<boolean> => {
        leereVorkommenIndex();
        return (await vorkommenIndex(database)).eintraege.some((e) => e.publicId === id);
    };

    it("🔴 B8d: das Anlegen (`lore.create`) geht zurück als Stilllegen (nichts wird gelöscht): Liste, Vorprüfung, Rücknahme, Suchindex; die Rücknahme der Rücknahme belebt wieder", async () => {
        const operationId = neu();
        const angelegt = await legeVorkommenAn(database, anna, { operationId, name: "P74T Neuling", art: "fauna" });
        const id = angelegt.publicId;
        expect((await eintrag(operationId)).status).toBe("ruecknehmbar");
        expect(await imIndex(id)).toBe(true);
        const vor = await vorschau(annaLeser, id, [operationId]);
        expect(vor.ergebnis).toBe("ok");
        expect(vor.offen).toEqual([operationId]);
        const operationenVorher = await anzahlOperationen();

        const rueck = neu();
        const quittung = await ruecknehmen(anna, annaLeser, id, koerper([operationId], { operationId: rueck }));
        expect(quittung.status).toBe("applied");
        expect(quittung.reverts).toEqual([operationId]);
        expect(quittung.derivedWork).toEqual([]);
        expect(quittung.mapRevision).toBeUndefined();
        expect(await anzahlOperationen()).toBe(operationenVorher + 1);
        // Stillgelegt wie das Entfernen im Editor (Zustand `suppressed`, Herkunft `editor`), nie gelöscht; der Name bleibt.
        expect(await eintragStand(id)).toMatchObject({
            name: "P74T Neuling",
            state: "suppressed",
            is_active: false,
            retired_origin: "editor",
            source_system: "editor",
        });
        // Die Suche folgt: Der stillgelegte Eintrag fehlt im Index.
        expect(await imIndex(id)).toBe(false);
        expect((await eintrag(operationId)).status).toBe("bereits_zurueckgenommen");
        expect((await eintrag(rueck)).status).toBe("ruecknehmbar");
        // Dieselbe Kennung: dieselbe Quittung; eine andere Kennung für dieselbe Liste: nie ein Doppel.
        expect((await ruecknehmen(anna, annaLeser, id, koerper([operationId], { operationId: rueck }))).status).toBe(
            "replayed",
        );
        expect(await fehler(ruecknehmen(anna, annaLeser, id, koerper([operationId])))).toMatchObject({
            statusCode: 409,
            code: "already_reverted",
        });

        const beleben = await ruecknehmen(anna, annaLeser, id, koerper([rueck]));
        expect(beleben.status).toBe("applied");
        expect(await eintragStand(id)).toMatchObject({ state: "active", is_active: true, retired_origin: null });
        expect(await imIndex(id)).toBe(true);
        expect((await eintrag(operationId)).status).toBe("ruecknehmbar");
    });

    it("🔴 B8d: eine Serie aus Anlegen und Folgeänderung geht als Ganzes zurück; ein Eintrag einer anderen Person braucht einen Grund; die Revision zählt", async () => {
        const operationId = neu();
        const id = (await legeVorkommenAn(database, bernd, { operationId, name: "P74T Serie", art: "fauna" })).publicId;
        const eins = neu();
        await aendereVorkommen(database, bernd, id, {
            operationId: eins,
            baseRevision: (await eintragStand(id)).revision,
            fields: { gruppe: "Raubtier" },
        } as InhalteVorkommenAendernBody);
        const members = [operationId, eins];
        const vor = await vorschau(annaLeser, id, members);
        expect(vor.ergebnis).toBe("ok");
        expect(vor.offen).toEqual(members);
        expect(vor.reasonRequired).toBe(true);
        expect(await fehler(ruecknehmen(anna, annaLeser, id, koerper(members)))).toMatchObject({
            statusCode: 400,
            code: "reason_required",
        });
        const revisionVorher = (await eintragStand(id)).revision;
        const quittung = await ruecknehmen(anna, annaLeser, id, koerper(members, { reason: "Doppelt angelegt" }));
        expect(quittung.status).toBe("applied");
        const nach = await eintragStand(id);
        // Still; was die Folgeänderung schrieb, bleibt (ohne Belang für einen stillen Eintrag); die Revision zählt einmal.
        expect(nach).toMatchObject({ state: "suppressed", is_active: false, gruppe: "Raubtier" });
        expect(nach.revision).toBe(revisionVorher + 1);
        expect((await eintrag(quittung.operationId)).reason).toBe("Doppelt angelegt");
    });

    it("🔴 B8d: eine spätere Änderung an einem angelegten Eintrag oder eine Quellenverknüpfung ohne Operation hindern das Stilllegen (nichts wird geschrieben)", async () => {
        const operationId = neu();
        const id = (await legeVorkommenAn(database, anna, { operationId, name: "P74T Belegt", art: "fauna" })).publicId;
        // Eine spätere Änderung einer anderen Person: Konflikt `spaeter`.
        const fremd = neu();
        await aendereVorkommen(database, bernd, id, {
            operationId: fremd,
            baseRevision: (await eintragStand(id)).revision,
            fields: { gruppe: "Von Bernd" },
        } as InhalteVorkommenAendernBody);
        const spaeter = await vorschau(annaLeser, id, [operationId]);
        expect(spaeter.ergebnis).toBe("edit_conflict");
        expect(spaeter.konflikte.map((k) => k.art)).toContain("spaeter");
        expect(await fehler(ruecknehmen(anna, annaLeser, id, koerper([operationId])))).toMatchObject({
            statusCode: 409,
            code: "edit_conflict",
        });
        expect((await eintragStand(id)).is_active).toBe(true);

        // Ohne Operation am Eintrag: eine Verknüpfung zu einer Quelle (wie ein Zug des Imports).
        const zweiter = neu();
        const id2 = (
            await legeVorkommenAn(database, anna, { operationId: zweiter, name: "P74T Belegt 2", art: "fauna" })
        ).publicId;
        const quelle = await quelleId("P74T Kräuterkunde");
        await database`
            INSERT INTO lore_entry_source (lore_entry_id, source_id, position, source_system)
            SELECT e.id, f.id, 0, 'legacy' FROM lore_entry e, feature_source f
             WHERE e.public_id = ${id2}::uuid AND f.public_id = ${quelle}::uuid
        `;
        const vor = await vorschau(annaLeser, id2, [zweiter]);
        expect(vor.ergebnis).toBe("edit_conflict");
        const wert = vor.konflikte.find((k) => k.art === "wert");
        expect(wert?.abweichung?.was).toBe("inhalt_verwendet");
        expect(wert?.felder).toEqual(["sources"]);
        const vorher = await anzahlOperationen();
        expect(await fehler(ruecknehmen(anna, annaLeser, id2, koerper([zweiter])))).toMatchObject({
            statusCode: 409,
            code: "edit_conflict",
        });
        expect(await anzahlOperationen()).toBe(vorher);
        expect((await eintragStand(id2)).is_active).toBe(true);
    });

    it("🔴 B8d: ohne das Recht manage_sources ist auch das Anlegen nicht zurückzunehmen (403)", async () => {
        const operationId = neu();
        const id = (await legeVorkommenAn(database, anna, { operationId, name: "P74T Recht", art: "fauna" })).publicId;
        expect((await vorschau(ohneRecht, id, [operationId])).ergebnis).toBe("forbidden");
        expect(await fehler(ruecknehmen(anna, ohneRecht, id, koerper([operationId])))).toMatchObject({
            statusCode: 403,
            code: "forbidden",
        });
        expect((await eintragStand(id)).is_active).toBe(true);
    });

    it("🔴 ein Mitglied, das Felder schreibt, die die Rücknahme nicht versteht (Wiki-Stand, Typ): nicht rücknehmbar (Grund art), ganz oder gar nicht", async () => {
        const id = await idVon(A);
        const ok = await aendere(anna, A, { fields: { gruppe: "Giftpflanze" } });
        const wikiStand = neu();
        await inhalteOperation(
            database,
            anna,
            { operationId: wikiStand, operation: "lore.update", body: { loreId: id } },
            async () => ({
                receipt: { affected: [{ kind: "lore", id, revision: 99 }], derivedWork: [], warnings: [] },
                summary: "Vorkommen „P74T Alraune“ geändert",
                entries: [
                    {
                        action: "lore.updated",
                        loreId: id,
                        revisionBefore: 98,
                        revisionAfter: 99,
                        changes: { typ: { before: "a", after: "b" } },
                    },
                ],
            }),
        );
        const vor = await vorschau(annaLeser, id, [ok, wikiStand]);
        expect(vor.ergebnis).toBe("not_revertable");
        expect(vor.mitglieder.find((m) => m.operationId === wikiStand)?.ausschluss).toEqual({ grund: "art" });
        const stand = await aufnahme(A);
        expect(await fehler(ruecknehmen(anna, annaLeser, id, koerper([ok, wikiStand])))).toMatchObject({
            statusCode: 400,
            code: "not_revertable",
        });
        expect(await aufnahme(A)).toEqual(stand);
    });

    it("🔴 eine zerbrochene Liste (falsche Prüfsumme, fremder Eintrag) und ein Eintrag, den es nicht gibt, werden abgewiesen", async () => {
        const id = await idVon(A);
        const eins = await aendere(anna, A, { fields: { gruppe: "Eins" } });
        const zwei = await aendere(anna, A, { fields: { gruppe: "Zwei" } });
        const hash = await fehler(
            ruecknehmen(anna, annaLeser, id, {
                operationId: neu(),
                members: [eins, zwei],
                membersHash: "0".repeat(64),
            }),
        );
        expect(hash).toMatchObject({ statusCode: 400, code: "invalid_members" });
        // Die Operation gehört zu einem anderen Eintrag als der der Route.
        const fremd = await aendere(anna, S, { fields: { gruppe: "Orks" } });
        expect(await fehler(ruecknehmen(anna, annaLeser, id, koerper([fremd])))).toMatchObject({
            statusCode: 400,
            code: "invalid_members",
        });
        expect(await fehler(ruecknehmen(anna, annaLeser, randomUUID(), koerper([eins, zwei])))).toMatchObject({
            statusCode: 404,
        });
    });

    it("🔴 die Rücknahme einer Rücknahme führt auf den Stand nach den Änderungen zurück (Felder, Zeilen, Quellen, Regeln; die angelegten Zeilen leben wieder)", async () => {
        const id = await idVon(A);
        const { eins, zwei } = await zweiSchritte();
        const geaendert = await aufnahme(A);
        const rueck = neu();
        await ruecknehmen(anna, annaLeser, id, koerper([eins, zwei], { operationId: rueck }));
        expect(await aufnahme(A)).not.toEqual(geaendert);

        const nochmal = neu();
        const quittung = await ruecknehmen(anna, annaLeser, id, koerper([rueck], { operationId: nochmal }));
        expect(quittung.status).toBe("applied");
        expect(quittung.reverts).toEqual([rueck]);
        gleichWieVorher(geaendert, await aufnahme(A));
        // Auch die Zeilen, die die Serie angelegt und die erste Rücknahme still gelegt hatte, sind wieder aktiv.
        expect(await aufnahme(A)).toMatchObject({
            orte: geaendert.orte,
            quellen: geaendert.quellen,
            regeln: geaendert.regeln,
        });
        expect((await eintrag(rueck)).status).toBe("bereits_zurueckgenommen");
    });

    it("🔴 Folgen wie beim Vorwärts-Schreiben: Wird eine Zeile wieder aktiv, rechnet die Rücknahme ihre Treffer neu; Leuchten (Kartenstand) und Suchindex folgen dem Stempel; kein Ereignis, kein Auftrag", async () => {
        const id = await idVon(A);
        const ortA = await zeileVon(A, "p68t-ort-a");
        const eins = await aendere(anna, A, { orte: [{ op: "remove", rowId: ortA }] });
        // Die Ableitung hat die Treffer der Zeile inzwischen verworfen (so steht eine Zeile nach einem Lauf, der sie nicht mehr trifft): Das Zurückholen muss sie neu rechnen.
        await database`DELETE FROM lore_place_target WHERE lore_place_id = ${ortA}::bigint`;
        await database`UPDATE lore_place SET key_class = 'other', target_state = 'unmatched', target_count = 0 WHERE id = ${ortA}::bigint`;
        const stempelVorher = await ermittleKartenstand(database);
        leereVorkommenIndex();
        const indexVorher = (await vorkommenIndex(database)).stempel;
        const auftraegeVorher = Number(
            (await database<{ n: string }[]>`SELECT count(*)::text AS n FROM job`)[0]?.n ?? "0",
        );

        const quittung = await ruecknehmen(anna, annaLeser, id, koerper([eins]));
        expect(quittung.status).toBe("applied");
        expect(quittung.derivedWork).toEqual([]);
        expect(quittung.mapRevision).toBeUndefined();
        const nach = await aufnahme(A);
        expect(nach.orte[ortA]).toMatchObject({
            state: "active",
            is_active: true,
            target_state: "resolved",
            target_count: 1,
            treffer: 1,
        });
        expect(await ermittleKartenstand(database)).not.toBe(stempelVorher);
        leereVorkommenIndex();
        expect((await vorkommenIndex(database)).stempel).not.toBe(indexVorher);
        expect(Number((await database<{ n: string }[]>`SELECT count(*)::text AS n FROM job`)[0]?.n ?? "0")).toBe(
            auftraegeVorher,
        );
    });

    it("🔴 der Suchindex folgt einer Rücknahme, die den Kartenbezug ändert: Löst jemand die einzige Zeile des Orks, fehlt sein Kartenbezug; die Rücknahme holt ihn zurück", async () => {
        const id = await idVon(S);
        const zeile = await zeileVon(S, "p68t-ort-a");
        const hatBezug = async (): Promise<boolean | undefined> => {
            leereVorkommenIndex();
            return (await vorkommenIndex(database)).eintraege.find((e) => e.publicId === id)?.kartenbezug;
        };
        expect(await hatBezug()).toBe(true);
        const eins = await aendere(anna, S, { orte: [{ op: "remove", rowId: zeile }] });
        expect(await hatBezug()).toBe(false);
        await ruecknehmen(anna, annaLeser, id, koerper([eins]));
        expect(await hatBezug()).toBe(true);
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("„Regeln als Text“ (`lore.rules_text`): EINE Operation über mehrere Einträge", () => {
        const text = async (extra: string[] = []): Promise<string> => {
            const kraeuter = await quelleId("P74T Kräuterkunde");
            return [
                `Quelle: [[#${kraeuter.slice(0, 8)}|P74T Kräuterkunde]], S. 3`,
                "P74T Alraune (Flora)",
                "| Herkunft = [[Wald]]",
                "P74T Ork (Spezies)",
                "| Verbreitung = [[Wald]]",
                ...extra,
            ].join("\n");
        };
        const uebernehmen = async (zeilen: string[] = []): Promise<string> => {
            const operationId = neu();
            const ergebnis = await uebernehmeRegelText(database, anna, { operationId, text: await text(zeilen) });
            expect(ergebnis.status).toBe("applied");
            return operationId;
        };

        it("🔴 die Rücknahme hängt an einem der Einträge, prüft und schreibt aber alle: Regeln und Quellen beider Einträge gehen zurück, eine Operation, ein Protokolleintrag je Eintrag", async () => {
            const idA = await idVon(A);
            const idS = await idVon(S);
            const vorherA = await aufnahme(A);
            const vorherS = await aufnahme(S);
            const revisionA = await revisionVon(A);
            const revisionS = await revisionVon(S);
            const op = await uebernehmen();
            expect(Object.keys((await aufnahme(A)).regeln)).toHaveLength(Object.keys(vorherA.regeln).length + 1);
            expect(await revisionVon(A)).toBe(revisionA + 1);
            const original = await eintrag(op);
            expect(original.objects.map((o) => [o.id, o.action]).sort()).toEqual(
                [
                    [idA, "lore.rules_text"],
                    [idS, "lore.rules_text"],
                ].sort(),
            );

            // An EINEM Eintrag (dem Ork) aufgehängt, nicht an der Alraune, die zuerst im Text steht.
            const vor = await vorschau(annaLeser, idS, [op]);
            expect(vor.ergebnis).toBe("ok");
            expect(vor.gegenstaende.map((g) => g.id).sort()).toEqual([idA, idS].sort());
            expect(vor.folgen).toEqual({ gegenstaende: 2, gelaende: "keines" });
            // Er steht als Einzeleintrag, nie in einer Serie (Fachvertrag B.2).
            expect(vor.mitglieder[0]!.series).toBeUndefined();

            const operationId = neu();
            const quittung = await ruecknehmen(anna, annaLeser, idS, koerper([op], { operationId }));
            expect(quittung.status).toBe("applied");
            expect(quittung.affected.map((a) => a.id).sort()).toEqual([idA, idS].sort());
            gleichWieVorher(vorherA, await aufnahme(A));
            gleichWieVorher(vorherS, await aufnahme(S));
            // Die Revision beider Einträge zählt für die Rücknahme.
            expect(await revisionVon(A)).toBe(revisionA + 2);
            expect(await revisionVon(S)).toBe(revisionS + 2);
            const rueck = await eintrag(operationId);
            expect(rueck.objects.map((o) => o.id).sort()).toEqual([idA, idS].sort());
            expect((await eintrag(op)).status).toBe("bereits_zurueckgenommen");
            // Neu angelegte Regeln und Quellenverknüpfungen sind still gelegt, nie gelöscht.
            const nach = await aufnahme(S);
            expect(Object.values(nach.regeln).filter((r) => r["state"] === "retired")).toHaveLength(1);
            expect(Object.values(nach.quellen).filter((q) => q["state"] === "retired")).toHaveLength(1);
        });

        it("🔴 ganz oder gar nicht über beide Einträge: Eine spätere Änderung an dem Eintrag, der NICHT der Anker ist, hält die ganze Rücknahme an", async () => {
            const idS = await idVon(S);
            const op = await uebernehmen();
            await aendere(bernd, A, { fields: { gruppe: "Von Bernd" } });
            const standA = await aufnahme(A);
            const standS = await aufnahme(S);
            const vor = await vorschau(annaLeser, idS, [op]);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte.map((k) => [k.kind, k.id])).toEqual([["lore", await idVon(A)]]);
            const operationenVorher = await anzahlOperationen();
            expect(await fehler(ruecknehmen(anna, annaLeser, idS, koerper([op])))).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await aufnahme(A)).toEqual(standA);
            expect(await aufnahme(S)).toEqual(standS);
            expect(await anzahlOperationen()).toBe(operationenVorher);
        });

        it("🔴 B8d: legte die Übernahme auch einen Eintrag an (`Name (Kategorie, neu)`), geht auch der zurück: der neue Eintrag wird stillgelegt samt seiner Regel, die übrigen gehen auf den Stand davor; die Rücknahme davon belebt alles", async () => {
            const idA = await idVon(A);
            const vorherA = await aufnahme(A);
            const op = await uebernehmen(["P74T Neuling (Fauna, neu)", "| Herkunft = [[Wald]]"]);
            const original = await eintrag(op);
            expect(original.objects.map((o) => o.action).sort()).toEqual(
                ["lore.created", "lore.rules_text", "lore.rules_text"].sort(),
            );
            expect(original.status).toBe("ruecknehmbar");
            const neuId = original.objects.find((o) => o.action === "lore.created")!.id;
            expect(await imIndex(neuId)).toBe(true);
            const vor = await vorschau(annaLeser, idA, [op]);
            expect(vor.ergebnis).toBe("ok");
            expect(vor.gegenstaende.map((g) => g.id)).toContain(neuId);

            const rueck = neu();
            const quittung = await ruecknehmen(anna, annaLeser, idA, koerper([op], { operationId: rueck }));
            expect(quittung.status).toBe("applied");
            expect(quittung.affected.map((a) => a.id)).toContain(neuId);
            gleichWieVorher(vorherA, await aufnahme(A));
            expect(await eintragStand(neuId)).toMatchObject({ state: "suppressed", is_active: false });
            const regeln = await database<{ state: string }[]>`
                SELECT r.state FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = ${neuId}::uuid`;
            expect(regeln.map((r) => r.state)).toEqual(["retired"]);
            expect(await imIndex(neuId)).toBe(false);
            expect((await eintrag(op)).status).toBe("bereits_zurueckgenommen");

            const beleben = await ruecknehmen(anna, annaLeser, idA, koerper([rueck]));
            expect(beleben.status).toBe("applied");
            expect(await eintragStand(neuId)).toMatchObject({ state: "active", is_active: true });
            const nachher = await database<{ state: string }[]>`
                SELECT r.state FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = ${neuId}::uuid`;
            expect(nachher.map((r) => r.state)).toEqual(["active"]);
            expect(await imIndex(neuId)).toBe(true);
        });

        it("eine Übernahme an EINEM Eintrag ist Mitglied einer Serie mit dem Speichern im Reiter und geht mit ihm zusammen zurück", async () => {
            const idA = await idVon(A);
            const vorherA = await aufnahme(A);
            const kraeuter = await quelleId("P74T Kräuterkunde");
            const eins = await aendere(anna, A, { fields: { gruppe: "Giftpflanze" } });
            const operationId = neu();
            await uebernehmeRegelText(database, anna, {
                operationId,
                text: [
                    `Quelle: [[#${kraeuter.slice(0, 8)}|P74T Kräuterkunde]], S. 3`,
                    "P74T Alraune (Flora)",
                    "| Herkunft = [[Wald]]",
                ].join("\n"),
            });
            const mitglied = await eintrag(operationId);
            expect(mitglied.series).toMatchObject({ position: 2, size: 2 });
            const quittung = await ruecknehmen(anna, annaLeser, idA, koerper([eins, operationId]));
            expect(quittung.status).toBe("applied");
            gleichWieVorher(vorherA, await aufnahme(A));
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    it("🔴 die Route: Besucher 401, Reviewer darf die Vorprüfung lesen, aber nicht zurücknehmen (403); der Editor nimmt zurück; Antworten im Vertrag", async () => {
        const id = await idVon(A);
        const vorher = await aufnahme(A);
        const eins = await aendere(anna, A, { fields: { gruppe: "Giftpflanze" } });
        const post = (adresse: string, rolle: string | undefined, payload: object) =>
            app.inject({
                method: "POST",
                url: adresse,
                headers: { origin: TEST_ORIGIN, ...(rolle === undefined ? {} : { cookie: cookies.get(rolle) ?? "" }) },
                payload,
            });
        const vorschauBody = vorbody([eins]);
        const vorschauUrl = editorVorkommenRestoreSeriesPreviewUrl(id);
        const ruecknahmeUrl = editorVorkommenRestoreSeriesUrl(id);
        expect((await post(vorschauUrl, undefined, vorschauBody)).statusCode).toBe(401);
        const lesen = await post(vorschauUrl, "reviewer", vorschauBody);
        expect(lesen.statusCode).toBe(200);
        expect(lesen.headers["cache-control"]).toBe("private, no-store");
        const pruefung = lesen.json() as Pruefung;
        // Der Reviewer hat das Recht der Vorwärtsoperation nicht: Die Vorprüfung sagt es, und erzählt nichts über den Stand.
        expect(pruefung.ergebnis).toBe("forbidden");
        expect(Value.Check(RuecknahmePruefung, pruefung)).toBe(true);
        expect((await post(ruecknahmeUrl, "reviewer", koerper([eins]))).statusCode).toBe(403);

        const editorVorschau = await post(vorschauUrl, "editor", vorschauBody);
        expect(editorVorschau.statusCode).toBe(200);
        expect((editorVorschau.json() as Pruefung).ergebnis).toBe("ok");
        const ok = await post(ruecknahmeUrl, "editor", koerper([eins]));
        expect(ok.statusCode, ok.body).toBe(200);
        expect(Value.Check(RuecknahmeReceipt, ok.json())).toBe(true);
        expect((ok.json() as Quittung).reverts).toEqual([eins]);
        gleichWieVorher(vorher, await aufnahme(A));
        expect(
            (await post(editorVorkommenRestoreSeriesPreviewUrl(randomUUID()), "editor", vorschauBody)).statusCode,
        ).toBe(404);
    });
});
