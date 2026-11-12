import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type Browser, type Page } from "@playwright/test";
import type { MediaPublicView } from "@avesmaps3d/shared";
import { openMap } from "./map-handle.ts";

/**
 * Abnahmeblatt „Bildbezug im Infopanel“ (Betreiber 2026-10-11, wörtlich „1A … 2 B … 3 A ja das gilt für alle“; Arbeitsanweisung
 * `project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md`, Mockup `project-control/mockups/bildbezug-2026-10-11.html`).
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `info-panel-bildbezug.spec.ts`, `.touch.spec.ts`, `test/bildbezug.test.ts` und `apps/server/test/bildbezug.test.ts`.
 *
 * Echte Orte, echte Bilder vom laufenden Stapel. Den Bildbezug rechnet dieses Blatt mit DERSELBEN Regel des Servers
 * (`apps/server/src/media/image-relation.ts`, nur lesend gegen `DATABASE_URL`) und legt ihn in die Antwort, solange der Server auf 3000
 * die Vorversion fährt; danach liefert er dasselbe selbst. Gezeigt: Gareth (sieben eigene Dateien), Thorwal (eine eigene), Akiras (eine
 * Datei an vielen Orten) und die Reichsstraße 3 (Grafik der Art), hell und dunkel in echter Größe, dreifach vergrößert, am Telefon.
 *
 *   npm run review:bildbezug
 *
 * Ablage: `review/bildbezug/blatt.png` (`review/` ist nicht versioniert; dieses Blatt wird mit `git add -f` vorgelegt).
 */

const REPO = resolve(import.meta.dirname, "../../..");
const OUTPUT = resolve(REPO, "review/bildbezug");
const CANON = JSON.parse(readFileSync(resolve(REPO, "config/design-canon/avesmaps.json"), "utf8")) as {
    colour: Record<string, string>;
};

interface Fall {
    key: string;
    titel: string;
    ref: Record<string, unknown>;
    notiz: string;
}

const FAELLE: readonly Fall[] = [
    {
        key: "gareth",
        titel: "Gareth",
        ref: { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" },
        notiz: "sieben eigene Dateien",
    },
    {
        key: "thorwal",
        titel: "Thorwal",
        ref: { kind: "place", id: "b5176e97-6e6f-5c41-ad60-ea20a06e3bbf" },
        notiz: "eine eigene Datei",
    },
    {
        key: "akiras",
        titel: "Akiras",
        ref: { kind: "place", id: "236ee78b-e012-5506-a467-3b8171848439" },
        notiz: "dieselbe Datei an vielen Orten",
    },
    {
        key: "strasse",
        titel: "Reichsstraße 3",
        ref: { kind: "path", chain: "Reichsstraße 3:Reichsstrasse" },
        notiz: "Grafik der Art",
    },
];

/** Fasar am Telefon: zehn Seitenmarken neben der Beschriftung. */
const FASAR: Fall = {
    key: "fasar",
    titel: "Fasar",
    ref: { kind: "place", id: "aed5f402-47d0-5a89-a7e2-c3f8a31e56c2" },
    notiz: "zehn eigene Dateien",
};

interface Regel {
    relation: "place_view" | "type_image";
    places: number;
}

interface Verbindung {
    unsafe<T>(query: string, parameters: unknown[]): Promise<T>;
    end(options: { timeout: number }): Promise<void>;
}

/** Die Regel des Servers je Asset, gegen die Entwicklungsdatenbank (nur lesend). */
async function regelFuer(ids: readonly string[]): Promise<Map<string, Regel>> {
    if (process.env["DATABASE_URL"] === undefined && existsSync(resolve(REPO, ".env"))) {
        process.loadEnvFile(resolve(REPO, ".env"));
    }
    const adresse = process.env["DATABASE_URL"];
    if (adresse === undefined || ids.length === 0) return new Map();
    const laden = <T>(pfad: string): Promise<T> => import(pathToFileURL(resolve(REPO, pfad)).href) as Promise<T>;
    const { createDatabase } = await laden<{ createDatabase(url: string, options: { max: number }): Verbindung }>(
        "apps/server/src/database.ts",
    );
    const { placesOfSourceFileSql } = await laden<{ placesOfSourceFileSql(column: string): string }>(
        "apps/server/src/media/image-relation.ts",
    );
    const db = createDatabase(adresse, { max: 1 });
    try {
        const rows = await db.unsafe<{ id: string; places: number }[]>(
            `SELECT a.public_id::text AS id, ${placesOfSourceFileSql("a.id")} AS places
               FROM media_asset a WHERE a.public_id = ANY($1::uuid[])`,
            [ids],
        );
        return new Map(
            rows.map((row) => [
                row.id,
                { relation: row.places === 1 ? "place_view" : "type_image", places: row.places },
            ]),
        );
    } finally {
        await db.end({ timeout: 5 });
    }
}

/** Legt den Bildbezug in die Detailantworten der Orte (2B wie der Server: eine Ortsansicht nimmt die Typbilder weg). */
async function bezugEinlegen(page: Page, regeln: Map<string, Regel>, gesehen: Map<string, string[]>): Promise<void> {
    await page.route(
        (url) => /^\/api\/subjects\/place\/[0-9a-f-]{36}$/.test(url.pathname),
        async (route) => {
            const response = await route.fetch();
            const answer = (await response.json()) as { media?: { header?: MediaPublicView[] } };
            const header = answer.media?.header;
            if (header !== undefined) {
                const mit = header.map((view) => ({
                    ...view,
                    relation: view.relation ?? regeln.get(view.id)?.relation ?? "type_image",
                }));
                const ortsansicht = mit.some((view) => view.relation === "place_view");
                answer.media!.header = ortsansicht ? mit.filter((view) => view.relation === "place_view") : mit;
                gesehen.set(
                    new URL(route.request().url()).pathname.split("/").pop()!,
                    header.map((view) => view.id),
                );
            }
            await route.fulfill({ response, json: answer });
        },
    );
}

interface Aufnahme {
    kopf: Buffer;
    nah: Buffer;
    text: string;
}

async function aufnehmen(
    browser: Browser,
    baseURL: string,
    fall: Fall,
    optionen: { scheme: "light" | "dark"; width: number; height: number; scale: number; mobile: boolean },
    regeln: Map<string, Regel>,
    gesehen: Map<string, string[]>,
): Promise<Aufnahme> {
    const context = await browser.newContext({
        baseURL,
        viewport: { width: optionen.width, height: optionen.height },
        deviceScaleFactor: optionen.scale,
        colorScheme: optionen.scheme,
        isMobile: optionen.mobile,
        hasTouch: optionen.mobile,
        extraHTTPHeaders: { "x-forwarded-for": `10.77.0.${String(200 + Math.floor(Math.random() * 40))}` },
    });
    const page = await context.newPage();
    await bezugEinlegen(page, regeln, gesehen);
    await openMap(page);
    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref as never), fall.ref);
    await page.getByTestId("info-title").waitFor({ timeout: 30_000 });
    await page.getByTestId("info-header-bildbezug").waitFor({ timeout: 30_000 });
    await page.waitForFunction(
        () => {
            const image = document.querySelector<HTMLImageElement>("[data-testid=info-header-image]");
            return image !== null && image.complete && image.naturalWidth > 0;
        },
        undefined,
        { timeout: 30_000 },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const kopf = await page.getByTestId("info-header").screenshot();
    const medien = (await page.getByTestId("info-media").boundingBox())!;
    const nah = await page.screenshot({
        clip: { x: medien.x + medien.width - 150, y: medien.y + medien.height - 56, width: 150, height: 56 },
    });
    const text = (await page.getByTestId("info-header-bildbezug").innerText()).trim();
    await context.close();
    return { kopf, nah, text };
}

const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

test("Abnahmeblatt: Bildbezug im Infopanel (Ortsansicht, Ortsansichten, Typbild)", async ({ browser }, testInfo) => {
    test.setTimeout(900_000);
    const baseURL = String(testInfo.project.use.baseURL);

    // Erst die Ids der Kopfbilder sammeln (ein Lauf ohne Bezug), dann die Regel für genau diese rechnen.
    const gesehen = new Map<string, string[]>();
    const vorab = await browser.newContext({ baseURL });
    const probe = await vorab.newPage();
    await bezugEinlegen(probe, new Map(), gesehen);
    await openMap(probe);
    for (const fall of [...FAELLE, FASAR].filter((entry) => entry.ref["kind"] === "place")) {
        await probe.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref as never), fall.ref);
        await probe.getByTestId("info-title").filter({ hasText: fall.titel }).waitFor({ timeout: 30_000 });
        await probe.waitForTimeout(300);
    }
    await vorab.close();
    const regeln = await regelFuer([...gesehen.values()].flat());

    const reihen: Record<string, Record<string, Aufnahme>> = { hell: {}, dunkel: {}, telefon: {}, fasar: {} };
    for (const fall of FAELLE) {
        reihen["hell"]![fall.key] = await aufnehmen(
            browser,
            baseURL,
            fall,
            { scheme: "light", width: 1280, height: 900, scale: 3, mobile: false },
            regeln,
            gesehen,
        );
        reihen["dunkel"]![fall.key] = await aufnehmen(
            browser,
            baseURL,
            fall,
            { scheme: "dark", width: 1280, height: 900, scale: 1, mobile: false },
            regeln,
            gesehen,
        );
        reihen["telefon"]![fall.key] = await aufnehmen(
            browser,
            baseURL,
            fall,
            { scheme: "light", width: 412, height: 915, scale: 1, mobile: true },
            regeln,
            gesehen,
        );
    }
    // Fasar am Telefon: zehn Seitenmarken neben der Beschriftung.
    reihen["fasar"]!["fasar"] = await aufnehmen(
        browser,
        baseURL,
        FASAR,
        { scheme: "light", width: 412, height: 915, scale: 1, mobile: true },
        regeln,
        gesehen,
    );

    const zaehle = (bezug: Regel["relation"]): number =>
        [...regeln.values()].filter((regel) => regel.relation === bezug).length;
    const orte = (fall: Fall): string => {
        const ids = gesehen.get(String(fall.ref["id"])) ?? [];
        const max = Math.max(0, ...ids.map((id) => regeln.get(id)?.places ?? 0));
        return ids.length === 0 ? "" : ` · die Datei hängt an ${String(max)} ${max === 1 ? "Ort" : "Orten"}`;
    };
    const colour = CANON.colour;
    const png = (buffer: Buffer): string => `data:image/png;base64,${buffer.toString("base64")}`;
    const zelle = (reihe: string, fall: Fall, breite: number): string => {
        const aufnahme = reihen[reihe]![fall.key]!;
        return `<figure><img style="width:${String(breite)}px" src="${png(aufnahme.kopf)}" alt=""><figcaption><b>${escape(fall.titel)}</b> · ${escape(aufnahme.text)}<br>${escape(fall.notiz)}${escape(orte(fall))}</figcaption></figure>`;
    };
    const nah = (fall: Fall): string =>
        `<figure><img style="width:450px" src="${png(reihen["hell"]![fall.key]!.nah)}" alt=""><figcaption><b>${escape(fall.titel)}</b> · dreifach</figcaption></figure>`;

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${baseURL}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 28px 32px 40px; background: ${colour["pageBg"]}; color: ${colour["text"]}; font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; width: 1700px; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 400; color: ${colour["textStrong"]}; }
.lead { margin: 0 0 18px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1640px; }
h2 { margin: 22px 0 8px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]}; }
.row { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
figure { margin: 0; }
figure img { display: block; border: 1px solid ${colour["border"]}; border-radius: 8px; }
figcaption { margin-top: 6px; font-size: 12px; color: ${colour["textMuted"]}; }
figcaption b { font-weight: 400; color: ${colour["textStrong"]}; }
.note { margin: 20px 0 0; padding: 10px 14px; border: 1px solid ${colour["border"]}; border-radius: 8px; background: ${colour["panelSoft"]}; font-size: 13px; max-width: 1640px; }
.note b { font-weight: 400; color: ${colour["accentStrong"]}; }
</style></head><body>
<h1>Bildbezug im Infopanel: Ortsansicht · Ortsansichten · Typbild</h1>
<p class="lead">Betreiber 2026-10-11 „1A … 2 B … 3 A ja das gilt für alle“ · Regel je Verwendung auf dem Server: dieselbe Quelldatei an genau einem aktiven Ort = Ortsansicht, sonst Typbild; ein Editor übersteuert je Verwendung. Unter den gezeigten Dateien ${String(zaehle("place_view"))} als Ortsansicht und ${String(zaehle("type_image"))} als Typbild. Beschriftung unten rechts im Bild, nie oben rechts (✕ am Telefon).</p>
<h2>Rechner, helles Thema · echte Größe</h2>
<div class="row">${FAELLE.map((fall) => zelle("hell", fall, 400)).join("")}</div>
<h2>Nahaufnahme der Ecke · dreifach</h2>
<div class="row">${FAELLE.map(nah).join("")}</div>
<h2>Rechner, dunkles Thema · echte Größe</h2>
<div class="row">${FAELLE.map((fall) => zelle("dunkel", fall, 400)).join("")}</div>
<h2>Telefon (412 px), helles Thema · dazu Fasar mit zehn Seitenmarken</h2>
<div class="row">${FAELLE.map((fall) => zelle("telefon", fall, 388)).join("")}${zelle("fasar", FASAR, 388)}</div>
<p class="note"><b>Ortsansicht</b>: Bildsymbol auf kleiner Plakette, beim Zeigen ein leiser Zoom im Ausschnitt (2,5 %, 150 ms, nicht bei reduzierter Bewegung, nicht am Finger), ein Klick öffnet die Bildansicht mit den Ortsansichten; Pfeile blättern nur. <b>Typbild</b>: nur die Schrift, zu 50 % durchsichtig mit Schatten, ohne Symbol, Rahmen und Grund; das Bild selbst bleibt unverändert, nichts ist klickbar. Die Grafik der Art (Orte ohne eigenes Bild, Wege, Flächen, Gipfel, Gebiete, Etappen, Kraftlinien) trägt immer „Typbild“. Wappen, Kanon-Etikett und Nennung bleiben, wie sie sind.</p>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    const sheetContext = await browser.newContext({ baseURL, viewport: { width: 1764, height: 1000 } });
    const sheet = await sheetContext.newPage();
    // Das Blatt kommt vom Ursprung der Entwicklungsseite, damit die Hausschrift laden darf.
    await sheet.route("**/__bildbezugblatt.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__bildbezugblatt.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(500);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
