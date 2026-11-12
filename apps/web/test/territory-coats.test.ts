import { describe, expect, it } from "vitest";
import { TERRITORY_COATS_URL, coatImageId, mediaPublicUrl } from "@avesmaps3d/shared";
import { loadTerritoryCoats } from "../src/map/territory-coats.ts";

/**
 * Die Wappenliste lesen (WI-0121): Fehlt sie, stehen die Namen allein; ist sie kaputt, sagt es die Karte laut.
 */

const SHA = "ab".repeat(32);
const GEBIET = "e201c69b-4811-48fd-826c-60ed976c73e0";

function antwort(status: number, body: unknown, typ = "application/json; charset=utf-8"): typeof fetch {
    return (() =>
        Promise.resolve(
            new Response(typeof body === "string" ? body : JSON.stringify(body), {
                status,
                headers: { "content-type": typ },
            }),
        )) as unknown as typeof fetch;
}

describe("Wappenliste lesen", () => {
    it("🔴 aus der Antwort wird die Liste für den Stil: Kennung des Gebiets → Bildname", async () => {
        const liste = await loadTerritoryCoats(
            antwort(200, { schemaVersion: 1, coats: { [GEBIET]: mediaPublicUrl(SHA) } }),
        );
        expect(liste).toEqual({ [GEBIET]: coatImageId(mediaPublicUrl(SHA)) });
    });

    it("fragt die Adresse des Vertrags, als JSON", async () => {
        let angefragt: { url: string; accept: string | null } | undefined;
        await loadTerritoryCoats(((url: string, init?: RequestInit) => {
            angefragt = { url, accept: new Headers(init?.headers).get("accept") };
            return Promise.resolve(
                new Response(JSON.stringify({ schemaVersion: 1, coats: {} }), {
                    headers: { "content-type": "application/json" },
                }),
            );
        }) as unknown as typeof fetch);
        expect(angefragt).toEqual({ url: TERRITORY_COATS_URL, accept: "application/json" });
    });

    it("🔴 liest tolerant: ein Feld, das eine neuere Version des Servers dazugibt, stört nicht", async () => {
        const liste = await loadTerritoryCoats(
            antwort(200, { schemaVersion: 1, coats: { [GEBIET]: mediaPublicUrl(SHA) }, neu: [1, 2] }),
        );
        expect(Object.keys(liste)).toEqual([GEBIET]);
    });

    it("🔴 keine Route (404) und eine Oberfläche statt JSON (Nginx ohne Ort) heißen: keine Wappen, die Namen stehen allein", async () => {
        expect(await loadTerritoryCoats(antwort(404, { error: { code: "not_found" } }))).toEqual({});
        expect(await loadTerritoryCoats(antwort(200, "<!doctype html><title>Avesmaps</title>", "text/html"))).toEqual(
            {},
        );
    });

    it("🔴 alles andere scheitert laut: 5xx, 204, kein JSON, falsches Schema, eine fremde Adresse", async () => {
        await expect(loadTerritoryCoats(antwort(503, { error: {} }))).rejects.toThrow(/503/);
        await expect(loadTerritoryCoats(antwort(204, ""))).rejects.toThrow(/204/);
        await expect(loadTerritoryCoats(antwort(200, "{kaputt"))).rejects.toThrow(/kein JSON/);
        await expect(loadTerritoryCoats(antwort(200, { schemaVersion: 2, coats: {} }))).rejects.toThrow();
        await expect(
            loadTerritoryCoats(antwort(200, { schemaVersion: 1, coats: { [GEBIET]: "https://example.org/w.webp" } })),
        ).rejects.toThrow();
    });
});
