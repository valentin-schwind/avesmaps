import { describe, expect, it } from "vitest";
import {
    WIKISYNC_DUMP_URL,
    WIKISYNC_TAFELN_URL,
    WIKISYNC_UEBERNEHMEN_URL,
    WIKISYNC_ZURUECKNEHMEN_URL,
} from "@avesmaps3d/shared";
import type { Need } from "../src/auth/bestaetigen.ts";
import { ApiFailure } from "../src/auth/api.ts";
import { createWikisync, wikisyncProbleme } from "../src/wikisync/wikisync.ts";

/**
 * Jeder Knopf des Reiters „WikiSync“, der einen Passkey braucht (WI-0253, erster Lauf auf der Stage 2026-10-26): Verlangt der Server `reauth_required`
 * mit `need: passkey`, fragt die Oberfläche über das gemeinsame Fenster „Kurz bestätigen“ nach und wiederholt die Anfrage danach einmal. Der Server hier
 * ist nachgebaut: Er lehnt jede schreibende Anfrage ab, bis der Passkey gegeben ist, und antwortet dann mit einer Quittung.
 */

const QUITTUNG = { environment: "staging", affected: [], derivedWork: [], warnings: [] };

function server() {
    const zustand = { passkey: false, posts: [] as string[], bodies: [] as unknown[] };
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
        const pfad = String(url).split("?")[0] ?? "";
        await Promise.resolve();
        if (init?.method !== "POST") return new Response(JSON.stringify({}), { status: 200 });
        zustand.posts.push(pfad);
        zustand.bodies.push(typeof init.body === "string" ? JSON.parse(init.body) : null);
        if (!zustand.passkey) {
            return new Response(
                JSON.stringify({
                    error: {
                        code: "reauth_required",
                        message: "Die Anmeldung muss kurz bestätigt werden.",
                        details: { need: "passkey" },
                    },
                }),
                { status: 403 },
            );
        }
        return new Response(JSON.stringify(QUITTUNG), { status: 200 });
    }) as typeof fetch;
    const fragen: Need[] = [];
    const ask = async (need: Need): Promise<boolean> => {
        fragen.push(need);
        zustand.passkey = true;
        return true;
    };
    return { zustand, fetcher, ask, fragen };
}

const FAELLE: readonly {
    name: string;
    url: string;
    tue: (ws: ReturnType<typeof createWikisync>) => Promise<{ ok: boolean }>;
}[] = [
    {
        name: "WikiSync starten (einzelne Bereiche)",
        url: WIKISYNC_UEBERNEHMEN_URL,
        tue: (ws) => ws.starten({ bereiche: ["kraftlinie"], ablauf: "ganz" }),
    },
    {
        name: "WikiSync starten (alle)",
        url: WIKISYNC_UEBERNEHMEN_URL,
        tue: (ws) => ws.starten({ alle: true, ablauf: "ganz" }),
    },
    // Der Server fragt den Passkey nur in Production (Vali 2026-10-27); dort geht der Knopf denselben Weg.
    { name: "Dump holen", url: WIKISYNC_DUMP_URL, tue: (ws) => ws.dumpHolen() },
    { name: "Zurücknehmen (ein Bereich)", url: WIKISYNC_ZURUECKNEHMEN_URL, tue: (ws) => ws.zuruecknehmen(7, "ort") },
    { name: "Zurücknehmen (ganzer Lauf)", url: WIKISYNC_ZURUECKNEHMEN_URL, tue: (ws) => ws.zuruecknehmen(7) },
    {
        name: "Namensräume speichern",
        url: WIKISYNC_TAFELN_URL,
        tue: (ws) => ws.tafelnSpeichern("namensraeume", { namensraeume: [] } as never),
    },
    {
        name: "Objektarten ohne Wiki speichern",
        url: WIKISYNC_TAFELN_URL,
        tue: (ws) => ws.tafelnSpeichern("ohne", { objektarten: [] } as never),
    },
];

describe("WikiSync: jeder Passkey-Knopf fragt über das gemeinsame Fenster", () => {
    for (const fall of FAELLE) {
        it(`${fall.name}: 403 reauth_required, Passkey, dann gelingt es mit genau einer Wiederholung`, async () => {
            const { zustand, fetcher, ask, fragen } = server();
            const ws = createWikisync({ fetcher, ask });
            const ergebnis = await fall.tue(ws);
            expect(fragen).toEqual(["passkey"]);
            expect(zustand.posts.filter((pfad) => pfad === fall.url)).toHaveLength(2);
            expect(ergebnis.ok).toBe(true);
            expect(ws.ergebnis.value?.result.ok).toBe(true);
        });

        it(`${fall.name}: ohne Passkey bleibt es bei dem Satz, was fehlt`, async () => {
            const { fetcher } = server();
            const ws = createWikisync({ fetcher, ask: async () => false });
            const ergebnis = await fall.tue(ws);
            expect(ergebnis.ok).toBe(false);
            expect(ws.ergebnis.value?.result.problems).toEqual([{ key: "admin.system.error.notConfirmed" }]);
        });
    }

    it("🔴 „WikiSync starten“ ist EIN Aufruf: ein Passkey, eine Anfrage mit dem Ablauf (Dump, Kategorien-Datei und Übernahme verkettet der Server)", async () => {
        const { zustand, fetcher, ask, fragen } = server();
        const ws = createWikisync({ fetcher, ask });
        await ws.starten({ bereiche: ["ort", "weg"], ablauf: "ganz" });
        expect(fragen).toEqual(["passkey"]);
        // Die erste Anfrage wird abgelehnt, die zweite gelingt: dieselbe Handlung, nichts weiter (keine Vorschau und kein weiterer Teil als eigener Aufruf).
        expect(zustand.posts).toEqual([WIKISYNC_UEBERNEHMEN_URL, WIKISYNC_UEBERNEHMEN_URL]);
        expect(zustand.bodies.at(-1)).toMatchObject({ bereiche: ["ort", "weg"], ablauf: "ganz" });
        await ws.starten({ alle: true, ablauf: "ganz" });
        expect(zustand.bodies.at(-1)).toMatchObject({ alle: true, ablauf: "ganz" });
        expect(zustand.posts.every((pfad) => pfad === WIKISYNC_UEBERNEHMEN_URL)).toBe(true);
    });
});

describe("WikiSync: ein Fehler, den keine Zuordnung kennt, nennt seinen Code", () => {
    it("🔴 statt nur „Das ging gerade nicht.“: der Status und der Code des Servers, oder der Name des Fehlers in der Seite", () => {
        expect(wikisyncProbleme(new ApiFailure(403, "forbidden_origin", "x"))).toEqual([
            { key: "admin.wikisync.fehler.unbekannt", params: { code: "403 forbidden_origin" } },
        ]);
        expect(wikisyncProbleme(new TypeError("kaputt"))).toEqual([
            { key: "admin.wikisync.fehler.unbekannt", params: { code: "TypeError" } },
        ]);
        // Was eine Zuordnung kennt, behält seinen eigenen Satz.
        expect(wikisyncProbleme(new ApiFailure(409, "no_change", "x"))).toEqual([
            { key: "admin.wikisync.fehler.no_change" },
        ]);
        expect(wikisyncProbleme(new ApiFailure(429, "rate_limited", "x"))).toEqual([{ key: "auth.form.rateLimited" }]);
    });

    it("ein Fehler beim Dump holen, den der Server mit unbekanntem Code ablehnt, erscheint mit diesem Code an der Stelle der Handlung", async () => {
        const fetcher = (async () =>
            new Response(JSON.stringify({ error: { code: "forbidden_origin", message: "x" } }), {
                status: 403,
            })) as typeof fetch;
        const ws = createWikisync({ fetcher, ask: async () => true });
        const ergebnis = await ws.dumpHolen();
        expect(ergebnis.ok).toBe(false);
        expect(ws.ergebnis.value?.result.problems).toEqual([
            { key: "admin.wikisync.fehler.unbekannt", params: { code: "403 forbidden_origin" } },
        ]);
    });
});
