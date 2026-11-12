import { expect, test, type Page, type Route } from "@playwright/test";
import { ADMIN_CAPABILITIES, ME, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * „Verantwortlich für:“ im Browser (WI-0133, Betreiber 2026-10-10): in der Personenansicht der Kontenverwaltung (kurz im Kopf, in
 * „Zugang“ unter „Eingeladen von“) und im Fenster „Konto“. Sitzung und Verwaltungs-API aus `verwaltung-stub.ts`, das eigene Konto
 * aus einem kleinen Stub hier; geprüft wird, was die Fenster zeigen und schicken. Rechte und Protokoll prüft der Server
 * (`apps/server/test/auth-responsibility.test.ts`).
 */
const PRAIODAN = "a1b2c3d4-0000-4000-8000-000000000005";
const OPERATOR_CAPABILITIES = [
    ...ADMIN_CAPABILITIES,
    "assign_admin",
    "grant_special_capabilities",
    "set_responsibility",
];

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Zwei Personen, wie der Server sie zeigt: Praiodan mit Eintrag, die angemeldete Person ohne. */
function people(text: string | null, operator: boolean) {
    const person = (id: string, displayName: string, extra: Record<string, unknown>) => ({
        id,
        displayName,
        status: "active",
        revision: 1,
        role: "editor",
        access: "active",
        accessRevision: 1,
        methods: ["discord"],
        passwordDisabled: false,
        passkeyCount: 0,
        activeSessions: 0,
        grants: [],
        createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
        lastLoginAt: new Date(Date.now() - 3_600_000).toISOString(),
        lastSeenAt: null,
        invitedBy: { id: ME.id, displayName: ME.displayName },
        lockReason: null,
        lockedAt: null,
        lockedBy: null,
        responsibleFor: null,
        self: false,
        manageable: true,
        ...extra,
    });
    return [
        person(PRAIODAN, "Praiodan_42", { responsibleFor: text }),
        person(ME.id, ME.displayName, {
            role: operator ? "operator" : "admin",
            revision: 3,
            invitedBy: null,
            self: true,
            manageable: false,
        }),
    ];
}

/** Die Liste der Personen aus `people`; alles Übrige beantwortet der Stub. */
const mitEintrag =
    (text: string | null, operator = false) =>
    (call: AdminCall) =>
        call.method === "GET" && call.path === "/api/admin/people"
            ? { status: 200, body: { people: people(text, operator) } }
            : undefined;

/** Das eigene Konto, so knapp, wie das Fenster „Konto“ es braucht; schreibende Anfragen an `/api/account/*` landen in `calls`. */
async function kontoStub(page: Page, responsibleFor: string | null): Promise<AdminCall[]> {
    const calls: AdminCall[] = [];
    await page.route("**/api/account", (route) =>
        json(route, 200, {
            person: {
                id: ME.id,
                displayName: ME.displayName,
                status: "active",
                revision: 3,
                role: "admin",
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
                responsibleFor,
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
        calls.push({
            method: request.method(),
            path: new URL(request.url()).pathname,
            query: new URLSearchParams(),
            body: request.postDataJSON() as Record<string, unknown>,
        });
        return json(route, 200, { status: "applied" });
    });
    return calls;
}

async function kontenverwaltung(page: Page, options: Parameters<typeof stubAdmin>[1]) {
    const calls = await stubAdmin(page, options);
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-kontenverwaltung").click();
    await expect(page.getByRole("dialog", { name: "Kontenverwaltung" })).toBeVisible();
    return calls;
}

test("🔴 der Betreiber ändert „Verantwortlich für“ einer anderen Person in „Zugang“; der Kopf zeigt es kurz", async ({
    page,
}) => {
    const calls = await kontenverwaltung(page, {
        capabilities: OPERATOR_CAPABILITIES,
        role: "operator",
        answer: mitEintrag("Medienrechte", true),
    });
    await page.getByTestId(`person-oeffnen-${PRAIODAN}`).click();
    await expect(page.getByTestId("person-detail-verantwortung-kopf")).toHaveText("Verantwortlich für: Medienrechte");
    await expect(page.getByTestId("person-verantwortung-text")).toHaveText("Medienrechte");

    await page.getByTestId("person-verantwortung-aendern").click();
    const feld = page.getByTestId("person-verantwortung-feld").getByRole("textbox");
    await expect(feld).toHaveValue("Medienrechte");
    await expect(feld).toHaveAttribute("maxlength", "120");
    await feld.fill("Medienrechte, Wappen");
    await page.getByTestId("person-verantwortung-speichern").click();
    await expect(page.getByTestId("person-verantwortung-feld")).toBeHidden();
    expect(
        calls
            .filter((call) => call.method === "POST" && call.path === "/api/admin/people/responsibility")
            .map((call) => call.body),
    ).toEqual([
        {
            operationId: expect.any(String),
            personId: PRAIODAN,
            responsibleFor: "Medienrechte, Wappen",
            baseRevision: 1,
        },
    ]);
});

test("🔴 ein Admin ohne das Recht liest nur; am eigenen Konto ändert er es über das Konto", async ({ page }) => {
    const konto = await kontoStub(page, null);
    const calls = await kontenverwaltung(page, { answer: mitEintrag("Medienrechte") });
    await page.getByTestId(`person-oeffnen-${PRAIODAN}`).click();
    await expect(page.getByTestId("person-verantwortung-text")).toHaveText("Medienrechte");
    await expect(page.getByTestId("person-verantwortung-aendern")).toHaveCount(0);

    await page.getByTestId("person-zurueck").click();
    await page.getByTestId(`person-oeffnen-${ME.id}`).click();
    await expect(page.getByTestId("person-detail-verantwortung-kopf")).toHaveCount(0);
    await expect(page.getByTestId("person-verantwortung-text")).toHaveText("nicht angegeben");
    await page.getByTestId("person-verantwortung-aendern").click();
    await page.getByTestId("person-verantwortung-feld").getByRole("textbox").fill("Konten");
    await page.getByTestId("person-verantwortung-speichern").click();
    await expect(page.getByTestId("person-verantwortung-feld")).toBeHidden();
    expect(konto.map((call) => [call.path, call.body?.["responsibleFor"]])).toEqual([
        ["/api/account/responsibility", "Konten"],
    ]);
    expect(calls.filter((call) => call.path === "/api/admin/people/responsibility")).toEqual([]);
});

test("🔴 Konto: ein Feld mit Speichern, gesperrt, solange nichts geändert ist", async ({ page }) => {
    await stubAdmin(page, {});
    const calls = await kontoStub(page, "Kartenpflege Garetien");
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-konto").click();
    const feld = page.getByTestId("konto-verantwortung-feld").getByRole("textbox");
    await expect(feld).toHaveValue("Kartenpflege Garetien");
    await expect(feld).toHaveAttribute("maxlength", "120");
    const speichern = page.getByTestId("konto-verantwortung-speichern");
    await expect(speichern).toBeDisabled();
    await feld.fill("Kartenpflege Garetien und Weiden");
    await expect(speichern).toBeEnabled();
    await speichern.click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({
        path: "/api/account/responsibility",
        body: { responsibleFor: "Kartenpflege Garetien und Weiden", baseRevision: 3 },
    });
});
