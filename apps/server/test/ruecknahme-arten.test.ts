import { describe, expect, it } from "vitest";
import { POWERLINE_STATE_CHANGES } from "@avesmaps3d/shared";
import { WEG_WECHSEL } from "../src/editor/path-split.ts";
import { koenntMitgliedSein } from "../src/editor/arbeitsserie.ts";
import {
    EINZEL_OPERATIONEN,
    GEBIET_ENTFERNEN_OPERATIONEN,
    KRAFTLINIE_STAND_OPERATIONEN,
    RUECKNEHMBARE_OPERATIONEN,
    RUECKNEHMBARE_OPERATIONEN_LISTE,
    SYSTEMLAUF_OPERATIONEN,
    WEG_STAND_OPERATIONEN,
    WIKISYNC_OPERATIONEN,
    istRuecknehmbareOperation,
} from "../src/editor/ruecknahme-arten.ts";
import { FLAECHE_ADAPTER } from "../src/editor/ruecknahme-flaeche.ts";
import { GEBIET_ADAPTER } from "../src/editor/ruecknahme-gebiet.ts";
import { KORPUS_ADAPTER } from "../src/editor/ruecknahme-korpus.ts";
import { KRAFTLINIE_ADAPTER, NODIX_ADAPTER } from "../src/editor/ruecknahme-kraftlinie.ts";
import { ORT_ADAPTER } from "../src/editor/ruecknahme-ort.ts";
import { QUELLE_ADAPTER } from "../src/editor/ruecknahme-quelle.ts";
import { SPRACHE_ADAPTER } from "../src/editor/ruecknahme-sprache.ts";
import { VORKOMMEN_ADAPTER } from "../src/editor/ruecknahme-vorkommen.ts";
import { UMWANDLUNG_ADAPTER } from "../src/editor/ruecknahme-umwandlung.ts";
import { WIKIBOX_ADAPTER } from "../src/editor/ruecknahme-wikibox.ts";
import { WIKISYNC_ADAPTER } from "../src/editor/ruecknahme-wikisync.ts";
import { WEG_ADAPTER } from "../src/editor/ruecknahme-weg.ts";
import { WERK_ADAPTER } from "../src/editor/ruecknahme-werk.ts";
import { ENTFERNEN_OPERATIONEN } from "../src/editor/territory-retire.ts";
import type { RuecknahmeAdapter } from "../src/editor/ruecknahme.ts";

/**
 * Der Katalog der Arten (WI-0265 B6f; `apps/server/src/editor/ruecknahme-arten.ts`), ohne Datenbank: Er hält die Liste („nicht rücknehmbar, Grund Art“) und die Adapter
 * (`pruefeArt`) auf einer Quelle.
 *
 * Problemfälle: Der Katalog führt einen Namen, den kein Adapter annimmt (ein ↺, das immer ablehnt); ein Adapter nimmt eine Operation an, die der Katalog nicht kennt (ein fälschlich
 * verstecktes ↺); die Namen der Wechsel des Stands und des Entfernens, die der Katalog wörtlich führt, laufen von ihren Schreibwegen weg; eine Inhalte-Operation, die kein Adapter
 * kennt (das Anlegen), gilt als rücknehmbar. Quelle, Werk und Korpus (WI-0265 B6g1), das Vorkommen (B6g2) und die Quellen am Träger (B6g3) sind rücknehmbar, ihr Anlegen nicht.
 */

const ADAPTER: Readonly<Record<string, RuecknahmeAdapter>> = {
    ort: ORT_ADAPTER,
    weg: WEG_ADAPTER,
    gebiet: GEBIET_ADAPTER,
    kraftlinie: KRAFTLINIE_ADAPTER,
    nodix: NODIX_ADAPTER,
    flaeche: FLAECHE_ADAPTER,
    umwandlung: UMWANDLUNG_ADAPTER,
    sprache: SPRACHE_ADAPTER,
    quelle: QUELLE_ADAPTER,
    werk: WERK_ADAPTER,
    korpus: KORPUS_ADAPTER,
    vorkommen: VORKOMMEN_ADAPTER,
    wikibox: WIKIBOX_ADAPTER,
    wikisync: WIKISYNC_ADAPTER,
};

/** Je rücknehmbare Operation Aktionen ihrer Protokolleinträge, wie die Schreibwege sie hinterlassen: Der zuständige Adapter muss sie annehmen. */
const BEISPIELE: readonly (readonly [familie: string, operation: string, aktionen: readonly string[]])[] = [
    ["ort", "place.update", ["place.updated"]],
    ["ort", "place.move", ["place.moved", "path.endpoint_moved"]],
    ["ort", "place.delete", ["place.deleted"]],
    ["ort", "place.restore_series", ["place.updated"]],
    ["ort", "traeger.sources", ["place.sources_changed"]],
    ["ort", "place.restore_series", ["place.sources_changed"]],
    ["ort", "place.restore_series", ["place.updated", "place.sources_changed"]],
    // WI-0265 B8a: Mehrfachbearbeitung, Anlegen, Wiederherstellen, Von der Karte nehmen und Setzen, je mit der Rücknahme davon.
    ["ort", "place.sammel", ["place.updated", "place.updated"]],
    ["ort", "place.create", ["place.created"]],
    ["ort", "place.update", ["place.created", "place.updated"]],
    ["ort", "place.restore_series", ["place.deleted"]],
    ["ort", "place.restore_series", ["place.deleted_unplaced"]],
    ["ort", "place.restore", ["place.restored"]],
    ["ort", "place.restore_series", ["place.restored"]],
    ["ort", "place.take_off_map", ["place.taken_off_map"]],
    ["ort", "place.restore_series", ["place.taken_off_map"]],
    ["ort", "place.move", ["place.placed"]],
    ["ort", "place.restore_series", ["place.placed"]],
    ["weg", "path.update", ["path.updated"]],
    ["weg", "path.reshape", ["path.reshaped"]],
    ["weg", "path.delete", ["path.deleted"]],
    ["weg", "path.restore", ["path.restored"]],
    ["weg", "path.take_off_map", ["path.taken_off_map"]],
    ["weg", "path.put_on_map", ["path.put_on_map"]],
    ["weg", "path.regroup", ["path.regrouped"]],
    ["weg", "path.join", ["path.joined"]],
    ["weg", "path.restore_series", ["path.updated"]],
    ["weg", "traeger.sources", ["path.sources_changed"]],
    ["weg", "path.restore_series", ["path.updated", "path.sources_changed"]],
    // WI-0265 B8a: Felder und Kurve in einem Schritt, Anlegen, Teilen und das Zusammenlegen der Teile (die Rücknahme des Teilens), je mit der Rücknahme davon.
    ["weg", "path.update", ["path.updated", "path.reshaped"]],
    ["weg", "path.update", ["path.updated", "path.reshaped", "path.carried"]],
    ["weg", "path.restore_series", ["path.updated", "path.reshaped"]],
    ["weg", "path.create", ["path.created"]],
    ["weg", "path.split", ["path.split", "path.created"]],
    ["weg", "path.restore_series", ["path.split", "path.created"]],
    ["weg", "path.restore_series", ["path.merged", "path.merged"]],
    // WI-0265 B8a2: Die Rücknahmen von „Wege verbinden“ und „Auswahl zu neuem Weg“ und ihre Gegenrichtung (die Richtung steht im Namen der Aktion); eine Kette aus drei Gliedern.
    ["weg", "path.restore_series", ["path.joined", "path.joined"]],
    ["weg", "path.restore_series", ["path.regrouped", "path.regrouped"]],
    ["weg", "path.restore_series", ["path.regrouped_again", "path.regrouped_again"]],
    // WI-0310: der Straßen-Assistent, seine Rücknahme und deren Rücknahme (die Richtung steht im Namen der Aktion wie beim Umgruppieren).
    ["weg", "path.assign_street", ["path.street_assigned", "path.street_assigned"]],
    ["weg", "path.restore_series", ["path.street_assigned", "path.street_assigned"]],
    ["weg", "path.restore_series", ["path.street_assigned_again"]],
    ["weg", "path.restore_series", ["path.merged", "path.merged", "path.merged"]],
    ["weg", "path.restore_series", ["path.split", "path.created", "path.created"]],
    ["weg", "path.restore_series", ["path.deleted"]],
    ["gebiet", "territory.update", ["territory.updated"]],
    ["gebiet", "territory.display", ["territory.display_changed"]],
    ["gebiet", "territory.sammel", ["territory.updated"]],
    ["gebiet", "territory.retire", ["territory.retired"]],
    ["gebiet", "territory.create_parent", ["territory.created"]],
    ["gebiet", "territory.merge", ["territory_area.merged"]],
    ["gebiet", "territory.restore_series", ["territory.updated"]],
    ["gebiet", "traeger.sources", ["territory.sources_changed"]],
    ["gebiet", "territory.restore_series", ["territory.updated", "territory.sources_changed"]],
    // WI-0265 B8b: Form, Anlegen und Zurückholen.
    ["gebiet", "territory.update", ["territory.updated", "territory_area.reshaped", "territory_area.carried"]],
    ["gebiet", "territory.update", ["territory_area.reshaped"]],
    ["gebiet", "territory.create", ["territory.created", "territory_area.created"]],
    ["gebiet", "territory_area.create", ["territory_area.created"]],
    ["gebiet", "territory.restore", ["territory.restored", "territory_area.restored", "territory.updated"]],
    ["gebiet", "territory.restore_series", ["territory.retired", "territory_area.retired"]],
    ["kraftlinie", "powerline.update_line", ["powerline.updated"]],
    ["kraftlinie", "powerline.create", ["powerline.created"]],
    ["nodix", "nodix.create", ["nodix.created"]],
    ["nodix", "nodix.move", ["nodix.moved"]],
    ["nodix", "nodix.retire", ["nodix.retired"]],
    ["nodix", "nodix.restore_series", ["nodix.moved"]],
    ["nodix", "nodix.restore_series", ["nodix.retired"]],
    ["nodix", "nodix.restore_series", ["nodix.restored"]],
    ["kraftlinie", "powerline.take_off_map", ["powerline.taken_off_map"]],
    ["kraftlinie", "powerline.put_on_map", ["powerline.put_on_map"]],
    ["kraftlinie", "powerline.retire", ["powerline.retired"]],
    ["kraftlinie", "powerline.restore", ["powerline.restored"]],
    ["kraftlinie", "powerline.restore_series", ["powerline.updated"]],
    ["flaeche", "landscape.update", ["region.updated"]],
    ["flaeche", "landscape.restore_series", ["region.updated"]],
    ["flaeche", "traeger.sources", ["region.sources_changed"]],
    ["flaeche", "landscape.restore_series", ["region.updated", "region.sources_changed"]],
    ["flaeche", "landscape.restore", ["region.restored"]],
    ["flaeche", "landscape.retire", ["region.retired"]],
    ["flaeche", "landscape.batch", ["area.reshaped"]],
    ["flaeche", "landscape.boolean", ["area.boolean"]],
    ["flaeche", "landscape.parts", ["area.parts"]],
    ["flaeche", "landscape.split", ["area.split"]],
    ["flaeche", "landscape.copy", ["area.copied"]],
    ["flaeche", "landscape.merge", ["area.merged"]],
    // WI-0265 B8c: Anlegen (Fläche samt Teilfläche, Beschriftung, Gipfel und Landmarke) und das Löschen einer Beschriftung.
    ["flaeche", "landscape.create", ["region.created", "area.created"]],
    ["flaeche", "label.create", ["label.created"]],
    ["flaeche", "label.retire", ["label.retired"]],
    ["flaeche", "peak.create", ["peak.created"]],
    ["flaeche", "peak.update", ["peak.updated"]],
    ["flaeche", "peak.restore_series", ["peak.updated"]],
    ["flaeche", "peak.retire", ["peak.retired"]],
    ["flaeche", "peak.restore", ["peak.restored"]],
    // WI-0265 B8c: Anlegen einer Sprache (auch mit Wiki-Artikeln, die sie einer anderen nahm) und einer Teilfläche, und die Kopie einer Fläche der Derographie.
    ["sprache", "sprache.create", ["sprache.created"]],
    ["sprache", "sprache.create", ["sprache.created", "sprache.wiki_changed"]],
    ["sprache", "sprache_flaeche.create", ["sprache_flaeche.created"]],
    ["sprache", "sprache.flaeche_aus_landschaft", ["sprache_flaeche.copied"]],
    ["sprache", "sprache.flaeche_aus_landschaft", ["sprache.created", "sprache_flaeche.copied"]],
    ["sprache", "sprache.update", ["sprache.updated"]],
    ["sprache", "sprache.wiki", ["sprache.wiki_changed"]],
    ["sprache", "sprache.retire", ["sprache.retired"]],
    ["sprache", "sprache.restore", ["sprache.restored"]],
    ["sprache", "sprache.restore_series", ["sprache.updated"]],
    ["sprache", "sprache_flaeche.reshape", ["sprache_flaeche.reshaped"]],
    ["sprache", "sprache_flaeche.parts", ["sprache_flaeche.parts"]],
    ["sprache", "sprache_flaeche.split", ["sprache_flaeche.split"]],
    ["sprache", "sprache_flaeche.boolean", ["sprache_flaeche.boolean"]],
    ["sprache", "sprache_flaeche.copy", ["sprache_flaeche.copied"]],
    ["sprache", "sprache_flaeche.retire", ["sprache_flaeche.retired"]],
    ["sprache", "sprache_flaeche.restore", ["sprache_flaeche.restored"]],
    // WI-0265 B8d: das Anlegen von Quelle, Werk, Korpus und Vorkommen (Stilllegen), auch ein Eintrag aus „Regeln als Text“.
    ["quelle", "source.create", ["source.created"]],
    ["werk", "work.create", ["work.created"]],
    ["korpus", "corpus.create", ["corpus.created"]],
    ["vorkommen", "lore.create", ["lore.created"]],
    ["vorkommen", "lore.rules_text", ["lore.rules_text", "lore.created"]],
    ["quelle", "source.update", ["source.updated"]],
    ["quelle", "source.update", ["source.updated", "path.sources_changed"]],
    ["quelle", "source.restore_series", ["source.updated"]],
    ["werk", "work.update", ["work.updated"]],
    ["werk", "work.restore_series", ["work.updated"]],
    ["korpus", "corpus.update", ["corpus.updated"]],
    ["korpus", "corpus.restore_series", ["corpus.updated"]],
    ["vorkommen", "lore.update", ["lore.updated"]],
    ["vorkommen", "lore.rules_text", ["lore.rules_text"]],
    ["vorkommen", "lore.restore_series", ["lore.updated"]],
    // WI-0265 B8d: die Wiki-Box der sechs Arten (Zuweisen, Entfernen, je mit der Rücknahme davon).
    ["wikibox", "wikibox.zuweisen", ["place.wiki_zugewiesen"]],
    ["wikibox", "wikibox.zuweisen", ["path.wiki_zugewiesen", "path.wiki_zugewiesen"]],
    ["wikibox", "wikibox.zuweisen", ["territory.wiki_zugewiesen"]],
    ["wikibox", "wikibox.zuweisen", ["region.wiki_zugewiesen"]],
    ["wikibox", "wikibox.zuweisen", ["powerline.wiki_zugewiesen", "powerline.wiki_zugewiesen"]],
    ["wikibox", "wikibox.zuweisen", ["peak.wiki_zugewiesen"]],
    ["wikibox", "wikibox.entfernen", ["place.wiki_entfernt"]],
    ["wikibox", "wikibox.restore_series", ["place.wiki_zugewiesen"]],
    ["wikibox", "wikibox.restore_series", ["path.wiki_entfernt", "path.wiki_entfernt"]],
    // WI-0300: die weiteren Artikel eines Wegs, je Abschnitt ein Eintrag, und ihre Rücknahme.
    ["wikibox", "wikibox.weitere_zuweisen", ["path.wiki_weitere_zugewiesen", "path.wiki_weitere_zugewiesen"]],
    ["wikibox", "wikibox.weitere_entfernen", ["path.wiki_weitere_entfernt"]],
    ["wikibox", "wikibox.restore_series", ["path.wiki_weitere_zugewiesen"]],
    // WI-0265 B8d: die Übernahmen des WikiSync (Quelle `wikisync`); ihre Rücknahme hat der WikiSync selbst.
    ["wikisync", "wikisync.uebernehmen", ["place.wikisync_uebernommen"]],
    ["wikisync", "lore.rules_wikisync", ["lore.rules_wikisync"]],
    // WI-0265 B8e: die Rücknahmen des WikiSync, der Sync eines Objekts (Wiki-Box) und die Zuweisung einer Fläche.
    ["wikisync", "wikisync.zuruecknehmen", ["place.wikisync_zurueckgenommen"]],
    ["wikisync", "lore.rules_wikisync_undo", ["lore.rules_wikisync_undo"]],
    ["wikisync", "lore.rules_wikisync_redo", ["lore.rules_wikisync_redo"]],
    ["wikisync", "wikisync.objekt_sync", ["place.wikisync_uebernommen"]],
    ["wikisync", "wikisync.objekt_zuruecknehmen", ["place.wikisync_zurueckgenommen"]],
    ["wikisync", "wikisync.flaeche_zuweisen", ["region.wiki_zugewiesen"]],
    // WI-0265 B8e2: die Rücknahme der Zuweisung und deren Wiederherstellung.
    ["wikisync", "wikisync.flaeche_zuruecknehmen", ["region.wiki_entfernt"]],
    ["wikisync", "wikisync.flaeche_wiederherstellen", ["region.wiki_zugewiesen"]],
    // „In Landmarke umwandeln …“ und seine Rücknahme (WI-0271 L8).
    ["umwandlung", "landmarke.umwandeln", ["place.in_landmarke", "peak.aus_ort"]],
    ["umwandlung", "landmarke.restore_series", ["place.aus_landmarke", "peak.zum_ort"]],
    // „Nicht auf die Karte“ an einem Landmarken-Kandidaten und zurück (WI-0271 L7): einander die Rücknahme.
    ["wikisync", "wikisync.landmarke_unterdruecken", ["landmarke_artikel.unterdrueckt"]],
    ["wikisync", "wikisync.landmarke_anbieten", ["landmarke_artikel.angeboten"]],
];

/** Operationen, die KEIN Adapter zurücknimmt (Anlegen der übrigen Arten, Inhalte, Betreiberläufe …), mit Aktionen, die ihre Schreibwege hinterlassen. Ort und Weg: seit WI-0265 B8a, Fläche, Gipfel und Sprache: seit B8c oben. */
const ARTEN: readonly (readonly [operation: string, aktionen: readonly string[]])[] = [
    // Betreiberläufe (WI-0265 B8c): `area.gebirge_startwerte` schreibt das Gebirge als Agent mit Freigabe und eigenem Rückweg (`--zurueckspielen`), kein Handgriff eines Editors.
    ["area.gebirge_startwerte", ["area.gebirge"]],
    // Die Inhalte (WI-0254): Quelle, Werk und Korpus sind seit B6g1, das Vorkommen seit B6g2, die Quellen am Träger seit B6g3 und ihr Anlegen seit B8d rücknehmbar (oben).
];

describe("Katalog der Arten (WI-0265 B6f)", () => {
    it("🔴 jedes Beispiel einer rücknehmbaren Operation steht im Katalog UND wird von dem Adapter seiner Familie angenommen", () => {
        for (const [familie, operation, aktionen] of BEISPIELE) {
            expect([operation, istRuecknehmbareOperation(operation)]).toEqual([operation, true]);
            expect([operation, ADAPTER[familie]!.pruefeArt(operation, aktionen)]).toEqual([operation, { ok: true }]);
        }
    });

    it("🔴 der Katalog führt keinen Namen ohne Beispiel: Jede Operation darin hat einen Adapter, der sie annimmt (kein ↺, das immer ablehnt)", () => {
        const belegt = new Set(BEISPIELE.map(([, operation]) => operation));
        expect(RUECKNEHMBARE_OPERATIONEN_LISTE.filter((operation) => !belegt.has(operation))).toEqual([]);
        expect([...belegt].filter((operation) => !istRuecknehmbareOperation(operation))).toEqual([]);
        // Und die Familien des Katalogs sind genau die der Adapter.
        expect(Object.keys(RUECKNEHMBARE_OPERATIONEN).sort()).toEqual(Object.keys(ADAPTER).sort());
        for (const [familie, menge] of Object.entries(RUECKNEHMBARE_OPERATIONEN))
            for (const operation of menge)
                expect(
                    [operation, BEISPIELE.some(([f, o]) => f === familie && o === operation)],
                    `${operation} in ${familie}`,
                ).toEqual([operation, true]);
    });

    it("🔴 Anlegen eines Orts oder Wegs, Weg teilen, Abnehmen, die Inhalte und die Betreiberläufe stehen in keiner Menge, und KEIN Adapter nimmt sie an (Grund art)", () => {
        for (const [operation, aktionen] of ARTEN) {
            expect([operation, istRuecknehmbareOperation(operation)]).toEqual([operation, false]);
            for (const [familie, adapter] of Object.entries(ADAPTER))
                expect([familie, operation, adapter.pruefeArt(operation, aktionen)]).toEqual([
                    familie,
                    operation,
                    { ok: false, reason: "art" },
                ]);
        }
    });

    it("🔴 B8d, B8e: der WikiSync führt die Übernahmen, ihre Rücknahmen, den Sync eines Objekts und die Zuweisung einer Fläche; die Rücknahme der Zuweisung und ihre Wiederherstellung (B8e2) sind dabei, das Recht folgt der Art (Verwaltung `undo_wikisync_run`, Editor `edit_map_objects`)", () => {
        expect([...WIKISYNC_OPERATIONEN].sort()).toEqual([
            "lore.rules_wikisync",
            "lore.rules_wikisync_redo",
            "lore.rules_wikisync_undo",
            "wikisync.flaeche_wiederherstellen",
            "wikisync.flaeche_zuruecknehmen",
            "wikisync.flaeche_zuweisen",
            "wikisync.landmarke_anbieten",
            "wikisync.landmarke_unterdruecken",
            "wikisync.objekt_sync",
            "wikisync.objekt_zuruecknehmen",
            "wikisync.uebernehmen",
            "wikisync.zuruecknehmen",
        ]);
        for (const operation of ["wikisync.region_zuweisen"]) {
            expect([operation, istRuecknehmbareOperation(operation)]).toEqual([operation, false]);
            expect([operation, WIKISYNC_ADAPTER.pruefeArt(operation, [])]).toEqual([
                operation,
                { ok: false, reason: "art" },
            ]);
        }
        for (const operation of WIKISYNC_OPERATIONEN)
            expect([operation, WIKISYNC_ADAPTER.pruefeArt(operation, [])]).toEqual([operation, { ok: true }]);
        expect(WIKISYNC_ADAPTER.recht("wikisync.uebernehmen", [])).toBe("undo_wikisync_run");
        expect(WIKISYNC_ADAPTER.recht("lore.rules_wikisync_undo", [])).toBe("undo_wikisync_run");
        expect(WIKISYNC_ADAPTER.recht("wikisync.objekt_sync", [])).toBe("edit_map_objects");
        expect(WIKISYNC_ADAPTER.recht("wikisync.flaeche_zuweisen", [])).toBe("edit_map_objects");
        expect(WIKISYNC_ADAPTER.recht("wikisync.flaeche_zuruecknehmen", [])).toBe("edit_map_objects");
        expect(WIKISYNC_ADAPTER.recht("wikisync.flaeche_wiederherstellen", [])).toBe("edit_map_objects");
        expect(WIKISYNC_ADAPTER.recht("wikisync.landmarke_unterdruecken", [])).toBe("edit_map_objects");
        expect(WIKISYNC_ADAPTER.recht("wikisync.landmarke_anbieten", [])).toBe("edit_map_objects");
        // Eine Operation des WikiSync ist nie Mitglied einer Serie (Quelle `wikisync`, nicht `editor`).
        expect(koenntMitgliedSein({ source: "wikisync", personId: "p", action: "wikisync.uebernehmen" })).toBe(false);
    });

    it("🔴 B8d: die Einzeleinträge (Wiki-Box) sind rücknehmbar, aber nie Mitglied einer Serie; die Wiki-Box nimmt nur ihre eigenen Aktionen an, kein anderer Adapter sie", () => {
        for (const operation of EINZEL_OPERATIONEN) {
            expect(istRuecknehmbareOperation(operation)).toBe(true);
            expect(koenntMitgliedSein({ source: "editor", personId: "p", action: operation })).toBe(false);
        }
        expect(koenntMitgliedSein({ source: "editor", personId: "p", action: "place.update" })).toBe(true);
        expect(WIKIBOX_ADAPTER.pruefeArt("wikibox.zuweisen", ["place.updated"])).toEqual({ ok: false, reason: "art" });
        expect(WIKIBOX_ADAPTER.pruefeArt("place.update", ["place.wiki_zugewiesen"])).toEqual({
            ok: false,
            reason: "art",
        });
        expect(WIKIBOX_ADAPTER.pruefeArt("wikibox.zuweisen", [])).toEqual({ ok: false, reason: "art" });
        expect(WIKIBOX_ADAPTER.recht("wikibox.zuweisen", ["place.wiki_zugewiesen"])).toBe("edit_map_objects");
        for (const [familie, adapter] of Object.entries(ADAPTER))
            if (familie !== "wikibox")
                expect([familie, adapter.pruefeArt("wikibox.zuweisen", ["place.wiki_zugewiesen"])]).toEqual([
                    familie,
                    { ok: false, reason: "art" },
                ]);
    });

    it("🔴 B6g3: eine Änderung der Quelle, die auch die Straße eines Wegs berührt (`path.sources_changed`), ist rücknehmbar; `path.sources_changed` allein unter `source.update` und die Aktionen einer anderen Art sind es nicht", () => {
        expect(QUELLE_ADAPTER.pruefeArt("source.update", ["source.updated"])).toEqual({ ok: true });
        expect(QUELLE_ADAPTER.pruefeArt("source.update", ["source.updated", "path.sources_changed"])).toEqual({
            ok: true,
        });
        expect(QUELLE_ADAPTER.pruefeArt("source.update", ["path.sources_changed"])).toEqual({
            ok: false,
            reason: "art",
        });
        expect(QUELLE_ADAPTER.pruefeArt("source.update", ["source.updated", "place.sources_changed"])).toEqual({
            ok: false,
            reason: "art",
        });
        expect(QUELLE_ADAPTER.recht("source.update", ["source.updated", "path.sources_changed"])).toBe(
            "manage_sources",
        );
        // Ein Werk oder Korpus nimmt nur seine eigene Aktion an, eine Quelle nicht die des Werks.
        expect(WERK_ADAPTER.pruefeArt("work.update", ["source.updated"])).toEqual({ ok: false, reason: "art" });
        expect(KORPUS_ADAPTER.pruefeArt("corpus.update", ["work.updated"])).toEqual({ ok: false, reason: "art" });
        expect(QUELLE_ADAPTER.pruefeArt("source.update", [])).toEqual({ ok: false, reason: "art" });
    });

    it("🔴 B6g2/B8d: eine Übernahme von „Regeln als Text“ ist rücknehmbar, ob sie nur Regeln an bestehenden Einträgen oder auch einen Eintrag anlegte (`lore.created`)", () => {
        expect(VORKOMMEN_ADAPTER.pruefeArt("lore.rules_text", ["lore.rules_text", "lore.rules_text"])).toEqual({
            ok: true,
        });
        expect(VORKOMMEN_ADAPTER.pruefeArt("lore.rules_text", ["lore.rules_text", "lore.created"])).toEqual({
            ok: true,
        });
        // Das Anlegen schreibt genau `created`: unter `lore.create` nur diese Aktion, nie `lore.updated`.
        expect(VORKOMMEN_ADAPTER.pruefeArt("lore.create", ["lore.created"])).toEqual({ ok: true });
        expect(QUELLE_ADAPTER.pruefeArt("source.create", ["source.created", "path.sources_changed"])).toEqual({
            ok: false,
            reason: "art",
        });
        expect(WERK_ADAPTER.pruefeArt("work.create", ["source.created"])).toEqual({ ok: false, reason: "art" });
        expect(KORPUS_ADAPTER.pruefeArt("corpus.create", ["corpus.created"])).toEqual({ ok: true });
        // Was der WikiSync schreibt, hat einen eigenen Namen und eine eigene Quelle; eine fremde Aktion unter `lore.update` gehört nicht dazu.
        expect(VORKOMMEN_ADAPTER.pruefeArt("lore.rules_wikisync", ["lore.rules_wikisync"])).toEqual({
            ok: false,
            reason: "art",
        });
        expect(VORKOMMEN_ADAPTER.pruefeArt("lore.update", ["source.updated"])).toEqual({ ok: false, reason: "art" });
        expect(VORKOMMEN_ADAPTER.pruefeArt("lore.update", [])).toEqual({ ok: false, reason: "art" });
        expect(VORKOMMEN_ADAPTER.recht("lore.update", ["lore.updated"])).toBe("manage_sources");
    });

    it("🔴 B6g3: `traeger.sources` gehört zur Familie seines Trägers: Jeder Adapter nimmt nur die Aktion seiner Art an, nie die eines anderen Trägers, nie die Felder darunter", () => {
        const aktion: Readonly<Record<string, string>> = {
            ort: "place.sources_changed",
            gebiet: "territory.sources_changed",
            flaeche: "region.sources_changed",
            weg: "path.sources_changed",
        };
        for (const [familie, eigene] of Object.entries(aktion)) {
            expect([familie, ADAPTER[familie]!.pruefeArt("traeger.sources", [eigene])]).toEqual([
                familie,
                { ok: true },
            ]);
            // Die Felder des Orts, des Gebiets … stehen nicht unter dem Namen der Quellen.
            expect(
                ADAPTER[familie]!.pruefeArt("traeger.sources", [eigene.replace("sources_changed", "updated")]),
            ).toEqual({ ok: false, reason: "art" });
            for (const [andere, fremde] of Object.entries(aktion))
                if (andere !== familie)
                    expect([familie, fremde, ADAPTER[familie]!.pruefeArt("traeger.sources", [fremde])]).toEqual([
                        familie,
                        fremde,
                        { ok: false, reason: "art" },
                    ]);
        }
        // Die übrigen Familien kennen die Quellen am Träger nicht.
        for (const familie of ["kraftlinie", "sprache", "werk", "korpus", "vorkommen"])
            for (const eigene of Object.values(aktion))
                expect(ADAPTER[familie]!.pruefeArt("traeger.sources", [eigene])).toEqual({ ok: false, reason: "art" });
    });

    it("🔴 B6g3: das Recht der Quellen ist `manage_sources`, das der Felder das bisherige; eine Rücknahme von Feldern UND Quellen verlangt beide", () => {
        expect(ORT_ADAPTER.recht("traeger.sources", ["place.sources_changed"])).toBe("manage_sources");
        expect(ORT_ADAPTER.recht("place.update", ["place.updated"])).toBe("edit_map_objects");
        expect(ORT_ADAPTER.recht("place.restore_series", ["place.updated", "place.sources_changed"])).toEqual([
            "edit_map_objects",
            "manage_sources",
        ]);
        expect(GEBIET_ADAPTER.recht("traeger.sources", ["territory.sources_changed"])).toBe("manage_sources");
        // Seit WI-0279 (Fachrechte nach Gebiet, Landschaft und Weg) heißt das Recht der Felder `edit_territories`, nicht mehr `edit_map_objects`.
        expect(
            GEBIET_ADAPTER.recht("territory.restore_series", ["territory.updated", "territory.sources_changed"]),
        ).toEqual(["edit_territories", "manage_sources"]);
        expect(WEG_ADAPTER.recht("traeger.sources", ["path.sources_changed"])).toBe("manage_sources");
        expect(WEG_ADAPTER.recht("path.restore_series", ["path.updated", "path.sources_changed"])).toEqual([
            "edit_map_objects",
            "manage_sources",
        ]);
        expect(FLAECHE_ADAPTER.recht("traeger.sources", ["region.sources_changed"])).toBe("manage_sources");
        expect(FLAECHE_ADAPTER.recht("landscape.restore_series", ["region.updated", "region.sources_changed"])).toEqual(
            ["edit_landscapes", "manage_sources"],
        );
    });

    it("🔴 B8a: Ort und Weg anlegen, Ort von der Karte nehmen, wiederherstellen, Mehrfachbearbeitung und Weg teilen stehen im Katalog; nutzlastabhängige Grenzfälle lehnt der Adapter mit art ab", () => {
        for (const operation of [
            "place.create",
            "place.take_off_map",
            "place.restore",
            "place.sammel",
            "path.create",
            "path.split",
        ])
            expect([operation, istRuecknehmbareOperation(operation)]).toEqual([operation, true]);
        const ablehnen: readonly (readonly [RuecknahmeAdapter, string, readonly string[]])[] = [
            // Zwei Orte in einem Anlegen, oder das Anlegen zusammen mit einer fremden Aktion.
            [ORT_ADAPTER, "place.create", ["place.created", "place.created"]],
            [ORT_ADAPTER, "place.update", ["place.created", "place.deleted"]],
            [ORT_ADAPTER, "place.create", ["place.updated"]],
            // Wiederherstellen, Abnehmen und Setzen nehmen nur ihre eigene Aktion an; ein Setzen ist genau EIN Eintrag.
            [ORT_ADAPTER, "place.restore_series", ["place.restored", "place.updated"]],
            [ORT_ADAPTER, "place.take_off_map", ["place.placed"]],
            [ORT_ADAPTER, "place.move", ["place.placed", "place.placed"]],
            [ORT_ADAPTER, "place.delete", ["place.restored"]],
            // Teilen: genau ein verkürzter und ein neuer Teil; unter einem fremden Namen und mit zwei neuen Teilen nicht.
            [WEG_ADAPTER, "path.split", ["path.split"]],
            [WEG_ADAPTER, "path.split", ["path.created", "path.created"]],
            [WEG_ADAPTER, "path.update", ["path.split", "path.created"]],
            // Das Zusammenlegen (path.merged) ist nur die Rücknahme des Teilens, nie eine Operation für sich, und immer mit zwei Teilen.
            [WEG_ADAPTER, "path.split", ["path.merged", "path.merged"]],
            [WEG_ADAPTER, "path.restore_series", ["path.merged"]],
            // B8a2: die Rücknahmen von Verbinden und Umgruppieren nur unter dem Namen der Rücknahme, die Verbindung mit mindestens zwei Abschnitten, die Gegenrichtung der Umgruppierung nie unter dem Original.
            [WEG_ADAPTER, "path.update", ["path.joined", "path.joined"]],
            [WEG_ADAPTER, "path.restore_series", ["path.joined"]],
            [WEG_ADAPTER, "path.regroup", ["path.regrouped_again"]],
            [WEG_ADAPTER, "path.restore_series", ["path.regrouped", "path.regrouped_again"]],
            // WI-0310: die Gegenrichtung des Straßen-Assistenten nie unter dem Original, keine Mischung der Richtungen.
            [WEG_ADAPTER, "path.assign_street", ["path.street_assigned_again"]],
            [WEG_ADAPTER, "path.restore_series", ["path.street_assigned", "path.street_assigned_again"]],
            [WEG_ADAPTER, "path.split", ["path.split", "path.created", "path.split"]],
            // Anlegen: genau ein Weg.
            [WEG_ADAPTER, "path.create", ["path.created", "path.created"]],
            [WEG_ADAPTER, "path.create", ["path.updated"]],
            // Felder mit Kurve: genau EINE Kurve, und nur die Aktionen der Felder und der Kurve.
            [WEG_ADAPTER, "path.update", ["path.updated", "path.reshaped", "path.reshaped"]],
            [WEG_ADAPTER, "path.update", ["path.updated", "path.reshaped", "path.deleted"]],
        ];
        for (const [adapter, operation, aktionen] of ablehnen)
            expect([adapter.familie, operation, aktionen, adapter.pruefeArt(operation, aktionen)]).toEqual([
                adapter.familie,
                operation,
                aktionen,
                { ok: false, reason: "art" },
            ]);
    });

    it("🔴 B8a: das Recht folgt der Vorwärtsoperation: Anlegen eines Orts mit Lage und eines Wegs beide Rechte, Abnehmen und Setzen die Lage, Wiederherstellen und Löschen das Sachrecht", () => {
        expect(ORT_ADAPTER.recht("place.create", ["place.created"], ["name", "subtype", "position"])).toEqual([
            "edit_map_objects",
            "edit_map_geometry",
        ]);
        // Ein neuer Ort ohne Lage (E16) berührt keine Geometrie.
        expect(ORT_ADAPTER.recht("place.create", ["place.created"], ["name", "subtype"])).toBe("edit_map_objects");
        expect(ORT_ADAPTER.recht("place.take_off_map", ["place.taken_off_map"])).toBe("edit_map_geometry");
        expect(ORT_ADAPTER.recht("place.move", ["place.placed"])).toBe("edit_map_geometry");
        expect(ORT_ADAPTER.recht("place.restore", ["place.restored"])).toBe("edit_map_objects");
        expect(ORT_ADAPTER.recht("place.restore_series", ["place.deleted"])).toBe("edit_map_objects");
        expect(ORT_ADAPTER.recht("place.sammel", ["place.updated", "place.updated"])).toBe("edit_map_objects");
        // Umgruppieren und ihre Gegenrichtung sind Sachsache; das Verbinden selbst (die Rücknahme davon) bleibt das Lagerecht.
        for (const aktion of [
            "path.regrouped",
            "path.regrouped_again",
            "path.street_assigned",
            "path.street_assigned_again",
        ])
            expect(WEG_ADAPTER.recht("path.restore_series", [aktion, aktion])).toBe("edit_map_objects");
        expect(WEG_ADAPTER.recht("path.assign_street", ["path.street_assigned"])).toBe("edit_map_objects");
        expect(WEG_ADAPTER.recht("path.join", ["path.joined", "path.joined"])).toBe("edit_map_geometry");
        for (const [operation, aktionen] of [
            ["path.create", ["path.created"]],
            ["path.split", ["path.split", "path.created"]],
            ["path.restore_series", ["path.merged", "path.merged"]],
            // B8a2: Die Rücknahme der Rücknahme von „Wege verbinden“ verbindet wieder (Sach- und Lagerecht, wie die Route).
            ["path.restore_series", ["path.joined", "path.joined"]],
            ["path.update", ["path.updated", "path.reshaped"]],
        ] as const)
            expect([operation, WEG_ADAPTER.recht(operation, aktionen)]).toEqual([
                operation,
                ["edit_map_objects", "edit_map_geometry"],
            ]);
    });

    it("die Liste für SQL ist der sortierte Auszug des Katalogs, ohne Dopplung", () => {
        const alle = Object.values(RUECKNEHMBARE_OPERATIONEN).flatMap((menge) => [...menge]);
        expect(RUECKNEHMBARE_OPERATIONEN_LISTE).toEqual([...new Set(alle)].sort());
        // `place.restore_series` & Co. stehen je Familie mehrfach (Felder und Verschieben), die Liste führt sie einmal.
        expect(RUECKNEHMBARE_OPERATIONEN_LISTE.filter((o) => o === "place.restore_series")).toHaveLength(1);
    });

    it("🪤 die wörtlich geführten Namen laufen nicht von ihren Schreibwegen weg: Wechsel des Stands (Weg, Kraftlinie) und Entfernen (Gebiet)", () => {
        const stand = [...WEG_STAND_OPERATIONEN].filter((operation) => operation !== "path.restore_series").sort();
        expect(stand).toEqual(Object.keys(WEG_WECHSEL).sort());
        const linie = [...KRAFTLINIE_STAND_OPERATIONEN]
            .filter((operation) => operation !== "powerline.restore_series")
            .sort();
        expect(linie).toEqual(Object.keys(POWERLINE_STATE_CHANGES).sort());
        expect([...GEBIET_ENTFERNEN_OPERATIONEN].sort()).toEqual([...ENTFERNEN_OPERATIONEN].sort());
    });
    it("🔴 B8b: Anlegen, Form und Zurückholen am Gebiet; ihr Recht ist das der Vorwärtsoperation, und eine Rücknahme aus Feldern UND Stilllegen geht nicht noch einmal zurück", () => {
        // Das Anlegen verlangt Sache und Form (seit WI-0279 `edit_territories` und `edit_territory_form`, ab Admin, Betreiber 2026-11-04); die Form ebenfalls (die Felder allein nur die Sache).
        expect(GEBIET_ADAPTER.recht("territory.create", ["territory.created", "territory_area.created"])).toEqual([
            "edit_territories",
            "edit_territory_form",
        ]);
        expect(GEBIET_ADAPTER.recht("territory_area.create", ["territory_area.created"])).toEqual([
            "edit_territories",
            "edit_territory_form",
        ]);
        expect(GEBIET_ADAPTER.recht("territory.update", ["territory.updated", "territory_area.reshaped"])).toEqual([
            "edit_territories",
            "edit_territory_form",
        ]);
        expect(GEBIET_ADAPTER.recht("territory.update", ["territory.updated"])).toBe("edit_territories");
        expect(GEBIET_ADAPTER.recht("territory.restore", ["territory.restored"])).toBe("edit_territory_form");
        // Das Anlegen nimmt nur seine eigenen Aktionen an.
        expect(GEBIET_ADAPTER.pruefeArt("territory.create", ["territory.created", "territory.updated"])).toEqual({
            ok: false,
            reason: "art",
        });
        expect(GEBIET_ADAPTER.pruefeArt("territory_area.create", ["territory.created"])).toEqual({
            ok: false,
            reason: "art",
        });
        // Die Rücknahme von Feldern und eines Stilllegens zugleich (B8b2): Sie ist rücknehmbar (Stand über `kehreEntfernenUm`, Felder über den Weg der Felder).
        const gemischt = (felder: string[], operation = "territory.restore_series", operationId = "m1", seq = 1) => ({
            operationId,
            seq,
            at: "2026-10-31T10:00:00.000Z",
            operation,
            source: "restore" as const,
            actor: { kind: "person" as const },
            status: "ruecknehmbar" as const,
            offen: true,
            gegenstaende: [
                {
                    kind: "territory" as const,
                    id: "g1",
                    action: "territory.updated",
                    revisionBefore: 1,
                    revisionAfter: 2,
                    felder,
                },
                {
                    kind: "territory_area" as const,
                    id: "f1",
                    action: "territory_area.retired",
                    revisionBefore: 1,
                    revisionAfter: 2,
                    felder: ["active"],
                },
            ],
        });
        expect(
            GEBIET_ADAPTER.pruefeArt("territory.restore_series", ["territory.updated", "territory_area.retired"]),
        ).toEqual({ ok: true });
        expect([...GEBIET_ADAPTER.pruefeListe!([gemischt(["name"])]).entries()]).toEqual([]);
        expect([...GEBIET_ADAPTER.pruefeListe!([gemischt(["parent", "parentOrigin"])]).entries()]).toEqual([]);
        // In einer Serie (mehrere Mitglieder) steht ein Entfernen oder Vereinigen, das nur ein Gebiet berührte; „Unter neues Obergebiet …“ und das Zurückholen gehen allein.
        const felder = { ...gemischt(["name"], "territory.update", "m2", 2), source: "editor" as const };
        const entfernt = (operation: string, seq: number) => ({
            ...gemischt([], operation, `e${String(seq)}`, seq),
            source: "editor" as const,
            gegenstaende: [
                {
                    kind: "territory" as const,
                    id: "g1",
                    action: "territory.retired",
                    revisionBefore: 1,
                    revisionAfter: 2,
                    felder: ["active"],
                },
            ],
        });
        const neben = (mitglied: ReturnType<typeof entfernt>) => [
            ...GEBIET_ADAPTER.pruefeListe!([
                { ...felder, gegenstaende: [felder.gegenstaende[0]!] },
                mitglied,
            ]).entries(),
        ];
        expect(neben(entfernt("territory.retire", 3))).toEqual([]);
        expect(neben(entfernt("territory.merge", 3))).toEqual([]);
        expect(neben(entfernt("territory.create_parent", 3))).toEqual([["e3", "art"]]);
        expect(neben(entfernt("territory.restore", 3))).toEqual([["e3", "art"]]);
        // Kraftlinie: das Anlegen ist eine Änderung der Linie, der Kraftlinienpunkt eine eigene Familie.
        expect(KRAFTLINIE_ADAPTER.recht("powerline.create", ["powerline.created"])).toBe("edit_map_geometry");
        expect(NODIX_ADAPTER.recht("nodix.move", ["nodix.moved"])).toBe("edit_map_geometry");
        expect(NODIX_ADAPTER.pruefeArt("nodix.move", ["nodix.moved", "powerline.updated"])).toEqual({
            ok: false,
            reason: "art",
        });
        expect(NODIX_ADAPTER.pruefeArt("powerline.update_line", ["nodix.moved"])).toEqual({
            ok: false,
            reason: "art",
        });
    });

    it("🔴 B8c: Fläche und Gipfel anlegen verlangt Sache und Lage, die Beschriftung nur die Sache, jede Sprachänderung `manage_sources`; ein Gipfelfeld, das der Adapter nicht kennt, schließt ein Anlegen aus", () => {
        // Seit WI-0279: Sache = `edit_landscapes`, Lage = `edit_landscape_form` (ab Admin, Betreiber 2026-11-04).
        expect(FLAECHE_ADAPTER.recht("landscape.create", ["region.created", "area.created"])).toEqual([
            "edit_landscapes",
            "edit_landscape_form",
        ]);
        expect(FLAECHE_ADAPTER.recht("peak.create", ["peak.created"])).toEqual([
            "edit_landscapes",
            "edit_landscape_form",
        ]);
        expect(FLAECHE_ADAPTER.recht("label.create", ["label.created"])).toBe("edit_landscapes");
        expect(FLAECHE_ADAPTER.recht("label.retire", ["label.retired"])).toBe("edit_landscapes");
        // Die Rücknahme des Anlegens ist ein Stilllegen: das Recht der Fläche, die von der Karte geht.
        expect(FLAECHE_ADAPTER.recht("landscape.restore_series", ["region.retired", "area.retired"])).toBe(
            "edit_landscape_form",
        );
        for (const operation of ["sprache.create", "sprache_flaeche.create", "sprache.flaeche_aus_landschaft"])
            expect(SPRACHE_ADAPTER.recht(operation, ["sprache.created"])).toBe("edit_languages");
        // Eine Anlage trägt nur ihre eigenen Aktionen: Die Aktionen einer anderen Art nimmt der Adapter der Sprache nicht an.
        expect(SPRACHE_ADAPTER.pruefeArt("sprache.create", ["region.created"])).toEqual({ ok: false, reason: "art" });
        expect(SPRACHE_ADAPTER.pruefeArt("sprache.create", [])).toEqual({ ok: false, reason: "art" });
        expect(FLAECHE_ADAPTER.pruefeArt("peak.create", ["territory.created"])).toEqual({ ok: false, reason: "art" });
        const gipfel = (felder: string[]) => ({
            operationId: "g1",
            seq: 1,
            at: "2026-10-31T10:00:00.000Z",
            operation: "peak.create",
            source: "editor" as const,
            actor: { kind: "person" as const },
            status: "ruecknehmbar" as const,
            offen: true,
            gegenstaende: [
                {
                    kind: "peak" as const,
                    id: "p1",
                    action: "peak.created",
                    revisionBefore: null,
                    revisionAfter: 1,
                    felder,
                },
            ],
        });
        expect([
            ...FLAECHE_ADAPTER.pruefeListe!([gipfel(["name", "subtype", "merkmale", "position", "active"])]).entries(),
        ]).toEqual([]);
        expect([...FLAECHE_ADAPTER.pruefeListe!([gipfel(["name", "ausdehnung"])]).entries()]).toEqual([["g1", "art"]]);
    });

    it("🔴 B8c: Betreiberläufe haben ihren eigenen Rückweg und stehen in keiner Familie (`area.gebirge_startwerte`: Sicherung und `--zurueckspielen`)", () => {
        expect([...SYSTEMLAUF_OPERATIONEN]).toEqual(["area.gebirge_startwerte"]);
        for (const operation of SYSTEMLAUF_OPERATIONEN) {
            expect([operation, istRuecknehmbareOperation(operation)]).toEqual([operation, false]);
            for (const menge of Object.values(RUECKNEHMBARE_OPERATIONEN)) expect(menge.has(operation)).toBe(false);
        }
    });
});
