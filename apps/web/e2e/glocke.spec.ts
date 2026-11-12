import { expect, test, type Page } from "@playwright/test";
import { benachrichtigungen, stubBenachrichtigungen, type BenachrichtigungServer } from "./benachrichtigungen-stub.ts";
import { stubKanal } from "./kanal-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Glocke in der Leiste (WI-0136 N2/N3, Blatt `review/wi-0136/blatt.png`). Sitzung aus `verwaltung-stub.ts`, Benachrichtigungen aus
 * `benachrichtigungen-stub.ts`, der Kanal aus `kanal-stub.ts`.
 *
 * - 🔴 Die Zahl der ungelesenen an der Glocke; Öffnen markiert alles als gelesen (bis zur jüngsten Kennung).
 * - 🔴 „Fix ist live“: „Gelöst“ schickt die Antwort und zeigt danach den Stand; „Noch nicht gelöst“ verlangt einen Kommentar.
 * - 🔴 Die OPS-Nummer öffnet den Vorgang im Kanal; ohne Kanal ist sie Text.
 * - Leer und Fehler wie im Blatt.
 */
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "use_operator_channel"];

async function oeffnen(page: Page, capabilities: string[] = BETREIBER, server?: Promise<BenachrichtigungServer>) {
    await stubAdmin(page, { role: capabilities.includes("use_operator_channel") ? "operator" : "admin", capabilities });
    const nachrichten = await (server ?? stubBenachrichtigungen(page));
    await page.goto("/edit");
    await expect(page.getByTestId("kopfleiste")).toBeVisible();
    return nachrichten;
}

const posts = (server: BenachrichtigungServer, ende: string) =>
    server.posts.filter((post) => post.path.endsWith(ende)).map((post) => post.body);

test("🔴 Zahl an der Glocke; Öffnen zeigt die Einträge und markiert sie als gelesen", async ({ page }) => {
    const server = await oeffnen(page);
    const knopf = page.getByTestId("glocke-knopf");
    await expect(page.getByTestId("glocke-zahl")).toHaveText("2");
    await expect(knopf).toHaveAttribute("aria-label", "Benachrichtigungen, 2 neu");
    // Die Glocke steht vor der Person, wie im Blatt.
    const glocke = await knopf.boundingBox();
    const person = await page.locator(".leiste__person").boundingBox();
    expect(glocke !== null && person !== null && glocke.x < person.x).toBe(true);

    await knopf.click();
    const klappe = page.getByTestId("glocke-klappe");
    await expect(klappe).toBeVisible();
    await expect(page.getByTestId("benachrichtigung-12")).toContainText("Claudio");
    await expect(page.getByTestId("benachrichtigung-12")).toContainText("Betrieb");
    await expect(page.getByTestId("benachrichtigung-12")).toContainText(
        "Fix für OPS-000127 „See-321 wird sichtbar“ ist live.",
    );
    await expect(page.getByTestId("benachrichtigung-11")).toContainText("Claudia hat OPS-000131 übernommen.");
    // Schon Gelesenes steht im Archiv (Betreiber 2026-10-13). 🔴 Beim ersten Öffnen auf einem Gerät ohne gemerkten Schnitt bleiben die beiden
    // neuen trotzdem oben: Das Öffnen markiert sie als gelesen, und ohne eingefrorenen Schnitt rutschten sie ins Archiv.
    await expect(page.getByTestId("benachrichtigung-9")).toHaveCount(0);
    await page.getByTestId("glocke-archiv").click();
    await expect(page.getByTestId("benachrichtigung-9")).toContainText("Akzeptiert von Thomas");
    await expect(page.getByTestId("benachrichtigung-12")).toBeVisible();
    await expect.poll(() => posts(server, "/gelesen")).toEqual([{ bis: 12 }]);
    await expect(page.getByTestId("glocke-zahl")).toHaveCount(0);
    // Escape schließt.
    await page.keyboard.press("Escape");
    await expect(klappe).toHaveCount(0);
});

test("🔴 „Gelöst“ antwortet und zeigt den Stand; „Noch nicht gelöst“ verlangt einen Kommentar", async ({ page }) => {
    const eintraege = benachrichtigungen();
    eintraege.push({ ...eintraege[0]!, id: 13, ops: "OPS-000140", text: "Suche findet Wehrheim nicht" });
    const server = await oeffnen(page, BETREIBER, stubBenachrichtigungen(page, eintraege));
    await page.getByTestId("glocke-knopf").click();
    const erster = page.getByTestId("benachrichtigung-12");
    await erster.getByTestId("benachrichtigung-geloest").click();
    await expect(erster.getByTestId("benachrichtigung-stand")).toHaveText("Als gelöst bestätigt.");
    expect(posts(server, "/12/antwort")).toEqual([expect.objectContaining({ antwort: "geloest" })]);

    const zweiter = page.getByTestId("benachrichtigung-13");
    await zweiter.getByTestId("benachrichtigung-nicht-geloest").click();
    await expect(zweiter.getByTestId("benachrichtigung-wieder")).toBeDisabled();
    await zweiter.getByTestId("benachrichtigung-kommentar").fill("Am Telefon noch da.");
    await zweiter.getByTestId("benachrichtigung-wieder").click();
    await expect(zweiter.getByTestId("benachrichtigung-stand")).toHaveText("Mit Kommentar wieder geöffnet.");
    expect(posts(server, "/13/antwort")).toEqual([
        expect.objectContaining({ antwort: "nicht_geloest", kommentar: "Am Telefon noch da." }),
    ]);
});

test("🔴 die OPS-Nummer öffnet den Vorgang im Kanal der Systemsteuerung", async ({ page }) => {
    await stubKanal(page);
    await oeffnen(page);
    await page.getByTestId("glocke-knopf").click();
    await page.getByTestId("benachrichtigung-ops-OPS-000127").click();
    await expect(page.getByTestId("glocke-klappe")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await expect(page.getByTestId("verwaltung-eintrag-claudio")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("kanal-vorgang-OPS-000127")).toBeVisible();
    // „Alle Vorgänge“ führt in die Liste (das Fenster liegt über der Leiste: erst schließen).
    await page.getByTestId("verwaltung-schliessen").click();
    await page.getByTestId("glocke-knopf").click();
    await page.getByTestId("glocke-kanal").click();
    await expect(page.getByTestId("kanal-liste")).toBeVisible();
});

test("ohne Kanal: keine Knöpfe, die OPS-Nummer ist Text, kein „Alle Vorgänge“; leer heißt leer", async ({ page }) => {
    const server = stubBenachrichtigungen(page, []);
    await oeffnen(page, ADMIN_CAPABILITIES, server);
    await expect(page.getByTestId("glocke-zahl")).toHaveCount(0);
    await page.getByTestId("glocke-knopf").click();
    await expect(page.getByTestId("glocke-leer")).toHaveText("Keine Benachrichtigungen.");
    await expect(page.getByTestId("glocke-kanal")).toHaveCount(0);
});

test("scheitert die Abfrage, sagt die Klappe es und bietet „Erneut versuchen“", async ({ page }) => {
    await stubAdmin(page, { role: "operator", capabilities: BETREIBER });
    const server = await stubBenachrichtigungen(page);
    server.fehler = 503;
    await page.goto("/edit");
    await page.getByTestId("glocke-knopf").click();
    await expect(page.getByTestId("glocke-klappe")).toContainText("Benachrichtigungen konnten nicht geladen werden.");
    server.fehler = null;
    await page.getByTestId("glocke-erneut").click();
    await expect(page.getByTestId("benachrichtigung-12")).toBeVisible();
});
