import { createHash, randomUUID } from "node:crypto";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    RuecknahmePruefung,
    RuecknahmeReceipt,
    editorPathUpdateUrl,
    editorPlaceRestoreSeriesPreviewUrl,
    editorPlaceRestoreSeriesUrl,
    editorPlaceUrl,
    editorTerritoryUrl,
    editorLandscapeUrl,
    type Capability,
    type InhalteTraegerArt,
    type InhalteTraegerQuellenArt,
    type InhalteTraegerQuellenBody,
    type RuecknahmeBody,
    type RuecknahmePruefung as Pruefung,
    type RuecknahmeReceipt as Quittung,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ruecknehmenFlaeche, vorschauFlaeche } from "../src/editor/ruecknahme-flaeche.ts";
import { ruecknehmenGebiet, vorschauGebiet } from "../src/editor/ruecknahme-gebiet.ts";
import { ruecknehmenOrt, vorschauOrt } from "../src/editor/ruecknahme-ort.ts";
import { ruecknehmenQuelle, vorschauQuelle } from "../src/editor/ruecknahme-quelle.ts";
import { ruecknehmenWeg, vorschauWeg } from "../src/editor/ruecknahme-weg.ts";
import type { RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { ApiError } from "../src/http/api-error.ts";
import { aendereQuelle } from "../src/inhalte/quellen-schreiben.ts";
import { aendereTraegerQuellen } from "../src/inhalte/traeger-quellen-schreiben.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { P3, cleanP3Fixtures, insertP3Carriers, p3Id } from "./support/p3-fixture.ts";

/**
 * Die Quellen eines Kartenobjekts zurücknehmen (WI-0265 B6g3; Fachvertrag C.2, C.3, F.1, B.2, Gate 2 und 3; Testvertrag U4 bis U9): `traeger.sources` gehört zur Familie seines Trägers (Ort, Gebiet, Landschaft,
 * Weg) und teilt dessen Serie; `source.update` nimmt seine `links` (Verwendungen an mehreren Trägern) mit zurück. Gegen echtes PostgreSQL (`TEST_DATABASE_URL`); die Rechte der App-Rolle prüft der Rauchtest
 * der Schreibwege (`support/schreibwege/`).
 *
 * Problemfälle: Eine Serie aus Feldern und Quellen geht nur teilweise zurück (die Felder, aber nicht die Quellen, oder umgekehrt); eine Verknüpfung, die die Serie anlegte, wird gelöscht statt still gelegt; eine
 * gelöste oder unterdrückte (Legacy) bleibt gelöst; die Angaben (Art, Seiten, Notiz) kehren nicht auf den Stand von damals zurück; das Etikett des Objekts (Kanon) bleibt auf dem Stand der Serie; eine Änderung
 * an der Zeile seither bleibt unbemerkt (auch eine ohne Operation am Träger, weil sie von der Quelle her kam) oder wird überschrieben; eine Rücknahme geht halb durch, wenn ein Träger von mehreren nicht passt;
 * ein Doppelklick schreibt zweimal; eine fremde Person wird ohne Grund zurückgenommen; ohne `manage_sources` geht die Rücknahme der Quellen durch; die Rücknahme nur der Quellen löst Ereignis und Ableitung der
 * Karte aus (Kacheln laden neu); ein Weg geht nur auf einem Teil seiner Abschnitte zurück; eine Rücknahme der Rücknahme führt nicht zum Stand davor.
 */

FormatRegistry.Set("date-time", (wert) => !Number.isNaN(Date.parse(wert)));

const url = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = url ? describe : describe.skip;

const HOST = "https://p3test.example";
/** Der zweite Abschnitt der Straße „P3T Weg Eins“ (der erste ist `P3.weg`, der Anker mit der kleineren Kennung). */
const ABSCHNITT_ZWEI = p3Id(0xf1);

type Art = InhalteTraegerQuellenArt;
const TAFELN = {
    place: { link: "place_source", fk: "place_id", traeger: "place", kanon: "place_canon" },
    territory: { link: "territory_source", fk: "territory_id", traeger: "territory", kanon: "territory_canon" },
    area: { link: "region_source", fk: "region_id", traeger: "region", kanon: "region_canon" },
    path: { link: "path_source", fk: "path_id", traeger: "path", kanon: "path_canon" },
    peak: { link: "terrain_peak_source", fk: "terrain_peak_id", traeger: "terrain_peak", kanon: "terrain_peak_canon" },
} as const;

describeWithDatabase("Quellen am Träger zurücknehmen (WI-0265 B6g3)", { timeout: 300_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: AuthFixture;
    let anna: MapActor;
    let bernd: MapActor;
    let annaLeser: RuecknahmeLeser;
    let berndLeser: RuecknahmeLeser;
    const cookies = { anna: "", bernd: "" };
    const operationen: string[] = [];
    const neu = (): string => {
        const id = randomUUID();
        operationen.push(id);
        return id;
    };
    const ALLE: ReadonlySet<Capability> = new Set<Capability>([
        "use_editor_menu",
        "edit_map_objects",
        "edit_map_geometry",
        // Seit WI-0279 (Fachrechte nach Gebiet und Landschaft): Felder und Quellen dieser Träger verlangen sie statt `edit_map_objects` (nicht die Form: sie ist ab Admin).
        "edit_territories",
        "edit_landscapes",
        "manage_sources",
    ]);
    let q1 = "";
    let q2 = "";
    let q3 = "";

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

    const koerper = (members: string[], extra: { operationId?: string; reason?: string } = {}): RuecknahmeBody => ({
        operationId: extra.operationId ?? neu(),
        members,
        membersHash: mitgliederHash(members),
        ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    });
    const vorbody = (members: string[]): RuecknahmeVorschauBody => ({ members, membersHash: mitgliederHash(members) });

    // --- Fixtures ------------------------------------------------------------------------------------------------------------

    const quelleAnlegen = async (titel: string, pfad: string, art: string, offiziell: boolean): Promise<string> => {
        const adresse = `${HOST}/${pfad}`;
        const schluessel = `url:${createHash("sha256").update(adresse, "utf8").digest("hex")}`;
        const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system)
            VALUES (${schluessel}, 'final', ${adresse}, ${titel}, ${art}, ${offiziell}, 'test-b6g3')
            RETURNING public_id::text
        `;
        return zeile!.public_id;
    };

    async function aufraeumen(): Promise<void> {
        // Alles, was an den Trägern der Fixture oder an einer ihrer Quellen hing (auch Reste eines früheren Laufs): erst die Einträge, dann die Operationen.
        const ops = await database<{ operation_id: string }[]>`
            SELECT DISTINCT operation_id::text AS operation_id FROM map_audit_event
             WHERE place_public_id::text LIKE '63000000-%' OR path_public_id::text LIKE '63000000-%'
                OR territory_public_id::text LIKE '63000000-%' OR region_public_id::text LIKE '63000000-%'
                OR peak_public_id::text LIKE '63000000-%'
                OR source_public_id IN (SELECT public_id FROM feature_source WHERE title LIKE 'P3T%' OR url LIKE 'https://p3test.%')
        `;
        const ids = [...new Set([...ops.map((o) => o.operation_id), ...operationen])];
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${ids}::uuid[])`;
        await cleanP3Fixtures(database);
        operationen.length = 0;
    }

    async function baueAuf(): Promise<void> {
        await aufraeumen();
        await insertP3Carriers(database);
        // Der zweite Abschnitt der Straße „P3T Weg Eins“ (gleicher Name, hinter dem ersten).
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${ABSCHNITT_ZWEI}, 'aventuria', 'P3T Weg Eins', 'Strasse', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(310, 310), ST_MakePoint(320, 310)), 0), 'test', TRUE)
        `;
        q1 = await quelleAnlegen("P3T Quelle Eins", "eins", "regelbuch", true);
        q2 = await quelleAnlegen("P3T Quelle Zwei", "zwei", "briefspiel", false);
        q3 = await quelleAnlegen("P3T Quelle Drei", "drei", "briefspiel", false);
        // Eine Verknüpfung aus Legacy am Ort (Seite 7, „Erwähnung“) und an EINEM Abschnitt des Wegs.
        await database`
            INSERT INTO place_source (place_id, source_id, reference_kind, pages, position, source_system)
            SELECT p.id, f.id, 'erwaehnung', '7', 0, 'legacy' FROM place p, feature_source f
             WHERE p.public_id = ${P3.ort}::uuid AND f.public_id = ${q3}::uuid
        `;
        await database`
            INSERT INTO path_source (path_id, source_id, reference_kind, pages, position, source_system)
            SELECT p.id, f.id, 'erwaehnung', '7', 0, 'legacy' FROM path p, feature_source f
             WHERE p.public_id = ${P3.weg}::uuid AND f.public_id = ${q3}::uuid
        `;
    }

    // --- Vorwärts-Schreiben ---------------------------------------------------------------------------------------------------

    const GESEHEN_LEGACY = { state: "active", referenceKind: "erwaehnung", pages: "7", note: null } as const;
    const traegerQuellen = async (
        akteur: MapActor,
        kind: Art,
        kennung: string,
        aenderungen: InhalteTraegerQuellenBody["aenderungen"],
    ): Promise<string> => {
        const operationId = neu();
        await aendereTraegerQuellen(database, akteur, kind, kennung, { operationId, aenderungen });
        return operationId;
    };
    const haengeAn = (akteur: MapActor, kind: Art, kennung: string, quelle: string, pages = "S. 12"): Promise<string> =>
        traegerQuellen(akteur, kind, kennung, [
            { op: "add", sourceId: quelle, vorher: null, referenceKind: "ausfuehrlich", pages },
        ]);

    const sende = (
        cookie: string,
        method: "POST" | "PATCH",
        pfad: string,
        payload: Record<string, unknown>,
    ): Promise<LightMyRequestResponse> =>
        app.inject({ method, url: pfad, headers: { cookie, origin: TEST_ORIGIN }, payload });
    const revision = async (tabelle: "place" | "territory" | "region" | "path", id: string): Promise<number> =>
        Number(
            (
                await database.unsafe<{ r: string }[]>(
                    `SELECT revision::text AS r FROM ${tabelle} WHERE public_id = $1::uuid`,
                    [id],
                )
            )[0]!.r,
        );
    const ok = async (antwort: Promise<LightMyRequestResponse>): Promise<string> => {
        const a = await antwort;
        expect(a.statusCode, a.body).toBe(200);
        return (a.json() as { operationId: string }).operationId;
    };
    /** „Fertig“ am Ort (`place.update`), als die Person mit dem Cookie. */
    const ortFelder = async (cookie: string, changes: Record<string, unknown>): Promise<string> => {
        const operationId = neu();
        return ok(
            sende(cookie, "PATCH", editorPlaceUrl(P3.ort), {
                operationId,
                baseRevision: await revision("place", P3.ort),
                changes,
            }),
        );
    };
    const gebietFelder = async (cookie: string, changes: Record<string, unknown>): Promise<string> =>
        ok(
            sende(cookie, "PATCH", editorTerritoryUrl(P3.gebiet), {
                operationId: neu(),
                baseRevision: await revision("territory", P3.gebiet),
                changes,
            }),
        );
    const landschaftFelder = async (cookie: string, changes: Record<string, unknown>): Promise<string> =>
        ok(
            sende(cookie, "PATCH", editorLandscapeUrl(P3.region), {
                operationId: neu(),
                baseRevision: await revision("region", P3.region),
                changes,
            }),
        );
    const wegFelder = async (cookie: string, felder: Record<string, unknown>): Promise<string> =>
        ok(
            sende(cookie, "POST", editorPathUpdateUrl(P3.weg), {
                operationId: neu(),
                // Die ganze Straße: beide Abschnitte, die Felder am ersten.
                sections: [
                    { publicId: P3.weg, baseRevision: await revision("path", P3.weg), ...felder },
                    { publicId: ABSCHNITT_ZWEI, baseRevision: await revision("path", ABSCHNITT_ZWEI) },
                ],
            }),
        );

    // --- Lesen des Standes -----------------------------------------------------------------------------------------------------

    const verknuepfung = async (art: InhalteTraegerArt, traegerId: string, quelleId: string) => {
        const t = TAFELN[art];
        return (
            await database.unsafe<
                {
                    state: string;
                    is_active: boolean;
                    source_system: string;
                    reference_kind: string | null;
                    pages: string | null;
                    note: string | null;
                    retired_origin: string | null;
                }[]
            >(
                `SELECT l.state, l.is_active, l.source_system, l.reference_kind, l.pages, l.note, l.retired_origin
                   FROM ${t.link} l JOIN ${t.traeger} c ON c.id = l.${t.fk} JOIN feature_source f ON f.id = l.source_id
                  WHERE c.public_id = $1::uuid AND f.public_id = $2::uuid ORDER BY l.id`,
                [traegerId, quelleId],
            )
        )[0];
    };
    /** Die Zeilen einer Quelle an allen Abschnitten der Straße „P3T Weg Eins“. */
    const wegZeilen = async (quelleId: string) =>
        database<
            {
                carrier: string;
                state: string;
                is_active: boolean;
                pages: string | null;
                reference_kind: string | null;
                source_system: string;
            }[]
        >`
            SELECT p.public_id::text AS carrier, l.state, l.is_active, l.pages, l.reference_kind, l.source_system
              FROM path_source l JOIN path p ON p.id = l.path_id JOIN feature_source f ON f.id = l.source_id
             WHERE f.public_id = ${quelleId}::uuid AND p.public_id::text LIKE '63000000-%' ORDER BY p.public_id
        `;
    const zahlZeilen = async (art: InhalteTraegerArt, traegerId: string, quelleId: string): Promise<number> => {
        const t = TAFELN[art];
        return (
            await database.unsafe<{ n: number }[]>(
                `SELECT count(*)::int AS n FROM ${t.link} l JOIN ${t.traeger} c ON c.id = l.${t.fk} JOIN feature_source f ON f.id = l.source_id
                  WHERE c.public_id = $1::uuid AND f.public_id = $2::uuid`,
                [traegerId, quelleId],
            )
        )[0]!.n;
    };
    const kanon = async (art: InhalteTraegerArt, traegerId: string) => {
        const t = TAFELN[art];
        return (
            await database.unsafe<{ canon: string; designator_type: string | null }[]>(
                `SELECT k.canon, k.designator_type FROM ${t.kanon} k JOIN ${t.traeger} c ON c.id = k.${t.fk} WHERE c.public_id = $1::uuid`,
                [traegerId],
            )
        )[0];
    };
    const spalte = async (tabelle: "place" | "territory" | "region", id: string): Promise<string> =>
        (await database.unsafe<{ name: string }[]>(`SELECT name FROM ${tabelle} WHERE public_id = $1::uuid`, [id]))[0]!
            .name;
    const zahlOperationen = async (): Promise<number> =>
        Number((await database<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)[0]!.n);
    const operation = async (operationId: string) =>
        (
            await database<{ action: string; source: string; summary: string | null }[]>`
                SELECT action, source, summary FROM map_operation WHERE operation_id = ${operationId}::uuid`
        )[0];
    const eintraege = (operationId: string) =>
        database<
            {
                action: string;
                revision_before: number | null;
                revision_after: number | null;
                changes: Record<string, { before?: unknown; after?: unknown }>;
            }[]
        >`
            SELECT action, revision_before::int, revision_after::int, changes
              FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
    const zurueckgenommen = async (operationId: string): Promise<string[]> =>
        (
            await database<{ id: string }[]>`
                SELECT reverted_operation_id::text AS id FROM map_operation_revert_link
                 WHERE restore_operation_id = ${operationId}::uuid ORDER BY position`
        ).map((zeile) => zeile.id);
    const quelleRevision = async (id: string): Promise<number> =>
        Number(
            (
                await database<
                    { r: string }[]
                >`SELECT revision::text AS r FROM feature_source WHERE public_id = ${id}::uuid`
            )[0]!.r,
        );
    const quelleNotiz = async (id: string): Promise<string | null> =>
        (
            await database<
                { n: string | null }[]
            >`SELECT editor_note AS n FROM feature_source WHERE public_id = ${id}::uuid`
        )[0]!.n;

    beforeAll(async () => {
        database = createDatabase(url as string, { max: 6 });
        await migrate(database);
        fixture = authFixture(database);
        const a = await fixture.person("editor", { name: "Anna Quellen" });
        const b = await fixture.person("editor", { name: "Bernd Quellen" });
        cookies.anna = (await fixture.session(a.id, { passkeyMinutesAgo: 1 })).cookie;
        cookies.bernd = (await fixture.session(b.id, { passkeyMinutesAgo: 1 })).cookie;
        anna = { kind: "person", personId: a.id, environment: "test" };
        bernd = { kind: "person", personId: b.id, environment: "test" };
        annaLeser = { personId: a.id, rechte: ALLE };
        berndLeser = { personId: b.id, rechte: ALLE };
        app = buildApp({
            config,
            database: createDatabase(url as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 300_000);

    beforeEach(baueAuf, 120_000);

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await fixture?.cleanup();
        await database.end({ timeout: 5 });
    });

    // ---------------------------------------------------------------------------------------------------------------------------
    describe("Ort: Felder und Quellen in einer Serie", () => {
        it("🔴 eine Serie aus Feldern und Quellen geht in EINER Rücknahme auf den ersten Vorher-Stand beider zurück: Name, angelegte Verknüpfung still gelegt, geänderte auf ihre Angaben, Etikett neu", async () => {
            // Vor der Serie ist noch kein Etikett gerechnet (die Fixture schreibt die Verknüpfung von Hand).
            const kanonVorher = await kanon("place", P3.ort);
            const m1 = await ortFelder(cookies.anna, { name: "P3T Ort Neu" });
            const m2 = await haengeAn(anna, "place", P3.ort, q1);
            const m3 = await traegerQuellen(anna, "place", P3.ort, [
                { op: "update", sourceId: q3, vorher: GESEHEN_LEGACY, pages: "99", note: "neu" },
            ]);
            // Die Serie hat das Etikett verändert (eine offizielle Quelle mit Art des Belegs: Rang 2).
            expect(await kanon("place", P3.ort)).toEqual({ canon: "official", designator_type: "regelbuch" });
            expect(kanonVorher).not.toEqual(await kanon("place", P3.ort));
            const mitglieder = [m1, m2, m3];

            const vor = await vorschauOrt(database, P3.ort, vorbody(mitglieder), annaLeser);
            expect(vor.ergebnis).toBe("ok");
            expect(Value.Check(RuecknahmePruefung, vor)).toBe(true);
            // Die Quellen führen keine Revision des Orts: Die erwartete Revision bleibt die nach dem letzten Feld (kein Konflikt `revision`).
            expect(vor.gegenstaende).toEqual([
                expect.objectContaining({
                    kind: "place",
                    id: P3.ort,
                    erwarteteRevision: vor.gegenstaende[0]!.istRevision,
                }),
            ]);
            expect(vor.folgen).toMatchObject({ gelaende: "keines" });

            const operationId = neu();
            const quittung = await ruecknehmenOrt(
                database,
                anna,
                annaLeser,
                P3.ort,
                koerper(mitglieder, { operationId }),
            );
            expect(Value.Check(RuecknahmeReceipt, quittung)).toBe(true);
            expect(quittung.reverts).toEqual(mitglieder);

            expect(await spalte("place", P3.ort)).toBe("P3T Ort Eins");
            // Die Verknüpfung, die die Serie anlegte: still gelegt, nie gelöscht.
            expect(await zahlZeilen("place", P3.ort, q1)).toBe(1);
            expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({
                state: "retired",
                is_active: false,
                retired_origin: "editor",
                source_system: "editor",
            });
            // Die Verknüpfung aus Legacy: Angaben wie vor der Serie.
            expect(await verknuepfung("place", P3.ort, q3)).toMatchObject({
                state: "active",
                is_active: true,
                reference_kind: "erwaehnung",
                pages: "7",
                note: null,
                source_system: "editor",
            });
            // Ohne die offizielle Quelle bleibt die aus Legacy (Rang 3): Das Etikett ist neu gerechnet, nicht das der Serie.
            expect(await kanon("place", P3.ort)).toEqual({ canon: "unofficial", designator_type: "briefspiel" });
            expect(kanonVorher).toBeUndefined();

            expect(await operation(operationId)).toMatchObject({ action: "place.restore_series", source: "restore" });
            expect(await zurueckgenommen(operationId)).toEqual(mitglieder);
            const protokoll = await eintraege(operationId);
            expect(protokoll.map((e) => e.action).sort()).toEqual(["place.sources_changed", "place.updated"]);
            const quellenEintrag = protokoll.find((e) => e.action === "place.sources_changed")!;
            expect(quellenEintrag.revision_before).toBeNull();
            // Je Quelle vorher und nachher.
            const nachId = (liste: unknown): Record<string, unknown> =>
                Object.fromEntries((liste as { sourceId: string }[]).map((zeile) => [zeile.sourceId, zeile]));
            const vorherListe = nachId(quellenEintrag.changes["quellen"]!.before);
            const nachherListe = nachId(quellenEintrag.changes["quellen"]!.after);
            expect(vorherListe[q1]).toMatchObject({ state: "active", pages: "S. 12" });
            expect(vorherListe[q3]).toMatchObject({ state: "active", pages: "99", note: "neu" });
            expect(nachherListe[q1]).toMatchObject({ title: "P3T Quelle Eins", state: "retired" });
            expect(nachherListe[q3]).toMatchObject({ state: "active", pages: "7", note: null });
        });

        it("🔴 nur Quellen gehen über die Naht der Inhalte: kein Ereignis `map.changed`, keine Kachelrevision in der Quittung", async () => {
            const m1 = await haengeAn(anna, "place", P3.ort, q1);
            const quittung = await ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m1]));
            expect(quittung.mapRevision).toBeUndefined();
            expect(quittung.affected).toEqual([expect.objectContaining({ kind: "place", id: P3.ort })]);
            expect(quittung.derivedWork).toEqual([]);
            expect((await verknuepfung("place", P3.ort, q1))?.state).toBe("retired");
            // Mit Feldern dagegen läuft die Naht der Karte (Ereignis und Kachelrevision).
            const f = await ortFelder(cookies.anna, { name: "P3T Ort Zwei" });
            const q = await haengeAn(anna, "place", P3.ort, q2);
            const gemischt = await ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([f, q]));
            expect(gemischt.mapRevision).toBeGreaterThan(0);
        });

        it("🔴 eine gelöste (Legacy: unterdrückte) Verknüpfung wird belebt, eine angelegte und wieder gelöste bleibt still", async () => {
            const loesen = await traegerQuellen(anna, "place", P3.ort, [
                { op: "remove", sourceId: q3, vorher: GESEHEN_LEGACY },
            ]);
            const anlegen = await haengeAn(anna, "place", P3.ort, q2);
            const wieder = await traegerQuellen(anna, "place", P3.ort, [
                {
                    op: "remove",
                    sourceId: q2,
                    vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "S. 12", note: null },
                },
            ]);
            expect(await verknuepfung("place", P3.ort, q3)).toMatchObject({ state: "suppressed", is_active: false });
            await ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([loesen, anlegen, wieder]));
            expect(await verknuepfung("place", P3.ort, q3)).toMatchObject({
                state: "active",
                is_active: true,
                retired_origin: null,
                reference_kind: "erwaehnung",
                pages: "7",
            });
            expect(await zahlZeilen("place", P3.ort, q2)).toBe(1);
            expect(await verknuepfung("place", P3.ort, q2)).toMatchObject({ state: "retired", is_active: false });
        });

        it("🔴 einzeln nur das letzte offene Mitglied: ein früheres ist „überholt“ und schreibt nichts", async () => {
            const m1 = await haengeAn(anna, "place", P3.ort, q1);
            const m2 = await haengeAn(anna, "place", P3.ort, q2);
            const vor = await vorschauOrt(database, P3.ort, vorbody([m1]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte.map((k) => k.art)).toContain("ueberholt");
            const stand = await zahlOperationen();
            expect(await fehler(ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m1])))).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await zahlOperationen()).toBe(stand);
            // Das letzte geht.
            await ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m2]));
            expect((await verknuepfung("place", P3.ort, q2))?.state).toBe("retired");
            expect((await verknuepfung("place", P3.ort, q1))?.state).toBe("active");
        });
    });

    // ---------------------------------------------------------------------------------------------------------------------------
    describe("Konflikt: streng, ganz oder gar nicht", () => {
        it("🔴 eine spätere Operation einer anderen Person am Ort ist ein Konflikt `spaeter`: 409, nichts geschrieben", async () => {
            const m1 = await haengeAn(anna, "place", P3.ort, q1);
            await traegerQuellen(bernd, "place", P3.ort, [
                {
                    op: "update",
                    sourceId: q1,
                    vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "S. 12", note: null },
                    pages: "S. 40",
                },
            ]);
            const vor = await vorschauOrt(database, P3.ort, vorbody([m1]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte.map((k) => k.art)).toContain("spaeter");
            const stand = await zahlOperationen();
            expect(await fehler(ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m1])))).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await zahlOperationen()).toBe(stand);
            expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({ state: "active", pages: "S. 40" });
        });

        it("🔴 eine Änderung der Zeile OHNE Operation am Ort (sie kam von der Quelle her, `source.update`) ist ein Konflikt `wert` am Feld `quellen`: nichts geschrieben", async () => {
            const m1 = await haengeAn(anna, "place", P3.ort, q1);
            // Bernd ändert die Seiten dieser Verwendung im Fenster „Inhalte bearbeiten“: `source.update` schreibt am Ort keinen Eintrag.
            await aendereQuelle(database, bernd, q1, {
                operationId: neu(),
                baseRevision: await quelleRevision(q1),
                links: [{ op: "update", kind: "place", carrierId: P3.ort, pages: "S. 77" }],
            });
            const vor = await vorschauOrt(database, P3.ort, vorbody([m1]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte).toEqual([
                expect.objectContaining({
                    art: "wert",
                    kind: "place",
                    id: P3.ort,
                    felder: ["quellen"],
                    abweichung: { was: "felder" },
                }),
            ]);
            const stand = await zahlOperationen();
            expect(await fehler(ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m1])))).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await zahlOperationen()).toBe(stand);
            expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({ state: "active", pages: "S. 77" });
        });

        it("🔴 sollte eine Verwendung wieder aktiv werden, darf die Quelle nicht inzwischen stillgelegt sein (wie beim Anhängen): Konflikt, nichts geschrieben", async () => {
            const m1 = await traegerQuellen(anna, "place", P3.ort, [
                { op: "remove", sourceId: q3, vorher: GESEHEN_LEGACY },
            ]);
            await database`UPDATE feature_source SET is_active = FALSE, retired_at = now(), retired_origin = 'editor' WHERE public_id = ${q3}::uuid`;
            const vor = await vorschauOrt(database, P3.ort, vorbody([m1]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte[0]).toMatchObject({ art: "wert", kind: "place", felder: ["quellen"] });
            expect(await fehler(ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m1])))).toMatchObject({
                statusCode: 409,
            });
            expect((await verknuepfung("place", P3.ort, q3))?.state).toBe("suppressed");
        });
    });

    // ---------------------------------------------------------------------------------------------------------------------------
    describe("Wiederholung, fremde Person, Rechte, Rücknahme der Rücknahme", () => {
        it("🔴 dieselbe Kennung noch einmal gibt die erste Quittung zurück (`replayed`); eine neue Kennung für dieselben Mitglieder ist `already_reverted`", async () => {
            const m1 = await haengeAn(anna, "place", P3.ort, q1);
            const operationId = neu();
            const erste = await ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m1], { operationId }));
            expect(erste.status).toBe("applied");
            const stand = await zahlOperationen();
            const noch = await ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m1], { operationId }));
            expect(noch.status).toBe("replayed");
            expect(noch.operationId).toBe(erste.operationId);
            expect(await zahlOperationen()).toBe(stand);
            expect(await fehler(ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m1])))).toMatchObject({
                statusCode: 409,
                code: "already_reverted",
            });
        });

        it("🔴 eine fremde Person ohne Grund: 400 `reason_required`, nichts geschrieben; mit Grund geht es, und der Grund steht an jedem Eintrag", async () => {
            const m1 = await haengeAn(anna, "place", P3.ort, q1);
            const stand = await zahlOperationen();
            expect(await fehler(ruecknehmenOrt(database, bernd, berndLeser, P3.ort, koerper([m1])))).toMatchObject({
                statusCode: 400,
                code: "reason_required",
            });
            expect(await zahlOperationen()).toBe(stand);
            expect((await verknuepfung("place", P3.ort, q1))?.state).toBe("active");
            const operationId = neu();
            await ruecknehmenOrt(
                database,
                bernd,
                berndLeser,
                P3.ort,
                koerper([m1], { operationId, reason: "Falsche Quelle" }),
            );
            const protokoll = await eintraege(operationId);
            expect(protokoll).toHaveLength(1);
            expect(protokoll[0]!.changes["restoreReason"]).toEqual({ after: "Falsche Quelle" });
            expect((await verknuepfung("place", P3.ort, q1))?.state).toBe("retired");
        });

        it("🔴 Rechte: die Quellen verlangen `manage_sources`, die Felder `edit_map_objects`, eine gemischte Serie beide (403 sonst, nichts geschrieben)", async () => {
            const nurFelder: RuecknahmeLeser = {
                personId: annaLeser.personId,
                rechte: new Set<Capability>(["use_editor_menu", "edit_map_objects"]),
            };
            const nurQuellen: RuecknahmeLeser = {
                personId: annaLeser.personId,
                rechte: new Set<Capability>(["use_editor_menu", "manage_sources"]),
            };
            const felder = await ortFelder(cookies.anna, { name: "P3T Ort Recht" });
            const quellen = await haengeAn(anna, "place", P3.ort, q1);
            const stand = await zahlOperationen();

            // Gemischt: beide Rechte.
            for (const leser of [nurFelder, nurQuellen]) {
                const vor = await vorschauOrt(database, P3.ort, vorbody([felder, quellen]), leser);
                expect(vor.ergebnis).toBe("forbidden");
                expect(
                    await fehler(ruecknehmenOrt(database, anna, leser, P3.ort, koerper([felder, quellen]))),
                ).toMatchObject({
                    statusCode: 403,
                    code: "forbidden",
                });
            }
            expect((await vorschauOrt(database, P3.ort, vorbody([felder, quellen]), nurFelder)).fehlendeRechte).toEqual(
                ["manage_sources"],
            );
            expect(
                (await vorschauOrt(database, P3.ort, vorbody([felder, quellen]), nurQuellen)).fehlendeRechte,
            ).toEqual(["edit_map_objects"]);
            // Nur Quellen: `manage_sources` genügt, `edit_map_objects` allein nicht.
            expect(await fehler(ruecknehmenOrt(database, anna, nurFelder, P3.ort, koerper([quellen])))).toMatchObject({
                statusCode: 403,
            });
            expect(await zahlOperationen()).toBe(stand);
            expect((await vorschauOrt(database, P3.ort, vorbody([quellen]), nurQuellen)).ergebnis).toBe("ok");
            await ruecknehmenOrt(database, anna, nurQuellen, P3.ort, koerper([quellen]));
            expect((await verknuepfung("place", P3.ort, q1))?.state).toBe("retired");
        });

        it("🔴 die Rücknahme der Rücknahme einer gemischten Serie führt auf den Stand der Serie zurück: Name, Verknüpfungen und Angaben", async () => {
            const m1 = await ortFelder(cookies.anna, { name: "P3T Ort Neu" });
            const m2 = await haengeAn(anna, "place", P3.ort, q1);
            const m3 = await traegerQuellen(anna, "place", P3.ort, [
                { op: "update", sourceId: q3, vorher: GESEHEN_LEGACY, pages: "99" },
            ]);
            const kanonSerie = await kanon("place", P3.ort);
            const erste = neu();
            await ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([m1, m2, m3], { operationId: erste }));
            expect(await spalte("place", P3.ort)).toBe("P3T Ort Eins");
            // Die Rücknahme trägt Felder UND Quellen (`place.restore_series`): Sie ist selbst zurücknehmbar.
            const zweite = neu();
            const quittung = await ruecknehmenOrt(
                database,
                anna,
                annaLeser,
                P3.ort,
                koerper([erste], { operationId: zweite }),
            );
            expect(quittung.reverts).toEqual([erste]);
            expect(await spalte("place", P3.ort)).toBe("P3T Ort Neu");
            expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({
                state: "active",
                is_active: true,
                reference_kind: "ausfuehrlich",
                pages: "S. 12",
            });
            expect(await verknuepfung("place", P3.ort, q3)).toMatchObject({ state: "active", pages: "99" });
            expect(await kanon("place", P3.ort)).toEqual(kanonSerie);
            // Und die Originale gelten wieder als zurücknehmbar.
            const wieder = await vorschauOrt(database, P3.ort, vorbody([m1, m2, m3]), annaLeser);
            expect(wieder.ergebnis).toBe("ok");
        });

        it("🔴 über die Route: Vorprüfung und Rücknahme der Quellen eines Orts mit Schema, als Person mit Sitzung", async () => {
            const m1 = await haengeAn(anna, "place", P3.ort, q1);
            const vorschau = await sende(cookies.anna, "POST", editorPlaceRestoreSeriesPreviewUrl(P3.ort), {
                members: [m1],
                membersHash: mitgliederHash([m1]),
            });
            expect(vorschau.statusCode, vorschau.body).toBe(200);
            expect(Value.Check(RuecknahmePruefung, vorschau.json())).toBe(true);
            expect((vorschau.json() as Pruefung).ergebnis).toBe("ok");
            const antwort = await sende(cookies.anna, "POST", editorPlaceRestoreSeriesUrl(P3.ort), {
                operationId: neu(),
                members: [m1],
                membersHash: mitgliederHash([m1]),
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            expect(Value.Check(RuecknahmeReceipt, antwort.json())).toBe(true);
            expect((antwort.json() as Quittung).reverts).toEqual([m1]);
            expect((await verknuepfung("place", P3.ort, q1))?.state).toBe("retired");
        });
    });

    // ---------------------------------------------------------------------------------------------------------------------------
    describe("Gebiet, Landschaft und Weg", () => {
        it("🔴 Gebiet: Felder und Quellen in einer Serie, ganz oder gar nicht", async () => {
            const m1 = await gebietFelder(cookies.anna, { name: "P3T Gebiet Neu" });
            const m2 = await haengeAn(anna, "territory", P3.gebiet, q1);
            const m3 = await haengeAn(anna, "territory", P3.gebiet, q2, "S. 3");
            const vor = await vorschauGebiet(database, P3.gebiet, vorbody([m1, m2, m3]), annaLeser);
            expect(vor.ergebnis).toBe("ok");
            const quittung = await ruecknehmenGebiet(database, anna, annaLeser, P3.gebiet, koerper([m1, m2, m3]));
            expect(quittung.reverts).toEqual([m1, m2, m3]);
            expect(await spalte("territory", P3.gebiet)).toBe("P3T Gebiet");
            for (const q of [q1, q2]) {
                expect(await zahlZeilen("territory", P3.gebiet, q)).toBe(1);
                expect(await verknuepfung("territory", P3.gebiet, q)).toMatchObject({
                    state: "retired",
                    is_active: false,
                });
            }
            // Eine Rücknahme nur der Quellen: Naht der Inhalte.
            const nurQ = await haengeAn(anna, "territory", P3.gebiet, q3);
            const q = await ruecknehmenGebiet(database, anna, annaLeser, P3.gebiet, koerper([nurQ]));
            expect(q.mapRevision).toBeUndefined();
            expect((await verknuepfung("territory", P3.gebiet, q3))?.state).toBe("retired");
        });

        it("🔴 Landschaft: Felder und Quellen in einer Serie; die Vorschau nur der Quellen meldet kein Gelände (sie ändern weder Form noch Art)", async () => {
            const m1 = await landschaftFelder(cookies.anna, { name: "P3T Region Neu" });
            const m2 = await haengeAn(anna, "area", P3.region, q1);
            const vor = await vorschauFlaeche(database, P3.region, vorbody([m1, m2]), annaLeser);
            expect(vor.ergebnis).toBe("ok");
            const quittung = await ruecknehmenFlaeche(database, anna, annaLeser, P3.region, koerper([m1, m2]));
            expect(quittung.reverts).toEqual([m1, m2]);
            expect(await spalte("region", P3.region)).toBe("P3T Region Eins");
            expect(await verknuepfung("area", P3.region, q1)).toMatchObject({ state: "retired", is_active: false });
            // Die Landschaft hat einen Wiki-Artikel (Rang 1: offiziell, ohne Art des Belegs); ihr Etikett ist gerechnet und von der Quelle unabhängig.
            expect(await kanon("area", P3.region)).toEqual({ canon: "official", designator_type: null });

            // Nur Quellen: Die Vorschau sagt „kein Gelände“ (die Region liegt in der Topographie und speist es, ihre Quellen nicht).
            const nurQ = await haengeAn(anna, "area", P3.region, q2);
            const vorQ = await vorschauFlaeche(database, P3.region, vorbody([nurQ]), annaLeser);
            expect(vorQ.ergebnis).toBe("ok");
            expect(vorQ.folgen).toMatchObject({ gelaende: "keines" });
            const q = await ruecknehmenFlaeche(database, anna, annaLeser, P3.region, koerper([nurQ]));
            expect(q.mapRevision).toBeUndefined();
            expect(q.warnings).toEqual([]);
            expect((await verknuepfung("area", P3.region, q2))?.state).toBe("retired");
        });

        it("🔴 Weg: die Quelle geht auf der GANZEN Straße zurück (beide Abschnitte), eine angelegte wird auf allen still gelegt, nie gelöscht", async () => {
            const m1 = await haengeAn(anna, "path", P3.weg, q1, "S. 1");
            const m2 = await traegerQuellen(anna, "path", P3.weg, [
                {
                    op: "update",
                    sourceId: q1,
                    vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "S. 1", note: null },
                    pages: "S. 2",
                },
            ]);
            expect((await wegZeilen(q1)).map((z) => [z.carrier, z.state, z.pages])).toEqual([
                [P3.weg, "active", "S. 2"],
                [ABSCHNITT_ZWEI, "active", "S. 2"],
            ]);
            const vor = await vorschauWeg(database, P3.weg, vorbody([m1, m2]), annaLeser);
            expect(vor.ergebnis).toBe("ok");
            const operationId = neu();
            const quittung = await ruecknehmenWeg(
                database,
                anna,
                annaLeser,
                P3.weg,
                koerper([m1, m2], { operationId }),
            );
            expect(quittung.mapRevision).toBeUndefined();
            expect(quittung.affected.map((a) => a.id).sort()).toEqual([P3.weg, ABSCHNITT_ZWEI].sort());
            expect((await wegZeilen(q1)).map((z) => [z.carrier, z.state, z.is_active, z.source_system])).toEqual([
                [P3.weg, "retired", false, "editor"],
                [ABSCHNITT_ZWEI, "retired", false, "editor"],
            ]);
            // Der Eintrag am Anker nennt die Sicht der Straße vorher und nachher.
            const protokoll = await eintraege(operationId);
            expect(protokoll).toHaveLength(1);
            expect(protokoll[0]!.action).toBe("path.sources_changed");
            expect(protokoll[0]!.changes["quellen"]).toEqual({
                before: [expect.objectContaining({ sourceId: q1, state: "active", pages: "S. 2" })],
                after: [expect.objectContaining({ sourceId: q1, state: "retired" })],
            });
        });

        it("🔴 Weg: die Rücknahme der Rücknahme der Quellen führt die Straße auf den Stand der Serie zurück (aktiv auf allen Abschnitten, Angaben von damals)", async () => {
            const m1 = await haengeAn(anna, "path", P3.weg, q1, "S. 1");
            const erste = neu();
            await ruecknehmenWeg(database, anna, annaLeser, P3.weg, koerper([m1], { operationId: erste }));
            expect((await wegZeilen(q1)).map((z) => z.state)).toEqual(["retired", "retired"]);
            const zweite = neu();
            const quittung = await ruecknehmenWeg(
                database,
                anna,
                annaLeser,
                P3.weg,
                koerper([erste], { operationId: zweite }),
            );
            expect(quittung.reverts).toEqual([erste]);
            expect((await wegZeilen(q1)).map((z) => [z.carrier, z.state, z.pages, z.reference_kind])).toEqual([
                [P3.weg, "active", "S. 1", "ausfuehrlich"],
                [ABSCHNITT_ZWEI, "active", "S. 1", "ausfuehrlich"],
            ]);
            // Das Original gilt wieder als zurücknehmbar.
            expect((await vorschauWeg(database, P3.weg, vorbody([m1]), annaLeser)).ergebnis).toBe("ok");
        });

        it("🔴 Weg: eine Quelle, die vorher nur an EINEM Abschnitt stand (Legacy), kommt als Sicht der Straße zurück: auf allen Abschnitten mit den Angaben von damals", async () => {
            expect((await wegZeilen(q3)).map((z) => [z.carrier, z.state, z.pages])).toEqual([[P3.weg, "active", "7"]]);
            const m1 = await traegerQuellen(anna, "path", P3.weg, [
                { op: "update", sourceId: q3, vorher: GESEHEN_LEGACY, pages: "99" },
            ]);
            expect((await wegZeilen(q3)).map((z) => [z.carrier, z.pages])).toEqual([
                [P3.weg, "99"],
                [ABSCHNITT_ZWEI, "99"],
            ]);
            await ruecknehmenWeg(database, anna, annaLeser, P3.weg, koerper([m1]));
            // Die Sicht der Straße ist wieder die von damals (aktiv, Seite 7, Erwähnung); sie gilt nun überall (Grenze der Genauigkeit: das Protokoll kennt keine Abschnitte).
            expect((await wegZeilen(q3)).map((z) => [z.carrier, z.state, z.pages, z.reference_kind])).toEqual([
                [P3.weg, "active", "7", "erwaehnung"],
                [ABSCHNITT_ZWEI, "active", "7", "erwaehnung"],
            ]);
        });

        it("🔴 Weg: Felder und Quellen der Straße in einer Serie; eine Änderung der Straße seither (ohne Operation) hält die Rücknahme an", async () => {
            const m1 = await wegFelder(cookies.anna, { tunnel: true });
            const m2 = await haengeAn(anna, "path", P3.weg, q2);
            // Bernd ändert die Verwendung von der Quelle her (kein Eintrag am Weg).
            const stand = await zahlOperationen();
            await aendereQuelle(database, bernd, q2, {
                operationId: neu(),
                baseRevision: await quelleRevision(q2),
                links: [
                    {
                        op: "update",
                        kind: "path",
                        carrierId: P3.weg,
                        vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "S. 12", note: null },
                        pages: "S. 90",
                    },
                ],
            });
            const vor = await vorschauWeg(database, P3.weg, vorbody([m1, m2]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte.some((k) => k.art === "wert" && k.felder?.includes("quellen"))).toBe(true);
            const nachKonflikt = await zahlOperationen();
            expect(nachKonflikt).toBe(stand + 1);
            expect(await fehler(ruecknehmenWeg(database, anna, annaLeser, P3.weg, koerper([m1, m2])))).toMatchObject({
                statusCode: 409,
            });
            expect(await zahlOperationen()).toBe(nachKonflikt);
            expect((await wegZeilen(q2)).map((z) => [z.state, z.pages])).toEqual([
                ["active", "S. 90"],
                ["active", "S. 90"],
            ]);
        });

        it("🔴 Weg: die gemischte Serie geht, wenn nichts dazwischen kam: das Feld der Straße und die Quellen zurück", async () => {
            const m1 = await wegFelder(cookies.anna, { tunnel: true });
            const m2 = await haengeAn(anna, "path", P3.weg, q2);
            const vor = await vorschauWeg(database, P3.weg, vorbody([m1, m2]), annaLeser);
            expect(vor.ergebnis).toBe("ok");
            await ruecknehmenWeg(database, anna, annaLeser, P3.weg, koerper([m1, m2]));
            const [weg] = await database<
                { tunnel: boolean }[]
            >`SELECT is_tunnel AS tunnel FROM path WHERE public_id = ${P3.weg}::uuid`;
            expect(weg!.tunnel).toBe(false);
            expect((await wegZeilen(q2)).map((z) => z.state)).toEqual(["retired", "retired"]);
        });
    });

    // ---------------------------------------------------------------------------------------------------------------------------
    describe("source.update mit links (Verwendungen an mehreren Trägern)", () => {
        /** Eine Änderung vom Quellen-Fenster aus: ein Feld und eine Verwendung an Ort, Gebiet, Landschaft, Gipfel und Weg. */
        const mitVerwendungen = async (akteur: MapActor, quelle: string): Promise<string> => {
            const operationId = neu();
            await aendereQuelle(database, akteur, quelle, {
                operationId,
                baseRevision: await quelleRevision(quelle),
                fields: { editorNote: "Notiz der Redaktion" },
                links: [
                    { op: "add", kind: "place", carrierId: P3.ort, referenceKind: "ausfuehrlich", pages: "9" },
                    { op: "add", kind: "territory", carrierId: P3.gebiet, referenceKind: "ausfuehrlich", pages: "9" },
                    { op: "add", kind: "area", carrierId: P3.region, referenceKind: "ausfuehrlich", pages: "9" },
                    { op: "add", kind: "peak", carrierId: P3.gipfel, referenceKind: "ausfuehrlich", pages: "9" },
                    {
                        op: "add",
                        kind: "path",
                        carrierId: P3.weg,
                        vorher: null,
                        referenceKind: "ausfuehrlich",
                        pages: "9",
                    },
                ],
            });
            return operationId;
        };
        const verwendungen = async (quelle: string) => ({
            ort: (await verknuepfung("place", P3.ort, quelle))?.state,
            gebiet: (await verknuepfung("territory", P3.gebiet, quelle))?.state,
            region: (await verknuepfung("area", P3.region, quelle))?.state,
            gipfel: (await verknuepfung("peak", P3.gipfel, quelle))?.state,
            weg: (await wegZeilen(quelle)).map((z) => z.state),
        });

        it("🔴 eine Änderung mit Feld und Verwendungen an fünf Trägern geht in EINER Rücknahme zurück: das Feld, jede Verknüpfung still gelegt, die Revision der Quelle zählt einmal, das Etikett neu", async () => {
            // Vor der Änderung ist noch kein Etikett gerechnet; danach trägt der Ort die offizielle Quelle (Rang 2).
            expect(await kanon("place", P3.ort)).toBeUndefined();
            const revisionVorher = await quelleRevision(q1);
            const m1 = await mitVerwendungen(anna, q1);
            expect(await quelleRevision(q1)).toBe(revisionVorher + 1);
            expect(await verwendungen(q1)).toEqual({
                ort: "active",
                gebiet: "active",
                region: "active",
                gipfel: "active",
                weg: ["active", "active"],
            });
            const kanonSerie = await kanon("place", P3.ort);
            expect(kanonSerie).toEqual({ canon: "official", designator_type: "regelbuch" });

            const vor = await vorschauQuelle(database, q1, vorbody([m1]), annaLeser);
            expect(vor.ergebnis).toBe("ok");
            expect(Value.Check(RuecknahmePruefung, vor)).toBe(true);
            const operationId = neu();
            const quittung = await ruecknehmenQuelle(database, anna, annaLeser, q1, koerper([m1], { operationId }));
            expect(Value.Check(RuecknahmeReceipt, quittung)).toBe(true);

            expect(await quelleNotiz(q1)).toBeNull();
            expect(await verwendungen(q1)).toEqual({
                ort: "retired",
                gebiet: "retired",
                region: "retired",
                gipfel: "retired",
                weg: ["retired", "retired"],
            });
            // Nie gelöscht.
            for (const [art, traeger] of [
                ["place", P3.ort],
                ["territory", P3.gebiet],
                ["area", P3.region],
                ["peak", P3.gipfel],
            ] as const)
                expect(await zahlZeilen(art, traeger, q1), art).toBe(1);
            // Genau EINE Revision, wie das Original; `source.updated` hält die Verwendungen in `changes.links` fest, die Straße zusätzlich am Anker.
            expect(await quelleRevision(q1)).toBe(revisionVorher + 2);
            const protokoll = await eintraege(operationId);
            expect(protokoll.map((e) => e.action).sort()).toEqual(["path.sources_changed", "source.updated"]);
            const quelleEintrag = protokoll.find((e) => e.action === "source.updated")!;
            expect(quelleEintrag.revision_after).toBe(revisionVorher + 2);
            expect((quelleEintrag.changes["links"]!.after as { state: string }[]).map((l) => l.state)).toEqual([
                "retired",
                "retired",
                "retired",
                "retired",
                "retired",
            ]);
            expect(quelleEintrag.changes["editorNote"]).toEqual({ before: "Notiz der Redaktion", after: null });
            // Ohne die offizielle Quelle bleibt die aus Legacy (Rang 3): neu gerechnet in derselben Transaktion.
            expect(await kanon("place", P3.ort)).toEqual({ canon: "unofficial", designator_type: "briefspiel" });
            expect(await operation(operationId)).toMatchObject({ action: "source.restore_series", source: "restore" });
            // Die Quittung nennt auch die Träger (ein offenes Fenster liest seine Quellen danach neu).
            expect(quittung.affected.map((a) => a.kind).sort()).toEqual(
                ["landscape", "path", "path", "peak", "place", "source", "territory"].sort(),
            );
            expect(quittung.mapRevision).toBeUndefined();
        });

        it("🔴 ein Träger passt nicht mehr: ALLE werden geprüft, keiner geschrieben (409, die Verwendungen der anderen Träger und das Feld bleiben)", async () => {
            const m1 = await mitVerwendungen(anna, q1);
            // Bernd ändert die Verwendung am Gebiet vom Gebiet her.
            await traegerQuellen(bernd, "territory", P3.gebiet, [
                {
                    op: "update",
                    sourceId: q1,
                    vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "9", note: null },
                    pages: "10",
                },
            ]);
            const revisionNach = await quelleRevision(q1);
            const vor = await vorschauQuelle(database, q1, vorbody([m1]), annaLeser);
            expect(vor.ergebnis).toBe("edit_conflict");
            expect(vor.konflikte).toEqual([
                expect.objectContaining({
                    art: "wert",
                    kind: "source",
                    id: q1,
                    felder: ["links"],
                    abweichung: { was: "felder" },
                }),
            ]);
            const stand = await zahlOperationen();
            expect(await fehler(ruecknehmenQuelle(database, anna, annaLeser, q1, koerper([m1])))).toMatchObject({
                statusCode: 409,
                code: "edit_conflict",
            });
            expect(await zahlOperationen()).toBe(stand);
            expect(await quelleRevision(q1)).toBe(revisionNach);
            expect(await quelleNotiz(q1)).toBe("Notiz der Redaktion");
            expect(await verwendungen(q1)).toEqual({
                ort: "active",
                gebiet: "active",
                region: "active",
                gipfel: "active",
                weg: ["active", "active"],
            });
        });

        it("🔴 eine Verwendung, die ein früherer Stand gelöst hatte, wird belebt (mit ihren Angaben); die Rücknahme der Rücknahme führt auf den Stand der Änderung zurück", async () => {
            // Vorher ist q3 am Ort aus Legacy aktiv (Seite 7); die Änderung löst sie und legt q3 am Gebiet an.
            const operationId = neu();
            await aendereQuelle(database, anna, q3, {
                operationId,
                baseRevision: await quelleRevision(q3),
                links: [
                    { op: "remove", kind: "place", carrierId: P3.ort },
                    { op: "add", kind: "territory", carrierId: P3.gebiet, referenceKind: "ergaenzend", pages: "3" },
                ],
            });
            expect((await verknuepfung("place", P3.ort, q3))?.state).toBe("suppressed");
            const erste = neu();
            await ruecknehmenQuelle(database, anna, annaLeser, q3, koerper([operationId], { operationId: erste }));
            expect(await verknuepfung("place", P3.ort, q3)).toMatchObject({
                state: "active",
                is_active: true,
                reference_kind: "erwaehnung",
                pages: "7",
                source_system: "editor",
            });
            expect((await verknuepfung("territory", P3.gebiet, q3))?.state).toBe("retired");
            // Und zurück zur Rücknahme.
            await ruecknehmenQuelle(database, anna, annaLeser, q3, koerper([erste]));
            expect((await verknuepfung("place", P3.ort, q3))?.state).toBe("suppressed");
            expect(await verknuepfung("territory", P3.gebiet, q3)).toMatchObject({
                state: "active",
                reference_kind: "ergaenzend",
                pages: "3",
            });
        });

        it("🔴 Recht: ohne `manage_sources` 403; eine fremde Person braucht einen Grund", async () => {
            const m1 = await mitVerwendungen(anna, q1);
            const ohne: RuecknahmeLeser = {
                personId: annaLeser.personId,
                rechte: new Set<Capability>(["use_editor_menu"]),
            };
            expect(await fehler(ruecknehmenQuelle(database, anna, ohne, q1, koerper([m1])))).toMatchObject({
                statusCode: 403,
            });
            expect(await fehler(ruecknehmenQuelle(database, bernd, berndLeser, q1, koerper([m1])))).toMatchObject({
                statusCode: 400,
                code: "reason_required",
            });
            expect((await verwendungen(q1)).ort).toBe("active");
            await ruecknehmenQuelle(database, bernd, berndLeser, q1, koerper([m1], { reason: "Irrtum" }));
            expect((await verwendungen(q1)).ort).toBe("retired");
        });

        it("🔴 die Änderung einer Quelle und die Quellen am Ort sind getrennte Serien: Jede geht für sich zurück, die andere bleibt", async () => {
            const amOrt = await haengeAn(anna, "place", P3.ort, q2);
            const vonQuelle = neu();
            await aendereQuelle(database, anna, q1, {
                operationId: vonQuelle,
                baseRevision: await quelleRevision(q1),
                links: [{ op: "add", kind: "place", carrierId: P3.ort, referenceKind: "ausfuehrlich", pages: "1" }],
            });
            await ruecknehmenQuelle(database, anna, annaLeser, q1, koerper([vonQuelle]));
            expect((await verknuepfung("place", P3.ort, q1))?.state).toBe("retired");
            expect((await verknuepfung("place", P3.ort, q2))?.state).toBe("active");
            await ruecknehmenOrt(database, anna, annaLeser, P3.ort, koerper([amOrt]));
            expect((await verknuepfung("place", P3.ort, q2))?.state).toBe("retired");
        });
    });
});
