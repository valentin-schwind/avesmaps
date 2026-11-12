import { afterEach, describe, expect, it, vi } from "vitest";
import { WETTER_SYMBOL_VORGABEN, type SubjectDetail } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { createObjectLink } from "../src/info-panel/object-link.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import { presentationFromDetail } from "../src/info-panel/presentation.ts";
import { shareAddress } from "../src/info-panel/share-address.ts";
import { INTERACTION_PRIORITY } from "../src/map/interaction/priorities.ts";
import type { HitContext, InteractionOwner, MapInteractionCoordinator } from "../src/map/interaction/types.ts";
import { installWetterInfo, type WetterInfoAnschluss } from "../src/map/wetter/wetter-info.ts";
import { wetterIconName, wetterIconSchild } from "../src/map/wetter/wetter-schalter.ts";
import { symboleFuerEngine, type Symbolebene, type WetterSymbol } from "../src/map/wetter/wetter-symbole.ts";
import { env, REVISION, shown } from "./panel-fixtures.ts";

/**
 * Das Infopanel eines Wetter-Icons mit Wiki-Verweis (WI-0288; Betreiber 2026-11-08: „ja infopanel bauen“), ohne Browser: das Modell aus der Detailantwort, Link und
 * Darstellung, und der Besitzer `wetter-info` der Karte. Den Klick im echten Bild prüft `e2e/wetter-infopanel.spec.ts`.
 *
 * Problemfälle: Ein Icon ohne Verweis nimmt den Klick (er gehört der Karte darunter); bei offenem Wetter-Editor öffnet der Klick ein Panel statt zu wählen; ein unbekannter
 * Typ eines neueren Servers zeigt das Bild einer anderen Art; die Lizenzzeile steht ohne Wiki-Text da; der Link teilt einen Namen statt der Kennung.
 */

afterEach(() => setLocale("de"));

const ID = "02880000-0000-4000-8000-000000000001";
const WIKI_URL = "https://de.wiki-aventurica.de/wiki/Probewind_(Wind)";
const prov = { kind: "wiki" as const, wikiUrl: WIKI_URL };

const wind: SubjectDetail = {
    subject: { kind: "wetterSymbol", id: ID },
    revision: REVISION,
    title: "Westwinddrift",
    subtitle: [{ part: "type", key: "wind" }],
    facts: [
        { field: "regionParent", value: "Probeküste", provenance: prov },
        { field: "description", value: "Ein erfundener Wind.", provenance: prov },
    ],
    wiki: {
        url: WIKI_URL,
        title: "Probewind (Wind)",
        corpus: { key: "wiki-aventurica.de" },
        license: { name: "CC BY-SA 3.0", uri: "https://creativecommons.org/licenses/by-sa/3.0/" },
    },
    target: { x: 341, y: 407, zoom: 3, bounds: [191, 257, 491, 557] },
};

/** Die Antwort ohne ein Feld (ein Feld ohne Inhalt fehlt in der Antwort, WI-0063 5.3). */
const ohne = (detail: SubjectDetail, feld: keyof SubjectDetail): SubjectDetail =>
    Object.fromEntries(Object.entries(detail).filter(([name]) => name !== feld)) as SubjectDetail;

describe("Das Modell des Panels", () => {
    it("🔴 Kopf mit Typbild und Art, Region und Beschreibung, Lizenzzeile, Wikizeile, Anzeigen und Link teilen", () => {
        const modell = panelModelOf(shown(wind), null, env())!;
        expect(modell.header).toMatchObject({ title: "Westwinddrift", graphic: "wind", images: [] });
        expect(modell.header.subtitle).toEqual([{ parts: [{ text: "Wind" }] }]);
        expect(modell.rows.map((row) => [row.label, row.value.kind === "text" ? row.value.text : ""])).toEqual([
            ["Region", "Probeküste"],
            ["Beschreibung", "Ein erfundener Wind."],
        ]);
        expect(modell.lizenz).toHaveLength(1);
        expect(modell.wiki?.url).toBe(WIKI_URL);
        expect(modell.actions.map((action) => action.id)).toEqual(["show", "share"]);
        expect(modell.actions[1]!.run).toEqual({
            type: "share",
            url: `https://avesmaps.test/?wetter=${ID}`,
            what: "place",
        });
        // Keine Quellen, keine Kataloge: Ein Icon trägt nichts davon.
        expect(modell.sources).toBeUndefined();
        expect(modell.catalogs).toEqual([]);
    });

    it("Wirbel, Meeresströmung und Mahlstrom wählen ihr Bild und ihr Wort; in einer anderen Sprache das Wort der Sprache", () => {
        const mit = (key: string): SubjectDetail => ({ ...wind, subtitle: [{ part: "type", key }] });
        const kopf = (key: string) => panelModelOf(shown(mit(key)), null, env())!.header;
        expect(["wirbel", "stroemung", "mahlstrom"].map((key) => kopf(key).graphic)).toEqual([
            "wirbelsturm",
            "meeresstroemung",
            "mahlstrom",
        ]);
        expect(kopf("stroemung").subtitle).toEqual([{ parts: [{ text: "Meeresströmung" }] }]);
        setLocale("en");
        expect(kopf("wirbel").subtitle).toEqual([{ parts: [{ text: "Vortex" }] }]);
        expect(kopf("mahlstrom").subtitle).toEqual([{ parts: [{ text: "Maelstrom" }] }]);
    });

    it("🔴 tolerant: ein unbekannter Typ zeigt das allgemeine Bild ohne Art; ohne Beschreibung keine Lizenzzeile; ohne Felder keine Zeilen", () => {
        const fremd: SubjectDetail = { ...ohne(wind, "facts"), subtitle: [{ part: "type", key: "hagel" }] };
        const modell = panelModelOf(shown(fremd), null, env())!;
        expect(modell.header.graphic).toBe("region");
        expect(modell.header.subtitle).toEqual([]);
        expect(modell.rows).toEqual([]);
        expect(modell.lizenz).toBeUndefined();
        const nurRegion: SubjectDetail = { ...wind, facts: [wind.facts![0]!] };
        expect(panelModelOf(shown(nurRegion), null, env())!.lizenz).toBeUndefined();
        // Ohne Titel der vorläufige Name der Karte.
        const ohneTitel = ohne(wind, "title");
        expect(panelModelOf(shown(ohneTitel, "Passat"), null, env())!.header.title).toBe("Passat");
    });
});

describe("Link und Darstellung", () => {
    it("🔴 Link teilen nennt die Kennung; `?wetter=` öffnet das Icon, eine Kennung in Großbuchstaben auch; Unsinn sagt es", async () => {
        expect(shareAddress("https://avesmaps.test/", { kind: "wetterSymbol", id: ID })).toBe(
            `https://avesmaps.test/?wetter=${ID}`,
        );
        const openSubject = vi.fn();
        const notify = vi.fn();
        const link = createObjectLink({ selection: { openSubject }, client: { resolveLink: vi.fn() }, notify });
        await link.open(`?wetter=${ID.toUpperCase()}`);
        expect(openSubject).toHaveBeenCalledWith(
            { kind: "wetterSymbol", id: ID },
            { source: "link", camera: "target" },
        );
        await link.open("?wetter=Passat");
        expect(openSubject).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it("ein Icon aus einem Link steht in der Ansicht „Standard“", () => {
        expect(presentationFromDetail(wind)).toEqual({ view: "standard" });
    });
});

const symbol = (felder: Partial<WetterSymbol>): WetterSymbol => ({
    ...symboleFuerEngine([WETTER_SYMBOL_VORGABEN[0]!])[0]!,
    ...felder,
});

describe("Der Besitzer `wetter-info` auf der Karte", () => {
    /** Ein Koordinator, der nur den angemeldeten Besitzer festhält. */
    function aufbau(unterDemZeiger: WetterSymbol | undefined, editorOffen = false) {
        let besitzer: InteractionOwner | undefined;
        const coordinator = {
            register: (owner: InteractionOwner) => {
                besitzer = owner;
                return () => (besitzer = undefined);
            },
        } as unknown as MapInteractionCoordinator;
        const symbole = { infoTreffer: vi.fn(() => unterDemZeiger) } as unknown as Symbolebene;
        const info: WetterInfoAnschluss = { oeffne: vi.fn(), zeige: vi.fn(), offen: () => undefined };
        const ab = installWetterInfo(coordinator, symbole, () => editorOffen, info);
        const context = (kind: HitContext["kind"]) =>
            ({ kind, point: { x: 10, y: 20 }, screen: { x: 110, y: 220 } }) as unknown as HitContext;
        return { besitzer: besitzer!, info, symbole, context, ab };
    }

    it("🔴 ein Icon mit Verweis: Hand und Schild beim Zeigen, das Panel beim Klick; ohne Treffer beansprucht er nichts", async () => {
        const passat = symbol({ id: ID, wiki: "Probewind (Wind)", name: "Passat" });
        const { besitzer, info, context } = aufbau(passat);
        expect(besitzer.id).toBe("wetter-info");
        expect(besitzer.priority).toBe(INTERACTION_PRIORITY["wetter-info"]);
        expect(besitzer.kinds).toEqual(["click", "hover"]);
        const anspruch = await besitzer.hit(context("click"));
        expect(anspruch).toMatchObject({ cursor: "pointer", symbol: passat });
        besitzer.apply("hover", anspruch!, context("hover"));
        expect(info.zeige).toHaveBeenCalledWith(passat, { x: 110, y: 220 });
        besitzer.apply("click", anspruch!, context("click"));
        expect(info.oeffne).toHaveBeenCalledWith(passat, { x: 110, y: 220 });
        besitzer.lost?.("hover-ended");
        expect(info.zeige).toHaveBeenLastCalledWith(undefined, undefined);
        expect(await aufbau(undefined).besitzer.hit(context("click"))).toBeUndefined();
    });

    it("🔴 bei offenem Wetter-Editor schweigt er: Der Klick gehört dem Editor (Rang über ihm)", () => {
        const { besitzer } = aufbau(symbol({ wiki: "Probewind (Wind)" }), true);
        expect(besitzer.enabled?.()).toBe(false);
        expect(INTERACTION_PRIORITY["wetter-icon"]).toBeGreaterThan(INTERACTION_PRIORITY["wetter-info"]);
        // Über Ort und Reisebild: Die Icons liegen als SVG über der Karte.
        expect(INTERACTION_PRIORITY["wetter-info"]).toBeGreaterThan(INTERACTION_PRIORITY.reisebild);
        expect(INTERACTION_PRIORITY["wetter-info"]).toBeGreaterThan(INTERACTION_PRIORITY.place);
    });

    it("der Verweis reist mit dem Icon in die Ebene; Name und Schild ohne Namen aus dem Titel ohne Klammerzusatz", () => {
        const [mit, ohne] = symboleFuerEngine([
            { ...WETTER_SYMBOL_VORGABEN[0]!, wikiTitel: "Probewind (Wind)" },
            WETTER_SYMBOL_VORGABEN[1]!,
        ]);
        expect(mit!.wiki).toBe("Probewind (Wind)");
        expect(ohne!.wiki).toBe("");
        expect(wetterIconName({ name: "", wiki: "Probewind (Wind)" })).toBe("Probewind");
        expect(wetterIconName({ name: "Westwinddrift", wiki: "Probewind (Wind)" })).toBe("Westwinddrift");
        expect(wetterIconSchild({ name: "", wiki: "Probestrom", kind: "stroemung" }, { x: 1, y: 2 })).toEqual({
            name: "Probestrom",
            type: "Meeresströmung",
            screen: { x: 1, y: 2 },
        });
    });
});
