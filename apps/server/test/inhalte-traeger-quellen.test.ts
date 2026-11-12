import { createHash, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    InhalteTraegerQuellen,
    OperationReceipt,
    inhalteTraegerQuellenUrl,
    type InhalteTraegerQuellenArt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { pathHistory } from "../src/editor/history.ts";
import { readEditorPathStreet } from "../src/editor/path-list.ts";
import { leseTraegerQuellen } from "../src/inhalte/traeger-quellen-lesen.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { cleanP3Fixtures, insertP3Carriers, P3, p3Id } from "./support/p3-fixture.ts";

/**
 * Die Quellen eines Kartenobjekts in den Editoren (WI-0254 §12, Migration 0066 und 0232): lesen und schreiben für Ort, Herrschaftsgebiet, Landschaft, Gipfel (auch eine Landmarke ohne Gelände, WI-0271 L4) und die ganze Straße eines Wegs.
 * Gegen die Wegwerf-Datenbank der Testläufe (`TEST_DATABASE_URL`), über Fastify mit echten Sitzungen; die Rechte der App-Rolle prüft der Rauchtest der Schreibwege.
 *
 * Problemfälle: ein Speichern überschreibt still, was ein anderer inzwischen geändert hat; ein halb gelungenes Speichern bleibt stehen; die Revision des Objekts steigt (der Weg schreibt
 * sie nicht); eine Verknüpfung aus Legacy wird gelöscht statt unterdrückt; das Etikett des Objekts bleibt auf dem alten Stand; an ein stilles Objekt oder eine stillgelegte Quelle hängt
 * etwas an; ein Reviewer schreibt; das Zitat des Wikis fehlt oder steht für den falschen Lauf da; eine Straße zeigt nur einen Abschnitt; **ein Weg bleibt nach dem Speichern uneinheitlich
 * (die Quelle hängt an einem Teil der Abschnitte, mit verschiedenen Angaben), zwei Speichern derselben Straße von verschiedenen Abschnitten aus überholen sich, der Verlauf der Straße
 * findet die Änderung nicht.**
 */

const url = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = url ? describe : describe.skip;
const MARKE = "test-wi0254-tq";
const HOST = "https://p3test.example";
const operationen: string[] = [];
const neu = (): string => {
    const id = randomUUID();
    operationen.push(id);
    return id;
};
/** Ein inaktiver Ort und ein zweiter Abschnitt der Straße „P3T Weg Eins“ (beide tragen die Vorsilbe der Fixture und gehen mit ihr). */
const ORT_STILL = p3Id(0xf2);
const ABSCHNITT_ZWEI = p3Id(0xf1);
/** Eine Straße mit drei Abschnitten für das Schreiben („P3T Weg Quellen“) und eine, die von der Karte genommen ist („P3T Weg Still“). */
const WEG_DREI = [p3Id(0xf3), p3Id(0xf4), p3Id(0xf5)] as const;
const WEG_STILL = p3Id(0xf6);
/** Eine Höhle (Landmarke ohne Gelände) neben `P3.gipfel` (Berggipfel) und `P3.gipfelInaktiv`. */
const HOEHLE = p3Id(0xf7);

type Art = Exclude<InhalteTraegerQuellenArt, "path">;
const TAFELN = {
    place: { link: "place_source", fk: "place_id", traeger: "place", kanon: "place_canon" },
    territory: { link: "territory_source", fk: "territory_id", traeger: "territory", kanon: "territory_canon" },
    area: { link: "region_source", fk: "region_id", traeger: "region", kanon: "region_canon" },
    peak: { link: "terrain_peak_source", fk: "terrain_peak_id", traeger: "terrain_peak", kanon: "terrain_peak_canon" },
} as const;

describeWithDatabase("Quellen eines Kartenobjekts in den Editoren (WI-0254 §12)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let aus: FastifyInstance;
    let fixture: AuthFixture;
    const cookies = { editor: "", reviewer: "", tester: "" };
    let q1 = "";
    let q2 = "";
    let q3 = "";
    let q4 = "";

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "tq",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };

    const aufraeumen = async (): Promise<void> => {
        await cleanP3Fixtures(database);
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM wikisync_lauf WHERE parser_version = ${MARKE}`;
    };

    const quelleAnlegen = async (
        titel: string,
        pfad: string,
        art: string,
        offiziell: boolean,
        still = false,
    ): Promise<string> => {
        const adresse = `${HOST}/${pfad}`;
        const schluessel = `url:${createHash("sha256").update(adresse, "utf8").digest("hex")}`;
        const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system, is_active, retired_at, retired_origin)
            VALUES (${schluessel}, 'final', ${adresse}, ${titel}, ${art}, ${offiziell}, ${MARKE}, ${!still},
                    ${still ? new Date() : null}, ${still ? "editor" : null})
            RETURNING public_id::text
        `;
        return zeile!.public_id;
    };

    const holen = (art: string, id: string, wer?: string, server: FastifyInstance = app) =>
        server.inject({
            method: "GET",
            url: inhalteTraegerQuellenUrl(art, id),
            headers: wer === undefined ? {} : { cookie: wer },
        });
    const schreiben = (
        art: string,
        id: string,
        body: object,
        wer: string = cookies.editor,
        server: FastifyInstance = app,
    ) =>
        server.inject({
            method: "POST",
            url: inhalteTraegerQuellenUrl(art, id),
            headers: { cookie: wer, origin: TEST_ORIGIN },
            payload: body,
        });
    const lesen = async (art: string, id: string): Promise<InhalteTraegerQuellen> => {
        const antwort = await holen(art, id, cookies.editor);
        expect(antwort.statusCode).toBe(200);
        const json = antwort.json<InhalteTraegerQuellen>();
        expect([...Value.Errors(InhalteTraegerQuellen, json)].map((e) => e.path)).toEqual([]);
        return json;
    };
    const aendern = (aenderungen: object[], operationId = neu()) => ({ operationId, aenderungen });

    const verknuepfung = async (art: Art, traegerId: string, quelleId: string) => {
        const t = TAFELN[art];
        const [zeile] = await database.unsafe<
            {
                state: string;
                is_active: boolean;
                source_system: string;
                reference_kind: string | null;
                pages: string | null;
                note: string | null;
                position: number;
                retired_origin: string | null;
            }[]
        >(
            `SELECT l.state, l.is_active, l.source_system, l.reference_kind, l.pages, l.note, l.position, l.retired_origin
               FROM ${t.link} l
               JOIN ${t.traeger} c ON c.id = l.${t.fk}
               JOIN feature_source f ON f.id = l.source_id
              WHERE c.public_id = $1::uuid AND f.public_id = $2::uuid`,
            [traegerId, quelleId],
        );
        return zeile;
    };
    const zahlVerknuepfungen = async (art: Art, traegerId: string, quelleId: string): Promise<number> => {
        const t = TAFELN[art];
        const [zeile] = await database.unsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM ${t.link} l JOIN ${t.traeger} c ON c.id = l.${t.fk}
               JOIN feature_source f ON f.id = l.source_id WHERE c.public_id = $1::uuid AND f.public_id = $2::uuid`,
            [traegerId, quelleId],
        );
        return zeile!.n;
    };
    const kanon = async (art: Art, traegerId: string) => {
        const t = TAFELN[art];
        const [zeile] = await database.unsafe<{ canon: string; designator_type: string | null }[]>(
            `SELECT k.canon, k.designator_type FROM ${t.kanon} k JOIN ${t.traeger} c ON c.id = k.${t.fk} WHERE c.public_id = $1::uuid`,
            [traegerId],
        );
        return zeile;
    };
    const revision = async (art: Art, traegerId: string): Promise<number> => {
        const [zeile] = await database.unsafe<{ revision: number }[]>(
            `SELECT revision::int AS revision FROM ${TAFELN[art].traeger} WHERE public_id = $1::uuid`,
            [traegerId],
        );
        return zeile!.revision;
    };
    const protokoll = (operationId: string) =>
        database<
            {
                action: string;
                revision_before: number | null;
                revision_after: number | null;
                place_public_id: string | null;
                territory_public_id: string | null;
                region_public_id: string | null;
                peak_public_id: string | null;
                changes: { quellen?: { before: Record<string, unknown>[]; after: Record<string, unknown>[] } };
            }[]
        >`
            SELECT action, revision_before::int, revision_after::int, place_public_id::text, territory_public_id::text, region_public_id::text, peak_public_id::text, changes
              FROM map_audit_event WHERE operation_id = ${operationId}::uuid
        `;
    const operation = async (operationId: string) => {
        const [zeile] = await database<{ action: string; summary: string | null }[]>`
            SELECT action, summary FROM map_operation WHERE operation_id = ${operationId}::uuid
        `;
        return zeile;
    };

    beforeAll(async () => {
        database = createDatabase(url as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        await insertP3Carriers(database);
        // Ein stilles Objekt und ein zweiter Abschnitt der Straße „P3T Weg Eins“ (der erste Abschnitt ist `P3.weg`).
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT_STILL}, 'aventuria', 'P3T Ort Still', 'stadt', ST_SetSRID(ST_MakePoint(305, 300), 0), 'test', FALSE)
        `;
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (${ABSCHNITT_ZWEI}, 'aventuria', 'P3T Weg Eins', 'Strasse', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(310, 310), ST_MakePoint(320, 310)), 0), 'test', TRUE)
        `;
        // Die Straße „P3T Weg Quellen“: drei Abschnitte hintereinander; daneben eine Straße, die von der Karte genommen ist.
        for (const [nummer, abschnitt] of WEG_DREI.entries()) {
            await database`
                INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
                VALUES (${abschnitt}, 'aventuria', 'P3T Weg Quellen', 'Strasse', FALSE,
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(${360 + nummer * 10}, 360), ST_MakePoint(${370 + nummer * 10}, 360)), 0), 'test', TRUE)
            `;
        }
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active, off_map)
            VALUES (${WEG_STILL}, 'aventuria', 'P3T Weg Still', 'Strasse', FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(400, 360), ST_MakePoint(410, 360)), 0), 'test', FALSE, TRUE)
        `;
        // Eine Höhle: eine Landmarke ohne Gelände, ohne Höhe.
        await database`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${HOEHLE}, 'aventuria', 'P3T Höhle', 'hoehle', ST_SetSRID(ST_MakePoint(342, 340), 0), 'test', TRUE)
        `;
        q1 = await quelleAnlegen("P3T Quelle Eins", "eins", "regelbuch", true);
        q2 = await quelleAnlegen("P3T Quelle Zwei", "zwei", "briefspiel", false);
        q3 = await quelleAnlegen("P3T Quelle Drei", "drei", "briefspiel", false);
        q4 = await quelleAnlegen("P3T Quelle Still", "still", "briefspiel", false, true);
        // Eine Verknüpfung aus Legacy am Ort: Seite 7, „Erwähnung“.
        await database`
            INSERT INTO place_source (place_id, source_id, reference_kind, pages, position, source_system)
            SELECT p.id, f.id, 'erwaehnung', '7', 0, 'legacy' FROM place p, feature_source f
             WHERE p.public_id = ${P3.ort}::uuid AND f.public_id = ${q3}::uuid
        `;
        fixture = authFixture(database);
        for (const rolle of ["tester", "reviewer", "editor"] as const) {
            const person = await fixture.person(rolle, { name: `TQ ${rolle}` });
            cookies[rolle] = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        }
        app = buildApp({
            config,
            database: createDatabase(url as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        aus = buildApp({
            config: { ...config, mapEditing: "off" },
            database: createDatabase(url as string, { max: 2 }),
            logStream: { write: () => undefined },
        });
        await aus.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await aus?.close();
        await aufraeumen();
        await fixture?.cleanup();
        await database.end({ timeout: 5 });
    });

    // -----------------------------------------------------------------------------------------------------------------
    // Lesen
    // -----------------------------------------------------------------------------------------------------------------

    it("🔴 Lesen: alle Zustände mit Reihenfolge, eine stillgelegte Quelle fehlt, ohne Lauf des Wikis ist `wiki` überall null", async () => {
        await database`
            INSERT INTO place_source (place_id, source_id, reference_kind, position, source_system)
            SELECT p.id, f.id, 'erwaehnung', 5, 'legacy' FROM place p, feature_source f
             WHERE p.public_id = ${P3.ort}::uuid AND f.public_id = ${q4}::uuid
        `;
        const antwort = await lesen("place", P3.ort);
        expect(antwort).toMatchObject({
            traeger: { kind: "place", id: P3.ort, name: "P3T Ort Eins", aktiv: true },
            aenderbar: true,
            wiki: null,
        });
        expect("grund" in antwort).toBe(false);
        // Die Quelle q4 ist stillgelegt (Katalog): wie im Infopanel fehlt sie.
        expect(antwort.quellen).toEqual([
            expect.objectContaining({
                sourceId: q3,
                title: "P3T Quelle Drei",
                sourceType: "briefspiel",
                offiziell: false,
                url: `${HOST}/drei`,
                referenceKind: "erwaehnung",
                pages: "7",
                note: null,
                state: "active",
                wiki: null,
            }),
        ]);
        expect("abschnitte" in antwort.quellen[0]!).toBe(false);
        expect(antwort.quellen[0]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    });

    it("Lesen: die Quelle eines Korpus nennt dessen Namen (`korpus.label`), eine ohne Korpus `korpus: null`", async () => {
        const schluessel = "p3t-korpus.example";
        await database`
            INSERT INTO source_corpus (corpus_key, label, form, source_system)
            VALUES (${schluessel}, 'LieblichesFeld-Wiki', '', ${MARKE})
        `;
        try {
            await database`UPDATE feature_source SET corpus_key = ${schluessel} WHERE public_id = ${q3}::uuid`;
            const antwort = await lesen("place", P3.ort);
            const drei = antwort.quellen.find((q) => q.sourceId === q3);
            expect(drei?.korpus).toEqual({ label: "LieblichesFeld-Wiki" });
            for (const andere of antwort.quellen.filter((q) => q.sourceId !== q3))
                expect(andere.korpus ?? null).toBeNull();
        } finally {
            await database`UPDATE feature_source SET corpus_key = NULL WHERE public_id = ${q3}::uuid`;
            await database`DELETE FROM source_corpus WHERE corpus_key = ${schluessel}`;
        }
    });

    it("🔴 Lesen: nur mit Anmeldung und ab Reviewer; ein unbekanntes Objekt ist 404, eine fremde Art oder ein Name keine Art/Kennung (400)", async () => {
        expect((await holen("place", P3.ort)).statusCode).toBe(401);
        expect((await holen("place", P3.ort, cookies.tester)).statusCode).toBe(403);
        const reviewer = await holen("place", P3.ort, cookies.reviewer);
        expect(reviewer.statusCode).toBe(200);
        expect(reviewer.headers["cache-control"]).toBe("private, no-cache");
        for (const art of ["place", "territory", "area", "peak", "path"]) {
            expect((await holen(art, randomUUID(), cookies.editor)).statusCode, art).toBe(404);
        }
        expect((await holen("label", P3.gipfel, cookies.editor)).statusCode).toBe(400);
        expect((await holen("place", "Gareth", cookies.editor)).statusCode).toBe(400);
    });

    it("ein stilles Objekt ist nicht änderbar, mit Grund", async () => {
        const antwort = await lesen("place", ORT_STILL);
        expect(antwort).toMatchObject({ traeger: { aktiv: false }, aenderbar: false, grund: "still", quellen: [] });
    });

    // -----------------------------------------------------------------------------------------------------------------
    // Schreiben: Ort
    // -----------------------------------------------------------------------------------------------------------------

    let operationAnhaengen = "";
    let revisionOrt = 0;

    it("🔴 Anhängen: Zeile des Editors am Ende, gekürzte Angaben, die Revision des Ortes steigt nicht, ein Eintrag ohne Revision im Fachprotokoll, das Etikett folgt", async () => {
        revisionOrt = await revision("place", P3.ort);
        operationAnhaengen = neu();
        const antwort = await schreiben(
            "place",
            P3.ort,
            aendern(
                [{ op: "add", sourceId: q1, vorher: null, referenceKind: "ausfuehrlich", pages: " S. 12 ", note: "" }],
                operationAnhaengen,
            ),
        );
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<OperationReceipt>();
        expect([...Value.Errors(OperationReceipt, quittung)].map((e) => e.path)).toEqual([]);
        expect(quittung).toMatchObject({
            status: "applied",
            affected: [{ kind: "place", id: P3.ort, revision: revisionOrt }],
        });
        expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({
            state: "active",
            is_active: true,
            source_system: "editor",
            reference_kind: "ausfuehrlich",
            pages: "S. 12",
            note: null,
            // Hinter allen vorhandenen Zeilen des Orts, auch den gelösten (die stillgelegte Quelle q4 hält Position 5).
            position: 6,
        });
        expect(await revision("place", P3.ort)).toBe(revisionOrt);
        // Rang 2 der Kanon-Regel: eine offizielle Quelle mit Art des Belegs; in derselben Transaktion gerechnet.
        expect(await kanon("place", P3.ort)).toEqual({ canon: "official", designator_type: "regelbuch" });
        const eintraege = await protokoll(operationAnhaengen);
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]).toMatchObject({
            action: "place.sources_changed",
            place_public_id: P3.ort,
            revision_before: null,
            revision_after: null,
        });
        expect(eintraege[0]!.changes.quellen!.before).toEqual([
            expect.objectContaining({ sourceId: q1, state: "none" }),
        ]);
        expect(eintraege[0]!.changes.quellen!.after).toEqual([
            expect.objectContaining({
                sourceId: q1,
                title: "P3T Quelle Eins",
                state: "active",
                referenceKind: "ausfuehrlich",
                pages: "S. 12",
                note: null,
            }),
        ]);
        expect(await operation(operationAnhaengen)).toEqual({
            action: "traeger.sources",
            summary: "Quellen von „P3T Ort Eins“ geändert",
        });
        // Das Lesen zeigt sie hinter der aus Legacy (Reihenfolge am Objekt).
        expect((await lesen("place", P3.ort)).quellen.map((q) => q.sourceId)).toEqual([q3, q1]);
    });

    it("dieselbe Kennung noch einmal gibt die Quittung zurück, ohne eine zweite Änderung", async () => {
        const noch = await schreiben(
            "place",
            P3.ort,
            aendern(
                [{ op: "add", sourceId: q1, vorher: null, referenceKind: "ausfuehrlich", pages: " S. 12 ", note: "" }],
                operationAnhaengen,
            ),
        );
        expect(noch.statusCode).toBe(200);
        expect(noch.json<OperationReceipt>().status).toBe("replayed");
        expect(await zahlVerknuepfungen("place", P3.ort, q1)).toBe(1);
        expect(await protokoll(operationAnhaengen)).toHaveLength(1);
    });

    it("Ändern: Art, Seiten und Notiz gegen den gesehenen Stand; dieselben Werte noch einmal ändern nichts (kein Protokoll)", async () => {
        const gesehen = { state: "active", referenceKind: "ausfuehrlich", pages: "S. 12", note: null };
        const operationId = neu();
        const antwort = await schreiben(
            "place",
            P3.ort,
            aendern(
                [
                    {
                        op: "update",
                        sourceId: q1,
                        vorher: gesehen,
                        referenceKind: "ergaenzend",
                        pages: "S. 14 ff.",
                        note: "Hinweis",
                    },
                ],
                operationId,
            ),
        );
        expect(antwort.statusCode).toBe(200);
        expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({
            reference_kind: "ergaenzend",
            pages: "S. 14 ff.",
            note: "Hinweis",
            source_system: "editor",
        });
        const [eintrag] = await protokoll(operationId);
        expect(eintrag!.changes.quellen!.before[0]).toMatchObject({ pages: "S. 12", note: null });
        expect(eintrag!.changes.quellen!.after[0]).toMatchObject({ pages: "S. 14 ff.", note: "Hinweis" });

        const nochmal = neu();
        const gleich = await schreiben(
            "place",
            P3.ort,
            aendern(
                [
                    {
                        op: "update",
                        sourceId: q1,
                        vorher: { state: "active", referenceKind: "ergaenzend", pages: "S. 14 ff.", note: "Hinweis" },
                        pages: "S. 14 ff.",
                    },
                ],
                nochmal,
            ),
        );
        expect(gleich.statusCode).toBe(200);
        expect(await protokoll(nochmal)).toEqual([]);
        // Leeren: `null` und Leerraum werden zu nichts.
        const leer = await schreiben(
            "place",
            P3.ort,
            aendern([
                {
                    op: "update",
                    sourceId: q1,
                    vorher: { state: "active", referenceKind: "ergaenzend", pages: "S. 14 ff.", note: "Hinweis" },
                    pages: null,
                    note: "   ",
                },
            ]),
        );
        expect(leer.statusCode).toBe(200);
        expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({
            reference_kind: "ergaenzend",
            pages: null,
            note: null,
        });
        // Auch die Art des Belegs lässt sich leeren (`null` bleibt `null`, Fastifys ajv macht keine Zeichenkette daraus), und `vorher` darf sie leer tragen.
        const ohneArt = await schreiben(
            "place",
            P3.ort,
            aendern([
                {
                    op: "update",
                    sourceId: q1,
                    vorher: { state: "active", referenceKind: "ergaenzend", pages: null, note: null },
                    referenceKind: null,
                },
            ]),
        );
        expect(ohneArt.statusCode).toBe(200);
        expect((await verknuepfung("place", P3.ort, q1))!.reference_kind).toBeNull();
        const mitArt = await schreiben(
            "place",
            P3.ort,
            aendern([
                {
                    op: "update",
                    sourceId: q1,
                    vorher: { state: "active", referenceKind: null, pages: null, note: null },
                    referenceKind: "ergaenzend",
                },
            ]),
        );
        expect(mitArt.statusCode).toBe(200);
        expect((await verknuepfung("place", P3.ort, q1))!.reference_kind).toBe("ergaenzend");
    });

    it("🔴 ein veralteter Stand ist 409 edit_conflict mit wer und wann; nichts wird geschrieben, auch das Gültige davor nicht", async () => {
        const nachher = await revision("place", P3.ort);
        const antwort = await schreiben(
            "place",
            P3.ort,
            aendern([
                // Gültig, würde die Quelle q2 anhängen …
                { op: "add", sourceId: q2, vorher: null, pages: "1" },
                // … aber diese Änderung kennt nur den Stand von vor dem Ändern.
                {
                    op: "update",
                    sourceId: q1,
                    vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "S. 12", note: null },
                    pages: "9",
                },
            ]),
        );
        expect(antwort.statusCode).toBe(409);
        const fehler = antwort.json<{ error: { code: string; details: Record<string, unknown> } }>().error;
        expect(fehler.code).toBe("edit_conflict");
        expect(fehler.details).toMatchObject({
            currentRevision: nachher,
            changedBy: { displayName: "TQ editor" },
        });
        expect(typeof fehler.details["changedAt"]).toBe("string");
        expect(await verknuepfung("place", P3.ort, q2)).toBeUndefined();
        expect((await verknuepfung("place", P3.ort, q1))!.pages).toBeNull();
    });

    it("🔴 eine Verknüpfung, die inzwischen ein anderer angehängt hat, ist ein Konflikt (vorher: null stimmt nicht mehr)", async () => {
        const antwort = await schreiben(
            "place",
            P3.ort,
            aendern([{ op: "add", sourceId: q1, vorher: null, pages: "5" }]),
        );
        expect(antwort.statusCode).toBe(409);
        expect(await zahlVerknuepfungen("place", P3.ort, q1)).toBe(1);
    });

    it("🔴 Lösen legt still, es löscht nie: eigene Verknüpfung retired, aus Legacy suppressed; beide kommen zurück", async () => {
        const gesehenQ1 = { state: "active", referenceKind: "ergaenzend", pages: null, note: null };
        const gesehenQ3 = { state: "active", referenceKind: "erwaehnung", pages: "7", note: null };
        const operationId = neu();
        const antwort = await schreiben(
            "place",
            P3.ort,
            aendern(
                [
                    { op: "remove", sourceId: q1, vorher: gesehenQ1 },
                    { op: "remove", sourceId: q3, vorher: gesehenQ3 },
                ],
                operationId,
            ),
        );
        expect(antwort.statusCode).toBe(200);
        expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({
            state: "retired",
            is_active: false,
            retired_origin: "editor",
            source_system: "editor",
        });
        expect(await verknuepfung("place", P3.ort, q3)).toMatchObject({
            state: "suppressed",
            is_active: false,
            retired_origin: "editor",
            source_system: "editor",
        });
        // Zwei Quellen, ein Eintrag im Protokoll, vorher und nachher je Quelle.
        const eintraege = await protokoll(operationId);
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]!.changes.quellen!.after.map((e) => [e["sourceId"], e["state"]])).toEqual([
            [q1, "retired"],
            [q3, "suppressed"],
        ]);
        // Ohne aktive Verweise sagt der Rang 4 beim Lesen etwas anderes: Die Zeile des Etiketts ist weg oder nicht mehr „official“.
        expect((await kanon("place", P3.ort))?.canon).not.toBe("official");
        // Die gelösten stehen weiter da, die aktiven zuerst.
        const gelesen = await lesen("place", P3.ort);
        expect(gelesen.quellen.map((q) => [q.sourceId, q.state])).toEqual([
            [q3, "suppressed"],
            [q1, "retired"],
        ]);
        // Nochmals lösen ist ein Fehler, kein stilles Nichts.
        const nochmal = await schreiben(
            "place",
            P3.ort,
            aendern([{ op: "remove", sourceId: q1, vorher: { ...gesehenQ1, state: "retired" } }]),
        );
        expect(nochmal.statusCode).toBe(400);

        const zurueck = await schreiben(
            "place",
            P3.ort,
            aendern([
                { op: "restore", sourceId: q1, vorher: { ...gesehenQ1, state: "retired" } },
                { op: "restore", sourceId: q3, vorher: { ...gesehenQ3, state: "suppressed" } },
            ]),
        );
        expect(zurueck.statusCode).toBe(200);
        expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({ state: "active", retired_origin: null });
        expect(await verknuepfung("place", P3.ort, q3)).toMatchObject({
            state: "active",
            retired_origin: null,
            pages: "7",
            reference_kind: "erwaehnung",
        });
        expect(await kanon("place", P3.ort)).toMatchObject({ canon: "official" });
        // Wieder holen, was nicht gelöst ist: Fehler.
        const aktiv = await schreiben(
            "place",
            P3.ort,
            aendern([{ op: "restore", sourceId: q1, vorher: { ...gesehenQ1, state: "active" } }]),
        );
        expect(aktiv.statusCode).toBe(400);
    });

    it("Anhängen holt eine gelöste Verknüpfung zurück: dieselbe Zeile, mit neuen Angaben", async () => {
        const gesehen = { state: "active", referenceKind: "ergaenzend", pages: null, note: null };
        await schreiben("place", P3.ort, aendern([{ op: "remove", sourceId: q1, vorher: gesehen }]));
        const antwort = await schreiben(
            "place",
            P3.ort,
            aendern([
                {
                    op: "add",
                    sourceId: q1,
                    vorher: { ...gesehen, state: "retired" },
                    referenceKind: "erwaehnung",
                    pages: "S. 99",
                },
            ]),
        );
        expect(antwort.statusCode).toBe(200);
        expect(await zahlVerknuepfungen("place", P3.ort, q1)).toBe(1);
        expect(await verknuepfung("place", P3.ort, q1)).toMatchObject({
            state: "active",
            is_active: true,
            retired_origin: null,
            reference_kind: "erwaehnung",
            pages: "S. 99",
        });
    });

    it("🔴 Prüfungen: stilles Objekt, stillgelegte und unbekannte Quelle, schon angehängt, doppelt in einer Anfrage, nicht angehängt", async () => {
        const stilles = await schreiben("place", ORT_STILL, aendern([{ op: "add", sourceId: q1, vorher: null }]));
        expect(stilles.statusCode).toBe(400);
        expect(await zahlVerknuepfungen("place", ORT_STILL, q1)).toBe(0);

        const stillgelegt = await schreiben(
            "place",
            P3.ort,
            aendern([
                { op: "add", sourceId: q2, vorher: null },
                { op: "add", sourceId: q4, vorher: null },
            ]),
        );
        expect(stillgelegt.statusCode).toBe(400);
        expect(stillgelegt.json<{ error: { code: string } }>().error.code).toBe("validation_failed");
        // Das Gültige davor ist mit zurückgerollt.
        expect(await verknuepfung("place", P3.ort, q2)).toBeUndefined();

        expect(
            (await schreiben("place", P3.ort, aendern([{ op: "add", sourceId: randomUUID(), vorher: null }])))
                .statusCode,
        ).toBe(404);
        expect(
            (await schreiben("place", randomUUID(), aendern([{ op: "add", sourceId: q2, vorher: null }]))).statusCode,
        ).toBe(404);

        const gesehenQ1 = { state: "active", referenceKind: "erwaehnung", pages: "S. 99", note: null };
        expect(
            (await schreiben("place", P3.ort, aendern([{ op: "add", sourceId: q1, vorher: gesehenQ1 }]))).statusCode,
        ).toBe(400);
        const doppelt = await schreiben(
            "place",
            P3.ort,
            aendern([
                { op: "update", sourceId: q1, vorher: gesehenQ1, pages: "1" },
                { op: "update", sourceId: q1, vorher: gesehenQ1, pages: "2" },
            ]),
        );
        expect(doppelt.statusCode).toBe(400);
        expect((await verknuepfung("place", P3.ort, q1))!.pages).toBe("S. 99");
        // Ändern, was nicht angehängt ist.
        expect(
            (await schreiben("place", P3.ort, aendern([{ op: "update", sourceId: q2, vorher: null, pages: "3" }])))
                .statusCode,
        ).toBe(404);
    });

    it("🔴 der Körper wird geprüft: unbekannte Art des Belegs, zu lange Seiten, keine Änderungen, ohne `vorher`", async () => {
        const ungueltig = [
            aendern([{ op: "add", sourceId: q2, vorher: null, referenceKind: "frei" }]),
            aendern([{ op: "add", sourceId: q2, vorher: null, pages: "x".repeat(121) }]),
            aendern([]),
            aendern([{ op: "add", sourceId: q2 }]),
            aendern([{ op: "add", sourceId: "P3T", vorher: null }]),
        ];
        for (const koerper of ungueltig) {
            expect((await schreiben("place", P3.ort, koerper)).statusCode, JSON.stringify(koerper)).toBe(400);
        }
        expect(await verknuepfung("place", P3.ort, q2)).toBeUndefined();
    });

    it("🔴 Rechte: ohne Anmeldung 401, als Reviewer 403; ist das Bearbeiten der Karte aus, 423 map_editing_off; nichts wird geschrieben", async () => {
        const koerper = aendern([{ op: "add", sourceId: q2, vorher: null }]);
        const ohne = await app.inject({
            method: "POST",
            url: inhalteTraegerQuellenUrl("place", P3.ort),
            headers: { origin: TEST_ORIGIN },
            payload: koerper,
        });
        expect(ohne.statusCode).toBe(401);
        expect((await schreiben("place", P3.ort, koerper, cookies.reviewer)).statusCode).toBe(403);
        const gesperrt = await schreiben("place", P3.ort, koerper, cookies.editor, aus);
        expect(gesperrt.statusCode).toBe(423);
        expect(gesperrt.json<{ error: { code: string } }>().error.code).toBe("map_editing_off");
        expect(await verknuepfung("place", P3.ort, q2)).toBeUndefined();
    });

    // -----------------------------------------------------------------------------------------------------------------
    // Schreiben: Gebiet, Landschaft; Weg (Lesen, Rechte)
    // -----------------------------------------------------------------------------------------------------------------

    it("🔴 Gebiet: anhängen und lösen, das Etikett folgt; Protokoll `territory.sources_changed`", async () => {
        const anhaengen = neu();
        const revisionVorher = await revision("territory", P3.gebiet);
        const a = await schreiben(
            "territory",
            P3.gebiet,
            aendern([{ op: "add", sourceId: q1, vorher: null, referenceKind: "ausfuehrlich", pages: "3" }], anhaengen),
        );
        expect(a.statusCode).toBe(200);
        expect(await kanon("territory", P3.gebiet)).toEqual({ canon: "official", designator_type: "regelbuch" });
        expect(await protokoll(anhaengen)).toEqual([
            expect.objectContaining({
                action: "territory.sources_changed",
                territory_public_id: P3.gebiet,
                place_public_id: null,
                revision_after: null,
            }),
        ]);
        const geloest = await schreiben(
            "territory",
            P3.gebiet,
            aendern([
                {
                    op: "remove",
                    sourceId: q1,
                    vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "3", note: null },
                },
            ]),
        );
        expect(geloest.statusCode).toBe(200);
        expect(await verknuepfung("territory", P3.gebiet, q1)).toMatchObject({ state: "retired" });
        // Ohne Verweise sagen Rang 1 bis 3 nichts mehr: Die Zeile entfällt.
        expect(await kanon("territory", P3.gebiet)).toBeUndefined();
        expect(await revision("territory", P3.gebiet)).toBe(revisionVorher);
        expect((await lesen("territory", P3.gebiet)).quellen).toEqual([expect.objectContaining({ state: "retired" })]);
    });

    it("🔴 Landschaft: anhängen und lösen unter der Art `area` (Tafel region); Protokoll `region.sources_changed`, die Quittung nennt die Landschaft", async () => {
        const anhaengen = neu();
        const revisionVorher = await revision("area", P3.region);
        const a = await schreiben(
            "area",
            P3.region,
            aendern([{ op: "add", sourceId: q2, vorher: null, referenceKind: "erwaehnung" }], anhaengen),
        );
        expect(a.statusCode).toBe(200);
        expect(a.json<OperationReceipt>().affected).toEqual([
            { kind: "landscape", id: P3.region, revision: revisionVorher },
        ]);
        expect(await verknuepfung("area", P3.region, q2)).toMatchObject({ state: "active", source_system: "editor" });
        expect(await protokoll(anhaengen)).toEqual([
            expect.objectContaining({
                action: "region.sources_changed",
                region_public_id: P3.region,
                revision_before: null,
                revision_after: null,
            }),
        ]);
        const geloest = await schreiben(
            "area",
            P3.region,
            aendern([
                {
                    op: "remove",
                    sourceId: q2,
                    vorher: { state: "active", referenceKind: "erwaehnung", pages: null, note: null },
                },
            ]),
        );
        expect(geloest.statusCode).toBe(200);
        expect(await verknuepfung("area", P3.region, q2)).toMatchObject({ state: "retired" });
        expect(await revision("area", P3.region)).toBe(revisionVorher);
        expect((await lesen("area", P3.region)).traeger).toMatchObject({ kind: "area", name: "P3T Region Eins" });
    });

    it("🔴 Gipfel: lesen, anhängen und lösen unter der Art `peak` (Tafel terrain_peak); Protokoll `peak.sources_changed` am Gipfel ohne Revision, das Etikett folgt; eine Höhle ohne Gelände geht genauso, ein stiller Gipfel nicht", async () => {
        // Lesen: eine Verknüpfung aus Legacy am Berggipfel; eine stillgelegte Quelle fehlt, das Zitat des Wikis ist ohne Lauf null.
        await database`
            INSERT INTO terrain_peak_source (terrain_peak_id, source_id, reference_kind, pages, position, source_system)
            SELECT t.id, f.id, 'erwaehnung', '9', 0, 'legacy' FROM terrain_peak t, feature_source f
             WHERE t.public_id = ${P3.gipfel}::uuid AND f.public_id = ${q3}::uuid
        `;
        await database`
            INSERT INTO terrain_peak_source (terrain_peak_id, source_id, reference_kind, position, source_system)
            SELECT t.id, f.id, 'erwaehnung', 5, 'legacy' FROM terrain_peak t, feature_source f
             WHERE t.public_id = ${P3.gipfel}::uuid AND f.public_id = ${q4}::uuid
        `;
        const gelesen = await lesen("peak", P3.gipfel);
        expect(gelesen).toMatchObject({
            traeger: { kind: "peak", id: P3.gipfel, name: "P3T Gipfel", aktiv: true },
            aenderbar: true,
            wiki: null,
        });
        expect("grund" in gelesen).toBe(false);
        expect(gelesen.quellen).toEqual([
            expect.objectContaining({
                sourceId: q3,
                state: "active",
                referenceKind: "erwaehnung",
                pages: "9",
                wiki: null,
            }),
        ]);
        // Die Höhle hat noch keine; ein Reviewer liest, ein Tester nicht.
        expect((await lesen("peak", HOEHLE)).quellen).toEqual([]);
        expect((await holen("peak", P3.gipfel, cookies.reviewer)).statusCode).toBe(200);
        expect((await holen("peak", P3.gipfel, cookies.tester)).statusCode).toBe(403);

        // Anhängen: eine Zeile des Editors am Ende, die Revision des Gipfels steigt nicht, EIN Eintrag am Gipfel ohne Revision.
        const revisionVorher = await revision("peak", P3.gipfel);
        const anhaengen = neu();
        const a = await schreiben(
            "peak",
            P3.gipfel,
            aendern(
                [
                    {
                        op: "add",
                        sourceId: q1,
                        vorher: null,
                        referenceKind: "ausfuehrlich",
                        pages: "  3 ",
                        note: " Karte ",
                    },
                ],
                anhaengen,
            ),
        );
        expect(a.statusCode, a.body).toBe(200);
        expect(a.json<OperationReceipt>().affected).toEqual([
            { kind: "peak", id: P3.gipfel, revision: revisionVorher },
        ]);
        expect(await verknuepfung("peak", P3.gipfel, q1)).toMatchObject({
            state: "active",
            is_active: true,
            source_system: "editor",
            reference_kind: "ausfuehrlich",
            pages: "3",
            note: "Karte",
            // Am Ende: hinter der stillgelegten Quelle mit Position 5.
            position: 6,
        });
        expect(await revision("peak", P3.gipfel)).toBe(revisionVorher);
        expect(await kanon("peak", P3.gipfel)).toEqual({ canon: "official", designator_type: "regelbuch" });
        expect(await protokoll(anhaengen)).toEqual([
            expect.objectContaining({
                action: "peak.sources_changed",
                peak_public_id: P3.gipfel,
                place_public_id: null,
                region_public_id: null,
                revision_before: null,
                revision_after: null,
                changes: {
                    quellen: {
                        before: [
                            expect.objectContaining({ sourceId: q1, state: "none", referenceKind: null, pages: null }),
                        ],
                        after: [
                            expect.objectContaining({
                                sourceId: q1,
                                title: "P3T Quelle Eins",
                                state: "active",
                                referenceKind: "ausfuehrlich",
                                pages: "3",
                                note: "Karte",
                            }),
                        ],
                    },
                },
            }),
        ]);
        expect(await operation(anhaengen)).toMatchObject({
            action: "traeger.sources",
            summary: "Quellen von „P3T Gipfel“ geändert",
        });

        // Ändern gegen den gesehenen Stand; ein veralteter Stand ist 409 und schreibt nichts.
        const veraltet = await schreiben(
            "peak",
            P3.gipfel,
            aendern([
                {
                    op: "update",
                    sourceId: q1,
                    vorher: { state: "active", referenceKind: "erwaehnung", pages: "1", note: null },
                    pages: "4",
                },
            ]),
        );
        expect(veraltet.statusCode).toBe(409);
        expect(veraltet.json()).toMatchObject({ error: { code: "edit_conflict" } });
        expect(await verknuepfung("peak", P3.gipfel, q1)).toMatchObject({ pages: "3" });

        // Lösen: eine eigene Verknüpfung wird `retired`, die aus Legacy `suppressed`; nie gelöscht; beide kommen zurück.
        const loesen = neu();
        const geloest = await schreiben(
            "peak",
            P3.gipfel,
            aendern(
                [
                    {
                        op: "remove",
                        sourceId: q1,
                        vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "3", note: "Karte" },
                    },
                    {
                        op: "remove",
                        sourceId: q3,
                        vorher: { state: "active", referenceKind: "erwaehnung", pages: "9", note: null },
                    },
                ],
                loesen,
            ),
        );
        expect(geloest.statusCode, geloest.body).toBe(200);
        expect(await verknuepfung("peak", P3.gipfel, q1)).toMatchObject({
            state: "retired",
            is_active: false,
            retired_origin: "editor",
        });
        expect(await verknuepfung("peak", P3.gipfel, q3)).toMatchObject({ state: "suppressed", is_active: false });
        expect(await zahlVerknuepfungen("peak", P3.gipfel, q1)).toBe(1);
        expect(await revision("peak", P3.gipfel)).toBe(revisionVorher);
        // Ohne Verweise sagen Rang 1 bis 3 nichts mehr: Die Zeile entfällt.
        expect(await kanon("peak", P3.gipfel)).toBeUndefined();
        const protokolliert = await protokoll(loesen);
        expect(protokolliert).toHaveLength(1);
        expect(protokolliert[0]).toMatchObject({ action: "peak.sources_changed", peak_public_id: P3.gipfel });
        expect(protokolliert[0]!.changes.quellen!.after).toHaveLength(2);
        expect((await lesen("peak", P3.gipfel)).quellen.map((q) => q.state)).toEqual(["suppressed", "retired"]);
        const geholt = await schreiben(
            "peak",
            P3.gipfel,
            aendern([
                {
                    op: "restore",
                    sourceId: q3,
                    vorher: { state: "suppressed", referenceKind: "erwaehnung", pages: "9", note: null },
                },
            ]),
        );
        expect(geholt.statusCode, geholt.body).toBe(200);
        expect(await verknuepfung("peak", P3.gipfel, q3)).toMatchObject({ state: "active", pages: "9" });

        // Eine Höhle (Landmarke ohne Gelände) geht genauso: dieselbe Tafel, derselbe Eintrag, keine Höhe im Spiel.
        const hoehle = neu();
        const h = await schreiben(
            "peak",
            HOEHLE,
            aendern([{ op: "add", sourceId: q2, vorher: null, referenceKind: "erwaehnung" }], hoehle),
        );
        expect(h.statusCode, h.body).toBe(200);
        expect(await verknuepfung("peak", HOEHLE, q2)).toMatchObject({ state: "active", source_system: "editor" });
        expect(await protokoll(hoehle)).toEqual([
            expect.objectContaining({ action: "peak.sources_changed", peak_public_id: HOEHLE }),
        ]);
        expect((await lesen("peak", HOEHLE)).traeger).toMatchObject({ kind: "peak", name: "P3T Höhle", aktiv: true });
        expect(await revision("peak", HOEHLE)).toBe(1);

        // Ein stiller Gipfel ist nicht änderbar; an ihn hängt nichts an. Rechte und Schalter gelten wie überall.
        expect(await lesen("peak", P3.gipfelInaktiv)).toMatchObject({
            traeger: { aktiv: false },
            aenderbar: false,
            grund: "still",
            quellen: [],
        });
        const still = await schreiben("peak", P3.gipfelInaktiv, aendern([{ op: "add", sourceId: q1, vorher: null }]));
        expect(still.statusCode).toBe(400);
        expect(await zahlVerknuepfungen("peak", P3.gipfelInaktiv, q1)).toBe(0);
        const koerper = aendern([{ op: "add", sourceId: q1, vorher: null }]);
        expect((await schreiben("peak", HOEHLE, koerper, cookies.reviewer)).statusCode).toBe(403);
        expect((await schreiben("peak", HOEHLE, koerper, cookies.editor, aus)).statusCode).toBe(423);
        expect((await schreiben("peak", randomUUID(), koerper)).statusCode).toBe(404);
        expect(await zahlVerknuepfungen("peak", HOEHLE, q1)).toBe(0);
    });

    it("🔴 Wege: Lesen zeigt `aenderbar: true` ohne Grund `weg`; die Rechte gelten auch hier zuerst (Reviewer 403, Schreibschalter aus 423)", async () => {
        const koerper = aendern([{ op: "add", sourceId: q1, vorher: null }]);
        expect((await schreiben("path", P3.weg, koerper, cookies.reviewer)).statusCode).toBe(403);
        const gesperrt = await schreiben("path", P3.weg, koerper, cookies.editor, aus);
        expect(gesperrt.statusCode).toBe(423);
        expect(gesperrt.json<{ error: { code: string } }>().error.code).toBe("map_editing_off");
        const [zahl] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM path_source WHERE source_id IN (SELECT id FROM feature_source WHERE source_system = ${MARKE})`;
        expect(zahl!.n).toBe(0);
        const gelesen = await lesen("path", P3.weg);
        expect(gelesen).toMatchObject({
            aenderbar: true,
            traeger: { kind: "path", name: "P3T Weg Eins", aktiv: true },
        });
        expect("grund" in gelesen).toBe(false);
    });

    it("Straße: die Vereinigung über die Abschnitte; Zählung, Einheitlichkeit und Zustand, jeder Abschnitt der Straße führt zur selben Antwort", async () => {
        const strasse = await readEditorPathStreet(database, P3.weg);
        const abschnitte = strasse!.segments.map((s) => s.id);
        expect(abschnitte.sort()).toEqual([P3.weg, ABSCHNITT_ZWEI].sort());
        const erster = strasse!.segments[0]!.id;
        const zweiter = strasse!.segments[1]!.id;
        const eintragen = async (abschnitt: string, quelle: string, seiten: string | null, zustand = "active") =>
            database`
                INSERT INTO path_source (path_id, source_id, reference_kind, pages, position, state, is_active, retired_at, retired_origin, source_system)
                SELECT p.id, f.id, 'erwaehnung', ${seiten}, 0, ${zustand}, ${zustand === "active"},
                       ${zustand === "active" ? null : new Date()}, ${zustand === "active" ? null : "import"}, 'legacy'
                  FROM path p, feature_source f WHERE p.public_id = ${abschnitt}::uuid AND f.public_id = ${quelle}::uuid
            `;
        await eintragen(erster, q1, "5");
        await eintragen(zweiter, q1, "5");
        await eintragen(zweiter, q2, "8", "retired");
        await eintragen(erster, q2, "8", "suppressed");

        const beide = await lesen("path", P3.weg);
        expect(beide.traeger).toMatchObject({ kind: "path", id: P3.weg, name: "P3T Weg Eins", aktiv: true });
        expect(beide.quellen.map((q) => q.sourceId)).toEqual([q1, q2]);
        expect(beide.quellen[0]).toMatchObject({
            state: "active",
            pages: "5",
            abschnitte: { mit: 2, von: 2, einheitlich: true, gleichDemWiki: false },
        });
        // Eine gelöste und eine unterdrückte Zeile: gelöst gilt vor unterdrückt; ohne aktiven Abschnitt ist `mit` 0.
        expect(beide.quellen[1]).toMatchObject({ state: "retired", abschnitte: { mit: 0, von: 2, einheitlich: true } });
        // Derselbe Weg von einem anderen Abschnitt her.
        expect(await lesen("path", ABSCHNITT_ZWEI)).toEqual({
            ...beide,
            traeger: { ...beide.traeger, id: ABSCHNITT_ZWEI },
        });

        // Sagt der zweite Abschnitt etwas anderes: nicht einheitlich, oben steht der erste entlang der Straße.
        await database`
            UPDATE path_source SET pages = '6'
             WHERE path_id = (SELECT id FROM path WHERE public_id = ${zweiter}::uuid) AND source_id = (SELECT id FROM feature_source WHERE public_id = ${q1}::uuid)
        `;
        const verschieden = await lesen("path", P3.weg);
        expect(verschieden.quellen[0]).toMatchObject({
            pages: "5",
            abschnitte: { mit: 2, von: 2, einheitlich: false },
        });

        // Trägt nur ein Abschnitt die Quelle: 1 von 2.
        await database`
            DELETE FROM path_source
             WHERE path_id = (SELECT id FROM path WHERE public_id = ${zweiter}::uuid) AND source_id = (SELECT id FROM feature_source WHERE public_id = ${q1}::uuid)
        `;
        const einer = await lesen("path", P3.weg);
        expect(einer.quellen[0]).toMatchObject({ abschnitte: { mit: 1, von: 2, einheitlich: true } });
    });

    // -----------------------------------------------------------------------------------------------------------------
    // Schreiben: die Straße eines Wegs (WI-0254 §12, Runde 6)
    // -----------------------------------------------------------------------------------------------------------------

    describe("Straße schreiben: die Quelle gilt der ganzen Straße, nie einzelnen Abschnitten", () => {
        interface WegZeile {
            carrier: string;
            state: string;
            is_active: boolean;
            source_system: string;
            retired_origin: string | null;
            reference_kind: string | null;
            pages: string | null;
            note: string | null;
        }
        const ABSCHNITTE = [...WEG_DREI];
        /** Die Abschnitte entlang der Straße (wie das Wege-Fenster sie ordnet) und ihr Anker, die kleinste Kennung. */
        let entlang: string[] = [];
        let anker = "";

        const verknuepfungen = (quelle: string) => database<WegZeile[]>`
            SELECT p.public_id::text AS carrier, v.state, v.is_active, v.source_system, v.retired_origin, v.reference_kind, v.pages, v.note
              FROM path_source v JOIN path p ON p.id = v.path_id JOIN feature_source f ON f.id = v.source_id
             WHERE f.public_id = ${quelle}::uuid AND p.public_id = ANY(${ABSCHNITTE}::uuid[])
             ORDER BY p.public_id
        `;
        const revisionen = () => database<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int FROM path WHERE public_id = ANY(${ABSCHNITTE}::uuid[]) ORDER BY public_id
        `;
        const kanonZeilen = () => database<{ id: string; canon: string; designator_type: string | null }[]>`
            SELECT p.public_id::text AS id, k.canon, k.designator_type
              FROM path_canon k JOIN path p ON p.id = k.path_id WHERE p.public_id = ANY(${ABSCHNITTE}::uuid[]) ORDER BY p.public_id
        `;
        /** Eine Verknüpfung aus Legacy an einem Abschnitt, wie der Zug sie anlegt. */
        const ausLegacy = (abschnitt: string, quelle: string, art: string | null, seiten: string | null) =>
            database`
                INSERT INTO path_source (path_id, source_id, reference_kind, pages, position, source_system)
                SELECT p.id, f.id, ${art}, ${seiten}, 0, 'legacy'
                  FROM path p, feature_source f WHERE p.public_id = ${abschnitt}::uuid AND f.public_id = ${quelle}::uuid
            `;
        const protokollWeg = (operationId: string) =>
            database<
                {
                    action: string;
                    path_public_id: string | null;
                    place_public_id: string | null;
                    revision_before: number | null;
                    revision_after: number | null;
                    changes: { quellen: { before: Record<string, unknown>[]; after: Record<string, unknown>[] } };
                }[]
            >`
                SELECT action, path_public_id::text, place_public_id::text, revision_before::int, revision_after::int, changes
                  FROM map_audit_event WHERE operation_id = ${operationId}::uuid
            `;
        const einheitlich = (zeilen: WegZeile[], erwartet: Partial<WegZeile>): void => {
            expect(zeilen.map((z) => z.carrier).sort()).toEqual([...ABSCHNITTE].sort());
            for (const zeile of zeilen) expect(zeile).toMatchObject(erwartet);
        };
        const gesehen = (state: string, art: string | null, seiten: string | null, notiz: string | null = null) => ({
            state,
            referenceKind: art,
            pages: seiten,
            note: notiz,
        });

        beforeAll(async () => {
            await database`DELETE FROM path_source WHERE path_id IN (SELECT id FROM path WHERE public_id = ANY(${ABSCHNITTE}::uuid[]))`;
            await database`DELETE FROM path_canon WHERE path_id IN (SELECT id FROM path WHERE public_id = ANY(${ABSCHNITTE}::uuid[]))`;
            const eine = await readEditorPathStreet(database, WEG_DREI[0]);
            entlang = eine!.segments.map((s) => s.id);
            anker = eine!.id;
        });

        it("🔴 uneinheitlicher Start (Quelle an 2 von 3 Abschnitten, verschiedene Angaben): ändern macht sie auf allen dreien einheitlich; Revision des Wegs steigt nicht, EIN Eintrag `path.sources_changed` am Anker, der Verlauf der Straße findet ihn, das Etikett aller Abschnitte folgt", async () => {
            const [a, b, c] = entlang as [string, string, string];
            expect([...entlang].sort()).toEqual([...ABSCHNITTE].sort());
            expect(anker).toBe([...ABSCHNITTE].sort()[0]);
            await ausLegacy(a, q1, "erwaehnung", "5");
            await ausLegacy(b, q1, "ausfuehrlich", "7");
            expect(await kanonZeilen()).toEqual([]);

            // Die Sicht der Straße: aktiv, die Angaben des ersten Abschnitts entlang der Straße; von jedem Abschnitt aus dieselbe Antwort.
            const sicht = await lesen("path", c);
            expect(sicht).toMatchObject({
                aenderbar: true,
                traeger: { kind: "path", id: c, name: "P3T Weg Quellen", aktiv: true },
            });
            expect("grund" in sicht).toBe(false);
            expect(sicht.quellen).toEqual([
                expect.objectContaining({
                    sourceId: q1,
                    state: "active",
                    referenceKind: "erwaehnung",
                    pages: "5",
                    abschnitte: expect.objectContaining({ mit: 2, von: 3, einheitlich: false }),
                }),
            ]);

            const revisionVorher = await revisionen();
            const op = neu();
            // Geschrieben wird von dem Abschnitt aus, der die Quelle gar nicht trägt: `:id` ist irgendein Abschnitt.
            const antwort = await schreiben(
                "path",
                c,
                aendern(
                    [{ op: "update", sourceId: q1, vorher: gesehen("active", "erwaehnung", "5"), pages: " 9 " }],
                    op,
                ),
            );
            expect(antwort.statusCode).toBe(200);
            const quittung = antwort.json<OperationReceipt>();
            expect([...Value.Errors(OperationReceipt, quittung)].map((e) => e.path)).toEqual([]);
            expect(quittung.affected.map((e) => e.id).sort()).toEqual([...ABSCHNITTE].sort());
            expect(quittung.derivedWork).toEqual([]);

            // Alle drei: aktiv, vom Editor, mit denselben Angaben (die Art des zweiten Abschnitts auch).
            einheitlich(await verknuepfungen(q1), {
                state: "active",
                is_active: true,
                source_system: "editor",
                retired_origin: null,
                reference_kind: "erwaehnung",
                pages: "9",
                note: null,
            });
            expect((await lesen("path", b)).quellen[0]).toMatchObject({
                pages: "9",
                referenceKind: "erwaehnung",
                abschnitte: { mit: 3, von: 3, einheitlich: true },
            });

            // Keine Revision des Wegs; EIN Eintrag am Anker ohne Revision, in der Sicht der Straße.
            expect(await revisionen()).toEqual(revisionVorher);
            expect(await protokollWeg(op)).toEqual([
                expect.objectContaining({
                    action: "path.sources_changed",
                    path_public_id: anker,
                    place_public_id: null,
                    revision_before: null,
                    revision_after: null,
                }),
            ]);
            const eintrag = (await protokollWeg(op))[0]!;
            expect(eintrag.changes.quellen.before).toEqual([
                {
                    sourceId: q1,
                    title: "P3T Quelle Eins",
                    state: "active",
                    referenceKind: "erwaehnung",
                    pages: "5",
                    note: null,
                },
            ]);
            expect(eintrag.changes.quellen.after).toEqual([
                {
                    sourceId: q1,
                    title: "P3T Quelle Eins",
                    state: "active",
                    referenceKind: "erwaehnung",
                    pages: "9",
                    note: null,
                },
            ]);
            expect(await operation(op)).toEqual({
                action: "traeger.sources",
                summary: "Quellen von „P3T Weg Quellen“ geändert",
            });
            // Der Verlauf der Straße (liest alle Abschnitte) findet die Operation.
            const verlauf = await pathHistory(database, entlang, {});
            expect(verlauf.entries.map((e) => e.operationId)).toContain(op);
            // Das Etikett jedes Abschnitts ist neu gerechnet (die Quelle ist offiziell).
            expect(await kanonZeilen()).toEqual(
                [...ABSCHNITTE].sort().map((id) => ({ id, canon: "official", designator_type: "regelbuch" })),
            );
        });

        it("Anhängen einer neuen Quelle: eine Zeile je Abschnitt, mit denselben Angaben und am Ende der Reihenfolge; dieselben Werte noch einmal schreibt nichts und protokolliert nichts", async () => {
            const op = neu();
            const antwort = await schreiben(
                "path",
                entlang[0]!,
                aendern(
                    [
                        {
                            op: "add",
                            sourceId: q2,
                            vorher: null,
                            referenceKind: "ergaenzend",
                            pages: "3",
                            note: "Hinweis",
                        },
                    ],
                    op,
                ),
            );
            expect(antwort.statusCode).toBe(200);
            einheitlich(await verknuepfungen(q2), {
                state: "active",
                is_active: true,
                source_system: "editor",
                reference_kind: "ergaenzend",
                pages: "3",
                note: "Hinweis",
            });
            const eintrag = (await protokollWeg(op))[0]!;
            expect(eintrag.changes.quellen.before).toEqual([
                { sourceId: q2, title: "P3T Quelle Zwei", state: "none", referenceKind: null, pages: null, note: null },
            ]);
            expect(eintrag.changes.quellen.after[0]).toMatchObject({
                state: "active",
                referenceKind: "ergaenzend",
                pages: "3",
            });
            // Dieselben Werte noch einmal (vom anderen Ende der Straße): kein Protokoll, nichts geändert.
            const nochmal = neu();
            const gleich = await schreiben(
                "path",
                entlang[2]!,
                aendern(
                    [
                        {
                            op: "update",
                            sourceId: q2,
                            vorher: gesehen("active", "ergaenzend", "3", "Hinweis"),
                            pages: "3",
                        },
                    ],
                    nochmal,
                ),
            );
            expect(gleich.statusCode).toBe(200);
            expect(await protokollWeg(nochmal)).toEqual([]);
        });

        it("🔴 ein veralteter Stand ist 409 edit_conflict mit wer und wann; nichts wird geschrieben (auch nicht an anderen Abschnitten); `vorher: null` bei einer vorhandenen Quelle ebenso", async () => {
            const stand = await verknuepfungen(q1);
            const antwort = await schreiben(
                "path",
                entlang[1]!,
                aendern([{ op: "update", sourceId: q1, vorher: gesehen("active", "erwaehnung", "5"), pages: "1" }]),
            );
            expect(antwort.statusCode).toBe(409);
            const fehler = antwort.json<{ error: { code: string; details: Record<string, unknown> } }>().error;
            expect(fehler.code).toBe("edit_conflict");
            expect(fehler.details).toMatchObject({ changedBy: { displayName: "TQ editor" } });
            expect(typeof fehler.details["changedAt"]).toBe("string");
            expect(await verknuepfungen(q1)).toEqual(stand);

            const vorhanden = await schreiben(
                "path",
                entlang[0]!,
                aendern([{ op: "add", sourceId: q1, vorher: null }]),
            );
            expect(vorhanden.statusCode).toBe(409);
            expect(await verknuepfungen(q1)).toEqual(stand);
        });

        it("🔴 lösen: eine Zeile des Editors wird gelöst (`retired`), eine aus Legacy unterdrückt (`suppressed`), jeweils auf allen Abschnitten, nie gelöscht; holen stellt alle mit den bisherigen Angaben wieder her", async () => {
            // q1 gehört seit dem Ändern dem Editor: gelöst.
            const loesen = await schreiben(
                "path",
                entlang[2]!,
                aendern([{ op: "remove", sourceId: q1, vorher: gesehen("active", "erwaehnung", "9") }]),
            );
            expect(loesen.statusCode).toBe(200);
            einheitlich(await verknuepfungen(q1), {
                state: "retired",
                is_active: false,
                retired_origin: "editor",
                source_system: "editor",
                pages: "9",
            });
            const gelesen = (await lesen("path", entlang[0]!)).quellen.find((q) => q.sourceId === q1)!;
            expect(gelesen).toMatchObject({ state: "retired", pages: "9", abschnitte: { mit: 0, von: 3 } });

            // Nochmals lösen ist ein Fehler, ändern einer gelösten ebenso, holen einer aktiven ebenso.
            const nochmal = await schreiben(
                "path",
                entlang[0]!,
                aendern([{ op: "remove", sourceId: q1, vorher: gesehen("retired", "erwaehnung", "9") }]),
            );
            expect(nochmal.statusCode).toBe(400);
            const aendernGeloest = await schreiben(
                "path",
                entlang[0]!,
                aendern([{ op: "update", sourceId: q1, vorher: gesehen("retired", "erwaehnung", "9"), pages: "1" }]),
            );
            expect(aendernGeloest.statusCode).toBe(400);

            const holen = await schreiben(
                "path",
                entlang[1]!,
                aendern([{ op: "restore", sourceId: q1, vorher: gesehen("retired", "erwaehnung", "9") }]),
            );
            expect(holen.statusCode).toBe(200);
            einheitlich(await verknuepfungen(q1), {
                state: "active",
                is_active: true,
                retired_origin: null,
                reference_kind: "erwaehnung",
                pages: "9",
            });
            const aktivHolen = await schreiben(
                "path",
                entlang[1]!,
                aendern([{ op: "restore", sourceId: q1, vorher: gesehen("active", "erwaehnung", "9") }]),
            );
            expect(aktivHolen.statusCode).toBe(400);
            const dazuAktiv = await schreiben(
                "path",
                entlang[1]!,
                aendern([{ op: "add", sourceId: q1, vorher: gesehen("active", "erwaehnung", "9") }]),
            );
            expect(dazuAktiv.statusCode).toBe(400);

            // q3 steht noch als Zeile aus Legacy an allen Abschnitten: lösen heißt unterdrücken (der Zug belebt sie nie), holen belebt sie wieder.
            for (const abschnitt of entlang) await ausLegacy(abschnitt, q3, "erwaehnung", "2");
            const unterdruecken = await schreiben(
                "path",
                entlang[0]!,
                aendern([{ op: "remove", sourceId: q3, vorher: gesehen("active", "erwaehnung", "2") }]),
            );
            expect(unterdruecken.statusCode).toBe(200);
            einheitlich(await verknuepfungen(q3), {
                state: "suppressed",
                is_active: false,
                retired_origin: "editor",
                source_system: "editor",
            });
            const belebt = await schreiben(
                "path",
                entlang[0]!,
                aendern([{ op: "restore", sourceId: q3, vorher: gesehen("suppressed", "erwaehnung", "2") }]),
            );
            expect(belebt.statusCode).toBe(200);
            einheitlich(await verknuepfungen(q3), {
                state: "active",
                is_active: true,
                retired_origin: null,
                pages: "2",
            });
        });

        it("Eine Verknüpfung, die an einem Abschnitt gelöst ist und an den anderen aktiv: ändern belebt sie dort mit den Angaben der Straße, lösen lässt die übrigen stehen", async () => {
            await database`
                UPDATE path_source SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'import'
                 WHERE source_id = (SELECT id FROM feature_source WHERE public_id = ${q3}::uuid)
                   AND path_id = (SELECT id FROM path WHERE public_id = ${entlang[1]!}::uuid)
            `;
            const eine = (await verknuepfungen(q3)).filter((z) => z.state === "retired");
            expect(eine).toHaveLength(1);
            // Die Straße zeigt sie aktiv (zwei von drei); ändern holt den dritten zurück.
            const antwort = await schreiben(
                "path",
                entlang[2]!,
                aendern([{ op: "update", sourceId: q3, vorher: gesehen("active", "erwaehnung", "2"), note: "Neu" }]),
            );
            expect(antwort.statusCode).toBe(200);
            einheitlich(await verknuepfungen(q3), {
                state: "active",
                is_active: true,
                retired_origin: null,
                source_system: "editor",
                reference_kind: "erwaehnung",
                pages: "2",
                note: "Neu",
            });
        });

        it("🔴 eine Straße, die nicht auf der Karte ist, bleibt 400; ein unbekannter Abschnitt und eine unbekannte Quelle sind 404; ein Seeweg gibt es hier nicht", async () => {
            const still = await schreiben("path", WEG_STILL, aendern([{ op: "add", sourceId: q1, vorher: null }]));
            expect(still.statusCode).toBe(400);
            expect(still.json<{ error: { code: string } }>().error.code).toBe("validation_failed");
            const [zahl] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM path_source WHERE path_id = (SELECT id FROM path WHERE public_id = ${WEG_STILL}::uuid)`;
            expect(zahl!.n).toBe(0);
            expect(await lesen("path", WEG_STILL)).toMatchObject({
                aenderbar: false,
                grund: "still",
                traeger: { aktiv: false },
            });

            const keinWeg = await schreiben("path", randomUUID(), aendern([{ op: "add", sourceId: q1, vorher: null }]));
            expect(keinWeg.statusCode).toBe(404);
            const keineQuelle = await schreiben(
                "path",
                entlang[0]!,
                aendern([{ op: "add", sourceId: randomUUID(), vorher: null }]),
            );
            expect(keineQuelle.statusCode).toBe(404);
            // Eine stillgelegte Quelle hängt nirgends an.
            const stilleQuelle = await schreiben(
                "path",
                entlang[0]!,
                aendern([{ op: "add", sourceId: q4, vorher: null }]),
            );
            expect(stilleQuelle.statusCode).toBe(400);
            expect(await verknuepfungen(q4)).toEqual([]);
        });

        it("🔴 zwei Speichern derselben Straße von verschiedenen Abschnitten aus überholen sich nicht: eines gelingt, das andere ist 409, und es gibt je Abschnitt genau eine Zeile", async () => {
            const [a, , c] = entlang as [string, string, string];
            const frisch = await quelleAnlegen("P3T Quelle Fuenf", "fuenf", "briefspiel", false);
            const antworten = await Promise.all([
                schreiben("path", a, aendern([{ op: "add", sourceId: frisch, vorher: null, pages: "1" }])),
                schreiben("path", c, aendern([{ op: "add", sourceId: frisch, vorher: null, pages: "2" }])),
            ]);
            expect(antworten.map((antwort) => antwort.statusCode).sort()).toEqual([200, 409]);
            const zeilen = await verknuepfungen(frisch);
            einheitlich(zeilen, { state: "active", is_active: true, source_system: "editor" });
            // Alle drei sagen dasselbe: Das Speichern, das gewann, gilt der ganzen Straße.
            expect(new Set(zeilen.map((zeile) => zeile.pages)).size).toBe(1);
        });
    });

    // -----------------------------------------------------------------------------------------------------------------
    // Das Zitat des Wikis
    // -----------------------------------------------------------------------------------------------------------------

    describe("Zitate des Wikis (Tafel aus Migration 0251)", () => {
        let zitatDb: Database;
        let tafelDa = false;
        let laufMitZitaten = 0;

        /** Eine Tafel, die nur diese Verbindung sieht (wie die der Migration 0251; ohne Fremdschlüssel, die eine temporäre Tafel nicht auf eine feste haben darf). */
        const legeTafelAn = async (): Promise<void> => {
            await zitatDb.unsafe(`
                CREATE TEMP TABLE IF NOT EXISTS wikisync_quelle_zitat (
                    lauf_id BIGINT NOT NULL,
                    traeger_art TEXT NOT NULL,
                    traeger_id UUID NOT NULL,
                    quelle_key TEXT NOT NULL,
                    art TEXT, seiten TEXT, notiz TEXT, artikel TEXT,
                    PRIMARY KEY (lauf_id, traeger_art, traeger_id, quelle_key)
                )
            `);
        };
        const lauf = async (bereiche: string[], beendet = new Date()): Promise<number> => {
            const [zeile] = await database<{ id: number }[]>`
                INSERT INTO wikisync_lauf (bereiche, status, dump_datei, dump_sha256, dump_stand, dump_seiten, dump_vollstaendig, parser_version, beendet_am)
                VALUES (${bereiche}, 'fertig', 'test.xml', ${"a".repeat(64)}, '2026-10-01', 10, TRUE, ${MARKE}, ${beendet})
                RETURNING id::int
            `;
            return zeile!.id;
        };
        const schluessel = async (quelle: string): Promise<string> => {
            const [zeile] = await database<{ source_key: string }[]>`
                SELECT source_key FROM feature_source WHERE public_id = ${quelle}::uuid
            `;
            return zeile!.source_key;
        };
        const zitat = async (
            laufId: number,
            art: string,
            traeger: string,
            quelle: string,
            werte: { art: string | null; seiten: string | null; notiz: string | null },
        ): Promise<void> => {
            await zitatDb`
                INSERT INTO wikisync_quelle_zitat (lauf_id, traeger_art, traeger_id, quelle_key, art, seiten, notiz)
                VALUES (${laufId}::bigint, ${art}, ${traeger}::uuid, ${await schluessel(quelle)}, ${werte.art}, ${werte.seiten}, ${werte.notiz})
            `;
        };

        beforeAll(async () => {
            zitatDb = createDatabase(url as string, { max: 1 });
            const [vorhanden] = await database<
                { z: string | null }[]
            >`SELECT to_regclass('public.wikisync_quelle_zitat')::text AS z`;
            tafelDa = vorhanden?.z != null;
        });
        afterAll(async () => {
            await zitatDb.end({ timeout: 5 });
        });

        it("🔴 ohne die Tafel (vor Migration 0251 oder ohne das Recht der App) ist `wiki` überall null und das Lesen scheitert nicht", async () => {
            if (tafelDa) return; // Die Tafel gibt es in dieser Datenbank: den Fall „ohne“ gibt es hier nicht.
            await lauf(["quelle"]);
            const antwort = await leseTraegerQuellen(zitatDb, "place", P3.ort);
            expect(antwort!.wiki).toBeNull();
            expect(antwort!.quellen.length).toBeGreaterThan(0);
            expect(antwort!.quellen.every((q) => q.wiki === null)).toBe(true);
            await database`DELETE FROM wikisync_lauf WHERE parser_version = ${MARKE}`;
        });

        it("🔴 mit der Tafel, aber ohne Zitate ist `wiki` null; ein jüngerer Lauf anderer Bereiche oder ohne Zitate verdrängt den mit Zitaten nicht", async () => {
            await legeTafelAn();
            await database`DELETE FROM wikisync_lauf WHERE parser_version = ${MARKE}`;
            await lauf(["quelle"]);
            expect((await leseTraegerQuellen(zitatDb, "place", P3.ort))!.wiki).toBeNull();

            laufMitZitaten = await lauf(["quelle"], new Date(Date.now() - 60_000));
            // Das Zitat zu q3 am Ort: gleich der Verknüpfung aus Legacy (Erwähnung, Seite 7).
            await zitat(laufMitZitaten, "place", P3.ort, q3, { art: "erwaehnung", seiten: "7", notiz: null });
            // Ein jüngerer Lauf der Orte (ohne Bereich „quelle“) und ein jüngerer der Quellen ohne Zitate.
            await lauf(["ort"]);
            await lauf(["quelle"]);
            const antwort = await leseTraegerQuellen(zitatDb, "place", P3.ort);
            expect(antwort!.wiki).toMatchObject({ laufId: laufMitZitaten, dumpStand: "2026-10-01" });
            expect(typeof antwort!.wiki!.beendetAm).toBe("string");
            const [drei] = antwort!.quellen.filter((q) => q.sourceId === q3);
            expect(drei!.wiki).toEqual({ art: "erwaehnung", seiten: "7", notiz: null });
            // Eine Quelle, die das Wiki an diesem Objekt nicht zitiert, hat kein Zitat.
            expect(antwort!.quellen.filter((q) => q.sourceId !== q3).every((q) => q.wiki === null)).toBe(true);
            // Das Zitat gehört dem Objekt: am anderen Ort steht es nicht.
            expect((await leseTraegerQuellen(zitatDb, "place", P3.ortZwei))!.quellen).toEqual([]);
        });

        it("das Zitat eines Gipfels liegt unter der Art `peak`", async () => {
            await legeTafelAn();
            const laufId = laufMitZitaten;
            // Der Berggipfel trägt q3 (aktiv, Seite 9, Erwähnung) aus dem Test davor; das Wiki zitiert dasselbe.
            await zitat(laufId, "peak", P3.gipfel, q3, { art: "erwaehnung", seiten: "9", notiz: null });
            const gipfel = await leseTraegerQuellen(zitatDb, "peak", P3.gipfel);
            expect(gipfel!.wiki).toMatchObject({ laufId });
            const [drei] = gipfel!.quellen.filter((q) => q.sourceId === q3);
            expect(drei!.wiki).toEqual({ art: "erwaehnung", seiten: "9", notiz: null });
            // Das Zitat gehört dem Gipfel: an der Höhle steht es nicht.
            expect((await leseTraegerQuellen(zitatDb, "peak", HOEHLE))!.quellen.every((q) => q.wiki === null)).toBe(
                true,
            );
        });

        it("das Zitat einer Landschaft liegt unter der Art `area`; die Straße vergleicht jeden Abschnitt mit dem Zitat seines Artikels", async () => {
            await legeTafelAn();
            const laufId = laufMitZitaten;
            // Landschaft
            await schreiben(
                "area",
                P3.region,
                aendern([
                    {
                        op: "add",
                        sourceId: q2,
                        vorher: { state: "retired", referenceKind: "erwaehnung", pages: null, note: null },
                        pages: "4",
                    },
                ]),
            );
            await zitat(laufId, "area", P3.region, q2, { art: "erwaehnung", seiten: "4", notiz: null });
            const landschaft = await leseTraegerQuellen(zitatDb, "area", P3.region);
            expect(landschaft!.wiki).toMatchObject({ laufId });
            expect(landschaft!.quellen[0]!.wiki).toEqual({ art: "erwaehnung", seiten: "4", notiz: null });

            // Straße: q1 trägt beide Abschnitte mit „5“ (die Zeilen des Tests davor räumt die erste Anweisung weg).
            const strasse = await readEditorPathStreet(database, P3.weg);
            const [erster, zweiter] = strasse!.segments.map((s) => s.id) as [string, string];
            await database`DELETE FROM path_source WHERE source_id IN (SELECT id FROM feature_source WHERE source_system = ${MARKE})`;
            for (const abschnitt of [erster, zweiter]) {
                await database`
                    INSERT INTO path_source (path_id, source_id, reference_kind, pages, position, source_system)
                    SELECT p.id, f.id, 'erwaehnung', '5', 0, 'legacy' FROM path p, feature_source f
                     WHERE p.public_id = ${abschnitt}::uuid AND f.public_id = ${q1}::uuid
                `;
            }
            await zitat(laufId, "path", erster, q1, { art: "erwaehnung", seiten: "5", notiz: null });
            const nurEiner = await leseTraegerQuellen(zitatDb, "path", P3.weg);
            const nurEinerQ1 = nurEiner!.quellen.find((q) => q.sourceId === q1)!;
            // Nur ein Abschnitt hat ein Zitat: nicht jeder gleicht ihm, und oben steht das eine Zitat.
            expect(nurEinerQ1.abschnitte).toMatchObject({ mit: 2, von: 2, einheitlich: true, gleichDemWiki: false });
            expect(nurEinerQ1.wiki).toEqual({ art: "erwaehnung", seiten: "5", notiz: null });
            await zitat(laufId, "path", zweiter, q1, { art: "erwaehnung", seiten: " 5 ", notiz: "" });
            const beide = (await leseTraegerQuellen(zitatDb, "path", P3.weg))!.quellen.find((q) => q.sourceId === q1)!;
            expect(beide.abschnitte).toMatchObject({ gleichDemWiki: true });
            // Ein Abschnitt weicht ab (Seiten): nicht mehr jeder gleicht seinem Zitat.
            await database`
                UPDATE path_source SET pages = '6'
                 WHERE path_id = (SELECT id FROM path WHERE public_id = ${zweiter}::uuid) AND source_id = (SELECT id FROM feature_source WHERE public_id = ${q1}::uuid)
            `;
            const abweichend = (await leseTraegerQuellen(zitatDb, "path", P3.weg))!.quellen.find(
                (q) => q.sourceId === q1,
            )!;
            expect(abweichend.abschnitte).toMatchObject({ einheitlich: false, gleichDemWiki: false });
        });
    });
});
