import { effectScope, nextTick } from "vue";
import { beforeEach, describe, expect, it } from "vitest";
import type { MapHistoryEntry, MapHistorySeries } from "@avesmaps3d/shared";
import {
    angebotEinzeln,
    angebotSerie,
    gebietArt,
    ortArt,
    ruecknahmeFamilie,
    ruecknahmeZiel,
    wegArt,
} from "../src/aenderungen/aenderung-ruecknahme";
import { gruppiere, type SerienZeile } from "../src/aenderungen/aenderung-modell";
import { nichtRuecknehmbarSatz } from "../src/aenderungen/aenderung-text";
import { setLocale, t } from "../src/i18n/i18n";
import {
    betrifftKlappbox,
    liesNeuBeiMeldung,
    meldeTraegerQuellen,
    traegerQuellenMeldung,
} from "../src/fenster/traeger-quellen-melde";

/**
 * Die Quellen eines Orts, Gebiets, einer Landschaft und eines Wegs zurücknehmen (WI-0265 B6g3): Sie gehören zur Familie ihres Trägers und teilen dessen Serie; die Oberfläche bietet das ↺ dort an, wo der
 * Server es kennt (`traeger.sources`, Aktion `<art>.sources_changed`), und eine offene Klappbox liest ihre Quellen nach einer Rücknahme neu. Ohne Bauteil und ohne Server; die Antworten des Servers prüft
 * `apps/server/test/ruecknahme-traeger-quellen.test.ts`.
 *
 * Problemfälle: Die Quellen eines Orts haben kein ↺ (ein Satz „Inhalte werden noch nicht zurückgenommen“ steht da); Felder und Quellen desselben Orts sind keine gemeinsame Serie, oder ein Verschieben darin
 * geht doch in die Serie; die Aktion eines anderen Trägers wird als Quelle dieses Trägers gelesen (ein Ort unter der Adresse eines Wegs); die Klappbox eines anderen Objekts liest neu, oder die offene
 * Klappbox bleibt auf dem alten Stand.
 */

const ORT = "b6930000-0000-4000-8000-000000000001";
const GEBIET = "b6930000-0000-4000-8000-000000000002";
const LANDSCHAFT = "b6930000-0000-4000-8000-000000000003";
const WEG = "b6930000-0000-4000-8000-000000000004";
const GIPFEL = "b6930000-0000-4000-8000-000000000005";
const id = (n: number): string => `b6930693-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

type Art = "place" | "territory" | "landscape" | "path";
const AKTION: Readonly<Record<Art, string>> = {
    place: "place.sources_changed",
    territory: "territory.sources_changed",
    landscape: "region.sources_changed",
    path: "path.sources_changed",
};
const TRAEGER: Readonly<Record<Art, string>> = { place: ORT, territory: GEBIET, landscape: LANDSCHAFT, path: WEG };

const grundEintrag = (n: number, ueber: Partial<MapHistoryEntry> = {}): MapHistoryEntry => ({
    operationId: id(n),
    seq: n,
    at: `2026-10-31T10:${String(n).padStart(2, "0")}:00.000Z`,
    operation: "traeger.sources",
    source: "editor",
    actor: { kind: "person", id: "p-vali", name: "Vali", self: true },
    objects: [],
    status: "ruecknehmbar",
    ...ueber,
});

/** Die Quellen eines Trägers (`traeger.sources`): ohne Revision, `changes.quellen`. */
const quellen = (n: number, art: Art, ueber: Partial<MapHistoryEntry> = {}): MapHistoryEntry =>
    grundEintrag(n, {
        objects: [
            {
                kind: art,
                id: TRAEGER[art],
                name: "Name",
                action: AKTION[art],
                revisionBefore: null,
                revisionAfter: null,
                changes: { quellen: { before: [], after: [] } },
            },
        ],
        ...ueber,
    });

const FELDER_OPERATION = { place: "place.update", territory: "territory.update", path: "path.update" } as const;
const FELDER_AKTION = { place: "place.updated", territory: "territory.updated", path: "path.updated" } as const;
/** Die Felder des Trägers (`<art>.update`). */
const felder = (n: number, art: "place" | "territory" | "path", ueber: Partial<MapHistoryEntry> = {}) =>
    grundEintrag(n, {
        operation: FELDER_OPERATION[art],
        objects: [
            {
                kind: art,
                id: TRAEGER[art],
                name: "Name",
                action: FELDER_AKTION[art],
                revisionBefore: 1,
                revisionAfter: 2,
                changes: { name: { before: "A", after: "B" } },
            },
        ],
        ...ueber,
    });

/** Ein Verschieben des Orts samt Wegende (geht nur allein). */
const verschieben = (n: number, ueber: Partial<MapHistoryEntry> = {}) =>
    grundEintrag(n, {
        operation: "place.move",
        objects: [
            {
                kind: "place",
                id: ORT,
                name: "Name",
                action: "place.moved",
                revisionBefore: 1,
                revisionAfter: 2,
                changes: {},
            },
            {
                kind: "path",
                id: WEG,
                name: "Name",
                action: "path.endpoint_moved",
                revisionBefore: 1,
                revisionAfter: 2,
                changes: {},
            },
        ],
        ...ueber,
    });

/** Ein Wechsel des Stands am Weg (geht nur allein). */
const loeschenWeg = (n: number, ueber: Partial<MapHistoryEntry> = {}) =>
    grundEintrag(n, {
        operation: "path.delete",
        objects: [
            {
                kind: "path",
                id: WEG,
                name: "Name",
                action: "path.deleted",
                revisionBefore: 1,
                revisionAfter: 2,
                changes: {},
            },
        ],
        ...ueber,
    });

function serieAus(
    mitglieder: readonly MapHistoryEntry[],
    scope: MapHistorySeries["scope"],
    hash: string,
): { zeile: SerienZeile; meta: MapHistorySeries } {
    const meta: MapHistorySeries = {
        id: id(1),
        size: mitglieder.length,
        delivered: mitglieder.length,
        members: mitglieder.map((m) => m.operationId),
        membersHash: hash.repeat(64),
        scope,
    };
    // Die Liste liefert die neuesten zuerst.
    const neuesteZuerst = mitglieder
        .map((m, i) => ({ ...m, series: { id: meta.id, position: i + 1, size: mitglieder.length } }))
        .reverse();
    return { zeile: gruppiere(neuesteZuerst, new Map([[meta.id, meta]]))[0] as SerienZeile, meta };
}

beforeEach(() => setLocale("de"));

describe("Quellen am Träger: Familie und Adresse (WI-0265 B6g3)", () => {
    it("🔴 jede Art Träger: Familie und Adresse sind die des Trägers, das ↺ ist frei", () => {
        for (const art of ["place", "territory", "landscape", "path"] as const) {
            const e = quellen(1, art);
            expect(ruecknahmeFamilie(e), art).toBe(art);
            expect(ruecknahmeZiel(e), art).toEqual({ familie: art, id: TRAEGER[art] });
            const angebot = angebotEinzeln(e, ruecknahmeZiel(e));
            expect(angebot?.sperre, art).toBeUndefined();
            expect(angebot?.mitglieder, art).toEqual([e.operationId]);
        }
    });

    it("🔴 auch die Rücknahme der Quellen hat dieselbe Adresse (Rücknahme der Rücknahme)", () => {
        for (const [art, operation] of [
            ["place", "place.restore_series"],
            ["territory", "territory.restore_series"],
            ["landscape", "landscape.restore_series"],
            ["path", "path.restore_series"],
        ] as const) {
            const e = quellen(2, art, { operation, source: "restore" });
            expect(ruecknahmeFamilie(e), art).toBe(art);
        }
    });

    it("🔴 die Aktion eines anderen Trägers und die Felder unter dem Namen der Quellen gehören nicht dazu; die Quellen eines Gipfels haben seit B8c die Familie des Gipfels", () => {
        expect(ortArt("traeger.sources", ["place.sources_changed"])).toBe("quellen");
        expect(ortArt("place.restore_series", ["place.sources_changed"])).toBe("quellen");
        expect(ortArt("traeger.sources", ["path.sources_changed"])).toBeUndefined();
        expect(ortArt("traeger.sources", ["place.updated"])).toBeUndefined();
        // Der Name der Felder trägt keine Quellen: Das Protokoll von `place.update` kennt sie nicht.
        expect(ortArt("place.update", ["place.sources_changed"])).toBeUndefined();
        expect(gebietArt("traeger.sources", ["territory.sources_changed"])).toBe("quellen");
        expect(gebietArt("traeger.sources", ["place.sources_changed"])).toBeUndefined();
        expect(wegArt("traeger.sources", ["path.sources_changed"])).toBe("quellen");
        expect(wegArt("traeger.sources", ["territory.sources_changed"])).toBeUndefined();
        // Felder und Quellen in EINER Rücknahme sind Felder, die auch Quellen tragen.
        expect(ortArt("place.restore_series", ["place.updated", "place.sources_changed"])).toBe("felder");
        expect(gebietArt("territory.restore_series", ["territory.updated", "territory.sources_changed"])).toBe(
            "felder",
        );
        expect(wegArt("path.restore_series", ["path.updated", "path.sources_changed"])).toBe("felder");
        const gipfel = quellen(3, "place", {
            objects: [{ ...quellen(3, "place").objects[0]!, kind: "peak", id: GIPFEL, action: "peak.sources_changed" }],
        });
        expect(ruecknahmeFamilie(gipfel)).toBe("peak");
        expect(ruecknahmeZiel(gipfel)).toEqual({ familie: "peak", id: GIPFEL });
    });

    it("🔴 ein Eintrag, der nur die Quellen eines anderen Trägers nennt, gehört dessen Familie, nie einer anderen", () => {
        const amWeg = quellen(1, "place", {
            operation: "path.restore_series",
            objects: [
                { ...quellen(1, "place").objects[0]!, kind: "path", id: WEG, action: "path.sources_changed" },
                { ...quellen(1, "place").objects[0]!, kind: "place", id: ORT, action: "place.sources_changed" },
            ],
        });
        // Zwei Träger in einem Eintrag gibt es nicht: weder Ort noch Weg nehmen ihn an.
        expect(ruecknahmeFamilie(amWeg)).toBeUndefined();
    });

    it("kein Satz „Inhalte werden noch nicht zurückgenommen“ mehr: Eine Art ohne ↺ sagt den allgemeinen Satz", () => {
        const e = quellen(1, "place", { status: "nicht_ruecknehmbar", statusReason: "art" });
        expect(nichtRuecknehmbarSatz(e)).toBe(t("aenderungen.status.grund.art"));
    });
});

describe("Quellen am Träger: Serien (WI-0265 B6g3)", () => {
    it("🔴 Felder und Quellen desselben Orts sind eine Serie und gehen als Ganzes", () => {
        const mitglieder = [felder(1, "place"), quellen(2, "place"), quellen(3, "place")];
        const { zeile, meta } = serieAus(mitglieder, { kind: "place", id: ORT }, "q");
        const ziel = ruecknahmeZiel(zeile.mitglieder[0]!);
        expect(ziel).toEqual({ familie: "place", id: ORT });
        const angebot = angebotSerie(zeile, ziel);
        expect(angebot?.sperre).toBeUndefined();
        expect(angebot?.modus).toBe("serie");
        expect(angebot?.mitglieder).toEqual(meta.members);
        expect(angebot?.membersHash).toBe("q".repeat(64));
        expect(angebot?.offen).toBe(3);
    });

    it("🔴 ein Verschieben in der Serie sperrt sie: Es geht allein", () => {
        const mitglieder = [felder(1, "place"), verschieben(2), quellen(3, "place")];
        const { zeile } = serieAus(mitglieder, { kind: "place", id: ORT }, "v");
        expect(angebotSerie(zeile, ruecknahmeZiel(zeile.mitglieder[0]!))?.sperre).toEqual({ art: "art" });
    });

    it("🔴 am Gebiet und am Weg dasselbe: Felder und Quellen bilden eine Serie", () => {
        for (const art of ["territory", "path"] as const) {
            const { zeile } = serieAus([felder(1, art), quellen(2, art)], { kind: art, id: TRAEGER[art] }, "w");
            expect(angebotSerie(zeile, ruecknahmeZiel(zeile.mitglieder[0]!))?.sperre, art).toBeUndefined();
        }
    });

    it("🔴 ein Wechsel des Stands am Weg in der Serie sperrt sie (er geht allein)", () => {
        const { zeile } = serieAus([quellen(1, "path"), loeschenWeg(2)], { kind: "path", id: WEG }, "x");
        expect(angebotSerie(zeile, ruecknahmeZiel(zeile.mitglieder[0]!))?.sperre).toEqual({ art: "art" });
    });

    it("🔴 eine Serie aus Quellen allein ist eine Serie wie jede: einzeln nur das letzte offene Mitglied", () => {
        const { zeile } = serieAus(
            [quellen(1, "territory"), quellen(2, "territory")],
            { kind: "territory", id: GEBIET },
            "y",
        );
        const aelteres = zeile.mitglieder.find((m) => m.seq === 1)!;
        const juengeres = zeile.mitglieder.find((m) => m.seq === 2)!;
        const ziel = ruecknahmeZiel(juengeres);
        expect(angebotEinzeln(juengeres, ziel, zeile.mitglieder)?.sperre).toBeUndefined();
        expect(angebotEinzeln(aelteres, ziel, zeile.mitglieder)?.sperre).toEqual({ art: "ueberholt", position: 2 });
    });
});

describe("Quellen am Träger: offene Klappboxen lesen nach einer Rücknahme neu (WI-0265 B6g3)", () => {
    beforeEach(() => {
        traegerQuellenMeldung.value = undefined;
    });

    it("🔴 die Meldung nennt, was die Quittung berührte; die Landschaft heißt in der Klappbox `area`, der Gipfel `peak`", () => {
        meldeTraegerQuellen([
            { kind: "place", id: ORT },
            { kind: "landscape", id: LANDSCHAFT },
            { kind: "path", id: WEG },
            { kind: "territory", id: GEBIET },
            { kind: "peak", id: GIPFEL },
        ]);
        const meldung = traegerQuellenMeldung.value!;
        expect(betrifftKlappbox(meldung, "place", ORT)).toBe(true);
        expect(betrifftKlappbox(meldung, "peak", GIPFEL)).toBe(true);
        expect(betrifftKlappbox(meldung, "peak", ORT)).toBe(false);
        expect(betrifftKlappbox(meldung, "area", LANDSCHAFT)).toBe(true);
        expect(betrifftKlappbox(meldung, "path", WEG)).toBe(true);
        expect(betrifftKlappbox(meldung, "territory", GEBIET)).toBe(true);
    });

    it("🔴 ein anderes Objekt und eine andere Art lesen nicht neu", () => {
        meldeTraegerQuellen([{ kind: "place", id: ORT }]);
        const meldung = traegerQuellenMeldung.value!;
        expect(betrifftKlappbox(meldung, "place", GEBIET)).toBe(false);
        expect(betrifftKlappbox(meldung, "territory", ORT)).toBe(false);
        expect(betrifftKlappbox(meldung, "area", ORT)).toBe(false);
    });

    it("🔴 beim Weg liest jeder Abschnitt der Straße neu (die Quittung nennt alle)", () => {
        const abschnitt = "b6930000-0000-4000-8000-0000000000a1";
        meldeTraegerQuellen([
            { kind: "path", id: WEG },
            { kind: "path", id: abschnitt },
        ]);
        expect(betrifftKlappbox(traegerQuellenMeldung.value!, "path", abschnitt)).toBe(true);
    });

    it("nennt die Quittung nichts mit Klappbox (Quelle, Vorkommen, Kraftlinie), entsteht keine Meldung; jede Meldung ist neu", () => {
        meldeTraegerQuellen([
            { kind: "source", id: ORT },
            { kind: "lore", id: ORT },
            { kind: "powerline", id: GIPFEL },
        ]);
        expect(traegerQuellenMeldung.value).toBeUndefined();
        meldeTraegerQuellen([{ kind: "place", id: ORT }]);
        const erste = traegerQuellenMeldung.value!;
        meldeTraegerQuellen([{ kind: "place", id: ORT }]);
        expect(traegerQuellenMeldung.value).not.toBe(erste);
        expect(traegerQuellenMeldung.value!.nr).toBeGreaterThan(erste.nr);
    });

    it("🔴 die Klappbox des betroffenen Objekts liest neu, die eines anderen nicht; nach dem Ende ihres Bereichs hört sie nicht mehr zu", async () => {
        const gelesen: string[] = [];
        const scope = effectScope();
        scope.run(() => {
            liesNeuBeiMeldung(
                () => ({ kind: "place", id: ORT }),
                () => gelesen.push("ort"),
            );
            liesNeuBeiMeldung(
                () => ({ kind: "area", id: LANDSCHAFT }),
                () => gelesen.push("landschaft"),
            );
            liesNeuBeiMeldung(
                () => ({ kind: "path", id: WEG }),
                () => gelesen.push("weg"),
            );
        });
        meldeTraegerQuellen([{ kind: "place", id: ORT }]);
        await nextTick();
        expect(gelesen).toEqual(["ort"]);
        meldeTraegerQuellen([
            { kind: "landscape", id: LANDSCHAFT },
            { kind: "path", id: WEG },
        ]);
        await nextTick();
        expect(gelesen).toEqual(["ort", "landschaft", "weg"]);
        scope.stop();
        meldeTraegerQuellen([{ kind: "place", id: ORT }]);
        await nextTick();
        expect(gelesen).toHaveLength(3);
    });
});
