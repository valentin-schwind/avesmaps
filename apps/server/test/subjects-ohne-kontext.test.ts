import Fastify from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SubjectService } from "../src/subjects/service.ts";
import { alsOhneKontext, istOhneKontext } from "../src/subjects/context.ts";
import { subjectRoutes } from "../src/routes/subjects.ts";

/**
 * Das Weg-Infopanel unter Last (WI-0283; Claudio 2026-11-06: 18-mal „canceling statement due to statement timeout“ an einem Abend, fast nur Wege). Problemfall: Der
 * Kontext („verläuft durch“) scheitert an seiner Zeitgrenze von 2 s, und das ganze Panel fällt mit 503 aus. Soll: Die Auskunft kommt, ohne Kontext, und landet nicht im
 * Zwischenspeicher; einen Augenblick später ist sie vollständig.
 */

const zeitgrenze = (): Error =>
    new postgres.PostgresError({
        name: "PostgresError",
        message: "canceling statement due to statement timeout",
        code: "57014",
    } as never);

const WEG = {
    subject: { kind: "path", anchor: "28300000-0000-4000-8000-000000000001" },
    revision: "r1",
    title: "Reichsstraße 3",
};

describe("Weg-Infopanel: Kontext an der Zeitgrenze", () => {
    const app = Fastify({ logger: false });
    const warn = vi.fn();
    let antwort: unknown = WEG;

    beforeAll(async () => {
        app.decorate("subjects", { detail: async () => antwort } as unknown as SubjectService);
        app.addHook("onRequest", async (request) => {
            request.log.warn = warn as never;
        });
        await app.register(subjectRoutes);
    });
    afterAll(async () => {
        await app.close();
    });

    it("erkennt die Zeitgrenze als Abbruch (57014), nicht als Ausfall des Kontexts allein", async () => {
        const { isStatementCancelled } = await import("../src/database.ts");
        expect(isStatementCancelled(zeitgrenze())).toBe(true);
    });

    it("🔴 eine Antwort ohne Kontext: 200, aber nie im Zwischenspeicher, und das Log zählt sie", async () => {
        antwort = alsOhneKontext({ ...WEG });
        expect(istOhneKontext(antwort)).toBe(true);
        const ergebnis = await app.inject({ url: "/api/subjects/path/name:Reichsstra%C3%9Fe%203" });
        expect(ergebnis.statusCode).toBe(200);
        expect(ergebnis.headers["cache-control"]).toBe("no-store");
        expect(warn).toHaveBeenCalledWith({ grund: "kontext_zeitgrenze" }, expect.any(String));
    });

    it("die vollständige Antwort bleibt zwischenspeicherbar", async () => {
        antwort = { ...WEG };
        expect(istOhneKontext(antwort)).toBe(false);
        const ergebnis = await app.inject({ url: "/api/subjects/path/name:Reichsstra%C3%9Fe%203" });
        expect(ergebnis.statusCode).toBe(200);
        expect(ergebnis.headers["cache-control"]).toMatch(/^public, max-age=/);
    });
});
