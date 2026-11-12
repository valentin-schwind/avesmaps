import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SocialDetail, SocialListe, SocialQuittung, pruefeBeitrag, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { communityBeitragAufbewahrung, communitySocialFreigabe } from "../src/community/aufbewahrung.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Der Social Hub im Community-Modul (WI-0270 C11, Fachkonzept §15) gegen echtes PostgreSQL.
 *
 * - 🔴 **Vorlegen und Freigeben:** Ein Editor mit `social_communication` verfasst und legt vor, mehr nicht. Freigeben, zurücknehmen und zurückgeben nur mit `manage_news`;
 *   ein Betreiber gibt den EIGENEN Beitrag allein frei (E10, Vermerk im Verlauf), einen fremden Entwurf nicht.
 * - 🔴 **Ein Speicher:** Die Freigabe schreibt GENAU EINEN Eintrag in `public.news_entry` (Verweis `beitrag_id`); Zurücknehmen versteckt ihn, Ändern ändert ihn,
 *   erneut senden macht keinen zweiten. `GET /api/news` zeigt, was die Besucher sehen.
 * - 🔴 **Eine Zählung:** Der Server zählt mit dem Modul des Fensters nach und weist Zu-Langes ab, auch wenn das Fenster es durchließe; ein Kanal ohne Verbindung
 *   und ein Bild ohne Beschreibung oder mit ungeklärten Rechten sperren das Vorlegen.
 * - 🔴 **Die Routine:** `news_add` behält seine Signatur und legt den Vorschlag als Beitrag an (Notbremse: ein Lauf je Tag und Kanal, höchstens drei; Vali 2026-10-31 „A: Alle aus dem Lauf“); die Frischeprüfung lässt ihn
 *   nach sieben Tagen verfallen; die Systemsteuerung der Neuigkeiten zieht den Beitrag nach.
 * - 🔴 **Protokoll ohne Text:** `system.social_*` trägt SOC-Nummer und Kanal, nie Titel, Text oder Hashtags.
 * Die Rechte der App-Rolle wie auf dem VPS prüft `community-grants.test.ts`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "social-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

interface Quittung {
    id: number;
    nr: string;
    revision: number;
    zustand: "entwurf" | "vorgelegt" | "veroeffentlicht";
}

describeWithDatabase("Social Hub: Routen und Datenbank (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let edda: { id: string; cookie: string };
    let emil: { id: string; cookie: string };
    let betreiber: { id: string; cookie: string };
    let zweiterBetreiber: { id: string; cookie: string };
    let lena: { id: string; cookie: string };
    let umgebung: string;
    /**
     * 🪤 Die Glocke geht an ALLE aktiven Betreiber der Umgebung (`community_bearbeitende`), auch an die, die ein früher abgebrochener Lauf oder eine andere Testdatei in der
     * gemeinsamen Testdatenbank stehen ließ. Geprüft werden darum nur die Meldungen an die Personen dieser Datei.
     */
    let meine: string[];

    async function leeren(): Promise<void> {
        await database`DELETE FROM avesmaps_community.beitrag`;
        await database`DELETE FROM public.news_entry`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.social_%'`;
        await database`DELETE FROM public.benachrichtigung WHERE art = 'social_freigabe'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        umgebung = TEST_AUTH.environment ?? "local";
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        edda = await person("editor", "Edda");
        emil = await person("editor", "Emil");
        betreiber = await person("operator", "Rondrikan");
        zweiterBetreiber = await person("operator", "Thomas");
        lena = await person("reviewer", "Lena");
        meine = [edda, emil, betreiber, zweiterBetreiber, lena].map((p) => p.id);
    });

    beforeEach(leeren);

    afterAll(async () => {
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const get = (url: string, cookie?: string) =>
        app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    const inhalt = (patch: Record<string, unknown> = {}) => ({
        titel: "Die Reichsstraße ist da",
        text: "Die Reichsstraße von Gareth nach Wehrheim steht jetzt auf der Karte.",
        hashtags: ["Aventurien", "Karte"],
        rubrik: "karte",
        ki: false,
        kanaele: ["neuigkeiten"],
        ...patch,
    });
    /** Legt einen Beitrag an und gibt seine Quittung zurück. */
    const anlegen = async (cookie: string, patch: Record<string, unknown> = {}): Promise<Quittung> => {
        const antwort = await post("/api/community/social", { operationId: randomUUID(), ...inhalt(patch) }, cookie);
        expect(code(antwort)).toBe("201");
        expect(Value.Check(SocialQuittung, antwort.json())).toBe(true);
        return antwort.json() as Quittung;
    };
    const schritt = (id: number, was: string, revision: number, cookie: string, extra: Record<string, unknown> = {}) =>
        post(
            `/api/community/social/${String(id)}/${was}`,
            { operationId: randomUUID(), baseRevision: revision, ...extra },
            cookie,
        );
    /** Ein Schritt, der gelingen muss; gibt die neue Quittung zurück. */
    const tu = async (
        id: number,
        was: string,
        revision: number,
        cookie: string,
        extra: Record<string, unknown> = {},
    ): Promise<Quittung> => {
        const antwort = await schritt(id, was, revision, cookie, extra);
        expect(code(antwort)).toBe("200");
        return antwort.json() as Quittung;
    };
    const detail = async (id: number, cookie = betreiber.cookie) => {
        const antwort = await get(`/api/community/social/${String(id)}`, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as SocialDetail;
        expect(Value.Check(SocialDetail, body)).toBe(true);
        return body;
    };
    const neuigkeiten = (beitrag: number) =>
        database<
            {
                id: string;
                titel: string;
                text: string;
                rubrik: string;
                zustand: string;
                geloescht: boolean;
                herkunft: string;
            }[]
        >`
            SELECT id::text, titel, text, rubrik, zustand, geloescht_at IS NOT NULL AS geloescht, herkunft
              FROM public.news_entry WHERE beitrag_id = ${beitrag}
        `;
    const alleNeuigkeiten = async (): Promise<number> =>
        (await database<{ n: number }[]>`SELECT count(*)::int AS n FROM public.news_entry`)[0]!.n;
    const oeffentlich = async (): Promise<string[]> => {
        const antwort = await get("/api/news");
        return (antwort.json() as { eintraege: { titel: string }[] }).eintraege.map((eintrag) => eintrag.titel);
    };
    const protokoll = (action: string) =>
        database<{ target_ref: string | null; details: Record<string, unknown> }[]>`
            SELECT target_ref, details FROM avesmaps_auth.security_event WHERE action = ${action} ORDER BY id
        `;
    const ereignisse = async (id: number): Promise<{ art: string; text: string | null }[]> =>
        (await detail(id)).verlauf.map((e) => ({ art: e.art, text: e.text }));

    /** Ein Medium im Medienkern: `klaerung` bestimmt, ob die Rechte geklärt sind. */
    async function medium(klaerung: string): Promise<string> {
        const [asset] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO public.media_asset (media_kind, origin, source_system, title)
            VALUES ('image', 'editor_upload', 'test', 'Karte der Reichsstraße') RETURNING id::text, public_id::text
        `;
        await database`
            INSERT INTO public.media_rights (media_asset_id, rights_basis, clearance_state)
            VALUES (${asset!.id}::bigint, 'own_work', ${klaerung})
        `;
        return asset!.public_id;
    }

    describe("Rechte: wer was darf", () => {
        it("🔴 ohne social_communication gibt es weder Liste noch Fenster noch Schreiben; ohne Anmeldung 401", async () => {
            expect(code(await get("/api/community/social"))).toBe("401 unauthenticated");
            expect(code(await get("/api/community/social", lena.cookie))).toBe("403 forbidden");
            expect(code(await get("/api/community/social/1", lena.cookie))).toBe("403 forbidden");
            const antwort = await post(
                "/api/community/social",
                { operationId: randomUUID(), ...inhalt() },
                lena.cookie,
            );
            expect(code(antwort)).toBe("403 forbidden");
            expect((await database`SELECT 1 FROM avesmaps_community.beitrag`).length).toBe(0);
        });

        it("🔴 ein Editor kann nur vorlegen: freigeben, zurücknehmen, zurückgeben, erneut senden und Änderung veröffentlichen sind ihm verwehrt", async () => {
            const b = await anlegen(edda.cookie);
            const vorgelegt = await tu(b.id, "vorlegen", b.revision, edda.cookie);
            expect(vorgelegt.zustand).toBe("vorgelegt");
            for (const was of ["freigeben", "zurueckgeben", "zuruecknehmen", "aenderung"]) {
                expect(code(await schritt(b.id, was, vorgelegt.revision, edda.cookie)), was).toBe("403 forbidden");
            }
            expect(code(await schritt(b.id, "erneut", vorgelegt.revision, edda.cookie, { kanal: "neuigkeiten" }))).toBe(
                "403 forbidden",
            );
            expect((await detail(b.id)).zeile.zustand).toBe("vorgelegt");
            expect(await alleNeuigkeiten()).toBe(0);
        });

        it("ein vorgelegter Beitrag ändert nur, wer ihn freigibt; ein fremder Entwurf gehört dem Verfasser", async () => {
            const b = await anlegen(edda.cookie);
            // Emil ändert, legt vor, verwirft Eddas Entwurf nicht.
            for (const was of ["aendern", "vorlegen", "papierkorb"]) {
                const antwort =
                    was === "aendern"
                        ? await post(
                              `/api/community/social/${String(b.id)}/aendern`,
                              { operationId: randomUUID(), baseRevision: b.revision, ...inhalt({ titel: "Anders" }) },
                              emil.cookie,
                          )
                        : await schritt(b.id, was, b.revision, emil.cookie);
                expect(code(antwort), was).toBe("403 community_forbidden");
            }
            // Edda legt vor und kann den vorgelegten dann nicht mehr ändern, den Betreiber schon.
            const vorgelegt = await tu(b.id, "vorlegen", b.revision, edda.cookie);
            const aendern = (cookie: string) =>
                post(
                    `/api/community/social/${String(b.id)}/aendern`,
                    { operationId: randomUUID(), baseRevision: vorgelegt.revision, ...inhalt({ titel: "Besser" }) },
                    cookie,
                );
            expect(code(await aendern(edda.cookie))).toBe("403 community_forbidden");
            expect(code(await aendern(betreiber.cookie))).toBe("200");
        });
    });

    describe("Ein Speicher: die Neuigkeit", () => {
        it("🔴 die Freigabe veröffentlicht GENAU EINEN Eintrag mit Verweis; Zurücknehmen versteckt ihn, Ändern ändert ihn, erneut senden macht keinen zweiten", async () => {
            const b = await anlegen(edda.cookie, { titel: "Erste Fassung" });
            const vorgelegt = await tu(b.id, "vorlegen", b.revision, edda.cookie);
            expect(await neuigkeiten(b.id)).toEqual([]);
            expect(await oeffentlich()).toEqual([]);

            const frei = await tu(b.id, "freigeben", vorgelegt.revision, betreiber.cookie);
            expect(frei.zustand).toBe("veroeffentlicht");
            const eintraege = await neuigkeiten(b.id);
            expect(eintraege).toHaveLength(1);
            expect(eintraege[0]).toMatchObject({
                titel: "Erste Fassung",
                rubrik: "karte",
                zustand: "sichtbar",
                geloescht: false,
            });
            expect(await oeffentlich()).toEqual(["Erste Fassung"]);
            expect(await alleNeuigkeiten()).toBe(1);
            const ziel = (await detail(b.id)).zeile.ziele.find((z) => z.kanal === "neuigkeiten");
            expect(ziel).toMatchObject({ zustand: "ok", adresse: `news:${eintraege[0]!.id}`, versuche: 1 });

            // Dieselbe Freigabe noch einmal (derselbe Beitrag, andere Kennung): kein zweiter Eintrag, sondern ein Übergangsfehler.
            expect(code(await schritt(b.id, "freigeben", frei.revision, betreiber.cookie))).toBe(
                "409 community_transition",
            );
            expect(await alleNeuigkeiten()).toBe(1);

            // Ändern im Hub: der Beitrag merkt sich „geändert“, die Seite bleibt wie sie war, bis die Änderung veröffentlicht ist.
            const geaendert = await post(
                `/api/community/social/${String(b.id)}/aendern`,
                { operationId: randomUUID(), baseRevision: frei.revision, ...inhalt({ titel: "Zweite Fassung" }) },
                betreiber.cookie,
            );
            expect(code(geaendert)).toBe("200");
            expect((await detail(b.id)).zeile.geaendert).toBe(true);
            expect(await oeffentlich()).toEqual(["Erste Fassung"]);
            const veroeffentlicht = await tu(
                b.id,
                "aenderung",
                (geaendert.json() as Quittung).revision,
                betreiber.cookie,
            );
            expect((await neuigkeiten(b.id))[0]).toMatchObject({ titel: "Zweite Fassung", zustand: "sichtbar" });
            expect(await oeffentlich()).toEqual(["Zweite Fassung"]);
            expect((await detail(b.id)).zeile.geaendert).toBe(false);
            expect(await alleNeuigkeiten()).toBe(1);

            // Zurücknehmen versteckt, löscht nicht.
            const zurueck = await tu(b.id, "zuruecknehmen", veroeffentlicht.revision, betreiber.cookie);
            expect((await neuigkeiten(b.id))[0]).toMatchObject({ zustand: "versteckt", geloescht: false });
            expect(await oeffentlich()).toEqual([]);
            expect((await detail(b.id)).zeile.ziele.find((z) => z.kanal === "neuigkeiten")?.zustand).toBe("zurueck");
            expect((await detail(b.id)).zeile.zustand).toBe("veroeffentlicht");
            // Nichts mehr zurückzunehmen; erneut senden macht dieselbe Neuigkeit wieder sichtbar, ohne zweiten Eintrag.
            expect(code(await schritt(b.id, "zuruecknehmen", zurueck.revision, betreiber.cookie))).toBe(
                "409 community_transition",
            );
            await tu(b.id, "erneut", zurueck.revision, betreiber.cookie, { kanal: "neuigkeiten" });
            expect(await oeffentlich()).toEqual(["Zweite Fassung"]);
            expect(await neuigkeiten(b.id)).toHaveLength(1);
            expect(await alleNeuigkeiten()).toBe(1);
        });

        it("🔴 es gibt keinen zweiten Speicher: Text und Titel der Seite stehen in `news_entry`, die Tafeln des Hubs halten nur den Beitrag", async () => {
            const b = await anlegen(betreiber.cookie, { titel: "Nur einmal" });
            await tu(b.id, "freigeben", b.revision, betreiber.cookie);
            const spalten = await database<{ table_name: string }[]>`
                SELECT DISTINCT table_name FROM information_schema.columns
                 WHERE table_schema = 'avesmaps_community' AND table_name LIKE 'beitrag%' ORDER BY table_name
            `;
            expect(spalten.map((s) => s.table_name)).toEqual(["beitrag", "beitrag_ereignis", "beitrag_ziel"]);
            // Das Ziel hält Adresse und Zustand, nicht die gesendete Fassung der Neuigkeit.
            const ziel = await database<{ column_name: string }[]>`
                SELECT column_name FROM information_schema.columns WHERE table_schema = 'avesmaps_community' AND table_name = 'beitrag_ziel'
            `;
            expect(ziel.map((z) => z.column_name).sort()).toEqual([
                "adresse",
                "beitrag_id",
                "fehler",
                "gesendet_at",
                "kanal",
                "versuche",
                "zustand",
            ]);
        });

        it("🔴 die Pflege der Neuigkeiten in der Systemsteuerung zeigt „aus SOC-…“ an Einträgen aus dem Hub, an keinem anderen", async () => {
            const b = await anlegen(betreiber.cookie, { titel: "Aus dem Hub" });
            await tu(b.id, "freigeben", b.revision, betreiber.cookie);
            await database`
                INSERT INTO public.news_entry (datum, titel, text, rubrik, zustand, herkunft, freigegeben_at)
                VALUES ('2026-10-12', 'Von Hand', 'Ein Satz.', 'karte', 'sichtbar', 'legacy', now())
            `;
            const antwort = await get("/api/admin/system/news", betreiber.cookie);
            expect(code(antwort)).toBe("200");
            const eintraege = (antwort.json() as { eintraege: { titel: string; beitrag?: string | null }[] }).eintraege;
            expect(eintraege.map((e) => [e.titel, e.beitrag ?? null]).sort()).toEqual([
                ["Aus dem Hub", b.nr],
                ["Von Hand", null],
            ]);
            // Zeigt das Ziel nicht auf genau diesen Eintrag (etwa nach einem Production-Zug), fehlt die Marke.
            await database`UPDATE avesmaps_community.beitrag_ziel SET adresse = 'news:999999999' WHERE beitrag_id = ${b.id}`;
            const nachher = (await get("/api/admin/system/news", betreiber.cookie)).json() as {
                eintraege: { beitrag?: string | null }[];
            };
            expect(nachher.eintraege.every((e) => (e.beitrag ?? null) === null)).toBe(true);
        });

        it("die Neuigkeit trägt Datum, Rubrik und den Namen des Freigebenden als Herkunft; das Datum der Seite ist der heutige Berliner Tag", async () => {
            const b = await anlegen(betreiber.cookie, { rubrik: "inhalte" });
            await tu(b.id, "freigeben", b.revision, betreiber.cookie);
            const [zeile] = await database<{ datum: string; rubrik: string; herkunft: string; von: string | null }[]>`
                SELECT datum::text, rubrik, herkunft, von_person::text AS von FROM public.news_entry WHERE beitrag_id = ${b.id}
            `;
            const [heute] = await database<
                { tag: string }[]
            >`SELECT (now() AT TIME ZONE 'Europe/Berlin')::date::text AS tag`;
            expect(zeile).toEqual({ datum: heute!.tag, rubrik: "inhalte", herkunft: "Rondrikan", von: betreiber.id });
        });
    });

    describe("Vorlegen, Freigeben und E10", () => {
        it("🔴 ein Betreiber gibt den EIGENEN Beitrag allein frei, mit Vermerk im Verlauf; einen fremden, nicht vorgelegten Entwurf nicht", async () => {
            const eigen = await anlegen(betreiber.cookie, { titel: "Mein eigener" });
            const frei = await tu(eigen.id, "freigeben", eigen.revision, betreiber.cookie);
            expect(frei.zustand).toBe("veroeffentlicht");
            expect(await ereignisse(eigen.id)).toEqual([
                { art: "angelegt", text: null },
                { art: "freigegeben", text: "allein freigegeben" },
                { art: "gesendet", text: "Neuigkeiten" },
            ]);

            const fremd = await anlegen(edda.cookie, { titel: "Eddas Entwurf" });
            expect(code(await schritt(fremd.id, "freigeben", fremd.revision, betreiber.cookie))).toBe(
                "409 community_transition",
            );
            expect(await neuigkeiten(fremd.id)).toEqual([]);
            // Vorgelegt, gibt ein anderer Betreiber sie ohne Vermerk „allein“ frei.
            const vorgelegt = await tu(fremd.id, "vorlegen", fremd.revision, edda.cookie);
            await tu(fremd.id, "freigeben", vorgelegt.revision, zweiterBetreiber.cookie);
            expect((await ereignisse(fremd.id)).find((e) => e.art === "freigegeben")).toEqual({
                art: "freigegeben",
                text: null,
            });
        });

        it("zurück an den Verfasser: der Beitrag wird wieder Entwurf, der Grund steht im Verlauf; die Vorlage zieht der Verfasser auch selbst zurück", async () => {
            const b = await anlegen(edda.cookie);
            const v1 = await tu(b.id, "vorlegen", b.revision, edda.cookie);
            const zurueck = await tu(b.id, "zurueckgeben", v1.revision, betreiber.cookie, {
                grund: "Bitte die Rubrik prüfen.",
            });
            expect(zurueck.zustand).toBe("entwurf");
            expect((await detail(b.id)).verlauf.find((e) => e.art === "zurueckgegeben")?.text).toBe(
                "Bitte die Rubrik prüfen.",
            );
            const v2 = await tu(b.id, "vorlegen", zurueck.revision, edda.cookie);
            const gezogen = await tu(b.id, "zurueckziehen", v2.revision, edda.cookie);
            expect(gezogen.zustand).toBe("entwurf");
            expect((await detail(b.id)).zeile.vorgelegtAt).toBeNull();
        });

        it("Konflikt: ein veralteter Stand ist 409 community_conflict, nichts wird still überschrieben", async () => {
            const b = await anlegen(edda.cookie);
            await tu(b.id, "vorlegen", b.revision, edda.cookie);
            expect(code(await schritt(b.id, "freigeben", b.revision, betreiber.cookie))).toBe("409 community_conflict");
            expect(await alleNeuigkeiten()).toBe(0);
        });

        it("eine Wiederholung derselben Kennung tut nichts zweites und schreibt nur einen Eintrag ins Protokoll", async () => {
            const b = await anlegen(betreiber.cookie);
            const operationId = randomUUID();
            const erste = await post(
                `/api/community/social/${String(b.id)}/freigeben`,
                { operationId, baseRevision: b.revision },
                betreiber.cookie,
            );
            const zweite = await post(
                `/api/community/social/${String(b.id)}/freigeben`,
                { operationId, baseRevision: b.revision },
                betreiber.cookie,
            );
            expect(code(erste)).toBe("200");
            expect(code(zweite)).toBe("200");
            expect((zweite.json() as Quittung).revision).toBe((erste.json() as Quittung).revision);
            expect(await alleNeuigkeiten()).toBe(1);
            expect(await protokoll("system.social_freigegeben")).toHaveLength(1);
        });
    });

    describe("Eine Zählung für Fenster und Server", () => {
        it("🔴 der Server weist zu Langes ab, auch wenn das Fenster es durchließe: Vorlegen, Freigeben, Änderung und erneut senden zählen nach", async () => {
            const lang = "a".repeat(4001);
            // Gespeichert wird als Entwurf auch Zu-Langes (Arbeit in Arbeit) ...
            const b = await anlegen(edda.cookie, { text: lang });
            // ... aber nicht vorgelegt.
            const antwort = await schritt(b.id, "vorlegen", b.revision, edda.cookie);
            expect(code(antwort)).toBe("422 community_invalid");
            expect((antwort.json() as { error: { message: string } }).error.message).toBe(
                "Neuigkeiten: 1 Zeichen zu viel.",
            );
            // Der Betreiber kann den eigenen Entwurf auch nicht über die Zählung hinweg freigeben.
            const eigen = await anlegen(betreiber.cookie, { text: lang });
            expect(code(await schritt(eigen.id, "freigeben", eigen.revision, betreiber.cookie))).toBe(
                "422 community_invalid",
            );
            expect(await alleNeuigkeiten()).toBe(0);
            // Auch das Ändern nach dem Veröffentlichen bleibt nicht ungezählt: erst kürzen, dann veröffentlichen.
            const ok = await anlegen(betreiber.cookie, { text: "Kurz." });
            const frei = await tu(ok.id, "freigeben", ok.revision, betreiber.cookie);
            const lange = await post(
                `/api/community/social/${String(ok.id)}/aendern`,
                { operationId: randomUUID(), baseRevision: frei.revision, ...inhalt({ text: lang }) },
                betreiber.cookie,
            );
            expect(code(lange)).toBe("200");
            expect(code(await schritt(ok.id, "aenderung", (lange.json() as Quittung).revision, betreiber.cookie))).toBe(
                "422 community_invalid",
            );
            expect((await neuigkeiten(ok.id))[0]!.text).toBe("Kurz.");
        });

        it("🔴 Fenster und Server zählen gleich: an der Grenze geht es durch, eins darüber nicht; Titel 200; Codepoints, nicht Grapheme", async () => {
            const faelle: { patch: Record<string, unknown>; geht: boolean }[] = [
                { patch: { text: "a".repeat(4000) }, geht: true },
                { patch: { text: "a".repeat(4001) }, geht: false },
                { patch: { titel: "T".repeat(200) }, geht: true },
                { patch: { titel: "T".repeat(201) }, geht: false },
                // 2000 Daumen mit Hautton sind 4000 Codepoints (2000 Grapheme): die Seite zählt Codepoints wie `char_length`.
                { patch: { text: "👍🏽".repeat(2000) }, geht: true },
                { patch: { text: "👍🏽".repeat(2001) }, geht: false },
                { patch: { text: "a\r\nb".repeat(1000) }, geht: true },
            ];
            for (const fall of faelle) {
                const fenster = pruefeBeitrag({
                    titel: (fall.patch["titel"] as string | undefined) ?? "Titel",
                    text: (fall.patch["text"] as string | undefined) ?? "Text.",
                    hashtags: [],
                    kanaele: ["neuigkeiten"],
                });
                expect(fenster === null, JSON.stringify(Object.keys(fall.patch))).toBe(fall.geht);
                // Eine Titelzeile über 200 Zeichen nimmt schon die Tafel nicht an (harte Grenze); Zu-Langes im Text wird als Entwurf gespeichert.
                if (typeof fall.patch["titel"] === "string" && fall.patch["titel"].length > 200) {
                    const abgelehnt = await post(
                        "/api/community/social",
                        { operationId: randomUUID(), ...inhalt({ hashtags: [], ...fall.patch }) },
                        edda.cookie,
                    );
                    expect(code(abgelehnt)).toBe("422 community_invalid");
                    continue;
                }
                const b = await anlegen(edda.cookie, { hashtags: [], ...fall.patch });
                const server = await schritt(b.id, "vorlegen", b.revision, edda.cookie);
                expect(
                    code(server) === "200",
                    `Server: ${JSON.stringify(Object.keys(fall.patch))} ${String((fall.patch["text"] as string | undefined)?.length)}`,
                ).toBe(fall.geht);
            }
        });

        it("ohne Titelzeile, ohne Text und ohne Kanal geht nichts; ein Kanal ohne Verbindung sperrt das Vorlegen", async () => {
            for (const patch of [{ titel: null }, { titel: "  " }, { text: "   " }]) {
                const b = await anlegen(edda.cookie, patch);
                expect(code(await schritt(b.id, "vorlegen", b.revision, edda.cookie)), JSON.stringify(patch)).toBe(
                    "422 community_invalid",
                );
            }
            const mastodon = await anlegen(edda.cookie, { kanaele: ["neuigkeiten", "mastodon"] });
            const antwort = await schritt(mastodon.id, "vorlegen", mastodon.revision, edda.cookie);
            expect(code(antwort)).toBe("422 community_invalid");
            // Ohne die Angaben der Umgebung (`COMMUNITY_SOCIAL_MASTODON_*`) gibt es den Kanal nicht (WI-0268 C12a); sein Verhalten mit Konfiguration prüft `community-social-mastodon.test.ts`.
            expect((antwort.json() as { error: { message: string } }).error.message).toBe(
                "Mastodon ist in dieser Umgebung nicht eingerichtet.",
            );
            // Kein Kanal gibt schon das Schema nicht her.
            const leer = await post(
                "/api/community/social",
                { operationId: randomUUID(), ...inhalt({ kanaele: [] }) },
                edda.cookie,
            );
            expect(leer.statusCode).toBe(400);
            // Eine fremde Rubrik gibt es nicht.
            const rubrik = await post(
                "/api/community/social",
                { operationId: randomUUID(), ...inhalt({ rubrik: "wetter" }) },
                edda.cookie,
            );
            expect(code(rubrik)).toBe("422 community_invalid");
        });

        it("Hashtags werden bereinigt: # davor, Doppelte weg, Ungültiges weg", async () => {
            const b = await anlegen(edda.cookie, {
                hashtags: ["Aventurien", "#aventurien", " #Über ", "#kein leer", "##x"],
            });
            expect((await detail(b.id)).zeile.hashtags).toEqual(["#Aventurien", "#Über", "#x"]);
        });
    });

    describe("Das Bild", () => {
        it("🔴 ein Bild ohne Bildbeschreibung sperrt Vorlegen und Freigeben; ohne geklärte Rechte auch", async () => {
            const geklaert = await medium("cleared");
            const offen = await medium("unreviewed");

            const ohneBeschreibung = await anlegen(edda.cookie, { bild: geklaert });
            const a = await schritt(ohneBeschreibung.id, "vorlegen", ohneBeschreibung.revision, edda.cookie);
            expect(code(a)).toBe("422 community_invalid");
            expect((a.json() as { error: { message: string } }).error.message).toBe("Die Bildbeschreibung fehlt.");

            const ungeklaert = await anlegen(edda.cookie, { bild: offen, bildBeschreibung: "Eine Karte." });
            const b = await schritt(ungeklaert.id, "vorlegen", ungeklaert.revision, edda.cookie);
            expect(code(b)).toBe("422 community_invalid");
            expect((b.json() as { error: { message: string } }).error.message).toBe(
                "Die Rechte des Bildes lassen keinen Beitrag zu.",
            );

            const unbekannt = await anlegen(edda.cookie, { bild: randomUUID(), bildBeschreibung: "Eine Karte." });
            expect(code(await schritt(unbekannt.id, "vorlegen", unbekannt.revision, edda.cookie))).toBe(
                "422 community_invalid",
            );

            const gut = await anlegen(edda.cookie, { bild: geklaert, bildBeschreibung: "Die Reichsstraße als Linie." });
            expect(code(await schritt(gut.id, "vorlegen", gut.revision, edda.cookie))).toBe("200");
            const d = await detail(gut.id);
            expect(d.bild).toMatchObject({
                id: geklaert,
                titel: "Karte der Reichsstraße",
                rechtsbasis: "own_work",
                klaerung: "cleared",
                geklaert: true,
            });
        });
    });

    describe("Papierkorb", () => {
        it("der Verfasser legt den eigenen Entwurf hinein und holt ihn zurück, ein anderer Editor nicht; veröffentlichte gehen nicht hinein", async () => {
            const b = await anlegen(edda.cookie);
            expect(code(await schritt(b.id, "papierkorb", b.revision, emil.cookie))).toBe("403 community_forbidden");
            const korb = await tu(b.id, "papierkorb", b.revision, edda.cookie);
            const liste = await get("/api/community/social?segment=papierkorb", edda.cookie);
            expect(Value.Check(SocialListe, liste.json())).toBe(true);
            expect((liste.json() as SocialListe).zeilen.map((z) => z.id)).toEqual([b.id]);
            expect((liste.json() as SocialListe).zaehler).toMatchObject({ offen: 0, papierkorb: 1 });
            // Im Papierkorb wird nichts geändert, vorgelegt oder freigegeben.
            expect(code(await schritt(b.id, "vorlegen", korb.revision, edda.cookie))).toBe("409 community_transition");
            expect(code(await schritt(b.id, "freigeben", korb.revision, betreiber.cookie))).toBe(
                "409 community_transition",
            );
            const zurueck = await tu(b.id, "zurueckholen", korb.revision, edda.cookie);
            expect(zurueck.zustand).toBe("entwurf");
            expect((await detail(b.id)).zeile.papierkorb).toBe(false);

            const frei = await anlegen(betreiber.cookie);
            const veroeffentlicht = await tu(frei.id, "freigeben", frei.revision, betreiber.cookie);
            expect(code(await schritt(frei.id, "papierkorb", veroeffentlicht.revision, betreiber.cookie))).toBe(
                "409 community_transition",
            );
        });
    });

    describe("Die Liste", () => {
        it("Segmente, Zahlen, Suche und Kanal; Offen fasst Entwürfe und Vorgelegte zusammen", async () => {
            const a = await anlegen(edda.cookie, { titel: "Reichsstraße eröffnet" });
            const b = await anlegen(edda.cookie, { titel: "Neue Schiffsrouten", text: "Von Havena nach Charypso." });
            await tu(b.id, "vorlegen", b.revision, edda.cookie);
            const c = await anlegen(betreiber.cookie, { titel: "Schon draußen" });
            await tu(c.id, "freigeben", c.revision, betreiber.cookie);

            const offen = (await get("/api/community/social?segment=offen", betreiber.cookie)).json() as SocialListe;
            expect(offen.zeilen.map((z) => z.id).sort()).toEqual([a.id, b.id].sort());
            expect(offen.zaehler).toEqual({
                offen: 2,
                veroeffentlicht: 1,
                papierkorb: 0,
                entwurf: 1,
                vorgelegt: 1,
                wartet: 1,
            });
            const draussen = (
                await get("/api/community/social?segment=veroeffentlicht", betreiber.cookie)
            ).json() as SocialListe;
            expect(draussen.zeilen.map((z) => z.id)).toEqual([c.id]);
            const suche = (
                await get("/api/community/social?segment=offen&q=Havena", betreiber.cookie)
            ).json() as SocialListe;
            expect(suche.zeilen.map((z) => z.id)).toEqual([b.id]);
            const hashtag = (
                await get("/api/community/social?segment=offen&q=%23Aventurien", betreiber.cookie)
            ).json() as SocialListe;
            expect(hashtag.zeilen).toHaveLength(2);
            const mastodon = (
                await get("/api/community/social?segment=offen&kanal=mastodon", betreiber.cookie)
            ).json() as SocialListe;
            expect(mastodon.zeilen).toEqual([]);
            const eigen = (await get("/api/community/social?segment=offen", edda.cookie)).json() as SocialListe;
            expect(eigen.zeilen[0]?.verfasser?.name).toBe("Edda");
            // Der Prozentzeichen-Test: Eine Suche nach `%` findet nicht alles.
            const prozent = (
                await get("/api/community/social?segment=offen&q=%25", betreiber.cookie)
            ).json() as SocialListe;
            expect(prozent.zeilen).toEqual([]);
        });

        it("ein Beitrag aus einem Vorgang trägt die COM-Nummer, aber keine Daten des Melders", async () => {
            const [vorgang] = await database<{ id: string }[]>`
                INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, operation_id) VALUES ('meldung', 'lage', 'website', gen_random_uuid())
                RETURNING id::text
            `;
            const antwort = await post(
                "/api/community/social",
                { operationId: randomUUID(), ...inhalt({ rubrik: "community" }), vorgang: Number(vorgang!.id) },
                edda.cookie,
            );
            expect(code(antwort)).toBe("201");
            const d = await detail((antwort.json() as Quittung).id);
            expect(d.zeile.herkunft).toBe("vorgang");
            expect(d.zeile.vorgang).toBe(`COM-${vorgang!.id.padStart(6, "0")}`);
            expect(d.zeile.rubrik).toBe("community");
            expect(JSON.stringify(d)).not.toMatch(/melder|mail|schluessel/iu);
            // Ein Vorgang, den es nicht gibt, wird nicht verknüpft.
            const keiner = await post(
                "/api/community/social",
                { operationId: randomUUID(), ...inhalt(), vorgang: 999_999_999 },
                edda.cookie,
            );
            expect(code(keiner)).toBe("404 community_not_found");
            await database`DELETE FROM avesmaps_community.vorgang WHERE id = ${vorgang!.id}::bigint`;
        });
    });

    describe("Protokoll und Glocke", () => {
        it("🔴 das Protokoll trägt SOC-Nummer und Kanal, nie Titel, Text oder Hashtags", async () => {
            const b = await anlegen(edda.cookie, {
                titel: "Geheimer Titel XYZ",
                text: "Geheimer Text XYZ",
                hashtags: ["Geheim"],
            });
            const v = await tu(b.id, "vorlegen", b.revision, edda.cookie);
            const f = await tu(b.id, "freigeben", v.revision, betreiber.cookie);
            const z = await tu(b.id, "zuruecknehmen", f.revision, betreiber.cookie);
            const e = await tu(b.id, "erneut", z.revision, betreiber.cookie, { kanal: "neuigkeiten" });
            const k = await anlegen(edda.cookie);
            await tu(k.id, "papierkorb", k.revision, edda.cookie);
            expect(e.zustand).toBe("veroeffentlicht");
            const nr = b.nr;
            expect(await protokoll("system.social_vorgelegt")).toEqual([{ target_ref: nr, details: { beitrag: nr } }]);
            expect(await protokoll("system.social_freigegeben")).toEqual([
                { target_ref: nr, details: { beitrag: nr, kanal: "neuigkeiten" } },
            ]);
            expect(await protokoll("system.social_zurueckgenommen")).toEqual([
                { target_ref: nr, details: { beitrag: nr, kanal: "neuigkeiten" } },
            ]);
            expect(await protokoll("system.social_erneut_gesendet")).toHaveLength(1);
            expect(await protokoll("system.social_verworfen")).toEqual([
                { target_ref: k.nr, details: { beitrag: k.nr } },
            ]);
            const alle = await database<{ details: unknown; target_ref: string | null }[]>`
                SELECT details, target_ref FROM avesmaps_auth.security_event WHERE action LIKE 'system.social_%'
            `;
            expect(JSON.stringify(alle)).not.toMatch(/XYZ|Geheim/u);
            // Auch der Verlauf des Beitrags trägt keinen Text.
            expect(JSON.stringify((await detail(b.id)).verlauf)).not.toMatch(/XYZ|Geheim/u);
        });

        it("🔔 ein vorgelegter Beitrag meldet sich bei den Betreibern („SOC-… wartet“), nicht bei dem, der ihn vorlegte; nie mit Text", async () => {
            const b = await anlegen(edda.cookie, { titel: "Geheimer Titel XYZ" });
            await tu(b.id, "vorlegen", b.revision, edda.cookie);
            const zeilen = await database<{ an: string; art: string; text: string | null }[]>`
                SELECT an_person::text AS an, art, text FROM public.benachrichtigung WHERE art = 'social_freigabe' AND an_person::text = ANY(${meine}) ORDER BY an_person
            `;
            expect(new Set(zeilen.map((z) => z.an))).toEqual(new Set([betreiber.id, zweiterBetreiber.id]));
            expect(zeilen.every((z) => z.text === b.nr)).toBe(true);
            // Ein Betreiber, der selbst vorlegt, bekommt keine Meldung an sich selbst.
            const eigen = await anlegen(betreiber.cookie);
            await tu(eigen.id, "vorlegen", eigen.revision, betreiber.cookie);
            const nachEigen = await database<{ an: string }[]>`
                SELECT an_person::text AS an FROM public.benachrichtigung WHERE art = 'social_freigabe' AND text = ${eigen.nr} AND an_person::text = ANY(${meine})
            `;
            expect(nachEigen.map((z) => z.an)).toEqual([zweiterBetreiber.id]);
            // Zurückziehen und neu Vorlegen meldet nicht ein zweites Mal.
            const gezogen = await database<
                { revision: number }[]
            >`SELECT revision FROM avesmaps_community.beitrag WHERE id = ${b.id}`;
            const zurueck = await tu(b.id, "zurueckziehen", gezogen[0]!.revision, edda.cookie);
            await tu(b.id, "vorlegen", zurueck.revision, edda.cookie);
            expect(
                (
                    await database`SELECT 1 FROM public.benachrichtigung WHERE art = 'social_freigabe' AND text = ${b.nr} AND an_person::text = ANY(${meine})`
                ).length,
            ).toBe(2);
        });
    });

    describe("Die Routine", () => {
        const routine = (titel: string, quelle: string) =>
            database<{ id: string | null }[]>`
                SELECT public.news_add('2026-10-30'::date, ${titel}, 'Ein Satz für normale Leser.', 'karte', ${quelle})::text AS id
            `;
        const beitraege = () =>
            database<
                {
                    id: string;
                    zustand: string;
                    herkunft: string;
                    ki: boolean;
                    titel: string;
                    verfasser: string | null;
                    papierkorb: boolean;
                    art: string | null;
                }[]
            >`
                SELECT id::text, zustand, herkunft, ki, titel, verfasser::text AS verfasser, papierkorb_at IS NOT NULL AS papierkorb, papierkorb_art AS art
                  FROM avesmaps_community.beitrag ORDER BY id
            `;

        it("🔴 `news_add` behält seine Signatur und legt den Entwurf als Vorschlag im Hub an (Herkunft Routine, KI, vorgelegt, mit Verweis)", async () => {
            const [signatur] = await database<{ args: string; ergebnis: string }[]>`
                SELECT pg_get_function_identity_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS ergebnis
                  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'news_add'
            `;
            expect(signatur).toEqual({
                args: "p_datum date, p_titel text, p_text text, p_rubrik text, p_quelle text",
                ergebnis: "bigint",
            });
            const [neu] = await routine("Neu auf der Karte", "test:r1");
            expect(neu!.id).not.toBeNull();
            const liste = await beitraege();
            expect(liste).toHaveLength(1);
            expect(liste[0]).toMatchObject({
                zustand: "vorgelegt",
                herkunft: "routine",
                ki: true,
                titel: "Neu auf der Karte",
                verfasser: null,
            });
            const [eintrag] = await database<{ zustand: string; beitrag_id: string }[]>`
                SELECT zustand, beitrag_id::text FROM public.news_entry WHERE id = ${neu!.id}::bigint
            `;
            expect(eintrag).toEqual({ zustand: "entwurf", beitrag_id: liste[0]!.id });
            // Derselbe Stand noch einmal: nichts Neues, auch kein zweiter Beitrag.
            const [nochmal] = await routine("Neu auf der Karte", "test:r1");
            expect(nochmal!.id).toBeNull();
            expect(await beitraege()).toHaveLength(1);
        });

        it("🔴 Notbremse: ein ganzer Lauf (höchstens drei) je Tag und Kanal steht im Hub; der vierte Entwurf bleibt wie bisher einer allein in der Systemsteuerung", async () => {
            await routine("Erster", "test:n1");
            await routine("Zweiter", "test:n2");
            await routine("Dritter", "test:n3");
            await routine("Vierter", "test:n4");
            expect((await beitraege()).map((b) => b.titel).sort()).toEqual(["Dritter", "Erster", "Zweiter"]);
            expect(await alleNeuigkeiten()).toBe(4);
            const ohne = await database<
                { titel: string }[]
            >`SELECT titel FROM public.news_entry WHERE beitrag_id IS NULL ORDER BY titel`;
            expect(ohne.map((e) => e.titel)).toEqual(["Vierter"]);
            // Ein verworfener Vorschlag macht keinen Platz für einen neuen am selben Tag.
            const [erster] = await beitraege();
            const korb = await schritt(
                Number(erster!.id),
                "papierkorb",
                (await detail(Number(erster!.id))).zeile.revision,
                betreiber.cookie,
            );
            expect(code(korb)).toBe("200");
            await routine("Fünfter", "test:n5");
            expect(await beitraege()).toHaveLength(3);
        });

        it("🔴 die Freigabe des Vorschlags macht den vorhandenen Entwurf sichtbar (kein zweiter Eintrag) und gibt den Beitrag als veröffentlicht frei", async () => {
            const [neu] = await routine("Vorschlag", "test:f1");
            const [b] = await beitraege();
            const id = Number(b!.id);
            const d = await detail(id);
            expect(d.zeile).toMatchObject({ herkunft: "routine", verfasser: null, zustand: "vorgelegt" });
            // Ein Vorschlag der Routine hat keinen Verfasser, an den er zurückgehen könnte.
            expect(code(await schritt(id, "zurueckgeben", d.zeile.revision, betreiber.cookie))).toBe(
                "409 community_transition",
            );
            const frei = await tu(id, "freigeben", d.zeile.revision, betreiber.cookie);
            expect(frei.zustand).toBe("veroeffentlicht");
            expect(await alleNeuigkeiten()).toBe(1);
            const [eintrag] = await database<
                { id: string; zustand: string; herkunft: string; freigegeben_von: string | null }[]
            >`
                SELECT id::text, zustand, herkunft, freigegeben_von::text FROM public.news_entry WHERE beitrag_id = ${id}
            `;
            expect(eintrag).toMatchObject({
                id: neu!.id,
                zustand: "sichtbar",
                herkunft: "routine",
                freigegeben_von: betreiber.id,
            });
            expect(await oeffentlich()).toEqual(["Vorschlag"]);
        });

        it("🔴 Frischeprüfung: ein Vorschlag, der sieben Tage liegt, verfällt in den Papierkorb (samt Entwurf der Seite); ein frischer nicht; Zurückholen beginnt neu", async () => {
            await routine("Alt", "test:a1");
            const [alt] = await beitraege();
            await database`UPDATE avesmaps_community.beitrag SET vorgelegt_at = now() - interval '8 days' WHERE id = ${alt!.id}::bigint`;
            // Ein Beitrag der Redaktion, der lange liegt, verfällt nicht; nur die Routine ist ein Vorschlag.
            const rede = await anlegen(edda.cookie);
            await tu(rede.id, "vorlegen", rede.revision, edda.cookie);
            await database`UPDATE avesmaps_community.beitrag SET vorgelegt_at = now() - interval '30 days' WHERE id = ${rede.id}`;
            expect(await communityBeitragAufbewahrung(database)).toEqual({
                beitraegeVerfallen: 1,
                beitraegeGeloescht: 0,
            });
            const nachher = await beitraege();
            expect(nachher.find((b) => b.id === alt!.id)).toMatchObject({
                papierkorb: true,
                art: "verfallen",
                zustand: "vorgelegt",
            });
            expect(nachher.find((b) => b.id === String(rede.id))).toMatchObject({ papierkorb: false });
            const [eintrag] = await database<{ geloescht: boolean; zustand: string }[]>`
                SELECT geloescht_at IS NOT NULL AS geloescht, zustand FROM public.news_entry WHERE beitrag_id = ${alt!.id}::bigint
            `;
            expect(eintrag).toEqual({ geloescht: true, zustand: "entwurf" });
            expect((await detail(Number(alt!.id))).zeile).toMatchObject({ papierkorb: true, verfallen: true });
            // Ein zweiter Lauf tut nichts mehr.
            expect(await communityBeitragAufbewahrung(database)).toEqual({
                beitraegeVerfallen: 0,
                beitraegeGeloescht: 0,
            });

            // Zurückholen: wieder vorgelegt, die sieben Tage beginnen von vorn, der Eintrag der Seite ist aus ihrem Papierkorb.
            const d = await detail(Number(alt!.id));
            await tu(Number(alt!.id), "zurueckholen", d.zeile.revision, betreiber.cookie);
            expect(await communityBeitragAufbewahrung(database)).toEqual({
                beitraegeVerfallen: 0,
                beitraegeGeloescht: 0,
            });
            const [zurueck] = await database<{ geloescht: boolean }[]>`
                SELECT geloescht_at IS NOT NULL AS geloescht FROM public.news_entry WHERE beitrag_id = ${alt!.id}::bigint
            `;
            expect(zurueck!.geloescht).toBe(false);
            // Der Papierkorb der Beiträge ist nach 30 Tagen leer, die Seite behält ihre Zeile.
            await database`UPDATE avesmaps_community.beitrag SET papierkorb_at = now() - interval '31 days', papierkorb_art = 'verfallen' WHERE id = ${alt!.id}::bigint`;
            expect(await communityBeitragAufbewahrung(database)).toEqual({
                beitraegeVerfallen: 0,
                beitraegeGeloescht: 1,
            });
            expect(await alleNeuigkeiten()).toBe(1);
        });

        it("🔔 der tägliche Lauf meldet die Vorschläge der Routine den Betreibern, einmal je Beitrag", async () => {
            await routine("Zum Melden", "test:g1");
            const [b] = await beitraege();
            const nr = `SOC-${b!.id.padStart(6, "0")}`;
            expect(await communitySocialFreigabe(database, umgebung)).toMatchObject({ vorschlaege: 1 });
            const erste = await database<{ an: string; text: string | null }[]>`
                SELECT an_person::text AS an, text FROM public.benachrichtigung WHERE art = 'social_freigabe' AND an_person::text = ANY(${meine})
            `;
            expect(new Set(erste.map((z) => z.an))).toEqual(new Set([betreiber.id, zweiterBetreiber.id]));
            expect(erste.every((z) => z.text === nr)).toBe(true);
            expect(await communitySocialFreigabe(database, umgebung)).toMatchObject({
                vorschlaege: 1,
                vorschlaegeGemeldet: 0,
            });
        });

        it("🔴 die Systemsteuerung zieht den Beitrag nach: Freigeben, Verstecken und Papierkorb der Seite stimmen mit dem Hub überein", async () => {
            const [neu] = await routine("Von Hand freigegeben", "test:s1");
            const [b] = await beitraege();
            const id = Number(b!.id);
            const seite = (was: Record<string, unknown>) =>
                post(`/api/admin/system/news/${neu!.id!}`, { operationId: randomUUID(), ...was }, betreiber.cookie);
            // Die Seite gibt den Entwurf frei: Der Hub sagt „veröffentlicht“, das Ziel „ok“, und der Verlauf nennt die Systemsteuerung.
            expect(code(await seite({ zustand: "sichtbar" }))).toBe("200");
            let d = await detail(id);
            expect(d.zeile.zustand).toBe("veroeffentlicht");
            expect(d.zeile.ziele.find((z) => z.kanal === "neuigkeiten")?.zustand).toBe("ok");
            expect((await ereignisse(id)).at(-1)).toEqual({ art: "in_systemsteuerung", text: "veröffentlicht" });
            // Versteckt in der Seite: Das Ziel ist zurückgenommen.
            expect(code(await seite({ zustand: "versteckt" }))).toBe("200");
            d = await detail(id);
            expect(d.zeile.ziele.find((z) => z.kanal === "neuigkeiten")?.zustand).toBe("zurueck");
            // Text gebessert in der Seite: Der Beitrag folgt.
            expect(code(await seite({ titel: "Anders benannt" }))).toBe("200");
            expect((await detail(id)).zeile.titel).toBe("Anders benannt");
            // Der Hub schreibt selbst, ohne dass der Spiegel dazwischenfunkt: kein Eintrag „in_systemsteuerung“ von seinem eigenen Schreiben.
            const vorher = (await ereignisse(id)).filter((e) => e.art === "in_systemsteuerung").length;
            const aktuell = await detail(id);
            await tu(id, "erneut", aktuell.zeile.revision, betreiber.cookie, { kanal: "neuigkeiten" });
            expect((await ereignisse(id)).filter((e) => e.art === "in_systemsteuerung")).toHaveLength(vorher);
            expect(await oeffentlich()).toEqual(["Anders benannt"]);
        });

        it("ein Eintrag von Hand oder aus Legacy hat keinen Beitrag und bleibt, wie er ist", async () => {
            await database`
                INSERT INTO public.news_entry (datum, titel, text, rubrik, zustand, herkunft, freigegeben_at)
                VALUES ('2026-10-12', 'Alt', 'Ein Satz.', 'karte', 'sichtbar', 'legacy', now())
            `;
            const [alt] = await database<{ id: string }[]>`SELECT id::text FROM public.news_entry`;
            const antwort = await post(
                `/api/admin/system/news/${alt!.id}`,
                { operationId: randomUUID(), zustand: "versteckt" },
                betreiber.cookie,
            );
            expect(code(antwort)).toBe("200");
            expect(await beitraege()).toEqual([]);
        });
    });

    describe("Die Datenbank", () => {
        it("Zustandsregeln der Tafel: kein veröffentlichter Beitrag im Papierkorb, Revision zählt, Verfasser fällt mit dem Konto weg", async () => {
            const b = await anlegen(edda.cookie);
            await expect(
                database`UPDATE avesmaps_community.beitrag SET zustand = 'veroeffentlicht', veroeffentlicht_at = now(), vorgelegt_at = now(), papierkorb_at = now(), papierkorb_art = 'verworfen' WHERE id = ${b.id}`,
            ).rejects.toMatchObject({ code: "23514" });
            await expect(
                database`UPDATE avesmaps_community.beitrag SET kanaele = ARRAY['x'] WHERE id = ${b.id}`,
            ).rejects.toMatchObject({ code: "23514" });
            await expect(
                database`UPDATE avesmaps_community.beitrag SET herkunft = 'vorgang' WHERE id = ${b.id}`,
            ).rejects.toMatchObject({ code: "23514" });
            const [vorher] = await database<
                { n: number }[]
            >`SELECT avesmaps_community.redact_person_community(${edda.id}::uuid) AS n`;
            expect(vorher!.n).toBeGreaterThanOrEqual(2);
            const d = await detail(b.id);
            expect(d.zeile.verfasser).toBeNull();
            expect(d.verlauf.every((e) => e.von === null)).toBe(true);
        });
    });
});
