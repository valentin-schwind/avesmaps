import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA, type KartenvorschlagNutzung } from "@avesmaps3d/shared";
import { rechneBeitragsbild } from "../src/community/social/beitrag-bild.ts";
import { JobWorker } from "../src/jobs/worker.ts";
import { kartenvorschlagAufbewahrung, KARTENVORSCHLAG_RETENTION_KIND } from "../src/kartenvorschlag/aufbewahrung.ts";
import { legeWerkAn, pruefeKartendatei } from "../src/kartenvorschlag/db.ts";
import {
    ORIGINAL_LOESCHEN_AN,
    gesichertBis,
    originalLoeschen,
    originalOptionenAus,
    profilVerlustfrei,
    type OriginalAblage,
    type OriginalLoeschenLauf,
} from "../src/kartenvorschlag/original-loeschen.ts";
import { holeWahrnehmungNach } from "../src/media-editor/aehnlich.ts";
import { fuehreZusammen } from "../src/media-editor/merge.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { profileForRole } from "../src/media/raster/profiles.ts";
import { recipeVersion } from "../src/media/raster/render.ts";
import { MediaStore, sha256Of, storageKey } from "../src/media/storage.ts";
import { fakeMemory, fakeSpawner, testJobsConfig, uniqueScope } from "./support/jobs-support.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Das Original eines angenommenen Kartenvorschlags (WI-0275, Betreiberentscheid 2026-11-04), so wie auf dem VPS: Wegwerf-Cluster mit den Rollen und ALLEN Vorlagen unter `apps/server/src/db/*.psql`, Lauf und
 * Abgleich als Jobs-Rolle, eine echte Ablage auf der Platte.
 *
 * - der Schalter: Ausgeschaltet entfernt der Lauf nichts und schreibt keine Zeile;
 * - 🔴 die zwei Schritte: erst der Master, Stempel und Entfernen erst, wenn er in einer Sicherung liegt; was die Statusdatei dafür hergeben muss;
 * - die Fälligkeit: Welche Bedingung hält was zurück;
 * - geteilte Bytes samt zweier Fälliger, nachgewachsene Dateien, die Sperre gegen ein gleichzeitiges Anlegen;
 * - ein Absturz zwischen den Schritten;
 * - 🔴 nach dem Löschen: Rechte in beide Richtungen, Rezeptwechsel, fremde Rolle, Notaus, Zusammenführen. Das Werk bleibt `ok`, unter `private/source` entsteht nichts;
 * - der Master fehlt: `missing_file`, nichts fällt weg, Rückspielen heilt;
 * - Name und Notiz nach 90 Tagen.
 */

const ENV = "kvoriginal";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const PERSON = "7e570000-0000-4000-8000-00000000000a";
const describeWithCluster = postgresBin ? describe : describe.skip;

/** Ein undurchsichtiges PNG aus Rauschen, je Saat andere Bytes. */
async function bild(saat: number, breite = 64, hoehe = 48): Promise<Buffer> {
    const roh = Buffer.alloc(breite * hoehe * 3);
    let stand = createHash("sha256").update(String(saat)).digest();
    for (let i = 0; i < roh.length; i += stand.length) {
        stand = createHash("sha256").update(stand).digest();
        stand.copy(roh, i);
    }
    return sharp(roh, { raw: { width: breite, height: hoehe, channels: 3 } })
        .png()
        .toBuffer();
}

const pixel = async (bytes: Uint8Array): Promise<Buffer> => sharp(bytes).ensureAlpha().raw().toBuffer();

/** Eine PDF mit zwei Seiten (Muster `media-raster-pdf.test.ts`). */
function pdfMitZweiSeiten(): Buffer {
    const inhalt = "0.8 0.1 0.1 rg 50 50 500 300 re f";
    const objekte = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Contents 4 0 R >>",
        `<< /Length ${String(inhalt.length)} >>\nstream\n${inhalt}\nendstream`,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Contents 4 0 R >>",
    ];
    let body = "%PDF-1.4\n";
    const lagen: number[] = [];
    objekte.forEach((objekt, index) => {
        lagen.push(body.length);
        body += `${String(index + 1)} 0 obj\n${objekt}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${String(objekte.length + 1)}\n0000000000 65535 f \n`;
    for (const lage of lagen) body += `${String(lage).padStart(10, "0")} 00000 n \n`;
    body += `trailer\n<< /Size ${String(objekte.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
    return Buffer.from(body, "latin1");
}

interface Werk {
    id: string;
    publicId: string;
    schluessel: string;
    sha256: string;
}

interface Dateizeile {
    id: string;
    variant: string;
    storage_class: string;
    storage_key: string;
    sha256: string;
    recipe_version: string | null;
    bytes_deleted_at: Date | null;
}

describeWithCluster("Original eines angenommenen Kartenvorschlags (Wegwerf-Cluster, Jobs-Rolle, echte Ablage)", () => {
    let cluster: VpsCluster;
    let wurzel = "";
    let store: MediaStore;
    let statusDatei = "";
    let saat = 1000;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN, { mapDomains: true });
        wurzel = mkdtempSync(join(tmpdir(), "avesmaps3d-kvoriginal-"));
        store = new MediaStore(wurzel);
        statusDatei = join(wurzel, "sicherung-status.json");
    }, 240_000);

    afterEach(async () => {
        // Was ein Fall stehen ließ, ist für den nächsten nicht mehr fällig: Jeder Fall zählt nur sein eigenes Werk.
        await cluster.admin`UPDATE citymap_suggestion SET decided_at = now() WHERE state = 'approved'`;
        await cluster.admin`DELETE FROM job_event WHERE job_id IN (SELECT id FROM job WHERE kind = 'media_settle')`;
        await cluster.admin`DELETE FROM job WHERE kind = 'media_settle'`;
        await rm(statusDatei, { force: true });
    });

    afterAll(async () => {
        await cluster?.stop();
        if (wurzel !== "") rmSync(wurzel, { recursive: true, force: true });
    }, 60_000);

    const abgleich = (publicId: string, role: "map_full" | "header" = "map_full") =>
        settleAssetFiles(cluster.jobs, store, { assetPublicId: publicId, role });
    const lauf = (ablage: OriginalAblage = store) =>
        originalLoeschen(cluster.jobs, ablage, { an: true, sicherungStatus: statusDatei });
    /** Vor einer Sekunde, in einer Sekunde: Die Master-Zeilen eines Falls entstehen dazwischen. */
    const vorhin = (): string => new Date(Date.now() - 60_000).toISOString();
    const gleich = (): string => new Date(Date.now() + 1000).toISOString();
    /** Die Statusdatei, wie `ops/backup/avesmaps3d-backup.sh` sie nach einem gelungenen Lauf schreibt, der gerade erst beginnt; `aenderung` überschreibt einzelne Felder. */
    const sicherungsStatus = (aenderung: Record<string, unknown> = {}): Record<string, unknown> => ({
        schema_version: 1,
        last_run: { started_at: gleich(), finished_at: gleich(), result: "ok", error_code: null, trigger: "timer" },
        last_success_at: gleich(),
        parts: [
            {
                kind: "db",
                bytes: 1,
                sha256: "a".repeat(64),
                encrypted: true,
                offsite: "dropbox",
                offsite_verified_at: gleich(),
            },
            {
                kind: "media_production",
                bytes: 1,
                sha256: "b".repeat(64),
                encrypted: true,
                offsite: "dropbox",
                offsite_verified_at: gleich(),
            },
        ],
        ...aenderung,
    });
    const schreibeStatus = (inhalt: unknown): Promise<void> => writeFile(statusDatei, JSON.stringify(inhalt));
    const sicherungLief = (): Promise<void> => schreibeStatus(sicherungsStatus());
    /** Die beiden Schritte: Der erste Lauf legt den Master an, die Sicherung läuft, der zweite Lauf stempelt und entfernt. Sein Ergebnis zählt. */
    const zweiLaeufe = async (ablage: OriginalAblage = store): Promise<OriginalLoeschenLauf> => {
        await lauf();
        await sicherungLief();
        return lauf(ablage);
    };
    /** Die echte Ablage, an einer Stelle abgeändert: So stürzt ein Lauf zwischen zwei Schritten ab. */
    const mit = (aenderung: Partial<OriginalAblage>): OriginalAblage => ({
        read: (key, max) => store.read(key, max),
        store: (klasse, inhalt, endung) => store.store(klasse, inhalt, endung),
        exists: (key) => store.exists(key),
        removeAfterDelete: (key) => store.removeAfterDelete(key),
        ...aenderung,
    });

    async function neuesWerk(bytes?: Buffer, mime = "image/png"): Promise<Werk> {
        saat += 1;
        const datei = pruefeKartendatei(bytes ?? (await bild(saat)), mime);
        const nutzung: KartenvorschlagNutzung = "avesmaps_only";
        const werk = await cluster.migrator.begin((tx) =>
            legeWerkAn(tx, store, datei, { titel: `Karte ${String(saat)}`, nutzung, urheber: null }),
        );
        const [zeile] = await cluster.admin<{ storage_key: string }[]>`
            SELECT storage_key FROM media_file WHERE media_asset_id = ${werk.id}::bigint AND storage_class = 'private_source'
        `;
        await abgleich(werk.publicId);
        return { id: werk.id, publicId: werk.publicId, schluessel: zeile!.storage_key, sha256: werk.sha256 };
    }

    /** Macht aus dem Werk einen Vorschlag; mit Karte und Verwendung, wenn er angenommen ist. */
    async function vorschlag(
        werk: Werk,
        optionen: { state?: "approved" | "pending" | "rejected"; tage?: number } = {},
    ): Promise<string> {
        const state = optionen.state ?? "approved";
        const tage = optionen.tage ?? 8;
        let karte: string | null = null;
        if (state === "approved") {
            const [zeile] = await cluster.admin<{ id: string }[]>`
                INSERT INTO citymap (public_id, title, source_system) VALUES (gen_random_uuid(), 'Karte', 'avesmaps3d') RETURNING id::text AS id
            `;
            karte = zeile!.id;
            await cluster.admin`
                INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin) VALUES (${karte}::bigint, ${werk.id}::bigint, 'map_full', 'editor')
            `;
            await cluster.admin`UPDATE media_asset SET moderation_state = 'approved' WHERE id = ${werk.id}::bigint`;
        }
        const entschieden = state === "pending" ? null : new Date(Date.now() - tage * 86_400_000);
        const [zeile] = await cluster.admin<{ id: string }[]>`
            INSERT INTO citymap_suggestion (operation_id, state, status_key_hash, way, title, file_mime, media_asset_id, usage_grant, terms_version,
                                            attribution_name, note, decided_at, state_changed_at, accepted_citymap_id)
            VALUES (${randomUUID()}::uuid, ${state}, ${createHash("sha256").update(randomUUID()).digest()}, 'file', 'Vorschlag', 'image/png', ${werk.id}::bigint,
                    'avesmaps_only', 'kv-original-test', 'Alrik', 'Eine Notiz', ${entschieden}, ${entschieden ?? new Date()}, ${karte}::bigint)
            RETURNING id::text AS id
        `;
        if (state === "approved") await abgleich(werk.publicId);
        return zeile!.id;
    }

    const faelligesWerk = async (bytes?: Buffer): Promise<Werk> => {
        const werk = await neuesWerk(bytes);
        await vorschlag(werk);
        return werk;
    };

    const zeilen = (werk: Pick<Werk, "id">) =>
        cluster.admin<Dateizeile[]>`
            SELECT id::text AS id, variant, storage_class, storage_key, sha256, recipe_version, bytes_deleted_at
              FROM media_file WHERE media_asset_id = ${werk.id}::bigint ORDER BY id
        `;
    const zeile = async (werk: Pick<Werk, "id">, klasse: string): Promise<Dateizeile | undefined> =>
        (await zeilen(werk)).find((eintrag) => eintrag.storage_class === klasse);
    const zustand = async (werk: Pick<Werk, "id">): Promise<string | undefined> => {
        const [row] = await cluster.admin<
            { technical_state: string }[]
        >`SELECT technical_state FROM media_asset WHERE id = ${werk.id}::bigint`;
        return row?.technical_state;
    };
    const unterQuelle = async (): Promise<string[]> =>
        (await readdir(join(wurzel, "private", "source"), { recursive: true, withFileTypes: true }).catch(() => []))
            .filter((eintrag) => eintrag.isFile())
            .map((eintrag) => eintrag.name)
            .sort();
    const oeffentlich = (werk: Pick<Werk, "id">) =>
        cluster.admin`UPDATE media_rights SET rights_basis = 'public_domain', license_key = NULL, license_family = NULL, clearance_state = 'cleared' WHERE media_asset_id = ${werk.id}::bigint`;
    const privat = (werk: Pick<Werk, "id">) =>
        cluster.admin`UPDATE media_rights SET clearance_state = 'unreviewed' WHERE media_asset_id = ${werk.id}::bigint`;
    /** Täuscht ein altes Rezept vor (ein Sprung von sharp oder libwebp): Der Abgleich rechnet neu. */
    const altesRezept = (werk: Pick<Werk, "id">) =>
        cluster.admin`UPDATE media_file SET recipe_version = '1 / sharp 0 / libvips 0 / libwebp 0' WHERE media_asset_id = ${werk.id}::bigint AND storage_class IN ('published', 'derivative')`;

    /** Lässt das Original eines fälligen Werks wirklich fallen und prüft, dass es so war. */
    const geloeschtesWerk = async (bytes?: Buffer): Promise<Werk> => {
        const werk = await faelligesWerk(bytes);
        const ergebnis = await zweiLaeufe();
        expect(ergebnis.gestempelt, JSON.stringify(ergebnis)).toBe(1);
        expect(await store.exists(werk.schluessel)).toBe(false);
        return werk;
    };

    describe("der Schalter", () => {
        it("🔴 er steht aus; ausgeschaltet entfernt der Lauf keine Datei und schreibt keine Zeile, er zählt nur", async () => {
            expect(ORIGINAL_LOESCHEN_AN).toBe(false);
            const werk = await faelligesWerk();
            const vorher = await zeilen(werk);
            const ergebnis = await originalLoeschen(cluster.jobs, store);
            expect(ergebnis).toMatchObject({ an: false, faellig: 1, gestempelt: 0, dateien: 0, fehlgeschlagen: 0 });
            expect(await store.exists(werk.schluessel)).toBe(true);
            expect(await zeilen(werk)).toEqual(vorher);
            const fassung = await zeile(werk, "derivative");
            expect(
                await store.exists(storageKey("master", fassung!.sha256, "webp")),
                "kein Master auf der Platte",
            ).toBe(false);
        });

        it("🔴 auch der ganze Job der Pflege entfernt nichts: als Jobs-Rolle gelaufen, das Ergebnis nennt, was fällig wäre", async () => {
            const werk = await faelligesWerk();
            const release = `kvoriginal-${randomUUID()}`;
            const arbeiter = new JobWorker({
                database: cluster.jobs,
                config: testJobsConfig(),
                mapDomainId: AVENTURIA.mapDomain,
                release,
                deriveScope: uniqueScope("derive"),
                spawnChild: fakeSpawner().spawn,
                memory: fakeMemory().probe,
                kartenvorschlagRetentionEveryMs: 3_600_000,
                kartenvorschlagAblage: store,
            });
            expect(await arbeiter.pflege()).toMatchObject({ kartenvorschlagRetention: true });
            expect(await store.exists(werk.schluessel)).toBe(true);
            expect(await zeile(werk, "master")).toBeUndefined();
            expect((await zeile(werk, "private_source"))?.bytes_deleted_at).toBeNull();
            const [job] = await cluster.admin<{ state: string; result: { original: Record<string, unknown> } }[]>`
                SELECT state, result FROM job WHERE kind = ${KARTENVORSCHLAG_RETENTION_KIND} AND release = ${release}
            `;
            expect(job?.state).toBe("SUCCEEDED");
            expect(job?.result.original).toMatchObject({ an: false, faellig: 1, gestempelt: 0, dateien: 0 });
        });
    });

    describe("der Regelfall", () => {
        it("🔴 Zeile bleibt mit allen Werten und Stempel, daneben der Master als Kopie der verlustfreien Fassung, die Datei ist weg", async () => {
            const bytes = await bild(++saat, 80, 60);
            const werk = await faelligesWerk(bytes);
            const vorher = await zeile(werk, "private_source");
            const fassung = (await zeilen(werk)).find((eintrag) => eintrag.variant === "intern_citymap_full");
            expect(fassung).toBeDefined();
            const ergebnis = await zweiLaeufe();
            expect(ergebnis).toMatchObject({
                an: true,
                faellig: 1,
                gestempelt: 1,
                dateien: 1,
                gehalten: 0,
                fehlgeschlagen: 0,
            });
            const nachher = await zeile(werk, "private_source");
            expect(nachher).toMatchObject({
                id: vorher!.id,
                storage_key: vorher!.storage_key,
                sha256: vorher!.sha256,
            });
            expect(nachher!.bytes_deleted_at).toBeInstanceOf(Date);
            expect(await store.exists(werk.schluessel)).toBe(false);
            const master = await zeile(werk, "master");
            expect(master).toMatchObject({ variant: "master", sha256: fassung!.sha256, recipe_version: null });
            expect(master!.storage_key.startsWith("master/")).toBe(true);
            // Die Kopie trägt dieselben Pixel wie die hochgeladene Datei.
            const gelesen = await store.read(master!.storage_key, 10_000_000);
            expect(sha256Of(gelesen)).toBe(master!.sha256);
            expect((await pixel(gelesen)).equals(await pixel(bytes))).toBe(true);
            expect(await zustand(werk)).toBe("ok");
            // Der zweite Lauf hat nichts mehr zu tun.
            expect(await lauf()).toMatchObject({ faellig: 0, gestempelt: 0, dateien: 0 });
        });

        it("eine veröffentlichte Fassung dient genauso als Vorlage des Masters", async () => {
            const werk = await neuesWerk();
            await vorschlag(werk);
            await oeffentlich(werk);
            await abgleich(werk.publicId);
            const veroeffentlicht = await zeile(werk, "published");
            expect(veroeffentlicht?.variant).toBe("citymap_full");
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, dateien: 1 });
            expect((await zeile(werk, "master"))?.sha256).toBe(veroeffentlicht!.sha256);
        });

        it("🔴 ein PDF: Es bleibt nur Seite 1, das Werk bleibt ok und rechnet danach aus dem Master", async () => {
            const werk = await neuesWerk(pdfMitZweiSeiten(), "application/pdf");
            await vorschlag(werk);
            expect(await zustand(werk)).toBe("ok");
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, dateien: 1 });
            expect(await store.exists(werk.schluessel)).toBe(false);
            const master = await zeile(werk, "master");
            const metadaten = await sharp(await store.read(master!.storage_key, 10_000_000)).metadata();
            expect(metadaten.format).toBe("webp");
            expect(metadaten.pages ?? 1).toBe(1);
            await altesRezept(werk);
            expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", unchanged: false });
        }, 120_000);
    });

    describe("🔴 zwei Schritte: Das Original fällt erst, wenn der Master in einer Sicherung liegt", () => {
        const masterzeilen = async (werk: Pick<Werk, "id">): Promise<Dateizeile[]> =>
            (await zeilen(werk)).filter((eintrag) => eintrag.storage_class === "master");
        /** Nichts gestempelt, nichts entfernt, der Master liegt, das Original auch. */
        const wartet = async (werk: Werk, ergebnis: OriginalLoeschenLauf): Promise<void> => {
            expect(ergebnis, JSON.stringify(ergebnis)).toMatchObject({
                gestempelt: 0,
                dateien: 0,
                masterAngelegt: 0,
                zurueckgestellt: 1,
                fehlgeschlagen: 0,
            });
            expect(await store.exists(werk.schluessel), "das Original liegt").toBe(true);
            expect((await zeile(werk, "private_source"))?.bytes_deleted_at, "kein Stempel").toBeNull();
            expect(await masterzeilen(werk), "genau ein Master").toHaveLength(1);
        };

        it("der erste Lauf legt Datei und Zeile des Masters an, stempelt nicht und entfernt nichts, auch wenn die Sicherung schon gelaufen ist", async () => {
            const werk = await faelligesWerk();
            await schreibeStatus(
                sicherungsStatus({ last_run: { started_at: vorhin(), finished_at: vorhin(), result: "ok" } }),
            );
            const ergebnis = await lauf();
            expect(ergebnis, JSON.stringify(ergebnis)).toMatchObject({
                an: true,
                faellig: 1,
                masterAngelegt: 1,
                gestempelt: 0,
                dateien: 0,
                zurueckgestellt: 0,
                fehlgeschlagen: 0,
            });
            const [master] = await masterzeilen(werk);
            expect(await store.exists(master!.storage_key), "die Datei des Masters liegt").toBe(true);
            expect(await store.exists(werk.schluessel), "das Original liegt").toBe(true);
            expect((await zeile(werk, "private_source"))?.bytes_deleted_at).toBeNull();
        });

        it("🔴 solange keine Sicherung nach dem Master begann, wartet er, und jeder weitere Lauf lässt es bei der einen Zeile", async () => {
            const werk = await faelligesWerk();
            await lauf();
            await schreibeStatus(
                sicherungsStatus({ last_run: { started_at: vorhin(), finished_at: vorhin(), result: "ok" } }),
            );
            await wartet(werk, await lauf());
            await wartet(werk, await lauf());
        });

        it("🔴 ein späterer Lauf stempelt und entfernt, nachdem eine Sicherung begann, und es bleibt bei der einen Master-Zeile", async () => {
            const werk = await faelligesWerk();
            await lauf();
            const [master] = await masterzeilen(werk);
            await sicherungLief();
            const ergebnis = await lauf();
            expect(ergebnis, JSON.stringify(ergebnis)).toMatchObject({
                faellig: 1,
                masterAngelegt: 0,
                gestempelt: 1,
                dateien: 1,
                fehlgeschlagen: 0,
            });
            expect(await store.exists(werk.schluessel)).toBe(false);
            expect((await zeile(werk, "private_source"))?.bytes_deleted_at).toBeInstanceOf(Date);
            expect(await masterzeilen(werk)).toEqual([master]);
        });

        it("🔴 eine Sicherung, die vor dem Master begann und danach endete, zählt nicht: Das Medienarchiv war da vielleicht schon gepackt", async () => {
            const werk = await faelligesWerk();
            await lauf();
            await schreibeStatus(
                sicherungsStatus({ last_run: { started_at: vorhin(), finished_at: gleich(), result: "ok" } }),
            );
            await wartet(werk, await lauf());
        });

        it("🔴 ein Medienarchiv, das vor dem Master außer Haus ging, zählt nicht: Der Lauf der Sicherung gilt als gelungen, auch wenn das Archiv dieser Nacht scheiterte", async () => {
            const werk = await faelligesWerk();
            await lauf();
            await schreibeStatus(
                sicherungsStatus({
                    parts: [{ kind: "media_production", offsite: "dropbox", offsite_verified_at: vorhin() }],
                }),
            );
            await wartet(werk, await lauf());
        });

        const unbrauchbar: [string, () => Promise<void>][] = [
            ["die Datei fehlt", () => rm(statusDatei, { force: true })],
            ["sie ist kein JSON", () => writeFile(statusDatei, "{ kaputt")],
            ["sie hat die falsche Form", () => schreibeStatus(["kein Objekt"])],
            ["last_success_at fehlt", () => schreibeStatus(sicherungsStatus({ last_success_at: undefined }))],
            ["last_success_at ist null", () => schreibeStatus(sicherungsStatus({ last_success_at: null }))],
            [
                "last_success_at ist kein Zeitpunkt",
                () => schreibeStatus(sicherungsStatus({ last_success_at: "gestern" })),
            ],
            [
                "der letzte Lauf läuft noch",
                () =>
                    schreibeStatus(
                        sicherungsStatus({ last_run: { started_at: gleich(), finished_at: null, result: "running" } }),
                    ),
            ],
            [
                "der letzte Lauf scheiterte",
                () =>
                    schreibeStatus(
                        sicherungsStatus({
                            last_run: { started_at: gleich(), finished_at: gleich(), result: "failed" },
                        }),
                    ),
            ],
            ["kein letzter Lauf", () => schreibeStatus(sicherungsStatus({ last_run: undefined }))],
            ["kein Medienarchiv", () => schreibeStatus(sicherungsStatus({ parts: [] }))],
            [
                "das Medienarchiv liegt nur lokal",
                () =>
                    schreibeStatus(
                        sicherungsStatus({
                            parts: [{ kind: "media_production", offsite: null, offsite_verified_at: null }],
                        }),
                    ),
            ],
        ];
        it.each(unbrauchbar)("🔴 %s: nichts stempeln, nichts löschen, zurückgestellt", async (_name, einrichten) => {
            const werk = await faelligesWerk();
            await lauf();
            await einrichten();
            const ergebnis = await lauf();
            expect(ergebnis.gesichertBis).toBeNull();
            await wartet(werk, ergebnis);
        });

        it("ohne Einstellung (BACKUP_STATUS_FILE) legt der Lauf den Master an und stempelt nie", async () => {
            const werk = await faelligesWerk();
            await sicherungLief();
            const ohne = () => originalLoeschen(cluster.jobs, store, { an: true });
            expect(await ohne()).toMatchObject({ masterAngelegt: 1, gesichertBis: null });
            await wartet(werk, await ohne());
        });

        it("gesichertBis ist der frühere der beiden Zeitpunkte: Beginn des Laufs, Medienarchiv außer Haus", async () => {
            await schreibeStatus(
                sicherungsStatus({
                    last_run: { started_at: "2026-11-04T01:30:00Z", finished_at: "2026-11-04T01:55:00Z", result: "ok" },
                    last_success_at: "2026-11-04T01:55:00Z",
                    parts: [
                        { kind: "media_production", offsite: "dropbox", offsite_verified_at: "2026-11-04T01:33:00Z" },
                    ],
                }),
            );
            expect(await gesichertBis(statusDatei)).toEqual(new Date("2026-11-04T01:30:00Z"));
            await schreibeStatus(
                sicherungsStatus({
                    last_run: { started_at: "2026-11-04T01:30:00Z", finished_at: "2026-11-04T01:55:00Z", result: "ok" },
                    last_success_at: "2026-11-04T01:55:00Z",
                    parts: [
                        { kind: "media_production", offsite: "dropbox", offsite_verified_at: "2026-11-03T01:33:00Z" },
                    ],
                }),
            );
            expect(await gesichertBis(statusDatei)).toEqual(new Date("2026-11-03T01:33:00Z"));
            expect(await gesichertBis(undefined)).toBeNull();
            expect(await gesichertBis("")).toBeNull();
        });

        it("auch ausgeschaltet liest der Lauf die Statusdatei und nennt den Stand: So zeigt schon der Betrieb ohne Schalter, ob der Worker sie lesen darf", async () => {
            await schreibeStatus(
                sicherungsStatus({
                    last_run: { started_at: "2026-11-04T01:30:00Z", finished_at: "2026-11-04T01:55:00Z", result: "ok" },
                    parts: [
                        { kind: "media_production", offsite: "dropbox", offsite_verified_at: "2026-11-04T01:33:00Z" },
                    ],
                }),
            );
            const werk = await faelligesWerk();
            const ergebnis = await originalLoeschen(cluster.jobs, store, { sicherungStatus: statusDatei });
            expect(ergebnis).toMatchObject({ an: false, gesichertBis: "2026-11-04T01:30:00.000Z", faellig: 1 });
            expect(await zeile(werk, "master")).toBeUndefined();
        });

        it("🔴 fehlt die Datei des Masters oder stimmt ihr Hash nicht, bleibt das Original, und der Fehler steht im Ergebnis; liegt sie wieder, geht es weiter", async () => {
            const werk = await faelligesWerk();
            await lauf();
            const [master] = await masterzeilen(werk);
            const inhalt = await store.read(master!.storage_key, 10_000_000);
            await sicherungLief();
            await rm(store.pathFor(master!.storage_key));
            const fehlt = await lauf();
            expect(fehlt).toMatchObject({ faellig: 0, gestempelt: 0, dateien: 0, fehlgeschlagen: 1 });
            expect(fehlt.codes).toContain("master_fehlt");
            await writeFile(store.pathFor(master!.storage_key), Buffer.from("verdorben"));
            const verdorben = await lauf();
            expect(verdorben).toMatchObject({ gestempelt: 0, fehlgeschlagen: 1 });
            expect(verdorben.codes).toContain("master_fehlt");
            expect(await store.exists(werk.schluessel)).toBe(true);
            expect((await zeile(werk, "private_source"))?.bytes_deleted_at).toBeNull();
            expect(await masterzeilen(werk), "keine zweite Zeile").toHaveLength(1);
            await writeFile(store.pathFor(master!.storage_key), inhalt);
            expect(await lauf()).toMatchObject({ gestempelt: 1, dateien: 1, fehlgeschlagen: 0 });
        });

        it("🔴 die Datenbank nimmt keine zweite Master-Zeile desselben Werks an", async () => {
            const werk = await faelligesWerk();
            await lauf();
            await expect(cluster.admin`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${werk.id}::bigint, 'master', 'master', ${storageKey("master", "c".repeat(64), "webp")}, 'image/webp', 1, 1, 1, ${"c".repeat(64)})
            `).rejects.toThrow(/media_file_variant_unique/u);
        });

        it("geteilte Bytes: Ein jüngerer Master wartet auf seine Sicherung, der ältere stempelt schon; die Datei fällt erst mit dem letzten", async () => {
            const bytes = await bild(++saat);
            const alt = await faelligesWerk(bytes);
            await lauf();
            // Diese Sicherung beginnt nach dem ersten Master und vor dem zweiten.
            await schreibeStatus(
                sicherungsStatus({
                    last_run: { started_at: new Date().toISOString(), finished_at: gleich(), result: "ok" },
                }),
            );
            const jung = await faelligesWerk(bytes);
            expect(await lauf()).toMatchObject({ masterAngelegt: 1, gestempelt: 1, gehalten: 1, dateien: 0 });
            expect(await store.exists(alt.schluessel), "das jüngere Werk hält sie noch").toBe(true);
            expect((await zeile(jung, "private_source"))?.bytes_deleted_at).toBeNull();
            await sicherungLief();
            expect(await lauf()).toMatchObject({ gestempelt: 1, dateien: 1, gehalten: 0 });
            expect(await store.exists(alt.schluessel)).toBe(false);
        });

        describe("eine Master-Zeile ohne Stempel stört nichts", () => {
            it("🔴 der Abgleich rechnet weiter aus dem Original: Rechte hin und zurück, Rezeptwechsel, eine andere Rolle; der Master bleibt, wie er ist", async () => {
                const werk = await faelligesWerk();
                await lauf();
                const [master] = await masterzeilen(werk);
                const vorher = await unterQuelle();

                await oeffentlich(werk);
                expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", published: true });
                expect((await zeile(werk, "published"))?.variant).toBe("citymap_full");
                await privat(werk);
                expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", published: false });
                await altesRezept(werk);
                expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", unchanged: false });
                expect(await abgleich(werk.publicId, "header")).toMatchObject({ technicalState: "ok" });

                expect(await masterzeilen(werk)).toEqual([master]);
                expect(await store.exists(master!.storage_key)).toBe(true);
                expect((await zeile(werk, "private_source"))?.bytes_deleted_at).toBeNull();
                expect(await unterQuelle()).toEqual(vorher);

                // Der zweite Schritt fragt danach nicht mehr nach der Fassung: Der Master ist schon da.
                expect(await zweiLaeufe()).toMatchObject({ masterAngelegt: 0, gestempelt: 1, dateien: 1 });
            });

            it("🔴 fehlt das Original, bevor es gestempelt ist, gilt der alte Weg: missing_file, und der Master heilt es nicht heimlich", async () => {
                const werk = await faelligesWerk();
                await lauf();
                await rm(store.pathFor(werk.schluessel));
                await altesRezept(werk);
                expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "missing_file" });
                expect(await zustand(werk)).toBe("missing_file");
                expect(await zeile(werk, "master"), "der Master bleibt").toBeDefined();
            });

            it("die Aufbewahrung lässt den angenommenen Vorschlag samt Master stehen; geht das Werk, fällt der Master mit, wenn kein anderes Werk ihn hält", async () => {
                const bytes = await bild(++saat);
                const geht = await faelligesWerk(bytes);
                const bleibt = await faelligesWerk(bytes);
                await lauf();
                const [master] = await masterzeilen(geht);
                expect((await masterzeilen(bleibt))[0]?.storage_key).toBe(master!.storage_key);

                await kartenvorschlagAufbewahrung(cluster.jobs, store);
                expect(await store.exists(master!.storage_key)).toBe(true);

                const zurueckziehen = async (werk: Werk): Promise<void> => {
                    await cluster.admin`UPDATE citymap_media SET retired_at = now() WHERE media_asset_id = ${werk.id}::bigint`;
                    await cluster.admin`
                        UPDATE citymap_suggestion SET state = 'rejected', state_changed_at = now() - interval '40 days', accepted_citymap_id = NULL
                         WHERE media_asset_id = ${werk.id}::bigint
                    `;
                };
                await zurueckziehen(geht);
                await kartenvorschlagAufbewahrung(cluster.jobs, store);
                expect(await zeilen(geht), "das Werk ist weg").toEqual([]);
                expect(await store.exists(master!.storage_key), "das andere Werk hält den Master").toBe(true);

                await zurueckziehen(bleibt);
                await kartenvorschlagAufbewahrung(cluster.jobs, store);
                expect(await zeilen(bleibt)).toEqual([]);
                expect(await store.exists(master!.storage_key), "nun hält ihn keines mehr").toBe(false);
                expect(await store.exists(bleibt.schluessel)).toBe(false);
            });

            it("ein Notaus nach dem ersten Schritt hält den Stempel zurück, der Master bleibt privat; nach dem Aufheben geht es ohne zweite Zeile weiter", async () => {
                const werk = await faelligesWerk();
                await lauf();
                await cluster.admin`
                    INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
                    VALUES (${werk.sha256}, ${werk.id}::bigint, 'Test', ${PERSON}::uuid)
                `;
                await sicherungLief();
                expect(await lauf()).toMatchObject({ faellig: 0, gestempelt: 0, zurueckgestellt: 0 });
                expect((await zeile(werk, "master"))?.storage_key.startsWith("master/")).toBe(true);
                await cluster.admin`
                    UPDATE media_publication_suspension SET lifted_at = now(), lifted_by_person = ${PERSON}::uuid, lift_reason = 'Test'
                     WHERE source_sha256 = ${werk.sha256}
                `;
                expect(await lauf()).toMatchObject({ gestempelt: 1, dateien: 1 });
                expect(await masterzeilen(werk)).toHaveLength(1);
            });
        });

        describe("die Einstellungen des Jobs", () => {
            it("der Pfad kommt aus BACKUP_STATUS_FILE, und nur die Stage kann die Probe einschalten; Production nie", () => {
                expect(
                    originalOptionenAus({ BACKUP_STATUS_FILE: "/x/status.json", AVESMAPS_ENV: "production" }),
                ).toEqual({
                    sicherungStatus: "/x/status.json",
                });
                expect(
                    originalOptionenAus({ AVESMAPS_ENV: "production", KARTENVORSCHLAG_ORIGINAL_PROBE: "an" }),
                ).not.toHaveProperty("an");
                expect(originalOptionenAus({ AVESMAPS_ENV: "staging" })).not.toHaveProperty("an");
                expect(
                    originalOptionenAus({ AVESMAPS_ENV: "staging", KARTENVORSCHLAG_ORIGINAL_PROBE: "aus" }),
                ).not.toHaveProperty("an");
                expect(
                    originalOptionenAus({ AVESMAPS_ENV: "staging", KARTENVORSCHLAG_ORIGINAL_PROBE: "an" }),
                ).toMatchObject({
                    an: true,
                });
            });

            it("🔴 der ganze Job reicht Pfad und Probe durch: als Jobs-Rolle gelaufen, der erste Schritt steht im Ergebnis", async () => {
                const werk = await faelligesWerk();
                await sicherungLief();
                const release = `kvoriginal-${randomUUID()}`;
                await cluster.admin`DELETE FROM job_event WHERE job_id IN (SELECT id FROM job WHERE kind = ${KARTENVORSCHLAG_RETENTION_KIND})`;
                await cluster.admin`DELETE FROM job WHERE kind = ${KARTENVORSCHLAG_RETENTION_KIND}`;
                const arbeiter = new JobWorker({
                    database: cluster.jobs,
                    config: testJobsConfig(),
                    mapDomainId: AVENTURIA.mapDomain,
                    release,
                    deriveScope: uniqueScope("derive"),
                    spawnChild: fakeSpawner().spawn,
                    memory: fakeMemory().probe,
                    kartenvorschlagRetentionEveryMs: 3_600_000,
                    kartenvorschlagAblage: store,
                    kartenvorschlagOriginal: { an: true, sicherungStatus: statusDatei },
                });
                expect(await arbeiter.pflege()).toMatchObject({ kartenvorschlagRetention: true });
                const [job] = await cluster.admin<{ state: string; result: { original: Record<string, unknown> } }[]>`
                    SELECT state, result FROM job WHERE kind = ${KARTENVORSCHLAG_RETENTION_KIND} AND release = ${release}
                `;
                expect(job?.state).toBe("SUCCEEDED");
                expect(job?.result.original).toMatchObject({
                    an: true,
                    faellig: 1,
                    masterAngelegt: 1,
                    gestempelt: 0,
                    dateien: 0,
                });
                expect(job?.result.original["gesichertBis"]).toEqual(expect.any(String));
                expect(await zeile(werk, "master")).toBeDefined();
                expect(await store.exists(werk.schluessel)).toBe(true);
            });
        });
    });

    describe("die Fälligkeit: Was hält das Original zurück?", () => {
        const haelt = async (werk: Werk, was: "zurueckgestellt" | "gehalten" | "nichts"): Promise<void> => {
            const ergebnis = await lauf();
            expect(ergebnis, JSON.stringify(ergebnis)).toMatchObject({
                gestempelt: 0,
                dateien: 0,
                fehlgeschlagen: 0,
                zurueckgestellt: was === "zurueckgestellt" ? 1 : 0,
                gehalten: was === "gehalten" ? 1 : 0,
            });
            expect(await store.exists(werk.schluessel), "die Datei bleibt").toBe(true);
            expect((await zeile(werk, "private_source"))?.bytes_deleted_at, "kein Stempel").toBeNull();
            expect(await zeile(werk, "master"), "kein Master").toBeUndefined();
        };

        it("noch nicht angenommen", async () => {
            const werk = await neuesWerk();
            await vorschlag(werk, { state: "pending" });
            await haelt(werk, "nichts");
        });

        it("abgelehnt", async () => {
            const werk = await neuesWerk();
            await vorschlag(werk, { state: "rejected" });
            await haelt(werk, "nichts");
        });

        it("angenommen vor höchstens 7 Tagen", async () => {
            const werk = await neuesWerk();
            await vorschlag(werk, { tage: 6 });
            await haelt(werk, "nichts");
        });

        it("ein anderes Quellsystem", async () => {
            const werk = await faelligesWerk();
            await cluster.admin`UPDATE media_asset SET source_system = 'photobox' WHERE id = ${werk.id}::bigint`;
            await haelt(werk, "nichts");
        });

        it("technisch nicht in Ordnung", async () => {
            const werk = await faelligesWerk();
            await cluster.admin`UPDATE media_asset SET technical_state = 'decode_failed' WHERE id = ${werk.id}::bigint`;
            await haelt(werk, "nichts");
        });

        it("redaktionell nicht in Ordnung", async () => {
            const werk = await faelligesWerk();
            await cluster.admin`UPDATE media_asset SET moderation_state = 'rejected' WHERE id = ${werk.id}::bigint`;
            await haelt(werk, "nichts");
        });

        it("keine Fassung citymap_full", async () => {
            const werk = await faelligesWerk();
            await cluster.admin`DELETE FROM media_file WHERE media_asset_id = ${werk.id}::bigint AND storage_class = 'derivative'`;
            await haelt(werk, "zurueckgestellt");
        });

        it("die Datei der Fassung fehlt", async () => {
            const werk = await faelligesWerk();
            const fassung = await zeile(werk, "derivative");
            await rm(store.pathFor(fassung!.storage_key));
            await haelt(werk, "zurueckgestellt");
        });

        it("der Hash der Fassung stimmt nicht", async () => {
            const werk = await faelligesWerk();
            const fassung = await zeile(werk, "derivative");
            await writeFile(store.pathFor(fassung!.storage_key), Buffer.from("verdorben"));
            await haelt(werk, "zurueckgestellt");
        });

        it("die Fassung stammt aus einer anderen Revision des Rezepts", async () => {
            const werk = await faelligesWerk();
            await cluster.admin`UPDATE media_file SET recipe_version = '0 / sharp 0 / libvips 0 / libwebp 0' WHERE media_asset_id = ${werk.id}::bigint AND storage_class = 'derivative'`;
            await haelt(werk, "zurueckgestellt");
        });

        it("nur ein verlustfreies Rezept mit erhaltenen Pixeln darf das Original ersetzen", () => {
            expect(profilVerlustfrei(profileForRole("map_full"))).toBe(true);
            expect(profilVerlustfrei(profileForRole("header"))).toBe(false);
            expect(profilVerlustfrei(profileForRole("coat"))).toBe(false);
        });

        it("ein aktiver Notaus; ein aufgehobener hält nichts mehr", async () => {
            const werk = await faelligesWerk();
            await cluster.admin`
                INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
                VALUES (${werk.sha256}, ${werk.id}::bigint, 'Test', ${PERSON}::uuid)
            `;
            await haelt(werk, "nichts");
            await cluster.admin`
                UPDATE media_publication_suspension SET lifted_at = now(), lifted_by_person = ${PERSON}::uuid, lift_reason = 'Test'
                 WHERE source_sha256 = ${werk.sha256}
            `;
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, dateien: 1 });
        });

        it("eine geltende Zusammenführung; eine aufgehobene hält nichts mehr", async () => {
            const werk = await faelligesWerk();
            const anderes = await neuesWerk();
            await cluster.admin`
                INSERT INTO media_merge (merged_asset_id, kept_asset_id, source_sha256, merged_by_person)
                VALUES (${anderes.id}::bigint, ${werk.id}::bigint, ${werk.sha256}, ${PERSON}::uuid)
            `;
            await haelt(werk, "nichts");
            await cluster.admin`
                UPDATE media_merge SET lifted_at = now(), lifted_by_person = ${PERSON}::uuid WHERE kept_asset_id = ${werk.id}::bigint
            `;
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, dateien: 1 });
        });

        it("ein offener Abgleich", async () => {
            const werk = await faelligesWerk();
            await cluster.app`
                SELECT * FROM job_enqueue('media_settle', 1::smallint, ${AVENTURIA.mapDomain}, ${PERSON},
                                          ${cluster.app.json({ asset: werk.publicId, role: "map_full" })})
            `;
            await haelt(werk, "nichts");
        });

        it("die Bytes hält ein anderes lebendes Werk", async () => {
            const bytes = await bild(++saat);
            const werk = await faelligesWerk(bytes);
            const anderes = await neuesWerk(bytes);
            await vorschlag(anderes, { state: "pending" });
            await haelt(werk, "gehalten");
        });
    });

    describe("geteilte Bytes", () => {
        it("🔴 zwei Fällige warten nicht ewig aufeinander: beide bekommen den Stempel, die eine Datei fällt", async () => {
            const bytes = await bild(++saat);
            const a = await faelligesWerk(bytes);
            const b = await faelligesWerk(bytes);
            expect(a.schluessel).toBe(b.schluessel);
            expect(await zweiLaeufe()).toMatchObject({ faellig: 2, gestempelt: 2, dateien: 1, gehalten: 0 });
            expect(await store.exists(a.schluessel)).toBe(false);
            expect((await zeile(a, "private_source"))?.bytes_deleted_at).toBeInstanceOf(Date);
            expect((await zeile(b, "private_source"))?.bytes_deleted_at).toBeInstanceOf(Date);
            expect((await zeile(a, "master"))?.storage_key).toBe((await zeile(b, "master"))?.storage_key);
            await altesRezept(a);
            await altesRezept(b);
            expect(await abgleich(a.publicId)).toMatchObject({ technicalState: "ok" });
            expect(await abgleich(b.publicId)).toMatchObject({ technicalState: "ok" });
        });

        it("taugt die Fassung des einen nicht, bekommt nur der andere den Stempel; die Datei bleibt für den einen liegen, und der nächste Lauf nimmt sie mit", async () => {
            const bytes = await bild(++saat);
            const a = await faelligesWerk(bytes);
            const b = await faelligesWerk(bytes);
            const fassungB = await zeile(b, "derivative");
            await cluster.admin`UPDATE media_file SET recipe_version = '0 / alt' WHERE id = ${fassungB!.id}::bigint`;
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, zurueckgestellt: 1, gehalten: 1, dateien: 0 });
            expect(await store.exists(a.schluessel), "B lebt und hält sie").toBe(true);
            expect((await zeile(a, "private_source"))?.bytes_deleted_at).toBeInstanceOf(Date);
            expect((await zeile(b, "private_source"))?.bytes_deleted_at).toBeNull();
            await cluster.admin`UPDATE media_file SET recipe_version = ${recipeVersion(profileForRole("map_full"))} WHERE id = ${fassungB!.id}::bigint`;
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, dateien: 1, gehalten: 0 });
            expect(await store.exists(a.schluessel)).toBe(false);
        });

        it("ein lebendes Werk hält die Datei; fällt es weg, nimmt der nächste Lauf sie mit", async () => {
            const bytes = await bild(++saat);
            const werk = await faelligesWerk(bytes);
            const anderes = await neuesWerk(bytes);
            await vorschlag(anderes, { state: "rejected", tage: 40 });
            expect(await lauf()).toMatchObject({ gestempelt: 0, gehalten: 1 });
            expect(await store.exists(werk.schluessel)).toBe(true);
            // Die Aufbewahrung nimmt den abgelehnten Vorschlag samt Werk; sein Schlüssel bleibt liegen, weil das andere Werk ihn noch lebend hält.
            expect((await kartenvorschlagAufbewahrung(cluster.jobs, store)).schluessel).toBe(0);
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, dateien: 1 });
            expect(await store.exists(werk.schluessel)).toBe(false);
        });

        it("🔴 eine nachgewachsene Datei: Das neue Werk hält sie; eine gestempelte Zeile hält sie nicht, und die Aufbewahrung nennt ihren Schlüssel", async () => {
            const bytes = await bild(++saat);
            const werk = await geloeschtesWerk(bytes);
            const neu = await neuesWerk(bytes);
            await vorschlag(neu, { state: "rejected", tage: 40 });
            expect(await store.exists(werk.schluessel)).toBe(true);
            expect(await lauf()).toMatchObject({ gehalten: 1, dateien: 0 });
            expect(await store.exists(werk.schluessel), "das lebende Werk hält sie").toBe(true);
            const aufbewahrung = await kartenvorschlagAufbewahrung(cluster.jobs, store);
            expect(aufbewahrung).toMatchObject({ dateien: 1, gehalten: 0 });
            expect(await store.exists(werk.schluessel), "nur noch die gestempelte Zeile").toBe(false);
            await altesRezept(werk);
            expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok" });
        });

        it("eine Datei, die ohne lebende Zeile wieder liegt, räumt der nächste Lauf weg", async () => {
            const bytes = await bild(++saat);
            const werk = await geloeschtesWerk(bytes);
            await writeFile(store.pathFor(werk.schluessel), bytes);
            expect(await lauf()).toMatchObject({ dateien: 1 });
            expect(await store.exists(werk.schluessel)).toBe(false);
        });

        it("🔴 die Sperre je Hash: Legt gerade jemand dieselben Bytes an, wartet das Entfernen und sieht danach das neue Werk", async () => {
            const bytes = await bild(++saat);
            const werk = await faelligesWerk(bytes);
            // Der Absturz nach dem Stempel: Die Datei liegt noch, keine lebende Zeile hält sie.
            await zweiLaeufe(mit({ removeAfterDelete: () => Promise.reject(new Error("Absturz")) }));
            expect(await store.exists(werk.schluessel)).toBe(true);

            let angelegt!: () => void;
            let weiter!: () => void;
            const istAngelegt = new Promise<void>((resolve) => (angelegt = resolve));
            const darfWeiter = new Promise<void>((resolve) => (weiter = resolve));
            const datei = pruefeKartendatei(bytes, "image/png");
            const anlegen = cluster.migrator.begin(async (tx) => {
                const neu = await legeWerkAn(tx, store, datei, {
                    titel: "Dieselben Bytes",
                    nutzung: "avesmaps_only",
                    urheber: null,
                });
                angelegt();
                await darfWeiter;
                return neu;
            });
            await istAngelegt;
            const entfernen = lauf();
            await new Promise((resolve) => setTimeout(resolve, 300));
            weiter();
            const neu = await anlegen;
            expect(await entfernen).toMatchObject({ gehalten: 1, dateien: 0, fehlgeschlagen: 0 });
            expect(await store.exists(werk.schluessel), "die Zeile des neuen Werks zeigt nicht ins Leere").toBe(true);
            expect(neu.sha256).toBe(werk.sha256);
            // Das neue Werk geht wieder; dann räumt der nächste Lauf die Datei weg, und die übrigen Fälle zählen nur ihre eigene.
            await cluster.admin`DELETE FROM media_rights WHERE media_asset_id = ${neu.id}::bigint`;
            await cluster.admin`DELETE FROM media_file WHERE media_asset_id = ${neu.id}::bigint`;
            await cluster.admin`DELETE FROM media_asset WHERE id = ${neu.id}::bigint`;
            expect(await lauf()).toMatchObject({ dateien: 1 });
        });
    });

    describe("ein Absturz zwischen den Schritten", () => {
        it("nach dem Ablegen des Masters, vor der Transaktion: kein Stempel, die Datei liegt, der nächste Lauf macht weiter", async () => {
            const werk = await faelligesWerk();
            const ergebnis = await lauf(
                mit({
                    store: async (klasse, inhalt, endung) => {
                        await store.store(klasse, inhalt, endung);
                        throw new Error("Absturz");
                    },
                }),
            );
            expect(ergebnis).toMatchObject({ masterAngelegt: 0, gestempelt: 0, dateien: 0, fehlgeschlagen: 1 });
            expect(await zeile(werk, "master")).toBeUndefined();
            expect((await zeile(werk, "private_source"))?.bytes_deleted_at).toBeNull();
            expect(await store.exists(werk.schluessel)).toBe(true);
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, dateien: 1, fehlgeschlagen: 0 });
            expect(await store.exists(werk.schluessel)).toBe(false);
        });

        it("🔴 nach dem Stempel, vor dem Entfernen: Der Abgleich rechnet schon aus dem Master, und der nächste Lauf räumt die Datei weg", async () => {
            const werk = await faelligesWerk();
            const ergebnis = await zweiLaeufe(mit({ removeAfterDelete: () => Promise.reject(new Error("Absturz")) }));
            expect(ergebnis).toMatchObject({ gestempelt: 1, dateien: 0, fehlgeschlagen: 1 });
            expect(ergebnis.offen).toEqual([werk.schluessel]);
            expect((await zeile(werk, "private_source"))?.bytes_deleted_at).toBeInstanceOf(Date);
            expect(await store.exists(werk.schluessel)).toBe(true);
            await altesRezept(werk);
            expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", unchanged: false });
            expect(await lauf()).toMatchObject({ gestempelt: 0, dateien: 1, fehlgeschlagen: 0 });
            expect(await store.exists(werk.schluessel)).toBe(false);
        });

        it("🔴 fehlt der Master nach dem Stempel, fällt das Original nicht; liegt er wieder, fällt es", async () => {
            const werk = await faelligesWerk();
            const ergebnis = await zweiLaeufe(mit({ removeAfterDelete: () => Promise.reject(new Error("Absturz")) }));
            expect(ergebnis.gestempelt).toBe(1);
            const master = await zeile(werk, "master");
            const inhalt = await store.read(master!.storage_key, 10_000_000);
            await rm(store.pathFor(master!.storage_key));
            const ohne = await lauf();
            expect(ohne).toMatchObject({ dateien: 0, fehlgeschlagen: 1 });
            expect(ohne.codes).toContain("master_fehlt");
            expect(await store.exists(werk.schluessel)).toBe(true);
            await writeFile(store.pathFor(master!.storage_key), inhalt);
            expect(await lauf()).toMatchObject({ dateien: 1, fehlgeschlagen: 0 });
            expect(await store.exists(werk.schluessel)).toBe(false);
        });
    });

    it("🔴 der Wettlauf: Fällt das Original, während der Abgleich es gerade lesen will, rechnet er aus dem Master, statt das Werk auf missing_file zu setzen", async () => {
        const werk = await faelligesWerk();
        await lauf();
        await sicherungLief();
        await altesRezept(werk);
        let gelaufen = false;
        class Wettlauf extends MediaStore {
            override async read(key: string, maxBytes: number): Promise<Buffer> {
                if (key === werk.schluessel && !gelaufen) {
                    gelaufen = true;
                    expect(await lauf()).toMatchObject({ gestempelt: 1, dateien: 1 });
                }
                return super.read(key, maxBytes);
            }
        }
        const ergebnis = await settleAssetFiles(cluster.jobs, new Wettlauf(wurzel), {
            assetPublicId: werk.publicId,
            role: "map_full",
        });
        expect(gelaufen, "der Abgleich las die Zeile noch ohne Stempel").toBe(true);
        expect(ergebnis).toMatchObject({ technicalState: "ok", unchanged: false });
        expect(await zustand(werk)).toBe("ok");
        expect(await store.exists(werk.schluessel)).toBe(false);
    });

    describe("🔴 nach dem Löschen läuft alles weiter", () => {
        it("Rechte in beide Richtungen: öffentlich und zurück, immer ok, die öffentliche Datei hat dieselben Bytes wie der Master, nichts Neues unter private/source", async () => {
            const werk = await geloeschtesWerk();
            const vorher = await unterQuelle();
            const master = await zeile(werk, "master");

            await oeffentlich(werk);
            expect(await abgleich(werk.publicId)).toMatchObject({
                technicalState: "ok",
                published: true,
                unchanged: false,
            });
            const veroeffentlicht = await zeile(werk, "published");
            expect(veroeffentlicht).toMatchObject({ variant: "citymap_full", sha256: master!.sha256 });
            expect(await store.exists(veroeffentlicht!.storage_key)).toBe(true);
            expect(await zeile(werk, "derivative"), "die private Vorschau fällt weg").toBeUndefined();

            await privat(werk);
            expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", published: false });
            expect(await zeile(werk, "published")).toBeUndefined();
            expect(await store.exists(veroeffentlicht!.storage_key)).toBe(false);
            expect((await zeile(werk, "derivative"))?.variant).toBe("intern_citymap_full");

            expect(await zustand(werk)).toBe("ok");
            expect(await unterQuelle()).toEqual(vorher);
            expect(await store.exists(werk.schluessel)).toBe(false);
            expect(await store.exists(master!.storage_key)).toBe(true);
        });

        it("Rezeptwechsel (Sprung von sharp oder libwebp): neu gerechnet aus dem Master, ok, nichts Neues unter private/source", async () => {
            const werk = await geloeschtesWerk();
            const vorher = await unterQuelle();
            await altesRezept(werk);
            expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", unchanged: false });
            const fassung = await zeile(werk, "derivative");
            expect(fassung?.recipe_version).toBe(recipeVersion(profileForRole("map_full")));
            expect(await zustand(werk)).toBe("ok");
            expect(await unterQuelle()).toEqual(vorher);
        });

        it("eine andere Rolle (header): gerechnet aus dem Master, ok, nichts Neues unter private/source", async () => {
            const werk = await geloeschtesWerk();
            const vorher = await unterQuelle();
            expect(await abgleich(werk.publicId, "header")).toMatchObject({ technicalState: "ok" });
            expect((await zeilen(werk)).map((eintrag) => eintrag.variant)).toContain("intern_header_16_9");
            expect(await zustand(werk)).toBe("ok");
            expect(await unterQuelle()).toEqual(vorher);
        });

        it("🔴 ein Master über den 6 MiB der Hochladenden geht auch in einer fremden Rolle durch: Er ist von uns gerechnet", async () => {
            const werk = await geloeschtesWerk(await bild(++saat, 1600, 1500));
            const master = await zeile(werk, "master");
            const inhalt = await store.read(master!.storage_key, 50_000_000);
            expect(inhalt.byteLength).toBeGreaterThan(6 * 1024 * 1024);
            expect(await abgleich(werk.publicId, "header")).toMatchObject({ technicalState: "ok" });
            expect((await zeilen(werk)).map((eintrag) => eintrag.variant)).toContain("intern_header_16_9");
            expect(await zustand(werk)).toBe("ok");
        }, 120_000);

        it("Notaus: Die Zeile trägt ihn weiter, die veröffentlichte Zeile bleibt, nach dem Aufheben läuft der Abgleich aus dem Master", async () => {
            const werk = await neuesWerk();
            await vorschlag(werk);
            await oeffentlich(werk);
            await abgleich(werk.publicId);
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, dateien: 1 });
            const vorher = await unterQuelle();
            await cluster.admin`
                INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
                VALUES (${werk.sha256}, ${werk.id}::bigint, 'Test', ${PERSON}::uuid)
            `;
            const unterNotaus = await abgleich(werk.publicId);
            expect(unterNotaus).toMatchObject({ technicalState: "ok", published: false });
            expect(unterNotaus.findings).toContain("suspended_held");
            expect((await zeile(werk, "published"))?.variant).toBe("citymap_full");
            await cluster.admin`
                UPDATE media_publication_suspension SET lifted_at = now(), lifted_by_person = ${PERSON}::uuid, lift_reason = 'Test'
                 WHERE source_sha256 = ${werk.sha256}
            `;
            expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", published: true });
            expect(await zeile(werk, "derivative"), "die Vorschau des Notaus fällt weg").toBeUndefined();
            expect(await zustand(werk)).toBe("ok");
            expect(await unterQuelle()).toEqual(vorher);
        });

        it("Zusammenführen: über den Hash der Zeile, beide Werke bleiben ok, nichts Neues unter private/source", async () => {
            const bytes = await bild(++saat);
            const bleibt = await faelligesWerk(bytes);
            const geht = await faelligesWerk(bytes);
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 2, dateien: 1 });
            const vorher = await unterQuelle();
            const stand = await cluster.admin<{ id: string; revision: number }[]>`
                SELECT id::text AS id, revision::int AS revision FROM media_asset WHERE id = ANY(${[bleibt.id, geht.id]}::bigint[])
            `;
            const revision = (werk: Werk): number => stand.find((eintrag) => eintrag.id === werk.id)!.revision;
            await cluster.migrator.begin((tx) =>
                fuehreZusammen(
                    tx,
                    { personId: PERSON, environment: "staging" },
                    {
                        keep: { assetId: bleibt.publicId, baseRevision: revision(bleibt) },
                        merge: [{ assetId: geht.publicId, baseRevision: revision(geht) }],
                    },
                    { abgleich: true },
                ),
            );
            const auftraege = await cluster.admin<{ asset: string }[]>`
                SELECT input_ref ->> 'asset' AS asset FROM job WHERE kind = 'media_settle' AND state = 'QUEUED'
            `;
            expect(auftraege.length).toBeGreaterThan(0);
            await altesRezept(bleibt);
            await altesRezept(geht);
            expect(await abgleich(bleibt.publicId)).toMatchObject({ technicalState: "ok" });
            expect(await abgleich(geht.publicId)).toMatchObject({ technicalState: "ok" });
            expect(await zustand(bleibt)).toBe("ok");
            expect(await zustand(geht)).toBe("ok");
            expect(await unterQuelle()).toEqual(vorher);
        });

        it("die Messwerte der Originalzeile bleiben; ein Beitragsbild rechnet aus dem Master; das Nachholen des Wahrnehmungs-Hashs fragt nicht nach einer gelöschten Datei", async () => {
            const werk = await geloeschtesWerk();
            await cluster.admin`
                UPDATE media_file SET perceptual_hash = 'ffffffffffffffff' WHERE media_asset_id = ${werk.id}::bigint AND storage_class = 'private_source'
            `;
            await altesRezept(werk);
            expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", unchanged: false });
            const [zeileNachher] = await cluster.admin<{ hash: string }[]>`
                SELECT perceptual_hash AS hash FROM media_file WHERE media_asset_id = ${werk.id}::bigint AND storage_class = 'private_source'
            `;
            expect(zeileNachher?.hash).toBe("ffffffffffffffff");

            const beitrag = await rechneBeitragsbild(cluster.jobs, werk.publicId, store);
            expect(beitrag?.mime).toBe("image/webp");

            await cluster.admin`
                UPDATE media_file SET perceptual_hash = NULL WHERE media_asset_id = ${werk.id}::bigint AND storage_class = 'private_source'
            `;
            const nachholen = await holeWahrnehmungNach(cluster.jobs, store, { schreiben: false });
            expect(nachholen.fehler.map((eintrag) => eintrag.asset)).not.toContain(werk.publicId);
        });
    });

    describe("🔴 der Master fehlt oder taugt nicht", () => {
        it("fehlt er, steht das Werk auf missing_file, keine Zeile und keine Datei fällt; Rückspielen heilt", async () => {
            const werk = await neuesWerk();
            await vorschlag(werk);
            await oeffentlich(werk);
            await abgleich(werk.publicId);
            expect(await zweiLaeufe()).toMatchObject({ gestempelt: 1, dateien: 1 });
            const master = await zeile(werk, "master");
            const inhalt = await store.read(master!.storage_key, 10_000_000);
            await rm(store.pathFor(master!.storage_key));
            await altesRezept(werk);
            const vorher = await zeilen(werk);
            const veroeffentlicht = vorher.find((eintrag) => eintrag.storage_class === "published");
            const vorherQuelle = await unterQuelle();

            const fehlt = await abgleich(werk.publicId);
            expect(fehlt).toMatchObject({ technicalState: "missing_file" });
            expect(fehlt.findings).toContain("missing_file");
            expect(await zustand(werk)).toBe("missing_file");
            expect(await zeilen(werk), "keine Zeile geändert").toEqual(vorher);
            expect(await store.exists(veroeffentlicht!.storage_key), "die öffentliche Datei liegt noch").toBe(true);
            expect(await unterQuelle()).toEqual(vorherQuelle);

            await writeFile(store.pathFor(master!.storage_key), inhalt);
            expect(await abgleich(werk.publicId)).toMatchObject({ technicalState: "ok", published: true });
            expect(await zustand(werk)).toBe("ok");
        });

        it("wird er abgewiesen (hier: keine Bilddatei), schreibt das keinen Zustand, und keine Zeile fällt", async () => {
            const werk = await geloeschtesWerk();
            const kaputt = await store.store("master", Buffer.from("kein Bild, nur Text"), "webp");
            await cluster.admin`
                UPDATE media_file SET storage_key = ${kaputt.key}, sha256 = ${kaputt.sha256}, byte_size = ${kaputt.byteSize}
                 WHERE media_asset_id = ${werk.id}::bigint AND storage_class = 'master'
            `;
            await altesRezept(werk);
            const vorher = await zeilen(werk);
            const ergebnis = await abgleich(werk.publicId);
            expect(ergebnis).toMatchObject({ technicalState: "ok", unchanged: true });
            expect(ergebnis.findings.length).toBe(1);
            expect(await zustand(werk)).toBe("ok");
            expect(await zeilen(werk)).toEqual(vorher);
        });
    });

    describe("Name und Notiz nach 90 Tagen", () => {
        const angaben = async (id: string) => {
            const [row] = await cluster.admin<
                { attribution_name: string | null; note: string | null; title: string }[]
            >`
                SELECT attribution_name, note, title FROM citymap_suggestion WHERE id = ${id}::bigint
            `;
            return row;
        };
        /** Die Funktion der Datenbank als Jobs-Rolle, gerechnet `sekunden` nach der Entscheidung. */
        const aufbewahren = async (id: string, sekunden: number): Promise<void> => {
            const [row] = await cluster.admin<
                { decided_at: Date }[]
            >`SELECT decided_at FROM citymap_suggestion WHERE id = ${id}::bigint`;
            const jetzt = new Date(row!.decided_at.getTime() + sekunden * 1000);
            await cluster.jobs`SELECT storage_key FROM public.kartenvorschlag_aufbewahren(${jetzt})`;
        };
        const TAG = 86_400;

        it("🔴 89 Tage und genau 90 Tage nach der Entscheidung bleiben sie, danach sind sie weg; der Vorschlag selbst bleibt", async () => {
            const werk = await neuesWerk();
            const id = await vorschlag(werk, { tage: 1 });
            await aufbewahren(id, 89 * TAG);
            expect(await angaben(id)).toMatchObject({ attribution_name: "Alrik", note: "Eine Notiz" });
            await aufbewahren(id, 90 * TAG);
            expect(await angaben(id)).toMatchObject({ attribution_name: "Alrik", note: "Eine Notiz" });
            await aufbewahren(id, 90 * TAG + 1);
            expect(await angaben(id)).toEqual({ attribution_name: null, note: null, title: "Vorschlag" });
        });

        it("das ist an keinen Schalter gebunden, und ein wartender Vorschlag behält beides", async () => {
            const werk = await neuesWerk();
            const alt = await vorschlag(werk, { tage: 91 });
            const wartend = await vorschlag(await neuesWerk(), { state: "pending" });
            await kartenvorschlagAufbewahrung(cluster.jobs, store);
            expect(await angaben(alt)).toMatchObject({ attribution_name: null, note: null });
            expect(await angaben(wartend)).toMatchObject({ attribution_name: "Alrik", note: "Eine Notiz" });
        });
    });
});
