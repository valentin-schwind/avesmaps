import { afterEach, describe, expect, it } from "vitest";
import { BEZUG_OBJEKTARTEN, type RouteResponse } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import type { PanelModel, RowModel } from "../src/info-panel/panel-types.ts";
import {
    DORF_ID,
    GARETH_ID,
    dorf,
    env,
    gareth,
    gebiet,
    gebietEigenerKnoten,
    gebietNurZusatzfelder,
    gebietStaatsinfobox,
    gebietUmstritten,
    gipfel,
    huegel,
    kraftlinie,
    kraftlinieMitGestalt,
    punkt,
    punktLore,
    punktMitNachbarn,
    reichsstrasse,
    reichsstrasseMitRoute,
    see,
    shown,
    verborgenerOrt,
    waldwildnis,
} from "./panel-fixtures.ts";

/**
 * Was das Infopanel zeigt (WI-0063 P6, Design Guide §16, Betreiber: „aussehn wie legacy“): das Modell aus der Antwort des Servers, ohne
 * Browser. Wie es aussieht und sich bedient, prüfen `e2e/info-panel-grammar.spec.ts` und das Abnahmeblatt.
 */

const model = (...args: Parameters<typeof shown>): PanelModel => {
    const result = panelModelOf(shown(...args), null, env());
    if (result === undefined) throw new Error("kein Modell");
    return result;
};
const labels = (rows: readonly RowModel[]): string[] => rows.map((row) => row.label);
/** Der Text einer Zeile, wie er auf dem Bild steht: bei einer Zeile mit Links die Stücke hintereinander. */
const text = (row: RowModel | undefined): string =>
    row?.value.kind === "text"
        ? row.value.text
        : row?.value.kind === "parts"
          ? row.value.parts.map((part) => part.text).join("")
          : "";

afterEach(() => setLocale("de"));

describe("🔴 Gareth, der reiche Referenzfall: Reihenfolge und Wortlaut wie Legacy", () => {
    const m = model(gareth);

    it("Kopf: Name, Art und die Herrschaft als Link, das Kanon-Etikett, die Grafik der Ortsgröße", () => {
        expect(m.header.title).toBe("Gareth");
        expect(m.header.subtitle.map((item) => item.parts.map((part) => part.text).join(""))).toEqual([
            "Metropole",
            "Hauptstadt von Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
        ]);
        // Der Name des Gebiets ist ein Link, das Wort davor nicht.
        const parts = m.header.subtitle[1]?.parts ?? [];
        expect(parts.map((part) => part.ref?.kind)).toEqual([undefined, "territory"]);
        expect(m.header.canon).toEqual({ state: "official" });
        expect(m.header.graphic).toBe("metropole");
        expect(m.header.images).toEqual([]);
        expect(m.header.coat).toBeUndefined();
    });

    it("Aktionen in Legacys Reihenfolge: Reiseziel (gefüllt), Link teilen, Bewertung schreiben (WI-0269 C10), Änderungen vorschlagen (gesperrt)", () => {
        expect(m.actions.map((action) => [action.id, action.label, action.tone])).toEqual([
            ["addDestination", "Reiseziel hinzufügen", "accent"],
            ["share", "Link teilen", "soft"],
            ["review", "Bewertung schreiben", "soft"],
            ["suggest", "Änderungen vorschlagen", "soft"],
        ]);
        expect(m.actions[0]?.run).toMatchObject({
            type: "addPlace",
            hit: { id: GARETH_ID, name: "Gareth", subtype: "metropole", hidden: false, x: 551.625, y: 532.969 },
        });
    });

    it("🔴 „Link teilen“ ist Legacys Adresse: `?siedlung=` mit dem Seitenteil der Wiki-Adresse", () => {
        expect(m.actions[1]?.run).toEqual({
            type: "share",
            url: "https://avesmaps.test/?siedlung=Gareth",
            what: "place",
        });
    });

    it("„Liegt in“ ist die Treppe von der Wurzel zum Blatt", () => {
        expect(m.liesIn?.heading).toBe("Liegt in");
        expect(m.liesIn?.rows.map((row) => [row.depth, row.name])).toEqual([
            [0, "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth"],
            [1, "Königreich Garetien"],
            [2, "Kaisermark Gareth"],
            [3, "Alt-Gareth"],
        ]);
        expect(m.liesIn?.lid).toBeUndefined();
    });

    it("🔴 die Datentabelle: Beschreibung, Oberhaupt, Einwohner, Verkehrswege, Handelszone, Klimazone - die Lage fehlt, wie bei Legacy", () => {
        expect(labels(m.rows)).toEqual([
            "Beschreibung",
            "Oberhaupt",
            "Einwohner",
            "Verkehrswege",
            "Handelszone",
            "Klimazone",
        ]);
        expect(text(m.rows[5])).toBe("Gemäßigte Zone");
    });

    it("🔴 die Beschreibung ist nur der erste Satz (Legacy `settlementFirstSentence`)", () => {
        expect(text(m.rows[0])).toBe(
            "Gareth ist mit Abstand die größte Stadt Aventuriens und Hauptstadt des Mittelreichs.",
        );
    });

    it("die Verkehrswege sind Links auf die Wege, der Text dazwischen bleibt", () => {
        const value = m.rows[3]?.value;
        expect(value?.kind).toBe("parts");
        if (value?.kind !== "parts") return;
        expect(value.parts.map((part) => [part.text, part.ref?.kind])).toEqual([
            ["Reichsstraßen 2 und 3", "path"],
            [", ", undefined],
            ["Gardel", "path"],
        ]);
    });

    it("Wikizeile: Name, Kanon, Rechtetafel mit Lizenz als Link und der Adresse; die Quellen mit Zähler", () => {
        expect(m.wiki?.label).toBe("Wiki Aventurica");
        expect(m.wiki?.canon).toEqual({ state: "official" });
        expect(m.wiki?.rights.map((row) => row.key)).toEqual(["kanon", "link", "license", "address"]);
        expect(m.wiki?.rights.find((row) => row.key === "license")).toMatchObject({
            text: "CC BY-SA 3.0",
            href: "https://creativecommons.org/licenses/by-sa/3.0/",
        });
        expect(m.wiki?.rights.find((row) => row.key === "address")?.href).toBe(
            "https://de.wiki-aventurica.de/wiki/Gareth",
        );
        expect(m.sources).toMatchObject({ count: 254, ref: { kind: "place" } });
    });
});

describe("🔴 verborgene Felder fehlen - und erscheinen nur freigegeben oder im Entwicklermodus", () => {
    it("wie Legacy: keine eigenen Angaben des Orts, keine Lage", () => {
        const m = model(gareth);
        expect(m.rows.map((row) => row.key)).not.toContainEqual(expect.stringContaining("direct"));
        expect(labels(m.rows)).not.toContain("Lage");
        expect(labels(m.rows).filter((label) => label === "Einwohner")).toHaveLength(1);
    });

    it("mit allen Zusatzfeldern: die eigenen Angaben stehen daneben und heißen so, dazu die Lage und der Rest hinter der Pille", () => {
        const m = panelModelOf(shown(gareth), null, env("all"));
        expect(labels(m?.rows ?? [])).toEqual(
            expect.arrayContaining(["Lage", "Lage (eigene Angabe)", "Einwohner", "Einwohner (eigene Angabe)"]),
        );
        const description = m?.rows[0]?.value;
        expect(description?.kind).toBe("more");
        if (description?.kind !== "more") return;
        expect(description.text).not.toContain("Sie ist seit ihrer Gründung gewachsen.");
        expect(description.full).toContain("Sie ist seit ihrer Gründung gewachsen.");
    });

    it("freigegeben (jeder Besucher, Betreiber 2026-10-04): Zusatzfelder, der Rest der Beschreibung hinter der Pille", () => {
        const m = panelModelOf(shown(gareth), null, env("approved"));
        expect(labels(m?.rows ?? [])).toEqual(expect.arrayContaining(["Lage", "Lage (eigene Angabe)"]));
        const description = m?.rows[0]?.value;
        expect(description?.kind).toBe("more");
        if (description?.kind !== "more") return;
        expect(description.text.split(/(?<=\.)\s/)).toHaveLength(1);
        expect(description.full.startsWith(description.text)).toBe(true);
    });

    it("freigegeben: „Hauptstadt von A, B“ in EINER Angabe, jeder Name ein Link; der Sitz, der schon Hauptstadt heißt, fällt weg", () => {
        const subtitle = panelModelOf(shown(gareth), null, env("approved"))?.header.subtitle ?? [];
        expect(subtitle.map((item) => item.parts.map((part) => part.text).join(""))).toEqual([
            "Metropole",
            "Hauptstadt von Heiliges Neues Kaiserreich vom Greifenthron zu Gareth, Königreich Garetien",
        ]);
        expect(subtitle[1]?.parts.filter((part) => part.ref !== undefined)).toHaveLength(2);
        // Wie Legacy: nur das weiteste Gebiet.
        const legacy = model(gareth).header.subtitle;
        expect(legacy.map((item) => item.parts.map((part) => part.text).join(""))).toEqual([
            "Metropole",
            "Hauptstadt von Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
        ]);
    });

    it("eine eigene Angabe, die nur den Wert des Wikis wiederholt, kommt nicht doppelt", () => {
        const copy = {
            ...gareth,
            facts: [
                ...(gareth.facts ?? []),
                {
                    field: "oberhaupt" as const,
                    value: "Kaiserin Rohaja von Gareth",
                    provenance: { kind: "wiki" as const },
                    layer: "direct" as const,
                    legacyHidden: true as const,
                },
            ],
        };
        const rows = panelModelOf(shown(copy), null, env("all"))?.rows ?? [];
        expect(rows.filter((row) => row.label.startsWith("Oberhaupt"))).toHaveLength(1);
    });
});

describe("🔴 ein Dorf ohne Wiki bleibt knapp: nichts erfunden, keine leere Zeile, keine leere Sektion (WI-0063 5.3, 14)", () => {
    const m = model(dorf);

    it("Name, Art und die Aktionen - sonst nichts", () => {
        expect(m.header.title).toBe("Felden");
        expect(m.header.subtitle.map((item) => item.parts[0]?.text)).toEqual(["Dorf"]);
        expect(m.header.graphic).toBe("dorf");
        expect(m.header.canon).toBeUndefined();
        // Kein verborgener Ort, also keine Pille „Verborgen“ (WI-0080 Nachtrag).
        expect(m.header.hidden).toBeUndefined();
        expect(m.rows).toEqual([]);
        expect(m.liesIn).toBeUndefined();
        expect(m.wiki).toBeUndefined();
        expect(m.sources).toBeUndefined();
        // Ohne Wiki-Adresse teilt der Ort über seine Kennung (Legacy `?place=`).
        expect(m.actions.find((action) => action.id === "share")?.run).toEqual({
            type: "share",
            url: `https://avesmaps.test/?place=${DORF_ID}`,
            what: "place",
        });
    });

    it("🔴 eine Ruine trägt „(Ruine)“ auch an der bloßen Größe (OPS-000094), ohne Wiki dazu der Satz in der Beschreibung wie Legacy", () => {
        const ruine = { ...dorf, subtitle: [...(dorf.subtitle ?? []), { part: "ruin" as const }] };
        const m2 = model(ruine);
        expect(m2.header.subtitle[0]?.parts[0]?.text).toBe("Dorf (Ruine)");
        expect(text(m2.rows[0])).toBe("Ruine oder zerstört.");
    });

    it("🔴 eine Ruine mit Wiki-Artikel und ohne eigene Art nennt die Ruine in der Unterzeile (OPS-000094, Weidensee)", () => {
        const weidensee = {
            ...dorf,
            subtitle: [...(dorf.subtitle ?? []), { part: "ruin" as const }],
            facts: [
                {
                    field: "description" as const,
                    value: "Das Dorf wurde aufgegeben.",
                    provenance: { kind: "wiki" as const },
                },
            ],
        };
        expect(model(weidensee).header.subtitle[0]?.parts[0]?.text).toBe("Dorf (Ruine)");
    });

    it("kein zweites „Ruine“, wenn der Name es schon trägt", () => {
        const vilarstein = {
            ...dorf,
            title: "Ruine Vilarstein",
            subtitle: [...(dorf.subtitle ?? []), { part: "ruin" as const }],
        };
        expect(model(vilarstein).header.subtitle[0]?.parts[0]?.text).toBe("Dorf");
    });

    it("kein zweites „Ruine“, wenn die Art es schon trägt", () => {
        const festungsruine = {
            ...dorf,
            subtitle: [
                { part: "type" as const, key: "gebaeude" },
                { part: "kind" as const, text: "Festungsruine" },
                { part: "ruin" as const },
            ],
        };
        expect(model(festungsruine).header.subtitle[0]?.parts[0]?.text).toBe("Festungsruine");
    });

    it("eine Ortsart (Festung) ersetzt die Größe, und die Ruine hängt an ihr", () => {
        const burg = {
            ...dorf,
            subtitle: [
                { part: "type" as const, key: "gebaeude" },
                { part: "kind" as const, text: "Festung" },
                { part: "ruin" as const },
            ],
        };
        expect(model(burg).header.subtitle[0]?.parts[0]?.text).toBe("Festung (Ruine)");
        expect(model(burg).header.graphic).toBe("gebaeude");
    });

    it("🔴 „unterirdisch“ (WI-0128 E21) steht hinter dem Ortstyp, auch ohne eigene Art, und neben der Ruine", () => {
        const unten = { ...dorf, subtitle: [...(dorf.subtitle ?? []), { part: "underground" as const }] };
        expect(model(unten).header.subtitle[0]?.parts[0]?.text).toBe("Dorf (unterirdisch)");
        const mine = {
            ...dorf,
            subtitle: [
                { part: "type" as const, key: "gebaeude" },
                { part: "kind" as const, text: "Mine" },
                { part: "ruin" as const },
                { part: "underground" as const },
            ],
        };
        expect(model(mine).header.subtitle[0]?.parts[0]?.text).toBe("Mine (Ruine, unterirdisch)");
    });
});

describe("eine Antwort ohne eine einzige leere Zeile, Sektion oder Kachel - über alle Arten", () => {
    const fixtures = [gareth, dorf, waldwildnis, huegel, see, reichsstrasse, kraftlinie, gebiet, gipfel];
    for (const mode of ["legacy", "all"] as const) {
        it(`Modus ${mode}`, () => {
            for (const detail of fixtures) {
                const m = panelModelOf(shown(detail), null, env(mode));
                expect(m, detail.title).toBeDefined();
                for (const row of m?.rows ?? []) {
                    expect(row.label.trim(), `${detail.title}: Beschriftung`).not.toBe("");
                    if (row.value.kind === "text")
                        expect(row.value.text.trim(), `${detail.title}: ${row.label}`).not.toBe("");
                    if (row.value.kind === "parts")
                        expect(row.value.parts.length, `${detail.title}: ${row.label}`).toBeGreaterThan(0);
                }
                if (m?.liesIn !== undefined) expect(m.liesIn.rows.length).toBeGreaterThan(0);
                if (m?.sources !== undefined) expect(m.sources.count).toBeGreaterThan(0);
                expect(new Set(m?.rows.map((row) => row.key)).size, `${detail.title}: Schlüssel eindeutig`).toBe(
                    m?.rows.length,
                );
            }
        });
    }

    it("nichts gewählt: kein Modell; solange die Antwort fehlt, nur der Name, den die Karte schon kannte", () => {
        expect(panelModelOf(undefined, null, env())).toBeUndefined();
        const pending = panelModelOf(shown(undefined, "Gareth"), null, env());
        expect(pending).toEqual({
            header: { title: "Gareth", subtitle: [], images: [] },
            actions: [],
            rows: [],
            catalogs: [],
        });
    });
});

describe("🔴 „Änderungen vorschlagen“ öffnet das Meldeformular zum Objekt (WI-0268 C2; bis dahin gesperrt, WI-0063 4.1)", () => {
    it("jede Art, die sie zeigt: eine Kachel mit der Handlung `suggest` und dem Objekt als Bezug, keine Sperre, keine Erklärung", () => {
        for (const detail of [gareth, dorf, waldwildnis, huegel, reichsstrasse, kraftlinie, gebiet, gipfel]) {
            const m = model(detail);
            const suggest = m.actions.find((action) => action.id === "suggest");
            expect(suggest, detail.title).toBeDefined();
            expect(suggest?.run?.type, `${detail.title}: Handlung`).toBe("suggest");
            expect(suggest?.tone).toBe("soft");
            expect(m.actionsNote, detail.title).toBeUndefined();
        }
    });

    it("🔴 der Bezug trägt Objektart, Kennung und den Schnappschuss von Name, Art und Lage (Fachkonzept §6)", () => {
        const run = model(gareth).actions.find((action) => action.id === "suggest")?.run;
        expect(run).toEqual({
            type: "suggest",
            objektArt: "place",
            objektId: GARETH_ID,
            name: "Gareth",
            typ: "metropole",
            lage: { x: 551.625, y: 532.969 },
        });
    });

    it("jede der sechs Objektarten nennt ihre Art, wie `BEZUG_OBJEKTARTEN` sie kennt; ein Weg und eine Kraftlinie ihren Anker", () => {
        const arten = new Map<string, string>();
        for (const detail of [gareth, waldwildnis, reichsstrasse, kraftlinie, gebiet, gipfel]) {
            const run = model(detail).actions.find((action) => action.id === "suggest")?.run;
            if (run?.type !== "suggest") throw new Error(`${detail.title}: keine Handlung`);
            expect(BEZUG_OBJEKTARTEN as readonly string[], detail.title).toContain(run.objektArt);
            expect(run.objektId, detail.title).toMatch(/^[0-9a-f-]{36}$/u);
            expect(run.name, detail.title).toBe(detail.title);
            arten.set(run.objektArt, detail.title ?? "");
        }
        expect([...arten.keys()].sort()).toEqual(["area", "path", "peak", "place", "powerline", "territory"]);
    });

    it("🔴 gesperrt bleibt die Kachel nur, wo die Antwort keine Kennung des Objekts nennt - und dann sagt die Zeile unter dem Band es", () => {
        const ohneKennung = { ...reichsstrasse, subject: { kind: "path" as const, chain: "name:Reichsstraße 3" } };
        const m = model(ohneKennung);
        const suggest = m.actions.find((action) => action.id === "suggest");
        expect(suggest?.run).toBeUndefined();
        expect(m.actionsNote).toBe("Änderungen vorschlagen kommt mit dem Editor.");
    });

    it("keine andere Kachel ist gesperrt; jede hat eine Handlung, und „suggest“ öffnet nur das Formular (Lesen, Planer, Zwischenablage, Kamera)", () => {
        const kinds = new Set<string>();
        for (const detail of [gareth, reichsstrasse, kraftlinie, waldwildnis]) {
            for (const action of model(detail).actions) {
                expect(action.run, `${detail.title}: ${action.id}`).toBeDefined();
                kinds.add(action.run?.type ?? "");
            }
        }
        expect([...kinds].sort()).toEqual(["addPlace", "review", "share", "show", "suggest"]);
    });
});

describe("Aktionen je Art, wie Legacy", () => {
    it("ein Ort, der schon Reiseziel ist, heißt „Reiseziel entfernen“ (Gefahr-Ton), nicht doppelt hinzufügen", () => {
        const m = panelModelOf(shown(gareth), null, env("legacy", [GARETH_ID]));
        expect(m?.actions[0]).toMatchObject({
            id: "removeDestination",
            label: "Reiseziel entfernen",
            tone: "danger",
            run: { type: "removeDestination", id: GARETH_ID },
        });
    });

    it("Landschaft: Link teilen nur mit Wiki-Adresse (`?region=`), sonst nur das gesperrte „Änderungen vorschlagen“", () => {
        expect(model(waldwildnis).actions.map((action) => action.id)).toEqual(["share", "suggest"]);
        expect(model(waldwildnis).actions[0]?.run).toMatchObject({ url: "https://avesmaps.test/?region=Waldwildnis" });
        expect(model(huegel).actions.map((action) => action.id)).toEqual(["suggest"]);
    });

    it("Gebiet teilt als `?staat=`, ein Gipfel ohne Wiki über seine Kennung", () => {
        expect(model(gebiet).actions[0]?.run).toMatchObject({
            url: "https://avesmaps.test/?staat=K%C3%B6nigreich_Garetien",
        });
        // Seit WI-0271 L6 steht vor „Link teilen“ am Gipfel „Reiseziel hinzufügen“ (`landmarke-wegpunkt.test.ts`).
        expect(model(gipfel).actions.find((action) => action.id === "share")?.run).toMatchObject({
            url: `https://avesmaps.test/?place=${gipfel.subject.kind === "peak" ? gipfel.subject.id : ""}`,
        });
    });

    it("Weg: Anzeigen (gefüllt), Link teilen (`?strasse=`), Änderungen vorschlagen; „Weg als Route“ nur, wo der Server die Orte nennt", () => {
        const m = model(reichsstrasse);
        expect(m.actions.map((action) => [action.id, action.tone])).toEqual([
            ["show", "accent"],
            ["share", "soft"],
            ["suggest", "soft"],
        ]);
        expect(m.actions[1]?.run).toMatchObject({ url: "https://avesmaps.test/?strasse=Reichsstra%C3%9Fe_3" });
    });

    it("🔴 Kraftlinie: Anzeigen und Änderungen vorschlagen - kein „Link teilen“ (Legacy führt ihn dort bewusst nicht)", () => {
        expect(model(kraftlinie).actions.map((action) => action.id)).toEqual(["show", "suggest"]);
    });

    it("Kartenpunkt: Reiseziel, Link teilen mit `?pin=` (y vor x), Entfernen", () => {
        const m = panelModelOf(shown(punkt), null, env());
        expect(m?.actions.map((action) => [action.id, action.tone])).toEqual([
            ["addDestination", "accent"],
            ["share", "soft"],
            ["removePoint", "danger"],
        ]);
        expect(m?.actions[0]?.run).toEqual({ type: "addMapPoint", x: 551.6, y: 520.5 });
        expect(m?.actions[1]?.run).toEqual({
            type: "share",
            url: "https://avesmaps.test/?pin=520.500,551.600",
            what: "pin",
        });
        expect(m?.actions[2]?.run).toEqual({ type: "closePoint" });
        expect(m?.actionsNote).toBeUndefined();
    });
});

describe("Landschaft, See und Hügel zeigen Kontext statt einer leeren Titelbox (WI-0063 5.1, 14)", () => {
    it("Waldwildnis: Lage, Staat, Sprache, Beschreibung; Ebenen und Klima; die Herrschaft als Baum mit Anteilen", () => {
        const m = model(waldwildnis);
        expect(m.header.subtitle.map((item) => item.parts[0]?.text)).toEqual(["Urwald"]);
        expect(m.header.graphic).toBe("urwald");
        expect(labels(m.rows)).toEqual(["Lage", "Staat", "Sprache", "Beschreibung", "Regionen", "Klimazone"]);
        expect(text(m.rows[4])).toBe("Aventurien (Kontinent) · Streitende Königreiche");
        // Fünf Zeilen: mehr als vier, also ein Deckel, dessen Kopf die Beziehung samt Zahl nennt.
        expect(m.liesIn?.lid?.summary).toBe("Erstreckt sich über 5 politische Gebiete");
        expect(m.liesIn?.rows.map((row) => [row.depth, row.name, row.share])).toEqual([
            [0, "Königreich Nostria", " (83 %)"],
            [1, "Waldgrafschaft Thuranshag", " (34 %)"],
            [1, "Grenzgrafschaft Tommellande", " (13 %)"],
            [0, "Königreich Andergast", " (17 %)"],
            [1, "Freiherrschaft Thurana", " (5 %)"],
        ]);
    });

    it("🔴 die Nachbarn und der Kontinent sind Zusatzfelder: wie Legacy fehlen sie, freigegeben stehen sie da", () => {
        expect(labels(model(waldwildnis).rows)).not.toContain("Nachbarn");
        const rows = panelModelOf(shown(waldwildnis), null, env("approved"))?.rows ?? [];
        expect(labels(rows)).toEqual(expect.arrayContaining(["Kontinent", "Nachbarn"]));
        expect(labels(rows).filter((label) => label.startsWith("Nachbar"))).toEqual(["Nachbarn"]);
        expect(text(rows.find((row) => row.label === "Nachbarn"))).toBe("Ingvaltal (N), Thuranien (O)");
    });

    it("🔴 Nachbarn: EINE Zeile, nach Name gruppiert, Richtungen in Windrosen-Reihenfolge (Betreiber 2026-10-04)", () => {
        const neighbor = (direction: "N" | "NO" | "O" | "SO" | "S" | "SW" | "W" | "NW", name: string) => ({
            field: "neighbors" as const,
            direction,
            values: [name],
            provenance: { kind: "wiki" as const },
            legacyHidden: true as const,
        });
        const caldaia = {
            ...waldwildnis,
            facts: [
                // Absichtlich nicht in Windrosen-Reihenfolge geliefert.
                neighbor("NW", "Herz des Kontinents"),
                neighbor("S", "Sumiswald"),
                neighbor("N", "Herz des Kontinents"),
                neighbor("SW", "Ragatien"),
                neighbor("O", "Raschtulswall"),
                neighbor("NO", "Herz des Kontinents"),
                neighbor("W", "Ambossgebirge"),
                neighbor("SO", "Ragatien"),
            ],
        };
        const rows = panelModelOf(shown(caldaia), null, env("approved"))?.rows ?? [];
        expect(text(rows.find((row) => row.label === "Nachbarn"))).toBe(
            "Herz des Kontinents (N, NO, NW), Raschtulswall (O), Ragatien (SO, SW), Sumiswald (S), Ambossgebirge (W)",
        );
        setLocale("en");
        const english = panelModelOf(shown(caldaia), null, env("approved"))?.rows ?? [];
        expect(text(english.find((row) => row.label === "Neighbours"))).toBe(
            "Herz des Kontinents (N, NE, NW), Raschtulswall (E), Ragatien (SE, SW), Sumiswald (S), Ambossgebirge (W)",
        );
    });

    it("Hügel der Brinaskquelle: kein Wiki, keine Felder - aber Gebiet, Landschaften und Klima", () => {
        const m = model(huegel);
        expect(m.header.title).toBe("Hügel der Brinaskquelle");
        expect(m.header.graphic).toBe("huegel");
        expect(m.liesIn?.rows.map((row) => row.name)).toEqual(["Orkreich"]);
        // Ein Gebiet, das die Fläche ganz deckt, braucht keinen Anteil.
        expect(m.liesIn?.rows[0]?.share).toBeUndefined();
        expect(labels(m.rows)).toEqual(["Regionen", "Vegetation", "Klimazone"]);
        // WI-0105: Eine Fläche ohne Namen heißt im Satz ihrer Art (seit OPS-073 ohne „Unbezeichneter“): „Wald“.
        expect(text(m.rows[1])).toBe("Wald");
        expect(m.wiki).toBeUndefined();
        expect(m.sources).toBeUndefined();
    });

    it("ein See ohne Namen heißt „See“ und zeigt sein Gebiet", () => {
        const m = model(see);
        // WI-0105, Betreiber 2026-10-07: „‚Wald-925‘ sollte zu ‚Unbezeichneter Wald‘“; OPS-073: nur noch die Art.
        expect(m.header.title).toBe("See");
        expect(m.header.graphic).toBe("see");
        expect(m.liesIn?.rows).toHaveLength(1);
    });
});

describe("Weg, Kraftlinie, Gebiet, Gipfel", () => {
    it("Weg: Lage, Länge, „Führt durch“, der Verlauf als Deckel; der erste Satz; die Grafik der Wegart", () => {
        const m = model(reichsstrasse);
        expect(m.header.graphic).toBe("reichsstrasse");
        expect(m.header.subtitle.map((item) => item.parts[0]?.text)).toEqual(["Reichsstraße"]);
        expect(labels(m.rows)).toEqual(["Lage", "Länge", "Führt durch", "Verlauf", "Beschreibung"]);
        expect(text(m.rows[2])).toBe("Albernia · Der große Fluss");
        expect(m.rows[3]?.value).toMatchObject({
            kind: "lid",
            count: 7,
            preview: "Elenvina → … → Gratenfels",
            unit: "Orte auf dem Weg",
        });
        expect(text(m.rows[4])).toBe("Die Reichsstraße 3 führt von Elenvina über Kyndoch nach Gratenfels.");
        // Die Herrschaftsketten sind bei einem Weg ein Zusatz: Legacy zeigt dort keine.
        expect(m.liesIn).toBeUndefined();
        expect(panelModelOf(shown(reichsstrasse), null, env("all"))?.liesIn?.heading).toBe("Verläuft durch");
    });

    it("ein kurzer Verlauf (unter fünf Orten) bleibt eine Zeile", () => {
        const kurz = {
            ...reichsstrasse,
            facts: [{ field: "verlauf" as const, value: "A → B → C", provenance: { kind: "wiki" as const } }],
        };
        expect(model(kurz).rows[1]?.value).toEqual({ kind: "text", text: "A → B → C" });
    });

    it("Kraftlinie: die Beschreibung bleibt ganz, der Verlauf ist ein Zusatz, die Grafik ist die der Kraftlinie", () => {
        const m = model(kraftlinie);
        expect(m.header.graphic).toBe("kraftlinien");
        expect(m.header.subtitle.map((item) => item.parts[0]?.text)).toEqual(["Kraftlinie"]);
        expect(labels(m.rows)).toEqual(["Stärke", "Regionen", "Beschreibung"]);
        expect(text(m.rows[2])).toContain("Sie verbindet orkische Ritualhöhlen");
        expect(labels(panelModelOf(shown(kraftlinie), null, env("all"))?.rows ?? [])).toContain("Verlauf");
    });

    it("Gebiet: die Art im Untertitel, Hauptstadt als Link, das Etikett „inoffiziell“ als Halbpille mit Bezeichner", () => {
        const m = model(gebiet);
        expect(m.header.subtitle.map((item) => item.parts[0]?.text)).toEqual(["Königreich"]);
        expect(m.header.canon).toEqual({ state: "unofficial", by: "Briefspiel (2)" });
        // Seit dem Betreiberentscheid vom 2026-10-13 hat ein Gebiet seine EIGENE Kopfkategorie, nicht mehr das allgemeine Bild.
        expect(m.header.graphic).toBe("gebiet");
        const capital = m.rows.find((row) => row.label === "Hauptstadt");
        expect(capital?.value).toMatchObject({ kind: "parts", parts: [{ text: "Gareth", ref: { kind: "place" } }] });
        expect(m.wiki?.rights.find((row) => row.key === "kanon")?.text).toContain("Inoffiziell");
        // Legacy: rechts in der Halbpille der Wikizeile steht die Art, nicht noch einmal der Name oder der Bezeichner des Kopfes.
        expect(m.wiki?.canon).toEqual({ state: "unofficial", by: "Wiki-Artikel" });
    });

    it("Gipfel: die Art als Wort, die Gipfelgrafik", () => {
        const m = model(gipfel);
        expect(m.header.subtitle.map((item) => item.parts[0]?.text)).toEqual(["Berggipfel"]);
        expect(m.header.graphic).toBe("berggipfel");
        expect(m.rows.map((row) => row.label)).toEqual(["Lage", "Beschreibung"]);
        expect(text(m.rows[0])).toBe("Rote Sichel");
        expect(text(m.rows[1])).toBe("Die Adlerspitze ist der höchste Berg der Roten Sichel.");
    });
});

describe("eine freie Kartenstelle: „Was ist hier?“ (WI-0063 4.9)", () => {
    const m = panelModelOf(shown(punkt), null, env());

    it("Titel und die Grade des Gradnetzes (0° in Gareth), die Koordinate der Karte hinter dem verborgenen Klick (WI-0273)", () => {
        expect(m?.header.title).toBe("Was ist hier?");
        expect(m?.header.subtitle[0]?.parts[0]?.text).toBe("Kartenpunkt (0° 22′ S · 0° 00′)");
        expect(m?.header.subtitle[0]?.parts[0]?.wechsel).toBe("Kartenpunkt (x 551,60 · y 520,50)");
    });

    it("die Gegend: die Treppe „An dieser Stelle“, Derographie und Vegetation, die Vorkommen, Klimazone, die Flüsse", () => {
        expect(m?.liesIn?.heading).toBe("An dieser Stelle");
        // 🔴 Die vier Vorkommenszeilen stehen zwischen der Vegetation und der Klimazone (WI-0110) - Legacys eigener Platz
        // („Klimazone steht IMMER direkt unter Flora“, Owner 2026-08-03) und die Reihenfolge des Hauses.
        expect(labels(m?.rows ?? [])).toEqual([
            "Regionen",
            "Vegetation",
            "Waren",
            "Fauna",
            "Flora",
            "Spezies",
            "Klimazone",
            "Flüsse in der Nähe",
        ]);
        expect(text(m?.rows[0])).toBe("Herz des Kontinents · Aventurien (Kontinent)");
        expect(text(m?.rows[1])).toBe("Goldene Au (Kulturlandschaft)");
        expect(text(m?.rows[7])).toBe("Finkenbach (Bach)");
    });

    it("🔴 die Vorkommen bringen ihre Antwort MIT und fragen nichts nach - ein Punkt hat keine Sektionsadresse", () => {
        const ware = m?.rows.find((row) => row.key === "lore:ware")?.value;
        expect(ware?.kind).toBe("lore");
        if (ware?.kind !== "lore") throw new Error("keine Vorkommenszeile");
        expect(ware.sentence).toBe("2 Handelswaren gelistet");
        // 🪤 Keine `ref`: Es gibt kein Kartenobjekt, das zu fragen wäre - dafür steht die Antwort schon hier.
        expect(ware.ref).toBeUndefined();
        expect(ware.section?.rows).toBe(punktLore);
        // Die vier Zeilen teilen EINE Antwort (WI-0091 A10).
        const sections = (m?.rows ?? [])
            .map((row) => (row.value.kind === "lore" ? row.value.section : undefined))
            .filter((section) => section !== undefined);
        expect(sections).toHaveLength(4);
        expect(new Set(sections).size).toBe(1);
    });

    it("🔴 nie „Direkt von hier“: der Satz zählt nur die Listen, und eine Zeile steht auch bei 0", () => {
        const satz = (key: string): string | undefined => {
            const value = m?.rows.find((row) => row.key === key)?.value;
            return value?.kind === "lore" ? value.sentence : undefined;
        };
        expect(satz("lore:flora")).toBe("Keine besonderen Vorkommen");
        expect(satz("lore:spezies")).toBe("1 Spezies verzeichnet");
        for (const row of m?.rows ?? []) {
            if (row.value.kind !== "lore") continue;
            const groups = (row.value.section?.rows ?? []).flatMap((entry) => entry.groups.map((group) => group.group));
            expect(groups, row.key).not.toContain("here");
            expect(groups, row.key).not.toContain("origin");
        }
    });

    it("🪤 ohne Vorkommen in der Antwort stehen die vier Zeilen nicht - keine Zeile wartet auf eine Antwort", () => {
        const ohne = panelModelOf(shown({ ...punkt, lore: undefined }), null, env());
        expect(labels(ohne?.rows ?? [])).toEqual(["Regionen", "Vegetation", "Klimazone", "Flüsse in der Nähe"]);
    });

    it("das Bild folgt der Gegend: erst die Vegetation, vor der Antwort der Platzhaltergrund", () => {
        expect(m?.header.graphic).toBe("kulturlandschaft");
        expect(panelModelOf(shown(undefined), null, env())?.header.graphic).toBeUndefined();
        const ref = { kind: "mapPoint" as const, x: 1, y: 2 };
        const before = panelModelOf(
            { ref, key: "k", title: undefined, status: "loading", answer: undefined },
            null,
            env(),
        );
        expect(before?.header.graphic).toBeUndefined();
        // Die Kacheln stehen sofort da, auch ohne Antwort.
        expect(before?.actions.map((action) => action.id)).toEqual(["addDestination", "share", "removePoint"]);
    });
});

describe("eine Etappe zeigt ihren Inhalt wie in P5 und die Navigation „Etappe n von m · ‹ · ›“ (P7, E13)", () => {
    // Eine Reise trägt ihre Teilstrecken, ihre Meilen je Einheit und je Etappe Strecke und Zeit: Daraus baut der
    // Kopf der Etappe seine drei Kennzahlen (WI-0079 §7a).
    const route = {
        legs: [],
        miles_per_unit: 3,
        stages: [
            {
                index: 0,
                type: "Strasse",
                path_names: ["Reichsstraße 1"],
                from: { name: "Gareth" },
                to: { name: "" },
                distance_units: 4,
                travel_hours: 2,
                rest_hours: 0,
            },
        ],
    } as unknown as RouteResponse;

    it("Titel, von → nach, Wegart und Wege; die Grafik der Wegart; keine Aktionen", () => {
        const m = panelModelOf(
            {
                ref: { kind: "routeStage", index: 0, routeKey: "a~b" },
                key: "k",
                title: undefined,
                status: "ready",
                answer: undefined,
            },
            route,
            env(),
        );
        expect(m?.header.title).toBe("Etappe 1 von 1");
        // Die Zeile Von, Pfeil, Bis (das Leerzeichen vor dem Pfeil ist geschützt); die Einzelheiten prüft `panel-stage.test.ts`.
        expect(m?.header.subtitle[0]?.parts.map((part) => part.text).join("")).toBe("Gareth\u00a0→ Kreuzung");
        expect(m?.header.graphic).toBe("strasse");
        expect(m?.rows.map((row) => [row.label, text(row)])).toEqual([
            ["Wegart", "Straße"],
            ["Wege", "Reichsstraße 1"],
        ]);
        expect(m?.actions).toEqual([]);
    });

    const stageSubject = (index: number): Parameters<typeof panelModelOf>[0] => ({
        ref: { kind: "routeStage", index, routeKey: "a~b" },
        key: `k${String(index)}`,
        title: undefined,
        status: "ready",
        answer: undefined,
    });
    const stage = (index: number): RouteResponse["stages"][number] =>
        ({
            index,
            type: "Strasse",
            path_names: [],
            from: { name: "A" },
            to: { name: "B" },
            distance_units: 4,
            travel_hours: 2,
            rest_hours: 0,
        }) as never;
    const threeStages = {
        legs: [],
        miles_per_unit: 3,
        stages: [stage(0), stage(1), stage(2)],
    } as unknown as RouteResponse;

    it("🔴 die Pfeile: an der ersten Etappe ist ‹ gesperrt, an der letzten ›, dazwischen beide frei", () => {
        const nav = (index: number): { hasPrev: boolean; hasNext: boolean } | undefined =>
            panelModelOf(stageSubject(index), threeStages, env())?.header.stageNav;
        expect(nav(0)).toMatchObject({ hasPrev: false, hasNext: true });
        expect(nav(1)).toMatchObject({ hasPrev: true, hasNext: true });
        expect(nav(2)).toMatchObject({ hasPrev: true, hasNext: false });
    });

    it("die Pfeile tragen ihre Beschriftung für Bildschirmleser, in beiden Sprachen", () => {
        expect(panelModelOf(stageSubject(1), threeStages, env())?.header.stageNav).toMatchObject({
            prev: "Vorige Etappe",
            next: "Nächste Etappe",
        });
        setLocale("en");
        expect(panelModelOf(stageSubject(1), threeStages, env())?.header.stageNav).toMatchObject({
            prev: "Previous stage",
            next: "Next stage",
        });
    });

    it("eine einzige Etappe hat beide Pfeile gesperrt; ohne Etappe in der Reise gibt es keine Pfeile (sie hätten kein Ziel)", () => {
        expect(panelModelOf(stageSubject(0), route, env())?.header.stageNav).toMatchObject({
            hasPrev: false,
            hasNext: false,
        });
        expect(panelModelOf(stageSubject(5), route, env())?.header.stageNav).toBeUndefined();
        expect(panelModelOf(stageSubject(0), null, env())?.header.stageNav).toBeUndefined();
    });
});

describe("Weg: „Weg als Route“ und „Ganze Straße“ (P7, B12; Legacy `pathAlsRouteKachelMarkup`, `avesmapsWegMarkierungszeile`)", () => {
    it("🔴 die Kachel steht als vierte, nach „Änderungen vorschlagen“, mit der Ziel-Nadel, und trägt die Orte als Wegpunkte", () => {
        const m = model(reichsstrasseMitRoute);
        expect(m.actions.map((action) => action.id)).toEqual(["show", "share", "suggest", "pathAsRoute"]);
        const tile = m.actions[3];
        expect(tile).toMatchObject({ label: "Weg als Route", tone: "soft", icon: { image: "waypoint-end" } });
        expect(tile?.run).toMatchObject({ type: "pathAsRoute" });
        const places = tile?.run?.type === "pathAsRoute" ? tile.run.places : [];
        expect(places.map((entry) => entry.name)).toEqual(["Elenvina", "Kyndoch", "Gratenfels"]);
        // Ein WaypointHit des Planers: derselbe Ort, nie verborgen.
        expect(places[0]).toMatchObject({ subtype: "stadt", hidden: false, x: 400.5, y: 457.8 });
    });

    it("ohne Orte vom Server keine Kachel (kein Wiki-Artikel, Seeweg, weniger als zwei Orte): das Band bleibt dreiteilig", () => {
        expect(model(reichsstrasse).actions.map((action) => action.id)).toEqual(["show", "share", "suggest"]);
    });

    it("englisch heißt sie wie in Legacy „Way as route“", () => {
        setLocale("en");
        expect(model(reichsstrasseMitRoute).actions[3]?.label).toBe("Way as route");
    });

    it("🔴 die Markierungszeile „Ganze Straße: Von – Bis“ steht unter der Wegart; ohne Strecke keine Zeile", () => {
        expect(model(reichsstrasseMitRoute).header.note).toEqual({
            label: "Ganze Straße:",
            text: "Elenvina – Gratenfels",
        });
        expect(model(reichsstrasse).header.note).toBeUndefined();
    });
});

describe("Kraftlinie: Verbindet, Verläuft über, Abschnitte (P7; Legacy `powerlineInfoboxMarkup`)", () => {
    const m = model(kraftlinieMitGestalt);

    it("🔴 Teilzuordnung (WI-0205): die Abschnitte ohne den Artikel der Linie stehen in der Zeile „Abschnitte“", () => {
        const teil = model({
            ...kraftlinieMitGestalt,
            lineShape: { ...kraftlinieMitGestalt.lineShape, segmentsWithoutWiki: 3 },
        });
        const zeile = teil.rows.find((row) => row.label === "Abschnitte");
        expect(zeile?.value).toEqual({ kind: "text", text: "14 · geschlossener Ring · davon 3 ohne Wiki-Artikel" });
    });

    it("die drei Zeilen stehen vor Stärke, in Legacys Reihenfolge", () => {
        expect(labels(m.rows)).toEqual([
            "Verbindet",
            "Verläuft über",
            "Abschnitte",
            "Stärke",
            "Regionen",
            "Beschreibung",
        ]);
    });

    it("zwei Enden heißen „A ↔ B“, jeder Name ein Link auf den Ort; mehr Enden stehen mit „ · “", () => {
        const value = m.rows[0]?.value;
        expect(value?.kind).toBe("parts");
        const parts = value?.kind === "parts" ? value.parts : [];
        expect(parts.map((part) => part.text)).toEqual(["Blutzinnen", " ↔ ", "Rote Sichel"]);
        expect(parts.map((part) => part.ref?.kind)).toEqual(["place", undefined, "place"]);
        const three = model({
            ...kraftlinieMitGestalt,
            lineShape: {
                ends: [
                    ...(kraftlinieMitGestalt.lineShape?.ends ?? []),
                    { ref: { kind: "place", id: "70000000-0000-4000-8000-0000000000ff" }, name: "Dritte Spitze" },
                ],
            },
        });
        const parts3 = three.rows[0]?.value.kind === "parts" ? three.rows[0].value.parts : [];
        expect(parts3.map((part) => part.text)).toEqual(["Blutzinnen", " · ", "Rote Sichel", " · ", "Dritte Spitze"]);
    });

    it("„Verläuft über“ kürzt mit „…“, wo es mehr gibt; „Abschnitte“ nennt die Zahl und den Ring", () => {
        const via = m.rows[1]?.value.kind === "parts" ? m.rows[1].value.parts : [];
        expect(via.map((part) => part.text)).toEqual(["Seminar der Verständigung", " …"]);
        expect(text(m.rows[2])).toBe("14 · geschlossener Ring");
    });

    it("🔴 ohne Gestalt (kein benannter Ort, ein Segment) fehlen die drei Zeilen - keine leere Zeile", () => {
        expect(labels(model(kraftlinie).rows)).toEqual(["Stärke", "Regionen", "Beschreibung"]);
    });

    it("englisch: Connects, Runs via, Sections", () => {
        setLocale("en");
        expect(labels(model(kraftlinieMitGestalt).rows).slice(0, 3)).toEqual(["Connects", "Runs via", "Sections"]);
    });
});

describe("Gebiet: Umstritten mit, Herrschaftssitz, Kartenzeitraum, Klimazone (P7; Legacy `createRegionWikiInfoBoxMarkup`)", () => {
    const m = model(gebietUmstritten);

    it("die Reihenfolge ist Legacys: Status, Umstritten mit, Hauptstadt, Herrschaftssitz, Kartenzeitraum, Klimazone", () => {
        expect(labels(m.rows)).toEqual([
            "Status",
            "Umstritten mit",
            "Hauptstadt",
            "Herrschaftssitz",
            "Kartenzeitraum",
            "Klimazone",
        ]);
    });

    it("🔴 jeder Anspruchsteller ist ein Link auf sein Gebiet mit dem Kästchen in seiner Farbe, durch Komma getrennt", () => {
        const parts = m.rows[1]?.value.kind === "parts" ? m.rows[1].value.parts : [];
        expect(parts).toEqual([
            {
                text: "Markgrafschaft Perricum",
                ref: { kind: "territory", id: "22119a37-632d-4b20-a297-1af281d45315" },
                swatch: "#a9b263",
            },
            { text: ", " },
            {
                text: "Bergkönigreich Tosch Mur",
                ref: { kind: "territory", id: "e5727ed3-dd73-4e21-a512-b369a46edfa1" },
                swatch: "#c34141",
            },
        ]);
    });

    it("die Klimazone des Gebiets mit Anteilen, wie bei jeder Fläche", () => {
        expect(text(m.rows[5])).toBe("Gemäßigte Zone (87 %) · Winterfeuchte Subtropen (11 %)");
    });

    it("ohne Anspruchsteller fehlt die Zeile; englisch heißt sie „Contested with“", () => {
        expect(labels(model(gebiet).rows)).not.toContain("Umstritten mit");
        setLocale("en");
        expect(labels(model(gebietUmstritten).rows)).toContain("Contested with");
        expect(labels(model(gebietUmstritten).rows)).toContain("Map period");
    });
});

describe("Gebiet: die Staatsinfobox des Gebietsexports E4 (WI-0063 27.18; Legacy `createRegionWikiInfoBoxMarkup`)", () => {
    const rowsIn = (mode: "approved" | "legacy" | "all", answer = gebietStaatsinfobox): RowModel[] =>
        panelModelOf(shown(answer), null, env(mode))?.rows ?? [];
    const TABLE = [
        "Status",
        "Herrschaftsform",
        "Oberhaupt",
        "Gründung",
        "Auflösung",
        "Gründer",
        "Hauptstadt",
        "Herrschaftssitz",
        "Sprache",
        "Währung",
        "Einwohnerzahl",
        "Geographisch",
        "Kartenzeitraum",
        "Handelswaren",
        "Klimazone",
    ];

    it("🔴 Tobrien: Legacys Reihenfolge - auch wenn der Server die Fakten durcheinander liefert; die Handelszone fehlt, weil sie leer ist", () => {
        expect(labels(rowsIn("approved"))).toEqual(TABLE);
        // Genau Legacys Anzeige und die Anzeige der Besucher sind für das Gebiet dieselbe: es gibt keine freigegebene Zusatzzeile.
        expect(labels(rowsIn("legacy"))).toEqual(TABLE);
        expect(labels(rowsIn("approved"))).not.toContain("Handelszone");
    });

    it("die Werte stehen verbatim; Hauptstadt und Herrschaftssitz sind Links auf den Ort, alles andere ist Text", () => {
        const rows = rowsIn("approved");
        const byLabel = (label: string): RowModel | undefined => rows.find((row) => row.label === label);
        expect(text(byLabel("Herrschaftsform"))).toBe("Feudalherrschaft");
        expect(text(byLabel("Einwohnerzahl"))).toBe("80000 (1040 BF)");
        expect(text(byLabel("Handelswaren"))).toBe("Holz, Vieh, Pferde, Pflaumen, Kupfer");
        expect(byLabel("Hauptstadt")?.value).toEqual({
            kind: "parts",
            parts: [{ text: "Ysilia (nominell)", ref: { kind: "place", id: "0cf5714d-0417-4096-aa2a-f5a631f94613" } }],
        });
        expect(byLabel("Herrschaftssitz")?.value).toMatchObject({ kind: "parts", parts: [{ text: "Perainefurten" }] });
        for (const label of TABLE.filter((entry) => !["Hauptstadt", "Herrschaftssitz", "Klimazone"].includes(entry))) {
            expect(byLabel(label)?.value.kind, label).toBe("text");
        }
    });

    it("🔴 die vier Zusatzfelder (Kontinent, Politisch, Wappenbeschreibung, Zugehörigkeit roh) erscheinen nicht - nur im Entwicklerschalter „alle“", () => {
        for (const mode of ["approved", "legacy"] as const) {
            const shownLabels = labels(rowsIn(mode));
            for (const hidden of ["Kontinent", "Politisch", "Wappenbeschreibung", "Zugehörigkeit (roh)"]) {
                expect(shownLabels, `${mode}: ${hidden}`).not.toContain(hidden);
            }
        }
        // Im Modus „alle“ stehen sie hinter der Tabelle, in der Folge der Antwort.
        expect(labels(rowsIn("all")).slice(TABLE.length)).toEqual([
            "Politisch",
            "Kontinent",
            "Zugehörigkeit (roh)",
            "Wappenbeschreibung",
        ]);
    });

    it("🔴 ein eigener Knoten ohne Wiki-Artikel: nur seine Sprache; das Zusatzfeld „Politisch“ bleibt verborgen", () => {
        const rows = rowsIn("approved", gebietEigenerKnoten);
        expect(labels(rows)).toEqual(["Sprache", "Klimazone"]);
        expect(text(rows[0])).toBe("Garethi");
    });

    it("🔴 ein Gebiet, dessen Detailzeile nur Zusatzfelder trägt, zeigt keine Zeile - keinen Platzhalter, keinen Strich", () => {
        expect(rowsIn("approved", gebietNurZusatzfelder)).toEqual([]);
    });

    it("🔴 ein bewusst leerer Override entfällt als Zeile: ohne den Fakt steht kein „Oberhaupt“ da, die übrigen Zeilen bleiben in ihrer Folge", () => {
        // Der Server liefert für `''` keinen Fakt (die Antwort verbietet einen leeren Wert); das Panel erfindet keine Zeile dafür.
        const withoutRuler = {
            ...gebietStaatsinfobox,
            facts: (gebietStaatsinfobox.facts ?? []).filter((fact) => fact.field !== "oberhaupt"),
        };
        expect(labels(rowsIn("approved", withoutRuler))).toEqual(TABLE.filter((label) => label !== "Oberhaupt"));
    });

    it("englisch: Legacys Wortlaut der Staatsinfobox", () => {
        setLocale("en");
        expect(labels(rowsIn("approved"))).toEqual([
            "Status",
            "Form of government",
            "Ruler",
            "Founded",
            "Dissolution",
            "Founder",
            "Capital",
            "Seat",
            "Language",
            "Currency",
            "Population",
            "Geography",
            "Map period",
            "Trade goods",
            "Climate zone",
        ]);
    });
});

describe("Kartenstelle: „In der Nähe (n)“ (P7; Legacy `avesmapsWhatIsHereNearbyMarkup`)", () => {
    const m = panelModelOf(shown(punktMitNachbarn), null, env());

    it("ein Abschnitt mit Zähler; die Zeilen stehen nach Entfernung, die Art links als Wort", () => {
        expect(m?.nearby?.heading).toBe("In der Nähe");
        expect(m?.nearby?.count).toBe(3);
        expect(labels(m?.nearby?.rows ?? [])).toEqual(["Straße", "Gebäude", "Flussweg"]);
    });

    it("🔴 der Name ist ein Link auf Ort oder Weg, dann „ · “, der Abstand in Meilen (eine Stelle) und die Nadel", () => {
        const parts = (index: number): { text: string; ref?: string; bearing?: string }[] => {
            const value = m?.nearby?.rows[index]?.value;
            return value?.kind === "parts"
                ? value.parts.map((part) => ({
                      text: part.text,
                      ...(part.ref === undefined ? {} : { ref: part.ref.kind }),
                      ...(part.bearing === undefined ? {} : { bearing: part.bearing.label }),
                  }))
                : [];
        };
        // Ein Weg ohne Namen nennt nur den Abstand.
        expect(parts(0)).toEqual([{ text: "1,1 Meilen", bearing: "Südwest (210,3°)" }]);
        expect(parts(1)).toEqual([
            { text: "Schloss Finkenschlag", ref: "place" },
            { text: " · " },
            { text: "1,6 Meilen", bearing: "Westen (287,8°)" },
        ]);
        expect(parts(2)[0]).toEqual({ text: "Finkenbach", ref: "path" });
        // Die Nadel dreht sich um die echte Peilung, das Wort ist die nächste von acht Richtungen (359,9 Grad ist Norden).
        expect(parts(2)[2]?.bearing).toBe("Norden (359,9°)");
    });

    it("🔴 ohne Nachbarn kein Abschnitt; der Kartenpunkt ohne Antwort und der von heute (ohne Feld) tragen keinen", () => {
        expect(panelModelOf(shown(punkt), null, env())?.nearby).toBeUndefined();
        expect(panelModelOf(shown({ ...punkt, nearby: undefined }), null, env())?.nearby).toBeUndefined();
    });

    it("englisch: „Nearby“, „miles“ und die Himmelsrichtung wie in Legacy", () => {
        setLocale("en");
        const en = panelModelOf(shown(punktMitNachbarn), null, env());
        expect(en?.nearby?.heading).toBe("Nearby");
        const value = en?.nearby?.rows[1]?.value;
        const miles = value?.kind === "parts" ? value.parts[2] : undefined;
        expect(miles?.text).toBe("1.6 miles");
        expect(miles?.bearing?.label).toBe("West (287.8°)");
    });
});

describe("🔴 Ein verborgener Ort trägt die Pille „Verborgen“ (WI-0080 Nachtrag, Betreiber 2026-10-05)", () => {
    it("neben dem Kanon-Etikett, und nur aus dem Lesevertrag", () => {
        const m = model(verborgenerOrt);
        expect(m.header.title).toBe("Der verlassene Ritualplatz der Orks");
        expect(m.header.hidden).toBe(true);
        // Sie steht NEBEN dem Kanon-Etikett, sie ersetzt es nicht.
        expect(m.header.canon).toEqual({ state: "unofficial", by: "Briefspiel" });
        // Ganz normal: Das Panel ist das eines Orts, mit Aktionen und Reiseziel (WI-0080 Abnahmekriterium 2).
        expect(m.actions.map((action) => action.id)).toContain("addDestination");
    });

    it("🔴 keine andere Art bekommt sie: ohne das Merkmal im Vertrag steht keine Pille da", () => {
        // Dieselbe Antwort ohne `hidden` - der Client leitet die Pille aus nichts anderem ab (nicht aus der Art, nicht aus der Karte).
        const sichtbar = { ...verborgenerOrt };
        delete sichtbar.hidden;
        expect(model(sichtbar).header.hidden).toBeUndefined();
        for (const antwort of [gareth, dorf, waldwildnis, gebiet, gipfel, reichsstrasse, kraftlinie, see, huegel]) {
            expect(model(antwort).header.hidden, antwort.subject.kind).toBeUndefined();
        }
        expect(panelModelOf(shown(punkt), null, env())?.header.hidden).toBeUndefined();
    });

    it("englisch: „Hidden“", () => {
        setLocale("en");
        // Der Wortlaut steht in der Sprachtafel; das Modell trägt nur das Merkmal.
        expect(model(verborgenerOrt).header.hidden).toBe(true);
    });
});

describe("Englisch: der Wortlaut ist Legacys (`popup.*`, `infobox.*`)", () => {
    it("Aktionen, Liegt in, Klimazone, Quellenzeile", () => {
        setLocale("en");
        const m = model(gareth);
        expect(m.actions.map((action) => action.label)).toEqual([
            "Add destination",
            "Share link",
            "Write a review",
            "Suggest a change",
        ]);
        expect(m.liesIn?.heading).toBe("Located in");
        expect(labels(m.rows).slice(-1)).toEqual(["Climate zone"]);
        expect(m.wiki?.rights.find((row) => row.key === "kanon")?.text).toContain("Official");
        expect(m.header.subtitle[1]?.parts.map((part) => part.text).join("")).toContain("Capital of");
    });
});
