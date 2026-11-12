import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AdminContentSwitches, type AdminContentSwitchRow } from "@avesmaps3d/shared";
import {
    folgeSatz,
    createInhalte,
    gruppen,
    schalterName,
    schalterUnter,
    schienenWert,
    standText,
} from "../src/auth/inhalte.ts";

/**
 * Der Eintrag „Inhalte“ (WI-0127 SYS-10) ohne Browser: Namen, Unterzeilen und Sätze wie im Blatt A2/A5, die Gruppen der Tafeln, „aus seit …“,
 * die Zahl in der Schiene und das Umschalten mit Inhaltsrevision und Passkey gegen einen nachgebauten Server.
 */

const NOW = new Date("2026-10-11T10:00:00Z");
const zeile = (key: string, group: AdminContentSwitchRow["group"], patch: Partial<AdminContentSwitchRow> = {}) => ({
    key,
    group,
    enabled: true,
    changedAt: null,
    changedBy: null,
    visible: null,
    ...patch,
});

function stand(patch: Partial<AdminContentSwitches> = {}): AdminContentSwitches {
    const body: AdminContentSwitches = {
        now: NOW.toISOString(),
        revision: 4,
        source: "database",
        rows: [
            zeile("media.role.coat", "media_role"),
            zeile("media.role.map_preview", "media_role", {
                enabled: false,
                changedAt: "2026-10-09T18:20:00Z",
                changedBy: "Rondrikan",
            }),
            zeile("media.rights.permission", "media_rights"),
            zeile("media.rights.unclear", "media_rights"),
            zeile("media.license.cc-by-sa", "media_rights"),
            zeile("panel.literature", "panel"),
            zeile("panel.lore.fauna", "panel"),
            zeile("panel.reviews", "panel"),
            zeile("map.series.original", "map"),
        ],
        unknownKeys: [],
        ...patch,
    };
    expect(Value.Check(AdminContentSwitches, body)).toBe(true);
    return body;
}

describe("Texte und Gruppen (Blatt A2, A5)", () => {
    it("Namen, Unterzeilen und Sätze; Lizenzen und Serien mit Rückfall auf die Kennung", () => {
        expect(schalterName("media.role.coat")).toBe("Wappen");
        expect(schalterUnter("media.role.coat")).toBe("an Orten und Gebieten, auch an den Gebietsnamen der Karte");
        expect(folgeSatz("media.role.map_preview")).toBe(
            "einen Platzhalter statt der Vorschau; Karten und Links bleiben",
        );
        expect(schalterName("media.license.cc-by-sa")).toBe("CC BY-SA");
        expect(schalterName("media.license.neu-1")).toBe("NEU-1");
        expect(schalterName("map.series.original")).toBe("Kartenserie „Original“");
        expect(folgeSatz("map.series.original")).toMatch(/^der Umschalter bietet sie nicht an/u);
        expect(schalterName("panel.lore.fauna")).toBe("Fauna");
    });

    it("🔴 die Tafeln: Vorkommen als eigene Zeile, Lizenzen getrennt von den Rechtsgründen", () => {
        const g = gruppen(stand());
        expect(g.art.map((row) => row.key)).toEqual(["media.role.coat", "media.role.map_preview"]);
        expect(g.rechte.map((row) => row.key)).toEqual(["media.rights.permission", "media.rights.unclear"]);
        expect(g.lizenzen.map((row) => row.key)).toEqual(["media.license.cc-by-sa"]);
        expect(g.panel.map((row) => row.key)).toEqual(["panel.literature", "panel.reviews"]);
        expect(g.vorkommen.map((row) => row.key)).toEqual(["panel.lore.fauna"]);
        expect(g.karte.map((row) => row.key)).toEqual(["map.series.original"]);
    });

    it("„aus seit … · Person“ nur bei aus; die Schiene zählt die ausgeschalteten", () => {
        const [, aus] = stand().rows;
        expect(standText(aus!, NOW)).toMatch(/^aus seit .+ · Rondrikan$/u);
        expect(standText(stand().rows[0]!, NOW)).toBeNull();
        // Bilder sagen, wie viele sie gerade zurückhalten (Blatt A2: „564 ausgeblendet seit …“).
        expect(standText({ ...aus!, hidden: 564 }, NOW)).toMatch(/^564 ausgeblendet seit .+ · Rondrikan$/u);
        expect(schienenWert(stand())).toBe("1 aus");
        expect(schienenWert(stand({ rows: [zeile("media.role.coat", "media_role")] }))).toBeUndefined();
        expect(schienenWert(null)).toBeUndefined();
    });
});

type Answer = { status: number; body?: unknown };
function server(...answers: Answer[]) {
    const calls: { url: string; method: string; body: Record<string, unknown> | undefined }[] = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls.push({
            url: String(url),
            method: init?.method ?? "GET",
            body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        });
        const answer = answers.shift() ?? { status: 500 };
        return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), { status: answer.status });
    };
    return { calls, fetcher: fetcher as typeof fetch };
}
const RECEIPT: Answer = {
    status: 200,
    body: { operationId: "x", status: "applied", environment: "test", affected: [], derivedWork: [], warnings: [] },
};

describe("Umschalten", () => {
    it("🔴 schickt Inhaltsrevision, Schlüssel und Stellung; danach neu geladen", async () => {
        const { calls, fetcher } = server({ status: 200, body: stand() }, RECEIPT, {
            status: 200,
            body: stand({ revision: 5 }),
        });
        const inhalte = createInhalte({ fetcher, ask: async () => true });
        await inhalte.load();
        expect((await inhalte.schalte("panel.reviews", false)).ok).toBe(true);
        const post = calls.find((call) => call.method === "POST");
        expect(post?.url).toBe("/api/admin/system/content-switches");
        expect(post?.body).toMatchObject({ baseRevision: 4, key: "panel.reviews", enabled: false });
        expect(inhalte.stand.value?.revision).toBe(5);
        expect(inhalte.busy.value).toBeNull();
    });

    it("die letzte Kartenserie: der Satz des Servers an ihrem Schlüssel; ein abgebrochener Passkey ändert nichts", async () => {
        const { fetcher } = server(
            { status: 200, body: stand() },
            { status: 409, body: { error: { code: "last_series", message: "x" } } },
            { status: 200, body: stand() },
            { status: 403, body: { error: { code: "reauth_required", message: "x", details: { need: "passkey" } } } },
            { status: 200, body: stand() },
        );
        const inhalte = createInhalte({ fetcher, ask: async () => false });
        await inhalte.load();
        expect(await inhalte.schalte("map.series.original", false)).toEqual({
            ok: false,
            problems: [{ key: "admin.content.error.lastSeries" }],
        });
        expect(inhalte.ergebnis.value?.key).toBe("map.series.original");
        expect(await inhalte.schalte("panel.reviews", false)).toEqual({
            ok: false,
            problems: [{ key: "admin.system.error.notConfirmed" }],
        });
    });
});
