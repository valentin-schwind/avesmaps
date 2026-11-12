import { randomUUID } from "node:crypto";
import type { Capability } from "@avesmaps3d/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ruecknehmenQuelle, vorschauQuelle } from "../src/editor/ruecknahme-quelle.ts";
import { ruecknehmenWerk, vorschauWerk } from "../src/editor/ruecknahme-werk.ts";
import type { RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { bereinigeTitel, findeTitelMitAuszeichnung, kennungDerOperation } from "../src/inhalte/titel-bereinigen.ts";
import { urlHash } from "../src/migration/sources.ts";
import { authFixture } from "./support/auth-fixture.ts";

/**
 * Der Lauf `titel:bereinigen` (Fund aus OPS-000091, Vali 2026-11-07: „Daten-Lauf“): Titel mit HTML oder Wiki-Markup im Bestand auf die Regel
 * `titelOhneAuszeichnung` bringen. Gegen die Wegwerf-Datenbank der Testläufe (`TEST_DATABASE_URL`); jeder Fall grenzt mit `nur` auf seine eigenen Zeilen ein.
 *
 * Problemfälle: der Lauf macht einen Titel des Wikis zu einem der Redaktion (`source_system = 'editor'`, Vermerk `manual`); ein Titel ohne Auszeichnung
 * („Band <1>“) wird mitgeschrieben; ein Titel, den die Regel leert, wird leer geschrieben; ein seit dem Lesen geänderter Gegenstand wird überschrieben;
 * die Operation steht ohne Akteur und Freigabe im Protokoll; ein zweiter Lauf schreibt noch einmal.
 */

const url = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = url ? describe : describe.skip;
const FREIGABE = "Test: Titel ohne Auszeichnung";
const agent: MapActor & { kind: "agent" } = {
    kind: "agent",
    label: "claudio",
    approvalRef: FREIGABE,
    environment: "test",
};

describeWithDatabase("Titel mit Auszeichnung im Bestand bereinigen (titel:bereinigen)", () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    const quellen: string[] = [];
    const werke: string[] = [];
    const assets: string[] = [];
    const laeufe: string[] = [];

    const quelle = async (titel: string, herkunft = "legacy"): Promise<string> => {
        const adresse = `https://titel-bereinigen.example/${randomUUID()}`;
        const [row] = await database<{ public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system)
            VALUES (${`url:${urlHash(adresse)}`}, 'final', ${adresse}, ${titel}, 'sonstiges', TRUE, ${herkunft})
            RETURNING public_id::text
        `;
        quellen.push(row!.public_id);
        return row!.public_id;
    };
    const werk = async (titel: string): Promise<string> => {
        const [row] = await database<{ public_id: string }[]>`
            INSERT INTO adventure (public_id, title, product_type, is_official, source_system)
            VALUES (gen_random_uuid(), ${titel}, 'gruppenabenteuer', TRUE, 'wikisync') RETURNING public_id::text
        `;
        werke.push(row!.public_id);
        return row!.public_id;
    };
    const asset = async (titel: string): Promise<string> => {
        const [row] = await database<{ public_id: string }[]>`
            INSERT INTO media_asset (media_kind, origin, source_system, source_ref, title)
            VALUES ('image', 'legacy_import', 'titel-bereinigen-test', ${randomUUID()}, ${titel}) RETURNING public_id::text
        `;
        assets.push(row!.public_id);
        return row!.public_id;
    };
    const stand = async (tafel: "feature_source" | "adventure" | "media_asset", kennung: string) => {
        const [row] = await database.unsafe<{ title: string; revision: number; source_system: string }[]>(
            `SELECT title, revision::int AS revision, source_system FROM ${tafel} WHERE public_id = $1::uuid`,
            [kennung],
        );
        return row!;
    };

    beforeAll(async () => {
        database = createDatabase(url as string);
        await migrate(database);
        fixture = authFixture(database);
    }, 120_000);

    afterAll(async () => {
        const operationen = await database<{ operation_id: string }[]>`
            SELECT DISTINCT operation_id::text FROM map_audit_event
             WHERE source_public_id = ANY(${quellen}::uuid[]) OR work_public_id = ANY(${werke}::uuid[])
        `;
        const ids = operationen.map((zeile) => zeile.operation_id);
        await database`
            DELETE FROM map_operation_revert_link
             WHERE restore_operation_id = ANY(${ids}::uuid[]) OR reverted_operation_id = ANY(${ids}::uuid[])
        `;
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM migration_run WHERE id = ANY(${laeufe}::uuid[])`;
        await database`DELETE FROM feature_source WHERE public_id = ANY(${quellen}::uuid[])`;
        await database`DELETE FROM adventure_field_origin WHERE adventure_id IN (SELECT id FROM adventure WHERE public_id = ANY(${werke}::uuid[]))`;
        await database`DELETE FROM adventure WHERE public_id = ANY(${werke}::uuid[])`;
        await database`DELETE FROM media_asset WHERE public_id = ANY(${assets}::uuid[])`;
        await fixture.cleanup();
        await database.end({ timeout: 5 });
    });

    it("findet genau die Titel, die die Regel ändert; ein Titel, den sie leert, bleibt stehen", async () => {
        const ids = [
            await quelle("Landkartenset <br />Das Dornenreich"),
            await quelle("Band <1>"),
            await quelle("Ohne Auszeichnung"),
            await quelle("<br />"),
            await werk("[[Das Geisterschiff (Szenario)|Das Geisterschiff]]"),
            await asset("Umschlag von „Der Scharlatan<br>Die Gabe der Amazonen“"),
        ];
        const funde = await findeTitelMitAuszeichnung(database, ids);
        expect(funde.map((fund) => [fund.art, fund.vorher, fund.nachher, fund.leer])).toEqual([
            ["quelle", "<br />", "", true],
            ["quelle", "Landkartenset <br />Das Dornenreich", "Landkartenset Das Dornenreich", false],
            ["werk", "[[Das Geisterschiff (Szenario)|Das Geisterschiff]]", "Das Geisterschiff", false],
            [
                "asset",
                "Umschlag von „Der Scharlatan<br>Die Gabe der Amazonen“",
                "Umschlag von „Der Scharlatan Die Gabe der Amazonen“",
                false,
            ],
        ]);
        const ergebnis = await bereinigeTitel(database, agent, funde);
        if (ergebnis.journal !== null) laeufe.push(ergebnis.journal);
        expect(ergebnis.fehler).toEqual([]);
        expect(ergebnis.geschrieben).toHaveLength(3);
        expect((await stand("feature_source", ids[3]!)).title).toBe("<br />");
    });

    it("schreibt nur den Titel: Herkunft bleibt, Akteur und Freigabe stehen im Protokoll, ein zweiter Lauf findet nichts", async () => {
        const q = await quelle("Landkartenset <br />Der Wolfsfrost", "wikisync");
        const w = await werk("Der Zug durch das Nebelmoor<br/>Die Sümpfe des Lebens");
        const a = await asset("Umschlag von „Der Zug durch das Nebelmoor<br/>Die Sümpfe des Lebens“");
        const vorher = {
            q: await stand("feature_source", q),
            w: await stand("adventure", w),
            a: await stand("media_asset", a),
        };
        const funde = await findeTitelMitAuszeichnung(database, [q, w, a]);
        expect(funde).toHaveLength(3);
        const ergebnis = await bereinigeTitel(database, agent, funde);
        if (ergebnis.journal !== null) laeufe.push(ergebnis.journal);
        expect(ergebnis.fehler).toEqual([]);

        const nachher = {
            q: await stand("feature_source", q),
            w: await stand("adventure", w),
            a: await stand("media_asset", a),
        };
        expect(nachher.q).toEqual({
            title: "Landkartenset Der Wolfsfrost",
            revision: vorher.q.revision + 1,
            source_system: "wikisync",
        });
        expect(nachher.w).toEqual({
            title: "Der Zug durch das Nebelmoor Die Sümpfe des Lebens",
            revision: vorher.w.revision + 1,
            source_system: "wikisync",
        });
        expect(nachher.a.title).toBe("Umschlag von „Der Zug durch das Nebelmoor Die Sümpfe des Lebens“");
        expect(nachher.a.revision).toBe(vorher.a.revision + 1);
        expect(nachher.a.source_system).toBe("titel-bereinigen-test");
        const vermerke = await database`
            SELECT 1 FROM adventure_field_origin o JOIN adventure a ON a.id = o.adventure_id WHERE a.public_id = ${w}::uuid
        `;
        expect(vermerke).toHaveLength(0);

        const protokoll = await database<
            {
                action: string;
                actor_kind: string;
                actor_label: string;
                approval_ref: string;
                eintrag: string;
                changes: unknown;
                vor: number;
                nach: number;
            }[]
        >`
            SELECT o.action, o.actor_kind, o.actor_label, o.approval_ref, e.action AS eintrag, e.changes,
                   e.revision_before::int AS vor, e.revision_after::int AS nach
              FROM map_operation o JOIN map_audit_event e ON e.operation_id = o.operation_id
             WHERE e.source_public_id = ${q}::uuid OR e.work_public_id = ${w}::uuid
             ORDER BY o.action
        `;
        expect(protokoll).toEqual([
            {
                action: "source.update",
                actor_kind: "agent",
                actor_label: "claudio",
                approval_ref: FREIGABE,
                eintrag: "source.updated",
                changes: {
                    title: { before: "Landkartenset <br />Der Wolfsfrost", after: "Landkartenset Der Wolfsfrost" },
                },
                vor: vorher.q.revision,
                nach: vorher.q.revision + 1,
            },
            {
                action: "work.update",
                actor_kind: "agent",
                actor_label: "claudio",
                approval_ref: FREIGABE,
                eintrag: "work.updated",
                changes: {
                    title: {
                        before: "Der Zug durch das Nebelmoor<br/>Die Sümpfe des Lebens",
                        after: "Der Zug durch das Nebelmoor Die Sümpfe des Lebens",
                    },
                },
                vor: vorher.w.revision,
                nach: vorher.w.revision + 1,
            },
        ]);
        const [journal] = await database<{ journal: { operator_said: string; renamed_titles: unknown[] } }[]>`
            SELECT journal FROM migration_run WHERE id = ${ergebnis.journal}::uuid
        `;
        expect(journal!.journal.operator_said).toBe(FREIGABE);
        expect(journal!.journal.renamed_titles).toEqual([
            {
                asset: a,
                before: "Umschlag von „Der Zug durch das Nebelmoor<br/>Die Sümpfe des Lebens“",
                after: "Umschlag von „Der Zug durch das Nebelmoor Die Sümpfe des Lebens“",
                revision_before: vorher.a.revision,
                revision_after: vorher.a.revision + 1,
            },
        ]);

        expect(await findeTitelMitAuszeichnung(database, [q, w, a])).toEqual([]);
        // Derselbe Fund noch einmal (ein wiederholter Aufruf): dieselbe Kennung, nichts doppelt im Protokoll.
        expect(kennungDerOperation(funde[0]!)).toBe(ergebnis.operationen.get(q));
    });

    it("↺ in „Änderungen“ nimmt die Operation an, bringt die Auszeichnung aber nicht zurück: Die Rücknahme schreibt über denselben Weg mit derselben Regel", async () => {
        const p = await fixture.person("editor", { name: "Titel Rücknahme" });
        const person: MapActor = { kind: "person", personId: p.id, environment: "test" };
        const leser: RuecknahmeLeser = {
            personId: p.id,
            rechte: new Set<Capability>(["use_editor_menu", "manage_sources"]),
        };
        const q = await quelle("Landkartenset <br />Das Dornenreich");
        const w = await werk("Der Scharlatan<br>Die Gabe der Amazonen");
        const ergebnis = await bereinigeTitel(database, agent, await findeTitelMitAuszeichnung(database, [q, w]));
        expect(ergebnis.fehler).toEqual([]);
        const mitglieder = (id: string) => {
            const members = [ergebnis.operationen.get(id)!];
            return { members, membersHash: mitgliederHash(members) };
        };
        expect((await vorschauQuelle(database, q, mitglieder(q), leser)).ergebnis).toBe("ok");
        expect((await vorschauWerk(database, w, mitglieder(w), leser)).ergebnis).toBe("ok");
        // Der Lauf ist ein Agent, keine Person der Sitzung: Die Rücknahme verlangt darum den Grund.
        await ruecknehmenQuelle(database, person, leser, q, {
            operationId: randomUUID(),
            ...mitglieder(q),
            reason: "Probe",
        });
        await ruecknehmenWerk(database, person, leser, w, {
            operationId: randomUUID(),
            ...mitglieder(w),
            reason: "Probe",
        });
        expect((await stand("feature_source", q)).title).toBe("Landkartenset Das Dornenreich");
        expect((await stand("adventure", w)).title).toBe("Der Scharlatan Die Gabe der Amazonen");
    });

    it("lässt einen seit dem Lesen geänderten Gegenstand liegen und nennt ihn als Fehler", async () => {
        const q = await quelle("Der Scharlatan<br>Die Gabe der Amazonen");
        const a = await asset("Umschlag von „Der Scharlatan<br>Die Gabe der Amazonen“");
        const funde = await findeTitelMitAuszeichnung(database, [q, a]);
        await database`UPDATE feature_source SET title = 'Von Hand gesetzt' WHERE public_id = ${q}::uuid`;
        await database`UPDATE media_asset SET title = 'Von Hand benannt' WHERE public_id = ${a}::uuid`;
        const ergebnis = await bereinigeTitel(database, agent, funde);
        if (ergebnis.journal !== null) laeufe.push(ergebnis.journal);
        expect(ergebnis.geschrieben).toEqual([]);
        expect(ergebnis.fehler.map((fehler) => fehler.fund.art)).toEqual(["quelle", "asset"]);
        expect((await stand("feature_source", q)).title).toBe("Von Hand gesetzt");
        expect((await stand("media_asset", a)).title).toBe("Von Hand benannt");
        const operationen = await database`SELECT 1 FROM map_audit_event WHERE source_public_id = ${q}::uuid`;
        expect(operationen).toHaveLength(0);
    });
});
