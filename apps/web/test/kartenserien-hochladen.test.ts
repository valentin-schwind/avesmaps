import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KARTENSERIE_STUECK_BYTES, type KartenserieAuftrag } from "@avesmaps3d/shared";
import { createHochladen, kennungAus, pruefeDatei, type HochladenStand } from "../src/kartenserien/hochladen.ts";
import { ablauf } from "../src/kartenserien/kartenserien.ts";

/**
 * Hochladen einer Kartenserie im Browser (WI-0220 Schnitt 3): der Kopf der Datei, die Kennung aus dem Namen, das stückweise Hochladen
 * mit Prüfsumme und Fortsetzen gegen einen nachgebauten Server, und der Ablauf, den der Reiter daraus zeigt.
 */

function png(kante: number, laenge = 2048): Uint8Array<ArrayBuffer> {
    const kopf = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const daten = new Uint8Array(laenge);
    daten.set(kopf, 0);
    new DataView(daten.buffer).setUint32(16, kante);
    new DataView(daten.buffer).setUint32(20, kante);
    return daten;
}
const datei = (bytes: Uint8Array<ArrayBuffer>, name = "nacht.png") => new File([bytes], name, { type: "image/png" });

describe("Die Datei vor dem Hochladen", () => {
    it("🔴 liest nur den Kopf: Quadrat mit erlaubter Kante passt, alles andere sagt warum", async () => {
        expect(await pruefeDatei(datei(png(8192)))).toMatchObject({ ok: true, kante: 8192 });
        expect((await pruefeDatei(datei(png(8192)))).satz).toContain("341 Kacheln");
        expect(await pruefeDatei(datei(png(10_000)))).toMatchObject({ ok: false, kante: null });
        expect(await pruefeDatei(datei(new Uint8Array(64), "kein.png"))).toMatchObject({ ok: false });
    });

    it("die Kennung aus dem Namen: Umlaute ausgeschrieben, nur Kleinbuchstaben, höchstens 24", () => {
        expect(kennungAus("Aventurien bei Nacht")).toBe("aventurienbeinacht");
        expect(kennungAus("Ödland & Größe")).toBe("oedlandgroesse");
        expect(kennungAus("x".repeat(40))).toHaveLength(24);
    });
});

type Antwort = { status: number; body?: unknown };
function server(antwort: (url: string, init: RequestInit) => Antwort) {
    const aufrufe: { url: string; method: string; headers: Record<string, string>; bytes: number }[] = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = init?.body;
        aufrufe.push({
            url: String(url),
            method: init?.method ?? "GET",
            headers: (init?.headers ?? {}) as Record<string, string>,
            bytes: body instanceof ArrayBuffer ? body.byteLength : 0,
        });
        const a = antwort(String(url), init ?? {});
        return new Response(a.body === undefined ? "" : JSON.stringify(a.body), { status: a.status });
    };
    return { aufrufe, fetcher: fetcher as typeof fetch };
}
const QUITTUNG = {
    operationId: "x",
    status: "applied",
    environment: "staging",
    affected: [],
    derivedWork: [],
    warnings: [],
};

describe("Hochladen gegen einen nachgebauten Server", () => {
    it("🔴 legt an, schickt Stücke zu 8 MiB mit ihrer Prüfsumme, schließt ab", async () => {
        const bytes = png(8192, KARTENSERIE_STUECK_BYTES + 1000);
        let empfangen = 0;
        const { aufrufe, fetcher } = server((url, init) => {
            if (init.method === "POST" && url.endsWith("/uploads"))
                return { status: 200, body: { ...QUITTUNG, affected: [{ kind: "map_series_upload", id: "u1" }] } };
            if (init.method === "PUT") {
                empfangen += (init.body as ArrayBuffer).byteLength;
                return { status: 200, body: { empfangen } };
            }
            return {
                status: 200,
                body: { ...QUITTUNG, derivedWork: [{ kind: "map_series_tile", jobId: "j1", state: "queued" }] },
            };
        });
        const h = createHochladen({ fetcher, ask: async () => true, warte: async () => undefined });
        const ok = await h.starte(datei(bytes), { art: "ersetzen", id: "original" }, 8192);
        expect(ok).toBe(true);
        const puts = aufrufe.filter((a) => a.method === "PUT");
        expect(puts.map((p) => [p.url.split("?")[1], p.bytes])).toEqual([
            ["versatz=0", KARTENSERIE_STUECK_BYTES],
            [`versatz=${KARTENSERIE_STUECK_BYTES}`, 1000],
        ]);
        const erstes = createHash("sha256").update(bytes.subarray(0, KARTENSERIE_STUECK_BYTES)).digest("hex");
        expect(puts[0]!.headers["x-avesmaps-sha256"]).toBe(erstes);
        expect(aufrufe.at(-1)?.url).toBe("/api/admin/system/kartenserien/uploads/u1/abschluss");
        expect(h.stand.value).toMatchObject({ phase: "fertig", jobId: "j1", empfangen: bytes.length });
    });

    it("🔴 ein verfälschtes Stück und ein verschobener Stand: weiter am Stand des Servers", async () => {
        const bytes = png(8192, 3000);
        let versuch = 0;
        const { aufrufe, fetcher } = server((url, init) => {
            if (init.method === "POST" && url.endsWith("/uploads"))
                return { status: 200, body: { ...QUITTUNG, affected: [{ kind: "map_series_upload", id: "u2" }] } };
            if (init.method === "PUT") {
                versuch += 1;
                if (versuch === 1)
                    return {
                        status: 422,
                        body: { error: { code: "kartenserien_pruefsumme", message: "x", details: { empfangen: 0 } } },
                    };
                return { status: 200, body: { empfangen: 3000 } };
            }
            return { status: 200, body: QUITTUNG };
        });
        const h = createHochladen({ fetcher, ask: async () => true, warte: async () => undefined });
        expect(await h.starte(datei(bytes), { art: "ersetzen", id: "old" }, 8192)).toBe(true);
        expect(aufrufe.filter((a) => a.method === "PUT")).toHaveLength(2);
    });

    it("Fortsetzen mit einer anderen Datei geht nicht; mit derselben ab dem Stand des Servers", async () => {
        const bytes = png(8192, 5000);
        const { aufrufe, fetcher } = server((_url, init) =>
            init.method === "PUT" ? { status: 200, body: { empfangen: 5000 } } : { status: 200, body: QUITTUNG },
        );
        const h = createHochladen({ fetcher, ask: async () => true, warte: async () => undefined });
        const upload = {
            uploadId: "u3",
            ziel: { art: "ersetzen" as const, id: "modern" },
            bytes: 5000,
            empfangen: 2000,
            kante: 8192,
            stueckBytes: KARTENSERIE_STUECK_BYTES,
            angelegt: "2026-10-18T12:00:00Z",
        };
        expect(await h.setzeFort(datei(png(8192, 4000)), upload)).toBe(false);
        expect(h.stand.value?.fehler).toEqual([{ key: "admin.kartenserien.hochladen.andereDatei" }]);
        expect(await h.setzeFort(datei(bytes), upload)).toBe(true);
        expect(aufrufe.find((a) => a.method === "PUT")?.url).toContain("versatz=2000");
    });
});

describe("Der Ablauf im Reiter", () => {
    const upload = (teil: Partial<HochladenStand>): HochladenStand => ({
        serie: "nacht",
        art: "neu",
        phase: "hochladen",
        uploadId: "u",
        empfangen: 0,
        bytes: 1000,
        fehler: [],
        jobId: null,
        ...teil,
    });
    const auftrag = (teil: Partial<KartenserieAuftrag>): KartenserieAuftrag => ({
        jobId: "j",
        state: "RUNNING",
        phase: "zerlegen",
        progress: 0.45,
        waitReason: null,
        fehler: null,
        art: "neu",
        kante: 8192,
        seit: "2026-10-18T12:00:00Z",
        ...teil,
    });

    it("🔴 Hochladen bis 40 %, Warten, Zerlegen mit Kacheln, Umschalten; gescheitert nennt den Grund", () => {
        expect(ablauf(upload({ empfangen: 500 }), null)).toMatchObject({ schritt: 0, prozent: 20, angehalten: false });
        expect(ablauf(upload({ phase: "angehalten" }), null)?.angehalten).toBe(true);
        expect(ablauf(null, auftrag({ state: "QUEUED", phase: null, progress: null }))).toMatchObject({ schritt: 2 });
        const zerlegen = ablauf(null, auftrag({}));
        expect(zerlegen).toMatchObject({ schritt: 3, prozent: 67 });
        expect(zerlegen?.zeile).toContain("von 341 Kacheln");
        expect(ablauf(null, auftrag({ phase: "umschalten", progress: 0.95 }))?.schritt).toBe(4);
        expect(ablauf(null, auftrag({ state: "FAILED", fehler: "Die Quelle ist kein Quadrat" }))?.fehler).toBe(
            "Die Quelle ist kein Quadrat",
        );
        expect(ablauf(null, null)).toBeNull();
        // Ein fertiger Upload zeigt nichts mehr; dann spricht der Auftrag.
        expect(ablauf(upload({ phase: "fertig" }), null)).toBeNull();
    });
});
