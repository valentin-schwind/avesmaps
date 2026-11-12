import { expect, test, type Route } from "@playwright/test";
import {
    MAM_BASKETS,
    MEDIA_ASSET_TYPES,
    type MamNavigation,
    type MamSearchResult,
    type MediaAssetDetail,
    type MediaUsageResult,
} from "@avesmaps3d/shared";
import { MIT_MEDIEN, stubSitzung } from "./medien-quelle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";

/**
 * „Darin aufgegangen“ und „↺ Aufheben“ im Inspector (WI-0068 D1, Paket „was beim Bedienen nicht geht“): Die Route gab es, den Knopf
 * nicht. Ein aufgegangenes Werk steht in keiner Liste; erreichbar ist es über das bleibende. Die Antworten des Servers sind vorgegeben;
 * was der Server tut, prüft `media-merge.test.ts`.
 */

const ASSET = "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69";
const LAUF = "efe85e4c-1111-4222-8333-444455556666";
const SHA = "a".repeat(64);
const AM = "2026-10-05T10:00:00.000Z";
const WEG = "7e570000-0000-4000-8000-0000000000d1";

function detail(): MediaAssetDetail {
    return {
        asset: {
            id: ASSET,
            revision: 3,
            title: null,
            kind: "image",
            assetType: "coat",
            origin: "legacy_import",
            creationMethod: "ai_generated",
            technicalState: "ok",
            moderationState: "not_applicable",
            degradedOriginal: false,
            sourceSystem: "avesmaps-legacy",
            sourceRef: "settlement_coat:42",
            createdAt: AM,
            updatedAt: AM,
            importedAt: AM,
        },
        rights: {
            revision: 1,
            basis: "own_work",
            licenseKey: null,
            licenseFamily: null,
            licenseName: null,
            licenseUri: null,
            requiresAttribution: false,
            creator: null,
            rightsHolder: null,
            attribution: null,
            clearance: "legacy_assumed",
            reviewedAt: null,
            updatedAt: AM,
            rightsNote: "nur intern",
            legacyRightsCode: "own_work",
            reviewedBy: null,
            reviewer: null,
        },
        creation: {
            revision: 1,
            updatedAt: AM,
            tool: null,
            model: "SDXL",
            prompt: "ein Fuchs auf Gold",
            negativePrompt: null,
            parameters: null,
            legacyNoteRaw: null,
        },
        ingest: [
            {
                kind: "legacy_import",
                migrationRunId: LAUF,
                sourceSystem: "avesmaps-legacy",
                sourceRef: "uploads/wappen/own/3946d663a420.png",
                ingestedAt: AM,
                actor: null,
                legacyActorLabel: null,
                legacyUploadedAt: null,
                legacyStampSemantics: null,
                submissionId: null,
                originalFilename: null,
            },
        ],
        legacySource: {
            mediaClass: "settlement_coat_own",
            legacyOrigin: "own",
            legacySource: null,
            legacyForm: null,
            legacyPublic: true,
            legacyShown: true,
            mediaRevision: null,
            fileFetchedAt: null,
            localUrl: "/uploads/wappen/own/3946d663a420.png",
            storedUrl: null,
            sourceUrl: "https://de.wiki-aventurica.de/wiki/Gareth",
        },
        representations: [
            {
                variant: "source",
                storageClass: "private_source",
                mimeType: "image/png",
                width: 128,
                height: 128,
                byteSize: 20_480,
                sha256: SHA,
                recipe: null,
                recipeVersion: null,
                createdAt: AM,
                url: null,
                storageKey: "private/source/aa/aa/aaaa.png",
            },
            {
                variant: "coat",
                storageClass: "published",
                mimeType: "image/webp",
                width: 128,
                height: 128,
                byteSize: 8_000,
                sha256: "b".repeat(64),
                recipe: "coat",
                recipeVersion: "1",
                createdAt: AM,
                url: `/media/sha256/bb/bb/${"b".repeat(64)}.webp`,
                storageKey: "published/bb/bb/bbbb.webp",
            },
        ],
        suspensions: [],
        mergedHere: [],
        usageCount: 1,
        retiredUsageCount: 0,
        sharedFileCount: 0,
        history: [],
        evidence: [],
    };
}

const navigation = (): MamNavigation => ({
    total: 1,
    kinds: { image: 1, model_3d: 0 },
    types: Object.fromEntries(MEDIA_ASSET_TYPES.map((typ) => [typ, 0])) as MamNavigation["types"],
    galleries: 0,
    citymaps: 0,
    photoboxGalerien: 0,
    typeImages: 0,
    baskets: Object.fromEntries(MAM_BASKETS.map((korb) => [korb, 0])) as MamNavigation["baskets"],
});
const leereListe = (): MamSearchResult => ({ items: [], total: 0, limit: 100, offset: 0 });
const verwendung = (): MediaUsageResult => ({
    asset: { id: ASSET, revision: 3 },
    usages: [],
    retired: 0,
    sameFile: [],
});

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
    });

test("🔴 das bleibende Werk nennt das aufgegangene; ↺ Aufheben fragt erst, dann EINE Operation mit der Kennung des aufgegangenen", async ({
    page,
}) => {
    let aufgehoben = false;
    const gesendet: { url: string; body: unknown }[] = [];
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media"]);
    await editorPanelGemerktZu(page);
    await page.route("**/api/editor/**", async (route) => {
        const pfad = new URL(route.request().url()).pathname;
        if (route.request().method() === "POST") {
            gesendet.push({ url: pfad, body: route.request().postDataJSON() as unknown });
            aufgehoben = true;
            return json(route, 200, {
                operationId: (route.request().postDataJSON() as { operationId: string }).operationId,
                status: "applied",
                environment: "development",
                affected: [{ kind: "media_asset", id: WEG, revision: 1 }],
                derivedWork: [],
                warnings: [],
            });
        }
        if (pfad === "/api/editor/media/navigation") return json(route, 200, navigation());
        if (pfad === "/api/editor/media") return json(route, 200, leereListe());
        if (pfad === `/api/editor/media/${ASSET}/usage`) return json(route, 200, verwendung());
        if (pfad === `/api/editor/media/${ASSET}`) {
            const d = detail();
            d.mergedHere = aufgehoben
                ? []
                : [
                      {
                          assetId: WEG,
                          title: "Wappen von Gareth (2)",
                          mergedAt: "2026-10-17T12:00:00.000Z",
                          mergedBy: { id: "1b2c3d4e-0000-4000-8000-000000000001", displayName: "Thalionmel" },
                      },
                  ];
            return json(route, 200, d);
        }
        return json(route, 404, { error: { code: "not_found", message: "Diese Adresse gibt es nicht." } });
    });
    await page.goto(`/edit?medien=${ASSET}`);
    const kasten = page.getByTestId("medien-aufgegangen");
    await expect(kasten).toBeVisible({ timeout: 60_000 });
    await expect(kasten).toContainText("Wappen von Gareth (2)");
    await expect(kasten).toContainText("von Thalionmel");

    await page.getByTestId(`medien-aufgegangen-aufheben-${WEG}`).click();
    const frage = page.getByTestId(`medien-aufgegangen-frage-${WEG}`);
    await expect(frage).toContainText("Zusammenführung mit „Wappen von Gareth (2)“ aufheben?");
    expect(gesendet, "erst fragen").toEqual([]);
    await frage.getByRole("button", { name: "Aufheben" }).click();

    await expect(kasten, "danach nennt das Werk nichts mehr").toBeHidden({ timeout: 20_000 });
    expect(gesendet).toEqual([
        { url: `/api/editor/media/${WEG}/merge/lift`, body: { operationId: expect.any(String) as unknown as string } },
    ]);
});
