import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { MapHistoryPage } from "@avesmaps3d/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REDACTED, dissolvePerson } from "../src/auth/dissolve.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mapChange, mapChanges } from "../src/editor/history.ts";
import { MAP_AUDIT_FREE_TEXT_KEYS } from "../src/editor/map-audit-freitext.ts";
import {
    MAP_AUDIT_FIELDS,
    mapOperation,
    type MapActor,
    type MapAuditEntry,
    type MapChange,
} from "../src/editor/map-operation.ts";
import { authFixture } from "./support/auth-fixture.ts";
import { violation } from "./support/media-fixture.ts";

/**
 * Konto auflösen schwärzt auch das Kartenprotokoll (WI-0265 B7, Migration 0273; Fachvertrag F.3; Claudios Antwort „Ja, schwärzen“).
 *
 * Problemfall: Wer eine fremde Änderung zurücknimmt, schreibt einen Grund (`restoreReason` im Fachprotokoll `map_audit_event`); er kann einen Namen tragen und
 * stünde nach der Auflösung des Kontos für immer im Reiter „Änderungen“, den die App nur anhängen darf. Soll: der Grund der Rücknahmen DER Person wird
 * "[geschwärzt]", der Hash ihrer Anfragen leer; Inhalt der Karte, Gründe anderer Personen, Kennungen, Zeiten und Revisionen bleiben, die Liste liest danach
 * ohne Fehler, ein zweiter Lauf ändert nichts.
 */

// TypeBox kennt `date-time` nicht von selbst; ohne Eintrag prüft `Value.Check` jeden Zeitstempel als falsch.
FormatRegistry.Set("date-time", (wert) => !Number.isNaN(Date.parse(wert)));

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MIGRATION = fileURLToPath(new URL("../migrations/0273_map_redact_person.sql", import.meta.url));

/** Kennungen dieses Tests: dasselbe Präfix, damit das Aufräumen nur sie trifft. */
const PREFIX = "b7b70265";
const op = (n: number): string => `${PREFIX}-0000-4000-9000-${String(n).padStart(12, "0")}`;
const ort = (n: number): string => `${PREFIX}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const quelle = (n: number): string => `${PREFIX}-0000-4000-8100-${String(n).padStart(12, "0")}`;

describe("Freitextschlüssel des Kartenprotokolls", () => {
    it("🔴 dieselbe Liste in Migration 0273 und im Code, mit derselben Marke wie beim Auflösen", () => {
        const sql = readFileSync(MIGRATION, "utf8");
        const listed = /free_text CONSTANT text\[\] := ARRAY\[([^\]]*)\]/.exec(sql)?.[1];
        expect(listed?.split(",").map((entry) => entry.trim().replace(/^'|'$/g, ""))).toEqual([
            ...MAP_AUDIT_FREE_TEXT_KEYS,
        ]);
        expect(sql).toContain(`'${REDACTED}'`);
    });

    it("🔴 jeder Schlüssel der Positivliste, der nach Begründung aussieht, steht in der Liste; jede Notiz am Inhalt ist als Inhalt entschieden", () => {
        // Redaktionsnotiz an einer Quelle, einem Werk, einem Korpus, einem Lore-Eintrag: Inhalt der Karte, nicht Begründung der Person über ihre Handlung.
        // Ihr `before` schreibt die Rücknahme zurück; schwärzte man sie, verlöre die Karte Geschichte.
        const INHALT = new Set(["editorNote"]);
        const felder = new Set(Object.values(MAP_AUDIT_FIELDS).flat() as string[]);
        const grundartig = [...felder].filter((feld) => /reason|grund|begr[uü]nd/iu.test(feld));
        expect(grundartig.sort()).toEqual([...MAP_AUDIT_FREE_TEXT_KEYS].sort());
        const notizartig = [...felder].filter((feld) => /note|notiz|kommentar|comment|nachricht|message/iu.test(feld));
        for (const feld of notizartig)
            expect(
                INHALT.has(feld),
                `${feld}: Inhalt oder Begründung der Person? Entscheiden, in Liste oder Migration aufnehmen`,
            ).toBe(true);
        for (const schluessel of MAP_AUDIT_FREE_TEXT_KEYS) expect(felder.has(schluessel)).toBe(true);
    });
});

describeWithDatabase("Konto auflösen: Kartenprotokoll (Migration 0273)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let leaving: { id: string; name: string };
    let staying: { id: string; name: string };
    let weg: MapActor;
    let bleibt: MapActor;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
    }, 120_000);

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE ${`${PREFIX}-%`}`;
        // Die Verknüpfungen gehen mit ihren Operationen (ON DELETE CASCADE, Migration 0262).
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE ${`${PREFIX}-%`}`;
    }

    beforeEach(async () => {
        await aufraeumen();
        leaving = await fixture.person("editor", { name: "Karten Gehende" });
        staying = await fixture.person("editor", { name: "Karten Bleibende" });
        weg = { kind: "person", personId: leaving.id, environment: "test" };
        bleibt = { kind: "person", personId: staying.id, environment: "test" };
    });

    afterEach(async () => {
        await aufraeumen();
        await fixture.cleanup();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    const aenderung = (id: string, changes: Record<string, MapChange>): MapAuditEntry => ({
        action: "place.updated",
        placeId: id,
        revisionBefore: 1,
        revisionAfter: 2,
        changes,
    });

    /** Eine Operation über die echte Schreibnaht (Hash und Quittung wie im Betrieb). */
    async function schreibe(
        n: number,
        akteur: MapActor,
        eintraege: MapAuditEntry[],
        optionen: { zurueck?: number; grund?: string; operation?: string } = {},
    ): Promise<void> {
        await mapOperation(
            database,
            akteur,
            {
                operationId: op(n),
                operation:
                    optionen.operation ?? (optionen.zurueck === undefined ? "place.update" : "place.restore_series"),
                mapDomainId: "aventuria",
                // Der Körper trägt den Grund wie die Anfrage einer Rücknahme; der Hash darüber ist es, den die Schwärzung leert.
                body: { n, ...(optionen.grund === undefined ? {} : { reason: optionen.grund }) },
                ...(optionen.zurueck === undefined
                    ? {}
                    : { source: "restore" as const, reverts: [op(optionen.zurueck)] }),
            },
            async () => ({
                receipt: { affected: [], derivedWork: [], warnings: [] },
                summary: `Operation ${String(n)}`,
                entries: eintraege,
            }),
        );
    }

    async function dissolve(personId: string, name: string) {
        return database.begin((tx) =>
            dissolvePerson(tx, { personId, environment: "test", actorLabel: "cli:test", expectName: name }),
        );
    }

    type Eintrag = {
        operation_id: string;
        id: string;
        changes: Record<string, unknown>;
        revision_before: string | null;
    };
    const eintraegeVon = (ns: number[]) =>
        database<Eintrag[]>`
            SELECT operation_id::text, id::text, changes, revision_before::text
              FROM map_audit_event WHERE operation_id = ANY(${ns.map(op)}::uuid[]) ORDER BY id`;

    /**
     * Die Welt: 1 fremde Änderung (bleibt), 2 Änderung der Gehenden an einer Quelle (Inhalt mit `editorNote`), 3 ihre Rücknahme von 1 mit Grund, 4 Rücknahme von 2
     * durch die Bleibende mit Grund, 5 eine Änderung von ihr ohne Grund, 6 ihre Rücknahme von 5 als Serie zweier Orte mit Grund an jedem Eintrag, 7 eine Operation des Systems
     * mit demselben Schlüssel (kein Mensch, nicht ihre).
     */
    async function baueWelt(): Promise<void> {
        await schreibe(1, bleibt, [aenderung(ort(1), { name: { before: "alt", after: "neu" } })]);
        await schreibe(2, weg, [
            {
                action: "source.updated",
                sourceId: quelle(1),
                revisionBefore: 1,
                revisionAfter: 2,
                changes: { editorNote: { before: "Redaktionsnotiz alt", after: "Redaktionsnotiz neu" } },
            },
        ]);
        await schreibe(
            3,
            weg,
            [
                aenderung(ort(1), {
                    name: { before: "neu", after: "alt" },
                    restoreReason: { after: "Mail von Rondrikan: falscher Ort" },
                }),
            ],
            {
                zurueck: 1,
                grund: "Mail von Rondrikan: falscher Ort",
            },
        );
        await schreibe(
            4,
            bleibt,
            [
                aenderung(ort(2), {
                    name: { before: "b", after: "a" },
                    restoreReason: { after: "Grund der Bleibenden" },
                }),
            ],
            {
                zurueck: 2,
                grund: "Grund der Bleibenden",
            },
        );
        await schreibe(5, weg, [aenderung(ort(3), { name: { before: "x", after: "y" } })]);
        await schreibe(
            6,
            weg,
            [
                aenderung(ort(4), {
                    name: { before: "c", after: "d" },
                    restoreReason: { after: "Serie: Beschwerde von Thalionmel" },
                }),
                aenderung(ort(5), {
                    name: { before: "e", after: "f" },
                    restoreReason: { after: "Serie: Beschwerde von Thalionmel" },
                }),
            ],
            { zurueck: 5, grund: "Serie: Beschwerde von Thalionmel" },
        );
        await schreibe(7, { kind: "system", label: "test", environment: "test" }, [
            aenderung(ort(6), { name: { before: "g", after: "h" }, restoreReason: { after: "Text des Systems" } }),
        ]);
    }

    it("🔴 ihr Grund wird zur Marke, Inhalt, fremde Gründe, Kennungen und Revisionen bleiben; ihr Hash geht; ein zweiter Lauf ändert nichts", async () => {
        await baueWelt();
        const vorher = await eintraegeVon([1, 2, 3, 4, 5, 6, 7]);
        const operationenVorher = await database<
            { operation_id: string; seq: string; summary: string; at: Date; receipt: unknown }[]
        >`
            SELECT operation_id::text, seq::text, summary, at, receipt FROM map_operation WHERE operation_id = ANY(${[1, 2, 3, 4, 5, 6, 7].map(op)}::uuid[]) ORDER BY seq`;
        const verknuepfungenVorher = await database<{ n: string }[]>`
            SELECT count(*)::text AS n FROM map_operation_revert_link WHERE restore_operation_id::text LIKE ${`${PREFIX}-%`}`;

        const result = await dissolve(leaving.id, leaving.name);
        // 3 Einträge mit Grund (Operation 3 und die zwei der Serie) und 4 Operationen mit Hash (2, 3, 5, 6).
        expect(result.counts.redactedMap).toBe(7);

        const nachher = await eintraegeVon([1, 2, 3, 4, 5, 6, 7]);
        // Kennungen, Zuordnung und Revisionen bleiben, auch die Reihenfolge.
        expect(nachher.map((e) => [e.id, e.operation_id, e.revision_before])).toEqual(
            vorher.map((e) => [e.id, e.operation_id, e.revision_before]),
        );
        const von = (liste: Eintrag[], n: number) =>
            liste.filter((e) => e.operation_id === op(n)).map((e) => e.changes);
        // Ihr Grund ist die Marke, `name` daneben bleibt; der Schlüssel behält seine Form.
        expect(von(nachher, 3)).toEqual([
            { name: { before: "neu", after: "alt" }, restoreReason: { after: REDACTED } },
        ]);
        expect(von(nachher, 6)).toEqual([
            { name: { before: "c", after: "d" }, restoreReason: { after: REDACTED } },
            { name: { before: "e", after: "f" }, restoreReason: { after: REDACTED } },
        ]);
        // Unverändert: ihre Änderung am Inhalt, die Rücknahme der Bleibenden mit ihrem Grund, ihre Änderung ohne Grund, die fremde Änderung, die Operation des Systems.
        for (const n of [1, 2, 4, 5, 7]) expect(von(nachher, n), `Operation ${String(n)}`).toEqual(von(vorher, n));
        expect(von(nachher, 2)).toEqual([
            { editorNote: { before: "Redaktionsnotiz alt", after: "Redaktionsnotiz neu" } },
        ]);
        expect(von(nachher, 4)).toEqual([
            { name: { before: "b", after: "a" }, restoreReason: { after: "Grund der Bleibenden" } },
        ]);
        expect(von(nachher, 7)).toEqual([
            { name: { before: "g", after: "h" }, restoreReason: { after: "Text des Systems" } },
        ]);

        // Der Hash ist weg, wo SIE handelte; sonst bleibt er. Alles andere an der Operation bleibt, auch die Quittung.
        const hashes = await database<{ operation_id: string; leer: boolean }[]>`
            SELECT operation_id::text, request_hash IS NULL AS leer FROM map_operation
             WHERE operation_id = ANY(${[1, 2, 3, 4, 5, 6, 7].map(op)}::uuid[]) ORDER BY seq`;
        expect(hashes.map((h) => h.leer)).toEqual([false, true, true, false, true, true, false]);
        const operationenNachher = await database<
            { operation_id: string; seq: string; summary: string; at: Date; receipt: unknown }[]
        >`
            SELECT operation_id::text, seq::text, summary, at, receipt FROM map_operation WHERE operation_id = ANY(${[1, 2, 3, 4, 5, 6, 7].map(op)}::uuid[]) ORDER BY seq`;
        expect(operationenNachher).toEqual(operationenVorher);
        const verknuepfungenNachher = await database<{ n: string }[]>`
            SELECT count(*)::text AS n FROM map_operation_revert_link WHERE restore_operation_id::text LIKE ${`${PREFIX}-%`}`;
        expect(verknuepfungenNachher).toEqual(verknuepfungenVorher);

        // Was sie als Grund schrieb, steht nirgends mehr im Protokoll; ein zweiter Lauf findet nichts.
        const alles = JSON.stringify(await eintraegeVon([3, 6]));
        for (const spur of ["Rondrikan", "Thalionmel", "falscher Ort", "Beschwerde"]) expect(alles).not.toContain(spur);
        expect((await dissolve(leaving.id, leaving.name)).counts.redactedMap).toBe(0);
        expect(await eintraegeVon([1, 2, 3, 4, 5, 6, 7])).toEqual(nachher);
    });

    it("🔴 „Änderungen“ liest danach ohne Fehler: die Marke ist der Grund, der Grund der Bleibenden bleibt, das Original nennt ihn; die Antwort passt zum Vertrag", async () => {
        await baueWelt();
        await dissolve(leaving.id, leaving.name);

        const seite = await mapChanges(database, { mapDomainId: "aventuria", personId: staying.id });
        expect(
            Value.Check(MapHistoryPage, seite),
            JSON.stringify([...Value.Errors(MapHistoryPage, seite)].slice(0, 3)),
        ).toBe(true);
        const eintrag = (n: number) => {
            const gefunden = seite.entries.find((e) => e.operationId === op(n));
            if (gefunden === undefined) throw new Error(`Operation ${String(n)} fehlt in der Antwort`);
            return gefunden;
        };
        // Ihre Rücknahme von 1: Grund = Marke; das Original nennt sie mit demselben Grund.
        expect(eintrag(3).reason).toBe(REDACTED);
        expect(eintrag(1).revertedBy?.reason).toBe(REDACTED);
        // Ihre Gründe der Serie ebenso, der Grund der Bleibenden unverändert.
        expect(eintrag(6).reason).toBe(REDACTED);
        expect(eintrag(4).reason).toBe("Grund der Bleibenden");
        expect(eintrag(2).revertedBy?.reason).toBe("Grund der Bleibenden");
        // Ihre Änderung ohne Grund hat weiter keinen, die Historie bleibt zurücknehmbar (die Zustände sind die der Welt, nicht die der Schwärzung).
        expect(eintrag(5).reason).toBeUndefined();
        expect(eintrag(3).status).toBe("ruecknehmbar");
        expect(eintrag(1).status).toBe("bereits_zurueckgenommen");
        // Wer es war: der Platzhalter, nicht der Name.
        expect(eintrag(3).actor).toMatchObject({ kind: "person", id: leaving.id });
        expect(JSON.stringify(seite)).not.toContain("Karten Gehende");

        // Das Detail liest dieselbe Marke.
        const detail = await mapChange(database, op(3), { mapDomainId: "aventuria", personId: staying.id });
        expect(detail?.reason).toBe(REDACTED);
    });

    it("🔴 eine Wiederholung derselben Kennung bekommt nach der Schwärzung 409 statt der Quittung; davor die Quittung", async () => {
        await baueWelt();
        const nochmal = () =>
            mapOperation(
                database,
                weg,
                {
                    operationId: op(3),
                    operation: "place.restore_series",
                    mapDomainId: "aventuria",
                    body: { n: 3, reason: "Mail von Rondrikan: falscher Ort" },
                    source: "restore",
                    reverts: [op(1)],
                },
                async () => {
                    throw new Error("darf nicht ausgeführt werden");
                },
            );
        expect((await nochmal()).status).toBe("replayed");
        await dissolve(leaving.id, leaving.name);
        await expect(nochmal()).rejects.toMatchObject({ statusCode: 409, code: "idempotency_key_reused" });
    });

    it("🔴 die Formen des Schlüssels: Wert ohne Objekt, `before` und `after`, JSON-null, schon geschwärzt; andere Arten von Akteuren bleiben", async () => {
        const roh = async (n: number, personId: string | null, changes: unknown): Promise<void> => {
            await database`
                INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, environment, actor_kind, actor_person_id, actor_label)
                VALUES (${op(n)}::uuid, 'aventuria', decode(repeat('ab', 32), 'hex'),
                        jsonb_build_object('operationId', ${op(n)}::text, 'status', 'applied'), 'place.update', 'editor', 'test',
                        ${personId === null ? "system" : "person"}, ${personId}::uuid, ${personId === null ? "test" : null})`;
            await database`
                INSERT INTO map_audit_event (operation_id, action, place_public_id, revision_before, revision_after, changes)
                VALUES (${op(n)}::uuid, 'place.updated', ${ort(n)}::uuid, 1, 2, ${database.json(changes as never)})`;
        };
        await roh(1, leaving.id, { restoreReason: "Text ohne Objekt" });
        await roh(2, leaving.id, { restoreReason: { before: "vorher", after: "nachher" } });
        await roh(3, leaving.id, { restoreReason: { before: null, after: "nur nach" } });
        await roh(4, leaving.id, { restoreReason: { after: REDACTED } });
        await roh(5, leaving.id, { restoreReason: { after: null }, name: { before: "a", after: "b" } });
        await roh(6, leaving.id, { restoreReason: {} });
        await roh(7, leaving.id, { name: { before: "a", after: "b" } });
        await roh(8, staying.id, { restoreReason: { after: "fremd" } });
        await roh(9, null, { restoreReason: { after: "System" } });

        const [ergebnis] = await database<
            { n: string }[]
        >`SELECT public.redact_person_map_operation(${leaving.id}::uuid)::text AS n`;
        // Geändert: Operation 1 bis 3 (je ein Eintrag), dazu der Hash aller sieben Operationen der Person.
        expect(ergebnis!.n).toBe(String(3 + 7));
        const nachher = await eintraegeVon([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(nachher.map((e) => e.changes)).toEqual([
            { restoreReason: REDACTED },
            { restoreReason: { before: REDACTED, after: REDACTED } },
            { restoreReason: { before: null, after: REDACTED } },
            { restoreReason: { after: REDACTED } },
            { restoreReason: { after: null }, name: { before: "a", after: "b" } },
            { restoreReason: {} },
            { name: { before: "a", after: "b" } },
            { restoreReason: { after: "fremd" } },
            { restoreReason: { after: "System" } },
        ]);
        const [wiederholt] = await database<
            { n: string }[]
        >`SELECT public.redact_person_map_operation(${leaving.id}::uuid)::text AS n`;
        expect(wiederholt!.n).toBe("0");
        // Ohne Person, und eine Kennung ohne Operationen: nichts.
        const [ohne] = await database<{ a: string; b: string }[]>`
            SELECT public.redact_person_map_operation(NULL)::text AS a, public.redact_person_map_operation(gen_random_uuid())::text AS b`;
        expect(ohne).toEqual({ a: "0", b: "0" });
    });

    it("🔴 die gelockerte Bedingung: ohne Quittung weiter nicht, ohne Hash nur mit Quittung; Import und Zurücksetzen der Testwelt tragen weder noch", async () => {
        const einfuegen = (n: number, source: string, hash: string, receipt: string) =>
            database.unsafe(
                `INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, environment, actor_kind, actor_label)
                 VALUES ('${op(n)}', 'aventuria', ${hash}, ${receipt}, 'place.update', '${source}', 'test', 'system', 'test')`,
            );
        const quittung = (n: number) => `jsonb_build_object('operationId', '${op(n)}'::text, 'status', 'applied')`;
        expect(await violation(einfuegen(1, "editor", "NULL", "NULL"))).toEqual({
            code: "23514",
            constraint: "map_operation_request_from_runner",
        });
        expect(await violation(einfuegen(2, "restore", "decode(repeat('ab', 32), 'hex')", "NULL"))).toEqual({
            code: "23514",
            constraint: "map_operation_request_from_runner",
        });
        await einfuegen(3, "editor", "NULL", quittung(3));
        await einfuegen(4, "import", "NULL", "NULL");
        await einfuegen(5, "testwelt_reset", "NULL", "NULL");
    });
});
