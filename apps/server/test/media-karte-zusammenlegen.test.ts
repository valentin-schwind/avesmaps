import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_KARTEN_URL,
    mediaKarteBildUrl,
    mediaKarteLinksUrl,
    mediaKarteQuellenUrl,
    mediaKarteStilllegenUrl,
    mediaKarteUrl,
    mediaKarteZurueckholenUrl,
    mediaKarteZusammenlegenUrl,
    type MamKarteDetail,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { legeKartenZusammen } from "../src/media-editor/kartensammlung-zusammenlegen.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertAsset, insertPlace, sha } from "./support/media-fixture.ts";
import { cleanEditorMedia } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Einträge der Kartensammlung zusammenlegen (WI-0287 Stufe 2, `citymap.merge`; „Bilder an anderen Eintrag geben“ im Dialog „Eintrag entfernen“), gegen echtes PostgreSQL:
 * Karten werden weitere Versionen des Ziels (die erste mit der übergebenen Bezeichnung, ein gleiches Werk nicht doppelt), die Vorschau zieht mit oder bleibt in der Liste,
 * Fundstellen, Publikationen und Orte, die dort fehlen, kommen dazu, die Einzelentscheidung einer Verwendung zieht mit; die Quelle wird stillgelegt, beide Einträge zählen eine
 * Revision hoch und tragen eine Zeile im Fachprotokoll, die sie gegen den Legacy-Zug hält; der stillgelegte nennt das Ziel. 409 bei stillgelegtem Ziel, Ziel gleich Quelle,
 * veraltetem Stand an Quelle oder Ziel; ohne Recht 403; während des Zugs 503. Zurückholen lässt die übergebenen Bilder am Ziel. Die Oberfläche prüft
 * `medien-karte-zusammenlegen-modell.test.ts` und `e2e/medien-karten-bilder.spec.ts`.
 */
describeWithDatabase("Einträge der Kartensammlung zusammenlegen (WI-0287 Stufe 2)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let cookie = "";
    let leseCookie = "";
    let personId = "";
    const personen: string[] = [];
    const orte: { id: string; publicId: string }[] = [];
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
    const stand = async (id: string): Promise<number> => (await lies(id)).revision;
    const muss = async (antwort: Promise<{ statusCode: number; body: string }>): Promise<void> => {
        const fertig = await antwort;
        expect(fertig.statusCode, fertig.body).toBe(200);
    };
    const legeAn = async (titel: string, places: string[] = []): Promise<string> => {
        const antwort = await post(MEDIA_KARTEN_URL, {
            operationId: randomUUID(),
            fields: { title: `Z287T ${titel}` },
            types: [],
            places,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "citymap")!.id;
    };
    let nummer = 0;
    /** Ein Werk ohne Datei; seine Art setzt das erste Binden. */
    const werk = async (): Promise<string> =>
        (await insertAsset(database, { ref: `z287t-${String(nummer++)}`, published: [] })).publicId;
    const binde = async (id: string, role: "map_full" | "map_preview", assetId: string, versionLabel?: string) =>
        muss(
            post(mediaKarteBildUrl(id), {
                operationId: randomUUID(),
                baseRevision: await stand(id),
                role,
                assetId,
                ...(versionLabel === undefined ? {} : { versionLabel }),
            }),
        );
    const links = async (id: string, urls: string[]) =>
        muss(
            post(mediaKarteLinksUrl(id), {
                operationId: randomUUID(),
                baseRevision: await stand(id),
                links: urls.map((url) => ({ url, label: `Link ${url.slice(-1)}`, isPaid: null })),
            }),
        );
    const publikation = async (id: string, sourceId: string, pages?: string) =>
        muss(
            post(mediaKarteQuellenUrl(id), {
                operationId: randomUUID(),
                baseRevision: await stand(id),
                op: "add",
                sourceId,
                ...(pages === undefined ? {} : { pages }),
            }),
        );
    const quelle = async (titel: string): Promise<string> => {
        const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
            VALUES (${`wikipub:z287t-${sha(titel).slice(0, 12)}`}, 'final', NULL, ${`Z287T ${titel}`}, 'regionalspielhilfe', TRUE)
            RETURNING public_id::text AS public_id
        `;
        return zeile!.public_id;
    };
    const zusammen = (
        id: string,
        body: { baseRevision: number; targetId: string; targetBaseRevision: number; versionLabel?: string | null },
        kekse = cookie,
    ) => post(mediaKarteZusammenlegenUrl(id), { operationId: randomUUID(), ...body }, kekse);
    const versionen = (karte: MamKarteDetail) =>
        karte.images
            .filter((bild) => bild.role === "map_full")
            .map((bild) => [bild.assetId, bild.versionLabel, bild.versionPosition]);
    const vorschau = (karte: MamKarteDetail) => karte.images.find((bild) => bild.role === "map_preview")?.assetId;
    const fehler = (antwort: { statusCode: number; json(): unknown }): string =>
        `${String(antwort.statusCode)} ${(antwort.json() as { error?: { code?: string } }).error?.code ?? ""}`.trim();

    const aufraeumen = async (): Promise<void> => {
        const ids = await database<{ id: string }[]>`
            SELECT id::text AS id FROM citymap WHERE title LIKE 'Z287T %' AND source_system = 'avesmaps3d'
        `;
        const kennungen = ids.map((zeile) => zeile.id);
        for (const tafel of [
            "citymap_media",
            "citymap_type",
            "citymap_place",
            "citymap_link",
            "citymap_source",
        ] as const) {
            await database.unsafe(`DELETE FROM ${tafel} WHERE citymap_id = ANY($1::bigint[])`, [
                `{${kennungen.join(",")}}`,
            ]);
        }
        await database`
            DELETE FROM media_audit_event
             WHERE citymap_public_id IN (SELECT public_id FROM citymap WHERE id = ANY(${kennungen}::bigint[]))
        `;
        await database`DELETE FROM citymap WHERE id = ANY(${kennungen}::bigint[])`;
        await database`DELETE FROM feature_source WHERE title LIKE 'Z287T %'`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        await cleanMediaFixtures(database);
        const fixture = authFixture(database);
        const redakteurin = await fixture.person("editor", { name: "Zusammenlegen Redakteurin" });
        const pruefer = await fixture.person("reviewer", { name: "Zusammenlegen Prüfer" });
        personId = redakteurin.id;
        personen.push(redakteurin.id, pruefer.id);
        cookie = (await fixture.session(redakteurin.id, { passkeyMinutesAgo: 1 })).cookie;
        leseCookie = (await fixture.session(pruefer.id, { passkeyMinutesAgo: 1 })).cookie;
        await cleanEditorMedia(database, personen);
        orte.push(await insertPlace(database, 288), await insertPlace(database, 289));
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
        await cleanEditorMedia(database, personen);
        await cleanMediaFixtures(database);
        await database.end();
    });

    it("🔴 Karten werden weitere Versionen, die Vorschau zieht mit, was dort fehlt, kommt dazu; die Quelle ist stillgelegt und nennt das Ziel; Zurückholen lässt die Bilder dort", async () => {
        const [hier, dort] = [orte[0]!, orte[1]!];
        const ziel = await legeAn("Re'Cha", [hier.publicId]);
        const spieler = await legeAn("Re'Cha Spielerversion", [hier.publicId, dort.publicId]);
        const [a, b, c, v] = [await werk(), await werk(), await werk(), await werk()];
        await binde(ziel, "map_full", a);
        await binde(spieler, "map_full", b);
        await binde(spieler, "map_full", c, "Alt");
        await binde(spieler, "map_preview", v);
        await links(ziel, ["https://z287t.example/1"]);
        await links(spieler, ["https://z287t.example/1", "https://z287t.example/2"]);
        const [band, heft] = [await quelle("Band"), await quelle("Heft")];
        await publikation(ziel, band);
        await publikation(spieler, band, "7");
        await publikation(spieler, heft, "12");
        // Eine Einzelentscheidung an der Verwendung (hier: gesperrt) geht beim Zusammenlegen nicht verloren.
        await database`
            UPDATE citymap_media m SET publication_override = 'blocked', override_decided_on = current_date, override_decided_by = ${personId}::uuid
              FROM media_asset w, citymap k
             WHERE w.id = m.media_asset_id AND w.public_id = ${c}::uuid AND k.id = m.citymap_id AND k.public_id = ${spieler}::uuid
        `;
        const vorher = { ziel: await stand(ziel), quelle: await stand(spieler) };

        const antwort = await zusammen(spieler, {
            baseRevision: vorher.quelle,
            targetId: ziel,
            targetBaseRevision: vorher.ziel,
            versionLabel: "  Spielerversion ",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as OperationReceipt;
        expect(quittung.affected).toEqual([
            { kind: "citymap", id: spieler, revision: vorher.quelle + 1 },
            { kind: "citymap", id: ziel, revision: vorher.ziel + 1 },
        ]);
        // Je Werk und Rolle ein Abgleich: zwei Karten, eine Vorschau.
        expect(quittung.derivedWork).toHaveLength(3);

        const danach = await lies(ziel);
        expect(versionen(danach)).toEqual([
            [a, null, 0],
            [b, "Spielerversion", 1],
            [c, "Alt", 2],
        ]);
        expect(vorschau(danach)).toBe(v);
        expect(danach.images.find((bild) => bild.assetId === c)?.override).toBe("blocked");
        expect(danach.links.map((link) => [link.role, link.url])).toEqual([
            ["primary", "https://z287t.example/1"],
            ["further", "https://z287t.example/2"],
        ]);
        expect(danach.publications?.map((p) => [p.title, p.pages, p.state])).toEqual([
            ["Z287T Band", null, "active"],
            ["Z287T Heft", "12", "active"],
        ]);
        expect(danach.places.map((ort) => ort.target?.id)).toEqual([hier.publicId, dort.publicId]);
        expect(danach.editorHeld).toBe(true);

        const still = await lies(spieler);
        expect(still).toMatchObject({
            state: "retired",
            active: false,
            images: [],
            handedTo: { id: ziel, title: "Z287T Re'Cha" },
        });
        // Fundstellen, Publikationen und Orte bleiben am stillgelegten Eintrag (Kopien, kein Umzug).
        expect(still.links).toHaveLength(2);
        expect(still.places).toHaveLength(2);

        const zeilen = await database<
            { eintrag: string; action: string; target_revision: number; details: Record<string, unknown> }[]
        >`
            SELECT citymap_public_id::text AS eintrag, action, target_revision::int AS target_revision, details FROM media_audit_event
             WHERE operation_id = ${quittung.operationId}::uuid ORDER BY id
        `;
        expect(zeilen).toEqual([
            {
                eintrag: spieler,
                action: "citymap.retired",
                target_revision: vorher.quelle + 1,
                details: { bindings: 3, handedTo: ziel },
            },
            {
                eintrag: ziel,
                action: "citymap.updated",
                target_revision: vorher.ziel + 1,
                details: { fields: ["images", "links", "sources", "places"], handedFrom: spieler },
            },
        ]);

        // Zurückholen: Der Eintrag ist wieder da, ohne Bilder; die übergebenen bleiben am Ziel.
        await muss(
            post(mediaKarteZurueckholenUrl(spieler), { operationId: randomUUID(), baseRevision: still.revision }),
        );
        const zurueck = await lies(spieler);
        expect(zurueck).toMatchObject({ state: "active", images: [], handedTo: null });
        expect(versionen(await lies(ziel))).toHaveLength(3);
    });

    it("dasselbe Werk am Ziel wird nicht doppelt geführt und bekommt die Bezeichnung; hat das Ziel eine Vorschau, bleibt die übergebene nur in der Liste", async () => {
        const sylla = await legeAn("Sylla");
        const sl = await legeAn("Sylla SL-Version");
        const [bild, eigene, fremde] = [await werk(), await werk(), await werk()];
        await binde(sylla, "map_full", bild);
        await binde(sylla, "map_preview", eigene);
        await binde(sl, "map_full", bild);
        await binde(sl, "map_preview", fremde);

        const antwort = await zusammen(sl, {
            baseRevision: await stand(sl),
            targetId: sylla,
            targetBaseRevision: await stand(sylla),
            versionLabel: "SL-Version",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const danach = await lies(sylla);
        expect(versionen(danach)).toEqual([[bild, "SL-Version", 0]]);
        expect(vorschau(danach)).toBe(eigene);
        const [zeilen] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id JOIN citymap c ON c.id = m.citymap_id
             WHERE a.public_id = ${bild}::uuid AND c.public_id = ${sylla}::uuid
        `;
        expect(zeilen!.n, "keine zweite Bindung desselben Werks").toBe(1);
        // Die übergebene Vorschau hängt nirgends mehr, das Werk bleibt.
        const [frei] = await database<{ aktiv: number; werk: number }[]>`
            SELECT (SELECT count(*)::int FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id
                     WHERE a.public_id = ${fremde}::uuid AND m.retired_at IS NULL) AS aktiv,
                   (SELECT count(*)::int FROM media_asset WHERE public_id = ${fremde}::uuid) AS werk
        `;
        expect(frei).toEqual({ aktiv: 0, werk: 1 });
        const [zeile] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM media_audit_event WHERE citymap_public_id = ${sylla}::uuid AND action = 'citymap.updated'
             ORDER BY id DESC LIMIT 1
        `;
        expect(zeile!.details).toEqual({ fields: ["images"], handedFrom: sl });
    });

    it("🔴 409 bei stillgelegtem Ziel, Ziel gleich Quelle, schon stillgelegter Quelle und veraltetem Stand an Quelle oder Ziel; 404 bei unbekanntem Ziel; ohne Recht 403; nichts ändert sich", async () => {
        const quelleId = await legeAn("Quelle");
        const zielId = await legeAn("Ziel");
        const stillId = await legeAn("Still");
        const karte = await werk();
        await binde(quelleId, "map_full", karte);
        await muss(
            post(mediaKarteStilllegenUrl(stillId), { operationId: randomUUID(), baseRevision: await stand(stillId) }),
        );
        const q = await stand(quelleId);
        const z = await stand(zielId);

        expect(
            fehler(await zusammen(quelleId, { baseRevision: q, targetId: zielId, targetBaseRevision: z }, leseCookie)),
        ).toBe("403 forbidden");
        expect(fehler(await zusammen(quelleId, { baseRevision: q, targetId: quelleId, targetBaseRevision: q }))).toBe(
            "409 citymap_merge_self",
        );
        expect(
            fehler(
                await zusammen(quelleId, {
                    baseRevision: q,
                    targetId: stillId,
                    targetBaseRevision: await stand(stillId),
                }),
            ),
        ).toBe("409 citymap_target_retired");
        expect(fehler(await zusammen(quelleId, { baseRevision: q + 4, targetId: zielId, targetBaseRevision: z }))).toBe(
            "409 edit_conflict",
        );
        expect(fehler(await zusammen(quelleId, { baseRevision: q, targetId: zielId, targetBaseRevision: z + 4 }))).toBe(
            "409 edit_conflict",
        );
        expect(
            fehler(await zusammen(quelleId, { baseRevision: q, targetId: randomUUID(), targetBaseRevision: 1 })),
        ).toBe("404 not_found");
        expect(
            fehler(
                await zusammen(stillId, {
                    baseRevision: await stand(stillId),
                    targetId: zielId,
                    targetBaseRevision: z,
                }),
            ),
        ).toBe("409 citymap_already_retired");

        const unveraendert = await lies(quelleId);
        expect(unveraendert).toMatchObject({ state: "active", revision: q });
        expect(versionen(unveraendert)).toEqual([[karte, null, 0]]);
        expect((await lies(zielId)).revision).toBe(z);
    });

    it("schreibt der Legacy-Zug gerade, ist das Zusammenlegen 503 und nichts ändert sich", async () => {
        const quelleId = await legeAn("Zug Quelle");
        const zielId = await legeAn("Zug Ziel");
        const q = await stand(quelleId);
        const z = await stand(zielId);
        const domaene = `test-karte-zusammen-${randomUUID()}`;
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
                legeKartenZusammen(
                    database,
                    { personId, environment: "test" as const },
                    quelleId,
                    { operationId: randomUUID(), baseRevision: q, targetId: zielId, targetBaseRevision: z },
                    { mapDomainId: domaene },
                ),
            ).rejects.toMatchObject({ statusCode: 503, code: "map_import_running" });
        } finally {
            freigeben();
            await zug;
        }
        expect((await lies(quelleId)).state).toBe("active");
        expect((await lies(zielId)).revision).toBe(z);
    });
});
