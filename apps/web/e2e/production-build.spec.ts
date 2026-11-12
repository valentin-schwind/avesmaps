import { existsSync, readdirSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ZAHLEN } from "./besucherstatistik-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Der PRODUCTION-BUILD, nicht der Dev-Server.
 *
 * 💣 Genau hier lag der blinde Fleck: jeder andere Browsertest läuft gegen `npm run dev`, und der
 * Production-Build wurde nie im Browser geöffnet. Auf Stage war die Karte dann leer — MapLibre
 * lief, der Canvas stand, die Koordinatenanzeige reagierte, und **keine einzige Vektorebene**
 * erschien.
 *
 * Die Ursache war eine fehlende Datei. MapLibre baut seine Worker-URL selbst zusammen
 * (`new URL(`./${name}`, import.meta.url)`), und dieses Muster kann kein Bundler statisch
 * auflösen; die Worker-Datei wurde deshalb nicht emittiert. Der Request lief in den SPA-Fallback
 * und bekam **HTTP 200 mit `text/html`** statt JavaScript.
 *
 * 🪤 Drei Dinge machen diesen Fehler so teuer:
 *   - Der Status ist 200. Ein `curl` auf die Kachelquellen findet nichts, weil die Kacheln völlig
 *     in Ordnung sind — sie werden nur nie abgefragt.
 *   - Es gibt **keine** Fehlermeldung. Weder eine Ausnahme noch ein `map.on("error")`.
 *   - MapLibre wirkt intakt: die Karte reagiert auf die Maus, nur der Style wird nie fertig.
 *
 * Der Test braucht einen Build und die Vorschau auf Port 4181; beides erledigt `npm run test:e2e:build --workspace @avesmaps3d/web`
 * (`playwright.build.config.ts`, WI-0189).
 */

const PREVIEW = "http://localhost:4181/";
const distAssets = fileURLToPath(new URL("../dist/assets/", import.meta.url));

/** So läuft diese Datei: Der Befehl baut, startet die Vorschau und fährt sie (WI-0189). */
const ANLEITUNG = "npm run test:e2e:build --workspace @avesmaps3d/web";

/** Die neueste Quelle, aus der der Build entsteht; ist sie jünger als `dist/index.html`, prüfte die Datei einen alten Stand. */
function neuesteQuelle(): { datei: string; zeit: number } {
    const wurzeln = ["../src/", "../../../packages/shared/src/", "../index.html", "../vite.config.ts"].map((pfad) =>
        fileURLToPath(new URL(pfad, import.meta.url)),
    );
    let neueste = { datei: "", zeit: 0 };
    for (const wurzel of wurzeln) {
        const dateien = statSync(wurzel).isDirectory()
            ? readdirSync(wurzel, { recursive: true, withFileTypes: true })
                  .filter((eintrag) => eintrag.isFile())
                  .map((eintrag) => `${eintrag.parentPath}/${eintrag.name}`)
            : [wurzel];
        for (const datei of dateien) {
            const zeit = statSync(datei).mtimeMs;
            if (zeit > neueste.zeit) neueste = { datei, zeit };
        }
    }
    return neueste;
}

/**
 * 💣 **Diese Datei lief im gewöhnlichen Browserlauf mit und war dort IMMER rot** (gemessen am 2026-10-06: `ENOENT` auf
 * `apps/web/dist/assets` und `ERR_CONNECTION_REFUSED` auf 4181, in jedem Volllauf, seit es sie gibt). Sie prüft den
 * PRODUCTION-Build, und `npm run test:e2e` baut keinen und startet keine Vorschau - sie hat deshalb einen eigenen Befehl
 * (`npm run test:e2e:build`, `docs/regeln/befehle.md`).
 *
 * 🔴 Drei Fälle, die immer rot sind, sind keine Prüfung mehr, sondern Rauschen, in dem ein echter Fund untergeht.
 * Fehlt eine Voraussetzung, ist das Ergebnis deshalb ein SICHTBARER SKIP mit der Anleitung, nie „grün“ und nie ein
 * roter Fall, der etwas anderes behauptet (Kap. 11.155, wie `curve-label-martin.spec.ts` es mit seiner Fixture hält).
 * 🪤 Mit Build und Vorschau prüft die Datei unverändert dasselbe - an der Zusicherung ändert sich nichts.
 */
let fehlt: string | null = null;

test.beforeAll(async () => {
    if (!existsSync(distAssets)) {
        fehlt = `es gibt keinen Production-Build: ${distAssets} fehlt`;
        return;
    }
    const quelle = neuesteQuelle();
    if (quelle.zeit > statSync(fileURLToPath(new URL("../dist/index.html", import.meta.url))).mtimeMs) {
        fehlt = `veralteter Build: ${quelle.datei} ist jünger als dist`;
        return;
    }
    try {
        await fetch(PREVIEW, { signal: AbortSignal.timeout(3_000) });
    } catch {
        fehlt = `auf ${PREVIEW} antwortet keine Vorschau`;
    }
});

test.beforeEach(() => {
    test.skip(fehlt !== null, `${fehlt ?? ""} — so läuft diese Datei: ${ANLEITUNG}`);
});

test("der Build emittiert die MapLibre-Worker-Datei", async () => {
    // Die billigste Prüfung zuerst: ohne die Datei im Build kann nichts anderes stimmen.
    const files = await readdir(distAssets);
    const worker = files.filter((name) => /maplibre.*worker.*\.m?js$/.test(name));
    expect(worker, `dist/assets enthält keinen MapLibre-Worker: ${files.join(", ")}`).not.toEqual([]);
});

test("der Worker kommt als JavaScript an, nicht als HTML", async ({ page }) => {
    const workerResponses: string[] = [];
    page.on("response", (response) => {
        if (/maplibre.*worker/i.test(response.url())) {
            workerResponses.push(`${String(response.status())} ${response.headers()["content-type"] ?? "-"}`);
        }
    });

    await page.goto(PREVIEW);
    await page.waitForTimeout(6000);

    expect(workerResponses.length, "der Worker wird überhaupt angefragt").toBeGreaterThan(0);
    for (const response of workerResponses) {
        // 🪤 Auf den Status allein ist kein Verlass - der SPA-Fallback antwortet mit 200. Der
        // Content-Type ist das, was den Unterschied zwischen Worker und Startseite ausmacht.
        expect(response, "Worker als JavaScript ausgeliefert").toMatch(/^200 (text|application)\/javascript/);
    }
});

/**
 * 💣 DIE Prüfung dieser Datei: kommen Vektorkacheln an?
 *
 * Alles andere kann grün sein, während die Karte leer bleibt. Genau das ist zweimal passiert:
 *
 *   1. Der Worker fehlte im Artefakt. Sein Request lief in den SPA-Fallback und bekam 200 mit
 *      `text/html`.
 *   2. Danach war der Worker da (200, `text/javascript`, 19 KB) — und startete trotzdem nicht: als
 *      MODUL-Worker importiert er `./maplibre-gl-shared.mjs`, und `?url` kopiert nur die eine
 *      Datei, ohne ihre Imports aufzulösen. Der Import lief ins 404, `new Worker()` scheiterte mit
 *      einem Error-Event OHNE Meldung, und der Fehler sah aus wie vorher.
 *
 * Beide Male war die Ursache verschieden und das Symptom identisch: keine Konsolenmeldung, keine
 * Ausnahme, kein einziger Kachel-Request. Deshalb steht hier die Frage, auf die es ankommt, und
 * nicht eine Stellvertreterfrage.
 *
 * 🪤 Ein früherer Anlauf maß stattdessen die Bildgröße, ein zweiter das Markerrot — beide blieben
 * ohne den Fix grün, weil das Geländeraster schon Farbe liefert und die Serie "Original" ihre
 * Ortsmarken IM RASTER trägt. Sie wurden entfernt statt geschärft, und deshalb blieb Fehler 2
 * unentdeckt, bis Stage ihn zeigte. Ein Stellvertreter, der auch ohne die Sache grün ist, kostet
 * mehr als er nützt.
 */
test("der Build lädt Vektorkacheln", async ({ page }) => {
    const vectorRequests: number[] = [];
    const errors: string[] = [];
    page.on("response", (response) => {
        if (response.url().includes("/tiles/vector/")) {
            vectorRequests.push(response.status());
        }
    });
    page.on("console", (message) => {
        if (message.type() === "error") {
            errors.push(message.text().slice(0, 200));
        }
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message.slice(0, 200)}`));

    await page.setViewportSize({ width: 1100, height: 750 });
    await page.goto(PREVIEW);
    await page.waitForTimeout(9000);

    expect(errors, "keine Fehler in der Konsole").toEqual([]);
    // Ohne laufenden Worker ist diese Zahl NULL - der Style wird nie fertig, und MapLibre fragt
    // keine einzige Quelle ab. Gemessen: mit Worker rund 60 Anfragen.
    expect(vectorRequests.length, "es werden Vektorkacheln angefragt").toBeGreaterThan(10);
    // 204 ist in Ordnung (leere Kachel), 4xx/5xx nicht.
    expect(vectorRequests.filter((status) => status >= 400)).toEqual([]);
});

/**
 * 💣 **Derselbe blinde Fleck, drei Tage später und an anderer Stelle** (Claudio 2026-10-13,
 * `handovers/2026-10-13-besucherstatistik-ohne-einstieg-an-claudia.md`): Der Server zählte Besucher — am 13.10. zwischen 18:54 und
 * 19:16 in Production 248 × `POST /api/besuch` —, und **niemand konnte die Zahlen ansehen**. Die Ansicht sitzt im Reiter „Status“ des
 * Editorpanels, und das Panel hing an `import.meta.env.DEV` (D23). Im ausgelieferten Build war die Bedingung `false`.
 *
 * 🪤 Unentdeckt blieb es, weil **jeder** Browsertest gegen `npm run dev` läuft: Dort ist `DEV` wahr, das Panel da, die Zahlen
 * sichtbar. Beleg, dass es nie jemand sah: Seit dem 12.10. 20:00 steht in den Journalen von Stage und Production kein einziges
 * `GET /api/besuch/zahlen`.
 *
 * Deshalb steht die Frage hier, im einzigen Test, der den ausgelieferten Build öffnet: **Kommt ein Editor an die Zahlen?**
 *
 * 🔴 **Nicht geprüft, bewusst:** dass das Bearbeiten ohne `MAP_EDITING` gesperrt bleibt. Das prüft der Server, wo es hingehört
 * (`editor-status.test.ts`: Production startet mit `testwelt` gar nicht, `map_editing_off` ist 423). Ein Stellvertreter in der
 * Oberfläche, der auch ohne die Sache grün ist, kostet mehr als er nützt — siehe den Dateikopf.
 */
test("ein Editor kommt im ausgelieferten Build an die Besucherzahlen", async ({ page }) => {
    const zahlenAnfragen: string[] = [];
    page.on("request", (request) => {
        if (request.url().includes("/api/besuch/zahlen")) zahlenAnfragen.push(request.url());
    });

    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "editor" });
    await page.route("**/api/besuch/zahlen*", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZAHLEN) }),
    );
    await page.route("**/api/besuch", (route) => route.fulfill({ status: 204, body: "" }));
    await page.route("**/api/besuch/ping", (route) => route.fulfill({ status: 204, body: "" }));

    // Der Editor-Modus, wie ihn ein angemeldeter Editor öffnet; die Karte muss dafür nicht fertig sein.
    await page.goto(`${PREVIEW}edit`);

    // 1. Die Lasche gibt es überhaupt. Bis zum 13.10. endete der Test hier: Im ausgelieferten Build war sie nicht da.
    const lasche = page.getByTestId("editor-panel-tab");
    await expect(lasche, "die Lasche „Editor“ steht im ausgelieferten Build").toBeVisible({ timeout: 30_000 });
    await lasche.click();

    // 2. Der Reiter „Status“ holt die Zahlen. Das ist die Frage, auf die es ankommt — nicht, ob irgendein Panel aufgeht.
    await page.getByRole("tab", { name: "Status" }).click();
    await expect
        .poll(() => zahlenAnfragen.length, { message: "GET /api/besuch/zahlen wird angefragt", timeout: 15_000 })
        .toBeGreaterThan(0);

    // 3. Und die Zahlen stehen auch da: die Aufrufe des Zeitraums aus dem gestellten Abzug (wie `besucherstatistik.spec.ts`).
    await expect(page.getByTestId("editor-panel").getByText("21.156")).toBeVisible();
});
