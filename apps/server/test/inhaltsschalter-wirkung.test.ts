import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    TERRITORY_COATS_URL,
    parseTerritoryCoats,
    type LoreRowView,
    type SubjectLiteratureSection,
    type SubjectLoreSection,
    type SubjectReviewsSection,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { loadUsages } from "../src/media-editor/usage.ts";
import { decidePublication, type PublicationRequest } from "../src/media/policy.ts";
import { resolveAllTerritoryCoats } from "../src/media/resolver.ts";
import { PUBLISHED_VARIANT } from "../src/media/roles.ts";
import { pausiereAbschnitt } from "../src/subjects/pausiert.ts";
import { cleanMediaFixtures, insertAsset, insertPlace, insertTerritory } from "./support/media-fixture.ts";

/**
 * Die Wirkung der Inhaltsschalter auf die Medien (WI-0127 SYS-10 Teil b1): `switched_off` in der EINEN Entscheidung
 * (`media/policy.ts`), im öffentlichen Lesepfad (Resolver, Wappenliste) und im MAM (Verwendungen). Katalog, Tafel und Umschalten
 * prüft `inhaltsschalter.test.ts`.
 *
 * - Ein Schalter hält nur zurück, was sonst öffentlich wäre; ein ohnehin gesperrtes Bild behält seinen eigentlichen Grund.
 * - Ohne `switches` (Import, Dateiabgleich, Regelwechsel) gilt kein Schalter.
 */

const COAT_REQUEST: PublicationRequest = {
    role: "coat",
    asset: { mediaKind: "image", technicalState: "ok", moderationState: "not_applicable", creationMethod: "unknown" },
    rights: { basis: "own_work", clearance: "cleared", licenseKey: null, licenseRequiresAttribution: null },
    usage: { role: "coat", suppressed: false, retired: false, override: "none" },
    published: { mimeType: "image/webp" },
    rules: [],
};

const aus = (...keys: string[]): { isOff(key: string): boolean } => ({ isOff: (key) => keys.includes(key) });

describe("Inhaltsschalter in der Entscheidung (rein)", () => {
    it("🔴 hält zurück, was sonst öffentlich wäre: Rolle, Rechtsgrund, Lizenzfamilie, „ungeklärt“", () => {
        expect(decidePublication(COAT_REQUEST)).toEqual({ allowed: true, reason: "automatic" });
        expect(decidePublication({ ...COAT_REQUEST, switches: aus() })).toEqual({ allowed: true, reason: "automatic" });
        expect(decidePublication({ ...COAT_REQUEST, switches: aus("media.role.coat") }).reason).toBe("switched_off");
        expect(decidePublication({ ...COAT_REQUEST, switches: aus("media.role.header") }).allowed).toBe(true);
        expect(decidePublication({ ...COAT_REQUEST, switches: aus("media.rights.own_work") }).reason).toBe(
            "switched_off",
        );

        const lizenz: PublicationRequest = {
            ...COAT_REQUEST,
            rights: {
                basis: "license",
                clearance: "cleared",
                licenseKey: "cc-by-4.0",
                licenseRequiresAttribution: true,
                licenseFamily: "cc-by",
            },
            usage: { ...COAT_REQUEST.usage, override: "approved" },
        };
        // Seit WI-0282 (Betreiber 2026-11-06) trägt „Rechte geprüft“ (cleared) jede bekannte Rechtslage von selbst, auch eine Lizenz mit Nennung;
        // die Einzelfreigabe wird dafür nicht mehr gebraucht. Der Schalter der Lizenzfamilie wirkt trotzdem.
        expect(decidePublication(lizenz)).toEqual({ allowed: true, reason: "automatic" });
        expect(decidePublication({ ...lizenz, switches: aus("media.license.cc-by") }).reason).toBe("switched_off");
        expect(decidePublication({ ...lizenz, switches: aus("media.license.cc-by-sa") }).allowed).toBe(true);

        const angenommen: PublicationRequest = {
            ...COAT_REQUEST,
            rights: {
                basis: "public_domain",
                clearance: "legacy_assumed",
                licenseKey: null,
                licenseRequiresAttribution: null,
            },
            usage: { ...COAT_REQUEST.usage, override: "approved" },
        };
        expect(decidePublication(angenommen).allowed).toBe(true);
        expect(decidePublication({ ...angenommen, switches: aus("media.rights.unclear") }).reason).toBe("switched_off");
    });

    it("das Vollbild der Kartensammlung hängt am Schalter der Kartenvorschauen", () => {
        const vollbild: PublicationRequest = {
            ...COAT_REQUEST,
            role: "map_full",
            usage: { ...COAT_REQUEST.usage, role: "map_full" },
        };
        expect(decidePublication({ ...vollbild, switches: aus("media.role.map_preview") }).reason).toBe("switched_off");
    });

    it("ein ohnehin gesperrtes Bild behält seinen Grund", () => {
        const ohneRechte = { ...COAT_REQUEST, rights: null, switches: aus("media.role.coat") };
        expect(decidePublication(ohneRechte).reason).toBe("rights_missing");
        const gesperrt = {
            ...COAT_REQUEST,
            usage: { ...COAT_REQUEST.usage, override: "blocked" as const },
            switches: aus("media.role.coat"),
        };
        expect(decidePublication(gesperrt).reason).toBe("blocked");
    });
});

describe("Inhaltsschalter im Infopanel (rein)", () => {
    const subject = { kind: "place", id: "6d656469-0000-4000-8000-000000000001" } as const;
    const revision = "r1";
    const zeile = (kind: LoreRowView["kind"]): LoreRowView => ({ kind, count: 2, groups: [] });

    it("🔴 Literatur, Kartensammlung, Bewertungen: leer mit `paused`, sonst unverändert", () => {
        const werke = { subject, revision, works: [{ title: "x" }] } as unknown as SubjectLiteratureSection;
        expect(pausiereAbschnitt("literature", werke, () => false)).toBe(werke);
        expect(pausiereAbschnitt("literature", werke, (key) => key === "panel.literature")).toEqual({
            subject,
            revision,
            works: [],
            paused: true,
        });
        const karten = { subject, revision, maps: [{ title: "y" }] };
        expect(pausiereAbschnitt("citymaps", karten, (key) => key === "panel.citymaps")).toEqual({
            subject,
            revision,
            maps: [],
            paused: true,
        });
        const bewertungen = {
            subject,
            revision,
            count: 3,
            average: 4.3,
            reviews: [{ stars: 4 }],
        } as SubjectReviewsSection;
        expect(pausiereAbschnitt("reviews", bewertungen, (key) => key === "panel.reviews")).toEqual({
            subject,
            revision,
            count: 0,
            reviews: [],
            paused: true,
        });
        // Quellen und Stätten haben keinen Schalter.
        expect(pausiereAbschnitt("sources", werke, () => true)).toBe(werke);
        expect(pausiereAbschnitt("literature", null, () => true)).toBeNull();
    });

    it("🔴 Vorkommen je Art: die Zeile fehlt, die Art steht in `pausedKinds`", () => {
        const lore: SubjectLoreSection = { subject, revision, rows: [zeile("ware"), zeile("fauna"), zeile("flora")] };
        expect(pausiereAbschnitt("lore", lore, () => false)).toBe(lore);
        expect(pausiereAbschnitt("lore", lore, (key) => key === "panel.lore.fauna")).toEqual({
            subject,
            revision,
            rows: [zeile("ware"), zeile("flora")],
            pausedKinds: ["fauna"],
        });
        // Eine ausgeblendete Art ohne Zeile ändert nichts.
        expect(pausiereAbschnitt("lore", lore, (key) => key === "panel.lore.spezies")).toBe(lore);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Inhaltsschalter im Lesepfad und im MAM", () => {
    let database: Database;
    let app: ReturnType<typeof buildApp>;

    const reset = async (): Promise<void> => {
        await database`DELETE FROM content_switch`;
        await cleanMediaFixtures(database);
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await reset();
        app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database: createDatabase(testDatabaseUrl as string),
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app.close();
        await reset();
        await database.end({ timeout: 5 });
    });

    beforeEach(reset);

    async function wappenGebiet(n: number): Promise<{ territory: string; asset: string }> {
        const territory = await insertTerritory(database, n);
        const asset = await insertAsset(database, {
            ref: `schalter-${String(n)}`,
            rights: { basis: "own_work", clearance: "cleared" },
            published: [{ variant: PUBLISHED_VARIANT.coat }],
        });
        await database`
            INSERT INTO territory_media (territory_id, media_asset_id, role, origin)
            VALUES (${territory.id}, ${asset.id}, 'coat', 'wiki_localized')
        `;
        return { territory: territory.publicId, asset: asset.id };
    }

    const wappenliste = async (): Promise<Record<string, string>> => {
        const response = await app.inject({ method: "GET", url: TERRITORY_COATS_URL });
        expect(response.statusCode).toBe(200);
        return parseTerritoryCoats(response.json()).coats;
    };

    it("🔴 „Wappen“ aus: der Resolver, die Wappenliste der Anwendung und das MAM halten es zurück; an: es ist wieder da", async () => {
        const { territory, asset } = await wappenGebiet(90);
        expect((await resolveAllTerritoryCoats(database)).has(territory)).toBe(true);
        const vorher = await wappenliste();
        expect(vorher[territory]).toBeDefined();

        await database`INSERT INTO content_switch (key, enabled, changed_by_label) VALUES ('media.role.coat', FALSE, 'test')`;
        // Eine Transaktion oder ein Werkzeug liest den Stand frisch; die Anwendung über ihren Store, sobald der Weckruf da ist.
        expect((await resolveAllTerritoryCoats(database)).has(territory)).toBe(false);
        await expect
            .poll(async () => (await wappenliste())[territory], { timeout: 15_000, interval: 250 })
            .toBeUndefined();

        const mam = (await loadUsages(database, [asset])).get(asset) ?? [];
        expect(mam.map((usage) => usage.publication)).toEqual([{ public: false, reason: "switched_off" }]);
        // Der Regelwechsel vergleicht Regeln, nicht Schalter.
        const ohne = (await loadUsages(database, [asset], { schalter: false })).get(asset) ?? [];
        expect(ohne.map((usage) => usage.publication)).toEqual([{ public: true, reason: "automatic" }]);

        await database`UPDATE content_switch SET enabled = TRUE WHERE key = 'media.role.coat'`;
        expect((await resolveAllTerritoryCoats(database)).has(territory)).toBe(true);
        await expect
            .poll(async () => (await wappenliste())[territory], { timeout: 15_000, interval: 250 })
            .toBeDefined();
    });

    it("🔴 „Literatur“ und „Bewertungen“ aus: die Abschnitte antworten leer mit `paused`, eine freie Kartenstelle bleibt heil", async () => {
        const place = await insertPlace(database, 92);
        const abschnitt = async <T>(name: string): Promise<T> => {
            const response = await app.inject({ method: "GET", url: `/api/subjects/place/${place.publicId}/${name}` });
            expect(response.statusCode).toBe(200);
            return response.json<T>();
        };
        expect((await abschnitt<SubjectLiteratureSection>("literature")).paused).toBeUndefined();

        await database`INSERT INTO content_switch (key, enabled) VALUES ('panel.literature', FALSE), ('panel.reviews', FALSE)`;
        await expect
            .poll(async () => (await abschnitt<SubjectLiteratureSection>("literature")).paused, {
                timeout: 15_000,
                interval: 250,
            })
            .toBe(true);
        expect(await abschnitt<SubjectReviewsSection>("reviews")).toMatchObject({
            count: 0,
            reviews: [],
            paused: true,
        });
        // Ein unbekannter Ort bleibt 404, auch ausgeblendet.
        const fehlt = await app.inject({
            method: "GET",
            url: "/api/subjects/place/6d656469-0000-4000-8000-0000000000ff/literature",
        });
        expect(fehlt.statusCode).toBe(404);
        const punkt = await app.inject({ method: "GET", url: "/api/subjects/map-point?x=392&y=300" });
        expect(punkt.statusCode).toBe(200);
    });

    it("„Eigenes Werk“ aus trifft das Wappen über den Rechtsgrund, „Public Domain“ aus nicht", async () => {
        const { territory } = await wappenGebiet(91);
        await database`INSERT INTO content_switch (key, enabled) VALUES ('media.rights.public_domain', FALSE)`;
        expect((await resolveAllTerritoryCoats(database)).has(territory)).toBe(true);
        await database`INSERT INTO content_switch (key, enabled) VALUES ('media.rights.own_work', FALSE)`;
        expect((await resolveAllTerritoryCoats(database)).has(territory)).toBe(false);
    });
});
