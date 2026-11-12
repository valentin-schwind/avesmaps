import { describe, expect, it } from "vitest";
import type { KanalVorgang } from "@avesmaps3d/shared";
import { createKanal, zustandName } from "../src/auth/kanal.ts";

/**
 * „An Community weiterleiten“ in der Oberfläche des Kanals (WI-0297; Vali 2026-11-09 zu OPS-000097): der dritte Knopf der Sichtung ruft
 * `POST /api/kanal/vorgaenge/:ops/an-community` mit der Revision, sperrt die zwei Freigaben solange mit (derselbe Schlüssel `sichten`), und die zwei
 * Fehler der Brücke bekommen eigene Sätze. Danach heißt der Zustand „an Community“ statt „akzeptiert“.
 */

const vorgang = { ops: "OPS-000097", revision: 3, status: "zu_sichten", abschluss: null } as unknown as KanalVorgang;

function antwort(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Kanal: An Community weiterleiten", () => {
    it("🔴 der Knopf schickt die Revision an den eigenen Weg und sperrt dabei auch die zwei Freigaben", async () => {
        const posts: { url: string; body: Record<string, unknown> }[] = [];
        let busyWaehrend: string | null = null;
        const kanal = createKanal({
            fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
                if (init?.method === "POST") {
                    busyWaehrend = kanal.busy.value;
                    posts.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
                    return antwort(200, {
                        operationId: "x",
                        status: "applied",
                        environment: "test",
                        affected: [],
                        derivedWork: [],
                        warnings: [],
                    });
                }
                return antwort(404, { error: { code: "kanal_not_found", message: "weg" } });
            }) as typeof fetch,
        });
        kanal.vorgang.value = vorgang;
        expect(await kanal.anCommunity()).toBe(true);
        expect(posts).toHaveLength(1);
        expect(posts[0]!.url).toBe("/api/kanal/vorgaenge/OPS-000097/an-community");
        expect(posts[0]!.body).toMatchObject({ baseRevision: 3 });
        expect(posts[0]!.body["operationId"]).toMatch(/^[0-9a-f-]{36}$/u);
        expect(busyWaehrend).toBe("sichten");
    });

    it("🔴 Brücke aus und Production nicht erreichbar: je ein eigener Satz, kein allgemeiner Fehler", async () => {
        for (const [code, key] of [
            ["kanal_community_aus", "kanal.error.communityAus"],
            ["kanal_community_ausfall", "kanal.error.communityAusfall"],
        ] as const) {
            const kanal = createKanal({
                fetcher: (async (_url: string | URL | Request, init?: RequestInit) =>
                    init?.method === "POST"
                        ? antwort(503, { error: { code, message: "Server" } })
                        : antwort(404, { error: { code: "kanal_not_found", message: "weg" } })) as typeof fetch,
            });
            kanal.vorgang.value = vorgang;
            expect(await kanal.anCommunity()).toBe(false);
            expect(kanal.fehler.value).toEqual([{ key }]);
        }
    });

    it("der Zustand: an die Community heißt „an Community“, alles andere wie bisher", () => {
        expect(zustandName({ status: "abgenommen", abschluss: "an_community" })).toBe("an Community");
        expect(zustandName({ status: "abgenommen", abschluss: "erledigt" })).toBe("akzeptiert");
        expect(zustandName({ status: "zu_sichten", abschluss: null })).toBe("zu sichten");
    });
});
