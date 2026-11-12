import { expect, test, type Page, type Route } from "@playwright/test";
import { ME, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * Bezeichnung und eigene Sonderrollen im Fenster „Konto“ (WI-0279 E9b, E10). Sitzung aus `verwaltung-stub.ts`, das Konto aus einem kleinen Stub
 * hier; Rechte und Protokoll prüft `apps/server/test/sonderrollen-durchsetzung.test.ts`.
 */
const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function kontoStub(page: Page, role: string, sonderrollen: readonly object[]): Promise<AdminCall[]> {
    const calls: AdminCall[] = [];
    let bezeichnung: string | null = null;
    await page.route("**/api/account", (route) =>
        json(route, 200, {
            person: {
                id: ME.id,
                displayName: ME.displayName,
                status: "active",
                revision: 3,
                role,
                bezeichnung,
                sonderrollen,
                access: "active",
                accessRevision: 1,
                methods: ["discord"],
                passwordDisabled: false,
                passkeyCount: 0,
                activeSessions: 1,
                grants: [],
                createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
                lastLoginAt: new Date(Date.now() - 60_000).toISOString(),
                lastSeenAt: null,
                invitedBy: null,
                lockReason: null,
                lockedAt: null,
                lockedBy: null,
                responsibleFor: null,
                self: true,
                manageable: false,
            },
            loginName: null,
            discord: null,
            passkeys: [],
            sessions: [],
            specialCapabilities: [],
            legacy: [],
        }),
    );
    await page.route("**/api/account/*", (route) => {
        const request = route.request();
        const body = request.postDataJSON() as Record<string, unknown>;
        calls.push({
            method: request.method(),
            path: new URL(request.url()).pathname,
            query: new URLSearchParams(),
            body,
        });
        if (typeof body["bezeichnung"] === "string") bezeichnung = body["bezeichnung"];
        return json(route, 200, { status: "applied" });
    });
    return calls;
}

async function oeffneKonto(page: Page): Promise<void> {
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-konto").click();
    await expect(page.getByTestId("konto-bezeichnung")).toBeVisible();
}

test("🔴 die Bezeichnung zeigt die eigene Wortform, gilt mit dem Klick und steht ohne Wahl neutral", async ({
    page,
}) => {
    await stubAdmin(page, {});
    const calls = await kontoStub(page, "editor", []);
    await oeffneKonto(page);
    const knoepfe = page.getByTestId("konto-bezeichnung").getByRole("button");
    await expect(knoepfe).toHaveText(["Editor", "Editorin", "Editor:in"]);
    await expect(knoepfe.nth(2)).toHaveAttribute("aria-pressed", "true");
    await knoepfe.nth(1).click();
    await expect(knoepfe.nth(1)).toHaveAttribute("aria-pressed", "true");
    const gesendet = calls.filter((call) => call.path === "/api/account/bezeichnung");
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]?.body).toMatchObject({ bezeichnung: "feminin" });
    // Ohne Sonderrolle gibt es die Karte nicht.
    await expect(page.getByTestId("konto-sonderrollen")).toHaveCount(0);
});

test("🔴 das Konto nennt die eigenen Sonderrollen zum Lesen, die Regionen zusammen", async ({ page }) => {
    await stubAdmin(page, {});
    await kontoStub(page, "admin", [
        { sonderrolle: "kurator", region: null },
        { sonderrolle: "ortskundiger", region: "Greifenfurt" },
        { sonderrolle: "ortskundiger", region: "Weiden" },
    ]);
    await oeffneKonto(page);
    const karte = page.getByTestId("konto-sonderrollen");
    await expect(karte).toContainText("Ortskundige:r (Greifenfurt, Weiden)");
    await expect(karte).toContainText("Kurator:in");
    await expect(karte.getByRole("button")).toHaveCount(0);
    // „Admin“ hat nur eine Form: Die Knöpfe zeigen die erste eigene Rolle mit dreien.
    await expect(page.getByTestId("konto-bezeichnung").getByRole("button")).toHaveText([
        "Kurator",
        "Kuratorin",
        "Kurator:in",
    ]);
});

// Betreiber 2026-11-03 („das ist etwas doof abgeschnitten“): „Betreiberin“ passte nicht in ein Drittel der Zeile.
for (const [rolle, sonderrollen, wort] of [
    ["operator", [], "Betreiber:in"],
    ["admin", [{ sonderrolle: "social_media_manager", region: null }], "Social-Media-Manager:in"],
] as const) {
    test(`🔴 die Bezeichnung schneidet kein Wort ab: ${wort}`, async ({ page }) => {
        await stubAdmin(page, {});
        await kontoStub(page, rolle, sonderrollen);
        await oeffneKonto(page);
        const knoepfe = page.getByTestId("konto-bezeichnung").getByRole("button");
        await expect(knoepfe.nth(2)).toHaveText(wort);
        await expect
            .poll(() =>
                knoepfe.evaluateAll((alle) =>
                    alle.map((knopf) => {
                        const span = knopf.querySelector(".einzeilig") as HTMLElement;
                        return span.scrollWidth <= span.clientWidth;
                    }),
                ),
            )
            .toEqual([true, true, true]);
    });
}
