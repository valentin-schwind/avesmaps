import { expect, test, type Page } from "@playwright/test";
import type { FreigabeSicht } from "@avesmaps3d/shared";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Wo früher „Für Production freigeben“ stand, steht der Zustand der Freigabe (WI-0248; Vali 2026-10-26: „1. Wann getestet wird: WENN ICH DAS WILL“,
 * „3. … Nein das passiert automatisch, sobald der test grün war“). Der Start des Release-Tests auf Lokal IST die Freigabe; die Stage zeigt, was aus
 * ihr wird: wartet auf den Test, Test läuft, rot, grün und geht von selbst raus, in Production. Der Rückweg bleibt ein Knopf.
 *
 * Problemfall davor: Ein zweiter Knopf nach dem Test, den der Betreiber ausdrücklich nicht will („Eine Absegnung … Nein das passiert automatisch“), und
 * Sätze über ein Nachtfenster, das es seit dem 2026-10-24 nicht mehr gibt.
 */
const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "release_to_production"];
const STAND = "a7728a1".padEnd(40, "0");

const SICHT: FreigabeSicht = {
    now: "2026-10-26T19:00:00.000Z",
    datei: {
        schema: 1,
        standAt: "2026-10-26T18:59:00.000Z",
        production: { release: "b2ee1b3", commit: "b2ee1b3".padEnd(40, "0"), seit: "2026-10-18T00:17:00.000Z" },
        stage: { release: "a7728a1", commit: STAND, seit: "2026-10-26T18:46:00.000Z" },
        stageGruen: null,
        stagePruefung: "Proben und Journal gruen, 26.10. 20:48",
        technik: { migrationen: ["0230", "0231"], rechte: [], umgebungswerte: [] },
        themen: [],
        probenGruen: true,
        nachweis: "fehlt",
    },
    sperre: "stage_ungeprueft",
    laeuft: null,
    frueher: [],
    freigabe: null,
} as unknown as FreigabeSicht;

/** Die Sicht mit einer Freigabe aus dem Start des Release-Tests in diesem Zustand (wie Claudios `freigabe:stand --release-freigabe` sie schreibt). */
function mitFreigabe(zustand: string, satz: string | null = null): FreigabeSicht {
    return {
        ...SICHT,
        datei: {
            ...SICHT.datei!,
            releaseFreigabe: {
                commit: STAND,
                kennung: "RT-00000000-0000-4000-8000-000000000001",
                von: "Vali",
                seit: "2026-10-26T18:50:00.000Z",
                zustand,
                grund: zustand === "abgebrochen" ? "Abgebrochen von Vali" : "x",
                satz,
            },
        },
    } as unknown as FreigabeSicht;
}

async function oeffne(page: Page, sicht: FreigabeSicht): Promise<void> {
    await stubAdmin(page, {
        capabilities: OPERATOR,
        role: "operator",
        person: { passkeyCount: 1 },
        environment: "staging",
        answer: (call) =>
            call.path.startsWith("/api/admin/system/production") ? { status: 200, body: sicht } : undefined,
    });
    await page.goto("/?verwaltung=production");
    await page.getByTestId("umgebungen-freigabe-zustand").waitFor({ timeout: 20_000 });
}

test("„Alles nach Production“ von Hand wartet auf eine grün geprüfte Stage; ohne Freigabe sagt der Satz, wie eine entsteht", async ({
    page,
}) => {
    await oeffne(page, SICHT);
    // Vali 2026-10-31: nach einem Release-Test auch von Hand nach Production; hier ist die Stage ungeprüft, der Knopf also gesperrt.
    await expect(page.getByTestId("production-release")).toBeDisabled();
    await expect(page.getByTestId("umgebungen-freigabe-zustand")).toHaveText(
        "Keine Freigabe. Der Start des Release-Tests auf Lokal gibt den Stage-Stand frei; bei Grün geht er von selbst nach Production.",
    );
    // Was mitginge, steht weiter darunter; kein Satz über ein Nachtfenster oder eine Uhrzeit.
    await expect(page.getByTestId("umgebungen-knopfsatz")).toContainText("a7728a1");
    await expect(page.getByText("Nachtfenster")).toHaveCount(0);
    await expect(page.getByText("Um 04:30 prüft der Server")).toHaveCount(0);
    // Der Rückweg betrifft Production, nicht die Stage: Eine ungeprüfte Stage hält ihn nicht auf (wie der Server).
    await expect(page.getByTestId("production-rollback")).toBeEnabled();
});

test("🔴 die Freigabe aus dem Start: wartet, läuft, rot, grün und geht von selbst raus, in Production", async ({
    context,
}) => {
    for (const [zustand, text] of [
        ["wartet", "Freigabe a7728a1 von Vali: wartet auf den Release-Test"],
        ["laeuft", "Freigabe a7728a1 von Vali: Release-Test läuft"],
        ["rot", "Freigabe a7728a1 von Vali: Release-Test rot, nichts geht nach Production"],
        ["gruen", "Freigabe a7728a1 von Vali: grün, geht von selbst nach Production"],
        ["ausgeliefert", "Freigabe a7728a1 von Vali: in Production"],
        ["abgebrochen", "Freigabe a7728a1: nicht ausgeliefert (Abgebrochen von Vali)"],
    ] as const) {
        // Je Zustand eine frische Seite: Die Stubs einer Seite gelten für ihre ganze Lebenszeit.
        const page = await context.newPage();
        await oeffne(page, mitFreigabe(zustand));
        await expect(page.getByTestId("umgebungen-freigabe-zustand"), zustand).toHaveText(text);
        await expect(page.getByTestId("production-release")).toHaveCount(1);
        await page.close();
    }
});

test("Claudios Zusatz zur Auslieferung steht unter dem Zustand", async ({ page }) => {
    await oeffne(page, mitFreigabe("gruen", "Auslieferung wartet: die nächtliche Sicherung läuft noch"));
    await expect(page.getByTestId("umgebungen-freigabe-satz")).toHaveText(
        "Auslieferung wartet: die nächtliche Sicherung läuft noch",
    );
});

test("eine offene Nacht-Freigabe von früher bleibt sichtbar und abbrechbar", async ({ page }) => {
    await oeffne(page, {
        ...SICHT,
        freigabe: {
            ops: "OPS-000050",
            release: "a7728a1",
            commit: STAND,
            seit: "2026-10-19T18:50:00.000Z",
            wer: "Vali",
            pruefung: null,
        },
    } as FreigabeSicht);
    await expect(page.getByTestId("production-nacht")).toContainText("Für Production freigegeben: a7728a1");
    await expect(page.getByTestId("production-nacht-abbrechen")).toBeEnabled();
});
