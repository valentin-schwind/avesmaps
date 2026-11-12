import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    KanalBerichte,
    KanalListe,
    KanalVorgang,
    KanalZaehler,
    fortschrittDerZeile,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { aenderung, beobachtung, nachpruefen, nachweis, opsId, status } from "../src/kanal/db.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Routen des Betreiber-Kanals (WI-0124, KANAL-0001 §4.2) gegen echtes PostgreSQL.
 *
 * - 🔴 Nur `use_operator_channel` (Rolle Betreiber, Stufe V): Admin und Editor 403, ohne zweiten Faktor 403, ohne Anmeldung 401.
 * - Melden: Kontext nur aus der Positivliste, Umgebung und Release setzt der Server; ein fremdes Feld kommt nicht an.
 * - 🔴 Abnehmen mit der aktuellen Revision (sonst 409 `kanal_conflict`), auch durch einen anderen Betreiber (Entscheidung 17 A); wieder
 *   öffnen führt zurück auf „in Arbeit“ in Runde 2.
 * - 🔴 „Meldung jetzt löschen“ nur an abgenommenen (sonst 409 `kanal_transition`), danach der Rest; genau ein Protokolleintrag mit nur der
 *   OPS-ID; dieselbe Handlung noch einmal ist eine Wiederholung. „Bild entfernen“ ebenso.
 * - 🔴 „Fix-Berichte“ (`GET /api/kanal/aenderungen`): nur Betreiber, neueste oben, auch ohne Vorgang (mit Grund), blättern mit `vor`; der
 *   Bericht überlebt „Meldung jetzt löschen“ (dauerhaft, §3.1).
 * - Grenzen: der 21. Vorgang einer Person in einer Stunde 429 `kanal_rate`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SHA = "b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621";

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "kanal-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Betreiber-Kanal: Routen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let rondrikan: { id: string; cookie: string };
    let thomas: { id: string; cookie: string };
    let admin: { cookie: string };
    let editor: { cookie: string };
    let ohneFaktor: { cookie: string };

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_kanal.beobachtung`;
        await database`DELETE FROM avesmaps_kanal.aenderung`;
        await database`DELETE FROM avesmaps_kanal.nachweis`;
        await database`DELETE FROM avesmaps_kanal.bild`;
        await database`DELETE FROM avesmaps_kanal.eintrag`;
        await database`UPDATE avesmaps_kanal.vorgang SET folgt_auf = NULL`;
        await database`DELETE FROM avesmaps_kanal.vorgang`;
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
        const person = async (role: Role, name: string, assurance: "strong" | "basic" = "strong") => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, {
                assurance,
                passkeyMinutesAgo: assurance === "strong" ? 60 : null,
            });
            return { ...created, cookie };
        };
        rondrikan = await person("operator", "Rondrikan");
        thomas = await person("operator", "Thomas");
        admin = await person("admin", "Admina");
        editor = await person("editor", "Editha");
        ohneFaktor = await person("operator", "Ohne Faktor", "basic");
    });

    beforeEach(leeren);

    afterAll(async () => {
        await app?.close();
        await leeren().catch(() => undefined);
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.kanal_%'`.catch(
            () => undefined,
        );
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const get = (url: string, cookie = rondrikan.cookie) => app.inject({ method: "GET", url, headers: { cookie } });
    const post = (url: string, payload: Record<string, unknown>, cookie = rondrikan.cookie) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const melde = async (patch: Record<string, unknown> = {}, cookie = rondrikan.cookie): Promise<string> => {
        const antwort = await post(
            "/api/kanal/vorgaenge",
            {
                operationId: randomUUID(),
                kategorie: "bug",
                prioritaet: "hoch",
                titel: "See-321 wird sichtbar",
                nachricht: "Im Infopanel steht See-321.",
                kontext: { ansicht: "Standard, Zoom 6,00, bei Gareth", geraet: "Rechner · Firefox 131" },
                ...patch,
            },
            cookie,
        );
        expect(code(antwort)).toBe("200");
        return (antwort.json() as { affected: { id: string }[] }).affected[0]!.id;
    };
    const vorgang = async (ops: string, cookie = rondrikan.cookie): Promise<KanalVorgang> => {
        const antwort = await get(`/api/kanal/vorgaenge/${ops}`, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as KanalVorgang;
        expect(Value.Check(KanalVorgang, body)).toBe(true);
        return body;
    };
    const zurAbnahme = async (ops: string): Promise<number> => {
        const id = Number(ops.slice(4));
        await status(database, id, "in_arbeit", { als: "claudio" });
        await aenderung(
            database,
            { vorgang: id, klasse: "A", art: "code", was: "Infopanel ohne technischen Titel", commit: SHA },
            { als: "claudio" },
        );
        await nachweis(database, id, "fix_committed", { commit: SHA, als: "claudio" });
        await nachweis(database, id, "auf_stage", { release: "r1", als: "claudio" });
        await status(database, id, "auf_stage", { als: "claudio" });
        return status(database, id, "zur_abnahme", {
            als: "claudio",
            kurztitel: "Platzhaltername See-321 im Infopanel sichtbar",
        });
    };

    it("🔴 nur Betreiber mit zweitem Faktor; Admin und Editor 403, ohne Anmeldung 401", async () => {
        expect(code(await get("/api/kanal/vorgaenge", admin.cookie))).toBe("403 forbidden");
        expect(code(await get("/api/kanal/vorgaenge", editor.cookie))).toBe("403 forbidden");
        expect(code(await get("/api/kanal/vorgaenge", ohneFaktor.cookie))).toMatch(/^403 /u);
        expect((await app.inject({ method: "GET", url: "/api/kanal/zaehler" })).statusCode).toBe(401);
        expect(code(await post("/api/kanal/vorgaenge", { operationId: randomUUID() }, admin.cookie))).toMatch(
            /^4\d\d /u,
        );
    });

    it("melden: Kontext aus der Positivliste plus Umgebung und Release; fremde Felder kommen nicht an; Liste und Zähler", async () => {
        const ops = await melde();
        const v = await vorgang(ops);
        expect(v).toMatchObject({
            ops,
            status: "neu",
            zustaendig: "claudio",
            titel: "See-321 wird sichtbar",
            gemeldetVon: { name: "Rondrikan" },
        });
        expect(v.kontext).toEqual({
            umgebung: "test",
            release: "kanal-test",
            ansicht: "Standard, Zoom 6,00, bei Gareth",
            geraet: "Rechner · Firefox 131",
        });
        const fremd = await post("/api/kanal/vorgaenge", {
            operationId: randomUUID(),
            kategorie: "bug",
            prioritaet: "hoch",
            titel: "x",
            nachricht: "y",
            kontext: { passwort: "geheim" },
        });
        // Fastify entfernt unbekannte Felder (removeAdditional): Nichts davon kommt an.
        expect(fremd.statusCode).toBe(200);
        const fremdOps = (fremd.json() as { affected: { id: string }[] }).affected[0]!.id;
        expect(Object.keys((await vorgang(fremdOps)).kontext).sort()).toEqual(["release", "umgebung"]);
        const liste = (await get("/api/kanal/vorgaenge")).json() as KanalListe;
        expect(Value.Check(KanalListe, liste)).toBe(true);
        expect(liste.zeilen.map((z) => z.ops)).toEqual([ops, fremdOps]);
        expect(liste.zaehler).toEqual({ offen: 2, abnahme: 0, archiv: 0 });
        const zaehlerAntwort = (await get("/api/kanal/zaehler")).json() as KanalZaehler;
        expect(Value.Check(KanalZaehler, zaehlerAntwort)).toBe(true);
        expect(zaehlerAntwort.abnahme).toBe(0);
        // Wann die Routinen zuletzt abholten, auch hier: Ein direkt geöffneter Vorgang sagt sonst nichts darüber.
        expect(Object.keys(zaehlerAntwort.zuletztAbgeholt).sort()).toEqual(["claudia", "claudio"]);
        expect(code(await get("/api/kanal/vorgaenge/OPS-999999"))).toBe("404 kanal_not_found");
    });

    it("🔴 Suche q: OPS-Nummer, Titel, Meldung und Verlauf im Server; % ist ein Zeichen; die Zähler bleiben die Summen", async () => {
        // Betreiber 2026-10-11 (Entscheidungsprotokoll 3f7acfc8): eine Freitextsuche in jeder Leiste. Der Text der Meldung steht nicht in
        // der Liste, deshalb sucht der Server.
        const kacheln = await melde({ titel: "Kacheln fehlen bei Gareth", nachricht: "Seit dem Neuladen 100% grau." });
        const see = await melde({ titel: "See-321 wird sichtbar", nachricht: "Im Infopanel steht See-321." });
        expect(
            code(
                await post(`/api/kanal/vorgaenge/${see}/nachricht`, {
                    operationId: randomUUID(),
                    text: "Auch in Punin.",
                }),
            ),
        ).toBe("200");
        const suche = async (q: string): Promise<KanalListe> => {
            const antwort = await get(`/api/kanal/vorgaenge?q=${encodeURIComponent(q)}`);
            expect(code(antwort)).toBe("200");
            return antwort.json() as KanalListe;
        };
        const treffer = async (q: string): Promise<string[]> => (await suche(q)).zeilen.map((z) => z.ops);
        expect(await treffer("gareth")).toEqual([kacheln]);
        expect(await treffer(see)).toEqual([see]);
        expect(await treffer(see.slice(4))).toEqual([see]);
        expect(await treffer("infopanel steht")).toEqual([see]);
        expect(await treffer("punin")).toEqual([see]);
        expect(await treffer("100% grau")).toEqual([kacheln]);
        expect(await treffer("100%grau")).toEqual([]);
        expect(await treffer("niemand schreibt das")).toEqual([]);
        expect((await suche("punin")).zaehler.offen).toBe(2);
    });

    it("🔴 abnehmen mit aktueller Revision, auch durch einen anderen Betreiber; wieder öffnen führt in Runde 2", async () => {
        const ops = await melde();
        const revision = await zurAbnahme(ops);
        expect((await get("/api/kanal/zaehler")).json()).toMatchObject({ abnahme: 1 });
        expect(
            code(
                await post(`/api/kanal/vorgaenge/${ops}/abnehmen`, {
                    operationId: randomUUID(),
                    baseRevision: revision - 1,
                }),
            ),
        ).toBe("409 kanal_conflict");
        expect(
            code(
                await post(`/api/kanal/vorgaenge/${ops}/wieder-oeffnen`, {
                    operationId: randomUUID(),
                    baseRevision: revision,
                    kommentar: "Noch nicht gelöst.",
                }),
            ),
        ).toBe("200");
        const zwei = await vorgang(ops);
        expect(zwei).toMatchObject({ status: "in_arbeit", runde: 2, nachweise: 0 });
        // WI-0162: Die Zeile der Liste trägt die Fix-Berichte der laufenden Runde, damit die vier Punkte denselben Weg
        // zeigen wie die Leiste im Vorgang. Nach dem Wiederöffnen ist die Runde leer, also zählt der Status.
        const zeileZwei = ((await get("/api/kanal/vorgaenge")).json() as KanalListe).zeilen.find((z) => z.ops === ops);
        expect(zeileZwei).toMatchObject({ nachweise: 0, aenderungen: 0 });
        expect(fortschrittDerZeile(zeileZwei!)).toEqual({ weg: "status", erreicht: 2, von: 4 });
        expect(zwei.alleNachweise.map((n) => `${String(n.runde)}:${n.station}`)).toEqual([
            "1:fix_committed",
            "1:auf_stage",
        ]);
        const id = Number(ops.slice(4));
        await status(database, id, "beantwortet", { als: "claudio", text: "Am Telefon war der Zwischenspeicher alt." });
        const neue = await status(database, id, "zur_abnahme", { als: "claudio" });
        const abgenommen = await post(
            `/api/kanal/vorgaenge/${ops}/abnehmen`,
            { operationId: randomUUID(), baseRevision: neue },
            thomas.cookie,
        );
        expect(code(abgenommen)).toBe("200");
        const fertig = await vorgang(ops);
        expect(fertig).toMatchObject({ status: "abgenommen", abgenommenVon: { name: "Thomas" } });
        expect(fertig.aufbewahrtBis).not.toBeNull();
        const archiv = (await get("/api/kanal/vorgaenge?reiter=archiv")).json() as KanalListe;
        expect(archiv.zeilen.map((z) => z.ops)).toEqual([ops]);
        // Nach der Abnahme keine Nachricht mehr.
        expect(
            code(await post(`/api/kanal/vorgaenge/${ops}/nachricht`, { operationId: randomUUID(), text: "noch was" })),
        ).toBe("409 kanal_transition");
    });

    it("🔴 der Betreiber schließt selbst ab: erledigt ohne Agenten, abbrechen nur mit Begründung, danach löschen", async () => {
        const ops = await melde();
        const offen = await vorgang(ops);
        expect(offen.abschluss).toBeNull();

        // Ohne Begründung weist die Datenbank das Abbrechen ab, der Vorgang bleibt offen.
        expect(
            code(
                await post(`/api/kanal/vorgaenge/${ops}/abschliessen`, {
                    operationId: randomUUID(),
                    baseRevision: offen.revision,
                    art: "abgebrochen",
                }),
            ),
        ).toBe("422 kanal_invalid");
        expect((await vorgang(ops)).status).toBe(offen.status);

        // Erledigt braucht keine: ein Klick, aus dem offenen Status, ohne Kurztitel und ohne zur_abnahme.
        expect(
            code(
                await post(
                    `/api/kanal/vorgaenge/${ops}/abschliessen`,
                    { operationId: randomUUID(), baseRevision: offen.revision, art: "erledigt" },
                    thomas.cookie,
                ),
            ),
        ).toBe("200");
        const zu = await vorgang(ops);
        expect(zu).toMatchObject({
            status: "abgenommen",
            abschluss: "erledigt",
            abgenommenVon: { name: "Thomas" },
        });
        expect(zu.alleNachweise.map((n) => n.station)).toEqual(["betreiber_abnahme"]);
        expect(((await get("/api/kanal/vorgaenge?reiter=archiv")).json() as KanalListe).zeilen[0]).toMatchObject({
            ops,
            abschluss: "erledigt",
        });
        // Löschen hängt am Zustand, nicht am Weg dorthin.
        expect(code(await post(`/api/kanal/vorgaenge/${ops}/loeschen`, { operationId: randomUUID() }))).toBe("200");

        // Ein abgebrochener Vorgang trägt seine Begründung im Verlauf.
        const zweiter = await melde();
        const stand = await vorgang(zweiter);
        expect(
            code(
                await post(`/api/kanal/vorgaenge/${zweiter}/abschliessen`, {
                    operationId: randomUUID(),
                    baseRevision: stand.revision,
                    art: "abgebrochen",
                    begruendung: "Doppelmeldung, siehe den anderen Vorgang.",
                }),
            ),
        ).toBe("200");
        const weg = await vorgang(zweiter);
        expect(weg.abschluss).toBe("abgebrochen");
        expect(weg.eintraege.at(-1)).toMatchObject({ art: "status", statusNach: "abgenommen" });
        expect(weg.eintraege.at(-1)?.text).toBe("Doppelmeldung, siehe den anderen Vorgang.");
    });

    it("🔴 „Meldung jetzt löschen“: nur abgenommen; genau ein Protokolleintrag mit nur der OPS-ID; Wiederholung ohne zweiten", async () => {
        const ops = await melde();
        expect(code(await post(`/api/kanal/vorgaenge/${ops}/loeschen`, { operationId: randomUUID() }))).toBe(
            "409 kanal_transition",
        );
        const revision = await zurAbnahme(ops);
        expect(
            code(
                await post(`/api/kanal/vorgaenge/${ops}/abnehmen`, {
                    operationId: randomUUID(),
                    baseRevision: revision,
                }),
            ),
        ).toBe("200");
        const operationId = randomUUID();
        expect(code(await post(`/api/kanal/vorgaenge/${ops}/loeschen`, { operationId }))).toBe("200");
        const wieder = await post(`/api/kanal/vorgaenge/${ops}/loeschen`, { operationId });
        expect((wieder.json() as { status: string }).status).toBe("replayed");
        const rest = await vorgang(ops);
        expect(rest).toMatchObject({
            titel: null,
            nachricht: null,
            gemeldetVon: null,
            vonHandGeloescht: true,
            kurztitel: "Platzhaltername See-321 im Infopanel sichtbar",
        });
        expect(rest.eintraege).toEqual([]);
        expect(rest.aenderungen).toHaveLength(1);
        const events = await database<{ details: Record<string, unknown>; target_ref: string }[]>`
            SELECT details, target_ref FROM avesmaps_auth.security_event WHERE action = 'system.kanal_purged' AND operation_id = ${operationId}
        `;
        expect(events).toEqual([{ details: { ops }, target_ref: ops }]);
    });

    it("🔴 Fix-Berichte: nur Betreiber, neueste oben, ohne Vorgang mit Grund, blättern mit `vor`; sie überleben das Löschen der Meldung", async () => {
        expect(code(await get("/api/kanal/aenderungen", admin.cookie))).toBe("403 forbidden");
        const ops = await melde();
        await zurAbnahme(ops);
        const [mitVorgang] = await database<{ id: string }[]>`SELECT id::text FROM avesmaps_kanal.aenderung`;
        await beobachtung(
            database,
            Number(mitVorgang!.id),
            "fallback",
            "42 Platzhalter griffen auf den Kartennamen zurück",
            { als: "claudio" },
        );
        await nachpruefen(database, Number(mitVorgang!.id), "ok", undefined, { als: "claudia" });
        const ohne = await aenderung(
            database,
            { klasse: "A", art: "betrieb", was: "Dienst neu gestartet nach Speicherspitze", grund: "Routine" },
            { als: "claudio" },
        );

        const antwort = await get("/api/kanal/aenderungen");
        expect(code(antwort)).toBe("200");
        const liste = antwort.json() as KanalBerichte;
        expect(Value.Check(KanalBerichte, liste)).toBe(true);
        expect(liste.weiter).toBeNull();
        expect(liste.berichte.map((b) => [b.ops, b.grund, b.was])).toEqual([
            [null, "Routine", "Dienst neu gestartet nach Speicherspitze"],
            [ops, null, "Infopanel ohne technischen Titel"],
        ]);
        expect(liste.berichte[1]).toMatchObject({
            agent: "claudio",
            klasse: "A",
            art: "code",
            commit: SHA,
            runde: 1,
            nachpruefung: "ok",
            beobachtungen: [{ ergebnis: "fallback", text: "42 Platzhalter griffen auf den Kartennamen zurück" }],
        });
        const aelter = (await get(`/api/kanal/aenderungen?vor=${String(ohne)}`).then((r) => r.json())) as KanalBerichte;
        expect(aelter.berichte.map((b) => b.ops)).toEqual([ops]);
        // Die Suche im Protokoll (Betreiber 2026-10-11): was, Grund, Commit und OPS-Nummer, im Server.
        const suche = async (q: string): Promise<(string | null)[]> =>
            (
                (await get(`/api/kanal/aenderungen?q=${encodeURIComponent(q)}`).then((r) => r.json())) as KanalBerichte
            ).berichte.map((b) => b.ops);
        expect(await suche("speicherspitze")).toEqual([null]);
        expect(await suche("routine")).toEqual([null]);
        expect(await suche(SHA.slice(0, 7))).toEqual([ops]);
        expect(await suche(ops)).toEqual([ops]);
        expect(await suche("nichts dergleichen")).toEqual([]);

        // Abnehmen und die Meldung löschen: Der Fix-Bericht bleibt, mit seiner OPS-ID.
        // Die Nachprüfung zählt die Revision weiter; abgenommen wird der Stand von jetzt.
        const { revision } = await vorgang(ops);
        expect(
            code(
                await post(`/api/kanal/vorgaenge/${ops}/abnehmen`, {
                    operationId: randomUUID(),
                    baseRevision: revision,
                }),
            ),
        ).toBe("200");
        expect(code(await post(`/api/kanal/vorgaenge/${ops}/loeschen`, { operationId: randomUUID() }))).toBe("200");
        const danach = (await get("/api/kanal/aenderungen").then((r) => r.json())) as KanalBerichte;
        expect(danach.berichte.map((b) => b.ops)).toEqual([null, ops]);
    });

    it("„Bild entfernen“: jederzeit, ein Protokolleintrag ohne Inhalt; im Verlauf bleibt „Bild entfernt“", async () => {
        const ops = await melde();
        const bild = randomUUID();
        await database`
            SELECT avesmaps_kanal.kanal_bild_anlegen(${randomUUID()}::uuid, ${Number(ops.slice(4))}::bigint, ${rondrikan.id}::uuid, ${bild}::uuid,
                                                     ${"c".repeat(64)}, 'png', 1280, 900, 4567)
        `;
        expect((await vorgang(ops)).bilder.map((b) => b.id)).toEqual([bild]);
        const operationId = randomUUID();
        expect(code(await post(`/api/kanal/bilder/${bild}/entfernen`, { operationId }))).toBe("200");
        const v = await vorgang(ops);
        expect(v.bilder).toEqual([]);
        expect(v.eintraege.map((e) => e.art)).toEqual(["bild", "bild_entfernt"]);
        const [event] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.kanal_image_removed' AND operation_id = ${operationId}
        `;
        expect(event?.details).toEqual({ ops });
        expect(code(await post(`/api/kanal/bilder/${randomUUID()}/entfernen`, { operationId: randomUUID() }))).toBe(
            "404 kanal_not_found",
        );
    });

    it("Grenze: der 21. Vorgang einer Person in einer Stunde 429 kanal_rate", async () => {
        for (let i = 0; i < 20; i += 1) {
            await database`
                SELECT avesmaps_kanal.kanal_melden(${randomUUID()}::uuid, 'test', ${rondrikan.id}::uuid, 'idee', 'niedrig', ${`Idee ${String(i)}`},
                                                   'Text', NULL, '{}'::jsonb, NULL)
            `;
        }
        const antwort = await post("/api/kanal/vorgaenge", {
            operationId: randomUUID(),
            kategorie: "idee",
            prioritaet: "niedrig",
            titel: "zu viel",
            nachricht: "Text",
        });
        expect(code(antwort)).toBe("429 kanal_rate");
        expect(opsId(1)).toBe("OPS-000001");
    });
});
