import { describe, expect, it, vi } from "vitest";
import { readObjectLink, type ResolveLinkResponse, type SubjectRef } from "@avesmaps3d/shared";
import { createObjectLink, readPin } from "../src/info-panel/object-link.ts";
import type { OpenSubjectOptions } from "../src/info-panel/subject-selection.ts";
import { SubjectRequestError } from "../src/info-panel/subject-client.ts";

/**
 * Die Legacy-Objektlinks beim Start (WI-0063 4.6): unveränderte Schlüssel, deutsche vor englischen, jeder Link auf EINE
 * Naht (`openSubject`), und nie still die Startansicht.
 */

const GARETH: SubjectRef = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };
const RATHILA_A: SubjectRef = { kind: "place", id: "db4c0af3-6d5e-590b-beca-1cb8e549d9e1" };
const RATHILA_B: SubjectRef = { kind: "place", id: "22222222-6d5e-590b-beca-1cb8e549d9e1" };

const reader =
    (search: string) =>
    (name: string): string | null =>
        new URLSearchParams(search).get(name);

describe("die Schlüssel und ihre Aliase (WI-0063 4.6)", () => {
    it("🔴 jeder Legacy-Schlüssel wird unverändert gelesen", () => {
        for (const [search, param] of [
            ["siedlung=Gareth", "siedlung"],
            ["staat=Punin", "staat"],
            ["region=Nordmarken", "region"],
            ["strasse=Reichsstrasse_1", "strasse"],
            ["fluss=Letta", "fluss"],
            ["place=80558060-4299-54aa-b520-814b10819885", "place"],
        ] as const) {
            expect(readObjectLink(reader(search))?.param, search).toBe(param);
        }
    });

    it("🔴 die englischen Namen sind Aliase auf dieselbe Bedeutung", () => {
        for (const [search, param] of [
            ["settlement=Gareth", "siedlung"],
            ["state=Punin", "staat"],
            ["road=Reichsstrasse_1", "strasse"],
            ["river=Letta", "fluss"],
            ["region=Nordmarken", "region"],
        ] as const) {
            expect(readObjectLink(reader(search))?.param, search).toBe(param);
        }
    });

    it("🔴 stehen deutsch und englisch gleicher Bedeutung zugleich da, gewinnt der deutsche Schlüssel", () => {
        expect(readObjectLink(reader("settlement=Punin&siedlung=Gareth"))).toMatchObject({
            name: "siedlung",
            value: "Gareth",
        });
        expect(readObjectLink(reader("road=B&strasse=A"))).toMatchObject({ name: "strasse", value: "A" });
        expect(readObjectLink(reader("river=B&fluss=A"))).toMatchObject({ name: "fluss", value: "A" });
        expect(readObjectLink(reader("state=B&staat=A"))).toMatchObject({ name: "staat", value: "A" });
    });

    it("🔴 Legacys feste Priorität gilt, nicht die Folge der Adresse: place, siedlung, staat, region, strasse, fluss", () => {
        expect(readObjectLink(reader("fluss=F&strasse=S&region=R&staat=T&siedlung=O"))?.param).toBe("siedlung");
        expect(readObjectLink(reader("fluss=F&strasse=S&region=R&staat=T"))?.param).toBe("staat");
        expect(readObjectLink(reader("fluss=F&strasse=S&region=R"))?.param).toBe("region");
        expect(readObjectLink(reader("fluss=F&strasse=S"))?.param).toBe("strasse");
        expect(readObjectLink(reader("fluss=F&siedlung=O&place=abc"))?.param).toBe("place");
    });

    it("ein leerer Wert zählt nicht", () => {
        expect(readObjectLink(reader("siedlung=%20&staat=Punin"))?.param).toBe("staat");
        expect(readObjectLink(reader("siedlung="))).toBeNull();
    });
});

describe("`?pin=lat,lng` (Legacys Reihenfolge: y vor x)", () => {
    it("🔴 `lat,lng` mit drei Stellen wird x = lng, y = lat", () => {
        expect(readPin("532.969,551.625")).toEqual({ x: 551.625, y: 532.969 });
        expect(readPin(" 532.969 , 551.625 ")).toEqual({ x: 551.625, y: 532.969 });
    });

    it("🔴 nicht lesbar und außerhalb der Karte werden unterschieden", () => {
        expect(readPin("Gareth")).toBe("invalid");
        expect(readPin("1,2,3")).toBe("invalid");
        expect(readPin("99999,99999")).toBe("outside");
        expect(readPin("-5,-5")).toBe("outside");
    });
});

interface Opened {
    ref: SubjectRef;
    options: OpenSubjectOptions;
}

function create(answer: ResolveLinkResponse | Error): {
    link: ReturnType<typeof createObjectLink>;
    opened: Opened[];
    notes: string[];
    resolve: ReturnType<typeof vi.fn>;
} {
    const opened: Opened[] = [];
    const notes: string[] = [];
    const resolve = vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
    const link = createObjectLink({
        selection: {
            openSubject: (ref, options) => {
                opened.push({ ref, options });
                return true;
            },
        },
        client: { resolveLink: resolve },
        notify: (text) => notes.push(text),
    });
    return { link, opened, notes, resolve };
}

describe("öffnen: auf EINE Naht, die Kamera fliegt hin", () => {
    it("🔴 ein aufgelöster Link öffnet über openSubject, aus der Quelle „link“, mit Flug zum Ziel", async () => {
        const { link, opened, resolve } = create({ ref: GARETH, param: "siedlung", via: "name" });
        await link.open("?siedlung=Gareth");
        expect(opened).toEqual([{ ref: GARETH, options: { source: "link", camera: "target" } }]);
        expect(resolve).toHaveBeenCalledWith({ param: "siedlung", name: "siedlung", value: "Gareth" });
    });

    it("🔴 der englische Alias fragt unter seinem Namen, die Auflösung ist dieselbe", async () => {
        const { link, resolve } = create({ ref: GARETH, param: "siedlung", via: "name" });
        await link.open("?settlement=Gareth");
        expect(resolve).toHaveBeenCalledWith({ param: "siedlung", name: "settlement", value: "Gareth" });
    });

    it("🔴 `pin` braucht keinen Server: ein Kartenpunkt, direkt", async () => {
        const { link, opened, resolve } = create(new Error("darf nicht gefragt werden"));
        await link.open("?pin=532.969,551.625");
        expect(resolve).not.toHaveBeenCalled();
        expect(opened).toEqual([
            {
                ref: { kind: "mapPoint", x: 551.63, y: 532.97 },
                options: { source: "link", camera: "target" },
            },
        ]);
    });

    it("🔴 mehrdeutig heißt Auswahlliste: Nichts wird still gewählt", async () => {
        const { link, opened } = create({
            candidates: [
                { ref: RATHILA_A, title: "Rathila", type: "dorf" },
                { ref: RATHILA_B, title: "Rathila", type: "stadt" },
            ],
            param: "siedlung",
            via: "name",
        });
        await link.open("?siedlung=Rathila");
        expect(opened).toEqual([]);
        expect(link.choices.value?.entries).toEqual([
            { ref: RATHILA_A, name: "Rathila", type: "Dorf" },
            { ref: RATHILA_B, name: "Rathila", type: "Stadt" },
        ]);
        link.choose(RATHILA_B);
        expect(link.choices.value).toBeUndefined();
        expect(opened).toEqual([{ ref: RATHILA_B, options: { source: "link", camera: "target" } }]);
    });

    it("die Liste lässt sich schließen, ohne etwas zu öffnen", async () => {
        const { link, opened } = create({
            candidates: [
                { ref: RATHILA_A, title: "Rathila" },
                { ref: RATHILA_B, title: "Rathila" },
            ],
            param: "siedlung",
            via: "name",
        });
        await link.open("?siedlung=Rathila");
        link.dismiss();
        expect(link.choices.value).toBeUndefined();
        expect(opened).toEqual([]);
    });

    it("🔴 nicht gefunden sagt es mit dem Namen aus dem Link - nie still Gareth oder die Startansicht", async () => {
        const { link, opened, notes } = create({ notFound: { param: "siedlung", value: "Unbekanntheim" } });
        await link.open("?siedlung=Unbekanntheim");
        expect(opened).toEqual([]);
        expect(notes).toEqual(["„Unbekanntheim“ ist nicht (mehr) auf der Karte."]);
    });

    it("🔴 ein Unterstrich im Wiki-Namen wird in der Meldung zum Leerzeichen", async () => {
        const { link, notes } = create({ notFound: { param: "strasse", value: "Reichsstrasse_1" } });
        await link.open("?strasse=Reichsstrasse_1");
        expect(notes).toEqual(["„Reichsstrasse 1“ ist nicht (mehr) auf der Karte."]);
    });

    it("🔴 scheitert die Auflösung (Netz, 503), sagt es das auch", async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { link, opened, notes } = create(new SubjectRequestError(503, "resolve-link"));
        await link.open("?siedlung=Gareth");
        expect(opened).toEqual([]);
        expect(notes).toEqual(["Der Link konnte nicht aufgelöst werden."]);
        quiet.mockRestore();
    });

    it("🔴 ein Kartenpunkt außerhalb der Karte und ein unlesbarer sagen es", async () => {
        const first = create({ notFound: { param: "siedlung", value: "x" } });
        await first.link.open("?pin=99999,99999");
        expect(first.opened).toEqual([]);
        expect(first.notes).toEqual(["Der Kartenpunkt im Link liegt außerhalb der Karte."]);
        const second = create({ notFound: { param: "siedlung", value: "x" } });
        await second.link.open("?pin=Gareth");
        expect(second.notes).toEqual(["Der Kartenpunkt im Link ist nicht lesbar."]);
    });

    it("🔴 pin und Objektlink: erst der Kartenpunkt, dann der Objektlink - der spätere ersetzt den früheren, wie in Legacy", async () => {
        const { link, opened } = create({ ref: GARETH, param: "siedlung", via: "name" });
        await link.open("?siedlung=Gareth&pin=532.969,551.625");
        expect(opened.map((entry) => entry.ref.kind)).toEqual(["mapPoint", "place"]);
    });

    it("ohne Objektlink und ohne pin geschieht nichts: Die Startansicht bleibt, wie sie ist", async () => {
        const { link, opened, notes, resolve } = create(new Error("-"));
        await link.open("?route=Gareth~Fasar&lang=en");
        expect(opened).toEqual([]);
        expect(notes).toEqual([]);
        expect(resolve).not.toHaveBeenCalled();
    });
});
