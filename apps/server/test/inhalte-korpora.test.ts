import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { ApiError } from "../src/http/api-error.ts";
import { leseKorpus, listeKorpora } from "../src/inhalte/korpora-lesen.ts";
import { aendereKorpus, legeKorpusAn, pruefeWirkung, pruefeSchluessel } from "../src/inhalte/korpora-schreiben.ts";
import { leseQuelle } from "../src/inhalte/quellen-lesen.ts";
import { aendereQuelle, legeQuelleAn, schluesselDerAdresse } from "../src/inhalte/quellen-schreiben.ts";
import { wendeKorpusVorgabeAn } from "../src/migration/korpus-vorgabe.ts";
import { cleanP3Fixtures, insertP3Carriers, P3, type P3Ids } from "./support/p3-fixture.ts";

/**
 * Das Fenster „Inhalte bearbeiten“, Reiter „Korpora“ (WI-0254, Runde 4, Migration 0236; Vali: „Belegstellen-Korpus ja, wenn ich da was änder, änderts überall, was
 * den Korpus verwendet“): anlegen, ändern, Wirkung prüfen, Durchschreiben auf die Quellen einer Belegstelle, Sperre an der Quelle, Nachrechnen beim Zug. Gegen die
 * Wegwerf-Datenbank der Testläufe (`TEST_DATABASE_URL`); die Rechte der App-Rolle prüft der Rauchtest der Schreibwege.
 *
 * Problemfälle: ein Schlüssel mit www oder Pfad legt einen Korpus an, den nie jemand trifft; bei einem Werk schreibt eine Änderung doch durch (gemischte Arten
 * eines Shops würden platt); bei einer Belegstelle bleibt eine Quelle zurück („überall“ gilt nicht); die Änderung trifft hundert Quellen ohne Rückfrage; ein
 * Teil der Quellen wird geschrieben und der Korpus nicht (eine Transaktion); das Etikett der Träger bleibt auf dem alten Stand; an der einzelnen Quelle lässt
 * sich ändern, was der Korpus vorgibt; der Zug stellt die Quellen auf Legacys Werte zurück.
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
const BELEG = "p74kbeleg.example";
const WERK = "p74kwerk.example";
const OFFEN = "p74koffen.example";

describeWithDatabase("Korpora im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 4)", () => {
    let database: Database;
    let traeger: P3Ids;

    const fehler = async (work: Promise<unknown>): Promise<ApiError> => {
        try {
            await work;
        } catch (error) {
            if (error instanceof ApiError) return error;
            throw error;
        }
        throw new Error("ging durch");
    };
    const aufraeumen = async (): Promise<void> => {
        await database`DELETE FROM territory_source WHERE source_id IN (SELECT id FROM feature_source WHERE title LIKE 'P74K%')`;
        await database`DELETE FROM feature_source WHERE title LIKE 'P74K%'`;
        await database`DELETE FROM source_corpus WHERE corpus_key LIKE 'p74k%'`;
        await cleanP3Fixtures(database);
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
    };
    const korpusAnlegen = async (
        key: string,
        form: string,
        zusatz: { source_type?: string; is_official?: boolean; attribution?: string; label?: string } = {},
    ): Promise<string> => {
        const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO source_corpus (corpus_key, label, form, source_type, is_official, attribution, source_system)
            VALUES (${key}, ${zusatz.label ?? "P74K Angebot"}, ${form}, ${zusatz.source_type ?? null}, ${zusatz.is_official ?? null},
                    ${zusatz.attribution ?? null}, 'legacy')
            RETURNING public_id::text
        `;
        return zeile!.public_id;
    };
    /** Eine Quelle der Domain mit Adresse; gibt Kennung und interne Nummer zurück. */
    const quelleAnlegen = async (
        key: string,
        nummer: number,
        werte: {
            source_type?: string;
            is_official?: boolean;
            license_statement?: string;
            license_key?: string | null;
            attribution?: string | null;
            is_active?: boolean;
            source_system?: string;
            /** `null`: eine Quelle der Domain, zu der es noch keinen Korpus gibt. */
            corpus_key?: string | null;
        } = {},
    ): Promise<{ id: string; publicId: string }> => {
        const adresse = `https://www.${key}/seite-${String(nummer)}`;
        const aktiv = werte.is_active ?? true;
        const [zeile] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, license_statement, license_key, attribution,
                                        corpus_key, source_system, is_active, retired_at, retired_origin)
            VALUES (${schluesselDerAdresse(adresse)}, 'final', ${adresse}, ${`P74K Seite ${String(nummer)} ${key}`}, ${werte.source_type ?? "sonstiges"},
                    ${werte.is_official ?? false}, ${werte.license_statement ?? "unrecorded"}, ${werte.license_key ?? null}, ${werte.attribution ?? null},
                    ${werte.corpus_key === undefined ? key : werte.corpus_key}, ${werte.source_system ?? "legacy"}, ${aktiv}, ${aktiv ? null : new Date().toISOString()}, ${aktiv ? null : "import"})
            RETURNING id::text, public_id::text
        `;
        return { id: zeile!.id, publicId: zeile!.public_id };
    };
    const quelle = async (publicId: string) => {
        const [row] = await database<
            {
                revision: number;
                source_type: string;
                is_official: boolean;
                license_statement: string;
                license_key: string | null;
                attribution: string | null;
                source_system: string;
            }[]
        >`
            SELECT revision::int, source_type, is_official, license_statement, license_key, attribution, source_system
              FROM feature_source WHERE public_id = ${publicId}::uuid
        `;
        return row!;
    };
    const korpusZeile = async (key: string) => {
        const [row] = await database<
            {
                public_id: string;
                revision: number;
                label: string;
                form: string;
                source_type: string | null;
                is_official: boolean | null;
                license_statement: string;
                license_key: string | null;
                attribution: string | null;
                editor_note: string | null;
                source_system: string;
            }[]
        >`
            SELECT public_id::text, revision::int, label, form, source_type, is_official, license_statement, license_key, attribution, editor_note, source_system
              FROM source_corpus WHERE corpus_key = ${key}
        `;
        return row!;
    };
    const protokoll = async (operationId: string) =>
        database<
            {
                action: string;
                revision_before: number | null;
                revision_after: number | null;
                changes: Record<string, { before?: unknown; after?: unknown }>;
            }[]
        >`
            SELECT action, revision_before::int, revision_after::int, changes FROM map_audit_event WHERE operation_id = ${operationId}::uuid
        `;
    const kanon = async () => {
        const [row] = await database<{ canon: string; designator_type: string | null }[]>`
            SELECT k.canon, k.designator_type FROM territory_canon k JOIN territory t ON t.id = k.territory_id WHERE t.public_id = ${P3.gebiet}::uuid
        `;
        return row;
    };
    const aendere = (
        korpusId: string,
        felder: Parameters<typeof aendereKorpus>[3]["fields"],
        revision: number,
        bestaetigt?: boolean,
    ) =>
        aendereKorpus(database, redakteur, korpusId, {
            operationId: neu(),
            baseRevision: revision,
            fields: felder,
            ...(bestaetigt === undefined ? {} : { bestaetigt }),
        });

    beforeAll(async () => {
        database = createDatabase(url as string);
        await migrate(database);
        await aufraeumen();
        traeger = await insertP3Carriers(database);
    }, 120_000);

    beforeEach(async () => {
        await database`DELETE FROM territory_source WHERE source_id IN (SELECT id FROM feature_source WHERE title LIKE 'P74K%')`;
        await database`DELETE FROM feature_source WHERE title LIKE 'P74K%'`;
        await database`DELETE FROM source_corpus WHERE corpus_key LIKE 'p74k%'`;
        await database`DELETE FROM territory_canon WHERE territory_id = ${traeger[P3.gebiet]!}::bigint`;
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    // -----------------------------------------------------------------------------------------------------------------------------
    // Anlegen
    // -----------------------------------------------------------------------------------------------------------------------------

    it("der Schlüssel ist eine registrierbare Domain: kein www, kein Pfad, keine Unterdomain, nie ein Name", () => {
        expect(pruefeSchluessel("  P74KNeu.Example. ")).toBe("p74kneu.example");
        for (const schlecht of [
            "www.p74kneu.example",
            "wiki.p74kneu.example",
            "p74kneu.example/pfad",
            "beispiel",
            "Mein Angebot",
            "",
            "..",
            "a b.example",
        ]) {
            expect(() => pruefeSchluessel(schlecht), schlecht).toThrow(ApiError);
        }
        // Eine mehrteilige Endung gehört zur Domain.
        expect(pruefeSchluessel("beispiel.co.uk")).toBe("beispiel.co.uk");
    });

    it("🔴 Anlegen: source_system editor, ohne Form, eigene Kennung, Protokoll; Quellen der Domain ohne Korpus gehören danach dazu; ein vorhandener Korpus ist 409", async () => {
        const ohneKorpus = await quelleAnlegen(BELEG, 1, { corpus_key: null });
        const operationId = neu();
        const quittung = await legeKorpusAn(database, redakteur, {
            operationId,
            key: ` ${BELEG.toUpperCase()}. `,
            label: "  Briefspiel Beleg ",
        });
        expect(quittung.affected).toEqual([{ kind: "corpus", id: quittung.publicId, revision: 1 }]);
        expect(await korpusZeile(BELEG)).toMatchObject({
            public_id: quittung.publicId,
            revision: 1,
            label: "Briefspiel Beleg",
            form: "",
            source_type: null,
            is_official: null,
            license_statement: "unrecorded",
            source_system: "editor",
        });
        const [eintrag] = await protokoll(operationId);
        expect(eintrag).toMatchObject({ action: "corpus.created", revision_before: null, revision_after: 1 });
        expect(eintrag!.changes).toMatchObject({ key: { after: BELEG }, label: { after: "Briefspiel Beleg" } });
        const [dazu] = await database<
            { corpus_key: string | null }[]
        >`SELECT corpus_key FROM feature_source WHERE id = ${ohneKorpus.id}::bigint`;
        expect(dazu?.corpus_key).toBe(BELEG);
        const doppelt = await fehler(legeKorpusAn(database, redakteur, { operationId: neu(), key: BELEG }));
        expect(doppelt).toMatchObject({ statusCode: 409, code: "corpus_exists" });
        expect(doppelt.details).toMatchObject({ corpusId: quittung.publicId, active: true });
        // Eine wiederholte Anfrage mit derselben Kennung gibt dieselbe Quittung und legt nichts neu an.
        const nochmal = await legeKorpusAn(database, redakteur, {
            operationId,
            key: ` ${BELEG.toUpperCase()}. `,
            label: "  Briefspiel Beleg ",
        });
        expect(nochmal.status).toBe("replayed");
        expect(nochmal.publicId).toBe(quittung.publicId);
    });

    // -----------------------------------------------------------------------------------------------------------------------------
    // Lesen
    // -----------------------------------------------------------------------------------------------------------------------------

    it("🔴 Lesen: die Liste sucht nach Name und Domain und filtert nach Anzeigeform; der Korpus nennt Quellen, Abweichungen, Träger und ob er durchschreibt", async () => {
        const beleg = await korpusAnlegen(BELEG, "belegstelle", {
            source_type: "briefspiel",
            label: "P74K Briefspiel",
        });
        await korpusAnlegen(WERK, "werk", { label: "P74K Shop" });
        await korpusAnlegen(OFFEN, "", { label: "" });
        const a = await quelleAnlegen(BELEG, 1, { source_type: "briefspiel" });
        const b = await quelleAnlegen(BELEG, 2, { source_type: "sonstiges" });
        await quelleAnlegen(BELEG, 3, { is_active: false });
        await database`
            INSERT INTO territory_source (territory_id, source_id, position, source_system)
            VALUES (${traeger[P3.gebiet]!}::bigint, ${a.id}::bigint, 0, 'test'), (${traeger[P3.gebiet]!}::bigint, ${b.id}::bigint, 1, 'test')
        `;
        const liste = await listeKorpora(database, { q: "p74k" });
        // Die Reihenfolge nach Titel hängt an der Sortierfolge der Datenbank (Leerzeichen, Punkte): Hier zählt die Menge.
        expect(
            liste.items
                .map((k) => [k.key, k.title, k.form, k.quellen, k.herkunft])
                .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
        ).toEqual([
            [BELEG, "P74K Briefspiel", "belegstelle", 2, "legacy"],
            [OFFEN, OFFEN, "", 0, "legacy"],
            [WERK, "P74K Shop", "werk", 0, "legacy"],
        ]);
        expect((await listeKorpora(database, { q: "p74k briefspiel" })).items.map((k) => k.key)).toEqual([BELEG]);
        expect((await listeKorpora(database, { q: "briefspiel" })).items.map((k) => k.key)).toContain(BELEG);
        expect((await listeKorpora(database, { q: "p74k", form: "werk" })).items.map((k) => k.key)).toEqual([WERK]);
        expect((await listeKorpora(database, { q: "p74k", form: "unentschieden" })).items.map((k) => k.key)).toEqual([
            OFFEN,
        ]);
        const aufsteigend = (await listeKorpora(database, { q: "p74k" })).items.map((k) => k.key);
        expect((await listeKorpora(database, { q: "p74k", sort: "title_desc" })).items.map((k) => k.key)).toEqual(
            [...aufsteigend].reverse(),
        );
        expect((await listeKorpora(database, { q: "p74k_" })).total).toBe(0);

        const korpus = await leseKorpus(database, beleg);
        expect(korpus).toMatchObject({
            id: beleg,
            key: BELEG,
            form: "belegstelle",
            sourceType: "briefspiel",
            isOfficial: null,
            lizenzAussage: "unrecorded",
            schreibtDurch: true,
            quellenGesamt: 2,
            traegerGesamt: 1,
            abweichendGesamt: 1,
        });
        // Eine stillgelegte Quelle gehört dem Korpus nicht mehr zu; die Abweichung nennt das Feld.
        expect(korpus!.quellen.map((q) => [q.id, q.uses, q.abweichend])).toEqual([
            [a.publicId, 1, []],
            [b.publicId, 1, ["sourceType"]],
        ]);
        expect(await leseKorpus(database, randomUUID())).toBeUndefined();
        expect(korpus!.lizenzen.length).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------------------------------------------------------------
    // Ändern
    // -----------------------------------------------------------------------------------------------------------------------------

    it("🔴 Belegstelle: eine Änderung schreibt auf ALLE aktiven Quellen der Domain durch, in einer Operation mit Protokoll; die Revision zählt einmal, das Etikett der Träger folgt", async () => {
        const id = await korpusAnlegen(BELEG, "belegstelle");
        const eins = await quelleAnlegen(BELEG, 1, { source_type: "sonstiges" });
        const zwei = await quelleAnlegen(BELEG, 2, {
            source_type: "abenteuer",
            is_official: false,
            attribution: "Alt",
        });
        const drei = await quelleAnlegen(BELEG, 3, {
            source_type: "briefspiel",
            is_official: true,
            source_system: "editor",
        });
        const still = await quelleAnlegen(BELEG, 4, { is_active: false });
        await database`
            INSERT INTO territory_source (territory_id, source_id, position, source_system)
            VALUES (${traeger[P3.gebiet]!}::bigint, ${eins.id}::bigint, 0, 'test')
        `;
        const vorher = await Promise.all([eins, zwei, drei, still].map((q) => quelle(q.publicId)));
        const operationId = neu();
        const quittung = await aendereKorpus(database, redakteur, id, {
            operationId,
            baseRevision: 1,
            fields: {
                label: "  Briefspiel (Beleg) ",
                sourceType: "briefspiel",
                isOfficial: true,
                lizenzAussage: "license",
                lizenzKey: "cc-by-sa-3.0",
                attribution: "  Die Autoren ",
                editorNote: " Notiz ",
            },
        });
        expect(quittung.affected).toEqual([{ kind: "corpus", id, revision: 2 }]);
        expect(await korpusZeile(BELEG)).toMatchObject({
            revision: 2,
            label: "Briefspiel (Beleg)",
            form: "belegstelle",
            source_type: "briefspiel",
            is_official: true,
            license_statement: "license",
            license_key: "cc-by-sa-3.0",
            attribution: "Die Autoren",
            editor_note: "Notiz",
            source_system: "editor",
        });
        // Überall heißt überall: auch die Quelle, die die Redaktion angelegt hat; die stillgelegte bleibt.
        for (const q of [eins, zwei, drei]) {
            expect(await quelle(q.publicId), q.publicId).toMatchObject({
                source_type: "briefspiel",
                is_official: true,
                license_statement: "license",
                license_key: "cc-by-sa-3.0",
                attribution: "Die Autoren",
            });
        }
        expect(await quelle(still.publicId)).toMatchObject({
            source_type: "sonstiges",
            is_official: false,
            license_statement: "unrecorded",
        });
        // Die Quellen werden nicht einzeln als „editor“ gesperrt (die geschützte Zeile ist die des Korpus), ihre Revision zählt der Trigger.
        expect((await quelle(eins.publicId)).source_system).toBe("legacy");
        expect((await quelle(zwei.publicId)).revision).toBe(vorher[1]!.revision + 1);
        expect((await quelle(still.publicId)).revision).toBe(vorher[3]!.revision);
        // Das Protokoll hält fest, was sich wo änderte: vorher und nachher je geänderter Quelle.
        const [eintrag] = await protokoll(operationId);
        expect(eintrag).toMatchObject({ action: "corpus.updated", revision_before: 1, revision_after: 2 });
        expect(eintrag!.changes).toMatchObject({
            label: { before: "P74K Angebot", after: "Briefspiel (Beleg)" },
            sourceType: { after: "briefspiel" },
            isOfficial: { after: true },
        });
        const quellenAenderung = eintrag!.changes["quellen"] as {
            before: { id: string; sourceType: string }[];
            after: { id: string; sourceType: string }[];
        };
        expect(quellenAenderung.before.map((q) => [q.id, q.sourceType]).sort()).toEqual(
            [
                [eins.publicId, "sonstiges"],
                [zwei.publicId, "abenteuer"],
                [drei.publicId, "briefspiel"],
            ].sort(),
        );
        expect(quellenAenderung.after.every((q) => q.sourceType === "briefspiel")).toBe(true);
        const [operation] = await database<
            { summary: string }[]
        >`SELECT summary FROM map_operation WHERE operation_id = ${operationId}::uuid`;
        expect(operation?.summary).toBe("Korpus „Briefspiel (Beleg)“ geändert, 3 Quellen");
        // Das Etikett des Trägers folgt der Regel (offiziell mit der Art), in derselben Transaktion.
        expect(await kanon()).toMatchObject({ canon: "official", designator_type: "briefspiel" });
        // Derselbe Stand noch einmal ist keine Änderung: keine Revision, kein Protokoll.
        const nochmal = await aendere(id, { sourceType: "briefspiel", isOfficial: true }, 2);
        expect(nochmal.affected).toEqual([{ kind: "corpus", id, revision: 2 }]);
    });

    it("🔴 Werk und unentschiedene Form: nichts schreibt durch, die Felder sind am Korpus gesperrt; erst die Form Belegstelle gibt vor", async () => {
        const werk = await korpusAnlegen(WERK, "werk");
        const offen = await korpusAnlegen(OFFEN, "");
        const w = await quelleAnlegen(WERK, 1, { source_type: "roman" });
        const o = await quelleAnlegen(OFFEN, 1, { source_type: "abenteuer", is_official: true });
        for (const [id, form] of [
            [werk, "werk"],
            [offen, ""],
        ] as const) {
            for (const felder of [
                { sourceType: "briefspiel" },
                { isOfficial: false },
                { lizenzAussage: "public_domain" },
                { attribution: "Nennung" },
            ] as const) {
                const f = await fehler(aendere(id, felder, 1));
                expect(f, `${form} ${JSON.stringify(felder)}`).toMatchObject({
                    statusCode: 400,
                    code: "validation_failed",
                });
            }
        }
        // Name, Notiz und Form dürfen sich ändern; die Quellen bleiben, wie sie sind.
        await aendere(werk, { label: "Shop", editorNote: "x" }, 1);
        expect(await quelle(w.publicId)).toMatchObject({ source_type: "roman" });
        expect(await quelle(o.publicId)).toMatchObject({ source_type: "abenteuer", is_official: true });
        // Form und Vorgabe zusammen sind erlaubt: Die Form NACH der Änderung zählt.
        await aendere(offen, { form: "belegstelle", sourceType: "briefspiel" }, 1);
        expect(await quelle(o.publicId)).toMatchObject({ source_type: "briefspiel", is_official: true });
        // Zurück zu „werk“: die Werte bleiben an den Quellen, weiter schreibt nichts durch, die Felder sind wieder gesperrt.
        await aendere(offen, { form: "werk" }, 2);
        expect(await quelle(o.publicId)).toMatchObject({ source_type: "briefspiel" });
        expect(await fehler(aendere(offen, { sourceType: "roman" }, 3))).toMatchObject({ statusCode: 400 });
        expect(await korpusZeile(OFFEN)).toMatchObject({ form: "werk", source_type: "briefspiel", revision: 3 });
    });

    it("🔴 Eine Vorgabe „nicht erfasst“ oder leer gibt nichts vor und nimmt nichts zurück; Lizenz: Aussage und Schlüssel gehören zusammen", async () => {
        const id = await korpusAnlegen(BELEG, "belegstelle");
        const q = await quelleAnlegen(BELEG, 1, {
            source_type: "roman",
            attribution: "Alt",
            license_statement: "unfree",
        });
        // Nur die Form und der Name: keine Vorgabe gesetzt, also schreibt nichts durch.
        await aendere(id, { label: "Nur Name" }, 1);
        expect(await quelle(q.publicId)).toMatchObject({
            source_type: "roman",
            attribution: "Alt",
            license_statement: "unfree",
        });
        expect(await fehler(aendere(id, { lizenzAussage: "license" }, 2))).toMatchObject({ statusCode: 400 });
        expect(await fehler(aendere(id, { lizenzAussage: "license", lizenzKey: "gibt-es-nicht" }, 2))).toMatchObject({
            statusCode: 400,
        });
        expect(await fehler(aendere(id, { lizenzAussage: "unfree", lizenzKey: "cc-by-sa-3.0" }, 2))).toMatchObject({
            statusCode: 400,
        });
        expect(await fehler(aendere(id, { sourceType: "gibtesnicht" as never }, 2))).toMatchObject({ statusCode: 400 });
        await aendere(id, { lizenzAussage: "public_domain" }, 2);
        expect(await quelle(q.publicId)).toMatchObject({
            license_statement: "public_domain",
            license_key: null,
            source_type: "roman",
            attribution: "Alt",
        });
        // Die Vorgabe zurücknehmen (leer, „nicht erfasst“) schreibt nichts zurück.
        await aendere(id, { sourceType: null, lizenzAussage: "unrecorded", attribution: "   " }, 3);
        expect(await quelle(q.publicId)).toMatchObject({ license_statement: "public_domain" });
        expect(await korpusZeile(BELEG)).toMatchObject({
            source_type: null,
            license_statement: "unrecorded",
            attribution: null,
        });
    });

    it("🔴 Ab 10 Quellen, die sich ändern, verlangt das Speichern die Bestätigung (409 corpus_confirm_required); abgelehnt bleibt alles beim Alten", async () => {
        const id = await korpusAnlegen(BELEG, "belegstelle");
        const quellen = [];
        for (let nummer = 1; nummer <= 10; nummer += 1)
            quellen.push(await quelleAnlegen(BELEG, nummer, { source_type: "sonstiges" }));
        const vorher = await quelle(quellen[0]!.publicId);
        const abgelehnt = await fehler(aendere(id, { sourceType: "briefspiel" }, 1));
        expect(abgelehnt).toMatchObject({ statusCode: 409, code: "corpus_confirm_required" });
        expect(abgelehnt.details).toMatchObject({ quellen: 10, aendern: 10 });
        // Nichts ist passiert: weder die Quellen noch der Korpus (eine Transaktion).
        expect(await quelle(quellen[0]!.publicId)).toEqual(vorher);
        expect(await korpusZeile(BELEG)).toMatchObject({ revision: 1, source_type: null });
        // Mit der Bestätigung geht es durch.
        await aendere(id, { sourceType: "briefspiel" }, 1, true);
        expect(await quelle(quellen[9]!.publicId)).toMatchObject({ source_type: "briefspiel" });
        // Ändern sich nur neun, fragt nichts nach (eine Quelle trägt den Wert schon).
        await aendere(id, { sourceType: null }, 2);
        await database`UPDATE feature_source SET source_type = 'sonstiges' WHERE id = ANY(${quellen.slice(1).map((q) => q.id)}::bigint[])`;
        await aendere(id, { sourceType: "briefspiel" }, 3);
        expect(await quelle(quellen[1]!.publicId)).toMatchObject({ source_type: "briefspiel" });
    });

    it("🔴 Wirkung prüfen: je Feld, wie viele Quellen sich ändern und wie viele davon eine Aussage tragen, die überschrieben wird; bei einem Werk bleibt es leer", async () => {
        const id = await korpusAnlegen(BELEG, "belegstelle");
        await quelleAnlegen(BELEG, 1, { source_type: "sonstiges" });
        await quelleAnlegen(BELEG, 2, { source_type: "abenteuer", attribution: "Alt" });
        await quelleAnlegen(BELEG, 3, { source_type: "briefspiel", is_official: true });
        await quelleAnlegen(BELEG, 4, { is_active: false, source_type: "roman" });
        const wirkung = await pruefeWirkung(database, id, {
            fields: { sourceType: "briefspiel", isOfficial: true, attribution: "Neu", lizenzAussage: "public_domain" },
        });
        expect(wirkung).toMatchObject({
            form: "belegstelle",
            schreibtDurch: true,
            quellenGesamt: 3,
            traegerGesamt: 0,
            aendernGesamt: 3,
            bestaetigungAb: 10,
            bestaetigungNoetig: false,
        });
        expect(wirkung.felder.map((f) => [f.feld, f.aendern, f.ueberschreibt])).toEqual([
            ["sourceType", 2, 1],
            ["isOfficial", 2, 2],
            ["lizenz", 3, 0],
            ["attribution", 3, 1],
        ]);
        // „Wirkung prüfen“ schreibt nichts.
        expect(await korpusZeile(BELEG)).toMatchObject({ revision: 1, source_type: null });
        // Auch die Form gehört zur Rechnung: Mit „werk“ danach schreibt nichts durch.
        const werk = await pruefeWirkung(database, id, { fields: { form: "werk" } });
        expect(werk).toMatchObject({ form: "werk", schreibtDurch: false, aendernGesamt: 0, felder: [] });
        expect((await fehler(pruefeWirkung(database, randomUUID(), { fields: {} }))).statusCode).toBe(404);
    });

    it("ein veralteter Stand ist 409 edit_conflict, ein leerer Körper und ein unbekannter Korpus sind Fehler", async () => {
        const id = await korpusAnlegen(BELEG, "belegstelle");
        await aendere(id, { label: "Erste Änderung" }, 1);
        const alt = await fehler(aendere(id, { label: "Zweite Änderung" }, 1));
        expect(alt).toMatchObject({ statusCode: 409, code: "edit_conflict" });
        expect((await fehler(aendere(id, {}, 2))).statusCode).toBe(400);
        expect((await fehler(aendere(randomUUID(), { label: "x" }, 1))).statusCode).toBe(404);
        expect(await korpusZeile(BELEG)).toMatchObject({ label: "Erste Änderung", revision: 2 });
    });

    // -----------------------------------------------------------------------------------------------------------------------------
    // Die Quelle: was der Korpus vorgibt, gehört dem Korpus
    // -----------------------------------------------------------------------------------------------------------------------------

    it("🔴 An der einzelnen Quelle sind die Felder gesperrt, die der Korpus vorgibt; eine neue Quelle der Domain bekommt die Vorgabe; Werk-Korpora lassen alles frei", async () => {
        const beleg = await korpusAnlegen(BELEG, "belegstelle", {
            source_type: "briefspiel",
            attribution: "Die Autoren",
        });
        const werk = await korpusAnlegen(WERK, "werk", { source_type: "roman" });
        const q = await quelleAnlegen(BELEG, 1, { source_type: "briefspiel", attribution: "Die Autoren" });
        const w = await quelleAnlegen(WERK, 1, { source_type: "abenteuer" });
        void werk;
        // Der Korpus sagt es der Quelle: nur die gesetzten Felder, nur bei einer Belegstelle.
        expect((await leseQuelle(database, q.publicId))!.korpus).toMatchObject({
            key: BELEG,
            form: "belegstelle",
            gibtVor: ["sourceType", "attribution"],
        });
        expect((await leseQuelle(database, w.publicId))!.korpus).toMatchObject({ key: WERK, form: "werk" });
        expect((await leseQuelle(database, w.publicId))!.korpus?.gibtVor).toBeUndefined();
        const stand = (await quelle(q.publicId)).revision;
        const gesperrt = await fehler(
            aendereQuelle(database, redakteur, q.publicId, {
                operationId: neu(),
                baseRevision: stand,
                fields: { sourceType: "abenteuer" },
            }),
        );
        expect(gesperrt).toMatchObject({ statusCode: 400, code: "validation_failed" });
        expect(
            await fehler(
                aendereQuelle(database, redakteur, q.publicId, {
                    operationId: neu(),
                    baseRevision: stand,
                    fields: { attribution: "Andere" },
                }),
            ),
        ).toMatchObject({
            statusCode: 400,
        });
        // Was der Korpus nicht vorgibt (offiziell, Lizenz), bleibt an der Quelle; der Wert, den der Korpus ohnehin trägt, ist keine Änderung.
        await aendereQuelle(database, redakteur, q.publicId, {
            operationId: neu(),
            baseRevision: stand,
            fields: { isOfficial: true, sourceType: "briefspiel", title: "P74K Seite 1 neu" },
        });
        expect(await quelle(q.publicId)).toMatchObject({ is_official: true, source_type: "briefspiel" });
        // Bei einem Werk bleibt alles frei.
        const standW = (await quelle(w.publicId)).revision;
        await aendereQuelle(database, redakteur, w.publicId, {
            operationId: neu(),
            baseRevision: standW,
            fields: { sourceType: "roman" },
        });
        expect(await quelle(w.publicId)).toMatchObject({ source_type: "roman" });
        // Eine neue Quelle der Domain bekommt, was der Korpus vorgibt (Art und Namensnennung), gleich beim Anlegen.
        const angelegt = await legeQuelleAn(database, redakteur, {
            operationId: neu(),
            url: `https://www.${BELEG}/neu`,
            title: "P74K Neue Seite",
            sourceType: "roman",
            isOfficial: true,
        });
        expect(await quelle(angelegt.publicId)).toMatchObject({
            source_type: "briefspiel",
            is_official: true,
            attribution: "Die Autoren",
        });
        void beleg;
    });

    // -----------------------------------------------------------------------------------------------------------------------------
    // Der Zug
    // -----------------------------------------------------------------------------------------------------------------------------

    it("🔴 Der Zug rechnet die Vorgabe eines Belegstellen-Korpus nach dem Abgleich erneut auf die Quellen, auch auf die der Redaktion; Werke und Korpora ohne Vorgabe bleiben", async () => {
        await korpusAnlegen(BELEG, "belegstelle", {
            source_type: "briefspiel",
            is_official: false,
            attribution: "Die Autoren",
        });
        await korpusAnlegen(WERK, "werk", { source_type: "roman" });
        await korpusAnlegen(OFFEN, "belegstelle");
        const a = await quelleAnlegen(BELEG, 1, { source_type: "sonstiges", is_official: true });
        const b = await quelleAnlegen(BELEG, 2, {
            source_type: "briefspiel",
            is_official: false,
            attribution: "Die Autoren",
        });
        const c = await quelleAnlegen(BELEG, 3, { source_type: "abenteuer", source_system: "editor" });
        const stillgelegt = await quelleAnlegen(BELEG, 4, { is_active: false, source_type: "roman" });
        const w = await quelleAnlegen(WERK, 1, { source_type: "abenteuer" });
        const o = await quelleAnlegen(OFFEN, 1, { source_type: "abenteuer" });
        const bericht = await wendeKorpusVorgabeAn(database);
        // Die Wegwerf-Datenbank kann weitere Korpora tragen: gezählt wird, was zu meinen gehört.
        expect(bericht.korpora).toBeGreaterThanOrEqual(1);
        expect(bericht.quellen).toBeGreaterThanOrEqual(2);
        expect(await quelle(a.publicId)).toMatchObject({
            source_type: "briefspiel",
            is_official: false,
            attribution: "Die Autoren",
        });
        expect(await quelle(b.publicId)).toMatchObject({ source_type: "briefspiel", is_official: false });
        expect(await quelle(c.publicId)).toMatchObject({ source_type: "briefspiel", source_system: "editor" });
        expect(await quelle(stillgelegt.publicId)).toMatchObject({ source_type: "roman" });
        expect(await quelle(w.publicId)).toMatchObject({ source_type: "abenteuer" });
        expect(await quelle(o.publicId)).toMatchObject({ source_type: "abenteuer" });
        // Ein zweiter Lauf ändert nichts mehr.
        expect((await wendeKorpusVorgabeAn(database)).quellen).toBe(0);
    });
});
