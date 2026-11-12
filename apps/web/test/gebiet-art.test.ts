import { describe, expect, it } from "vitest";
import type { EditorTerritoryDetail } from "@avesmaps3d/shared";
import { createGebietArt, felderAus, type GebietFelder } from "../src/gebietseditor/gebiet-art.ts";
import { detailLage, tippeDetail } from "../src/gebietseditor/gebiet-detailfelder.ts";

/**
 * Das Herrschaftsgebiet als Art des gemeinsamen Entwurfs (WI-0209 B2; O3, `fenster/bearbeitung.ts`): Felder lesen, EINE Operation
 * `territory.update` bauen, Konflikt und Sicherung. Den Ablauf selbst prüft `fenster-bearbeitung.test.ts`, den Server
 * `apps/server/test/territory-update.test.ts`.
 *
 * Problemfälle: Unveränderte Felder gehen mit; Leerzeichen am Rand zählen als Änderung; die Hauptstadt lässt sich nicht wegnehmen;
 * ohne Änderung geht trotzdem ein Körper raus; der Konflikt verliert eigene Änderungen oder übernimmt fremde nicht.
 */

const ID = "b2000000-0000-4000-8000-000000000001";
const STADT = "b2000000-0000-4000-8000-0000000000c1";

const detail = (extra: Partial<EditorTerritoryDetail> = {}): EditorTerritoryDetail => ({
    id: ID,
    revision: 7,
    name: "Baronie Alt",
    shortName: "Alt",
    type: "Baronie",
    status: "Lehen",
    color: "#b2b065",
    opacity: 0.7,
    order: 0,
    parents: [],
    children: [],
    capital: { id: STADT, name: "Altstadt", kind: "stadt" },
    details: {},
    areas: [],
    claimedBy: [],
    claims: [],
    ...extra,
});
const stand = (felder: Partial<GebietFelder>) => ({ felder: { ...felderAus(detail()), ...felder }, form: undefined });

describe("Gebiet als Art des Entwurfs", () => {
    it("🔴 EINE Operation mit nur den geänderten Feldern, getrimmt, gegen die Revision des Gebiets", () => {
        const art = createGebietArt();
        const start = stand({});
        expect(art.operation(detail(), start, stand({ name: "  Baronie Alt " }), "op")).toBeUndefined();
        expect(art.operation(detail(), start, stand({ name: " Baronie Neu ", status: "" }), "op")).toEqual({
            operationId: "op",
            baseRevision: 7,
            changes: { name: "Baronie Neu", status: "" },
        });
        // Die Hauptstadt wegnehmen ist der leere Wert.
        expect(art.operation(detail(), start, stand({ capital: undefined }), "op")?.changes).toEqual({ capital: "" });
    });

    it("🔴 geändert, fremd und auf neuem Stand: eigene Felder bleiben, fremde kommen", () => {
        const art = createGebietArt();
        expect(art.geaendert(detail(), stand({ shortName: "Neu", capital: undefined }))).toEqual([
            "kurzname",
            "hauptstadt",
        ]);
        const jetzt = detail({ revision: 8, type: "Grafschaft", status: "frei" });
        expect(art.fremde(detail(), jetzt)).toEqual(["art", "status"]);
        const neu = art.aufNeuenStand(detail(), jetzt, stand({ name: "Mein Name", status: "Mein Status" }));
        expect(neu.felder).toMatchObject({ name: "Mein Name", type: "Grafschaft", status: "Mein Status" });
    });

    it("🔴 D1 Umhängen ist ein Feld: changes.parent, zur Wurzel der leere Wert; ein fremdes Umhängen kommt an, ein eigenes bleibt", () => {
        const art = createGebietArt();
        const reich = { id: "b2000000-0000-4000-8000-0000000000a0", name: "Reich" };
        const west = { id: "b2000000-0000-4000-8000-0000000000a1", name: "West" };
        const ost = { id: "b2000000-0000-4000-8000-0000000000a2", name: "Ost" };
        const unter = detail({ parents: [west, reich] });
        const start = { felder: felderAus(unter), form: undefined };
        const nach = (parent: GebietFelder["parent"]) => ({ felder: { ...felderAus(unter), parent }, form: undefined });
        expect(felderAus(unter).parent).toEqual(west);
        expect(art.operation(unter, start, nach(ost), "op")).toEqual({
            operationId: "op",
            baseRevision: 7,
            changes: { parent: ost.id },
        });
        expect(art.operation(unter, start, nach(undefined), "op")?.changes).toEqual({ parent: "" });
        expect(art.geaendert(unter, nach(ost))).toEqual(["obergebiet"]);
        const jetzt = detail({ revision: 8, parents: [ost, reich], parentOrigin: "override" });
        expect(art.fremde(unter, jetzt)).toEqual(["obergebiet"]);
        expect(art.aufNeuenStand(unter, jetzt, start).felder.parent).toEqual(ost);
        expect(art.aufNeuenStand(unter, jetzt, nach(undefined)).felder.parent).toBeUndefined();
    });

    it("🔴 G6 Detailfelder: Tippen schreibt { value } (manual), ↺ { revert: wiki }; Tippen und Löschen an einem leeren Feld schreibt nichts", () => {
        const art = createGebietArt();
        const d = detail({
            details: {
                ruler: { value: "Kaiser Hal", origin: "wiki", wiki: "Kaiser Hal" },
                currency: { value: "", origin: "override", wiki: "Dukaten" },
                language: { value: null, wiki: "Garethi" },
            },
        });
        const f = felderAus(d);
        const start = { felder: f, form: undefined };
        expect(f).toMatchObject({ ruler: "Kaiser Hal", currency: "", language: null, blazon: null });
        expect(f.herkunft).toEqual({ ruler: "wiki", currency: "manual" });
        expect(f.wiki?.werte).toEqual({ ruler: "Kaiser Hal", currency: "Dukaten", language: "Garethi" });
        // Die Zeilen: folgt dem Wiki, weicht (der bewusste Leerwert verdeckt den Wiki-Wert), ohne eigenen Wert, unbekannt.
        expect(detailLage(f, "ruler", false).zustand).toBe("folgt");
        expect(detailLage(f, "currency", false)).toMatchObject({
            zustand: "weicht",
            wikiText: "Dukaten",
            zurueck: true,
        });
        expect(detailLage(f, "language", false)).toMatchObject({ zustand: "weicht", wikiText: "Garethi" });
        expect(detailLage(f, "blazon", false).zustand).toBe("unbekannt");
        expect(detailLage(f, "currency", true)).toMatchObject({ zustand: "lesend", zurueck: false, mitZurueck: false });

        const getippt = tippeDetail(tippeDetail(f, f, "ruler", " Kaiserin Rohaja "), f, "blazon", "Greif");
        const jetzt = art.aufWiki!(art.aufWiki!(getippt, "currency"), "language");
        expect(art.herkunft!(jetzt, "ruler")).toBe("manual");
        expect(jetzt).toMatchObject({ currency: "Dukaten", language: "Garethi" });
        expect(art.geaendert(d, { felder: jetzt, form: undefined })).toEqual([
            "ruler",
            "language",
            "currency",
            "blazon",
        ]);
        expect(art.operation(d, start, { felder: jetzt, form: undefined }, "op")).toEqual({
            operationId: "op",
            baseRevision: 7,
            changes: {
                details: {
                    ruler: { value: "Kaiserin Rohaja" },
                    language: { revert: "wiki" },
                    currency: { revert: "wiki" },
                    blazon: { value: "Greif" },
                },
            },
        });
        // Getippt und wieder gelöscht: kein bewusster Leerwert, nichts geht raus.
        const geloescht = tippeDetail(tippeDetail(f, f, "blazon", "x"), f, "blazon", " ");
        expect(geloescht.blazon).toBeNull();
        expect(geloescht.herkunft).toEqual(f.herkunft);
        expect(art.operation(d, start, { felder: geloescht, form: undefined }, "op")).toBeUndefined();
        // Ein Feld mit Wert leeren ist der bewusste Leerwert (manual).
        expect(
            art.operation(d, start, { felder: tippeDetail(f, f, "ruler", ""), form: undefined }, "op")?.changes,
        ).toEqual({ details: { ruler: { value: "" } } });
        // Auf neuem Stand: das eigene Feld bleibt mit seiner Herkunft, ein fremdes kommt an.
        const fremd = detail({
            revision: 8,
            details: { ...d.details, ruler: { value: "Kaiser Reto", origin: "override", wiki: "Kaiser Hal" } },
        });
        expect(art.fremde(d, fremd)).toEqual(["ruler"]);
        const neu = art.aufNeuenStand(d, fremd, { felder: tippeDetail(f, f, "blazon", "Greif"), form: undefined });
        expect(neu.felder).toMatchObject({ ruler: "Kaiser Reto", blazon: "Greif" });
        expect(neu.felder.herkunft).toMatchObject({ ruler: "manual", blazon: "manual" });
    });

    it("die Sicherung im Browser nimmt nur einen vollständigen Stand", () => {
        const art = createGebietArt();
        const gesichert = art.sicherung!.aus(stand({ name: "X" }));
        expect(art.sicherung!.ein(JSON.parse(JSON.stringify(gesichert)))?.felder.name).toBe("X");
        expect(art.sicherung!.ein({ felder: { name: "X" } })).toBeUndefined();
        expect(art.sicherung!.ein(null)).toBeUndefined();
    });
});
