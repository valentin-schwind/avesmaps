import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";

/**
 * 🔴 Positivliste aller Routen (WI-0120 A3, Ultra-Review R-02, Kap. 11.22, AUTH-0001 §8): Jede Route ist entweder
 * ausdrücklich öffentlich oder trägt ihr Recht (`config.auth`, gesetzt von `protect(…)`). Eine neue Route ohne beides lässt
 * diesen Test fallen, statt still offen zu sein.
 *
 * Die heutigen Lesepfade der Karte sind öffentlich (Karte ohne Anmeldung, Auftrag 2026-10-09 Abschnitt 6) und stehen hier
 * als Präfix. Neue Routen tragen `config.auth` selbst.
 */

/** Lesend (GET/HEAD), öffentlich: die Karte, ihr Infopanel, Kacheln, Medien, Gesundheit. */
const PUBLIC_READ_PREFIXES = [
    "/health",
    "/tiles/",
    "/media/",
    "/api/subjects/",
    "/api/areas/",
    "/api/route",
    "/api/search",
    "/api/share/",
    "/api/powerlines",
    "/api/territories/",
    // Die Kachelrevisionen beim Start der Karte (WI-0283 H3): je Art nur die jüngste Folgenummer von `map.changed`, derselbe Stand, den die
    // öffentliche Karte aus den Ereignissen kennt; keine Fachdaten, keine Personen.
    "/api/map/tile-revisions",
] as const;

/**
 * Öffentliche Anfragen mit Körper, die nichts an Konten oder Fachdaten ändern (Rechnen, Kurzlink mit eigener Drossel).
 *
 * Dazu die zwei Pfade der Discord-Befehle (WI-0255, `routes/discord-interaktionen.ts`): Discord meldet sich nie mit Sitzung, die Anfrage
 * trägt statt des Rechts die Ed25519-Signatur auf dem rohen Rumpf (fehlt sie oder stimmt sie nicht: 401); sie legt einen Vorgang im
 * Betreiber-Kanal an, der erst nach der Freigabe durch den Betreiber etwas auslöst, oder schließt mit `/erledigt` einen aus Discord (den eigenen,
 * ein Betreiber jeden; die Rechte prüfen Datenbank und `discord/vorgaenge.ts`), und gilt nur, wo der Kanal lebt (sonst 404).
 */
const PUBLIC_POSTS = [
    "POST /api/route/landscapes",
    "POST /api/route/stage/lore",
    "POST /api/route/unterwegs",
    // Die Gegenden EINES gewählten Vorkommens an der Route (WI-0257 S5): rechnet nur, ändert nichts, dieselbe Zweierschranke wie die Liste.
    "POST /api/route/unterwegs/gegenden",
    "POST /api/share",
    "POST /api/discord/interactions",
    "POST /api/discord/interactions.php",
] as const;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
};

interface RouteEntry {
    method: string;
    url: string;
    auth: unknown;
}

async function allRoutes(): Promise<RouteEntry[]> {
    const app = buildApp({ config, logStream: { write: () => undefined } });
    const found: RouteEntry[] = [];
    app.addHook("onRoute", (options) => {
        const methods = Array.isArray(options.method) ? options.method : [options.method];
        for (const method of methods) found.push({ method, url: options.url, auth: options.config?.auth });
    });
    await app.ready();
    await app.close();
    return found;
}

describe("Jede Route ist öffentlich gelistet oder trägt ihr Recht", () => {
    it("🔴 keine Route ohne Entscheidung", async () => {
        const routes = await allRoutes();
        expect(routes.length).toBeGreaterThan(50);
        const undecided = routes.filter(({ method, url, auth }) => {
            if (auth !== undefined) return false;
            if (
                (method === "GET" || method === "HEAD") &&
                PUBLIC_READ_PREFIXES.some((prefix) => url.startsWith(prefix))
            ) {
                return false;
            }
            if ((PUBLIC_POSTS as readonly string[]).includes(`${method} ${url}`)) return false;
            return true;
        });
        expect(undecided.map(({ method, url }) => `${method} ${url}`)).toEqual([]);
    });

    it("🔴 die Statusseite trägt ihr Recht (WI-0120 A11, JOBS-0001 D1 A)", async () => {
        const routes = await allRoutes();
        const status = routes.filter(({ url }) => /^\/api\/(jobs|events|status\/)/u.test(url));
        expect(status.length).toBeGreaterThanOrEqual(5);
        for (const { method, url, auth } of status) {
            const capability = (auth as { capability?: string } | undefined)?.capability;
            expect(capability, `${method} ${url}`).toBe(
                url.startsWith("/api/status/") ? "view_operations" : "view_own_jobs",
            );
        }
    });

    it("🔴 unter /api/auth, /api/account und /api/admin ist nichts stillschweigend offen", async () => {
        const routes = await allRoutes();
        const guarded = routes.filter(({ url }) => /^\/api\/(auth|account|admin)\//u.test(url));
        expect(guarded.length).toBeGreaterThan(0);
        expect(guarded.filter(({ auth }) => auth === undefined).map(({ method, url }) => `${method} ${url}`)).toEqual(
            [],
        );
        // Öffentlich darf dort nur sein, was ohne Anmeldung gehen MUSS.
        const open = guarded.filter(({ auth }) => auth === "public").map(({ url }) => url);
        for (const url of open) expect(url).toMatch(/^\/api\/auth\//u);
    });
});
