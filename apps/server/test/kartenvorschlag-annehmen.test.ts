import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
    KARTENVORSCHLAG_REDAKTION_URL,
    KARTENVORSCHLAG_SCHLUESSEL_KOPF,
    KARTENVORSCHLAG_TERMS_VERSION,
    KARTENVORSCHLAG_URL,
    KartenvorschlagDetail,
    KartenvorschlagListe,
    KartenvorschlagStand,
    mediaPublicUrl,
    type KartenvorschlagEinreichung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { schluesselHash } from "../src/community/db.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { JOB_KIND_CATALOG } from "../src/jobs/kinds.ts";
import { JobWorker } from "../src/jobs/worker.ts";
import { annehmen, notizDerKarte } from "../src/kartenvorschlag/annehmen.ts";
import { KARTENVORSCHLAG_RETENTION_KIND, kartenvorschlagAufbewahrung } from "../src/kartenvorschlag/aufbewahrung.ts";
import { legeWerkAn, pruefeKartendatei, technikNachziehen } from "../src/kartenvorschlag/db.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { MediaStore } from "../src/media/storage.ts";
import { mapSpec, typeSpec } from "../src/migration/citymaps-import.ts";
import { syncTable } from "../src/migration/sync-table.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { fakeMemory, fakeSpawner, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";
import { jpegMitMetadaten, legeOrtAn, neueSpuren, neuerSchluessel } from "./support/photobox-fixture.ts";

vi.setConfig({ testTimeout: 60_000 });

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Karte vorschlagen, Stufe B2 (WI-0275): Annehmen, Aufbewahrung und Notaus, gegen echtes PostgreSQL und einen echten Medienspeicher.
 *
 * - Annehmen eines Links und einer Datei: die Karte entsteht aus den Angaben des Vorschlags (Unbekanntes bleibt unbekannt), das Werk wird gebunden, aber nicht
 *   öffentlich; Fachprotokoll `citymap.created`, Ereignis im Anmeldeprotokoll, Abgleich eingereiht;
 * - Doppelannahme (andere Kennung, dieselbe Kennung), Revisionskonflikt, falscher Zustand, unbekannt, Zugriff ohne Recht, laufender Legacy-Zug;
 * - 🔴 der Legacy-Zug (`syncTable` mit der Karten-Spec) legt die angenommene Karte nicht still; ohne die Zeile `citymap.created` täte er es;
 * - Aufbewahrung: die Funktion der Datenbank, der Lauf mit den Dateien, der Job der Pflege;
 * - Notaus: Schalter aus → Einreichen 503, `stand` falsch, Statusseite und Redaktion laufen weiter.
 */

const TAG_MS = 24 * 60 * 60 * 1000;
const vor = (tage: number): string => new Date(Date.now() - tage * TAG_MS).toISOString();

function config(mediaRoot: string): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "kartenvorschlag-annehmen-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    };
}

describe("notizDerKarte", () => {
    it("Beschreibung, dazu die Quelle, wo sie nicht schon Beschriftung des Links ist", () => {
        expect(notizDerKarte(null, null, false)).toBeNull();
        expect(notizDerKarte("Ein Plan", null, false)).toBe("Ein Plan");
        expect(notizDerKarte(null, "Aventurischer Bote 12", true)).toBeNull();
        expect(notizDerKarte(null, "Aventurischer Bote 12", false)).toBe("Quelle: Aventurischer Bote 12");
        expect(notizDerKarte("Ein Plan", "Heft", false)).toBe("Ein Plan\n\nQuelle: Heft");
    });
});

describeWithDatabase("Karte vorschlagen, Annehmen, Aufbewahrung, Notaus (WI-0275 B2)", { timeout: 240_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: AuthFixture;
    let mediaRoot = "";
    let store: MediaStore;
    let reviewer: { cookie: string; id: string };
    let tester: { cookie: string; id: string };
    const spuren = neueSpuren();
    const orte: string[] = [];
    const operationen: string[] = [];
    const eigeneKarten: string[] = [];
    const release = `kartenvorschlag-annehmen-${randomUUID()}`;
    let adresse = 10;
    const neueAdresse = (): string => `10.61.0.${String(adresse++)}`;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await seedMapDomains(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-kartenvorschlag-annehmen-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        app = buildApp({
            config: config(mediaRoot),
            database: createDatabase(testDatabaseUrl as string, { max: 3 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        const person = async (role: "reviewer" | "tester") => {
            const created = await fixture.person(role);
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        reviewer = await person("reviewer");
        tester = await person("tester");
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await schalter(true);
        await raeumeAuf();
        for (const ort of orte) await database`DELETE FROM place WHERE id = ${ort}::bigint`;
        await database`DELETE FROM job WHERE kind = ${KARTENVORSCHLAG_RETENTION_KIND} AND release = ${release}`;
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    /** Räumt alles ab, was diese Datei angelegt hat: Vorschläge (nach ihren Schlüsseln und Marken), Karten samt Kindern, Werke, Aufträge, Protokoll. */
    async function raeumeAuf(): Promise<void> {
        const hashes = spuren.schluessel.map((schluessel) => schluesselHash(schluessel).toString("hex"));
        const zeilen = await database<
            { id: string; asset: string | null; public_id: string | null; karte: string | null }[]
        >`
            SELECT s.id::text AS id, s.media_asset_id::text AS asset, a.public_id::text AS public_id, s.accepted_citymap_id::text AS karte
              FROM citymap_suggestion s LEFT JOIN media_asset a ON a.id = s.media_asset_id
             WHERE encode(s.status_key_hash, 'hex') = ANY(${hashes}::text[]) OR s.terms_version = 'kv-annehmen-test' OR s.title LIKE 'KVAT %'`;
        const assetIds = zeilen.flatMap((zeile) => (zeile.asset === null ? [] : [zeile.asset]));
        const assetPublic = zeilen.flatMap((zeile) => (zeile.public_id === null ? [] : [zeile.public_id]));
        await database`DELETE FROM job_event WHERE job_id IN (SELECT id FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ANY(${assetPublic}::text[]))`;
        await database`DELETE FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ANY(${assetPublic}::text[])`;
        await database`DELETE FROM citymap_suggestion WHERE id = ANY(${zeilen.map((zeile) => zeile.id)}::bigint[])`;
        const karten = [...zeilen.flatMap((zeile) => (zeile.karte === null ? [] : [zeile.karte])), ...eigeneKarten];
        const publicIds = (
            await database<
                { public_id: string }[]
            >`SELECT public_id::text AS public_id FROM citymap WHERE id = ANY(${karten}::bigint[])`
        ).map((zeile) => zeile.public_id);
        await database`DELETE FROM media_audit_event WHERE citymap_public_id = ANY(${publicIds}::uuid[]) OR operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM media_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
        for (const tafel of ["citymap_media", "citymap_type", "citymap_place", "citymap_link"] as const) {
            await database.unsafe(`DELETE FROM ${tafel} WHERE citymap_id = ANY($1::bigint[])`, [
                `{${karten.join(",")}}`,
            ]);
        }
        await database`DELETE FROM citymap WHERE id = ANY(${karten}::bigint[])`;
        // Werke der Aufbewahrungsfälle, deren Vorschlag die Funktion schon löschte (ein verwendetes Werk bleibt).
        const waisen = await database<{ id: string }[]>`
            SELECT id::text AS id FROM media_asset WHERE source_system = 'kartenvorschlag' AND title LIKE 'KVAT %'`;
        const alleWerke = [...assetIds, ...waisen.map((zeile) => zeile.id)];
        await database`DELETE FROM citymap_media WHERE media_asset_id = ANY(${alleWerke}::bigint[])`;
        await database`DELETE FROM media_file WHERE media_asset_id = ANY(${alleWerke}::bigint[])`;
        await database`DELETE FROM media_rights WHERE media_asset_id = ANY(${alleWerke}::bigint[])`;
        await database`DELETE FROM media_asset WHERE id = ANY(${alleWerke}::bigint[])`;
    }

    /** Der Schalter „Vorschläge annehmen“ direkt in der Tafel (der Speicher der Anwendung wird verworfen). */
    async function schalter(an: boolean): Promise<void> {
        if (an) await database`DELETE FROM content_switch WHERE key = 'kartenvorschlag.submissions'`;
        else {
            await database`
                INSERT INTO content_switch (key, enabled, changed_at, changed_by_label)
                VALUES ('kartenvorschlag.submissions', false, now(), 'kartenvorschlag-annehmen-test')
                ON CONFLICT (key) DO UPDATE SET enabled = false`;
        }
        app?.inhaltsschalter?.forget();
    }

    const roh = (
        method: "POST" | "PUT" | "GET",
        url: string,
        payload: unknown,
        opt: { ip?: string; headers?: Record<string, string> } = {},
    ) =>
        app.inject({
            method,
            url,
            payload: payload as object,
            remoteAddress: opt.ip ?? neueAdresse(),
            headers: { origin: TEST_ORIGIN, ...(opt.headers ?? {}) },
        });
    const senden = (url: string, payload: unknown) => roh("POST", url, payload);
    const fehler = (antwort: { statusCode: number; json(): unknown }): string =>
        antwort.statusCode < 300
            ? String(antwort.statusCode)
            : `${String(antwort.statusCode)} ${(antwort.json() as { error?: { code?: string } }).error?.code ?? ""}`.trim();

    function link(patch: Partial<KartenvorschlagEinreichung> = {}): KartenvorschlagEinreichung {
        return {
            operationId: randomUUID(),
            schluessel: neuerSchluessel(spuren),
            weg: "link",
            titel: "Gareth - Gesamtplan",
            link: "https://www.ulisses-ebooks.de/de/product/120516/gareth",
            falle: { feld: "", dauerMs: 8000 },
            ...patch,
        };
    }
    const mitDatei = (patch: Partial<KartenvorschlagEinreichung> = {}) =>
        link({
            weg: "datei",
            titel: "Selbst gezeichnet",
            datei: { typ: "image/jpeg", groesse: 1000 },
            nutzung: "avesmaps_only",
            bedingungen: KARTENVORSCHLAG_TERMS_VERSION,
            ...patch,
            link: undefined as never,
        });
    const einreichenOk = async (body: KartenvorschlagEinreichung) => {
        const antwort = await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, body);
        expect(fehler(antwort), "Einreichung").toBe("201");
    };
    const dateiHoch = (schluessel: string, bytes: Buffer) =>
        roh("PUT", `${KARTENVORSCHLAG_URL}/datei`, bytes, {
            headers: { "content-type": "application/octet-stream", [KARTENVORSCHLAG_SCHLUESSEL_KOPF]: schluessel },
        });
    const zeile = async (schluessel: string) => {
        const [row] = await database<
            {
                id: string;
                public_id: string;
                state: string;
                asset: string | null;
                revision: number;
                karte: string | null;
            }[]
        >`
            SELECT id::text AS id, public_id::text AS public_id, state, media_asset_id::text AS asset, revision::int AS revision,
                   accepted_citymap_id::text AS karte
              FROM citymap_suggestion WHERE status_key_hash = ${schluesselHash(schluessel)}`;
        return row;
    };
    /** Der Abgleich im Worker, hier in-Prozess. */
    async function abgleichen(schluessel: string): Promise<void> {
        const row = await zeile(schluessel);
        const [werk] = await database<
            { public_id: string }[]
        >`SELECT public_id::text AS public_id FROM media_asset WHERE id = ${row!.asset}::bigint`;
        await settleAssetFiles(database, store, { assetPublicId: werk!.public_id, role: "map_full" });
    }
    /** Ein Vorschlag mit Datei bis `pending` (Datei hochgeladen und geprüft). */
    async function dateiVorschlag(seed: number, patch: Partial<KartenvorschlagEinreichung> = {}) {
        const body = mitDatei(patch);
        await einreichenOk(body);
        expect(fehler(await dateiHoch(body.schluessel, (await jpegMitMetadaten(seed)).bytes))).toBe("200");
        await abgleichen(body.schluessel);
        // Die Redaktion sieht den Vorschlag erst nach dem Nachziehen der Technik (`pending`); die Revision dazu gehört zum Stand, den die Oberfläche sah.
        await technikNachziehen(database);
        const row = (await zeile(body.schluessel))!;
        expect(row.asset).not.toBeNull();
        expect(row.state).toBe("pending");
        return { body, ...row };
    }
    const aufruf = (id: string, payload: Record<string, unknown>, cookie = reviewer.cookie) =>
        app.inject({
            method: "POST",
            url: `${KARTENVORSCHLAG_REDAKTION_URL}/${id}/annehmen`,
            payload,
            headers: { origin: TEST_ORIGIN, cookie },
        });
    /** Annehmen mit gemerkter Operation (zum Aufräumen). */
    const annehmenMit = (id: string, baseRevision: number, operationId: string = randomUUID(), cookie?: string) => {
        operationen.push(operationId);
        return aufruf(id, { operationId, baseRevision }, cookie);
    };
    const kartenZeile = async (publicId: string) => {
        const [row] = await database<
            {
                id: string;
                title: string;
                art: string | null;
                color_mode: string | null;
                is_spoiler: boolean | null;
                is_official: boolean | null;
                is_labeled: boolean | null;
                note: string | null;
                author: string | null;
                valid_from_bf: number | null;
                legacy_origin: string;
                source_system: string;
                is_active: boolean;
                revision: number;
            }[]
        >`SELECT id::text AS id, title, art, color_mode, is_spoiler, is_official, is_labeled, note, author, valid_from_bf, legacy_origin, source_system, is_active, revision::int AS revision
            FROM citymap WHERE public_id = ${publicId}::uuid`;
        return row;
    };

    it("Annehmen eines Links: die Karte entsteht aus den Angaben, Unbekanntes bleibt unbekannt, Fachprotokoll und Ereignis stehen", async () => {
        const ort = await legeOrtAn(database, "Annehmen-Testort");
        orte.push(ort.id);
        const body = link({
            titel: "Annehmen Link",
            beschreibung: "Ein Plan der Oberstadt",
            quelle: "Aventurischer Bote 120",
            placeId: ort.publicId,
            typen: ["stadtplan", "viertel"],
            urheber: "Alrik Zeichner",
            art: "politisch",
            farbe: "farbig",
            gueltigAb: 1020,
            spoiler: true,
            kostenpflichtig: false,
            notiz: "NUR FUER DIE REDAKTION",
            name: "Brin Besucher",
        });
        await einreichenOk(body);
        const vorschlag = (await zeile(body.schluessel))!;
        expect(vorschlag.state).toBe("pending");

        const falsch = await annehmenMit(vorschlag.public_id, vorschlag.revision + 3);
        expect(fehler(falsch)).toBe("409 kartenvorschlag_conflict");
        expect((await zeile(body.schluessel))!.state).toBe("pending");

        const antwort = await annehmenMit(vorschlag.public_id, vorschlag.revision);
        expect(fehler(antwort)).toBe("200");
        expect(Value.Check(KartenvorschlagDetail, antwort.json())).toBe(true);
        const detail = antwort.json() as KartenvorschlagDetail;
        expect(detail).toMatchObject({ zustand: "approved", weg: "link" });
        expect(detail.karte).toMatch(/^[0-9a-f-]{36}$/);
        const karte = (await kartenZeile(detail.karte!))!;
        eigeneKarten.push(karte.id);
        expect(karte).toMatchObject({
            title: "Annehmen Link",
            art: "politisch",
            color_mode: "farbig",
            is_spoiler: true,
            // Unbekannt bleibt unbekannt, nie „nein“.
            is_official: null,
            is_labeled: null,
            author: "Alrik Zeichner",
            valid_from_bf: 1020,
            legacy_origin: "community",
            source_system: "avesmaps3d",
            is_active: true,
            revision: 1,
        });
        // Die Quelle ist die Beschriftung des Links (kurz), die Beschreibung die Notiz; die Notiz an die Redaktion und der Name bleiben im Vorschlag.
        expect(karte.note).toBe("Ein Plan der Oberstadt");
        expect(JSON.stringify(karte)).not.toContain("NUR FUER DIE REDAKTION");
        expect(JSON.stringify(karte)).not.toContain("Brin Besucher");
        const typen = await database<{ type_key: string; source_system: string }[]>`
            SELECT type_key, source_system FROM citymap_type WHERE citymap_id = ${karte.id}::bigint AND is_active ORDER BY type_key`;
        expect(typen).toEqual([
            { type_key: "stadtplan", source_system: "avesmaps3d" },
            { type_key: "viertel", source_system: "avesmaps3d" },
        ]);
        const orteZeilen = await database<
            { target_state: string; place_id: string; raw_name: string; target_origin: string }[]
        >`
            SELECT target_state, place_id::text AS place_id, raw_name, target_origin FROM citymap_place WHERE citymap_id = ${karte.id}::bigint`;
        expect(orteZeilen).toEqual([
            { target_state: "resolved", place_id: ort.id, raw_name: "Annehmen-Testort", target_origin: "editor" },
        ]);
        const links = await database<{ link_role: string; url: string; label: string; is_paid: boolean | null }[]>`
            SELECT link_role, url, label, is_paid FROM citymap_link WHERE citymap_id = ${karte.id}::bigint`;
        expect(links).toEqual([
            { link_role: "primary", url: body.link, label: "Aventurischer Bote 120", is_paid: false },
        ]);
        expect(
            (await database`SELECT 1 FROM citymap_media WHERE citymap_id = ${karte.id}::bigint`).length,
            "ein Link bringt kein Werk",
        ).toBe(0);
        // Fachprotokoll: eine Zeile `citymap.created` an der Karte, ohne Titel oder Link.
        const protokoll = await database<
            { action: string; target_revision: number; details: Record<string, unknown> }[]
        >`
            SELECT action, target_revision::int AS target_revision, details FROM media_audit_event WHERE citymap_public_id = ${detail.karte}::uuid`;
        expect(protokoll).toEqual([
            { action: "citymap.created", target_revision: 1, details: { way: "link", types: 2, place: true } },
        ]);
        const [ereignisse] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event
             WHERE action = 'system.community_kartenvorschlag_angenommen' AND target_ref = ${vorschlag.public_id}`;
        expect(ereignisse!.n).toBe(1);
        // Der Einreicher sieht „angenommen“; zurückziehen geht nicht mehr.
        const statusAntwort = await senden(`${KARTENVORSCHLAG_URL}/status`, { schluessel: body.schluessel });
        expect(statusAntwort.json()).toMatchObject({ zustand: "approved", zurueckziehbar: false, grund: null });
        expect(
            fehler(
                await senden(`${KARTENVORSCHLAG_URL}/status/zurueckziehen`, {
                    schluessel: body.schluessel,
                    operationId: randomUUID(),
                }),
            ),
        ).toBe("409 kartenvorschlag_transition");

        // Doppelannahme: andere Kennung → derselbe Stand, keine zweite Karte, kein zweites Ereignis; dieselbe Kennung → dieselbe Antwort.
        const nochmal = await annehmenMit(vorschlag.public_id, vorschlag.revision);
        expect(fehler(nochmal)).toBe("200");
        expect((nochmal.json() as KartenvorschlagDetail).karte).toBe(detail.karte);
        const kennung = randomUUID();
        expect(fehler(await annehmenMit(vorschlag.public_id, vorschlag.revision, kennung))).toBe("200");
        expect(fehler(await annehmenMit(vorschlag.public_id, vorschlag.revision, kennung))).toBe("200");
        const [karten] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM citymap WHERE title = 'Annehmen Link'`;
        expect(karten!.n).toBe(1);
        const [nachher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event
             WHERE action = 'system.community_kartenvorschlag_angenommen' AND target_ref = ${vorschlag.public_id}`;
        expect(nachher!.n).toBe(1);
        const [spur] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_audit_event WHERE citymap_public_id = ${detail.karte}::uuid`;
        expect(spur!.n).toBe(1);
    });

    it("Annehmen einer Datei: das Werk wird als Vollkarte gebunden und freigegeben, bleibt aber privat; der Abgleich ist eingereiht, die Vorschau da", async () => {
        const v = await dateiVorschlag(31, { titel: "Annehmen Datei", quelle: "Eigene Zeichnung", farbe: "braun" });
        const [vorher] = await database<{ moderation_state: string; public_id: string; technical_state: string }[]>`
            SELECT moderation_state, public_id::text AS public_id, technical_state FROM media_asset WHERE id = ${v.asset}::bigint`;
        expect(vorher).toMatchObject({ moderation_state: "pending", technical_state: "ok" });

        const antwort = await annehmenMit(v.public_id, v.revision);
        expect(fehler(antwort)).toBe("200");
        const detail = antwort.json() as KartenvorschlagDetail;
        const karte = (await kartenZeile(detail.karte!))!;
        eigeneKarten.push(karte.id);
        expect(karte).toMatchObject({ title: "Annehmen Datei", color_mode: "braun" });
        // Die Quelle einer Datei steht am Ende der Notiz (kein Link, der sie beschriften könnte).
        expect(karte.note).toBe("Quelle: Eigene Zeichnung");

        const bindungen = await database<
            { role: string; origin: string; publication_override: string; retired_at: Date | null }[]
        >`
            SELECT role, origin, publication_override, retired_at FROM citymap_media WHERE citymap_id = ${karte.id}::bigint`;
        expect(bindungen).toEqual([
            { role: "map_full", origin: "editor", publication_override: "none", retired_at: null },
        ]);
        const [werk] = await database<
            { moderation_state: string }[]
        >`SELECT moderation_state FROM media_asset WHERE id = ${v.asset}::bigint`;
        expect(werk!.moderation_state).toBe("approved");
        const [rechte] = await database<
            { clearance_state: string; reviewed: boolean; reviewer: boolean }[]
        >`SELECT clearance_state, reviewed_at IS NOT NULL AS reviewed, reviewed_by_person IS NOT NULL AS reviewer
             FROM media_rights WHERE media_asset_id = ${v.asset}::bigint`;
        expect(rechte, "die Annahme gibt die Karte frei (WI-0282)").toEqual({
            clearance_state: "cleared",
            reviewed: true,
            reviewer: true,
        });
        // Der Abgleich der Rolle ist eingereiht (er rechnet die Entscheidung mit der neuen Verwendung).
        const [auftrag] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ${vorher!.public_id} AND input_ref ->> 'role' = 'map_full'`;
        expect(auftrag!.n).toBeGreaterThanOrEqual(2);
        // Der Abgleich im Worker: Vorschau da, und die Annahme hat die Datei freigegeben.
        await settleAssetFiles(database, store, { assetPublicId: vorher!.public_id, role: "map_full" });
        const dateien = await database<{ variant: string; storage_class: string }[]>`
            SELECT variant, storage_class FROM media_file WHERE media_asset_id = ${v.asset}::bigint ORDER BY variant`;
        expect(dateien, "die Annahme gibt die Karte frei").toContainEqual({
            variant: "citymap_full",
            storage_class: "published",
        });
        const protokoll = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM media_audit_event WHERE citymap_public_id = ${detail.karte}::uuid`;
        expect(protokoll).toEqual([{ details: { way: "file", types: 0, place: false } }]);
        const freigabe = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM media_audit_event
             WHERE media_asset_public_id = ${vorher!.public_id}::uuid AND action = 'rights.reviewed'`;
        expect(freigabe).toEqual([{ details: { decision: "cleared", previous: "unreviewed" } }]);
    });

    it("🔴 eine angenommene Datei nach acht Tagen: Der Lauf nennt sie fällig und entfernt nichts (Schalter aus); Name und Notiz bleiben bis 90 Tage nach der Entscheidung", async () => {
        const v = await dateiVorschlag(32, {
            titel: "Annehmen und aufbewahren",
            name: "Alrik",
            notiz: "Für die Redaktion",
        });
        const antwort = await annehmenMit(v.public_id, v.revision);
        expect(fehler(antwort)).toBe("200");
        const karte = (await kartenZeile((antwort.json() as KartenvorschlagDetail).karte!))!;
        eigeneKarten.push(karte.id);
        const [werk] = await database<{ public_id: string }[]>`
            SELECT public_id::text AS public_id FROM media_asset WHERE id = ${v.asset}::bigint`;
        await settleAssetFiles(database, store, { assetPublicId: werk!.public_id, role: "map_full" });
        // Der Abgleich ist gelaufen: Die eingereihten Aufträge dürfen nicht offen stehen, sonst hielte das die Fälligkeit zurück.
        await database`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ${werk!.public_id} AND state = 'QUEUED'`;
        await database`UPDATE citymap_suggestion SET decided_at = ${vor(8)}::timestamptz WHERE media_asset_id = ${v.asset}::bigint`;
        const [quelle] = await database<{ storage_key: string }[]>`
            SELECT storage_key FROM media_file WHERE media_asset_id = ${v.asset}::bigint AND storage_class = 'private_source'`;

        const lauf = await kartenvorschlagAufbewahrung(database, store);
        expect(lauf.original).toMatchObject({ an: false, gestempelt: 0, dateien: 0, fehlgeschlagen: 0 });
        expect(lauf.original.faellig).toBeGreaterThanOrEqual(1);
        expect(await store.exists(quelle!.storage_key), "die Datei bleibt, solange der Schalter aus steht").toBe(true);
        const dateien = await database<{ storage_class: string; bytes_deleted_at: Date | null }[]>`
            SELECT storage_class, bytes_deleted_at FROM media_file WHERE media_asset_id = ${v.asset}::bigint`;
        expect(dateien.every((datei) => datei.bytes_deleted_at === null && datei.storage_class !== "master")).toBe(
            true,
        );

        const angaben = () =>
            database<{ attribution_name: string | null; note: string | null }[]>`
                SELECT attribution_name, note FROM citymap_suggestion WHERE media_asset_id = ${v.asset}::bigint`;
        expect(await angaben()).toEqual([{ attribution_name: "Alrik", note: "Für die Redaktion" }]);
        await database`UPDATE citymap_suggestion SET decided_at = ${vor(89)}::timestamptz WHERE media_asset_id = ${v.asset}::bigint`;
        await kartenvorschlagAufbewahrung(database, store);
        expect(await angaben()).toEqual([{ attribution_name: "Alrik", note: "Für die Redaktion" }]);
        await database`UPDATE citymap_suggestion SET decided_at = ${vor(91)}::timestamptz WHERE media_asset_id = ${v.asset}::bigint`;
        await kartenvorschlagAufbewahrung(database, store);
        expect(await angaben()).toEqual([{ attribution_name: null, note: null }]);
    });

    it("Annehmen mit Ort aus dem Blatt: ein gewählter gilt statt des vorgeschlagenen, `null` heißt keiner, ein unbekannter ist 422; der Vorschlag nennt danach den Ort der Karte", async () => {
        const ort = await legeOrtAn(database, "Blatt-Testort");
        orte.push(ort.id);
        const orteDerKarte = (karte: string) =>
            database<{ place_id: string; raw_name: string }[]>`
                SELECT place_id::text AS place_id, raw_name FROM citymap_place WHERE citymap_id = ${karte}::bigint`;
        const mit = (id: string, baseRevision: number, placeId: string | null) => {
            const operationId = randomUUID();
            operationen.push(operationId);
            return aufruf(id, { operationId, baseRevision, placeId });
        };

        const ohneOrt = link({ titel: "Ohne Ort im Vorschlag" });
        await einreichenOk(ohneOrt);
        const a = (await zeile(ohneOrt.schluessel))!;
        expect(fehler(await mit(a.public_id, a.revision, randomUUID()))).toBe("422 kartenvorschlag_invalid");
        expect((await zeile(ohneOrt.schluessel))!.state).toBe("pending");
        const gewaehlt = await mit(a.public_id, a.revision, ort.publicId);
        expect(fehler(gewaehlt)).toBe("200");
        expect(Value.Check(KartenvorschlagDetail, gewaehlt.json())).toBe(true);
        const detailA = gewaehlt.json() as KartenvorschlagDetail;
        expect(detailA.ort).toEqual({ id: ort.publicId, name: "Blatt-Testort" });
        const karteA = (await kartenZeile(detailA.karte!))!;
        eigeneKarten.push(karteA.id);
        expect(await orteDerKarte(karteA.id)).toEqual([{ place_id: ort.id, raw_name: "Blatt-Testort" }]);

        const mitOrt = link({ titel: "Ort wird weggenommen", placeId: ort.publicId });
        await einreichenOk(mitOrt);
        const b = (await zeile(mitOrt.schluessel))!;
        const ohne = await mit(b.public_id, b.revision, null);
        expect(fehler(ohne)).toBe("200");
        const detailB = ohne.json() as KartenvorschlagDetail;
        expect(detailB.ort).toBeNull();
        const karteB = (await kartenZeile(detailB.karte!))!;
        eigeneKarten.push(karteB.id);
        expect(await orteDerKarte(karteB.id)).toEqual([]);
    });

    it("🔴 Annehmen als weitere Version eines Eintrags (WI-0287 Stufe 2): keine neue Karte, die Datei hängt als Version mit Bezeichnung, der Link kommt zu den Fundstellen, Titel, Angaben und Ort bleiben; stillgelegt 409, unbekannt 404", async () => {
        const mit = (id: string, baseRevision: number, extra: Record<string, unknown>) => {
            const operationId = randomUUID();
            operationen.push(operationId);
            return aufruf(id, { operationId, baseRevision, ...extra });
        };
        // Der Eintrag: ein erster Vorschlag, wie bisher als neuer Eintrag angenommen.
        const erster = await dateiVorschlag(41, { titel: "KVAT Version Ziel", farbe: "braun" });
        const neu = await mit(erster.public_id, erster.revision, {});
        expect(fehler(neu)).toBe("200");
        const ziel = (neu.json() as KartenvorschlagDetail).karte!;
        const vorher = (await kartenZeile(ziel))!;
        eigeneKarten.push(vorher.id);

        // Ein zweiter Vorschlag mit Ort, Typ und Farbe als Version: Nur die Datei kommt dazu, mit ihrer Bezeichnung; der Ort des Vorschlags bleibt, `placeId` gilt nicht.
        const ort = await legeOrtAn(database, "Version-Testort");
        orte.push(ort.id);
        const zweiter = await dateiVorschlag(42, {
            titel: "KVAT Bei Nacht",
            farbe: "farbig",
            typen: ["dungeon"],
            placeId: ort.publicId,
        });
        const version = await mit(zweiter.public_id, zweiter.revision, {
            targetId: ziel,
            versionLabel: " Nachtausgabe ",
            placeId: null,
        });
        expect(fehler(version)).toBe("200");
        expect(Value.Check(KartenvorschlagDetail, version.json())).toBe(true);
        expect(version.json()).toMatchObject({ zustand: "approved", karte: ziel, ort: { id: ort.publicId } });
        const [neueKarten] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM citymap WHERE title = 'KVAT Bei Nacht'`;
        expect(neueKarten!.n, "keine neue Karte").toBe(0);
        const versionen = await database<{ asset: string; label: string | null; position: number | null }[]>`
            SELECT media_asset_id::text AS asset, version_label AS label, version_position AS position FROM citymap_media
             WHERE citymap_id = ${vorher.id}::bigint AND role = 'map_full' AND retired_at IS NULL
             ORDER BY version_position NULLS FIRST, id`;
        expect(versionen).toEqual([
            { asset: erster.asset, label: null, position: 0 },
            { asset: zweiter.asset, label: "Nachtausgabe", position: 1 },
        ]);
        expect(await kartenZeile(ziel)).toMatchObject({
            title: "KVAT Version Ziel",
            color_mode: "braun",
            revision: vorher.revision + 1,
        });
        const [kinder] = await database<{ typen: number; orte: number }[]>`
            SELECT (SELECT count(*)::int FROM citymap_type WHERE citymap_id = ${vorher.id}::bigint) AS typen,
                   (SELECT count(*)::int FROM citymap_place WHERE citymap_id = ${vorher.id}::bigint) AS orte`;
        expect(kinder, "Typen und Orte des Eintrags bleiben").toEqual({ typen: 0, orte: 0 });
        // Die Annahme gibt die Datei frei wie beim neuen Eintrag.
        const [werk] = await database<{ moderation_state: string; clearance_state: string }[]>`
            SELECT a.moderation_state, r.clearance_state FROM media_asset a JOIN media_rights r ON r.media_asset_id = a.id
             WHERE a.id = ${zweiter.asset}::bigint`;
        expect(werk).toEqual({ moderation_state: "approved", clearance_state: "cleared" });
        const protokoll = await database<
            { action: string; target_revision: number; details: Record<string, unknown> }[]
        >`
            SELECT action, target_revision::int AS target_revision, details FROM media_audit_event
             WHERE citymap_public_id = ${ziel}::uuid ORDER BY id`;
        expect(protokoll.at(-1)).toEqual({
            action: "citymap.updated",
            target_revision: vorher.revision + 1,
            details: { fields: ["images"] },
        });

        // Ein Link als Version: Er kommt zu den Fundstellen und wird Karten-Link, weil der Eintrag keinen hatte.
        const alsLink = link({ titel: "KVAT Link Version", quelle: "Bote 7", kostenpflichtig: true });
        await einreichenOk(alsLink);
        const l = (await zeile(alsLink.schluessel))!;
        expect(fehler(await mit(l.public_id, l.revision, { targetId: ziel }))).toBe("200");
        const links = await database<{ link_role: string; url: string; label: string; is_paid: boolean | null }[]>`
            SELECT link_role, url, label, is_paid FROM citymap_link WHERE citymap_id = ${vorher.id}::bigint AND is_active`;
        expect(links).toEqual([{ link_role: "primary", url: alsLink.link, label: "Bote 7", is_paid: true }]);

        // Ein stillgelegter Eintrag nimmt nichts an (409), ein unbekannter ist 404; der Vorschlag bleibt offen.
        await database`
            UPDATE citymap SET state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE id = ${vorher.id}::bigint`;
        const spaet = link({ titel: "KVAT Zu spaet" });
        await einreichenOk(spaet);
        const s = (await zeile(spaet.schluessel))!;
        expect(fehler(await mit(s.public_id, s.revision, { targetId: ziel }))).toBe("409 citymap_target_retired");
        expect(fehler(await mit(s.public_id, s.revision, { targetId: randomUUID() }))).toBe("404 not_found");
        expect((await zeile(spaet.schluessel))!.state).toBe("pending");
    });

    it("Die Liste: Segmente, Suche in Titel und Ort, eine Nummer trifft genau, Zähler aller; offen die ältesten zuerst, entschiedene die neuesten; seitenweise", async () => {
        const marke = `Probe${randomUUID().slice(0, 8)}`;
        const lies = async (abfrage: Record<string, string>) => {
            const antwort = await app.inject({
                method: "GET",
                url: `${KARTENVORSCHLAG_REDAKTION_URL}?${new URLSearchParams(abfrage).toString()}`,
                headers: { cookie: reviewer.cookie },
            });
            expect(fehler(antwort)).toBe("200");
            expect(Value.Check(KartenvorschlagListe, antwort.json())).toBe(true);
            return antwort.json() as KartenvorschlagListe;
        };
        const titel = (liste: KartenvorschlagListe) => liste.eintraege.map((eintrag) => eintrag.titel);
        const koerper = [
            link({ titel: `${marke} eins` }),
            link({ titel: `${marke} zwei` }),
            link({ titel: `${marke} drei` }),
        ];
        for (const body of koerper) await einreichenOk(body);
        const erste = (await zeile(koerper[0]!.schluessel))!;
        const zweite = (await zeile(koerper[1]!.schluessel))!;
        const offen = await lies({ segment: "offen", q: marke });
        expect(titel(offen)).toEqual([`${marke} eins`, `${marke} zwei`, `${marke} drei`]);

        const seite = await lies({ segment: "offen", q: marke, limit: "2" });
        expect(titel(seite)).toEqual([`${marke} eins`, `${marke} zwei`]);
        expect(seite.weitere).toBe(true);
        const rest = await lies({ segment: "offen", q: marke, limit: "2", nach: String(seite.naechste) });
        expect(titel(rest)).toEqual([`${marke} drei`]);
        expect(rest.weitere).toBe(false);

        const [{ number } = { number: "" }] = await database<{ number: string }[]>`
            SELECT number::text AS number FROM citymap_suggestion WHERE id = ${zweite.id}::bigint`;
        expect(titel(await lies({ segment: "offen", q: `K-${number}` }))).toEqual([`${marke} zwei`]);
        expect(titel(await lies({ segment: "offen", q: number }))).toEqual([`${marke} zwei`]);
        expect(
            titel(await lies({ segment: "offen", q: `${marke.slice(0, 6)}%` })),
            "ein % ist ein Zeichen, kein Muster",
        ).toEqual([]);

        const annahme = await annehmenMit(erste.public_id, erste.revision);
        expect(fehler(annahme)).toBe("200");
        eigeneKarten.push((await kartenZeile((annahme.json() as KartenvorschlagDetail).karte!))!.id);
        const nochEine = await annehmenMit(zweite.public_id, zweite.revision);
        eigeneKarten.push((await kartenZeile((nochEine.json() as KartenvorschlagDetail).karte!))!.id);
        expect(titel(await lies({ segment: "offen", q: marke }))).toEqual([`${marke} drei`]);
        const angenommen = await lies({ segment: "angenommen", q: marke });
        expect(titel(angenommen), "die neuesten zuerst").toEqual([`${marke} zwei`, `${marke} eins`]);
        expect(titel(await lies({ segment: "abgelehnt", q: marke }))).toEqual([]);

        const zahlen = await database<{ state: string; n: number }[]>`
            SELECT state, count(*)::int AS n FROM citymap_suggestion GROUP BY state`;
        for (const { state, n } of zahlen) {
            expect(angenommen.zaehler[state as keyof KartenvorschlagListe["zaehler"]], state).toBe(n);
        }
    });

    it("🔴 ein neuer Vorschlag läutet bei der Redaktion: ein Link sofort, eine Datei erst mit den Bytes; ab dem zweiten die Zahl; die Wiederholung zählt nicht; nie Titel oder Name", async () => {
        const zeilen = (person: string) =>
            database<{ text: string | null; quelle: string }[]>`
                SELECT text, quelle FROM public.benachrichtigung
                 WHERE an_person = ${person}::uuid AND art = 'kartenvorschlag_neu' ORDER BY id`;
        await database`DELETE FROM public.benachrichtigung WHERE art = 'kartenvorschlag_neu'`;

        const body = link({ titel: "Läutet", name: "Brin Besucher", notiz: "Geheim" });
        await einreichenOk(body);
        const { public_id: id } = (await zeile(body.schluessel))!;
        const eine = [{ text: id, quelle: `kartenvorschlag_neu:${id}` }];
        expect(await zeilen(reviewer.id)).toEqual(eine);
        const [ohneRecht] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM public.benachrichtigung WHERE art = 'kartenvorschlag_neu' AND an_person = ${tester.id}::uuid`;
        expect(ohneRecht?.n).toBe(0);

        await einreichenOk(body);
        expect(await zeilen(reviewer.id), "die Wiederholung zählt nicht").toEqual(eine);

        const datei = mitDatei({ titel: "Läutet mit Datei" });
        await einreichenOk(datei);
        expect(await zeilen(reviewer.id), "noch keine Bytes, noch nichts zu prüfen").toEqual(eine);
        const bytes = (await jpegMitMetadaten(33)).bytes;
        expect(fehler(await dateiHoch(datei.schluessel, bytes))).toBe("200");
        const zwei = [{ text: "2", quelle: `kartenvorschlag_neu:${id}` }];
        expect(await zeilen(reviewer.id)).toEqual(zwei);
        expect(fehler(await dateiHoch(datei.schluessel, bytes))).toBe("200");
        expect(await zeilen(reviewer.id), "ein zweites Hochladen zählt nicht").toEqual(zwei);
        await database`DELETE FROM public.benachrichtigung WHERE art = 'kartenvorschlag_neu'`;
    });

    it("Das Vorschaubild kommt beim Lesen mit: der private Weg der Medienverwaltung; beim Link keins", async () => {
        const v = await dateiVorschlag(34, { titel: "Mit Vorschau" });
        const lies = (id: string) =>
            app.inject({
                method: "GET",
                url: `${KARTENVORSCHLAG_REDAKTION_URL}/${id}`,
                headers: { cookie: reviewer.cookie },
            });
        const antwort = await lies(v.public_id);
        expect(fehler(antwort)).toBe("200");
        expect(Value.Check(KartenvorschlagDetail, antwort.json())).toBe(true);
        expect((antwort.json() as KartenvorschlagDetail).vorschau).toMatch(/intern_/);

        // 🪤 Wird das Bild öffentlich, fällt die private Vorschau weg (so stand es auf der Stage: „Keine Vorschau“ an einer angenommenen Karte).
        const [oeffentlich] = await database<{ sha256: string }[]>`
            UPDATE media_file SET storage_class = 'published', variant = 'citymap_full',
                   storage_key = 'published/sha256/' || substr(sha256, 1, 2) || '/' || substr(sha256, 3, 2) || '/' || sha256 || '.webp'
             WHERE media_asset_id = ${v.asset}::bigint AND variant LIKE 'intern\\_%'
            RETURNING sha256`;
        expect(oeffentlich).toBeDefined();
        const danach = await lies(v.public_id);
        expect((danach.json() as KartenvorschlagDetail).vorschau).toBe(mediaPublicUrl(oeffentlich!.sha256));

        const body = link({ titel: "Ohne Vorschau" });
        await einreichenOk(body);
        const ohne = await lies((await zeile(body.schluessel))!.public_id);
        expect((ohne.json() as KartenvorschlagDetail).vorschau).toBeNull();
    });

    it("falsche Lage: noch ohne Datei (incoming), abgelehnt, unbekannt → 404 oder 409; ohne Anmeldung 401, ohne Recht 403", async () => {
        const offen = mitDatei({ titel: "Ohne Datei" });
        await einreichenOk(offen);
        const o = (await zeile(offen.schluessel))!;
        expect(o.state).toBe("incoming");
        expect(fehler(await annehmenMit(o.public_id, o.revision))).toBe("409 kartenvorschlag_transition");

        const abgelehnt = link({ titel: "Wird abgelehnt" });
        await einreichenOk(abgelehnt);
        const a = (await zeile(abgelehnt.schluessel))!;
        expect(
            fehler(
                await app.inject({
                    method: "POST",
                    url: `${KARTENVORSCHLAG_REDAKTION_URL}/${a.public_id}/ablehnen`,
                    payload: { operationId: randomUUID(), baseRevision: a.revision },
                    headers: { origin: TEST_ORIGIN, cookie: reviewer.cookie },
                }),
            ),
        ).toBe("200");
        expect(fehler(await annehmenMit(a.public_id, a.revision + 1))).toBe("409 kartenvorschlag_transition");
        expect(fehler(await annehmenMit(randomUUID(), 1))).toBe("404 kartenvorschlag_not_found");

        const gut = link({ titel: "Nur mit Recht" });
        await einreichenOk(gut);
        const g = (await zeile(gut.schluessel))!;
        const ohneAnmeldung = await app.inject({
            method: "POST",
            url: `${KARTENVORSCHLAG_REDAKTION_URL}/${g.public_id}/annehmen`,
            payload: { operationId: randomUUID(), baseRevision: g.revision },
            headers: { origin: TEST_ORIGIN },
        });
        expect(fehler(ohneAnmeldung)).toMatch(/^401/);
        expect(fehler(await annehmenMit(g.public_id, g.revision, randomUUID(), tester.cookie))).toMatch(/^403/);
        expect((await zeile(gut.schluessel))!.state, "ohne Recht entsteht nichts").toBe("pending");
        expect((await zeile(gut.schluessel))!.karte).toBeNull();
    });

    it("gegen einen laufenden Legacy-Zug: 503 map_import_running, nichts entsteht", async () => {
        const domaene = `kv-zug-${randomUUID()}`;
        const body = link({ titel: "Gegen den Zug" });
        await einreichenOk(body);
        const v = (await zeile(body.schluessel))!;
        const zug = await database.reserve();
        try {
            await zug`SELECT pg_advisory_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene}))`;
            const operationId = randomUUID();
            operationen.push(operationId);
            await expect(
                annehmen(
                    database,
                    { personId: reviewer.id, environment: "test" },
                    v.public_id,
                    { operationId, baseRevision: v.revision },
                    async () => undefined,
                    { mapDomainId: domaene },
                ),
            ).rejects.toMatchObject({ code: "map_import_running" });
            expect((await zeile(body.schluessel))!.state).toBe("pending");
        } finally {
            await zug`SELECT pg_advisory_unlock_all()`;
            zug.release();
        }
    });

    it("🔴 der Legacy-Zug legt die angenommene Karte nicht still; ohne die Zeile `citymap.created` täte er es", async () => {
        const body = link({ titel: "Gegen den Datenzug", typen: ["ortsplan"] });
        await einreichenOk(body);
        const v = (await zeile(body.schluessel))!;
        const detail = (await annehmenMit(v.public_id, v.revision)).json() as KartenvorschlagDetail;
        const karte = (await kartenZeile(detail.karte!))!;
        eigeneKarten.push(karte.id);

        class Zurueck extends Error {}
        const lauf = async (ohneZeile: boolean) => {
            let ergebnis: { karteStillgelegt: boolean; typStillgelegt: boolean; geschuetzt: boolean } | undefined;
            await database
                .begin(async (tx) => {
                    if (ohneZeile)
                        await tx`DELETE FROM media_audit_event WHERE citymap_public_id = ${detail.karte}::uuid`;
                    // Ein Satz ohne diese Karte: alles, was Legacy nicht nennt, wird stillgelegt, außer Geschütztes.
                    const karten = await syncTable(tx, mapSpec(), [], { runId: randomUUID() });
                    const typen = await syncTable(tx, typeSpec(), [], { runId: randomUUID() });
                    const [stand] = await tx<
                        { is_active: boolean }[]
                    >`SELECT is_active FROM citymap WHERE id = ${karte.id}::bigint`;
                    const [typ] = await tx<{ is_active: boolean }[]>`
                        SELECT is_active FROM citymap_type WHERE citymap_id = ${karte.id}::bigint AND type_key = 'ortsplan'`;
                    ergebnis = {
                        karteStillgelegt: !stand!.is_active || karten.retiring.some((o) => o.publicId === detail.karte),
                        typStillgelegt: !typ!.is_active || (typen.retired > 0 && !typ!.is_active),
                        geschuetzt: true,
                    };
                    throw new Zurueck();
                })
                .catch((error: unknown) => {
                    if (!(error instanceof Zurueck)) throw error;
                });
            return ergebnis!;
        };
        expect(await lauf(false)).toMatchObject({ karteStillgelegt: false, typStillgelegt: false });
        expect((await lauf(true)).karteStillgelegt, "Gegenprobe: ohne Fachprotokoll wäre die Karte fällig").toBe(true);
        expect((await kartenZeile(detail.karte!))!.is_active).toBe(true);
    });

    describe("Aufbewahrung", () => {
        let nummer = 0;
        /** Ein Vorschlag mit Zustand, Alter und, wenn gewünscht, einem Werk mit echter Datei im Speicher. */
        async function fall(opt: { state: string; tage: number; mitWerk?: boolean; technik?: "ok" | "pending" }) {
            const mark = "kv-annehmen-test";
            let assetId: string | null = null;
            let schluessel: string | null = null;
            if (opt.mitWerk === true) {
                const geprueft = pruefeKartendatei((await jpegMitMetadaten(900 + nummer)).bytes, "image/jpeg");
                const werk = await database.begin((tx) =>
                    legeWerkAn(tx, store, geprueft, {
                        titel: `KVAT Aufbewahrung ${String(nummer)}`,
                        nutzung: "avesmaps_only",
                        urheber: null,
                    }),
                );
                assetId = werk.id;
                await database`UPDATE media_asset SET technical_state = ${opt.technik ?? "ok"} WHERE id = ${werk.id}::bigint`;
                const [file] = await database<
                    { storage_key: string }[]
                >`SELECT storage_key FROM media_file WHERE media_asset_id = ${werk.id}::bigint`;
                schluessel = file!.storage_key;
                expect(await store.exists(schluessel)).toBe(true);
            }
            nummer += 1;
            const [row] = await database<{ id: string }[]>`
                INSERT INTO citymap_suggestion (operation_id, state, status_key_hash, way, title, link_url, file_mime, usage_grant, terms_version,
                                                media_asset_id, state_changed_at, decided_at)
                VALUES (${randomUUID()}::uuid, ${opt.state}, ${schluesselHash(neuerSchluessel())}, ${assetId === null && opt.mitWerk !== true ? "link" : "file"},
                        ${`KVAT Aufbewahrung ${String(nummer)}`}, ${opt.mitWerk === true ? null : "https://example.org/karte"},
                        ${opt.mitWerk === true ? "image/jpeg" : null}, ${opt.mitWerk === true ? "avesmaps_only" : null},
                        ${opt.mitWerk === true ? mark : null}, ${assetId}::bigint, ${vor(opt.tage)}::timestamptz,
                        ${opt.state === "approved" || opt.state === "rejected" ? vor(opt.tage) : null}::timestamptz)
                RETURNING id::text AS id`;
            return { id: row!.id, assetId, schluessel };
        }
        const da = async (id: string): Promise<boolean> =>
            (await database`SELECT 1 FROM citymap_suggestion WHERE id = ${id}::bigint`).length === 1;
        const werkDa = async (id: string | null): Promise<boolean> =>
            id !== null && (await database`SELECT 1 FROM media_asset WHERE id = ${id}::bigint`).length === 1;

        it("🔴 die Funktion: nie hochgeladene und gescheiterte nach 7 Tagen, abgelehnte und zurückgezogene nach 30 Tagen; pending und angenommene nie", async () => {
            const alt = await fall({ state: "incoming", tage: 8 });
            const jung = await fall({ state: "incoming", tage: 6 });
            const gescheitert = await fall({ state: "technical_failed", tage: 8, mitWerk: true, technik: "pending" });
            const fertigWartet = await fall({ state: "incoming", tage: 20, mitWerk: true, technik: "ok" });
            const haengt = await fall({ state: "incoming", tage: 20, mitWerk: true, technik: "pending" });
            const abgelehnt = await fall({ state: "rejected", tage: 31, mitWerk: true });
            const abgelehntJung = await fall({ state: "rejected", tage: 29, mitWerk: true });
            const zurueck = await fall({ state: "withdrawn", tage: 31 });
            const wartend = await fall({ state: "pending", tage: 200 });

            const schluessel = (
                await database<
                    { storage_key: string }[]
                >`SELECT storage_key FROM public.kartenvorschlag_aufbewahren(now())`
            ).map((row) => row.storage_key);

            for (const weg of [alt, gescheitert, haengt, abgelehnt, zurueck])
                expect(await da(weg.id), "Zeile weg").toBe(false);
            for (const bleibt of [jung, fertigWartet, abgelehntJung, wartend])
                expect(await da(bleibt.id), "Zeile bleibt").toBe(true);
            for (const weg of [gescheitert, haengt, abgelehnt])
                expect(await werkDa(weg.assetId), "Werk weg").toBe(false);
            for (const bleibt of [fertigWartet, abgelehntJung])
                expect(await werkDa(bleibt.assetId), "Werk bleibt").toBe(true);
            expect(schluessel.sort()).toEqual(
                [gescheitert.schluessel, haengt.schluessel, abgelehnt.schluessel]
                    .filter((s): s is string => s !== null)
                    .sort(),
            );
            // Die Funktion löscht nur Zeilen; die Dateien liegen noch.
            expect(await store.exists(abgelehnt.schluessel!)).toBe(true);
        });

        it("🔴 der Lauf löscht die Dateien genau der gelieferten Schlüssel; ein Werk, das aktiv verwendet wird, bleibt samt Datei", async () => {
            const weg = await fall({ state: "rejected", tage: 40, mitWerk: true });
            const verwendet = await fall({ state: "withdrawn", tage: 40, mitWerk: true });
            const jung = await fall({ state: "rejected", tage: 3, mitWerk: true });
            // Das Werk des zweiten hängt aktiv an einer Karte: Die Zeile des Vorschlags geht, das Werk bleibt.
            const [karte] = await database<{ id: string }[]>`
                INSERT INTO citymap (public_id, title, source_system) VALUES (gen_random_uuid(), 'Aufbewahrung-Karte', 'avesmaps3d') RETURNING id::text AS id`;
            eigeneKarten.push(karte!.id);
            await database`INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin) VALUES (${karte!.id}::bigint, ${verwendet.assetId}::bigint, 'map_full', 'editor')`;

            const lauf = await kartenvorschlagAufbewahrung(database, store);
            expect(lauf.fehlgeschlagen).toBe(0);
            expect(lauf.schluessel).toBeGreaterThanOrEqual(1);
            expect(await da(weg.id)).toBe(false);
            expect(await werkDa(weg.assetId)).toBe(false);
            expect(await store.exists(weg.schluessel!), "die Datei ist weg").toBe(false);
            expect(await da(verwendet.id)).toBe(false);
            expect(await werkDa(verwendet.assetId), "was irgendwo hängt, bleibt").toBe(true);
            expect(await store.exists(verwendet.schluessel!)).toBe(true);
            expect(await da(jung.id)).toBe(true);
            expect(await store.exists(jung.schluessel!)).toBe(true);
            // Zweiter Lauf: nichts mehr zu tun.
            expect((await kartenvorschlagAufbewahrung(database, store)).schluessel).toBe(0);
        });

        it("die Art steht im Katalog der Aufträge (aufgezeichnet, keine queued-Jobart); die Pflege führt sie aus und zeichnet sie auf", async () => {
            expect(JOB_KIND_CATALOG[KARTENVORSCHLAG_RETENTION_KIND]).toMatchObject({
                kind: "kartenvorschlag_aufbewahrung",
                origin: "recorded",
                holdsSharedDomainLock: false,
                threads: 0,
            });
            const weg = await fall({ state: "rejected", tage: 40, mitWerk: true });
            const arbeiter = (mitAblage: boolean) =>
                new JobWorker({
                    database,
                    config: testJobsConfig(),
                    mapDomainId: "aventuria",
                    release,
                    deriveScope: uniqueScope("derive"),
                    spawnChild: fakeSpawner().spawn,
                    memory: fakeMemory().probe,
                    kartenvorschlagRetentionEveryMs: 3_600_000,
                    ...(mitAblage ? { kartenvorschlagAblage: store } : {}),
                });
            // Ohne Ablage läuft nichts, der Lauf steht als gescheitert da und die Zeile bleibt (die Schlüssel gingen sonst verloren).
            expect(await arbeiter(false).pflege()).toMatchObject({ kartenvorschlagRetention: true });
            expect(await da(weg.id)).toBe(true);
            await database`DELETE FROM job WHERE kind = ${KARTENVORSCHLAG_RETENTION_KIND} AND release = ${release}`;
            expect(await arbeiter(true).pflege()).toMatchObject({ kartenvorschlagRetention: true });
            expect(await da(weg.id)).toBe(false);
            expect(await store.exists(weg.schluessel!)).toBe(false);
            const laeufe = await database<{ state: string; origin: string; error_code: string | null }[]>`
                SELECT state, origin, error_code FROM job WHERE kind = ${KARTENVORSCHLAG_RETENTION_KIND} AND release = ${release}`;
            expect(laeufe).toEqual([{ state: "SUCCEEDED", origin: "recorded", error_code: null }]);
            // Im selben Abstand läuft sie nicht noch einmal.
            expect(await arbeiter(true).pflege()).toMatchObject({ kartenvorschlagRetention: false });
        });

        it("SECURITY DEFINER mit festem search_path; PUBLIC darf sie nicht rufen; jede Tafel aus MEDIA_USAGE_TABLES wird auf aktive Verwendung geprüft", async () => {
            const [funktion] = await database<
                { definer: boolean; config: string[] | null; public_darf: boolean; prosrc: string }[]
            >`
                SELECT p.prosecdef AS definer, p.proconfig AS config, has_function_privilege('public', p.oid, 'EXECUTE') AS public_darf, p.prosrc
                  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'kartenvorschlag_aufbewahren'`;
            expect(funktion).toMatchObject({
                definer: true,
                config: ["search_path=public, pg_temp"],
                public_darf: false,
            });
            const { MEDIA_USAGE_TABLES } = await import("../src/media-editor/usage-sql.ts");
            for (const tafel of MEDIA_USAGE_TABLES) {
                expect(funktion!.prosrc, `${tafel} fehlt in kartenvorschlag_aufbewahren`).toContain(
                    `FROM ${tafel} WHERE media_asset_id = v_asset AND retired_at IS NULL`,
                );
            }
        });
    });

    describe("Notaus", () => {
        it("🔴 Schalter aus: Einreichen 503 kartenvorschlag_paused, stand.einreichen falsch; Status, Datei nachreichen und Redaktion laufen weiter; wieder an: geht", async () => {
            const vorhanden = mitDatei({ titel: "Schon eingereicht" });
            await einreichenOk(vorhanden);
            await schalter(false);
            try {
                const neu = link({ titel: "Während der Pause" });
                const antwort = await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, neu);
                expect(fehler(antwort)).toBe("503 kartenvorschlag_paused");
                expect(antwort.body).toContain("Kartenvorschläge werden gerade nicht angenommen.");
                expect(await zeile(neu.schluessel), "nichts wurde angelegt").toBeUndefined();
                const stand = await app.inject({ method: "GET", url: `${KARTENVORSCHLAG_URL}/stand` });
                expect(Value.Check(KartenvorschlagStand, stand.json())).toBe(true);
                expect(stand.json()).toEqual({ einreichen: false });
                // Was schon eingereicht ist, bleibt bedienbar.
                expect(
                    fehler(await senden(`${KARTENVORSCHLAG_URL}/status`, { schluessel: vorhanden.schluessel })),
                ).toBe("200");
                expect(fehler(await dateiHoch(vorhanden.schluessel, (await jpegMitMetadaten(77)).bytes))).toBe("200");
                const liste = await app.inject({
                    method: "GET",
                    url: KARTENVORSCHLAG_REDAKTION_URL,
                    headers: { cookie: reviewer.cookie },
                });
                expect(liste.statusCode).toBe(200);
            } finally {
                await schalter(true);
            }
            const stand = await app.inject({ method: "GET", url: `${KARTENVORSCHLAG_URL}/stand` });
            expect(stand.json()).toEqual({ einreichen: true });
            await einreichenOk(link({ titel: "Nach der Pause" }));
        });
    });
});
