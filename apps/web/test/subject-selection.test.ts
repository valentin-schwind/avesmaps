import { beforeEach, describe, expect, it, vi } from "vitest";
import { subjectKey, type SubjectDetail, type SubjectRef } from "@avesmaps3d/shared";
import type { PresentedSelection } from "../src/info-panel/presentation.ts";
import { createRevisionCache } from "../src/info-panel/subject-cache.ts";
import type { SubjectAnswer, SubjectClient } from "../src/info-panel/subject-client.ts";
import {
    createSubjectSelection,
    type OpenSubjectOptions,
    type SubjectSelection,
} from "../src/info-panel/subject-selection.ts";

/**
 * Die Auswahl und der rechte Slot (WI-0063 P5, §8, §11, §16): genau EIN gewählter Subject, EINE Öffnungsnaht.
 * Der Dienst ist ein Testdoppel, dessen Antworten der Test selbst abschickt - so lässt sich die Reihenfolge der Antworten
 * bestimmen, die im Netz der Zufall bestimmt.
 */

const REVISION = "1b1fc50153bf";
const GARETH: SubjectRef = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };
const WALD: SubjectRef = { kind: "area", id: "0b5a8b1e-4a6c-4f0e-9d0b-2f0a5b8c7d11" };
const FLUSS: SubjectRef = { kind: "path", chain: "Gardel:Flussweg" };

const garethDetail: SubjectDetail = {
    subject: GARETH,
    revision: REVISION,
    title: "Gareth",
    subtitle: [{ part: "type", key: "metropole" }],
    target: { x: 551.625, y: 532.969, zoom: 5 },
};
const waldDetail: SubjectDetail = {
    subject: WALD,
    revision: REVISION,
    title: "Waldwildnis",
    subtitle: [{ part: "type", key: "wald" }],
    target: { x: 400, y: 300, zoom: 4, bounds: [380, 280, 420, 320] },
};
interface Call {
    ref: SubjectRef;
    signal: AbortSignal | undefined;
    frisch?: boolean | undefined;
    resolve: (answer: SubjectAnswer | null) => void;
    reject: (error: Error) => void;
}

interface Harness {
    selection: SubjectSelection;
    calls: Call[];
    presented: PresentedSelection[];
    cleared: () => number;
    flights: { ref: SubjectRef; target: unknown }[];
}

function create(options: { canPin?: boolean; now?: () => number } = {}): Harness {
    const calls: Call[] = [];
    const client: SubjectClient = {
        detail: (ref, signal, frisch) =>
            new Promise((resolve, reject) => calls.push({ ref, signal, frisch, resolve, reject })),
        resolveLink: () => Promise.reject(new Error("nicht gebraucht")),
    };
    const presented: PresentedSelection[] = [];
    const flights: Harness["flights"] = [];
    let cleared = 0;
    const selection = createSubjectSelection({
        client,
        canPin: options.canPin ?? false,
        cache: createRevisionCache<SubjectAnswer>({ ttlMs: 60_000, size: 10, now: options.now ?? (() => 0) }),
        effects: {
            present: (next) => presented.push(next),
            clear: () => {
                cleared += 1;
            },
            fly: (ref, target) => flights.push({ ref, target }),
        },
    });
    return { selection, calls, presented, cleared: () => cleared, flights };
}

const map: Pick<OpenSubjectOptions, "source" | "camera"> = { source: "map", camera: "none" };
const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("🔴 eine verspätete Antwort überschreibt nie einen neueren Subject (WI-0063 11.3)", () => {
    it("Gareth anklicken, sofort Waldwildnis, die langsame Gareth-Antwort kommt später: Das Panel bleibt Waldwildnis", async () => {
        const { selection, calls } = create();
        selection.openSubject(GARETH, { ...map, known: { title: "Gareth" } });
        selection.openSubject(WALD, { ...map, known: { title: "Waldwildnis" } });
        expect(calls).toHaveLength(2);
        // Die zweite Antwort kommt zuerst, die erste, überholte danach.
        calls[1]?.resolve(waldDetail);
        await flush();
        calls[0]?.resolve(garethDetail);
        await flush();
        expect(selection.shown.value?.status).toBe("ready");
        expect(selection.shown.value?.answer).toBe(waldDetail);
        expect(subjectKey(selection.selected.value as SubjectRef)).toBe(subjectKey(WALD));
    });

    it("auch umgekehrt: Kommt die Gareth-Antwort VOR der zweiten, überschreibt die zweite sie", async () => {
        const { selection, calls } = create();
        selection.openSubject(GARETH, map);
        selection.openSubject(WALD, map);
        calls[0]?.resolve(garethDetail);
        await flush();
        expect(selection.shown.value?.answer).toBeUndefined();
        expect(selection.shown.value?.status).toBe("loading");
        calls[1]?.resolve(waldDetail);
        await flush();
        expect(selection.shown.value?.answer).toBe(waldDetail);
    });

    it("jede Öffnung bricht die Frage nach der vorigen ab (AbortController)", () => {
        const { selection, calls } = create();
        selection.openSubject(GARETH, map);
        selection.openSubject(WALD, map);
        expect(calls[0]?.signal?.aborted).toBe(true);
        expect(calls[1]?.signal?.aborted).toBe(false);
    });

    it("eine Antwort nach dem Schließen zeichnet nichts mehr", async () => {
        const { selection, calls, presented } = create();
        selection.openSubject(GARETH, { source: "link", camera: "target" });
        selection.closeSubject({ source: "escape" });
        calls[0]?.resolve(garethDetail);
        await flush();
        expect(selection.shown.value).toBeUndefined();
        expect(presented).toEqual([]);
    });

    it("🪤 ein überholter Fehlschlag ändert nichts: nur der des gewählten Subjects zählt", async () => {
        const { selection, calls } = create();
        const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
        selection.openSubject(GARETH, map);
        selection.openSubject(WALD, map);
        calls[0]?.reject(new Error("Netz"));
        await flush();
        expect(selection.shown.value?.status).toBe("loading");
        quiet.mockRestore();
    });
});

describe("`subjectKey`: gleicher Subject, gleicher Schlüssel", () => {
    it("derselbe Ort noch einmal angeklickt fragt nichts neu, die Antwort bleibt", async () => {
        const { selection, calls } = create();
        selection.openSubject(GARETH, map);
        calls[0]?.resolve(garethDetail);
        await flush();
        selection.openSubject({ ...GARETH }, map);
        expect(calls).toHaveLength(1);
        expect(selection.shown.value?.answer).toBe(garethDetail);
    });

    it("zwei Druckstellen derselben Hundertstel sind derselbe Kartenpunkt", () => {
        expect(subjectKey({ kind: "mapPoint", x: 10.001, y: 20 })).toBe(
            subjectKey({ kind: "mapPoint", x: 10.004, y: 20 }),
        );
        expect(subjectKey({ kind: "mapPoint", x: 10.01, y: 20 })).not.toBe(
            subjectKey({ kind: "mapPoint", x: 10, y: 20 }),
        );
    });

    it("der Server nennt den kanonischen Ref: ein Weg über die Kette wird sein Anker samt Wiki-Schlüssel", async () => {
        const { selection, calls } = create();
        selection.openSubject(FLUSS, map);
        const canonical: SubjectRef = {
            kind: "path",
            anchor: "11111111-2222-4333-8444-555555555555",
            wiki: "Gardel",
        };
        calls[0]?.resolve({ subject: canonical, revision: REVISION, title: "Gardel" });
        await flush();
        expect(selection.selected.value).toEqual(canonical);
        // Derselbe Fluss noch einmal über die Kette: kein neuer Abruf, es ist derselbe Subject.
        selection.openSubject(FLUSS, map);
        expect(calls).toHaveLength(1);
    });
});

describe("der kurze Cache gilt nur unter (revision, subjectKey)", () => {
    it("derselbe Subject nach dem Schließen kommt aus dem Cache, nicht noch einmal vom Server", async () => {
        const { selection, calls } = create();
        selection.openSubject(GARETH, map);
        calls[0]?.resolve(garethDetail);
        await flush();
        selection.closeSubject();
        selection.openSubject(GARETH, map);
        expect(calls).toHaveLength(1);
        expect(selection.shown.value?.status).toBe("ready");
    });

    it("🔴 eine neue Revision macht die alten Einträge wertlos", async () => {
        const { selection, calls } = create();
        selection.openSubject(GARETH, map);
        calls[0]?.resolve(garethDetail);
        await flush();
        selection.openSubject(WALD, map);
        calls[1]?.resolve({ ...waldDetail, revision: "ffffffffffff" });
        await flush();
        selection.closeSubject();
        selection.openSubject(GARETH, map);
        expect(calls).toHaveLength(3);
    });

    it("🔴 ein Eintrag läuft nach seiner Zeit ab", async () => {
        let now = 0;
        const { selection, calls } = create({ now: () => now });
        selection.openSubject(GARETH, map);
        calls[0]?.resolve(garethDetail);
        await flush();
        selection.closeSubject();
        now = 61_000;
        selection.openSubject(GARETH, map);
        expect(calls).toHaveLength(2);
    });

    it("ein Subject, der nicht (mehr) da ist (404), wird nicht gecacht und heißt „missing“", async () => {
        const { selection, calls } = create();
        selection.openSubject(GARETH, map);
        calls[0]?.resolve(null);
        await flush();
        expect(selection.shown.value?.status).toBe("missing");
        selection.closeSubject();
        selection.openSubject(GARETH, map);
        expect(calls).toHaveLength(2);
    });
});

describe("die Darstellung der Karte wird aus dem einen Subject gespeist, nicht von ihm ersetzt", () => {
    it("🔴 was die Karte schon kennt, zeigt sie sofort - ohne die Antwort abzuwarten", () => {
        const { selection, presented } = create();
        const place = {
            id: GARETH.kind === "place" ? GARETH.id : "",
            name: "Gareth",
            subtype: "metropole",
            x: 1,
            y: 2,
        };
        selection.openSubject(GARETH, { ...map, known: { title: "Gareth", presentation: { place } } });
        expect(presented).toEqual([{ place }]);
        expect(selection.shown.value?.title).toBe("Gareth");
        expect(selection.shown.value?.status).toBe("loading");
    });

    it("🔴 ein Link kennt nur die Antwort: Die Darstellung kommt mit ihr, und die Kamera fliegt zu ihrem Ziel", async () => {
        const { selection, calls, presented, flights } = create();
        selection.openSubject(GARETH, { source: "link", camera: "target" });
        expect(presented).toEqual([]);
        calls[0]?.resolve(garethDetail);
        await flush();
        expect(presented).toHaveLength(1);
        expect(presented[0]?.place).toMatchObject({
            id: GARETH.kind === "place" ? GARETH.id : "",
            name: "Gareth",
            x: 551.625,
        });
        expect(flights).toEqual([{ ref: GARETH, target: garethDetail.target }]);
    });

    it("🔴 die Kamera fliegt nur, wo der Aufrufer es verlangt: Ein Kartenklick lässt sie, wo sie ist", async () => {
        const { selection, calls, flights } = create();
        selection.openSubject(GARETH, map);
        calls[0]?.resolve(garethDetail);
        await flush();
        expect(flights).toEqual([]);
    });

    it("eine freie Kartenstelle zeigt ihren Tropfen sofort und fliegt hin, ohne die Antwort abzuwarten", () => {
        const { selection, presented, flights } = create();
        const point: SubjectRef = { kind: "mapPoint", x: 12.5, y: 40.25 };
        selection.openSubject(point, { source: "link", camera: "target" });
        expect(presented).toEqual([{ pin: { x: 12.5, y: 40.25 } }]);
        expect(flights).toEqual([{ ref: point, target: undefined }]);
    });

    it("eine Etappe lebt im Planer: kein Abruf, sofort bereit", () => {
        const { selection, calls } = create();
        selection.openSubject({ kind: "routeStage", index: 2, routeKey: "a~b" }, { source: "planner", camera: "none" });
        expect(calls).toEqual([]);
        expect(selection.shown.value?.status).toBe("ready");
    });

    it("🔴 eine Etappe löst den Ort ab: Was der vorige Subject leuchten ließ, endet - die Etappe selbst gehört dem Planer", () => {
        const { selection, presented } = create();
        const place = { id: "p1", name: "Gareth", subtype: "metropole", x: 1, y: 2 };
        selection.openSubject(GARETH, { ...map, known: { presentation: { place } } });
        selection.openSubject({ kind: "routeStage", index: 0, routeKey: "a~b" }, { source: "planner", camera: "none" });
        // Die letzte Darstellung ist leer: kein Ort, keine Fläche, kein Tropfen, und `stage` fehlt (der Planer behält sie).
        expect(presented.at(-1)).toEqual({});
    });

    it("🔴 ein Fehlschlag sagt es und lässt sich wiederholen; die Wiederholung fragt neu", async () => {
        const { selection, calls } = create();
        const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
        selection.openSubject(GARETH, map);
        calls[0]?.reject(new Error("503"));
        await flush();
        expect(selection.shown.value?.status).toBe("error");
        selection.retry();
        expect(selection.shown.value?.status).toBe("loading");
        expect(calls).toHaveLength(2);
        calls[1]?.resolve(garethDetail);
        await flush();
        expect(selection.shown.value?.status).toBe("ready");
        quiet.mockRestore();
    });

    it("nichts gewählt: Schließen räumt die ganze Darstellung ab", () => {
        const { selection, cleared } = create();
        selection.openSubject(GARETH, map);
        selection.closeSubject();
        expect(cleared()).toBe(1);
        expect(selection.selected.value).toBeUndefined();
        expect(selection.hasContent.value).toBe(false);
    });
});

describe("der rechte Slot: info, editor, geschlossen, eingeklappt (WI-0063 §8)", () => {
    let h: Harness;
    beforeEach(() => {
        h = create();
    });

    it("🔴 der Slot ist zu, bis etwas gewählt ist; die Wahl öffnet das Infopanel", () => {
        expect(h.selection.slot.value).toBe("closed");
        expect(h.selection.panelVisible.value).toBe(false);
        h.selection.openSubject(GARETH, map);
        expect(h.selection.slot.value).toBe("info");
        expect(h.selection.panelVisible.value).toBe(true);
    });

    it("🔴 die Randlasche klappt nur die Darstellung ein: Die Auswahl bleibt", () => {
        h.selection.openSubject(GARETH, map);
        h.selection.togglePanel();
        expect(h.selection.panelVisible.value).toBe(false);
        expect(h.selection.hasContent.value).toBe(true);
        expect(h.selection.selected.value).toEqual(GARETH);
        h.selection.togglePanel();
        expect(h.selection.panelVisible.value).toBe(true);
    });

    it("🔴 ein Leerklick hebt die Auswahl auf, und das Panel klappt ein", () => {
        h.selection.openSubject(GARETH, map);
        expect(h.selection.closeSubject()).toBe(true);
        expect(h.selection.panelVisible.value).toBe(false);
        expect(h.selection.slot.value).toBe("closed");
    });

    it("eine neue Wahl holt ein eingeklapptes Panel wieder hervor", () => {
        h.selection.openSubject(GARETH, map);
        h.selection.collapsePanel();
        h.selection.openSubject(WALD, map);
        expect(h.selection.panelVisible.value).toBe(true);
    });

    it("🔴 ein aktives Editorpanel bleibt vorn: Das Infopanel zieht nur im Hintergrund nach und zählt nicht als sichtbar", () => {
        h.selection.slot.value = "editor";
        h.selection.openSubject(GARETH, map);
        expect(h.selection.slot.value).toBe("editor");
        expect(h.selection.panelVisible.value).toBe(false);
        // Der Inhalt zieht trotzdem nach.
        expect(h.selection.shown.value?.key).toBe(subjectKey(GARETH));
        // Escape: Das Infopanel ist nicht sichtbar, also schließt es nicht; die Auswahl der Karte endet erst in der nächsten Stufe.
        expect(h.selection.escapeVisible()).toBe(false);
        expect(h.selection.selected.value).toEqual(GARETH);
        expect(h.selection.escapeSelection()).toBe(true);
        expect(h.selection.selected.value).toBeUndefined();
        // Der Editor bleibt, wie er ist.
        expect(h.selection.slot.value).toBe("editor");
    });

    it("🔴 Escape schließt das SICHTBARE Infopanel samt Auswahl; ein eingeklapptes ist nicht sichtbar", () => {
        h.selection.openSubject(GARETH, map);
        h.selection.collapsePanel();
        expect(h.selection.escapeVisible()).toBe(false);
        h.selection.togglePanel();
        expect(h.selection.escapeVisible()).toBe(true);
        expect(h.selection.selected.value).toBeUndefined();
    });
});

describe("🔴 zwei Laschen, ein Slot, eins offen (WI-0128 E3, Legacy `avesmapsEdgePanels`)", () => {
    let h: Harness;
    beforeEach(() => {
        h = create();
    });

    it("die Lasche „Editor“ öffnet das Editorpanel und schließt den Slot wieder; ohne Auswahl ist er danach zu", () => {
        h.selection.toggleEditor();
        expect(h.selection.editorVisible.value).toBe(true);
        expect(h.selection.slotOpen.value).toBe(true);
        h.selection.toggleEditor();
        expect(h.selection.editorVisible.value).toBe(false);
        expect(h.selection.slot.value).toBe("closed");
        expect(h.selection.slotOpen.value).toBe(false);
    });

    it("🔴 vorn steht immer nur eins: Das Editorpanel verdeckt ein offenes Infopanel, die Auswahl bleibt", () => {
        h.selection.openSubject(GARETH, map);
        h.selection.toggleEditor();
        expect(h.selection.panelVisible.value).toBe(false);
        expect(h.selection.editorVisible.value).toBe(true);
        expect(h.selection.selected.value).toEqual(GARETH);
    });

    it("🔴 die Lasche „Info“ holt das Infopanel vor das Editorpanel", () => {
        h.selection.openSubject(GARETH, map);
        h.selection.toggleEditor();
        h.selection.togglePanel();
        expect(h.selection.panelVisible.value).toBe(true);
        expect(h.selection.editorVisible.value).toBe(false);
    });

    it("das Editorpanel zu: Mit Auswahl steht das Infopanel eingeklappt dahinter, seine Lasche bleibt", () => {
        h.selection.openSubject(GARETH, map);
        h.selection.toggleEditor();
        h.selection.toggleEditor();
        expect(h.selection.slot.value).toBe("info");
        expect(h.selection.panelVisible.value).toBe(false);
        expect(h.selection.slotOpen.value).toBe(false);
        expect(h.selection.hasContent.value).toBe(true);
    });

    it("ohne Auswahl tut die Lasche „Info“ nichts, auch nicht vor dem Editorpanel", () => {
        h.selection.showEditor();
        h.selection.togglePanel();
        expect(h.selection.editorVisible.value).toBe(true);
    });

    it("🔴 eine Wahl aus der Liste eines Werkzeugs (`still`) markiert, holt das Infopanel aber nicht nach vorn (E6)", () => {
        h.selection.openSubject(GARETH, { source: "link", camera: "none", still: true });
        expect(h.selection.selected.value).toEqual(GARETH);
        expect(h.selection.slot.value).toBe("closed");
        expect(h.selection.panelVisible.value).toBe(false);
    });

    it("`closeEditor` schließt nur ein Editorpanel, das vorn steht", () => {
        h.selection.openSubject(GARETH, map);
        h.selection.closeEditor();
        expect(h.selection.panelVisible.value).toBe(true);
        h.selection.showEditor();
        h.selection.closeEditor();
        expect(h.selection.editorVisible.value).toBe(false);
    });
});

describe("🔴 lokale Auswahlfixierung (WI-0063 4.11, §16): nur Editor, nur die eigene Auswahl", () => {
    it("ein Besucher kann nichts fixieren: Die Leertaste gehört seiner Suche", () => {
        const { selection } = create({ canPin: false });
        selection.openSubject(GARETH, map);
        expect(selection.togglePin()).toBe(false);
        expect(selection.pinned.value).toBe(false);
    });

    it("ohne Auswahl gibt es nichts festzuhalten", () => {
        const { selection } = create({ canPin: true });
        expect(selection.togglePin()).toBe(false);
        expect(selection.pinned.value).toBe(false);
    });

    it("🔴 fixiert wechselt kein normaler Kartenklick den Subject - auch nicht ein Leerklick", () => {
        const { selection, calls, cleared } = create({ canPin: true });
        selection.openSubject(GARETH, map);
        expect(selection.togglePin()).toBe(true);
        expect(selection.openSubject(WALD, map)).toBe(false);
        expect(selection.closeSubject()).toBe(false);
        expect(selection.selected.value).toEqual(GARETH);
        expect(calls).toHaveLength(1);
        expect(cleared()).toBe(0);
    });

    it("Hover und Kamera bleiben: Die Fixierung ändert den Slot nicht, die Randlasche klappt weiter ein", () => {
        const { selection } = create({ canPin: true });
        selection.openSubject(GARETH, map);
        selection.togglePin();
        selection.togglePanel();
        expect(selection.panelVisible.value).toBe(false);
        expect(selection.pinned.value).toBe(true);
    });

    it("die Leertaste löst sie wieder, dann wechselt der Klick wieder", () => {
        const { selection } = create({ canPin: true });
        selection.openSubject(GARETH, map);
        selection.togglePin();
        selection.togglePin();
        expect(selection.pinned.value).toBe(false);
        expect(selection.openSubject(WALD, map)).toBe(true);
    });

    it("🔴 Suche, Link und Planer sind bewusste Handlungen: Sie wechseln den Subject und lösen die Fixierung", () => {
        const { selection } = create({ canPin: true });
        selection.openSubject(GARETH, map);
        selection.togglePin();
        expect(selection.openSubject(WALD, { source: "search", camera: "none" })).toBe(true);
        expect(selection.selected.value).toEqual(WALD);
        expect(selection.pinned.value).toBe(false);
    });

    it("🔴 Escape löst die Fixierung mit der Auswahl", () => {
        const { selection } = create({ canPin: true });
        selection.openSubject(GARETH, map);
        selection.togglePin();
        expect(selection.escapeVisible()).toBe(true);
        expect(selection.pinned.value).toBe(false);
        expect(selection.selected.value).toBeUndefined();
    });
});

describe("nur Lesen: kein Schreibpfad, kein Floating Menu (WI-0063 4.1)", () => {
    it("🔴 der Dienst fragt nur mit GET und ohne Körper - „Änderungen vorschlagen“ löst keinen Request aus", async () => {
        const { createSubjectClient } = await import("../src/info-panel/subject-client.ts");
        const requests: { url: string; init: RequestInit | undefined }[] = [];
        const fetcher = vi.fn((url: string | URL | Request, init?: RequestInit) => {
            requests.push({ url: String(url), init });
            return Promise.resolve(new Response(JSON.stringify(garethDetail), { status: 200 }));
        }) as unknown as typeof fetch;
        const client = createSubjectClient(fetcher);
        await client.detail(GARETH);
        await client.detail({ kind: "mapPoint", x: 1, y: 2 });
        expect(requests.map((request) => request.url)).toEqual([
            `/api/subjects/place/${GARETH.kind === "place" ? GARETH.id : ""}`,
            "/api/subjects/map-point?x=1&y=2",
        ]);
        for (const request of requests) {
            expect(request.init?.method).toBeUndefined();
            expect(request.init?.body).toBeUndefined();
        }
    });
});

describe("auffrischen nach einer Änderung im Ortseditor (WI-0128 E19: „Infopanel und Liste zeigen das neue Wappen“)", () => {
    it("liest den gezeigten Ort neu, am Cache vorbei, ohne Flug; bis zur Antwort bleibt die alte stehen", async () => {
        const { selection, calls, flights } = create();
        selection.openSubject(GARETH, { source: "link", camera: "target" });
        calls[0]?.resolve(garethDetail);
        await flush();
        expect(flights).toHaveLength(1);

        selection.auffrischen(GARETH);
        expect(calls).toHaveLength(2);
        expect(calls[1]?.frisch).toBe(true);
        expect(selection.shown.value?.answer).toBe(garethDetail);
        const neu: SubjectDetail = { ...garethDetail, title: "Gareth (neu)" };
        calls[1]?.resolve(neu);
        await flush();
        expect(selection.shown.value?.answer).toBe(neu);
        expect(flights).toHaveLength(1);

        // Der Cache hält danach den neuen Stand: Wer Gareth wieder öffnet, sieht ihn ohne neue Frage.
        selection.openSubject(WALD, map);
        calls[2]?.resolve(waldDetail);
        await flush();
        selection.openSubject(GARETH, map);
        expect(calls.map((call) => call.frisch)).toEqual([false, true, false]);
        expect(selection.shown.value?.answer).toBe(neu);
    });

    it("ein anderer gezeigter Subject und ein noch ladender bleiben, wie sie sind", async () => {
        const { selection, calls } = create();
        selection.openSubject(WALD, map);
        selection.auffrischen(GARETH);
        expect(calls).toHaveLength(1);
        calls[0]?.resolve(waldDetail);
        await flush();
        selection.auffrischen(GARETH);
        expect(calls).toHaveLength(1);
        selection.auffrischen();
        expect(calls).toHaveLength(2);
    });
});

describe('auffrischen nach dem Umbenennen eines Wegs (WI-0177, Betreiber 2026-10-18: „es steht immer noch "unbezeichneter weg" dran“)', () => {
    const NEUER_WEG: SubjectRef = { kind: "path", chain: "Weg-12:Weg" };
    const ANKER: SubjectRef = { kind: "path", anchor: "11111111-2222-4333-8444-555555555555" };
    const klick: PresentedSelection = {
        area: {
            kind: "path",
            id: "Weg-12:Weg",
            name: "Weg-12",
            type: "Weg",
            anchor: { x: 10, y: 20 },
            segment: "11111111-2222-4333-8444-555555555555",
        },
    };
    const weg = (title: string | undefined, subtype = "Weg"): SubjectDetail => ({
        subject: ANKER,
        revision: REVISION,
        ...(title === undefined ? {} : { title }),
        subtitle: [{ part: "type", key: subtype }],
        target: { x: 12, y: 22, zoom: 6 },
    });

    async function geoeffnet(): Promise<Harness> {
        const harness = create();
        harness.selection.openSubject(NEUER_WEG, { ...map, known: { presentation: klick } });
        harness.calls[0]?.resolve(weg(undefined));
        await flush();
        return harness;
    }

    it("die Markierung geht auf die neue Kette über, an der Stelle des Klicks und ohne Ansichtswechsel; der Titel kommt mit der Antwort", async () => {
        const { selection, calls, presented } = await geoeffnet();
        expect(presented).toEqual([klick]);

        selection.auffrischen();
        calls[1]?.resolve(weg("Eisenstraße"));
        await flush();
        expect((selection.shown.value?.answer as SubjectDetail | undefined)?.title).toBe("Eisenstraße");
        expect(presented.at(-1)).toEqual({
            area: { ...klick.area, id: "name:Eisenstraße", name: "Eisenstraße", type: "Weg" },
        });
        expect(presented.at(-1)?.view).toBeUndefined();
    });

    it("ein anderer Wegtyp bleibt dieselbe Kette (ein Weg ist sein Name, WI-0177 Schritt 2b): die Markierung trifft weiter", async () => {
        const { selection, calls, presented } = await geoeffnet();
        selection.auffrischen();
        calls[1]?.resolve(weg("Eisenstraße"));
        await flush();
        selection.auffrischen();
        calls[2]?.resolve(weg("Eisenstraße", "Strasse"));
        await flush();
        expect(presented).toHaveLength(2);
        expect(presented.at(-1)?.area?.id).toBe("name:Eisenstraße");
    });

    it("bleibt die Kette, bleibt die Markierung, wie der Klick sie setzte (etwa der markierte Abschnitt)", async () => {
        const { selection, calls, presented } = await geoeffnet();
        selection.auffrischen();
        calls[1]?.resolve(weg(undefined));
        await flush();
        expect(presented).toEqual([klick]);

        selection.auffrischen();
        calls[2]?.resolve(weg("Eisenstraße"));
        await flush();
        selection.auffrischen();
        calls[3]?.resolve(weg("Eisenstraße"));
        await flush();
        expect(presented).toHaveLength(2);
    });

    it("ein Weg aus einem Link (ohne Darstellung des Klicks) zeigt ohnehin, was die Antwort sagt", async () => {
        const { selection, calls, presented } = create();
        selection.openSubject(NEUER_WEG, { source: "link", camera: "none" });
        calls[0]?.resolve(weg("Eisenstraße"));
        await flush();
        expect(presented.at(-1)?.area?.id).toBe("name:Eisenstraße");
        expect(presented).toHaveLength(1);
    });
});

describe("auffrischen leert den Zwischenspeicher auch für ein Subject, das gerade nicht offen ist (WI-0209, Betreiber 2026-10-19)", () => {
    it("🔴 ein umbenanntes Gebiet, das vorher gezeigt war, kommt beim nächsten Öffnen neu, nicht aus dem Speicher", async () => {
        const { selection, calls } = create();
        selection.openSubject(GARETH, map);
        calls[0]?.resolve(garethDetail);
        await flush();
        selection.openSubject(WALD, map);
        calls[1]?.resolve(waldDetail);
        await flush();
        // Geschrieben wurde an Gareth, gezeigt ist der Wald: Er bleibt, wie er ist, der Speicher gilt nicht mehr.
        selection.auffrischen(GARETH);
        expect(calls).toHaveLength(2);
        selection.openSubject(GARETH, map);
        expect(calls).toHaveLength(3);
    });
});

describe("ein Weg leuchtet mit den Abschnitten seiner Gruppe, auch den geteilten (WI-0302; Vali 2026-11-10, „Ja, mitzählen“)", () => {
    const KETTE: SubjectRef = { kind: "path", chain: "name:Goldfelser Stieg" };
    const ANKER: SubjectRef = { kind: "path", anchor: "0c0c0c0c-0000-4000-8000-0000000000b1" };
    const GRUPPE = ["0c0c0c0c-0000-4000-8000-0000000000b1", "0c0c0c0c-0000-4000-8000-0000000000b2"];
    const klick = (segment?: string): PresentedSelection => ({
        area: {
            kind: "path",
            id: "name:Goldfelser Stieg",
            name: "Goldfelser Stieg",
            type: "Strasse",
            anchor: { x: 10, y: 20 },
            ...(segment === undefined ? {} : { segment }),
        },
    });
    const antwort: SubjectDetail = {
        subject: ANKER,
        revision: REVISION,
        title: "Goldfelser Stieg",
        subtitle: [{ part: "type", key: "Strasse" }],
        target: { x: 12, y: 22, zoom: 6 },
        abschnitte: GRUPPE,
    };

    it("🔴 die Markierung des Klicks nimmt die Abschnitte der Antwort, an der Stelle des Klicks; dieselbe Antwort noch einmal zeigt nichts neu", async () => {
        const { selection, calls, presented } = create();
        selection.openSubject(KETTE, { ...map, known: { presentation: klick() } });
        calls[0]?.resolve(antwort);
        await flush();
        expect(presented.at(-1)).toEqual({ area: { ...klick().area, abschnitte: GRUPPE } });
        const zahl = presented.length;
        selection.auffrischen();
        calls[1]?.resolve(antwort);
        await flush();
        expect(presented).toHaveLength(zahl);
        // Nach „Fertig“ im Editor teilt der Weg einen Abschnitt weniger: Die Markierung folgt der neu gelesenen Gruppe.
        selection.auffrischen();
        calls[2]?.resolve({ ...antwort, abschnitte: [GRUPPE[0]!] });
        await flush();
        expect(presented.at(-1)?.area?.abschnitte).toEqual([GRUPPE[0]]);
    });

    it("ein im Editor markierter Abschnitt bleibt allein", async () => {
        const { selection, calls, presented } = create();
        selection.openSubject(KETTE, { ...map, known: { presentation: klick(GRUPPE[0]) } });
        calls[0]?.resolve(antwort);
        await flush();
        expect(presented.every((p) => p.area?.abschnitte === undefined)).toBe(true);
    });
});
