import { randomBytes, randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AnKanalAntwort, KorrekturKandidaten, VorgangDetail, VorgangQuittung, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { mitHerkunft } from "../src/community/herkunft.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { mapOperation, type MapActor, type MapWork } from "../src/editor/map-operation.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Verknüpfungen eines Vorgangs (WI-0268 C7; Fachkonzept WI-0263 §6 und §7, Migration 0272 und 0273) gegen echtes PostgreSQL, über die Routen.
 *
 * - **Korrektur:** Was der Editor mit dem Vorgang als Herkunft schrieb (`editor`) und was jemand von Hand verknüpfte (`hand`) steht im Detail, neueste zuerst, ohne Doppelte. Eine unbekannte Operation
 *   gibt 404; dieselbe Verknüpfung zweimal ist eine Zeile und ein Eintrag im Protokoll; der Vorgang ändert dabei weder Zustand noch Revision.
 * - **Kandidaten:** die letzten 15 Operationen am Bezugsobjekt, bei einer Stelle die eigenen der Person; was schon verknüpft ist, fehlt.
 * - 🔴 **Betreiber-Kanal:** `an-kanal` legt den Kanal-Vorgang an und verknüpft ihn in EINER Transaktion, ohne Melderdaten (weder Name noch Adresse noch Text), nur mit `use_operator_channel`; dieselbe
 *   Kennung legt nichts zweites an. Das Protokoll trägt nur Nummern.
 * - 🔴 **Anfragen nur mit `read_mailbox`:** der Wächter der Anfragen gilt auch für die neuen Wege.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0268-c7b";
const ORT = "a2680c08-0000-4000-8000-000000000001";
const op = (n: number): string => `a2680c08-0000-4000-9000-${String(n).padStart(12, "0")}`;
const MELDER_NAME = "Alrike Quellenfinder";
const MELDER_MAIL = "alrike.quellenfinder@example.org";
const MELDER_TEXT = "Wehrheim liegt zu weit im Westen, laut Regionalband näher an der Reichsstraße.";

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "community-verknuepfen-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Community: Verknüpfungen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let lena: { id: string; cookie: string };
    let adrian: { id: string; cookie: string };
    let olaf: { id: string; cookie: string };
    let alle: string[];
    let adresse = 10;
    const neueAdresse = (): string => `10.41.0.${String(adresse++)}`;
    let zaehler = 0;
    let olafAkteur: MapActor;
    let lenaAkteur: MapActor;

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_community.vorgang`;
        await database`DELETE FROM avesmaps_kanal.vorgang WHERE gemeldet_von = ANY(${alle}::uuid[])`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.community_%'`;
        await database`DELETE FROM public.benachrichtigung WHERE an_person = ANY(${alle}::uuid[])`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a2680c08-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a2680c08-%'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        lena = await person("reviewer", "Lena");
        adrian = await person("admin", "Adrian");
        olaf = await person("operator", "Olaf");
        alle = [lena.id, adrian.id, olaf.id];
        olafAkteur = { kind: "person", personId: olaf.id, environment: "test" };
        lenaAkteur = { kind: "person", personId: lena.id, environment: "test" };
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}, 'aventuria', 'C7 Probeort', 'stadt', ST_SetSRID(ST_MakePoint(611, 612), 0), ${SOURCE}, TRUE)
        `;
    });

    beforeEach(async () => {
        await leeren();
        zaehler = 0;
    });

    afterAll(async () => {
        await leeren().catch(() => undefined);
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`.catch(() => undefined);
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    // --- Hilfen --------------------------------------------------------------------------------------------------------------

    const umbenennen =
        (name: string): MapWork =>
        async (tx) => {
            await tx`UPDATE place SET name = ${name} WHERE public_id = ${ORT}::uuid`;
            return {
                receipt: { affected: [], derivedWork: [], warnings: [] },
                summary: `Umbenannt in ${name}`,
                entries: [{ action: "place.updated", placeId: ORT, changes: { name: { before: null, after: name } } }],
            };
        };
    /** Eine Operation am Ort; `von` ist, wer sie schrieb, `herkunft` der Vorgang, aus dem der Editor geöffnet wurde. Gibt die Kennung der Operation zurück. */
    async function speichern(von: MapActor = olafAkteur, herkunft?: number): Promise<string> {
        zaehler += 1;
        const kennung = op(zaehler);
        const lauf = () =>
            mapOperation(
                database,
                von,
                {
                    operationId: kennung,
                    operation: "place.update",
                    mapDomainId: "aventuria",
                    body: { name: `Probe ${String(zaehler)}` },
                },
                umbenennen(`Probe ${String(zaehler)}`),
            );
        await (herkunft === undefined ? lauf() : mitHerkunft(herkunft, lauf));
        return kennung;
    }

    const meldung = (patch: Record<string, unknown> = {}) => ({
        operationId: randomUUID(),
        schluessel: randomBytes(32).toString("base64url"),
        kategorie: "lage",
        text: MELDER_TEXT,
        quelle: "Herz des Reiches, S. 112",
        name: MELDER_NAME,
        bezug: {
            art: "objekt",
            objektArt: "place",
            objektId: ORT,
            name: "C7 Probeort",
            typ: "Stadt",
            lage: { x: 611, y: 612 },
        },
        falle: { feld: "", dauerMs: 8000 },
        ...patch,
    });
    const kontakt = () => ({
        operationId: randomUUID(),
        schluessel: randomBytes(32).toString("base64url"),
        kategorie: "frage",
        text: "Darf die Karte für ein Spielleiterhandbuch verwendet werden? Wir würden gern einen Ausschnitt drucken.",
        name: MELDER_NAME,
        mail: MELDER_MAIL,
        falle: { feld: "", dauerMs: 8000 },
    });
    const postOeffentlich = (url: string, payload: Record<string, unknown>) =>
        app.inject({ method: "POST", url, payload, remoteAddress: neueAdresse(), headers: { origin: TEST_ORIGIN } });
    const get = (url: string, cookie?: string) =>
        app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    /** Reicht eine Meldung ein (am Ort, mit Namen des Melders) und gibt ihre Nummer zurück. */
    async function melde(patch: Record<string, unknown> = {}): Promise<string> {
        const antwort = await postOeffentlich("/api/community/meldungen", meldung(patch));
        expect(code(antwort)).toBe("201");
        return (antwort.json() as { nummer: string }).nummer;
    }
    const meldeStelle = (): Promise<string> => melde({ bezug: { art: "stelle", lage: { x: 611, y: 612 } } });
    const idVon = (nummer: string): number => Number(nummer.slice(4));
    async function detail(nummer: string, cookie = olaf.cookie): Promise<VorgangDetail> {
        const antwort = await get(`/api/community/vorgaenge/${nummer}`, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as VorgangDetail;
        expect(Value.Check(VorgangDetail, body)).toBe(true);
        return body;
    }
    const kandidaten = async (nummer: string, cookie = olaf.cookie) => {
        const antwort = await get(`/api/community/vorgaenge/${nummer}/korrektur-kandidaten`, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as KorrekturKandidaten;
        expect(Value.Check(KorrekturKandidaten, body)).toBe(true);
        return body;
    };
    const korrektur = (nummer: string, ziel: string, cookie = olaf.cookie, operationId: string = randomUUID()) =>
        post(`/api/community/vorgaenge/${nummer}/korrektur`, { operationId, ziel }, cookie);
    const anKanal = (nummer: string, patch: Record<string, unknown> = {}, cookie = olaf.cookie) =>
        post(
            `/api/community/vorgaenge/${nummer}/an-kanal`,
            {
                operationId: randomUUID(),
                kategorie: "karteninhalt",
                prioritaet: "normal",
                titel: `${nummer} · Lage · C7 Probeort`,
                nachricht: `Aus Community-Vorgang ${nummer}. Bezug: C7 Probeort.`,
                ...patch,
            },
            cookie,
        );
    const protokoll = async (action: string) =>
        database<{ target_ref: string | null; details: Record<string, unknown> }[]>`
            SELECT target_ref, details FROM avesmaps_auth.security_event WHERE action = ${action} ORDER BY id
        `;
    const zeilen = async (nummer: string): Promise<number> =>
        (
            await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM avesmaps_community.verknuepfung WHERE vorgang_id = ${idVon(nummer)}::bigint
            `
        )[0]!.n;

    // --- Korrektur -----------------------------------------------------------------------------------------------------------

    it("🔴 Korrektur von Hand: die Operation steht mit dem Weg `hand` im Detail; zweimal ist eine Zeile und ein Eintrag im Protokoll; Zustand und Revision bleiben", async () => {
        const nummer = await melde();
        const vorher = await detail(nummer);
        expect(vorher.korrekturen).toBeUndefined();
        expect(vorher.kanal).toBeUndefined();
        const kennung = await speichern();

        const erste = await korrektur(nummer, kennung);
        expect(code(erste)).toBe("200");
        expect(Value.Check(VorgangQuittung, erste.json())).toBe(true);
        expect(erste.json()).toEqual({ nummer, revision: vorher.zeile.revision });
        // Dieselbe Verknüpfung nochmals, mit anderer Kennung der Handlung.
        expect(code(await korrektur(nummer, kennung))).toBe("200");
        // Dieselbe Kennung der Handlung nochmals.
        const operationId = randomUUID();
        expect(code(await korrektur(nummer, kennung, olaf.cookie, operationId))).toBe("200");
        expect(code(await korrektur(nummer, kennung, olaf.cookie, operationId))).toBe("200");

        expect(await zeilen(nummer)).toBe(1);
        const danach = await detail(nummer);
        expect(danach.korrekturen).toEqual([
            {
                operationId: kennung,
                aktion: "place.update",
                zusammenfassung: "Umbenannt in Probe 1",
                at: expect.any(String),
                von: { id: olaf.id, name: "Olaf" },
                weg: "hand",
            },
        ]);
        expect(danach.zeile.revision).toBe(vorher.zeile.revision);
        expect(danach.zeile.zustand).toBe(vorher.zeile.zustand);
        expect(await protokoll("system.community_korrektur_verknuepft")).toEqual([
            { target_ref: nummer, details: { com: nummer, operation: kennung } },
        ]);
    });

    it("🔴 eine unbekannte Operation gibt 404, eine falsche Form 400; nichts wird verknüpft und nichts protokolliert", async () => {
        const nummer = await melde();
        expect(code(await korrektur(nummer, randomUUID()))).toBe("404 community_not_found");
        expect(code(await korrektur(nummer, "keine-kennung"))).toBe("400 validation_failed");
        expect(code(await korrektur(nummer, randomUUID().toUpperCase()))).toBe("400 validation_failed");
        expect(code(await korrektur("COM-999999", await speichern()))).toBe("404 community_not_found");
        expect(await zeilen(nummer)).toBe(0);
        expect(await protokoll("system.community_korrektur_verknuepft")).toEqual([]);
    });

    it("🔴 Herkunft aus dem Editor: eine Operation mit dem Vorgang als Herkunft steht im Detail (`editor`), neueste zuerst, ohne Doppelte", async () => {
        const nummer = await melde();
        const aelter = await speichern(olafAkteur, idVon(nummer));
        const handKennung = await speichern(lenaAkteur);
        const juenger = await speichern(olafAkteur, idVon(nummer));
        // Auch die eine, die der Editor schon mit dem Vorgang schrieb, darf jemand von Hand verknüpfen: sie bleibt eine Zeile, mit dem Weg `editor`.
        expect(code(await korrektur(nummer, aelter))).toBe("200");
        expect(code(await korrektur(nummer, handKennung))).toBe("200");
        // Eine Operation ohne Herkunft gehört nicht dazu.
        await speichern(olafAkteur);

        const d = await detail(nummer);
        expect(d.korrekturen?.map((k) => [k.operationId, k.weg])).toEqual([
            [juenger, "editor"],
            [handKennung, "hand"],
            [aelter, "editor"],
        ]);
        expect(d.korrekturen?.[1]?.von).toEqual({ id: lena.id, name: "Lena" });
    });

    it("🔴 ein Agent oder das System hinterlässt keinen Namen: `von` ist leer", async () => {
        const nummer = await melde();
        const kennung = await speichern({ kind: "system", label: "probe", environment: "test" });
        expect(code(await korrektur(nummer, kennung))).toBe("200");
        expect((await detail(nummer)).korrekturen?.[0]).toMatchObject({ operationId: kennung, von: null, weg: "hand" });
    });

    it("die Funktion prüft Art und Form selbst, auch ohne die Route davor", async () => {
        const nummer = await melde();
        const id = idVon(nummer);
        const rufe = (art: string, ziel: string) =>
            database`SELECT avesmaps_community.community_verknuepfen(${id}::bigint, ${olaf.id}::uuid, ${art}, ${ziel})`;
        await expect(rufe("ops", "OPS-12")).rejects.toMatchObject({ code: "KC422" });
        await expect(rufe("ops", "ops-000012")).rejects.toMatchObject({ code: "KC422" });
        await expect(rufe("dublette_von", "OPS-000012")).rejects.toMatchObject({ code: "KC422" });
        await expect(rufe("korrektur", "OPS-000012")).rejects.toMatchObject({ code: "KC422" });
        await expect(rufe("korrektur", randomUUID())).rejects.toMatchObject({ code: "KC404" });
        await expect(
            database`SELECT avesmaps_community.community_verknuepfen(999999999::bigint, ${olaf.id}::uuid, 'ops', 'OPS-000012')`,
        ).rejects.toMatchObject({ code: "KC404" });
        expect(await zeilen(nummer)).toBe(0);
    });

    // --- Kandidaten ----------------------------------------------------------------------------------------------------------

    it("🔴 Kandidaten am Bezugsobjekt: die letzten 15 Operationen an diesem Objekt, neueste zuerst; schon Verknüpfte fehlen", async () => {
        const nummer = await melde();
        const kennungen: string[] = [];
        for (let n = 0; n < 17; n += 1) kennungen.push(await speichern(n % 2 === 0 ? olafAkteur : lenaAkteur));
        // Eine Operation an einem ANDEREN Objekt gehört nicht dazu.
        const anderes = randomUUID();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${anderes}, 'aventuria', 'C7 Nachbar', 'dorf', ST_SetSRID(ST_MakePoint(700, 700), 0), ${SOURCE}, TRUE)
        `;
        const nachbar = op(900);
        await mapOperation(
            database,
            olafAkteur,
            { operationId: nachbar, operation: "place.update", mapDomainId: "aventuria", body: { name: "Nachbar" } },
            async (tx) => {
                await tx`UPDATE place SET name = 'Nachbar' WHERE public_id = ${anderes}::uuid`;
                return {
                    receipt: { affected: [], derivedWork: [], warnings: [] },
                    summary: "Nachbar umbenannt",
                    entries: [
                        {
                            action: "place.updated",
                            placeId: anderes,
                            changes: { name: { before: null, after: "Nachbar" } },
                        },
                    ],
                };
            },
        );

        const erste = await kandidaten(nummer);
        expect(erste.quelle).toBe("objekt");
        expect(erste.kandidaten).toHaveLength(15);
        expect(erste.kandidaten.map((k) => k.operationId)).toEqual([...kennungen].reverse().slice(0, 15));
        expect(erste.kandidaten.map((k) => k.operationId)).not.toContain(nachbar);
        expect(erste.kandidaten[0]).toMatchObject({ aktion: "place.update", zusammenfassung: "Umbenannt in Probe 17" });
        expect(erste.kandidaten[0]?.von).toEqual({ id: olaf.id, name: "Olaf" });

        // Die neueste verknüpfen: sie fehlt, dafür rückt die sechzehnte nach.
        expect(code(await korrektur(nummer, kennungen[16]!))).toBe("200");
        const zweite = await kandidaten(nummer);
        expect(zweite.kandidaten).toHaveLength(15);
        expect(zweite.kandidaten.map((k) => k.operationId)).toEqual([...kennungen].reverse().slice(1, 16));
    });

    it("🔴 Kandidaten ohne Objektbezug: die letzten eigenen Operationen der Sitzung, nie die einer anderen Person", async () => {
        const nummer = await meldeStelle();
        const meine = await speichern(olafAkteur);
        await speichern(lenaAkteur);
        const auchMeine = await speichern(olafAkteur);
        const olafs = await kandidaten(nummer);
        expect(olafs.quelle).toBe("sitzung");
        expect(olafs.kandidaten.map((k) => k.operationId)).toEqual([auchMeine, meine]);
        // Wer eine Operation nie geschrieben hat, sieht keine.
        expect((await kandidaten(nummer, adrian.cookie)).kandidaten).toEqual([]);
        // Ein Editor-Ergebnis des Vorgangs selbst steht schon als Korrektur da und wird nicht nochmals angeboten.
        const ausEditor = await speichern(olafAkteur, idVon(nummer));
        expect((await kandidaten(nummer)).kandidaten.map((k) => k.operationId)).not.toContain(ausEditor);
        expect((await detail(nummer)).korrekturen?.map((k) => k.operationId)).toEqual([ausEditor]);
    });

    it("Kandidaten eines Vorgangs, den es nicht gibt: 404", async () => {
        expect(code(await get("/api/community/vorgaenge/COM-999999/korrektur-kandidaten", olaf.cookie))).toBe(
            "404 community_not_found",
        );
    });

    // --- Betreiber-Kanal -----------------------------------------------------------------------------------------------------

    it("🔴 an den Betreiber-Kanal: Kanal-Vorgang und Verknüpfung entstehen zusammen, ohne ein Wort vom Melder; das Protokoll trägt nur Nummern", async () => {
        const nummer = await melde();
        const vorher = await detail(nummer);
        // Was der Server nicht kennt (Name, Adresse, Text des Melders, ein eigener Kontext), wird verworfen und kommt nie im Kanal an.
        const antwort = await anKanal(nummer, {
            kategorie: "bug",
            prioritaet: "hoch",
            titel: `${nummer} · Fehler`,
            nachricht: `Aus Community-Vorgang ${nummer}.`,
            name: MELDER_NAME,
            mail: MELDER_MAIL,
            text: MELDER_TEXT,
            kontext: { objekt: "Wehrheim" },
        });
        expect(code(antwort)).toBe("200");
        expect(Value.Check(AnKanalAntwort, antwort.json())).toBe(true);
        const { ops } = antwort.json() as { nummer: string; ops: string };
        expect(antwort.json()).toEqual({ nummer, ops });
        expect(ops).toMatch(/^OPS-\d{6}$/u);

        const [kanal] = await database<
            {
                environment: string;
                art: string;
                kategorie: string;
                prioritaet: string;
                titel: string | null;
                nachricht: string | null;
                schritte: string | null;
                kontext: Record<string, string>;
                gemeldet_von: string | null;
            }[]
        >`
            SELECT environment, art, kategorie, prioritaet, titel, nachricht, schritte, kontext, gemeldet_von::text FROM avesmaps_kanal.vorgang
             WHERE id = ${Number(ops.slice(4))}::bigint
        `;
        expect(kanal).toMatchObject({
            environment: "test",
            art: "meldung",
            kategorie: "bug",
            prioritaet: "hoch",
            titel: `${nummer} · Fehler`,
            nachricht: `Aus Community-Vorgang ${nummer}.`,
            gemeldet_von: olaf.id,
        });
        expect(kanal?.kontext).toEqual({
            umgebung: "test",
            release: "community-verknuepfen-test",
            anfrage: nummer,
        });
        // Nichts vom Melder ging mit: weder Name noch Text noch Quelle noch Lage.
        const alles = JSON.stringify(kanal);
        for (const verboten of [
            MELDER_NAME,
            MELDER_MAIL,
            "Alrike",
            MELDER_TEXT,
            "Regionalband",
            "Herz des Reiches",
            "Wehrheim",
        ])
            expect(alles, verboten).not.toContain(verboten);

        const nachher = await detail(nummer);
        expect(nachher.kanal).toEqual([{ nummer: ops }]);
        expect(nachher.zeile.revision).toBe(vorher.zeile.revision);
        expect(await zeilen(nummer)).toBe(1);
        const eintraege = await protokoll("system.community_an_kanal");
        expect(eintraege).toEqual([{ target_ref: nummer, details: { com: nummer, ops } }]);
        expect(JSON.stringify(eintraege)).not.toContain("Fehler");
    });

    it("🔴 dieselbe Kennung der Handlung legt nichts zweites an; eine neue Kennung reicht nochmals weiter", async () => {
        const nummer = await melde();
        const operationId = randomUUID();
        const erste = await anKanal(nummer, { operationId });
        const zweite = await anKanal(nummer, { operationId });
        expect(code(erste)).toBe("200");
        expect(code(zweite)).toBe("200");
        expect(zweite.json()).toEqual(erste.json());
        const zahl = async () =>
            (
                await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM avesmaps_kanal.vorgang WHERE gemeldet_von = ${olaf.id}::uuid
                `
            )[0]!.n;
        expect(await zahl()).toBe(1);
        expect(await zeilen(nummer)).toBe(1);
        expect(await protokoll("system.community_an_kanal")).toHaveLength(1);

        const dritte = await anKanal(nummer);
        expect(code(dritte)).toBe("200");
        expect((dritte.json() as { ops: string }).ops).not.toBe((erste.json() as { ops: string }).ops);
        expect(await zahl()).toBe(2);
        expect((await detail(nummer)).kanal).toHaveLength(2);
    });

    it("🔴 ohne `use_operator_channel` gibt es 403, und nichts entsteht: Reviewer und Admin dürfen den Kanal nicht benutzen", async () => {
        const nummer = await melde();
        for (const person of [lena, adrian]) {
            expect(code(await anKanal(nummer, {}, person.cookie)), person.id).toBe("403 community_forbidden");
        }
        expect(code(await post(`/api/community/vorgaenge/${nummer}/an-kanal`, {}, olaf.cookie))).toBe(
            "400 validation_failed",
        );
        expect(code(await anKanal(nummer, { kategorie: "unbekannt" }))).toBe("400 validation_failed");
        expect(code(await anKanal(nummer, { titel: "" }))).toBe("400 validation_failed");
        expect(code(await anKanal(nummer, { titel: "x".repeat(121) }))).toBe("400 validation_failed");
        const [kanal] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM avesmaps_kanal.vorgang WHERE gemeldet_von = ANY(${alle}::uuid[])`;
        expect(kanal?.n).toBe(0);
        expect(await zeilen(nummer)).toBe(0);
        expect(await protokoll("system.community_an_kanal")).toEqual([]);
    });

    it("an einen Vorgang, den es nicht gibt, reicht der Kanal nichts weiter: 404, und der Kanal-Vorgang entsteht nicht", async () => {
        expect(code(await anKanal("COM-999999"))).toBe("404 community_not_found");
        const [kanal] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM avesmaps_kanal.vorgang WHERE gemeldet_von = ANY(${alle}::uuid[])`;
        expect(kanal?.n).toBe(0);
    });

    it("🔴 die Grenze des Kanals gilt auch hier: 20 Vorgänge je Person und Stunde; eine Wiederholung zählt nicht dazu", async () => {
        const nummer = await melde();
        const letzte = randomUUID();
        for (let n = 0; n < 19; n += 1) expect(code(await anKanal(nummer))).toBe("200");
        expect(code(await anKanal(nummer, { operationId: letzte }))).toBe("200");
        expect(code(await anKanal(nummer))).toBe("429 community_rate");
        // Die Wiederholung der zwanzigsten ist keine neue Handlung.
        expect(code(await anKanal(nummer, { operationId: letzte }))).toBe("200");
    });

    // --- Anfragen und Anmeldung ------------------------------------------------------------------------------------------------

    it("🔴 Anfragen nur mit `read_mailbox`: ohne das Recht gibt es 403 auf Kandidaten, Korrektur und Kanal; ohne Anmeldung 401", async () => {
        const antwort = await postOeffentlich("/api/community/anfragen", kontakt());
        expect(code(antwort)).toBe("201");
        const nummer = (antwort.json() as { nummer: string }).nummer;
        const kennung = await speichern();
        for (const cookie of [lena.cookie, adrian.cookie]) {
            expect(code(await get(`/api/community/vorgaenge/${nummer}/korrektur-kandidaten`, cookie))).toBe(
                "403 community_forbidden",
            );
            expect(code(await korrektur(nummer, kennung, cookie))).toBe("403 community_forbidden");
            expect(code(await anKanal(nummer, {}, cookie))).toBe("403 community_forbidden");
        }
        expect(await zeilen(nummer)).toBe(0);
        // Mit dem Recht geht es, und der Kanal bekommt weder Name noch Adresse der Anfrage.
        expect(code(await korrektur(nummer, kennung))).toBe("200");
        const weiter = await anKanal(nummer);
        expect(code(weiter)).toBe("200");
        const [kanal] = await database<{ alles: string }[]>`
            SELECT to_jsonb(v)::text AS alles FROM avesmaps_kanal.vorgang v WHERE v.id = ${Number((weiter.json() as { ops: string }).ops.slice(4))}::bigint
        `;
        for (const verboten of [MELDER_NAME, MELDER_MAIL, "Spielleiterhandbuch"])
            expect(kanal?.alles, verboten).not.toContain(verboten);

        expect(code(await get(`/api/community/vorgaenge/${nummer}/korrektur-kandidaten`))).toBe("401 unauthenticated");
        expect(
            code(
                await app.inject({
                    method: "POST",
                    url: `/api/community/vorgaenge/${nummer}/korrektur`,
                    payload: {},
                    headers: { origin: TEST_ORIGIN },
                }),
            ),
        ).toBe("401 unauthenticated");
    });

    it("🔴 ein Reviewer darf Korrekturen lesen und verknüpfen (`moderate_submissions`), nicht den Kanal", async () => {
        const nummer = await melde();
        const kennung = await speichern(lenaAkteur);
        expect((await kandidaten(nummer, lena.cookie)).kandidaten.map((k) => k.operationId)).toEqual([kennung]);
        expect(code(await korrektur(nummer, kennung, lena.cookie))).toBe("200");
        expect((await detail(nummer, lena.cookie)).korrekturen?.map((k) => k.operationId)).toEqual([kennung]);
    });
});
