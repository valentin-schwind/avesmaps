import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { alsMehrfachauswahl } from "../src/editor-liste/mehrfachauswahl.ts";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import { createGebietseditorSteuerung } from "../src/gebietseditor/gebietseditor-steuerung.ts";

/**
 * Der Klick auf ein Herrschaftsgebiet im Editor-Modus (WI-0209 nach A4; wie die Landschaft, EDIT-0003 T34 (1), Regel 7 für Flächen;
 * Orchestrierung 2026-10-17). Problemfälle: Der Klick öffnet den Gebietseditor nicht, wenn er zu ist, oder wählt das Gebiet nicht; ein
 * zweiter Klick lässt zwei sichtbare Fenster stehen (je Gebiet ein Fenster, das erste wird abgelegt, D19); außerhalb des Editor-Modus, aus Suche oder Link oder still nimmt er dem Infopanel den Platz;
 * eine Landschaft landet im Gebietseditor.
 */
const GEBIET = { kind: "territory", id: "a4a4a4a4-0000-4000-8000-000000000001" } as const;

function aufbau(vorlaeufig = vi.fn()) {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ yearBf: 1049, rows: [] }), { status: 200 }));
    return createGebietseditorSteuerung(createWerkzeugfenster(undefined), fetcher, { vorlaeufig });
}

describe("Gebietseditor: Klick auf ein Gebiet", () => {
    it("🔴 im Editor-Modus öffnet der Kartenklick das Fenster am Gebiet, auch wenn es zu war; ein zweiter öffnet an seiner Stelle (D19)", () => {
        const steuerung = aufbau();
        expect(steuerung.geoeffnet(GEBIET, { source: "map", camera: "none" }, true)).toBe(true);
        expect(steuerung.fenster.value).toHaveLength(1);
        expect(steuerung.auswahl.value).toBe(GEBIET.id);
        expect(steuerung.bearbeitungVon(GEBIET.id)).toBeDefined();
        const anderes = { kind: "territory", id: "a4a4a4a4-0000-4000-8000-000000000002" } as const;
        expect(steuerung.geoeffnet(anderes, { source: "map", camera: "none" }, true)).toBe(true);
        // Je Gebiet ein Fenster (EDIT-0003 T44, D19, B2): Das zweite öffnet an der Stelle des ersten, das erste ist abgelegt.
        expect(steuerung.fenster.value.filter((x) => x.lage !== "versenkt")).toHaveLength(1);
        expect(steuerung.fenster.value.map((x) => x.gegenstand).sort()).toEqual([GEBIET.id, anderes.id].sort());
        expect(steuerung.auswahl.value).toBe(anderes.id);
        steuerung.destroy();
    });

    it("🔴 Fund 2 der Stage-Probe: hakt man in der Mehrfachauswahl genau eins an, geht das bisherige Fenster ohne Entwurf zu (kein leerer Eintrag unter „Offene Bearbeitungen“)", async () => {
        const steuerung = aufbau();
        steuerung.oeffneFuer(GEBIET.id);
        const anderes = "a4a4a4a4-0000-4000-8000-000000000002";
        alsMehrfachauswahl(() => {
            steuerung.mehrfachauswahl.setzeAn(true);
            steuerung.mehrfachauswahl.setzeAngehakt([anderes]);
        });
        await nextTick();
        expect(steuerung.fenster.value.map((x) => [x.gegenstand, x.lage])).toEqual([[anderes, "angedockt"]]);
        steuerung.destroy();
    });

    it("🔴 außerhalb des Editor-Modus, aus Suche oder Link, still, oder eine Landschaft: nichts", () => {
        const steuerung = aufbau();
        expect(steuerung.geoeffnet(GEBIET, { source: "map", camera: "none" }, false)).toBe(false);
        expect(steuerung.geoeffnet(GEBIET, { source: "link", camera: "none" }, true)).toBe(false);
        expect(steuerung.geoeffnet(GEBIET, { source: "map", camera: "none", still: true }, true)).toBe(false);
        expect(steuerung.geoeffnet({ kind: "area", id: "r-1" }, { source: "map", camera: "none" }, true)).toBe(false);
        expect(steuerung.fenster.value).toHaveLength(0);
        expect(steuerung.auswahl.value).toBeUndefined();
        steuerung.destroy();
    });

    it("🔴 Variante A: öffnet erst die Karte das Fenster, steht es nur mit den Eigenschaften; ein offenes und das Verb behalten die Liste", () => {
        const vorlaeufig = vi.fn();
        const steuerung = aufbau(vorlaeufig);
        steuerung.geoeffnet(GEBIET, { source: "map", camera: "none" }, true);
        expect(vorlaeufig).toHaveBeenCalledTimes(1);
        expect(vorlaeufig).toHaveBeenCalledWith(steuerung.fenster.value[0]!.id, true, "gebietseditor");
        steuerung.oeffneFuer("a4a4a4a4-0000-4000-8000-000000000003");
        expect(vorlaeufig).toHaveBeenCalledTimes(1);
        steuerung.destroy();
        const verb = aufbau(vorlaeufig);
        verb.oeffneWerkzeug();
        expect(vorlaeufig).toHaveBeenCalledTimes(1);
        verb.destroy();
    });
});

describe("Gebietseditor: nach „Fertig“ (Betreiber 2026-10-19: „umbenannt in Valis reich, aber es heisst immer noch neues herrschaftsgebiet“)", () => {
    it("🔴 meldet das geschriebene Gebiet mit der Kachelrevision, damit das Infopanel es neu liest", async () => {
        const detail = {
            id: GEBIET.id,
            revision: 1,
            name: "Neues Herrschaftsgebiet",
            color: "#888888",
            opacity: 0.33,
            order: 0,
            parents: [],
            children: [],
            details: {},
            areas: [],
            claimedBy: [],
            claims: [],
        };
        const fetcher = vi.fn(async (eingabe: RequestInfo | URL, init?: RequestInit) => {
            const url = String(eingabe);
            if (init?.method === "PATCH")
                return new Response(
                    JSON.stringify({
                        operationId: "op",
                        status: "applied",
                        environment: "test",
                        affected: [{ kind: "territory", id: GEBIET.id, revision: 2 }],
                        derivedWork: [],
                        warnings: [],
                        mapRevision: 77,
                    }),
                    { status: 200 },
                );
            if (url.endsWith(GEBIET.id)) return new Response(JSON.stringify(detail), { status: 200 });
            return new Response(JSON.stringify({ yearBf: 1049, rows: [] }), { status: 200 });
        });
        const geaendert = vi.fn();
        const sperre = {
            nimm: vi.fn(async (ziel: { kind: "territory"; id: string }, part: string) => ({
                art: "genommen" as const,
                sperre: { ...ziel, part, person: { id: "p", name: "Ich" }, since: "", heartbeatAt: "", own: true },
            })),
            gib: vi.fn(),
            beiVerlust: () => () => undefined,
        };
        const steuerung = createGebietseditorSteuerung(createWerkzeugfenster(undefined), fetcher, undefined, {
            sperre: sperre as never,
            geaendert,
            darfSchreiben: () => true,
        });
        steuerung.oeffneFuer(GEBIET.id);
        const bearbeitung = steuerung.bearbeitungVon(GEBIET.id)!;
        await vi.waitFor(() => expect(bearbeitung.detail.value?.name).toBe("Neues Herrschaftsgebiet"));
        bearbeitung.feld((felder) => ({ ...felder, name: "Valis Reich" }), "name");
        await bearbeitung.fertig();
        expect(fetcher).toHaveBeenCalledWith(
            expect.stringContaining(GEBIET.id),
            expect.objectContaining({ method: "PATCH" }),
        );
        expect(geaendert).toHaveBeenCalledWith(77, GEBIET.id);
    });
});

describe("Gebietseditor: Funde der Bedienprobe auf der Stage (Hauptorchestrierung 2026-10-19)", () => {
    const A = "a4a4a4a4-0000-4000-8000-0000000000a1";
    const B = "a4a4a4a4-0000-4000-8000-0000000000b2";
    const NAMEN: Record<string, string> = { [A]: "Valis Reich", [B]: "Claudios Reich" };
    const detailVon = (id: string) => ({
        id,
        revision: 1,
        name: NAMEN[id]!,
        color: "#888888",
        opacity: 0.33,
        order: 0,
        parents: [],
        children: [],
        details: {},
        areas: [],
        claimedBy: [],
        claims: [],
    });

    function aufbauMitEntwurf() {
        const abrufe: { url: string; methode: string }[] = [];
        const fetcher = vi.fn(async (eingabe: RequestInfo | URL, init?: RequestInit) => {
            const url = String(eingabe);
            const methode = init?.method ?? "GET";
            abrufe.push({ url, methode });
            if (methode !== "GET")
                return new Response(
                    JSON.stringify({
                        operationId: "op",
                        status: "applied",
                        environment: "test",
                        affected: [],
                        derivedWork: [],
                        warnings: [],
                        mapRevision: 9,
                    }),
                    { status: 200 },
                );
            // Die Hierarchie des gelöschten Gebiets gibt es nicht mehr.
            if (url.includes("/hierarchy")) return new Response("{}", { status: url.includes(A) ? 404 : 500 });
            const id = Object.keys(NAMEN).find((schluessel) => url.endsWith(schluessel));
            if (id !== undefined) return new Response(JSON.stringify(detailVon(id)), { status: 200 });
            return new Response(JSON.stringify({ yearBf: 1049, rows: [] }), { status: 200 });
        });
        const werkzeugfenster = createWerkzeugfenster(undefined);
        const sperre = {
            nimm: vi.fn(async (ziel: { kind: "territory"; id: string }, part: string) => ({
                art: "genommen" as const,
                sperre: { ...ziel, part, person: { id: "p", name: "Ich" }, since: "", heartbeatAt: "", own: true },
            })),
            gib: vi.fn(),
            beiVerlust: () => () => undefined,
        };
        const geaendert = vi.fn();
        const steuerung = createGebietseditorSteuerung(werkzeugfenster, fetcher, undefined, {
            sperre: sperre as never,
            geaendert,
            darfSchreiben: () => true,
        });
        const detailAbrufe = (id: string) => abrufe.filter((a) => a.methode === "GET" && a.url.endsWith(id)).length;
        return { steuerung, werkzeugfenster, abrufe, detailAbrufe, geaendert };
    }

    it("🔴 Wappen im Kasten geändert: Liste und Detail lesen neu, das Gebiet geht ohne Kachelrevision ans Infopanel", async () => {
        const { steuerung, abrufe, detailAbrufe, geaendert } = aufbauMitEntwurf();
        steuerung.oeffneFuer(B);
        await vi.waitFor(() => expect(steuerung.bearbeitungVon(B)?.detail.value?.name).toBe("Claudios Reich"));
        const listen = () =>
            abrufe.filter((a) => a.methode === "GET" && a.url.endsWith("/api/editor/territories")).length;
        const vorher = { liste: listen(), detail: detailAbrufe(B) };
        steuerung.wappenGeaendert(B);
        await vi.waitFor(() => expect(detailAbrufe(B)).toBeGreaterThan(vorher.detail));
        expect(listen()).toBeGreaterThan(vorher.liste);
        expect(geaendert).toHaveBeenCalledWith(undefined, B);
    });

    it("🔴 2: nach „Fertig“ an einem Gebiet liest ein anderes ruhendes Fenster neu (das Obergebiet nach dem Umhängen seiner Kinder)", async () => {
        const { steuerung, detailAbrufe } = aufbauMitEntwurf();
        steuerung.oeffneFuer(B);
        await vi.waitFor(() => expect(steuerung.bearbeitungVon(B)?.detail.value?.name).toBe("Claudios Reich"));
        steuerung.oeffneFuer(A);
        const a = steuerung.bearbeitungVon(A)!;
        await vi.waitFor(() => expect(a.detail.value?.name).toBe("Valis Reich"));
        const vorher = detailAbrufe(B);
        a.feld((felder) => ({ ...felder, name: "Valis Reich am See" }), "name");
        await a.fertig();
        await vi.waitFor(() => expect(detailAbrufe(B)).toBeGreaterThan(vorher));
    });

    it("🔴 3: nach dem Fehler der Hierarchie am gelöschten Gebiet fragt ein anderes Gebiet neu, und der Satz geht", async () => {
        const { steuerung, abrufe } = aufbauMitEntwurf();
        steuerung.hierarchieGebraucht(A);
        await vi.waitFor(() => expect(steuerung.hierarchieFehler.value).toBeDefined());
        steuerung.hierarchieGebraucht(B);
        expect(steuerung.hierarchieFehler.value).toBeUndefined();
        expect(abrufe.some((x) => x.url.includes(`${B}/hierarchy`))).toBe(true);
    });

    it("🔴 4: „Ganz löschen“ schließt das Fenster des Gebiets; „Von der Karte nehmen“ lässt es stehen", async () => {
        const { steuerung, werkzeugfenster } = aufbauMitEntwurf();
        const offen = (id: string) => werkzeugfenster.stand.value.fenster.some((f) => f.gegenstand === id);
        steuerung.oeffneFuer(A);
        await vi.waitFor(() => expect(steuerung.bearbeitungVon(A)?.detail.value).toBeDefined());
        expect(await steuerung.entferne(A, "off_map", undefined)).toEqual({ ok: true });
        expect(offen(A)).toBe(true);
        await vi.waitFor(() => expect(steuerung.bearbeitungVon(A)?.detail.value).toBeDefined());
        expect(await steuerung.entferne(A, "retire", undefined)).toEqual({ ok: true });
        expect(offen(A)).toBe(false);
    });
});
