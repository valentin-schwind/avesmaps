import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_KARTEN_URL,
    mediaKarteLinksUrl,
    mediaKarteStilllegenUrl,
    mediaKarteUrl,
    type MamKarteDetail,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { ersetzeKartenlinks } from "../src/media-editor/kartensammlung-links.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures } from "./support/media-fixture.ts";
import { cleanEditorMedia } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Fundstellen eines Eintrags der Kartensammlung ersetzen (WI-0287 Stufe 1, Punkt 3; `citymap.links`). Die Menge gilt in der gegebenen Folge (erste Zeile `primary`, Rest `further`),
 * Wegfallendes wird stillgelegt, Früheres lebt wieder auf, Neues entsteht von Hand; `isPaid` bleibt dreiwertig. Falsche und doppelte Adressen sind 400, der gesehene Stand zählt (409),
 * ein stillgelegter Eintrag nimmt nichts an, ohne Recht 403, der Legacy-Zug hat Vorrang (503). Die Besucherseite liest nur aktive Links (`subjects/sections/citymaps.ts`).
 */
describeWithDatabase("Fundstellen der Kartensammlung (WI-0287)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let cookie = "";
    let leseCookie = "";
    let personId = "";
    let pruefId = "";
    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot: undefined,
        auth: TEST_AUTH,
    });
    const post = (url: string, payload: Record<string, unknown>, kekse = cookie) =>
        app.inject({ method: "POST", url, headers: { origin: TEST_ORIGIN, cookie: kekse }, payload });
    const lies = async (id: string): Promise<MamKarteDetail> =>
        (await app.inject({ method: "GET", url: mediaKarteUrl(id), headers: { origin: TEST_ORIGIN, cookie } })).json();
    const legeAn = async (titel: string): Promise<string> => {
        const antwort = await post(MEDIA_KARTEN_URL, {
            operationId: randomUUID(),
            fields: { title: titel },
            types: [],
            places: [],
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "citymap")!.id;
    };
    const setze = (id: string, baseRevision: number, links: unknown[], kekse = cookie) =>
        post(mediaKarteLinksUrl(id), { operationId: randomUUID(), baseRevision, links }, kekse);
    const zeilen = (id: string) =>
        database<
            {
                url: string;
                link_role: string;
                position: number;
                is_paid: boolean | null;
                state: string;
                is_active: boolean;
                retired_origin: string | null;
                source_system: string;
                legacy_origin: string;
            }[]
        >`
            SELECT l.url, l.link_role, l.position, l.is_paid, l.state, l.is_active, l.retired_origin, l.source_system, l.legacy_origin
              FROM citymap_link l JOIN citymap c ON c.id = l.citymap_id WHERE c.public_id = ${id}::uuid ORDER BY l.id
        `;
    const aufraeumen = async (): Promise<void> => {
        const ids = await database<{ id: string }[]>`
            SELECT id::text AS id FROM citymap WHERE title LIKE '%Links der Probe%' AND source_system = 'avesmaps3d'
        `;
        const kennungen = ids.map((zeile) => zeile.id);
        await database`DELETE FROM citymap_link WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`
            DELETE FROM media_audit_event
             WHERE citymap_public_id IN (SELECT public_id FROM citymap WHERE id = ANY(${kennungen}::bigint[]))
        `;
        await database`DELETE FROM citymap WHERE id = ANY(${kennungen}::bigint[])`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        const fixture = authFixture(database);
        const redakteurin = await fixture.person("editor", { name: "Links Redakteurin" });
        personId = redakteurin.id;
        cookie = (await fixture.session(redakteurin.id, { passkeyMinutesAgo: 1 })).cookie;
        const pruefer = await fixture.person("reviewer", { name: "Links Prüfer" });
        pruefId = pruefer.id;
        leseCookie = (await fixture.session(pruefer.id, { passkeyMinutesAgo: 1 })).cookie;
        await cleanEditorMedia(database, [personId, pruefId]);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await cleanEditorMedia(database, [personId, pruefId]);
        await cleanMediaFixtures(database);
        await database.end();
    });

    it("ersetzt die Menge in der gegebenen Folge: erste Zeile primary, Rest further, dreiwertig, leere Beschriftung wird Karte", async () => {
        const id = await legeAn("Ersetzen Links der Probe");
        const stand = (await lies(id)).revision;
        const antwort = await setze(id, stand, [
            { url: "https://example.org/a", label: "  Die Karte  ", isPaid: false },
            { url: "http://example.org/b", label: "   ", isPaid: true },
            { url: "https://example.org/c", label: "Dritte", isPaid: null },
        ]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const karte = await lies(id);
        expect(karte.revision).toBe(stand + 1);
        expect(karte.links).toEqual([
            { role: "primary", url: "https://example.org/a", label: "Die Karte", isPaid: false },
            { role: "further", url: "http://example.org/b", label: "Karte", isPaid: true },
            { role: "further", url: "https://example.org/c", label: "Dritte", isPaid: null },
        ]);
        const gespeichert = await zeilen(id);
        expect(gespeichert.map((z) => [z.position, z.link_role, z.is_paid])).toEqual([
            [0, "primary", false],
            [1, "further", true],
            [2, "further", null],
        ]);
        expect(gespeichert.every((z) => z.source_system === "avesmaps3d" && z.legacy_origin === "manual")).toBe(true);
        const [protokoll] = await database<{ details: { fields: string[] }; target_revision: number }[]>`
            SELECT details, target_revision::int AS target_revision FROM media_audit_event
             WHERE citymap_public_id = ${id}::uuid AND action = 'citymap.updated'
        `;
        expect(protokoll!.details.fields).toEqual(["links"]);
        expect(protokoll!.target_revision).toBe(stand + 1);
    });

    it("Wegfallendes wird stillgelegt, die Folge ändert die Rolle, Früheres lebt wieder auf (dieselbe Zeile)", async () => {
        const id = await legeAn("Folge Links der Probe");
        let stand = (await lies(id)).revision;
        const a = { url: "https://example.org/a", label: "A", isPaid: null };
        const b = { url: "https://example.org/b", label: "B", isPaid: null };
        const c = { url: "https://example.org/c", label: "C", isPaid: false };
        expect((await setze(id, stand, [a, b])).statusCode).toBe(200);
        stand += 1;

        // Umstellen: b wird der Karten-Link, a rückt nach, c kommt dazu.
        expect((await setze(id, stand, [b, a, c])).statusCode).toBe(200);
        stand += 1;
        expect((await lies(id)).links.map((l) => [l.role, l.url])).toEqual([
            ["primary", b.url],
            ["further", a.url],
            ["further", c.url],
        ]);

        // a und c fallen weg: stillgelegt, nicht gelöscht.
        expect((await setze(id, stand, [b])).statusCode).toBe(200);
        stand += 1;
        expect((await lies(id)).links.map((l) => l.url)).toEqual([b.url]);
        const still = (await zeilen(id)).filter((z) => !z.is_active);
        expect(still.map((z) => z.url).sort()).toEqual([a.url, c.url]);
        expect(still.every((z) => z.state === "retired" && z.retired_origin === "editor")).toBe(true);

        // a kommt zurück, jetzt als Karten-Link: dieselbe Zeile, kein zweiter Eintrag.
        expect((await setze(id, stand, [{ ...a, label: "A neu", isPaid: true }, b])).statusCode).toBe(200);
        stand += 1;
        const karte = await lies(id);
        expect(karte.links).toEqual([
            { role: "primary", url: a.url, label: "A neu", isPaid: true },
            { role: "further", url: b.url, label: "B", isPaid: null },
        ]);
        const alle = await zeilen(id);
        expect(alle).toHaveLength(3);
        expect(alle.find((z) => z.url === a.url)).toMatchObject({
            is_active: true,
            state: "active",
            retired_origin: null,
        });

        // Leere Menge: alles still, der Eintrag hat keinen Link mehr.
        expect((await setze(id, stand, [])).statusCode).toBe(200);
        expect((await lies(id)).links).toEqual([]);
    });

    it("eine Adresse ohne http oder https und eine doppelte sind 400, nichts ändert sich", async () => {
        const id = await legeAn("Falsch Links der Probe");
        const stand = (await lies(id)).revision;
        for (const url of ["ftp://example.org/x", "example.org/x", "javascript:alert(1)", "https://", "https://a b"]) {
            const antwort = await setze(id, stand, [{ url, label: "X", isPaid: null }]);
            expect(antwort.statusCode, url).toBe(400);
        }
        const doppelt = await setze(id, stand, [
            { url: "https://example.org/x", label: "X", isPaid: null },
            { url: " https://example.org/x ", label: "Y", isPaid: false },
        ]);
        expect(doppelt.statusCode).toBe(400);
        const ohneWert = await setze(id, stand, [{ url: "https://example.org/x", label: "X" }]);
        expect(ohneWert.statusCode).toBe(400);
        const danach = await lies(id);
        expect(danach.revision).toBe(stand);
        expect(danach.links).toEqual([]);
        expect(await zeilen(id)).toEqual([]);
    });

    it("der gesehene Stand zählt (409), ohne Recht 403, dieselbe Kennung wirkt nur einmal", async () => {
        const id = await legeAn("Stand Links der Probe");
        const stand = (await lies(id)).revision;
        const link = [{ url: "https://example.org/s", label: "S", isPaid: null }];
        expect((await setze(id, stand + 3, link)).statusCode).toBe(409);
        expect((await setze(id, stand, link, leseCookie)).statusCode).toBe(403);
        const operationId = randomUUID();
        const body = { operationId, baseRevision: stand, links: link };
        const erste = await post(mediaKarteLinksUrl(id), body);
        expect(erste.statusCode, erste.body).toBe(200);
        const zweite = await post(mediaKarteLinksUrl(id), body);
        expect(zweite.json()).toEqual({ ...(erste.json() as OperationReceipt), status: "replayed" });
        expect((await lies(id)).revision).toBe(stand + 1);
    });

    it("ein stillgelegter Eintrag nimmt keine Links an (409 citymap_retired)", async () => {
        const id = await legeAn("Stillgelegt Links der Probe");
        const stand = (await lies(id)).revision;
        const entfernt = await post(mediaKarteStilllegenUrl(id), { operationId: randomUUID(), baseRevision: stand });
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        const antwort = await setze(id, stand + 1, [{ url: "https://example.org/s", label: "S", isPaid: null }]);
        expect(antwort.statusCode).toBe(409);
        expect(antwort.json()).toMatchObject({ error: { code: "citymap_retired" } });
    });

    it("was wegfällt, liest die Besucherseite nicht mehr (nur aktive Links)", async () => {
        const id = await legeAn("Besucher Links der Probe");
        let stand = (await lies(id)).revision;
        const bleibt = { url: "https://example.org/bleibt", label: "Bleibt", isPaid: false };
        const geht = { url: "https://example.org/geht", label: "Geht", isPaid: null };
        expect((await setze(id, stand, [bleibt, geht])).statusCode).toBe(200);
        stand += 1;
        expect((await setze(id, stand, [bleibt])).statusCode).toBe(200);
        const sichtbar = await database<{ url: string }[]>`
            SELECT l.url FROM citymap_link l JOIN citymap c ON c.id = l.citymap_id
             WHERE c.public_id = ${id}::uuid AND l.is_active AND l.state = 'active'
        `;
        expect(sichtbar.map((z) => z.url)).toEqual([bleibt.url]);
    });

    it("schreibt der Legacy-Zug gerade, ist das Ersetzen 503 und nichts ändert sich", async () => {
        const id = await legeAn("Zug Links der Probe");
        const stand = (await lies(id)).revision;
        const domaene = `test-karte-links-${randomUUID()}`;
        let freigeben: () => void = () => undefined;
        const halten = new Promise<void>((resolve) => {
            freigeben = resolve;
        });
        let steht: () => void = () => undefined;
        const gesperrt = new Promise<void>((resolve) => {
            steht = resolve;
        });
        const zug = database.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene}))`;
            steht();
            await halten;
        });
        await gesperrt;
        try {
            await expect(
                ersetzeKartenlinks(
                    database,
                    { personId, environment: "test" as const },
                    id,
                    {
                        operationId: randomUUID(),
                        baseRevision: stand,
                        links: [{ url: "https://example.org/z", label: "Z", isPaid: null }],
                    },
                    { mapDomainId: domaene },
                ),
            ).rejects.toMatchObject({ statusCode: 503, code: "map_import_running" });
        } finally {
            freigeben();
            await zug;
        }
        expect((await lies(id)).revision).toBe(stand);
        expect(await zeilen(id)).toEqual([]);
    });
});
