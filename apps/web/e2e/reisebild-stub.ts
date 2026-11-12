import { crc32, deflateSync } from "node:zlib";
import type { Page, Route } from "@playwright/test";

/**
 * Die Attrappe des Servers für die Reisebilder (WI-0272 S2b; Routen `POST /api/photobox/…`, Verträge `packages/shared/src/photobox.ts`) und des nächsten Orts. Kein eigener Fastify:
 * Die Specs `reisebild-*.spec.ts` prüfen die Oberfläche, die Routen stehen in den Servertests. Alles steht im Speicher des Aufrufs; was die Seite gesendet hat, liegt in
 * `aufrufe` und kann geprüft werden.
 */

export const GARETH_ORT = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Gareth",
    subtype: "metropole",
    hidden: false,
    x: 551.625,
    y: 532.969,
};

export interface Aufruf {
    readonly methode: string;
    /** Der Pfad hinter `/api/photobox`, z. B. `/einreichungen` oder `/status/offline`. */
    readonly pfad: string;
    readonly body: unknown;
}

export interface AttrappeOptionen {
    /** Antwort auf `GET /stand`. */
    readonly einreichen?: boolean;
    /** Der Stand, den `POST /status` liefert; `undefined` heißt 404 (derselbe Satz für „nie gewesen“). */
    status?: Record<string, unknown> | undefined;
    /** Ein Fehler, den `POST /status` (das Lesen des Standes) liefert, statt des Standes; `undefined` nimmt ihn wieder weg. */
    statusFehler?: { status: number; code: string } | undefined;
    /** Ab wann die Vorschau fertig ist (Anzahl der Abfragen vorher, 404 `photobox_preview_missing`); 0 heißt gleich. */
    vorschauNachAbfragen?: number;
    /**
     * Der Stand je Schlüssel für die Liste „Meine Reisebilder“ (Entwurf 9): ein Stand, `undefined` für „gibt es nicht“ (404) oder ein Fehler statt des Standes. Ein Schlüssel, der hier fehlt, bekommt
     * `status` wie bisher. Die Vorschau eines Schlüssels hängt an `vorschauBereit` seines Standes.
     */
    statusJeSchluessel?: Record<
        string,
        Record<string, unknown> | { fehler: { status: number; code: string } } | undefined
    >;
    /** Wie lange `POST /status` antwortet, in Millisekunden (die Karten zeigen bis dahin ihren Platzhalter). */
    statusVerzoegerungMs?: number;
    /** Die Vorschau eines Schlüssels (ein WebP), wo die Aufnahmen für die Abnahme ein echtes Bild brauchen; sonst ein Bildpunkt. */
    vorschauBild?: (schluessel: string) => Buffer | undefined;
    /** Ein Fehler, den `POST /einreichungen` liefert, statt 201. */
    einreichenFehler?: { status: number; code: string };
    /** Ein Fehler, den eine Statusaktion liefert, statt des neuen Stands. */
    aktionFehler?: { status: number; code: string; details?: Record<string, unknown> };
    /** Die Treffer der Suche (`GET /api/search`), die der Bezug im Formular vorschlägt. */
    suchtreffer?: readonly Record<string, unknown>[];
}

export interface Attrappe {
    readonly aufrufe: Aufruf[];
    readonly optionen: AttrappeOptionen;
}

/** Ein kleines WebP (1 × 1) für die Vorschau. */
const WEBP_1X1 = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");

/** Statt eines Standes ein Fehler des Servers (`statusJeSchluessel`)? */
const istFehlerStand = (
    wert: Record<string, unknown> | { fehler: { status: number; code: string } },
): wert is { fehler: { status: number; code: string } } => "fehler" in wert;

const json = (route: Route, status: number, body: unknown): Promise<void> =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const fehler = (route: Route, status: number, code: string, details?: Record<string, unknown>): Promise<void> =>
    json(route, status, { error: { code, message: code, ...(details === undefined ? {} : { details }) } });

export async function stubReisebilder(page: Page, optionen: AttrappeOptionen = {}): Promise<Attrappe> {
    const attrappe: Attrappe = { aufrufe: [], optionen };
    let vorschauAbfragen = 0;

    await page.route("**/api/route/waypoints/nearest*", (route) =>
        json(route, 200, { place: GARETH_ORT, distance: 1.5 }),
    );
    await page.route("**/api/search?*", (route) =>
        json(route, 200, { query: "", hits: optionen.suchtreffer ?? [], truncated: false }),
    );
    await page.route("**/api/photobox/**", async (route) => {
        const anfrage = route.request();
        const pfad = new URL(anfrage.url()).pathname.replace(/^\/api\/photobox/u, "");
        const body: unknown = anfrage.postData() === null ? undefined : JSON.parse(anfrage.postData()!);
        attrappe.aufrufe.push({ methode: anfrage.method(), pfad, body });
        if (pfad === "/stand") return json(route, 200, { einreichen: optionen.einreichen ?? true });
        if (pfad === "/einreichungen") {
            if (optionen.einreichenFehler)
                return fehler(route, optionen.einreichenFehler.status, optionen.einreichenFehler.code);
            return json(route, 201, { ok: true });
        }
        if (pfad === "/status" && optionen.statusJeSchluessel !== undefined) {
            const schluessel = String((body as { schluessel?: unknown } | undefined)?.schluessel);
            if (schluessel in optionen.statusJeSchluessel) {
                if (optionen.statusVerzoegerungMs)
                    await new Promise((fertig) => setTimeout(fertig, optionen.statusVerzoegerungMs));
                const eigener = optionen.statusJeSchluessel[schluessel];
                if (eigener === undefined) return fehler(route, 404, "photobox_not_found");
                if (istFehlerStand(eigener)) return fehler(route, eigener.fehler.status, eigener.fehler.code);
                return json(route, 200, eigener);
            }
        }
        if (pfad === "/status/vorschau" && optionen.statusJeSchluessel !== undefined) {
            const schluessel = String((body as { schluessel?: unknown } | undefined)?.schluessel);
            if (schluessel in optionen.statusJeSchluessel) {
                const eigener = optionen.statusJeSchluessel[schluessel];
                if (eigener === undefined || istFehlerStand(eigener)) return fehler(route, 404, "photobox_not_found");
                if (eigener["vorschauBereit"] !== true) return fehler(route, 404, "photobox_preview_missing");
                return route.fulfill({
                    status: 200,
                    contentType: "image/webp",
                    body: optionen.vorschauBild?.(schluessel) ?? WEBP_1X1,
                });
            }
        }
        if (pfad === "/status") {
            if (optionen.statusVerzoegerungMs)
                await new Promise((fertig) => setTimeout(fertig, optionen.statusVerzoegerungMs));
            if (optionen.statusFehler) return fehler(route, optionen.statusFehler.status, optionen.statusFehler.code);
            if (optionen.status === undefined) return fehler(route, 404, "photobox_not_found");
            return json(route, 200, optionen.status);
        }
        if (pfad === "/status/vorschau") {
            if (optionen.status === undefined) return fehler(route, 404, "photobox_not_found");
            vorschauAbfragen += 1;
            if (vorschauAbfragen <= (optionen.vorschauNachAbfragen ?? 0))
                return fehler(route, 404, "photobox_preview_missing");
            return route.fulfill({ status: 200, contentType: "image/webp", body: WEBP_1X1 });
        }
        // Eine Statusaktion: der neue Stand ist die Antwort. Die Attrappe ändert den Zustand wie der Server.
        if (optionen.aktionFehler) {
            return fehler(
                route,
                optionen.aktionFehler.status,
                optionen.aktionFehler.code,
                optionen.aktionFehler.details,
            );
        }
        if (optionen.status === undefined) return fehler(route, 404, "photobox_not_found");
        const aktion = pfad.replace(/^\/status\//u, "");
        const werte = (body ?? {}) as Record<string, unknown>;
        if (aktion === "zurueckziehen") optionen.status = { ...optionen.status, zustand: "withdrawn" };
        else if (aktion === "offline") optionen.status = { ...optionen.status, zustand: "offline" };
        else if (aktion === "nutzung") optionen.status = { ...optionen.status, nutzung: werte["nutzung"] };
        else if (aktion === "beschreibung") {
            optionen.status =
                optionen.status["zustand"] === "approved"
                    ? { ...optionen.status, wartendeBeschreibung: werte["beschreibung"] }
                    : { ...optionen.status, beschreibung: werte["beschreibung"] };
        } else if (aktion === "bild")
            optionen.status = { ...optionen.status, zustand: "incoming", vorschauBereit: false };
        return json(route, 200, optionen.status);
    });
    return attrappe;
}

/** Ein gültiges PNG (RGBA, einfarbig) für die Dateiwahl der Specs; `zlib.crc32` rechnet die Prüfsummen der Blöcke. */
export function kleinesPng(breite = 64, hoehe = 48, farbe: readonly [number, number, number] = [60, 110, 160]): Buffer {
    const block = (art: string, daten: Buffer): Buffer => {
        const laenge = Buffer.alloc(4);
        laenge.writeUInt32BE(daten.length);
        const kern = Buffer.concat([Buffer.from(art, "ascii"), daten]);
        const summe = Buffer.alloc(4);
        summe.writeUInt32BE(crc32(kern));
        return Buffer.concat([laenge, kern, summe]);
    };
    const kopf = Buffer.alloc(13);
    kopf.writeUInt32BE(breite, 0);
    kopf.writeUInt32BE(hoehe, 4);
    kopf[8] = 8; // Bits je Kanal
    kopf[9] = 6; // RGBA
    const zeile = Buffer.alloc(1 + breite * 4);
    for (let x = 0; x < breite; x++) {
        zeile[1 + x * 4] = farbe[0];
        zeile[2 + x * 4] = farbe[1];
        zeile[3 + x * 4] = farbe[2];
        zeile[4 + x * 4] = 255;
    }
    const roh = Buffer.concat(Array.from({ length: hoehe }, () => zeile));
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        block("IHDR", kopf),
        block("IDAT", deflateSync(roh)),
        block("IEND", Buffer.alloc(0)),
    ]);
}

// --- Der Lesepfad der Karte (WI-0272 S4, Aufgabe 27) -------------------------------------------------------------------

/** Ein Bild der Antwort, wie `GET /api/media/reisebilder` es liefert; der Rest hat Vorgaben. */
export interface KartenBild {
    readonly id: string;
    readonly lage: { x: number; y: number };
    readonly entstehung?: "drawing" | "photo" | "ai_generated" | "avesmaps_capture";
    readonly name?: string;
    readonly beschreibung?: string;
    readonly lizenz?: { name: string; uri?: string };
    readonly blickrichtung?: number;
    readonly ort?: {
        id: string;
        name: string;
        lage: { x: number; y: number };
        subtype: string;
        capitalBands?: string;
    };
    /** Ohne Kachel: die Attrappe liefert keine kleine Fassung. */
    readonly ohneKachel?: boolean;
    /** 404 für die Kachel und die große Fassung. */
    readonly fehlt?: boolean;
    /** Ein Hochformat (900 x 1600 statt 1600 x 900). */
    readonly hochformat?: boolean;
}

export interface KartenAttrappe {
    /** Wie oft die Seite den Lesepfad gefragt hat. */
    abrufe: number;
    /** Die Adressen der Abrufe. */
    readonly adressen: string[];
    /** Die Bilder, die die Attrappe kennt; die Seite bekommt die im Ausschnitt. */
    bilder: KartenBild[];
    /** `false`: Der Schalter `media.role.photobox` ist aus. */
    an: boolean;
    /** Wie oft eine Bilddatei geholt wurde. */
    dateien: number;
}

const kartenDatei = (
    id: string,
    art: "gross" | "kachel",
    hochformat = false,
): { url: string; breite: number; hoehe: number } => {
    const lang = art === "gross" ? 1600 : 480;
    const kurz = art === "gross" ? 900 : 270;
    return {
        url: `/media/reisebild-test/${id}-${art}.webp`,
        breite: hochformat ? kurz : lang,
        hoehe: hochformat ? lang : kurz,
    };
};

/** Die Attrappe des Lesepfads der Karte und der Bilddateien unter `/media/reisebild-test/`. */
export async function stubReisebilderKarte(page: Page, bilder: readonly KartenBild[]): Promise<KartenAttrappe> {
    const attrappe: KartenAttrappe = { abrufe: 0, adressen: [], bilder: [...bilder], an: true, dateien: 0 };
    await page.route("**/media/reisebild-test/**", (route) => {
        attrappe.dateien += 1;
        const name = new URL(route.request().url()).pathname;
        const bild = attrappe.bilder.find((b) => name.includes(b.id));
        if (bild?.fehlt === true) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ status: 200, contentType: "image/webp", body: WEBP_1X1 });
    });
    await page.route("**/api/media/reisebilder*", (route) => {
        attrappe.abrufe += 1;
        attrappe.adressen.push(route.request().url());
        const q = new URL(route.request().url()).searchParams;
        const x0 = Number(q.get("x0"));
        const y0 = Number(q.get("y0"));
        const x1 = Number(q.get("x1"));
        const y1 = Number(q.get("y1"));
        if (!attrappe.an) return json(route, 200, { an: false, bilder: [], gekappt: false });
        const drin = attrappe.bilder.filter(
            (b) => b.lage.x >= x0 && b.lage.x <= x1 && b.lage.y >= y0 && b.lage.y <= y1,
        );
        return json(route, 200, {
            an: true,
            gekappt: false,
            bilder: drin.map((b) => ({
                id: b.id,
                lage: b.lage,
                datei: kartenDatei(b.id, "gross", b.hochformat === true),
                ...(b.ohneKachel === true ? {} : { kachel: kartenDatei(b.id, "kachel", b.hochformat === true) }),
                beschreibung: b.beschreibung ?? `Beispielbild ${b.id}`,
                ...(b.name === undefined ? {} : { name: b.name }),
                entstehung: b.entstehung ?? "drawing",
                ...(b.lizenz === undefined ? {} : { lizenz: b.lizenz }),
                ...(b.blickrichtung === undefined ? {} : { blickrichtung: b.blickrichtung }),
                ...(b.ort === undefined ? {} : { ort: b.ort }),
            })),
        });
    });
    return attrappe;
}
