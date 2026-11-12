import { Value } from "@sinclair/typebox/value";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CitymapEntry, MediaPublicView } from "@avesmaps3d/shared";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { PUBLISHED_VARIANT } from "../src/media/roles.ts";
import {
    creditRequired,
    resolveCitymapFulls,
    resolveCitymapPreviews,
    resolveCitymapVersions,
    resolveLiteratureCovers,
    resolvePlaceMedia,
    resolveTerritoryCoats,
    resolveTerritoryMedia,
} from "../src/media/resolver.ts";
import { listCitymaps } from "../src/subjects/sections/citymaps.ts";
import {
    cleanMediaFixtures,
    insertAdventure,
    insertAsset,
    insertCitymap,
    insertGallery,
    insertPlace,
    insertRule,
    insertTerritory,
    sha,
    type AssetSpec,
    type FixtureAsset,
} from "./support/media-fixture.ts";

/**
 * Der öffentliche Lesepfad gegen echtes PostgreSQL (WI-0063 MEDIA-M5): was ein Ort oder ein Gebiet an Medien zeigt, und
 * was die Antwort NIE enthält.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Verbindung selbst für die zählenden Ersatzverbindungen: Der Resolver liest darüber die Inhaltsschalter (WI-0127 SYS-10), einmal
 * je Aufruf und nie je Zeile; gezählt wird weiter nur `unsafe`, die Abfrage der Medien.
 */
const tagged =
    (database: Database) =>
    (strings: TemplateStringsArray, ...values: never[]): unknown =>
        database(strings, ...values);

const COAT = PUBLISHED_VARIANT.coat;

const OWN_CLEARED = { basis: "own_work", clearance: "cleared" } as const;
const CC_BY = { basis: "license", clearance: "cleared", licenseKey: "cc-by-4.0" } as const;
/**
 * CC BY, deren Rechte noch niemand geprüft hat (Bestand aus Legacy). Seit WI-0282 (Betreiber 2026-11-06) trägt „Rechte geprüft“ (`cleared`) jede bekannte
 * Rechtslage von selbst, auch eine Lizenz mit Nennung; ohne diese Prüfung erscheint sie nur mit Regel oder bewusster Einzelfreigabe.
 */
const CC_BY_UNGEPRUEFT = { ...CC_BY, clearance: "legacy_asserted" } as const;

/**
 * Die Nennung hängt an der Rechtelage, nicht am Weg (Betreiber 2026-10-11 über die Koordination, wörtlich: „[Name] ist ein editor von uns, aber "Urheber" braucht nur dran stehen wenn das bild auch urhebernennung verlangt, oder?“).
 */
describe("Media Core: Nennung nur, wo die Rechte sie verlangen", () => {
    it("eine Lizenz mit Nennungspflicht, eine Erlaubnis und die Fan-Richtlinie ja; eigenes Werk, gemeinfrei, CC0 nein", () => {
        expect(creditRequired({ basis: "license", licenseRequiresAttribution: true })).toBe(true);
        // CC BY ohne bekannte Version (kein Katalogschlüssel): die Familie verlangt sie.
        expect(creditRequired({ basis: "license", licenseRequiresAttribution: null })).toBe(true);
        expect(creditRequired({ basis: "license", licenseRequiresAttribution: false })).toBe(false);
        expect(creditRequired({ basis: "permission", licenseRequiresAttribution: null })).toBe(true);
        expect(creditRequired({ basis: "fan_policy", licenseRequiresAttribution: null })).toBe(true);
        expect(creditRequired({ basis: "own_work", licenseRequiresAttribution: null })).toBe(false);
        expect(creditRequired({ basis: "public_domain", licenseRequiresAttribution: null })).toBe(false);
    });
});

/** Wirft am Ende, damit eine Transaktion zurückgerollt wird, ohne dass die Zeilen je sichtbar werden. */
class Rollback extends Error {}

describeWithDatabase("Media Core: öffentlicher Lesepfad", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanMediaFixtures(database);
    }, 120_000);

    afterAll(async () => {
        await cleanMediaFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await cleanMediaFixtures(database);
    });

    afterEach(async () => {
        await cleanMediaFixtures(database);
    });

    /** Ein Asset für Wappen oder Kopfbild: Rechte nach Vorgabe, veröffentlichte Datei der Rollenvariante. */
    const asset = (ref: string, role: "coat" | "header", extra: Partial<AssetSpec> = {}): Promise<FixtureAsset> =>
        insertAsset(database, {
            ref,
            rights: OWN_CLEARED,
            published: [{ variant: PUBLISHED_VARIANT[role] }],
            ...extra,
        });

    const bindCoat = (placeId: string, assetId: string): Promise<unknown> =>
        database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${placeId}, ${assetId}, 'coat', 'legacy')`;

    async function bindGallery(
        placeId: string,
        ref: string,
        items: { asset: FixtureAsset; order: number; override?: string }[],
    ): Promise<string> {
        const gallery = await insertGallery(database, ref);
        await database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${placeId}, ${gallery.id}, 'header', 'legacy')`;
        for (const item of items) {
            if (item.override === "approved") {
                await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order, publication_override, override_decided_on, override_operator_quote)
                               VALUES (${gallery.id}, ${item.asset.id}, ${item.order}, 'approved', '2026-10-04', 'Testfreigabe des Betreibers')`;
            } else {
                await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order, publication_override)
                               VALUES (${gallery.id}, ${item.asset.id}, ${item.order}, ${item.override ?? "none"})`;
            }
        }
        return gallery.id;
    }

    /** Läuft in einer Transaktion, die danach zurückgerollt wird: für Zustände, die das Schema am Ende verbietet. */
    async function inRolledBackTransaction<T>(work: (transaction: Queryable) => Promise<T>): Promise<T> {
        let result: T | undefined;
        try {
            await database.begin(async (transaction) => {
                result = await work(transaction);
                throw new Rollback();
            });
        } catch (error) {
            if (!(error instanceof Rollback)) throw error;
        }
        return result as T;
    }

    it("🔴 die öffentliche Antwort enthält weder Prompt noch interne Notiz, Beleg, Legacy-Login oder Speicherschlüssel", async () => {
        const place = await insertPlace(database, 1);
        const coat = await asset("secret-coat", "coat", {
            ingestActorLegacy: "LOGIN-GEHEIM",
            rights: {
                ...OWN_CLEARED,
                rightsNote: "RECHTENOTIZ-GEHEIM",
                legacyRightsCode: "CODE-GEHEIM",
                creator: "Urheberin Eins",
            },
        });
        const header = await asset("secret-header", "header", { ingestActorLegacy: "LOGIN-GEHEIM" });
        await database`
            INSERT INTO media_creation (media_asset_id, tool, model, prompt, negative_prompt, parameters, legacy_note_raw)
            SELECT id, 'WERKZEUG-GEHEIM', 'MODELL-GEHEIM', 'PROMPT-GEHEIM', 'NEGATIV-GEHEIM', '{"seed": "SEED-GEHEIM"}'::jsonb, 'NOTIZ-GEHEIM'
            FROM media_asset WHERE source_system = 'media-test'
        `;
        await database`
            INSERT INTO media_rights_evidence (media_asset_id, evidence_kind, external_url, issuer, recipient, description, recorded_by)
            SELECT id, 'license_page', 'https://beleg.example/BELEG-GEHEIM', 'AUSSTELLER-GEHEIM', 'EMPFAENGER-GEHEIM', 'BELEGTEXT-GEHEIM', 'ERFASSER-GEHEIM'
            FROM media_asset WHERE source_system = 'media-test'
        `;
        await database`
            UPDATE media_rights SET reviewed_by = 'PRUEFER-GEHEIM'
            WHERE media_asset_id IN (SELECT id FROM media_asset WHERE source_system = 'media-test')
        `;
        await bindCoat(place.id, coat.id);
        await bindGallery(place.id, "settlement-gallery:secret", [{ asset: header, order: 1 }]);

        const views = await resolvePlaceMedia(database, place.publicId);
        expect(views.map((view) => view.role)).toEqual(["coat", "header"]);
        for (const view of views) {
            expect(
                Value.Check(MediaPublicView, view),
                JSON.stringify([...Value.Errors(MediaPublicView, view)][0]),
            ).toBe(true);
        }
        const json = JSON.stringify(views);
        for (const secret of [
            "GEHEIM",
            "beleg.example",
            "storage",
            "private/",
            "prompt",
            "clearance",
            "legacy",
            "evidence",
            "uploaded",
            "rights",
            "media_",
            "own_work",
        ]) {
            expect(json.toLowerCase(), `die Antwort darf „${secret}“ nicht enthalten`).not.toContain(
                secret.toLowerCase(),
            );
        }
        // Ein automatisch freigegebenes Medium trägt keine Nennung, auch wenn der Urheber bekannt ist.
        expect(views[0]).not.toHaveProperty("credit");
        expect(Object.keys(views[0] ?? {}).sort()).toEqual(["height", "id", "mimeType", "role", "url", "width"]);
        expect(views[0]?.id).toBe(coat.publicId);
    });

    it("die Galerie kommt in sort_order, ein einzelnes Titelbild steht davor, Dubletten fallen weg", async () => {
        const place = await insertPlace(database, 2);
        // Nacheinander: gleichzeitige Transaktionen scheitern am geteilten lokalen Cluster, wenn er ausgelastet ist.
        const one = await asset("gal-1", "header");
        const two = await asset("gal-2", "header");
        const three = await asset("gal-3", "header");
        if (!one || !two || !three) throw new Error("Fixture");
        // Absichtlich nicht in Reihenfolge eingetragen.
        await bindGallery(place.id, "settlement-gallery:order", [
            { asset: three, order: 30 },
            { asset: one, order: 10 },
            { asset: two, order: 20 },
        ]);
        const title = await asset("gal-title", "header");
        await database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${place.id}, ${title.id}, 'header', 'legacy')`;

        const views = await resolvePlaceMedia(database, place.publicId);
        expect(views.map((view) => view.id)).toEqual([title.publicId, one.publicId, two.publicId, three.publicId]);
        expect(views.every((view) => view.role === "header")).toBe(true);

        // Dasselbe Bild als Titelbild und in der Galerie erscheint einmal, und zwar vorn.
        await database`UPDATE place_media SET retired_at = now() WHERE place_id = ${place.id} AND media_asset_id = ${title.id}`;
        await database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${place.id}, ${three.id}, 'header', 'legacy')`;
        expect((await resolvePlaceMedia(database, place.publicId)).map((view) => view.id)).toEqual([
            three.publicId,
            one.publicId,
            two.publicId,
        ]);
    });

    it("🔴 ein nicht freigegebenes CC-BY-Bild fehlt, mit bewusster Freigabe erscheint es samt Nennung", async () => {
        const place = await insertPlace(database, 3);
        const open = await asset("cc-open", "header");
        const ccBy = await asset("cc-by", "header", {
            rights: { ...CC_BY_UNGEPRUEFT, creator: "Fotografin", attribution: "Foto: Fotografin, CC BY 4.0" },
        });
        const ccByApproved = await asset("cc-by-approved", "header", {
            rights: { ...CC_BY_UNGEPRUEFT, creator: "Fotograf", attribution: "Foto: Fotograf, CC BY 4.0" },
        });
        await bindGallery(place.id, "settlement-gallery:cc", [
            { asset: open, order: 1 },
            { asset: ccBy, order: 2 },
            { asset: ccByApproved, order: 3, override: "approved" },
        ]);
        const views = await resolvePlaceMedia(database, place.publicId);
        expect(views.map((view) => view.id)).toEqual([open.publicId, ccByApproved.publicId]);
        expect(views[0]).not.toHaveProperty("credit");
        expect(views[1]?.credit).toEqual({
            creator: "Fotograf",
            licenseName: "CC BY 4.0",
            licenseUri: "https://creativecommons.org/licenses/by/4.0/",
            attribution: "Foto: Fotograf, CC BY 4.0",
        });
        expect(Value.Check(MediaPublicView, views[1])).toBe(true);
    });

    it("🔴 Nennung: ein eigenes KI-Bild über die Regel ohne Zeile, CC BY mit, CC0 und gemeinfrei ohne (Betreiber 2026-10-11)", async () => {
        const place = await insertPlace(database, 9);
        // Wie die sechs Ortsbilder aus Legacy: eigenes Werk, KI, mit eingetragenem Urheber, öffentlich über die Regel.
        const ki = await asset("nennung-ki", "header", {
            rights: { basis: "own_work", clearance: "legacy_asserted", creator: "Elwe" },
        });
        await database`UPDATE media_asset SET creation_method = 'ai_generated' WHERE id = ${ki.id}`;
        const ccBy = await asset("nennung-ccby", "header", {
            rights: { ...CC_BY, creator: "Fotografin", attribution: "Foto: Fotografin, CC BY 4.0" },
        });
        const cc0 = await asset("nennung-cc0", "header", {
            rights: { basis: "license", clearance: "cleared", licenseKey: "cc0-1.0", creator: "Spender" },
        });
        const gemeinfrei = await asset("nennung-pd", "header", {
            rights: { basis: "public_domain", clearance: "legacy_asserted", creator: "Alter Meister" },
        });
        await insertRule(database, { basis: "own_work", role: "header" });
        await bindGallery(place.id, "settlement-gallery:nennung", [
            { asset: ki, order: 1 },
            { asset: ccBy, order: 2, override: "approved" },
            { asset: cc0, order: 3, override: "approved" },
            { asset: gemeinfrei, order: 4 },
        ]);
        const views = await resolvePlaceMedia(database, place.publicId);
        expect(views.map((view) => view.id)).toEqual([ki.publicId, ccBy.publicId, cc0.publicId, gemeinfrei.publicId]);
        expect(views[0]).not.toHaveProperty("credit");
        expect(views[1]?.credit).toEqual({
            creator: "Fotografin",
            licenseName: "CC BY 4.0",
            licenseUri: "https://creativecommons.org/licenses/by/4.0/",
            attribution: "Foto: Fotografin, CC BY 4.0",
        });
        // CC0 über eine Einzelfreigabe: kein Weg macht eine Nennung nötig, die die Lizenz nicht verlangt.
        expect(views[2]).not.toHaveProperty("credit");
        expect(views[3]).not.toHaveProperty("credit");
    });

    it("🔴 Unterdrückung gewinnt, auch gegen eine Einzelfreigabe", async () => {
        const place = await insertPlace(database, 4);
        const coat = await asset("sup-coat", "coat");
        const header = await asset("sup-header", "header");
        const views = await inRolledBackTransaction(async (transaction) => {
            // Den Endzustand verbietet das Schema; innerhalb der Transaktion lässt ihn der verzögerte Trigger zu.
            await transaction`INSERT INTO place_media (place_id, media_asset_id, role, origin, publication_override, override_decided_on, override_operator_quote)
                              VALUES (${place.id}, ${coat.id}, 'coat', 'legacy', 'approved', '2026-10-04', 'freigegeben')`;
            await transaction`INSERT INTO place_media_suppression (place_id, role, origin, legacy_reason) VALUES (${place.id}, 'coat', 'legacy', 'coat_none')`;
            const gallery = await transaction<{ id: string }[]>`
                INSERT INTO media_gallery (gallery_kind, source_system, source_ref) VALUES ('object_gallery', 'media-test', 'settlement-gallery:sup') RETURNING id
            `;
            await transaction`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${place.id}, ${gallery[0]?.id ?? ""}, 'header', 'legacy')`;
            await transaction`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${gallery[0]?.id ?? ""}, ${header.id}, 1)`;
            await transaction`INSERT INTO place_media_suppression (place_id, role, origin) VALUES (${place.id}, 'header', 'editor')`;
            return resolvePlaceMedia(transaction, place.publicId);
        });
        expect(views).toEqual([]);

        // Ohne Unterdrückung erscheinen beide.
        await bindCoat(place.id, coat.id);
        await bindGallery(place.id, "settlement-gallery:sup-2", [{ asset: header, order: 1 }]);
        expect((await resolvePlaceMedia(database, place.publicId)).map((view) => view.role)).toEqual([
            "coat",
            "header",
        ]);
    });

    it("zurückgezogene Bindungen, Einträge und Galerien erscheinen nicht", async () => {
        const place = await insertPlace(database, 5);
        const coat = await asset("ret-coat", "coat");
        const keep = await asset("ret-keep", "header");
        const retired = await asset("ret-item", "header");
        const inRetiredGallery = await asset("ret-gallery", "header");
        await database`INSERT INTO place_media (place_id, media_asset_id, role, origin, retired_at) VALUES (${place.id}, ${coat.id}, 'coat', 'legacy', now())`;
        const galleryId = await bindGallery(place.id, "settlement-gallery:ret", [
            { asset: keep, order: 1 },
            { asset: retired, order: 2 },
        ]);
        await database`UPDATE media_gallery_item SET retired_at = now() WHERE gallery_id = ${galleryId} AND media_asset_id = ${retired.id}`;
        expect((await resolvePlaceMedia(database, place.publicId)).map((view) => view.id)).toEqual([keep.publicId]);

        // Eine zurückgezogene Galeriebindung nimmt alle ihre Einträge mit.
        await database`UPDATE place_media_gallery SET retired_at = now() WHERE place_id = ${place.id}`;
        await bindGallery(place.id, "settlement-gallery:ret-2", [
            { asset: inRetiredGallery, order: 1, override: "blocked" },
        ]);
        expect(await resolvePlaceMedia(database, place.publicId)).toEqual([]);
    });

    it("nichts ohne veröffentlichte Repräsentation der Rolle, ohne technischen Zustand ok oder mit SVG", async () => {
        const place = await insertPlace(database, 6);
        const good = await asset("tech-good", "header");
        const noFile = await asset("tech-nofile", "header", { published: [] });
        // Nur die Variante des Wappens: für das Kopfbild gibt es keine veröffentlichte Datei.
        const wrongVariant = await asset("tech-variant", "header", { published: [{ variant: COAT }] });
        const pending = await asset("tech-pending", "header", { technicalState: "pending" });
        const missing = await asset("tech-missing", "header", { technicalState: "missing_file" });
        const rejected = await asset("tech-rejected", "header", { moderationState: "rejected" });
        const noRights = await asset("tech-norights", "header", { rights: null });
        const unknown = await asset("tech-unknown", "header", {
            rights: { basis: "unknown", clearance: "unreviewed" },
        });
        const model = await asset("tech-model", "header", { mediaKind: "model_3d" });
        await bindGallery(
            place.id,
            "settlement-gallery:tech",
            [good, noFile, wrongVariant, pending, missing, rejected, noRights, unknown, model].map((item, index) => ({
                asset: item,
                order: index + 1,
            })),
        );
        expect((await resolvePlaceMedia(database, place.publicId)).map((view) => view.id)).toEqual([good.publicId]);
    });

    it("🔴 Ortsbilder (legacy_assumed, eigenes Werk): nur mit Regel (own_work, header) öffentlich, `blocked` am Galerieeintrag schlägt sie", async () => {
        const place = await insertPlace(database, 7);
        const assumed = await asset("rule-a", "header", {
            rights: { basis: "own_work", clearance: "legacy_assumed", legacyRightsCode: "ai_generated" },
        });
        const blocked = await asset("rule-b", "header", { rights: { basis: "own_work", clearance: "legacy_assumed" } });
        await bindGallery(place.id, "settlement-gallery:rule", [
            { asset: assumed, order: 1 },
            { asset: blocked, order: 2, override: "blocked" },
        ]);
        // Ohne Regel bleibt legacy_assumed dunkel.
        expect(await resolvePlaceMedia(database, place.publicId)).toEqual([]);

        // Mit der Regel (own_work, header) wird das Ortsbild öffentlich; blocked am Galerieeintrag schlägt sie.
        await insertRule(database, { basis: "own_work", role: "header" });
        const views = await resolvePlaceMedia(database, place.publicId);
        expect(views.map((view) => view.id)).toEqual([assumed.publicId]);
        // Ein automatisch öffentliches Medium trägt keine Nennung; ein per Regel freigegebenes nur, was es hat.
        expect(views[0]).not.toHaveProperty("credit");

        // Eine Regel für eine andere Rolle öffnet das Kopfbild nicht.
        await database`UPDATE publication_rule SET role = 'coat' WHERE scope_text LIKE 'media-test Regel own_work/header'`;
        expect(await resolvePlaceMedia(database, place.publicId)).toEqual([]);
    });

    it("🔴 fan_policy: eine Regel für literature_cover öffnet das Wappen nicht; eine widerrufene Regel wirkt nicht", async () => {
        const place = await insertPlace(database, 8);
        const coat = await asset("fan-coat", "coat", {
            rights: {
                basis: "fan_policy",
                clearance: "legacy_asserted",
                creator: "Ulisses",
                attribution: "Unter den Fan-Regeln",
            },
        });
        await bindCoat(place.id, coat.id);
        expect(await resolvePlaceMedia(database, place.publicId)).toEqual([]);

        await insertRule(database, { basis: "fan_policy", role: "literature_cover" });
        expect(await resolvePlaceMedia(database, place.publicId)).toEqual([]);

        // Eine widerrufene Regel für das Wappen wirkt nicht.
        await database`UPDATE publication_rule SET role = 'coat', revoked_on = '2026-10-05', revoked_reason = 'Test' WHERE scope_text LIKE '%fan_policy/literature_cover'`;
        expect(await resolvePlaceMedia(database, place.publicId)).toEqual([]);

        // Eine gültige Regel für das Wappen öffnet es, samt der Nennung, die das Medium trägt.
        await insertRule(database, { basis: "fan_policy", role: "coat" });
        const views = await resolvePlaceMedia(database, place.publicId);
        expect(views).toHaveLength(1);
        expect(views[0]?.credit).toEqual({ creator: "Ulisses", attribution: "Unter den Fan-Regeln" });

        // Ein `blocked` am Binding schlägt die Regel.
        await database`UPDATE place_media SET publication_override = 'blocked' WHERE place_id = ${place.id}`;
        expect(await resolvePlaceMedia(database, place.publicId)).toEqual([]);
    });

    it("Gebiete: das Wappen nach Rechten, CC BY nur mit Freigabe, Unterdrückung gewinnt", async () => {
        const territory = await insertTerritory(database, 9);
        const coat = await asset("t-coat", "coat");
        await database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${territory.id}, ${coat.id}, 'coat', 'wiki_localized')`;
        const views = await resolveTerritoryMedia(database, territory.publicId);
        expect(views.map((view) => [view.id, view.role])).toEqual([[coat.publicId, "coat"]]);

        // CC BY ohne Freigabe: fehlt.
        const ccBy = await asset("t-cc-by", "coat", { rights: CC_BY_UNGEPRUEFT });
        await database`UPDATE territory_media SET retired_at = now() WHERE territory_id = ${territory.id}`;
        await database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${territory.id}, ${ccBy.id}, 'coat', 'legacy')`;
        expect(await resolveTerritoryMedia(database, territory.publicId)).toEqual([]);
        await database`UPDATE territory_media SET publication_override = 'approved', override_decided_on = '2026-10-04', override_operator_quote = 'Betreiber: ja' WHERE territory_id = ${territory.id} AND retired_at IS NULL`;
        expect((await resolveTerritoryMedia(database, territory.publicId)).map((view) => view.id)).toEqual([
            ccBy.publicId,
        ]);

        // Unterdrückung (leerer Override) gewinnt.
        const suppressed = await inRolledBackTransaction(async (transaction) => {
            await transaction`INSERT INTO territory_media_suppression (territory_id, role, origin, legacy_reason) VALUES (${territory.id}, 'coat', 'legacy', 'empty_override')`;
            return resolveTerritoryMedia(transaction, territory.publicId);
        });
        expect(suppressed).toEqual([]);
    });

    it("EINE Abfrage je Fachobjekt, auch bei vielen Bildern (kein N+1)", async () => {
        const place = await insertPlace(database, 10);
        const coat = await asset("n-coat", "coat");
        await bindCoat(place.id, coat.id);
        const items = [];
        for (let index = 0; index < 8; index += 1) {
            items.push(
                await asset(`n-${String(index)}`, "header", { rights: index % 2 ? CC_BY_UNGEPRUEFT : OWN_CLEARED }),
            );
        }
        await bindGallery(
            place.id,
            "settlement-gallery:n",
            items.map((item, index) => ({ asset: item, order: index + 1 })),
        );

        let calls = 0;
        const counting = Object.assign(tagged(database), {
            unsafe: (...args: Parameters<Database["unsafe"]>) => {
                calls += 1;
                return database.unsafe(...args);
            },
        }) as unknown as Queryable;
        const views = await resolvePlaceMedia(counting, place.publicId);
        expect(views).toHaveLength(1 + 4);
        expect(calls).toBe(1);
        calls = 0;
        await resolveTerritoryMedia(counting, (await insertTerritory(database, 11)).publicId);
        expect(calls).toBe(1);
    });

    /**
     * Die Treppe „Liegt in“ fragt für ihre ganze Kette EINMAL (WI-0094): dieselbe Quelle, dieselbe Entscheidung und
     * dieselbe Variante wie `resolveTerritoryMedia`, nur für viele Gebiete auf einmal.
     */
    describe("Wappen vieler Gebiete auf einmal (WI-0094)", () => {
        it("🔴 EINE Abfrage für die ganze Kette, und nur Gebiete mit erlaubtem Wappen stehen darin", async () => {
            const mitWappen = [await insertTerritory(database, 30), await insertTerritory(database, 31)];
            const ohneWappen = await insertTerritory(database, 32);
            for (const [index, gebiet] of mitWappen.entries()) {
                const coat = await asset(`kette-${String(index)}`, "coat");
                await database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${gebiet.id}, ${coat.id}, 'coat', 'wiki_localized')`;
            }

            let calls = 0;
            const counting = Object.assign(tagged(database), {
                unsafe: (...args: Parameters<Database["unsafe"]>) => {
                    calls += 1;
                    return database.unsafe(...args);
                },
            }) as unknown as Queryable;
            const found = await resolveTerritoryCoats(counting, [
                ...mitWappen.map((gebiet) => gebiet.publicId),
                ohneWappen.publicId,
            ]);
            expect(calls).toBe(1);
            expect([...found.keys()].sort()).toEqual(mitWappen.map((gebiet) => gebiet.publicId).sort());
            // Ohne Wappen gibt es KEINEN Eintrag - kein leerer Wert, aus dem die Oberfläche ein Loch bauen könnte.
            expect(found.has(ohneWappen.publicId)).toBe(false);
            for (const view of found.values()) {
                expect(view.role).toBe("coat");
                expect(Value.Check(MediaPublicView, view)).toBe(true);
            }
        });

        it("dieselbe Entscheidung wie beim einzelnen Gebiet: Unterdrückung und `blocked` nehmen das Wappen weg", async () => {
            const gebiet = await insertTerritory(database, 33);
            const coat = await asset("kette-suppress", "coat");
            await database`INSERT INTO territory_media (territory_id, media_asset_id, role, origin) VALUES (${gebiet.id}, ${coat.id}, 'coat', 'wiki_localized')`;
            expect((await resolveTerritoryCoats(database, [gebiet.publicId])).get(gebiet.publicId)?.id).toBe(
                coat.publicId,
            );

            const unterdrueckt = await inRolledBackTransaction(async (transaction) => {
                await transaction`INSERT INTO territory_media_suppression (territory_id, role, origin, legacy_reason) VALUES (${gebiet.id}, 'coat', 'legacy', 'empty_override')`;
                return resolveTerritoryCoats(transaction, [gebiet.publicId]);
            });
            expect(unterdrueckt).toEqual(new Map());

            await database`UPDATE territory_media SET publication_override = 'blocked' WHERE territory_id = ${gebiet.id}`;
            expect(await resolveTerritoryCoats(database, [gebiet.publicId])).toEqual(new Map());
        });

        it("eine leere Liste fragt gar nicht; eine Kennung ohne UUID-Form ist kein Fehler", async () => {
            let calls = 0;
            const counting = Object.assign(tagged(database), {
                unsafe: (...args: Parameters<Database["unsafe"]>) => {
                    calls += 1;
                    return database.unsafe(...args);
                },
            }) as unknown as Queryable;
            expect(await resolveTerritoryCoats(counting, [])).toEqual(new Map());
            expect(await resolveTerritoryCoats(counting, ["kein-uuid"])).toEqual(new Map());
            expect(calls).toBe(0);
        });
    });

    it("ein unbekannter Ort, ein Gebiet ohne Medien oder eine Kennung ohne UUID-Form ergeben eine leere Liste", async () => {
        expect(await resolvePlaceMedia(database, "6d656469-0000-4000-8000-0000000fffff")).toEqual([]);
        expect(await resolvePlaceMedia(database, "kein-uuid")).toEqual([]);
        expect(await resolveTerritoryMedia(database, "6d656469-0000-4000-8000-0000000ffffe")).toEqual([]);
        const territory = await insertTerritory(database, 12);
        expect(await resolveTerritoryMedia(database, territory.publicId)).toEqual([]);
    });

    describe("Katalogträger: Umschläge und Vorschauen (MEDIA-M14)", () => {
        /** Ein Asset der Katalogrollen: fan_policy wie im echten Satz, veröffentlichte Datei der Rollenvariante. */
        const catalogAsset = (ref: string, role: "literature_cover" | "map_preview"): Promise<FixtureAsset> =>
            insertAsset(database, {
                ref,
                rights: { basis: "fan_policy", clearance: "legacy_asserted" },
                published: [{ variant: PUBLISHED_VARIANT[role] }],
            });

        it("🔴 die Regel entscheidet: ohne Regel kein Umschlag, mit Regel genau einer je Werk", async () => {
            const werk = await insertAdventure(database, 20);
            const cover = await catalogAsset("cover-20", "literature_cover");
            await database`INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin) VALUES (${werk.id}, ${cover.id}, 'literature_cover', 'legacy')`;
            expect(await resolveLiteratureCovers(database, [werk.publicId])).toEqual(new Map());
            await insertRule(database, { basis: "fan_policy", role: "literature_cover" });
            const found = await resolveLiteratureCovers(database, [werk.publicId]);
            expect(found.get(werk.publicId)).toMatchObject({ role: "literature_cover", mimeType: "image/webp" });
            expect(Value.Check(MediaPublicView, found.get(werk.publicId))).toBe(true);
        });

        it("🔴 eine Regel für `literature_cover` öffnet keine Kartenvorschau - die Rolle gehört zur Entscheidung", async () => {
            await insertRule(database, { basis: "fan_policy", role: "literature_cover" });
            const karte = await insertCitymap(database, 21);
            const preview = await catalogAsset("preview-21", "map_preview");
            await database`INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin) VALUES (${karte.id}, ${preview.id}, 'map_preview', 'legacy')`;
            expect(await resolveCitymapPreviews(database, [karte.publicId])).toEqual(new Map());
            await insertRule(database, { basis: "fan_policy", role: "map_preview" });
            expect((await resolveCitymapPreviews(database, [karte.publicId])).get(karte.publicId)?.role).toBe(
                "map_preview",
            );
        });

        it("eine zurückgezogene Bindung, ein `blocked` und eine Bindung ohne Datei liefern nichts", async () => {
            await insertRule(database, { basis: "fan_policy", role: "literature_cover" });
            const [zurueck, gesperrt, ohneDatei] = [
                await insertAdventure(database, 22),
                await insertAdventure(database, 23),
                await insertAdventure(database, 24),
            ];
            const a = await catalogAsset("cover-22", "literature_cover");
            const b = await catalogAsset("cover-23", "literature_cover");
            const c = await insertAsset(database, {
                ref: "cover-24",
                rights: { basis: "fan_policy", clearance: "legacy_asserted" },
                published: [],
            });
            await database`INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin, retired_at) VALUES (${zurueck.id}, ${a.id}, 'literature_cover', 'legacy', now())`;
            await database`INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin, publication_override) VALUES (${gesperrt.id}, ${b.id}, 'literature_cover', 'legacy', 'blocked')`;
            await database`INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin) VALUES (${ohneDatei.id}, ${c.id}, 'literature_cover', 'legacy')`;
            const found = await resolveLiteratureCovers(database, [
                zurueck.publicId,
                gesperrt.publicId,
                ohneDatei.publicId,
            ]);
            expect(found).toEqual(new Map());
        });

        it("🔴 EINE Abfrage für viele Träger (kein N+1); eine leere Liste fragt gar nicht", async () => {
            await insertRule(database, { basis: "fan_policy", role: "literature_cover" });
            const werke = [];
            for (let index = 0; index < 6; index += 1) {
                const werk = await insertAdventure(database, 30 + index);
                const cover = await catalogAsset(`cover-${String(30 + index)}`, "literature_cover");
                await database`INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin) VALUES (${werk.id}, ${cover.id}, 'literature_cover', 'legacy')`;
                werke.push(werk.publicId);
            }
            let calls = 0;
            const counting = Object.assign(tagged(database), {
                unsafe: (...args: Parameters<Database["unsafe"]>) => {
                    calls += 1;
                    return database.unsafe(...args);
                },
            }) as unknown as Queryable;
            const found = await resolveLiteratureCovers(counting, werke);
            expect(found.size).toBe(6);
            expect(calls).toBe(1);
            calls = 0;
            expect(await resolveLiteratureCovers(counting, [])).toEqual(new Map());
            // Eine Kennung ohne UUID-Form kennt die Datenbank nicht; sie ist kein Fehler, nur ohne Medien.
            expect(await resolveCitymapPreviews(counting, ["kein-uuid"])).toEqual(new Map());
            expect(calls).toBe(0);
        });
    });

    describe("Kartenvollbild: die dritte Katalogrolle (MEDIA-M11)", () => {
        /**
         * Wie die EINE Vollkarte im Bestand (Rhôndur): ein eigener Upload mit Legacys `permission_granted`, und das ist
         * bei `citymap_full` nie die Fan-Richtlinie, sondern eine Einzelgenehmigung (`mapRights`). Also `permission` -
         * die Rechtslage, für die es heute keine Freigaberegel gibt.
         */
        const vollbild = (ref: string, variant: string = PUBLISHED_VARIANT.map_full): Promise<FixtureAsset> =>
            insertAsset(database, {
                ref,
                rights: { basis: "permission", clearance: "legacy_asserted", legacyRightsCode: "permission_granted" },
                published: [{ variant }],
            });

        const bindFull = (citymapId: string, assetId: string, extra = ""): Promise<unknown> =>
            database.unsafe(
                `INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin${extra ? ", publication_override" : ""})
                 VALUES ($1, $2, 'map_full', 'legacy'${extra ? `, '${extra}'` : ""})`,
                [citymapId, assetId],
            );

        it("🔴 der Befund aus MEDIA-M11: ohne Regel liefert der Lesepfad LEER, mit Regel (permission, map_full) genau ein Vollbild", async () => {
            const karte = await insertCitymap(database, 40);
            const full = await vollbild("full-40");
            await bindFull(karte.id, full.id);

            // So soll er sich heute verhalten: er fragt richtig und bekommt nichts, weil keine Freigabe greift.
            expect(await resolveCitymapFulls(database, [karte.publicId])).toEqual(new Map());

            // Und so, sobald der Betreiber die Regel setzt - ohne eine Zeile Code.
            await insertRule(database, { basis: "permission", role: "map_full" });
            const found = await resolveCitymapFulls(database, [karte.publicId]);
            expect(found.get(karte.publicId)).toMatchObject({
                id: full.publicId,
                role: "map_full",
                mimeType: "image/webp",
            });
            // Die öffentliche Sicht und nichts darüber: sechs Felder, keine Nennung ohne Urheber am Medium.
            expect(Object.keys(found.get(karte.publicId) ?? {}).sort()).toEqual([
                "height",
                "id",
                "mimeType",
                "role",
                "url",
                "width",
            ]);
            expect(
                Value.Check(MediaPublicView, found.get(karte.publicId)),
                JSON.stringify([...Value.Errors(MediaPublicView, found.get(karte.publicId))][0]),
            ).toBe(true);

            // Eine widerrufene Regel wirkt nicht - der Rückweg ist ein Befehl, keine Codeänderung.
            await database`UPDATE publication_rule SET revoked_on = '2026-10-06', revoked_reason = 'Test' WHERE scope_text LIKE '%permission/map_full'`;
            expect(await resolveCitymapFulls(database, [karte.publicId])).toEqual(new Map());
        });

        it("🔴 Vollbild und Vorschau sind zwei Entscheidungen: eine Regel für die eine Rolle öffnet die andere nicht", async () => {
            const karte = await insertCitymap(database, 41);
            const full = await vollbild("full-41");
            const preview = await insertAsset(database, {
                ref: "preview-41",
                rights: { basis: "permission", clearance: "legacy_asserted" },
                published: [{ variant: PUBLISHED_VARIANT.map_preview }],
            });
            await bindFull(karte.id, full.id);
            await database`INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin) VALUES (${karte.id}, ${preview.id}, 'map_preview', 'legacy')`;

            // Die Regel der Vorschau hebt das Vollbild nicht (ruleCovers vergleicht die Rolle).
            await insertRule(database, { basis: "permission", role: "map_preview" });
            expect(await resolveCitymapFulls(database, [karte.publicId])).toEqual(new Map());
            expect((await resolveCitymapPreviews(database, [karte.publicId])).get(karte.publicId)?.role).toBe(
                "map_preview",
            );

            // Umgekehrt ebenso: die Regel des Vollbilds lässt die Vorschau unberührt, und jede Rolle liefert ihre eigene Datei.
            await insertRule(database, { basis: "permission", role: "map_full" });
            expect((await resolveCitymapFulls(database, [karte.publicId])).get(karte.publicId)?.id).toBe(full.publicId);
            expect((await resolveCitymapPreviews(database, [karte.publicId])).get(karte.publicId)?.id).toBe(
                preview.publicId,
            );
        });

        it("die veröffentlichte Variante gehört zur Rolle: eine Datei der Vorschau-Variante trägt kein Vollbild", async () => {
            await insertRule(database, { basis: "permission", role: "map_full" });
            const karte = await insertCitymap(database, 42);
            // Dasselbe Asset, dieselbe Bindung - nur die veröffentlichte Datei heißt nicht `citymap_full`.
            const falsch = await vollbild("full-42", PUBLISHED_VARIANT.map_preview);
            await bindFull(karte.id, falsch.id);
            expect(await resolveCitymapFulls(database, [karte.publicId])).toEqual(new Map());
        });

        it("zurückgezogen, `blocked` und ohne Datei liefern nichts, auch mit Regel", async () => {
            await insertRule(database, { basis: "permission", role: "map_full" });
            const [zurueck, gesperrt, ohneDatei] = [
                await insertCitymap(database, 43),
                await insertCitymap(database, 44),
                await insertCitymap(database, 45),
            ];
            const a = await vollbild("full-43");
            const b = await vollbild("full-44");
            const c = await insertAsset(database, {
                ref: "full-45",
                rights: { basis: "permission", clearance: "legacy_asserted" },
                published: [],
            });
            await database`INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin, retired_at) VALUES (${zurueck.id}, ${a.id}, 'map_full', 'legacy', now())`;
            await bindFull(gesperrt.id, b.id, "blocked");
            await bindFull(ohneDatei.id, c.id);
            expect(
                await resolveCitymapFulls(database, [zurueck.publicId, gesperrt.publicId, ohneDatei.publicId]),
            ).toEqual(new Map());
        });

        it("🔴 mehrere Versionen (WI-0287 Stufe 2, Migration 0321): das Vollbild ist die erste in ihrer Reihenfolge, die öffentlich sein darf", async () => {
            await insertRule(database, { basis: "permission", role: "map_full" });
            const karte = await insertCitymap(database, 46);
            const [hinten, vorn, mitte] = [
                await vollbild("full-46a"),
                await vollbild("full-46b"),
                await vollbild("full-46c"),
            ];
            // Gebunden in der Folge hinten, vorn, mitte; die Positionen ordnen vorn, mitte, hinten. Die vordere ist einzeln gesperrt.
            const binde = (assetId: string, position: number, override = "none"): Promise<unknown> =>
                database`
                    INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin, version_position, publication_override)
                    VALUES (${karte.id}::bigint, ${assetId}::bigint, 'map_full', 'editor', ${position}, ${override})
                `;
            await binde(hinten.id, 2);
            await binde(vorn.id, 0, "blocked");
            await binde(mitte.id, 1);
            expect((await resolveCitymapFulls(database, [karte.publicId])).get(karte.publicId)?.id).toBe(
                mitte.publicId,
            );
            await database`UPDATE citymap_media SET publication_override = 'none' WHERE media_asset_id = ${vorn.id}::bigint`;
            expect((await resolveCitymapFulls(database, [karte.publicId])).get(karte.publicId)?.id).toBe(vorn.publicId);
        });

        it("🔴 Besucher (WI-0287 Stufe 2): `fulls` nennt jede Version mit Bezeichnung, ihr Vollbild nur, wo die Policy es für sie erlaubt; `full` bleibt die erste öffentliche", async () => {
            await insertRule(database, { basis: "permission", role: "map_full" });
            const ort = await insertPlace(database, 47);
            const karte = await insertCitymap(database, 47);
            const [spieler, meister] = [await vollbild("full-47a"), await vollbild("full-47b")];
            await database`
                INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin, version_label, version_position, publication_override)
                VALUES (${karte.id}::bigint, ${spieler.id}::bigint, 'map_full', 'editor', 'Spielerversion', 0, 'blocked'),
                       (${karte.id}::bigint, ${meister.id}::bigint, 'map_full', 'editor', NULL, 1, 'none')
            `;
            await database`
                INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, dup_ordinal, raw_name, target_state, resolved_by,
                                           place_id, target_origin, legacy_origin, source_system)
                VALUES (${karte.id}::bigint, 0, 0, 'medienort 47', 0, 'Medienort 47', 'resolved', 'public_id', ${ort.id}::bigint, 'editor',
                        'manual', 'avesmaps3d')
            `;
            try {
                // Die Spielerversion ist einzeln gesperrt: Sie steht da, mit Bezeichnung, aber ohne Bild (das Fenster zeigt die Vorschau).
                expect((await resolveCitymapVersions(database, [karte.publicId])).get(karte.publicId)).toEqual([
                    { label: "Spielerversion" },
                    { view: expect.objectContaining({ id: meister.publicId, role: "map_full" }) },
                ]);
                const [eintrag] = await listCitymaps(database, "place", [ort.publicId]);
                expect(eintrag?.fulls).toEqual([
                    { label: "Spielerversion" },
                    { view: expect.objectContaining({ id: meister.publicId }) },
                ]);
                expect(eintrag?.full?.id).toBe(meister.publicId);
                expect(
                    Value.Check(CitymapEntry, eintrag),
                    JSON.stringify([...Value.Errors(CitymapEntry, eintrag)][0]),
                ).toBe(true);

                // Freigegeben, rückt die erste Version auch in `full`; eine Karte ohne Version hat kein `fulls`.
                await database`UPDATE citymap_media SET publication_override = 'none' WHERE media_asset_id = ${spieler.id}::bigint`;
                const [danach] = await listCitymaps(database, "place", [ort.publicId]);
                expect(danach?.full?.id).toBe(spieler.publicId);
                expect(danach?.fulls?.map((version) => version.view?.id)).toEqual([spieler.publicId, meister.publicId]);
                await database`UPDATE citymap_media SET retired_at = now() WHERE citymap_id = ${karte.id}::bigint`;
                const [ohne] = await listCitymaps(database, "place", [ort.publicId]);
                expect(ohne).not.toHaveProperty("fulls");
                expect(ohne).not.toHaveProperty("full");
            } finally {
                await database`DELETE FROM citymap_place WHERE citymap_id = ${karte.id}::bigint`;
            }
        });

        it("🔴 EINE Abfrage für alle Karten (kein N+1); eine leere Liste fragt gar nicht", async () => {
            await insertRule(database, { basis: "permission", role: "map_full" });
            const karten = [];
            for (let index = 0; index < 5; index += 1) {
                const karte = await insertCitymap(database, 50 + index);
                const full = await vollbild(`full-${String(50 + index)}`);
                await bindFull(karte.id, full.id);
                karten.push(karte.publicId);
            }
            let calls = 0;
            const counting = Object.assign(tagged(database), {
                unsafe: (...args: Parameters<Database["unsafe"]>) => {
                    calls += 1;
                    return database.unsafe(...args);
                },
            }) as unknown as Queryable;
            expect((await resolveCitymapFulls(counting, karten)).size).toBe(5);
            expect(calls).toBe(1);
            calls = 0;
            expect(await resolveCitymapFulls(counting, [])).toEqual(new Map());
            expect(await resolveCitymapFulls(counting, ["kein-uuid"])).toEqual(new Map());
            expect(calls).toBe(0);
            // Eine unbekannte Karte ist kein Fehler, nur ohne Bild.
            expect(await resolveCitymapFulls(database, ["6d656469-0000-4000-8000-0000000ffffd"])).toEqual(new Map());
        });
    });

    it("die Adresse ist inhaltsversioniert: ein neues Rezept ergibt eine neue Adresse, kein ?v=", async () => {
        const place = await insertPlace(database, 13);
        const coat = await asset("url-coat", "coat");
        await bindCoat(place.id, coat.id);
        const [first] = await resolvePlaceMedia(database, place.publicId);
        const hash = sha("url-coat/coat");
        expect(first?.url).toBe(`/media/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.webp`);
        expect(first?.url).not.toContain("?");
        expect(first).toMatchObject({ width: 64, height: 48, mimeType: "image/webp" });
    });
});
