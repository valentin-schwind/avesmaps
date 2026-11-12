import { expect, test, type Route } from "@playwright/test";
import {
    MAM_BASKETS,
    MEDIA_ASSET_TYPES,
    type MamGalleryList,
    type MamNavigation,
    type MediaGalleryDetail,
} from "@avesmaps3d/shared";
import { MIT_MEDIEN, REVIEWER, stubSitzung } from "./medien-quelle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";

/**
 * „✕ Galerie entfernen“ im Galerie-Inspector (WI-0068 R3, Paket „was beim Bedienen nicht geht“): Eine Galerie ließ sich anlegen, aber
 * nicht entfernen. Nur eine eigene ohne Ort; sonst steht der Knopf gesperrt mit Grund. Die Antworten des Servers sind vorgegeben; was
 * der Server prüft, zeigt `media-galerie-schreibpfad.test.ts`.
 */

const GALERIE = "7e570000-0000-4000-8000-0000000000e1";
const AM = "2026-10-19T08:00:00.000Z";

const navigation = (): MamNavigation => ({
    total: 0,
    kinds: { image: 0, model_3d: 0 },
    types: Object.fromEntries(MEDIA_ASSET_TYPES.map((typ) => [typ, 0])) as MamNavigation["types"],
    galleries: 1,
    citymaps: 0,
    photoboxGalerien: 0,
    typeImages: 0,
    baskets: Object.fromEntries(MAM_BASKETS.map((korb) => [korb, 0])) as MamNavigation["baskets"],
});

function galerie(teil: Partial<MediaGalleryDetail> = {}): MediaGalleryDetail {
    return {
        id: GALERIE,
        revision: 4,
        kind: "object_gallery",
        title: "Entwurf Hafen",
        origin: "editor",
        publicationState: "published",
        coverAssetId: null,
        createdAt: AM,
        updatedAt: AM,
        fromLegacy: false,
        createdBy: { id: REVIEWER.id, displayName: REVIEWER.displayName },
        items: [],
        bindings: [],
        ...teil,
    };
}

const liste = (da: boolean): MamGalleryList => ({
    items: da
        ? [
              {
                  id: GALERIE,
                  revision: 4,
                  title: "Entwurf Hafen",
                  kind: "object_gallery",
                  origin: "editor",
                  publicationState: "published",
                  items: 0,
                  places: [],
                  draft: true,
                  previews: [],
              } as unknown as MamGalleryList["items"][number],
          ]
        : [],
    total: da ? 1 : 0,
});

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
    });

async function oeffne(
    page: import("@playwright/test").Page,
    detail: MediaGalleryDetail,
): Promise<{ gesendet: { url: string; body: unknown }[] }> {
    let entfernt = false;
    const gesendet: { url: string; body: unknown }[] = [];
    await stubSitzung(page, [...MIT_MEDIEN, "upload_media"]);
    await editorPanelGemerktZu(page);
    await page.route("**/api/editor/**", async (route) => {
        const pfad = new URL(route.request().url()).pathname;
        if (route.request().method() === "POST") {
            const body = route.request().postDataJSON() as { operationId: string };
            gesendet.push({ url: pfad, body });
            entfernt = true;
            return json(route, 200, {
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [{ kind: "gallery", id: GALERIE }],
                derivedWork: [],
                warnings: [],
            });
        }
        if (pfad === "/api/editor/media/navigation") return json(route, 200, navigation());
        if (pfad === "/api/editor/galleries") return json(route, 200, liste(!entfernt));
        if (pfad === `/api/editor/galleries/${GALERIE}`) {
            return entfernt
                ? json(route, 404, { error: { code: "not_found", message: "Diese Galerie gibt es nicht." } })
                : json(route, 200, detail);
        }
        return json(route, 404, { error: { code: "not_found", message: "Diese Adresse gibt es nicht." } });
    });
    await page.goto(`/edit?medien&medien-objekt=galerien&medien-galerie=${GALERIE}`);
    await expect(page.getByTestId("medien-galerie-entfernen-ganz")).toBeVisible({ timeout: 60_000 });
    return { gesendet };
}

test("🔴 eine eigene Galerie ohne Ort: ✕ Galerie entfernen fragt erst, dann EINE Operation; danach ist keine gewählt", async ({
    page,
}) => {
    const { gesendet } = await oeffne(page, galerie());
    await page.getByTestId("medien-galerie-entfernen-ganz").click();
    const frage = page.getByTestId("medien-galerie-entfernen-frage");
    await expect(frage).toContainText("Galerie „Entwurf Hafen“ entfernen?");
    await expect(frage).toContainText("Die Bilder bleiben in der Medienverwaltung");
    expect(gesendet, "erst fragen").toEqual([]);
    await frage.getByRole("button", { name: "Entfernen" }).click();

    await expect(page.getByTestId("medien-galerie-entfernen-ganz")).toBeHidden({ timeout: 20_000 });
    expect(gesendet).toEqual([
        {
            url: "/api/editor/media/galleries/delete",
            body: { operationId: expect.any(String) as unknown as string, galleryId: GALERIE, baseRevision: 4 },
        },
    ]);
});

test("an einem Ort, aus Legacy oder fremd: der Knopf steht gesperrt und nennt den Grund", async ({ page }) => {
    await oeffne(
        page,
        galerie({
            bindings: [
                {
                    subject: {
                        kind: "place",
                        id: "7e570000-0000-4000-8000-0000000000e2",
                        name: "Gareth",
                        active: true,
                    },
                    role: "header",
                    origin: "editor",
                    retired: false,
                    revision: 1,
                },
            ],
        }),
    );
    const knopf = page.getByTestId("medien-galerie-entfernen-ganz");
    await expect(knopf).toBeDisabled();
    await expect(page.locator(".galerie__entfernen")).toContainText("Erst von allen Orten lösen.");
});
