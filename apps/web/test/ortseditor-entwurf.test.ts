import { describe, expect, it } from "vitest";
import type { EditorPlaceDetail, OperationReceipt, PlaceUpdateBody } from "@avesmaps3d/shared";
import {
    aenderungen,
    allesAufWiki,
    aufWiki,
    aufWikiGroesse,
    aufWikiName,
    eigeneWerte,
    eigenerWert,
    entwurfAus,
    fremdeFelder,
    geaendert,
    groesseZeile,
    nameZeile,
    setzeName,
    setzeText,
    ueberschneiden,
} from "../src/ortseditor/entwurf.ts";
import { createOrtBearbeitung, type OrtApi } from "../src/ortseditor/ort-bearbeitung.ts";

/**
 * Entwurf und Speichern im Ortseditor (WI-0128 E11; EDIT-0001 §4.3; Gesamtmockup Version 7): Was gesendet wird, ist nur die Änderung
 * gegenüber dem gelesenen Stand; ↺ setzt Wert UND Herkunft; ein Konflikt nennt eigene und fremde Felder, und „Eigene Änderung anwenden“
 * geht nur ohne Überschneidung.
 */

const GRATENFELS = "7527ed5b-303a-57af-926e-ed41a8b82dfc";

function ort(revision = 7, ueber: Partial<EditorPlaceDetail> = {}): EditorPlaceDetail {
    return {
        publicId: GRATENFELS,
        revision,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: { x: 450.2, y: 535.64 },
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: "Eine Stadt am Fluss.", origin: null, wiki: "Hauptstadt der Grafschaft." },
            einwohner: { value: null, origin: null, wiki: "2.200" },
            lage: { value: "Kosch", origin: "wiki", wiki: "Kosch" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels", state: "assigned" },
        pathEnds: [],
        ...ueber,
    };
}

describe("Entwurf: nur die Änderung, ↺ mit Herkunft", () => {
    it("frisch geladen ändert nichts; ein Feld ohne eigenen Wert zeigt den Wiki-Wert", () => {
        const entwurf = entwurfAus(ort());
        expect(aenderungen(ort(), entwurf)).toEqual({});
        expect(entwurf.texte.einwohner).toEqual({ wert: "2.200", wiki: true });
        expect(entwurf.texte.description).toEqual({ wert: "Eine Stadt am Fluss.", wiki: false });
    });

    it("🔴 getippt ist ein eigener Wert; ↺ wird { revert: 'wiki' }; Name getrimmt, leere Art wird null", () => {
        let entwurf = setzeText(entwurfAus(ort()), "einwohner", "2.500");
        entwurf = { ...entwurf, name: " Gratenfels am Fluss ", kind: " " };
        expect(aenderungen(ort(1, { kind: "Festung" }), { ...entwurf })).toMatchObject({
            name: "Gratenfels am Fluss",
            kind: null,
            einwohner: { value: "2.500" },
        });
        expect(eigenerWert(ort(), entwurf, "einwohner")).toBe(true);
        const zurueck = aufWiki(ort(), entwurf, "description");
        expect(aenderungen(ort(), zurueck)).toMatchObject({ description: { revert: "wiki" } });
        expect(geaendert(aenderungen(ort(), zurueck))).toEqual(["name", "einwohner", "description"]);
    });

    it("🔴 die sechs Merkmale sind Haken im Entwurf: Seehafen, Nodix, Unterirdisch und Entrückt gehen wie Ruine und Verborgen", () => {
        const entwurf = { ...entwurfAus(ort()), seaport: true, nodix: true, underground: true, withdrawn: true };
        expect(aenderungen(ort(), entwurf)).toEqual({ seaport: true, nodix: true, underground: true, withdrawn: true });
        expect(geaendert(aenderungen(ort(), entwurf))).toEqual(["seaport", "nodix", "underground", "withdrawn"]);
        expect(entwurfAus(ort(1, { seaport: true }))).toMatchObject({ seaport: true, underground: false });
    });

    it("„↺ Alles auf Wiki-Werte“ zählt und setzt nur Felder mit eigenem Wert; ein Feld ohne Wiki-Wert bleibt", () => {
        let entwurf = setzeText(entwurfAus(ort()), "oberhaupt", "Graf Probe");
        entwurf = setzeText(entwurf, "einwohner", "9");
        expect(eigeneWerte(ort(), entwurf)).toBe(2);
        const alle = allesAufWiki(ort(), entwurf);
        expect(eigeneWerte(ort(), alle)).toBe(0);
        expect(alle.texte.oberhaupt).toEqual({ wert: "Graf Probe", wiki: false });
        expect(alle.texte.description).toEqual({ wert: "Hauptstadt der Grafschaft.", wiki: true });
    });

    it("ein geleertes Feld ohne eigenen Wert ändert nichts; ein geleertes mit eigenem Wert löscht ihn", () => {
        expect(aenderungen(ort(), setzeText(entwurfAus(ort()), "einwohner", ""))).toEqual({});
        expect(aenderungen(ort(), setzeText(entwurfAus(ort()), "description", " "))).toEqual({
            description: { value: null },
        });
    });

    it("fremde Felder und Überschneidung: was zwischen zwei Ständen anders ist", () => {
        const jetzt = ort(8, {
            hidden: true,
            fields: { ...ort().fields, einwohner: { value: "2.300", origin: "manual", wiki: "2.200" } },
        });
        const fremde = fremdeFelder(ort(), jetzt);
        expect(fremde).toEqual(["einwohner", "hidden"]);
        expect(ueberschneiden(["name", "einwohner"], fremde)).toEqual(["einwohner"]);
        expect(ueberschneiden(["name"], fremde)).toEqual([]);
    });
});

/** Ein Server zum Anfassen: jede Antwort aus einer Warteschlange, jede Anfrage protokolliert. */
function server(
    lesen: (EditorPlaceDetail | null)[],
    speichern: Awaited<ReturnType<OrtApi["speichereOrt"]>>[],
): OrtApi & { gesendet: PlaceUpdateBody[] } {
    const gesendet: PlaceUpdateBody[] = [];
    return {
        gesendet,
        ort: () => Promise.resolve(lesen.shift() ?? null),
        speichereOrt: (_id, body) => {
            gesendet.push(body);
            return Promise.resolve(speichern.shift()!);
        },
    };
}
const quittung = (revision: number, warnings: OperationReceipt["warnings"] = []): OperationReceipt => ({
    operationId: "x",
    status: "applied",
    environment: "test",
    affected: [{ kind: "place", id: GRATENFELS, revision }],
    derivedWork: [],
    warnings,
});
const warte = () => new Promise((resolve) => setTimeout(resolve, 0));
let kennung = 0;
const neueKennung = () => `00000000-0000-4000-8000-${String((kennung += 1)).padStart(12, "0")}`;

describe("Bearbeitung: Speichern, Konflikt, Ablehnung", () => {
    it("🔴 speichert nur die Änderung auf der gelesenen Revision, liest danach neu: „Gespeichert als Revision 8“", async () => {
        const api = server([ort(), ort(8, { name: "Gratenfels Neu" })], [{ ok: true, quittung: quittung(8) }]);
        const b = createOrtBearbeitung(GRATENFELS, api, neueKennung);
        await warte();
        expect(b.zustand.value).toEqual({ art: "bereit" });
        b.aendere((e) => ({ ...e, name: "Gratenfels Neu" }));
        expect(b.ungespeichert.value).toBe(true);
        await b.speichern();
        expect(api.gesendet).toEqual([
            { operationId: expect.any(String), baseRevision: 7, changes: { name: "Gratenfels Neu" } },
        ]);
        expect(b.zustand.value).toEqual({ art: "gespeichert", revision: 8, befunde: [] });
        expect(b.ungespeichert.value).toBe(false);
        expect(b.detail.value?.revision).toBe(8);
    });

    it("🔴 Konflikt ohne Überschneidung: nennt wer und welche Felder; „anwenden“ sendet nur die eigenen auf die neue Revision", async () => {
        const jetzt = ort(8, { hidden: true });
        const api = server(
            [ort(), jetzt, ort(9, { hidden: true, name: "Gratenfels Neu" })],
            [
                {
                    ok: false,
                    status: 409,
                    fehler: {
                        code: "edit_conflict",
                        message: "Jemand hat das gerade geändert.",
                        details: { currentRevision: 8, changedBy: { id: "p", displayName: "Rondrikan" } },
                    },
                },
                { ok: true, quittung: quittung(9) },
            ],
        );
        const b = createOrtBearbeitung(GRATENFELS, api, neueKennung);
        await warte();
        b.aendere((e) => ({ ...e, name: "Gratenfels Neu" }));
        await b.speichern();
        expect(b.zustand.value).toMatchObject({
            art: "konflikt",
            wer: "Rondrikan",
            eigene: ["name"],
            fremde: ["hidden"],
            beide: [],
        });
        await b.eigeneAnwenden();
        expect(api.gesendet[1]).toEqual({
            operationId: expect.any(String),
            baseRevision: 8,
            changes: { name: "Gratenfels Neu" },
        });
        // Jede Handlung eine eigene Kennung.
        expect(api.gesendet[1]!.operationId).not.toBe(api.gesendet[0]!.operationId);
        expect(b.zustand.value).toMatchObject({ art: "gespeichert", revision: 9 });
        expect(b.detail.value?.hidden).toBe(true);
    });

    it("🔴 Konflikt mit Überschneidung: „anwenden“ tut nichts, „trotzdem“ überschreibt, „fremden Stand“ verwirft den Entwurf", async () => {
        const jetzt = ort(8, { name: "Gratenfels an der Breite" });
        const konflikt = {
            ok: false as const,
            status: 409,
            fehler: { code: "edit_conflict", message: "x", details: { currentRevision: 8 } },
        };
        const api = server([ort(), jetzt, jetzt], [konflikt, konflikt]);
        const b = createOrtBearbeitung(GRATENFELS, api, neueKennung);
        await warte();
        b.aendere((e) => ({ ...e, name: "Gratenfels Neu" }));
        await b.speichern();
        expect(b.zustand.value).toMatchObject({ art: "konflikt", beide: ["name"], wer: undefined });
        await b.eigeneAnwenden();
        expect(api.gesendet).toHaveLength(1);
        await b.eigeneAnwenden(true);
        expect(api.gesendet[1]).toMatchObject({ baseRevision: 8, changes: { name: "Gratenfels Neu" } });
        b.fremdenUebernehmen();
        expect(b.zustand.value).toEqual({ art: "bereit" });
        expect(b.entwurf.value?.name).toBe("Gratenfels an der Breite");
        expect(b.ungespeichert.value).toBe(false);
    });

    it("abgelehnt (Zug läuft, 503): der Satz des Servers, der Entwurf bleibt; Verwerfen setzt zurück", async () => {
        const api = server(
            [ort()],
            [
                {
                    ok: false,
                    status: 503,
                    fehler: {
                        code: "map_import_running",
                        message: "Die Karte wird gerade aus Legacy zurückgesetzt. Speichern geht gleich wieder.",
                    },
                },
            ],
        );
        const b = createOrtBearbeitung(GRATENFELS, api, neueKennung);
        await warte();
        b.aendere((e) => ({ ...e, ruined: true }));
        await b.speichern();
        expect(b.zustand.value).toMatchObject({ art: "abgelehnt", code: "map_import_running" });
        expect(b.ungespeichert.value).toBe(true);
        b.verwerfen();
        expect(b.ungespeichert.value).toBe(false);
        expect(b.zustand.value).toEqual({ art: "bereit" });
    });

    it("ohne Änderung sendet Speichern nichts; ein verschwundener Ort heißt „fehlt“", async () => {
        const api = server([ort()], []);
        const b = createOrtBearbeitung(GRATENFELS, api, neueKennung);
        await warte();
        await b.speichern();
        expect(api.gesendet).toEqual([]);
        const weg = createOrtBearbeitung(GRATENFELS, server([null], []), neueKennung);
        await warte();
        expect(weg.zustand.value).toEqual({ art: "fehlt" });
    });
});

/**
 * Der Name als Wiki-Feld (WI-0225; Orchestrierung 2026-10-18: am Ort gilt Legacy). Problemfälle: ↺ am Namen sendet den Text statt
 * `{ revert: "wiki" }` (dann setzt der Server die Herkunft manual); ein getippter Name gleich dem Wiki-Namen gilt als wiki; ohne Artikel
 * steht ein Wiki-Name da; „↺ Alles auf Wiki-Werte“ zählt den Namen nicht.
 */
describe("Der Name mit Wiki-Wert (WI-0225)", () => {
    const mitName = (ueber: Partial<EditorPlaceDetail> = {}): EditorPlaceDetail =>
        ort(7, { nameWiki: "Gratenfels (Stadt)", ...ueber });

    it("🔴 weicht ab: ↺ setzt den Wiki-Namen und sendet { revert: wiki }; getippt sendet den Text", () => {
        const detail = mitName();
        const start = entwurfAus(detail);
        expect(nameZeile(detail, start)).toMatchObject({
            zustand: "weicht",
            wikiText: "Gratenfels (Stadt)",
            zurueck: true,
        });
        const zurueck = aufWikiName(detail, start);
        expect(zurueck.name).toBe("Gratenfels (Stadt)");
        expect(nameZeile(detail, zurueck).zustand).toBe("folgt");
        expect(aenderungen(detail, zurueck)).toEqual({ name: { revert: "wiki" } });
        const getippt = setzeName(zurueck, "Gratenfels (Stadt)");
        expect(nameZeile(detail, getippt).zustand).toBe("gleich");
        expect(aenderungen(detail, getippt)).toEqual({ name: "Gratenfels (Stadt)" });
    });

    it("gelesen mit Herkunft wiki heißt „folgt“; ohne Artikel kein Gegenstück; ohne Wiki-Namen unbekannt", () => {
        const folgt = mitName({ name: "Gratenfels (Stadt)", herkunft: { name: "wiki" } });
        expect(nameZeile(folgt, entwurfAus(folgt)).zustand).toBe("folgt");
        expect(aenderungen(folgt, entwurfAus(folgt))).toEqual({});
        const ohneArtikel = ort(7, { wiki: null });
        expect(nameZeile(ohneArtikel, entwurfAus(ohneArtikel)).zustand).toBe("ohne");
        expect(nameZeile(ort(), entwurfAus(ort())).zustand).toBe("unbekannt");
        expect(aufWikiName(ort(), entwurfAus(ort()))).toEqual(entwurfAus(ort()));
    });

    it("„↺ Alles auf Wiki-Werte“ zählt und setzt den Namen mit", () => {
        const detail = mitName();
        const start = entwurfAus(detail);
        const vorher = eigeneWerte(detail, start);
        expect(eigeneWerte(ort(), entwurfAus(ort()))).toBe(vorher - 1);
        const alle = allesAufWiki(detail, start);
        expect(alle.name).toBe("Gratenfels (Stadt)");
        expect(eigeneWerte(detail, alle)).toBe(0);
    });
});

describe("Die Ortsgröße mit Wiki-Wert (WI-0225)", () => {
    const beschrifte = (wert: string): string => ({ stadt: "Stadt", kleinstadt: "Kleinstadt" })[wert] ?? wert;

    it("🔴 weicht ab: in der Beschriftung des Auswahlfelds, ↺ sendet { revert: wiki }; ohne Wiki-Wert unbekannt", () => {
        const detail = ort(7, { subtypeWiki: "kleinstadt" });
        const start = entwurfAus(detail);
        expect(groesseZeile(detail, start, beschrifte)).toMatchObject({ zustand: "weicht", wikiText: "Kleinstadt" });
        const zurueck = aufWikiGroesse(detail, start);
        expect(zurueck.subtype).toBe("kleinstadt");
        expect(groesseZeile(detail, zurueck, beschrifte).zustand).toBe("folgt");
        expect(aenderungen(detail, zurueck)).toEqual({ subtype: { revert: "wiki" } });
        expect(groesseZeile(ort(), entwurfAus(ort()), beschrifte).zustand).toBe("unbekannt");
        expect(eigeneWerte(detail, start)).toBe(eigeneWerte(ort(), entwurfAus(ort())) + 1);
    });
});
