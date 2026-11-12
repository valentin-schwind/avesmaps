import { expect, test, type Locator, type Page } from "@playwright/test";
import { kartenserienServer, type KartenserienServer } from "./kartenserien-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Reiter „Kartenserien“ (WI-0220 Schnitt 2) im Browser gegen den Nachbau (`kartenserien-stub.ts`). Vorlage ist der abgenommene
 * Entwurf Fassung 4 (Betreiber 2026-10-18). Die echten Routen prüft `apps/server/test/map-series.test.ts`.
 */

const BETREIBER = [...ADMIN_CAPABILITIES, "manage_map_series", "release_to_production"];

async function oeffnen(
    page: Page,
    server: KartenserienServer,
    capabilities: string[] = BETREIBER,
    environment: string = "staging",
) {
    await stubAdmin(page, {
        capabilities,
        environment,
        role: capabilities.includes("manage_map_series") ? "operator" : "admin",
        person: { passkeyCount: 1 },
        answer: (call) => server.handle(call),
    });
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-kartenserien").click();
    await expect(page.getByTestId("kartenserien")).toBeVisible();
}

test("🔴 Liste in der Reihenfolge des Fächers mit Pillen; Kartenserien steht vorn in Karte & Einstellungen", async ({
    page,
}) => {
    const server = kartenserienServer();
    await oeffnen(page, server);
    await expect(page.locator('[data-testid^="kartenserien-zeile-"]')).toHaveCount(3);
    await expect(page.getByTestId("kartenserien-zeile-modern")).toContainText("Vorgabe");
    // Old ist seit 2026-11-10 für alle (Besucher sehen es nur unter „Nur Karte“), keine Pille „Nur für Editoren“ mehr.
    await expect(page.getByTestId("kartenserien-zeile-old")).not.toContainText("Nur für Editoren");
    await expect(page.getByTestId("kartenserien-zeile-modern")).toContainText(
        "32.768 px · Zoom 0 bis 6 · 5.461 Kacheln",
    );
    // Die Vorgabe zeigt ihre Pille statt des Knopfs; „Original nicht in der Sicherung“ steht bei den Infos.
    await expect(page.getByTestId("kartenserien-ist-vorgabe")).toBeVisible();
    await expect(page.getByTestId("kartenserien-infos")).toContainText("Original nicht in der Sicherung");
});

test("🔴 Sichtbarkeit: Niemand geht an den Server; Old für alle nur unter „Nur Karte“, nie Vorgabe; die Vorgabe nicht verbergen", async ({
    page,
}) => {
    const server = kartenserienServer();
    await oeffnen(page, server);
    await page.getByTestId("kartenserien-zeile-original").click();
    await page.getByTestId("kartenserien-stufe-niemand").click();
    await expect.poll(() => server.posts.at(-1)?.["aktion"]).toEqual({ art: "stufe", stufe: "niemand" });
    await expect(page.getByTestId("kartenserien-zeile-original")).toContainText("Ausgeblendet");
    await page.getByTestId("kartenserien-zeile-old").click();
    // Beschriftung im Bild (Betreiber 2026-11-10): „Alle“ heißt für Besucher nur unter „Nur Karte“, Vorgabe wird die Serie nie.
    await expect(page.getByTestId("kartenserien-stufe-alle")).toBeEnabled();
    await expect(page.getByTestId("kartenserien-stufe-editoren")).toBeEnabled();
    // Betreiber 2026-10-18: „gibt dem feld rechts bei sichtbarkeit zur auswahl doch mehr platz“ – die drei Stufen stehen ungekürzt,
    // und der Satz, warum „Als Vorgabe setzen“ gesperrt ist, steht nur einmal (am Knopf).
    const karte = page.getByTestId("kartenserien-sichtbarkeit");
    const gekuerzt = await karte
        .locator(".einzeilig")
        .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));
    expect(gekuerzt).toEqual([]);
    await expect(karte.getByText("Besucher sehen sie nur unter „Nur Karte“", { exact: false })).toHaveCount(1);
    await expect(
        karte.getByText("Als Vorgabe stünde in den Ansichten mit Namen jeder Name doppelt.", { exact: false }),
    ).toHaveCount(1);
    await page.getByTestId("kartenserien-zeile-modern").click();
    await expect(page.getByTestId("kartenserien-stufe-editoren")).toBeDisabled();
});

test("Bild im Fächermenü: Ausschnitt wählen und übernehmen schickt die Kachel der Stufe 5", async ({ page }) => {
    const server = kartenserienServer();
    await oeffnen(page, server);
    await page.getByTestId("kartenserien-zeile-original").click();
    await page.getByTestId("kartenserien-ausschnitt-oeffnen").click();
    const karte = page.getByTestId("kartenserien-ausschnitt-karte");
    await karte.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.getByTestId("kartenserien-ausschnitt-uebernehmen").click();
    await expect.poll(() => server.posts.at(-1)?.["aktion"]).toEqual({ art: "thumb", thumb: { x: 18, y: 16 } });
});

test("Papierkorb: mit Rückfrage hinein, Wiederherstellen holt die Serie zurück; die Vorgabe lässt sich nicht löschen", async ({
    page,
}) => {
    const server = kartenserienServer();
    await oeffnen(page, server);
    await expect(page.getByTestId("kartenserien-loeschen")).toBeDisabled();
    await page.getByTestId("kartenserien-zeile-original").click();
    await page.getByTestId("kartenserien-loeschen").click();
    await page.getByTestId("kartenserien-loeschen-frage").getByRole("button", { name: "In den Papierkorb" }).click();
    await expect(page.getByTestId("kartenserien-korb-original")).toBeVisible();
    // Schnitt 4: die Frist steht dabei.
    await expect(page.getByTestId("kartenserien-korb-original")).toContainText("endgültig weg am");
    await expect(page.getByTestId("kartenserien-papierkorb")).toContainText("30 Tage");
    await expect(page.locator('[data-testid^="kartenserien-zeile-"]')).toHaveCount(2);
    await page.getByTestId("kartenserien-wiederherstellen-original").click();
    await expect(page.locator('[data-testid^="kartenserien-zeile-"]')).toHaveCount(3);
});

test("🔴 ohne Sonderrecht: alles sichtbar, nichts änderbar, mit dem Satz warum", async ({ page }) => {
    const server = kartenserienServer();
    await oeffnen(page, server, ADMIN_CAPABILITIES);
    await expect(page.getByTestId("kartenserien-nur-lesen")).toContainText("Kartenserien verwalten");
    await expect(page.getByTestId("kartenserien-name").locator("input")).toBeDisabled();
});

// ── Hochladen, Ersetzen, Fassungen (Schnitt 3) ──────────────────────────────────────────────────────────────────────────────────

/** Ein „PNG“ für den Browser: Signatur und IHDR mit der Kante, danach beliebige Bytes (der Nachbau zerlegt nicht). */
function png(kante: number, laenge = 4096): Buffer {
    const masse = Buffer.alloc(8);
    masse.writeUInt32BE(kante, 0);
    masse.writeUInt32BE(kante, 4);
    return Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), masse, Buffer.alloc(laenge - 24, 7)]);
}

test("🔴 Neue Kartenserie: Kennung aus dem Namen, Kopf der Datei geprüft, Hochladen reiht den Auftrag ein; die Serie steht in Arbeit", async ({
    page,
}) => {
    const server = kartenserienServer();
    await oeffnen(page, server);
    await expect(page.getByTestId("kartenserien-platz")).toContainText("136");
    await page.getByTestId("kartenserien-neu").click();
    await page.getByTestId("kartenserien-hochladen-name").locator("input").fill("Aventurien bei Nacht");
    await expect(page.getByTestId("kartenserien-hochladen-kennung").locator("input")).toHaveValue("aventurienbeinacht");
    await expect(page.getByTestId("kartenserien-hochladen-los")).toBeDisabled();
    // Eine falsche Kante sagt der Kopf der Datei, bevor ein Byte hochgeht.
    await page.getByTestId("kartenserien-hochladen-datei").setInputFiles({
        name: "falsch.png",
        mimeType: "image/png",
        buffer: png(10_000),
    });
    await expect(page.getByTestId("kartenserien-hochladen-pruefung")).toContainText("Gebraucht wird ein Quadrat");
    await expect(page.getByTestId("kartenserien-hochladen-los")).toBeDisabled();
    await page.getByTestId("kartenserien-hochladen-datei").setInputFiles({
        name: "nacht.png",
        mimeType: "image/png",
        buffer: png(8192),
    });
    await expect(page.getByTestId("kartenserien-hochladen-pruefung")).toContainText("Zoom 0 bis 4 mit 341 Kacheln");
    await page.getByTestId("kartenserien-hochladen-los").click();
    await expect
        .poll(() => server.posts.find((p) => p["ziel"] !== undefined)?.["ziel"])
        .toEqual({
            art: "neu",
            id: "aventurienbeinacht",
            anlage: { label: "Aventurien bei Nacht", labelsInImage: false, nurEditoren: true },
        });
    await expect.poll(() => server.posts.some((p) => p["abschluss"] !== undefined)).toBe(true);
    const arbeit = page.getByTestId("kartenserien-arbeit-aventurienbeinacht");
    await expect(arbeit).toContainText("Neue Serie „Aventurien bei Nacht“ wird angelegt");
    await expect(page.getByTestId("kartenserien-arbeit-aventurienbeinacht-schritt-warten")).toHaveClass(
        /ablauf__schritt--jetzt/u,
    );
    // Im Fächer steht sie noch nicht.
    await expect(page.locator('[data-testid^="kartenserien-zeile-"]')).toHaveCount(3);
});

test("Ersetzen: dieselbe Datei-Prüfung, danach der Ablauf an der Serie", async ({ page }) => {
    const server = kartenserienServer();
    await oeffnen(page, server);
    await page.getByTestId("kartenserien-zeile-original").click();
    await page.getByTestId("kartenserien-ersetzen").click();
    await expect(page.getByTestId("kartenserien-hochladen")).toContainText("„Original“ ersetzen");
    await page.getByTestId("kartenserien-hochladen-datei").setInputFiles({
        name: "original-neu.png",
        mimeType: "image/png",
        buffer: png(32768),
    });
    await page.getByTestId("kartenserien-hochladen-los").click();
    await expect
        .poll(() => server.posts.find((p) => p["ziel"] !== undefined)?.["ziel"])
        .toEqual({ art: "ersetzen", id: "original" });
    await expect(page.getByTestId("kartenserien-ablauf")).toContainText("Neue Fassung wird erstellt");
    await expect(page.getByTestId("kartenserien-ersetzen")).toBeDisabled();
});

test("🔴 Fassungen: die vorige steht da, „Zurück auf diese Fassung“ schaltet nur den Zeiger", async ({ page }) => {
    const server = kartenserienServer();
    await oeffnen(page, server);
    const fassungen = page.getByTestId("kartenserien-fassungen");
    await expect(fassungen.locator("li")).toHaveCount(2);
    await page.getByTestId("kartenserien-fassung-zurueck-0a0b0c0d0e0f").click();
    await expect.poll(() => server.posts.at(-1)?.["aktion"]).toEqual({ art: "fassung", revision: "0a0b0c0d0e0f" });
    await expect(page.getByTestId("kartenserien-fassung-0a0b0c0d0e0f")).toContainText("aktiv");
});

// ── Papierkorb mit Frist, Nach Production übernehmen (Schnitt 4) ──────────────────────────────────────────────────────────────────

test("🔴 Nach Production übernehmen: nur die Betreiber, mit Rückfrage; danach wartet die Übernahme an der Serie", async ({
    page,
}) => {
    const server = kartenserienServer();
    await oeffnen(page, server);
    await page.getByTestId("kartenserien-zeile-original").click();
    await page.getByTestId("kartenserien-uebernehmen").click();
    const frage = page.getByTestId("kartenserien-uebernehmen-frage");
    await expect(frage).toContainText("„Original“ nach Production übernehmen?");
    await expect(frage).toContainText("Fassung 1d40b5257c2f");
    await frage.getByRole("button", { name: "Übernehmen" }).click();
    await expect.poll(() => server.posts.at(-1)).toMatchObject({ id: "original", production: true });
    await expect(page.getByTestId("kartenserien-uebernahme-stand")).toContainText("wartet in der Warteschlange");
    await expect(page.getByTestId("kartenserien-uebernehmen")).toBeDisabled();
});

test("ohne das Recht der Betreiber ist „Nach Production übernehmen“ gesperrt", async ({ page }) => {
    const server = kartenserienServer();
    await oeffnen(page, server, [...ADMIN_CAPABILITIES, "manage_map_series"]);
    await page.getByTestId("kartenserien-zeile-original").click();
    await expect(page.getByTestId("kartenserien-uebernehmen")).toBeDisabled();
});

test("🔴 auf Production: kein Ersetzen, kein Papierkorb, kein Übernehmen, dafür der Hinweis", async ({ page }) => {
    const server = kartenserienServer();
    await oeffnen(page, server, BETREIBER, "production");
    await expect(page.getByTestId("kartenserien-production-hinweis")).toContainText(
        "Auf Production wird hier nichts hochgeladen oder gelöscht.",
    );
    await expect(page.getByTestId("kartenserien-ersetzen")).toHaveCount(0);
    await expect(page.getByTestId("kartenserien-loeschen")).toHaveCount(0);
    await expect(page.getByTestId("kartenserien-uebernehmen")).toHaveCount(0);
    await expect(page.getByTestId("kartenserien-neu")).toBeDisabled();
});

/** Wie viele Zeilen der Text eines Elements im Browser belegt (die Rechtecke seiner Zeilen, nach ihrer Oberkante gezählt). */
const zeilenAnzahl = (ort: Locator) =>
    ort.evaluate((el) => {
        const bereich = document.createRange();
        bereich.selectNodeContents(el);
        return new Set([...bereich.getClientRects()].map((r) => Math.round(r.top))).size;
    });

test("🔴 auf Production steht der Grund der Sperre genau einmal; die Zeilen der Liste bleiben heil (Befund 2026-10-25)", async ({
    page,
}) => {
    const server = kartenserienServer();
    await oeffnen(page, server, BETREIBER, "production");
    const seite = page.getByTestId("kartenserien");
    const hinweis = page.getByTestId("kartenserien-production-hinweis");
    // Der Satz steht einmal, oben: nicht an den ▲/▼, nicht unter Name und Beschreibung, nicht an den Knöpfen darunter, nicht als zweiter Kasten.
    await expect(seite.getByText("Auf Production wird hier nichts")).toHaveCount(1);
    await expect(hinweis).toBeVisible();
    await expect(seite.getByTestId("sperrgrund")).toHaveCount(0);
    await expect(page.getByTestId("kartenserien-liste").getByText("Auf Production")).toHaveCount(0);
    // Die gesperrten Elemente bleiben gesperrt, zeigen aber auf den Satz (aria-describedby) und tragen den Grund als title.
    const kennung = await hinweis.getAttribute("id");
    expect(kennung).toBeTruthy();
    for (const ort of [
        page.getByTestId("kartenserien-name").locator("input"),
        page.getByTestId("kartenserien-beschreibung"),
        page.getByTestId("kartenserien-neu"),
        page.getByTestId("kartenserien-hoch-original"),
        page.getByTestId("kartenserien-runter-original"),
        page.getByTestId("kartenserien-ausschnitt-oeffnen"),
        page.getByTestId("kartenserien-lizenz-bearbeiten"),
    ]) {
        await expect(ort).toBeDisabled();
        await expect(ort).toHaveAttribute("aria-describedby", kennung!);
        await expect(ort).toHaveAttribute("title", /Auf Production wird hier nichts geändert/u);
    }
    // Der erste hat kein ▲, der letzte kein ▼: gesperrt ohne Satz, wie überall im Haus.
    await expect(page.getByTestId("kartenserien-hoch-modern")).toBeDisabled();
    await expect(page.getByTestId("kartenserien-runter-old")).toBeDisabled();
    // Die Zeilen der Liste sehen aus wie auf der Stage: der Titel in einer Zeile (nicht „Ori-gi-nal“), die Angaben höchstens in zweien.
    for (const id of ["modern", "original", "old"]) {
        const zeile = page.getByTestId(`kartenserien-zeile-${id}`);
        expect(await zeilenAnzahl(zeile.locator(".kartenserien__name"))).toBe(1);
        expect(await zeilenAnzahl(zeile.locator(".kartenserien__unter"))).toBeLessThanOrEqual(2);
        expect((await zeile.boundingBox())!.width).toBeGreaterThan(220);
    }
});

test("🔴 ohne Sonderrecht steht der Grund der Sperre ebenfalls nur einmal, nicht an jedem Feld und Knopf", async ({
    page,
}) => {
    const server = kartenserienServer();
    await oeffnen(page, server, ADMIN_CAPABILITIES);
    const seite = page.getByTestId("kartenserien");
    await expect(seite.getByText("Ändern braucht das Recht")).toHaveCount(1);
    // Eigene Gründe eines Knopfs (Vorgabe nicht löschbar, übernehmen nur die Betreiber) stehen weiter an ihm; der der ganzen Seite nicht.
    await expect(seite.getByTestId("sperrgrund").filter({ hasText: "Ändern braucht das Recht" })).toHaveCount(0);
    await expect(page.getByTestId("kartenserien-name").locator("input")).toHaveAttribute(
        "aria-describedby",
        (await page.getByTestId("kartenserien-nur-lesen").getAttribute("id"))!,
    );
    await expect(page.getByTestId("kartenserien-hoch-original")).toBeDisabled();
});
