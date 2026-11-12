import { describe, expect, it } from "vitest";
import { MAP_HISTORY_OBJECT_KINDS, type MapHistoryObjectKind } from "@avesmaps3d/shared";
import { MAP_AUDIT_FIELDS } from "../../server/src/editor/map-operation.ts";
import { istGrundFeld } from "../src/aenderungen/aenderung-detail-modell";
import { feldBezeichnung, zeilenFeldNamen } from "../src/aenderungen/aenderung-felder";
import { bereinigtesFeld, istRohNeben } from "../src/aenderungen/aenderung-text";
import { locale } from "../src/i18n/i18n";

/**
 * 💣 **Jeder Schlüssel des Fachprotokolls hat einen Namen** (WI-0265 B6i; Betreiber: „Wiki settlement class“, „Roh schrift“, „Offizielle sprache“ im Reiter „Änderungen“).
 *
 * `feldBezeichnung` fällt für einen Schlüssel ohne Namen auf `lesbar` zurück („Wiki settlement class“): ein Notbehelf, der halb englisch aussieht. Der Rückfall war nie das Ziel, aber nichts hat
 * gemerkt, wenn ein Schreibweg einen neuen Schlüssel in die Positivliste `MAP_AUDIT_FIELDS` (Server, `editor/map-operation.ts`) aufnahm. Dieser Test liest die Liste selbst (nicht eine Abschrift)
 * und wird rot, sobald ein Schlüssel ohne Namen dazukommt. Wer das liest, weil er rot ist: Den Namen trägt `aenderung-felder.ts` nach (Tafel der Art, `ALLGEMEIN` oder, für einen Wiki-Stand, das Feld
 * in `admin.wikisync.feld.*`); ein Feld, das nie als Zeile erscheint, gehört in `istNebenfeld` / `istGrundFeld` (`aenderung-detail-modell.ts`).
 */

/** Die Art im Protokoll (`MAP_AUDIT_FIELDS`) → die Art des Gegenstands in den „Änderungen“ (`MapHistoryObject.kind`): nur die Landschaft heißt dort anders. */
const GEGENSTAND: Readonly<Record<string, MapHistoryObjectKind>> = { region: "landscape" };
const artVon = (audit: string): MapHistoryObjectKind => GEGENSTAND[audit] ?? (audit as MapHistoryObjectKind);

/** Schlüssel, die nie als eigene Zeile erscheinen: der Grund einer Rücknahme (ein Satz) und die Herkunft neben ihrem Feld (`nameOrigin`). */
const hatKeineZeile = (feld: string): boolean => istGrundFeld(feld) || feld.endsWith("Origin");

const FAELLE = Object.entries(MAP_AUDIT_FIELDS).flatMap(([art, felder]) =>
    (felder as readonly string[]).map((feld): [string, string] => [art, feld]),
);

describe("Schlüssel des Fachprotokolls haben einen Namen", () => {
    it("die Liste ist da und jede Art des Protokolls ist eine Art der „Änderungen“", () => {
        expect(FAELLE.length).toBeGreaterThan(300);
        for (const art of Object.keys(MAP_AUDIT_FIELDS)) expect(MAP_HISTORY_OBJECT_KINDS, art).toContain(artVon(art));
    });

    it("🔴 kein Schlüssel der Positivliste steht als Rückfall („Wiki settlement class“, „Roh schrift“) da", () => {
        const ohneName = FAELLE.filter(
            ([art, feld]) => !hatKeineZeile(feld) && feldBezeichnung(artVon(art), feld).schluessel !== undefined,
        ).map(([art, feld]) => `${art}.${feld}`);
        expect(ohneName).toEqual([]);
    });

    it("💣 ein erfundener Schlüssel fiele auf: der Wächter kann rot werden", () => {
        for (const feld of ["erfundenesNeuesFeld", "wikiGibtEsNicht", "wikiGibtEsNichtUnbekannt", "rohGibtEsNicht"])
            expect(feldBezeichnung("place", feld).schluessel, feld).toBe(feld);
        expect(feldBezeichnung("sprache_artikel", "erfundenesNeuesFeld").text).toBe("Erfundenes neues feld");
    });

    it("jeder Name ist ein Wort für Menschen: kein Unterstrich, kein camelCase, kein englischer Rest", () => {
        const schluesselartig = /_|[a-z][A-Z]/u;
        const englisch = /^Roh |\b(?:origin|restore|reason|class|type|height|staerke)\b/iu;
        const gefunden = FAELLE.flatMap(([art, feld]) => {
            if (hatKeineZeile(feld)) return [];
            const text = feldBezeichnung(artVon(art), feld).text;
            return schluesselartig.test(text) || englisch.test(text) ? [`${art}.${feld}: ${text}`] : [];
        });
        expect(gefunden).toEqual([]);
    });
});

describe("Wiki-Stand und Wiki-Quelltext heißen nach ihrem Feld", () => {
    it("🔴 `wiki<Feld>` heißt „<Feld> im Wiki“, die Marke „… unbekannt“ (die Namen kommen aus dem Bericht des WikiSync)", () => {
        locale.value = "de";
        expect(feldBezeichnung("place", "wikiSettlementClass")).toEqual({ text: "Ortsgröße im Wiki" });
        expect(feldBezeichnung("place", "wikiSettlementClassUnbekannt")).toEqual({
            text: "Ortsgröße im Wiki unbekannt",
        });
        expect(feldBezeichnung("place", "wikiName").text).toBe("Name im Wiki");
        expect(feldBezeichnung("place", "wikiRegionText").text).toBe("Region im Wiki");
        expect(feldBezeichnung("peak", "wikiNachbarSo").text).toBe("Nachbar im Südosten im Wiki");
        expect(feldBezeichnung("peak", "wikiHeight").text).toBe("Höhe im Wiki");
        expect(feldBezeichnung("powerline", "wikiStaerke").text).toBe("Stärke im Wiki");
        // Die Detailfelder des Gebiets, auch die zwei, die der Bericht des WikiSync nicht kennt.
        expect(feldBezeichnung("territory", "wikiFormOfGovernment").text).toBe("Staatsform im Wiki");
        expect(feldBezeichnung("territory", "wikiTradeZoneUnbekannt").text).toBe("Handelszone im Wiki unbekannt");
        expect(feldBezeichnung("territory", "wikiPolitical").text).toBe("Politisch im Wiki");
    });

    it("🔴 `roh<Feld>` heißt „<Feld> (Wiki-Quelltext)“, auch als Wiki-Stand", () => {
        locale.value = "de";
        expect(feldBezeichnung("sprache_artikel", "rohSchrift")).toEqual({ text: "Schrift (Wiki-Quelltext)" });
        expect(feldBezeichnung("sprache_artikel", "rohOffizielleSprache").text).toBe(
            "Offizielle Sprache (Wiki-Quelltext)",
        );
        expect(feldBezeichnung("sprache_artikel", "rohWeitereVerbreitung").text).toBe(
            "Weitere Verbreitung (Wiki-Quelltext)",
        );
        expect(feldBezeichnung("lore", "wikiRohVerbreitung").text).toBe("Verbreitung (Wiki-Quelltext) im Wiki");
    });

    it("die Felder des Sprachartikels heißen wie im Bericht des WikiSync", () => {
        locale.value = "de";
        const namen = Object.fromEntries(
            [
                "artikel",
                "name",
                "sprachfamilie",
                "vorstufen",
                "schrift",
                "sprecheranzahl",
                "offizielleSprache",
                "weitereVerbreitung",
                "kurzbeschreibung",
                "navigation",
            ].map((feld) => [feld, feldBezeichnung("sprache_artikel", feld).text]),
        );
        expect(namen).toEqual({
            artikel: "Artikel",
            name: "Name",
            sprachfamilie: "Sprachfamilie",
            vorstufen: "Vorstufen",
            schrift: "Schrift",
            sprecheranzahl: "Sprecheranzahl",
            offizielleSprache: "Offizielle Sprache",
            weitereVerbreitung: "Weitere Verbreitung",
            kurzbeschreibung: "Kurzbeschreibung",
            navigation: "Sprachfamilie (Navigationsleiste)",
        });
    });

    it("das Rohfeld und seine bereinigte Fassung finden einander; `rohstoffe` ist kein Rohfeld", () => {
        expect(bereinigtesFeld("rohSchrift")).toBe("schrift");
        expect(bereinigtesFeld("rohOffizielleSprache")).toBe("offizielleSprache");
        expect(bereinigtesFeld("wikiRohVerbreitung")).toBe("wikiVerbreitung");
        expect(bereinigtesFeld("rohstoffe")).toBeUndefined();
        expect(bereinigtesFeld("schrift")).toBeUndefined();
        expect(bereinigtesFeld("wikiRohe")).toBeUndefined();
        expect(istRohNeben("rohSchrift", ["schrift", "rohSchrift"])).toBe(true);
        expect(istRohNeben("rohSchrift", ["rohSchrift", "name"])).toBe(false);
    });
});

describe("Die Feldzeile der Liste zeigt das Rohfeld nur, wenn es allein steht", () => {
    it("🔴 `rohSchrift` neben `schrift` fällt weg, allein heißt es „Schrift (Wiki-Quelltext)“", () => {
        locale.value = "de";
        expect(zeilenFeldNamen("sprache_artikel", ["artikel", "schrift", "rohSchrift", "rohVorstufen"])).toEqual([
            "Artikel",
            "Schrift",
            "Vorstufen (Wiki-Quelltext)",
        ]);
    });

    it("kein Grund einer Rücknahme und keine Herkunft neben dem Feld in der Zeile", () => {
        locale.value = "de";
        expect(zeilenFeldNamen("place", ["name", "nameOrigin", "restoreReason"])).toEqual(["Name"]);
    });
});
