import { describe, expect, it } from "vitest";
import {
    AVENTURIA_SERIES,
    KARTENSERIEN_PRODUCTION_URL,
    KARTENSERIEN_URL,
    type AdminKartenserie,
    type AdminKartenserien,
} from "@avesmaps3d/shared";
import { createKartenserien, uebernahmeGesperrt, uebernahmeSatz } from "../src/kartenserien/kartenserien.ts";

/**
 * „Nach Production übernehmen“ im Browser (WI-0220 Schnitt 4, Vorlage Fassung 4): wann der Knopf gesperrt ist und warum, der Satz zur
 * letzten Übernahme, und dass der Knopf an die eigene Route schickt und danach neu lädt.
 */

const serie = AVENTURIA_SERIES.series.find((s) => s.id === "original")!;
function eintrag(teil: Partial<AdminKartenserie> = {}): AdminKartenserie {
    return {
        serie,
        quelle: "vorgabe",
        stufe: "alle",
        istVorgabe: false,
        fassung: { revision: "aaaaaaaaaaaa", maxNativeZoom: 6 },
        fassungen: [],
        auftrag: null,
        uebernahme: null,
        geaendert: null,
        ...teil,
    };
}

describe("Sperrgrund der Übernahme", () => {
    it("🔴 nur die Betreiber, nicht ausgeblendet, kein offener Auftrag, nur mit lesbarer Fassung", () => {
        expect(uebernahmeGesperrt(eintrag(), { darf: true, sonst: undefined })).toBeUndefined();
        expect(uebernahmeGesperrt(eintrag(), { darf: false, sonst: undefined })).toBe(
            "Nach Production übernehmen nur die Betreiber.",
        );
        expect(uebernahmeGesperrt(eintrag({ stufe: "niemand" }), { darf: true, sonst: undefined })).toContain(
            "ausgeblendete Serie",
        );
        const laeuft = {
            jobId: "j",
            state: "RUNNING",
            phase: "kopieren",
            fehler: null,
            revision: "aaaaaaaaaaaa",
            seit: "2026-10-18T12:00:00.000Z",
            bis: null,
        };
        expect(uebernahmeGesperrt(eintrag({ uebernahme: laeuft }), { darf: true, sonst: undefined })).toBe(
            "Für diese Serie läuft schon ein Upload oder Auftrag.",
        );
        expect(uebernahmeGesperrt(eintrag({ fassung: null }), { darf: true, sonst: undefined })).toBe(
            "Diese Fassung liegt nicht auf dem Server.",
        );
        expect(uebernahmeGesperrt(eintrag(), { darf: true, sonst: "beschäftigt" })).toBe("beschäftigt");
    });

    it("der Satz zur letzten Übernahme: wartet, läuft mit Phase, fertig mit Fassung, gescheitert mit Grund", () => {
        const jetzt = new Date("2026-10-18T12:10:00.000Z");
        const u = (teil: object) =>
            eintrag({
                uebernahme: {
                    jobId: "j",
                    state: "QUEUED",
                    phase: null,
                    fehler: null,
                    revision: "aaaaaaaaaaaa",
                    seit: "2026-10-18T12:00:00.000Z",
                    bis: null,
                    ...teil,
                },
            });
        expect(uebernahmeSatz(eintrag(), jetzt)).toBeNull();
        expect(uebernahmeSatz(u({}), jetzt)).toBe("Die Übernahme nach Production wartet in der Warteschlange.");
        expect(uebernahmeSatz(u({ state: "RUNNING", phase: "kopieren" }), jetzt)).toBe(
            "Die Übernahme nach Production läuft: Kopieren.",
        );
        expect(uebernahmeSatz(u({ state: "SUCCEEDED", bis: "2026-10-18T12:05:00.000Z" }), jetzt)).toMatch(
            /^Zuletzt nach Production übernommen: Fassung aaaaaaaaaaaa, /u,
        );
        expect(uebernahmeSatz(u({ state: "FAILED", fehler: "Proben rot" }), jetzt)).toBe(
            "Die Übernahme nach Production ist gescheitert: Proben rot",
        );
    });
});

describe("Der Knopf schickt an die eigene Route", () => {
    it("🔴 POST an …/production mit der Kennung, danach liest der Reiter neu", async () => {
        const aufrufe: { url: string; method: string; body: unknown }[] = [];
        const stand: AdminKartenserien = {
            now: "2026-10-18T12:00:00.000Z",
            revision: 3,
            source: "database",
            license: AVENTURIA_SERIES.license,
            serien: [eintrag()],
            papierkorb: [],
            platz: null,
            uploads: [],
            inArbeit: [],
            unknownKeys: [],
        };
        const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const method = init?.method ?? "GET";
            aufrufe.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
            if (method === "GET") return new Response(JSON.stringify(stand), { status: 200 });
            return new Response(
                JSON.stringify({
                    operationId: "x",
                    status: "applied",
                    environment: "staging",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                }),
                { status: 200 },
            );
        };
        const k = createKartenserien({ fetcher: fetcher as typeof fetch, ask: async () => true });
        await k.load();
        expect(await k.uebernehmen("original")).toBe(true);
        const post = aufrufe.find((a) => a.method === "POST");
        expect(post?.url).toBe(KARTENSERIEN_PRODUCTION_URL);
        expect(post?.body).toMatchObject({ id: "original" });
        expect(aufrufe.filter((a) => a.method === "GET" && a.url === KARTENSERIEN_URL)).toHaveLength(2);
    });
});
