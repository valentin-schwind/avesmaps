import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
    MapHistoryEntry,
    MapHistorySeries,
    RuecknahmeBody,
    RuecknahmeKonflikt,
    RuecknahmePruefung,
    RuecknahmeReceipt,
} from "@avesmaps3d/shared";
import {
    angebotEinzeln,
    angebotSerie,
    betroffenZeilen,
    folgenZeilen,
    konfliktGegenstand,
    gebietArt,
    konfliktZeilen,
    ortArt,
    ruecknahmeFamilie,
    ruecknahmeZiel,
    wegArt,
} from "../src/aenderungen/aenderung-ruecknahme";
import {
    createRuecknahmeDaten,
    ruecknahmeUrl,
    vorschauUrl,
    type Antwort,
    type RuecknahmeDaten,
} from "../src/aenderungen/aenderung-ruecknahme-daten";
import { createRuecknahme, type RuecknahmeOptionen } from "../src/aenderungen/aenderung-ruecknahme-steuerung";
import { konfliktFeldName } from "../src/aenderungen/aenderung-felder";
import { vorgangName, vorgangTafelSchluessel } from "../src/aenderungen/aenderung-vorgang";
import { gruppiere, type SerienZeile } from "../src/aenderungen/aenderung-modell";
import { setLocale, t, type MessageKey } from "../src/i18n/i18n";

/**
 * Das Zurücknehmen aus „Änderungen“ und dem Objektverlauf (WI-0265 B5c; Probierseite `review/wi-0265/aenderungen.html`, Szenen 2, 3, 6, 7; Testvertrag U4, U5, U6, U8, U12,
 * Gate 2). Ohne Bauteil und ohne Server: Das Modell sagt, wann ein ↺ angeboten wird und was an den Server geht; der Ablauf zeigt, was der Server sagt, und schreibt nie
 * eine halbe Rücknahme. Die Oberfläche selbst prüft der Browserfall `e2e/aenderungen-ruecknahme.spec.ts` gegen den echten Server.
 *
 * Problemfälle: Ein Klick auf „Gesamte Serie“ schickt nur die offenen Mitglieder oder alle ohne Prüfsumme; ein mittleres Mitglied wird angeboten und löscht eine spätere
 * Änderung; ein Konflikt schreibt trotzdem; ein Doppelklick schreibt zweimal; der Netzfehler erzeugt beim Wiederholen eine NEUE Kennung; eine Serie, die inzwischen
 * gewachsen ist, wird mit der alten Liste zurückgenommen; eine fremde Person wird ohne Grund zurückgenommen; die rohe Operation `path.reshape` steht in der Liste.
 */

const GEBIRGE = "b5c00000-0000-4000-8000-000000000001";
const FLAECHE = "b5c00000-0000-4000-8000-0000000000a1";
const ORT = "b5c00000-0000-4000-8000-000000000002";
const ORT2 = "b5c00000-0000-4000-8000-000000000003";
const WEG = "b5c00000-0000-4000-8000-0000000000e1";
const GIPFEL = "b5c00000-0000-4000-8000-0000000000f1";
const LABEL = "b5c00000-0000-4000-8000-0000000000b1";
const id = (n: number): string => `b5c0b5c0-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const gebirgsEintrag = (n: number, ueber: Partial<MapHistoryEntry> = {}): MapHistoryEntry => ({
    operationId: id(n),
    seq: n,
    at: `2026-10-31T10:${String(n).padStart(2, "0")}:00.000Z`,
    operation: "landscape.update",
    source: "editor",
    actor: { kind: "person", id: "p-vali", name: "Vali", self: true },
    objects: [
        {
            kind: "area",
            id: FLAECHE,
            name: "Blutzinnen",
            action: "area.gebirge",
            revisionBefore: n,
            revisionAfter: n + 1,
            changes: { gebirge: { omitted: true } },
        },
    ],
    status: "ruecknehmbar",
    ...ueber,
});
const ortEintrag = (n: number, operation: string, aktionen: string[], ueber: Partial<MapHistoryEntry> = {}) => ({
    ...gebirgsEintrag(n),
    operation,
    objects: aktionen.map((action, i) => ({
        kind: action.startsWith("path.") ? ("path" as const) : ("place" as const),
        id: action.startsWith("path.") ? WEG : i === 0 ? ORT : ORT2,
        name: action.startsWith("path.") ? "Reichsstraße" : "Gratenfels",
        action,
        revisionBefore: 1,
        revisionAfter: 2,
        changes: {},
    })),
    ...ueber,
});

/** Eine Serie aus `n` Mitgliedern des Gebirges, wie die Liste sie liefert: neueste zuerst, `series` je Mitglied, `meta` mit der Prüfsumme. */
function serie(n: number, ueber: Array<Partial<MapHistoryEntry>> = []) {
    const mitglieder = Array.from({ length: n }, (_, i) =>
        gebirgsEintrag(i + 1, { series: { id: id(1), position: i + 1, size: n }, ...ueber[i] }),
    ).reverse();
    const meta: MapHistorySeries = {
        id: id(1),
        size: n,
        delivered: n,
        members: mitglieder.map((m) => m.operationId).reverse(),
        membersHash: "a".repeat(64),
        scope: { kind: "landscape", id: GEBIRGE, name: "Blutzinnen" },
    };
    const zeilen = gruppiere(mitglieder, new Map([[meta.id, meta]]));
    return { mitglieder, meta, zeile: zeilen[0]! as Extract<(typeof zeilen)[number], { art: "serie" }> };
}

beforeEach(() => setLocale("de"));

describe("Vorgangsnamen: nie der rohe Schlüssel", () => {
    it("🔴 path.reshape, place.move und landscape.reshape heißen Kurve geändert, Verschoben und Form geändert", () => {
        expect(vorgangName("path.reshape")).toBe("Kurve geändert");
        expect(vorgangName("place.move")).toBe("Verschoben");
        expect(vorgangName("landscape.reshape")).toBe("Form geändert");
        expect(vorgangName("territory_area.reshape")).toBe("Form geändert");
        expect(vorgangName("landscape.restore_series")).toBe("Serie zurückgenommen");
        expect(vorgangName("place.delete")).toBe("Gelöscht");
        // Eine reine Änderung am Gebirge ist eine Änderung der Teilfläche, keine „Eigenschaften“ der Landschaft.
        expect(vorgangName("landscape.update", ["area.gebirge"])).toBe("Gebirge geändert");
        expect(vorgangName("landscape.update", ["region.updated"])).toBe("Eigenschaften geändert");
    });

    it("🔴 was die Tafel nicht kennt, fällt lesbar zurück: mit der Art, sonst nur „Änderung“ - nie mit dem Schlüssel", () => {
        expect(vorgangName("lore.rules_wikisync")).toBe("Änderung: Vorkommen");
        expect(vorgangName("zzz.irgendwas")).toBe("Änderung");
        expect(vorgangName("irgendwas")).toBe("Änderung");
        for (const operation of ["lore.rules_wikisync", "zzz.irgendwas", "irgendwas", "path.reshape"])
            expect(vorgangName(operation)).not.toContain(".");
    });

    it("jede Handlung der Server-Operationen (die der Liste) hat ihr Wort in der Tafel", () => {
        const handlungen = [
            "place.create",
            "place.update",
            "place.move",
            "place.delete",
            "place.restore",
            "place.take_off_map",
            "place.sammel",
            "path.update",
            "path.reshape",
            "path.split",
            "path.join",
            "path.regroup",
            "powerline.update_line",
            "landscape.update",
            "landscape.parts",
            "landscape.boolean",
            "landscape.batch",
            "landscape.copy",
            "landscape.merge",
            "territory.create_parent",
            "territory.display",
            "area.gebirge_startwerte",
            "traeger.sources",
            "site.add",
            "site.relate",
            "sprache.wiki",
            "nodix.move",
            "peak.retire",
            // WI-0265 B8c
            "landscape.create",
            "label.create",
            "label.retire",
            "peak.create",
            "sprache.create",
            "sprache_flaeche.create",
        ];
        for (const operation of handlungen) expect(vorgangTafelSchluessel(operation), operation).toBeDefined();
    });

    it("🔴 englisch ebenso (die Tafel gibt es in allen neun Sprachen)", () => {
        setLocale("en");
        expect(vorgangName("path.reshape")).toBe("Curve changed");
        expect(vorgangName("place.move")).toBe("Moved");
        expect(vorgangName("zzz.irgendwas")).toBe("Change");
    });
});

describe("Adresse und Angebot", () => {
    it("🔴 das Gebirge: die Landschaft nennt die Teilfläche am Gegenstand, sonst die Serie; seit B6c geht auch eine Operation mit Feldern daneben", () => {
        const e = gebirgsEintrag(1);
        expect(ruecknahmeFamilie(e)).toBe("landscape");
        // Eine ältere Antwort ohne `landscape` am Gegenstand und ohne Serie kennt die Adresse nicht.
        expect(ruecknahmeZiel(e)).toBeUndefined();
        expect(ruecknahmeZiel(e, { scope: { kind: "landscape", id: GEBIRGE } })).toEqual({
            familie: "landscape",
            id: GEBIRGE,
        });
        // Eine Operation, die neben dem Gebirge die Felder der Landschaft schrieb (seit B6c rücknehmbar), und die Rücknahme einer Serie.
        expect(
            ruecknahmeFamilie({
                ...e,
                objects: [...e.objects, { ...e.objects[0]!, kind: "landscape", id: GEBIRGE, action: "region.updated" }],
            }),
        ).toBe("landscape");
        expect(ruecknahmeFamilie({ ...e, operation: "landscape.restore_series" })).toBe("landscape");
        expect(ruecknahmeFamilie({ ...e, operation: "landscape.reshape" })).toBeUndefined();
    });

    it("🔴 B5d: eine EINZELNE Gebirgsänderung ohne Serie kennt ihre Landschaft aus dem Gegenstand und bietet das ↺ an", () => {
        const e = gebirgsEintrag(1);
        const mit: MapHistoryEntry = {
            ...e,
            objects: [{ ...e.objects[0]!, landscape: { id: GEBIRGE, name: "Blutzinnen" } }],
        };
        expect(ruecknahmeZiel(mit)).toEqual({ familie: "landscape", id: GEBIRGE });
        const angebot = angebotEinzeln(mit, ruecknahmeZiel(mit))!;
        expect(angebot).toMatchObject({
            modus: "einzeln",
            ziel: { familie: "landscape", id: GEBIRGE },
            mitglieder: [mit.operationId],
            offen: 1,
            sperre: undefined,
        });
        // Dieselbe Adresse wie die der Serie: Einzeleintrag und Serie rufen dieselbe Route.
        expect(ruecknahmeZiel(mit, { scope: { kind: "landscape", id: GEBIRGE } })).toEqual(ruecknahmeZiel(mit));
        // Das ↺ der Landschaft gehört nur zu Gebirgsänderungen: Eine andere Operation derselben Teilfläche bekommt es nicht.
        expect(ruecknahmeZiel({ ...mit, operation: "landscape.reshape" })).toBeUndefined();
    });

    it("🔴 B5d: jede einzelne Änderung am Ort (Felder, Verschieben, Löschen) hat ihr ↺ mit der Adresse des Orts", () => {
        const arten: [string, string[]][] = [
            ["place.update", ["place.updated"]],
            ["place.move", ["place.moved", "path.endpoint_moved"]],
            ["place.delete", ["place.deleted"]],
        ];
        for (const [operation, aktionen] of arten) {
            const e = ortEintrag(9, operation, aktionen);
            const angebot = angebotEinzeln(e, ruecknahmeZiel(e));
            expect(angebot, operation).toMatchObject({
                modus: "einzeln",
                ziel: { familie: "place", id: ORT },
                mitglieder: [e.operationId],
                sperre: undefined,
            });
        }
    });

    it("🔴 der Ort: Felder (auch die Mehrfachbearbeitung), EIN Verschieben samt Wegenden, EIN Löschen (auch mehrerer Orte), Anlegen, Wiederherstellen, Abnehmen und Setzen (WI-0265 B8a)", () => {
        expect(ortArt("place.update", ["place.updated"])).toBe("felder");
        expect(ortArt("place.move", ["place.moved", "path.endpoint_moved", "path.endpoint_moved"])).toBe("verschieben");
        expect(ortArt("place.move", ["place.moved", "place.moved"])).toBeUndefined();
        expect(ortArt("place.delete", ["place.deleted", "place.deleted"])).toBe("loeschen");
        expect(ortArt("place.create", ["place.created"])).toBe("anlegen");
        expect(ortArt("place.update", ["place.created", "place.updated"])).toBe("anlegen");
        expect(ortArt("place.create", ["place.created", "place.created"])).toBeUndefined();
        expect(ortArt("place.sammel", ["place.updated", "place.updated"])).toBe("felder");
        expect(ortArt("place.take_off_map", ["place.taken_off_map"])).toBe("abnehmen");
        expect(ortArt("place.restore_series", ["place.taken_off_map"])).toBe("abnehmen");
        expect(ortArt("place.move", ["place.placed"])).toBe("aufsetzen");
        expect(ortArt("place.restore_series", ["place.placed"])).toBe("aufsetzen");
        expect(ortArt("place.move", ["place.placed", "place.placed"])).toBeUndefined();
        expect(ortArt("place.restore", ["place.restored"])).toBe("wiederherstellen");
        expect(ortArt("place.restore_series", ["place.restored"])).toBe("wiederherstellen");
        // Die Rücknahme eines Anlegens oder Wiederherstellens stilllegt wie ein Löschen und lässt sich wie dieses zurücknehmen.
        expect(ortArt("place.restore_series", ["place.deleted"])).toBe("loeschen");
        expect(ortArt("place.delete", ["place.restored"])).toBeUndefined();
        for (const [operation, aktionen] of [
            ["place.create", ["place.created"]],
            ["place.restore", ["place.restored"]],
            ["place.take_off_map", ["place.taken_off_map"]],
            ["place.move", ["place.placed"]],
        ] as const) {
            const e = ortEintrag(9, operation, [...aktionen]);
            expect(ruecknahmeFamilie(e), operation).toBe("place");
            expect(ruecknahmeZiel(e), operation).toEqual({ familie: "place", id: ORT });
            expect(angebotEinzeln(e, ruecknahmeZiel(e))!.sperre, operation).toBeUndefined();
        }
        const loeschen = ortEintrag(5, "place.delete", ["place.deleted", "place.deleted"]);
        expect(ruecknahmeZiel(loeschen)).toEqual({ familie: "place", id: ORT });
    });

    it("🔴 eine Einzelrücknahme schickt genau eine Kennung, ohne Prüfsumme (die rechnet der Server)", () => {
        const e = ortEintrag(7, "place.update", ["place.updated"]);
        const angebot = angebotEinzeln(e, ruecknahmeZiel(e))!;
        expect(angebot).toMatchObject({
            modus: "einzeln",
            mitglieder: [e.operationId],
            membersHash: undefined,
            sperre: undefined,
        });
        // Ohne Adresse oder mit der falschen Familie gibt es kein Angebot.
        expect(angebotEinzeln(e, undefined)).toBeUndefined();
        expect(angebotEinzeln(e, { familie: "landscape", id: GEBIRGE })).toBeUndefined();
    });

    it("🔴 U5: in einer Serie geht einzeln nur das letzte offene Mitglied; die früheren sind gesperrt mit „überholt durch Schritt n“", () => {
        const { mitglieder, meta } = serie(4);
        const ziel = { familie: "landscape" as const, id: meta.scope.id };
        const neuestes = mitglieder[0]!;
        const mittleres = mitglieder[2]!; // Schritt 2
        expect(angebotEinzeln(neuestes, ziel, mitglieder)!.sperre).toBeUndefined();
        expect(angebotEinzeln(mittleres, ziel, mitglieder)!.sperre).toEqual({ art: "ueberholt", position: 3 });
        // Ist der spätere Schritt schon zurückgenommen, geht der frühere wieder (von hinten zurücknehmen).
        const zurueck = mitglieder.map((m) =>
            m.series!.position > 2 ? { ...m, status: "bereits_zurueckgenommen" as const } : m,
        );
        expect(angebotEinzeln(zurueck[2]!, ziel, zurueck)!.sperre).toBeUndefined();
    });

    it("zurückgenommen und nicht rücknehmbar sagt die Liste vorab", () => {
        const e = ortEintrag(7, "place.update", ["place.updated"], { status: "bereits_zurueckgenommen" });
        expect(angebotEinzeln(e, ruecknahmeZiel(e))!.sperre).toEqual({ art: "zurueck" });
        const q = ortEintrag(8, "place.update", ["place.updated"], { status: "nicht_ruecknehmbar" });
        expect(angebotEinzeln(q, ruecknahmeZiel(q))!.sperre).toEqual({ art: "quelle" });
    });

    it("🔴 B6f: nicht rücknehmbar mit Grund art (Anlegen, Inhalte …) sperrt ohne ↺-Grund der Quelle; Inhalte haben gar keine Adresse", () => {
        // Der Server führt die Art als `nicht_ruecknehmbar` mit Grund `art`: das ↺ fehlt (kein gesperrter Knopf), der Satz steht im Detail.
        const art = ortEintrag(9, "place.update", ["place.updated"], {
            status: "nicht_ruecknehmbar",
            statusReason: "art",
        });
        expect(angebotEinzeln(art, ruecknahmeZiel(art))!.sperre).toEqual({ art: "nichtArt" });
        expect(angebotEinzeln(art, ruecknahmeZiel(art))!.offen).toBe(0);
        // Ohne Grund (ältere Antwort) bleibt es bei der Quelle.
        const ohne = ortEintrag(10, "place.update", ["place.updated"], { status: "nicht_ruecknehmbar" });
        expect(angebotEinzeln(ohne, ruecknahmeZiel(ohne))!.sperre).toEqual({ art: "quelle" });
        // Eine Operation, die der Server nicht zurücknimmt (hier ein Betreiberlauf mit der Aktion einer Inhalte-Art; das Anlegen von Quelle, Werk, Korpus und Vorkommen seit B8d ja), gehört zu keiner Familie: keine Adresse, also kein Angebot und kein ↺.
        const quelle: MapHistoryEntry = {
            ...gebirgsEintrag(11),
            operation: "lore.import",
            status: "nicht_ruecknehmbar",
            statusReason: "art",
            objects: [
                {
                    kind: "lore",
                    id: id(500),
                    name: "Wiki Aventurica",
                    action: "lore.created",
                    revisionBefore: null,
                    revisionAfter: 1,
                    changes: {},
                },
            ],
        };
        expect(ruecknahmeFamilie(quelle)).toBeUndefined();
        expect(ruecknahmeZiel(quelle)).toBeUndefined();
        expect(angebotEinzeln(quelle, ruecknahmeZiel(quelle))).toBeUndefined();
    });

    it("🔴 B6f: eine Serie, deren Mitglieder alle Grund art tragen, sperrt als nichtArt; gemischt mit Quelle bleibt es die Quelle", () => {
        const ziel = { familie: "landscape" as const, id: GEBIRGE };
        const art = serie(2, [
            { status: "nicht_ruecknehmbar", statusReason: "art" },
            { status: "nicht_ruecknehmbar", statusReason: "art" },
        ]);
        expect(angebotSerie(art.zeile, ziel)!.sperre).toEqual({ art: "nichtArt" });
        const gemischt = serie(2, [
            { status: "nicht_ruecknehmbar", statusReason: "quelle" },
            { status: "nicht_ruecknehmbar", statusReason: "art" },
        ]);
        expect(angebotSerie(gemischt.zeile, ziel)!.sperre).toEqual({ art: "quelle" });
    });

    it("🔴 die ganze Serie: ALLE Mitglieder (auch die zurückgenommenen) mit der Prüfsumme der Liste; die Zahl zählt die offenen", () => {
        const { zeile, meta } = serie(8, [{ status: "bereits_zurueckgenommen" }]);
        const angebot = angebotSerie(zeile, { familie: "landscape", id: GEBIRGE })!;
        expect(angebot.modus).toBe("serie");
        expect(angebot.mitglieder).toEqual(meta.members);
        expect(angebot.mitglieder).toHaveLength(8);
        expect(angebot.membersHash).toBe(meta.membersHash);
        expect(angebot.offen).toBe(7);
        expect(angebot.sperre).toBeUndefined();
        // Ohne Prüfsumme der Serie (keine Meta) oder ohne Adresse bietet die Liste nichts an.
        expect(angebotSerie({ ...zeile, meta: undefined }, { familie: "landscape", id: GEBIRGE })).toBeUndefined();
        expect(angebotSerie(zeile, undefined)).toBeUndefined();
    });

    it("🔴 eine Serie am Ort, die mit dem Anlegen beginnt, geht als Ganzes zurück (auch mit Verschieben, Abnehmen und Setzen darin); ein Löschen darin sperrt (WI-0265 B8a)", () => {
        const eintraege = [
            ortEintrag(1, "place.create", ["place.created"], { series: { id: id(1), position: 1, size: 4 } }),
            ortEintrag(2, "place.update", ["place.updated"], { series: { id: id(1), position: 2, size: 4 } }),
            ortEintrag(3, "place.move", ["place.moved"], { series: { id: id(1), position: 3, size: 4 } }),
            ortEintrag(4, "place.update", ["place.updated"], { series: { id: id(1), position: 4, size: 4 } }),
        ];
        const meta: MapHistorySeries = {
            id: id(1),
            size: 4,
            delivered: 4,
            members: eintraege.map((m) => m.operationId),
            membersHash: "c".repeat(64),
            scope: { kind: "place", id: ORT },
        };
        const zeile = (liste: MapHistoryEntry[]) =>
            gruppiere([...liste].reverse(), new Map([[meta.id, meta]]))[0]! as Extract<
                ReturnType<typeof gruppiere>[number],
                { art: "serie" }
            >;
        const ziel = { familie: "place" as const, id: ORT };
        expect(angebotSerie(zeile(eintraege), ziel)!.sperre).toBeUndefined();
        // Ohne das Anlegen bleibt das Verschieben in der Serie gesperrt.
        expect(angebotSerie(zeile(eintraege.slice(1)), ziel)!.sperre).toEqual({ art: "art" });
        // Ein Löschen darin ginge nicht (der Ort wäre schon stillgelegt).
        const mitLoeschen = [
            eintraege[0]!,
            ortEintrag(2, "place.delete", ["place.deleted"], { series: { id: id(1), position: 2, size: 4 } }),
            eintraege[2]!,
            eintraege[3]!,
        ];
        expect(angebotSerie(zeile(mitLoeschen), ziel)!.sperre).toEqual({ art: "art" });
    });

    it("eine Serie am Ort sind nur Felder: ein Verschieben darin sperrt die Serie mit Grund „Art“; alle zurückgenommen sperrt ebenso", () => {
        const felder = [1, 2, 3].map((n) =>
            ortEintrag(n, "place.update", ["place.updated"], { series: { id: id(1), position: n, size: 3 } }),
        );
        const meta: MapHistorySeries = {
            id: id(1),
            size: 3,
            delivered: 3,
            members: felder.map((m) => m.operationId),
            membersHash: "b".repeat(64),
            scope: { kind: "place", id: ORT },
        };
        const zeile = (liste: MapHistoryEntry[]) =>
            gruppiere([...liste].reverse(), new Map([[meta.id, meta]]))[0]! as Extract<
                ReturnType<typeof gruppiere>[number],
                { art: "serie" }
            >;
        const ziel = { familie: "place" as const, id: ORT };
        expect(angebotSerie(zeile(felder), ziel)!.sperre).toBeUndefined();
        const mitVerschieben = [
            felder[0]!,
            ortEintrag(2, "place.move", ["place.moved"], { series: { id: id(1), position: 2, size: 3 } }),
            felder[2]!,
        ];
        expect(angebotSerie(zeile(mitVerschieben), ziel)!.sperre).toEqual({ art: "art" });
        const alleZurueck = felder.map((m) => ({ ...m, status: "bereits_zurueckgenommen" as const }));
        expect(angebotSerie(zeile(alleZurueck), ziel)!.sperre).toEqual({ art: "zurueck" });
    });
});

const pruefung = (ueber: Partial<RuecknahmePruefung> = {}): RuecknahmePruefung => ({
    ergebnis: "ok",
    membersHash: "c".repeat(64),
    mitglieder: [1, 2, 3].map((n) => ({
        operationId: id(n),
        seq: n,
        at: `2026-10-31T10:${String(n).padStart(2, "0")}:00.000Z`,
        operation: "landscape.update",
        source: "editor" as const,
        actor: { kind: "person" as const, id: "p-vali", name: "Vali" },
        status: "ruecknehmbar" as const,
        offen: true,
        gegenstaende: [
            {
                kind: "area" as const,
                id: FLAECHE,
                name: "Blutzinnen",
                action: "area.gebirge",
                revisionBefore: n,
                revisionAfter: n + 1,
                felder: ["gebirge"],
            },
        ],
        series: { id: id(1), position: n, size: 3 },
    })),
    offen: [id(1), id(2), id(3)],
    gegenstaende: [],
    konflikte: [],
    sperren: [],
    fehlendeRechte: [],
    fremdePersonen: [],
    reasonRequired: false,
    folgen: { gegenstaende: 1, gelaende: "lokal" },
    ...ueber,
});

const quittung = (ueber: Partial<RuecknahmeReceipt> = {}): RuecknahmeReceipt => ({
    operationId: id(99),
    status: "applied",
    environment: "development",
    affected: [{ kind: "area", id: FLAECHE, revision: 12 }],
    derivedWork: [],
    warnings: [],
    mapRevision: 77,
    reverts: [id(1), id(2), id(3)],
    ...ueber,
});

describe("Die Rückfrage: Mitglieder, Folgen, Konflikte", () => {
    it("🔴 die Rückfrage nennt genau die offenen Mitglieder, in der Folge der Serie, mit Schritt, Uhrzeit und Gegenstand", () => {
        const zeilen = betroffenZeilen(pruefung({ offen: [id(3), id(1)] }));
        expect(zeilen.map((z) => z.operationId)).toEqual([id(1), id(3)]);
        expect(zeilen[0]).toMatchObject({ titel: "Schritt 1/3: Gebirge geändert", gegenstaende: "Blutzinnen" });
        expect(zeilen[0]!.zeit).toMatch(/\d{2}:\d{2}/);
    });

    it("🔴 die Folgen: „Gelände wird neu berechnet“ (ein Lauf), oder ehrlich „veraltet“ ohne Lauf; Wegenden gemeinsam", () => {
        expect(folgenZeilen(pruefung())).toEqual([
            "Gelände wird neu berechnet: ein gemeinsamer Lauf für den ganzen Bereich.",
        ]);
        expect(folgenZeilen(pruefung({ folgen: { gegenstaende: 1, gelaende: "veraltet" } }))[0]).toContain(
            "bleibt veraltet",
        );
        expect(folgenZeilen(pruefung({ folgen: { gegenstaende: 0, gelaende: "keines" } }))).toEqual([]);
        const verschieben = pruefung({
            mitglieder: [
                {
                    ...pruefung().mitglieder[0]!,
                    operation: "place.move",
                    gegenstaende: [
                        {
                            kind: "place",
                            id: ORT,
                            action: "place.moved",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: [],
                        },
                        ...[WEG, id(500), id(501), id(502)].map((weg) => ({
                            kind: "path" as const,
                            id: weg,
                            action: "path.endpoint_moved",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: [],
                        })),
                    ],
                },
            ],
            offen: [id(1)],
            folgen: { gegenstaende: 5, gelaende: "keines" },
        });
        expect(folgenZeilen(verschieben)).toEqual(["Wegenden: 4, gemeinsam mit dem Ort oder gar nicht."]);
    });

    it("🔴 U6/Szene 6: die Konfliktliste nennt Gegenstand, Art, Person, Zeit und Felder - lesbar, nie als Schlüssel", () => {
        const zeilen = konfliktZeilen(
            [
                {
                    art: "spaeter",
                    kind: "area",
                    id: FLAECHE,
                    name: "Blutzinnen",
                    changedBy: { kind: "person", id: "p-thomas", name: "Thomas" },
                    changedAt: "2026-10-31T13:20:00.000Z",
                    operationId: id(40),
                    felder: ["maximalhoehe", "netz"],
                },
                { art: "wert", kind: "path", id: WEG, detail: "Flusshöhe" },
            ],
            konfliktFeldName,
        );
        // Die Spalten des Gebirges heißen wie im Reiter „Gebirge“, das Netz „Gezeichnete Kämme“.
        expect(zeilen[0]).toMatchObject({
            objekt: "Blutzinnen",
            art: "später geändert",
            satz: undefined,
            felder: "Felder: Höhe des Kamms, Gezeichnete Kämme",
        });
        expect(zeilen[0]!.von).toMatch(/^von Thomas, /u);
        // Ein deutscher Satz des Servers ohne `abweichung` erscheint nie sichtbar, nur als Hinweis beim Überfahren.
        expect(zeilen[1]).toMatchObject({
            objekt: "Weg",
            art: "Wert weicht ab",
            satz: undefined,
            hinweis: "Flusshöhe",
            von: undefined,
        });
        // „Konflikt prüfen“ öffnet beim Gebirge die Landschaft der Rücknahme, nicht die Teilfläche, die kein Fenster hat.
        expect(konfliktGegenstand({ kind: "area", id: FLAECHE }, { familie: "landscape", id: GEBIRGE })).toEqual({
            kind: "landscape",
            id: GEBIRGE,
        });
        expect(konfliktGegenstand({ kind: "path", id: WEG, name: "Weg" }, { familie: "place", id: ORT })).toEqual({
            kind: "path",
            id: WEG,
            name: "Weg",
        });
    });
});

describe("B5d: Konfliktmeldungen aus Schlüsseln und Sprachtafeln, nie ein Satz des Servers", () => {
    const wert = (ueber: Partial<RuecknahmeKonflikt>): RuecknahmeKonflikt => ({
        art: "wert",
        kind: "area",
        id: FLAECHE,
        name: "Blutzinnen",
        ...ueber,
    });
    const satz = (k: RuecknahmeKonflikt): string | undefined => konfliktZeilen([k], konfliktFeldName)[0]!.satz;

    it("🔴 Felder des Gebirges: Spaltennamen des Reiters statt des Schlüssels maximalhoehe", () => {
        const k = wert({
            felder: ["maximalhoehe", "einschnitt"],
            abweichung: { was: "felder" },
            detail: "Heute anders als nach dem letzten Schritt: maximalhoehe.",
        });
        const zeile = konfliktZeilen([k], konfliktFeldName)[0]!;
        expect(zeile.satz).toBe("Heute anders als nach dem letzten Schritt: Höhe des Kamms, Taltiefe.");
        expect(zeile.satz).not.toContain("maximalhoehe");
        // Der Satz nennt die Felder schon: Die Zeile „Felder: …“ steht nicht noch einmal da. Der deutsche Server-Satz bleibt Hinweis.
        expect(zeile.felder).toBeUndefined();
        expect(zeile.hinweis).toContain("maximalhoehe");
    });

    it("🔴 das Netz: „Gezeichnete Kämme“ mit den Teilen, die abweichen - in Worten, nie als Schlüssel", () => {
        expect(
            satz(
                wert({
                    felder: ["netz"],
                    abweichung: { was: "felder", netzTeile: ["kaemme", "mulden", "flussHoehen"] },
                }),
            ),
        ).toBe("Heute anders als nach dem letzten Schritt: Gezeichnete Kämme (Kämme, Mulden, Höhen an Flüssen).");
    });

    it("🔴 eine gewanderte Flusshöhe nennt die Ursache; weichen zugleich Felder ab, steht beides da", () => {
        expect(satz(wert({ felder: ["netz"], abweichung: { was: "flusshoehe" } }))).toBe(
            "Eine Flusshöhe ist seit dem ersten Schritt mit ihrem Weg gewandert.",
        );
        expect(
            satz(
                wert({
                    felder: ["maximalhoehe", "netz"],
                    abweichung: { was: "flusshoehe", netzTeile: ["flussHoehen"] },
                }),
            ),
        ).toBe(
            "Eine Flusshöhe ist seit dem ersten Schritt mit ihrem Weg gewandert. Heute anders als nach dem letzten Schritt: Höhe des Kamms, Gezeichnete Kämme (Höhen an Flüssen).",
        );
    });

    it("🔴 Ort und Wegenden: Lage in Zahlen, Satz aus der Tafel", () => {
        const ort = { kind: "place" as const, id: ORT, name: "Gratenfels" };
        expect(satz(wert({ ...ort, abweichung: { was: "ort_geloescht" } }))).toBe("Der Ort ist gelöscht.");
        expect(satz(wert({ ...ort, abweichung: { was: "ort_nicht_auf_karte" } }))).toBe(
            "Der Ort steht nicht mehr auf der Karte.",
        );
        expect(
            satz(
                wert({
                    ...ort,
                    abweichung: { was: "ort_lage", heute: { x: 412, y: 307.5 }, erwartet: { x: 405, y: 305 } },
                }),
            ),
        ).toBe("Der Ort liegt bei (412 | 307,5) statt bei (405 | 305).");
        const weg = { kind: "path" as const, id: WEG, name: "Reichsstraße" };
        expect(satz(wert({ ...weg, abweichung: { was: "weg_fehlt" } }))).toBe("Den Weg gibt es nicht mehr.");
        expect(
            satz(wert({ ...weg, abweichung: { was: "weg_anfang", heute: { x: 1, y: 2 }, erwartet: { x: 3, y: 4 } } })),
        ).toBe("Der Anfangspunkt des Wegs liegt bei (1 | 2) statt bei (3 | 4).");
        expect(
            satz(wert({ ...weg, abweichung: { was: "weg_ende", heute: { x: 1, y: 2 }, erwartet: { x: 3, y: 4 } } })),
        ).toBe("Der Endpunkt des Wegs liegt bei (1 | 2) statt bei (3 | 4).");
    });

    it("🔴 in allen neun Sprachen ein Satz ohne rohen Schlüssel und ohne deutschen Server-Satz", () => {
        const k = wert({
            felder: ["maximalhoehe", "netz"],
            abweichung: { was: "flusshoehe", netzTeile: ["kaemme"] },
            detail: "Heute anders als nach dem letzten Schritt: maximalhoehe.",
        });
        const deutsch = satz(k);
        expect(deutsch).toContain("Höhe des Kamms");
        for (const sprache of ["en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            const zeile = konfliktZeilen([k], konfliktFeldName)[0]!;
            expect(zeile.satz, sprache).toBeTruthy();
            expect(zeile.satz, sprache).not.toBe(deutsch);
            expect(zeile.satz, sprache).not.toMatch(/maximalhoehe|flussHoehen|kaemme|\{\w+\}/u);
            expect(zeile.satz, sprache).not.toContain("Heute anders");
        }
    });

    it("🔴 die Abweichung des Servers kommt auch aus der Antwort 409 edit_conflict", async () => {
        const d = daten(
            [ok(pruefung())],
            [
                fehler(409, "edit_conflict", "x", {
                    objects: [
                        {
                            kind: "area",
                            id: FLAECHE,
                            name: "Blutzinnen",
                            art: "wert",
                            felder: ["maximalhoehe"],
                            abweichung: { was: "felder" },
                            detail: "Heute anders als nach dem letzten Schritt: maximalhoehe.",
                        },
                    ],
                }),
            ],
        );
        const { s } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        await s.bestaetige();
        const stand = s.stand.value;
        expect(
            stand.art === "blockiert" && stand.blockade.art === "konflikt" && stand.blockade.konflikte[0],
        ).toMatchObject({
            abweichung: { was: "felder" },
            felder: ["maximalhoehe"],
        });
    });
});

/** Ein Server aus Antworten: jede Anfrage nimmt die nächste vorbereitete Antwort und merkt sich ihren Körper. */
function daten(vorschauen: Array<Antwort<RuecknahmePruefung>>, schreiben: Array<Antwort<RuecknahmeReceipt>>) {
    const log = { vorschau: [] as unknown[], schreiben: [] as RuecknahmeBody[] };
    const fake: RuecknahmeDaten = {
        vorschau: (_ziel, body) => {
            log.vorschau.push(body);
            return Promise.resolve(
                vorschauen.shift() ?? { ok: false, status: 500, fehler: { code: "leer", message: "leer" } },
            );
        },
        ruecknehmen: (_ziel, body) => {
            log.schreiben.push(body);
            return Promise.resolve(
                schreiben.shift() ?? { ok: false, status: 500, fehler: { code: "leer", message: "leer" } },
            );
        },
    };
    return { fake, log };
}
const ok = <Q>(wert: Q): Antwort<Q> => ({ ok: true, wert });
const fehler = (status: number, code: string, message = code, details?: Record<string, unknown>): Antwort<never> => ({
    ok: false,
    status,
    fehler: { code, message, ...(details === undefined ? {} : { details }) },
});

const SERIE_ANGEBOT = () => angebotSerie(serie(3).zeile, { familie: "landscape", id: GEBIRGE })!;

function steuerung(
    d: ReturnType<typeof daten>,
    ueber: Partial<RuecknahmeOptionen> = {},
): { s: ReturnType<typeof createRuecknahme>; neuLesen: ReturnType<typeof vi.fn>; fertig: ReturnType<typeof vi.fn> } {
    let n = 0;
    const neuLesen = vi.fn();
    const fertig = vi.fn();
    const s = createRuecknahme({
        daten: d.fake,
        neueKennung: () => id(900 + ++n),
        folge: { vormerke: () => undefined },
        neuLesen,
        zurueckgenommen: fertig,
        ...ueber,
    });
    return { s, neuLesen, fertig };
}

describe("Der Ablauf: Klick, Vorprüfung, Rückfrage, Rücknahme", () => {
    it("🔴 Szene 2: die Vorprüfung geht mit ALLEN Mitgliedern und der Prüfsumme der Serie; die Rückfrage steht, geschrieben ist noch nichts", async () => {
        const d = daten([ok(pruefung())], []);
        const { s } = steuerung(d);
        const angebot = SERIE_ANGEBOT();
        await s.starte(angebot);
        expect(d.log.vorschau).toEqual([{ members: angebot.mitglieder, membersHash: angebot.membersHash }]);
        expect(s.stand.value.art).toBe("fragt");
        expect(d.log.schreiben).toHaveLength(0);
    });

    it("🔴 U3: „Zurücknehmen“ schreibt EINE Rücknahme mit neuer Kennung, den Mitgliedern der Vorprüfung und deren Prüfsumme; danach Ergebnis und Nachziehen", async () => {
        const d = daten([ok(pruefung())], [ok(quittung())]);
        const { s, fertig } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        await s.bestaetige();
        expect(d.log.schreiben).toEqual([
            { operationId: id(901), members: [id(1), id(2), id(3)], membersHash: "c".repeat(64) },
        ]);
        expect(s.stand.value).toMatchObject({ art: "fertig", serie: true, wiederholt: false });
        expect(fertig).toHaveBeenCalledTimes(1);
    });

    it("🔴 Gate 2: bei einer fremden Person ist der Grund Pflicht; ohne ihn schreibt nichts, mit ihm steht er im Körper (getrimmt)", async () => {
        const d = daten(
            [
                ok(
                    pruefung({
                        reasonRequired: true,
                        fremdePersonen: [{ kind: "person", id: "p-thomas", name: "Thomas" }],
                    }),
                ),
            ],
            [ok(quittung())],
        );
        const { s } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        await s.bestaetige("   ");
        expect(d.log.schreiben).toHaveLength(0);
        expect(s.stand.value.art).toBe("fragt");
        await s.bestaetige("  Falsches Gebirge bearbeitet ");
        expect(d.log.schreiben[0]!.reason).toBe("Falsches Gebirge bearbeitet");
    });

    it("🔴 U6/Szene 6: ein Konflikt zeigt die Liste und schreibt NICHTS (keine Teilrücknahme); die Liste liest neu", async () => {
        const konflikt = {
            art: "spaeter" as const,
            kind: "area" as const,
            id: FLAECHE,
            name: "Blutzinnen",
            changedBy: { kind: "person" as const, id: "p-thomas", name: "Thomas" },
            changedAt: "2026-10-31T13:20:00.000Z",
            operationId: id(40),
        };
        const d = daten([ok(pruefung({ ergebnis: "edit_conflict", konflikte: [konflikt] }))], []);
        const { s, neuLesen } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        expect(s.stand.value).toMatchObject({ art: "blockiert", blockade: { art: "konflikt", konflikte: [konflikt] } });
        expect(d.log.schreiben).toHaveLength(0);
        expect(neuLesen).toHaveBeenCalled();
        // „Bestätigen“ ohne Rückfrage tut nichts.
        await s.bestaetige();
        expect(d.log.schreiben).toHaveLength(0);
    });

    it("🔴 ein Konflikt erst beim Schreiben (409 edit_conflict) zeigt dieselbe Liste aus den Einzelheiten der Antwort", async () => {
        const d = daten(
            [ok(pruefung())],
            [
                fehler(409, "edit_conflict", "x", {
                    objects: [
                        {
                            kind: "area",
                            id: FLAECHE,
                            name: "Blutzinnen",
                            art: "spaeter",
                            changedBy: { kind: "person", id: "p-thomas", name: "Thomas" },
                            changedAt: "2026-10-31T13:20:00.000Z",
                            operationId: id(40),
                            felder: ["gebirge"],
                        },
                    ],
                }),
            ],
        );
        const { s, neuLesen, fertig } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        await s.bestaetige();
        const stand = s.stand.value;
        expect(
            stand.art === "blockiert" && stand.blockade.art === "konflikt" && stand.blockade.konflikte[0],
        ).toMatchObject({
            kind: "area",
            name: "Blutzinnen",
            felder: ["gebirge"],
        });
        expect(neuLesen).toHaveBeenCalled();
        expect(fertig).not.toHaveBeenCalled();
    });

    it("🔴 Recht, Sperre, Quelle/Art: der Server sagt nein, nichts wird geschrieben; „kein Recht“ sperrt den Knopf", async () => {
        const gesperrt = daten(
            [
                ok(
                    pruefung({
                        ergebnis: "object_locked",
                        sperren: [
                            {
                                kind: "landscape",
                                id: GEBIRGE,
                                person: { id: "p-thomas", name: "Thomas" },
                                part: "felder",
                                since: "2026-10-31T13:00:00.000Z",
                            },
                        ],
                    }),
                ),
            ],
            [],
        );
        const eins = steuerung(gesperrt);
        await eins.s.starte(SERIE_ANGEBOT());
        expect(eins.s.stand.value).toMatchObject({ art: "blockiert", blockade: { art: "gesperrt" } });

        const verboten = daten([ok(pruefung({ ergebnis: "forbidden", fehlendeRechte: ["edit_map_geometry"] }))], []);
        const zwei = steuerung(verboten);
        await zwei.s.starte(SERIE_ANGEBOT());
        expect(zwei.s.verboten.value).toBe(true);
        expect(zwei.s.stand.value).toMatchObject({ blockade: { art: "verboten" } });

        const art = daten(
            [
                ok(
                    pruefung({
                        ergebnis: "not_revertable",
                        mitglieder: [{ ...pruefung().mitglieder[0]!, offen: false, ausschluss: { grund: "art" } }],
                    }),
                ),
            ],
            [],
        );
        const drei = steuerung(art);
        await drei.s.starte(SERIE_ANGEBOT());
        expect(drei.s.stand.value).toMatchObject({ blockade: { art: "nicht", grund: "art" } });
        expect([gesperrt, verboten, art].flatMap((x) => x.log.schreiben)).toHaveLength(0);
    });

    it("🔴 Szene 3: ist die Serie gewachsen (series_changed), fragt der Ablauf mit der NEUEN Liste noch einmal und sagt es", async () => {
        const neu = [id(1), id(2), id(3), id(4)];
        const d = daten(
            [
                ok(pruefung({ ergebnis: "series_changed", neueMitglieder: neu, neuerHash: "d".repeat(64) })),
                ok(pruefung({ membersHash: "d".repeat(64) })),
            ],
            [],
        );
        const { s, neuLesen } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        expect(d.log.vorschau[1]).toEqual({ members: neu, membersHash: "d".repeat(64) });
        expect(s.stand.value).toMatchObject({ art: "fragt", hinweis: "serieGewachsen" });
        expect(neuLesen).toHaveBeenCalled();
    });

    it("🔴 U8: eine bereits zurückgenommene Serie sagt es (wer, wann aus den Einzelheiten) und liest die Liste neu; nichts wird geschrieben", async () => {
        const d = daten(
            [ok(pruefung())],
            [
                fehler(409, "already_reverted", "x", {
                    revertedBy: [{ operationId: id(70), at: "2026-10-31T14:00:00.000Z" }],
                }),
            ],
        );
        const { s, neuLesen } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        await s.bestaetige();
        expect(s.stand.value).toMatchObject({
            art: "blockiert",
            blockade: { art: "schon", durch: { at: "2026-10-31T14:00:00.000Z" } },
        });
        expect(neuLesen).toHaveBeenCalled();
    });

    it("🔴 U8: Doppelklick schreibt nur einmal; ein Netzfehler erlaubt dieselbe Anfrage mit DERSELBEN Kennung (replayed), der nächste Klick eine neue", async () => {
        const d = daten(
            [ok(pruefung()), ok(pruefung())],
            [fehler(0, "network_error"), ok(quittung({ status: "replayed" }))],
        );
        const { s } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        void s.bestaetige();
        await s.bestaetige();
        expect(d.log.schreiben).toHaveLength(1);
        expect(s.stand.value).toMatchObject({ art: "fehler", wiederholbar: true });
        await s.nochmal();
        expect(d.log.schreiben.map((b) => b.operationId)).toEqual([id(901), id(901)]);
        expect(s.stand.value).toMatchObject({ art: "fertig", wiederholt: true });
        // Eine neue Bestätigung nach einem endgültigen Nein bekommt eine neue Kennung.
        const e = daten([ok(pruefung()), ok(pruefung())], [fehler(423, "map_editing_off", "gesperrt"), ok(quittung())]);
        const zwei = steuerung(e);
        await zwei.s.starte(SERIE_ANGEBOT());
        await zwei.s.bestaetige();
        expect(zwei.s.stand.value).toMatchObject({ art: "fehler", wiederholbar: false, satz: "gesperrt" });
        await zwei.s.starte(SERIE_ANGEBOT());
        await zwei.s.bestaetige();
        expect(e.log.schreiben.map((b) => b.operationId)).toEqual([id(901), id(902)]);
    });

    it("die Quittung gibt die Folgearbeit an die Warteschlange (nichts Simuliertes) und nennt Befunde in Worten", async () => {
        const vormerke = vi.fn(() => ({ art: "gelaende" as const, auftrag: "job-9" }));
        const d = daten(
            [ok(pruefung())],
            [
                ok(
                    quittung({
                        derivedWork: [
                            { kind: "terrain_local", jobId: "job-8", state: "queued" },
                            { kind: "dem_publish", jobId: "job-9", state: "queued" },
                        ],
                        warnings: [{ code: "terrain_stale", message: "x" }],
                    }),
                ),
            ],
        );
        const { s } = steuerung(d, { folge: { vormerke } });
        await s.starte(SERIE_ANGEBOT());
        await s.bestaetige();
        expect(vormerke).toHaveBeenCalledWith(expect.objectContaining({ derivedWork: expect.any(Array) }));
        // Rechnet das Gelände, gilt „Gelände veraltet“ nicht (wie im Fuß der Fenster).
        expect(s.stand.value).toMatchObject({
            art: "fertig",
            folge: { art: "gelaende", auftrag: "job-9" },
            befunde: [],
        });
    });

    it("ein anderes Angebot oder Schließen verwirft die Rückfrage; die Vorprüfung einer älteren Frage zählt nicht mehr", async () => {
        const d = daten([ok(pruefung())], []);
        const { s } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        s.schliesse();
        expect(s.stand.value.art).toBe("ruhe");
    });
});

describe("Die Adressen", () => {
    it("je Familie eine Adresse, für die Vorprüfung und die Rücknahme", () => {
        expect(vorschauUrl({ familie: "landscape", id: GEBIRGE })).toBe(
            `/api/editor/landscapes/${GEBIRGE}/restore-series/preview`,
        );
        expect(ruecknahmeUrl({ familie: "landscape", id: GEBIRGE })).toBe(
            `/api/editor/landscapes/${GEBIRGE}/restore-series`,
        );
        expect(vorschauUrl({ familie: "peak", id: GIPFEL })).toBe(`/api/editor/peaks/${GIPFEL}/restore-series/preview`);
        expect(ruecknahmeUrl({ familie: "peak", id: GIPFEL })).toBe(`/api/editor/peaks/${GIPFEL}/restore-series`);
        expect(vorschauUrl({ familie: "place", id: ORT })).toBe(`/api/editor/places/${ORT}/restore-series/preview`);
        expect(ruecknahmeUrl({ familie: "place", id: ORT })).toBe(`/api/editor/places/${ORT}/restore-series`);
    });

    it("🔴 die Daten schicken POST mit dem Körper; ein Fehler kommt im Umschlag, ohne Netz als Status 0", async () => {
        const aufrufe: { url: string; init: RequestInit }[] = [];
        const hole = ((url: string, init: RequestInit) => {
            aufrufe.push({ url, init });
            return Promise.resolve(
                new Response(JSON.stringify({ error: { code: "forbidden", message: "Dafür fehlt das Recht." } }), {
                    status: 403,
                }),
            );
        }) as unknown as typeof fetch;
        const antwort = await createRuecknahmeDaten(hole).ruecknehmen(
            { familie: "place", id: ORT },
            { operationId: id(1), members: [id(2)], membersHash: "e".repeat(64) },
        );
        expect(antwort).toEqual({
            ok: false,
            status: 403,
            fehler: { code: "forbidden", message: "Dafür fehlt das Recht." },
        });
        expect(aufrufe[0]!.url).toBe(`/api/editor/places/${ORT}/restore-series`);
        expect(aufrufe[0]!.init.method).toBe("POST");
        expect(JSON.parse(aufrufe[0]!.init.body as string)).toEqual({
            operationId: id(1),
            members: [id(2)],
            membersHash: "e".repeat(64),
        });
        const ohneNetz = createRuecknahmeDaten((() =>
            Promise.reject(new TypeError("offline"))) as unknown as typeof fetch);
        expect(await ohneNetz.vorschau({ familie: "place", id: ORT }, { members: [id(2)] })).toMatchObject({
            ok: false,
            status: 0,
            fehler: { code: "network_error" },
        });
    });
});

describe("B6a und B6a2: Wege zurücknehmen (Felder, Kurve, Stand, Umgruppieren, Verbinden über den Server)", () => {
    const WEG2 = "b5c00000-0000-4000-8000-0000000000e2";
    const wegEintrag = (n: number, operation: string, aktionen: string[], ueber: Partial<MapHistoryEntry> = {}) => ({
        ...gebirgsEintrag(n),
        operation,
        objects: aktionen.map((action, i) => ({
            kind: "path" as const,
            id: i === 0 ? WEG : WEG2,
            name: "Reichsstraße",
            action,
            revisionBefore: 1,
            revisionAfter: 2,
            changes: {},
        })),
        ...ueber,
    });

    it("🔴 Felder, Kurve (samt mitgezogenen Punkten), die vier Wechsel des Stands, Umgruppieren und Verbinden gehören dem Weg; Anlegen und Teilen nicht", () => {
        expect(wegArt("path.update", ["path.updated", "path.updated"])).toBe("felder");
        expect(wegArt("path.restore_series", ["path.updated"])).toBe("felder");
        expect(wegArt("path.update", ["path.reshaped", "path.carried"])).toBe("kurve");
        // Der Altbestand (je Handgriff gespeichert) heißt `path.reshape`.
        expect(wegArt("path.reshape", ["path.reshaped"])).toBe("kurve");
        // Felder zusammen mit der Kurve gehen nicht; zwei Kurven in einer Operation auch nicht.
        // Felder UND Kurve in einem Schritt (WI-0265 B8a).
        expect(wegArt("path.update", ["path.updated", "path.reshaped"])).toBe("felderkurve");
        expect(wegArt("path.update", ["path.updated", "path.reshaped", "path.carried"])).toBe("felderkurve");
        expect(wegArt("path.restore_series", ["path.updated", "path.reshaped"])).toBe("felderkurve");
        expect(wegArt("path.update", ["path.updated", "path.reshaped", "path.reshaped"])).toBeUndefined();
        expect(wegArt("path.update", ["path.updated", "path.reshaped", "path.deleted"])).toBeUndefined();
        expect(wegArt("path.update", ["path.reshaped", "path.reshaped"])).toBeUndefined();
        for (const [operation, aktion] of [
            ["path.delete", "path.deleted"],
            ["path.restore", "path.restored"],
            ["path.take_off_map", "path.taken_off_map"],
            ["path.put_on_map", "path.put_on_map"],
        ] as const)
            expect(wegArt(operation, [aktion, aktion]), operation).toBe("stand");
        // Die Rücknahme selbst ist ein Mitglied wie jedes andere.
        expect(wegArt("path.restore_series", ["path.restored"])).toBe("stand");
        expect(wegArt("path.delete", ["path.deleted", "path.restored"])).toBeUndefined();
        // Anlegen, Teilen und das Zusammenlegen der Teile (die Rücknahme des Teilens), je mit der Rücknahme davon (WI-0265 B8a).
        expect(wegArt("path.create", ["path.created"])).toBe("anlegen");
        expect(wegArt("path.create", ["path.created", "path.created"])).toBeUndefined();
        expect(wegArt("path.split", ["path.split", "path.created"])).toBe("teilen");
        expect(wegArt("path.restore_series", ["path.split", "path.created"])).toBe("teilen");
        expect(wegArt("path.split", ["path.split"])).toBeUndefined();
        expect(wegArt("path.restore_series", ["path.merged", "path.merged"])).toBe("zusammen");
        expect(wegArt("path.split", ["path.merged", "path.merged"])).toBeUndefined();
        expect(wegArt("path.restore_series", ["path.merged"])).toBeUndefined();
        expect(wegArt("path.restore_series", ["path.deleted"])).toBe("stand");
        // „Wege verbinden“ und „Auswahl zu neuem Weg“ (B6a2): nur die Operation selbst, nie ihre Rücknahme (`path.restore_series`).
        expect(wegArt("path.join", ["path.joined", "path.joined"])).toBe("verbinden");
        expect(wegArt("path.regroup", ["path.regrouped"])).toBe("umgruppieren");
        // Die Rücknahmen von Verbinden und Umgruppieren sind selbst rücknehmbar, in beide Richtungen; die Richtung steht im Namen der Aktion (WI-0265 B8a2).
        expect(wegArt("path.restore_series", ["path.joined", "path.joined"])).toBe("getrennt");
        expect(wegArt("path.restore_series", ["path.joined"])).toBeUndefined();
        expect(wegArt("path.restore_series", ["path.regrouped", "path.regrouped"])).toBe("entgruppiert");
        expect(wegArt("path.restore_series", ["path.regrouped_again", "path.regrouped_again"])).toBe("neugruppiert");
        // Der Straßen-Assistent (WI-0310): die Operation und beide Richtungen ihrer Rücknahme.
        expect(wegArt("path.assign_street", ["path.street_assigned", "path.street_assigned"])).toBe("strasse");
        expect(wegArt("path.restore_series", ["path.street_assigned"])).toBe("strasse_zurueck");
        expect(wegArt("path.restore_series", ["path.street_assigned_again"])).toBe("strasse_wieder");
        expect(wegArt("path.assign_street", ["path.street_assigned", "path.updated"])).toBeUndefined();
        expect(wegArt("path.join", ["path.regrouped_again"])).toBeUndefined();
        // Eine Kette aus mehreren Gliedern: ein vorderer Teil und beliebig viele hintere.
        expect(wegArt("path.restore_series", ["path.merged", "path.merged", "path.merged"])).toBe("zusammen");
        expect(wegArt("path.restore_series", ["path.split", "path.created", "path.created"])).toBe("teilen");
        expect(wegArt("path.split", ["path.split", "path.created", "path.split"])).toBeUndefined();
        expect(wegArt("path.join", ["path.joined", "path.deleted"])).toBeUndefined();
        // Die Quellen der Straße (B6g3) sind eine eigene Art; die Aktion eines anderen Trägers und die Felder darunter sind es nicht.
        expect(wegArt("traeger.sources", ["path.sources_changed"])).toBe("quellen");
        expect(wegArt("path.restore_series", ["path.sources_changed"])).toBe("quellen");
        expect(wegArt("traeger.sources", ["place.sources_changed"])).toBeUndefined();
        expect(wegArt("traeger.sources", ["path.updated"])).toBeUndefined();
        expect(wegArt("path.update", ["path.sources_changed"])).toBeUndefined();
        // Felder und Quellen zusammen (eine Rücknahme beider) sind Felder, die auch Quellen tragen.
        expect(wegArt("path.restore_series", ["path.updated", "path.sources_changed"])).toBe("felder");
    });

    it("🔴 die Adresse hängt an einem Abschnitt, den die Operation berührte; eine Operation ohne Weg-Art hat keine", () => {
        const felder = wegEintrag(1, "path.update", ["path.updated"]);
        expect(ruecknahmeFamilie(felder)).toBe("path");
        expect(ruecknahmeZiel(felder)).toEqual({ familie: "path", id: WEG });
        const stand = wegEintrag(2, "path.delete", ["path.deleted", "path.deleted"]);
        expect(ruecknahmeZiel(stand)).toEqual({ familie: "path", id: WEG });
        const kurve = wegEintrag(3, "path.update", ["path.reshaped", "path.carried"]);
        expect(ruecknahmeZiel(kurve)).toEqual({ familie: "path", id: WEG });
        // Teilen hat zwei Einträge (der verkürzte und der neue Teil); mit nur einem ist es keine Art, die der Server kennt.
        const split = wegEintrag(4, "path.split", ["path.split"]);
        expect(ruecknahmeFamilie(split)).toBeUndefined();
        expect(ruecknahmeZiel(split)).toBeUndefined();
        const geteilt = wegEintrag(4, "path.split", ["path.split", "path.created"]);
        expect(ruecknahmeFamilie(geteilt)).toBe("path");
        expect(ruecknahmeZiel(geteilt)).toEqual({ familie: "path", id: WEG });
        for (const [operation, aktionen] of [
            ["path.create", ["path.created"]],
            ["path.update", ["path.updated", "path.reshaped", "path.carried"]],
            ["path.restore_series", ["path.merged", "path.merged"]],
        ] as const)
            expect(ruecknahmeFamilie(wegEintrag(4, operation, [...aktionen])), operation).toBe("path");
        // Umgruppieren und Verbinden haben dieselbe Adresse wie im Reiter und im Wegverlauf; eine Rücknahme davon (Altbestand mit Quelle restore) hat keine.
        for (const [operation, aktion] of [
            ["path.regroup", "path.regrouped"],
            ["path.join", "path.joined"],
        ] as const) {
            const e = wegEintrag(4, operation, [aktion]);
            expect(ruecknahmeFamilie(e), operation).toBe("path");
            expect(ruecknahmeZiel(e), operation).toEqual({ familie: "path", id: WEG });
            const alt = wegEintrag(4, operation, [aktion], { source: "restore" });
            expect(ruecknahmeFamilie(alt), `${operation} restore`).toBeUndefined();
        }
        // Die Rücknahme des Servers (`path.restore_series`, Quelle restore) hat dagegen ein ↺ (WI-0265 B8a2).
        for (const aktion of ["path.regrouped", "path.regrouped_again", "path.joined"] as const) {
            const rueck = wegEintrag(4, "path.restore_series", [aktion, aktion], { source: "restore" });
            expect(ruecknahmeFamilie(rueck), aktion).toBe("path");
            expect(ruecknahmeZiel(rueck), aktion).toEqual({ familie: "path", id: WEG });
        }
        // Eine Operation am Ort bleibt am Ort, auch wenn sie Wegenden mitzieht.
        const verschoben = ortEintrag(5, "place.move", ["place.moved", "path.endpoint_moved"]);
        expect(ruecknahmeFamilie(verschoben)).toBe("place");
    });

    it("🔴 eine Serie am Weg sind nur Felder: ein Wechsel des Stands oder eine Kurve darin sperrt die Serie mit Grund „Art“", () => {
        const felder = [1, 2, 3].map((n) =>
            wegEintrag(n, "path.update", ["path.updated"], { series: { id: id(1), position: n, size: 3 } }),
        );
        const meta: MapHistorySeries = {
            id: id(1),
            size: 3,
            delivered: 3,
            members: felder.map((m) => m.operationId),
            membersHash: "d".repeat(64),
            scope: { kind: "path", id: WEG },
        };
        const zeile = (liste: MapHistoryEntry[]) =>
            gruppiere([...liste].reverse(), new Map([[meta.id, meta]]))[0]! as Extract<
                ReturnType<typeof gruppiere>[number],
                { art: "serie" }
            >;
        const ziel = { familie: "path" as const, id: WEG };
        expect(angebotSerie(zeile(felder), ziel)!.sperre).toBeUndefined();
        const mitKurve = [
            felder[0]!,
            wegEintrag(2, "path.update", ["path.reshaped"], { series: { id: id(1), position: 2, size: 3 } }),
            felder[2]!,
        ];
        expect(angebotSerie(zeile(mitKurve), ziel)!.sperre).toEqual({ art: "art" });
        // Einzeln geht das letzte offene Mitglied einer Serie von Feldern, das frühere ist überholt.
        const liste = [...felder].reverse();
        expect(angebotEinzeln(felder[2]!, ziel, liste)!.sperre).toBeUndefined();
        expect(angebotEinzeln(felder[0]!, ziel, liste)!.sperre).toEqual({ art: "ueberholt", position: 2 });
    });

    it("🔴 eine Serie am Weg, die mit dem Anlegen beginnt, geht als Ganzes zurück (auch mit einer Kurve darin); ein Wechsel des Stands darin sperrt (WI-0265 B8a)", () => {
        const eintraege = [
            wegEintrag(1, "path.create", ["path.created"], { series: { id: id(1), position: 1, size: 3 } }),
            wegEintrag(2, "path.update", ["path.updated"], { series: { id: id(1), position: 2, size: 3 } }),
            wegEintrag(3, "path.update", ["path.reshaped"], { series: { id: id(1), position: 3, size: 3 } }),
        ];
        const meta: MapHistorySeries = {
            id: id(1),
            size: 3,
            delivered: 3,
            members: eintraege.map((m) => m.operationId),
            membersHash: "e".repeat(64),
            scope: { kind: "path", id: WEG },
        };
        const zeile = (liste: MapHistoryEntry[]) =>
            gruppiere([...liste].reverse(), new Map([[meta.id, meta]]))[0]! as Extract<
                ReturnType<typeof gruppiere>[number],
                { art: "serie" }
            >;
        const ziel = { familie: "path" as const, id: WEG };
        expect(angebotSerie(zeile(eintraege), ziel)!.sperre).toBeUndefined();
        expect(angebotSerie(zeile(eintraege.slice(1)), ziel)!.sperre).toEqual({ art: "art" });
        const mitStand = [
            eintraege[0]!,
            wegEintrag(2, "path.take_off_map", ["path.taken_off_map"], { series: { id: id(1), position: 2, size: 3 } }),
            eintraege[2]!,
        ];
        expect(angebotSerie(zeile(mitStand), ziel)!.sperre).toEqual({ art: "art" });
    });

    it("🔴 die Rückfrage nennt am Weg, wie viele Abschnitte zurück auf die Karte kommen (R13), nie „Wegenden“", () => {
        const stand = (aktion: string, ids: string[]) =>
            pruefung({
                mitglieder: [
                    {
                        ...pruefung().mitglieder[0]!,
                        operation: "path.delete",
                        gegenstaende: ids.map((weg) => ({
                            kind: "path" as const,
                            id: weg,
                            action: aktion,
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: [],
                        })),
                    },
                ],
                offen: [id(1)],
                folgen: { gegenstaende: ids.length, gelaende: "keines" },
            });
        // „Ganz löschen“ zurücknehmen: zwei Abschnitte kommen zurück, gemeinsam oder gar nicht.
        expect(folgenZeilen(stand("path.deleted", [WEG, WEG2]))).toEqual([
            "2 Abschnitte kommen zurück auf die Karte.",
            "Gegenstände: 2, gemeinsam oder gar nicht.",
        ]);
        expect(folgenZeilen(stand("path.deleted", [WEG]))).toEqual(["1 Abschnitt kommt zurück auf die Karte."]);
        expect(folgenZeilen(stand("path.taken_off_map", [WEG]))).toEqual(["1 Abschnitt kommt zurück auf die Karte."]);
        // „Wege verbinden“ zurücknehmen: die still gelegten Abschnitte (Feld `active`) kommen zurück, die Vorlage nicht.
        const verbinden = pruefung({
            mitglieder: [
                {
                    ...pruefung().mitglieder[0]!,
                    operation: "path.join",
                    gegenstaende: [
                        {
                            kind: "path" as const,
                            id: WEG,
                            action: "path.joined",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: ["geometry"],
                        },
                        {
                            kind: "path" as const,
                            id: WEG2,
                            action: "path.joined",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: ["active"],
                        },
                    ],
                },
            ],
            offen: [id(1)],
            folgen: { gegenstaende: 2, gelaende: "keines" },
        });
        expect(folgenZeilen(verbinden)).toEqual([
            "1 Abschnitt kommt zurück auf die Karte.",
            "Gegenstände: 2, gemeinsam oder gar nicht.",
        ]);
        // Das Zusammenlegen der Teile zurücknehmen (WI-0265 B8a): der still gelegte hintere Teil (Feld active) kommt zurück, der vordere nur mit seiner Linie.
        const zusammen = pruefung({
            mitglieder: [
                {
                    ...pruefung().mitglieder[0]!,
                    operation: "path.restore_series",
                    gegenstaende: [
                        {
                            kind: "path" as const,
                            id: WEG,
                            action: "path.merged",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: ["geometry"],
                        },
                        {
                            kind: "path" as const,
                            id: WEG2,
                            action: "path.merged",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: ["active"],
                        },
                    ],
                },
            ],
            offen: [id(1)],
            folgen: { gegenstaende: 2, gelaende: "keines" },
        });
        expect(folgenZeilen(zusammen)).toEqual([
            "1 Abschnitt kommt zurück auf die Karte.",
            "Gegenstände: 2, gemeinsam oder gar nicht.",
        ]);
        // Die Rücknahme von „Wege verbinden“ zurücknehmen (WI-0265 B8a2): Die Abschnitte werden wieder zusammengelegt, nichts kommt „zurück auf die Karte“.
        const getrennt = pruefung({
            mitglieder: [
                {
                    ...pruefung().mitglieder[0]!,
                    operation: "path.restore_series",
                    gegenstaende: [
                        {
                            kind: "path" as const,
                            id: WEG,
                            action: "path.joined",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: ["geometry"],
                        },
                        {
                            kind: "path" as const,
                            id: WEG2,
                            action: "path.joined",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: ["active"],
                        },
                    ],
                },
            ],
            offen: [id(1)],
            folgen: { gegenstaende: 2, gelaende: "keines" },
        });
        expect(folgenZeilen(getrennt)).toEqual(["Gegenstände: 2, gemeinsam oder gar nicht."]);
        // Ein Weg, der von der Karte genommen wird, kommt nicht „zurück“.
        expect(folgenZeilen(stand("path.restored", [WEG]))).toEqual([]);
        for (const zeile of folgenZeilen(stand("path.deleted", [WEG, WEG2]))) expect(zeile).not.toContain("Wegenden");
    });

    it("🔴 die Kurve mit einer Höhe an einem Fluss nennt das Gelände als Folge (ein Lauf, oder ehrlich veraltet)", () => {
        const kurve = pruefung({
            mitglieder: [
                {
                    ...pruefung().mitglieder[0]!,
                    operation: "path.update",
                    gegenstaende: [
                        {
                            kind: "path" as const,
                            id: WEG,
                            action: "path.reshaped",
                            revisionBefore: 1,
                            revisionAfter: 2,
                            felder: ["geometry", "wasserHoehen"],
                        },
                    ],
                },
            ],
            offen: [id(1)],
            folgen: { gegenstaende: 1, gelaende: "lokal" },
        });
        expect(folgenZeilen(kurve)).toEqual([
            "Gelände wird neu berechnet: ein gemeinsamer Lauf für den ganzen Bereich.",
        ]);
    });

    it("🔴 Sätze zu `weg_strasse` und `weg_wert` aus den Sprachtafeln, in allen neun Sprachen, nie ein Schlüssel", () => {
        const k = (was: "weg_strasse" | "weg_wert"): RuecknahmeKonflikt => ({
            art: "wert",
            kind: "path",
            id: WEG,
            name: "Reichsstraße",
            felder: ["name"],
            abweichung: { was },
            detail: "Das Feld gilt für die ganze Straße.",
        });
        const satz = (konflikt: RuecknahmeKonflikt): string | undefined =>
            konfliktZeilen([konflikt], konfliktFeldName)[0]!.satz;
        expect(satz(k("weg_strasse"))).toBe(
            "Das gilt für die ganze Straße, die vorher aus anderen Abschnitten bestand oder je Abschnitt verschiedene Werte hatte: Name.",
        );
        expect(satz(k("weg_wert"))).toBe("Der frühere Wert lässt sich am Weg nicht wieder setzen: Name.");
        const deutsch = satz(k("weg_strasse"));
        for (const sprache of ["en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            for (const was of ["weg_strasse", "weg_wert"] as const) {
                const text = satz(k(was));
                expect(text, `${sprache} ${was}`).toBeTruthy();
                expect(text, `${sprache} ${was}`).not.toMatch(/\{\w+\}|weg_strasse|weg_wert/u);
                expect(text, `${sprache} ${was}`).not.toBe(deutsch);
            }
        }
    });

    it("🔴 Sätze zu `ort_kraftlinie`, `ort_auf_karte`, `weg_am_ort` und `zuordnung` (WI-0265 B8a) aus den Sprachtafeln, in allen neun Sprachen, nie ein Schlüssel", () => {
        const k = (was: "ort_kraftlinie" | "ort_auf_karte" | "weg_am_ort" | "zuordnung"): RuecknahmeKonflikt => ({
            art: "wert",
            kind: was === "weg_am_ort" ? "path" : "place",
            id: WEG,
            name: "Gratenfels",
            abweichung: { was },
            detail: "Befund des Servers.",
        });
        const satz = (konflikt: RuecknahmeKonflikt): string | undefined =>
            konfliktZeilen([konflikt], konfliktFeldName)[0]!.satz;
        expect(satz(k("ort_kraftlinie"))).toBe("Am Ort endet seither eine Kraftlinie.");
        expect(satz(k("ort_auf_karte"))).toBe("Der Ort steht inzwischen wieder auf der Karte.");
        expect(satz(k("weg_am_ort"))).toBe("Seit dem Anlegen endet ein Weg an diesem Ort.");
        expect(satz(k("zuordnung"))).toBe(
            "Eine Wiki-Zuordnung, die beim Anlegen noch nicht daran hing, hängt jetzt daran.",
        );
        for (const was of ["ort_kraftlinie", "ort_auf_karte", "weg_am_ort", "zuordnung"] as const) {
            setLocale("de");
            const deutsch = satz(k(was));
            for (const sprache of ["en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
                setLocale(sprache);
                const text = satz(k(was));
                expect(text, `${sprache} ${was}`).toBeTruthy();
                expect(text, `${sprache} ${was}`).not.toMatch(
                    /\{\w+\}|ort_kraftlinie|ort_auf_karte|weg_am_ort|zuordnung/u,
                );
                expect(text, `${sprache} ${was}`).not.toBe(deutsch);
            }
        }
        setLocale("de");
    });

    it("🔴 die Adressen und der Vorgangsname des Wegs", () => {
        expect(vorschauUrl({ familie: "path", id: WEG })).toBe(`/api/editor/paths/${WEG}/restore-series/preview`);
        expect(ruecknahmeUrl({ familie: "path", id: WEG })).toBe(`/api/editor/paths/${WEG}/restore-series`);
        // Die Kurve ist ein `path.update` mit Kurve: „Kurve geändert“, nicht „Eigenschaften geändert“.
        expect(vorgangName("path.update", ["path.reshaped", "path.carried"])).toBe("Kurve geändert");
        expect(vorgangName("path.update", ["path.updated"])).toBe("Eigenschaften geändert");
        expect(vorgangName("path.restore_series", ["path.updated"])).toBe("Serie zurückgenommen");
        for (const operation of [
            "path.create",
            "path.update",
            "path.reshape",
            "path.split",
            "path.delete",
            "path.restore",
            "path.take_off_map",
            "path.put_on_map",
            "path.regroup",
            "path.join",
            "path.restore_series",
        ])
            expect(vorgangTafelSchluessel(operation), operation).toBeDefined();
    });
});

// --- B6b: Gebiet und Kraftlinie -----------------------------------------------------------------------------------------------

const GEBIET = "b6b00000-0000-4000-8000-000000000001";
const GEBIETSFLAECHE = "b6b00000-0000-4000-8000-0000000000a1";
const ABSCHNITT = "b6b00000-0000-4000-8000-000000000002";
const ABSCHNITT2 = "b6b00000-0000-4000-8000-000000000003";

const mitObjekten = (
    n: number,
    operation: string,
    objekte: { kind: string; id: string; action: string; territory?: { id: string } }[],
    ueber: Partial<MapHistoryEntry> = {},
): MapHistoryEntry => ({
    ...gebirgsEintrag(n),
    operation,
    objects: objekte.map((o) => ({
        kind: o.kind as MapHistoryEntry["objects"][number]["kind"],
        id: o.id,
        name: "Name",
        action: o.action,
        revisionBefore: 1,
        revisionAfter: 2,
        changes: {},
        ...(o.territory === undefined ? {} : { territory: o.territory }),
    })),
    ...ueber,
});

describe("B6b: Gebiet und Kraftlinie über den Server", () => {
    it("🔴 die Adressen: Vorschau und Rücknahme hängen am Gebiet und an einem Abschnitt der Linie", () => {
        expect(vorschauUrl({ familie: "territory", id: GEBIET })).toBe(
            `/api/editor/territories/${GEBIET}/restore-series/preview`,
        );
        expect(ruecknahmeUrl({ familie: "territory", id: GEBIET })).toBe(
            `/api/editor/territories/${GEBIET}/restore-series`,
        );
        expect(vorschauUrl({ familie: "powerline", id: ABSCHNITT })).toBe(
            `/api/editor/powerlines/${ABSCHNITT}/restore-series/preview`,
        );
        expect(ruecknahmeUrl({ familie: "powerline", id: ABSCHNITT })).toBe(
            `/api/editor/powerlines/${ABSCHNITT}/restore-series`,
        );
    });

    it("🔴 die Familie und ihre Adresse im Eintrag: das Gebiet (auch aus einer Fläche), der Abschnitt der Linie; sonst keine", () => {
        const felder = mitObjekten(1, "territory.update", [
            { kind: "territory", id: GEBIET, action: "territory.updated" },
        ]);
        expect(ruecknahmeFamilie(felder)).toBe("territory");
        expect(ruecknahmeZiel(felder)).toEqual({ familie: "territory", id: GEBIET });
        const nurFlaeche = mitObjekten(2, "territory.retire", [
            { kind: "territory_area", id: GEBIETSFLAECHE, action: "territory_area.retired", territory: { id: GEBIET } },
        ]);
        expect(ruecknahmeZiel(nurFlaeche)).toEqual({ familie: "territory", id: GEBIET });
        // Ohne das Gebiet an der Fläche (ein älterer Server) gibt es keine Adresse.
        expect(
            ruecknahmeZiel(
                mitObjekten(3, "territory.retire", [
                    { kind: "territory_area", id: GEBIETSFLAECHE, action: "territory_area.retired" },
                ]),
            ),
        ).toBeUndefined();
        const linie = mitObjekten(4, "powerline.update_line", [
            { kind: "powerline", id: ABSCHNITT, action: "powerline.updated" },
            { kind: "powerline", id: ABSCHNITT2, action: "powerline.updated" },
        ]);
        expect(ruecknahmeFamilie(linie)).toBe("powerline");
        expect(ruecknahmeZiel(linie)).toEqual({ familie: "powerline", id: ABSCHNITT });
        // B8b: Anlegen, die Form, ein Zurückholen und das Anlegen einer Linie haben seither eine Familie; der Kraftlinienpunkt eine eigene.
        for (const [operation, aktion, art, familie] of [
            ["territory.create", "territory.created", "territory", "territory"],
            ["territory_area.create", "territory_area.created", "territory_area", "territory"],
            ["territory.update", "territory_area.reshaped", "territory_area", "territory"],
            ["territory.restore", "territory.restored", "territory", "territory"],
            ["powerline.create", "powerline.created", "powerline", "powerline"],
            ["nodix.create", "nodix.created", "nodix", "nodix"],
            ["nodix.move", "nodix.moved", "nodix", "nodix"],
            ["nodix.retire", "nodix.retired", "nodix", "nodix"],
            ["nodix.restore_series", "nodix.restored", "nodix", "nodix"],
        ] as const)
            expect(
                ruecknahmeFamilie(mitObjekten(5, operation, [{ kind: art, id: ABSCHNITT, action: aktion }])),
                operation,
            ).toBe(familie);
        // Die Adresse des Kraftlinienpunkts ist er selbst; eine Aktion einer anderen Art unter seinem Namen bleibt ohne Familie.
        expect(
            ruecknahmeZiel(mitObjekten(5, "nodix.move", [{ kind: "nodix", id: ABSCHNITT, action: "nodix.moved" }])),
        ).toEqual({ familie: "nodix", id: ABSCHNITT });
        expect(
            ruecknahmeFamilie(
                mitObjekten(5, "nodix.move", [{ kind: "powerline", id: ABSCHNITT, action: "powerline.updated" }]),
            ),
        ).not.toBe("nodix");
        expect(vorschauUrl({ familie: "nodix", id: "n1" })).toBe("/api/editor/nodices/n1/restore-series/preview");
        expect(ruecknahmeUrl({ familie: "nodix", id: "n1" })).toBe("/api/editor/nodices/n1/restore-series");
        // Das Anlegen eines Gebiets und „Grenze zeichnen“ gehen in einer Serie mit Feldern mit; ein Entfernen darin sperrt sie weiter.
        const serieMit = (operation: string, aktion: string, art: "territory" | "territory_area") =>
            mitObjekten(6, operation, [{ kind: art, id: GEBIET, action: aktion }]);
        expect(gebietArt("territory.create", ["territory.created", "territory_area.created"])).toBe("anlegen");
        expect(gebietArt("territory_area.create", ["territory_area.created"])).toBe("grenze");
        expect(gebietArt("territory.create", ["territory.updated"])).toBeUndefined();
        expect(ruecknahmeFamilie(serieMit("territory.create", "territory.created", "territory"))).toBe("territory");
    });

    it("🔴 Gebiet: eine Serie sind Felder, Darstellung, Form, Anlegen und ein Entfernen nur dieses Gebiets; „Unter neues Obergebiet …“ und ein Zurückholen sperren sie mit Grund „Art“", () => {
        const eintraege = [1, 2, 3].map((n) =>
            mitObjekten(n, "territory.update", [{ kind: "territory", id: GEBIET, action: "territory.updated" }], {
                series: { id: id(7), position: n, size: 3 },
            }),
        );
        const meta: MapHistorySeries = {
            id: id(7),
            size: 3,
            delivered: 3,
            members: eintraege.map((m) => m.operationId),
            membersHash: "c".repeat(64),
            scope: { kind: "territory", id: GEBIET },
        };
        const zeile = (liste: MapHistoryEntry[]) =>
            gruppiere([...liste].reverse(), new Map([[meta.id, meta]]))[0]! as Extract<
                ReturnType<typeof gruppiere>[number],
                { art: "serie" }
            >;
        const ziel = { familie: "territory" as const, id: GEBIET };
        expect(angebotSerie(zeile(eintraege), ziel)!.sperre).toBeUndefined();
        const mitEntfernen = [
            eintraege[0]!,
            mitObjekten(2, "territory.retire", [{ kind: "territory", id: GEBIET, action: "territory.retired" }], {
                series: { id: id(7), position: 2, size: 3 },
            }),
            eintraege[2]!,
        ];
        // B8b2: Ein Entfernen, das nur dieses Gebiet berührte, ist Mitglied der Serie; „Unter neues Obergebiet …“ geht allein.
        expect(angebotSerie(zeile(mitEntfernen), ziel)!.sperre).toBeUndefined();
        const mitObergebiet = [
            eintraege[0]!,
            mitObjekten(
                2,
                "territory.create_parent",
                [{ kind: "territory", id: GEBIET, action: "territory.created" }],
                {
                    series: { id: id(7), position: 2, size: 3 },
                },
            ),
            eintraege[2]!,
        ];
        expect(angebotSerie(zeile(mitObergebiet), ziel)!.sperre).toEqual({ art: "art" });
        // B8b: Das Anlegen eröffnet die Serie, die Fläche („Grenze zeichnen“) und die Form gehen mit; ein Zurückholen in der Serie sperrt sie.
        const mitAnlegen = [
            mitObjekten(
                1,
                "territory.create",
                [
                    { kind: "territory", id: GEBIET, action: "territory.created" },
                    { kind: "territory_area", id: GEBIETSFLAECHE, action: "territory_area.created" },
                ],
                { series: { id: id(7), position: 1, size: 3 } },
            ),
            eintraege[1]!,
            mitObjekten(
                3,
                "territory.update",
                [
                    { kind: "territory", id: GEBIET, action: "territory.updated" },
                    { kind: "territory_area", id: GEBIETSFLAECHE, action: "territory_area.reshaped" },
                ],
                { series: { id: id(7), position: 3, size: 3 } },
            ),
        ];
        expect(angebotSerie(zeile(mitAnlegen), ziel)!.sperre).toBeUndefined();
        const mitZurueckholen = [
            eintraege[0]!,
            mitObjekten(2, "territory.restore", [{ kind: "territory", id: GEBIET, action: "territory.restored" }], {
                series: { id: id(7), position: 2, size: 3 },
            }),
            eintraege[2]!,
        ];
        expect(angebotSerie(zeile(mitZurueckholen), ziel)!.sperre).toEqual({ art: "art" });
    });

    it("🔴 Kraftlinie: eine Serie sind nur Änderungen der Linie, ein Wechsel des Stands darin sperrt sie mit Grund „Art“; einzeln hat der Stand sein ↺", () => {
        const aenderung = (n: number) =>
            mitObjekten(
                n,
                "powerline.update_line",
                [{ kind: "powerline", id: ABSCHNITT, action: "powerline.updated" }],
                { series: { id: id(8), position: n, size: 2 } },
            );
        const stand = mitObjekten(
            2,
            "powerline.take_off_map",
            [{ kind: "powerline", id: ABSCHNITT, action: "powerline.taken_off_map" }],
            { series: { id: id(8), position: 2, size: 2 } },
        );
        const meta: MapHistorySeries = {
            id: id(8),
            size: 2,
            delivered: 2,
            members: [id(1), id(2)],
            membersHash: "d".repeat(64),
            scope: { kind: "powerline", id: ABSCHNITT },
        };
        const zeile = (liste: MapHistoryEntry[]) =>
            gruppiere([...liste].reverse(), new Map([[meta.id, meta]]))[0]! as Extract<
                ReturnType<typeof gruppiere>[number],
                { art: "serie" }
            >;
        const ziel = { familie: "powerline" as const, id: ABSCHNITT };
        expect(angebotSerie(zeile([aenderung(1), aenderung(2)]), ziel)!.sperre).toBeUndefined();
        expect(angebotSerie(zeile([aenderung(1), stand]), ziel)!.sperre).toEqual({ art: "art" });
        expect(angebotEinzeln(stand, ruecknahmeZiel(stand), [])).toMatchObject({
            modus: "einzeln",
            sperre: undefined,
        });
    });

    it("🔴 Vorgangsnamen: „Gelöscht“ oder „Von der Karte genommen“ je nach Entfernen, dazu die Namen der Flächen, des Mehrfachen und des Nodix - in allen neun Sprachen, nie der Schlüssel", () => {
        expect(vorgangName("territory.retire", ["territory.retired", "territory.updated"])).toBe("Gelöscht");
        expect(vorgangName("territory.retire", ["territory_area.retired"])).toBe("Von der Karte genommen");
        expect(vorgangName("territory.merge")).toBe("Flächen vereinigt");
        expect(vorgangName("territory.sammel")).toBe("Mehrere Gebiete geändert");
        expect(vorgangName("nodix.create")).toBe("Nodix angelegt");
        expect(vorgangName("nodix.move")).toBe("Nodix verschoben");
        expect(vorgangName("nodix.retire")).toBe("Nodix entfernt");
        expect(vorgangName("territory.restore_series")).toBe("Serie zurückgenommen");
        expect(vorgangName("powerline.restore_series")).toBe("Serie zurückgenommen");
        for (const sprache of ["en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            for (const operation of [
                "territory.merge",
                "territory.sammel",
                "nodix.create",
                "nodix.move",
                "nodix.retire",
            ])
                expect(vorgangName(operation), `${sprache} ${operation}`).not.toMatch(/\./);
            expect(vorgangName("territory.merge"), sprache).not.toBe("Flächen vereinigt");
        }
        // Die übrigen Operationen beider Familien haben ihr Wort in der Tafel.
        for (const operation of [
            "territory.create",
            "territory.create_parent",
            "territory.update",
            "territory.display",
            "territory.sammel",
            "territory.retire",
            "territory.restore",
            "territory.merge",
            "territory.restore_series",
            "territory_area.create",
            "powerline.create",
            "powerline.update_line",
            "powerline.take_off_map",
            "powerline.put_on_map",
            "powerline.retire",
            "powerline.restore",
            "powerline.restore_series",
            "nodix.create",
            "nodix.move",
            "nodix.retire",
        ])
            expect(vorgangTafelSchluessel(operation), operation).toBeDefined();
    });

    it("🔴 „Konflikt prüfen“: eine Fläche des Gebiets führt zum Gebiet, eine Linie und ein Gebiet zu sich selbst", () => {
        const gebiet = { familie: "territory" as const, id: GEBIET };
        expect(konfliktGegenstand({ kind: "territory_area", id: GEBIETSFLAECHE }, gebiet)).toEqual({
            kind: "territory",
            id: GEBIET,
        });
        expect(konfliktGegenstand({ kind: "territory", id: GEBIET, name: "Baronie" }, gebiet)).toEqual({
            kind: "territory",
            id: GEBIET,
            name: "Baronie",
        });
        expect(
            konfliktGegenstand({ kind: "powerline", id: ABSCHNITT2 }, { familie: "powerline", id: ABSCHNITT }),
        ).toEqual({ kind: "powerline", id: ABSCHNITT2, name: undefined });
    });

    it("🔴 Konflikte: Felder des Gebiets und der Linie heißen wie im Fenster, nie wie der Schlüssel des Protokolls", () => {
        for (const feld of [
            "name",
            "shortName",
            "type",
            "status",
            "capital",
            "parent",
            "color",
            "minZoom",
            "maxZoom",
            "ruler",
        ])
            expect(konfliktFeldName("territory", feld), feld).not.toBe(feld);
        for (const feld of ["name", "labelVisible", "description", "curve", "from", "to", "active", "wiki"])
            expect(konfliktFeldName("powerline", feld), feld).not.toBe(feld);
    });
});

describe("B6c: Derographie und Gipfel zurücknehmen (Felder, Beschriftungen, Form, Stilllegen, Werkzeuge an Flächen, Gipfel über den Server)", () => {
    const eintrag = (
        n: number,
        operation: string,
        objekte: { kind: "landscape" | "area" | "label" | "peak"; id?: string; action: string }[],
        ueber: Partial<MapHistoryEntry> = {},
    ): MapHistoryEntry => ({
        ...gebirgsEintrag(n),
        operation,
        objects: objekte.map((o) => ({
            kind: o.kind,
            id:
                o.id ??
                (o.kind === "landscape" ? GEBIRGE : o.kind === "area" ? FLAECHE : o.kind === "label" ? LABEL : GIPFEL),
            name: "Blutzinnen",
            action: o.action,
            revisionBefore: 1,
            revisionAfter: 2,
            changes: {},
            ...(o.kind === "area" || o.kind === "label" ? { landscape: { id: GEBIRGE } } : {}),
        })),
        ...ueber,
    });

    it("🔴 jede Art der Derographie, die der Server kennt, gehört der Landschaft und trägt ihre Adresse", () => {
        const arten: [string, string, MapHistoryEntry][] = [
            ["Felder", "landscape", eintrag(1, "landscape.update", [{ kind: "landscape", action: "region.updated" }])],
            [
                "Felder mit folgender Beschriftung",
                "landscape",
                eintrag(1, "landscape.update", [
                    { kind: "landscape", action: "region.updated" },
                    { kind: "label", action: "label.renamed" },
                ]),
            ],
            ["Beschriftung", "landscape", eintrag(1, "landscape.update", [{ kind: "label", action: "label.updated" }])],
            [
                "Form samt mitgezogener Nachbarin",
                "landscape",
                eintrag(1, "landscape.update", [
                    { kind: "area", action: "area.reshaped" },
                    { kind: "area", id: id(500), action: "area.carried" },
                ]),
            ],
            [
                "Entfernen",
                "landscape",
                eintrag(1, "landscape.retire", [
                    { kind: "landscape", action: "region.taken_off_map" },
                    { kind: "area", action: "area.retired" },
                    { kind: "label", action: "label.retired" },
                ]),
            ],
            [
                "Zurückholen",
                "landscape",
                eintrag(1, "landscape.restore", [
                    { kind: "landscape", action: "region.restored" },
                    { kind: "area", action: "area.restored" },
                ]),
            ],
            [
                "Mit anderer Fläche",
                "landscape",
                eintrag(1, "landscape.boolean", [
                    { kind: "area", action: "area.boolean" },
                    { kind: "area", id: id(501), action: "area.retired" },
                    { kind: "landscape", id: id(502), action: "region.retired" },
                ]),
            ],
            [
                "Unterflächen herauslösen",
                "landscape",
                eintrag(1, "landscape.parts", [
                    { kind: "area", action: "area.parts" },
                    { kind: "landscape", id: id(502), action: "region.created" },
                    { kind: "area", id: id(501), action: "area.created" },
                ]),
            ],
            [
                "Zerschneiden",
                "landscape",
                eintrag(1, "landscape.split", [
                    { kind: "area", action: "area.split" },
                    { kind: "area", id: id(501), action: "area.created" },
                ]),
            ],
            [
                "Kopieren",
                "landscape",
                eintrag(1, "landscape.copy", [{ kind: "area", id: id(501), action: "area.copied" }]),
            ],
            [
                "Flächen vereinigen",
                "landscape",
                eintrag(1, "landscape.merge", [
                    { kind: "area", action: "area.merged" },
                    { kind: "area", id: id(501), action: "area.retired" },
                ]),
            ],
            [
                "Mehrfachauswahl",
                "landscape",
                eintrag(1, "landscape.batch", [{ kind: "landscape", action: "region.updated" }]),
            ],
            [
                "Rücknahme einer Serie",
                "landscape",
                eintrag(1, "landscape.restore_series", [{ kind: "landscape", action: "region.updated" }]),
            ],
            [
                "Gebirge und Felder zugleich",
                "landscape",
                eintrag(1, "landscape.update", [
                    { kind: "landscape", action: "region.updated" },
                    { kind: "area", action: "area.gebirge" },
                ]),
            ],
            ["Gipfel: Felder", "peak", eintrag(1, "peak.update", [{ kind: "peak", action: "peak.updated" }])],
            ["Gipfel: Entfernen", "peak", eintrag(1, "peak.retire", [{ kind: "peak", action: "peak.retired" }])],
            ["Gipfel: Zurückholen", "peak", eintrag(1, "peak.restore", [{ kind: "peak", action: "peak.restored" }])],
            [
                "Gipfel: Rücknahme einer Serie",
                "peak",
                eintrag(1, "peak.restore_series", [{ kind: "peak", action: "peak.updated" }]),
            ],
            [
                "Gipfelhöhe aus der Gipfelliste des Gebirges (nur der Gipfel berührt)",
                "peak",
                eintrag(1, "landscape.update", [{ kind: "peak", action: "peak.updated" }]),
            ],
            [
                "Entfernen einer Mehrfachauswahl mit Gipfel: an der Landschaft",
                "landscape",
                eintrag(1, "landscape.retire", [
                    { kind: "landscape", action: "region.retired" },
                    { kind: "peak", action: "peak.retired" },
                ]),
            ],
        ];
        for (const [name, familie, e] of arten) {
            expect(ruecknahmeFamilie(e), name).toBe(familie);
            const ziel = ruecknahmeZiel(e);
            expect(ziel?.familie, name).toBe(familie);
            expect(ziel?.id, name).toBe(familie === "peak" ? GIPFEL : GEBIRGE);
            expect(angebotEinzeln(e, ziel), name).toMatchObject({ modus: "einzeln", sperre: undefined });
        }
    });

    it("🔴 eine fremde Aktion, ein Etikett einer anderen Operation und ein Eintrag ohne Gegenstand bleiben ohne ↺ (das Anlegen hat seit B8c sein ↺, siehe unten)", () => {
        const nicht: [string, MapHistoryEntry][] = [
            ["unbekannte Aktion", eintrag(1, "landscape.update", [{ kind: "landscape", action: "region.erfunden" }])],
            ["unbekannte Operation", eintrag(1, "landscape.reshape", [{ kind: "area", action: "area.reshaped" }])],
            ["ohne Gegenstand", eintrag(1, "landscape.update", [])],
        ];
        for (const [name, e] of nicht) {
            expect(ruecknahmeFamilie(e), name).toBeUndefined();
            expect(ruecknahmeZiel(e), name).toBeUndefined();
        }
    });

    it("🔴 eine Serie am Gipfel und an der Landschaft: ALLE Mitglieder mit der Prüfsumme der Liste unter der Adresse des Gipfels bzw. der Landschaft", () => {
        for (const [familie, adresse, operation, gegenstand] of [
            ["peak", GIPFEL, "peak.update", { kind: "peak" as const, action: "peak.updated" }],
            ["landscape", GEBIRGE, "landscape.update", { kind: "landscape" as const, action: "region.updated" }],
        ] as const) {
            const mitglieder = [1, 2, 3].map((n) =>
                eintrag(n, operation, [gegenstand], { series: { id: id(1), position: n, size: 3 } }),
            );
            const meta: MapHistorySeries = {
                id: id(1),
                size: 3,
                delivered: 3,
                members: mitglieder.map((m) => m.operationId),
                membersHash: "d".repeat(64),
                scope: { kind: familie, id: adresse },
            };
            const zeile = gruppiere([...mitglieder].reverse(), new Map([[meta.id, meta]]))[0]! as Extract<
                ReturnType<typeof gruppiere>[number],
                { art: "serie" }
            >;
            const angebot = angebotSerie(zeile, ruecknahmeZiel(zeile.mitglieder[0]!, zeile.meta));
            expect(angebot, familie).toMatchObject({
                modus: "serie",
                ziel: { familie, id: adresse },
                mitglieder: meta.members,
                membersHash: meta.membersHash,
                offen: 3,
                sperre: undefined,
            });
        }
    });

    it("🔴 „Konflikt prüfen“ führt bei einer Teilfläche oder Beschriftung zur Landschaft der Rücknahme, bei einem Gipfel zum Gipfel", () => {
        const ziel = { familie: "landscape" as const, id: GEBIRGE };
        expect(konfliktGegenstand({ kind: "area", id: FLAECHE, name: "x" }, ziel)).toEqual({
            kind: "landscape",
            id: GEBIRGE,
        });
        expect(konfliktGegenstand({ kind: "label", id: LABEL, name: "x" }, ziel)).toEqual({
            kind: "landscape",
            id: GEBIRGE,
        });
        expect(konfliktGegenstand({ kind: "landscape", id: id(7), name: "Nachbar" }, ziel)).toEqual({
            kind: "landscape",
            id: id(7),
            name: "Nachbar",
        });
        expect(
            konfliktGegenstand({ kind: "peak", id: GIPFEL, name: "Zinne" }, { familie: "peak", id: GIPFEL }),
        ).toEqual({
            kind: "peak",
            id: GIPFEL,
            name: "Zinne",
        });
    });

    it("🔴 Sätze zu `flaeche_nachbar` und `gipfel_wert` aus den Sprachtafeln, in allen neun Sprachen, nie ein Schlüssel", () => {
        const k = (was: "flaeche_nachbar" | "gipfel_wert"): RuecknahmeKonflikt => ({
            art: "wert",
            kind: was === "gipfel_wert" ? "peak" : "area",
            id: FLAECHE,
            name: "Blutzinnen",
            felder: [was === "gipfel_wert" ? "height" : "geometry"],
            abweichung: { was },
            detail: "Ein deutscher Satz des Servers.",
        });
        const satz = (konflikt: RuecknahmeKonflikt): string | undefined =>
            konfliktZeilen([konflikt], konfliktFeldName)[0]!.satz;
        expect(satz(k("flaeche_nachbar"))).toBe(
            "Die mitgezogenen Ecken der Nachbarfläche liegen nicht mehr genau an ihrer Stelle.",
        );
        expect(satz(k("gipfel_wert"))).toMatch(/^Der frühere Wert lässt sich am Gipfel nicht wieder setzen: .+\.$/u);
        const deutsch = { flaeche_nachbar: satz(k("flaeche_nachbar")), gipfel_wert: satz(k("gipfel_wert")) };
        for (const sprache of ["en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            for (const was of ["flaeche_nachbar", "gipfel_wert"] as const) {
                const text = satz(k(was));
                expect(text, `${sprache} ${was}`).toBeTruthy();
                expect(text, `${sprache} ${was}`).not.toMatch(/\{\w+\}|flaeche_nachbar|gipfel_wert/u);
                expect(text, `${sprache} ${was}`).not.toBe(deutsch[was]);
            }
        }
    });

    it("🔴 Vorgangsnamen: Form, Beschriftung, Gipfel und die Werkzeuge an Flächen haben ihr Wort in allen neun Tafeln", () => {
        expect(vorgangName("landscape.update", ["area.reshaped", "area.carried"])).toBe("Form geändert");
        expect(vorgangName("landscape.update", ["label.updated", "label.renamed"])).toBe("Beschriftung geändert");
        expect(vorgangName("landscape.update", ["region.updated"])).toBe("Eigenschaften geändert");
        expect(vorgangName("landscape.update", ["area.gebirge"])).toBe("Gebirge geändert");
        expect(vorgangName("peak.restore_series", ["peak.updated"])).toBe("Serie zurückgenommen");
        for (const operation of [
            "landscape.update",
            "landscape.retire",
            "landscape.restore",
            "landscape.restore_series",
            "landscape.batch",
            "landscape.boolean",
            "landscape.parts",
            "landscape.split",
            "landscape.copy",
            "landscape.merge",
            "peak.update",
            "peak.retire",
            "peak.restore",
            "peak.restore_series",
        ])
            expect(vorgangTafelSchluessel(operation), operation).toBeDefined();
        for (const sprache of ["en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            const text = vorgangName("landscape.update", ["label.updated"]);
            expect(text, sprache).toBeTruthy();
            expect(text, sprache).not.toBe("Beschriftung geändert");
            expect(text, sprache).not.toMatch(/aenderungen\./u);
        }
    });
});

describe("B6e: Sprachen zurücknehmen (Felder, Wiki-Artikel, Stilllegen, Form, Werkzeuge an Teilflächen, Kopieren in eine neue Sprache über den Server)", () => {
    const SPRACHE = "b5c00000-0000-4000-8000-0000000000d1";
    const SPRACHE2 = "b5c00000-0000-4000-8000-0000000000d2";
    const TEILFLAECHE = "b5c00000-0000-4000-8000-0000000000d3";
    type Objekt = {
        kind: "sprache" | "sprache_flaeche";
        id?: string;
        action: string;
        sprache?: { id: string; name?: string };
    };
    const eintrag = (
        n: number,
        operation: string,
        objekte: Objekt[],
        ueber: Partial<MapHistoryEntry> = {},
    ): MapHistoryEntry => ({
        ...gebirgsEintrag(n),
        operation,
        objects: objekte.map((o) => ({
            kind: o.kind,
            id: o.id ?? (o.kind === "sprache" ? SPRACHE : TEILFLAECHE),
            name: "Garethi",
            action: o.action,
            revisionBefore: 1,
            revisionAfter: 2,
            changes: {},
            ...(o.sprache !== undefined ? { sprache: o.sprache } : {}),
        })),
        ...ueber,
    });

    it("🔴 die Adressen: Vorschau und Rücknahme hängen an der Sprache", () => {
        expect(vorschauUrl({ familie: "sprache", id: SPRACHE })).toBe(
            `/api/editor/sprachen/${SPRACHE}/restore-series/preview`,
        );
        expect(ruecknahmeUrl({ familie: "sprache", id: SPRACHE })).toBe(
            `/api/editor/sprachen/${SPRACHE}/restore-series`,
        );
    });

    it("🔴 jede Art im Spracheditor, die der Server kennt, gehört der Sprache und trägt ihre Adresse; eine Teilfläche nennt ihre Sprache am Gegenstand", () => {
        const ziel = { familie: "sprache", id: SPRACHE };
        const arten: [string, MapHistoryEntry][] = [
            ["Felder", eintrag(1, "sprache.update", [{ kind: "sprache", action: "sprache.updated" }])],
            [
                "Wiki-Artikel samt Abgabe einer anderen Sprache",
                eintrag(1, "sprache.wiki", [
                    { kind: "sprache", action: "sprache.wiki_changed" },
                    { kind: "sprache", id: SPRACHE2, action: "sprache.wiki_released" },
                ]),
            ],
            ["Stilllegen", eintrag(1, "sprache.retire", [{ kind: "sprache", action: "sprache.retired" }])],
            ["Zurückholen", eintrag(1, "sprache.restore", [{ kind: "sprache", action: "sprache.restored" }])],
            [
                "Teilfläche stilllegen (nur die Teilfläche im Eintrag)",
                eintrag(1, "sprache_flaeche.retire", [
                    { kind: "sprache_flaeche", action: "sprache_flaeche.retired", sprache: { id: SPRACHE } },
                ]),
            ],
            [
                "Form",
                eintrag(1, "sprache_flaeche.reshape", [
                    { kind: "sprache_flaeche", action: "sprache_flaeche.reshaped", sprache: { id: SPRACHE } },
                ]),
            ],
            [
                "Unterflächen",
                eintrag(1, "sprache_flaeche.parts", [
                    { kind: "sprache_flaeche", action: "sprache_flaeche.parts", sprache: { id: SPRACHE } },
                    {
                        kind: "sprache_flaeche",
                        id: id(901),
                        action: "sprache_flaeche.retired",
                        sprache: { id: SPRACHE },
                    },
                ]),
            ],
            [
                "Zerschneiden",
                eintrag(1, "sprache_flaeche.split", [
                    { kind: "sprache_flaeche", action: "sprache_flaeche.split", sprache: { id: SPRACHE } },
                    {
                        kind: "sprache_flaeche",
                        id: id(901),
                        action: "sprache_flaeche.created",
                        sprache: { id: SPRACHE },
                    },
                ]),
            ],
            [
                "Mit anderer Fläche",
                eintrag(1, "sprache_flaeche.boolean", [
                    { kind: "sprache_flaeche", action: "sprache_flaeche.boolean", sprache: { id: SPRACHE } },
                    {
                        kind: "sprache_flaeche",
                        id: id(901),
                        action: "sprache_flaeche.retired",
                        sprache: { id: SPRACHE2 },
                    },
                ]),
            ],
            [
                "Kopieren in eine neue Sprache mit Originalfläche löschen",
                eintrag(1, "sprache_flaeche.copy", [
                    { kind: "sprache", action: "sprache.created" },
                    {
                        kind: "sprache_flaeche",
                        id: id(901),
                        action: "sprache_flaeche.copied",
                        sprache: { id: SPRACHE },
                    },
                    {
                        kind: "sprache_flaeche",
                        id: id(902),
                        action: "sprache_flaeche.retired",
                        sprache: { id: SPRACHE2 },
                    },
                ]),
            ],
            ["Rücknahme", eintrag(1, "sprache.restore_series", [{ kind: "sprache", action: "sprache.updated" }])],
        ];
        for (const [name, e] of arten) {
            expect(ruecknahmeFamilie(e), name).toBe("sprache");
            expect(ruecknahmeZiel(e), name).toEqual(ziel);
            expect(angebotEinzeln(e, ruecknahmeZiel(e))?.ziel, name).toEqual(ziel);
        }
    });

    it("🔴 eine fremde Aktion und eine Teilfläche ohne Sprache bleiben ohne ↺ (Anlegen und Kopie aus der Derographie haben seit B8c ihr ↺, siehe unten)", () => {
        for (const [name, e] of [
            ["Aktion unbekannt", eintrag(1, "sprache.update", [{ kind: "sprache", action: "sprache.zzz" }])],
        ] as const)
            expect(ruecknahmeFamilie(e), name).toBeUndefined();
        // Ein älterer Server nennt die Sprache an der Teilfläche nicht: keine Adresse.
        expect(
            ruecknahmeZiel(
                eintrag(1, "sprache_flaeche.retire", [{ kind: "sprache_flaeche", action: "sprache_flaeche.retired" }]),
            ),
        ).toBeUndefined();
    });

    it("🔴 eine Serie an der Sprache sind alle Mitglieder ihrer Familie; die Adresse nimmt die Sprache der Serie, wenn der Eintrag sie nicht nennt", () => {
        const mitglieder = [1, 2].map((n) =>
            eintrag(n, "sprache.update", [{ kind: "sprache", action: "sprache.updated" }], {
                series: { id: id(7), position: n, size: 2 },
            }),
        );
        const meta: MapHistorySeries = {
            id: id(7),
            size: 2,
            delivered: 2,
            members: mitglieder.map((m) => m.operationId),
            membersHash: "b".repeat(64),
            scope: { kind: "sprache", id: SPRACHE, name: "Garethi" },
        };
        const zeile = gruppiere([...mitglieder].reverse(), new Map([[meta.id, meta]]))[0]! as Extract<
            ReturnType<typeof gruppiere>[number],
            { art: "serie" }
        >;
        const angebot = angebotSerie(zeile, ruecknahmeZiel(zeile.mitglieder[0]!, zeile.meta));
        expect(angebot).toMatchObject({
            modus: "serie",
            ziel: { familie: "sprache", id: SPRACHE },
            mitglieder: meta.members,
            membersHash: meta.membersHash,
            sperre: undefined,
        });
    });

    it("🔴 „Konflikt prüfen“: eine Teilfläche führt zum Fenster ihrer Sprache", () => {
        const ziel = { familie: "sprache" as const, id: SPRACHE };
        expect(konfliktGegenstand({ kind: "sprache_flaeche", id: TEILFLAECHE }, ziel)).toEqual({
            kind: "sprache",
            id: SPRACHE,
        });
        expect(konfliktGegenstand({ kind: "sprache", id: SPRACHE, name: "Garethi" }, ziel)).toEqual({
            kind: "sprache",
            id: SPRACHE,
            name: "Garethi",
        });
    });

    it("🔴 Satz zu `sprache_wiki` aus den Sprachtafeln, in allen neun Sprachen, nie ein Schlüssel; Felder heißen wie im Fenster", () => {
        const k: RuecknahmeKonflikt = {
            art: "wert",
            kind: "sprache",
            id: SPRACHE,
            name: "Garethi",
            felder: ["wiki"],
            abweichung: { was: "sprache_wiki" },
            detail: "Ein deutscher Satz des Servers.",
        };
        const satz = (): string | undefined => konfliktZeilen([k], konfliktFeldName)[0]!.satz;
        expect(satz()).toBe(
            "Ein Wiki-Artikel, der zurückkäme, gehört heute einer anderen Sprache oder steht nicht mehr im Wiki.",
        );
        const deutsch = satz();
        for (const sprache of ["en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            const text = satz();
            expect(text, sprache).toBeTruthy();
            expect(text, sprache).not.toMatch(/\{\w+\}|sprache_wiki/u);
            expect(text, sprache).not.toBe(deutsch);
        }
        setLocale("de");
        for (const feld of ["name", "legende", "farbe", "reihenfolge", "wiki", "active", "geometry", "herkunft"])
            expect(konfliktFeldName("sprache", feld), feld).not.toBe(feld);
        for (const feld of ["geometry", "herkunft", "active"])
            expect(konfliktFeldName("sprache_flaeche", feld), feld).not.toBe(feld);
    });

    it("🔴 Vorgangsnamen: Wiki-Artikel, Kopieren und die Werkzeuge an Teilflächen haben ihr Wort in allen neun Tafeln, nie den Schlüssel", () => {
        expect(vorgangName("sprache.wiki")).toBe("Wiki-Artikel geändert");
        expect(vorgangName("sprache.flaeche_aus_landschaft")).toBe("Fläche aus der Derographie kopiert");
        expect(vorgangName("sprache.update")).toBe("Eigenschaften geändert");
        expect(vorgangName("sprache.restore_series")).toBe("Serie zurückgenommen");
        expect(vorgangName("sprache_flaeche.reshape")).toBe("Form geändert");
        for (const operation of [
            "sprache.create",
            "sprache.update",
            "sprache.wiki",
            "sprache.retire",
            "sprache.restore",
            "sprache.restore_series",
            "sprache.flaeche_aus_landschaft",
            "sprache_flaeche.create",
            "sprache_flaeche.reshape",
            "sprache_flaeche.parts",
            "sprache_flaeche.split",
            "sprache_flaeche.boolean",
            "sprache_flaeche.copy",
            "sprache_flaeche.retire",
            "sprache_flaeche.restore",
        ])
            expect(vorgangTafelSchluessel(operation), operation).toBeDefined();
        for (const sprache of ["en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            for (const operation of ["sprache.wiki", "sprache.flaeche_aus_landschaft"]) {
                const text = vorgangName(operation);
                expect(text, `${sprache} ${operation}`).toBeTruthy();
                expect(text, `${sprache} ${operation}`).not.toMatch(/\.|aenderungen\./u);
                expect(text, `${sprache} ${operation}`).not.toBe(
                    operation === "sprache.wiki" ? "Wiki-Artikel geändert" : "Fläche aus der Derographie kopiert",
                );
            }
        }
    });
});

describe("B6g1: Quelle, Werk und Korpus zurücknehmen (Felder, Ortsliste, Wirkung auf die Quellen über den Server)", () => {
    const QUELLE = "b5c00000-0000-4000-8000-0000000000c1";
    const WERK_ID = "b5c00000-0000-4000-8000-0000000000c2";
    const KORPUS = "b5c00000-0000-4000-8000-0000000000c3";
    type Objekt = {
        kind: "source" | "work" | "corpus" | "path" | "lore";
        id: string;
        action: string;
        changes?: Record<string, { before?: unknown; after?: unknown }>;
    };
    const eintrag = (
        n: number,
        operation: string,
        objekte: Objekt[],
        ueber: Partial<MapHistoryEntry> = {},
    ): MapHistoryEntry => ({
        ...gebirgsEintrag(n),
        operation,
        objects: objekte.map((o) => ({
            kind: o.kind,
            id: o.id,
            name: "Name",
            action: o.action,
            revisionBefore: 1,
            revisionAfter: 2,
            changes: o.changes ?? { title: { before: "A", after: "B" } },
        })),
        ...ueber,
    });

    it("🔴 die Adressen: Vorschau und Rücknahme hängen an der Quelle, am Werk und am Korpus des Fensters „Inhalte bearbeiten“", () => {
        expect(vorschauUrl({ familie: "source", id: QUELLE })).toBe(
            `/api/editor/inhalte/quellen/${QUELLE}/restore-series/preview`,
        );
        expect(ruecknahmeUrl({ familie: "source", id: QUELLE })).toBe(
            `/api/editor/inhalte/quellen/${QUELLE}/restore-series`,
        );
        expect(vorschauUrl({ familie: "work", id: WERK_ID })).toBe(
            `/api/editor/inhalte/literatur/${WERK_ID}/restore-series/preview`,
        );
        expect(ruecknahmeUrl({ familie: "work", id: WERK_ID })).toBe(
            `/api/editor/inhalte/literatur/${WERK_ID}/restore-series`,
        );
        expect(vorschauUrl({ familie: "corpus", id: KORPUS })).toBe(
            `/api/editor/inhalte/korpora/${KORPUS}/restore-series/preview`,
        );
        expect(ruecknahmeUrl({ familie: "corpus", id: KORPUS })).toBe(
            `/api/editor/inhalte/korpora/${KORPUS}/restore-series`,
        );
    });

    it("🔴 ↺ erscheint für Änderungen von Quelle, Werk und Korpus (auch ihre Rücknahme) und trägt die Adresse des Gegenstands", () => {
        const restore = { source: "restore" } as const;
        const faelle: [string, MapHistoryEntry, string, string][] = [
            [
                "source.update",
                eintrag(1, "source.update", [{ kind: "source", id: QUELLE, action: "source.updated" }]),
                "source",
                QUELLE,
            ],
            [
                "source.restore_series",
                eintrag(
                    1,
                    "source.restore_series",
                    [{ kind: "source", id: QUELLE, action: "source.updated" }],
                    restore,
                ),
                "source",
                QUELLE,
            ],
            [
                "work.update",
                eintrag(1, "work.update", [{ kind: "work", id: WERK_ID, action: "work.updated" }]),
                "work",
                WERK_ID,
            ],
            [
                "work.restore_series",
                eintrag(1, "work.restore_series", [{ kind: "work", id: WERK_ID, action: "work.updated" }], restore),
                "work",
                WERK_ID,
            ],
            [
                "corpus.update",
                eintrag(1, "corpus.update", [{ kind: "corpus", id: KORPUS, action: "corpus.updated" }]),
                "corpus",
                KORPUS,
            ],
            [
                "corpus.restore_series",
                eintrag(
                    1,
                    "corpus.restore_series",
                    [{ kind: "corpus", id: KORPUS, action: "corpus.updated" }],
                    restore,
                ),
                "corpus",
                KORPUS,
            ],
        ];
        for (const [name, e, familie, gegenstand] of faelle) {
            expect(ruecknahmeFamilie(e), name).toBe(familie);
            const ziel = ruecknahmeZiel(e);
            expect(ziel, name).toEqual({ familie, id: gegenstand });
            const angebot = angebotEinzeln(e, ziel);
            expect(angebot?.sperre, name).toBeUndefined();
            expect(angebot?.mitglieder, name).toEqual([e.operationId]);
        }
    });

    it("🔴 B8d: das Anlegen hat ein ↺ (Stilllegen), in der Familie seiner Art; die Verwendungen einer Quelle (`links`, auch am Weg) gehen seit B6g3 mit zurück", () => {
        for (const [operation, kind, aktion, familie] of [
            ["source.create", "source", "source.created", "source"],
            ["work.create", "work", "work.created", "work"],
            ["corpus.create", "corpus", "corpus.created", "corpus"],
            ["lore.create", "lore", "lore.created", "lore"],
        ] as const) {
            const angelegt = eintrag(1, operation, [{ kind, id: QUELLE, action: aktion }]);
            expect(ruecknahmeFamilie(angelegt), operation).toBe(familie);
            expect(ruecknahmeZiel(angelegt), operation).toEqual({ familie, id: QUELLE });
        }
        // Eine Aktion einer anderen Art unter dem Namen des Anlegens gehört nicht dazu.
        expect(
            ruecknahmeFamilie(eintrag(1, "source.create", [{ kind: "work", id: QUELLE, action: "work.created" }])),
        ).toBeUndefined();
        // `source.update`, das auch die Verwendungen an Trägern berührt (B6g3): dieselbe Familie, dieselbe Adresse.
        const mitLinks = eintrag(1, "source.update", [
            {
                kind: "source",
                id: QUELLE,
                action: "source.updated",
                changes: { title: { before: "A", after: "B" }, links: { before: [], after: [{ kind: "place" }] } },
            },
        ]);
        expect(ruecknahmeFamilie(mitLinks)).toBe("source");
        expect(ruecknahmeZiel(mitLinks)).toEqual({ familie: "source", id: QUELLE });
        // Berührt es die Straße eines Wegs, steht `path.sources_changed` im Protokoll; die Adresse bleibt die Quelle, nie der Weg.
        const amWeg = eintrag(1, "source.update", [
            { kind: "source", id: QUELLE, action: "source.updated" },
            { kind: "path", id: WEG, action: "path.sources_changed" },
        ]);
        expect(ruecknahmeFamilie(amWeg)).toBe("source");
        expect(ruecknahmeZiel(amWeg)).toEqual({ familie: "source", id: QUELLE });
        // `path.sources_changed` allein unter `source.update` ist keine Änderung der Quelle.
        expect(
            ruecknahmeFamilie(eintrag(1, "source.update", [{ kind: "path", id: WEG, action: "path.sources_changed" }])),
        ).toBeUndefined();
        // Die Aktion einer anderen Art unter `source.update` gehört nicht dazu.
        expect(
            ruecknahmeFamilie(eintrag(1, "source.update", [{ kind: "work", id: WERK_ID, action: "work.updated" }])),
        ).toBeUndefined();
    });

    it("🔴 eine Serie von Änderungen am Werk geht als Ganzes: die ganze Mitgliederliste mit Prüfsumme, ohne Sperre", () => {
        const mitglieder = [3, 2, 1].map((n) =>
            eintrag(n, "work.update", [{ kind: "work", id: WERK_ID, action: "work.updated" }], {
                series: { id: id(1), position: n, size: 3 },
            }),
        );
        const members = [...mitglieder].reverse().map((m) => m.operationId);
        const zeile: SerienZeile = {
            art: "serie",
            id: id(1),
            meta: {
                id: id(1),
                size: 3,
                delivered: 3,
                members,
                membersHash: "h".repeat(64),
                scope: { kind: "work", id: WERK_ID },
            },
            mitglieder,
        };
        const ziel = ruecknahmeZiel(mitglieder[0]!);
        expect(ziel).toEqual({ familie: "work", id: WERK_ID });
        const angebot = angebotSerie(zeile, ziel);
        expect(angebot?.sperre).toBeUndefined();
        expect(angebot?.modus).toBe("serie");
        expect(angebot?.mitglieder).toEqual(members);
        expect(angebot?.membersHash).toBe("h".repeat(64));
    });

    it("die Vorgangsnamen der Rücknahme in allen Sprachen: kein Schlüssel, kein Punkt", () => {
        for (const sprache of ["de", "en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            for (const operation of ["source.restore_series", "work.restore_series", "corpus.restore_series"]) {
                const text = vorgangName(operation);
                expect(text, `${sprache} ${operation}`).toBeTruthy();
                expect(text, `${sprache} ${operation}`).not.toMatch(/\.|aenderungen\./u);
            }
        }
        setLocale("de");
    });
});

describe("B6g2: Vorkommen zurücknehmen (Felder, Ortszeilen, Quellen, Regeln und „Regeln als Text“ über den Server)", () => {
    const EINTRAG = "b5c00000-0000-4000-8000-0000000000d1";
    const EINTRAG2 = "b5c00000-0000-4000-8000-0000000000d2";
    const lore = (
        n: number,
        operation: string,
        objekte: { id: string; action: string; changes?: Record<string, { before?: unknown; after?: unknown }> }[],
        ueber: Partial<MapHistoryEntry> = {},
    ): MapHistoryEntry => ({
        ...gebirgsEintrag(n),
        operation,
        objects: objekte.map((o) => ({
            kind: "lore" as const,
            id: o.id,
            name: "Alraune",
            action: o.action,
            revisionBefore: 1,
            revisionAfter: 2,
            changes: o.changes ?? { name: { before: "A", after: "B" } },
        })),
        ...ueber,
    });

    it("🔴 die Adressen: Vorschau und Rücknahme hängen am Eintrag des Reiters „Vorkommen“", () => {
        expect(vorschauUrl({ familie: "lore", id: EINTRAG })).toBe(
            `/api/editor/inhalte/vorkommen/${EINTRAG}/restore-series/preview`,
        );
        expect(ruecknahmeUrl({ familie: "lore", id: EINTRAG })).toBe(
            `/api/editor/inhalte/vorkommen/${EINTRAG}/restore-series`,
        );
    });

    it("🔴 ↺ erscheint für Änderungen am Vorkommen und „Regeln als Text“ (auch ihre Rücknahme) und trägt die Adresse des Eintrags", () => {
        const faelle: [string, MapHistoryEntry][] = [
            ["lore.update", lore(1, "lore.update", [{ id: EINTRAG, action: "lore.updated" }])],
            ["lore.rules_text", lore(2, "lore.rules_text", [{ id: EINTRAG, action: "lore.rules_text" }])],
            [
                "lore.restore_series",
                lore(3, "lore.restore_series", [{ id: EINTRAG, action: "lore.updated" }], { source: "restore" }),
            ],
        ];
        for (const [name, e] of faelle) {
            expect(ruecknahmeFamilie(e), name).toBe("lore");
            const ziel = ruecknahmeZiel(e);
            expect(ziel, name).toEqual({ familie: "lore", id: EINTRAG });
            const angebot = angebotEinzeln(e, ziel);
            expect(angebot?.sperre, name).toBeUndefined();
            expect(angebot?.mitglieder, name).toEqual([e.operationId]);
        }
    });

    it("🔴 „Regeln als Text“ über mehrere Einträge: EINE Rücknahme, die Adresse ist einer der Einträge (der erste)", () => {
        const mehrere = lore(4, "lore.rules_text", [
            { id: EINTRAG2, action: "lore.rules_text" },
            { id: EINTRAG, action: "lore.rules_text" },
        ]);
        expect(ruecknahmeFamilie(mehrere)).toBe("lore");
        expect(ruecknahmeZiel(mehrere)).toEqual({ familie: "lore", id: EINTRAG2 });
        expect(angebotEinzeln(mehrere, ruecknahmeZiel(mehrere))?.mitglieder).toEqual([mehrere.operationId]);
    });

    it("🔴 B8d: das Anlegen und ein Eintrag, den „Regeln als Text“ anlegte (Aktion `lore.created`), haben ein ↺ (Stilllegen)", () => {
        expect(
            ruecknahmeFamilie(lore(1, "lore.create", [{ id: EINTRAG, action: "lore.created" }])),
            "lore.create",
        ).toBe("lore");
        // Eine Übernahme, die auch einen neuen Eintrag anlegte: der Server nimmt auch sie zurück (der neue Eintrag wird stillgelegt).
        const mitNeuem = lore(2, "lore.rules_text", [
            { id: EINTRAG, action: "lore.rules_text" },
            { id: EINTRAG2, action: "lore.created" },
        ]);
        expect(ruecknahmeFamilie(mitNeuem)).toBe("lore");
        // Die Übernahme der Regeln des WikiSync gehört nicht dazu (eigener Weg, Quelle wikisync).
        expect(
            ruecknahmeFamilie(lore(3, "lore.rules_wikisync", [{ id: EINTRAG, action: "lore.rules_wikisync" }])),
        ).toBeUndefined();
    });

    it("🔴 eine Serie von Änderungen am Vorkommen geht als Ganzes: die ganze Mitgliederliste mit Prüfsumme, ohne Sperre", () => {
        const mitglieder = [3, 2, 1].map((n) =>
            lore(n, "lore.update", [{ id: EINTRAG, action: "lore.updated" }], {
                series: { id: id(1), position: n, size: 3 },
            }),
        );
        const members = [...mitglieder].reverse().map((m) => m.operationId);
        const zeile: SerienZeile = {
            art: "serie",
            id: id(1),
            meta: {
                id: id(1),
                size: 3,
                delivered: 3,
                members,
                membersHash: "h".repeat(64),
                scope: { kind: "lore", id: EINTRAG },
            },
            mitglieder,
        };
        const ziel = ruecknahmeZiel(mitglieder[0]!);
        expect(ziel).toEqual({ familie: "lore", id: EINTRAG });
        const angebot = angebotSerie(zeile, ziel);
        expect(angebot?.sperre).toBeUndefined();
        expect(angebot?.modus).toBe("serie");
        expect(angebot?.mitglieder).toEqual(members);
        expect(angebot?.membersHash).toBe("h".repeat(64));
    });

    it("die Vorgangsnamen der Rücknahme am Vorkommen in allen Sprachen: kein Schlüssel, kein Punkt", () => {
        for (const sprache of ["de", "en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            const text = vorgangName("lore.restore_series");
            expect(text, sprache).toBeTruthy();
            expect(text, sprache).not.toMatch(/\.|aenderungen\./u);
        }
        setLocale("de");
    });
});

describe("B8c: Anlegen an Derographie, Gipfel und Sprache über den Server", () => {
    const REGION = "b8c00000-0000-4000-8000-000000000001";
    const TEIL = "b8c00000-0000-4000-8000-0000000000a1";
    const BESCHRIFTUNG = "b8c00000-0000-4000-8000-0000000000b1";
    const SPRACHE = "b8c00000-0000-4000-8000-000000000002";
    const SPRACHTEIL = "b8c00000-0000-4000-8000-0000000000c1";
    const PEAK = "b8c00000-0000-4000-8000-0000000000d1";

    type Objekt = {
        kind: string;
        id: string;
        action: string;
        landscape?: { id: string };
        sprache?: { id: string };
    };
    const eintragMit = (
        n: number,
        operation: string,
        objekte: Objekt[],
        ueber: Partial<MapHistoryEntry> = {},
    ): MapHistoryEntry => ({
        ...gebirgsEintrag(n),
        operation,
        objects: objekte.map((o) => ({
            kind: o.kind as MapHistoryEntry["objects"][number]["kind"],
            id: o.id,
            name: "Name",
            action: o.action,
            revisionBefore: null,
            revisionAfter: 1,
            changes: {},
            ...(o.landscape === undefined ? {} : { landscape: o.landscape }),
            ...(o.sprache === undefined ? {} : { sprache: o.sprache }),
        })),
        ...ueber,
    });

    it("🔴 die Familie und die Adresse: Fläche anlegen (Landschaft und Teilfläche), Beschriftung anlegen und löschen, Gipfel setzen, Sprache und Teilfläche anlegen, Kopie aus der Derographie", () => {
        const faelle: [MapHistoryEntry, string, string][] = [
            [
                eintragMit(1, "landscape.create", [
                    { kind: "landscape", id: REGION, action: "region.created" },
                    { kind: "area", id: TEIL, action: "area.created", landscape: { id: REGION } },
                ]),
                "landscape",
                REGION,
            ],
            [
                eintragMit(2, "label.create", [
                    { kind: "label", id: BESCHRIFTUNG, action: "label.created", landscape: { id: REGION } },
                ]),
                "landscape",
                REGION,
            ],
            [
                eintragMit(3, "label.retire", [
                    { kind: "label", id: BESCHRIFTUNG, action: "label.retired", landscape: { id: REGION } },
                ]),
                "landscape",
                REGION,
            ],
            [eintragMit(4, "peak.create", [{ kind: "peak", id: PEAK, action: "peak.created" }]), "peak", PEAK],
            // Die Quellen eines Gipfels oder einer Landmarke teilen seine Serie (WI-0271 L4).
            [
                eintragMit(11, "traeger.sources", [{ kind: "peak", id: PEAK, action: "peak.sources_changed" }]),
                "peak",
                PEAK,
            ],
            [
                eintragMit(5, "sprache.create", [{ kind: "sprache", id: SPRACHE, action: "sprache.created" }]),
                "sprache",
                SPRACHE,
            ],
            // Das Wiki-Artikel-Nehmen beim Anlegen schreibt eine Zeile an der Sprache, der er genommen wurde.
            [
                eintragMit(6, "sprache.create", [
                    { kind: "sprache", id: SPRACHE, action: "sprache.created" },
                    { kind: "sprache", id: id(900), action: "sprache.wiki_changed" },
                ]),
                "sprache",
                SPRACHE,
            ],
            [
                eintragMit(7, "sprache_flaeche.create", [
                    {
                        kind: "sprache_flaeche",
                        id: SPRACHTEIL,
                        action: "sprache_flaeche.created",
                        sprache: { id: SPRACHE },
                    },
                ]),
                "sprache",
                SPRACHE,
            ],
            [
                eintragMit(8, "sprache.flaeche_aus_landschaft", [
                    { kind: "sprache", id: SPRACHE, action: "sprache.created" },
                    {
                        kind: "sprache_flaeche",
                        id: SPRACHTEIL,
                        action: "sprache_flaeche.copied",
                        sprache: { id: SPRACHE },
                    },
                ]),
                "sprache",
                SPRACHE,
            ],
        ];
        for (const [eintrag, familie, ziel] of faelle) {
            expect(ruecknahmeFamilie(eintrag), eintrag.operation).toBe(familie);
            expect(ruecknahmeZiel(eintrag), eintrag.operation).toEqual({ familie, id: ziel });
            const angebot = angebotEinzeln(eintrag, ruecknahmeZiel(eintrag));
            expect(angebot?.sperre, eintrag.operation).toBeUndefined();
            expect(angebot?.mitglieder).toEqual([eintrag.operationId]);
        }
        // Die Rücknahme eines Anlegens schreibt `*.retired` unter dem Namen der Rücknahme: auch sie hat ihr ↺.
        expect(
            ruecknahmeFamilie(
                eintragMit(9, "landscape.restore_series", [
                    { kind: "landscape", id: REGION, action: "region.retired" },
                    { kind: "area", id: TEIL, action: "area.retired", landscape: { id: REGION } },
                ]),
            ),
        ).toBe("landscape");
        expect(
            ruecknahmeFamilie(
                eintragMit(10, "sprache.restore_series", [{ kind: "sprache", id: SPRACHE, action: "sprache.retired" }]),
            ),
        ).toBe("sprache");
    });

    it("🔴 Betreiberläufe und das Anlegen fremder Arten bleiben ohne Familie: `area.gebirge_startwerte`, `place.create`, `media.create`", () => {
        const startwerte = eintragMit(1, "area.gebirge_startwerte", [
            { kind: "area", id: TEIL, action: "area.gebirge", landscape: { id: REGION } },
        ]);
        expect(ruecknahmeFamilie(startwerte)).toBeUndefined();
        expect(ruecknahmeZiel(startwerte)).toBeUndefined();
        expect(angebotEinzeln(startwerte, ruecknahmeZiel(startwerte))).toBeUndefined();
        // Eine Aktion einer anderen Art unter dem Namen des Anlegens gehört nicht dazu.
        expect(
            ruecknahmeFamilie(eintragMit(2, "peak.create", [{ kind: "place", id: ORT, action: "place.created" }])),
        ).not.toBe("peak");
        expect(
            ruecknahmeFamilie(eintragMit(3, "media.create", [{ kind: "source", id: ORT, action: "media.created" }])),
        ).toBeUndefined();
    });

    it("🔴 Anlegen, Umbenennen und Beschriften derselben Fläche ist EINE Serie: das ↺ der Serie ist angeboten, ohne Sperre", () => {
        const operationen: [string, Objekt[]][] = [
            [
                "landscape.create",
                [
                    { kind: "landscape", id: REGION, action: "region.created" },
                    { kind: "area", id: TEIL, action: "area.created", landscape: { id: REGION } },
                ],
            ],
            ["landscape.update", [{ kind: "landscape", id: REGION, action: "region.updated" }]],
            ["label.create", [{ kind: "label", id: BESCHRIFTUNG, action: "label.created", landscape: { id: REGION } }]],
        ];
        const mitglieder = operationen
            .map(([operation, objekte], i) =>
                eintragMit(i + 1, operation, objekte, { series: { id: id(70), position: i + 1, size: 3 } }),
            )
            .reverse();
        const meta: MapHistorySeries = {
            id: id(70),
            size: 3,
            delivered: 3,
            members: mitglieder.map((m) => m.operationId).reverse(),
            membersHash: "b".repeat(64),
            scope: { kind: "landscape", id: REGION, name: "Neue Fläche" },
        };
        const zeile = gruppiere(mitglieder, new Map([[meta.id, meta]]))[0]! as Extract<
            ReturnType<typeof gruppiere>[number],
            { art: "serie" }
        >;
        const angebot = angebotSerie(zeile, ruecknahmeZiel(mitglieder[0]!, meta));
        expect(angebot?.sperre).toBeUndefined();
        expect(angebot?.modus).toBe("serie");
        expect(angebot?.mitglieder).toEqual(meta.members);
        expect(angebot?.offen).toBe(3);
    });

    it("🔴 der Konflikt einer Sprachkopie heißt „Kopiert aus“, nie der rohe Schlüssel; „Konflikt prüfen“ führt zur Sprache", () => {
        const konflikt = {
            art: "wert",
            kind: "sprache",
            id: SPRACHE,
            name: "Thorwalsch",
            felder: ["kopiertAus"],
            abweichung: { was: "felder" },
        } as RuecknahmeKonflikt;
        const zeilen = konfliktZeilen([konflikt], konfliktFeldName);
        expect(zeilen[0]!.objekt).toBe("Thorwalsch");
        expect(zeilen[0]!.satz).toContain("Kopiert aus");
        expect(zeilen[0]!.satz).not.toContain("kopiertAus");
        expect(konfliktGegenstand(konflikt, { familie: "landscape", id: REGION })).toEqual({
            kind: "sprache",
            id: SPRACHE,
            name: "Thorwalsch",
        });
    });

    it("die Vorgangsnamen des Anlegens und Löschens in allen Sprachen: kein Schlüssel, kein Punkt", () => {
        for (const sprache of ["de", "en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            for (const operation of [
                "landscape.create",
                "label.create",
                "label.retire",
                "peak.create",
                "sprache.create",
                "sprache_flaeche.create",
                "sprache.flaeche_aus_landschaft",
            ]) {
                const text = vorgangName(operation);
                expect(text, `${sprache} ${operation}`).toBeTruthy();
                expect(text, `${sprache} ${operation}`).not.toMatch(/\.|aenderungen\./u);
            }
        }
        setLocale("de");
    });
});

describe("B8d: Wiki-Box zurücknehmen (Zuweisen und Entfernen als Einzeleintrag, eine Adresse je Art der Box)", () => {
    const box = (
        n: number,
        operation: string,
        kind: MapHistoryEntry["objects"][number]["kind"],
        aktion: string,
        ids: string[],
        ueber: Partial<MapHistoryEntry> = {},
    ): MapHistoryEntry => ({
        ...gebirgsEintrag(n),
        operation,
        objects: ids.map((objektId) => ({
            kind,
            id: objektId,
            name: "Träger",
            action: aktion,
            revisionBefore: 1,
            revisionAfter: 2,
            changes: { wiki: { before: "a", after: "b" } },
        })),
        ...ueber,
    });

    it("🔴 die sechs Arten haben eine Familie `wikibox` und eine Adresse mit ihrer Art; beim Weg und bei der Kraftlinie genügt irgendein Abschnitt", () => {
        for (const [kind, aktion, art] of [
            ["place", "place.wiki_zugewiesen", "ort"],
            ["path", "path.wiki_zugewiesen", "weg"],
            ["territory", "territory.wiki_entfernt", "gebiet"],
            ["landscape", "region.wiki_zugewiesen", "region"],
            ["powerline", "powerline.wiki_entfernt", "kraftlinie"],
            ["peak", "peak.wiki_zugewiesen", "gipfel"],
        ] as const) {
            const eintrag = box(
                1,
                aktion.endsWith("entfernt") ? "wikibox.entfernen" : "wikibox.zuweisen",
                kind,
                aktion,
                [ORT2, ORT],
            );
            expect(ruecknahmeFamilie(eintrag), aktion).toBe("wikibox");
            const ziel = ruecknahmeZiel(eintrag);
            expect(ziel, aktion).toEqual({ familie: "wikibox", id: ORT2, art });
            expect(vorschauUrl(ziel!)).toBe(`/api/editor/wiki-box/${art}/${ORT2}/restore-series/preview`);
            expect(ruecknahmeUrl(ziel!)).toBe(`/api/editor/wiki-box/${art}/${ORT2}/restore-series`);
        }
        // Die Rücknahme selbst ist dieselbe Familie (für die Rücknahme der Rücknahme).
        expect(
            ruecknahmeFamilie(
                box(2, "wikibox.restore_series", "place", "place.wiki_zugewiesen", [ORT], { source: "restore" }),
            ),
        ).toBe("wikibox");
    });

    it("🔴 weitere Artikel eines Wegs (WI-0300): Zuweisen und Lösen sind dieselbe Familie, die Art bleibt `weg`", () => {
        for (const [operation, aktion] of [
            ["wikibox.weitere_zuweisen", "path.wiki_weitere_zugewiesen"],
            ["wikibox.weitere_entfernen", "path.wiki_weitere_entfernt"],
        ] as const) {
            const eintrag = box(1, operation, "path", aktion, [ORT2, ORT]);
            expect(ruecknahmeFamilie(eintrag), aktion).toBe("wikibox");
            expect(ruecknahmeZiel(eintrag), aktion).toEqual({ familie: "wikibox", id: ORT2, art: "weg" });
        }
    });

    it("🔴 Aktionen einer anderen Art oder eines anderen Namens gehören nicht dazu (kein ↺ ohne Adresse)", () => {
        expect(ruecknahmeFamilie(box(1, "wikibox.zuweisen", "place", "place.updated", [ORT]))).toBeUndefined();
        expect(ruecknahmeFamilie(box(2, "place.update", "place", "place.wiki_zugewiesen", [ORT]))).toBeUndefined();
        // Die Zuweisung des WikiSync an Flächen (Quelle `wikisync`, `region.wiki_zugewiesen`) trägt einen anderen Namen.
        expect(
            ruecknahmeFamilie(box(3, "wikisync.region_zuweisen", "landscape", "region.wiki_zugewiesen", [FLAECHE])),
        ).toBeUndefined();
    });

    it("🔴 ein Schritt der Box ist ein Einzeleintrag: das ↺ gilt genau ihm; zurückgenommen ist es gesperrt, ein Schritt davor nicht ohne Weiteres (der Server prüft streng)", () => {
        const offen = box(1, "wikibox.zuweisen", "place", "place.wiki_zugewiesen", [ORT]);
        const angebot = angebotEinzeln(offen, ruecknahmeZiel(offen))!;
        expect(angebot.modus).toBe("einzeln");
        expect(angebot.mitglieder).toEqual([offen.operationId]);
        expect(angebot.offen).toBe(1);
        expect(angebot.sperre).toBeUndefined();
        const zurueck = box(2, "wikibox.entfernen", "place", "place.wiki_entfernt", [ORT], {
            status: "bereits_zurueckgenommen",
        });
        expect(angebotEinzeln(zurueck, ruecknahmeZiel(zurueck))!.sperre).toEqual({ art: "zurueck" });
    });

    it("🔴 die Sätze zu den Abweichungen der Box stehen in allen neun Sprachen und nennen weder Schlüssel noch Punkt", () => {
        for (const sprache of ["de", "en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            for (const was of ["wikibox_artikel", "wikibox_teilweise", "inhalt_verwendet"] as const) {
                const konflikt: RuecknahmeKonflikt = {
                    art: "wert",
                    kind: "place",
                    id: ORT,
                    felder: ["wiki"],
                    abweichung: { was },
                };
                const zeilen = konfliktZeilen([konflikt], konfliktFeldName);
                expect(zeilen[0]!.satz, `${sprache} ${was}`).toBeTruthy();
                expect(zeilen[0]!.satz, `${sprache} ${was}`).not.toMatch(/aenderungen\.|wikibox_/u);
            }
        }
        setLocale("de");
    });
});

describe("B8d: Übernahmen des WikiSync zurücknehmen (genau die Rücknahme des WikiSync, Passkey, Auftrag)", () => {
    const UEBERNAHME = id(900);
    const wiki = (
        n: number,
        operation: string,
        ueber: Partial<MapHistoryEntry> = {},
        aktion = "place.wikisync_uebernommen",
    ): MapHistoryEntry => ({
        ...gebirgsEintrag(n),
        operationId: n === 900 ? UEBERNAHME : id(n),
        operation,
        source: "wikisync",
        objects: [
            {
                kind: "place",
                id: ORT,
                name: "Gareth",
                action: aktion,
                revisionBefore: 1,
                revisionAfter: 2,
                changes: { name: { before: "A", after: "B" } },
            },
        ],
        ...ueber,
    });

    it("🔴 die Übernahme eines Laufs und von Regelvorschlägen und ihre Rücknahmen haben die Familie `wikisync` und als Adresse die Operation selbst; der Sync eines Objekts und die Zuweisung einer Fläche (B8e) die Familie `wikisyncschritt`; die Rücknahme der Zuweisung keine", () => {
        for (const operation of [
            "wikisync.uebernehmen",
            "lore.rules_wikisync",
            "wikisync.zuruecknehmen",
            "lore.rules_wikisync_undo",
            "lore.rules_wikisync_redo",
        ]) {
            const eintrag = wiki(900, operation, { status: "ruecknehmbar" });
            expect(ruecknahmeFamilie(eintrag), operation).toBe("wikisync");
            expect(ruecknahmeZiel(eintrag), operation).toEqual({ familie: "wikisync", id: UEBERNAHME });
        }
        for (const operation of [
            "wikisync.objekt_sync",
            "wikisync.objekt_zuruecknehmen",
            "wikisync.flaeche_zuweisen",
            "wikisync.flaeche_zuruecknehmen",
            "wikisync.flaeche_wiederherstellen",
        ]) {
            const eintrag = wiki(900, operation, { status: "ruecknehmbar" });
            expect(ruecknahmeFamilie(eintrag), operation).toBe("wikisyncschritt");
            expect(ruecknahmeZiel(eintrag), operation).toEqual({ familie: "wikisyncschritt", id: UEBERNAHME });
        }
        for (const operation of ["wikisync.region_zuweisen"]) {
            const eintrag = wiki(901, operation, { status: "nicht_ruecknehmbar", statusReason: "art" });
            expect(ruecknahmeFamilie(eintrag), operation).toBeUndefined();
            expect(ruecknahmeZiel(eintrag), operation).toBeUndefined();
        }
        // Dieselben Operationen aus einer anderen Quelle sind keine Übernahme des WikiSync.
        expect(ruecknahmeFamilie(wiki(902, "wikisync.uebernehmen", { source: "import" }))).toBeUndefined();
    });

    it("🔴 die Adressen: Vorschau und Rücknahme hängen an der Operation der Übernahme; die Schritte des Editors haben eine eigene Route", () => {
        const ziel = { familie: "wikisync", id: UEBERNAHME } as const;
        expect(vorschauUrl(ziel)).toBe(`/api/editor/wikisync/${UEBERNAHME}/restore-series/preview`);
        expect(ruecknahmeUrl(ziel)).toBe(`/api/editor/wikisync/${UEBERNAHME}/restore-series`);
        const schritt = { familie: "wikisyncschritt", id: UEBERNAHME } as const;
        expect(vorschauUrl(schritt)).toBe(`/api/editor/wikisync-schritt/${UEBERNAHME}/restore-series/preview`);
        expect(ruecknahmeUrl(schritt)).toBe(`/api/editor/wikisync-schritt/${UEBERNAHME}/restore-series`);
    });

    it("🔴 das Angebot: eine offene Übernahme bietet das ↺ an, eine zurückgenommene sperrt es mit `zurueck`, ihre Rücknahme bietet es wieder an (B8e), die Rücknahme einer Zuweisung hat keins (Grund art)", () => {
        const offen = wiki(900, "wikisync.uebernehmen", { status: "ruecknehmbar" });
        const angebot = angebotEinzeln(offen, ruecknahmeZiel(offen))!;
        expect(angebot).toMatchObject({ modus: "einzeln", mitglieder: [UEBERNAHME], offen: 1 });
        expect(angebot.sperre).toBeUndefined();
        const zurueck = wiki(900, "wikisync.uebernehmen", { status: "bereits_zurueckgenommen" });
        expect(angebotEinzeln(zurueck, ruecknahmeZiel(zurueck))!.sperre).toEqual({ art: "zurueck" });
        const rueck = wiki(901, "wikisync.zuruecknehmen", { status: "ruecknehmbar", reverts: [UEBERNAHME] });
        expect(angebotEinzeln(rueck, ruecknahmeZiel(rueck))).toMatchObject({
            modus: "einzeln",
            mitglieder: [id(901)],
            offen: 1,
        });
        const rueckZurueck = wiki(901, "wikisync.zuruecknehmen", { status: "bereits_zurueckgenommen" });
        expect(angebotEinzeln(rueckZurueck, ruecknahmeZiel(rueckZurueck))!.sperre).toEqual({ art: "zurueck" });
        // Seit B8e2 hat auch die Rücknahme einer Zuweisung ein ↺ (stellt sie wieder her); eine Operation, die der Katalog nicht kennt, nicht.
        const zuweisungRueck = wiki(903, "wikisync.flaeche_zuruecknehmen", {
            status: "ruecknehmbar",
            reverts: [UEBERNAHME],
        });
        expect(angebotEinzeln(zuweisungRueck, ruecknahmeZiel(zuweisungRueck))).toMatchObject({
            modus: "einzeln",
            offen: 1,
        });
        const unbekannt = wiki(904, "wikisync.region_zuweisen", { status: "nicht_ruecknehmbar", statusReason: "art" });
        expect(angebotEinzeln(unbekannt, ruecknahmeZiel(unbekannt))).toBeUndefined();
    });

    it("🔴 die Rückfrage nennt vor dem Schreiben, dass der WikiSync Feld für Feld und als Auftrag zurücknimmt", () => {
        const pruefung = {
            offen: [UEBERNAHME],
            mitglieder: [
                {
                    operationId: UEBERNAHME,
                    seq: 1,
                    at: "2026-10-31T10:00:00.000Z",
                    operation: "wikisync.uebernehmen",
                    source: "wikisync",
                    actor: { kind: "person" },
                    status: "ruecknehmbar",
                    offen: true,
                    gegenstaende: [],
                },
            ],
            folgen: { gegenstaende: 12, gelaende: "keines" },
        } as unknown as Pick<RuecknahmePruefung, "mitglieder" | "offen" | "folgen">;
        for (const sprache of ["de", "en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            const zeilen = folgenZeilen(pruefung);
            expect(zeilen.length, sprache).toBeGreaterThanOrEqual(2);
            expect(zeilen.join(" "), sprache).not.toMatch(/aenderungen\./u);
        }
        setLocale("de");
        expect(folgenZeilen(pruefung).some((zeile) => zeile.includes("Feld für Feld"))).toBe(true);
    });

    it("🔴 die Rücknahme fragt bei `reauth_required` nach dem Passkey und schickt dieselbe Anfrage mit DERSELBEN Kennung noch einmal; bricht die Person ab, bleibt die Antwort des Servers", async () => {
        const body = { operationId: id(1), members: [UEBERNAHME], membersHash: "e".repeat(64) };
        const ziel = { familie: "wikisync", id: UEBERNAHME } as const;
        const aufrufe: RequestInit[] = [];
        let versuch = 0;
        const hole = ((_url: string, init: RequestInit) => {
            aufrufe.push(init);
            versuch += 1;
            return Promise.resolve(
                versuch === 1
                    ? new Response(
                          JSON.stringify({
                              error: {
                                  code: "reauth_required",
                                  message: "Bestätigung nötig",
                                  details: { need: "passkey" },
                              },
                          }),
                          { status: 403 },
                      )
                    : new Response(
                          JSON.stringify({
                              operationId: id(1),
                              status: "applied",
                              environment: "test",
                              affected: [],
                              derivedWork: [{ kind: "wiki_zuruecknehmen", jobId: id(5), state: "queued" }],
                              warnings: [],
                              reverts: [],
                          }),
                          { status: 200 },
                      ),
            );
        }) as unknown as typeof fetch;
        const gefragt: string[] = [];
        const daten = createRuecknahmeDaten(hole, (need) => {
            gefragt.push(need);
            return Promise.resolve(true);
        });
        const ok = await daten.ruecknehmen(ziel, body);
        expect(ok).toMatchObject({ ok: true, wert: { status: "applied", reverts: [] } });
        expect(gefragt).toEqual(["passkey"]);
        expect(aufrufe).toHaveLength(2);
        expect(JSON.parse(aufrufe[0]!.body as string)).toEqual(JSON.parse(aufrufe[1]!.body as string));

        versuch = 0;
        const abgebrochen = await createRuecknahmeDaten(hole, () => Promise.resolve(false)).ruecknehmen(ziel, body);
        expect(abgebrochen).toMatchObject({ ok: false, status: 403, fehler: { code: "reauth_required" } });
    });
});

describe("B8d: die Antworten der Rücknahme des WikiSync in der Sprache der Person", () => {
    it("🔴 `uebernahme_laeuft` und ein fehlender frischer Passkey sind eigene Sätze aus der Tafel, nicht der deutsche Satz des Servers; nichts ist unklar", async () => {
        for (const [code, status] of [
            ["uebernahme_laeuft", 409],
            ["reauth_required", 403],
        ] as const) {
            const d = daten([ok(pruefung())], [fehler(status, code, "Satz des Servers (deutsch)")]);
            const { s } = steuerung(d);
            await s.starte(SERIE_ANGEBOT());
            await s.bestaetige();
            const stand = s.stand.value;
            expect(stand.art, code).toBe("fehler");
            if (stand.art !== "fehler") return;
            expect(stand.satz, code).not.toContain("Satz des Servers");
            expect(stand.satz, code).not.toMatch(/aenderungen\./u);
            expect(stand.wiederholbar, code).toBe(false);
        }
    });

    it("🔴 der Auftrag: die Quittung nennt als Warnung `wikisync_auftrag`, und die Rückfrage zeigt dazu den Satz der Tafel", async () => {
        const auftrag = {
            ...quittung(),
            derivedWork: [{ kind: "wiki_zuruecknehmen", jobId: id(5), state: "queued" as const }],
            warnings: [{ code: "wikisync_auftrag", message: "Satz des Servers (deutsch)" }],
            reverts: [],
        } as RuecknahmeReceipt;
        const d = daten([ok(pruefung())], [ok(auftrag)]);
        const { s, fertig } = steuerung(d);
        await s.starte(SERIE_ANGEBOT());
        await s.bestaetige();
        const stand = s.stand.value;
        expect(stand.art).toBe("fertig");
        if (stand.art !== "fertig") return;
        expect(stand.befunde).toEqual(["Die Rücknahme läuft als Auftrag; die Liste zeigt sie, sobald er fertig ist."]);
        expect(fertig).toHaveBeenCalledTimes(1);
    });
});

describe("B8e: Rücknahme der Rücknahme, Sync eines Objekts und Zuweisung einer Fläche in „Änderungen“", () => {
    const OPERATION = id(910);
    const eintrag = (operation: string, ueber: Partial<MapHistoryEntry> = {}): MapHistoryEntry => ({
        ...gebirgsEintrag(910),
        operationId: OPERATION,
        operation,
        source: "wikisync",
        status: "ruecknehmbar",
        ...ueber,
    });
    const pruefungFuer = (operation: string): Pick<RuecknahmePruefung, "mitglieder" | "offen" | "folgen"> =>
        ({
            offen: [OPERATION],
            mitglieder: [
                {
                    operationId: OPERATION,
                    seq: 1,
                    at: "2026-11-01T10:00:00.000Z",
                    operation,
                    source: "wikisync",
                    actor: { kind: "person" },
                    status: "ruecknehmbar",
                    offen: true,
                    gegenstaende: [],
                },
            ],
            folgen: { gegenstaende: 1, gelaende: "keines" },
        }) as unknown as Pick<RuecknahmePruefung, "mitglieder" | "offen" | "folgen">;

    it("🔴 die Rückfrage nennt beim Sync eines Objekts und bei der Zuweisung einer Fläche ihren eigenen Satz, in allen neun Sprachen und nie als Schlüssel", () => {
        const erwartet: [string, MessageKey][] = [
            ["wikisync.objekt_sync", "aenderungen.ruecknahme.folgen.wikisyncObjekt"],
            ["wikisync.objekt_zuruecknehmen", "aenderungen.ruecknahme.folgen.wikisyncObjekt"],
            ["wikisync.flaeche_zuweisen", "aenderungen.ruecknahme.folgen.wikisyncFlaeche"],
            ["wikisync.flaeche_wiederherstellen", "aenderungen.ruecknahme.folgen.wikisyncFlaeche"],
            ["wikisync.flaeche_zuruecknehmen", "aenderungen.ruecknahme.folgen.wikisyncFlaecheWieder"],
        ];
        for (const sprache of ["de", "en", "fr", "es", "it", "nl", "pl", "sv", "da"] as const) {
            setLocale(sprache);
            for (const [operation, schluessel] of erwartet) {
                const zeilen = folgenZeilen(pruefungFuer(operation));
                expect(zeilen, `${sprache} ${operation}`).toContain(t(schluessel));
                expect(zeilen.join(" "), `${sprache} ${operation}`).not.toMatch(/aenderungen\./u);
            }
            // Eine Übernahme sagt weiter den Satz des Laufs, nicht den des Objekts.
            expect(folgenZeilen(pruefungFuer("wikisync.uebernehmen"))).not.toContain(
                t("aenderungen.ruecknahme.folgen.wikisyncObjekt"),
            );
        }
        setLocale("de");
    });

    it("🔴 die Antworten der Gegenrichtung und der Zuweisung sind eigene Sätze aus der Tafel, nicht der deutsche Satz des Servers", async () => {
        for (const [code, status] of [
            ["nichts_wiederherzustellen", 409],
            ["nicht_zurueckgenommen", 409],
            ["nicht_zuruecknehmbar", 409],
            ["nicht_wiederherstellbar", 409],
        ] as const) {
            const d = daten([ok(pruefung())], [fehler(status, code, "Satz des Servers (deutsch)")]);
            const { s } = steuerung(d);
            await s.starte(SERIE_ANGEBOT());
            await s.bestaetige();
            const stand = s.stand.value;
            expect(stand.art, code).toBe("fehler");
            if (stand.art !== "fehler") return;
            expect(stand.satz, code).not.toContain("Satz des Servers");
            expect(stand.satz, code).not.toMatch(/aenderungen\./u);
            expect(stand.wiederholbar, code).toBe(false);
        }
    });

    it("🔴 der Status einer Rücknahme des WikiSync ist rücknehmbar oder zurückgenommen wie jede Operation: das Angebot folgt ihm", () => {
        for (const operation of [
            "wikisync.zuruecknehmen",
            "lore.rules_wikisync_undo",
            "lore.rules_wikisync_redo",
            "wikisync.objekt_zuruecknehmen",
        ]) {
            const offen = eintrag(operation);
            expect(angebotEinzeln(offen, ruecknahmeZiel(offen)), operation).toMatchObject({
                modus: "einzeln",
                offen: 1,
            });
            const zurueck = eintrag(operation, { status: "bereits_zurueckgenommen" });
            expect(angebotEinzeln(zurueck, ruecknahmeZiel(zurueck))!.sperre, operation).toEqual({ art: "zurueck" });
        }
    });
});
