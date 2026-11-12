import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { setMetadata } from "../src/media-editor/asset-operations.ts";
import { addToGallery } from "../src/media-editor/gallery-operations.ts";
import type { MediaActor } from "../src/media-editor/operation-store.ts";
import { publicationPreview } from "../src/media-editor/preview.ts";
import { mediaNavigation, searchMedia } from "../src/media-editor/search.ts";
import {
    MEDIA_TITLE_ROLES,
    derivedMediaTitle,
    nameUntitledAssets,
    planAssetTitles,
    subjectKindLabel,
    type TitleAsset,
    type TitleUsage,
} from "../src/media-editor/titles.ts";
import { loadUsages } from "../src/media-editor/usage.ts";
import { switchPublicationRules } from "../src/migration/media-rule-switch.ts";
import {
    AI_RULE_OPERATOR_QUOTE,
    PUBLICATION_RULE_SEEDS,
    SUPERSEDED_RULE_SEEDS,
    ruleSeedStates,
    seedPublicationRules,
    type SupersededRule,
} from "../src/migration/media-rules.ts";
import { backfillAssetTitles } from "../src/migration/media-titles.ts";
import {
    cleanMediaFixtures,
    insertAdventure,
    insertAsset,
    insertCitymap,
    insertGallery,
    insertPlace,
    insertTerritory,
    type FixtureAsset,
} from "./support/media-fixture.ts";
import { cleanLegacyMedia } from "./support/media-import-fixture.ts";
import { cleanEditorMedia, operation } from "./support/media-operations-fixture.ts";

/**
 * WI-0068, Betreiber 2026-10-10: „eigene bilder sind nicht automatisch öffentlich, aber die die wir haben sind alle KI-generiert und alle
 * KI-generierten sind öffentlich“ und „wichtig wärs mir, dass du den neuen Namen des assets … aus dem name des objekts zugewiesen ist …
 * also Gareths Wappen ist "Wappen von Gareth" bzd. "Bild von Gareth (1)" usw.“
 *
 * Teil A: die Klassenregeln für Wappen und Ortsbilder greifen über die Entstehung `ai_generated`; die alten Regeln (`own_work` allein)
 * werden in EINER Transaktion abgelöst, was herausfällt, steht als Befund und im Korb. Teil B: der Name aus dem Fachobjekt.
 */

const day = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

const usage = (overrides: Partial<TitleUsage> & Pick<TitleUsage, "assetId">): TitleUsage => ({
    subjectKind: "place",
    subjectId: "p-gareth",
    subjectName: "Gareth",
    role: "coat",
    via: "binding",
    position: null,
    boundAt: day("2026-10-05"),
    ...overrides,
});
const untitled = (assetId: string, title: string | null = null, humanTitle = false): TitleAsset => ({
    assetId,
    title,
    humanTitle,
});

describe("Namen aus dem Fachobjekt: die Regel (rein)", () => {
    it("Rollentafel: ein Wort je Rolle, nur Bilder immer nummeriert, Werke und Karten in Anführungszeichen", () => {
        expect(
            Object.fromEntries(Object.entries(MEDIA_TITLE_ROLES).map(([role, entry]) => [role, entry.word])),
        ).toEqual({
            coat: "Wappen",
            header: "Bild",
            literature_cover: "Umschlag",
            map_preview: "Vorschau",
            map_full: "Karte",
            photobox: "Reisebild",
            social_post: "Beitragsbild",
        });
        expect(derivedMediaTitle("coat", "place", "Gareth", null)).toBe("Wappen von Gareth");
        expect(derivedMediaTitle("photobox", "place", "Gareth", null)).toBe("Reisebild von Gareth");
        expect(derivedMediaTitle("header", "place", " Gareth ", 1)).toBe("Bild von Gareth (1)");
        expect(derivedMediaTitle("coat", "territory", "Baronie Eichenwald", null)).toBe(
            "Wappen von Baronie Eichenwald",
        );
        expect(derivedMediaTitle("literature_cover", "adventure", "Die Flusslande (2023)", null)).toBe(
            "Umschlag von „Die Flusslande (2023)“",
        );
        expect(derivedMediaTitle("map_preview", "citymap", "Stadtplan von Olport (Unter dem Westwind)", null)).toBe(
            "Vorschau von „Stadtplan von Olport (Unter dem Westwind)“",
        );
        expect(derivedMediaTitle("map_full", "citymap", "Rhôndur", null)).toBe("Karte von „Rhôndur“");
    });

    it("Beispiele des Betreibers: „Wappen von Gareth“ ohne Nummer, Bilder nach der Galerie (1), (2), (3), auch ein einzelnes", () => {
        const plan = planAssetTitles(
            [
                usage({ assetId: "1" }),
                usage({ assetId: "12", role: "header", via: "gallery", position: 2 }),
                usage({ assetId: "10", role: "header", via: "gallery", position: 0 }),
                usage({ assetId: "11", role: "header", via: "gallery", position: 1 }),
                usage({
                    assetId: "20",
                    subjectId: "p-perricum",
                    subjectName: "Perricum",
                    role: "header",
                    via: "gallery",
                    position: 0,
                }),
            ],
            ["1", "10", "11", "12", "20"].map((id) => untitled(id)),
        );
        expect(Object.fromEntries(plan)).toEqual({
            "1": "Wappen von Gareth",
            "10": "Bild von Gareth (1)",
            "11": "Bild von Gareth (2)",
            "12": "Bild von Gareth (3)",
            "20": "Bild von Perricum (1)",
        });
    });

    it("ein Titel eines Menschen bleibt, auch ein bewusst geleerter; sein Name ist vergeben, die Nummer weicht aus", () => {
        const usages = [
            usage({ assetId: "10", role: "header", via: "gallery", position: 0 }),
            usage({ assetId: "11", role: "header", via: "gallery", position: 1 }),
            usage({ assetId: "12", role: "header", via: "gallery", position: 2 }),
            usage({ assetId: "13", role: "header", via: "gallery", position: 3 }),
        ];
        const plan = planAssetTitles(usages, [
            untitled("10"),
            untitled("11", "Bild von Gareth (1)", true),
            untitled("12", null, true),
            untitled("13", "Marktplatz", true),
        ]);
        // 10 stünde auf (1), das trägt schon 11 (ein Mensch): die kleinste freie Nummer.
        expect(Object.fromEntries(plan)).toEqual({ "10": "Bild von Gareth (2)" });
    });

    it("mehrere Objekte: die älteste aktive Bindung gibt den Namen; mehrere Assets einer Rolle am Objekt werden nummeriert", () => {
        const plan = planAssetTitles(
            [
                usage({
                    assetId: "5",
                    subjectId: "t-1",
                    subjectKind: "territory",
                    subjectName: "Mark Rommilys",
                    boundAt: day("2026-10-06"),
                }),
                usage({ assetId: "5", subjectId: "p-1", subjectName: "Rommilys", boundAt: day("2026-10-05") }),
                usage({
                    assetId: "6",
                    role: "literature_cover",
                    subjectKind: "adventure",
                    subjectId: "a-1",
                    subjectName: "Havena",
                }),
                usage({
                    assetId: "7",
                    role: "literature_cover",
                    subjectKind: "adventure",
                    subjectId: "a-1",
                    subjectName: "Havena",
                    boundAt: day("2026-10-06"),
                }),
            ],
            ["5", "6", "7"].map((id) => untitled(id)),
        );
        expect(Object.fromEntries(plan)).toEqual({
            "5": "Wappen von Rommilys",
            "6": "Umschlag von „Havena“ (1)",
            "7": "Umschlag von „Havena“ (2)",
        });
    });

    it("eine Bindung benennt nur ihr Asset; die anderen der Galerie zählen für Platz und vergebene Namen", () => {
        const usages = [
            usage({ assetId: "30", role: "header", via: "gallery", position: 0 }),
            usage({ assetId: "10", role: "header", via: "gallery", position: 1 }),
            usage({ assetId: "11", role: "header", via: "gallery", position: 2 }),
        ];
        const assets = [untitled("30"), untitled("10", "Bild von Gareth (1)"), untitled("11", "Bild von Gareth (2)")];
        expect(Object.fromEntries(planAssetTitles(usages, assets, new Set(["30"])))).toEqual({
            "30": "Bild von Gareth (3)",
        });
        expect(planAssetTitles(usages, assets, new Set(["10"])).size).toBe(0);
    });
});

/**
 * Gleiche Namen verschiedener Objekte (Betreiber 2026-10-11, wörtlich: „ah dann 12 Wappen von Fasar, Stadt ohne klammer“): die Art
 * nach einem Komma, ohne Klammer; wo auch sie gleich ist, die Nummer dahinter. Die Beispiele sind echte Fälle des Bestands.
 */
describe("Namen aus dem Fachobjekt: gleiche Namen verschiedener Objekte (rein)", () => {
    const work = (assetId: string, subjectId: string, name: string, label: string | null, at: string): TitleUsage =>
        usage({
            assetId,
            role: "literature_cover",
            subjectKind: "adventure",
            subjectId,
            subjectName: name,
            subjectLabel: label,
            boundAt: day(at),
        });

    it("die Art: jede Stadtgröße heißt „Stadt“, ein Gebiet „Gebiet“, ein Werk Art und Ausgabe; eine Karte hat keine", () => {
        expect(subjectKindLabel("place", { placeSubtype: "metropole" })).toBe("Stadt");
        expect(subjectKindLabel("place", { placeSubtype: "kleinstadt" })).toBe("Stadt");
        expect(subjectKindLabel("place", { placeSubtype: "dorf" })).toBe("Dorf");
        expect(subjectKindLabel("place", { placeSubtype: "gebaeude" })).toBe("Gebäude");
        expect(subjectKindLabel("territory")).toBe("Gebiet");
        expect(subjectKindLabel("adventure", { productType: "gruppenabenteuer", edition: "DSA5" })).toBe(
            "Gruppenabenteuer DSA5",
        );
        expect(subjectKindLabel("adventure", { productType: "roman", edition: null })).toBe("Roman");
        expect(subjectKindLabel("adventure", { productType: "spielhilfe", edition: "keine" })).toBe("Spielhilfe");
        expect(subjectKindLabel("adventure", { productType: "brettspiel", edition: "" })).toBe("Brettspiel");
        expect(subjectKindLabel("citymap")).toBeNull();
    });

    it("🔴 Wappen-Paar: Stadt und Gebiet gleichen Namens heißen „Wappen von Fasar, Stadt“ und „Wappen von Fasar, Gebiet“", () => {
        const plan = planAssetTitles(
            [
                usage({ assetId: "1", subjectId: "p-fasar", subjectName: "Fasar", subjectLabel: "Stadt" }),
                usage({
                    assetId: "2",
                    subjectKind: "territory",
                    subjectId: "t-fasar",
                    subjectName: "Fasar",
                    subjectLabel: "Gebiet",
                }),
                // Ein Name ohne Doppelgänger bleibt kurz.
                usage({ assetId: "3", subjectId: "p-gareth", subjectName: "Gareth", subjectLabel: "Stadt" }),
            ],
            ["1", "2", "3"].map((id) => untitled(id)),
        );
        expect(Object.fromEntries(plan)).toEqual({
            "1": "Wappen von Fasar, Stadt",
            "2": "Wappen von Fasar, Gebiet",
            "3": "Wappen von Gareth",
        });
    });

    it("🔴 Bücher: Art und Ausgabe nach dem Komma („Umschlag von „Havena“, Gruppenabenteuer DSA5“)", () => {
        const plan = planAssetTitles(
            [
                work("1", "a-1", "Havena", "Regionalspielhilfe DSA1", "2026-10-01"),
                work("2", "a-2", "Havena", "Gruppenabenteuer DSA5", "2026-10-02"),
                work("3", "a-3", "Havena", "Spielhilfe DSA5", "2026-10-03"),
                work("4", "a-4", "Havena", "Regionalspielhilfe DSA5", "2026-10-04"),
            ],
            ["1", "2", "3", "4"].map((id) => untitled(id)),
        );
        expect(Object.fromEntries(plan)).toEqual({
            "1": "Umschlag von „Havena“, Regionalspielhilfe DSA1",
            "2": "Umschlag von „Havena“, Gruppenabenteuer DSA5",
            "3": "Umschlag von „Havena“, Spielhilfe DSA5",
            "4": "Umschlag von „Havena“, Regionalspielhilfe DSA5",
        });
    });

    it("🔴 auch nach der Art gleich: die Nummer dahinter, nach der ältesten Bindung; ohne Ausgabe nur die Art", () => {
        const plan = planAssetTitles(
            [
                work("2", "a-2", "Rohals Erben", "Spielhilfe DSA5", "2026-10-02"),
                work("1", "a-1", "Rohals Erben", "Spielhilfe DSA5", "2026-10-01"),
                work("3", "a-3", "Die Löwin von Neetha", "Roman", "2026-10-01"),
                work("4", "a-4", "Die Löwin von Neetha", "Roman", "2026-10-02"),
            ],
            ["1", "2", "3", "4"].map((id) => untitled(id)),
        );
        expect(Object.fromEntries(plan)).toEqual({
            "1": "Umschlag von „Rohals Erben“, Spielhilfe DSA5 (1)",
            "2": "Umschlag von „Rohals Erben“, Spielhilfe DSA5 (2)",
            "3": "Umschlag von „Die Löwin von Neetha“, Roman (1)",
            "4": "Umschlag von „Die Löwin von Neetha“, Roman (2)",
        });
    });

    it("Bilder zweier Dörfer gleichen Namens: die Nummer des Orts vor der des Bildes, in einer Klammer", () => {
        const plan = planAssetTitles(
            [
                usage({
                    assetId: "1",
                    role: "header",
                    via: "gallery",
                    position: 0,
                    subjectId: "p-1",
                    subjectName: "Eichenau",
                    subjectLabel: "Dorf",
                }),
                usage({
                    assetId: "2",
                    role: "header",
                    via: "gallery",
                    position: 0,
                    subjectId: "p-2",
                    subjectName: "Eichenau",
                    subjectLabel: "Dorf",
                    boundAt: day("2026-10-06"),
                }),
            ],
            ["1", "2"].map((id) => untitled(id)),
        );
        expect(Object.fromEntries(plan)).toEqual({
            "1": "Bild von Eichenau, Dorf (1.1)",
            "2": "Bild von Eichenau, Dorf (2.1)",
        });
    });

    it("🔴 umbenannt wird nur im Nachtrag und nur ein Name des Systems; ein Titel eines Menschen bleibt, die eigene Nummer auch", () => {
        const usages = [
            usage({ assetId: "1", subjectId: "p-fasar", subjectName: "Fasar", subjectLabel: "Stadt" }),
            usage({
                assetId: "2",
                subjectKind: "territory",
                subjectId: "t-fasar",
                subjectName: "Fasar",
                subjectLabel: "Gebiet",
            }),
            usage({
                assetId: "3",
                role: "header",
                via: "gallery",
                position: 0,
                subjectId: "p-fasar",
                subjectName: "Fasar",
                subjectLabel: "Stadt",
            }),
            usage({
                assetId: "4",
                role: "header",
                via: "gallery",
                position: 0,
                subjectKind: "territory",
                subjectId: "t-fasar",
                subjectName: "Fasar",
                subjectLabel: "Gebiet",
            }),
            usage({ assetId: "5", subjectId: "p-gareth", subjectName: "Gareth", subjectLabel: "Stadt" }),
        ];
        const assets = [
            // Der Mensch schrieb genau den alten Namen: er bleibt.
            untitled("1", "Wappen von Fasar", true),
            untitled("2", "Wappen von Fasar"),
            untitled("3", "Bild von Fasar (3)"),
            // Ein Name, den das System nie so gebaut hätte, bleibt ebenfalls.
            untitled("4", "Fasar bei Nacht"),
            untitled("5", "Wappen von Gareth"),
        ];
        // Import und Bindungen benennen nur leere Titel.
        expect(planAssetTitles(usages, assets).size).toBe(0);
        expect(Object.fromEntries(planAssetTitles(usages, assets, undefined, { renameSystem: true }))).toEqual({
            "2": "Wappen von Fasar, Gebiet",
            "3": "Bild von Fasar, Stadt (3)",
        });
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const PERSON = "6d696d70-0000-4000-9000-0000000000ab";
const ACTOR: MediaActor = { personId: PERSON, environment: "test" };
const RUN = "6d656469-0000-4000-9000-fffffffff0ab";

interface World {
    coat: FixtureAsset;
    aiHeader: FixtureAsset;
    photoHeader: FixtureAsset;
    assertedHeader: FixtureAsset;
    cover: FixtureAsset;
    preview: FixtureAsset;
    placeId: string;
    galleryId: string;
}

describeWithDatabase("KI-Regel und Namen (WI-0068, Betreiber 2026-10-10)", { timeout: 120_000 }, () => {
    let database: Database;
    let world: World;

    const clean = async (): Promise<void> => {
        await cleanEditorMedia(database, [PERSON]);
        await cleanMediaFixtures(database);
        await cleanLegacyMedia(database);
        await database`DELETE FROM migration_run WHERE id = ${RUN} OR source_ref IN ('media:regeln', 'media:titel')`;
    };

    /** Die Vorgängerinnen, wie das Seed-Skript sie vor Migration 0092 anlegte. */
    const insertPredecessor = async (rule: SupersededRule, revokedOn: string | null = null): Promise<void> => {
        await database`
            INSERT INTO publication_rule (rights_basis, license_key, role, scope_text, operator_quote, decided_on, revoked_on, revoked_reason)
            VALUES (${rule.basis}, NULL, ${rule.role}, ${rule.scopeText}, ${rule.operatorQuote}, ${rule.decidedOn}::date,
                    ${revokedOn}::date, ${revokedOn === null ? null : "Entscheidung"})
        `;
    };

    const ownWork = async (
        ref: string,
        clearance: string,
        creation: string,
        variant: string,
    ): Promise<FixtureAsset> => {
        const asset = await insertAsset(database, {
            ref,
            rights: { basis: "own_work", clearance },
            published: [{ variant }],
        });
        await database`UPDATE media_asset SET creation_method = ${creation} WHERE id = ${asset.id}`;
        await database`
            INSERT INTO media_ingest (media_asset_id, ingest_kind, migration_run_id, source_system)
            VALUES (${asset.id}, 'legacy_import', ${RUN}, 'media-test')
        `;
        return asset;
    };

    const buildWorld = async (): Promise<World> => {
        await database`
            INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version, status)
            VALUES (${RUN}, 'media', 'media-test', 'ki-regel', 'test', 'completed')
        `;
        const place = await insertPlace(database, 71);
        const adventure = await insertAdventure(database, 72);
        const citymap = await insertCitymap(database, 73);
        const coat = await ownWork("kiregel-wappen", "legacy_assumed", "ai_generated", "coat");
        const aiHeader = await ownWork("kiregel-bild-ki", "legacy_assumed", "ai_generated", "header_16_9");
        const photoHeader = await ownWork("kiregel-bild-foto", "legacy_assumed", "photo", "header_16_9");
        const assertedHeader = await ownWork("kiregel-bild-legacy", "legacy_asserted", "ai_generated", "header_16_9");
        const cover = await insertAsset(database, {
            ref: "kiregel-umschlag",
            rights: { basis: "fan_policy", clearance: "legacy_asserted" },
            published: [{ variant: "literature_cover" }],
        });
        const preview = await insertAsset(database, {
            ref: "kiregel-vorschau",
            rights: { basis: "fan_policy", clearance: "legacy_asserted" },
            published: [{ variant: "citymap_preview" }],
        });
        await database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${place.id}, ${coat.id}, 'coat', 'legacy')`;
        const gallery = await insertGallery(database, "kiregel-galerie");
        await database`
            INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${place.id}, ${gallery.id}, 'header', 'legacy')
        `;
        for (const [position, asset] of [aiHeader, photoHeader, assertedHeader].entries()) {
            await database`
                INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${gallery.id}, ${asset.id}, ${position})
            `;
        }
        await database`
            INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin) VALUES (${adventure.id}, ${cover.id}, 'literature_cover', 'legacy')
        `;
        await database`
            INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin) VALUES (${citymap.id}, ${preview.id}, 'map_preview', 'legacy')
        `;
        return {
            coat,
            aiHeader,
            photoHeader,
            assertedHeader,
            cover,
            preview,
            placeId: place.publicId,
            galleryId: gallery.id,
        };
    };

    /** Die Entscheidung je eigenem Asset dieser Welt: öffentlich und Grund. */
    const decisions = async (db: Database = database): Promise<Record<string, string>> => {
        const mine = [world.coat, world.aiHeader, world.photoHeader, world.assertedHeader];
        const usages = await loadUsages(
            db,
            mine.map((asset) => asset.id),
        );
        return Object.fromEntries(
            mine.map((asset) => {
                const publication = usages.get(asset.id)?.[0]?.publication;
                return [
                    asset.publicId,
                    `${publication?.public ? "öffentlich" : "privat"} ${publication?.reason ?? "-"}`,
                ];
            }),
        );
    };

    const ruleRows = async () =>
        database<{ key: string; revoked_on: string | null; quote: string; reason: string | null }[]>`
            SELECT concat_ws('/', rights_basis, creation_method, role) AS key, revoked_on::text, operator_quote AS quote,
                   revoked_reason AS reason
              FROM publication_rule WHERE rights_basis = 'own_work' AND license_key IS NULL ORDER BY id
        `;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await clean();
    }, 120_000);

    afterAll(async () => {
        await clean();
        await database?.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await clean();
        world = await buildWorld();
    });

    afterEach(clean);

    describe("Teil A: die Freigaberegel über die Entstehung", () => {
        beforeEach(async () => {
            // Der Stand vor dem Wechsel: die übrigen Regeln des Skripts gelten schon, die beiden Klassenregeln in ihrer alten Form.
            await seedPublicationRules(
                database,
                PUBLICATION_RULE_SEEDS.filter((seed) => seed.supersedes === undefined),
            );
            for (const rule of SUPERSEDED_RULE_SEEDS) await insertPredecessor(rule);
        });

        it("heute: alle eigenen Werke öffentlich, auch das Foto (die alte Regel nahm jedes eigene Werk als KI an)", async () => {
            expect(await decisions()).toEqual({
                [world.coat.publicId]: "öffentlich rule",
                [world.aiHeader.publicId]: "öffentlich rule",
                [world.photoHeader.publicId]: "öffentlich rule",
                // Betreiber 2026-10-11 („13: B!“): Legacys „eigenes Werk“ trägt nicht mehr von selbst; das KI-Bild steht über die Regel.
                [world.assertedHeader.publicId]: "öffentlich rule",
            });
            expect((await ruleSeedStates(database)).filter(({ state }) => state === "pending")).toHaveLength(2);
        });

        it("Trockenlauf: misst den Wechsel und schreibt nichts, auch kein Journal", async () => {
            const before = await ruleRows();
            const report = await switchPublicationRules(database, { dryRun: true });
            expect(report.rules.superseded).toBe(2);
            const mine = report.changes.filter((change) => change.before.publicId === world.photoHeader.publicId);
            expect(report.changes.map((change) => change.before.publicId)).toEqual([world.photoHeader.publicId]);
            expect(mine[0]?.before).toMatchObject({ public: true, reason: "rule" });
            expect(mine[0]?.after).toMatchObject({ public: false, reason: "legacy_assumed" });
            expect(report.findings.map((finding) => finding.code)).toEqual(["ki_annahme_entfallen"]);
            expect(report.findings[0]?.objects.map((object) => object.publicId)).toEqual([world.photoHeader.publicId]);
            expect(await ruleRows()).toEqual(before);
            const [journal] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM migration_run WHERE id = ${report.runId}`;
            expect(journal?.n).toBe(0);
        });

        it("mit Zitat: Vorgängerinnen widerrufen, KI-Regeln an, in EINER Transaktion; nur das Foto fällt heraus und liegt im Korb", async () => {
            const report = await switchPublicationRules(database, {
                dryRun: false,
                operatorSaid: "Testzitat Regelwechsel",
            });
            expect(report.rules).toMatchObject({ created: 2, superseded: 2, present: 6, held: [] });
            const rows = await ruleRows();
            expect(rows.map((row) => `${row.key} ${row.revoked_on ?? "gilt"}`)).toEqual([
                "own_work/header 2026-10-10",
                "own_work/coat 2026-10-10",
                "own_work/ai_generated/header gilt",
                "own_work/ai_generated/coat gilt",
            ]);
            expect(rows[0]?.reason).toContain("Abgelöst durch die Regel own_work/ai_generated/header");
            expect(rows[2]?.quote).toBe(AI_RULE_OPERATOR_QUOTE);
            expect(await decisions()).toEqual({
                [world.coat.publicId]: "öffentlich rule",
                [world.aiHeader.publicId]: "öffentlich rule",
                [world.photoHeader.publicId]: "privat legacy_assumed",
                // Betreiber 2026-10-11 („13: B!“): Legacys „eigenes Werk“ trägt nicht mehr von selbst; das KI-Bild steht über die Regel.
                [world.assertedHeader.publicId]: "öffentlich rule",
            });
            // Der Korb „Rechte prüfen: früher als KI angenommen“: genau das Foto, und die Navigation zählt es.
            const basket = await searchMedia(database, { basket: "former_ai_assumption", limit: 200 });
            expect(basket.items.map((item) => item.id)).toEqual([world.photoHeader.publicId]);
            expect((await mediaNavigation(database)).baskets.former_ai_assumption).toBe(1);
            const [journal] = await database<{ journal: { operator_said: string; changes: number } }[]>`
                SELECT journal FROM migration_run WHERE id = ${report.runId}
            `;
            expect(journal?.journal).toMatchObject({ operator_said: "Testzitat Regelwechsel", changes: 1 });

            // Zweiter Lauf: nichts mehr zu tun.
            const second = await switchPublicationRules(database, { dryRun: false });
            expect(second.rules).toMatchObject({ created: 0, superseded: 0 });
            expect(second.changes).toEqual([]);
        });

        it("kein Augenblick ohne Regel: ein Leser daneben sieht bis zum Commit den alten Stand, danach den neuen", async () => {
            const reader = createDatabase(testDatabaseUrl as string, { max: 1 });
            try {
                const before = await decisions(reader);
                await database.begin(async (tx) => {
                    await seedPublicationRules(tx);
                    expect(await decisions(reader)).toEqual(before);
                });
                expect(await decisions(reader)).toEqual({
                    ...before,
                    [world.photoHeader.publicId]: "privat legacy_assumed",
                });
            } finally {
                await reader.end({ timeout: 5 });
            }
        });

        it("ein neues eigenes Werk: KI-generiert öffentlich, ein Foto wartet auf die Rechteprüfung (Vorschau des Formulars)", async () => {
            await switchPublicationRules(database, { dryRun: false });
            const preview = (creation: "ai_generated" | "photo") =>
                publicationPreview(database, { role: "coat", basis: "own_work", creation });
            expect(await preview("ai_generated")).toEqual({ public: true, reason: "rule" });
            expect(await preview("photo")).toEqual({ public: false, reason: "clearance_pending" });
        });

        it("Entstehung im MAM ändern gleicht die Dateien je Rolle ab (Job), statt eine öffentliche Fassung stehen zu lassen", async () => {
            await switchPublicationRules(database, { dryRun: false });
            const [asset] = await database<
                { revision: number }[]
            >`SELECT revision::int FROM media_asset WHERE id = ${world.aiHeader.id}`;
            const receipt = await setMetadata(database, ACTOR, world.aiHeader.publicId, {
                operationId: operation(),
                baseRevision: asset!.revision,
                creationMethod: "photo",
            });
            expect(receipt.derivedWork.map((work) => work.kind)).toEqual(["media_settle"]);
            expect((await decisions())[world.aiHeader.publicId]).toBe("privat legacy_assumed");
            expect(
                (await searchMedia(database, { basket: "former_ai_assumption" })).items.map((item) => item.id).sort(),
            ).toEqual([world.aiHeader.publicId, world.photoHeader.publicId].sort());
        });

        it("🔴 eine widerrufene Vorgängerin bringt ihre Nachfolgerin nicht hervor: der Widerruf war eine Entscheidung", async () => {
            await database`DELETE FROM publication_rule WHERE rights_basis = 'own_work' AND role = 'header' AND creation_method IS NULL`;
            await insertPredecessor(SUPERSEDED_RULE_SEEDS[0]!, "2026-10-06");
            const report = await switchPublicationRules(database, { dryRun: false });
            expect(report.rules.held).toEqual(["own_work/ai_generated/header"]);
            expect((await ruleRows()).map((row) => `${row.key} ${row.revoked_on ?? "gilt"}`)).toEqual([
                "own_work/coat 2026-10-10",
                "own_work/header 2026-10-06",
                "own_work/ai_generated/coat gilt",
            ]);
            const states = Object.fromEntries(
                (await ruleSeedStates(database)).map(({ seed, state }) => [
                    `${seed.basis}/${seed.creationMethod}/${seed.role}`,
                    state,
                ]),
            );
            expect(states["own_work/ai_generated/header"]).toBe("held");
        });
    });

    describe("Teil B: der Name aus dem Fachobjekt", () => {
        it("benennt jedes Asset ohne Titel nach seinem Objekt, einmal; die Revision zählt", async () => {
            const [before] = await database<
                { revision: number }[]
            >`SELECT revision::int FROM media_asset WHERE id = ${world.coat.id}`;
            const result = await database.begin((tx) => nameUntitledAssets(tx));
            const titles = Object.fromEntries(result.named.map((asset) => [asset.publicId, asset.title]));
            expect(titles).toMatchObject({
                [world.coat.publicId]: "Wappen von Medienort 71",
                [world.aiHeader.publicId]: "Bild von Medienort 71 (1)",
                [world.photoHeader.publicId]: "Bild von Medienort 71 (2)",
                [world.assertedHeader.publicId]: "Bild von Medienort 71 (3)",
                [world.cover.publicId]: "Umschlag von „Medienwerk 72“",
                [world.preview.publicId]: "Vorschau von „Medienkarte 73“",
            });
            const [after] = await database<
                { revision: number }[]
            >`SELECT revision::int FROM media_asset WHERE id = ${world.coat.id}`;
            expect(after!.revision).toBe(before!.revision + 1);
            expect((await database.begin((tx) => nameUntitledAssets(tx))).named).toEqual([]);
        });

        it("🔴 ein Titel eines Menschen bleibt, auch ein bewusst geleerter, auch gegen den Nachtrag", async () => {
            const revisionOf = async (id: string) =>
                (await database<{ revision: number }[]>`SELECT revision::int FROM media_asset WHERE id = ${id}`)[0]!
                    .revision;
            await setMetadata(database, ACTOR, world.coat.publicId, {
                operationId: operation(),
                baseRevision: await revisionOf(world.coat.id),
                title: "Löwe im Schild",
            });
            await setMetadata(database, ACTOR, world.cover.publicId, {
                operationId: operation(),
                baseRevision: await revisionOf(world.cover.id),
                title: "",
            });
            const report = await backfillAssetTitles(database, { dryRun: false, operatorSaid: "Testzitat Namen" });
            expect(report.keptHuman).toBe(1);
            const titles = await database<{ id: string; title: string | null }[]>`
                SELECT id::text, title FROM media_asset WHERE id IN (${world.coat.id}, ${world.cover.id}) ORDER BY id
            `;
            expect(titles.map((row) => row.title)).toEqual(["Löwe im Schild", null]);
        });

        it("Nachtrag: ohne Zitat nur gerechnet, mit Zitat geschrieben und im Journal", async () => {
            const dry = await backfillAssetTitles(database, { dryRun: true });
            const mine = new Set(
                [world.coat, world.aiHeader, world.photoHeader, world.assertedHeader, world.cover, world.preview].map(
                    (asset) => asset.publicId,
                ),
            );
            expect(
                dry.named
                    .filter((asset) => mine.has(asset.publicId))
                    .map((asset) => asset.role)
                    .sort(),
            ).toEqual(["coat", "header", "header", "header", "literature_cover", "map_preview"]);
            const [untitled] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_asset WHERE id = ${world.coat.id} AND title IS NULL
            `;
            expect(untitled?.n).toBe(1);
            const written = await backfillAssetTitles(database, { dryRun: false, operatorSaid: "Testzitat Namen" });
            expect(written.named.length).toBe(dry.named.length);
            const [journal] = await database<{ journal: { operator_said: string; named: number } }[]>`
                SELECT journal FROM migration_run WHERE id = ${written.runId}
            `;
            expect(journal?.journal).toMatchObject({ operator_said: "Testzitat Namen", named: dry.named.length });
            expect((await backfillAssetTitles(database, { dryRun: false })).named).toEqual([]);
        });

        it("Bindung: ein Bild ohne Titel bekommt seinen Platz in der Galerie, oder die kleinste freie Nummer", async () => {
            await database.begin((tx) => nameUntitledAssets(tx));
            const fresh = await insertAsset(database, { ref: "kiregel-neu", published: [{ variant: "header_16_9" }] });
            const second = await insertAsset(database, {
                ref: "kiregel-neu-2",
                published: [{ variant: "header_16_9" }],
            });
            const gallery = async () =>
                (
                    await database<
                        { publicId: string; revision: number }[]
                    >`SELECT public_id::text AS "publicId", revision::int FROM media_gallery WHERE id = ${world.galleryId}`
                )[0]!;
            const added = await addToGallery(database, ACTOR, {
                operationId: operation(),
                galleryId: (await gallery()).publicId,
                assetId: fresh.publicId,
                baseRevision: (await gallery()).revision,
            });
            expect(added.affected.map((entry) => entry.kind)).toEqual(["gallery", "media_asset"]);
            await addToGallery(database, ACTOR, {
                operationId: operation(),
                galleryId: (await gallery()).publicId,
                assetId: second.publicId,
                baseRevision: (await gallery()).revision,
                position: 0,
            });
            const titles = await database<{ id: string; title: string }[]>`
                SELECT id::text, title FROM media_asset WHERE id IN (${fresh.id}, ${second.id}) ORDER BY id
            `;
            // Hinten angehängt: Platz 4. Vorn eingefügt: Platz 1 ist vergeben, die kleinste freie Nummer ist 5.
            expect(titles.map((row) => row.title)).toEqual(["Bild von Medienort 71 (4)", "Bild von Medienort 71 (5)"]);
            const derived = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_audit_event e JOIN media_operation o ON o.operation_id = e.operation_id
                 WHERE o.actor_person_id = ${PERSON}::uuid AND e.action = 'asset.title_derived'
            `;
            expect(derived[0]?.n).toBe(2);
        });

        it("🔴 gleiche Namen: eine Bindung unterscheidet sofort, der Nachtrag benennt Namen des Systems um; Mensch und Upload bleiben", async () => {
            await database.begin((tx) => nameUntitledAssets(tx));
            // Ein Gebiet gleichen Namens wie der Ort, mit eigenem Wappen (Fasar: Stadt und Gebiet).
            const territory = await insertTerritory(database, 74);
            await database`UPDATE territory SET name = 'Medienort 71' WHERE id = ${territory.id}`;
            const territoryCoat = await insertAsset(database, {
                ref: "kiregel-gebiet",
                published: [{ variant: "coat" }],
            });
            await database`
                INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${territory.id}, ${territoryCoat.id}, 'coat', 'legacy')
            `;
            const bound = await database.begin((tx) => nameUntitledAssets(tx, { assetIds: [territoryCoat.id] }));
            expect(bound.named.map((asset) => asset.title)).toEqual(["Wappen von Medienort 71, Gebiet"]);
            expect(bound.renamed).toEqual([]);

            // Zwei weitere Werke gleichen Titels: eines mit Ausgabe DSA5, eines wie das erste ohne; das zweite lädt ein Mensch hoch.
            const covers: FixtureAsset[] = [];
            for (const [n, edition] of [
                [75, "DSA5"],
                [76, null],
                [77, null],
            ] as const) {
                const adventure = await insertAdventure(database, n);
                await database`UPDATE adventure SET title = 'Medienwerk 72', edition = ${edition} WHERE id = ${adventure.id}`;
                const cover = await insertAsset(database, {
                    ref: `kiregel-umschlag-${String(n)}`,
                    published: [{ variant: "literature_cover" }],
                });
                await database`
                    INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin) VALUES (${adventure.id}, ${cover.id}, 'literature_cover', 'legacy')
                `;
                covers.push(cover);
            }
            await database`UPDATE media_asset SET origin = 'editor_upload', title = 'Umschlag von „Medienwerk 72“' WHERE id = ${covers[2]!.id}`;
            await database.begin((tx) => nameUntitledAssets(tx));
            // Der Mensch schreibt am Wappen des Orts genau den alten Namen hin: er bleibt.
            const [coatRow] = await database<
                { revision: number }[]
            >`SELECT revision::int FROM media_asset WHERE id = ${world.coat.id}`;
            await setMetadata(database, ACTOR, world.coat.publicId, {
                operationId: operation(),
                baseRevision: coatRow!.revision,
                title: "Wappen von Medienort 71",
            });

            const dry = await backfillAssetTitles(database, { dryRun: true });
            const mine = (report: typeof dry) =>
                Object.fromEntries(
                    report.renamed
                        .filter((asset) => [world.cover.id, ...covers.map((cover) => cover.id)].includes(asset.assetId))
                        .map((asset) => [asset.assetId, `${asset.before} → ${asset.title}`]),
                );
            expect(mine(dry)).toEqual({
                [world.cover.id]: "Umschlag von „Medienwerk 72“ → Umschlag von „Medienwerk 72“, Gruppenabenteuer (1)",
            });
            // Die Bindung von 76 bekam schon die Unterscheidung (keine Umbenennung); 77 ist ein Upload mit Namen, das Wappen benannte ein Mensch.
            expect(dry.renamed.some((asset) => asset.assetId === world.coat.id)).toBe(false);
            expect(dry.renamed.some((asset) => asset.assetId === covers[2]!.id)).toBe(false);
            const [still] = await database<
                { title: string }[]
            >`SELECT title FROM media_asset WHERE id = ${world.cover.id}`;
            expect(still?.title).toBe("Umschlag von „Medienwerk 72“");

            const written = await backfillAssetTitles(database, {
                dryRun: false,
                operatorSaid: "Testzitat gleiche Namen",
            });
            expect(written.renamed.length).toBe(dry.renamed.length);
            const titles = await database<{ id: string; title: string }[]>`
                SELECT id::text, title FROM media_asset
                 WHERE id IN (${world.coat.id}, ${territoryCoat.id}, ${world.cover.id}, ${covers[0]!.id}, ${covers[1]!.id}, ${covers[2]!.id})
            `;
            expect(Object.fromEntries(titles.map((row) => [row.id, row.title]))).toEqual({
                [world.coat.id]: "Wappen von Medienort 71",
                [territoryCoat.id]: "Wappen von Medienort 71, Gebiet",
                [world.cover.id]: "Umschlag von „Medienwerk 72“, Gruppenabenteuer (1)",
                [covers[0]!.id]: "Umschlag von „Medienwerk 72“, Gruppenabenteuer DSA5",
                [covers[1]!.id]: "Umschlag von „Medienwerk 72“, Gruppenabenteuer (2)",
                [covers[2]!.id]: "Umschlag von „Medienwerk 72“",
            });
            const [journal] = await database<{ journal: { renamed: number; operator_said: string } }[]>`
                SELECT journal FROM migration_run WHERE id = ${written.runId}
            `;
            expect(journal?.journal).toMatchObject({
                renamed: written.renamed.length,
                operator_said: "Testzitat gleiche Namen",
            });
            expect((await backfillAssetTitles(database, { dryRun: true })).renamed).toEqual([]);
        });
    });
});
