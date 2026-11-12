import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyImportOffen } from "./support/legacy-import-offen.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ApiError } from "../src/http/api-error.ts";
import { leseWerk, listeWerke } from "../src/inhalte/werke-lesen.ts";
import { aendereWerk, legeWerkAn } from "../src/inhalte/werke-schreiben.ts";
import { importLiterature } from "../src/migration/literature-import.ts";
import { C, cleanCatalogFixtures, insertCatalogCarriers, workId } from "./support/catalog-fixture.ts";

/**
 * Das Fenster „Inhalte bearbeiten“, Reiter „Literatur“ (WI-0254, Runde 2, Migration 0233): anlegen, ändern, die geordnete Ortsliste, Schutz
 * vor dem Legacy-Zug, Lesen. Gegen die Wegwerf-Datenbank der Testläufe (`TEST_DATABASE_URL`); die Rechte der App-Rolle prüft der Rauchtest
 * der Schreibwege.
 *
 * Problemfälle: ein veralteter Stand überschreibt still; die Revision zählt gar nicht oder mehrfach; die Jahresangabe in Worten bleibt neben
 * einem anderen Jahr stehen; eine Zeile aus Legacy wird gelöscht statt unterdrückt; Legacys Nummern (Lücken) werden ohne Not neu vergeben;
 * ein Name wird zur Kennung eines Ziels; dasselbe Ziel steht zweimal in derselben Rolle; der Zug überschreibt, was die Redaktion ordnete.
 */

const url = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = url ? describe : describe.skip;
const redakteur: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
const operationen: string[] = [];
const neu = (): string => {
    const id = randomUUID();
    operationen.push(id);
    return id;
};

type Bag = Record<string, unknown>;
const legacyOrt = (sortOrder: number, rawName: string, over: Bag = {}): Bag => ({
    role: "play",
    target_kind: "unresolved",
    target_public_id: "",
    target_wiki_key: "",
    territory_path: [],
    raw_name: rawName,
    sort_order: sortOrder,
    ...over,
});
const legacyWerk = (n: number, over: Bag = {}): Bag => ({
    public_id: workId(n),
    title: `P68T Werk ${String(n)}`,
    wiki_url: "",
    product_type: "gruppenabenteuer",
    edition: "DSA5",
    bf_year: 1040,
    bf_label: "Praios 1040",
    genre: "",
    complexity_gm: "",
    complexity_pl: "",
    is_official: true,
    fshop_code: "",
    cover_url: "",
    series: "",
    link_ulisses: "",
    link_fshop: "",
    isbn: "",
    contained_in: "",
    places: [],
    links: [],
    ...over,
});
const katalog = (items: Bag[]): Bag => ({
    ok: true,
    adventures: items,
    territory_meta: {},
    covers_enabled: true,
    adventures_enabled: true,
});

describeWithDatabase("Literatur im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 2)", () => {
    let database: Database;

    const fehler = async (work: Promise<unknown>): Promise<ApiError> => {
        try {
            await work;
        } catch (error) {
            if (error instanceof ApiError) return error;
            throw error;
        }
        throw new Error("ging durch");
    };
    const zeile = async (publicId: string) => {
        const [row] = await database<
            {
                id: string;
                revision: number;
                title: string;
                product_type: string;
                edition: string | null;
                genre: string | null;
                bf_year: number | null;
                bf_label: string | null;
                is_official: boolean;
                editor_note: string | null;
                source_system: string;
                state: string;
                is_active: boolean;
                retired_origin: string | null;
            }[]
        >`
            SELECT id::text, revision::int, title, product_type, edition, genre, bf_year, bf_label, is_official, editor_note, source_system,
                   state, is_active, retired_origin
              FROM adventure WHERE public_id = ${publicId}::uuid
        `;
        return row!;
    };
    const herkunft = async (publicId: string): Promise<Record<string, string>> => {
        const rows = await database<{ field: string; origin: string }[]>`
            SELECT f.field, f.origin FROM adventure_field_origin f JOIN adventure a ON a.id = f.adventure_id
             WHERE a.public_id = ${publicId}::uuid
        `;
        return Object.fromEntries(rows.map((eine) => [eine.field, eine.origin]));
    };
    const orte = async (publicId: string) =>
        database<
            {
                id: string;
                sort_order: number;
                export_ordinal: number;
                dup_ordinal: number;
                raw_name: string;
                role: string;
                target_state: string;
                resolved_by: string | null;
                state: string;
                is_active: boolean;
                retired_origin: string | null;
                source_system: string;
                place_id: string | null;
                territory_id: string | null;
            }[]
        >`
            SELECT p.id::text, p.sort_order, p.export_ordinal, p.dup_ordinal, p.raw_name, p.role, p.target_state, p.resolved_by, p.state,
                   p.is_active, p.retired_origin, p.source_system, p.place_id::text, p.territory_id::text
              FROM adventure_place p JOIN adventure a ON a.id = p.adventure_id
             WHERE a.public_id = ${publicId}::uuid
             ORDER BY p.sort_order, p.export_ordinal, p.id
        `;
    const protokoll = async (operationId: string) =>
        database<
            {
                action: string;
                revision_before: number | null;
                revision_after: number | null;
                changes: Record<string, unknown>;
            }[]
        >`
            SELECT action, revision_before::int, revision_after::int, changes FROM map_audit_event WHERE operation_id = ${operationId}::uuid
        `;
    const aufraeumen = async (): Promise<void> => {
        const meine = `(SELECT id FROM adventure WHERE title LIKE 'P70T%')`;
        for (const tabelle of ["adventure_place", "adventure_link", "adventure_field_origin", "adventure_media"]) {
            await database.unsafe(`DELETE FROM ${tabelle} WHERE adventure_id IN ${meine}`);
        }
        await database.unsafe(`DELETE FROM adventure WHERE title LIKE 'P70T%'`);
        await cleanCatalogFixtures(database);
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
    };
    const angelegt = async (titel: string, art = "gruppenabenteuer"): Promise<string> => {
        const antwort = await legeWerkAn(database, redakteur, { operationId: neu(), title: titel, productType: art });
        return antwort.publicId;
    };
    const aendere = async (
        id: string,
        body: Omit<Parameters<typeof aendereWerk>[3], "operationId" | "baseRevision">,
        revision?: number,
    ) => {
        const stand = revision ?? (await zeile(id)).revision;
        return aendereWerk(database, redakteur, id, { operationId: neu(), baseRevision: stand, ...body } as never);
    };

    beforeAll(async () => {
        // Die Testdaten entstehen mit dem Schreibweg des Imports; der Besitz des Bereichs ist hier nicht Gegenstand.
        legacyImportOffen();
        database = createDatabase(url as string);
        await migrate(database);
        await aufraeumen();
    }, 180_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await aufraeumen();
        await insertCatalogCarriers(database);
    });

    it("🔴 Anlegen: ein Werk der Redaktion mit Herkunft „manuell“, Wiki-Schlüssel leer, ein Eintrag im Fachprotokoll und ein Satz für „Änderungen“", async () => {
        const operationId = neu();
        const koerper = { operationId, title: "  P70T Siegelbruch ", productType: "gruppenabenteuer" };
        const antwort = await legeWerkAn(database, redakteur, koerper);
        const werk = await zeile(antwort.publicId);
        expect(werk).toMatchObject({
            title: "P70T Siegelbruch",
            product_type: "gruppenabenteuer",
            is_official: true,
            source_system: "editor",
            state: "active",
            is_active: true,
            revision: 1,
        });
        expect(await herkunft(antwort.publicId)).toEqual({
            title: "manual",
            product_type: "manual",
            is_official: "manual",
        });
        const eintraege = await protokoll(operationId);
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]).toMatchObject({ action: "work.created", revision_before: null, revision_after: 1 });
        const [operation] = await database<
            { summary: string }[]
        >`SELECT summary FROM map_operation WHERE operation_id = ${operationId}::uuid`;
        expect(operation?.summary).toBe("Werk „P70T Siegelbruch“ angelegt");
        // Dieselbe Kennung noch einmal: dieselbe Quittung, kein zweites Werk.
        const nochmal = await legeWerkAn(database, redakteur, koerper);
        expect(nochmal.publicId).toBe(antwort.publicId);
        const [anzahl] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM adventure WHERE title = 'P70T Siegelbruch'`;
        expect(anzahl?.n).toBe(1);
        // Ein gleichlautender Titel ist kein Merge-Beweis: ein zweites Werk entsteht.
        await angelegt("P70T Siegelbruch");
        const [zwei] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM adventure WHERE title = 'P70T Siegelbruch'`;
        expect(zwei?.n).toBe(2);
    });

    it("🔴 Auszeichnung im Titel: Anlegen und Ändern speichern reinen Text", async () => {
        const id = await angelegt("P70T Der Scharlatan<br>Die Gabe");
        expect((await zeile(id)).title).toBe("P70T Der Scharlatan Die Gabe");
        await aendere(id, { fields: { title: "P70T [[Geisterschiff (Szenario)|Geisterschiff]]" } });
        expect((await zeile(id)).title).toBe("P70T Geisterschiff");
    });

    it("ein Werk ohne Titel oder Art entsteht nicht", async () => {
        expect(
            (await fehler(legeWerkAn(database, redakteur, { operationId: neu(), title: "  ", productType: "roman" })))
                .statusCode,
        ).toBe(400);
        expect(
            (await fehler(legeWerkAn(database, redakteur, { operationId: neu(), title: "P70T X", productType: " " })))
                .statusCode,
        ).toBe(400);
    });

    it("🔴 Ändern: die Revision zählt genau einmal, die Herkunft je Feld steht auf „manuell“, das Jahr in Worten fällt mit dem Jahr, ein Protokoll mit vorher und nachher", async () => {
        const id = await angelegt("P70T Werk Zwei");
        const stand = await zeile(id);
        await database`UPDATE adventure SET bf_year = 1040, bf_label = 'Praios 1040', genre = 'Stadt' WHERE public_id = ${id}::uuid`;
        const nachDb = await zeile(id);
        const operationId = neu();
        const quittung = await aendereWerk(database, redakteur, id, {
            operationId,
            baseRevision: nachDb.revision,
            fields: {
                title: "P70T Werk Zwei, neu",
                genre: " Abenteuer ",
                bfYear: 1044,
                edition: "DSA4.1",
                editorNote: "  Orte folgen der Handlung  ",
            },
        });
        expect(quittung.affected).toEqual([{ kind: "work", id, revision: nachDb.revision + 1 }]);
        const jetzt = await zeile(id);
        expect(jetzt).toMatchObject({
            title: "P70T Werk Zwei, neu",
            genre: "Abenteuer",
            bf_year: 1044,
            bf_label: null,
            edition: "DSA4.1",
            editor_note: "Orte folgen der Handlung",
            source_system: "editor",
            revision: nachDb.revision + 1,
        });
        expect(stand.revision).toBe(1);
        expect(await herkunft(id)).toMatchObject({
            title: "manual",
            genre: "manual",
            bf_year: "manual",
            bf_label: "manual",
            edition: "manual",
        });
        const eintraege = await protokoll(operationId);
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]).toMatchObject({
            action: "work.updated",
            revision_before: nachDb.revision,
            revision_after: nachDb.revision + 1,
        });
        expect(eintraege[0]!.changes).toMatchObject({
            title: { before: "P70T Werk Zwei", after: "P70T Werk Zwei, neu" },
            genre: { before: "Stadt", after: "Abenteuer" },
            bfYear: { before: 1040, after: 1044 },
            bfLabel: { before: "Praios 1040", after: null },
        });
        const [operation] = await database<
            { summary: string }[]
        >`SELECT summary FROM map_operation WHERE operation_id = ${operationId}::uuid`;
        expect(operation?.summary).toBe("Werk „P70T Werk Zwei, neu“ geändert");
    });

    it("dieselben Werte noch einmal: keine Revision und kein Protokoll; ein leerer Text wird zu null; ein veralteter Stand ist 409", async () => {
        const id = await angelegt("P70T Werk Drei");
        await aendere(id, { fields: { genre: "Solo" } });
        const nach = await zeile(id);
        const operationId = neu();
        await aendereWerk(database, redakteur, id, {
            operationId,
            baseRevision: nach.revision,
            fields: { genre: "Solo", title: "P70T Werk Drei" },
        });
        expect((await zeile(id)).revision).toBe(nach.revision);
        expect(await protokoll(operationId)).toHaveLength(0);
        await aendere(id, { fields: { genre: "   " } });
        expect((await zeile(id)).genre).toBeNull();
        const alt = await fehler(aendere(id, { fields: { genre: "Fremd" } }, nach.revision));
        expect(alt.statusCode).toBe(409);
        expect(alt.code).toBe("edit_conflict");
        expect((await fehler(aendere(id, { fields: { title: "  " } }))).statusCode).toBe(400);
        expect((await fehler(aendere(id, {}))).statusCode).toBe(400);
        expect(
            (
                await fehler(
                    aendereWerk(database, redakteur, randomUUID(), {
                        operationId: neu(),
                        baseRevision: 1,
                        fields: { genre: "x" },
                    }),
                )
            ).statusCode,
        ).toBe(404);
    });

    it("🔴 Die Ortsliste: echte Ziele und ein ungeklärter Name, in der Reihenfolge der Liste, jede Zeile mit EINER Rolle; ein freier Name wird nie zum Ziel", async () => {
        const id = await angelegt("P70T Werk Vier");
        const operationId = neu();
        await aendereWerk(database, redakteur, id, {
            operationId,
            baseRevision: 1,
            orte: [
                { kind: "territory", carrierId: C.gebietA, role: "start" },
                { kind: "place", carrierId: C.ortA, role: "play" },
                { rawName: "Ein Dorf im Norden", role: "covers" },
            ],
        });
        const zeilen = await orte(id);
        expect(zeilen.map((z) => [z.sort_order, z.raw_name, z.role, z.target_state, z.resolved_by])).toEqual([
            [0, expect.stringContaining("68T"), "start", "resolved", "public_id"],
            [1, expect.stringContaining("68T"), "play", "resolved", "public_id"],
            [2, "Ein Dorf im Norden", "covers", "unresolved", null],
        ]);
        expect(zeilen[0]!.territory_id).not.toBeNull();
        expect(zeilen[1]!.place_id).not.toBeNull();
        expect(zeilen.every((z) => z.source_system === "editor" && z.is_active && z.state === "active")).toBe(true);
        const werk = await leseWerk(database, id);
        expect(werk?.revision).toBe(2);
        expect(werk?.orte.map((o) => [o.role, o.targetState, o.kind ?? null, o.carrierId ?? null])).toEqual([
            ["start", "resolved", "territory", C.gebietA],
            ["play", "resolved", "place", C.ortA],
            ["covers", "unresolved", null, null],
        ]);
        const [eintrag] = await protokoll(operationId);
        expect(eintrag?.changes["places"]).toMatchObject({
            before: [],
            after: expect.arrayContaining([expect.objectContaining({ role: "start" })]),
        });
    });

    it("🔴 Umordnen, Rolle ändern (★), Lösen und Zurückholen: die Zeilen bleiben, nichts wird gelöscht", async () => {
        const id = await angelegt("P70T Werk Fuenf");
        await aendere(id, {
            orte: [
                { kind: "place", carrierId: C.ortA, role: "play" },
                { kind: "place", carrierId: C.ortB, role: "play" },
                { kind: "place", carrierId: C.ortC, role: "play" },
            ],
        });
        const [a, b, c] = (await orte(id)).map((z) => z.id) as [string, string, string];
        // Umordnen: C nach vorn und zum Startort, A bleibt.
        await aendere(id, {
            orte: [
                { rowId: c, role: "start" },
                { rowId: a, role: "play" },
                { rowId: b, role: "play" },
            ],
        });
        let zeilen = await orte(id);
        expect(zeilen.map((z) => [z.id, z.sort_order, z.role])).toEqual([
            [c, 0, "start"],
            [a, 1, "play"],
            [b, 2, "play"],
        ]);
        // Lösen: B (eine eigene Zeile) wird gelöst, nicht gelöscht.
        await aendere(id, {
            orte: [
                { rowId: c, role: "start" },
                { rowId: a, role: "play" },
            ],
        });
        zeilen = await orte(id);
        const gel = zeilen.find((z) => z.id === b)!;
        expect(gel).toMatchObject({
            state: "retired",
            is_active: false,
            retired_origin: "editor",
            source_system: "editor",
        });
        expect((await leseWerk(database, id))?.orte.find((o) => o.rowId === b)?.state).toBe("retired");
        // Zurückholen: B erscheint wieder in der Liste, jetzt in der Mitte.
        await aendere(id, {
            orte: [
                { rowId: c, role: "start" },
                { rowId: b, role: "play" },
                { rowId: a, role: "play" },
            ],
        });
        zeilen = await orte(id);
        expect(zeilen.map((z) => [z.id, z.sort_order, z.is_active])).toEqual([
            [c, 0, true],
            [b, 1, true],
            [a, 2, true],
        ]);
        // Dieselbe Folge noch einmal: nichts ändert sich, die Revision bleibt.
        const revision = (await zeile(id)).revision;
        await aendere(id, {
            orte: [
                { rowId: c, role: "start" },
                { rowId: b, role: "play" },
                { rowId: a, role: "play" },
            ],
        });
        expect((await zeile(id)).revision).toBe(revision);
    });

    it("dasselbe Ziel steht in derselben Rolle nur einmal, ein stilles Objekt nimmt kein Werk auf, eine fremde Zeile ist unbekannt", async () => {
        const id = await angelegt("P70T Werk Sechs");
        const doppelt = await fehler(
            aendere(id, {
                orte: [
                    { kind: "place", carrierId: C.ortA, role: "play" },
                    { kind: "place", carrierId: C.ortA, role: "play" },
                ],
            }),
        );
        expect(doppelt.statusCode).toBe(400);
        // Dasselbe Ziel in zwei Rollen ist erlaubt (gemessen: 2 Fälle im Bestand).
        await aendere(id, {
            orte: [
                { kind: "place", carrierId: C.ortA, role: "start" },
                { kind: "place", carrierId: C.ortA, role: "play" },
            ],
        });
        expect(await orte(id)).toHaveLength(2);
        expect(
            (await fehler(aendere(id, { orte: [{ kind: "place", carrierId: C.ortInaktiv, role: "play" }] })))
                .statusCode,
        ).toBe(400);
        expect(
            (await fehler(aendere(id, { orte: [{ kind: "place", carrierId: randomUUID(), role: "play" }] })))
                .statusCode,
        ).toBe(404);
        expect((await fehler(aendere(id, { orte: [{ rowId: "999999999", role: "play" }] }))).statusCode).toBe(400);
        // Eine Zeile steht nur einmal in der Liste.
        const [eins] = (await orte(id)).map((z) => z.id) as [string];
        expect(
            (
                await fehler(
                    aendere(id, {
                        orte: [
                            { rowId: eins, role: "play" },
                            { rowId: eins, role: "start" },
                        ],
                    }),
                )
            ).statusCode,
        ).toBe(400);
    });

    it("🔴 Eine Zeile aus Legacy wird unterdrückt statt gelöscht; Legacys Nummern (Lücken) bleiben, wo nur angehängt oder gelöst wird, und werden neu vergeben, wo umgeordnet wird", async () => {
        await importLiterature(
            database,
            katalog([
                legacyWerk(1, {
                    title: "P70T Legacy Werk",
                    places: [
                        legacyOrt(0, "Gareth", { role: "start", target_kind: "settlement", target_public_id: C.ortA }),
                        legacyOrt(5, "Mittelreich", {
                            role: "play",
                            target_kind: "territory",
                            target_public_id: C.gebietB,
                        }),
                        legacyOrt(9, "Ein Dorf", { role: "play", target_kind: "unresolved" }),
                    ],
                }),
            ]),
        );
        const id = workId(1);
        const vorher = await orte(id);
        expect(vorher.map((z) => [z.sort_order, z.source_system])).toEqual([
            [0, "legacy"],
            [5, "legacy"],
            [9, "legacy"],
        ]);
        const [r0, r5, r9] = vorher.map((z) => z.id) as [string, string, string];
        // Anhängen: die Nummern bleiben, die neue Zeile hängt hinten an (höchste Nummer + 1).
        await aendere(id, {
            orte: [
                { rowId: r0, role: "start" },
                { rowId: r5, role: "play" },
                { rowId: r9, role: "play" },
                { kind: "place", carrierId: C.ortB, role: "play" },
            ],
        });
        let zeilen = await orte(id);
        expect(zeilen.map((z) => z.sort_order)).toEqual([0, 5, 9, 10]);
        const neueId = zeilen[3]!.id;
        expect(zeilen[0]!.source_system).toBe("legacy");
        // Lösen: die Zeile aus Legacy wird unterdrückt (der Zug belebt sie nie), die Nummern der übrigen bleiben.
        await aendere(id, {
            orte: [
                { rowId: r0, role: "start" },
                { rowId: r9, role: "play" },
                { rowId: neueId, role: "play" },
            ],
        });
        zeilen = await orte(id);
        const unterdrueckt = zeilen.find((z) => z.id === r5)!;
        expect(unterdrueckt).toMatchObject({ state: "suppressed", is_active: false, retired_origin: "editor" });
        expect(zeilen.filter((z) => z.is_active).map((z) => z.sort_order)).toEqual([0, 9, 10]);
        // Umordnen: neu vergeben, 0 bis n-1.
        await aendere(id, {
            orte: [
                { rowId: r9, role: "play" },
                { rowId: r0, role: "start" },
                { rowId: neueId, role: "play" },
            ],
        });
        zeilen = await orte(id);
        expect(zeilen.filter((z) => z.is_active).map((z) => [z.id, z.sort_order])).toEqual([
            [r9, 0],
            [r0, 1],
            [neueId, 2],
        ]);
    });

    it("🔴 Der Legacy-Zug fasst ein Werk der Redaktion samt Ortsliste nie an und legt es nicht still", async () => {
        const antwort = {
            catalog: katalog([
                legacyWerk(2, {
                    title: "P70T Geschütztes Werk",
                    places: [
                        legacyOrt(0, "Gareth", { role: "start", target_kind: "settlement", target_public_id: C.ortA }),
                    ],
                }),
            ]),
        };
        await importLiterature(database, antwort.catalog);
        const id = workId(2);
        const [erste] = await orte(id);
        await aendere(id, {
            fields: { title: "P70T Geschütztes Werk, von Hand" },
            orte: [
                { kind: "place", carrierId: C.ortB, role: "start" },
                { rowId: erste!.id, role: "play" },
            ],
        });
        const nachBearbeitung = await orte(id);
        expect(nachBearbeitung.map((z) => z.sort_order)).toEqual([0, 1]);
        // Der Zug bringt Legacys Stand (anderer Titel, andere Ortsliste) und, in einem zweiten Lauf, gar kein Werk mehr.
        const zug = await importLiterature(
            database,
            katalog([
                legacyWerk(2, {
                    title: "P70T Legacy sagt etwas anderes",
                    places: [
                        legacyOrt(0, "Gareth", { role: "play", target_kind: "settlement", target_public_id: C.ortA }),
                        legacyOrt(1, "Neu in Legacy", { role: "play", target_kind: "unresolved" }),
                    ],
                }),
            ]),
        );
        expect(zug.skipped).toBe(false);
        expect((await zeile(id)).title).toBe("P70T Geschütztes Werk, von Hand");
        expect((await zeile(id)).source_system).toBe("editor");
        expect((await orte(id)).map((z) => [z.id, z.sort_order, z.role, z.is_active])).toEqual(
            nachBearbeitung.map((z) => [z.id, z.sort_order, z.role, z.is_active]),
        );
        await importLiterature(database, katalog([legacyWerk(3, { title: "P70T Anderes Werk" })]));
        const nach = await zeile(id);
        expect(nach).toMatchObject({ is_active: true, state: "active" });
        expect((await orte(id)).every((z) => z.is_active)).toBe(true);
    });

    it("Stilllegen und Zurückholen: unterdrückt, nie gelöscht; ein stilles Werk lässt sich nur wiederherstellen; die Liste kennt den Stand", async () => {
        const id = await angelegt("P70T Werk Acht");
        await aendere(id, { fields: { aktiv: false } });
        expect(await zeile(id)).toMatchObject({ is_active: false, state: "retired", retired_origin: "editor" });
        expect((await listeWerke(database, { q: "P70T Werk Acht" })).items).toHaveLength(0);
        const stille = await listeWerke(database, { q: "P70T Werk Acht", stand: "stillgelegt" });
        expect(stille.items.map((e) => [e.title, e.stillgelegt])).toEqual([["P70T Werk Acht", true]]);
        expect((await fehler(aendere(id, { fields: { genre: "x" } }))).statusCode).toBe(400);
        expect((await fehler(aendere(id, { orte: [] }))).statusCode).toBe(400);
        await aendere(id, { fields: { aktiv: true, genre: "Zurück" } });
        expect(await zeile(id)).toMatchObject({
            is_active: true,
            state: "active",
            retired_origin: null,
            genre: "Zurück",
        });
    });

    it("Lesen: die Liste sucht, sortiert und zählt, das Werk trägt Herkunft, Cover und Zeilen; ein unbekanntes Werk gibt es nicht", async () => {
        const a = await angelegt("P70T Alpha");
        const b = await angelegt("P70T Beta");
        await aendere(a, {
            fields: { bfYear: 1010, edition: "DSA5" },
            orte: [{ kind: "place", carrierId: C.ortA, role: "start" }],
        });
        await aendere(b, { fields: { bfYear: 1050 } });
        const nachTitel = await listeWerke(database, { q: "P70T", sort: "title" });
        expect(nachTitel.items.map((e) => e.title)).toEqual(["P70T Alpha", "P70T Beta"]);
        expect((await listeWerke(database, { q: "P70T", sort: "title_desc" })).items.map((e) => e.title)).toEqual([
            "P70T Beta",
            "P70T Alpha",
        ]);
        expect((await listeWerke(database, { q: "P70T", sort: "year" })).items.map((e) => e.title)).toEqual([
            "P70T Beta",
            "P70T Alpha",
        ]);
        const alpha = nachTitel.items[0]!;
        expect(alpha).toMatchObject({
            id: a,
            orte: 1,
            edition: "DSA5",
            year: "1010",
            herkunft: "editor",
            stillgelegt: false,
        });
        expect(nachTitel.zahlen.editor).toBeGreaterThanOrEqual(2);
        expect((await listeWerke(database, { q: "P70T", herkunft: "legacy" })).items).toHaveLength(0);
        expect((await listeWerke(database, { q: "p70t_" })).total).toBe(0);
        const werk = await leseWerk(database, a);
        expect(werk).toMatchObject({
            id: a,
            title: "P70T Alpha",
            ursprung: "manual",
            herkunft: "editor",
            aktiv: true,
            cover: { gebunden: false },
            feldUrsprung: { title: "manual", bfYear: "manual", edition: "manual" },
        });
        expect(await leseWerk(database, randomUUID())).toBeUndefined();
    });

    it("🔴 „Von Hand“ heißt im Editor geändert ODER von Legacys Redaktion von Hand gepflegt: beides ist ◐ und steht im Filter „manuell“", async () => {
        await importLiterature(
            database,
            katalog([legacyWerk(5, { title: "P70T Handwerk" }), legacyWerk(6, { title: "P70T Wikiwerk" })]),
        );
        await database`UPDATE adventure SET legacy_origin = 'manual' WHERE public_id = ${workId(5)}::uuid`;
        await database`UPDATE adventure SET legacy_origin = 'wiki' WHERE public_id = ${workId(6)}::uuid`;
        const hand = await listeWerke(database, { q: "P70T", herkunft: "editor" });
        expect(hand.items.map((e) => [e.title, e.herkunft])).toEqual([["P70T Handwerk", "editor"]]);
        const wiki = await listeWerke(database, { q: "P70T", herkunft: "legacy" });
        expect(wiki.items.map((e) => [e.title, e.herkunft])).toEqual([["P70T Wikiwerk", "legacy"]]);
        expect((await leseWerk(database, workId(5)))?.ursprung).toBe("manual");
        expect((await leseWerk(database, workId(6)))?.ursprung).toBe("wiki");
        expect((await leseWerk(database, workId(5)))?.herkunft).toBe("editor");
        // Schreibt die Redaktion an ein Werk aus Legacy, wird aus dem Stand „Wiki“ der Stand „manuell“, das Werk gehört ihr.
        await aendere(workId(6), { fields: { genre: "Hand" } });
        expect(await leseWerk(database, workId(6))).toMatchObject({ ursprung: "manual", herkunft: "editor" });
    });
});
