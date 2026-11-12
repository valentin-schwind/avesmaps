import { expect, test, type Page } from "@playwright/test";
import { kanalServer, kanalVorgaenge, stubKanal, type KanalServer } from "./kanal-stub.ts";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der Betreiber-Kanal „Claudia & Claudio“ in der Systemsteuerung (WI-0124, KANAL-0001 K3, Blatt `review/wi-0124-mockup/`). Sitzung und
 * Verwaltung kommen aus `verwaltung-stub.ts`, der Kanal aus `kanal-stub.ts`. Geprüft wird, was der Betreiber sieht und schickt: der Eintrag
 * nur mit `use_operator_channel`, drei Reiter, Melden mit Pflichtfeldern, Abnehmen und Wieder öffnen mit der Revision, Löschen erst nach
 * der Abnahme und mit Rückfrage, ein Konflikt als Satz, Text als Text.
 *
 * Seit `f797a05a` (WI-0176, OPS-000012, 2026-10-15) heißt die ganze Wortfamilie in der Anzeige „akzeptieren“: Reiter „Zu akzeptieren“,
 * Status „zu akzeptieren“ und „akzeptiert“, Knopf „Akzeptieren“. Schlüssel, Statuswerte, Kennungen und API (`/abnehmen`) blieben.
 */
const BETREIBER = [...ADMIN_CAPABILITIES, "manage_system_settings", "use_operator_channel"];

async function oeffnen(page: Page, server: KanalServer = kanalServer()) {
    await stubAdmin(page, { role: "operator", capabilities: BETREIBER });
    await stubKanal(page, server);
    await page.goto("/edit");
    await page.getByTestId("kopfleiste-menue").click();
    await page.getByTestId("menue-systemsteuerung").click();
    const fenster = page.getByRole("dialog", { name: "Systemsteuerung" });
    await expect(fenster).toBeVisible();
    await page.getByTestId("verwaltung-eintrag-claudio").click();
    await expect(page.getByTestId("kanal-liste")).toBeVisible();
    return { fenster, server };
}

const posts = (server: KanalServer, ende: string) =>
    server.posts.filter((post) => post.path.endsWith(ende)).map((post) => post.body);

test("🔴 der Betreiber sieht „Claudia & Claudio“ vor dem Protokoll, mit der Zahl zur Abnahme; drei Reiter mit ihren Vorgängen", async ({
    page,
}) => {
    await oeffnen(page);
    const eintrag = page.getByTestId("verwaltung-eintrag-claudio");
    await expect(eintrag).toHaveAttribute("aria-current", "page");
    await expect(eintrag).toContainText("Claudia & Claudio");
    await expect(eintrag).toContainText("1");
    await expect(page.getByTestId("kanal-takt")).toContainText("Claudio");

    await expect(page.getByTestId("kanal-reiter-offen")).toHaveText("Offen (1)");
    await expect(page.getByTestId("kanal-reiter-abnahme")).toHaveText("Zu akzeptieren (1)");
    await expect(page.getByTestId("kanal-reiter-archiv")).toHaveText("Archiv (1)");
    await expect(page.locator("[data-testid^='kanal-zeile-']")).toHaveCount(1);
    await expect(page.getByTestId("kanal-zeile-OPS-000134")).toContainText("Stage lädt keine Kacheln");
    await expect(page.getByTestId("kanal-zeile-OPS-000134")).toContainText("Hesindiane");

    await page.getByTestId("kanal-reiter-abnahme").click();
    await expect(page.getByTestId("kanal-zeile-OPS-000127")).toContainText("See-321 wird sichtbar");
    await page.getByTestId("kanal-reiter-archiv").click();
    // Nach dem Ablauf bleibt der Rest: Kurztitel statt Titel, „Meldung gelöscht“.
    await expect(page.getByTestId("kanal-zeile-OPS-000098")).toContainText(
        "Infopanel zeigte Platzhalternamen bei Seen",
    );
    await expect(page.getByTestId("kanal-zeile-OPS-000098")).toContainText("Meldung gelöscht");
});

test("🔴 der Trichter der Vorgänge: Kategorie, Priorität und Zuständig mit Trefferzahl; die Reiter bleiben, die Wahl gilt in allen", async ({
    page,
}) => {
    await oeffnen(page);
    // Eine Zeile: Reiter, gleich daneben der Trichter; keine Klappliste und keine Segmente mehr.
    await expect(page.getByTestId("kanal-liste").locator("select")).toHaveCount(0);
    await expect(page.getByTestId("kanal-reiter-offen")).toBeVisible();
    await page.getByTestId("kanal-filter").click();
    const blatt = page.getByTestId("kanal-filter-blatt");
    await expect(blatt.locator("legend")).toHaveText(["Kategorie", "Priorität", "Zuständig"]);
    await expect(blatt.getByTestId("kanal-filter-zustaendig").locator("label")).toHaveText(["Claudio1", "Claudia0"]);
    await blatt.getByTestId("kanal-filter-zustaendig-claudia").check();
    await expect(page.getByTestId("kanal-leer")).toBeVisible();
    await expect(page.getByTestId("kanal-filter-zahl")).toHaveText("1");
    await page.keyboard.press("Escape");
    // In „Zu akzeptieren“ ist Claudia zuständig: Die Wahl gilt dort weiter, die Zeile steht da.
    await page.getByTestId("kanal-reiter-abnahme").click();
    await expect(page.locator("[data-testid^='kanal-zeile-']")).toHaveCount(1);
    await expect(page.getByTestId("kanal-zeile-OPS-000127")).toBeVisible();
    await page.getByTestId("kanal-reiter-offen").click();
    await page.getByTestId("kanal-filter").click();
    await page.getByTestId("kanal-filter-blatt").getByRole("button", { name: "Filter lösen" }).click();
    await expect(page.getByTestId("kanal-zeile-OPS-000134")).toBeVisible();
    await expect(page.getByTestId("kanal-filter-zahl")).toHaveCount(0);
});

test("🔴 Suche der Vorgänge links in der Leiste: geht als q an den Server, gilt in allen Reitern; ohne Treffer ein Satz mit dem Wort", async ({
    page,
}) => {
    await oeffnen(page);
    const anfragen: string[] = [];
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/kanal/vorgaenge") anfragen.push(url.search);
    });
    const suche = page.getByTestId("kanal-leiste-suche").locator("input");
    await expect(page.getByTestId("kanal-leiste").getByTestId("kanal-filter")).toBeVisible();
    await suche.fill("kacheln");
    await expect.poll(() => anfragen.at(-1)).toBe("?reiter=offen&q=kacheln");
    await expect(page.getByTestId("kanal-zeile-OPS-000134")).toBeVisible();
    await suche.fill("Punin");
    await expect(page.getByTestId("kanal-leer")).toHaveText("Kein Vorgang mit „Punin“ in diesem Reiter.");
    await page.getByTestId("kanal-reiter-abnahme").click();
    await expect.poll(() => anfragen.at(-1)).toBe("?reiter=abnahme&q=Punin");
    await suche.press("Escape");
    await expect(suche).toHaveValue("");
    await expect(page.getByTestId("kanal-zeile-OPS-000127")).toBeVisible();
});

test("🔴 ein Admin ohne `use_operator_channel` hat den Eintrag nicht, auch nicht über den tiefen Link", async ({
    page,
}) => {
    await stubAdmin(page);
    const server = await stubKanal(page);
    await page.goto("/edit?verwaltung=claudio");
    await expect(page.getByTestId("kopfleiste-menue")).toBeVisible();
    await expect(page.getByTestId("verwaltung-eintrag-claudio")).toHaveCount(0);
    await expect(page.getByTestId("kanal-liste")).toHaveCount(0);
    expect(server.posts).toHaveLength(0);
});

test("🔴 Vorgang melden: Titel und Nachricht sind Pflicht, das Gerät geht mit, danach steht der neue Vorgang offen", async ({
    page,
}) => {
    const { server } = await oeffnen(page);
    await page.getByTestId("kanal-melden").click();
    await expect(page.getByTestId("kanal-melden-formular")).toBeVisible();
    await page.getByTestId("kanal-absenden").click();
    await expect(page.getByTestId("kanal-melden-formular")).toContainText("Titel und Nachricht fehlen noch.");
    expect(posts(server, "/api/kanal/vorgaenge")).toHaveLength(0);

    await page.getByTestId("kanal-kategorie-umbau").click();
    await page.getByTestId("kanal-prioritaet").getByText("Hoch").click();
    await page.getByTestId("kanal-titel").fill("Stadtnamen größer");
    await page.getByTestId("kanal-nachricht").fill("Die Namen der Großstädte dürfen eine Stufe größer sein.");
    await page.getByTestId("kanal-geraet").fill("Laptop · Edge");
    await page.getByTestId("kanal-absenden").click();

    await expect(page.getByTestId("kanal-vorgang-OPS-000138")).toBeVisible();
    await expect(page.getByTestId("kanal-meldung")).toContainText(
        "Die Namen der Großstädte dürfen eine Stufe größer sein.",
    );
    const [body] = posts(server, "/api/kanal/vorgaenge");
    expect(body).toMatchObject({
        kategorie: "umbau",
        prioritaet: "hoch",
        titel: "Stadtnamen größer",
        nachricht: "Die Namen der Großstädte dürfen eine Stufe größer sein.",
        kontext: { geraet: "Laptop · Edge" },
    });
    expect(typeof body?.["operationId"]).toBe("string");
});

test("🔴 Akzeptieren schickt die Revision; danach „akzeptiert“, und die Meldung lässt sich nach Rückfrage jetzt löschen", async ({
    page,
}) => {
    const { server } = await oeffnen(page);
    await page.getByTestId("kanal-reiter-abnahme").click();
    await page.getByTestId("kanal-zeile-OPS-000127").click();
    const vorgang = page.getByTestId("kanal-vorgang-OPS-000127");
    await expect(vorgang).toBeVisible();
    await expect(page.getByTestId("kanal-status")).toHaveText("zu akzeptieren");
    await expect(page.getByTestId("kanal-fixbericht")).toContainText("Platzhalterregel im geteilten Paket");
    // Commits sind Links auf GitHub (WI-0137 §4): in der Nachweis-Leiste und im Fix-Bericht.
    const commit = "https://github.com/valentin-schwind/avesmaps3D/commit/b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621";
    await expect(page.getByTestId("kanal-nachweise").getByRole("link", { name: "b7e2d41" }).first()).toHaveAttribute(
        "href",
        commit,
    );
    await expect(page.getByTestId("kanal-fixbericht").getByRole("link", { name: "b7e2d41" })).toHaveAttribute(
        "href",
        commit,
    );

    await page.getByTestId("kanal-abnehmen").click();
    await expect(page.getByTestId("kanal-status")).toHaveText("akzeptiert");
    expect(posts(server, "/abnehmen")).toEqual([expect.objectContaining({ baseRevision: 9 })]);
    await expect(page.getByTestId("kanal-ende")).toContainText("der Fix-Bericht bleibt");

    await page.getByTestId("kanal-loeschen").click();
    const frage = page.getByTestId("kanal-loeschen-frage");
    await expect(frage).toContainText("OPS-000127");
    await expect(frage).toContainText("Platzhaltername See-321 im Infopanel sichtbar");
    expect(posts(server, "/loeschen")).toHaveLength(0);
    await frage.getByRole("button", { name: "Jetzt löschen" }).click();
    await expect.poll(() => posts(server, "/loeschen").length).toBe(1);
    await expect(page.getByTestId("kanal-rest")).toBeVisible();
    await expect(page.getByTestId("kanal-ende")).toHaveCount(0);
});

test("🔴 Wieder öffnen verlangt einen Kommentar und schickt ihn mit der Revision", async ({ page }) => {
    const { server } = await oeffnen(page);
    await page.getByTestId("kanal-reiter-abnahme").click();
    await page.getByTestId("kanal-zeile-OPS-000127").click();
    await page.getByTestId("kanal-wieder").click();
    const frage = page.getByTestId("kanal-wieder-frage");
    const bestaetigen = frage.getByRole("button", { name: "Wieder öffnen mit Kommentar" });
    await expect(bestaetigen).toBeDisabled();
    await page.getByTestId("kanal-kommentar").fill("Am Telefon steht der Name noch.");
    await bestaetigen.click();
    await expect(page.getByTestId("kanal-status")).toHaveText("in Arbeit");
    expect(posts(server, "/wieder-oeffnen")).toEqual([
        expect.objectContaining({ baseRevision: 9, kommentar: "Am Telefon steht der Name noch." }),
    ]);
    await expect(page.getByTestId("kanal-verlauf")).toContainText("Am Telefon steht der Name noch.");
});

test("🔴 ein Konflikt kommt als Satz, der Vorgang ist neu geladen", async ({ page }) => {
    const server = kanalServer();
    await oeffnen(page, server);
    await page.getByTestId("kanal-reiter-abnahme").click();
    await page.getByTestId("kanal-zeile-OPS-000127").click();
    await expect(page.getByTestId("kanal-abnehmen")).toBeVisible();
    // Inzwischen hat jemand anderes geschrieben.
    server.vorgaenge.find((v) => v.ops === "OPS-000127")!.revision = 10;
    await page.getByTestId("kanal-abnehmen").click();
    await expect(page.getByRole("alert").filter({ hasText: "Jemand war schneller" })).toBeVisible();
    await expect(page.getByTestId("kanal-status")).toHaveText("zu akzeptieren");
    // Neu geladen: Der nächste Versuch trägt die neue Revision und geht durch.
    await page.getByTestId("kanal-abnehmen").click();
    await expect(page.getByTestId("kanal-status")).toHaveText("akzeptiert");
    expect(posts(server, "/abnehmen").map((body) => body["baseRevision"])).toEqual([9, 10]);
});

test("🔴 Nachrichten stehen als Text da, nie als HTML; Antworten landen im Verlauf", async ({ page }) => {
    const vorgaenge = kanalVorgaenge();
    vorgaenge[0]!.nachricht = '<img src=x onerror="window.__kanalXss=1"> Kacheln fehlen';
    const { server } = await oeffnen(page, kanalServer(vorgaenge));
    await page.getByTestId("kanal-zeile-OPS-000134").click();
    await expect(page.getByTestId("kanal-meldung")).toContainText(
        '<img src=x onerror="window.__kanalXss=1"> Kacheln fehlen',
    );
    await expect(page.getByTestId("kanal-meldung").locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __kanalXss?: number }).__kanalXss)).toBeUndefined();

    await expect(page.getByTestId("kanal-verlauf")).toContainText("Welches Telefon und welcher Browser?");
    await page.getByTestId("kanal-antwort").fill("Pixel 7, Chrome");
    await page.getByTestId("kanal-senden").click();
    await expect(page.getByTestId("kanal-verlauf")).toContainText("Pixel 7, Chrome");
    expect(posts(server, "/nachricht")).toEqual([expect.objectContaining({ text: "Pixel 7, Chrome" })]);
});

test("🔴 Protokoll › Fix-Berichte: nur mit dem Kanal, ohne Wer und Zeitraum, dauerhaft; die OPS-ID öffnet den Vorgang", async ({
    page,
}) => {
    const { fenster } = await oeffnen(page);
    await page.getByTestId("verwaltung-eintrag-protokoll-system").click();
    // Art, Wer und Zeitraum stehen im Trichter (Hausregel §13.45).
    await page.getByTestId("protokoll-filter").click();
    await expect(page.getByTestId("protokoll-filter-art").locator("label")).toHaveText([
        "alle",
        "Betrieb & Datenabgleich",
        "Notzugang",
        "Alles, auch Konten",
        "Fix-Berichte",
    ]);
    await page.getByTestId("protokoll-filter-art-aenderungen").check();
    const tafel = page.getByTestId("berichte-tafel");
    await expect(tafel).toBeVisible();
    // Fix-Berichte kennen weder Wer noch Zeitraum: Im Blatt bleibt nur die Art.
    await expect(page.getByTestId("protokoll-filter-wer")).toHaveCount(0);
    await expect(page.getByTestId("protokoll-filter-zeitraum")).toHaveCount(0);
    await expect(page.getByTestId("protokoll-filter-zahl")).toHaveText("1");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("protokoll-filter-blatt")).toHaveCount(0);
    await expect(fenster.locator(".avm-fenster__fuss-hinweis")).toHaveText(
        "Einträge lassen sich weder ändern noch löschen. Die Änderungen von Claudia und Claudio bleiben dauerhaft.",
    );
    // Neueste oben; der Bericht ohne Vorgang nennt seinen Grund.
    await expect(tafel.locator("tbody tr")).toHaveCount(2);
    await expect(page.getByTestId("bericht-41")).toContainText("Platzhalterregel im geteilten Paket · B · Code");
    await expect(page.getByTestId("bericht-41")).toContainText("Commit b7e2d41 · Release 20261011T093012Z-b7e2d41");
    await expect(page.getByTestId("bericht-41").getByRole("link", { name: "b7e2d41" })).toHaveAttribute(
        "href",
        "https://github.com/valentin-schwind/avesmaps3D/commit/b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621",
    );
    await expect(page.getByTestId("bericht-41")).toContainText("● unauffällig");
    await expect(page.getByTestId("bericht-41")).toContainText("Claudia ok");
    await expect(page.getByTestId("bericht-40")).toContainText(
        "Dienst neu gestartet nach Speicherspitze · A · Betrieb (Grund: Routine)",
    );
    await expect(page.getByTestId("bericht-40")).toContainText("kein Commit");

    await page.getByTestId("bericht-ops-OPS-000127").click();
    await expect(page.getByTestId("verwaltung-eintrag-claudio")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("kanal-vorgang-OPS-000127")).toBeVisible();
    await page.getByTestId("kanal-zurueck").click();
    await expect(page.getByTestId("kanal-liste")).toBeVisible();
});

/** Maße und Format einer hochgeladenen Datei aus ihrem Kopf (WebP VP8, VP8L, VP8X oder PNG). */
function kopf(bytes: Buffer): { format: string; breite: number; hoehe: number } {
    if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
        const chunk = bytes.subarray(12, 16).toString("ascii");
        if (chunk === "VP8X")
            return { format: "webp", breite: 1 + bytes.readUIntLE(24, 3), hoehe: 1 + bytes.readUIntLE(27, 3) };
        if (chunk === "VP8 ")
            return { format: "webp", breite: bytes.readUInt16LE(26) & 0x3fff, hoehe: bytes.readUInt16LE(28) & 0x3fff };
        if (chunk === "VP8L") {
            const b = bytes.readUInt32LE(21);
            return { format: "webp", breite: (b & 0x3fff) + 1, hoehe: ((b >> 14) & 0x3fff) + 1 };
        }
    }
    if (bytes.readUInt32BE(0) === 0x89504e47)
        return { format: "png", breite: bytes.readUInt32BE(16), hoehe: bytes.readUInt32BE(20) };
    throw new Error("unbekanntes Format");
}
const FOTO = new URL("./fixtures/kanal-foto-gps.jpg", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1");

test("🔴 Bild anhängen: ein Telefonfoto 4032 × 3024 hochkant (EXIF) geht aufrecht mit 2560 px und ohne EXIF und GPS hinaus; entfernen fragt", async ({
    page,
}) => {
    const { server } = await oeffnen(page);
    await page.getByTestId("kanal-zeile-OPS-000134").click();
    await page.getByTestId("kanal-bild-datei").setInputFiles(FOTO);
    await expect.poll(() => posts(server, "/bilder").length).toBe(1);
    const [body] = posts(server, "/bilder");
    const bytes = Buffer.from((body?.["file"] as { dataBase64: string }).dataBase64, "base64");
    expect(kopf(bytes)).toEqual({ format: "webp", breite: 1920, hoehe: 2560 });
    expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
    expect(bytes.includes(Buffer.from("GPS"))).toBe(false);
    expect((body?.["file"] as { name: string }).name).toBe("kanal-foto-gps.webp");

    const bild = page.locator("[data-testid^='kanal-bild-6b616e61']").first();
    await expect(bild).toContainText("Bildschirmfoto · 1.920 × 2.560 · ohne Ortsangabe");
    await expect(bild.locator("img")).toHaveAttribute("src", /\/api\/kanal\/bilder\/[0-9a-f-]{36}\?groesse=vorschau$/u);
    await page.locator("[data-testid^='kanal-bild-entfernen-']").click();
    const frage = page.locator("[data-testid^='kanal-bild-frage-']");
    await expect(frage).toContainText("auch für Claudio");
    expect(posts(server, "/entfernen")).toHaveLength(0);
    await frage.getByRole("button", { name: "Entfernen" }).click();
    await expect.poll(() => posts(server, "/entfernen").length).toBe(1);
    await expect(page.getByTestId("kanal-verlauf")).toContainText("Bild entfernt");
});

test("Vorgang melden mit Bild: erst der Vorgang, dann das Bild an seine OPS-Nummer", async ({ page }) => {
    const { server } = await oeffnen(page);
    await page.getByTestId("kanal-melden").click();
    await page.getByTestId("kanal-bild-anhaengen-datei").setInputFiles(FOTO);
    await expect(page.getByTestId("kanal-bilder-gewaehlt")).toContainText("kanal-foto-gps.jpg");
    await page.getByTestId("kanal-titel").fill("Karte grau");
    await page.getByTestId("kanal-nachricht").fill("Bei Gareth bleibt die Karte grau.");
    await page.getByTestId("kanal-absenden").click();
    await expect(page.getByTestId("kanal-vorgang-OPS-000138")).toBeVisible();
    await expect
        .poll(() => server.posts.map((post) => post.path))
        .toEqual(["/api/kanal/vorgaenge", "/api/kanal/vorgaenge/OPS-000138/bilder"]);
    await expect(page.locator("[data-testid^='kanal-bild-6b616e61']")).toContainText("ohne Ortsangabe");
});

/** Hält Anfragen an `muster` fest, bis `loslassen()` kommt (für den Zustand „wird gesendet“). */
async function tor(page: Page, muster: string): Promise<{ erreicht: Promise<void>; loslassen: () => void }> {
    let loslassen: () => void = () => undefined;
    let erreicht: () => void = () => undefined;
    const offen = new Promise<void>((resolve) => (loslassen = resolve));
    const da = new Promise<void>((resolve) => (erreicht = resolve));
    await page.route(muster, async (route) => {
        if (route.request().method() === "POST") {
            erreicht();
            await offen;
        }
        await route.fallback();
    });
    return { erreicht: da, loslassen };
}

const ERWARTUNG = "Claudio schaut normalerweise im 30-Minuten-Takt nach.";

test("🔴 nach dem Absenden eine Bestätigung mit OPS-Nummer und Erwartung; gesperrt, solange gesendet wird, auch während der Bilder", async ({
    page,
}) => {
    // Befund vom Stage-Release 5c37bc88 (Claudio, 13b7f0b3): ohne Bestätigung sendete der Betreiber ein zweites Mal.
    const { server } = await oeffnen(page);
    const bildTor = await tor(page, "**/api/kanal/vorgaenge/*/bilder");
    await page.getByTestId("kanal-melden").click();
    await page.getByTestId("kanal-bild-anhaengen-datei").setInputFiles(FOTO);
    await page.getByTestId("kanal-titel").fill("Karte grau");
    await page.getByTestId("kanal-nachricht").fill("Bei Gareth bleibt die Karte grau.");
    await page.getByTestId("kanal-absenden").click();
    await bildTor.erreicht;
    await expect(page.getByTestId("kanal-absenden")).toBeDisabled();
    await expect(page.getByTestId("kanal-melden-formular").getByTestId("sperrgrund")).toHaveText("Wird gesendet …");
    bildTor.loslassen();
    await expect(page.getByTestId("kanal-bestaetigung")).toHaveText(`Vorgang OPS-000138 angelegt. ${ERWARTUNG}`);
    await expect(page.getByTestId("kanal-bestaetigung")).toHaveAttribute("role", "status");
    expect(posts(server, "/api/kanal/vorgaenge")).toHaveLength(1);

    // Eine Nachricht im Vorgang: gesperrt, solange sie läuft; danach die Bestätigung und ein leeres Feld.
    const nachrichtTor = await tor(page, "**/api/kanal/vorgaenge/OPS-000138/nachricht");
    await page.getByTestId("kanal-antwort").fill("Auch in Punin.");
    await page.getByTestId("kanal-senden").click();
    await nachrichtTor.erreicht;
    await expect(page.getByTestId("kanal-senden")).toBeDisabled();
    nachrichtTor.loslassen();
    await expect(page.getByTestId("kanal-bestaetigung")).toHaveText(`Nachricht zu OPS-000138 gesendet. ${ERWARTUNG}`);
    await expect(page.getByTestId("kanal-antwort")).toHaveValue("");
    expect(posts(server, "/nachricht")).toHaveLength(1);
});

const WARTET = "Der Vorgang wartet, bis die Routine wieder läuft.";

test("🔴 holt Claudio seit über einer Stunde nicht ab, sagen Liste, Vorgang, Bestätigung und Fuß es; kein 30-Minuten-Takt", async ({
    page,
}) => {
    // Befund Claudio (Übergabe 2026-10-11, Abendarbeit): Der Betreiber wartete 40 Minuten, ohne zu sehen, dass niemand abholt.
    const server = kanalServer();
    server.abgeholtVor.claudio = 3 * 3_600_000;
    const { fenster } = await oeffnen(page, server);
    await expect(page.getByTestId("kanal-abholung")).toHaveText(
        "Claudio holt gerade nicht ab, zuletzt vor 3 Std. Neue Vorgänge warten, bis die Routine wieder läuft.",
    );
    await expect(page.getByTestId("kanal-takt")).toHaveCount(0);
    await expect(fenster).not.toContainText("30-Minuten-Takt");
    await page.getByTestId("kanal-zeile-OPS-000134").click();
    await expect(page.getByTestId("kanal-vorgang-abholung")).toHaveText(
        `Claudio holt gerade nicht ab, zuletzt vor 3 Std. ${WARTET}`,
    );
    await page.getByTestId("kanal-antwort").fill("Noch da?");
    await page.getByTestId("kanal-senden").click();
    await expect(page.getByTestId("kanal-bestaetigung")).toHaveText(
        `Nachricht zu OPS-000134 gesendet. Claudio holt gerade nicht ab, zuletzt vor 3 Std. ${WARTET}`,
    );
    await expect(fenster).not.toContainText("30-Minuten-Takt");
});

test("🔴 hat Claudio noch nie abgeholt, steht das so da; frisch abgeholt bleibt der Satz zum Takt, ohne Warnung", async ({
    page,
}) => {
    const nie = kanalServer();
    nie.abgeholtVor.claudio = null;
    await oeffnen(page, nie);
    await expect(page.getByTestId("kanal-abholung")).toHaveText(
        "Claudio hat noch nie abgeholt. Neue Vorgänge warten, bis die Routine wieder läuft.",
    );
    await page.getByTestId("kanal-zeile-OPS-000134").click();
    await expect(page.getByTestId("kanal-vorgang-abholung")).toHaveText(`Claudio hat noch nie abgeholt. ${WARTET}`);

    // Holt die Routine wieder ab, zeigt das der nächste Blick (zurück zur Liste, Vorgang öffnen): der Satz wie bisher, keine Warnung.
    nie.abgeholtVor.claudio = 10 * 60_000;
    await page.getByTestId("kanal-zurueck").click();
    await expect(page.getByTestId("kanal-takt")).toContainText("Bearbeitung normalerweise im 30-Minuten-Takt");
    await expect(page.getByTestId("kanal-abholung")).toHaveCount(0);
    await page.getByTestId("kanal-zeile-OPS-000134").click();
    await expect(page.getByTestId("kanal-vorgang-abholung")).toHaveCount(0);
});

test("🔴 ein Fehler beim Senden bleibt als Satz stehen, der Entwurf bleibt, keine Bestätigung", async ({ page }) => {
    await oeffnen(page);
    await page.getByTestId("kanal-zeile-OPS-000134").click();
    await page.route("**/api/kanal/vorgaenge/OPS-000134/nachricht", (route) =>
        route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "internal", message: "vom Nachbau" } }),
        }),
    );
    await page.getByTestId("kanal-antwort").fill("Noch ein Hinweis.");
    await page.getByTestId("kanal-senden").click();
    await expect(page.getByTestId("kanal-vorgang-OPS-000134").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("kanal-antwort")).toHaveValue("Noch ein Hinweis.");
    await expect(page.getByTestId("kanal-bestaetigung")).toHaveCount(0);
    await expect(page.getByTestId("kanal-senden")).toBeEnabled();
});
