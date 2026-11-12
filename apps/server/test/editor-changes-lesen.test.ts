import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    MapHistoryEntry,
    MapHistoryPage,
    editorChangeUrl,
    type MapHistoryEntry as Eintrag,
    type MapHistoryPage as Seite,
    type Capability,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { mapChange, mapChanges, placeHistory } from "../src/editor/history.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "../src/editor/map-operation.ts";
import { ORT_ADAPTER } from "../src/editor/ruecknahme-ort.ts";
import { vorpruefen, type RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";

/**
 * „Änderungen“ lesen (WI-0265 B2a; Fachvertrag A, B, C.4, E.2; Testvertrag U1, U12 (Server), U14, U15) gegen echtes PostgreSQL (`TEST_DATABASE_URL`).
 *
 * Problemfälle: Eine Seite verliert oder verdoppelt eine Operation (Cursor `seq`) oder schneidet eine Arbeitsserie in der Mitte durch; ein Filter wirkt nicht auf dem
 * Server oder nur einzeln; der Zustand eines Originals stimmt nicht mit seiner Rücknahme überein (Rücknahme einer Rücknahme, Etikett-Rücknahme ohne Verknüpfung);
 * eine WikiSync-Rücknahme läuft über die Link-Tafel; die Liste trägt Geometrie, das Detail erfindet ein „Vorher“; Verlauf eines Orts und globale Liste sagen
 * Verschiedenes zur selben Operation; ein Tester liest die Liste oder sieht eine Personenkennung.
 */

// TypeBox kennt `date-time` nicht von selbst; ohne Eintrag prüft `Value.Check` jeden Zeitstempel als falsch.
FormatRegistry.Set("date-time", (wert) => !Number.isNaN(Date.parse(wert)));

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
/** Kennungen dieses Tests: dasselbe Präfix, damit das Aufräumen nur sie trifft. */
const op = (n: number): string => `b2650265-0000-4000-9000-${String(n).padStart(12, "0")}`;
const ort = (n: number): string => `b2650265-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GEBIRGE = (n: number): string => `b2650265-0000-4000-8100-${String(n).padStart(12, "0")}`;
const TEIL = (n: number): string => `b2650265-0000-4000-8200-${String(n).padStart(12, "0")}`;
const GEISTER = "b2650265-0000-4000-a000-0000000000f0";

describeWithDatabase("„Änderungen“ lesen: Zustand, Filter, Serien, Detail (WI-0265 B2a)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    let anna: MapActor;
    let bernd: MapActor;
    let annaId: string;
    let berndId: string;
    const cookies = new Map<Role, string>();

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    };

    async function aufraeumen(): Promise<void> {
        // 🪤 Alle Operationen der Testdatenbank, nicht nur die eigenen (`b2650265-…`): Die Fälle zählen Seiten und Filtertreffer über die GANZE Historie, und andere
        // Testdateien (Titel ohne Auszeichnung, Rücknahme von Werken, …) lassen ihre Operationen stehen. Die Dateien laufen nacheinander (Sperre je Datei), die Datenbank ist
        // eine Testdatenbank; so hängt der Lauf nicht von der Reihenfolge davor ab.
        await database`UPDATE wikisync_uebernahme SET zurueckgenommen_am = NULL, zurueckgenommen_durch = NULL WHERE operation_id IS NOT NULL`;
        await database`DELETE FROM wikisync_uebernahme WHERE art = 'zuruecknahme' AND operation_id IS NOT NULL`;
        await database`DELETE FROM wikisync_uebernahme WHERE operation_id IS NOT NULL`;
        await database`DELETE FROM map_audit_event`;
        // Die Verknüpfungen gehen mit ihren Operationen (ON DELETE CASCADE, Migration 0262).
        await database`DELETE FROM map_operation`;
    }

    /** Eine Operation über die echte Schreibnaht (mit Verknüpfung bei `reverts`); `minute` setzt die Zeit (der Test läuft als Besitzer). */
    async function schreibe(
        n: number,
        akteur: MapActor,
        eintrag: MapAuditEntry,
        optionen: {
            minute?: number;
            operation?: string;
            source?: "editor" | "restore";
            reverts?: readonly string[];
        } = {},
    ): Promise<void> {
        await mapOperation(
            database,
            akteur,
            {
                operationId: op(n),
                operation: optionen.operation ?? "place.update",
                mapDomainId: "aventuria",
                body: { n },
                ...(optionen.source === undefined ? {} : { source: optionen.source }),
                ...(optionen.reverts === undefined ? {} : { reverts: optionen.reverts }),
            },
            async () => ({
                receipt: { affected: [], derivedWork: [], warnings: [] },
                summary: `Operation ${String(n)}`,
                entries: [eintrag],
            }),
        );
        if (optionen.minute !== undefined)
            await database`UPDATE map_operation SET at = ${new Date(T0 + optionen.minute * MIN)} WHERE operation_id = ${op(n)}::uuid`;
    }

    /** Eine Änderung am Ort. */
    const amOrt = (id: string): MapAuditEntry => ({
        action: "place.updated",
        placeId: id,
        revisionBefore: 1,
        revisionAfter: 2,
        changes: { name: { before: "alt", after: "neu" } },
    });
    /** Eine Änderung am Gebirge (Teilfläche samt Fläche, wie der Schreibweg es nennt). */
    const amGebirge = (gebirge: string, teil: string, wert = 1): MapAuditEntry => ({
        action: "area.updated",
        regionId: gebirge,
        areaId: teil,
        revisionBefore: wert,
        revisionAfter: wert + 1,
        changes: { gebirge: { before: { hoehe: wert }, after: { hoehe: wert + 1 } } },
    });

    /** Eine Operation ohne die Schreibnaht (Altbestand, Import, WikiSync): Quelle und Akteur frei. */
    async function roh(
        n: number,
        optionen: { source: string; personId?: string | null; action?: string; minute?: number; placeId?: string },
    ): Promise<void> {
        const person = optionen.personId ?? null;
        await database`
            INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, environment, actor_kind,
                                       actor_person_id, actor_label, at)
            VALUES (${op(n)}::uuid, 'aventuria', decode(repeat('ab', 32), 'hex'),
                    jsonb_build_object('operationId', ${op(n)}::text, 'status', 'applied'), ${optionen.action ?? "place.update"},
                    ${optionen.source}, 'test', ${person === null ? "system" : "person"}, ${person}::uuid,
                    ${person === null ? "test" : null}, ${new Date(T0 + (optionen.minute ?? n) * MIN)})
        `;
        if (optionen.placeId !== undefined)
            await database`
                INSERT INTO map_audit_event (operation_id, action, place_public_id, revision_before, revision_after, changes)
                VALUES (${op(n)}::uuid, 'place.updated', ${optionen.placeId}::uuid, 1, 2, '{"name":{"before":"a","after":"b"}}'::jsonb)
            `;
    }

    const lese = (optionen: Partial<Parameters<typeof mapChanges>[1]> = {}, personId = annaId): Promise<Seite> =>
        mapChanges(database, { mapDomainId: "aventuria", personId, ...optionen });

    const ids = (seite: Seite): string[] => seite.entries.map((e) => e.operationId);
    const eintrag = (seite: Seite, n: number): Eintrag => {
        const e = seite.entries.find((x) => x.operationId === op(n));
        if (e === undefined) throw new Error(`Operation ${String(n)} fehlt in der Antwort`);
        return e;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        const a = await fixture.person("editor", { name: "Anna Änderung" });
        const b = await fixture.person("editor", { name: "Bernd Änderung" });
        annaId = a.id;
        berndId = b.id;
        anna = { kind: "person", personId: a.id, environment: "test" };
        bernd = { kind: "person", personId: b.id, environment: "test" };
        for (const role of ["tester", "reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `Lese ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 180_000);

    beforeEach(aufraeumen);

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("U1: lange Historie, Cursor und Filter", () => {
        async function viele(): Promise<{ anna: number[]; bernd: number[] }> {
            // 300 Operationen im Minutentakt, jede an einem eigenen Ort (also keine Serie); jede achte von Bernd.
            await database`
                INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, environment, actor_kind,
                                           actor_person_id, at)
                SELECT o.id, 'aventuria', decode(repeat('ab', 32), 'hex'), jsonb_build_object('operationId', o.id::text, 'status', 'applied'),
                       'place.update', 'editor', 'test', 'person', CASE WHEN o.n % 8 = 0 THEN ${berndId}::uuid ELSE ${annaId}::uuid END,
                       ${new Date(T0)}::timestamptz + o.n * interval '1 minute'
                  FROM (SELECT n, ('b2650265-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid AS id FROM generate_series(1, 300) n ORDER BY n) o
                 ORDER BY o.n
            `;
            await database`
                INSERT INTO map_audit_event (operation_id, action, place_public_id, revision_before, revision_after, changes)
                SELECT ('b2650265-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, 'place.updated',
                       ('b2650265-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 1, 2, '{"name":{"before":"a","after":"b"}}'::jsonb
                  FROM generate_series(1, 300) n
            `;
            const alle = Array.from({ length: 300 }, (_, i) => i + 1);
            return { anna: alle.filter((n) => n % 8 !== 0), bernd: alle.filter((n) => n % 8 === 0) };
        }

        async function alleSeiten(optionen: Partial<Parameters<typeof mapChanges>[1]>): Promise<Seite[]> {
            const seiten: Seite[] = [];
            let before: number | undefined;
            do {
                const seite = await lese({ ...optionen, ...(before === undefined ? {} : { before }) });
                seiten.push(seite);
                before = seite.next;
            } while (before !== undefined && seiten.length < 20);
            return seiten;
        }

        it("🔴 U1: 300 Operationen, „Alle“ in Seiten zu 120: neueste zuerst, ohne Lücke und ohne Dublette, der Cursor ist die kleinste gelieferte seq", async () => {
            const { anna: von } = await viele();
            const seiten = await alleSeiten({ limit: 120 });
            expect(seiten.map((s) => s.entries.length)).toEqual([120, 120, 60]);
            const alle = seiten.flatMap(ids);
            expect(alle).toEqual(Array.from({ length: 300 }, (_, i) => op(300 - i)));
            expect(new Set(alle).size).toBe(300);
            expect(seiten[0]!.next).toBe(seiten[0]!.entries.at(-1)!.seq);
            expect(seiten[2]!.next).toBeUndefined();
            // Keine Serie entsteht: jede Operation hat ihren eigenen Ort.
            expect(seiten.every((s) => s.series === undefined)).toBe(true);
            expect(von.length).toBe(263);
        });

        it("🔴 U1: „Meine“ und der Personenfilter sind dieselbe Menge; Zeitraum, Art, Zustand und Suche kombinieren sich", async () => {
            const { anna: ihre, bernd: seine } = await viele();
            const meine = (await alleSeiten({ mine: true, limit: 100 })).flatMap(ids);
            expect(meine).toEqual([...ihre].reverse().map(op));
            const person = (await alleSeiten({ person: annaId, limit: 100 })).flatMap(ids);
            expect(person).toEqual(meine);
            // Bernd über Annas Sitzung: „Meine“ UND Bernd sind leer; Bernd allein trifft seine.
            expect((await lese({ mine: true, person: berndId })).entries).toEqual([]);
            expect((await alleSeiten({ person: berndId })).flatMap(ids)).toEqual([...seine].reverse().map(op));
            // Zeitraum mit Zeitzone: from einschließlich, to ausschließlich (Operation n liegt n Minuten nach T0 = 12:00 UTC = 14:00 MESZ).
            const von = "2026-10-01T14:10:00+02:00";
            const bis = "2026-10-01T12:20:00Z";
            const zeitraum = (await alleSeiten({ person: annaId, from: von, to: bis })).flatMap(ids);
            expect(zeitraum).toEqual(
                ihre
                    .filter((n) => n >= 10 && n < 20)
                    .reverse()
                    .map(op),
            );
            // Alles zusammen: Person, Zeitraum, Art, Zustand und Suche (der Feldname `name` trifft jede).
            const kombiniert = await lese({
                person: annaId,
                from: von,
                to: bis,
                kind: "place",
                status: "ruecknehmbar",
                q: "nam",
            });
            expect(ids(kombiniert)).toEqual(zeitraum);
            // Eine andere Art trifft nichts; ein Gegenstand trifft genau seine Operation.
            expect((await lese({ person: annaId, kind: "path" })).entries).toEqual([]);
            expect(ids(await lese({ object: `place:${ort(17)}` }))).toEqual([op(17)]);
            expect(ids(await lese({ object: `place:${ort(17)}`, person: berndId }))).toEqual([]);
        });

        it("der Sammelwert „gelöscht“ trifft nur Personen, deren Konto es nicht mehr gibt; Name fehlt, Kennung bleibt", async () => {
            await viele();
            await roh(1001, { source: "editor", personId: GEISTER, placeId: ort(1001) });
            const geloescht = await lese({ person: "geloescht" });
            expect(ids(geloescht)).toEqual([op(1001)]);
            expect(geloescht.entries[0]!.actor).toEqual({ kind: "person", id: GEISTER });
            // Die Personen mit Konto tragen Name UND Kennung (nur diese Routen setzen `use_editor_menu` voraus).
            const eigene = await lese({ person: annaId, limit: 1 });
            expect(eigene.entries[0]!.actor).toEqual({ kind: "person", id: annaId, name: "Anna Änderung", self: true });
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Zustand und Rücknahme-Bezug (Fachvertrag A.3, C.4; U15)", () => {
        it("🔴 ein Original mit geltender Rücknahme: bereits_zurueckgenommen mit revertedBy; die Rücknahme trägt reverts und gilt selbst als rücknehmbar", async () => {
            await schreibe(1, anna, amOrt(ort(1)), { minute: 0 });
            await schreibe(2, bernd, amOrt(ort(1)), {
                minute: 5,
                source: "restore",
                operation: "place.update",
                reverts: [op(1)],
            });
            const seite = await lese();
            const original = eintrag(seite, 1);
            expect(original.status).toBe("bereits_zurueckgenommen");
            expect(original.revertedBy).toEqual({
                operationId: op(2),
                at: new Date(T0 + 5 * MIN).toISOString(),
                actor: { kind: "person", id: berndId, name: "Bernd Änderung" },
            });
            const ruecknahme = eintrag(seite, 2);
            expect(ruecknahme.source).toBe("restore");
            expect(ruecknahme.reverts).toEqual([op(1)]);
            expect(ruecknahme.status).toBe("ruecknehmbar");
            expect(ruecknahme.revertedBy).toBeUndefined();
        });

        it("🔴 der Grund einer Rücknahme steht am Eintrag (`reason`) und am Original (`revertedBy.reason`), in der Liste, im Detail und im Verlauf; ohne Grund fehlt das Feld", async () => {
            await schreibe(1, anna, amOrt(ort(8)), { minute: 0 });
            await schreibe(
                2,
                bernd,
                {
                    ...amOrt(ort(8)),
                    changes: {
                        name: { before: "neu", after: "alt" },
                        restoreReason: { after: "Falscher Ort bearbeitet" },
                    },
                },
                { minute: 5, source: "restore", operation: "place.restore_series", reverts: [op(1)] },
            );
            await schreibe(3, anna, amOrt(ort(8)), { minute: 6 });
            await schreibe(4, anna, amOrt(ort(8)), { minute: 7, source: "restore", reverts: [op(3)] });
            const seite = await lese();
            expect(eintrag(seite, 2).reason).toBe("Falscher Ort bearbeitet");
            expect(eintrag(seite, 1).revertedBy).toEqual({
                operationId: op(2),
                at: new Date(T0 + 5 * MIN).toISOString(),
                actor: { kind: "person", id: berndId, name: "Bernd Änderung" },
                reason: "Falscher Ort bearbeitet",
            });
            // Eine Rücknahme ohne Grund (eigene Änderung) und ein Original ohne Rücknahme tragen das Feld nicht.
            expect(eintrag(seite, 4).reason).toBeUndefined();
            expect(eintrag(seite, 3).revertedBy).not.toHaveProperty("reason");
            expect(eintrag(seite, 1).reason).toBeUndefined();
            const detail = await mapChange(database, op(2), { mapDomainId: "aventuria", personId: annaId });
            expect(detail?.reason).toBe("Falscher Ort bearbeitet");
            const verlauf = await placeHistory(database, ort(8), { personId: annaId });
            expect(verlauf.entries.find((e) => e.operationId === op(2))?.reason).toBe("Falscher Ort bearbeitet");
            expect(verlauf.entries.find((e) => e.operationId === op(1))?.revertedBy?.reason).toBe(
                "Falscher Ort bearbeitet",
            );
        });

        it("🔴 Rücknahme einer Rücknahme: die erste gilt nicht mehr, das Original ist wieder rücknehmbar (Link restore → restore)", async () => {
            await schreibe(1, anna, amOrt(ort(2)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(2)), { minute: 1, source: "restore", reverts: [op(1)] });
            await schreibe(3, bernd, amOrt(ort(2)), { minute: 2, source: "restore", reverts: [op(2)] });
            const seite = await lese();
            expect(eintrag(seite, 3)).toMatchObject({ status: "ruecknehmbar", reverts: [op(2)] });
            expect(eintrag(seite, 2)).toMatchObject({ status: "bereits_zurueckgenommen", reverts: [op(1)] });
            expect(eintrag(seite, 2).revertedBy?.operationId).toBe(op(3));
            expect(eintrag(seite, 1).status).toBe("ruecknehmbar");
            expect(eintrag(seite, 1).revertedBy).toBeUndefined();
            // Eine dritte Stufe: die Rücknahme der Rücknahme der Rücknahme hebt die zweite auf.
            await schreibe(4, anna, amOrt(ort(2)), { minute: 3, source: "restore", reverts: [op(3)] });
            const tiefer = await lese();
            expect(eintrag(tiefer, 3).status).toBe("bereits_zurueckgenommen");
            expect(eintrag(tiefer, 2).status).toBe("ruecknehmbar");
            expect(eintrag(tiefer, 1).status).toBe("bereits_zurueckgenommen");
            expect(eintrag(tiefer, 1).revertedBy?.operationId).toBe(op(2));
        });

        it("🔴 eine Rücknahme mehrerer Originale (Serie): jedes ist zurückgenommen, die Reihenfolge der Anfrage bleibt", async () => {
            for (const n of [1, 2, 3]) await schreibe(n, anna, amOrt(ort(3)), { minute: n });
            await schreibe(4, anna, amOrt(ort(3)), { minute: 10, source: "restore", reverts: [op(3), op(1), op(2)] });
            const seite = await lese();
            expect(eintrag(seite, 4).reverts).toEqual([op(3), op(1), op(2)]);
            for (const n of [1, 2, 3]) expect([n, eintrag(seite, n).revertedBy?.operationId]).toEqual([n, op(4)]);
        });

        it("🔴 ältere Etikett-Rücknahme ohne Verknüpfung: kein reverts, kein Backfill nach Vermutung; das Original gilt als rücknehmbar", async () => {
            await schreibe(1, anna, amOrt(ort(4)), { minute: 0 });
            await roh(2, { source: "restore", personId: annaId, minute: 1, placeId: ort(4) });
            const seite = await lese();
            expect(eintrag(seite, 2).reverts).toBeUndefined();
            expect(eintrag(seite, 2).status).toBe("ruecknehmbar");
            expect(eintrag(seite, 1).status).toBe("ruecknehmbar");
            expect(eintrag(seite, 1).revertedBy).toBeUndefined();
        });

        it("Import und Zurücksetzen der Testwelt sind nicht rücknehmbar (Grund Quelle); der WikiSync seit WI-0265 B8d/B8e anders (eigene Rücknahme, sonst Art)", async () => {
            await roh(1, { source: "import", placeId: ort(5) });
            await roh(2, { source: "testwelt_reset", placeId: ort(5) });
            await roh(3, { source: "wikisync", action: "wikisync.uebernehmen", placeId: ort(5) });
            await roh(4, { source: "wikisync", action: "wikisync.objekt_sync", placeId: ort(5) });
            await roh(5, { source: "wikisync", action: "wikisync.region_zuweisen", placeId: ort(5) });
            // Der Sync eines Objekts mit Vorher und Nachher im Fachprotokoll (die Aktion des Schreibers) lässt sich zurücknehmen; ohne dieses Protokoll bleibt er ehrlich ohne ↺.
            await roh(6, { source: "wikisync", action: "wikisync.objekt_sync" });
            await database`
                INSERT INTO map_audit_event (operation_id, action, place_public_id, revision_before, revision_after, changes)
                VALUES (${op(6)}::uuid, 'place.wikisync_uebernommen', ${ort(5)}::uuid, 1, 2, '{"name":{"before":"a","after":"b"}}'::jsonb)
            `;
            const seite = await lese();
            for (const n of [1, 2])
                expect(eintrag(seite, n)).toMatchObject({ status: "nicht_ruecknehmbar", statusReason: "quelle" });
            // Eine Übernahme des WikiSync hat die Rücknahme des WikiSync (hier noch ohne Protokoll der Übernahme: rücknehmbar, die Vorprüfung sagt, was geht), ebenso der Sync eines Objekts (B8e,
            // Link-Tafel); alles andere, was er schreibt, ist Art.
            expect(eintrag(seite, 3).status).toBe("ruecknehmbar");
            expect(eintrag(seite, 4)).toMatchObject({ status: "nicht_ruecknehmbar", statusReason: "art" });
            expect(eintrag(seite, 5)).toMatchObject({ status: "nicht_ruecknehmbar", statusReason: "art" });
            expect(eintrag(seite, 6).status).toBe("ruecknehmbar");
        });

        it("🔴 Filter nach Zustand: genau, auch bei einer Rücknahme einer Rücknahme", async () => {
            await schreibe(1, anna, amOrt(ort(6)), { minute: 0 }); // wieder rücknehmbar (R2 wurde zurückgenommen)
            await schreibe(2, anna, amOrt(ort(6)), { minute: 1, source: "restore", reverts: [op(1)] }); // zurückgenommen durch R3
            await schreibe(3, anna, amOrt(ort(6)), { minute: 2, source: "restore", reverts: [op(2)] });
            await schreibe(4, anna, amOrt(ort(7)), { minute: 3 }); // zurückgenommen durch R5
            await schreibe(5, anna, amOrt(ort(7)), { minute: 4, source: "restore", reverts: [op(4)] });
            await roh(6, { source: "import", placeId: ort(8) });
            expect(ids(await lese({ status: "bereits_zurueckgenommen" }))).toEqual([op(4), op(2)]);
            expect(ids(await lese({ status: "ruecknehmbar" }))).toEqual([op(5), op(3), op(1)]);
            expect(ids(await lese({ status: "nicht_ruecknehmbar" }))).toEqual([op(6)]);
            // Mit Seitengröße 1 trotzdem vollständig, ohne Lücke (die genaue Prüfung liest stapelweise).
            const einzeln: string[] = [];
            let before: number | undefined;
            do {
                const seite = await lese({
                    status: "ruecknehmbar",
                    limit: 1,
                    ...(before === undefined ? {} : { before }),
                });
                einzeln.push(...ids(seite));
                before = seite.next;
            } while (before !== undefined);
            expect(einzeln).toEqual([op(5), op(3), op(1)]);
        });

        it("🔴 WikiSync bleibt getrennt: Übernahme und Rücknahme verweisen über sein Protokoll, nie über die Link-Tafel; die Übernahme ist bereits zurückgenommen, die Rücknahme rücknehmbar (B8e)", async () => {
            await roh(1, { source: "wikisync", action: "wikisync.uebernehmen", placeId: ort(9) });
            await roh(2, { source: "wikisync", action: "wikisync.zuruecknehmen", placeId: ort(9) });
            const [uebernahme] = await database<{ id: string }[]>`
                INSERT INTO wikisync_uebernahme (art, bereich, lauf_id, status, beendet_am, operation_id)
                VALUES ('uebernahme', 'ort', 1, 'fertig', now(), ${op(1)}::uuid) RETURNING id::text
            `;
            const [rueck] = await database<{ id: string }[]>`
                INSERT INTO wikisync_uebernahme (art, bereich, lauf_id, status, beendet_am, operation_id, zurueck_von)
                VALUES ('zuruecknahme', 'ort', 1, 'fertig', now(), ${op(2)}::uuid, ${uebernahme!.id}::bigint) RETURNING id::text
            `;
            await database`
                UPDATE wikisync_uebernahme SET zurueckgenommen_am = now(), zurueckgenommen_durch = ${rueck!.id}::bigint
                 WHERE id = ${uebernahme!.id}::bigint
            `;
            const seite = await lese();
            expect(eintrag(seite, 1)).toMatchObject({ status: "bereits_zurueckgenommen" });
            expect(eintrag(seite, 1).statusReason).toBeUndefined();
            expect(eintrag(seite, 1).revertedBy?.operationId).toBe(op(2));
            expect(eintrag(seite, 2)).toMatchObject({ status: "ruecknehmbar", reverts: [op(1)] });
            expect(eintrag(seite, 2).statusReason).toBeUndefined();
            expect(ids(await lese({ status: "bereits_zurueckgenommen" }))).toEqual([op(1)]);
            expect(ids(await lese({ status: "ruecknehmbar" }))).toContain(op(2));
            const links = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM map_operation_revert_link
                 WHERE restore_operation_id::text LIKE 'b2650265-%' OR reverted_operation_id::text LIKE 'b2650265-%'
            `;
            expect(links[0]!.n).toBe(0);
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("B6f: Arten, die keine Familie zurücknimmt, sind nicht rücknehmbar (Grund art)", () => {
        const QUELLE = (n: number): string => `b2650265-0000-4000-8300-${String(n).padStart(12, "0")}`;
        /** Eine Änderung an einer Katalogquelle (Inhalte-Stammdaten, `inhalteOperation`). */
        const anQuelle = (id: string, titel = "neu", action: `source.${string}` = "source.updated"): MapAuditEntry => ({
            action,
            sourceId: id,
            revisionBefore: 1,
            revisionAfter: 2,
            changes: { title: { before: "alt", after: titel } },
        });
        const leser = (): RuecknahmeLeser => ({ personId: annaId, rechte: new Set<Capability>(["edit_map_objects"]) });
        /** Der Name einer Operation, die kein Adapter führt (das Anlegen von Quelle, Werk, Korpus und Vorkommen ist seit WI-0265 B8d rücknehmbar). */
        const OHNE_ADAPTER = "source.archivieren";

        it("🔴 eine Inhalte-Operation, die kein Adapter zurücknimmt, ist nicht_ruecknehmbar mit Grund art; eine Feldänderung am Ort bleibt rücknehmbar", async () => {
            await schreibe(1, anna, anQuelle(QUELLE(1), "neu"), {
                minute: 0,
                operation: OHNE_ADAPTER,
            });
            await schreibe(2, anna, amOrt(ort(20)), { minute: 1 });
            const seite = await lese();
            expect(eintrag(seite, 1)).toMatchObject({ status: "nicht_ruecknehmbar", statusReason: "art" });
            expect(eintrag(seite, 2).status).toBe("ruecknehmbar");
            expect(eintrag(seite, 2).statusReason).toBeUndefined();
            // Die Antwort bleibt gültig im Schema der Liste (der Grund ist ein Literal der Tafel).
            expect(Value.Check(MapHistoryPage, seite)).toBe(true);
        });

        it("🔴 B8d: das Anlegen jeder Art der Inhalte (Quelle, Werk, Korpus, Vorkommen) ist rücknehmbar", async () => {
            const arten: [string, MapAuditEntry][] = [
                ["source.create", anQuelle(QUELLE(2), "neu", "source.created")],
                ["work.create", { action: "work.created", workId: QUELLE(3), changes: { title: { after: "b" } } }],
                ["lore.create", { action: "lore.created", loreId: QUELLE(4), changes: { name: { after: "b" } } }],
                [
                    "corpus.create",
                    { action: "corpus.created", corpusId: QUELLE(5), changes: { label: { after: "b" } } },
                ],
            ];
            for (const [i, [operation, daten]] of arten.entries())
                await schreibe(i + 1, anna, daten, { minute: i, operation });
            const seite = await lese();
            for (const [i, [operation]] of arten.entries())
                expect([operation, eintrag(seite, i + 1).status, eintrag(seite, i + 1).statusReason]).toEqual([
                    operation,
                    "ruecknehmbar",
                    undefined,
                ]);
        });

        it("🔴 B6g1 und B6g2: Quelle, Werk, Korpus und Vorkommen sind rücknehmbar (Namensebene des Katalogs); zwei Änderungen derselben Quelle bilden eine Serie, beide rücknehmbar (Fachvertrag B.2)", async () => {
            await schreibe(1, anna, anQuelle(QUELLE(6), "eins"), { minute: 0, operation: "source.update" });
            await schreibe(2, anna, anQuelle(QUELLE(6), "zwei"), { minute: 1, operation: "source.update" });
            await schreibe(
                3,
                anna,
                { action: "work.updated", workId: QUELLE(3), changes: { title: { before: "a", after: "b" } } },
                { minute: 2, operation: "work.update" },
            );
            await schreibe(
                4,
                anna,
                { action: "corpus.updated", corpusId: QUELLE(5), changes: { label: { before: "a", after: "b" } } },
                { minute: 3, operation: "corpus.update" },
            );
            await schreibe(
                5,
                anna,
                { action: "lore.updated", loreId: QUELLE(4), changes: { name: { before: "a", after: "b" } } },
                { minute: 4, operation: "lore.update" },
            );
            await schreibe(
                6,
                anna,
                { action: "lore.rules_text", loreId: QUELLE(8), changes: { rules: { before: [], after: [] } } },
                { minute: 5, operation: "lore.rules_text" },
            );
            // B6g3: die Quellen eines Orts (`traeger.sources`) sind rücknehmbar und teilen die Serie des Orts.
            await schreibe(7, anna, amOrt(ort(21)), { minute: 6 });
            await schreibe(
                8,
                anna,
                { ...amOrt(ort(21)), action: "place.sources_changed", changes: { quellen: { before: [], after: [] } } },
                { minute: 7, operation: "traeger.sources" },
            );
            const seite = await lese();
            expect(eintrag(seite, 1).series).toMatchObject({ position: 1, size: 2 });
            expect(eintrag(seite, 2).series).toMatchObject({ position: 2, size: 2 });
            expect(eintrag(seite, 7).series).toMatchObject({ position: 1, size: 2 });
            expect(eintrag(seite, 8).series).toMatchObject({ position: 2, size: 2 });
            for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
                expect(eintrag(seite, n).status).toBe("ruecknehmbar");
                expect(eintrag(seite, n).statusReason).toBeUndefined();
            }
        });

        it("🔴 Quelle geht vor Art: Ein Import einer Quelle bleibt nicht_ruecknehmbar mit Grund quelle", async () => {
            await roh(1, { source: "import", action: "source.update", placeId: ort(24) });
            expect(eintrag(await lese(), 1)).toMatchObject({ status: "nicht_ruecknehmbar", statusReason: "quelle" });
        });

        it("🔴 Filter nach Zustand in beide Richtungen: ruecknehmbar schließt die Art aus, nicht_ruecknehmbar nimmt Art und Quelle auf", async () => {
            await schreibe(1, anna, amOrt(ort(25)), { minute: 0 }); // rücknehmbar
            await schreibe(2, anna, anQuelle(QUELLE(7), "neu"), {
                minute: 1,
                operation: OHNE_ADAPTER,
            }); // Art
            await schreibe(
                3,
                anna,
                { action: "work.updated", workId: QUELLE(10), changes: { title: { after: "b" } } },
                { minute: 2, operation: "work.archivieren" },
            ); // Art
            await roh(4, { source: "import", placeId: ort(27) }); // Quelle
            await schreibe(5, anna, amOrt(ort(28)), { minute: 4 }); // rücknehmbar
            expect(ids(await lese({ status: "ruecknehmbar" }))).toEqual([op(5), op(1)]);
            expect(ids(await lese({ status: "nicht_ruecknehmbar" }))).toEqual([op(4), op(3), op(2)]);
            expect(ids(await lese({ status: "bereits_zurueckgenommen" }))).toEqual([]);
            // Seitenweise (Seitengröße 1) ohne Lücke und ohne Dublette, in beide Richtungen.
            for (const [status, erwartet] of [
                ["ruecknehmbar", [op(5), op(1)]],
                ["nicht_ruecknehmbar", [op(4), op(3), op(2)]],
            ] as const) {
                const einzeln: string[] = [];
                let before: number | undefined;
                do {
                    const teil = await lese({ status, limit: 1, ...(before === undefined ? {} : { before }) });
                    einzeln.push(...ids(teil));
                    before = teil.next;
                } while (before !== undefined);
                expect([status, einzeln]).toEqual([status, erwartet]);
            }
        });

        it("🔴 Art-Operation mit geltender Rücknahme (Altbestand) bleibt bereits_zurueckgenommen; der Filter folgt dem Zustand der Einträge", async () => {
            // Die Link-Tafel kennt nur Operationen, die ein Adapter annahm; ein Eintrag auf eine Art-Operation kommt höchstens aus Altbestand. Er geht der Art vor.
            await schreibe(1, anna, anQuelle(QUELLE(8), "neu"), {
                minute: 0,
                operation: OHNE_ADAPTER,
            });
            await schreibe(2, anna, amOrt(ort(29)), { minute: 1, source: "restore", reverts: [op(1)] });
            const seite = await lese();
            expect(eintrag(seite, 1)).toMatchObject({ status: "bereits_zurueckgenommen" });
            expect(eintrag(seite, 1).statusReason).toBeUndefined();
            expect(ids(await lese({ status: "bereits_zurueckgenommen" }))).toEqual([op(1)]);
            expect(ids(await lese({ status: "nicht_ruecknehmbar" }))).toEqual([]);
            expect(ids(await lese({ status: "ruecknehmbar" }))).toEqual([op(2)]);
        });

        it("🔴 Vorprüfung: Ein Mitglied mit Grund art bekommt ausschluss art und das Ergebnis not_revertable (nie ok)", async () => {
            await schreibe(1, anna, anQuelle(QUELLE(9), "neu"), {
                minute: 0,
                operation: OHNE_ADAPTER,
            });
            const vor = await vorpruefen(
                database,
                { mapDomainId: "aventuria", mitglieder: [op(1)] },
                leser(),
                ORT_ADAPTER,
            );
            expect(vor.ergebnis).toBe("not_revertable");
            expect(vor.mitglieder[0]).toMatchObject({
                status: "nicht_ruecknehmbar",
                statusReason: "art",
                offen: false,
                ausschluss: { grund: "art" },
            });
            expect(vor.offen).toEqual([]);
        });

        it("🔴 Grenzfall nutzlastabhängig: place.update mit einer fremden Aktion (hier place.restored) bleibt rücknehmbar in der Liste, die Vorprüfung lehnt sie mit art ab", async () => {
            await schreibe(
                1,
                anna,
                { ...amOrt(ort(30)), action: "place.restored" },
                { minute: 0, operation: "place.update" },
            );
            expect(eintrag(await lese(), 1).status).toBe("ruecknehmbar");
            const vor = await vorpruefen(
                database,
                { mapDomainId: "aventuria", mitglieder: [op(1)] },
                leser(),
                ORT_ADAPTER,
            );
            expect(vor.ergebnis).toBe("not_revertable");
            expect(vor.mitglieder[0]).toMatchObject({ status: "ruecknehmbar", ausschluss: { grund: "art" } });
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Arbeitsserien beim Lesen (Fachvertrag B; U2, U14)", () => {
        const teil = TEIL(1);

        it("🔴 8× „Fertig“ am Gebirge: EINE Serie mit acht Einträgen, Kennung = ältestes Mitglied, jedes Mitglied einzeln adressierbar", async () => {
            const minuten = [0, 3, 5, 12, 14, 20, 29, 31];
            for (const [i, m] of minuten.entries())
                await schreibe(i + 1, anna, amGebirge(GEBIRGE(1), teil, i + 1), {
                    minute: m,
                    operation: "landscape.update",
                });
            const seite = await lese();
            expect(seite.entries).toHaveLength(8);
            for (let n = 1; n <= 8; n += 1)
                expect([n, eintrag(seite, n).series]).toEqual([n, { id: op(1), position: n, size: 8 }]);
            const alleIds = Array.from({ length: 8 }, (_, i) => op(i + 1));
            expect(seite.series).toEqual([
                {
                    id: op(1),
                    size: 8,
                    delivered: 8,
                    members: alleIds,
                    membersHash: mitgliederHash(alleIds),
                    scope: { kind: "landscape", id: GEBIRGE(1) },
                },
            ]);
            // Die Liste sagt, WAS sich änderte (Feldname), und trägt das Netz nicht; das Detail trägt es.
            expect(eintrag(seite, 1).objects[0]!.changes["gebirge"]).toEqual({ omitted: true });
            const detail = await mapChange(database, op(1), { mapDomainId: "aventuria", personId: annaId });
            expect(detail?.objects[0]!.changes["gebirge"]).toEqual({ before: { hoehe: 1 }, after: { hoehe: 2 } });
        });

        it("🔴 eine Operation derselben Person an einem ANDEREN Gegenstand beendet die Serie nicht; eine fremde am selben schon", async () => {
            await schreibe(1, anna, amOrt(ort(10)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(11)), { minute: 1 });
            await schreibe(3, anna, amOrt(ort(10)), { minute: 2 });
            await schreibe(4, bernd, amOrt(ort(10)), { minute: 3 });
            await schreibe(5, anna, amOrt(ort(10)), { minute: 4 });
            await schreibe(6, anna, amOrt(ort(10)), { minute: 5 });
            const seite = await lese();
            expect(eintrag(seite, 1).series).toEqual({ id: op(1), position: 1, size: 2 });
            expect(eintrag(seite, 3).series).toEqual({ id: op(1), position: 2, size: 2 });
            expect(eintrag(seite, 2).series).toBeUndefined();
            expect(eintrag(seite, 4).series).toBeUndefined();
            expect(eintrag(seite, 5).series).toEqual({ id: op(5), position: 1, size: 2 });
            expect(eintrag(seite, 6).series).toEqual({ id: op(5), position: 2, size: 2 });
            expect(seite.series?.map((s) => s.id).sort()).toEqual([op(1), op(5)].sort());
        });

        it("eine Rücknahme am Gegenstand beendet die Serie; die spätere „Fertig“ beginnen eine neue", async () => {
            await schreibe(1, anna, amOrt(ort(12)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(12)), { minute: 1 });
            await schreibe(3, anna, amOrt(ort(12)), { minute: 2, source: "restore", reverts: [op(1), op(2)] });
            await schreibe(4, anna, amOrt(ort(12)), { minute: 3 });
            await schreibe(5, anna, amOrt(ort(12)), { minute: 4 });
            const seite = await lese();
            expect(eintrag(seite, 2).series).toEqual({ id: op(1), position: 2, size: 2 });
            expect(eintrag(seite, 3).series).toBeUndefined();
            expect(eintrag(seite, 5).series).toEqual({ id: op(4), position: 2, size: 2 });
        });

        it("🔴 ein Import mit vielen Einträgen am Gegenstand beendet die Serie (er berührt ihn), ist nie Mitglied und wird nicht zum Mitglied gelesen", async () => {
            await schreibe(1, anna, amOrt(ort(14)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(14)), { minute: 1 });
            await roh(3, { source: "import", minute: 2, placeId: ort(14) });
            await database`
                INSERT INTO map_audit_event (operation_id, action, place_public_id, revision_before, revision_after, changes)
                SELECT ${op(3)}::uuid, 'place.updated', ('b2650265-0000-4000-8000-' || lpad((5000 + n)::text, 12, '0'))::uuid, 1, 2, '{}'::jsonb
                  FROM generate_series(1, 300) n
            `;
            await schreibe(4, anna, amOrt(ort(14)), { minute: 3 });
            await schreibe(5, anna, amOrt(ort(14)), { minute: 4 });
            const seite = await lese();
            expect(eintrag(seite, 1).series).toEqual({ id: op(1), position: 1, size: 2 });
            expect(eintrag(seite, 3).series).toBeUndefined();
            expect(eintrag(seite, 4).series).toEqual({ id: op(4), position: 1, size: 2 });
            expect(eintrag(seite, 5).series).toEqual({ id: op(4), position: 2, size: 2 });
            // Die 300 anderen Orte des Imports sind nicht angefasst: ihre Geschichte ist nur der Import.
            expect(
                ids(await lese({ object: `place:b2650265-0000-4000-8000-${String(5001).padStart(12, "0")}` })),
            ).toEqual([op(3)]);
        });

        it("ein Ort, der mit seinen Wegenden verschoben wurde (Mehr-Gegenstand-Eintrag), beendet die Ortsserie und ist kein Mitglied", async () => {
            await schreibe(1, anna, amOrt(ort(13)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(13)), { minute: 1 });
            await mapOperation(
                database,
                anna,
                { operationId: op(3), operation: "place.move", mapDomainId: "aventuria", body: { n: 3 } },
                async () => ({
                    receipt: { affected: [], derivedWork: [], warnings: [] },
                    summary: "verschoben",
                    entries: [
                        { action: "place.moved", placeId: ort(13), revisionBefore: 2, revisionAfter: 3, changes: {} },
                        {
                            action: "path.endpoint_moved",
                            pathId: ort(113),
                            revisionBefore: 1,
                            revisionAfter: 2,
                            changes: {},
                        },
                    ],
                }),
            );
            await schreibe(4, anna, amOrt(ort(13)), { minute: 3 });
            const seite = await lese();
            expect(eintrag(seite, 3).series).toBeUndefined();
            expect(eintrag(seite, 1).series?.size).toBe(2);
            expect(eintrag(seite, 4).series).toBeUndefined();
        });

        it("🔴 U14: eine Serie über die Seitengrenze wird ganz geliefert; der Cursor liegt unter ihrem ältesten Mitglied, die nächste Seite hat keines mehr", async () => {
            // Älteste zuerst: X1 bis X3 (Bernd, einzeln), dann Annas Serie M1 bis M12 am Gebirge mit vier fremden Einzelnen dazwischen, dann Y1 und Y2.
            let n = 0;
            const naechste = (): number => (n += 1);
            const einzeln: number[] = [];
            const x = [1, 2, 3].map(() => naechste());
            for (const k of x) await schreibe(k, bernd, amOrt(ort(200 + k)), { minute: k });
            einzeln.push(...x);
            const m: number[] = [];
            const dazwischen: number[] = [];
            for (let i = 1; i <= 12; i += 1) {
                const k = naechste();
                m.push(k);
                await schreibe(k, anna, amGebirge(GEBIRGE(2), TEIL(2), i), {
                    minute: 10 + i,
                    operation: "landscape.update",
                });
                if ([3, 5, 8, 10].includes(i)) {
                    const z = naechste();
                    dazwischen.push(z);
                    await schreibe(z, bernd, amOrt(ort(300 + z)), { minute: 10 + i });
                }
            }
            const y = [naechste(), naechste()];
            for (const k of y) await schreibe(k, bernd, amOrt(ort(400 + k)), { minute: 40 + k });

            const erste = await lese({ limit: 3 });
            const erwartet = new Set([...y, ...m, ...dazwischen].map(op));
            expect(new Set(ids(erste))).toEqual(erwartet);
            // Die Reihenfolge bleibt seq absteigend, der Cursor ist die kleinste gelieferte seq.
            expect(ids(erste)).toEqual([...y, ...m, ...dazwischen].sort((a, b) => b - a).map(op));
            expect(erste.next).toBe(erste.entries.at(-1)!.seq);
            expect(erste.next).toBe(eintrag(erste, m[0]!).seq);
            expect(erste.series).toHaveLength(1);
            expect(erste.series![0]).toMatchObject({ id: op(m[0]!), size: 12, delivered: 12 });
            expect(erste.series![0]!.continues).toBeUndefined();

            const zweite = await lese({ limit: 3, before: erste.next! });
            expect(ids(zweite)).toEqual([...x].reverse().map(op));
            expect(zweite.next).toBeUndefined();
            expect(zweite.series).toBeUndefined();
            // Keine Lücke, keine Dublette über beide Seiten.
            expect([...ids(erste), ...ids(zweite)].sort()).toEqual([...x, ...m, ...dazwischen, ...y].map(op).sort());

            // Ein späterer Eintrag wächst die Serie nach vorn; ihre Kennung bleibt, die Seite zeigt sie wieder ganz.
            const spaeter = naechste();
            await schreibe(spaeter, anna, amGebirge(GEBIRGE(2), TEIL(2), 13), {
                minute: 10 + 13,
                operation: "landscape.update",
            });
            const danach = await lese({ limit: 3 });
            expect(danach.series?.[0]).toMatchObject({ id: op(m[0]!), size: 13, delivered: 13 });
            expect(eintrag(danach, spaeter).series).toEqual({ id: op(m[0]!), position: 13, size: 13 });
            expect(danach.series?.[0]?.members.at(0)).toBe(op(m[0]!));
            expect(danach.series?.[0]?.membersHash).toBe(mitgliederHash(danach.series![0]!.members));
        });

        it("🔴 ein Filter trennt Mitglieder, die Serie bleibt ganz: geliefert werden die Treffer, `members` nennt alle", async () => {
            for (let i = 1; i <= 4; i += 1)
                await schreibe(i, anna, amGebirge(GEBIRGE(3), TEIL(3), i), {
                    minute: i * 2,
                    operation: "landscape.update",
                });
            const seite = await lese({ from: new Date(T0 + 5 * MIN).toISOString() });
            expect(ids(seite)).toEqual([op(4), op(3)]);
            expect(seite.series?.[0]).toMatchObject({ id: op(1), size: 4, delivered: 2 });
            expect(seite.series?.[0]?.members).toEqual([1, 2, 3, 4].map(op));
            expect(eintrag(seite, 3).series).toEqual({ id: op(1), position: 3, size: 4 });
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("U12 (Server): Verlauf eines Orts und globale Liste sagen dasselbe", () => {
        it("🔴 dieselben Operationen, derselbe Zustand, dieselbe Serie, dieselbe Person, dieselbe Rücknahme", async () => {
            await schreibe(1, anna, amOrt(ort(20)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(20)), { minute: 1 });
            await schreibe(3, bernd, amOrt(ort(20)), { minute: 2 });
            await schreibe(4, anna, amOrt(ort(20)), { minute: 3, source: "restore", reverts: [op(3)] });
            await schreibe(5, anna, amOrt(ort(21)), { minute: 4 });
            const verlauf = await placeHistory(database, ort(20), { personId: annaId });
            const global = await lese({ object: `place:${ort(20)}` });
            const sicht = (seite: Seite) =>
                seite.entries.map((e) => ({
                    id: e.operationId,
                    seq: e.seq,
                    at: e.at,
                    status: e.status,
                    statusReason: e.statusReason,
                    revertedBy: e.revertedBy,
                    reverts: e.reverts,
                    series: e.series,
                    actor: e.actor,
                }));
            expect(ids(verlauf)).toEqual([op(4), op(3), op(2), op(1)]);
            expect(sicht(global)).toEqual(sicht(verlauf));
            expect(global.series).toEqual(verlauf.series);
            expect(eintrag(global, 3).status).toBe("bereits_zurueckgenommen");
            expect(eintrag(global, 1).series).toEqual({ id: op(1), position: 1, size: 2 });
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Detail lazy: Nutzlast und ehrliche Lücke (Fachvertrag E.2, Gate 4; U11)", () => {
        const ring = (n: number): number[][] => Array.from({ length: 400 }, (_, i) => [i + n, i * 2 + n]);

        it("🔴 die Liste trägt keine Geometrie (omitted, Feldname bleibt), das Detail trägt sie so, wie das Protokoll sie führt", async () => {
            await mapOperation(
                database,
                anna,
                { operationId: op(1), operation: "landscape.update", mapDomainId: "aventuria", body: { n: 1 } },
                async () => ({
                    receipt: { affected: [], derivedWork: [], warnings: [] },
                    summary: "umgeformt",
                    entries: [
                        {
                            action: "area.reshaped",
                            regionId: GEBIRGE(4),
                            areaId: TEIL(4),
                            revisionBefore: 3,
                            revisionAfter: 4,
                            changes: {
                                geometry: { before: ring(0), after: ring(1) },
                                active: { before: false, after: true },
                            },
                        },
                    ],
                }),
            );
            const liste = await lese();
            expect(liste.entries[0]!.objects[0]!.changes).toEqual({
                geometry: { omitted: true },
                active: { before: false, after: true },
            });
            const detail = await mapChange(database, op(1), { mapDomainId: "aventuria", personId: annaId });
            expect(detail?.objects[0]!.changes["geometry"]).toEqual({ before: ring(0), after: ring(1) });
            expect(detail?.objects[0]!.formFehlt).toBeUndefined();
            expect(detail?.status).toBe("ruecknehmbar");
        });

        it("🔴 B5d: eine Teilfläche und eine Beschriftung nennen ihre Landschaft (Liste und Detail); ein Ort hat keine", async () => {
            // Eine einzelne Änderung am Gebirge, ohne Serie: Der Eintrag kennt die Landschaft sonst nur über `series.scope`, das es erst ab zwei Mitgliedern gibt.
            await schreibe(1, anna, amGebirge(GEBIRGE(5), TEIL(5)));
            await schreibe(2, anna, {
                action: "label.updated",
                regionId: GEBIRGE(6),
                labelId: ort(60),
                revisionBefore: 1,
                revisionAfter: 2,
                changes: { text: { before: "alt", after: "neu" } },
            });
            await schreibe(3, anna, amOrt(ort(61)));
            const liste = await lese();
            const von = (n: number) => liste.entries.find((e) => e.operationId === op(n))!.objects;
            expect(liste.series ?? []).toEqual([]);
            expect(von(1)).toMatchObject([{ kind: "area", id: TEIL(5), landscape: { id: GEBIRGE(5) } }]);
            expect(von(2)).toMatchObject([{ kind: "label", landscape: { id: GEBIRGE(6) } }]);
            expect(von(3)[0]!.landscape).toBeUndefined();
            // Das Detail trägt dasselbe, und die Antwort bleibt im Vertrag (das Feld ist im Schema).
            const detail = await mapChange(database, op(1), { mapDomainId: "aventuria", personId: annaId });
            expect(detail?.objects[0]?.landscape).toEqual({ id: GEBIRGE(5) });
            expect(Value.Check(MapHistoryEntry, detail)).toBe(true);
        });

        it("🔴 fehlt die frühere Form, steht formFehlt - nie ein Vorher aus dem heutigen Stand; ein neu angelegter Gegenstand hat keines zu vermissen", async () => {
            const aenderung = (
                action: MapAuditEntry["action"],
                revisionBefore: number | null,
                changes: MapAuditEntry["changes"],
            ): MapAuditEntry => ({
                action,
                regionId: GEBIRGE(5),
                areaId: TEIL(5),
                revisionBefore,
                revisionAfter: (revisionBefore ?? 0) + 1,
                ...(changes === undefined ? {} : { changes }),
            });
            const einzig = async (n: number, eintragZeile: MapAuditEntry, operation: string): Promise<void> => {
                await mapOperation(
                    database,
                    anna,
                    { operationId: op(n), operation, mapDomainId: "aventuria", body: { n } },
                    async () => ({ receipt: { affected: [], derivedWork: [], warnings: [] }, entries: [eintragZeile] }),
                );
            };
            // 1: nur `after`, der Gegenstand existierte (Revision 7) -> fehlt.
            await einzig(1, aenderung("area.reshaped", 7, { geometry: { after: ring(2) } }), "landscape.reshape");
            // 2: mitgezogene Nachbarfläche (`*.carried`): nur bewegte Punkte -> die Form fehlt.
            await einzig(
                2,
                aenderung("area.carried", 7, { geometry: { before: [[1, 2]], after: [[3, 4]] } }),
                "landscape.reshape",
            );
            // 3: neu angelegt (kein Revision vorher): `after` allein ist alles, was es gibt -> nichts fehlt.
            await einzig(3, aenderung("area.created", null, { geometry: { after: ring(3) } }), "landscape.create");
            // 4: vollständig -> nichts fehlt.
            await einzig(
                4,
                aenderung("area.reshaped", 8, { geometry: { before: ring(4), after: ring(5) } }),
                "landscape.reshape",
            );
            const lies = (n: number) => mapChange(database, op(n), { mapDomainId: "aventuria", personId: annaId });
            expect((await lies(1))?.objects[0]!.formFehlt).toEqual(["geometry"]);
            expect((await lies(2))?.objects[0]!.formFehlt).toEqual(["geometry"]);
            expect((await lies(3))?.objects[0]!.formFehlt).toBeUndefined();
            expect((await lies(4))?.objects[0]!.formFehlt).toBeUndefined();
            // Die Nutzlast bleibt unverändert: nichts wird ergänzt.
            expect((await lies(1))?.objects[0]!.changes["geometry"]).toEqual({ after: ring(2) });
        });

        it("eine unbekannte Operation gibt es nicht; das Detail trägt Zustand und Serie wie die Liste", async () => {
            expect(await mapChange(database, op(999), { mapDomainId: "aventuria", personId: annaId })).toBeUndefined();
            await schreibe(1, anna, amOrt(ort(30)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(30)), { minute: 1 });
            const detail = await mapChange(database, op(2), { mapDomainId: "aventuria", personId: annaId });
            expect(detail).toMatchObject({
                operationId: op(2),
                status: "ruecknehmbar",
                series: { id: op(1), position: 2, size: 2 },
            });
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Herkunft aus einem Community-Vorgang (WI-0265 B6g1; Spalte 0272, WI-0268 C7)", () => {
        const get = (url: string) =>
            app.inject({ method: "GET", url, headers: { cookie: cookies.get("reviewer") ?? "" } });

        it("🔴 communityVorgang steht als COM-Nummer an der Operation mit gesetzter Spalte (Liste, Detail, Verlauf eines Orts) und fehlt bei NULL", async () => {
            await schreibe(1, anna, amOrt(ort(60)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(61)), { minute: 1 });
            await schreibe(3, anna, amOrt(ort(60)), { minute: 2 });
            await database`UPDATE map_operation SET community_vorgang = 123 WHERE operation_id = ${op(1)}::uuid`;
            await database`UPDATE map_operation SET community_vorgang = 1234567 WHERE operation_id = ${op(3)}::uuid`;

            const liste = await lese();
            expect(eintrag(liste, 1).communityVorgang).toBe("COM-000123");
            expect(eintrag(liste, 3).communityVorgang).toBe("COM-1234567");
            // NULL: das Feld fehlt ganz (kein null, kein leerer Text).
            expect("communityVorgang" in eintrag(liste, 2)).toBe(false);

            const verlauf = await placeHistory(database, ort(60), { personId: annaId });
            expect(verlauf.entries.map((e) => [e.operationId, e.communityVorgang])).toEqual([
                [op(3), "COM-1234567"],
                [op(1), "COM-000123"],
            ]);

            const detail = await mapChange(database, op(1), { personId: annaId, mapDomainId: "aventuria" });
            expect(detail?.communityVorgang).toBe("COM-000123");
            const ohne = await mapChange(database, op(2), { personId: annaId, mapDomainId: "aventuria" });
            expect(ohne !== undefined && "communityVorgang" in ohne).toBe(false);
        });

        it("🔴 die Route liefert das Feld im Vertrag (Schema) und lässt es bei NULL weg", async () => {
            await schreibe(1, anna, amOrt(ort(62)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(63)), { minute: 1 });
            await database`UPDATE map_operation SET community_vorgang = 42 WHERE operation_id = ${op(1)}::uuid`;
            const seite = (await get(`${EDITOR_CHANGES_URL}?person=${annaId}`)).json() as Seite;
            expect(Value.Check(MapHistoryPage, seite)).toBe(true);
            expect(eintrag(seite, 1).communityVorgang).toBe("COM-000042");
            expect("communityVorgang" in eintrag(seite, 2)).toBe(false);
            const detail = await get(editorChangeUrl(op(1)));
            expect(detail.statusCode).toBe(200);
            expect(Value.Check(MapHistoryEntry, detail.json())).toBe(true);
            expect((detail.json() as Eintrag).communityVorgang).toBe("COM-000042");
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Route (Rechte und Schema)", () => {
        const get = (url: string, role?: Role) =>
            app.inject({ method: "GET", url, headers: role === undefined ? {} : { cookie: cookies.get(role) ?? "" } });

        it("🔴 Besucher 401, Tester 403, Reviewer liest; privat; Antwort und Detail entsprechen dem Vertrag und tragen Zustand und Kennung", async () => {
            await schreibe(1, anna, amOrt(ort(40)), { minute: 0 });
            await schreibe(2, anna, amOrt(ort(40)), { minute: 1 });
            for (const url of [EDITOR_CHANGES_URL, editorChangeUrl(op(1))]) {
                expect([url, (await get(url)).statusCode]).toEqual([url, 401]);
                expect([url, (await get(url, "tester")).statusCode]).toEqual([url, 403]);
            }
            const liste = await get(
                `${EDITOR_CHANGES_URL}?person=${annaId}&object=place:${ort(40)}&status=ruecknehmbar`,
                "reviewer",
            );
            expect(liste.statusCode).toBe(200);
            expect(liste.headers["cache-control"]).toBe("private, no-cache");
            const seite = liste.json() as Seite;
            expect(Value.Check(MapHistoryPage, seite)).toBe(true);
            expect(seite.entries.map((e) => e.operationId)).toEqual([op(2), op(1)]);
            expect(seite.entries[0]).toMatchObject({
                status: "ruecknehmbar",
                series: { id: op(1), position: 2, size: 2 },
            });
            expect(seite.entries[0]!.actor).toMatchObject({ kind: "person", id: annaId, name: "Anna Änderung" });
            expect(seite.series?.[0]).toMatchObject({ id: op(1), size: 2, delivered: 2 });
            const detail = await get(editorChangeUrl(op(2)), "reviewer");
            expect(detail.statusCode).toBe(200);
            expect(Value.Check(MapHistoryEntry, detail.json())).toBe(true);
            expect((await get(editorChangeUrl(op(999)), "reviewer")).statusCode).toBe(404);
        });

        it("🔴 ein Zeitpunkt ohne Zeitzone, eine unbekannte Art und eine zerbrochene Kennung werden mit 400 abgewiesen", async () => {
            for (const abfrage of [
                "from=2026-10-01T12:00:00",
                "to=morgen",
                "kind=hexe",
                "object=place:nichtuuid",
                "object=hexe:b2650265-0000-4000-8000-000000000001",
                "person=jemand",
                "status=konflikt",
            ])
                expect([abfrage, (await get(`${EDITOR_CHANGES_URL}?${abfrage}`, "reviewer")).statusCode]).toEqual([
                    abfrage,
                    400,
                ]);
            expect(
                (await get(`${EDITOR_CHANGES_URL}?from=2026-10-01T12:00:00%2B02:00&person=geloescht`, "reviewer"))
                    .statusCode,
            ).toBe(200);
            expect((await get(`${EDITOR_CHANGES_URL}/keine-kennung`, "reviewer")).statusCode).toBe(400);
        });
    });
});
