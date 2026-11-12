import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capabilitiesFor, type Capability } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { gegenstandVon, mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { eintraegeNachKennung } from "../src/editor/history.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "../src/editor/map-operation.ts";
import {
    vorpruefen,
    type RuecknahmeAdapter,
    type RuecknahmeLeser,
    type VorKonflikt,
    type Vorpruefung,
} from "../src/editor/ruecknahme.ts";
import { authFixture } from "./support/auth-fixture.ts";

/**
 * Die Vorprüfung der Rücknahme (WI-0265 B2b; Fachvertrag C.1 bis C.3, F.1; Testvertrag U4, U5, U6 (Vorprüfung), U8 (Teil), U9 (Teil), Gate 2) gegen echtes
 * PostgreSQL (`TEST_DATABASE_URL`), nur lesend: Jeder Fall prüft zugleich, dass die Vorprüfung nichts schreibt.
 *
 * Problemfälle: Ein überholtes Mitglied einer Serie lässt sich einzeln zurücknehmen und löscht den späteren Schritt; eine Fremdänderung bleibt unbemerkt oder
 * erscheint ohne Objekt, Revision und Person; das Zurücknehmen von hinten (Schritt 8, dann 7) scheitert an der Revision der ersten Rücknahme; eine Serie, die seit
 * dem Öffnen wuchs, wird still erweitert; ohne Recht erfährt die Person trotzdem von Konflikten und Sperren; eine fremde Person wird ohne Grund zurückgenommen;
 * die Prüfsumme hängt an der Reihenfolge der Liste.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const SOURCE = "test-wi0265-b2b";
const op = (n: number): string => `b2650266-0000-4000-9000-${String(n).padStart(12, "0")}`;
const ORT = (n: number): string => `b2650266-0000-4000-8000-${String(n).padStart(12, "0")}`;
const REGION = "b2650266-0000-4000-8100-000000000001";
const FLAECHE = "b2650266-0000-4000-8200-000000000001";
const FLAECHE2 = "b2650266-0000-4000-8200-000000000002";

/** Der Adapter, den die Tests für „Ort“ und „Gebirge“ gemeinsam brauchen (die echten kommen mit B3 und B4). */
function adapter(optionen: { werte?: readonly VorKonflikt[] } = {}): RuecknahmeAdapter {
    return {
        familie: "test",
        recht: (operation) => (operation === "place.move" ? "edit_map_geometry" : "edit_map_objects"),
        pruefeArt: (operation) => (operation.endsWith(".create") ? { ok: false, reason: "art" } : { ok: true }),
        ...(optionen.werte === undefined ? {} : { pruefeWerte: () => Promise.resolve(optionen.werte!) }),
    };
}

describeWithDatabase("Vorprüfung der Rücknahme (WI-0265 B2b)", { timeout: 180_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let anna: MapActor;
    let bernd: MapActor;
    let annaId: string;
    let berndId: string;
    let leserAnna: RuecknahmeLeser;
    let leserBernd: RuecknahmeLeser;
    let leserReviewer: RuecknahmeLeser;
    const rechte = (...liste: Capability[]): ReadonlySet<Capability> => new Set(liste);

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM editor_lock WHERE object_id::text LIKE 'b2650266-%'`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'b2650266-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'b2650266-%'`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM region_area WHERE public_id::text LIKE 'b2650266-%'`;
        await database`DELETE FROM region WHERE public_id::text LIKE 'b2650266-%'`;
    }

    async function legeOrtAn(n: number, name = `Ort ${String(n)}`): Promise<string> {
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT(n)}, 'aventuria', ${name}, 'stadt', ST_SetSRID(ST_MakePoint(${500 + n}, 512), 0), ${SOURCE}, TRUE)
        `;
        return ORT(n);
    }

    /** Eine Änderung am Ort über die echte Schreibnaht: der Name ändert sich, der Trigger zählt die Revision. */
    async function aendereOrt(
        n: number,
        akteur: MapActor,
        ort: string,
        name: string,
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
            async (tx) => {
                const [vorher] = await tx<{ revision: number; name: string }[]>`
                    SELECT revision::int AS revision, name FROM place WHERE public_id = ${ort}::uuid
                `;
                const [nachher] = await tx<{ revision: number }[]>`
                    UPDATE place SET name = ${name} WHERE public_id = ${ort}::uuid RETURNING revision::int AS revision
                `;
                return {
                    receipt: { affected: [], derivedWork: [], warnings: [] },
                    summary: name,
                    entries: [
                        {
                            action: "place.updated",
                            placeId: ort,
                            revisionBefore: vorher!.revision,
                            revisionAfter: nachher!.revision,
                            changes: { name: { before: vorher!.name, after: name } },
                        },
                    ],
                };
            },
        );
        if (optionen.minute !== undefined)
            await database`UPDATE map_operation SET at = ${new Date(T0 + optionen.minute * MIN)} WHERE operation_id = ${op(n)}::uuid`;
    }

    /** Eine Änderung am Gebirge, wie der Schreibweg sie protokolliert: Teilfläche samt Fläche, das Netz als Feld, KEINE Revision. */
    async function aendereGebirge(
        n: number,
        akteur: MapActor,
        flaeche: string,
        optionen: { minute?: number } = {},
    ): Promise<void> {
        const eintrag: MapAuditEntry = {
            action: "area.gebirge",
            regionId: REGION,
            areaId: flaeche,
            changes: { gebirge: { before: { netz: n - 1 }, after: { netz: n } } },
        };
        await mapOperation(
            database,
            akteur,
            { operationId: op(n), operation: "landscape.update", mapDomainId: "aventuria", body: { n } },
            async () => ({
                receipt: { affected: [], derivedWork: [], warnings: [] },
                summary: `Gebirge ${String(n)}`,
                entries: [eintrag],
            }),
        );
        if (optionen.minute !== undefined)
            await database`UPDATE map_operation SET at = ${new Date(T0 + optionen.minute * MIN)} WHERE operation_id = ${op(n)}::uuid`;
    }

    const pruefe = (
        mitglieder: readonly string[],
        leser: RuecknahmeLeser = leserAnna,
        optionen: { membersHash?: string; adapter?: RuecknahmeAdapter } = {},
    ): Promise<Vorpruefung> =>
        vorpruefen(
            database,
            {
                mapDomainId: "aventuria",
                mitglieder,
                ...(optionen.membersHash === undefined ? {} : { membersHash: optionen.membersHash }),
            },
            leser,
            optionen.adapter ?? adapter(),
        );

    /** Der Stand der Tafeln: Die Vorprüfung ändert keine. */
    async function stand(): Promise<string> {
        const [zeile] = await database<{ s: string }[]>`
            SELECT (SELECT count(*) FROM map_operation WHERE operation_id::text LIKE 'b2650266-%')::text || '/'
                || (SELECT count(*) FROM map_audit_event WHERE operation_id::text LIKE 'b2650266-%')::text || '/'
                || (SELECT count(*) FROM map_operation_revert_link WHERE restore_operation_id::text LIKE 'b2650266-%')::text || '/'
                || (SELECT coalesce(sum(revision), 0) FROM place WHERE source_system = ${SOURCE})::text || '/'
                || (SELECT count(*) FROM job)::text AS s
        `;
        return zeile!.s;
    }

    /** Annas drei Änderungen am Ort 1 (Serie), im Abstand von fünf Minuten. */
    async function serieVonDrei(): Promise<string> {
        const ort = await legeOrtAn(1);
        for (const [i, name] of ["Eins", "Zwei", "Drei"].entries())
            await aendereOrt(i + 1, anna, ort, name, { minute: i * 5 });
        return ort;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        const a = await fixture.person("editor", { name: "Anna Rückgang" });
        const b = await fixture.person("editor", { name: "Bernd Rückgang" });
        annaId = a.id;
        berndId = b.id;
        anna = { kind: "person", personId: a.id, environment: "test" };
        bernd = { kind: "person", personId: b.id, environment: "test" };
        leserAnna = { personId: a.id, rechte: capabilitiesFor("editor") };
        leserBernd = { personId: b.id, rechte: capabilitiesFor("editor") };
        leserReviewer = { personId: b.id, rechte: capabilitiesFor("reviewer") };
    }, 180_000);

    beforeEach(aufraeumen);

    afterAll(async () => {
        await aufraeumen();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("die Serie als Ganzes", () => {
        it("🔴 eine unberührte Serie ist ok: alle Mitglieder offen, Revision heute gleich Revision nach dem letzten Mitglied, nichts geschrieben", async () => {
            const ort = await serieVonDrei();
            const vorher = await stand();
            const serie = (await eintraegeNachKennung(database, [op(1)], { personId: annaId })).series[0]!;
            const ergebnis = await pruefe([op(3), op(1), op(2)], leserAnna, { membersHash: serie.membersHash });
            expect(ergebnis.ergebnis).toBe("ok");
            expect(ergebnis.mitglieder.map((m) => [m.operationId, m.offen, m.status])).toEqual([
                [op(1), true, "ruecknehmbar"],
                [op(2), true, "ruecknehmbar"],
                [op(3), true, "ruecknehmbar"],
            ]);
            expect(ergebnis.offen).toEqual([op(1), op(2), op(3)]);
            expect(ergebnis.gegenstaende).toEqual([
                { kind: "place", id: ort, name: "Drei", erwarteteRevision: 4, istRevision: 4 },
            ]);
            expect(ergebnis.mitglieder[0]!.gegenstaende[0]).toMatchObject({
                kind: "place",
                action: "place.updated",
                felder: ["name"],
            });
            expect(ergebnis.konflikte).toEqual([]);
            expect(ergebnis.sperren).toEqual([]);
            expect(ergebnis.reasonRequired).toBe(false);
            expect(ergebnis.membersHash).toBe(serie.membersHash);
            expect(await stand()).toBe(vorher);
        });

        it("🔴 U8 (Teil): die Prüfsumme hängt an der Menge, nicht an Reihenfolge und Schreibweise; eine zerbrochene Summe oder Liste weist die Vorprüfung ab", async () => {
            await serieVonDrei();
            const a = await pruefe([op(1), op(2), op(3)]);
            const b = await pruefe([op(3).toUpperCase(), op(1), op(2), op(1)]);
            expect(a.membersHash).toBe(b.membersHash);
            expect(a.membersHash).toBe(mitgliederHash([op(1), op(2), op(3)]));
            const hashFalsch = await pruefe([op(1), op(2), op(3)], leserAnna, {
                membersHash: mitgliederHash([op(1), op(2)]),
            });
            expect([hashFalsch.ergebnis, hashFalsch.ungueltig]).toEqual(["invalid_members", "hash"]);
            const unbekannt = await pruefe([op(1), op(99)]);
            expect([unbekannt.ergebnis, unbekannt.ungueltig]).toEqual(["invalid_members", "unbekannt"]);
            expect((await pruefe([])).ungueltig).toBe("leer");
            expect((await pruefe(["keine-kennung"])).ungueltig).toBe("unbekannt");
            // Zwei Operationen, die keine gemeinsame Serie sind (anderer Ort), sind keine Mitgliederliste.
            const anderer = await legeOrtAn(2);
            await aendereOrt(10, anna, anderer, "Anders", { minute: 1 });
            const gemischt = await pruefe([op(1), op(10)]);
            expect([gemischt.ergebnis, gemischt.ungueltig]).toEqual(["invalid_members", "keine_serie"]);
        });

        it("🔴 U8/B.4: ist die Serie seit dem Öffnen gewachsen, antwortet die Vorprüfung series_changed mit der neuen Liste und weitet nie still aus", async () => {
            const ort = await serieVonDrei();
            const alt = mitgliederHash([op(1), op(2), op(3)]);
            await aendereOrt(4, anna, ort, "Vier", { minute: 12 });
            const ergebnis = await pruefe([op(1), op(2), op(3)], leserAnna, { membersHash: alt });
            expect(ergebnis.ergebnis).toBe("series_changed");
            expect(ergebnis.neueMitglieder).toEqual([op(1), op(2), op(3), op(4)]);
            expect(ergebnis.neuerHash).toBe(mitgliederHash([op(1), op(2), op(3), op(4)]));
            expect(ergebnis.membersHash).toBe(alt);
            expect(ergebnis.offen).toEqual([op(1), op(2), op(3)]);
            // Mit der neuen Liste ist alles in Ordnung.
            expect(
                (await pruefe([op(1), op(2), op(3), op(4)], leserAnna, { membersHash: ergebnis.neuerHash! })).ergebnis,
            ).toBe("ok");
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("einzeln: nur das letzte offene Mitglied (Gate 3 streng; U4, U5)", () => {
        it("🔴 U5: ein überholtes Mitglied ist gesperrt und nennt den Schritt, der es überholt; das letzte ist frei (U4)", async () => {
            await serieVonDrei();
            const mitte = await pruefe([op(2)]);
            expect(mitte.ergebnis).toBe("edit_conflict");
            expect(mitte.mitglieder[0]!.ueberholtDurch).toEqual({
                operationId: op(3),
                seq: mitte.mitglieder[0]!.ueberholtDurch!.seq,
                position: 3,
            });
            expect(mitte.konflikte).toHaveLength(1);
            expect(mitte.konflikte[0]).toMatchObject({
                art: "ueberholt",
                kind: "place",
                operationId: op(3),
                eigene: true,
                ueberholtDurch: { operationId: op(3), position: 3 },
                changedBy: { id: annaId, name: "Anna Rückgang" },
            });
            // Das erste wird vom zweiten überholt, nicht erst vom dritten.
            expect((await pruefe([op(1)])).mitglieder[0]!.ueberholtDurch?.position).toBe(2);
            // Das letzte offene Mitglied ist frei.
            const letztes = await pruefe([op(3)]);
            expect(letztes.ergebnis).toBe("ok");
            expect(letztes.mitglieder[0]!.ueberholtDurch).toBeUndefined();
        });

        it("🔴 U4: von hinten Schritt für Schritt zurücknehmen: nach der Rücknahme von Schritt 3 ist Schritt 2 das letzte offene Mitglied, trotz der Revision der Rücknahme", async () => {
            const ort = await serieVonDrei();
            // Schritt 3 wird zurückgenommen: der Name geht auf den von Schritt 2, die Revision zählt weiter.
            await aendereOrt(4, anna, ort, "Zwei", { minute: 20, source: "restore", reverts: [op(3)] });
            const zwei = await pruefe([op(2)]);
            expect(zwei.ergebnis).toBe("ok");
            expect(zwei.gegenstaende[0]).toMatchObject({ erwarteteRevision: 5, istRevision: 5 });
            // Schritt 3 ist zurückgenommen; die Vorprüfung sagt es.
            const drei = await pruefe([op(3)]);
            expect(drei.ergebnis).toBe("already_reverted");
            expect(drei.mitglieder[0]).toMatchObject({ status: "bereits_zurueckgenommen", offen: false });
            // Die ganze Serie: offen sind Schritt 1 und 2, die Rücknahme von 3 hebt sich mit ihm auf.
            const serie = await pruefe([op(1), op(2), op(3)]);
            expect(serie.ergebnis).toBe("ok");
            expect(serie.offen).toEqual([op(1), op(2)]);
            expect(serie.mitglieder.map((m) => m.status)).toEqual([
                "ruecknehmbar",
                "ruecknehmbar",
                "bereits_zurueckgenommen",
            ]);
        });

        it("ist alles zurückgenommen, heißt es already_reverted; die Rücknahme der Rücknahme macht das Original wieder offen", async () => {
            const ort = await legeOrtAn(1);
            await aendereOrt(1, anna, ort, "Neu", { minute: 0 });
            await aendereOrt(2, anna, ort, "Ursprung", { minute: 1, source: "restore", reverts: [op(1)] });
            expect((await pruefe([op(1)])).ergebnis).toBe("already_reverted");
            await aendereOrt(3, anna, ort, "Neu", { minute: 2, source: "restore", reverts: [op(2)] });
            const wieder = await pruefe([op(1)]);
            // Das Original gilt wieder. Die Rücknahme (op 2) und ihre Rücknahme (op 3) heben einander auf: Der Name ist wieder der von op 1, die Revision zählt weiter.
            expect(wieder.mitglieder[0]!.status).toBe("ruecknehmbar");
            expect(wieder.ergebnis).toBe("ok");
            expect(wieder.gegenstaende[0]).toMatchObject({ erwarteteRevision: 4, istRevision: 4 });
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Konflikt, Sperre, Recht (U6, U9, Gate 2)", () => {
        it("🔴 U6: eine Fremdänderung seit dem letzten Mitglied: Konfliktliste mit Objekt, Revision, Person, Zeit und Feldern, nichts geschrieben", async () => {
            const ort = await serieVonDrei();
            await aendereOrt(4, bernd, ort, "Fremd", { minute: 30 });
            const vorher = await stand();
            const ergebnis = await pruefe([op(1), op(2), op(3)]);
            expect(ergebnis.ergebnis).toBe("edit_conflict");
            expect(ergebnis.konflikte).toEqual([
                {
                    art: "spaeter",
                    kind: "place",
                    id: ort,
                    name: "Fremd",
                    currentRevision: 5,
                    erwarteteRevision: 4,
                    changedBy: { kind: "person", id: berndId, name: "Bernd Rückgang" },
                    changedAt: new Date(T0 + 30 * MIN).toISOString(),
                    operationId: op(4),
                    seq: ergebnis.konflikte[0]!.seq,
                    felder: ["name"],
                    eigene: false,
                },
            ]);
            expect(ergebnis.gegenstaende[0]).toMatchObject({ erwarteteRevision: 4, istRevision: 5 });
            // Bernd hat keine eigene Änderung in der Serie von Anna: Anna fragt, also ist niemand Fremdes betroffen.
            expect(ergebnis.reasonRequired).toBe(false);
            expect(await stand()).toBe(vorher);
        });

        it("eine spätere eigene Änderung desselben Gegenstands ist ebenfalls ein Konflikt (streng), und eine Änderung außerhalb des Protokolls fällt an der Revision auf", async () => {
            const ort = await serieVonDrei();
            await aendereOrt(4, anna, ort, "Spaeter", { minute: 40 });
            const eigene = await pruefe([op(1), op(2), op(3)]);
            expect(eigene.konflikte[0]).toMatchObject({ art: "spaeter", eigene: true, operationId: op(4) });
            // Direkt in der Tafel, am Protokoll vorbei (etwa ein Import): nur die Revision weicht ab.
            await aufraeumen();
            const anderer = await legeOrtAn(7);
            await aendereOrt(11, anna, anderer, "A", { minute: 0 });
            await aendereOrt(12, anna, anderer, "B", { minute: 1 });
            await database`UPDATE place SET name = 'Direkt' WHERE public_id = ${anderer}::uuid`;
            const draussen = await pruefe([op(11), op(12)]);
            expect(draussen.ergebnis).toBe("edit_conflict");
            expect(draussen.konflikte).toEqual([
                {
                    art: "revision",
                    kind: "place",
                    id: anderer,
                    name: "Direkt",
                    currentRevision: 4,
                    erwarteteRevision: 3,
                },
            ]);
        });

        it("ein Gegenstand, den es nicht mehr gibt, ist ein Konflikt „geloescht“", async () => {
            const ort = await serieVonDrei();
            await database`DELETE FROM place WHERE public_id = ${ort}::uuid`;
            const ergebnis = await pruefe([op(1), op(2), op(3)]);
            expect(ergebnis.ergebnis).toBe("edit_conflict");
            expect(ergebnis.konflikte).toEqual([{ art: "geloescht", kind: "place", id: ort, erwarteteRevision: 4 }]);
            expect(ergebnis.gegenstaende[0]).toMatchObject({ fehlt: true });
        });

        it("🔴 Gate 2: nimmt eine andere Person die Serie zurück, ist eine fremde Person betroffen und der Grund Pflicht; die eigene nicht", async () => {
            await serieVonDrei();
            const fremd = await pruefe([op(1), op(2), op(3)], leserBernd);
            expect(fremd.ergebnis).toBe("ok");
            expect(fremd.reasonRequired).toBe(true);
            expect(fremd.fremdePersonen).toEqual([{ kind: "person", id: annaId, name: "Anna Rückgang" }]);
            const eigene = await pruefe([op(1), op(2), op(3)], leserAnna);
            expect([eigene.reasonRequired, eigene.fremdePersonen]).toEqual([false, []]);
        });

        it("🔴 U9 (Teil): fehlt das Recht der Vorwärtsoperation, kommt forbidden und sonst nichts: weder Konflikte noch Sperren noch Mitglieder offen", async () => {
            const ort = await serieVonDrei();
            await aendereOrt(4, bernd, ort, "Fremd", { minute: 30 });
            await database`
                INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
                VALUES ('place', ${ort}::uuid, 'felder', ${berndId}::uuid, 'Bernd Rückgang', gen_random_uuid())
            `;
            const ergebnis = await pruefe([op(1), op(2), op(3)], leserReviewer);
            expect(ergebnis.ergebnis).toBe("forbidden");
            expect(ergebnis.fehlendeRechte).toEqual(["edit_map_objects"]);
            expect([ergebnis.konflikte, ergebnis.sperren, ergebnis.offen]).toEqual([[], [], []]);
            // place.move verlangt das Recht der Geometrie.
            const verschoben = await legeOrtAn(3);
            await aendereOrt(20, anna, verschoben, "Weg", { minute: 50, operation: "place.move" });
            const nurObjekte: RuecknahmeLeser = { personId: annaId, rechte: rechte("edit_map_objects") };
            expect((await pruefe([op(20)], nurObjekte)).fehlendeRechte).toEqual(["edit_map_geometry"]);
        });

        it("🔴 U9 (Teil): eine Fremdsperre kommt vor jedem Konflikt; die eigene und eine abgelaufene zählen nicht", async () => {
            const ort = await serieVonDrei();
            await aendereOrt(4, bernd, ort, "Fremd", { minute: 30 });
            await database`
                INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
                VALUES ('place', ${ort}::uuid, 'felder', ${berndId}::uuid, 'Bernd Rückgang', gen_random_uuid())
            `;
            const gesperrt = await pruefe([op(1), op(2), op(3)], leserAnna);
            expect(gesperrt.ergebnis).toBe("object_locked");
            expect(gesperrt.sperren).toMatchObject([
                { kind: "place", id: ort, person: { id: berndId, name: "Bernd Rückgang" }, part: "felder" },
            ]);
            // Der Konflikt steht trotzdem in der Antwort (das Blatt zeigt beides), aber das Ergebnis ist die Sperre.
            expect(gesperrt.konflikte).toHaveLength(1);
            // Bernd selbst: die eigene Sperre zählt nicht.
            expect((await pruefe([op(1), op(2), op(3)], leserBernd)).sperren).toEqual([]);
            // Ohne Herzschlag seit über 15 Minuten ist das Objekt frei.
            await database`UPDATE editor_lock SET heartbeat_at = now() - interval '20 minutes' WHERE object_id = ${ort}::uuid`;
            expect((await pruefe([op(1), op(2), op(3)], leserAnna)).ergebnis).toBe("edit_conflict");
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Ausschlüsse: Quelle und Art", () => {
        it("🔴 Import und Testwelt sind nicht rücknehmbar (Quelle), ein Name des WikiSync, den er nicht zurücknimmt, ist Art (seit WI-0265 B8d hat die Übernahme des WikiSync eine eigene Rücknahme), Anlegen ist es nicht (Art, vom Adapter)", async () => {
            const ort = await legeOrtAn(1);
            for (const [n, quelle] of [
                [1, "import"],
                [2, "wikisync"],
                [3, "testwelt_reset"],
            ] as const)
                await database`
                    INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, environment, actor_kind, actor_label)
                    VALUES (${op(n)}::uuid, 'aventuria', decode(repeat('ab', 32), 'hex'),
                            jsonb_build_object('operationId', ${op(n)}::text, 'status', 'applied'), 'place.update', ${quelle}, 'test', 'system', 'test')
                `;
            for (const n of [1, 2, 3]) {
                const ergebnis = await pruefe([op(n)]);
                expect([n, ergebnis.ergebnis, ergebnis.mitglieder[0]!.ausschluss]).toEqual([
                    n,
                    "not_revertable",
                    // Eine Operation des WikiSync mit dem Namen `place.update` gibt es nicht; was der WikiSync schreibt und nicht in seiner Liste führt, ist Art.
                    { grund: n === 2 ? "art" : "quelle" },
                ]);
                expect(ergebnis.offen).toEqual([]);
            }
            await mapOperation(
                database,
                anna,
                { operationId: op(4), operation: "place.create", mapDomainId: "aventuria", body: { n: 4 } },
                async () => ({
                    receipt: { affected: [], derivedWork: [], warnings: [] },
                    entries: [
                        {
                            action: "place.created",
                            placeId: ort,
                            revisionAfter: 1,
                            changes: { name: { after: "Neu" } },
                        },
                    ],
                }),
            );
            const anlegen = await pruefe([op(4)]);
            expect([anlegen.ergebnis, anlegen.mitglieder[0]!.ausschluss]).toEqual(["not_revertable", { grund: "art" }]);
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Gebirge ohne Revision und die Schnittstelle des Adapters (B3)", () => {
        async function gebirge(): Promise<void> {
            const [region] = await database<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                VALUES (${REGION}, 'aventuria', 'Probegebirge', 'topographie', 'gebirge', TRUE) RETURNING id::text
            `;
            for (const flaeche of [FLAECHE, FLAECHE2])
                await database`
                    INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                    VALUES (${flaeche}, 'aventuria', ${region!.id}::bigint, ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))'), TRUE)
                `;
            for (let i = 1; i <= 4; i += 1) await aendereGebirge(i, anna, FLAECHE, { minute: i * 3 });
        }

        it("🔴 U5 am Gebirge: ohne Revisionen im Protokoll gilt die Serienregel trotzdem; die ganze Serie ist ok", async () => {
            await gebirge();
            const serie = await pruefe([op(1), op(2), op(3), op(4)]);
            expect(serie.ergebnis).toBe("ok");
            expect(serie.gegenstaende).toEqual([
                {
                    kind: "area",
                    id: FLAECHE,
                    name: "Probegebirge",
                    erwarteteRevision: null,
                    istRevision: expect.any(Number) as unknown as number,
                },
            ]);
            const mitte = await pruefe([op(2)]);
            expect([mitte.ergebnis, mitte.mitglieder[0]!.ueberholtDurch?.position]).toEqual(["edit_conflict", 3]);
            expect((await pruefe([op(4)])).ergebnis).toBe("ok");
        });

        it("eine Fremdänderung an derselben Teilfläche ist auch ohne Revision ein Konflikt; an einer anderen Teilfläche derselben Fläche nicht", async () => {
            await gebirge();
            await aendereGebirge(5, bernd, FLAECHE2, { minute: 20 });
            expect((await pruefe([op(1), op(2), op(3), op(4)])).ergebnis).toBe("ok");
            await aendereGebirge(6, bernd, FLAECHE, { minute: 21 });
            const konflikt = await pruefe([op(1), op(2), op(3), op(4)]);
            expect(konflikt.ergebnis).toBe("edit_conflict");
            expect(konflikt.konflikte).toMatchObject([
                {
                    art: "spaeter",
                    kind: "area",
                    id: FLAECHE,
                    operationId: op(6),
                    felder: ["gebirge"],
                    changedBy: { id: berndId },
                    eigene: false,
                },
            ]);
        });

        it("🔴 der Adapter prüft die Werte: seine Abweichung ist ein Konflikt der Art wert, eine leere Antwort lässt es ok", async () => {
            await gebirge();
            const abweichung: VorKonflikt = {
                art: "wert",
                kind: "area",
                id: FLAECHE,
                detail: "Das Netz weicht vom Endstand ab",
            };
            const mit = await pruefe([op(1), op(2), op(3), op(4)], leserAnna, {
                adapter: adapter({ werte: [abweichung] }),
            });
            expect(mit.ergebnis).toBe("edit_conflict");
            expect(mit.konflikte).toEqual([abweichung]);
            const ohne = await pruefe([op(1), op(2), op(3), op(4)], leserAnna, { adapter: adapter({ werte: [] }) });
            expect(ohne.ergebnis).toBe("ok");
        });
    });

    // ------------------------------------------------------------------------------------------------------------------------------------------------
    describe("Gegenstände wie die Verläufe (kein Auseinanderlaufen)", () => {
        it("🔴 gegenstandVon wählt für jede Zielspalte denselben Gegenstand wie die Einträge der Verläufe", async () => {
            const spalten = [
                ["place", "place_public_id"],
                ["path", "path_public_id"],
                ["powerline", "powerline_public_id"],
                ["nodix", "nodix_public_id"],
                ["landscape", "region_public_id"],
                ["area", "region_area_public_id"],
                ["label", "map_label_public_id"],
                ["territory", "territory_public_id"],
                ["territory_area", "territory_area_public_id"],
                ["peak", "peak_public_id"],
                ["source", "source_public_id"],
                ["work", "work_public_id"],
                ["lore", "lore_public_id"],
                ["corpus", "corpus_public_id"],
                ["sprache_artikel", "sprache_artikel_public_id"],
                ["sprache", "sprache_public_id"],
                ["sprache_flaeche", "sprache_flaeche_public_id"],
            ] as const;
            // Je Zielspalte ein Eintrag; die Teilfläche, die Beschriftung, die Gebiets- und die Sprachfläche tragen zusätzlich ihre Elternfläche (so schreibt es das Protokoll).
            const eltern: Record<string, string> = {
                region_area_public_id: "region_public_id",
                map_label_public_id: "region_public_id",
                territory_area_public_id: "territory_public_id",
                sprache_flaeche_public_id: "sprache_public_id",
            };
            for (const [i, [, spalte]] of spalten.entries()) {
                const n = 100 + i;
                await database`
                    INSERT INTO map_operation (operation_id, map_domain_id, action, source, environment, actor_kind, actor_label)
                    VALUES (${op(n)}::uuid, 'aventuria', 'test.zeile', 'import', 'test', 'system', 'test')
                `;
                const id = `b2650266-0000-4000-8300-${String(i).padStart(12, "0")}`;
                const elternSpalte = eltern[spalte];
                const werte: Record<string, string | null> = Object.fromEntries(spalten.map(([, s]) => [s, null]));
                werte[spalte] = id;
                if (elternSpalte !== undefined)
                    werte[elternSpalte] = `b2650266-0000-4000-8400-${String(i).padStart(12, "0")}`;
                await database`
                    INSERT INTO map_audit_event (operation_id, action, place_public_id, path_public_id, powerline_public_id, nodix_public_id,
                                                 region_public_id, region_area_public_id, map_label_public_id, territory_public_id,
                                                 territory_area_public_id, peak_public_id, source_public_id, work_public_id, lore_public_id,
                                                 corpus_public_id, sprache_artikel_public_id, sprache_public_id, sprache_flaeche_public_id, changes)
                    VALUES (${op(n)}::uuid, 'test.geaendert', ${werte["place_public_id"]!}::uuid, ${werte["path_public_id"]!}::uuid,
                            ${werte["powerline_public_id"]!}::uuid, ${werte["nodix_public_id"]!}::uuid, ${werte["region_public_id"]!}::uuid,
                            ${werte["region_area_public_id"]!}::uuid, ${werte["map_label_public_id"]!}::uuid, ${werte["territory_public_id"]!}::uuid,
                            ${werte["territory_area_public_id"]!}::uuid, ${werte["peak_public_id"]!}::uuid, ${werte["source_public_id"]!}::uuid,
                            ${werte["work_public_id"]!}::uuid, ${werte["lore_public_id"]!}::uuid, ${werte["corpus_public_id"]!}::uuid,
                            ${werte["sprache_artikel_public_id"]!}::uuid, ${werte["sprache_public_id"]!}::uuid,
                            ${werte["sprache_flaeche_public_id"]!}::uuid, '{}'::jsonb)
                `;
                const eintrag = (await eintraegeNachKennung(database, [op(n)], { personId: undefined })).entries[0]!;
                expect(gegenstandVon(werte as Parameters<typeof gegenstandVon>[0]), spalte).toEqual({
                    kind: eintrag.objects[0]!.kind,
                    id: eintrag.objects[0]!.id,
                });
            }
        });
    });
});
