import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyImportOffen } from "./support/legacy-import-offen.ts";
import { Value } from "@sinclair/typebox/value";
import { INHALTE_KONTINENTE, InhalteVorkommen } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ApiError } from "../src/http/api-error.ts";
import { leseVorkommen, listeVorkommen, sucheVorkommenZiele } from "../src/inhalte/vorkommen-lesen.ts";
import { aendereVorkommen, legeVorkommenAn } from "../src/inhalte/vorkommen-schreiben.ts";
import { CONTINENT_KEYS } from "../src/migration/lore-keys.ts";
import { importLore } from "../src/migration/lore-import.ts";
import { verifyLore } from "../src/migration/verify-lore.ts";
import {
    C,
    KRAEUTER_KEY,
    ZOO_KEY,
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
 * Das Fenster „Inhalte bearbeiten“, Reiter „Vorkommen“ (WI-0254, Runde 3, Migration 0234): Lesen, Stammdaten, Ortszeilen mit ihren Treffern, Quellen,
 * Schutz vor dem Legacy-Zug. Gegen die Wegwerf-Datenbank der Testläufe (`TEST_DATABASE_URL`); die Rechte der App-Rolle prüft der Rauchtest der
 * Schreibwege.
 *
 * Problemfälle: ein veralteter Stand überschreibt still; die Revision zählt gar nicht oder mehrfach; ein Objekt OHNE Wiki-Schlüssel wird zum Ziel
 * (der Schlüssel wäre geraten); ein Name wird zum Schlüssel; eine Zeile aus Legacy wird gelöscht statt unterdrückt; die Treffer einer neuen Zeile
 * sind falsch oder veralten; der Zug überschreibt, was die Redaktion änderte.
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

const A = "p74t-alraune";
const B = "p74t-leinoel";
const W = "p74t-weizen";
const S = "p74t-ork";
const G = "p74t-goblin";
const wald = { kind: "vegetation", region_type: "wald" };

describe("Die Kontinentliste der Redaktion ist die des Imports", () => {
    it("gleiche Begriffe in gleicher Folge", () => {
        expect([...INHALTE_KONTINENTE]).toEqual([...CONTINENT_KEYS]);
    });
});

describeWithDatabase("Vorkommen im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 3)", () => {
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
    const idVon = async (wikiKey: string): Promise<string> => {
        const [zeile] = await database<
            { public_id: string }[]
        >`SELECT public_id::text FROM lore_entry WHERE wiki_key = ${wikiKey}`;
        return zeile!.public_id;
    };
    const zeile = async (wikiKey: string) => {
        const [row] = await database<
            {
                id: string;
                revision: number;
                name: string;
                kind: string;
                gruppe: string | null;
                lebensraum: string | null;
                synonyme: string | null;
                editor_note: string | null;
                source_system: string;
                state: string;
                is_active: boolean;
                retired_origin: string | null;
            }[]
        >`
            SELECT id::text, revision::int, name, kind, gruppe, lebensraum, synonyme, editor_note, source_system, state, is_active, retired_origin
              FROM lore_entry WHERE wiki_key = ${wikiKey}
        `;
        return row!;
    };
    const herkunft = async (wikiKey: string): Promise<Record<string, string>> => {
        const rows = await database<{ field: string; origin: string }[]>`
            SELECT f.field, f.origin FROM lore_entry_field_origin f JOIN lore_entry e ON e.id = f.lore_entry_id WHERE e.wiki_key = ${wikiKey}
        `;
        return Object.fromEntries(rows.map((eine) => [eine.field, eine.origin]));
    };
    const orte = async (wikiKey: string) =>
        database<
            {
                id: string;
                place_wiki_key: string | null;
                relation: string;
                sort_order: number;
                key_class: string;
                target_state: string;
                target_count: number;
                state: string;
                is_active: boolean;
                retired_origin: string | null;
                source_system: string;
                target_origin: string;
                legacy_origin: string;
                treffer: number;
            }[]
        >`
            SELECT p.id::text, p.place_wiki_key, p.relation, p.sort_order, p.key_class, p.target_state, p.target_count::int AS target_count, p.state, p.is_active,
                   p.retired_origin, p.source_system, p.target_origin, p.legacy_origin,
                   (SELECT count(*) FROM lore_place_target t WHERE t.lore_place_id = p.id)::int AS treffer
              FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id
             WHERE e.wiki_key = ${wikiKey}
             ORDER BY p.sort_order, p.id
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
        await cleanLoreFixtures(database);
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
    };
    const aendere = async (
        wikiKey: string,
        body: Omit<Parameters<typeof aendereVorkommen>[3], "operationId" | "baseRevision">,
        revision?: number,
    ) => {
        const stand = revision ?? (await zeile(wikiKey)).revision;
        return aendereVorkommen(database, redakteur, await idVon(wikiKey), {
            operationId: neu(),
            baseRevision: stand,
            ...body,
        } as never);
    };

    /** Eine Antwort des Exports: Alraune (Flora, Wiki) mit allen Zuständen der Auflösung, eine Ware von Hand, eine unterdrückte Art, eine Spezies. */
    const antwort = () =>
        answer({
            entries: [
                entry(A, "flora", {
                    name: "P74T Alraune",
                    wiki_title: "Alraune",
                    gruppe: "Heilpflanze",
                    lebensraum: "Wald",
                    synonyme: "Mandragora",
                    field_origins: { gruppe: "manual" },
                }),
                entry(B, "ware", { name: "P74T Leinöl", origin: "manual" }),
                entry(W, "ware", { name: "P74T Weizen", status: "suppressed" }),
                entry(S, "spezies", { name: "P74T Ork" }),
                entry(G, "fauna", { name: "P74T Goblin", status: "retired" }),
            ],
            places: [
                place(A, "p68t-ort-a", { sort_order: 0 }),
                place(A, "p68t-ort-geteilt", { sort_order: 1 }),
                place(A, "aventurien", { sort_order: 2 }),
                place(A, "p68t-gibtesnicht", { sort_order: 3, relation: "herkunft" }),
                place(B, "p68t-ort-a"),
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
        await insertLoreFixtures(database);
        await importLore(database, antwort());
    });

    it("🔴 Lesen: die Liste sucht, filtert nach Art und Herkunft und zählt; ein unterdrückter Eintrag steht unter „stillgelegt“, ein vom Wiki vergessener nirgends", async () => {
        const liste = await listeVorkommen(database, { q: "P74T" });
        expect(liste.items.map((e) => [e.title, e.art, e.herkunft])).toEqual([
            ["P74T Alraune", "flora", "legacy"],
            ["P74T Leinöl", "ware", "editor"],
            ["P74T Ork", "spezies", "legacy"],
        ]);
        expect(liste.items[0]).toMatchObject({ gruppe: "Heilpflanze", verknuepfungen: 4, stillgelegt: false });
        expect((await listeVorkommen(database, { q: "P74T", art: "ware" })).items.map((e) => e.title)).toEqual([
            "P74T Leinöl",
        ]);
        expect((await listeVorkommen(database, { q: "mandragora" })).items.map((e) => e.title)).toEqual([
            "P74T Alraune",
        ]);
        expect((await listeVorkommen(database, { q: "P74T", herkunft: "editor" })).items.map((e) => e.title)).toEqual([
            "P74T Leinöl",
        ]);
        expect((await listeVorkommen(database, { q: "P74T", sort: "title_desc" })).items.map((e) => e.title)[0]).toBe(
            "P74T Ork",
        );
        const still = await listeVorkommen(database, { q: "P74T", stand: "stillgelegt" });
        expect(still.items.map((e) => [e.title, e.stillgelegt])).toEqual([["P74T Weizen", true]]);
        expect((await listeVorkommen(database, { q: "Goblin", stand: "alle" })).items).toEqual([]);
        expect(liste.zahlen.aktiv).toBeGreaterThanOrEqual(3);
        expect((await listeVorkommen(database, { q: "p74t_" })).total).toBe(0);
    });

    it("🔴 Lesen: der Eintrag trägt Ortszeilen mit ihren Treffern (ein Treffer, mehrere, Kontinent, keiner), die Regel samt Bedingungen und die Quelle", async () => {
        const id = await idVon(A);
        const eintrag = await leseVorkommen(database, id);
        expect(eintrag).toMatchObject({
            id,
            wikiKey: A,
            name: "P74T Alraune",
            art: "flora",
            gruppe: "Heilpflanze",
            ursprung: "wiki",
            herkunft: "legacy",
            aktiv: true,
            feldUrsprung: { gruppe: "manual" },
        });
        const zeilen = eintrag!.orte.map((o) => [o.wikiKey, o.relation, o.targetState, o.keyClass, o.trefferGesamt]);
        expect(zeilen).toEqual([
            ["p68t-ort-a", "verbreitung", "resolved", "other", 1],
            ["p68t-ort-geteilt", "verbreitung", "ambiguous", "other", 2],
            ["aventurien", "verbreitung", "unresolved", "continent", 0],
            ["p68t-gibtesnicht", "herkunft", "unmatched", "other", 0],
        ]);
        expect(eintrag!.orte[0]!.treffer.map((t) => [t.kind, t.carrierId])).toEqual([["place", C.ortA]]);
        expect(eintrag!.orte[1]!.treffer).toHaveLength(2);
        expect(eintrag!.regeln).toHaveLength(1);
        expect(eintrag!.regeln[0]).toMatchObject({ relation: "verbreitung", ursprung: "manual", state: "active" });
        expect(
            eintrag!.regeln[0]!.bedingungen.map((b) => [
                b.joinOp,
                b.arten.map((a) => `${a.ebene}/${a.art}`),
                b.klima ?? null,
            ]),
        ).toEqual([
            ["und", ["vegetation/wald"], null],
            ["oder", [], { von: "gemaessigt", bis: "subtropisch" }],
        ]);
        expect(eintrag!.quellen.map((q) => [q.title, q.pages, q.state, q.ursprung])).toEqual([
            ["P74T Zoo-Botanica Aventurica", "88", "active", "wiki"],
        ]);
        // Der Fingerabdruck der Regel (Paket R des Regeleditors) steht im Lesemodell; Wiki-Fassung und Vorschlag liefert erst der Regelweg.
        expect(eintrag!.regeln[0]!.ruleKey).toMatch(/^[0-9a-f]{64}$/);
        expect(eintrag!.regeln[0]).not.toHaveProperty("wikiBasis");
        expect(eintrag).not.toHaveProperty("wikiVorschlag");
        expect(await leseVorkommen(database, randomUUID())).toBeUndefined();
    });

    it("🔴 Lesen: jede Ortszeile nennt ihre Rolle; eine Zeile ohne Rolle (Bestand) ist ein Ort, eine Zeile mit anderer Rolle kommt mit dieser Rolle und ohne Treffer an (WI-0253 §23)", async () => {
        const id = await idVon(A);
        const bestand = await leseVorkommen(database, id);
        expect(bestand!.orte.map((o) => o.rolle)).toEqual(["ort", "ort", "ort", "ort"]);
        // So legt der WikiSync eine Zeile still um: Rolle gesetzt, die Treffer weg, nichts zugeordnet (`uebernahme/vorkommen.ts`, `trefferRechner`).
        const setze = async (schluessel: string, rolle: string | null): Promise<void> => {
            await database`
                UPDATE lore_place SET role = ${rolle}, key_class = 'other', target_state = 'unmatched', target_count = 0
                 WHERE place_wiki_key = ${schluessel} AND lore_entry_id = (SELECT id FROM lore_entry WHERE wiki_key = ${A})
            `;
            await database`
                DELETE FROM lore_place_target WHERE lore_place_id IN (
                    SELECT p.id FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id WHERE e.wiki_key = ${A} AND p.place_wiki_key = ${schluessel})
            `;
        };
        await setze("p68t-ort-a", "bezugspunkt");
        await setze("p68t-gibtesnicht", "andere_welt");
        // Eine ausdrücklich gesetzte Rolle "ort" ist dasselbe wie keine.
        await database`UPDATE lore_place SET role = 'ort' WHERE place_wiki_key = 'p68t-ort-geteilt' AND lore_entry_id = (SELECT id FROM lore_entry WHERE wiki_key = ${A})`;
        const eintrag = await leseVorkommen(database, id);
        expect(eintrag!.orte.map((o) => [o.wikiKey, o.rolle, o.targetState, o.trefferGesamt])).toEqual([
            ["p68t-ort-a", "bezugspunkt", "unmatched", 0],
            ["p68t-ort-geteilt", "ort", "ambiguous", 2],
            ["aventurien", "ort", "unresolved", 0],
            ["p68t-gibtesnicht", "andere_welt", "unmatched", 0],
        ]);
        expect(eintrag!.orte[0]!.treffer).toEqual([]);
        // Das Feld steht im Schema der Antwort (Fastify streift sonst ab) und ist dort ein Wort der Rollen.
        expect(Value.Check(InhalteVorkommen, eintrag)).toBe(true);
    });

    it("🔴 Ändern: die Revision zählt genau einmal, die Herkunft je Feld steht auf „manuell“, ein Protokoll mit vorher und nachher; der Wiki-Schlüssel bleibt", async () => {
        const stand = await zeile(A);
        const operationId = neu();
        const id = await idVon(A);
        const quittung = await aendereVorkommen(database, redakteur, id, {
            operationId,
            baseRevision: stand.revision,
            fields: {
                name: "  P74T Alraune, neu ",
                art: "fauna",
                gruppe: "   ",
                lebensraum: "Wald und Moor",
                synonyme: "Galgenmännlein",
                editorNote: " Eine Anmerkung ",
            },
        });
        expect(quittung.affected).toEqual([{ kind: "lore", id, revision: stand.revision + 1 }]);
        expect(await zeile(A)).toMatchObject({
            name: "P74T Alraune, neu",
            kind: "fauna",
            gruppe: null,
            lebensraum: "Wald und Moor",
            synonyme: "Galgenmännlein",
            editor_note: "Eine Anmerkung",
            source_system: "editor",
            revision: stand.revision + 1,
        });
        expect(await herkunft(A)).toMatchObject({
            name: "manual",
            kind: "manual",
            gruppe: "manual",
            lebensraum: "manual",
            synonyme: "manual",
        });
        const [eintrag] = await protokoll(operationId);
        expect(eintrag).toMatchObject({
            action: "lore.updated",
            revision_before: stand.revision,
            revision_after: stand.revision + 1,
        });
        expect(eintrag!.changes).toMatchObject({
            name: { before: "P74T Alraune", after: "P74T Alraune, neu" },
            art: { before: "flora", after: "fauna" },
            gruppe: { before: "Heilpflanze", after: null },
        });
        const [operation] = await database<
            { summary: string }[]
        >`SELECT summary FROM map_operation WHERE operation_id = ${operationId}::uuid`;
        expect(operation?.summary).toBe("Vorkommen „P74T Alraune, neu“ geändert");
        const gelesen = await leseVorkommen(database, id);
        expect(gelesen).toMatchObject({ wikiKey: A, ursprung: "manual", herkunft: "editor" });
    });

    it("dieselben Werte noch einmal: keine Revision, kein Protokoll; ein veralteter Stand ist 409; ein leerer Name, eine leere Anfrage und ein fremder Eintrag werden abgelehnt", async () => {
        await aendere(A, { fields: { synonyme: "Eins" } });
        const nach = await zeile(A);
        const operationId = neu();
        await aendereVorkommen(database, redakteur, await idVon(A), {
            operationId,
            baseRevision: nach.revision,
            fields: { synonyme: "Eins", name: nach.name },
        });
        expect((await zeile(A)).revision).toBe(nach.revision);
        expect(await protokoll(operationId)).toHaveLength(0);
        const alt = await fehler(aendere(A, { fields: { synonyme: "Zwei" } }, nach.revision - 1));
        expect(alt.statusCode).toBe(409);
        expect(alt.code).toBe("edit_conflict");
        expect((await fehler(aendere(A, { fields: { name: "  " } }))).statusCode).toBe(400);
        expect((await fehler(aendere(A, {}))).statusCode).toBe(400);
        expect(
            (
                await fehler(
                    aendereVorkommen(database, redakteur, randomUUID(), {
                        operationId: neu(),
                        baseRevision: 1,
                        fields: { gruppe: "x" },
                    }),
                )
            ).statusCode,
        ).toBe(404);
    });

    it("🔴 Ortszeile anhängen: der Schlüssel kommt aus der Zuordnung, die Treffer rechnet der Lookup des Imports, die Zeile ist von Hand (9999, target_origin editor)", async () => {
        const operationId = neu();
        await aendereVorkommen(database, redakteur, await idVon(S), {
            operationId,
            baseRevision: (await zeile(S)).revision,
            // Gareth hat einen Schlüssel; die Region auch; ein Kontinentbegriff braucht keinen Träger.
            orte: [
                { op: "add", kind: "area", carrierId: C.regionA, relation: "regionen" },
                { op: "add", kontinent: "myranor", relation: "verbreitung" },
            ],
        });
        const zeilen = await orte(S);
        const neue = zeilen.filter((z) => z.source_system === "editor");
        expect(neue.map((z) => [z.place_wiki_key, z.relation, z.sort_order, z.target_origin, z.legacy_origin])).toEqual(
            [
                ["p68t-region-a", "regionen", 9999, "editor", "manual"],
                ["myranor", "verbreitung", 9999, "editor", "manual"],
            ],
        );
        expect(neue[0]).toMatchObject({ target_state: "resolved", target_count: 1, treffer: 1, key_class: "other" });
        expect(neue[1]).toMatchObject({
            target_state: "unresolved",
            target_count: 0,
            treffer: 0,
            key_class: "continent",
        });
        const [eintrag] = await protokoll(operationId);
        expect(eintrag?.action).toBe("lore.updated");
        expect(eintrag?.changes["places"]).toMatchObject({
            before: [],
            after: expect.arrayContaining([expect.objectContaining({ wikiKey: "myranor" })]),
        });
        const gelesen = await leseVorkommen(database, await idVon(S));
        const region = gelesen!.orte.find((o) => o.wikiKey === "p68t-region-a")!;
        expect(region).toMatchObject({ ursprung: "manual", herkunft: "editor", targetState: "resolved" });
        expect(region.treffer.map((t) => t.kind)).toEqual(["area"]);
        expect(await zeile(S)).toMatchObject({ source_system: "editor" });
    });

    it("🔴 ein Objekt OHNE Wiki-Schlüssel, ein stilles Objekt und eine doppelte Zeile sind keine Ziele; ein Name wird nie zum Schlüssel", async () => {
        const ohneSchluessel = await fehler(
            aendere(S, { orte: [{ op: "add", kind: "place", carrierId: C.ortOhneZuordnung, relation: "vorkommen" }] }),
        );
        expect(ohneSchluessel.statusCode).toBe(400);
        expect(JSON.stringify(ohneSchluessel.details)).toContain("wiki_key");
        // Der inaktive Ort trägt eine Zuordnung, ist aber kein Ziel.
        expect(
            (
                await fehler(
                    aendere(S, {
                        orte: [{ op: "add", kind: "place", carrierId: C.ortInaktiv, relation: "vorkommen" }],
                    }),
                )
            ).statusCode,
        ).toBe(400);
        expect(
            (
                await fehler(
                    aendere(S, {
                        orte: [{ op: "add", kind: "place", carrierId: randomUUID(), relation: "vorkommen" }],
                    }),
                )
            ).statusCode,
        ).toBe(404);
        // Dieselbe Zeile (derselbe Schlüssel, dieselbe Beziehung) steht schon da.
        expect(
            (
                await fehler(
                    aendere(S, { orte: [{ op: "add", kind: "place", carrierId: C.ortA, relation: "vorkommen" }] }),
                )
            ).statusCode,
        ).toBe(400);
        // Eine andere Beziehung zum selben Ziel ist eine andere Zeile.
        await aendere(S, { orte: [{ op: "add", kind: "place", carrierId: C.ortA, relation: "herkunft" }] });
        expect((await orte(S)).filter((z) => z.place_wiki_key === "p68t-ort-a")).toHaveLength(2);
        expect((await zeile(S)).revision).toBe(2);
    });

    it("🔴 Entfernen legt still, es löscht nie: Legacy wird unterdrückt, die eigene Zeile gelöst; Zurückholen rechnet die Treffer neu; eine fremde Zeile ist unbekannt", async () => {
        const [legacyZeile] = await orte(S);
        await aendere(S, { orte: [{ op: "add", kontinent: "aventurien", relation: "verbreitung" }] });
        const eigene = (await orte(S)).find((z) => z.source_system === "editor")!;
        await aendere(S, {
            orte: [
                { op: "remove", rowId: legacyZeile!.id },
                { op: "remove", rowId: eigene.id },
            ],
        });
        let zeilen = await orte(S);
        expect(zeilen.find((z) => z.id === legacyZeile!.id)).toMatchObject({
            state: "suppressed",
            is_active: false,
            retired_origin: "editor",
            source_system: "editor",
        });
        expect(zeilen.find((z) => z.id === eigene.id)).toMatchObject({
            state: "retired",
            is_active: false,
            retired_origin: "editor",
        });
        expect((await leseVorkommen(database, await idVon(S)))!.orte.every((o) => o.state !== "active")).toBe(true);
        // Doppelt lösen geht nicht; Zurückholen schon, und die Treffer stehen wieder da.
        expect((await fehler(aendere(S, { orte: [{ op: "remove", rowId: legacyZeile!.id }] }))).statusCode).toBe(400);
        await aendere(S, { orte: [{ op: "restore", rowId: legacyZeile!.id }] });
        zeilen = await orte(S);
        expect(zeilen.find((z) => z.id === legacyZeile!.id)).toMatchObject({
            state: "active",
            is_active: true,
            retired_origin: null,
            treffer: 1,
        });
        expect((await fehler(aendere(S, { orte: [{ op: "restore", rowId: legacyZeile!.id }] }))).statusCode).toBe(400);
        expect((await fehler(aendere(S, { orte: [{ op: "remove", rowId: "999999999" }] }))).statusCode).toBe(400);
        // Dasselbe Ziel in derselben Beziehung noch einmal anhängen holt die gelöste eigene Zeile zurück, statt eine zweite anzulegen.
        await aendere(S, { orte: [{ op: "add", kontinent: "aventurien", relation: "verbreitung" }] });
        expect((await orte(S)).filter((z) => z.place_wiki_key === "aventurien")).toHaveLength(1);
        expect((await orte(S)).find((z) => z.id === eigene.id)).toMatchObject({ state: "active", is_active: true });
    });

    it("🔴 Lesen: Herkunft der Quellen ist der Vergleich mit dem Wiki (WI-0254 §12) – das Zitat je Quelle und oben der Lauf; ohne einen Lauf mit Zitaten der Vorkommen fehlen beide, und ein jüngerer Lauf ohne sie verdeckt den älteren nicht", async () => {
        const id = await idVon(A);
        const kraeuter = (
            await database<
                { public_id: string }[]
            >`SELECT public_id::text FROM feature_source WHERE source_key = ${KRAEUTER_KEY}`
        )[0]!;
        // Eine zweite Quelle am Eintrag, die der Artikel nicht nennt.
        await aendere(A, {
            quellen: [{ op: "add", sourceId: kraeuter.public_id, referenceKind: "erwaehnung", pages: "5" }],
        });

        const laeufe: number[] = [];
        const lauf = async (
            zahlen: Record<string, unknown>,
            zitate: {
                art: string;
                id: string;
                quelle: string;
                nennung: string;
                seiten: string | null;
                notiz: string | null;
            }[] = [],
            status = "fertig",
        ): Promise<number> => {
            const [kopf] = await database<{ id: number }[]>`
                INSERT INTO wikisync_lauf (bereiche, status, dump_datei, dump_sha256, dump_stand, dump_seiten, dump_vollstaendig, parser_version, beendet_am, zahlen)
                VALUES (ARRAY['quelle']::text[], ${status}, 'dump.xml', ${"a".repeat(64)}, '2026-10-01', 1, TRUE, 'test',
                        ${status === "laeuft" ? null : new Date().toISOString()}::timestamptz, ${database.json(zahlen as never)})
                RETURNING id::int AS id
            `;
            for (const z of zitate)
                await database`
                    INSERT INTO wikisync_quelle_zitat (lauf_id, traeger_art, traeger_id, quelle_key, art, seiten, notiz, artikel)
                    VALUES (${kopf!.id}, ${z.art}, ${z.id}::uuid, ${z.quelle}, ${z.nennung}, ${z.seiten}, ${z.notiz}, 'Alraune')
                `;
            laeufe.push(kopf!.id);
            return kopf!.id;
        };
        const lies = async () => (await leseVorkommen(database, id))!;
        try {
            // Kein Lauf: Weder der Lauf noch das Zitat je Quelle stehen da (die Oberfläche zeigt keinen Kreis).
            let eintrag = await lies();
            expect(eintrag).not.toHaveProperty("quellenWiki");
            expect(eintrag.quellen).toHaveLength(2);
            for (const quelle of eintrag.quellen) expect(quelle).not.toHaveProperty("wiki");

            // Ein Lauf mit Zitaten nur der Karte (oder vor dem Bau der Vorkommen-Zitate) sagt über die Vorkommen nichts.
            await lauf({ quelle: { zitate: 4, zitateVorkommen: 0 } }, [
                { art: "place", id: randomUUID(), quelle: ZOO_KEY, nennung: "ausfuehrlich", seiten: "1", notiz: null },
            ]);
            await lauf({ quelle: { zitate: 4 } });
            eintrag = await lies();
            expect(eintrag).not.toHaveProperty("quellenWiki");
            expect(eintrag.quellen[0]).not.toHaveProperty("wiki");

            // Ein Lauf mit Zitaten der Vorkommen: Der Artikel nennt die Zoo-Botanica mit anderer Fundstelle und Notiz, die Kräuterkunde nennt er nicht.
            const mitZitaten = await lauf({ quelle: { zitate: 1, zitateVorkommen: 1 } }, [
                { art: "lore", id, quelle: ZOO_KEY, nennung: "ergaenzend", seiten: "88", notiz: "{{R5}} Zoo" },
                // Ein Zitat eines anderen Eintrags und eines anderen Trägers an derselben Quelle gehört nicht hierher.
                {
                    art: "lore",
                    id: randomUUID(),
                    quelle: KRAEUTER_KEY,
                    nennung: "ausfuehrlich",
                    seiten: "9",
                    notiz: null,
                },
                { art: "place", id, quelle: KRAEUTER_KEY, nennung: "ausfuehrlich", seiten: "9", notiz: null },
            ]);
            eintrag = await lies();
            expect(eintrag.quellenWiki).toMatchObject({ laufId: mitZitaten, dumpStand: "2026-10-01" });
            expect(eintrag.quellen.map((q) => [q.title, q.wiki])).toEqual([
                ["P74T Zoo-Botanica Aventurica", { art: "ergaenzend", seiten: "88", notiz: "{{R5}} Zoo" }],
                ["P74T Kräuterkunde", null],
            ]);
            expect(Value.Check(InhalteVorkommen, eintrag)).toBe(true);
            // Ein Eintrag ohne Quellen bekommt den Lauf trotzdem (der Satz „Noch kein Abgleich“ entfällt).
            expect((await leseVorkommen(database, await idVon(B)))?.quellenWiki).toMatchObject({ laufId: mitZitaten });

            // Ein jüngerer Lauf, der die Zitate wegen eines fehlenden Rechts übersprang, oder einer, der noch läuft, verdeckt ihn nicht.
            await lauf({ quelle: { zitateUebersprungen: 7 } });
            await lauf({ quelle: { zitate: 1, zitateVorkommen: 1 } }, [], "laeuft");
            expect((await lies()).quellenWiki).toMatchObject({ laufId: mitZitaten });
            // Ein jüngerer fertiger mit Zitaten der Vorkommen löst ihn ab.
            const juenger = await lauf({ quelle: { zitate: 1, zitateVorkommen: 1 } }, [
                { art: "lore", id, quelle: KRAEUTER_KEY, nennung: "erwaehnung", seiten: "5", notiz: null },
            ]);
            eintrag = await lies();
            expect(eintrag.quellenWiki).toMatchObject({ laufId: juenger });
            expect(eintrag.quellen.map((q) => q.wiki)).toEqual([null, { art: "erwaehnung", seiten: "5", notiz: null }]);
        } finally {
            await database`DELETE FROM wikisync_lauf WHERE id = ANY(${laeufe}::bigint[])`;
        }
    });

    it("🔴 Quellen des Eintrags: anhängen, Fundstelle ändern, lösen (Wiki unterdrückt, eigene gelöst) und zurückholen; nur über echte Katalogquellen", async () => {
        const kraeuter = await database<
            { public_id: string }[]
        >`SELECT public_id::text FROM feature_source WHERE title = 'P74T Kräuterkunde'`;
        const zoo = await database<
            { public_id: string }[]
        >`SELECT public_id::text FROM feature_source WHERE title = 'P74T Zoo-Botanica Aventurica'`;
        const kraeuterId = kraeuter[0]!.public_id;
        const zooId = zoo[0]!.public_id;
        const operationId = neu();
        await aendereVorkommen(database, redakteur, await idVon(S), {
            operationId,
            baseRevision: (await zeile(S)).revision,
            quellen: [
                { op: "add", sourceId: kraeuterId, referenceKind: "ausfuehrlich", pages: "12" },
                { op: "add", sourceId: zooId },
            ],
        });
        let gelesen = (await leseVorkommen(database, await idVon(S)))!;
        expect(gelesen.quellen.map((q) => [q.title, q.referenceKind, q.pages, q.state, q.herkunft])).toEqual([
            ["P74T Kräuterkunde", "ausfuehrlich", "12", "active", "editor"],
            ["P74T Zoo-Botanica Aventurica", null, null, "active", "editor"],
        ]);
        // Typ, „offiziell“ und Adresse gehören der Quelle im Katalog (Klappbox der Quellen): Die Verknüpfung trägt sie nur zum Lesen; eine Buchquelle ohne Adresse hat keine `url`.
        expect(gelesen.quellen.map((q) => [q.sourceType, q.offiziell, q.url ?? null])).toEqual([
            ["sonstiges", false, "https://p74test.example/kraeuter"],
            ["regionalspielhilfe", true, null],
        ]);
        expect(Value.Check(InhalteVorkommen, gelesen)).toBe(true);
        expect((await protokoll(operationId))[0]?.changes["sources"]).toMatchObject({
            before: expect.any(Array),
            after: expect.any(Array),
        });
        await aendere(S, { quellen: [{ op: "update", sourceId: kraeuterId, pages: "13–15", note: "Kapitel 2" }] });
        gelesen = (await leseVorkommen(database, await idVon(S)))!;
        expect(gelesen.quellen[0]).toMatchObject({ pages: "13–15", note: "Kapitel 2" });
        // Eine Verknüpfung aus dem Wiki (Alraune, Zoo-Botanica) wird unterdrückt, nie gelöscht.
        await aendere(A, { quellen: [{ op: "remove", sourceId: zooId }] });
        const wiki = (await leseVorkommen(database, await idVon(A)))!;
        expect(wiki.quellen[0]).toMatchObject({ state: "suppressed" });
        await aendere(S, { quellen: [{ op: "remove", sourceId: kraeuterId }] });
        expect(
            (await leseVorkommen(database, await idVon(S)))!.quellen.find((q) => q.title === "P74T Kräuterkunde"),
        ).toMatchObject({ state: "retired" });
        expect(
            (await fehler(aendere(S, { quellen: [{ op: "update", sourceId: kraeuterId, pages: "1" }] }))).statusCode,
        ).toBe(400);
        await aendere(S, { quellen: [{ op: "restore", sourceId: kraeuterId }] });
        expect((await fehler(aendere(S, { quellen: [{ op: "remove", sourceId: randomUUID() }] }))).statusCode).toBe(
            404,
        );
        expect((await fehler(aendere(S, { quellen: [{ op: "restore", sourceId: kraeuterId }] }))).statusCode).toBe(400);
        expect((await fehler(aendere(S, { quellen: [{ op: "add", sourceId: kraeuterId }] }))).statusCode).toBe(400);
    });

    it("🔴 Regeln im Körper: eine leere Liste ist keine Änderung; ein Körper nur mit Regeln zählt die Revision, schreibt die Regel und lässt den Eintrag einen des Legacy-Zugs (R6, WI-0254 `--weiter`)", async () => {
        const regel = {
            op: "add" as const,
            relation: "vorkommen" as const,
            bedingungen: [{ verknuepfung: "und" as const, arten: [{ ebene: "vegetation", art: "wald" }] }],
        };
        expect((await fehler(aendere(S, { regeln: [] }))).statusCode).toBe(400);
        await aendere(S, { fields: { gruppe: "Leer" }, regeln: [] });
        expect(await zeile(S)).toMatchObject({ gruppe: "Leer" });
        // Nur Regeln: Die Revision zählt einmal, der Eintrag bleibt einer des Zugs (nur die Regel gehört der Redaktion), die Herkunft je Feld ändert sich nicht.
        const davor = await zeile(A);
        const feldHerkunft = await herkunft(A);
        const quittung = await aendere(A, { regeln: [regel] });
        expect(quittung.affected).toEqual([{ kind: "lore", id: await idVon(A), revision: davor.revision + 1 }]);
        expect(await zeile(A)).toMatchObject({ revision: davor.revision + 1, source_system: "legacy" });
        expect(await herkunft(A)).toEqual(feldHerkunft);
        // Mit einem Feld im selben Körper wird der Eintrag einer der Redaktion, wie immer.
        await aendere(A, { fields: { gruppe: "Mit Feld" } });
        expect(await zeile(A)).toMatchObject({ source_system: "editor" });
    });

    it("🔴 Der Zug lässt Regeln der Redaktion stehen: eine angelegte, eine ersetzte (die Regel aus Legacy bleibt still) und eine entfernte; der Eintrag bleibt dabei Legacys", async () => {
        const regelnVon = async (wikiKey: string) =>
            database<
                {
                    id: string;
                    state: string;
                    source_system: string;
                    retired_origin: string | null;
                    legacy_origin: string;
                    rule_key: string;
                }[]
            >`
                SELECT r.id::text, r.state, r.source_system, r.retired_origin, r.legacy_origin, r.rule_key
                  FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.wiki_key = ${wikiKey} ORDER BY r.id
            `;
        const legacyRegel = (await regelnVon(A))[0]!;
        expect(legacyRegel).toMatchObject({ state: "active", source_system: "legacy" });
        // Die Redaktion ersetzt die Regel aus Legacy (Wald, dann oder Klima) durch eine eigene und legt für den Ork eine neue Regel an, die Legacy nicht kennt.
        await aendere(A, {
            regeln: [
                {
                    op: "add",
                    relation: "verbreitung",
                    ersetzt: legacyRegel.id,
                    bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "vegetation", art: "steppe" }] }],
                },
            ],
        });
        await aendere(S, {
            regeln: [
                {
                    op: "add",
                    relation: "vorkommen",
                    bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "topographie", art: "gebirge" }] }],
                },
            ],
        });
        const eigeneA = (await regelnVon(A)).find((r) => r.source_system === "editor")!;
        const eigeneS = (await regelnVon(S))[0]!;
        expect(eigeneA).toMatchObject({ state: "active", legacy_origin: "manual" });
        expect((await regelnVon(A)).find((r) => r.id === legacyRegel.id)).toMatchObject({
            state: "retired",
            retired_origin: "editor",
        });
        const vorherA = await zeile(A);
        // Der nächste Lauf nennt dieselbe Antwort wie am Anfang: Die Regel aus Legacy steht in ihr, die der Redaktion nicht.
        const bericht = await importLore(database, antwort());
        expect(bericht.tables.lore_rule.retired).toBe(0);
        const nachA = await regelnVon(A);
        expect(nachA.find((r) => r.id === eigeneA.id)).toMatchObject({
            state: "active",
            source_system: "editor",
            retired_origin: null,
        });
        // Die ersetzte Regel aus Legacy belebt der Zug nicht, obwohl Legacy sie noch nennt.
        expect(nachA.find((r) => r.id === legacyRegel.id)).toMatchObject({
            state: "retired",
            retired_origin: "editor",
        });
        expect(await regelnVon(S)).toEqual([
            expect.objectContaining({ id: eigeneS.id, state: "active", retired_origin: null }),
        ]);
        // Der Eintrag bleibt einer des Zugs: Er folgt Legacy weiter (der Name kommt vom Zug), nur die Regeln gehören der Redaktion.
        expect(await zeile(A)).toMatchObject({ source_system: "legacy", revision: vorherA.revision });
        // Eine Regel der Redaktion zu entfernen, ändert daran nichts: still gelegt bleibt sie auch nach dem Lauf.
        await aendere(S, { regeln: [{ op: "remove", ruleId: eigeneS.id }] });
        await importLore(database, antwort());
        expect(await regelnVon(S)).toEqual([
            expect.objectContaining({ id: eigeneS.id, state: "retired", retired_origin: "editor" }),
        ]);
    });

    it("Unterdrücken und Zurückholen: unterdrückt, nie gelöscht; ein unterdrückter Eintrag lässt sich nur zurückholen", async () => {
        await aendere(S, { fields: { aktiv: false } });
        expect(await zeile(S)).toMatchObject({ is_active: false, state: "suppressed", retired_origin: "editor" });
        expect((await listeVorkommen(database, { q: "P74T Ork" })).items).toHaveLength(0);
        expect((await listeVorkommen(database, { q: "P74T Ork", stand: "stillgelegt" })).items).toHaveLength(1);
        expect((await fehler(aendere(S, { fields: { gruppe: "x" } }))).statusCode).toBe(400);
        expect((await fehler(aendere(S, { quellen: [{ op: "add", sourceId: randomUUID() }] }))).statusCode).toBe(400);
        await aendere(S, { fields: { aktiv: true, gruppe: "Zurück" } });
        expect(await zeile(S)).toMatchObject({
            is_active: true,
            state: "active",
            retired_origin: null,
            gruppe: "Zurück",
        });
    });

    it("Ziele für eine Ortszeile: nur Objekte mit Wiki-Schlüssel und Kontinentbegriffe, nie ein Name als Schlüssel", async () => {
        const ort = await sucheVorkommenZiele(database, "C68T Ort A", 8);
        const treffer = ort.items.find((z) => "carrierId" in z && z.carrierId === C.ortA);
        expect(treffer).toMatchObject({ kind: "place", wikiKey: "p68t-ort-a" });
        // Ein Ort ohne Zuordnung steht nicht in der Liste, auch wenn sein Name passt.
        expect(ort.items.some((z) => "carrierId" in z && z.carrierId === C.ortOhneZuordnung)).toBe(false);
        const region = await sucheVorkommenZiele(database, "C68T Region", 8);
        expect(region.items.some((z) => "carrierId" in z && z.carrierId === C.regionA && z.kind === "area")).toBe(true);
        const kontinent = await sucheVorkommenZiele(database, "Aventu", 8);
        expect(kontinent.items).toContainEqual({ kontinent: "aventurien", name: "Aventurien", wikiKey: "aventurien" });
        expect((await sucheVorkommenZiele(database, "gibtesnicht", 8)).items).toEqual([]);
    });

    it("🔴 Der Legacy-Zug fasst einen Eintrag der Redaktion samt Ortszeilen nie an, rechnet seine Treffer aber neu; ein anderer Eintrag folgt dem Zug weiter", async () => {
        await aendere(A, {
            fields: { name: "P74T Alraune von Hand" },
            orte: [{ op: "add", kind: "area", carrierId: C.regionA, relation: "regionen" }],
        });
        const nachBearbeitung = await orte(A);
        expect(nachBearbeitung.find((z) => z.place_wiki_key === "p68t-region-a")).toMatchObject({
            target_state: "resolved",
            treffer: 1,
        });
        // Legacy bringt einen anderen Namen, eine neue Zeile und bei einem anderen Eintrag (Ork) ebenfalls einen anderen Namen.
        const zug = answer({
            entries: [
                entry(A, "flora", { name: "P74T Legacy sagt etwas anderes", gruppe: "Fremd" }),
                entry(B, "ware", { name: "P74T Leinöl", origin: "manual" }),
                entry(S, "spezies", { name: "P74T Ork, vom Zug umbenannt" }),
            ],
            places: [
                place(A, "p68t-ort-a", { sort_order: 0 }),
                place(A, "p68t-neu-vom-zug", { sort_order: 1 }),
                place(B, "p68t-ort-a"),
                place(S, "p68t-ort-a", { relation: "vorkommen" }),
            ],
            sources: [zooRow(1), kraeuterRow(2)],
            links: [link(A, 1, { pages: "88", position: 0 })],
        });
        await importLore(database, zug);
        expect(await zeile(A)).toMatchObject({
            name: "P74T Alraune von Hand",
            source_system: "editor",
            state: "active",
        });
        const nachZug = await orte(A);
        expect(nachZug.map((z) => [z.place_wiki_key, z.is_active])).toEqual(
            nachBearbeitung.map((z) => [z.place_wiki_key, z.is_active]),
        );
        expect(nachZug.some((z) => z.place_wiki_key === "p68t-neu-vom-zug")).toBe(false);
        expect((await zeile(S)).name).toBe("P74T Ork, vom Zug umbenannt");
        // Wandert die Zuordnung der Region fort (der Schlüssel trägt keinen Träger mehr), rechnet der Zug die Treffer der Zeile der Redaktion neu.
        await database`DELETE FROM wiki_key_assignment WHERE object_public_id = ${C.regionA}::uuid`;
        await importLore(database, zug);
        const region = (await orte(A)).find((z) => z.place_wiki_key === "p68t-region-a")!;
        expect(region).toMatchObject({
            target_state: "unmatched",
            target_count: 0,
            treffer: 0,
            source_system: "editor",
            target_origin: "editor",
        });
        // Ein Eintrag der Redaktion, den die Antwort gar nicht nennt, wird nicht stillgelegt.
        await importLore(
            database,
            answer({
                entries: [entry(S, "spezies", { name: "P74T Ork, vom Zug umbenannt" })],
                places: [],
                sources: [],
                links: [],
            }),
        );
        expect(await zeile(A)).toMatchObject({ is_active: true, state: "active" });
        expect((await orte(A)).filter((z) => z.is_active).length).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------------------------------------------------------------
    // Vorkommen ohne Wiki-Artikel (Vali wählte B am Gate, Migration 0235)
    // -----------------------------------------------------------------------------------------------------------------------------

    const quellenKennung = async (titel: string): Promise<string> => {
        const [zeile] = await database<
            { public_id: string }[]
        >`SELECT public_id::text FROM feature_source WHERE title = ${titel}`;
        return zeile!.public_id;
    };
    const stand = async (publicId: string): Promise<number> => {
        const [zeile] = await database<
            { revision: number }[]
        >`SELECT revision::int FROM lore_entry WHERE public_id = ${publicId}::uuid`;
        return zeile!.revision;
    };

    it("🔴 Anlegen ohne Wiki-Artikel: kein Schlüssel, eigene Kennung, Herkunft „manuell“ je Feld, Protokoll, Pille INOFFIZIELL | Avesmaps; ein gleichlautender Name ist ein zweiter Eintrag", async () => {
        const operationId = neu();
        const quittung = await legeVorkommenAn(database, redakteur, {
            operationId,
            name: "  P74T Moosbart ",
            art: "flora",
            gruppe: "Moos",
            lebensraum: "   ",
            editorNote: " Nur im Norden ",
        });
        expect(quittung.affected).toEqual([{ kind: "lore", id: quittung.publicId, revision: 1 }]);
        const gelesen = await leseVorkommen(database, quittung.publicId);
        expect(gelesen).toMatchObject({
            id: quittung.publicId,
            wikiKey: null,
            name: "P74T Moosbart",
            art: "flora",
            gruppe: "Moos",
            lebensraum: null,
            editorNote: "Nur im Norden",
            ursprung: "manual",
            herkunft: "editor",
            aktiv: true,
            revision: 1,
            kanon: { canon: "unofficial", designatorLabel: "Avesmaps" },
        });
        expect(gelesen!.wikiUrl).toBeUndefined();
        expect(gelesen!.feldUrsprung).toEqual({ name: "manual", art: "manual", gruppe: "manual" });
        const [eintrag] = await protokoll(operationId);
        expect(eintrag).toMatchObject({ action: "lore.created", revision_before: null, revision_after: 1 });
        expect(eintrag!.changes).toMatchObject({ name: { after: "P74T Moosbart" }, art: { after: "flora" } });
        const [operation] = await database<
            { summary: string }[]
        >`SELECT summary FROM map_operation WHERE operation_id = ${operationId}::uuid`;
        expect(operation?.summary).toBe("Vorkommen „P74T Moosbart“ angelegt");
        const [zeileDb] = await database<
            { wiki_key: string | null; source_system: string; legacy_origin: string }[]
        >`SELECT wiki_key, source_system, legacy_origin FROM lore_entry WHERE public_id = ${quittung.publicId}::uuid`;
        expect(zeileDb).toEqual({ wiki_key: null, source_system: "editor", legacy_origin: "manual" });
        // Die Liste kennt ihn als von Hand, nach Namen suchbar; derselbe Name noch einmal legt einen zweiten, eigenen Eintrag an.
        const liste = await listeVorkommen(database, { q: "Moosbart" });
        expect(liste.items.map((e) => [e.title, e.herkunft, e.stillgelegt])).toEqual([
            ["P74T Moosbart", "editor", false],
        ]);
        const zweiter = await legeVorkommenAn(database, redakteur, {
            operationId: neu(),
            name: "P74T Moosbart",
            art: "fauna",
        });
        expect(zweiter.publicId).not.toBe(quittung.publicId);
        expect((await listeVorkommen(database, { q: "Moosbart" })).total).toBe(2);
        // Ein leerer Name ist nicht zu retten.
        expect(
            (await fehler(legeVorkommenAn(database, redakteur, { operationId: neu(), name: "   ", art: "ware" })))
                .statusCode,
        ).toBe(400);
    });

    it("🔴 Die Pille folgt der Kanon-Regel: der Namensraum der Wiki-Adresse, sonst die Quellen, sonst bei einem Eintrag ohne Artikel INOFFIZIELL | Avesmaps", async () => {
        // Rang 2: eine offizielle Quelle am Eintrag ohne Artikel gibt OFFIZIELL mit der Art; gelöst, fällt er auf Rang 4 zurück.
        const neuer = await legeVorkommenAn(database, redakteur, {
            operationId: neu(),
            name: "P74T Rangprobe",
            art: "fauna",
        });
        const zoo = await quellenKennung("P74T Zoo-Botanica Aventurica");
        await aendereVorkommen(database, redakteur, neuer.publicId, {
            operationId: neu(),
            baseRevision: await stand(neuer.publicId),
            quellen: [{ op: "add", sourceId: zoo }],
        });
        expect((await leseVorkommen(database, neuer.publicId))!.kanon).toEqual({
            canon: "official",
            designatorType: "regionalspielhilfe",
        });
        await aendereVorkommen(database, redakteur, neuer.publicId, {
            operationId: neu(),
            baseRevision: await stand(neuer.publicId),
            quellen: [{ op: "remove", sourceId: zoo }],
        });
        expect((await leseVorkommen(database, neuer.publicId))!.kanon).toEqual({
            canon: "unofficial",
            designatorLabel: "Avesmaps",
        });
        // Rang 1: die Wiki-Adresse entscheidet (Hauptraum offiziell ohne Bezeichner, Inoffiziell mit dem Bezeichner der Tafel).
        await importLore(
            database,
            answer({
                entries: [
                    entry("p74t-haupt", "fauna", { wiki_url: "https://de.wiki-aventurica.de/wiki/P74t_Haupt" }),
                    entry("p74t-inoff", "fauna", {
                        wiki_url: "https://de.wiki-aventurica.de/wiki/Inoffiziell:P74t_Inoff",
                    }),
                    entry("p74t-ohne", "fauna"),
                ],
            }),
        );
        expect((await leseVorkommen(database, await idVon("p74t-haupt")))!.kanon).toEqual({ canon: "official" });
        expect((await leseVorkommen(database, await idVon("p74t-inoff")))!.kanon).toEqual({
            canon: "unofficial",
            designatorLabel: "Wiki Aventurica",
        });
        // Ein Eintrag MIT Schlüssel, den die Regel nicht fasst (keine Adresse, keine Quelle), trägt keine Pille.
        expect((await leseVorkommen(database, await idVon("p74t-ohne")))!.kanon).toBeUndefined();
    });

    it("🔴 Ortszeile mit ungeklärtem Namen: kein Schlüssel, nie Treffer, nie gegen Kartenobjekte verglichen; derselbe Name einmal je Beziehung, Lösen legt still, Zurückholen kommt wieder", async () => {
        const id = await idVon(A);
        const vorher = (await orte(A)).length;
        await aendere(A, {
            orte: [
                { op: "add", name: "  Ein Dorf im Norden ", relation: "herkunft" },
                // Ein Name, der wie ein Träger oder ein Kontinent aussieht, bleibt ein Name: nie ein Schlüssel, nie ein Treffer.
                { op: "add", name: "C68T Ort A", relation: "vorkommen" },
                { op: "add", name: "Aventurien", relation: "vorkommen" },
            ],
        });
        const namenszeilen = (await orte(A)).filter((z) => z.place_wiki_key === null);
        expect(namenszeilen).toHaveLength(3);
        for (const zeile of namenszeilen) {
            expect(zeile).toMatchObject({
                key_class: "other",
                target_state: "unresolved",
                target_count: 0,
                treffer: 0,
                sort_order: 9999,
                state: "active",
                is_active: true,
                source_system: "editor",
                target_origin: "editor",
                legacy_origin: "manual",
            });
        }
        expect((await orte(A)).length).toBe(vorher + 3);
        const gelesen = await leseVorkommen(database, id);
        const dorf = gelesen!.orte.find((o) => o.name === "Ein Dorf im Norden")!;
        expect(dorf).toMatchObject({
            wikiKey: null,
            relation: "herkunft",
            keyClass: "other",
            targetState: "unresolved",
            treffer: [],
            trefferGesamt: 0,
            state: "active",
            ursprung: "manual",
            herkunft: "editor",
        });
        // Derselbe Name in derselben Beziehung (auch anders geschrieben) steht nur einmal; eine andere Beziehung ist eine zweite Zeile.
        const doppelt = await fehler(
            aendere(A, { orte: [{ op: "add", name: "ein DORF im norden", relation: "herkunft" }] }),
        );
        expect(doppelt).toMatchObject({ statusCode: 400 });
        await aendere(A, { orte: [{ op: "add", name: "Ein Dorf im Norden", relation: "verbreitung" }] });
        // Lösen legt still (eine eigene Zeile wird „gelöst“, nie gelöscht), Zurückholen kommt wieder; Treffer entstehen dabei keine.
        await aendere(A, { orte: [{ op: "remove", rowId: dorf.rowId }] });
        expect((await orte(A)).find((z) => z.id === dorf.rowId)).toMatchObject({
            state: "retired",
            is_active: false,
            retired_origin: "editor",
        });
        await aendere(A, { orte: [{ op: "restore", rowId: dorf.rowId }] });
        expect((await orte(A)).find((z) => z.id === dorf.rowId)).toMatchObject({
            state: "active",
            is_active: true,
            treffer: 0,
        });
        // Nach dem Lösen darf derselbe Name in derselben Beziehung wieder angehängt werden: Die stille Zeile kommt zurück, es entsteht keine zweite.
        await aendere(A, { orte: [{ op: "remove", rowId: dorf.rowId }] });
        await aendere(A, { orte: [{ op: "add", name: "Ein Dorf im Norden", relation: "herkunft" }] });
        expect((await orte(A)).filter((z) => z.place_wiki_key === null)).toHaveLength(4);
        expect((await orte(A)).find((z) => z.id === dorf.rowId)).toMatchObject({ state: "active", is_active: true });
    });

    it("🔴 Der Legacy-Zug fasst einen Eintrag ohne Wiki-Artikel und eine Namenszeile nie an, legt sie nicht still, und die Prüfung zählt sie nicht als Abweichung", async () => {
        const neuer = await legeVorkommenAn(database, redakteur, {
            operationId: neu(),
            name: "P74T Eigenbau",
            art: "ware",
        });
        await aendere(A, { orte: [{ op: "add", name: "Ein Dorf im Norden", relation: "herkunft" }] });
        const vorherAnzahl = (await database<{ n: number }[]>`SELECT count(*)::int AS n FROM lore_entry`)[0]!.n;
        // Zwei Läufe: die Antwort nennt den Eintrag ohne Artikel nicht, und die Namenszeile steht nicht in ihr.
        await importLore(database, antwort());
        await importLore(database, antwort());
        expect(await leseVorkommen(database, neuer.publicId)).toMatchObject({
            wikiKey: null,
            aktiv: true,
            name: "P74T Eigenbau",
        });
        expect((await orte(A)).filter((z) => z.place_wiki_key === null && z.is_active)).toHaveLength(1);
        expect((await database<{ n: number }[]>`SELECT count(*)::int AS n FROM lore_entry`)[0]!.n).toBe(vorherAnzahl);
        // Die Prüfung (verify:lore) nimmt Einträge der Redaktion und ihre Zeilen aus: Sie meldet keine Abweichung.
        const pruefung = await verifyLore(database, antwort());
        expect(pruefung.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual([]);
        expect(pruefung.passed).toBe(true);
    });
});
