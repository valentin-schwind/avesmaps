import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";

describe("Stillgelegte Visual-Relief-Kachelroute", () => {
    it("stellt keine zweite Höhenquelle mehr bereit", async () => {
        const app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
        });
        try {
            for (const url of [
                "/tiles/terrain/visual-relief/current.json",
                "/tiles/terrain/visual-relief/0054abcdef01/0/0/0.png",
            ]) {
                expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
            }
        } finally {
            await app.close();
        }
    });
});
