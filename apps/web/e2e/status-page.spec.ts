import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { fullOverview, jobEvent, mockBackend, repo, withStalled } from "./status-fixtures.ts";

/**
 * Die Statusseite im Browser (JOBS-0001 Teil B, Etappe 1, WI-0074): Reiter, Zustände als Wörter, Sätze, Live über `/ws`,
 * Reconnect, Abfrage als Sicherheitsnetz, Überblick nur lokal.
 *
 * 🔴 Ohne Server: Antworten und `/ws` kommen vom Test (`status-fixtures.ts`), so prüft der Test die SEITE und nicht den Inhalt einer
 * Datenbank. Der echte Weg steht in `status-page-live.spec.ts`. Mit `STATUS_SHOTS=1` entstehen Bilder unter `review/status-page/`.
 */

const SHOTS = fileURLToPath(new URL("../../../review/status-page/", import.meta.url));

async function shot(page: Page, name: string): Promise<void> {
    if (process.env["STATUS_SHOTS"] !== "1") return;
    mkdirSync(SHOTS, { recursive: true });
    // Übergänge laufen zu Ende, ehe das Bild entsteht.
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });
}

/** `/ws` ohne Server: der Test hält die Verbindung und schickt, was er will. */
async function mockSocket(page: Page): Promise<{
    connections: number;
    sent: unknown[];
    push(message: unknown): void;
    closeAll(code: number, reason: string): void;
}> {
    const handle = {
        connections: 0,
        sent: [] as unknown[],
        sockets: [] as { send(data: string): void; close(options: { code: number; reason: string }): void }[],
        push(message: unknown): void {
            for (const socket of this.sockets) socket.send(JSON.stringify(message));
        },
        closeAll(code: number, reason: string): void {
            for (const socket of this.sockets.splice(0)) socket.close({ code, reason });
        },
    };
    await page.routeWebSocket(/\/ws$/, (ws) => {
        handle.connections += 1;
        handle.sockets.push(ws);
        ws.onMessage((message) => {
            const parsed = JSON.parse(String(message)) as { op: string };
            handle.sent.push(parsed);
            if (parsed.op === "subscribe") ws.send(JSON.stringify({ op: "subscribed", channel: "jobs", seq: 120 }));
            if (parsed.op === "ping") ws.send(JSON.stringify({ op: "pong", serverTime: new Date().toISOString() }));
        });
        ws.send(JSON.stringify({ op: "hello", seq: 120, serverTime: new Date().toISOString(), releaseId: "x" }));
    });
    return handle;
}

test("🔴 Warteschlange: läuft, hängt, wartet, fertig, fehlgeschlagen — jeder Zustand als Wort, mit seinem Satz", async ({
    page,
}) => {
    await mockBackend(page);
    await mockSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("status-live")).toHaveAttribute("data-connection", "live");
    await expect(page.getByTestId("status-env")).toContainText(
        "Release 20261004T120000Z-abc1234 · Warteschlangen-Profil staging",
    );

    // läuft: der Zug in Phase I11, aufgezeichnet, mit Spitze gegen Erwartung
    const running = page.getByTestId("job-00000000-0000-4000-8000-0000000000a1");
    await expect(running).toHaveAttribute("data-state", "RUNNING");
    await expect(running.getByTestId("job-state")).toHaveText("läuft");
    await expect(running.getByTestId("job-meta")).toContainText("aufgezeichnet · Phase I11 · seit 5 min");
    await expect(running.getByTestId("job-meta")).toContainText("Spitze 1.250 MB, erwartet 1.400 MB");
    await expect(running.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");

    // hängt: abgeleitet aus der abgelaufenen Lease, mit dem Satz, was nun geschieht
    const stalled = page.getByTestId("job-00000000-0000-4000-8000-0000000000a2");
    await expect(stalled).toHaveAttribute("data-state", "stalled");
    await expect(stalled.getByTestId("job-state")).toHaveText("hängt");
    await expect(stalled.getByTestId("job-stalled")).toContainText("Die Lease ist seit");
    await expect(stalled.getByTestId("job-stalled")).toContainText("erneut eingereiht (Versuch 2 von 3)");
    // ... und steht im Abschnitt „Hängt“, nicht noch einmal unter „Läuft“
    await expect(
        page.getByTestId("stalled-list").getByTestId("job-00000000-0000-4000-8000-0000000000a2"),
    ).toBeVisible();
    await expect(page.getByTestId("running-list").getByTestId("job-00000000-0000-4000-8000-0000000000a2")).toHaveCount(
        0,
    );

    // wartet: Position, Grund, geschätzte Zeit oder „unbekannt“ — nie eine geratene Zahl
    const first = page.getByTestId("job-00000000-0000-4000-8000-0000000000b1");
    await expect(first.getByTestId("job-position")).toHaveText("Platz 1");
    await expect(first.getByTestId("job-wait")).toHaveText("Wartet auf den Bereich: ein anderer Job arbeitet dort.");
    await expect(first.getByTestId("job-estimate")).toContainText("Start in etwa 9 min");
    await expect(first.getByTestId("job-estimate")).toContainText("nach dem Startwert");
    const second = page.getByTestId("job-00000000-0000-4000-8000-0000000000b2");
    await expect(second.getByTestId("job-wait")).toHaveText("Wartet auf Speicher.");
    await expect(second.getByTestId("job-estimate")).toContainText("Start unbekannt");
    await expect(second.getByTestId("job-estimate")).toContainText(
        "Dauer unbekannt, es liegen noch zu wenige Läufe vor",
    );
    const third = page.getByTestId("job-00000000-0000-4000-8000-0000000000b3");
    await expect(third.getByTestId("job-wait")).toContainText("Wird gesammelt, noch");
    await expect(third.getByTestId("job-reason")).toHaveText("process_died: erneut eingereiht, Versuch 2 von 3.");
    await expect(third.getByTestId("job-estimate")).toContainText("Dauer 1 min 30 s bis 2 min 30 s");

    // fertig: Dauer, Spitze, ein Befund als Satz (gemeldet, nicht angehalten); abgebrochen mit Grund
    const done = page.getByTestId("job-00000000-0000-4000-8000-0000000000c1");
    await expect(done.getByTestId("job-state")).toHaveText("fertig");
    await expect(done.getByTestId("job-meta")).toContainText("Dauer 16 min");
    await expect(done.getByTestId("job-finding")).toContainText("Speicher über der Erwartung: Spitze RSS 1326 MB");
    await expect(page.getByTestId("job-00000000-0000-4000-8000-0000000000c2").getByTestId("job-reason")).toHaveText(
        "Abgebrochen, weil ein Vorgänger gescheitert ist.",
    );

    // fehlgeschlagen: Code und Klartext, drei Versuche
    const failed = page.getByTestId("job-00000000-0000-4000-8000-0000000000d1");
    await expect(failed.getByTestId("job-state")).toHaveText("fehlgeschlagen");
    await expect(failed.getByTestId("job-reason")).toContainText("process_died: Der Job-Prozess endete unerwartet");
    await expect(failed.getByTestId("job-meta")).toContainText("Versuch 3 von 3");

    // Speicher: gebucht gegen Budget, die Marke rollout
    await expect(page.getByTestId("memory-booked")).toContainText("1.796 MB von 1.600 MB");
    await expect(page.getByTestId("memory-free")).toContainText("3.100 MB (Boden 2.048 MB)");
    await expect(page.getByTestId("rollout-active")).toContainText("Die Marke rollout ist aktiv.");
    await expect(page.getByTestId("planner-state")).toHaveText("aktiv");
    await shot(page, "desktop-queue");
});

test("nur Ansicht: kein Knopf verändert die Queue (kein Abbrechen, kein Wiederholen)", async ({ page }) => {
    await mockBackend(page);
    await mockSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("queue-tab")).toBeVisible();
    // Knöpfe gibt es nur für die Reiter und den Themenwechsel
    const buttons = await page
        .getByRole("button")
        .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-testid") ?? node.getAttribute("aria-label") ?? ""),
        );
    expect(buttons.filter((name) => !/^status-reiter-|theme-toggle|Auf (dunkles|helles) Design/.test(name))).toEqual(
        [],
    );
});

test("Ohne Planer sagt die Seite es deutlich: wartende Jobs starten nicht", async ({ page }) => {
    await mockBackend(page, { overview: withStalled({ ...fullOverview(), plannerActive: false }) });
    await mockSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("planner-missing")).toContainText("Kein Planer erreichbar.");
    await expect(page.getByTestId("planner-state")).toHaveText("keiner");
});

test("🔴 Live: ein Ereignis über /ws lädt den Stand über HTTP neu, die Seite lädt nicht neu", async ({ page }) => {
    const backend = await mockBackend(page);
    const socket = await mockSocket(page);
    await page.goto("/status.html");
    await page.evaluate(() => {
        (window as unknown as { __marker: string }).__marker = "bleibt";
    });
    await expect(page.getByTestId("status-live")).toHaveAttribute("data-connection", "live");
    await expect(page.getByTestId("queued-list").getByRole("listitem")).toHaveCount(3);
    const before = backend.requests.overview;

    // Der Server hat einen Job mehr; ein Ereignis weckt die Seite.
    backend.overview = withStalled({
        ...fullOverview(),
        seq: 121,
        queued: [...fullOverview().queued],
        recent: [],
        failed: [],
    });
    backend.overview = { ...backend.overview, queued: backend.overview.queued.slice(0, 2), seq: 121 };
    socket.push({ op: "event", channel: "jobs", event: jobEvent(121, "job.succeeded") });
    await expect(page.getByTestId("queued-list").getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("recent-empty")).toBeVisible();
    expect(backend.requests.overview).toBeGreaterThan(before);
    expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe("bleibt");
});

test("🔴 Reconnect: schließt der Server mit 1001 (der alte Slot geht), verbindet die Seite neu und abonniert ab dem letzten seq", async ({
    page,
}) => {
    await page.addInitScript(() => {
        // Der Backoff mit Jitter, hier auf den kürzesten Wert festgelegt, damit der Test nicht auf einen Würfel wartet.
        Math.random = () => 0;
    });
    const backend = await mockBackend(page);
    const socket = await mockSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("status-live")).toHaveAttribute("data-connection", "live");
    expect(socket.connections).toBe(1);
    socket.push({ op: "event", channel: "jobs", event: jobEvent(125) });
    await expect.poll(() => backend.requests.overview).toBeGreaterThan(1);

    socket.closeAll(1001, "going away");
    await expect.poll(() => socket.connections, { timeout: 5000 }).toBe(2);
    await expect(page.getByTestId("status-live")).toHaveAttribute("data-connection", "live");
    const subscriptions = socket.sent.filter((message) => (message as { op: string }).op === "subscribe");
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0]).toEqual({ op: "subscribe", channel: "jobs", since: 120 });
    // Nach dem Ereignis 125 steht die Nummer im Abo: der Server spielt nach, was er noch hat.
    expect(subscriptions[1]).toEqual({ op: "subscribe", channel: "jobs", since: 125 });
});

test("🔴 Fällt /ws aus, fragt die Seite alle paar Sekunden nach (HTTP bleibt autoritativ) und sagt es", async ({
    page,
}) => {
    await page.clock.install();
    const backend = await mockBackend(page);
    await page.routeWebSocket(/\/ws$/, (ws) => {
        // Ein Proxy ohne Upgrade: die Verbindung kommt nie zustande.
        ws.close({ code: 1006, reason: "" });
    });
    await page.goto("/status.html");
    await expect(page.getByTestId("status-live")).toHaveAttribute("data-connection", "polling");
    await expect(page.getByTestId("status-live")).toContainText("Abfrage alle paar Sekunden");
    const before = backend.requests.overview;
    await page.clock.fastForward(6000);
    await expect.poll(() => backend.requests.overview).toBeGreaterThan(before);
    // Der Stand selbst bleibt da.
    await expect(page.getByTestId("queued-list")).toBeVisible();
});

test("Betrieb: Health, Release, Migration, Zeiger, Legacy-Satz und die letzten Imports", async ({ page }) => {
    await mockBackend(page);
    await mockSocket(page);
    await page.goto("/status.html");
    await page.getByTestId("status-reiter-operations").click();
    await expect(page).toHaveURL(/#operations$/);
    await expect(page.getByTestId("ops-health")).toHaveText("ok · postgis 3.6");
    await expect(page.getByTestId("ops-release")).toHaveText("20261004T120000Z-abc1234");
    await expect(page.getByTestId("ops-migration")).toHaveText("0070_jobs");
    await expect(page.getByTestId("ops-dem")).toHaveText("Revision a0d65d595b8f (webp)");
    // Veraltete Anzeigehöhen sind ein Befund, den man sehen muss
    await expect(page.getByTestId("ops-heights")).toHaveAttribute("data-state", "stale");
    await expect(page.getByTestId("ops-heights")).toContainText("veraltet");
    await expect(page.getByTestId("ops-legacy")).toContainText(
        "Karte 163536 · Ökosysteme 144193 · Gebiete pt-15706a07fe5477d8",
    );
    await expect(page.getByTestId("ops-imports").getByRole("listitem")).toHaveCount(1);
    await shot(page, "desktop-betrieb");
});

test("🔴 Überblick nur lokal (D2 A): auf der Stage gibt es den Reiter nicht", async ({ page }) => {
    await mockBackend(page, { repo: repo(false) });
    await mockSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("status-reiter-queue")).toBeVisible();
    await expect(page.getByTestId("status-reiter-overview")).toHaveCount(0);
    // auch über die Adresse nicht
    await page.goto("/status.html?x=1#overview");
    await expect(page.getByTestId("status-reiter-overview")).toHaveCount(0);
    await expect(page.getByTestId("queue-tab")).toBeVisible();
});

test("Überblick lokal: Wartet auf den Betreiber, heute entschieden, selbst entschieden, Sitzungen, Datenstand; jede Zeile mit Fundstelle als Link", async ({
    page,
}) => {
    await mockBackend(page, { repo: repo(true) });
    await mockSocket(page);
    await page.goto("/status.html");
    await page.getByTestId("status-reiter-overview").click();
    await expect(page.getByTestId("ov-waiting")).toContainText("Bootstrap der Unit für den Worker");
    await expect(page.getByTestId("ov-decided")).toContainText("„alles wie empfohlen“");
    await expect(page.getByTestId("ov-self")).toContainText("der Worker ist ein eigener Prozess");
    await expect(page.getByTestId("ov-sessions")).toContainText("WI-0074 JOBS-0001 Etappe 1");
    await expect(page.getByTestId("ov-data")).toContainText("Legacy-Satz");
    await expect(page.getByTestId("ov-data")).toContainText("map163536");
    // Beleg: Datei und Zeile, als Link auf GitHub
    const beleg = page.getByTestId("ov-waiting").getByRole("link");
    await expect(beleg).toHaveText("handovers/2026-10-04-a.md, Zeile 8");
    await expect(beleg).toHaveAttribute(
        "href",
        "https://github.com/valentin-schwind/avesmaps3D/blob/master/project-control/handovers/2026-10-04-a.md#L8",
    );
    await expect(beleg).toHaveAttribute("rel", /noopener/);
    await shot(page, "desktop-ueberblick");
});

test("🔴 Instanz ohne Statusseite (404 status_disabled): ein Satz, kein Neuverbinden gegen /ws", async ({ page }) => {
    await mockBackend(page, { disabled: true });
    const socket = await mockSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("status-failure")).toHaveText("Die Seite Warteschlange ist auf dieser Instanz aus.");
    await page.waitForTimeout(800);
    expect(socket.connections).toBe(0);
});

test("Englisch: `?lang=en` — dieselben Sätze aus der englischen Tafel", async ({ page }) => {
    await mockBackend(page);
    await mockSocket(page);
    await page.goto("/status.html?lang=en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // Die Seite heißt seit 2026-10-15 „Warteschlange“, englisch „Queue“ (abcecce83).
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Queue");
    await expect(page.getByTestId("job-00000000-0000-4000-8000-0000000000b2").getByTestId("job-wait")).toHaveText(
        "Waiting for memory.",
    );
    await expect(
        page.getByTestId("job-00000000-0000-4000-8000-0000000000b2").getByTestId("job-estimate"),
    ).toContainText("start unknown");
    await expect(page.getByTestId("memory-booked")).toContainText("1,796 MB of 1,600 MB");
    await expect(page.getByTestId("job-00000000-0000-4000-8000-0000000000a2").getByTestId("job-state")).toHaveText(
        "stalled",
    );
});

test("hell und dunkel: dieselbe Seite, beide Themen lesbar (Bilder mit STATUS_SHOTS=1)", async ({ page }) => {
    await mockBackend(page, { repo: repo(true) });
    await mockSocket(page);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/status.html");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("queue-tab")).toBeVisible();
    await shot(page, "desktop-queue-hell");
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await shot(page, "desktop-queue-dunkel");
    // Die Schrift ist im Dunkeln hell auf dunklem Grund: Kontrast der Fließschrift gegen den Seitengrund
    const colours = await page.evaluate(() => {
        const body = getComputedStyle(document.body).backgroundColor;
        const text = getComputedStyle(document.querySelector('[data-testid="queue-tab"]') as Element).color;
        return { body, text };
    });
    const luminance = (rgb: string): number => {
        const [r = 0, g = 0, b = 0] = (rgb.match(/\d+/g) ?? []).map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(luminance(colours.text)).toBeGreaterThan(luminance(colours.body) + 80);
});

test("🔴 WI-0120 A11: ohne Anmeldung sagt die Seite es und führt zur Anmeldung", async ({ page }) => {
    await mockBackend(page);
    await page.route("**/api/jobs/overview", (route) =>
        route.fulfill({ status: 401, json: { error: { code: "unauthenticated", message: "x" } } }),
    );
    await mockSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("status-failure")).toContainText(
        "Für die Seite Warteschlange ist eine Anmeldung nötig.",
    );
    await expect(page.getByTestId("status-signin")).toHaveAttribute("href", "/anmelden");
});

test("🔴 WI-0120 A11: die eigene Sicht eines Editors zeigt weder Speicher noch Betrieb, aber sagt, was fehlt", async ({
    page,
}) => {
    await mockBackend(page, { overview: { ...withStalled(fullOverview()), view: "own", memory: null } });
    await mockSocket(page);
    await page.goto("/status.html");
    await expect(page.getByTestId("status-own")).toBeVisible();
    await expect(page.getByTestId("memory")).toHaveCount(0);
    await expect(page.getByTestId("status-reiter-operations")).toHaveCount(0);
    await expect(page.getByTestId("status-reiter-queue")).toBeVisible();
});
