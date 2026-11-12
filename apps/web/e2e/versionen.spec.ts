import { expect, test, type Page } from "@playwright/test";
import { versionenAntwort } from "./versionen-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin, type AdminCall } from "./verwaltung-stub.ts";

/**
 * Der Eintrag „Versionen“ der Systemsteuerung (WI-0137, VERSION-0001 §4, Blatt 1) am Rechner, gegen den Nachbau (`versionen-stub.ts`) mit
 * den echten Release-Notizen aus `config/releases/`; die echten Routen prüft `apps/server/test/versionen-routes.test.ts`.
 *
 * - Oben das laufende Release: Commit als Link, `RELEASE_ID`, Titel, Zahlen ohne Doku, Vergleich auf GitHub.
 * - Die Änderungen nach Arbeitspaket, „Sonstiges“ zuletzt; Doku erst hinter „Auch Doku zeigen“ (Betreiber, Frage 1 B).
 * - Frühere Releases zugeklappt; Aufklappen lädt die Commits genau einmal.
 */

const GITHUB = "https://github.com/valentin-schwind/avesmaps3D";

async function oeffnen(page: Page, answer?: (call: AdminCall) => { status: number; body: unknown } | undefined) {
    const calls = await stubAdmin(page, {
        capabilities: ADMIN_CAPABILITIES,
        ...(answer === undefined ? {} : { answer }),
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-versionen").click();
    await expect(page.getByTestId("versionen-kopf")).toBeVisible();
    return calls;
}

test("🔴 das laufende Release: Kopf wie im Blatt, Gruppen je Arbeitspaket, Sonstiges zuletzt, Commits als Link auf GitHub", async ({
    page,
}) => {
    await oeffnen(page);
    const kopf = page.getByTestId("versionen-kopf");
    await expect(kopf.getByRole("link", { name: "df6f840c", exact: true })).toHaveAttribute(
        "href",
        new RegExp(`^${GITHUB}/commit/df6f840c[0-9a-f]{32}$`, "u"),
    );
    await expect(kopf).toContainText("Release 20261011T093012Z-df6f840c");
    await expect(kopf).toContainText("Routing ohne Kreuzungen");
    await expect(kopf).toContainText("22 Änderungen seit 557c6d11 in 7 Arbeitspaketen");
    await expect(kopf.getByRole("link", { name: "Alle auf GitHub vergleichen" })).toHaveAttribute(
        "href",
        new RegExp(`^${GITHUB}/compare/557c6d11[0-9a-f]{32}\\.\\.\\.df6f840c[0-9a-f]{32}$`, "u"),
    );
    const liste = page.getByTestId("versionen-liste-2026-10-11-df6f840c");
    await expect(liste.locator("h4")).toHaveText([
        /^WI-0128 · .+5$/u,
        /^WI-0129 · .+2$/u,
        /^WI-0127 · .+4$/u,
        /^WI-0132 · .+3$/u,
        /^WI-0131 · .+2$/u,
        /^WI-0134 · .+1$/u,
        /^WI-0068 · .+1$/u,
        "Sonstiges4",
    ]);
    // Eine Zeile: wann, wer mit Siegel, Art, Satz ohne Paketnummer, der Commit als Link.
    const zeile = liste.getByTestId("versionen-zeile-db978930");
    await expect(zeile).toContainText("Claudia");
    await expect(zeile).toContainText("PflegeE13 · Martin lokal ohne Kachelspeicher (--cache-size 0)");
    await expect(zeile.getByRole("link", { name: "db978930", exact: true })).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("verwaltung-eintrag-versionen")).toHaveText("Versionendf6f840c");
});

test("🔴 die Suche über der Liste: Arbeitspaket, Satz und Commit; nur die Suche, „Auch Doku zeigen“ bleibt der Aufklapper", async ({
    page,
}) => {
    // Koordination 2026-10-11: jede Liste hat die Leiste mit Freitextsuche (AvmListenleiste); Versionen hat keine echten Filter.
    await oeffnen(page);
    const leiste = page.getByTestId("versionen-leiste");
    const suche = leiste.getByTestId("versionen-leiste-suche").locator("input");
    await expect(leiste.getByTestId("catalog-filter")).toHaveCount(0);
    const liste = page.getByTestId("versionen-liste-2026-10-11-df6f840c");
    await suche.fill("wi-0129");
    await expect(liste.locator("h4")).toHaveText([/^WI-0129 · .+2$/u]);
    await suche.fill("db978930");
    await expect(liste.locator("tbody tr")).toHaveCount(1);
    await suche.fill("gibt es nicht");
    await expect(page.getByTestId("versionen-suche-leer")).toHaveText("Keine Änderung passt zur Suche.");
    // Kein Treffer heißt nicht „nur Doku“: der Satz für ein Release ohne Änderungen steht dann nicht da.
    await expect(liste.getByText("In diesem Release gibt es nur Doku.")).toHaveCount(0);
    await suche.press("Escape");
    await expect(liste.locator("tbody tr")).toHaveCount(22);
    await expect(page.getByTestId("versionen-doku")).toBeVisible();
});

test("🔴 Doku erst hinter „Auch Doku zeigen“: die Zahl im Knopf, danach mehr Zeilen, zurück blendet sie wieder aus", async ({
    page,
}) => {
    await oeffnen(page);
    const liste = page.getByTestId("versionen-liste-2026-10-11-df6f840c");
    // Der Release-Commit selbst ist Doku (nur der Stand) und steht ohne den Schalter nicht da.
    await expect(liste.getByTestId("versionen-zeile-df6f840c")).toHaveCount(0);
    const schalter = page.getByTestId("versionen-doku");
    await expect(schalter).toHaveText("Auch Doku zeigen (31)");
    await expect(schalter).toHaveAttribute("aria-pressed", "false");
    await schalter.click();
    await expect(schalter).toHaveText("Doku ausblenden");
    await expect(schalter).toHaveAttribute("aria-pressed", "true");
    await expect(liste.getByTestId("versionen-zeile-df6f840c")).toContainText("Doku");
    await expect(liste.locator("tbody tr")).toHaveCount(53);
    await schalter.click();
    await expect(liste.locator("tbody tr")).toHaveCount(22);
});

test("frühere Releases zugeklappt, neueste zuerst; Aufklappen lädt einmal, Zuklappen behält das Geladene", async ({
    page,
}) => {
    const calls = await oeffnen(page);
    const frueher = page.getByTestId("versionen-frueher");
    await expect(frueher.getByRole("button")).toHaveText([
        /^557c6d11\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}46 Änderungen/u,
        /^62951ae9/u,
        /^4fc6962c/u,
        /^028ec130/u,
        /^1ec3160e/u,
    ]);
    const knopf = page.getByTestId("versionen-frueher-2026-10-10-557c6d11");
    await expect(knopf).toHaveAttribute("aria-expanded", "false");
    await knopf.click();
    await expect(knopf).toHaveAttribute("aria-expanded", "true");
    const liste = page.getByTestId("versionen-liste-2026-10-10-557c6d11");
    await expect(liste.locator("h4").first()).toHaveText(/^WI-0068 · .+10$/u);
    await knopf.click();
    await expect(liste).toHaveCount(0);
    await knopf.click();
    await expect(liste).toBeVisible();
    const abrufe = calls.filter(
        (c) => c.method === "GET" && c.path === "/api/admin/system/versionen/2026-10-10-557c6d11",
    );
    expect(abrufe).toHaveLength(1);
});

test("🔴 lokal steht „lokal (dev)“ statt der Release-ID; ein kaputtes früheres Release meldet sich beim Aufklappen", async ({
    page,
}) => {
    const echt = versionenAntwort("dev");
    await stubAdmin(page, {
        capabilities: ADMIN_CAPABILITIES,
        answer: (call) => {
            if (call.path === "/api/admin/system/versionen/2026-10-10-557c6d11")
                return { status: 500, body: { error: { code: "internal", message: "vom Nachbau" } } };
            return echt(call);
        },
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await page.getByTestId("verwaltung-eintrag-versionen").click();
    await expect(page.getByTestId("versionen-kopf")).toContainText("lokal (dev), letzter Schnitt");
    await page.getByTestId("versionen-frueher-2026-10-10-557c6d11").click();
    await expect(page.getByTestId("versionen-frueher").getByRole("alert")).toHaveText(
        "Die Änderungen dieses Release ließen sich nicht laden.",
    );
});

test("ohne Release-Notizen im Stand: ein Satz statt des Kopfs", async ({ page }) => {
    await stubAdmin(page, {
        capabilities: ADMIN_CAPABILITIES,
        answer: (call) =>
            call.path === "/api/admin/system/versionen"
                ? { status: 200, body: { releaseId: "dev", laufend: null, frueher: [] } }
                : undefined,
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await page.getByTestId("verwaltung-eintrag-versionen").click();
    await expect(page.getByTestId("versionen-leer")).toHaveText("Noch keine Release-Notizen in diesem Stand.");
    await expect(page.getByTestId("versionen-kopf")).toHaveCount(0);
});
