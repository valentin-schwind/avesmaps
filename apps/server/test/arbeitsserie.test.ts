import { describe, expect, it } from "vitest";
import {
    SERIEN_MAX_MITGLIEDER,
    SERIEN_PAUSE_MIN,
    bildeSerien,
    istGruppierbar,
    mitgliederHash,
    scopeSchluessel,
    scopesVon,
    zerlegeScope,
    type SerienOperation,
} from "../src/editor/arbeitsserie.ts";

/**
 * Die Regel der Arbeitsserien (WI-0265 B2a; Fachvertrag B.1 bis B.3, Gate 1 „fein“), rein und ohne Datenbank.
 *
 * Problemfälle: Eine Serie mischt Ort, Weg und Gebirge einer Stunde Arbeit; eine fremde Operation am Gegenstand, eine Rücknahme, ein Import oder ein
 * Mehr-Gegenstand-Eintrag (Ort verschieben samt Wegenden) beendet sie nicht; eine Operation an einem ANDEREN Gegenstand beendet sie fälschlich; die Pause
 * läuft vom letzten Mitglied statt vom ersten; die Kennung ändert sich, wenn die Serie nach vorn wächst; eine Serie ist länger als 100.
 */

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);
const GEBIRGE = "landscape:aaaaaaaa-0000-4000-8000-000000000001";
const ORT = "place:bbbbbbbb-0000-4000-8000-000000000001";
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";

let zaehler = 0;
function op(
    minute: number,
    optionen: Partial<Pick<SerienOperation, "personId" | "source" | "action" | "scopes">> = {},
): SerienOperation {
    zaehler += 1;
    return {
        operationId: `00000000-0000-4000-8000-${String(zaehler).padStart(12, "0")}`,
        seq: zaehler,
        atMs: T0 + minute * MIN,
        source: optionen.source ?? "editor",
        action: optionen.action ?? "landscape.update",
        personId: optionen.personId === undefined ? A : optionen.personId,
        scopes: optionen.scopes ?? [GEBIRGE],
    };
}

const ids = (kette: readonly SerienOperation[]): string[] => kette.map((o) => o.operationId);

describe("Arbeitsserien: die Regel (Fachvertrag B)", () => {
    it("🔴 8× „Fertig“ am selben Gebirge, Pausen 2 bis 9 Minuten: EINE Serie mit 8 Mitgliedern, älteste zuerst", () => {
        const zeitleiste = [0, 3, 5, 12, 14, 20, 29, 31].map((m) => op(m));
        const ketten = bildeSerien(zeitleiste);
        expect(ketten).toHaveLength(1);
        expect(ids(ketten[0]!)).toEqual(ids(zeitleiste));
    });

    it("die Pause zählt von Mitglied zu Mitglied, nicht vom ersten: ein langer Vormittag mit kurzen Pausen bleibt EINE Serie", () => {
        const zeitleiste = Array.from({ length: 10 }, (_, i) => op(i * SERIEN_PAUSE_MIN));
        expect(bildeSerien(zeitleiste)).toHaveLength(1);
    });

    it("🔴 eine Pause über der Grenze trennt; genau die Grenze noch nicht", () => {
        const genau = [op(0), op(SERIEN_PAUSE_MIN)];
        expect(bildeSerien(genau)).toHaveLength(1);
        const darueber = [op(0), op(SERIEN_PAUSE_MIN + 1)];
        expect(bildeSerien(darueber)).toEqual([]);
        // 2 + 2: zwei Serien, wenn die Pause in der Mitte liegt.
        const vier = [op(0), op(5), op(60), op(65)];
        expect(bildeSerien(vier).map(ids)).toEqual([ids(vier.slice(0, 2)), ids(vier.slice(2))]);
    });

    it("eine einzelne Operation ist keine Serie", () => {
        expect(bildeSerien([op(0)])).toEqual([]);
    });

    it("🔴 A, B am selben Gegenstand, A macht weiter: B beendet die Serie von A, es sind zwei (B.3)", () => {
        const a1 = op(0);
        const a2 = op(2);
        const b1 = op(4, { personId: B });
        const a3 = op(6);
        const a4 = op(8);
        const ketten = bildeSerien([a1, a2, b1, a3, a4]);
        expect(ketten.map(ids)).toEqual([ids([a1, a2]), ids([a3, a4])]);
    });

    it("🔴 Rücknahme, Import und WikiSync am Gegenstand beenden die Serie und sind nie Mitglied", () => {
        for (const source of ["restore", "import", "wikisync", "testwelt_reset"]) {
            const a1 = op(0);
            const a2 = op(1);
            const dazwischen = op(2, { source, action: "landscape.restore" });
            const a3 = op(3);
            const a4 = op(4);
            expect(bildeSerien([a1, a2, dazwischen, a3, a4]).map(ids), source).toEqual([ids([a1, a2]), ids([a3, a4])]);
        }
    });

    it("🔴 ein Eintrag mit mehreren Gegenständen (Ort verschieben samt Wegenden) beendet die Ortsserie und ist nie Mitglied (B.3)", () => {
        const o1 = op(0, { scopes: [ORT], action: "place.update" });
        const o2 = op(1, { scopes: [ORT], action: "place.update" });
        const verschiebung = op(2, {
            scopes: [ORT, "path:cccccccc-0000-4000-8000-000000000001"],
            action: "place.move",
        });
        const o3 = op(3, { scopes: [ORT], action: "place.update" });
        const o4 = op(4, { scopes: [ORT], action: "place.update" });
        expect(bildeSerien([o1, o2, verschiebung, o3, o4]).map(ids)).toEqual([ids([o1, o2]), ids([o3, o4])]);
        expect(istGruppierbar(verschiebung)).toBe(false);
    });

    it("🔴 Anlegen ist nur Mitglied, wenn der Katalog es zurücknimmt (Ort und Weg, WI-0265 B8a); sonst ist es nie Mitglied und beendet die Serie", () => {
        // Ort anlegen und die Änderungen danach: EINE Serie, die mit dem Anlegen beginnt.
        const neu = op(0, { scopes: [ORT], action: "place.create" });
        const o1 = op(1, { scopes: [ORT], action: "place.update" });
        const o2 = op(2, { scopes: [ORT], action: "place.update" });
        expect(bildeSerien([neu, o1, o2]).map(ids)).toEqual([ids([neu, o1, o2])]);
        expect(istGruppierbar(neu)).toBe(true);
        // Ein neuer Weg ebenso.
        const weg = "path:cccccccc-0000-4000-8000-000000000002";
        const wegNeu = op(3, { scopes: [weg], action: "path.create" });
        const w1 = op(4, { scopes: [weg], action: "path.update" });
        expect(bildeSerien([wegNeu, w1]).map(ids)).toEqual([ids([wegNeu, w1])]);
        // Ein Anlegen, das keine Familie zurücknimmt (hier ein Medium), ist nie Mitglied und beendet die Serie. Ein Werk der Inhalte ist seit WI-0265 B8d eines.
        const medium = op(5, { scopes: ["media:dddddddd-0000-4000-8000-000000000001"], action: "media.create" });
        expect(istGruppierbar(medium)).toBe(false);
        expect(
            istGruppierbar(op(5, { scopes: ["work:dddddddd-0000-4000-8000-000000000001"], action: "work.create" })),
        ).toBe(true);
        const a1 = op(6, { scopes: [ORT], action: "place.update" });
        const dazwischen = op(7, { scopes: [ORT], action: "media.create" });
        const a2 = op(8, { scopes: [ORT], action: "place.update" });
        const a3 = op(9, { scopes: [ORT], action: "place.update" });
        expect(bildeSerien([a1, dazwischen, a2, a3]).map(ids)).toEqual([ids([a2, a3])]);
    });

    it("🔴 B8d: Quelle, Werk, Korpus und Vorkommen anlegen sind Mitglied und eröffnen die Serie; ein Schritt der Wiki-Box nie (Einzeleintrag, er beendet die Serie des Trägers)", () => {
        const QUELLE = "source:cccccccc-0000-4000-8000-0000000000cc";
        for (const action of ["source.create", "work.create", "corpus.create", "lore.create"])
            expect([action, istGruppierbar(op(0, { scopes: [QUELLE], action }))]).toEqual([action, true]);
        const neu = op(0, { scopes: [QUELLE], action: "source.create" });
        const o1 = op(1, { scopes: [QUELLE], action: "source.update" });
        expect(bildeSerien([neu, o1]).map(ids)).toEqual([ids([neu, o1])]);
        // Die Wiki-Box teilt den Gegenstand des Trägers, aber nie seine Serie.
        const a1 = op(2, { scopes: [ORT], action: "place.update" });
        const box = op(3, { scopes: [ORT], action: "wikibox.zuweisen" });
        const a2 = op(4, { scopes: [ORT], action: "place.update" });
        const a3 = op(5, { scopes: [ORT], action: "place.update" });
        expect(istGruppierbar(box)).toBe(false);
        expect(bildeSerien([a1, box, a2, a3]).map(ids)).toEqual([ids([a2, a3])]);
    });

    it("🔴 B8b: ein Anlegen, das der Katalog führt (Gebiet, Fläche, Kraftlinie, Kraftlinienpunkt), ist Mitglied und eröffnet die Serie; eines, das er nicht führt (Medium), bleibt draußen", () => {
        const GEBIET = "territory:cccccccc-0000-4000-8000-0000000000aa";
        for (const action of ["territory.create", "territory_area.create", "powerline.create", "nodix.create"])
            expect([action, istGruppierbar(op(0, { scopes: [GEBIET], action }))]).toEqual([action, true]);
        expect(istGruppierbar(op(0, { scopes: [GEBIET], action: "media.create" }))).toBe(false);
        const neu = op(0, { scopes: [GEBIET], action: "territory.create" });
        const o1 = op(1, { scopes: [GEBIET], action: "territory.update" });
        const o2 = op(2, { scopes: [GEBIET], action: "territory.update" });
        expect(bildeSerien([neu, o1, o2]).map(ids)).toEqual([ids([neu, o1, o2])]);
    });

    it("🔴 B8c: Fläche, Beschriftung, Gipfel und Landmarke, Sprache und Teilfläche der Sprache anlegen und eine Kopie in eine Sprache sind Mitglied; ein Betreiberlauf nicht", () => {
        const FLAECHE = "landscape:cccccccc-0000-4000-8000-0000000000bb";
        for (const action of [
            "landscape.create",
            "label.create",
            "peak.create",
            "sprache.create",
            "sprache_flaeche.create",
            "sprache.flaeche_aus_landschaft",
        ])
            expect([action, istGruppierbar(op(0, { scopes: [FLAECHE], action }))]).toEqual([action, true]);
        // Eine Quelle anlegen ist seit B8d Mitglied (Stilllegen); ein Betreiberlauf (Agent, keine Person) ist nie Mitglied.
        expect(istGruppierbar(op(0, { scopes: [FLAECHE], action: "source.create" }))).toBe(true);
        expect(istGruppierbar(op(0, { scopes: [FLAECHE], action: "area.gebirge_startwerte", personId: null }))).toBe(
            false,
        );
        // Eine Serie aus Anlegen, Beschriftung und Änderung derselben Person an derselben Fläche ist EINE Serie.
        const neu = op(0, { scopes: [FLAECHE], action: "landscape.create" });
        const beschriftung = op(1, { scopes: [FLAECHE], action: "label.create" });
        const umbenannt = op(2, { scopes: [FLAECHE], action: "landscape.update" });
        expect(bildeSerien([neu, beschriftung, umbenannt]).map(ids)).toEqual([ids([neu, beschriftung, umbenannt])]);
    });

    it("ein Agent, die Kommandozeile und das System bilden keine Serie (keine Person)", () => {
        const zeitleiste = [op(0, { personId: null }), op(1, { personId: null })];
        expect(bildeSerien(zeitleiste)).toEqual([]);
    });

    it("🔴 höchstens 100 Mitglieder, vom ältesten an gezählt: 250 am Stück sind 100 + 100 + 50, und die Kennung der ersten bleibt beim Wachsen", () => {
        const zeitleiste = Array.from({ length: 250 }, (_, i) => op(i));
        const ketten = bildeSerien(zeitleiste);
        expect(ketten.map((k) => k.length)).toEqual([SERIEN_MAX_MITGLIEDER, SERIEN_MAX_MITGLIEDER, 50]);
        const nachvorn = bildeSerien([...zeitleiste, op(250)]);
        expect(nachvorn[0]![0]!.operationId).toBe(ketten[0]![0]!.operationId);
        expect(nachvorn.map((k) => k.length)).toEqual([100, 100, 51]);
    });

    it("🔴 die Kennung ist die operationId des ÄLTESTEN Mitglieds und bleibt, wenn ein späterer Eintrag dazukommt (U14)", () => {
        const erste = [op(0), op(2), op(4)];
        const spaeter = op(6);
        const vorher = bildeSerien(erste);
        const nachher = bildeSerien([...erste, spaeter]);
        expect(vorher[0]![0]!.operationId).toBe(nachher[0]![0]!.operationId);
        expect(nachher[0]).toHaveLength(4);
    });
});

describe("Arbeitsserien: Gegenstand und Prüfsumme", () => {
    const ID = (n: number): string => `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`;

    it("🔴 der Scope folgt B.2: Teilfläche und Beschriftung tragen die Fläche mit, Gebietsfläche das Gebiet, Sprachfläche die Sprache", () => {
        expect(scopeSchluessel({ region_public_id: ID(1), region_area_public_id: ID(2) })).toBe(`landscape:${ID(1)}`);
        expect(scopeSchluessel({ region_public_id: ID(1), map_label_public_id: ID(3) })).toBe(`landscape:${ID(1)}`);
        expect(scopeSchluessel({ territory_public_id: ID(4), territory_area_public_id: ID(5) })).toBe(
            `territory:${ID(4)}`,
        );
        expect(scopeSchluessel({ sprache_public_id: ID(6), sprache_flaeche_public_id: ID(7) })).toBe(
            `sprache:${ID(6)}`,
        );
        expect(scopeSchluessel({ place_public_id: ID(8) })).toBe(`place:${ID(8)}`);
        expect(scopeSchluessel({ peak_public_id: ID(9) })).toBe(`peak:${ID(9)}`);
        expect(scopeSchluessel({})).toBeUndefined();
        expect(zerlegeScope(`landscape:${ID(1)}`)).toEqual({ kind: "landscape", id: ID(1) });
    });

    it("die Gegenstände einer Operation sind die verschiedenen Schlüssel ihrer Einträge; zwei Teilflächen DERSELBEN Fläche sind einer", () => {
        expect(
            scopesVon([
                { region_public_id: ID(1), region_area_public_id: ID(2) },
                { region_public_id: ID(1), region_area_public_id: ID(3) },
            ]),
        ).toEqual([`landscape:${ID(1)}`]);
        expect(scopesVon([{ place_public_id: ID(8) }, { path_public_id: ID(9) }])).toEqual([
            `path:${ID(9)}`,
            `place:${ID(8)}`,
        ]);
    });

    it("🔴 die Prüfsumme ist eine Menge: Reihenfolge, Schreibweise und Doppelte ändern sie nicht; ein Mitglied mehr schon", () => {
        const a = ID(1);
        const b = ID(2);
        const c = ID(3);
        expect(mitgliederHash([a, b, c])).toBe(mitgliederHash([c, a, b]));
        expect(mitgliederHash([a, b, c])).toBe(mitgliederHash([a.toUpperCase(), b, c, a]));
        expect(mitgliederHash([a, b, c])).not.toBe(mitgliederHash([a, b]));
        expect(mitgliederHash([a, b, c])).toMatch(/^[0-9a-f]{64}$/u);
    });
});
