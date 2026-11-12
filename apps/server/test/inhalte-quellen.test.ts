import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { pathHistory } from "../src/editor/history.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { readEditorPathStreet } from "../src/editor/path-list.ts";
import { ApiError } from "../src/http/api-error.ts";
import { leseQuelle, listeQuellen, sucheZiele } from "../src/inhalte/quellen-lesen.ts";
import { aendereQuelle, legeQuelleAn, pruefeAdresse, schluesselDerAdresse } from "../src/inhalte/quellen-schreiben.ts";
import { cleanP3Fixtures, insertP3Carriers, P3, p3Id } from "./support/p3-fixture.ts";

/**
 * Das Fenster „Inhalte bearbeiten“, Reiter „Quellen“ (WI-0254, Migration 0232): anlegen, ändern, Verwendungen, Etikett der Träger, Lesen.
 * Gegen die Wegwerf-Datenbank der Testläufe (`TEST_DATABASE_URL`); die Rechte der App-Rolle prüft der Rauchtest der Schreibwege.
 *
 * Problemfälle: eine bekannte Adresse legt eine zweite Quelle an; ein veralteter Stand überschreibt still; die Revision zählt gar nicht oder
 * mehrfach; eine Lizenz ohne Schlüssel oder mit fremdem Schlüssel geht durch; eine Verknüpfung aus Legacy wird gelöscht statt unterdrückt; das
 * Etikett des Trägers bleibt nach der Änderung auf dem alten Stand; ein Weg wird als einzelner Abschnitt änderbar; ein Name wird zur Kennung.
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
const HOST = "p3test.example";

describeWithDatabase("Quellen im Fenster „Inhalte bearbeiten“ (WI-0254)", () => {
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
                source_system: string;
                is_official: boolean;
                is_active: boolean;
                retired_origin: string | null;
                license_statement: string;
                license_key: string | null;
                corpus_key: string | null;
                attribution: string | null;
            }[]
        >`
            SELECT id::text, revision::int, title, source_system, is_official, is_active, retired_origin, license_statement, license_key,
                   corpus_key, attribution
              FROM feature_source WHERE public_id = ${publicId}::uuid
        `;
        return row!;
    };
    const kanon = async (traegerPublicId: string) => {
        const [row] = await database<
            { canon: string; designator_type: string | null; designator_count: number | null }[]
        >`
            SELECT k.canon, k.designator_type, k.designator_count
              FROM territory_canon k JOIN territory t ON t.id = k.territory_id WHERE t.public_id = ${traegerPublicId}::uuid
        `;
        return row;
    };
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
    const link = async (quelleId: string, traegerPublicId: string) => {
        const [row] = await database<
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
        >`
            SELECT l.state, l.is_active, l.source_system, l.reference_kind, l.pages, l.note, l.position, l.retired_origin
              FROM territory_source l
              JOIN territory t ON t.id = l.territory_id
              JOIN feature_source f ON f.id = l.source_id
             WHERE f.public_id = ${quelleId}::uuid AND t.public_id = ${traegerPublicId}::uuid
        `;
        return row;
    };
    const aufraeumen = async (): Promise<void> => {
        await cleanP3Fixtures(database);
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
    };

    beforeAll(async () => {
        database = createDatabase(url as string);
        await migrate(database);
        await aufraeumen();
        await insertP3Carriers(database);
        // Ein Werk-Korpus mit dokumentierten Rechten: eine neue Quelle der Domain erbt Lizenz und Namensnennung (nie Art und „offiziell“). Bei einem Werk bleiben die
        // Felder an der Quelle und sind änderbar; was eine BELEGSTELLE vorgibt, gehört dem Korpus (`inhalte-korpora.test.ts`, WI-0254 Runde 4).
        await database`
            INSERT INTO source_corpus (corpus_key, label, form, license_statement, license_key, attribution, source_system)
            VALUES (${HOST}, 'P3T Angebot', 'werk', 'license', 'cc-by-sa-3.0', 'Hand', 'test')
        `;
    }, 120_000);

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("die Adresse ist die Identität: nur https oder http mit Host, der Schlüssel ist der Hash genau dieser Adresse", () => {
        expect(pruefeAdresse("  https://p3test.example/x  ")).toBe("https://p3test.example/x");
        for (const schlecht of ["ftp://p3test.example/x", "p3test.example/x", "https://", "javascript:alert(1)"]) {
            expect(() => pruefeAdresse(schlecht), schlecht).toThrow(ApiError);
        }
        expect(schluesselDerAdresse("https://p3test.example/x")).toMatch(/^url:[0-9a-f]{64}$/);
    });

    let quelleId = "";
    let operationAnlegen = "";

    it("🔴 Anlegen: eine Quelle mit Adresse, source_system editor, Rechte aus dem Korpus der Domain, ein Eintrag im Fachprotokoll", async () => {
        operationAnlegen = neu();
        const antwort = await legeQuelleAn(database, redakteur, {
            operationId: operationAnlegen,
            url: `https://${HOST}/seite-a`,
            title: "  P3T Quelle Redaktion  ",
            sourceType: "briefspiel",
        });
        quelleId = antwort.publicId;
        expect(antwort.status).toBe("applied");
        expect(antwort.affected).toEqual([{ kind: "source", id: quelleId, revision: 1 }]);
        expect(await zeile(quelleId)).toMatchObject({
            title: "P3T Quelle Redaktion",
            revision: 1,
            source_system: "editor",
            is_official: false,
            is_active: true,
            corpus_key: HOST,
            license_statement: "license",
            license_key: "cc-by-sa-3.0",
            attribution: "Hand",
        });
        const eintraege = await protokoll(operationAnlegen);
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]).toMatchObject({ action: "source.created", revision_before: null, revision_after: 1 });
        expect(eintraege[0]?.changes).toMatchObject({
            url: { after: `https://${HOST}/seite-a` },
            title: { after: "P3T Quelle Redaktion" },
        });
    });

    it("dieselbe Kennung noch einmal gibt die Quittung zurück, ohne eine zweite Quelle", async () => {
        const wieder = await legeQuelleAn(database, redakteur, {
            operationId: operationAnlegen,
            url: `https://${HOST}/seite-a`,
            title: "  P3T Quelle Redaktion  ",
            sourceType: "briefspiel",
        });
        expect(wieder.status).toBe("replayed");
        expect(wieder.publicId).toBe(quelleId);
    });

    it("🔴 eine bekannte Adresse legt nichts an: 409 source_exists mit der vorhandenen Quelle", async () => {
        const e = await fehler(
            legeQuelleAn(database, redakteur, {
                operationId: neu(),
                url: `https://${HOST}/seite-a`,
                title: "Noch einmal",
            }),
        );
        expect(e.statusCode).toBe(409);
        expect(e.code).toBe("source_exists");
        expect(e.details).toMatchObject({ sourceId: quelleId, active: true });
    });

    it("🔴 Ändern: Titel, Art und offiziell zählen die Revision genau einmal und stehen mit vorher und nachher im Protokoll", async () => {
        const operationId = neu();
        const antwort = await aendereQuelle(database, redakteur, quelleId, {
            operationId,
            baseRevision: 1,
            fields: { title: "P3T Quelle geändert", sourceType: "regelbuch", isOfficial: true },
        });
        expect(antwort.affected).toEqual([{ kind: "source", id: quelleId, revision: 2 }]);
        expect(await zeile(quelleId)).toMatchObject({
            revision: 2,
            title: "P3T Quelle geändert",
            is_official: true,
            source_system: "editor",
        });
        const [eintrag] = await protokoll(operationId);
        expect(eintrag).toMatchObject({ action: "source.updated", revision_before: 1, revision_after: 2 });
        expect(eintrag?.changes).toMatchObject({
            title: { before: "P3T Quelle Redaktion", after: "P3T Quelle geändert" },
            sourceType: { before: "briefspiel", after: "regelbuch" },
            isOfficial: { before: false, after: true },
        });
    });

    it("🔴 Auszeichnung im Titel: Anlegen und Ändern speichern reinen Text", async () => {
        const angelegt = await legeQuelleAn(database, redakteur, {
            operationId: neu(),
            url: `https://${HOST}/seite-titel`,
            title: "P3T Landkartenset <br />Das Dornenreich",
            sourceType: "briefspiel",
        });
        expect((await zeile(angelegt.publicId)).title).toBe("P3T Landkartenset Das Dornenreich");
        await aendereQuelle(database, redakteur, angelegt.publicId, {
            operationId: neu(),
            baseRevision: 1,
            fields: { title: "P3T Der Zug<br/>Die Sümpfe" },
        });
        expect((await zeile(angelegt.publicId)).title).toBe("P3T Der Zug Die Sümpfe");
    });

    it("🔴 ein veralteter Stand ist 409 edit_conflict mit der jetzigen Revision; nichts wird geschrieben", async () => {
        const e = await fehler(
            aendereQuelle(database, redakteur, quelleId, {
                operationId: neu(),
                baseRevision: 1,
                fields: { title: "P3T Überholt" },
            }),
        );
        expect(e.statusCode).toBe(409);
        expect(e.code).toBe("edit_conflict");
        expect(e.details).toMatchObject({ currentRevision: 2 });
        expect((await zeile(quelleId)).title).toBe("P3T Quelle geändert");
    });

    it("dieselben Werte noch einmal ändern nichts: keine Revision, kein Protokoll", async () => {
        const operationId = neu();
        const antwort = await aendereQuelle(database, redakteur, quelleId, {
            operationId,
            baseRevision: 2,
            fields: { title: "P3T Quelle geändert", isOfficial: true },
        });
        expect(antwort.affected).toEqual([{ kind: "source", id: quelleId, revision: 2 }]);
        expect((await zeile(quelleId)).revision).toBe(2);
        expect(await protokoll(operationId)).toEqual([]);
        expect(
            (await fehler(aendereQuelle(database, redakteur, quelleId, { operationId: neu(), baseRevision: 2 }))).code,
        ).toBe("validation_failed");
    });

    it("Lizenz: Aussage und Schlüssel gehören zusammen, der Schlüssel kommt aus dem Katalog", async () => {
        const ohneSchluessel = await fehler(
            aendereQuelle(database, redakteur, quelleId, {
                operationId: neu(),
                baseRevision: 2,
                fields: { lizenzAussage: "license", lizenzKey: null },
            }),
        );
        expect(ohneSchluessel.code).toBe("validation_failed");
        const fremd = await fehler(
            aendereQuelle(database, redakteur, quelleId, {
                operationId: neu(),
                baseRevision: 2,
                fields: { lizenzAussage: "license", lizenzKey: "cc-by-9.9" },
            }),
        );
        expect(fremd.code).toBe("validation_failed");
        const schluesselOhneAussage = await fehler(
            aendereQuelle(database, redakteur, quelleId, {
                operationId: neu(),
                baseRevision: 2,
                fields: { lizenzAussage: "unfree", lizenzKey: "cc-by-4.0" },
            }),
        );
        expect(schluesselOhneAussage.code).toBe("validation_failed");
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 2,
            fields: { lizenzAussage: "license", lizenzKey: "cc-by-4.0", attribution: "  Neue Nennung  " },
        });
        expect(await zeile(quelleId)).toMatchObject({
            revision: 3,
            license_statement: "license",
            license_key: "cc-by-4.0",
            attribution: "Neue Nennung",
        });
        // Wer die Aussage wechselt, verliert den Schlüssel (CHECK in 0066): „nicht erfasst“ ist nie eine freie Lizenz.
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 3,
            fields: { lizenzAussage: "unrecorded", attribution: null },
        });
        expect(await zeile(quelleId)).toMatchObject({
            revision: 4,
            license_statement: "unrecorded",
            license_key: null,
            attribution: null,
        });
    });

    it("🔴 Verwendung anhängen: Zeile des Editors, Position 0, das Etikett des Trägers folgt der Regel (offiziell mit Art)", async () => {
        const operationId = neu();
        const antwort = await aendereQuelle(database, redakteur, quelleId, {
            operationId,
            baseRevision: 4,
            links: [
                { op: "add", kind: "territory", carrierId: P3.gebiet, referenceKind: null, pages: " S. 12 ", note: "" },
            ],
        });
        expect(antwort.affected).toEqual([{ kind: "source", id: quelleId, revision: 5 }]);
        expect(await link(quelleId, P3.gebiet)).toMatchObject({
            state: "active",
            is_active: true,
            source_system: "editor",
            reference_kind: null,
            pages: "S. 12",
            note: null,
            position: 0,
        });
        // Rang 2: die Quelle ist offiziell (Regelbuch), ohne Wiki-Zuweisung zählt sie: OFFIZIELL | Regelbuch.
        expect(await kanon(P3.gebiet)).toEqual({
            canon: "official",
            designator_type: "regelbuch",
            designator_count: null,
        });
        const [eintrag] = await protokoll(operationId);
        expect(eintrag?.changes).toMatchObject({
            links: {
                before: [{ kind: "territory", carrierId: P3.gebiet, state: "none" }],
                after: [{ kind: "territory", carrierId: P3.gebiet, state: "active", pages: "S. 12" }],
            },
        });
        const doppelt = await fehler(
            aendereQuelle(database, redakteur, quelleId, {
                operationId: neu(),
                baseRevision: 5,
                links: [{ op: "add", kind: "territory", carrierId: P3.gebiet }],
            }),
        );
        expect(doppelt.code).toBe("validation_failed");
    });

    it("Seiten und Notiz ändern: nur an einer aktiven Verwendung, mit Grenzen; leer wird nichts", async () => {
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 5,
            links: [
                {
                    op: "update",
                    kind: "territory",
                    carrierId: P3.gebiet,
                    referenceKind: "ausfuehrlich",
                    pages: "S. 14 ff.",
                    note: "Hinweis",
                },
            ],
        });
        expect(await link(quelleId, P3.gebiet)).toMatchObject({
            reference_kind: "ausfuehrlich",
            pages: "S. 14 ff.",
            note: "Hinweis",
        });
        // Eine Publikation (reference_kind gesetzt) zählt in Rang 2 und 3 wie eine Quelle (Vali 2026-10-25): das Etikett bleibt.
        expect(await kanon(P3.gebiet)).toMatchObject({ canon: "official" });
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 6,
            links: [{ op: "update", kind: "territory", carrierId: P3.gebiet, pages: "", note: null }],
        });
        expect(await link(quelleId, P3.gebiet)).toMatchObject({
            pages: null,
            note: null,
            reference_kind: "ausfuehrlich",
        });
    });

    it("„offiziell“ der Quelle ändert das Etikett ihrer Träger mit: INOFFIZIELL mit der Art", async () => {
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 7,
            fields: { isOfficial: false },
        });
        expect(await kanon(P3.gebiet)).toEqual({
            canon: "unofficial",
            designator_type: "regelbuch",
            designator_count: null,
        });
    });

    it("🔴 Lösen legt still, es löscht nie: eigene Verknüpfung retired, aus Legacy suppressed; beide stellen sich wieder her", async () => {
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 8,
            links: [{ op: "remove", kind: "territory", carrierId: P3.gebiet }],
        });
        expect(await link(quelleId, P3.gebiet)).toMatchObject({
            state: "retired",
            is_active: false,
            retired_origin: "editor",
        });
        // Ohne Verweise sagen Rang 1 bis 3 nichts mehr: Die Zeile entfällt, Rang 4 gilt beim Lesen.
        expect(await kanon(P3.gebiet)).toBeUndefined();
        const gelost = await fehler(
            aendereQuelle(database, redakteur, quelleId, {
                operationId: neu(),
                baseRevision: 9,
                links: [{ op: "remove", kind: "territory", carrierId: P3.gebiet }],
            }),
        );
        expect(gelost.code).toBe("validation_failed");
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 9,
            links: [{ op: "restore", kind: "territory", carrierId: P3.gebiet }],
        });
        expect(await link(quelleId, P3.gebiet)).toMatchObject({
            state: "active",
            is_active: true,
            retired_origin: null,
        });
        expect(await kanon(P3.gebiet)).toMatchObject({ canon: "unofficial" });

        // Eine Verknüpfung aus Legacy (source_system legacy) wird unterdrückt: der Zug belebt sie nie.
        await database`UPDATE territory_source SET source_system = 'legacy' WHERE source_id = ${(await zeile(quelleId)).id}::bigint`;
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 10,
            links: [{ op: "remove", kind: "territory", carrierId: P3.gebiet }],
        });
        expect(await link(quelleId, P3.gebiet)).toMatchObject({
            state: "suppressed",
            is_active: false,
            source_system: "editor",
        });
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 11,
            links: [{ op: "restore", kind: "territory", carrierId: P3.gebiet }],
        });
        expect(await link(quelleId, P3.gebiet)).toMatchObject({ state: "active" });
    });

    it("ein unbekannter Träger ist 404, eine Quelle ohne Stand 404, ein Text über der Grenze 400", async () => {
        expect(
            (
                await fehler(
                    aendereQuelle(database, redakteur, quelleId, {
                        operationId: neu(),
                        baseRevision: 12,
                        links: [{ op: "add", kind: "place", carrierId: randomUUID() }],
                    }),
                )
            ).statusCode,
        ).toBe(404);
        expect(
            (
                await fehler(
                    aendereQuelle(database, redakteur, randomUUID(), {
                        operationId: neu(),
                        baseRevision: 1,
                        fields: { title: "x" },
                    }),
                )
            ).statusCode,
        ).toBe(404);
        expect((await zeile(quelleId)).revision).toBe(12);
    });

    it("🔴 Stilllegen und Zurückholen: die Quelle bleibt als Zeile, die Träger verlieren das Etikett", async () => {
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 12,
            fields: { aktiv: false },
        });
        expect(await zeile(quelleId)).toMatchObject({
            is_active: false,
            retired_origin: "editor",
            source_system: "editor",
        });
        expect(await kanon(P3.gebiet)).toBeUndefined();
        const still = await listeQuellen(database, { q: "P3T Quelle geändert", stand: "stillgelegt" });
        expect(still.items.map((item) => item.id)).toContain(quelleId);
        expect((await listeQuellen(database, { q: "P3T Quelle geändert" })).items).toEqual([]);
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: 13,
            fields: { aktiv: true },
        });
        expect(await zeile(quelleId)).toMatchObject({ is_active: true, retired_origin: null });
        expect(await kanon(P3.gebiet)).toMatchObject({ canon: "unofficial" });
    });

    it("Lesen: Liste mit Suche, Herkunft und Zähler; die Quelle mit Verwendungen, Etikett, Korpus und Lizenzen", async () => {
        const liste = await listeQuellen(database, { q: "p3test.example/seite-a", herkunft: "editor" });
        expect(liste.items).toEqual([
            expect.objectContaining({ id: quelleId, uses: 1, herkunft: "editor", stillgelegt: false, corpusKey: HOST }),
        ]);
        expect(liste.total).toBe(1);
        expect(liste.zahlen.editor).toBeGreaterThanOrEqual(1);
        // „_“ und „%“ sind Zeichen, kein Muster.
        expect((await listeQuellen(database, { q: "p3test_example" })).items).toEqual([]);

        const quelle = await leseQuelle(database, quelleId);
        expect(quelle).toMatchObject({
            id: quelleId,
            title: "P3T Quelle geändert",
            identitaet: "url",
            herkunft: "editor",
            aktiv: true,
            domain: HOST,
            korpus: { key: HOST, label: "P3T Angebot", form: "werk" },
            verwendungenGesamt: 1,
        });
        expect(quelle?.verwendungen).toEqual([
            expect.objectContaining({
                kind: "territory",
                carrierId: P3.gebiet,
                name: "P3T Gebiet",
                state: "active",
                herkunft: "editor",
                aenderbar: true,
                canon: expect.objectContaining({ canon: "unofficial", designatorType: "regelbuch" }),
            }),
        ]);
        expect(quelle?.lizenzen.map((eine) => eine.key)).toContain("cc-by-sa-3.0");
        expect(await leseQuelle(database, randomUUID())).toBeUndefined();
    });

    it("🔴 Wege stehen je Straße da (nie ein Abschnitt), änderbar; die Suche nach Zielen findet Wege nur auf Wunsch, je Straße einmal, nie einen Griff", async () => {
        const id = (await zeile(quelleId)).id;
        await database`
            INSERT INTO path_source (path_id, source_id, position, source_system)
            SELECT p.id, ${id}::bigint, 0, 'test' FROM path p WHERE p.public_id::text LIKE '63000000-%'
        `;
        const quelle = await leseQuelle(database, quelleId);
        const wege = quelle?.verwendungen.filter((eine) => eine.kind === "path") ?? [];
        expect(wege.length).toBeGreaterThanOrEqual(2);
        expect(wege.every((eine) => eine.aenderbar && eine.state === "active" && !("abschnitte" in eine))).toBe(true);
        expect(quelle?.verwendungenGesamt).toBe(1 + wege.length);

        const ziele = await sucheZiele(database, "P3T Ort", 8);
        expect(ziele.items.map((ziel) => ziel.carrierId)).toEqual(expect.arrayContaining([P3.ort, P3.ortZwei]));
        // Ohne Wunsch (Literatur) kommt nie ein Weg zurück; mit Wunsch (Reiter Quellen) eine Straße mit ihrem Anker.
        expect(ziele.items.every((ziel) => ["place", "territory", "area", "peak"].includes(ziel.kind))).toBe(true);
        expect((await sucheZiele(database, "P3T Weg Eins", 8)).items).toEqual([]);
        expect((await sucheZiele(database, "P3T Weg Eins", 8, true)).items).toEqual([
            expect.objectContaining({ kind: "path", carrierId: P3.weg, name: "P3T Weg Eins", subtype: "Strasse" }),
        ]);
        // Ein Griff ist kein Name, nach dem jemand sucht.
        expect((await sucheZiele(database, "Strasse-77", 8, true)).items).toEqual([]);
        // Ein stillgelegter Träger ist kein Ziel.
        expect((await sucheZiele(database, "P3T Gipfel Inaktiv", 8)).items).toEqual([]);
        await database`DELETE FROM path_source WHERE source_id = ${id}::bigint`;
    });

    it("Kommentar der Redaktion (0233): wird getrimmt gespeichert, leer wird null, steht im Protokoll und kein anderer Leser sieht ihn", async () => {
        const stand = await zeile(quelleId);
        const operationId = neu();
        await aendereQuelle(database, redakteur, quelleId, {
            operationId,
            baseRevision: stand.revision,
            fields: { editorNote: "  Buchquelle; Seiten stehen an den Nachweisen.  " },
        });
        expect((await leseQuelle(database, quelleId))?.editorNote).toBe("Buchquelle; Seiten stehen an den Nachweisen.");
        const [eintrag] = await protokoll(operationId);
        expect(eintrag?.changes).toMatchObject({
            editorNote: { before: null, after: "Buchquelle; Seiten stehen an den Nachweisen." },
        });
        await aendereQuelle(database, redakteur, quelleId, {
            operationId: neu(),
            baseRevision: stand.revision + 1,
            fields: { editorNote: "   " },
        });
        expect((await leseQuelle(database, quelleId))?.editorNote).toBeNull();
    });

    // -----------------------------------------------------------------------------------------------------------------
    // Wege: immer die ganze Straße (WI-0254 §12, Runde 6)
    // -----------------------------------------------------------------------------------------------------------------

    describe("Wege im Reiter Quellen: die Quelle gilt der ganzen Straße, nie einzelnen Abschnitten", () => {
        /** „P3T Weg Reiter“: drei Abschnitte hintereinander. Der Anker (kleinste Kennung) liegt in der MITTE, der erste Abschnitt entlang der Straße ist der WESTLICHE. */
        const MITTE = p3Id(0xe1);
        const OST = p3Id(0xe2);
        const WEST = p3Id(0xe3);
        const ABSCHNITTE = [MITTE, OST, WEST];
        /** Eine Straße, die von der Karte genommen ist. */
        const STILL = p3Id(0xe4);
        let anker = "";
        let entlang: string[] = [];
        let q1 = "";
        let q2 = "";
        let q3 = "";
        let q4 = "";
        let q5 = "";

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
        const verknuepfungen = (quelle: string) => database<WegZeile[]>`
            SELECT p.public_id::text AS carrier, v.state, v.is_active, v.source_system, v.retired_origin, v.reference_kind, v.pages, v.note
              FROM path_source v JOIN path p ON p.id = v.path_id JOIN feature_source f ON f.id = v.source_id
             WHERE f.public_id = ${quelle}::uuid AND p.public_id = ANY(${ABSCHNITTE}::uuid[])
             ORDER BY p.public_id
        `;
        const einheitlich = (zeilen: WegZeile[], erwartet: Partial<WegZeile>): void => {
            expect(zeilen.map((z) => z.carrier).sort()).toEqual([...ABSCHNITTE].sort());
            for (const zeile of zeilen) expect(zeile).toMatchObject(erwartet);
        };
        const ausLegacy = (abschnitt: string, quelle: string, art: string | null, seiten: string | null) => database`
            INSERT INTO path_source (path_id, source_id, reference_kind, pages, position, source_system)
            SELECT p.id, f.id, ${art}, ${seiten}, 0, 'legacy'
              FROM path p, feature_source f WHERE p.public_id = ${abschnitt}::uuid AND f.public_id = ${quelle}::uuid
        `;
        const revisionen = () => database<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int FROM path WHERE public_id = ANY(${ABSCHNITTE}::uuid[]) ORDER BY public_id
        `;
        const eintraegeDer = (operationId: string) => database<
            {
                action: string;
                path_public_id: string | null;
                source_public_id: string | null;
                revision_before: number | null;
                revision_after: number | null;
                changes: Record<string, { before: Record<string, unknown>[]; after: Record<string, unknown>[] }>;
            }[]
        >`
            SELECT action, path_public_id::text, source_public_id::text, revision_before::int, revision_after::int, changes
              FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
        const kanonZeilen = () => database<{ id: string; canon: string; designator_type: string | null }[]>`
            SELECT p.public_id::text AS id, k.canon, k.designator_type
              FROM path_canon k JOIN path p ON p.id = k.path_id WHERE p.public_id = ANY(${ABSCHNITTE}::uuid[]) ORDER BY p.public_id
        `;
        const sicht = (state: string, art: string | null, seiten: string | null, notiz: string | null = null) => ({
            state,
            referenceKind: art,
            pages: seiten,
            note: notiz,
        });
        const neueQuelle = async (titel: string, pfad: string, offiziell = false): Promise<string> => {
            const angelegt = await legeQuelleAn(database, redakteur, {
                operationId: neu(),
                url: `https://${HOST}/${pfad}`,
                title: titel,
                sourceType: "briefspiel",
            });
            if (offiziell) {
                await aendereQuelle(database, redakteur, angelegt.publicId, {
                    operationId: neu(),
                    baseRevision: 1,
                    fields: { sourceType: "regelbuch", isOfficial: true },
                });
            }
            return angelegt.publicId;
        };
        const weg = (op: "add" | "update" | "remove" | "restore", carrierId: string, vorher: unknown, rest = {}) =>
            ({ op, kind: "path", carrierId, vorher, ...rest }) as never;

        beforeAll(async () => {
            const strecke = async (publicId: string, x: number, subtype: string, aktiv = true): Promise<void> => {
                await database`
                    INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active, off_map)
                    VALUES (${publicId}, 'aventuria', ${aktiv ? "P3T Weg Reiter" : "P3T Weg Reiter Still"}, ${subtype}, FALSE,
                            ST_SetSRID(ST_MakeLine(ST_MakePoint(${x}, 520), ST_MakePoint(${x + 10}, 520)), 0), 'test', ${aktiv}, ${!aktiv})
                `;
            };
            // Von West nach Ost: WEST (500-510, ein Pfad), MITTE (510-520), OST (520-530); die kleinste Kennung gehört der Mitte.
            await strecke(WEST, 500, "Pfad");
            await strecke(MITTE, 510, "Strasse");
            await strecke(OST, 520, "Strasse");
            await strecke(STILL, 600, "Strasse", false);
            const strasse = await readEditorPathStreet(database, OST);
            entlang = strasse!.segments.map((abschnitt) => abschnitt.id);
            anker = strasse!.id;
            q1 = await neueQuelle("P3T Quelle Wege Eins", "wege-eins", true);
            q2 = await neueQuelle("P3T Quelle Wege Zwei", "wege-zwei");
            q3 = await neueQuelle("P3T Quelle Wege Drei", "wege-drei");
            q4 = await neueQuelle("P3T Quelle Wege Vier", "wege-vier");
            q5 = await neueQuelle("P3T Quelle Wege Fuenf", "wege-fuenf");
        }, 120_000);

        it("🔴 Lesen: EINE Verwendung je Straße mit dem Anker als Kennung, die Sicht des ersten Abschnitts entlang der Straße (über Wegtypen hinweg), kein Abschnitt im Vertrag", async () => {
            // Der Aufbau: Anker in der Mitte, der erste Abschnitt entlang der Straße im Westen.
            expect(entlang).toEqual([WEST, MITTE, OST]);
            expect(anker).toBe(MITTE);
            // Die Quelle hängt an zwei von drei Abschnitten, mit verschiedenen Angaben; der westliche (erste entlang der Straße) sagt „Erwähnung, 5“.
            await ausLegacy(WEST, q1, "erwaehnung", "5");
            await ausLegacy(MITTE, q1, "ausfuehrlich", "7");
            const quelle = await leseQuelle(database, q1);
            const wege = quelle!.verwendungen.filter((eine) => eine.kind === "path");
            expect(wege).toEqual([
                expect.objectContaining({
                    kind: "path",
                    carrierId: anker,
                    name: "P3T Weg Reiter",
                    subtype: "Strasse",
                    state: "active",
                    referenceKind: "erwaehnung",
                    pages: "5",
                    herkunft: "legacy",
                    traegerAktiv: true,
                    aenderbar: true,
                }),
            ]);
            expect("abschnitte" in wege[0]!).toBe(false);
            expect(quelle!.verwendungenGesamt).toBe(1);
            // Die Liste links zählt die Straße einmal, nicht die beiden Abschnitte, die die Quelle tragen.
            const liste = await listeQuellen(database, { q: "P3T Quelle Wege Eins" });
            expect(liste.items.map((zeile) => [zeile.title, zeile.uses])).toEqual([["P3T Quelle Wege Eins", 1]]);
            expect(quelle!.verwendungen.filter((eine) => eine.name === "P3T Weg Reiter Still")).toEqual([]);
        });

        it("🔴 Ändern über source.update macht die Quelle auf ALLEN Abschnitten einheitlich (von einem Abschnitt aus, der sie gar nicht trägt); Revision des Wegs steigt nicht; die Quelle zählt einmal; beide Verläufe finden die Änderung, das Etikett aller Abschnitte folgt", async () => {
            const revisionVorher = await revisionen();
            const stand = (await zeile(q1)).revision;
            const op = neu();
            const quittung = await aendereQuelle(database, redakteur, q1, {
                operationId: op,
                baseRevision: stand,
                links: [weg("update", OST, sicht("active", "erwaehnung", "5"), { pages: " 9 " })],
            });
            expect(quittung.affected).toEqual([{ kind: "source", id: q1, revision: stand + 1 }]);

            einheitlich(await verknuepfungen(q1), {
                state: "active",
                is_active: true,
                source_system: "editor",
                retired_origin: null,
                reference_kind: "erwaehnung",
                pages: "9",
                note: null,
            });
            expect(await revisionen()).toEqual(revisionVorher);

            // Zwei Einträge: der der Quelle (mit dem Namen der Straße, ohne Abschnitt) und der der Straße am Anker, wie ihn der Wegeditor schreibt.
            const eintraege = await eintraegeDer(op);
            expect(eintraege).toEqual([
                expect.objectContaining({
                    action: "source.updated",
                    source_public_id: q1,
                    path_public_id: null,
                    revision_before: stand,
                    revision_after: stand + 1,
                }),
                expect.objectContaining({
                    action: "path.sources_changed",
                    path_public_id: anker,
                    source_public_id: null,
                    revision_before: null,
                    revision_after: null,
                }),
            ]);
            const quelleEintrag = eintraege[0]!;
            const strassenEintrag = eintraege[1]!;
            const strasse = {
                kind: "path",
                carrierId: anker,
                name: "P3T Weg Reiter",
                state: "active",
                referenceKind: "erwaehnung",
                note: null,
            };
            expect(quelleEintrag.changes["links"]).toEqual({
                before: [{ ...strasse, pages: "5" }],
                after: [{ ...strasse, pages: "9" }],
            });
            const katalog = {
                sourceId: q1,
                title: "P3T Quelle Wege Eins",
                state: "active",
                referenceKind: "erwaehnung",
                note: null,
            };
            expect(strassenEintrag.changes["quellen"]).toEqual({
                before: [{ ...katalog, pages: "5" }],
                after: [{ ...katalog, pages: "9" }],
            });
            // Der Verlauf der Straße (liest alle Abschnitte) findet die Operation, und mit dem Eintrag der Straße darin.
            const verlauf = await pathHistory(database, entlang, {});
            const eintrag = verlauf.entries.find((e) => e.operationId === op);
            expect(eintrag?.objects.filter((o) => o.action === "path.sources_changed").map((o) => o.id)).toEqual([
                anker,
            ]);
            // Das Etikett jedes Abschnitts ist neu gerechnet (die Quelle ist offiziell).
            expect(await kanonZeilen()).toEqual(
                [...ABSCHNITTE].sort().map((id) => ({ id, canon: "official", designator_type: "regelbuch" })),
            );
            // Dieselben Werte noch einmal ändern nichts: keine Revision, kein Protokoll.
            const nochmal = neu();
            const gleich = await aendereQuelle(database, redakteur, q1, {
                operationId: nochmal,
                baseRevision: stand + 1,
                links: [weg("update", MITTE, sicht("active", "erwaehnung", "9"), { pages: "9" })],
            });
            expect(gleich.affected).toEqual([{ kind: "source", id: q1, revision: stand + 1 }]);
            expect(await eintraegeDer(nochmal)).toEqual([]);
        });

        it("🔴 Lösen gilt der ganzen Straße (Legacy unterdrückt, nie gelöscht), Holen stellt alle mit den bisherigen Angaben wieder her; im Lesen steht die Straße dazwischen als unterdrückt", async () => {
            for (const abschnitt of ABSCHNITTE) await ausLegacy(abschnitt, q2, "ausfuehrlich", "12");
            const stand = (await zeile(q2)).revision;
            await aendereQuelle(database, redakteur, q2, {
                operationId: neu(),
                baseRevision: stand,
                links: [weg("remove", WEST, sicht("active", "ausfuehrlich", "12"))],
            });
            einheitlich(await verknuepfungen(q2), {
                state: "suppressed",
                is_active: false,
                source_system: "editor",
                retired_origin: "editor",
                reference_kind: "ausfuehrlich",
                pages: "12",
            });
            const still = (await leseQuelle(database, q2))!;
            expect(still.verwendungenGesamt).toBe(0);
            expect(still.verwendungen.filter((eine) => eine.kind === "path")).toEqual([
                expect.objectContaining({ carrierId: anker, state: "suppressed", pages: "12", aenderbar: true }),
            ]);

            // Eine gelöste lässt sich nicht ändern; erst holen.
            const aendern = await fehler(
                aendereQuelle(database, redakteur, q2, {
                    operationId: neu(),
                    baseRevision: stand + 1,
                    links: [weg("update", MITTE, sicht("suppressed", "ausfuehrlich", "12"), { pages: "1" })],
                }),
            );
            expect(aendern.statusCode).toBe(400);
            await aendereQuelle(database, redakteur, q2, {
                operationId: neu(),
                baseRevision: stand + 1,
                links: [weg("restore", OST, sicht("suppressed", "ausfuehrlich", "12"))],
            });
            einheitlich(await verknuepfungen(q2), {
                state: "active",
                is_active: true,
                source_system: "editor",
                retired_origin: null,
                reference_kind: "ausfuehrlich",
                pages: "12",
            });
            expect((await leseQuelle(database, q2))!.verwendungenGesamt).toBe(1);
        });

        it("Anhängen von der Quelle her: eine Zeile je Abschnitt mit denselben Angaben; add mit neuen Angaben belebt die gelöste Straße", async () => {
            const stand = (await zeile(q3)).revision;
            await aendereQuelle(database, redakteur, q3, {
                operationId: neu(),
                baseRevision: stand,
                links: [weg("add", OST, null, { referenceKind: "ergaenzend", pages: "3", note: " Südroute " })],
            });
            einheitlich(await verknuepfungen(q3), {
                state: "active",
                source_system: "editor",
                reference_kind: "ergaenzend",
                pages: "3",
                note: "Südroute",
            });
            await aendereQuelle(database, redakteur, q3, {
                operationId: neu(),
                baseRevision: stand + 1,
                links: [weg("remove", WEST, sicht("active", "ergaenzend", "3", "Südroute"))],
            });
            await aendereQuelle(database, redakteur, q3, {
                operationId: neu(),
                baseRevision: stand + 2,
                links: [weg("add", MITTE, sicht("retired", "ergaenzend", "3", "Südroute"), { pages: "4" })],
            });
            einheitlich(await verknuepfungen(q3), {
                state: "active",
                is_active: true,
                reference_kind: "ergaenzend",
                pages: "4",
                note: "Südroute",
            });
        });

        it("🔴 409, wenn `vorher` der Straße nicht mehr stimmt (auch bei passender Revision der Quelle, wenn der Wegeditor sie geändert hat); nichts wird geschrieben; Prüfungen am Körper", async () => {
            await ausLegacy(WEST, q4, "erwaehnung", "5");
            const stand = (await zeile(q4)).revision;
            const veraltet = await fehler(
                aendereQuelle(database, redakteur, q4, {
                    operationId: neu(),
                    baseRevision: stand,
                    links: [weg("update", MITTE, sicht("active", "erwaehnung", "4"), { pages: "9" })],
                }),
            );
            expect(veraltet.statusCode).toBe(409);
            expect(veraltet.code).toBe("edit_conflict");
            // „Es gab keine“ stimmt nicht, wenn es eine gibt.
            const dochDa = await fehler(
                aendereQuelle(database, redakteur, q4, {
                    operationId: neu(),
                    baseRevision: stand,
                    links: [weg("add", OST, null, { pages: "9" })],
                }),
            );
            expect(dochDa.statusCode).toBe(409);
            // Der Wegeditor ändert die Seite (die Revision der Quelle bleibt): Das Fenster der Quelle sah „5“.
            await database`
                UPDATE path_source SET pages = '6', source_system = 'editor', updated_at = now()
                 WHERE source_id = (SELECT id FROM feature_source WHERE public_id = ${q4}::uuid)
            `;
            const nachDemWegeditor = await fehler(
                aendereQuelle(database, redakteur, q4, {
                    operationId: neu(),
                    baseRevision: stand,
                    links: [weg("update", WEST, sicht("active", "erwaehnung", "5"), { pages: "9" })],
                }),
            );
            expect(nachDemWegeditor.statusCode).toBe(409);
            expect((await verknuepfungen(q4)).map((z) => z.pages)).toEqual(["6"]);
            expect((await zeile(q4)).revision).toBe(stand);

            // Der Körper: zu einem Weg gehört `vorher`, zu jedem anderen Träger nicht; dieselbe Straße nur einmal.
            const ohne = await fehler(
                aendereQuelle(database, redakteur, q4, {
                    operationId: neu(),
                    baseRevision: stand,
                    links: [{ op: "update", kind: "path", carrierId: MITTE, pages: "9" }],
                }),
            );
            expect(ohne.statusCode).toBe(400);
            const amOrt = await fehler(
                aendereQuelle(database, redakteur, q4, {
                    operationId: neu(),
                    baseRevision: stand,
                    links: [{ op: "add", kind: "place", carrierId: P3.ort, vorher: null }],
                }),
            );
            expect(amOrt.statusCode).toBe(400);
            const zweimal = await fehler(
                aendereQuelle(database, redakteur, q4, {
                    operationId: neu(),
                    baseRevision: stand,
                    links: [
                        weg("update", WEST, sicht("active", "erwaehnung", "6"), { pages: "7" }),
                        weg("update", OST, sicht("active", "erwaehnung", "6"), { pages: "8" }),
                    ],
                }),
            );
            expect(zweimal.statusCode).toBe(400);
            expect((await verknuepfungen(q4)).map((z) => z.pages)).toEqual(["6"]);
        });

        it("🔴 eine Straße, die nicht auf der Karte ist, bleibt 400; ein unbekannter Abschnitt ist 404", async () => {
            const stand = (await zeile(q5)).revision;
            const still = await fehler(
                aendereQuelle(database, redakteur, q5, {
                    operationId: neu(),
                    baseRevision: stand,
                    links: [weg("add", STILL, null, { pages: "1" })],
                }),
            );
            expect(still.statusCode).toBe(400);
            const unbekannt = await fehler(
                aendereQuelle(database, redakteur, q5, {
                    operationId: neu(),
                    baseRevision: stand,
                    links: [weg("add", randomUUID(), null)],
                }),
            );
            expect(unbekannt.statusCode).toBe(404);
            expect(await verknuepfungen(q5)).toEqual([]);
        });

        it("🔴 eine gemischte Operation (Stammdaten, Ort und Weg in einem Körper) ist atomar: gelingt ganz oder gar nicht, die Quelle zählt einmal", async () => {
            const stand = (await zeile(q5)).revision;
            const quelleId = (await zeile(q5)).id;
            const zahlOrte = async (): Promise<number> =>
                (
                    await database<
                        { n: number }[]
                    >`SELECT count(*)::int AS n FROM place_source WHERE source_id = ${quelleId}::bigint`
                )[0]!.n;
            await ausLegacy(WEST, q5, "erwaehnung", "5");
            const orteVorher = await zahlOrte();
            // Scheitert der Weg (veralteter Stand), bleiben Titel und Ort unberührt.
            const geplatzt = await fehler(
                aendereQuelle(database, redakteur, q5, {
                    operationId: neu(),
                    baseRevision: stand,
                    fields: { title: "P3T Quelle Wege Fuenf geändert" },
                    links: [
                        { op: "add", kind: "place", carrierId: P3.ortZwei, referenceKind: "erwaehnung" },
                        weg("update", MITTE, sicht("active", "erwaehnung", "veraltet"), { pages: "9" }),
                    ],
                }),
            );
            expect(geplatzt.statusCode).toBe(409);
            expect((await zeile(q5)).title).toBe("P3T Quelle Wege Fuenf");
            expect((await zeile(q5)).revision).toBe(stand);
            expect(await zahlOrte()).toBe(orteVorher);

            // Mit dem richtigen Stand geht alles zugleich durch.
            const op = neu();
            await aendereQuelle(database, redakteur, q5, {
                operationId: op,
                baseRevision: stand,
                fields: { title: "P3T Quelle Wege Fuenf geändert" },
                links: [
                    { op: "add", kind: "place", carrierId: P3.ortZwei, referenceKind: "erwaehnung" },
                    weg("update", MITTE, sicht("active", "erwaehnung", "5"), { pages: "9" }),
                ],
            });
            expect(await zeile(q5)).toMatchObject({ title: "P3T Quelle Wege Fuenf geändert", revision: stand + 1 });
            expect(await zahlOrte()).toBe(orteVorher + 1);
            einheitlich(await verknuepfungen(q5), { state: "active", reference_kind: "erwaehnung", pages: "9" });
            const eintraege = await eintraegeDer(op);
            expect(eintraege.map((e) => e.action)).toEqual(["source.updated", "path.sources_changed"]);
            expect(eintraege[0]?.changes["links"]?.after.map((e) => e["kind"])).toEqual(["place", "path"]);
        });

        it("🔴 die Sperren haben eine feste Reihenfolge (erst die Quelle, dann die Straßen nach aufsteigendem Anker): ein Körper in umgekehrter Reihenfolge hält die spätere Straße nicht, während er auf die frühere wartet", async () => {
            const [erste, zweite] = [P3.weg, anker].sort() as [string, string];
            const schluessel = (kennung: string) => `path:${kennung}`;
            const q6 = await neueQuelle("P3T Quelle Wege Sechs", "wege-sechs");
            const stand = (await zeile(q6)).revision;
            let nachzuegler: Promise<unknown> | undefined;
            let zweiteFrei: boolean | undefined;
            // Die Sperre der ersten Straße hält ein anderer; im Körper steht die zweite zuerst, der Folge nach kommt die erste vor ihr.
            await database.begin(async (tx) => {
                await tx`SELECT pg_advisory_xact_lock(hashtext('traeger_quellen:schreiben'), hashtext(${schluessel(erste)}))`;
                nachzuegler = aendereQuelle(database, redakteur, q6, {
                    operationId: neu(),
                    baseRevision: stand,
                    links: [weg("add", zweite, null, { pages: "1" }), weg("add", erste, null, { pages: "1" })],
                });
                for (let versuch = 0; versuch < 100; versuch += 1) {
                    const [wartet] = await tx<{ n: number }[]>`
                            SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
                        `;
                    if ((wartet?.n ?? 0) > 0) break;
                    await new Promise((fertig) => setTimeout(fertig, 50));
                }
                zweiteFrei = await database.begin(async (probe) => {
                    const [zeile] = await probe<{ ok: boolean }[]>`
                            SELECT pg_try_advisory_xact_lock(hashtext('traeger_quellen:schreiben'), hashtext(${schluessel(zweite)})) AS ok
                        `;
                    return zeile?.ok === true;
                });
            });
            await nachzuegler;
            expect(zweiteFrei).toBe(true);
            const wege = (await leseQuelle(database, q6))!.verwendungen.filter((eine) => eine.kind === "path");
            expect(wege.map((eine) => eine.carrierId).sort()).toEqual([erste, zweite].sort());
        }, 30_000);
    });
});
