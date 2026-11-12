import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
    EDITOR_SPRACHEN_ARTIKEL_URL,
    EDITOR_SPRACHEN_URL,
    type MapHistoryPage,
    SpracheEditorDetail,
    SpracheEditorFlaecheForm,
    SpracheEditorListe,
    type SpracheEditorArtikelListe,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { polygoneVon, ringe } from "../src/editor/ring-form.ts";
import { rechneSprachTreffer } from "../src/jobs/sprachen-treffer-job.ts";
import { importSprachen } from "../src/migration/sprachen-import.ts";
import { schluesselAus } from "../src/sprachen/editor-schreiben.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Der Spracheditor (WI-0261 S5d) gegen echtes PostGIS, so wie auf dem VPS: Wegwerf-Cluster mit allen Vorlagen unter `src/db/`, Fastify als App-Rolle mit
 * angemeldeten Personen. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: ein Schreibweg ohne Fachprotokoll oder ohne Zielspalte; ein veralteter Entwurf überschreibt; wer die Sperre nicht hält, schreibt trotzdem; ohne
 * Recht wird geschrieben; ein Artikel gehört nach dem Verschieben zwei Sprachen oder die abgebende Sprache merkt nichts; das Umsortieren scheitert am Teilindex der
 * Stelle; eine umgeformte Fläche der Sprachenkarte fällt dem nächsten Import zum Opfer; eine stillgelegte Sprache hält ihre Artikel fest oder bleibt auf der Karte;
 * eine Fläche ändert sich ohne Auftrag für die Treffer; die Liste zählt die Zustände falsch; die Bitte um Freigabe kennt die Sprache nicht.
 *
 * Die kleine Welt: Karteneinheiten um 300–500, eigene Sprachen je Test über die Route, Wiki-Artikel als Zeilen des WikiSync.
 */

const ENV = "spreditor";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const DATEI_A = fileURLToPath(new URL("./fixtures/sprachen-import-a.geojson", import.meta.url));
const DATEI_B = fileURLToPath(new URL("./fixtures/sprachen-import-b.geojson", import.meta.url));
const describeWithCluster = postgresBin ? describe : describe.skip;
const SILENT = { write: () => undefined };

const quadrat = (x0: number, y0: number, x1: number, y1: number): number[][][][] => [
    [
        [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
        ],
    ],
];

interface Angemeldet {
    id: string;
    cookie: string;
    run: string;
}

interface Quittung {
    status: string;
    affected: { kind: string; id: string; revision?: number }[];
    derivedWork: { kind: string; jobId?: string; state: string }[];
    mapRevision?: number;
    publicId?: string;
    schluessel?: string;
    flaecheId?: string;
}

describe("Schlüssel aus dem Namen (ohne Datenbank)", () => {
    it("klein, Umlaute ausgeschrieben, Akzente weg, sonst Bindestrich, ein Buchstabe vorn, höchstens 48 Zeichen", () => {
        expect(schluesselAus("Thorwalsch")).toBe("thorwalsch");
        expect(schluesselAus("Ologhaijan / Oloarkh (Orkisch)")).toBe("ologhaijan-oloarkh-orkisch");
        expect(schluesselAus("Ölisch Süß")).toBe("oelisch-suess");
        expect(schluesselAus("Bosparano à la Façon")).toBe("bosparano-a-la-facon");
        expect(schluesselAus("7 Zungen")).toBe("s-7-zungen");
        expect(schluesselAus("  !!  ")).toBe("sprache");
        expect(schluesselAus("x".repeat(60))).toHaveLength(48);
        for (const name of ["Thorwalsch", "7 Zungen", "  !!  ", "Ölisch Süß", "a-".repeat(30)])
            expect(schluesselAus(name)).toMatch(/^[a-z][a-z0-9_-]*$/);
    });
});

describeWithCluster("Spracheditor (WI-0261 S5d, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    let server: FastifyInstance | undefined;
    let fixture: AuthFixture | undefined;
    let importer: Database | undefined;
    // Sprachen schreibt nur der Linguist, darüber Admins und Betreiber (WI-0279 E17a): `editorin` und `kollege` tragen die Sonderrolle, `redakteur` nicht.
    const personen: Record<"editorin" | "kollege" | "redakteur" | "reviewer" | "tester", Angemeldet> = {
        editorin: { id: "", cookie: "", run: randomUUID() },
        redakteur: { id: "", cookie: "", run: randomUUID() },
        kollege: { id: "", cookie: "", run: randomUUID() },
        reviewer: { id: "", cookie: "", run: randomUUID() },
        tester: { id: "", cookie: "", run: randomUUID() },
    };

    const db = (): VpsCluster => cluster!;
    const app = (): FastifyInstance => server!;

    const senden = (
        method: "GET" | "POST",
        url: string,
        wer: Angemeldet | undefined,
        payload?: object,
    ): Promise<LightMyRequestResponse> =>
        app().inject({
            method,
            url,
            headers: {
                host: "avesmaps.test",
                origin: TEST_ORIGIN,
                "user-agent": "Spracheditor-Test",
                ...(wer === undefined ? {} : { cookie: wer.cookie }),
            },
            ...(payload === undefined ? {} : { payload }),
        });
    // 🪤 Ohne Anmeldung nur über `senden`: Ein ausdrückliches `undefined` nähme hier die Vorgabe (die Editorin).
    const holen = (url: string, wer: Angemeldet = personen.editorin): Promise<LightMyRequestResponse> =>
        senden("GET", url, wer);
    const schicken = (
        url: string,
        payload?: object,
        wer: Angemeldet = personen.editorin,
    ): Promise<LightMyRequestResponse> => senden("POST", url, wer, payload);
    const ok = <T = Quittung>(antwort: LightMyRequestResponse, status = 200): T => {
        expect(antwort.statusCode, antwort.body).toBe(status);
        return antwort.json() as T;
    };
    const fehler = (antwort: LightMyRequestResponse): { status: number; code: string; details?: unknown } => ({
        status: antwort.statusCode,
        code: (antwort.json() as { error: { code: string } }).error.code,
        details: (antwort.json() as { error: { details?: unknown } }).error.details,
    });

    const sperren = (sprache: string, wer: Angemeldet = personen.editorin): Promise<LightMyRequestResponse> =>
        schicken("/api/editor/locks", { run: wer.run, kind: "sprache", id: sprache, part: "form" }, wer);
    const freigeben = async (sprache: string, wer: Angemeldet = personen.editorin): Promise<void> => {
        const antwort = await schicken(
            "/api/editor/locks/release",
            { run: wer.run, kind: "sprache", id: sprache },
            wer,
        );
        expect(antwort.statusCode).toBe(204);
    };
    const neueSprache = async (
        name: string,
        mehr: { wiki?: string[]; legende?: string } = {},
        wer: Angemeldet = personen.editorin,
    ): Promise<{ id: string; schluessel: string; revision: number }> => {
        const quittung = ok(
            await schicken(EDITOR_SPRACHEN_URL, { operationId: randomUUID(), name, farbe: "#8f6fb3", ...mehr }, wer),
        );
        return {
            id: quittung.publicId!,
            schluessel: quittung.schluessel!,
            revision: quittung.affected.find((a) => a.kind === "sprache" && a.id === quittung.publicId)!.revision!,
        };
    };
    const revisionVon = async (sprache: string): Promise<number> => {
        const [zeile] = await db().admin<{ revision: number }[]>`
            SELECT revision::int AS revision FROM sprache WHERE public_id = ${sprache}::uuid
        `;
        return zeile!.revision;
    };
    const artikel = async (titel: string, aktiv = true): Promise<string> => {
        const [zeile] = await db().admin<{ public_id: string }[]>`
            INSERT INTO wiki_sprache_artikel (schluessel, titel, kurzbeschreibung, sprachfamilie, is_active, retired_at, retired_origin)
            VALUES (${titel.toLowerCase()}, ${titel}, ${`Kurz zu ${titel}`}, 'Testfamilie', ${aktiv},
                    ${aktiv ? null : db().admin`now()`}, ${aktiv ? null : "wikisync"})
            RETURNING public_id::text
        `;
        return zeile!.public_id;
    };
    const pillen = async (sprache: string): Promise<{ titel: string; position: number }[]> =>
        db().admin`
            SELECT a.titel, w.position
              FROM sprache_wiki w JOIN sprache s ON s.id = w.sprache_id JOIN wiki_sprache_artikel a ON a.id = w.wiki_sprache_artikel_id
             WHERE s.public_id = ${sprache}::uuid AND w.is_active ORDER BY w.position
        `;
    const protokoll = async (
        operationId: string,
    ): Promise<
        { action: string; sprache: string | null; flaeche: string | null; changes: Record<string, unknown> }[]
    > =>
        db().admin`
            SELECT action, sprache_public_id::text AS sprache, sprache_flaeche_public_id::text AS flaeche, changes
              FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
        `;
    const trefferAuftraege = async (): Promise<{ public_id: string; input_ref: { sprachen?: string[] } }[]> =>
        db().admin`
            SELECT public_id::text, input_ref FROM job WHERE kind = 'sprache_treffer' AND state = 'QUEUED' ORDER BY id
        `;
    const inDerKachel = async (sprache: string): Promise<string[]> =>
        (
            await db().admin<{ id: string }[]>`
                SELECT public_id::text AS id FROM sprache_flaeche_render WHERE sprache_public_id = ${sprache}::uuid ORDER BY public_id
            `
        ).map((zeile) => zeile.id);
    const flaecheAn = async (
        sprache: string,
        polygons: number[][][][],
    ): Promise<{ id: string; quittung: Quittung }> => {
        const quittung = ok(
            await schicken(`${EDITOR_SPRACHEN_URL}/${sprache}/flaechen`, {
                operationId: randomUUID(),
                baseRevision: await revisionVon(sprache),
                polygons,
            }),
        );
        return { id: quittung.flaecheId!, quittung };
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN, { mapDomains: true });
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: "spracheditor",
            databaseUrl: undefined,
            tileRoot: undefined,
            auth: TEST_AUTH,
            mapEditing: "testwelt",
        };
        server = buildApp({ config, database: cluster.app, logStream: SILENT });
        await server.ready();
        fixture = authFixture(cluster.admin);
        for (const [rolle, wer] of [
            ["editor", personen.editorin],
            ["editor", personen.kollege],
            ["editor", personen.redakteur],
            ["reviewer", personen.reviewer],
            ["tester", personen.tester],
        ] as const) {
            const person = await fixture.person(rolle);
            wer.id = person.id;
            if (wer === personen.editorin || wer === personen.kollege) {
                await db().admin`
                    INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, granted_by, reason)
                    VALUES (${person.id}, 'test', 'linguist', ${person.id}, 'Probe E17a')
                `;
            }
            wer.cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        }
        // Der Import läuft als Migrationsrolle; zwei Verbindungen für die Sperre der Domäne und die Transaktion (Muster `sprachen-import.test.ts`).
        const o = cluster.migrator.options as unknown as {
            host: string[];
            port: number[];
            user: string;
            database: string;
        };
        importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, { max: 3 });
    }, 300_000);

    afterAll(async () => {
        await fixture?.cleanup();
        await server?.close();
        await importer?.end({ timeout: 5 });
        await cluster?.stop();
    }, 60_000);

    it("🔴 die Liste: vier Zustände, freie Wiki-Artikel als „nur im Wiki“, stillgelegte nur auf Wunsch; Rechte und ETag", async () => {
        const [a1, a2] = [await artikel("Listen-Eins"), await artikel("Listen-Zwei")];
        await artikel("Listen-Frei");
        await artikel("Listen-Verschwunden", false);
        const alpha = await neueSprache("Listen Alpha", { wiki: [a1] });
        const beta = await neueSprache("Listen Beta", { wiki: [a2] });
        const gamma = await neueSprache("Listen Gamma");
        const delta = await neueSprache("Listen Delta");
        const epsilon = await neueSprache("Listen Epsilon");
        for (const sprache of [alpha, gamma, epsilon]) {
            ok(await sperren(sprache.id));
            await flaecheAn(sprache.id, quadrat(300, 300, 320, 320));
        }
        ok(
            await schicken(`${EDITOR_SPRACHEN_URL}/${epsilon.id}/retire`, {
                operationId: randomUUID(),
                baseRevision: await revisionVon(epsilon.id),
            }),
        );

        const liste = ok<SpracheEditorListe>(await holen(EDITOR_SPRACHEN_URL));
        expect([...Value.Errors(SpracheEditorListe, liste)].map((e) => e.path)).toEqual([]);
        const zustand = (id: string): string | undefined => liste.zeilen.find((z) => z.id === id)?.zustand;
        expect(zustand(alpha.id)).toBe("platziert_wiki");
        expect(zustand(beta.id)).toBe("nur_wiki");
        expect(zustand(gamma.id)).toBe("platziert_ohne_wiki");
        expect(zustand(delta.id)).toBe("leer");
        expect(zustand(epsilon.id)).toBeUndefined();
        const frei = liste.zeilen.filter((z) => z.art === "artikel").map((z) => (z as { titel: string }).titel);
        expect(frei).toEqual(["Listen-Frei"]);
        expect(liste.zahlen).toEqual({ platziertWiki: 1, nurWiki: 2, platziertOhneWiki: 1, leer: 1 });
        const zeile = liste.zeilen.find((z) => z.id === alpha.id) as {
            wikiArtikel: number;
            ersterArtikel: string;
            teilflaechen: number;
        };
        expect(zeile).toMatchObject({ wikiArtikel: 1, ersterArtikel: "Listen-Eins", teilflaechen: 1 });

        const mitStillen = ok<SpracheEditorListe>(await holen(`${EDITOR_SPRACHEN_URL}?stillgelegt=true`));
        expect(mitStillen.zeilen.find((z) => z.id === epsilon.id)).toMatchObject({ aktiv: false });
        expect(mitStillen.zahlen).toEqual(liste.zahlen);

        // Lesen ab Reviewer; ohne Anmeldung 401, als Tester 403. Unverändert antwortet der Server 304.
        expect((await senden("GET", EDITOR_SPRACHEN_URL, undefined)).statusCode).toBe(401);
        expect((await holen(EDITOR_SPRACHEN_URL, personen.tester)).statusCode).toBe(403);
        const erste = await holen(EDITOR_SPRACHEN_URL, personen.reviewer);
        expect(erste.statusCode).toBe(200);
        const bedingt = await app().inject({
            method: "GET",
            url: EDITOR_SPRACHEN_URL,
            headers: { cookie: personen.reviewer.cookie, "if-none-match": erste.headers["etag"] as string },
        });
        expect(bedingt.statusCode).toBe(304);
    });

    it("🔴 Anlegen: Schlüssel aus dem Namen und eindeutig, Farbe klein, Herkunft redaktion, Protokoll mit Ziel; Wiederholung; ohne Recht 403", async () => {
        const operationId = randomUUID();
        const koerper = { operationId, name: "Ölisch", farbe: "#AABBCC", legende: "Ölisch (Testlegende)" };
        const erste = ok(await schicken(EDITOR_SPRACHEN_URL, koerper));
        expect(erste).toMatchObject({ status: "applied", schluessel: "oelisch" });
        const wieder = ok(await schicken(EDITOR_SPRACHEN_URL, koerper));
        expect(wieder).toMatchObject({ status: "replayed", publicId: erste.publicId, schluessel: "oelisch" });
        const zweite = await neueSprache("Ölisch");
        expect(zweite.schluessel).toBe("oelisch-2");

        const [zeile] = await db().admin<
            { farbe: string; herkunft: string; reihenfolge: number; legende: string; revision: number }[]
        >`
            SELECT farbe, herkunft, reihenfolge, legende, revision::int AS revision FROM sprache WHERE public_id = ${erste.publicId!}::uuid
        `;
        expect(zeile).toMatchObject({
            farbe: "#aabbcc",
            herkunft: "redaktion",
            legende: "Ölisch (Testlegende)",
            revision: 1,
        });
        const [hoechste] = await db().admin<{ n: number }[]>`SELECT max(reihenfolge)::int AS n FROM sprache`;
        expect(hoechste!.n).toBeGreaterThanOrEqual(zeile!.reihenfolge);
        expect(await protokoll(operationId)).toEqual([
            {
                action: "sprache.created",
                sprache: erste.publicId,
                flaeche: null,
                changes: expect.objectContaining({ schluessel: { after: "oelisch" }, farbe: { after: "#aabbcc" } }),
            },
        ]);
        // Name und Farbe gehen in keinen Treffer ein: kein Auftrag; die Karte erfährt es trotzdem (`map.changed` mit der Art `sprache`).
        expect(erste.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["tiles"]);
        const [ereignis] = await db().admin<{ payload: { operation: string; affected: { kind: string }[] } }[]>`
            SELECT payload FROM job_event WHERE kind = 'map.changed' AND seq = ${erste.mapRevision!}
        `;
        expect(ereignis!.payload).toMatchObject({ operation: "sprache.create", affected: [{ kind: "sprache" }] });

        for (const wer of [personen.redakteur, personen.reviewer, personen.tester]) {
            const abgewiesen = await schicken(
                EDITOR_SPRACHEN_URL,
                { operationId: randomUUID(), name: "Nein", farbe: "#000000" },
                wer,
            );
            expect(abgewiesen.statusCode).toBe(403);
        }
        expect(
            (
                await senden("POST", EDITOR_SPRACHEN_URL, undefined, {
                    operationId: randomUUID(),
                    name: "Nein",
                    farbe: "#000000",
                })
            ).statusCode,
        ).toBe(401);
        expect(
            (await schicken(EDITOR_SPRACHEN_URL, { operationId: randomUUID(), name: "   ", farbe: "#000000" }))
                .statusCode,
        ).toBe(400);
        expect(
            (await schicken(EDITOR_SPRACHEN_URL, { operationId: randomUUID(), name: "X", farbe: "rot" })).statusCode,
        ).toBe(400);
    });

    it("🔴 Ändern: ohne Sperre 409 lock_required, fremde Sperre 409 object_locked, veraltete Revision 409 edit_conflict; ohne Recht 403", async () => {
        const sprache = await neueSprache("Änderbar");
        const url = `${EDITOR_SPRACHEN_URL}/${sprache.id}/update`;
        const koerper = (baseRevision: number, mehr: object = { name: "Geändert", farbe: "#123ABC" }): object => ({
            operationId: randomUUID(),
            baseRevision,
            ...mehr,
        });
        expect(fehler(await schicken(url, koerper(1)))).toMatchObject({ status: 409, code: "lock_required" });

        ok(await sperren(sprache.id, personen.kollege));
        const fremd = fehler(await schicken(url, koerper(1)));
        expect(fremd).toMatchObject({
            status: 409,
            code: "object_locked",
            details: { lock: { person: { id: personen.kollege.id } } },
        });
        await freigeben(sprache.id, personen.kollege);

        ok(await sperren(sprache.id));
        const zuerst = koerper(1);
        const quittung = ok(await schicken(url, zuerst));
        expect(quittung.affected).toEqual([{ kind: "sprache", id: sprache.id, revision: 2 }]);
        expect(await protokoll((zuerst as { operationId: string }).operationId)).toEqual([
            {
                action: "sprache.updated",
                sprache: sprache.id,
                flaeche: null,
                changes: {
                    name: { before: "Änderbar", after: "Geändert" },
                    farbe: { before: "#8f6fb3", after: "#123abc" },
                },
            },
        ]);
        const veraltet = fehler(await schicken(url, koerper(1, { reihenfolge: 7 })));
        expect(veraltet).toMatchObject({
            status: 409,
            code: "edit_conflict",
            details: { currentRevision: 2, changedBy: { id: personen.editorin.id } },
        });
        // Legende leeren und Reihenfolge; nichts zu ändern ist 400; derselbe Wert ist keine Änderung (keine Revision).
        ok(await schicken(url, koerper(2, { legende: "Lang", reihenfolge: 7 })));
        ok(await schicken(url, koerper(3, { legende: "" })));
        expect(await revisionVon(sprache.id)).toBe(4);
        const gleich = ok(await schicken(url, koerper(4, { name: "Geändert" })));
        expect(gleich.affected).toEqual([{ kind: "sprache", id: sprache.id, revision: 4 }]);
        expect((await schicken(url, { operationId: randomUUID(), baseRevision: 4 })).statusCode).toBe(400);
        expect((await schicken(url, koerper(4), personen.reviewer)).statusCode).toBe(403);
        await freigeben(sprache.id);
    });

    it("🔴 Wiki: zuordnen, umsortieren (zweistufig), lösen; ein Artikel wandert von A nach B, beide im Protokoll; verschwundene und unbekannte abgewiesen", async () => {
        const [x, y, z] = [await artikel("Pille X"), await artikel("Pille Y"), await artikel("Pille Z")];
        const a = await neueSprache("Wiki A");
        const b = await neueSprache("Wiki B");
        ok(await sperren(a.id));
        const wiki = (sprache: string, baseRevision: number, liste: string[]) =>
            schicken(`${EDITOR_SPRACHEN_URL}/${sprache}/wiki`, {
                operationId: randomUUID(),
                baseRevision,
                artikel: liste,
            });

        ok(await wiki(a.id, 1, [x, y, z]));
        expect(await pillen(a.id)).toEqual([
            { titel: "Pille X", position: 0 },
            { titel: "Pille Y", position: 1 },
            { titel: "Pille Z", position: 2 },
        ]);
        expect(await revisionVon(a.id)).toBe(2);
        // Umsortieren: Z nach vorn, X ans Ende, Y bleibt in der Mitte; das scheitert ohne Zwischenstellen am Teilindex der Stelle.
        const umsortiert = { operationId: randomUUID(), baseRevision: 2, artikel: [z, y, x] };
        ok(await schicken(`${EDITOR_SPRACHEN_URL}/${a.id}/wiki`, umsortiert));
        expect((await pillen(a.id)).map((p) => p.titel)).toEqual(["Pille Z", "Pille Y", "Pille X"]);
        expect((await protokoll(umsortiert.operationId))[0]).toMatchObject({
            action: "sprache.wiki_changed",
            changes: {
                wiki: {
                    before: [{ titel: "Pille X" }, { titel: "Pille Y" }, { titel: "Pille Z" }],
                    after: [{ titel: "Pille Z" }, { titel: "Pille Y" }, { titel: "Pille X" }],
                },
            },
        });
        // Lösen: Y fällt weg und bleibt als stille Zeile stehen (Herkunft der Redaktion), nie gelöscht.
        ok(await wiki(a.id, 3, [z, x]));
        expect((await pillen(a.id)).map((p) => p.titel)).toEqual(["Pille Z", "Pille X"]);
        const [still] = await db().admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM sprache_wiki w JOIN wiki_sprache_artikel t ON t.id = w.wiki_sprache_artikel_id
             WHERE t.titel = 'Pille Y' AND NOT w.is_active AND w.retired_origin = 'editor'
        `;
        expect(still!.n).toBe(1);

        // Von A nach B: B nimmt X; A hält die Kollegin nicht, also geht es. A verliert X, beide Sprachen stehen im Protokoll, A zählt hoch.
        await freigeben(a.id);
        ok(await sperren(b.id, personen.kollege));
        const nehmen = { operationId: randomUUID(), baseRevision: 1, artikel: [x] };
        const quittung = ok(await schicken(`${EDITOR_SPRACHEN_URL}/${b.id}/wiki`, nehmen, personen.kollege));
        expect((await pillen(b.id)).map((p) => p.titel)).toEqual(["Pille X"]);
        expect((await pillen(a.id)).map((p) => p.titel)).toEqual(["Pille Z"]);
        expect(quittung.affected).toEqual([
            { kind: "sprache", id: b.id, revision: 2 },
            { kind: "sprache", id: a.id, revision: 5 },
        ]);
        expect((await protokoll(nehmen.operationId)).map((e) => [e.action, e.sprache])).toEqual([
            ["sprache.wiki_changed", b.id],
            ["sprache.wiki_released", a.id],
        ]);
        const [operation] = await db().admin<
            { summary: string }[]
        >`SELECT summary FROM map_operation WHERE operation_id = ${nehmen.operationId}::uuid`;
        expect(operation!.summary).toContain("„Pille X“ von „Wiki A“");

        // Hält jemand anderes A, nimmt B ihm nichts weg; und wer B nicht hält, schreibt B nicht.
        ok(await sperren(a.id));
        expect(fehler(await wiki(b.id, 2, [x, z]))).toMatchObject({ status: 409, code: "object_locked" });
        const fremd = await schicken(
            `${EDITOR_SPRACHEN_URL}/${b.id}/wiki`,
            { operationId: randomUUID(), baseRevision: 2, artikel: [x, z] },
            personen.kollege,
        );
        expect(fehler(fremd)).toMatchObject({ status: 409, code: "object_locked" });
        expect((await pillen(a.id)).map((p) => p.titel)).toEqual(["Pille Z"]);

        // Ein verschwundener Artikel kommt nicht neu dazu, ein unbekannter auch nicht.
        const weg = await artikel("Pille Verschwunden", false);
        expect(fehler(await wiki(a.id, 5, [z, weg]))).toMatchObject({ status: 400, code: "validation_failed" });
        expect(fehler(await wiki(a.id, 5, [z, randomUUID()]))).toMatchObject({
            status: 400,
            code: "validation_failed",
        });
        await freigeben(a.id);
        await freigeben(b.id, personen.kollege);
    });

    it("🔴 Teilfläche anlegen: Protokoll mit beiden Zielen, Kachelsicht, Auftrag sprache_treffer; Überlappung erlaubt, ungültig und außerhalb nicht", async () => {
        const sprache = await neueSprache("Flächig");
        const andere = await neueSprache("Daneben");
        ok(await sperren(andere.id));
        await flaecheAn(andere.id, quadrat(400, 400, 460, 460));
        await freigeben(andere.id);
        const ohneSperre = await schicken(`${EDITOR_SPRACHEN_URL}/${sprache.id}/flaechen`, {
            operationId: randomUUID(),
            baseRevision: 1,
            polygons: quadrat(420, 420, 480, 480),
        });
        expect(fehler(ohneSperre)).toMatchObject({ status: 409, code: "lock_required" });
        ok(await sperren(sprache.id));
        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const operationId = randomUUID();
        // Überlappt die andere Sprache (420–460): ausdrücklich erlaubt, nichts rastet ein.
        const quittung = ok(
            await schicken(`${EDITOR_SPRACHEN_URL}/${sprache.id}/flaechen`, {
                operationId,
                baseRevision: 1,
                polygons: quadrat(420, 420, 480, 480),
            }),
        );
        const flaeche = quittung.flaecheId!;
        expect(quittung.affected).toEqual([
            { kind: "sprache", id: sprache.id, revision: 1 },
            { kind: "sprache_flaeche", id: flaeche, revision: 1 },
        ]);
        expect(await protokoll(operationId)).toEqual([
            expect.objectContaining({ action: "sprache_flaeche.created", sprache: sprache.id, flaeche }),
        ]);
        expect(await inDerKachel(sprache.id)).toEqual([flaeche]);
        const [zeile] = await db().admin<{ herkunft: string; quelle_revision: string | null; flaeche: number }[]>`
            SELECT herkunft, quelle_revision, ST_Area(geom) AS flaeche FROM sprache_flaeche WHERE public_id = ${flaeche}::uuid
        `;
        expect(zeile).toEqual({ herkunft: "redaktion", quelle_revision: null, flaeche: 3600 });
        const auftrag = quittung.derivedWork.find((arbeit) => arbeit.kind === "sprache_treffer");
        expect(auftrag?.state).toBe("queued");
        expect((await trefferAuftraege()).map((j) => [j.public_id, j.input_ref.sprachen])).toEqual([
            [auftrag!.jobId, [sprache.id]],
        ]);

        const anlegen = (polygons: unknown) =>
            schicken(`${EDITOR_SPRACHEN_URL}/${sprache.id}/flaechen`, {
                operationId: randomUUID(),
                baseRevision: 1,
                polygons,
            });
        // Eine Schleife (Fliege) schneidet sich selbst; eine Ecke weit außerhalb liegt nicht in der Karte; zwei Ecken sind kein Ring.
        const fliege = [
            [
                [
                    [300, 300],
                    [340, 340],
                    [340, 300],
                    [300, 340],
                ],
            ],
        ];
        expect(fehler(await anlegen(fliege))).toMatchObject({ status: 400, code: "validation_failed" });
        expect(fehler(await anlegen(quadrat(-90000, -90000, -89000, -89000)))).toMatchObject({
            status: 400,
            code: "validation_failed",
        });
        expect(
            (
                await anlegen([
                    [
                        [
                            [300, 300],
                            [310, 310],
                        ],
                    ],
                ])
            ).statusCode,
        ).toBe(400);
        expect(await inDerKachel(sprache.id)).toEqual([flaeche]);
        await freigeben(sprache.id);
    });

    it("🔴 Umformen macht die Fläche zu einer der Redaktion; ein gleicher Import (und ein neuer) lässt sie in Ruhe", async () => {
        const datei = readFileSync(DATEI_A);
        const bericht = await importSprachen(importer!, datei);
        expect(bericht.flaechen.angelegt).toBeGreaterThan(0);
        const [garethi] = await db().admin<{ sprache: string; flaeche: string; revision: number; quelle: string }[]>`
            SELECT s.public_id::text AS sprache, f.public_id::text AS flaeche, f.revision::int AS revision, f.quelle_revision AS quelle
              FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id
             WHERE s.schluessel = 'garethi' AND f.is_active AND f.herkunft = 'sprachenkarte'
             ORDER BY f.id LIMIT 1
        `;
        expect(garethi!.quelle).toBe(bericht.quelleRevision);
        const url = `${EDITOR_SPRACHEN_URL}/${garethi!.sprache}/flaechen/${garethi!.flaeche}`;
        const form = ok<{ polygons: number[][][][]; revision: number; herkunft: string }>(await holen(url));
        expect([...Value.Errors(SpracheEditorFlaecheForm, form)].map((e) => e.path)).toEqual([]);
        expect(form).toMatchObject({ herkunft: "sprachenkarte", revision: garethi!.revision });

        ok(await sperren(garethi!.sprache));
        // Eine Ecke verschoben, die übrigen bitgenau.
        const neu = form.polygons.map((polygon) =>
            polygon.map((ring) => ring.map(([px, py], i) => (i === 0 ? [px! + 5, py!] : [px!, py!]))),
        );
        const operationId = randomUUID();
        const quittung = ok(
            await schicken(`${url}/reshape`, { operationId, baseRevision: garethi!.revision, polygons: neu }),
        );
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toContain("sprache_treffer");
        const [nachher] = await db().admin<
            { herkunft: string; quelle_revision: string | null; revision: number; geom: string; aktiv: boolean }[]
        >`
            SELECT herkunft, quelle_revision, revision::int AS revision, ST_AsText(geom) AS geom, is_active AS aktiv
              FROM sprache_flaeche WHERE public_id = ${garethi!.flaeche}::uuid
        `;
        expect(nachher).toMatchObject({
            herkunft: "redaktion",
            quelle_revision: null,
            revision: garethi!.revision + 1,
            aktiv: true,
        });
        expect((await protokoll(operationId))[0]).toMatchObject({
            action: "sprache_flaeche.reshaped",
            sprache: garethi!.sprache,
            flaeche: garethi!.flaeche,
            changes: {
                // Das Fachprotokoll trägt die ganze Form vorher und nachher, nicht nur, was sich bewegt hat (WI-0261 Stufe 2, Bedingung (d)).
                geometry: { before: form.polygons, after: neu },
                herkunft: { before: "sprachenkarte", after: "redaktion" },
                quelleRevision: { before: bericht.quelleRevision, after: null },
            },
        });
        // Veraltet: 409 mit wer und wann.
        expect(
            fehler(
                await schicken(`${url}/reshape`, {
                    operationId: randomUUID(),
                    baseRevision: garethi!.revision,
                    polygons: form.polygons,
                }),
            ),
        ).toMatchObject({ status: 409, code: "edit_conflict" });

        const unberuehrt = async (): Promise<void> => {
            const [jetzt] = await db().admin<{ revision: number; geom: string; aktiv: boolean; herkunft: string }[]>`
                SELECT revision::int AS revision, ST_AsText(geom) AS geom, is_active AS aktiv, herkunft FROM sprache_flaeche WHERE public_id = ${garethi!.flaeche}::uuid
            `;
            expect(jetzt).toEqual({
                revision: nachher!.revision,
                geom: nachher!.geom,
                aktiv: true,
                herkunft: "redaktion",
            });
        };
        // Derselbe Import noch einmal: Die Datei ist schon eingespielt, die umgeformte Fläche bleibt bitgenau.
        const wieder = await importSprachen(importer!, datei);
        expect(wieder.flaechen.dateiSchonEingespielt).toBe(true);
        await unberuehrt();
        // Eine neue Datei ersetzt nur die Flächen der Sprachenkarte; die der Redaktion bleibt aktiv und unverändert.
        const neue = await importSprachen(importer!, readFileSync(DATEI_B));
        expect(neue.flaechen.stillgelegt).toBeGreaterThan(0);
        expect(neue.flaechen.redaktionUnberuehrt).toBeGreaterThan(0);
        await unberuehrt();
        await freigeben(garethi!.sprache);
    });

    it("🔴 Pinselstrich an einer Teilfläche (Stufe 2): gerechnet, nichts geschrieben, ohne Sperre; fremde Teilfläche 404, ganz wegradiert 400, ohne Recht 403", async () => {
        const sprache = await neueSprache("Gemalt");
        const andere = await neueSprache("Ungemalt");
        ok(await sperren(sprache.id));
        const { id: flaeche } = await flaecheAn(sprache.id, quadrat(500, 500, 540, 520));
        await freigeben(sprache.id);
        ok(await sperren(andere.id));
        const { id: fremd } = await flaecheAn(andere.id, quadrat(600, 600, 620, 620));
        await freigeben(andere.id);
        const pinsel = (s: string, f: string) => `${EDITOR_SPRACHEN_URL}/${s}/flaechen/${f}/brush`;
        const strich = {
            mode: "malen",
            polygons: quadrat(500, 500, 540, 520),
            line: [
                [540, 510],
                [560, 510],
            ],
            radius: 5,
            quadSegs: 8,
        };
        const stand = async () =>
            db().admin`
                SELECT f.revision::int AS revision, ST_AsText(f.geom) AS geom,
                       (SELECT count(*)::int FROM map_audit_event e WHERE e.sprache_flaeche_public_id = f.public_id) AS protokoll
                  FROM sprache_flaeche f WHERE f.public_id = ${flaeche}::uuid
            `;
        const vorher = await stand();

        // Ohne Sperre: Der Strich schreibt nichts, also braucht er keine.
        const neu = ok<{ polygons: number[][][][] }>(await schicken(pinsel(sprache.id, flaeche), strich));
        expect(neu.polygons).toHaveLength(1);
        expect(Math.max(...neu.polygons[0]![0]!.map(([x]) => x!))).toBeCloseTo(565, 1);
        const geteilt = ok<{ polygons: number[][][][] }>(
            await schicken(pinsel(sprache.id, flaeche), {
                ...strich,
                mode: "radieren",
                line: [
                    [520, 490],
                    [520, 530],
                ],
                radius: 2,
            }),
        );
        expect(geteilt.polygons).toHaveLength(2);
        expect(await stand()).toEqual(vorher);

        expect(fehler(await schicken(pinsel(sprache.id, fremd), strich))).toMatchObject({
            status: 404,
            code: "not_found",
        });
        expect(
            fehler(
                await schicken(pinsel(sprache.id, flaeche), {
                    ...strich,
                    mode: "radieren",
                    line: [[520, 510]],
                    radius: 100,
                }),
            ),
        ).toMatchObject({ status: 400, code: "validation_failed" });
        expect((await schicken(pinsel(sprache.id, flaeche), strich, personen.reviewer)).statusCode).toBe(403);
        expect(await stand()).toEqual(vorher);
    });

    // --- Stufe 3: Unterflächen, Zerschneiden, Mit anderer Fläche, Kopieren (WI-0261) ---------------------------------------------------------------

    /** Die Teilfläche, wie sie gespeichert ist: Form (Ringe ohne Schlusspunkt, wie das Protokoll sie führt), Stand, Herkunft. */
    const gespeichert = async (
        flaeche: string,
    ): Promise<{
        ringe: number[][][][];
        aktiv: boolean;
        herkunft: string;
        quelle: string | null;
        still: string | null;
        revision: number;
        sprache: string;
    }> => {
        const [zeile] = await db().admin<
            {
                geojson: string;
                aktiv: boolean;
                herkunft: string;
                quelle: string | null;
                still: string | null;
                revision: number;
                sprache: string;
            }[]
        >`
            SELECT ST_AsGeoJSON(f.geom, 15) AS geojson, f.is_active AS aktiv, f.herkunft, f.quelle_revision AS quelle,
                   f.retired_origin AS still, f.revision::int AS revision, s.public_id::text AS sprache
              FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id WHERE f.public_id = ${flaeche}::uuid
        `;
        const { geojson, ...rest } = zeile!;
        return { ...rest, ringe: ringe(polygoneVon(geojson)) };
    };
    /** Wie viele Operationen unter dieser Kennung stehen (EINE je Werkzeug, auch über mehrere Teilflächen und Sprachen). */
    const operationen = async (operationId: string): Promise<number> => {
        const [zeile] = await db().admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id = ${operationId}::uuid
        `;
        return zeile!.n;
    };
    /** Die Sprachen, für die ein Auftrag `sprache_treffer` wartet. */
    const trefferFuer = async (): Promise<string[]> =>
        [...new Set((await trefferAuftraege()).flatMap((j) => j.input_ref.sprachen ?? []))].sort();
    /** Die Fläche einer Teilfläche in Karteneinheiten². */
    const flaecheVon = async (id: string): Promise<number> => {
        const [zeile] = await db().admin<{ a: number }[]>`
            SELECT ST_Area(geom) AS a FROM sprache_flaeche WHERE public_id = ${id}::uuid
        `;
        return zeile!.a;
    };
    const werkzeug = (sprache: string, flaeche: string, was: string) =>
        `${EDITOR_SPRACHEN_URL}/${sprache}/flaechen/${flaeche}/${was}`;
    const flaecheDerSprachenkarte = async (flaeche: string): Promise<void> => {
        await db().admin`
            UPDATE sprache_flaeche SET herkunft = 'sprachenkarte', quelle_revision = ${"5ab3".padEnd(64, "0")}
             WHERE public_id = ${flaeche}::uuid
        `;
    };

    it("🔴 Unterflächen (Stufe 3): vereinigen verschmilzt die zusammenhängenden Teilflächen der Sprache zu EINER, herauslösen macht eine eigene, löschen nimmt einen Teil; EINE Operation, jede Teilfläche mit ganzer Form im Protokoll", async () => {
        const sprache = await neueSprache("Zerteilt");
        ok(await sperren(sprache.id));
        // A: zwei getrennte Stücke; B überlappt A, C nur B (zusammenhängend über B); D liegt allein.
        const a = (await flaecheAn(sprache.id, [...quadrat(650, 650, 670, 670), ...quadrat(700, 650, 720, 670)])).id;
        const b = (await flaecheAn(sprache.id, quadrat(665, 650, 685, 670))).id;
        const c = (await flaecheAn(sprache.id, quadrat(683, 650, 695, 670))).id;
        const d = (await flaecheAn(sprache.id, quadrat(900, 900, 920, 920))).id;
        await flaecheDerSprachenkarte(a);
        const vorher = {
            a: await gespeichert(a),
            b: await gespeichert(b),
            c: await gespeichert(c),
            d: await gespeichert(d),
        };
        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;

        // Ohne Sperre nicht.
        await freigeben(sprache.id);
        expect(
            fehler(
                await schicken(werkzeug(sprache.id, a, "parts"), {
                    operationId: randomUUID(),
                    operation: "vereinigen",
                    baseRevision: vorher.a.revision,
                }),
            ),
        ).toMatchObject({ status: 409, code: "lock_required" });
        ok(await sperren(sprache.id));

        const vereint = randomUUID();
        const quittung = ok<Quittung & { partsBefore?: number; partsAfter?: number }>(
            await schicken(werkzeug(sprache.id, a, "parts"), {
                operationId: vereint,
                operation: "vereinigen",
                baseRevision: vorher.a.revision,
            }),
        );
        expect(quittung).toMatchObject({ partsBefore: 4, partsAfter: 2 });
        expect(await operationen(vereint)).toBe(1);
        const nachA = await gespeichert(a);
        expect(nachA).toMatchObject({ aktiv: true, herkunft: "redaktion", quelle: null });
        expect(nachA.ringe).toHaveLength(2);
        for (const weg of [b, c]) expect(await gespeichert(weg)).toMatchObject({ aktiv: false, still: "editor" });
        expect(await gespeichert(d)).toEqual(vorher.d);
        expect(await protokoll(vereint)).toEqual([
            expect.objectContaining({
                action: "sprache_flaeche.parts",
                sprache: sprache.id,
                flaeche: a,
                changes: {
                    geometry: { before: vorher.a.ringe, after: nachA.ringe },
                    herkunft: { before: "sprachenkarte", after: "redaktion" },
                    quelleRevision: { before: vorher.a.quelle, after: null },
                },
            }),
            expect.objectContaining({
                action: "sprache_flaeche.retired",
                flaeche: b,
                changes: { active: { before: true, after: false }, geometry: { before: vorher.b.ringe } },
            }),
            expect.objectContaining({
                action: "sprache_flaeche.retired",
                flaeche: c,
                changes: { active: { before: true, after: false }, geometry: { before: vorher.c.ringe } },
            }),
        ]);
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toContain("sprache_treffer");
        expect(await trefferFuer()).toEqual([sprache.id]);
        // Allein und aus einem Stück: nichts zu verschmelzen.
        expect(
            fehler(
                await schicken(werkzeug(sprache.id, d, "parts"), {
                    operationId: randomUUID(),
                    operation: "vereinigen",
                    baseRevision: vorher.d.revision,
                }),
            ),
        ).toMatchObject({ status: 400, code: "validation_failed" });

        // Herauslösen: das Stück bei 700 wird eine eigene Teilfläche derselben Sprache.
        const stueck = nachA.ringe.findIndex((polygon) => Math.min(...polygon[0]!.map(([x]) => x!)) === 700);
        expect(stueck).toBeGreaterThanOrEqual(0);
        const geloest = randomUUID();
        const herausgeloest = ok<Quittung>(
            await schicken(werkzeug(sprache.id, a, "parts"), {
                operationId: geloest,
                operation: "herausloesen",
                baseRevision: nachA.revision,
                part: stueck,
            }),
        );
        const e = herausgeloest.flaecheId!;
        expect(e).toBeDefined();
        const [nachA2, neuE] = [await gespeichert(a), await gespeichert(e)];
        expect(nachA2.ringe).toEqual([nachA.ringe[1 - stueck]]);
        expect(neuE).toMatchObject({ aktiv: true, herkunft: "redaktion", quelle: null, sprache: sprache.id });
        expect(neuE.ringe).toEqual([nachA.ringe[stueck]]);
        expect(await operationen(geloest)).toBe(1);
        expect(await protokoll(geloest)).toEqual([
            expect.objectContaining({
                action: "sprache_flaeche.parts",
                flaeche: a,
                changes: { geometry: { before: nachA.ringe, after: nachA2.ringe } },
            }),
            expect.objectContaining({
                action: "sprache_flaeche.created",
                flaeche: e,
                changes: {
                    geometry: { after: neuE.ringe },
                    herkunft: { after: "redaktion" },
                    active: { after: true },
                },
            }),
        ]);
        // Aus einem Stück gibt es nichts herauszulösen.
        expect(
            fehler(
                await schicken(werkzeug(sprache.id, a, "parts"), {
                    operationId: randomUUID(),
                    operation: "herausloesen",
                    baseRevision: nachA2.revision,
                    part: 0,
                }),
            ),
        ).toMatchObject({ status: 400, code: "validation_failed" });

        // Löschen nimmt genau den gewählten Teil.
        const f = (await flaecheAn(sprache.id, [...quadrat(750, 750, 760, 760), ...quadrat(775, 750, 785, 760)])).id;
        const vorF = await gespeichert(f);
        const geloescht = randomUUID();
        ok(
            await schicken(werkzeug(sprache.id, f, "parts"), {
                operationId: geloescht,
                operation: "loeschen",
                baseRevision: vorF.revision,
                part: 0,
            }),
        );
        const nachF = await gespeichert(f);
        expect(nachF.ringe).toEqual([vorF.ringe[1]]);
        expect(await protokoll(geloescht)).toEqual([
            expect.objectContaining({
                action: "sprache_flaeche.parts",
                flaeche: f,
                changes: { geometry: { before: vorF.ringe, after: nachF.ringe } },
            }),
        ]);
        // Ein alter Stand ist 409, eine Teilfläche einer anderen Sprache 404.
        expect(
            fehler(
                await schicken(werkzeug(sprache.id, f, "parts"), {
                    operationId: randomUUID(),
                    operation: "vereinigen",
                    baseRevision: vorF.revision,
                }),
            ),
        ).toMatchObject({ status: 409, code: "edit_conflict" });
        const fremd = await neueSprache("Unzerteilt");
        expect(
            fehler(
                await schicken(werkzeug(fremd.id, f, "parts"), {
                    operationId: randomUUID(),
                    operation: "vereinigen",
                    baseRevision: nachF.revision,
                }),
            ),
        ).toMatchObject({ status: 404, code: "not_found" });
        await freigeben(sprache.id);
    });

    it("🔴 Zerschneiden (Stufe 3): exakt an der Linie, das größere Stück bleibt, das kleinere wird eine neue Teilfläche derselben Sprache; quert sie nicht, 400 und nichts geschrieben", async () => {
        const sprache = await neueSprache("Zerschnitten");
        ok(await sperren(sprache.id));
        const g = (await flaecheAn(sprache.id, quadrat(800, 800, 860, 840))).id;
        await flaecheDerSprachenkarte(g);
        const vorG = await gespeichert(g);
        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;

        expect(
            fehler(
                await schicken(werkzeug(sprache.id, g, "split"), {
                    operationId: randomUUID(),
                    baseRevision: vorG.revision,
                    line: [
                        [820, 790],
                        [820, 820],
                    ],
                }),
            ),
        ).toMatchObject({ status: 400, code: "validation_failed" });
        expect(await gespeichert(g)).toEqual(vorG);

        const schnitt = randomUUID();
        const quittung = ok<Quittung>(
            await schicken(werkzeug(sprache.id, g, "split"), {
                operationId: schnitt,
                baseRevision: vorG.revision,
                line: [
                    [820, 790],
                    [820, 850],
                ],
            }),
        );
        const h = quittung.flaecheId!;
        const [nachG, neuH] = [await gespeichert(g), await gespeichert(h)];
        expect(await flaecheVon(g)).toBeCloseTo(1600, 6);
        expect(await flaecheVon(h)).toBeCloseTo(800, 6);
        expect(nachG).toMatchObject({ aktiv: true, herkunft: "redaktion", quelle: null });
        expect(neuH).toMatchObject({ aktiv: true, herkunft: "redaktion", sprache: sprache.id });
        expect(await operationen(schnitt)).toBe(1);
        expect(await protokoll(schnitt)).toEqual([
            expect.objectContaining({
                action: "sprache_flaeche.split",
                flaeche: g,
                changes: {
                    geometry: { before: vorG.ringe, after: nachG.ringe },
                    herkunft: { before: "sprachenkarte", after: "redaktion" },
                    quelleRevision: { before: vorG.quelle, after: null },
                },
            }),
            expect.objectContaining({
                action: "sprache_flaeche.created",
                flaeche: h,
                changes: {
                    geometry: { after: neuH.ringe },
                    herkunft: { after: "redaktion" },
                    active: { after: true },
                },
            }),
        ]);
        expect(await trefferFuer()).toEqual([sprache.id]);
        await freigeben(sprache.id);
    });

    it("🔴 Mit anderer Fläche (Stufe 3): nur Teilflächen anderer Sprachen; Vorschau schreibt nichts; vereinigen legt die andere still (EINE Operation, beide Sprachen, beide Sperren), behalten braucht nur keine fremde Sperre", async () => {
        const x = await neueSprache("Verknuepft");
        const y = await neueSprache("Verschluckt");
        ok(await sperren(x.id));
        const q = (await flaecheAn(x.id, quadrat(600, 900, 640, 940))).id;
        const eigene = (await flaecheAn(x.id, quadrat(610, 900, 650, 940))).id;
        await freigeben(x.id);
        ok(await sperren(y.id));
        const z = (await flaecheAn(y.id, quadrat(620, 900, 660, 940))).id;
        const w = (await flaecheAn(y.id, quadrat(630, 900, 680, 940))).id;
        await freigeben(y.id);
        const vorQ = await gespeichert(q);
        const vorZ = await gespeichert(z);

        // Die Vorschau rechnet ohne Sperre und schreibt nichts; die andere Sprache bleibt immer (`targetLandscapeGoes`).
        const vorschau = ok<{
            polygons: number[][][][];
            targetName: string;
            consumesTarget: boolean;
            targetLandscapeGoes: boolean;
            areaRevision: number;
            targetAreaRevision: number;
        }>(await schicken(werkzeug(x.id, q, "boolean-preview"), { operation: "vereinigen", targetAreaId: z }));
        expect(vorschau).toMatchObject({
            targetName: "Verschluckt",
            consumesTarget: true,
            targetLandscapeGoes: false,
            areaRevision: vorQ.revision,
            targetAreaRevision: vorZ.revision,
        });
        expect(await gespeichert(q)).toEqual(vorQ);
        // Eine Teilfläche derselben Sprache ist kein Ziel.
        expect(
            fehler(
                await schicken(werkzeug(x.id, q, "boolean-preview"), { operation: "vereinigen", targetAreaId: eigene }),
            ),
        ).toMatchObject({ status: 400, code: "validation_failed" });

        const body = (operationId: string, operation: string, ziel: string, zielRevision: number) => ({
            operationId,
            operation,
            baseRevision: vorQ.revision,
            targetAreaId: ziel,
            targetBaseRevision: zielRevision,
        });
        // Vereinigen legt die andere still: Das verlangt auch die Sperre ihrer Sprache.
        ok(await sperren(x.id));
        expect(
            fehler(await schicken(werkzeug(x.id, q, "boolean"), body(randomUUID(), "vereinigen", z, vorZ.revision))),
        ).toMatchObject({ status: 409, code: "lock_required" });
        expect(await gespeichert(q)).toEqual(vorQ);
        expect(await gespeichert(z)).toEqual(vorZ);
        expect(
            fehler(await schicken(werkzeug(x.id, q, "boolean"), body(randomUUID(), "vereinigen", eigene, 1))),
        ).toMatchObject({ status: 400, code: "validation_failed" });

        ok(await sperren(y.id));
        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const vereint = randomUUID();
        const quittung = ok<Quittung>(
            await schicken(werkzeug(x.id, q, "boolean"), body(vereint, "vereinigen", z, vorZ.revision)),
        );
        const [nachQ, nachZ] = [await gespeichert(q), await gespeichert(z)];
        expect(nachQ.ringe).toHaveLength(1);
        expect(await flaecheVon(q)).toBeCloseTo(2400, 6);
        expect(nachZ).toMatchObject({ aktiv: false, still: "editor", ringe: vorZ.ringe });
        expect(await operationen(vereint)).toBe(1);
        expect(await protokoll(vereint)).toEqual([
            expect.objectContaining({
                action: "sprache_flaeche.boolean",
                sprache: x.id,
                flaeche: q,
                changes: { geometry: { before: vorQ.ringe, after: nachQ.ringe } },
            }),
            expect.objectContaining({
                action: "sprache_flaeche.retired",
                sprache: y.id,
                flaeche: z,
                changes: { active: { before: true, after: false }, geometry: { before: vorZ.ringe } },
            }),
        ]);
        expect(quittung.affected.filter((a) => a.kind === "sprache").map((a) => a.id)).toEqual([x.id, y.id]);
        expect(await trefferFuer()).toEqual([x.id, y.id].sort());
        await freigeben(y.id);

        // Die Schnittmenge lässt die andere stehen: ohne ihre Sperre, solange kein anderer sie hält.
        const vorW = await gespeichert(w);
        const schnitt = randomUUID();
        ok(
            await schicken(werkzeug(x.id, q, "boolean"), {
                ...body(schnitt, "schnittmenge", w, vorW.revision),
                baseRevision: nachQ.revision,
            }),
        );
        expect(await gespeichert(w)).toEqual(vorW);
        expect((await protokoll(schnitt)).map((zeile) => [zeile.action, zeile.flaeche])).toEqual([
            ["sprache_flaeche.boolean", q],
        ]);
        ok(await sperren(y.id, personen.kollege));
        const nachQ2 = await gespeichert(q);
        expect(
            fehler(
                await schicken(werkzeug(x.id, q, "boolean"), {
                    ...body(randomUUID(), "vereinigen-behalten", w, vorW.revision),
                    baseRevision: nachQ2.revision,
                }),
            ),
        ).toMatchObject({ status: 409, code: "object_locked" });
        await freigeben(y.id, personen.kollege);
        await freigeben(x.id);
    });

    it("🔴 Kopieren (Stufe 3): eine KOPIE in einer anderen Sprache (beide Sperren), mit Haken ein Umziehen; EINE Operation mit beiden Teilflächen im Protokoll", async () => {
        const k = await neueSprache("Kopierquelle");
        const l = await neueSprache("Kopierziel");
        ok(await sperren(k.id));
        const t = (await flaecheAn(k.id, quadrat(950, 950, 990, 990))).id;
        await flaecheDerSprachenkarte(t);
        const vorT = await gespeichert(t);
        const kopie = (operationId: string, deleteSource: boolean, ziel = l.id) => ({
            operationId,
            baseRevision: vorT.revision,
            targetId: ziel,
            deleteSource,
        });

        expect(fehler(await schicken(werkzeug(k.id, t, "copy"), kopie(randomUUID(), false)))).toMatchObject({
            status: 409,
            code: "lock_required",
        });
        expect(fehler(await schicken(werkzeug(k.id, t, "copy"), kopie(randomUUID(), false, k.id)))).toMatchObject({
            status: 400,
            code: "validation_failed",
        });
        ok(await sperren(l.id));
        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const kopiert = randomUUID();
        const quittung = ok<Quittung>(await schicken(werkzeug(k.id, t, "copy"), kopie(kopiert, false)));
        const neu = quittung.flaecheId!;
        expect(neu).not.toBe(t);
        expect(await gespeichert(neu)).toMatchObject({
            aktiv: true,
            herkunft: "redaktion",
            quelle: null,
            sprache: l.id,
            ringe: vorT.ringe,
        });
        expect(await gespeichert(t)).toEqual(vorT);
        expect(await operationen(kopiert)).toBe(1);
        expect(await protokoll(kopiert)).toEqual([
            expect.objectContaining({
                action: "sprache_flaeche.copied",
                sprache: l.id,
                flaeche: neu,
                changes: { geometry: { after: vorT.ringe }, herkunft: { after: "redaktion" }, active: { after: true } },
            }),
        ]);
        expect(await trefferFuer()).toEqual([l.id]);

        // Mit Haken: die Quelle wird stillgelegt, in derselben Operation.
        const umgezogen = randomUUID();
        const zweite = ok<Quittung>(await schicken(werkzeug(k.id, t, "copy"), kopie(umgezogen, true)));
        expect(await gespeichert(t)).toMatchObject({ aktiv: false, still: "editor" });
        expect(await operationen(umgezogen)).toBe(1);
        expect(await protokoll(umgezogen)).toEqual([
            expect.objectContaining({ action: "sprache_flaeche.copied", sprache: l.id, flaeche: zweite.flaecheId }),
            expect.objectContaining({
                action: "sprache_flaeche.retired",
                sprache: k.id,
                flaeche: t,
                changes: { active: { before: true, after: false }, geometry: { before: vorT.ringe } },
            }),
        ]);
        // Die Sprache der Quelle bleibt, auch ohne Teilfläche.
        const [quelleSprache] = await db().admin<{ aktiv: boolean }[]>`
            SELECT is_active AS aktiv FROM sprache WHERE public_id = ${k.id}::uuid
        `;
        expect(quelleSprache!.aktiv).toBe(true);
        await freigeben(l.id);
        await freigeben(k.id);
    });

    it("🔴 Kopieren in eine NEUE Sprache (Stufe 3, „Ja, auch neue“): Sprache und Kopie in EINER Operation, Protokoll mit beiden, Treffer für beide; Name wie beim Anlegen; genau eines von Ziel und neuer Sprache", async () => {
        const k = await neueSprache("Auswanderquelle");
        ok(await sperren(k.id));
        const t = (await flaecheAn(k.id, quadrat(880, 600, 900, 620))).id;
        const u = (await flaecheAn(k.id, quadrat(880, 640, 900, 660))).id;
        const vorT = await gespeichert(t);
        const zahl = async (): Promise<number> => {
            const [zeile] = await db().admin<{ n: number }[]>`SELECT count(*)::int AS n FROM sprache`;
            return zeile!.n;
        };
        const sprachen = await zahl();
        const basis = { baseRevision: vorT.revision, deleteSource: true };

        // Genau eines von `targetId` und `neueSprache`; ein leerer Name wie beim Anlegen 400. Nichts ist angelegt.
        for (const falsch of [
            { ...basis },
            { ...basis, targetId: (await neueSprache("Auswanderdritte")).id, neueSprache: { name: "Doppelt" } },
            { ...basis, neueSprache: { name: "   " } },
            { ...basis, neueSprache: { name: "Bunt", farbe: "rot" } },
        ])
            expect(
                fehler(await schicken(werkzeug(k.id, t, "copy"), { operationId: randomUUID(), ...falsch })),
                JSON.stringify(falsch),
            ).toMatchObject({ status: 400, code: "validation_failed" });
        expect(await zahl()).toBe(sprachen + 1);
        // Ohne die Sperre der Quelle: 409, und die neue Sprache entsteht auch nicht.
        await freigeben(k.id);
        expect(
            fehler(
                await schicken(werkzeug(k.id, t, "copy"), {
                    operationId: randomUUID(),
                    ...basis,
                    neueSprache: { name: "Auswanderziel" },
                }),
            ),
        ).toMatchObject({ status: 409, code: "lock_required" });
        expect(await zahl()).toBe(sprachen + 1);
        ok(await sperren(k.id));

        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const umzug = randomUUID();
        const quittung = ok<Quittung & { spracheId?: string }>(
            await schicken(werkzeug(k.id, t, "copy"), {
                operationId: umzug,
                ...basis,
                neueSprache: { name: "Auswanderziel" },
            }),
        );
        const neu = quittung.spracheId!;
        const kopie = quittung.flaecheId!;
        expect(await operationen(umzug)).toBe(1);
        const [zeile] = await db().admin<
            { schluessel: string; name: string; farbe: string; herkunft: string; reihenfolge: number; aktiv: boolean }[]
        >`
            SELECT schluessel, name, farbe, herkunft, reihenfolge, is_active AS aktiv FROM sprache WHERE public_id = ${neu}::uuid
        `;
        expect(zeile).toMatchObject({
            schluessel: "auswanderziel",
            name: "Auswanderziel",
            farbe: "#8f6fb3",
            herkunft: "redaktion",
            aktiv: true,
        });
        const [hoechste] = await db().admin<{ n: number }[]>`SELECT max(reihenfolge)::int AS n FROM sprache`;
        expect(zeile!.reihenfolge).toBe(hoechste!.n);
        expect(await gespeichert(kopie)).toMatchObject({
            aktiv: true,
            herkunft: "redaktion",
            quelle: null,
            sprache: neu,
            ringe: vorT.ringe,
        });
        expect(await gespeichert(t)).toMatchObject({ aktiv: false, still: "editor" });
        expect(await protokoll(umzug)).toEqual([
            expect.objectContaining({
                action: "sprache.created",
                sprache: neu,
                flaeche: null,
                changes: expect.objectContaining({
                    schluessel: { after: "auswanderziel" },
                    name: { after: "Auswanderziel" },
                    farbe: { after: "#8f6fb3" },
                    herkunft: { after: "redaktion" },
                    active: { after: true },
                }),
            }),
            expect.objectContaining({
                action: "sprache_flaeche.copied",
                sprache: neu,
                flaeche: kopie,
                changes: { geometry: { after: vorT.ringe }, herkunft: { after: "redaktion" }, active: { after: true } },
            }),
            expect.objectContaining({
                action: "sprache_flaeche.retired",
                sprache: k.id,
                flaeche: t,
                changes: { active: { before: true, after: false }, geometry: { before: vorT.ringe } },
            }),
        ]);
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toContain("sprache_treffer");
        expect(await trefferFuer()).toEqual([k.id, neu].sort());

        // Der Name ist schon vergeben: wie beim Anlegen kein Fehler, der Schlüssel wird eindeutig gemacht; eine gewählte Farbe gilt.
        const vorU = await gespeichert(u);
        const zweite = ok<Quittung & { spracheId?: string }>(
            await schicken(werkzeug(k.id, u, "copy"), {
                operationId: randomUUID(),
                baseRevision: vorU.revision,
                neueSprache: { name: "Auswanderziel", farbe: "#112233" },
                deleteSource: false,
            }),
        );
        const [doppelt] = await db().admin<{ schluessel: string; farbe: string }[]>`
            SELECT schluessel, farbe FROM sprache WHERE public_id = ${zweite.spracheId!}::uuid
        `;
        expect(doppelt).toEqual({ schluessel: "auswanderziel-2", farbe: "#112233" });
        expect(await gespeichert(u)).toEqual(vorU);
        await freigeben(k.id);
    });

    it("🔴 eine Fläche der Derographie in eine Sprache (WI-0261, „Ja, bauen“): EINE Operation mit eigener Aktion, Protokoll mit Quelle, Treffer; neue oder bestehende Sprache, Sperre, 404; region_area unverändert", async () => {
        const regionId = randomUUID();
        const areaId = randomUUID();
        await db().admin`
            WITH r AS (
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system)
                VALUES (${regionId}::uuid, 'aventuria', 'Spenderwald', 'vegetation', 'wald', 'spreditor')
                RETURNING id
            )
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${areaId}::uuid, r.id, 'aventuria',
                   ST_GeomFromText('MULTIPOLYGON(((900 700, 940 700, 940 740, 900 740, 900 700)), ((960 700, 980 700, 980 720, 960 720, 960 700)))', 0),
                   'spreditor'
              FROM r
        `;
        const landschaft = async () => {
            const [zeile] = await db().admin<{ revision: number; geom: string; aktiv: boolean }[]>`
                SELECT revision::int AS revision, ST_AsText(geom) AS geom, is_active AS aktiv FROM region_area WHERE public_id = ${areaId}::uuid
            `;
            const [ereignisse] = await db().admin<{ n: number }[]>`
                SELECT count(*)::int AS n FROM map_audit_event
                 WHERE region_area_public_id = ${areaId}::uuid OR region_public_id = ${regionId}::uuid
            `;
            return { ...zeile!, ereignisse: ereignisse!.n };
        };
        const vorher = await landschaft();
        const [quelle] = await db().admin<{ geojson: string }[]>`
            SELECT ST_AsGeoJSON(geom, 15) AS geojson FROM region_area WHERE public_id = ${areaId}::uuid
        `;
        const ringeDerQuelle = ringe(polygoneVon(quelle!.geojson));
        const URL_AUS = `${EDITOR_SPRACHEN_URL}/aus-landschaft`;
        const zahl = async (): Promise<number> => {
            const [zeile] = await db().admin<{ n: number }[]>`SELECT count(*)::int AS n FROM sprache`;
            return zeile!.n;
        };

        // Genau eines von Ziel und neuer Sprache; unbekannte Landschaft oder Fläche 404; nichts angelegt.
        const bestehende = await neueSprache("Empfaengersprache");
        const sprachen = await zahl();
        for (const falsch of [
            { regionId, areaId },
            { regionId, areaId, targetId: bestehende.id, neueSprache: { name: "Doppelt" } },
        ])
            expect(fehler(await schicken(URL_AUS, { operationId: randomUUID(), ...falsch }))).toMatchObject({
                status: 400,
                code: "validation_failed",
            });
        for (const falsch of [
            { regionId: randomUUID(), areaId },
            { regionId, areaId: randomUUID() },
        ])
            expect(
                fehler(
                    await schicken(URL_AUS, { operationId: randomUUID(), ...falsch, neueSprache: { name: "Niemand" } }),
                ),
            ).toMatchObject({ status: 404, code: "not_found" });
        expect(await zahl()).toBe(sprachen);
        // Eine bestehende Zielsprache verlangt ihre Sperre (wie beim Kopieren).
        expect(
            fehler(await schicken(URL_AUS, { operationId: randomUUID(), regionId, areaId, targetId: bestehende.id })),
        ).toMatchObject({ status: 409, code: "lock_required" });

        // In eine NEUE Sprache: ohne Sperre, EINE Operation mit eigener Aktion.
        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const neuOp = randomUUID();
        const neu = ok<Quittung & { spracheId?: string }>(
            await schicken(URL_AUS, {
                operationId: neuOp,
                regionId,
                areaId,
                neueSprache: { name: "Waldsprache" },
            }),
        );
        const neueId = neu.spracheId!;
        expect(await operationen(neuOp)).toBe(1);
        const [aktion] = await db().admin<{ action: string }[]>`
            SELECT action FROM map_operation WHERE operation_id = ${neuOp}::uuid
        `;
        expect(aktion!.action).toBe("sprache.flaeche_aus_landschaft");
        expect(await gespeichert(neu.flaecheId!)).toMatchObject({
            aktiv: true,
            herkunft: "redaktion",
            quelle: null,
            sprache: neueId,
            ringe: ringeDerQuelle,
        });
        const quelleImProtokoll = { regionId, areaId, name: "Spenderwald" };
        expect(await protokoll(neuOp)).toEqual([
            expect.objectContaining({
                action: "sprache.created",
                sprache: neueId,
                flaeche: null,
                changes: expect.objectContaining({ name: { after: "Waldsprache" }, herkunft: { after: "redaktion" } }),
            }),
            expect.objectContaining({
                action: "sprache_flaeche.copied",
                sprache: neueId,
                flaeche: neu.flaecheId,
                changes: {
                    geometry: { after: ringeDerQuelle },
                    herkunft: { after: "redaktion" },
                    active: { after: true },
                    kopiertAus: { after: quelleImProtokoll },
                },
            }),
        ]);
        expect(await trefferFuer()).toEqual([neueId]);

        // In eine BESTEHENDE Sprache: mit ihrer Sperre; ihre Revision bleibt (eine Teilfläche zählt sie nicht hoch).
        ok(await sperren(bestehende.id));
        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const altOp = randomUUID();
        const alt = ok<Quittung & { spracheId?: string }>(
            await schicken(URL_AUS, { operationId: altOp, regionId, areaId, targetId: bestehende.id }),
        );
        expect(alt.spracheId).toBe(bestehende.id);
        expect(await gespeichert(alt.flaecheId!)).toMatchObject({ sprache: bestehende.id, ringe: ringeDerQuelle });
        expect((await protokoll(altOp)).map((zeile) => [zeile.action, zeile.sprache])).toEqual([
            ["sprache_flaeche.copied", bestehende.id],
        ]);
        expect(await trefferFuer()).toEqual([bestehende.id]);
        await freigeben(bestehende.id);

        // Die Landschaft ist unberührt: dieselbe Revision und Form, und kein Ereignis nennt sie.
        expect(await landschaft()).toEqual(vorher);
    });

    it("🔴 Stilllegen gibt die Artikel frei und nimmt die Flächen aus der Kachelsicht; Zurückholen belebt, was noch frei ist; Teilflächen ebenso", async () => {
        const [p, q] = [await artikel("Still P"), await artikel("Still Q")];
        const sprache = await neueSprache("Stillbar", { wiki: [p, q] });
        const nachbar = await neueSprache("Nimmt Q");
        ok(await sperren(sprache.id));
        const { id: teil } = await flaecheAn(sprache.id, quadrat(300, 450, 340, 490));
        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const retire = { operationId: randomUUID(), baseRevision: await revisionVon(sprache.id) };
        const quittung = ok(await schicken(`${EDITOR_SPRACHEN_URL}/${sprache.id}/retire`, retire));
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toContain("sprache_treffer");
        expect((await trefferAuftraege()).map((j) => j.input_ref.sprachen)).toEqual([[sprache.id]]);
        expect(await inDerKachel(sprache.id)).toEqual([]);
        expect(await pillen(sprache.id)).toEqual([]);
        expect((await protokoll(retire.operationId))[0]).toMatchObject({
            action: "sprache.retired",
            changes: {
                active: { before: true, after: false },
                wiki: { before: [{ titel: "Still P" }, { titel: "Still Q" }], after: [] },
            },
        });
        const liste = ok<SpracheEditorListe>(await holen(EDITOR_SPRACHEN_URL));
        const frei = liste.zeilen.filter((z) => z.art === "artikel").map((z) => z.id);
        expect(frei).toEqual(expect.arrayContaining([p, q]));
        // Stillgelegt lässt sie sich nicht ändern; die Teilfläche bleibt (still über die Sicht, aktiv in der Tafel).
        const aendern = await schicken(`${EDITOR_SPRACHEN_URL}/${sprache.id}/update`, {
            operationId: randomUUID(),
            baseRevision: await revisionVon(sprache.id),
            name: "Nein",
        });
        expect(fehler(aendern)).toMatchObject({ status: 400, code: "validation_failed" });

        // Inzwischen nimmt eine andere Sprache Q; Zurückholen belebt nur P.
        ok(await sperren(nachbar.id));
        ok(
            await schicken(`${EDITOR_SPRACHEN_URL}/${nachbar.id}/wiki`, {
                operationId: randomUUID(),
                baseRevision: 1,
                artikel: [q],
            }),
        );
        const restore = { operationId: randomUUID(), baseRevision: await revisionVon(sprache.id) };
        ok(await schicken(`${EDITOR_SPRACHEN_URL}/${sprache.id}/restore`, restore));
        expect((await pillen(sprache.id)).map((z) => z.titel)).toEqual(["Still P"]);
        expect(await inDerKachel(sprache.id)).toEqual([teil]);
        expect((await protokoll(restore.operationId))[0]).toMatchObject({
            action: "sprache.restored",
            changes: { active: { before: false, after: true }, wiki: { before: [], after: [{ titel: "Still P" }] } },
        });

        // Teilfläche stilllegen und zurückholen; eine, die ein Import ersetzte, kommt nicht zurück.
        const flaechenUrl = `${EDITOR_SPRACHEN_URL}/${sprache.id}/flaechen/${teil}`;
        ok(await schicken(`${flaechenUrl}/retire`, { operationId: randomUUID(), baseRevision: 1 }));
        expect(await inDerKachel(sprache.id)).toEqual([]);
        ok(await schicken(`${flaechenUrl}/restore`, { operationId: randomUUID(), baseRevision: 2 }));
        expect(await inDerKachel(sprache.id)).toEqual([teil]);
        // Die ersetzte Fläche stammt aus dem Import der Datei B im Test davor (die Tests dieser Datei laufen der Reihe nach).
        const [ersetzt] = await db().admin<{ sprache: string; flaeche: string; revision: number }[]>`
            SELECT s.public_id::text AS sprache, f.public_id::text AS flaeche, f.revision::int AS revision
              FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id
             WHERE NOT f.is_active AND f.retired_origin = 'import' ORDER BY f.id LIMIT 1
        `;
        expect(ersetzt).toBeDefined();
        ok(await sperren(ersetzt!.sprache));
        const zurueck = await schicken(
            `${EDITOR_SPRACHEN_URL}/${ersetzt!.sprache}/flaechen/${ersetzt!.flaeche}/restore`,
            {
                operationId: randomUUID(),
                baseRevision: ersetzt!.revision,
            },
        );
        expect(fehler(zurueck)).toMatchObject({ status: 400, code: "validation_failed" });
        // Eine Teilfläche gehört zu ihrer Sprache: über eine fremde Sprache 404.
        const falsch = await schicken(`${EDITOR_SPRACHEN_URL}/${nachbar.id}/flaechen/${teil}/retire`, {
            operationId: randomUUID(),
            baseRevision: 3,
        });
        expect(falsch.statusCode).toBe(404);
        await freigeben(ersetzt!.sprache);
        await freigeben(sprache.id);
        await freigeben(nachbar.id);
    });

    it("Detail, Verlauf, Artikelsuche, Treffer neu rechnen; Sperren-Liste mit Schild und Bitte um Freigabe (0258)", async () => {
        const [m, n] = [await artikel("Detail M"), await artikel("Detail N")];
        const sprache = await neueSprache("Ausführlich", { wiki: [m] });
        const andere = await neueSprache("Überlappend", { wiki: [n] });
        ok(await sperren(sprache.id, personen.kollege));
        await (async () => {
            const quittung = ok(
                await schicken(
                    `${EDITOR_SPRACHEN_URL}/${sprache.id}/flaechen`,
                    {
                        operationId: randomUUID(),
                        baseRevision: await revisionVon(sprache.id),
                        polygons: quadrat(600, 300, 700, 400),
                    },
                    personen.kollege,
                ),
            );
            expect(quittung.flaecheId).toBeDefined();
        })();
        ok(await sperren(andere.id));
        await flaecheAn(andere.id, quadrat(650, 300, 750, 400));
        // Die Mischgebiete rechnet der Auftrag (Jobs-Rolle): danach nennt das Detail die Überlappung.
        await rechneSprachTreffer(db().jobs, "aventuria", { sprachen: [sprache.id, andere.id] });

        const detail = ok<typeof SpracheEditorDetail.static>(
            await holen(`${EDITOR_SPRACHEN_URL}/${sprache.id}?run=${personen.kollege.run}`, personen.kollege),
        );
        expect([...Value.Errors(SpracheEditorDetail, detail)].map((e) => e.path)).toEqual([]);
        expect(detail.wiki.map((pille) => [pille.titel, pille.imWiki, pille.herkunft])).toEqual([
            ["Detail M", true, "redaktion"],
        ]);
        expect(detail.teilflaechen).toEqual([
            expect.objectContaining({
                herkunft: "redaktion",
                flaeche: 10000,
                bbox: [600, 300, 700, 400],
                stuetzpunkte: 5,
                loecher: 0,
            }),
        ]);
        expect(detail.ueberlappungen).toEqual([
            expect.objectContaining({ id: andere.id, name: "Überlappend", flaeche: 5000, anteil: 0.5 }),
        ]);
        expect(detail.sperre).toMatchObject({ kind: "sprache", own: true, person: { id: personen.kollege.id } });
        expect(detail.treffer.berechnetAt).toBeNull();
        expect(
            ok<typeof SpracheEditorDetail.static>(await holen(`${EDITOR_SPRACHEN_URL}/${sprache.id}`)).sperre,
        ).toMatchObject({ own: false });
        expect((await holen(`${EDITOR_SPRACHEN_URL}/${randomUUID()}`)).statusCode).toBe(404);

        // Die Sperren-Liste nennt die Sprache mit einem Punkt in ihrer Fläche; die andere bittet um Freigabe (Bedingung aus 0258).
        const sperrenListe = ok<{ locks: { id: string; at?: { x: number; y: number } }[] }>(
            await holen("/api/editor/locks?kind=sprache", personen.editorin),
        );
        const schild = sperrenListe.locks.find((lock) => lock.id === sprache.id)?.at;
        expect(schild!.x).toBeGreaterThan(600);
        expect(schild!.x).toBeLessThan(700);
        ok(
            await schicken("/api/editor/locks/request", {
                kind: "sprache",
                id: sprache.id,
                run: personen.editorin.run,
            }),
        );

        // Verlauf: jede Operation, die die Sprache nennt, auch die an ihrer Teilfläche; die Teilfläche heißt wie die Sprache.
        const verlauf = ok<MapHistoryPage>(await holen(`${EDITOR_SPRACHEN_URL}/${sprache.id}/history`));
        expect(verlauf.entries.map((eintrag) => eintrag.operation)).toEqual([
            "sprache_flaeche.create",
            "sprache.create",
        ]);
        expect(verlauf.entries[0]!.objects[0]).toMatchObject({ kind: "sprache_flaeche", name: "Ausführlich" });
        expect(verlauf.entries[1]!.objects[0]).toMatchObject({ kind: "sprache", id: sprache.id, name: "Ausführlich" });

        // Artikelsuche: Besitzer, nur freie, Anfang zuerst.
        const suche = ok<SpracheEditorArtikelListe>(await holen(`${EDITOR_SPRACHEN_ARTIKEL_URL}?q=detail`));
        expect(suche.artikel.map((a) => [a.titel, a.besitzer?.id ?? null])).toEqual([
            ["Detail M", sprache.id],
            ["Detail N", andere.id],
        ]);
        const freie = ok<SpracheEditorArtikelListe>(await holen(`${EDITOR_SPRACHEN_ARTIKEL_URL}?q=detail&frei=true`));
        expect(freie.artikel).toEqual([]);

        // „↻ Jetzt neu berechnen“: ein Auftrag, der die Sprache rechnet; das Detail sagt, dass die Zahlen alt sind.
        await db().admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const auftrag = ok<{ jobId: string }>(await schicken(`${EDITOR_SPRACHEN_URL}/${sprache.id}/treffer`));
        expect((await trefferAuftraege()).map((j) => [j.public_id, j.input_ref.sprachen])).toEqual([
            [auftrag.jobId, [sprache.id]],
        ]);
        expect(
            ok<typeof SpracheEditorDetail.static>(await holen(`${EDITOR_SPRACHEN_URL}/${sprache.id}`)).treffer
                .ausstehend,
        ).toBe(true);
        expect(
            (await schicken(`${EDITOR_SPRACHEN_URL}/${sprache.id}/treffer`, undefined, personen.reviewer)).statusCode,
        ).toBe(403);
        await freigeben(sprache.id, personen.kollege);
        await freigeben(andere.id);
    });
});
