import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { TERRITORY_DETAIL_MAX, TerritoryUpdateBody } from "@avesmaps3d/shared";

/**
 * Der Vertrag der 17 Detailfelder durch Fastifys eigene Prüfung (WI-0209 G6). 🪤 Falle aus `docs/regeln/entwicklung.md`: ajv wandelt
 * in einer Vereinigung aus Text und `null` still um, ohne 400: Text vorn macht `null` zu `""` (dem bewussten Leerwert), `null` vorn `""` zu
 * `null`. Darum EIN Schema `type: ["string", "null"]`. Ohne
 * Datenbank: `buildApp` setzt keine eigenen ajv-Optionen, also prüft eine Route mit dem Schema von `PATCH /api/editor/territories/:id`
 * genauso.
 */
describe("Detailfelder im Vertrag (G6)", () => {
    it("🔴 { value: null } kommt als null an, nicht als bewusster Leerwert; Text, Leerwert und ↺ bleiben, wie sie sind", async () => {
        const app = Fastify();
        let angekommen: unknown;
        app.patch("/probe", { schema: { body: TerritoryUpdateBody } }, async (request) => {
            angekommen = request.body;
            return {};
        });
        const body = {
            operationId: randomUUID(),
            baseRevision: 3,
            changes: {
                details: {
                    currency: { value: null },
                    ruler: { value: "" },
                    founder: { value: "Raul" },
                    language: { revert: "wiki" },
                },
            },
        };
        try {
            const antwort = await app.inject({ method: "PATCH", url: "/probe", payload: body });
            expect(antwort.statusCode).toBe(200);
            expect(angekommen).toEqual(body);
            // Die Länge prüft der Vertrag weiter, ein Objekt bleibt ungültig.
            const zuLang = {
                ...body,
                changes: { details: { blazon: { value: "x".repeat(TERRITORY_DETAIL_MAX + 1) } } },
            };
            expect((await app.inject({ method: "PATCH", url: "/probe", payload: zuLang })).statusCode).toBe(400);
            const objekt = { ...body, changes: { details: { blazon: { value: { text: "x" } } } } };
            expect((await app.inject({ method: "PATCH", url: "/probe", payload: objekt })).statusCode).toBe(400);
        } finally {
            await app.close();
        }
    });
});
