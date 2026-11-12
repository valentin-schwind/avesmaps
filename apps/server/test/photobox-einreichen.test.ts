import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MEDIA_AUDIT_DETAIL_KEYS } from "../src/media-editor/operation-store.ts";
import { decidePublication, type PublicationRequest } from "../src/media/policy.ts";
import { MediaStore } from "../src/media/storage.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import {
    einreichung,
    legeOrtAn,
    neueOperation,
    neueSpuren,
    pngUpload,
    raeumeAuf,
    svgUpload,
    zaehle,
} from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Ein Reisebild einreichen, ohne Konto (WI-0272 S2, Aufgabe 9, `photobox/einreichen.ts`) gegen echtes PostgreSQL und einen echten Medienspeicher.
 *
 * - Eine gültige Einreichung legt genau EIN Asset (`community_upload`, `pending`), seine Quelldatei, Rechte (`permission` bzw. `license`
 *   `cc-by-4.0`, nie geprüft), Entstehung, den Eingang mit der Einreichung und OHNE Dateinamen, die Einreichung (`incoming`) und einen
 *   `media_settle`-Auftrag ohne Person an.
 * - SVG ist 415 und schreibt keine Datei; eine Avesmaps-Aufnahme unter CC BY ist 422.
 * - Dieselbe Operation noch einmal: dieselbe Quittung, keine zweite Zeile (M10); derselbe Schlüssel mit anderer Kennung: 409.
 * - 🔴 `decidePublication` hält das neue Asset in der Rolle `photobox` zurück (`moderation_pending`), selbst mit Regel und Freigabe.
 */

/** Alle Dateien unter einem Verzeichnis, relativ (für „es ist keine Datei geschrieben“). */
async function dateien(wurzel: string, unter = ""): Promise<string[]> {
    const gefunden: string[] = [];
    for (const eintrag of await readdir(join(wurzel, unter), { withFileTypes: true }).catch(() => [])) {
        const pfad = unter === "" ? eintrag.name : `${unter}/${eintrag.name}`;
        if (eintrag.isDirectory()) gefunden.push(...(await dateien(wurzel, pfad)));
        else gefunden.push(pfad);
    }
    return gefunden.sort();
}

describeWithDatabase("Reisebild einreichen (WI-0272 S2, Aufgabe 9)", { timeout: 120_000 }, () => {
    let database: Database;
    let mediaRoot = "";
    let store: MediaStore;
    const spuren = neueSpuren();
    const platz: { id: string; publicId: string }[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-einreichen-"));
        store = new MediaStore(mediaRoot);
    }, 120_000);

    afterEach(async () => {
        await raeumeAuf(database, spuren);
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
    });

    afterAll(async () => {
        await raeumeAuf(database, spuren);
        for (const ort of platz) await database`DELETE FROM place WHERE id = ${ort.id}::bigint`;
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    const zahlen = () => zaehle(database, spuren);

    it("🔴 eine gültige Einreichung legt Asset, Quelldatei, Rechte, Entstehung, Eingang, Einreichung und einen Auftrag an", async () => {
        const body = await einreichung(spuren, 1, {
            name: "  Alrike  ",
            beschreibung: "  Der Blick vom Hafen  ",
            blickrichtung: 3,
        });
        expect(await zahlen()).toEqual({ einreichung: 0, asset: 0, datei: 0, eingang: 0, operation: 0, auftrag: 0 });
        const antwort = await einreichen(database, store, "test", body);
        expect(antwort.publicId).toMatch(/^[0-9a-f-]{36}$/u);

        const [einreichungRow] = await database<
            {
                id: string;
                public_id: string;
                state: string;
                description: string;
                name: string | null;
                richtung: number | null;
                creation: string;
                grant: string;
                x: number;
                y: number;
                terms: string;
                hash: Buffer;
            }[]
        >`
            SELECT id::text AS id, public_id::text AS public_id, state, description, attribution_name AS name, view_direction AS richtung,
                   creation_kind AS creation, usage_grant AS grant, ST_X(geom) AS x, ST_Y(geom) AS y, terms_version AS terms, status_key_hash AS hash
              FROM media_submission WHERE public_id = ${antwort.publicId}::uuid`;
        expect(einreichungRow).toMatchObject({
            public_id: antwort.publicId,
            state: "incoming",
            // Getrimmt gespeichert (die Datenbank zählt nach btrim).
            description: "Der Blick vom Hafen",
            name: "Alrike",
            richtung: 3,
            creation: "photo",
            grant: "avesmaps_only",
            x: 300,
            y: 300,
        });
        expect(einreichungRow!.terms).toBe(body.bedingungen);
        // Gespeichert ist nur der Hash des Schlüssels.
        expect(einreichungRow!.hash.byteLength).toBe(32);

        // Genau EIN Asset, eine Quelldatei, ein Eingang, eine Operation und ein Auftrag.
        expect(await zahlen()).toEqual({ einreichung: 1, asset: 1, datei: 1, eingang: 1, operation: 1, auftrag: 1 });

        const assets = await database<
            {
                id: string;
                public_id: string;
                origin: string;
                moderation: string;
                technical: string;
                type: string | null;
                method: string;
                kind: string;
                source_system: string;
            }[]
        >`
            SELECT a.id::text AS id, a.public_id::text AS public_id, a.origin, a.moderation_state AS moderation, a.technical_state AS technical,
                   a.asset_type AS type, a.creation_method AS method, a.media_kind AS kind, a.source_system
              FROM media_asset a JOIN media_ingest i ON i.media_asset_id = a.id WHERE i.submission_id = ${einreichungRow!.id}::bigint`;
        expect(assets).toHaveLength(1);
        const asset = assets[0]!;
        expect(asset).toMatchObject({
            origin: "community_upload",
            moderation: "pending",
            technical: "pending",
            type: "picture",
            method: "photo",
            kind: "image",
            source_system: "photobox",
        });

        const quellen = await database<
            { variant: string; storage_class: string; storage_key: string; mime_type: string }[]
        >`
            SELECT variant, storage_class, storage_key, mime_type FROM media_file WHERE media_asset_id = ${asset.id}::bigint`;
        expect(quellen).toHaveLength(1);
        expect(quellen[0]).toMatchObject({
            variant: "source",
            storage_class: "private_source",
            mime_type: "image/png",
        });
        expect(await store.exists(quellen[0]!.storage_key)).toBe(true);

        const [rechte] = await database<
            {
                basis: string;
                key: string | null;
                family: string | null;
                clearance: string;
                creator: string | null;
                attribution: string | null;
            }[]
        >`
            SELECT rights_basis AS basis, license_key AS key, license_family AS family, clearance_state AS clearance, creator, attribution
              FROM media_rights WHERE media_asset_id = ${asset.id}::bigint`;
        expect(rechte).toEqual({
            basis: "permission",
            key: null,
            family: null,
            clearance: "unreviewed",
            creator: "Alrike",
            attribution: "Alrike",
        });

        const [entstehung] = await database<{ parameters: Record<string, unknown> | null }[]>`
            SELECT parameters FROM media_creation WHERE media_asset_id = ${asset.id}::bigint`;
        expect(entstehung?.parameters).toEqual({ wahl: "photo" });

        const [eingang] = await database<
            {
                kind: string;
                submission: string;
                filename: string | null;
                person: string | null;
                source_system: string | null;
                source_ref: string | null;
            }[]
        >`
            SELECT ingest_kind AS kind, submission_id::text AS submission, original_filename AS filename, actor_person_id::text AS person,
                   source_system, source_ref
              FROM media_ingest WHERE media_asset_id = ${asset.id}::bigint`;
        expect(eingang).toEqual({
            kind: "community_upload",
            submission: einreichungRow!.id,
            // Kein Dateiname der Besucher, keine Person.
            filename: null,
            person: null,
            source_system: "photobox",
            source_ref: `photobox:${antwort.publicId}`,
        });

        const [auftrag] = await database<
            { kind: string; actor_ref: string | null; input_ref: Record<string, unknown> }[]
        >`
            SELECT kind, actor_ref, input_ref FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ${asset.public_id}`;
        expect(auftrag).toEqual({
            kind: "media_settle",
            actor_ref: "photobox",
            input_ref: { asset: asset.public_id, role: "photobox" },
        });

        // Die Operation: anonym, Bezeichnung `photobox`, keine Person.
        const [operation] = await database<
            {
                action: string;
                actor_kind: string;
                actor_label: string | null;
                actor_person_id: string | null;
                environment: string;
            }[]
        >`
            SELECT action, actor_kind, actor_label, actor_person_id::text, environment FROM media_operation WHERE operation_id = ${body.operationId}::uuid`;
        expect(operation).toEqual({
            action: "photobox.submit",
            actor_kind: "anonymous",
            actor_label: "photobox",
            actor_person_id: null,
            environment: "test",
        });
        const protokoll = await database<
            { action: string; asset: string | null; details: Record<string, unknown>; revision: number | null }[]
        >`
            SELECT action, media_asset_public_id::text AS asset, details, target_revision::int AS revision
              FROM media_audit_event WHERE operation_id = ${body.operationId}::uuid`;
        expect(protokoll).toHaveLength(1);
        expect(protokoll[0]).toMatchObject({ action: "photobox.submitted", asset: asset.public_id, revision: 1 });
        // Keine Freitexte im Protokoll: weder Beschreibung noch Name noch Schlüssel.
        const text = JSON.stringify(protokoll[0]!.details);
        expect(text).not.toContain("Hafen");
        expect(text).not.toContain("Alrike");
        expect(text).not.toContain(body.schluessel);
    });

    it("CC BY 4.0 heißt Rechtsgrundlage Lizenz mit dem Katalogschlüssel und der Familie, ungeprüft", async () => {
        const body = await einreichung(spuren, 2, { nutzung: "cc-by-4.0", entstehung: "drawing" });
        const antwort = await einreichen(database, store, "test", body);
        const [rechte] = await database<
            {
                basis: string;
                key: string | null;
                family: string | null;
                clearance: string;
                method: string;
                grant: string;
            }[]
        >`
            SELECT r.rights_basis AS basis, r.license_key AS key, r.license_family AS family, r.clearance_state AS clearance,
                   a.creation_method AS method, s.usage_grant AS grant
              FROM media_submission s
              JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id
              JOIN media_rights r ON r.media_asset_id = a.id
             WHERE s.public_id = ${antwort.publicId}::uuid`;
        expect(rechte).toMatchObject({
            basis: "license",
            key: "cc-by-4.0",
            clearance: "unreviewed",
            method: "drawing",
            grant: "cc-by-4.0",
        });
        expect(rechte!.family).toMatch(/^cc/u);
    });

    it("ein Ort und ein Bezug werden gespeichert; ein unbekannter Ort ist 422 ohne Zeile und ohne Datei", async () => {
        const ort = await legeOrtAn(database);
        platz.push(ort);
        const body = await einreichung(spuren, 3, {
            placeId: ort.publicId,
            bezug: { art: "landschaft", id: "name:Svellt" },
        });
        const antwort = await einreichen(database, store, "test", body);
        const [row] = await database<{ place_id: string | null; kind: string | null; key: string | null }[]>`
            SELECT place_id::text AS place_id, reference_kind AS kind, reference_key AS key FROM media_submission WHERE public_id = ${antwort.publicId}::uuid`;
        expect(row).toEqual({ place_id: ort.id, kind: "landschaft", key: "name:Svellt" });

        const dateienVorher = await dateien(mediaRoot);
        const vorherZahlen = await zahlen();
        const fremd = await einreichung(spuren, 4, { placeId: "6d656469-0000-4000-8000-0000000fffff" });
        // WI-0291: der Fachcode steht in `details.reason`, das Fenster sagt daraus, was zu tun ist.
        await expect(einreichen(database, store, "test", fremd)).rejects.toMatchObject({
            statusCode: 422,
            code: "photobox_invalid",
            details: { reason: "ort_unbekannt" },
        });
        expect(await zahlen()).toEqual(vorherZahlen);
        expect(await dateien(mediaRoot)).toEqual(dateienVorher);
    });

    it("🔴 ein SVG wird mit 415 abgewiesen, und es ist keine Datei geschrieben", async () => {
        const vorher = await dateien(mediaRoot);
        const body = await einreichung(spuren, 5, { bild: svgUpload() });
        await expect(einreichen(database, store, "test", body)).rejects.toMatchObject({
            statusCode: 415,
            code: "unsupported_media_type",
        });
        expect(await dateien(mediaRoot)).toEqual(vorher);
        expect((await zahlen()).einreichung).toBe(0);
        expect((await zahlen()).asset).toBe(0);
    });

    it("kein Bild (Text) ist 415, ein Bild über 6 MiB ist 413; beide schreiben nichts", async () => {
        const vorher = await dateien(mediaRoot);
        const text = await einreichung(spuren, 6, {
            bild: { name: "x.png", dataBase64: Buffer.from("das ist kein Bild").toString("base64") },
        });
        await expect(einreichen(database, store, "test", text)).rejects.toMatchObject({ statusCode: 415 });
        const gross = await einreichung(spuren, 7, {
            bild: {
                name: "x.png",
                dataBase64: Buffer.concat([
                    Buffer.from("89504e470d0a1a0a", "hex"),
                    Buffer.alloc(6 * 1024 * 1024 + 1),
                ]).toString("base64"),
            },
        });
        await expect(einreichen(database, store, "test", gross)).rejects.toMatchObject({ statusCode: 413 });
        expect(await dateien(mediaRoot)).toEqual(vorher);
    });

    it("🔴 eine Avesmaps-Aufnahme unter CC BY ist 422, nichts wird geschrieben", async () => {
        const vorher = await dateien(mediaRoot);
        const body = await einreichung(spuren, 8, { entstehung: "avesmaps_capture", nutzung: "cc-by-4.0" });
        await expect(einreichen(database, store, "test", body)).rejects.toMatchObject({
            statusCode: 422,
            code: "photobox_invalid",
            details: { reason: "cc_by_avesmaps" },
        });
        expect((await zahlen()).einreichung).toBe(0);
        expect(await dateien(mediaRoot)).toEqual(vorher);
        // Dieselbe Aufnahme nur für Avesmaps geht.
        const gueltig = await einreichung(spuren, 8, { entstehung: "avesmaps_capture", nutzung: "avesmaps_only" });
        const antwort = await einreichen(database, store, "test", gueltig);
        const [asset] = await database<{ method: string }[]>`
            SELECT a.creation_method AS method FROM media_asset a JOIN media_ingest i ON i.media_asset_id = a.id JOIN media_submission s ON s.id = i.submission_id
             WHERE s.public_id = ${antwort.publicId}::uuid`;
        expect(asset?.method).toBe("derived");
    });

    it("eine Stelle außerhalb der Karte (auch genau auf dem Rand) ist 422; beschreibung nur aus Leerraum ist 422", async () => {
        const { minX, minY } = AVENTURIA.coordinateSpace.bounds;
        const rand = await einreichung(spuren, 9, { lage: { x: minX, y: minY } });
        await expect(einreichen(database, store, "test", rand)).rejects.toMatchObject({
            statusCode: 422,
            code: "photobox_invalid",
            details: { reason: "stelle_ausserhalb" },
        });
        const draussen = await einreichung(spuren, 9, { lage: { x: minX - 500, y: minY - 500 } });
        await expect(einreichen(database, store, "test", draussen)).rejects.toMatchObject({ statusCode: 422 });
        const leer = await einreichung(spuren, 9, { beschreibung: "   " });
        await expect(einreichen(database, store, "test", leer)).rejects.toMatchObject({
            statusCode: 422,
            code: "photobox_invalid",
            details: { reason: "feld_leer", feld: "beschreibung" },
        });
        const namenlos = await einreichung(spuren, 9, { name: "  " });
        await expect(einreichen(database, store, "test", namenlos)).rejects.toMatchObject({
            statusCode: 422,
            code: "photobox_invalid",
            details: { reason: "feld_leer", feld: "name" },
        });
        expect((await zahlen()).einreichung).toBe(0);
    });

    it("🔴 dieselbe Operation noch einmal: dieselbe Quittung, die Zeilenzahl bleibt; derselbe Schlüssel mit anderer Kennung ist 409", async () => {
        const body = await einreichung(spuren, 10);
        const erste = await einreichen(database, store, "test", body);
        const vorher = await zahlen();
        expect(vorher).toEqual({ einreichung: 1, asset: 1, datei: 1, eingang: 1, operation: 1, auftrag: 1 });
        const dateienVorher = await dateien(mediaRoot);
        const zweite = await einreichen(database, store, "test", body);
        expect(zweite).toEqual(erste);
        expect(await zahlen()).toEqual(vorher);
        expect(await dateien(mediaRoot)).toEqual(dateienVorher);

        // Dieselbe Kennung mit anderem Inhalt: die Wiederholung ist keine (M10).
        await expect(
            einreichen(database, store, "test", { ...body, beschreibung: "Etwas ganz anderes" }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: "idempotency_key_reused",
        });
        // Derselbe Schlüssel, neue Kennung: der Link gehört schon einer Einreichung.
        await expect(
            einreichen(database, store, "test", {
                ...body,
                operationId: neueOperation(spuren),
                bild: await pngUpload(11),
            }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: "photobox_key_used",
            details: { reason: "schluessel_belegt" },
        });
        expect(await zahlen()).toEqual(vorher);
    });

    it("🔴 decidePublication hält das neue Asset in der Rolle photobox zurück (moderation_pending), auch mit Regel und Freigabe", async () => {
        const body = await einreichung(spuren, 12);
        const antwort = await einreichen(database, store, "test", body);
        const [fakten] = await database<
            {
                moderation: string;
                method: string;
                technical: string;
                basis: string;
                clearance: string;
                key: string | null;
            }[]
        >`
            SELECT a.moderation_state AS moderation, a.creation_method AS method, a.technical_state AS technical,
                   r.rights_basis AS basis, r.clearance_state AS clearance, r.license_key AS key
              FROM media_submission s JOIN media_ingest i ON i.submission_id = s.id JOIN media_asset a ON a.id = i.media_asset_id
              JOIN media_rights r ON r.media_asset_id = a.id WHERE s.public_id = ${antwort.publicId}::uuid`;
        const anfrage = (technical: "ok" | "pending"): PublicationRequest => ({
            role: "photobox",
            asset: {
                mediaKind: "image",
                technicalState: technical,
                moderationState: fakten!.moderation as "pending",
                creationMethod: "photo",
            },
            rights: {
                basis: fakten!.basis as "permission",
                clearance: fakten!.clearance as "unreviewed",
                licenseKey: fakten!.key,
                licenseRequiresAttribution: null,
            },
            usage: { role: "photobox", suppressed: false, retired: false, override: "approved" },
            published: { mimeType: "image/webp" },
            rules: [
                { rightsBasis: "permission", licenseKey: null, creationMethod: null, role: "photobox", revoked: false },
            ],
        });
        // Technisch fertig, Regel und Einzelfreigabe da: nur die Moderation hält es zurück.
        expect(decidePublication(anfrage("ok"))).toEqual({ allowed: false, reason: "moderation_pending" });
        // So, wie es heute in der Datenbank steht, hält schon der technische Zustand es zurück.
        expect(decidePublication(anfrage("pending"))).toEqual({ allowed: false, reason: "technical_state_not_ok" });
    });

    it("die Fachprotokoll-Handlungen der Reisebilder stehen in der Positivliste, ohne Freitext", () => {
        for (const handlung of [
            "photobox.submitted",
            "photobox.description_set",
            "photobox.image_replaced",
            "photobox.withdrawn",
            "photobox.offline",
            "photobox.grant_set",
        ] as const) {
            const schluessel = MEDIA_AUDIT_DETAIL_KEYS[handlung] as readonly string[];
            expect(Array.isArray(schluessel), handlung).toBe(true);
            for (const key of schluessel)
                expect(
                    ["reason", "note", "description", "name", "text", "beschreibung"],
                    `${handlung}.${key}`,
                ).not.toContain(key);
        }
    });

    it("die Quelldatei liegt privat und bytegleich im Speicher", async () => {
        const body = await einreichung(spuren, 13);
        const antwort = await einreichen(database, store, "test", body);
        const [datei] = await database<{ storage_key: string; byte_size: number }[]>`
            SELECT f.storage_key, f.byte_size::int AS byte_size
              FROM media_file f JOIN media_ingest i ON i.media_asset_id = f.media_asset_id JOIN media_submission s ON s.id = i.submission_id
             WHERE s.public_id = ${antwort.publicId}::uuid`;
        expect(datei!.storage_key.startsWith("private/")).toBe(true);
        const info = await stat(join(mediaRoot, datei!.storage_key));
        expect(info.size).toBe(datei!.byte_size);
    });
});
