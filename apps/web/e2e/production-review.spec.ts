import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { devices, test, type Browser, type Page } from "@playwright/test";
import type { AdminKarteneinstellungen, FreigabeFortschritt, FreigabeSicht, UmgebungenStand } from "@avesmaps3d/shared";
import { ADMIN_CAPABILITIES, stubAdmin } from "./verwaltung-stub.ts";

/**
 * Abnahmeblatt „Umgebungen“ (WI-0204; vorher „Production“, FREIGABE-0001 Stufe 1). Der Betreiber wählte am 2026-10-16 „Direkt bauen“:
 * Dieses Blatt ist darum kein Schritt vor dem Bau, sondern die Sichtprüfung des Gebauten in allen Lagen.
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor, damit ein Mensch am Bild entscheidet. Die Prüfungen stehen in
 * `test/freigabe.test.ts`, `packages/shared/test/freigabe.test.ts` und auf dem Server in `test/freigabe.test.ts`.
 *
 * Gezeigt wird das Gebaute auf der ECHTEN Karte: der Eintrag in Ruhe, die Lagen, in denen der Knopf nicht geht, eine laufende Freigabe
 * mit ihren Stationen, ihr grünes und ihr rotes Ende samt Rückweg, dunkel und am Telefon.
 *
 *   npm run review:production
 *
 * Ablage: `review/freigabe/blatt.png` (`review/` ist nicht versioniert); `REVIEW_DIR` setzt einen anderen Ordner.
 */

const OUTPUT = process.env["REVIEW_DIR"] ?? resolve(import.meta.dirname, "../../../review/freigabe");
const OPERATOR = [...ADMIN_CAPABILITIES, "manage_system_settings", "release_to_production"];

const BASIS: FreigabeSicht = {
    now: "2026-10-13T15:00:00.000Z",
    datei: {
        schema: 1,
        standAt: "2026-10-13T14:59:00.000Z",
        production: { release: "878c244", commit: "878c244".padEnd(40, "0"), seit: "2026-10-12T21:22:00.000Z" },
        stage: { release: "e2f28dd", commit: "e2f28dd".padEnd(40, "0"), seit: "2026-10-13T14:05:00.000Z" },
        stageGruen: true,
        stagePruefung: "Proben und Journal, 14:08",
        technik: { migrationen: ["0118", "0119", "0122"], rechte: ["news-grants.psql"], umgebungswerte: ["KANAL"] },
        themen: [
            {
                id: "grundlage",
                name: null,
                satz: null,
                unredigiert: false,
                marken: ["migration", "rechte", "umgebungswert"],
                anzahl: 14,
                bis: "3396055",
            },
            {
                id: "WI-0139",
                name: "Neuigkeiten in Production",
                satz: "Unter „Neuigkeiten“ steht jetzt, was sich auf avesmaps.de getan hat.",
                unredigiert: false,
                marken: [],
                anzahl: 7,
                bis: "b81d356",
            },
            {
                id: "WI-0068",
                name: "Media Asset Management",
                satz: "Orte und Gebiete zeigen ein passendes Titelbild, auch wenn kein eigenes Foto vorliegt.",
                unredigiert: false,
                marken: [],
                anzahl: 11,
                bis: "e2f28dd",
            },
            {
                id: "WI-0142",
                name: "Neigung bis 85°",
                satz: "feat(WI-0142): Neigung bis 85 Grad am Zeigergerät, am Finger bleibt es bei 60",
                unredigiert: true,
                marken: [],
                anzahl: 3,
                bis: "c38d296",
            },
        ],
    },
    sperre: null,
    laeuft: null,
    frueher: [
        {
            ops: "OPS-000138",
            release: "878c244",
            at: "2026-10-12T21:22:00.000Z",
            wer: "Valentin",
            art: "release",
            themen: 9,
        },
        {
            ops: "OPS-000137",
            release: "20261012T163000Z-64e03c0",
            at: "2026-10-12T20:55:00.000Z",
            wer: "Thomas",
            art: "rollback",
            themen: 0,
        },
        {
            ops: "OPS-000136",
            release: "20261012T170000Z-5d1e9a2",
            at: "2026-10-12T19:30:00.000Z",
            wer: "Valentin",
            art: "release",
            themen: 2,
        },
        {
            ops: "OPS-000135",
            release: "64e03c0",
            at: "2026-10-12T18:40:00.000Z",
            wer: "Valentin",
            art: "release",
            themen: 4,
        },
    ],
};

const mit = (patch: Partial<FreigabeSicht>): FreigabeSicht => ({ ...BASIS, ...patch });

const LAUF_SEIT = "2026-10-13T14:58:00.000Z";
const fortschritt = (patch: Partial<FreigabeFortschritt>): FreigabeFortschritt => ({
    zustand: "laeuft",
    phase: "migrieren",
    fertig: [
        { phase: "abgeholt", ms: 3_000 },
        { phase: "vorbereiten", ms: 41_000 },
    ],
    beginn: "2026-10-13T14:59:20.000Z",
    phaseSeit: "2026-10-13T15:00:04.000Z",
    ende: null,
    fehlerCode: null,
    fehler: null,
    ...patch,
});
const FERTIG_ALLE = (["abgeholt", "vorbereiten", "migrieren", "rechte", "umschalten", "proben"] as const).map(
    (phase, i) => ({
        phase,
        ms: [3_000, 41_000, 18_000, 4_000, 22_000, 35_000][i] ?? null,
    }),
);

/** Stufe 2 (WI-0204 §10): der Live-Stand je Umgebung, Lokal, die Umgebung der Sitzung. Ohne Angabe wie Stufe 1. */
interface Lage {
    umgebung?: "staging" | "production";
    umgebungen?: UmgebungenStand;
    /** Antwortet die lokale Instanz der Probe? (Die Probe geht an die Adresse aus `umgebungen.lokal`.) */
    lokalOk?: boolean;
}

/** Die privaten Karteneinstellungen passend zur Adresse in `umgebungen.lokal`. */
function karteneinstellungen(umgebungen: UmgebungenStand): AdminKarteneinstellungen {
    const adresse = umgebungen.lokal?.adresse ?? null;
    return {
        now: "2026-10-13T15:00:00.000Z",
        revision: 4,
        source: "database",
        rows: [],
        unknownKeys: [],
        privat:
            adresse === null
                ? []
                : [{ id: "lokalName", value: new URL(adresse).hostname, changedAt: null, changedBy: null }],
    };
}

async function zeige(
    browser: Browser,
    baseURL: string,
    sicht: FreigabeSicht,
    options: Parameters<Browser["newContext"]>[0] = { viewport: { width: 1280, height: 900 } },
    lage: Lage = {},
): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({ baseURL, ...options });
    const page = await context.newPage();
    const umgebungen = lage.umgebungen;
    await stubAdmin(page, {
        capabilities: umgebungen === undefined ? OPERATOR : [...OPERATOR, "switch_environment"],
        role: "operator",
        person: { passkeyCount: 1 },
        environment: lage.umgebung ?? "staging",
        answer: (call) => {
            if (call.path.startsWith("/api/admin/system/production")) return { status: 200, body: sicht };
            if (umgebungen !== undefined && call.path.startsWith("/api/admin/system/umgebungen"))
                return { status: 200, body: umgebungen };
            if (umgebungen !== undefined && call.path.startsWith("/api/admin/system/karteneinstellungen"))
                return { status: 200, body: karteneinstellungen(umgebungen) };
            return undefined;
        },
    });
    // Die Probe ins Tailnet: `no-cors`, jede Antwort zählt als erreichbar; ohne Antwort bricht sie ab.
    const lokal = umgebungen?.lokal ?? null;
    if (lokal !== null) {
        await page.route(`${lokal.adresse}/**`, (route) =>
            lage.lokalOk === true ? route.fulfill({ status: 200, body: "" }) : route.abort("failed"),
        );
    }
    await page.goto("/?verwaltung=production");
    await page
        .getByTestId(lage.umgebung === "production" ? "umgebungen-production" : "production-rollback")
        .waitFor({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    return { page, close: () => context.close() };
}

test("Blatt: Umgebungen", async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    mkdirSync(OUTPUT, { recursive: true });
    const schuss = async (
        sicht: FreigabeSicht,
        name: string,
        ziel?: string,
        options?: Parameters<typeof zeige>[3],
        lage?: Lage & { unten?: boolean },
    ) => {
        const { page, close } = await zeige(browser, baseURL!, sicht, options, lage);
        if (lage?.unten === true)
            await page
                .locator('[data-testid="systemsteuerung-fenster"] [data-testid="fenster-rumpf"]')
                .evaluate((el) => (el.scrollTop = el.scrollHeight));
        await page.waitForTimeout(lage?.umgebungen === undefined ? 0 : 600);
        const ort = ziel === undefined ? page : page.locator(ziel);
        await ort.screenshot({ path: resolve(OUTPUT, `${name}.png`) });
        await close();
    };

    await schuss(BASIS, "a-ruhe");
    await schuss(BASIS, "b-nah", '[data-testid="systemsteuerung-fenster"]');
    await schuss(
        mit({ sperre: "stage_rot", datei: { ...BASIS.datei!, stageGruen: false } }),
        "c-rot",
        '[data-testid="systemsteuerung-fenster"]',
    );
    await schuss(
        mit({
            sperre: "laeuft",
            laeuft: { ops: "OPS-000142", art: "release", status: "neu", seit: LAUF_SEIT, fortschritt: null },
        }),
        "d-wartet",
        '[data-testid="systemsteuerung-fenster"]',
    );
    await schuss(
        mit({
            sperre: "laeuft",
            laeuft: { ops: "OPS-000142", art: "release", status: "neu", seit: LAUF_SEIT, fortschritt: fortschritt({}) },
        }),
        "d-laeuft",
        '[data-testid="systemsteuerung-fenster"]',
    );
    await schuss(
        mit({
            sperre: "gleich",
            datei: { ...BASIS.datei!, production: BASIS.datei!.stage, themen: [] },
            frueher: [
                {
                    ops: "OPS-000142",
                    release: "20261013T140500Z-e2f28dd",
                    at: LAUF_SEIT,
                    wer: "Valentin",
                    art: "release",
                    themen: 4,
                    fortschritt: fortschritt({
                        zustand: "gruen",
                        phase: "proben",
                        fertig: FERTIG_ALLE,
                        phaseSeit: null,
                        ende: "2026-10-13T15:01:23.000Z",
                    }),
                },
                ...BASIS.frueher,
            ],
        }),
        "d-gruen",
        '[data-testid="systemsteuerung-fenster"]',
    );
    // Rot endet der Lauf, aber der Vorgang bleibt offen, bis Claudio oder die Betreiber ihn abschließen: Er steht weiter als `laeuft`.
    await schuss(
        mit({
            sperre: "laeuft",
            laeuft: {
                ops: "OPS-000142",
                art: "release",
                status: "neu",
                seit: LAUF_SEIT,
                fortschritt: fortschritt({
                    zustand: "rot",
                    phase: "zurueck",
                    fertig: FERTIG_ALLE,
                    phaseSeit: null,
                    ende: "2026-10-13T15:02:10.000Z",
                    fehlerCode: "proben_rot",
                    fehler: "Proben rot: Die Kacheln antworten mit 503. Production ist automatisch auf 878c244 zurück.",
                }),
            },
        }),
        "d-rot",
        '[data-testid="systemsteuerung-fenster"]',
    );
    await schuss(
        mit({ sperre: "gleich", datei: { ...BASIS.datei!, stage: BASIS.datei!.production, themen: [] } }),
        "e-gleich",
        '[data-testid="systemsteuerung-fenster"]',
    );
    await schuss(BASIS, "f-dunkel", '[data-testid="systemsteuerung-fenster"]', {
        viewport: { width: 1280, height: 900 },
        colorScheme: "dark",
    });
    await schuss(BASIS, "g-telefon", undefined, devices["Pixel 7"]);

    // Stufe 2: Lokal und der Live-Stand je Umgebung.
    const LIVE: UmgebungenStand = {
        eigene: { releaseId: "20261013T140500Z-e2f28dd" },
        gegenseite: { releaseId: "20261012T192200Z-878c244", erreichbar: true },
        lokal: { adresse: "https://rechner.tail0000.ts.net", imMenue: "erreichbar" },
    };
    const fenster = '[data-testid="systemsteuerung-fenster"]';
    await schuss(BASIS, "h-lokal", fenster, undefined, { umgebungen: LIVE, lokalOk: true });
    await schuss(BASIS, "h-lokal-panel", fenster, undefined, { umgebungen: LIVE, lokalOk: true, unten: true });
    await schuss(BASIS, "h-lokal-aus", fenster, undefined, { umgebungen: LIVE, lokalOk: false });
    await schuss(BASIS, "h-lokal-leer", fenster, undefined, { umgebungen: { ...LIVE, lokal: null } });
    await schuss(mit({ datei: null, frueher: [] }), "i-production", fenster, undefined, {
        umgebung: "production",
        umgebungen: {
            eigene: { releaseId: "20261012T192200Z-878c244" },
            gegenseite: { releaseId: "20261013T140500Z-e2f28dd", erreichbar: true },
            lokal: LIVE.lokal,
        },
        lokalOk: true,
    });
    await schuss(BASIS, "i-telefon-lokal", undefined, devices["Pixel 7"], { umgebungen: LIVE, lokalOk: true });

    const img = (name: string, breite = 1280): string => `<img src="${name}.png" width="${String(breite)}" />`;
    const fig = (name: string, satz: string, breite = 620): string =>
        `<figure style="width:${String(breite)}px"><img src="${name}.png" width="${String(breite)}" /><figcaption>${satz}</figcaption></figure>`;
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8" />
<style>
body{margin:0;padding:28px 32px;background:#f3f0e8;color:#2e271e;font:14px/1.5 Arial,sans-serif;max-width:1344px}
h1{font-size:24px;font-weight:500;margin:0 0 4px}h2{font-size:16px;font-weight:600;margin:28px 0 10px}
h2 span{font-weight:400;color:#706557}p.lead{margin:0 0 6px;color:#4a4036}
.row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0}figcaption{margin-top:6px;color:#706557;font-size:13px}
img{display:block;border:1px solid #cec3b0;border-radius:6px;background:#fff;height:auto;max-width:100%}
p.note{margin-top:24px;padding:12px 14px;border-left:3px solid #8a6b16;background:#fffdf9;color:#4a4036}
</style></head><body>
<h1>Umgebungen (vorher „Production“)</h1>
<p class="lead">WI-0204 · Stand ${new Date().toISOString().slice(0, 10)} · Betreiber 2026-10-16: „Direkt bauen“, „Gleise je Release“, „An der Bahn“, „Nur Stationen“</p>

<h2>(a) Der Eintrag in Ruhe <span>· Systemsteuerung › System &amp; Betrieb › Umgebungen, die Zahl an der Schiene sind die wartenden Themen</span></h2>
${img("a-ruhe")}

<h2>(b) Nahaufnahme <span>· Stationen, Verbindung, der Knopf darunter, die Gleise, was mitgeht</span></h2>
${img("b-nah", 900)}

<h2>(c) Die Lagen, in denen nichts rausgeht</h2>
<div class="row">
${fig("c-rot", "Die Stage ist nicht grün geprüft: ungeprüft geht nichts raus", 430)}
${fig("e-gleich", "Production und Stage sind gleich: nichts zu schieben", 430)}
</div>

<h2>(d) Eine Freigabe läuft und endet</h2>
<div class="row">
${fig("d-wartet", "Auftrag erteilt, der Abholer hat noch nicht gemeldet", 430)}
${fig("d-laeuft", "Die Migrationen laufen; Schritte mit Zeiten", 430)}
${fig("d-gruen", "Grün: in Production, die Themen stehen auf „in Production“", 430)}
${fig("d-rot", "Rot nach dem Umschalten: automatischer Rückweg", 430)}
</div>

<h2>(f) Dunkel und (g) am Telefon</h2>
<div class="row">${fig("f-dunkel", "Dunkel, dieselbe Lage", 700)}${fig("g-telefon", "Pixel 7 (412 × 915)", 300)}</div>

<p class="note"><b>Worauf zu achten ist:</b> Es geht genau der Stand raus, der auf der Stage als grün geprüft dasteht — hat sich die Stage seit dem Blick bewegt, lehnt der Server ab,
statt etwas anderes zu schieben. Beide Knöpfe fragen den Passkey. Was danach passiert, steht im <b>Vorgang bei „Claudia &amp; Claudio“</b>: wer, wann, welche Nachweise und
der Weg zurück — dieselbe Akte wie bei jedem Fix. Ein Thema ohne redigierten Satz steht <i>kursiv</i> da und trägt die Marke „unredigiert“; der Satz ist dann nur der
Betreff des Commits. <b>Die Haken je Thema gibt es bewusst noch nicht</b> — das ist Stufe 2.</p>
</body></html>`;

    const sheetContext = await browser.newContext({ baseURL: baseURL!, viewport: { width: 1344, height: 1000 } });
    const sheet = await sheetContext.newPage();
    await sheet.route("**/__production.html", (route) =>
        route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
    );
    await sheet.goto("/__production.html");
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.waitForTimeout(600);
    await sheet.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    await sheetContext.close();
});
