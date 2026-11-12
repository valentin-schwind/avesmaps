import { randomUUID } from "node:crypto";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    RuecknahmePruefung,
    RuecknahmeReceipt,
    editorKorpusRestoreSeriesPreviewUrl,
    editorKorpusRestoreSeriesUrl,
    editorQuelleRestoreSeriesPreviewUrl,
    editorQuelleRestoreSeriesUrl,
    editorWerkRestoreSeriesPreviewUrl,
    editorWerkRestoreSeriesUrl,
    type Capability,
    type MapHistoryEntry,
    type RuecknahmeBody,
    type RuecknahmeReceipt as Quittung,
    type RuecknahmeVorschauBody,
    type RuecknahmePruefung as Pruefung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { mapChange } from "../src/editor/history.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ruecknehmenKorpus, vorschauKorpus } from "../src/editor/ruecknahme-korpus.ts";
import { ruecknehmenQuelle, vorschauQuelle } from "../src/editor/ruecknahme-quelle.ts";
import { ruecknehmenWerk, vorschauWerk } from "../src/editor/ruecknahme-werk.ts";
import type { RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { ApiError } from "../src/http/api-error.ts";
import { aendereKorpus, legeKorpusAn } from "../src/inhalte/korpora-schreiben.ts";
import { inhalteOperation } from "../src/inhalte/operation.ts";
import { TRAEGER } from "../src/inhalte/traeger.ts";
import { aendereQuelle, legeQuelleAn, schluesselDerAdresse } from "../src/inhalte/quellen-schreiben.ts";
import { aendereTraegerQuellen } from "../src/inhalte/traeger-quellen-schreiben.ts";
import { aendereWerk, legeWerkAn } from "../src/inhalte/werke-schreiben.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { P3, cleanP3Fixtures, insertP3Carriers } from "./support/p3-fixture.ts";

/**
 * Quellen, Werke und Korpora zurücknehmen (WI-0265 B6g1; Fachvertrag C.2, C.3, F.1, Gate 2 und 3; Testvertrag U4 bis U9): `POST /api/editor/inhalte/{quellen,literatur,korpora}/:id/restore-series[/preview]`
 * gegen echtes PostgreSQL (`TEST_DATABASE_URL`). Die Rechte der App-Rolle prüft der Rauchtest der Schreibwege (`support/schreibwege/inhalte.ts`).
 *
 * Problemfälle: Eine Serie geht nur teilweise zurück (ein Feld bleibt, die Jahresangabe in Worten, eine Zeile der Ortsliste, eine Quelle der Wirkung eines Korpus); eine Fremdänderung seither bleibt
 * unbemerkt oder wird überschrieben (auch eine Wirkung des Korpus, die die Quelle selbst nicht als Operation kennt); ein Doppelklick schreibt zweimal; eine fremde Person wird ohne Grund
 * zurückgenommen; das Anlegen (WI-0265 B8d: Stilllegen, mit Konflikt, wo seither etwas daran hängt) oder eine Änderung der Verwendungen gilt als nicht zurücknehmbar; die Rücknahme lässt die Karte ihre Kacheln neu laden (Ereignis und Ableitung, die die Inhalte nie
 * auslösen); eine Rücknahme der Rücknahme führt nicht zum Stand davor.
 */

FormatRegistry.Set("date-time", (wert) => !Number.isNaN(Date.parse(wert)));

const url = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = url ? describe : describe.skip;

const NEU = (): string => randomUUID();

describeWithDatabase("Inhalte zurücknehmen: Quelle, Werk, Korpus (WI-0265 B6g1)", { timeout: 300_000 }, () => {
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
        const id = NEU();
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

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
        for (const art of Object.keys(TRAEGER) as (keyof typeof TRAEGER)[])
            await database.unsafe(
                `DELETE FROM ${TRAEGER[art].link} WHERE source_id IN (SELECT id FROM feature_source WHERE title LIKE 'B6G1%')`,
            );
        await database`DELETE FROM feature_source WHERE title LIKE 'B6G1%'`;
        await database.unsafe(
            `DELETE FROM adventure_place WHERE adventure_id IN (SELECT id FROM adventure WHERE title LIKE 'B6G1%')`,
        );
        await database.unsafe(
            `DELETE FROM adventure_field_origin WHERE adventure_id IN (SELECT id FROM adventure WHERE title LIKE 'B6G1%')`,
        );
        await database`DELETE FROM adventure WHERE title LIKE 'B6G1%'`;
        await database`DELETE FROM source_corpus WHERE corpus_key LIKE 'b6g1%'`;
        await cleanP3Fixtures(database);
        operationen.length = 0;
    }

    const anzahlOperationen = async (): Promise<number> =>
        Number((await database<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)[0]!.n);

    // --- Fixtures: Stand ohne Operation (wie aus Legacy) ------------------------------------------------------------------------

    const quelleAnlegen = async (): Promise<string> => {
        const adresse = `https://b6g1.example/${NEU()}`;
        const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system)
            VALUES (${schluesselDerAdresse(adresse)}, 'final', ${adresse}, 'B6G1 Quelle', 'sonstiges', FALSE, 'legacy')
            RETURNING public_id::text
        `;
        return zeile!.public_id;
    };
    const werkAnlegen = async (): Promise<{ id: string; zeilen: string[] }> => {
        const [zeile] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO adventure (public_id, title, product_type, edition, bf_year, bf_label, is_official, source_system)
            VALUES (gen_random_uuid(), 'B6G1 Werk', 'gruppenabenteuer', 'DSA5', 1040, 'Praios 1040', TRUE, 'legacy')
            RETURNING id::text, public_id::text
        `;
        const zeilen: string[] = [];
        for (const [nummer, name] of ["Erste", "Zweite"].entries()) {
            const [eine] = await database<{ id: string }[]>`
                INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, raw_name, role, target_state, source_system)
                VALUES (${zeile!.id}::bigint, ${nummer}, ${nummer}, ${name.toLowerCase()}, ${name}, 'play', 'unresolved', ${nummer === 0 ? "legacy" : "editor"})
                RETURNING id::text
            `;
            zeilen.push(eine!.id);
        }
        return { id: zeile!.public_id, zeilen };
    };
    /** Ein Belegstellen-Korpus (Revision 1) mit zwei Quellen seiner Domain, die der Vorgabe folgen. */
    const korpusAnlegen = async (): Promise<{ id: string; key: string; quellen: string[] }> => {
        const key = `b6g1${NEU().slice(0, 8)}.example`;
        const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO source_corpus (corpus_key, label, form, source_type, is_official, source_system)
            VALUES (${key}, 'B6G1 Korpus', 'belegstelle', 'sonstiges', FALSE, 'legacy') RETURNING public_id::text
        `;
        const quellen: string[] = [];
        for (const nummer of [1, 2]) {
            const adresse = `https://www.${key}/seite-${String(nummer)}`;
            const [eine] = await database<{ public_id: string }[]>`
                INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, corpus_key, source_system)
                VALUES (${schluesselDerAdresse(adresse)}, 'final', ${adresse}, ${`B6G1 Seite ${String(nummer)} ${key}`}, 'sonstiges', FALSE, ${key}, 'legacy')
                RETURNING public_id::text
            `;
            quellen.push(eine!.public_id);
        }
        return { id: zeile!.public_id, key, quellen };
    };

    // --- Lesen --------------------------------------------------------------------------------------------------------------

    const quelleStand = async (id: string) =>
        (
            await database`
                SELECT title, source_type, is_official, license_statement, license_key, attribution, editor_note, is_active,
                       retired_at IS NOT NULL AS stillgelegt, retired_origin
                  FROM feature_source WHERE public_id = ${id}::uuid`
        )[0]!;
    const quelleRevision = async (id: string): Promise<number> =>
        Number(
            (
                await database<
                    { r: string }[]
                >`SELECT revision::text AS r FROM feature_source WHERE public_id = ${id}::uuid`
            )[0]!.r,
        );
    const werkStand = async (id: string) => ({
        werk: (
            await database`
                SELECT title, product_type, edition, series, genre, bf_year, bf_label, is_official, editor_note, is_active, state
                  FROM adventure WHERE public_id = ${id}::uuid`
        )[0]!,
        orte: await database`
            SELECT p.id::text AS id, p.role
              FROM adventure_place p JOIN adventure a ON a.id = p.adventure_id
             WHERE a.public_id = ${id}::uuid AND p.is_active AND p.state = 'active' ORDER BY p.sort_order, p.export_ordinal, p.id`,
    });
    const werkRevision = async (id: string): Promise<number> =>
        Number(
            (
                await database<{ r: string }[]>`SELECT revision::text AS r FROM adventure WHERE public_id = ${id}::uuid`
            )[0]!.r,
        );
    const korpusStand = async (id: string, quellen: string[]) => ({
        korpus: (
            await database`
                SELECT label, form, source_type, is_official, license_statement, license_key, attribution, editor_note
                  FROM source_corpus WHERE public_id = ${id}::uuid`
        )[0]!,
        quellen: await database`
            SELECT public_id::text, source_type, is_official, license_statement, license_key, attribution
              FROM feature_source WHERE public_id = ANY(${quellen}::uuid[]) ORDER BY public_id`,
    });
    const korpusRevision = async (id: string): Promise<number> =>
        Number(
            (
                await database<
                    { r: string }[]
                >`SELECT revision::text AS r FROM source_corpus WHERE public_id = ${id}::uuid`
            )[0]!.r,
        );

    // --- Szenarien: dieselben Fälle für alle drei -------------------------------------------------------------------------------

    interface Szenario {
        name: string;
        prefix: string;
        kind: "source" | "work" | "corpus";
        urls: { vorschau: (id: string) => string; ruecknahme: (id: string) => string };
        erzeuge(): Promise<string>;
        /** Eine Änderung (Schritt 1 oder 2) am Gegenstand; gibt die Kennung der Operation zurück. */
        aendere(id: string, akteur: MapActor, schritt: 1 | 2): Promise<string>;
        /** Eine spätere Änderung von Bernd. */
        fremdAendere(id: string): Promise<string>;
        stand(id: string): Promise<unknown>;
        /** Legt neu an (`*.create`); gibt Kennung des Gegenstands und der Operation zurück. */
        legeAn(akteur: MapActor): Promise<{ id: string; operationId: string }>;
        /** Ob der Gegenstand aktiv ist (nicht stillgelegt); es gibt ihn weiter, auch stillgelegt. */
        aktiv(id: string): Promise<boolean>;
        /** Lässt etwas am Gegenstand hängen, das keine Operation an ihm ist (Verwendung, Ortszeile); fehlt, wo nichts an einem angelegten Gegenstand hängen kann. */
        haengtAn?(id: string): Promise<void>;
        /** Das, woran es hängt, in den Namen des Protokolls (`inhalt_verwendet`). */
        haengtAnFelder?: string[];
        vorschau(leser: RuecknahmeLeser, id: string, body: RuecknahmeVorschauBody): Promise<Pruefung>;
        ruecknehmen(akteur: MapActor, leser: RuecknahmeLeser, id: string, body: RuecknahmeBody): Promise<Quittung>;
    }

    let korpusQuellen = new Map<string, string[]>();

    const szenarien: Szenario[] = [
        {
            name: "Quelle",
            prefix: "source",
            kind: "source",
            urls: { vorschau: editorQuelleRestoreSeriesPreviewUrl, ruecknahme: editorQuelleRestoreSeriesUrl },
            erzeuge: quelleAnlegen,
            async aendere(id, akteur, schritt) {
                const operationId = neu();
                await aendereQuelle(database, akteur, id, {
                    operationId,
                    baseRevision: await quelleRevision(id),
                    fields:
                        schritt === 1
                            ? { title: "B6G1 Quelle B", sourceType: "briefspiel" }
                            : { title: "B6G1 Quelle C", isOfficial: true, attribution: "Die Autoren", aktiv: false },
                });
                return operationId;
            },
            async fremdAendere(id) {
                const operationId = neu();
                await aendereQuelle(database, bernd, id, {
                    operationId,
                    baseRevision: await quelleRevision(id),
                    fields: { title: "B6G1 Quelle von Bernd" },
                });
                return operationId;
            },
            stand: quelleStand,
            aktiv: async (id) => (await quelleStand(id)).is_active === true,
            async haengtAn(id) {
                const traeger = await insertP3Carriers(database);
                expect(Object.keys(traeger)).not.toHaveLength(0);
                // Bernd hängt die Quelle am Ort an: eine Operation am Ort, keine an der Quelle.
                await aendereTraegerQuellen(database, bernd, "place", P3.ort, {
                    operationId: neu(),
                    aenderungen: [
                        { op: "add", sourceId: id, vorher: null, referenceKind: "ausfuehrlich", pages: "S. 1" },
                    ],
                });
            },
            haengtAnFelder: ["links"],
            async legeAn(akteur) {
                const operationId = neu();
                const angelegt = await legeQuelleAn(database, akteur, {
                    operationId,
                    url: `https://b6g1.example/neu-${NEU()}`,
                    title: "B6G1 Neu",
                });
                return { id: angelegt.publicId, operationId };
            },
            vorschau: (leser, id, body) => vorschauQuelle(database, id, body, leser),
            ruecknehmen: (akteur, leser, id, body) => ruecknehmenQuelle(database, akteur, leser, id, body),
        },
        {
            name: "Werk",
            prefix: "work",
            kind: "work",
            urls: { vorschau: editorWerkRestoreSeriesPreviewUrl, ruecknahme: editorWerkRestoreSeriesUrl },
            async erzeuge() {
                const werk = await werkAnlegen();
                zeilenVon.set(werk.id, werk.zeilen);
                return werk.id;
            },
            async aendere(id, akteur, schritt) {
                const operationId = neu();
                const zeilen = zeilenVon.get(id)!;
                await aendereWerk(database, akteur, id, {
                    operationId,
                    baseRevision: await werkRevision(id),
                    // Schritt 1 ändert das Jahr (das die Jahresangabe in Worten löscht), Schritt 2 die Ortsliste: eine Zeile fällt weg (die aus Legacy wird unterdrückt), eine kommt dazu, die Rolle wechselt.
                    ...(schritt === 1
                        ? { fields: { title: "B6G1 Werk B", edition: "DSA4", bfYear: 1041 } }
                        : {
                              fields: { editorNote: "Notiz" },
                              orte: [
                                  { rowId: zeilen[1]!, role: "start" },
                                  { rawName: "Dritte", role: "play" },
                              ],
                          }),
                });
                return operationId;
            },
            async fremdAendere(id) {
                const operationId = neu();
                await aendereWerk(database, bernd, id, {
                    operationId,
                    baseRevision: await werkRevision(id),
                    fields: { genre: "von Bernd" },
                });
                return operationId;
            },
            stand: werkStand,
            aktiv: async (id) => (await werkStand(id)).werk["is_active"] === true,
            async haengtAn(id) {
                // Eine Zeile der Ortsliste ohne Operation am Werk (wie ein Zug des Imports).
                await database`
                    INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, raw_name, role, target_state, source_system)
                    SELECT id, 0, 0, 'fremd', 'Fremd', 'play', 'unresolved', 'legacy' FROM adventure WHERE public_id = ${id}::uuid
                `;
            },
            haengtAnFelder: ["places"],
            async legeAn(akteur) {
                const operationId = neu();
                const angelegt = await legeWerkAn(database, akteur, {
                    operationId,
                    title: "B6G1 Neu",
                    productType: "gruppenabenteuer",
                });
                return { id: angelegt.publicId, operationId };
            },
            vorschau: (leser, id, body) => vorschauWerk(database, id, body, leser),
            ruecknehmen: (akteur, leser, id, body) => ruecknehmenWerk(database, akteur, leser, id, body),
        },
        {
            name: "Korpus",
            prefix: "corpus",
            kind: "corpus",
            urls: { vorschau: editorKorpusRestoreSeriesPreviewUrl, ruecknahme: editorKorpusRestoreSeriesUrl },
            async erzeuge() {
                const korpus = await korpusAnlegen();
                korpusQuellen.set(korpus.id, korpus.quellen);
                return korpus.id;
            },
            async aendere(id, akteur, schritt) {
                const operationId = neu();
                await aendereKorpus(database, akteur, id, {
                    operationId,
                    baseRevision: await korpusRevision(id),
                    // Schritt 2 schreibt Art und „offiziell“ auf beide Quellen der Domain durch.
                    fields:
                        schritt === 1
                            ? { label: "B6G1 Korpus B", editorNote: "Notiz" }
                            : { sourceType: "briefspiel", isOfficial: true },
                });
                return operationId;
            },
            async fremdAendere(id) {
                const operationId = neu();
                await aendereKorpus(database, bernd, id, {
                    operationId,
                    baseRevision: await korpusRevision(id),
                    fields: { label: "B6G1 Korpus von Bernd" },
                });
                return operationId;
            },
            stand: (id) => korpusStand(id, korpusQuellen.get(id) ?? []),
            aktiv: async (id) =>
                (
                    await database<
                        { a: boolean }[]
                    >`SELECT is_active AS a FROM source_corpus WHERE public_id = ${id}::uuid`
                )[0]!.a,
            async legeAn(akteur) {
                const operationId = neu();
                const angelegt = await legeKorpusAn(database, akteur, {
                    operationId,
                    key: `b6g1${NEU().slice(0, 8)}.example`,
                });
                return { id: angelegt.publicId, operationId };
            },
            vorschau: (leser, id, body) => vorschauKorpus(database, id, body, leser),
            ruecknehmen: (akteur, leser, id, body) => ruecknehmenKorpus(database, akteur, leser, id, body),
        },
    ];
    /** Die Nummern der Ortszeilen eines Werks aus der Fixture. */
    const zeilenVon = new Map<string, string[]>();

    const koerper = (members: string[], extra: { operationId?: string; reason?: string } = {}): RuecknahmeBody => ({
        operationId: extra.operationId ?? neu(),
        members,
        membersHash: mitgliederHash(members),
        ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    });
    const vorbody = (members: string[]): RuecknahmeVorschauBody => ({ members, membersHash: mitgliederHash(members) });
    const eintrag = async (operationId: string): Promise<MapHistoryEntry> =>
        (await mapChange(database, operationId, { mapDomainId: "aventuria", personId: annaLeser.personId }))!;

    beforeAll(async () => {
        database = createDatabase(url as string, { max: 6 });
        await migrate(database);
        fixture = authFixture(database);
        const a = await fixture.person("editor", { name: "Anna Inhalte" });
        const b = await fixture.person("editor", { name: "Bernd Inhalte" });
        anna = { kind: "person", personId: a.id, environment: "test" };
        bernd = { kind: "person", personId: b.id, environment: "test" };
        annaLeser = { personId: a.id, rechte: RECHTE };
        berndLeser = { personId: b.id, rechte: RECHTE };
        ohneRecht = { personId: a.id, rechte: new Set<Capability>(["use_editor_menu"]) };
        for (const [rolle, person] of [
            ["editor", a],
            ["reviewer", await fixture.person("reviewer", { name: "Rita Inhalte" })],
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
        korpusQuellen = new Map();
        zeilenVon.clear();
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe.each(szenarien)("$name", (s) => {
        it("🔴 eine Serie geht in EINER Operation auf den Stand vor dem ersten Mitglied zurück (Quelle restore, Verknüpfung zu beiden Originalen, kein Ereignis der Karte)", async () => {
            const id = await s.erzeuge();
            const vorher = await s.stand(id);
            const eins = await s.aendere(id, anna, 1);
            const zwei = await s.aendere(id, anna, 2);
            const geaendert = await s.stand(id);
            expect(geaendert).not.toEqual(vorher);
            const members = [eins, zwei];

            const vor = await s.vorschau(annaLeser, id, vorbody(members));
            expect(vor.ergebnis).toBe("ok");
            expect(vor.offen).toEqual(members);
            expect(vor.folgen).toEqual({ gegenstaende: 1, gelaende: "keines" });
            const operationenVorher = await anzahlOperationen();

            const operationId = neu();
            const quittung = await s.ruecknehmen(anna, annaLeser, id, koerper(members, { operationId }));
            expect(quittung.status).toBe("applied");
            expect(quittung.operationId).toBe(operationId);
            expect(quittung.reverts).toEqual(members);
            // Die Inhalte lösen weder Ableitung noch Ereignis der Karte aus (wie ihre Vorwärtswege).
            expect(quittung.mapRevision).toBeUndefined();
            expect(quittung.derivedWork).toEqual([]);
            expect(Value.Check(RuecknahmeReceipt, quittung)).toBe(true);
            expect(await s.stand(id)).toEqual(vorher);
            expect(await anzahlOperationen()).toBe(operationenVorher + 1);

            const zeile = (
                await database<{ action: string; source: string; map_domain_id: string }[]>`
                    SELECT action, source, map_domain_id FROM map_operation WHERE operation_id = ${operationId}::uuid`
            )[0]!;
            expect(zeile).toEqual({
                action: `${s.prefix}.restore_series`,
                source: "restore",
                map_domain_id: "aventuria",
            });
            const links = await database<{ id: string }[]>`
                SELECT reverted_operation_id::text AS id FROM map_operation_revert_link WHERE restore_operation_id = ${operationId}::uuid ORDER BY position`;
            expect(links.map((l) => l.id)).toEqual(members);
            // Beide Originale sind zurückgenommen; die Rücknahme selbst gilt.
            expect((await eintrag(eins)).status).toBe("bereits_zurueckgenommen");
            expect((await eintrag(zwei)).revertedBy?.operationId).toBe(operationId);
            expect((await eintrag(operationId)).source).toBe("restore");
        });

        it("🔴 eine spätere Änderung seither: 409 edit_conflict mit wer und wann, nichts geschrieben (ganz oder gar nicht)", async () => {
            const id = await s.erzeuge();
            const eins = await s.aendere(id, anna, 1);
            const zwei = await s.aendere(id, anna, 2);
            const fremd = await s.fremdAendere(id);
            const stand = await s.stand(id);
            const members = [eins, zwei];

            const vor = await s.vorschau(annaLeser, id, vorbody(members));
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte[0]).toMatchObject({ art: "spaeter", operationId: fremd, kind: s.kind, id });
            expect(vor.konflikte[0]!.changedBy?.name).toBe("Bernd Inhalte");

            const operationenVorher = await anzahlOperationen();
            const abgelehnt = await fehler(s.ruecknehmen(anna, annaLeser, id, koerper(members)));
            expect(abgelehnt).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            expect(await s.stand(id)).toEqual(stand);
            expect(await anzahlOperationen()).toBe(operationenVorher);
            expect(
                await database`SELECT 1 FROM map_operation_revert_link WHERE reverted_operation_id = ANY(${members}::uuid[])`,
            ).toHaveLength(0);
        });

        it("🔴 dieselbe Kennung noch einmal (Doppelklick, Netzretry): die erste Quittung als replayed, nichts doppelt", async () => {
            const id = await s.erzeuge();
            const eins = await s.aendere(id, anna, 1);
            const operationId = neu();
            const erste = await s.ruecknehmen(anna, annaLeser, id, koerper([eins], { operationId }));
            const stand = await s.stand(id);
            const operationenVorher = await anzahlOperationen();
            const zweite = await s.ruecknehmen(anna, annaLeser, id, koerper([eins], { operationId }));
            expect(zweite.status).toBe("replayed");
            expect(zweite.operationId).toBe(erste.operationId);
            expect(zweite.reverts).toEqual([eins]);
            expect(await s.stand(id)).toEqual(stand);
            expect(await anzahlOperationen()).toBe(operationenVorher);
            // Eine NEUE Kennung für dieselben Mitglieder: sie sind schon zurückgenommen.
            expect(await fehler(s.ruecknehmen(anna, annaLeser, id, koerper([eins])))).toMatchObject({
                statusCode: 409,
                code: "already_reverted",
            });
        });

        it("🔴 die Änderung einer anderen Person: ohne Grund 400 reason_required, mit Grund geht sie zurück und der Grund bleibt im Eintrag sichtbar", async () => {
            const id = await s.erzeuge();
            const vorher = await s.stand(id);
            const eins = await s.aendere(id, anna, 1);
            const vor = await s.vorschau(berndLeser, id, vorbody([eins]));
            expect(vor.ergebnis).toBe("ok");
            expect(vor.reasonRequired).toBe(true);
            expect(vor.fremdePersonen.map((p) => p.name)).toEqual(["Anna Inhalte"]);

            const operationenVorher = await anzahlOperationen();
            expect(await fehler(s.ruecknehmen(bernd, berndLeser, id, koerper([eins])))).toMatchObject({
                statusCode: 400,
                code: "reason_required",
            });
            expect(await anzahlOperationen()).toBe(operationenVorher);

            const operationId = neu();
            const quittung = await s.ruecknehmen(
                bernd,
                berndLeser,
                id,
                koerper([eins], { operationId, reason: "Falsche Angabe" }),
            );
            expect(quittung.status).toBe("applied");
            expect(await s.stand(id)).toEqual(vorher);
            expect((await eintrag(eins)).revertedBy).toMatchObject({ operationId, reason: "Falsche Angabe" });
            const rueck = await eintrag(operationId);
            expect(rueck.reason).toBe("Falsche Angabe");
            expect(rueck.actor.name).toBe("Bernd Inhalte");
        });

        it("🔴 ohne das Recht manage_sources: 403, nichts erfährt die Person über den Stand", async () => {
            const id = await s.erzeuge();
            const eins = await s.aendere(id, anna, 1);
            const vor = await s.vorschau(ohneRecht, id, vorbody([eins]));
            expect(vor.ergebnis).toBe("forbidden");
            expect(vor.fehlendeRechte).toEqual(["manage_sources"]);
            const abgelehnt = await fehler(s.ruecknehmen(anna, ohneRecht, id, koerper([eins])));
            expect(abgelehnt).toMatchObject({ statusCode: 403, code: "forbidden" });
        });

        it("🔴 B8d: das Anlegen (`*.create`) geht zurück als Stilllegen (nichts wird gelöscht): Liste, Vorprüfung, Rücknahme; die Rücknahme der Rücknahme belebt wieder", async () => {
            const { id, operationId } = await s.legeAn(anna);
            expect((await eintrag(operationId)).status).toBe("ruecknehmbar");
            expect(await s.aktiv(id)).toBe(true);
            const vor = await s.vorschau(annaLeser, id, vorbody([operationId]));
            expect(vor.ergebnis).toBe("ok");
            expect(vor.offen).toEqual([operationId]);

            const rueck = neu();
            const quittung = await s.ruecknehmen(anna, annaLeser, id, koerper([operationId], { operationId: rueck }));
            expect(quittung.status).toBe("applied");
            expect(quittung.reverts).toEqual([operationId]);
            expect(Value.Check(RuecknahmeReceipt, quittung)).toBe(true);
            // Stillgelegt, nicht gelöscht; die Inhalte lösen weder Ableitung noch Ereignis der Karte aus.
            expect(await s.aktiv(id)).toBe(false);
            expect(quittung.mapRevision).toBeUndefined();
            expect(quittung.derivedWork).toEqual([]);
            expect((await eintrag(operationId)).status).toBe("bereits_zurueckgenommen");
            expect((await eintrag(operationId)).revertedBy).toMatchObject({ operationId: rueck });
            expect((await eintrag(rueck)).status).toBe("ruecknehmbar");

            // Dieselbe Kennung noch einmal: dieselbe Quittung. Eine andere Kennung für dieselbe Liste: nie ein Doppel.
            const wieder = await s.ruecknehmen(anna, annaLeser, id, koerper([operationId], { operationId: rueck }));
            expect(wieder.status).toBe("replayed");
            expect(wieder.operationId).toBe(rueck);
            const doppelt = await fehler(s.ruecknehmen(anna, annaLeser, id, koerper([operationId])));
            expect(doppelt).toMatchObject({ statusCode: 409, code: "already_reverted" });

            // Die Rücknahme der Rücknahme belebt.
            const beleben = neu();
            const zurueck = await s.ruecknehmen(anna, annaLeser, id, koerper([rueck], { operationId: beleben }));
            expect(zurueck.status).toBe("applied");
            expect(zurueck.reverts).toEqual([rueck]);
            expect(await s.aktiv(id)).toBe(true);
            expect((await eintrag(operationId)).status).toBe("ruecknehmbar");
            expect((await eintrag(rueck)).status).toBe("bereits_zurueckgenommen");
        });

        it("🔴 B8d: eine Serie aus Anlegen und Folgeänderung derselben Person geht als Ganzes zurück (stillgelegt); eine Änderung einer anderen Person ist ein Konflikt", async () => {
            const { id, operationId } = await s.legeAn(anna);
            const eins = await s.aendere(id, anna, 1);
            const members = [operationId, eins];
            const vor = await s.vorschau(annaLeser, id, vorbody(members));
            expect(vor.ergebnis).toBe("ok");
            expect(vor.offen).toEqual(members);
            expect(vor.mitglieder.map((m) => m.series?.size)).toEqual([2, 2]);

            // Bernd ändert danach: streng, auch das Stilllegen sieht es (Konflikt `spaeter`), und nichts wird geschrieben.
            const fremd = await s.fremdAendere(id);
            const konflikt = await s.vorschau(annaLeser, id, vorbody(members));
            expect(konflikt.ergebnis).toBe("edit_conflict");
            expect(konflikt.konflikte.map((k) => ({ art: k.art, operationId: k.operationId }))).toContainEqual({
                art: "spaeter",
                operationId: fremd,
            });
            expect(await fehler(s.ruecknehmen(anna, annaLeser, id, koerper(members)))).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await s.aktiv(id)).toBe(true);
        });

        it("🔴 B8d: Anlegen und Folgeänderung einer anderen Person: ohne Grund 400, mit Grund geht die Serie zurück und der Grund bleibt im Eintrag", async () => {
            const { id, operationId } = await s.legeAn(bernd);
            const eins = await s.aendere(id, bernd, 1);
            const ohneGrund = await fehler(s.ruecknehmen(anna, annaLeser, id, koerper([operationId, eins])));
            expect(ohneGrund).toMatchObject({ statusCode: 400, code: "reason_required" });
            expect(await s.aktiv(id)).toBe(true);
            const quittung = await s.ruecknehmen(
                anna,
                annaLeser,
                id,
                koerper([operationId, eins], { reason: "Doppelt angelegt" }),
            );
            expect(quittung.status).toBe("applied");
            expect(await s.aktiv(id)).toBe(false);
            const rueck = await eintrag(quittung.operationId);
            expect(rueck.reason).toBe("Doppelt angelegt");
        });

        it("🔴 B8d: hängt seither etwas am angelegten Inhalt (ohne Operation an ihm), gibt es 409 mit abweichung `inhalt_verwendet` und nichts wird geschrieben", async (ctx) => {
            if (s.haengtAn === undefined) return ctx.skip();
            const { id, operationId } = await s.legeAn(anna);
            await s.haengtAn(id);
            const vor = await s.vorschau(annaLeser, id, vorbody([operationId]));
            expect(vor.ergebnis).toBe("edit_conflict");
            const wert = vor.konflikte.find((k) => k.art === "wert");
            // Weder die Verwendung an einem Träger noch eine Zeile der Ortsliste zählt die Revision des Gegenstands: Nur diese Prüfung sieht es.
            expect(wert?.abweichung?.was).toBe("inhalt_verwendet");
            expect(wert?.felder).toEqual(s.haengtAnFelder);
            const vorher = await anzahlOperationen();
            const abgelehnt = await fehler(s.ruecknehmen(anna, annaLeser, id, koerper([operationId])));
            expect(abgelehnt).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            expect(await s.aktiv(id)).toBe(true);
            expect(await anzahlOperationen()).toBe(vorher);
        });

        it("🔴 B8d: ohne das Recht manage_sources ist auch das Anlegen nicht zurückzunehmen (403)", async () => {
            const { id, operationId } = await s.legeAn(anna);
            const vor = await s.vorschau(ohneRecht, id, vorbody([operationId]));
            expect(vor.ergebnis).toBe("forbidden");
            expect(await fehler(s.ruecknehmen(anna, ohneRecht, id, koerper([operationId])))).toMatchObject({
                statusCode: 403,
            });
            expect(await s.aktiv(id)).toBe(true);
        });

        it("eine zerbrochene Liste (falsche Prüfsumme, fremder Gegenstand) und ein Gegenstand, den es nicht gibt, werden abgewiesen", async () => {
            const id = await s.erzeuge();
            const anderer = await s.erzeuge();
            const eins = await s.aendere(id, anna, 1);
            const zwei = await s.aendere(id, anna, 2);
            const hash = await fehler(
                s.ruecknehmen(anna, annaLeser, id, {
                    operationId: neu(),
                    members: [eins, zwei],
                    membersHash: "0".repeat(64),
                }),
            );
            expect(hash).toMatchObject({ statusCode: 400, code: "invalid_members" });
            // Die Operation gehört zu einem anderen Gegenstand als der der Route.
            const fremdeId = await s.aendere(anderer, anna, 1);
            expect(await fehler(s.ruecknehmen(anna, annaLeser, id, koerper([fremdeId])))).toMatchObject({
                statusCode: 400,
                code: "invalid_members",
            });
            expect(await fehler(s.ruecknehmen(anna, annaLeser, randomUUID(), koerper([eins, zwei])))).toMatchObject({
                statusCode: 404,
            });
        });

        it("🔴 die Rücknahme einer Rücknahme führt auf den Stand nach der Änderung zurück (der Rückweg liest ihr Protokoll wie das einer Änderung)", async () => {
            const id = await s.erzeuge();
            const eins = await s.aendere(id, anna, 1);
            const zwei = await s.aendere(id, anna, 2);
            const geaendert = await s.stand(id);
            const rueck = neu();
            await s.ruecknehmen(anna, annaLeser, id, koerper([eins, zwei], { operationId: rueck }));
            expect(await s.stand(id)).not.toEqual(geaendert);

            const nochmal = neu();
            const quittung = await s.ruecknehmen(anna, annaLeser, id, koerper([rueck], { operationId: nochmal }));
            expect(quittung.status).toBe("applied");
            expect(quittung.reverts).toEqual([rueck]);
            expect(await s.stand(id)).toEqual(geaendert);
            expect((await eintrag(rueck)).status).toBe("bereits_zurueckgenommen");
        });

        it("🔴 die Route: Besucher 401, Reviewer darf die Vorprüfung lesen, aber nicht zurücknehmen (403); der Editor nimmt zurück; Antworten im Vertrag", async () => {
            const id = await s.erzeuge();
            const vorher = await s.stand(id);
            const eins = await s.aendere(id, anna, 1);
            const post = (adresse: string, rolle: string | undefined, payload: object) =>
                app.inject({
                    method: "POST",
                    url: adresse,
                    headers: {
                        origin: TEST_ORIGIN,
                        ...(rolle === undefined ? {} : { cookie: cookies.get(rolle) ?? "" }),
                    },
                    payload,
                });
            const vorschauBody = vorbody([eins]);
            expect((await post(s.urls.vorschau(id), undefined, vorschauBody)).statusCode).toBe(401);
            const lesen = await post(s.urls.vorschau(id), "reviewer", vorschauBody);
            expect(lesen.statusCode).toBe(200);
            expect(lesen.headers["cache-control"]).toBe("private, no-store");
            const pruefung = lesen.json() as Pruefung;
            // Der Reviewer hat das Recht der Vorwärtsoperation nicht: Die Vorprüfung sagt es, und erzählt nichts über den Stand.
            expect(pruefung.ergebnis).toBe("forbidden");
            expect(Value.Check(RuecknahmePruefung, pruefung)).toBe(true);
            const unerlaubt = await post(s.urls.ruecknahme(id), "reviewer", koerper([eins]));
            expect(unerlaubt.statusCode).toBe(403);

            const editorVorschau = await post(s.urls.vorschau(id), "editor", vorschauBody);
            expect(editorVorschau.statusCode).toBe(200);
            expect((editorVorschau.json() as Pruefung).ergebnis).toBe("ok");
            const ok = await post(s.urls.ruecknahme(id), "editor", koerper([eins]));
            expect(ok.statusCode, ok.body).toBe(200);
            expect(Value.Check(RuecknahmeReceipt, ok.json())).toBe(true);
            expect((ok.json() as Quittung).reverts).toEqual([eins]);
            expect(await s.stand(id)).toEqual(vorher);
            expect((await post(s.urls.vorschau(randomUUID()), "editor", vorschauBody)).statusCode).toBe(404);
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Quelle: Verwendungen an Trägern (B6g3, mehr in `ruecknahme-traeger-quellen.test.ts`) und was bewusst nicht zurückgeht", () => {
        let traeger: Awaited<ReturnType<typeof insertP3Carriers>>;
        beforeEach(async () => {
            traeger = await insertP3Carriers(database);
        });

        it("🔴 B6g3: eine Änderung, die auch die Verwendungen an Trägern berührt, geht mit zurück: ganz oder gar nicht, die angelegte Verknüpfung wird still gelegt, nie gelöscht", async () => {
            expect(Object.keys(traeger)).not.toHaveLength(0);
            const id = await quelleAnlegen();
            const vorher = await quelleStand(id);
            const felder = neu();
            await aendereQuelle(database, anna, id, {
                operationId: felder,
                baseRevision: await quelleRevision(id),
                fields: { title: "B6G1 Quelle B" },
            });
            const mitLinks = neu();
            await aendereQuelle(database, anna, id, {
                operationId: mitLinks,
                baseRevision: await quelleRevision(id),
                fields: { editorNote: "Notiz" },
                links: [{ op: "add", kind: "place", carrierId: P3.ort }],
            });
            expect((await eintrag(mitLinks)).status).toBe("ruecknehmbar");
            const vor = await vorschauQuelle(database, id, vorbody([felder, mitLinks]), annaLeser);
            expect(vor.ergebnis).toBe("ok");
            const stand = await quelleStand(id);
            expect(stand).not.toEqual(vorher);
            await ruecknehmenQuelle(database, anna, annaLeser, id, koerper([felder, mitLinks]));
            expect(await quelleStand(id)).toEqual(vorher);
            const [zeile] = await database<{ state: string; is_active: boolean }[]>`
                SELECT l.state, l.is_active FROM place_source l JOIN place p ON p.id = l.place_id JOIN feature_source f ON f.id = l.source_id
                 WHERE p.public_id = ${P3.ort}::uuid AND f.public_id = ${id}::uuid`;
            expect(zeile).toEqual({ state: "retired", is_active: false });
        });

        it("🔴 schrieb ein Korpus seither durch, steht die Revision der Quelle anders, als ihr Protokoll sagt: Konflikt `revision`, nichts geschrieben", async () => {
            const korpus = await korpusAnlegen();
            const id = korpus.quellen[0]!;
            // Während die Anzeigeform noch nichts vorgibt, ändert die Redaktion die Art der Quelle.
            await database`UPDATE source_corpus SET form = '' WHERE public_id = ${korpus.id}::uuid`;
            const operationId = neu();
            await aendereQuelle(database, anna, id, {
                operationId,
                baseRevision: await quelleRevision(id),
                fields: { sourceType: "roman" },
            });
            // Danach wird der Korpus zur Belegstelle und schreibt seine Art auf die Quellen durch.
            await aendereKorpus(database, bernd, korpus.id, {
                operationId: neu(),
                baseRevision: await korpusRevision(korpus.id),
                fields: { form: "belegstelle", sourceType: "regelbuch" },
            });
            expect((await quelleStand(id)).source_type).toBe("regelbuch");
            const vor = await vorschauQuelle(database, id, vorbody([operationId]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte.map((k) => k.art)).toContain("revision");
            expect(
                await fehler(ruecknehmenQuelle(database, anna, annaLeser, id, koerper([operationId]))),
            ).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect((await quelleStand(id)).source_type).toBe("regelbuch");
        });

        it("🔴 gibt der Korpus der Domain ein Feld vor, kehrt kein früherer Wert dorthin zurück: Konflikt an den Feldern, nichts geschrieben", async () => {
            const korpus = await korpusAnlegen();
            const id = korpus.quellen[0]!;
            // Solange die Anzeigeform nichts vorgibt, ändert die Redaktion die Art der Quelle frei.
            await database`UPDATE source_corpus SET form = '' WHERE public_id = ${korpus.id}::uuid`;
            const operationId = neu();
            await aendereQuelle(database, anna, id, {
                operationId,
                baseRevision: await quelleRevision(id),
                fields: { sourceType: "roman" },
            });
            // Der Korpus wird Belegstelle, ohne dass die Quelle sich ändert: Er gibt „roman“ vor, die Quelle steht schon so (keine Revision, keine Operation an ihr).
            await database`UPDATE source_corpus SET form = 'belegstelle', source_type = 'roman' WHERE public_id = ${korpus.id}::uuid`;
            const vor = await vorschauQuelle(database, id, vorbody([operationId]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            const konflikt = vor.konflikte.find((k) => k.art === "wert");
            expect(konflikt).toMatchObject({ kind: "source", id, felder: ["sourceType"] });
            expect((await quelleStand(id)).source_type).toBe("roman");
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Werk: Jahresangabe, Ortsliste und Stilllegen", () => {
        it("🔴 die Jahresangabe in Worten kommt mit dem Jahr zurück, die Zeilen der Ortsliste kehren in ihre Reihenfolge zurück (die unterdrückte wird belebt, die neue stillgelegt), nie gelöscht", async () => {
            const werk = await werkAnlegen();
            zeilenVon.set(werk.id, werk.zeilen);
            const szenario = szenarien[1]!;
            const eins = await szenario.aendere(werk.id, anna, 1);
            const zwei = await szenario.aendere(werk.id, anna, 2);
            const jetzt = await werkStand(werk.id);
            expect(jetzt.werk).toMatchObject({ bf_year: 1041, bf_label: null });
            expect(jetzt.orte).toHaveLength(2);
            expect(jetzt.orte.map((z) => z["id"])).not.toContain(werk.zeilen[0]);

            await ruecknehmenWerk(database, anna, annaLeser, werk.id, koerper([eins, zwei]));
            const danach = await werkStand(werk.id);
            expect(danach.werk).toMatchObject({
                bf_year: 1040,
                bf_label: "Praios 1040",
                edition: "DSA5",
                title: "B6G1 Werk",
            });
            expect(danach.orte.map((z) => [z["id"], z["role"]])).toEqual([
                [werk.zeilen[0], "play"],
                [werk.zeilen[1], "play"],
            ]);
            // Die Nummern der Zeilen sind wieder die von Legacy (0 und 1).
            expect(
                (
                    await database<{ sort_order: number }[]>`
                        SELECT sort_order FROM adventure_place WHERE id = ANY(${werk.zeilen}::bigint[]) ORDER BY id`
                ).map((z) => z.sort_order),
            ).toEqual([0, 1]);
            // Die neue Zeile ist still, nicht gelöscht; die Herkunft der zurückgenommenen Felder steht auf „manuell“.
            const alle = await database<{ raw_name: string; state: string; is_active: boolean }[]>`
                SELECT p.raw_name, p.state, p.is_active FROM adventure_place p JOIN adventure a ON a.id = p.adventure_id
                 WHERE a.public_id = ${werk.id}::uuid ORDER BY p.id`;
            expect(alle).toHaveLength(3);
            expect(alle.find((z) => z.raw_name === "Dritte")).toMatchObject({ state: "retired", is_active: false });
            const herkunft = await database<{ field: string; origin: string }[]>`
                SELECT o.field, o.origin FROM adventure_field_origin o JOIN adventure a ON a.id = o.adventure_id
                 WHERE a.public_id = ${werk.id}::uuid ORDER BY o.field`;
            expect(herkunft.map((h) => h.field)).toEqual(
                expect.arrayContaining(["bf_label", "bf_year", "edition", "title"]),
            );
            expect(new Set(herkunft.map((h) => h.origin))).toEqual(new Set(["manual"]));
        });

        it("🔴 die Ortsliste hat seither jemand anders geordnet (ohne Operation): Konflikt am Feld places, nichts geschrieben", async () => {
            const werk = await werkAnlegen();
            zeilenVon.set(werk.id, werk.zeilen);
            const szenario = szenarien[1]!;
            const eins = await szenario.aendere(werk.id, anna, 1);
            const zwei = await szenario.aendere(werk.id, anna, 2);
            // Ein Import (ohne Operation und ohne die Revision des Werks) stellt eine Zeile still, die die Operation behalten hatte.
            await database`UPDATE adventure_place SET is_active = FALSE, state = 'retired', retired_at = now(), retired_origin = 'import' WHERE id = ${werk.zeilen[1]!}::bigint`;
            const vor = await vorschauWerk(database, werk.id, vorbody([eins, zwei]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte.find((k) => k.art === "wert")).toMatchObject({ kind: "work", felder: ["places"] });
            const vorher = await werkStand(werk.id);
            expect(
                await fehler(ruecknehmenWerk(database, anna, annaLeser, werk.id, koerper([eins, zwei]))),
            ).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await werkStand(werk.id)).toEqual(vorher);
        });

        it("🔴 ein Stand, der einmal galt, gilt wieder: Endet die Rücknahme bei einem stillgelegten Werk, ändert sie trotzdem den Titel (die Prüfung „nur wiederherstellen“ gilt nur vorwärts)", async () => {
            const werk = await werkAnlegen();
            zeilenVon.set(werk.id, werk.zeilen);
            // Das Werk ist aus Legacy stillgelegt; die Redaktion holt es zurück und ändert danach den Titel.
            await database`UPDATE adventure SET is_active = FALSE, state = 'retired', retired_at = now(), retired_origin = 'import' WHERE public_id = ${werk.id}::uuid`;
            const hol = neu();
            await aendereWerk(database, anna, werk.id, {
                operationId: hol,
                baseRevision: await werkRevision(werk.id),
                fields: { aktiv: true },
            });
            const titelNeu = neu();
            await aendereWerk(database, anna, werk.id, {
                operationId: titelNeu,
                baseRevision: await werkRevision(werk.id),
                fields: { title: "B6G1 Werk neu" },
            });
            // Vorwärts geht „stillgelegt UND anderer Titel“ nicht; zurück schon: Das Ziel ist der Stand vor beiden.
            await ruecknehmenWerk(database, anna, annaLeser, werk.id, koerper([hol, titelNeu]));
            const stand = await werkStand(werk.id);
            expect(stand.werk).toMatchObject({ title: "B6G1 Werk", is_active: false, state: "retired" });

            // Und das Gegenstück: die Serie [Titel ändern, stilllegen] geht auf „aktiv, alter Titel“.
            await database`UPDATE adventure SET is_active = TRUE, state = 'active', retired_at = NULL, retired_origin = NULL WHERE public_id = ${werk.id}::uuid`;
            const titel = neu();
            await aendereWerk(database, anna, werk.id, {
                operationId: titel,
                baseRevision: await werkRevision(werk.id),
                fields: { title: "B6G1 Werk dritter" },
            });
            const aus = neu();
            await aendereWerk(database, anna, werk.id, {
                operationId: aus,
                baseRevision: await werkRevision(werk.id),
                fields: { aktiv: false },
            });
            await ruecknehmenWerk(database, anna, annaLeser, werk.id, koerper([titel, aus]));
            expect((await werkStand(werk.id)).werk).toMatchObject({ title: "B6G1 Werk", is_active: true });
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Korpus: die Wirkung auf die Quellen", () => {
        it("🔴 die Angaben UND die Quellen der Wirkung gehen zurück (affected nennt sie), das Protokoll der Rücknahme führt die Wirkung wie `corpus.update`", async () => {
            const korpus = await korpusAnlegen();
            korpusQuellen.set(korpus.id, korpus.quellen);
            const szenario = szenarien[2]!;
            const vorher = await korpusStand(korpus.id, korpus.quellen);
            const eins = await szenario.aendere(korpus.id, anna, 1);
            const zwei = await szenario.aendere(korpus.id, anna, 2);
            expect((await korpusStand(korpus.id, korpus.quellen)).quellen.map((q) => q["source_type"])).toEqual([
                "briefspiel",
                "briefspiel",
            ]);

            const operationId = neu();
            const quittung = await ruecknehmenKorpus(
                database,
                anna,
                annaLeser,
                korpus.id,
                koerper([eins, zwei], { operationId }),
            );
            expect(await korpusStand(korpus.id, korpus.quellen)).toEqual(vorher);
            expect(quittung.affected.map((a) => a.kind).sort()).toEqual(["corpus", "source", "source"]);
            expect(new Set(quittung.affected.filter((a) => a.kind === "source").map((a) => a.id))).toEqual(
                new Set(korpus.quellen),
            );
            const rueck = await eintrag(operationId);
            const wirkung = rueck.objects[0]!.changes["quellen"];
            expect((wirkung?.before as unknown[]).length).toBe(2);
            expect((wirkung?.after as { sourceType: string }[]).map((q) => q.sourceType)).toEqual([
                "sonstiges",
                "sonstiges",
            ]);
        });

        it("🔴 steht eine Quelle der Wirkung heute anders (jemand hat sie seither geändert), ist es ein Konflikt am Feld quellen: ganz oder gar nicht, auch die Angaben bleiben", async () => {
            const korpus = await korpusAnlegen();
            korpusQuellen.set(korpus.id, korpus.quellen);
            const szenario = szenarien[2]!;
            const eins = await szenario.aendere(korpus.id, anna, 1);
            const zwei = await szenario.aendere(korpus.id, anna, 2);
            await database`UPDATE feature_source SET source_type = 'roman' WHERE public_id = ${korpus.quellen[0]!}::uuid`;
            const stand = await korpusStand(korpus.id, korpus.quellen);
            const vor = await vorschauKorpus(database, korpus.id, vorbody([eins, zwei]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte.find((k) => k.art === "wert")).toMatchObject({ kind: "corpus", felder: ["quellen"] });
            expect(
                await fehler(ruecknehmenKorpus(database, anna, annaLeser, korpus.id, koerper([eins, zwei]))),
            ).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await korpusStand(korpus.id, korpus.quellen)).toEqual(stand);
        });

        it("🔴 nennt das Protokoll die Wirkung nur als Zahl (mehr Quellen, als es einzeln führt), ist die Rücknahme ehrlich ein Konflikt am Feld quellen statt einer halben", async () => {
            const korpus = await korpusAnlegen();
            korpusQuellen.set(korpus.id, korpus.quellen);
            const operationId = neu();
            const revision = await korpusRevision(korpus.id);
            // Ein Eintrag, wie `corpus.update` ihn bei mehr als 500 Quellen schreibt.
            await inhalteOperation(
                database,
                anna,
                { operationId, operation: "corpus.update", body: { corpusId: korpus.id } },
                async (tx) => {
                    await tx`UPDATE source_corpus SET editor_note = 'viele', revision = ${revision + 1} WHERE public_id = ${korpus.id}::uuid`;
                    return {
                        receipt: {
                            affected: [{ kind: "corpus", id: korpus.id, revision: revision + 1 }],
                            derivedWork: [],
                            warnings: [],
                        },
                        entries: [
                            {
                                action: "corpus.updated",
                                corpusId: korpus.id,
                                revisionBefore: revision,
                                revisionAfter: revision + 1,
                                changes: {
                                    editorNote: { before: null, after: "viele" },
                                    quellen: { before: { anzahl: 600 }, after: { anzahl: 600 } },
                                },
                            },
                        ],
                    };
                },
            );
            const vor = await vorschauKorpus(database, korpus.id, vorbody([operationId]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte[0]).toMatchObject({ art: "wert", felder: ["quellen"] });
            expect(
                await fehler(ruecknehmenKorpus(database, anna, annaLeser, korpus.id, koerper([operationId]))),
            ).toMatchObject({
                statusCode: 409,
            });
            expect((await korpusStand(korpus.id, korpus.quellen)).korpus).toMatchObject({ editor_note: "viele" });
        });

        it("🔴 setzt die Rücknahme die Anzeigeform auf Belegstelle zurück, während Quellen der Domain der Vorgabe nicht folgen, ist es ein Konflikt (sonst schriebe das Durchschreiben Quellen, die das Protokoll nicht kennt)", async () => {
            const korpus = await korpusAnlegen();
            korpusQuellen.set(korpus.id, korpus.quellen);
            const operationId = neu();
            // Die Redaktion stellt die Belegstelle auf „Werk“ um (kein Durchschreiben) ...
            await aendereKorpus(database, anna, korpus.id, {
                operationId,
                baseRevision: await korpusRevision(korpus.id),
                fields: { form: "werk" },
            });
            // ... eine Quelle wird einzeln geändert (bei „Werk“ ist die Art frei; das ist eine spätere Operation am ANDEREN Gegenstand und kein Konflikt des Korpus) ...
            await aendereQuelle(database, anna, korpus.quellen[0]!, {
                operationId: neu(),
                baseRevision: Number(
                    (
                        await database<
                            { r: string }[]
                        >`SELECT revision::text AS r FROM feature_source WHERE public_id = ${korpus.quellen[0]!}::uuid`
                    )[0]!.r,
                ),
                fields: { sourceType: "roman" },
            });
            // ... und die Rücknahme würde die Belegstelle wiederherstellen, der diese Quelle nicht folgt.
            const vor = await vorschauKorpus(database, korpus.id, vorbody([operationId]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte.find((k) => k.art === "wert")).toMatchObject({ kind: "corpus", felder: ["quellen"] });
            expect((await korpusStand(korpus.id, korpus.quellen)).korpus).toMatchObject({ form: "werk" });
        });
    });
});
