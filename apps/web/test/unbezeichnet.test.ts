import { afterEach, describe, expect, it } from "vitest";
import type { MapPointDetail, SubjectDetail } from "@avesmaps3d/shared";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { setLocale } from "../src/i18n/i18n.ts";
import { it as italiano } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import { artNebenName, unnamedLandscapeLabel, unnamedPathLabel } from "../src/i18n/unnamed.ts";
import { areaChoiceList } from "../src/controls/choice-list.ts";
import { choicesOf } from "../src/info-panel/object-link.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import type { PanelModel, RowModel } from "../src/info-panel/panel-types.ts";
import { areaPointerHint, pathPointerHint } from "../src/map/pointer-hint.ts";
import { env, punkt, shown, waldwildnis } from "./panel-fixtures.ts";

/**
 * Ein Gegenstand ohne Namen heißt nach dem Satz seiner Art (WI-0105, Betreiber 2026-10-07: „wege mit
 * generischen namen wie Pfad-3443 … als ‚Unbezeichneter Pfad‘ … betiteln“ und „‚Wald-925‘ sollte zu
 * ‚Unbezeichneter Wald‘“).
 *
 * 🔴 OPS-073 (Thomas: „unbekannter Wald“ wirke total unprofessionell, das „unbekannter“ solle überall weg, „so dass zb nur Wald
 * steht“): Der Satz einer namenlosen FLÄCHE ist nur noch ihre Art. Die Wege behalten ihren Satz („Unbezeichneter Pfad“); ob auch sie
 * die Art allein tragen sollen, ist eine offene Frage an den Betreiber.
 *
 * 🔴 Die ERKENNUNG steht in `packages/shared` und ist dort gesichert (`path-names.test.ts`,
 * `landscape-names.test.ts`). Hier steht, was die Oberfläche daraus macht.
 */

afterEach(() => {
    setLocale("de");
});

const model = (answer: SubjectDetail | MapPointDetail | undefined, title?: string): PanelModel => {
    const result = panelModelOf(shown(answer, title), null, env());
    if (result === undefined) throw new Error("kein Modell");
    return result;
};
const row = (rows: readonly RowModel[], label: string): RowModel | undefined => rows.find((r) => r.label === label);
const text = (value: RowModel | undefined): string =>
    value?.value.kind === "text"
        ? value.value.text
        : value?.value.kind === "parts"
          ? value.value.parts.map((part) => part.text).join("")
          : "";

/** Dieselbe Fläche ohne Titel: genau der Fall, den der Server bei einem Griff schickt (`title` fehlt). */
const ohneTitel = <T extends { title?: string }>(detail: T): T => {
    const rest: Record<string, unknown> = { ...detail };
    delete rest["title"];
    return rest as T;
};

describe("die Sätze der Sprachtafeln", () => {
    it("die fünf Arten, für die der Betreiber einen Wortlaut gab", () => {
        expect(unnamedPathLabel("Pfad")).toBe("Unbezeichneter Pfad");
        expect(unnamedPathLabel("Strasse")).toBe("Unbezeichnete Straße");
        expect(unnamedPathLabel("Weg")).toBe("Unbezeichneter Weg");
        expect(unnamedPathLabel("Flussweg")).toBe("Unbezeichneter Fluss");
        expect(unnamedPathLabel("Flussweg", true)).toBe("Unbezeichneter Bach");
    });

    it("„Bach“ ist ein Flussweg mit Merkmal, keine neunte Wegart", () => {
        // 🪤 `is_bach` gilt im Schema nur am Flussweg (CHECK `path_bach_ist_flussweg`); an jeder anderen Art
        // bleibt der Satz der Art.
        expect(unnamedPathLabel("Pfad", true)).toBe("Unbezeichneter Pfad");
    });

    it("🚩 die vier Arten OHNE Wortlaut behalten ihr „Unbenannt“, bis der Betreiber einen nennt", () => {
        // Gemessene Griffe im aktiven Bestand: Seeweg 1.328, Gebirgspass 126, Wüstenpfad 14, Reichsstraße 12.
        expect(unnamedPathLabel("Seeweg")).toBe("Unbenannter Seeweg");
        expect(unnamedPathLabel("Gebirgspass")).toBe("Unbenannter Gebirgspass");
        expect(unnamedPathLabel("Wuestenpfad")).toBe("Unbenannter Wüstenpfad");
        expect(unnamedPathLabel("Reichsstrasse")).toBe("Unbenannte Reichsstraße");
    });

    it("eine unbekannte Wegart heißt „Ohne Namen“ - erfunden wird nichts", () => {
        expect(unnamedPathLabel("Luftweg")).toBe("Ohne Namen");
        expect(unnamedPathLabel("")).toBe("Ohne Namen");
    });

    it("🔴 die Landschaften heißen nur noch nach ihrer Art, ohne „Unbezeichnet…“ (OPS-073)", () => {
        expect(unnamedLandscapeLabel("wald")).toBe("Wald");
        expect(unnamedLandscapeLabel("insel")).toBe("Insel");
        expect(unnamedLandscapeLabel("tal")).toBe("Tal");
        expect(unnamedLandscapeLabel("suempfe_moore")).toBe("Sümpfe und Moore");
        expect(unnamedLandscapeLabel("region")).toBe("Region");
        expect(unnamedLandscapeLabel("inselgruppe")).toBe("Inselgruppe");
    });

    it("„sonstiges“ und jede unbekannte Art fallen auf „Fläche“", () => {
        // 🪤 „Sonstiges“ ist als Name einer Fläche kein Satz, und im Bestand gibt es keine aktive Fläche dieser Art.
        expect(unnamedLandscapeLabel("sonstiges")).toBe("Fläche");
        expect(unnamedLandscapeLabel("")).toBe("Fläche");
        expect(unnamedLandscapeLabel("raumstation")).toBe("Fläche");
    });

    it("🔴 die drei Arten vom 2026-10-08 haben eigene Sätze", () => {
        // Betreiber: „ja gletscher sind neu … nenn Sie einfach mal ‘Gletscher’ und ‘Eislandschaft’,
        // ‘Schneelandschaft’ gibts übrigens auch neu.“
        expect(unnamedLandscapeLabel("gletscher")).toBe("Gletscher");
        expect(unnamedLandscapeLabel("eislandschaft")).toBe("Eislandschaft");
        expect(unnamedLandscapeLabel("schneelandschaft")).toBe("Schneelandschaft");
    });

    it("🔴 und die zwei Küstenformen, aus demselben Nachtrag", () => {
        // Betreiber 2026-10-08: „‚Unbezeichnete Flachküste‘ / ‚Unbezeichnete Steilküste‘ -> ganz vergessen,
        // genau dasselbe“. 🪤 Die allgemeine Küste bleibt daneben eine eigene Art.
        expect(unnamedLandscapeLabel("flachkueste")).toBe("Flachküste");
        expect(unnamedLandscapeLabel("steilkueste")).toBe("Steilküste");
        expect(unnamedLandscapeLabel("kueste")).toBe("Küste");
    });

    it("🔴 die vier Vegetationsarten vom 2026-11-09 (WI-0301) heißen nach sich selbst", () => {
        expect(unnamedLandscapeLabel("bergtundra")).toBe("Bergtundra");
        expect(unnamedLandscapeLabel("savanne")).toBe("Savanne");
        expect(unnamedLandscapeLabel("heideland")).toBe("Heideland");
        expect(unnamedLandscapeLabel("oedland")).toBe("Ödland");
    });

    it("🔴 die Art neben dem Namen entfällt, wo sie der Name selbst ist - sonst steht sie doppelt", () => {
        expect(artNebenName("Wald", "Wald")).toBe("");
        expect(artNebenName("Waldwildnis", "Urwald")).toBe("Urwald");
        expect(artNebenName("Wald", "")).toBe("");
    });

    it("jede Landschaftsart der Artentafel hat einen Satz - außer „sonstiges“, mit Begründung", () => {
        const arten = Object.keys(de)
            .filter((key) => key.startsWith("landscape.type."))
            .map((key) => key.slice("landscape.type.".length));
        // 28 aus WI-0035 plus die fünf vom 2026-10-08: Gletscher, Flachküste, Steilküste, Schneelandschaft,
        // Eislandschaft. 🔴 Damit kennt die Tafel JEDE Art, die Legacys Katalog führt (33 von 33), und jede,
        // die im Bestand vorkommt - gemessen, nicht gezählt. Dazu die vier eigenen vom 2026-11-09 (WI-0301):
        // Bergtundra, Savanne, Heideland, Ödland.
        expect(arten.length).toBe(37);
        const ohne = arten.filter((art) => !(`landscape.unnamed.${art}` in de));
        expect(ohne).toEqual(["sonstiges"]);
        for (const art of arten) {
            if (art === "sonstiges") continue;
            expect(unnamedLandscapeLabel(art)).not.toMatch(/^Unbezeichnet/u);
            expect(`landscape.unnamed.${art}` in en).toBe(true);
        }
    });

    it("🔴 in allen neun Sprachen ist der Satz einer namenlosen Fläche die Art selbst - das hält die Dopplung unter dem Titel weg", () => {
        // Die Oberfläche lässt die Art neben oder unter dem Namen weg, wenn beide gleich sind (`artNebenName`,
        // `subtitleUnderTitle`). Läge ein Satz auch nur um ein Zeichen daneben, stünde sie wieder doppelt.
        const tafeln = { de, en, fr, nl, it: italiano, es, pl, da, sv } as Record<string, Record<string, string>>;
        for (const [sprache, tafel] of Object.entries(tafeln)) {
            const arten = Object.keys(tafel)
                .filter((key) => key.startsWith("landscape.unnamed."))
                .map((key) => key.slice("landscape.unnamed.".length));
            expect(arten.length, `${sprache}: Arten mit Satz`).toBe(36);
            for (const art of arten) {
                expect(tafel[`landscape.unnamed.${art}`], `${sprache}: ${art}`).toBe(tafel[`landscape.type.${art}`]);
            }
            expect(tafel["landscape.unnamed"], `${sprache}: Rückfall`).toBeTruthy();
        }
    });

    it("Englisch: jeder Satz kommt in beiden Tafeln vor", () => {
        setLocale("en");
        expect(unnamedPathLabel("Pfad")).toBe("Unnamed trail");
        expect(unnamedPathLabel("Flussweg", true)).toBe("Unnamed brook");
        expect(unnamedLandscapeLabel("wald")).toBe("Forest");
        expect(unnamedLandscapeLabel("gletscher")).toBe("Glacier");
        expect(unnamedLandscapeLabel("steilkueste")).toBe("Cliff Coast");
        expect(unnamedLandscapeLabel("sonstiges")).toBe("Area");
    });
});

describe("der Kopf des Infopanels", () => {
    it("eine Fläche ohne Titel heißt nach dem Satz ihrer Art, nicht nach der blanken Art", () => {
        expect(model(waldwildnis).header.title).toBe("Waldwildnis");
        expect(model(ohneTitel(waldwildnis)).header.title).toBe("Urwald");
    });

    it("🔴 die Art steht NICHT noch einmal darunter, wenn sie der Titel selbst ist (OPS-073)", () => {
        const kopf = model(ohneTitel(waldwildnis)).header;
        expect(kopf.subtitle.map((item) => item.parts.map((part) => part.text).join(""))).not.toContain("Urwald");
    });

    it("mit eigenem Namen bleibt die Art im Untertitel stehen - sie sagt etwas anderes als der Titel", () => {
        const kopf = model(waldwildnis).header;
        expect(kopf.title).toBe("Waldwildnis");
        expect(kopf.subtitle.map((item) => item.parts.map((part) => part.text).join(""))).toContain("Urwald");
    });

    it("ein Weg ohne Titel heißt nach dem Satz seiner Wegart", () => {
        const weg: SubjectDetail = {
            subject: { kind: "path", chain: "Pfad-3443:Pfad" },
            revision: waldwildnis.revision,
            subtitle: [{ part: "type", key: "Pfad" }],
        };
        expect(model(weg).header.title).toBe("Unbezeichneter Pfad");
    });

    it("💣 der rohe Griff kommt auch nicht als VORLÄUFIGER Titel durch", () => {
        // `known.title` ist der Name der Kachel oder des Suchtreffers. `app.vue` liest ihn jetzt mit
        // `pathReaderName`; ohne das stand hier „Pfad-3443“, bis die Antwort kam.
        const weg: SubjectDetail = {
            subject: { kind: "path", chain: "Pfad-3443:Pfad" },
            revision: waldwildnis.revision,
            subtitle: [{ part: "type", key: "Pfad" }],
        };
        expect(model(weg, "Pfad-3443").header.title).toBe("Pfad-3443");
        expect(model(weg, undefined).header.title).toBe("Unbezeichneter Pfad");
    });
});

describe("die Zeilen des Infopanels", () => {
    it("ein Fluss ohne Namen heißt „Unbezeichneter Bach“, und die Klammer fällt weg", () => {
        const benannt = model(punkt);
        expect(text(row(benannt.rows, de["infoPanel.rivers"]))).toBe("Finkenbach (Bach)");

        const ohneNamen: MapPointDetail = {
            ...punkt,
            context: {
                ...punkt.context,
                rivers: [{ ...(punkt.context?.rivers ?? [])[0]!, name: "Flussweg-3940" }],
            },
        };
        expect(text(row(model(ohneNamen).rows, de["infoPanel.rivers"]))).toBe("Unbezeichneter Bach");
    });

    it("eine Fläche ohne Namen in der Kontextzeile: der Satz, und die Art NICHT zusätzlich in Klammern", () => {
        const items = punkt.context?.landscapes?.items ?? [];
        const ohneNamen: MapPointDetail = {
            ...punkt,
            context: {
                ...punkt.context,
                landscapes: {
                    relation: "at_point",
                    items: [{ ref: items[0]!.ref, type: "wald", layer: "vegetation" }],
                },
            },
        };
        expect(text(row(model(ohneNamen).rows, de["layer.vegetation"]))).toBe("Wald");
    });
});

describe("Karte und Auswahllisten", () => {
    it("das Zeiger-Schild eines Wegs: der Satz als Name, die Art daneben", () => {
        expect(pathPointerHint({ name: "Gauweg", type: "Weg" }, { x: 1, y: 2 })).toMatchObject({
            name: "Gauweg",
            type: "Weg",
        });
        expect(pathPointerHint({ name: "Pfad-3443", type: "Pfad" }, { x: 1, y: 2 })).toMatchObject({
            name: "Unbezeichneter Pfad",
            type: "Pfad",
        });
        expect(pathPointerHint({ name: "Flussweg-3940", type: "Flussweg", bach: true }, { x: 1, y: 2 })).toMatchObject({
            name: "Unbezeichneter Bach",
            type: "Bach",
        });
    });

    it("das Zeiger-Schild einer Fläche ohne Namen: ihre Art als Name, und nicht noch einmal als Art dahinter", () => {
        const hint = areaPointerHint({
            candidate: { kind: "landscape", id: "x", name: null, type: "wald", area: 1 },
            others: 0,
            afterCurrent: false,
            screen: { x: 1, y: 2 },
        });
        expect(hint.name).toBe("Wald");
        expect(hint.type).toBe("");
        // Mit Namen bleibt die Art dahinter.
        const benannt = areaPointerHint({
            candidate: { kind: "landscape", id: "y", name: "Waldwildnis", type: "urwald", area: 1 },
            others: 0,
            afterCurrent: false,
            screen: { x: 1, y: 2 },
        });
        expect(benannt).toMatchObject({ name: "Waldwildnis", type: "Urwald" });
    });

    it("die Flächenliste an einer Stelle des Klicks", () => {
        const list = areaChoiceList({
            candidates: [
                { kind: "landscape", id: "a", name: "Waldwildnis", type: "urwald", area: 2 },
                { kind: "landscape", id: "b", name: null, type: "wald", area: 1 },
            ],
            selected: "a",
            screen: { x: 1, y: 2 },
            point: { x: 0, y: 0 },
        });
        expect(list.entries.map((entry) => entry.name)).toEqual(["Waldwildnis", "Wald"]);
        // Die namenlose Fläche heißt schon „Wald“: Die Art steht nicht noch einmal daneben (OPS-073).
        expect(list.entries.map((entry) => entry.type)).toEqual(["Urwald", ""]);
    });

    it("die Auswahlliste eines mehrdeutigen Objektlinks", () => {
        expect(
            choicesOf([
                { ref: { kind: "path", chain: "Gauweg:Weg" }, title: "Gauweg", type: "Weg" },
                { ref: { kind: "path", chain: "Pfad-3443:Pfad" }, type: "Pfad" },
                { ref: { kind: "area", id: "b" }, type: "wald" },
            ]).map((choice) => choice.name),
        ).toEqual(["Gauweg", "Unbezeichneter Pfad", "Wald"]);
    });
});

describe("der Satz steht NICHT auf der Karte", () => {
    it("🚩 die gezeichnete Beschriftung ist unberührt - sie kommt aus `path_label_run`", () => {
        // 74 der 845 beschrifteten Ketten tragen einen Griff und stehen heute roh auf der Karte. Das ist eine
        // Ableitung (`derive:path-runs`), kein Anzeigewert, und der Betreiber hat die Karte nicht genannt.
        // Dieser Fall hält die Grenze fest, damit sie nicht versehentlich fällt.
        expect(de["infoPanel.unnamed.Pfad"]).toBe("Unbezeichneter Pfad");
    });
});
