import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";
import { datenbankAdresse } from "./medien-quelle.ts";

/**
 * Hält zu Beginn jedes Laufs fest, gegen welche Vite und welchen Fastify er läuft (WI-0189, Review T2-06). Ohne diese Zeilen ließ
 * sich nach einem roten Fall nicht mehr sagen, ob er am eigenen Code, an fremdem Servercode oder an Daten lag: `reuseExistingServer`
 * nimmt jede Vite am Port, und die Vite reicht `/api` an den Fastify auf `PORT` weiter, gleich aus welchem Checkout (2026-10-04
 * maßen drei Arbeitskopien gegeneinander, 2026-10-08 lief ein Server ohne `TILE_ROOT`).
 *
 * 🔴 Meldet nur. Ein Lauf gegen eine fremde Vite oder einen toten Stapel wird nicht angehalten; das wäre eine neue blockierende
 * Prüfung und bräuchte eine Entscheidung des Betreibers.
 */

const CHECKOUT = fileURLToPath(new URL("../../../", import.meta.url))
    .replace(/\\/g, "/")
    .replace(/\/$/, "");

async function lies(url: string): Promise<Response | null> {
    try {
        return await fetch(url, { signal: AbortSignal.timeout(5_000) });
    } catch {
        return null;
    }
}

/** Woher die Vite `@avesmaps3d/shared` nimmt, verrät ihren Checkout: Seit WI-0189 löst sie es auf die Quellen ihres Checkouts auf. */
async function vite(basis: string): Promise<string> {
    const antwort = await lies(`${basis}/src/app.vue`);
    if (antwort === null || !antwort.ok)
        return `⚠ Vite auf ${basis} antwortet nicht (${antwort?.status ?? "keine Verbindung"})`;
    const text = await antwort.text();
    const quelle = /\/@fs\/([^"'?]+?)\/packages\/shared\/src\/index\.ts/u.exec(text)?.[1];
    if (quelle === undefined)
        return `⚠ Vite auf ${basis} liest shared nicht aus den Quellen (älterer Stand); ihr Checkout ist unbekannt`;
    return quelle === CHECKOUT
        ? `Vite auf ${basis}: dieser Checkout`
        : `⚠ Vite auf ${basis} liefert einen ANDEREN Checkout aus: ${quelle}`;
}

interface Lokal {
    checkout: string;
    commit: string | null;
    tileRoot: boolean;
    mediaRoot: boolean;
    pid: number;
    gestartet: string;
}

async function fastify(port: string): Promise<string[]> {
    const basis = `http://127.0.0.1:${port}`;
    const lokal = await lies(`${basis}/health/lokal`);
    if (lokal === null) return [`⚠ Fastify auf Port ${port} antwortet nicht`];
    if (!lokal.ok)
        return [`⚠ Fastify auf Port ${port} kennt /health/lokal nicht (älterer Stand oder kein Entwicklungsserver)`];
    const kennung = (await lokal.json()) as Lokal;
    const zeilen = [
        `Fastify auf Port ${port}: ${kennung.checkout === CHECKOUT ? "dieser Checkout" : `⚠ ein ANDERER Checkout (${kennung.checkout})`}, ` +
            `Commit ${kennung.commit ?? "unbekannt"}, PID ${String(kennung.pid)}, gestartet ${kennung.gestartet}`,
    ];
    if (!kennung.tileRoot) zeilen.push(`⚠ Fastify auf Port ${port}: TILE_ROOT fehlt, Rasterkacheln antworten 503`);
    if (!kennung.mediaRoot) zeilen.push(`⚠ Fastify auf Port ${port}: MEDIA_ROOT fehlt, Medien antworten 503`);
    const routing = await lies(`${basis}/health/routing`);
    if (routing !== null) {
        const stand = (await routing.json()) as { state?: string; revision?: string };
        zeilen.push(`Wegenetz: ${stand.state ?? "unbekannt"}${stand.revision ? `, Revision ${stand.revision}` : ""}`);
    }
    return zeilen;
}

export default async function umgebung(config: FullConfig): Promise<void> {
    const basis = String(config.projects[0]?.use.baseURL ?? "");
    const zeilen = [
        `Browsertests aus ${CHECKOUT}`,
        await vite(basis),
        ...(await fastify(process.env["E2E_API_PORT"] ?? "3000")),
        // Specs mit echten Medien (`medien-quelle.ts`) überspringen ohne Datenbank ALLE Fälle; das steht hier, nicht nur als „skipped“.
        datenbankAdresse() === undefined
            ? "⚠ Keine DATABASE_URL (auch nicht in der .env des Hauptcheckouts): Specs mit echten Medien überspringen alle Fälle"
            : "Echte Medien: DATABASE_URL gesetzt",
    ];
    process.stdout.write(`${zeilen.map((zeile) => `  ${zeile}`).join("\n")}\n`);
}
